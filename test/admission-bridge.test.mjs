import test from 'node:test'
import assert from 'node:assert/strict'
import { AdmissionRegistry } from '../lib/admission.js'
import { installAdmissionBridge } from '../lib/admission-bridge.js'

function makeBaseInfo(overrides = {}) {
  return {
    id: 'p/m',
    inputModalities: ['text'],
    ...overrides,
  }
}

function makeHarness({ originalInfo, originalError } = {}) {
  const calls = []
  const llm = {
    async resolveModelInfo(provider, model, signal) {
      calls.push({ provider, model, signal })
      if (originalError) throw originalError
      return originalInfo ?? makeBaseInfo({ provider, model, signal })
    },
  }
  const sessions = {
    async prompt(request) {
      const info = await llm.resolveModelInfo(request.payload.provider, request.payload.model)
      return { kind: 'prompt', info, payload: request.payload }
    },
    async selectModel(request) {
      const info = await llm.resolveModelInfo(request.payload.provider, request.payload.model)
      return { kind: 'selectModel', info, payload: request.payload }
    },
  }
  const agents = {
    get(sessionId) {
      return { sessionId }
    },
  }
  const logger = { errors: [], warns: [], error(m) { this.errors.push(m) }, warn(m) { this.warns.push(m) } }
  return { llm, sessions, agents, logger, calls }
}

test('outside admission scope resolveModelInfo is byte-identical and same object', async () => {
  const expected = makeBaseInfo({ provider: 'p', model: 'm', signal: undefined })
  const { llm, sessions, agents, logger } = makeHarness({ originalInfo: expected })
  const registry = new AdmissionRegistry()
  registry.register({ id: 'i', match: () => true, project: (o) => o })

  installAdmissionBridge({ llm, apiProxy: { sessions }, registry, agents, logger })

  const result = await llm.resolveModelInfo('p', 'm')
  assert.equal(result, expected)
})

test('inside prompt/selectModel scope matching text route appends image', async () => {
  const { llm, sessions, agents, logger } = makeHarness()
  const registry = new AdmissionRegistry()
  registry.register({ id: 'i', match: () => true, project: (o) => o })

  installAdmissionBridge({ llm, apiProxy: { sessions }, registry, agents, logger })

  const viaPrompt = await sessions.prompt({ payload: { sessionId: 's1', provider: 'p', model: 'm' } })
  assert.deepEqual(viaPrompt.info.inputModalities, ['text', 'image'])

  const viaSelect = await sessions.selectModel({ payload: { sessionId: 's1', provider: 'p', model: 'm' } })
  assert.deepEqual(viaSelect.info.inputModalities, ['text', 'image'])
})

test('native image-capable route is not modified', async () => {
  const { llm, sessions, agents, logger } = makeHarness({ originalInfo: makeBaseInfo({ inputModalities: ['text', 'image'] }) })
  const registry = new AdmissionRegistry()
  registry.register({ id: 'i', match: () => true, project: (o) => o })

  installAdmissionBridge({ llm, apiProxy: { sessions }, registry, agents, logger })

  const result = await sessions.prompt({ payload: { sessionId: 's1', provider: 'p', model: 'm' } })
  assert.deepEqual(result.info.inputModalities, ['text', 'image'])
})

test('undefined inputModalities is not added', async () => {
  const { llm, sessions, agents, logger } = makeHarness({ originalInfo: { id: 'p/m' } })
  const registry = new AdmissionRegistry()
  registry.register({ id: 'i', match: () => true, project: (o) => o })

  installAdmissionBridge({ llm, apiProxy: { sessions }, registry, agents, logger })

  const result = await sessions.prompt({ payload: { sessionId: 's1', provider: 'p', model: 'm' } })
  assert.equal(result.info.inputModalities, undefined)
})

test('no matching intent inside scope leaves info unchanged', async () => {
  const { llm, sessions, agents, logger } = makeHarness()
  const registry = new AdmissionRegistry()
  registry.register({ id: 'i', match: () => false, project: (o) => o })

  installAdmissionBridge({ llm, apiProxy: { sessions }, registry, agents, logger })

  const result = await sessions.prompt({ payload: { sessionId: 's1', provider: 'p', model: 'm' } })
  assert.deepEqual(result.info.inputModalities, ['text'])
})

test('original resolveModelInfo throwing is rethrown as the same error object', async () => {
  const boom = new Error('boom')
  const { llm, sessions, agents, logger } = makeHarness({ originalError: boom })
  const registry = new AdmissionRegistry()

  installAdmissionBridge({ llm, apiProxy: { sessions }, registry, agents, logger })

  let caught
  try {
    await llm.resolveModelInfo('p', 'm')
  } catch (error) {
    caught = error
  }
  assert.equal(caught, boom)
})

test('dispose restores all wrapped boundaries and flips isActive to false', async () => {
  const { llm, sessions, agents, logger } = makeHarness()
  const registry = new AdmissionRegistry()

  const originalResolveModelInfo = llm.resolveModelInfo
  const originalPrompt = sessions.prompt
  const originalSelectModel = sessions.selectModel

  const bridge = installAdmissionBridge({ llm, apiProxy: { sessions }, registry, agents, logger })
  assert.equal(bridge.isActive(), true)

  bridge.dispose()

  assert.equal(llm.resolveModelInfo, originalResolveModelInfo)
  assert.equal(sessions.prompt, originalPrompt)
  assert.equal(sessions.selectModel, originalSelectModel)
  assert.equal(bridge.isActive(), false)
})

test('dispose does not tear down another plugin wrapper and degrades to transparent', async () => {
  const { llm, sessions, agents, logger } = makeHarness()
  const registry = new AdmissionRegistry()
  registry.register({ id: 'i', match: () => true, project: (o) => o })

  const bridge = installAdmissionBridge({ llm, apiProxy: { sessions }, registry, agents, logger })
  const ourWrapper = llm.resolveModelInfo
  const otherWrapper = async (...args) => ourWrapper(...args)
  llm.resolveModelInfo = otherWrapper

  bridge.dispose()

  assert.equal(llm.resolveModelInfo, otherWrapper)
  assert.ok(logger.warns.length > 0)
  // our wrapper still exists under the other plugin's wrapper but is now
  // transparent: no image is appended.
  const result = await llm.resolveModelInfo('p', 'm')
  assert.deepEqual(result.inputModalities, ['text'])
})

test('repeated install in the same module instance does not nest wrappers', async () => {
  const { llm, sessions, agents, logger } = makeHarness()
  const registry = new AdmissionRegistry()

  const first = installAdmissionBridge({ llm, apiProxy: { sessions }, registry, agents, logger })
  const firstWrapper = llm.resolveModelInfo
  const second = installAdmissionBridge({ llm, apiProxy: { sessions }, registry, agents, logger })

  assert.notEqual(second, first)
  assert.equal(llm.resolveModelInfo, firstWrapper)
  // The second handle is a no-op owner for the already-installed chain.
  second.dispose()
  assert.equal(llm.resolveModelInfo, firstWrapper)

  first.dispose()
  assert.notEqual(llm.resolveModelInfo, firstWrapper)
})
