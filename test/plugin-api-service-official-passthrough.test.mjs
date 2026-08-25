import test from 'node:test'
import assert from 'node:assert/strict'
import { createFeatureRegistry } from '../lib/feature-registry.js'
import { PluginApiFeatureDisabledError, PluginApiInactiveError } from '../lib/errors.js'
import { createOfficialPassthroughHost } from '../lib/official-passthrough-host.js'
import { createPluginApiService } from '../lib/plugin-api-service.js'

function createService(coreActive = true) {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.6', registry, coreActive })
  const ctx = { reflect: { provide() {} } }
  return { registry, service: new ServiceClass(ctx) }
}

test('host owner forwards original arguments, receiver, result, throws, and rejected promises', async () => {
  const calls = []
  const syncResult = {}
  const rejected = Promise.reject(new Error('official rejection'))
  const namespace = {
    renderContextSnapshot(...args) {
      calls.push({ name: 'snapshot', receiver: this, args })
      return syncResult
    },
    joinContextSections(...args) {
      calls.push({ name: 'join', receiver: this, args })
      return rejected
    },
  }
  const owner = createOfficialPassthroughHost({ namespace })
  const assembly = { contexts: [], variables: {} }
  const sections = [{ name: 'runtime', text: 'value' }]

  assert.equal(owner.api.renderContextSnapshot(assembly), syncResult)
  const returned = owner.api.joinContextSections(sections)
  assert.equal(returned, rejected)
  assert.deepEqual(calls, [
    { name: 'snapshot', receiver: namespace, args: [assembly] },
    { name: 'join', receiver: namespace, args: [sections] },
  ])
  await assert.rejects(returned, /official rejection/)
})

test('host owner preserves synchronous throws without wrapping them', () => {
  const syncError = new Error('official synchronous failure')
  const owner = createOfficialPassthroughHost({
    namespace: {
      renderContextSnapshot() { throw syncError },
      joinContextSections() { return '' },
    },
  })

  assert.throws(
    () => owner.api.renderContextSnapshot({}),
    (error) => error === syncError,
  )
})

test('helper slots follow the service active state after reconciliation', () => {
  let active = true
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({
    apiVersion: '0.6',
    registry,
    coreActive: () => active,
  })
  const service = new ServiceClass({ reflect: { provide() {} } })
  service.mountFeature('systemPrompt', { section() {} })
  service.mountFeature('officialPassthrough', {
    renderContextSnapshot() { return 'snapshot' },
    joinContextSections() { return 'joined' },
  })

  assert.equal(service.systemPrompt.renderContextSnapshot(), 'snapshot')
  active = false
  assert.throws(
    () => service.systemPrompt.renderContextSnapshot(),
    (error) => error instanceof PluginApiInactiveError,
  )
})

test('each malformed helper is independently disabled with a safe diagnostic', () => {
  const errors = []
  const owner = createOfficialPassthroughHost({
    namespace: {
      renderContextSnapshot: 'not callable',
      joinContextSections(sections) { return sections },
    },
    logger: { error(message) { errors.push(message) } },
  })

  assert.equal(owner.diagnostics['systemPrompt.renderContextSnapshot'].reason, 'invalid-export')
  assert.equal(owner.diagnostics['systemPrompt.joinContextSections'], undefined)
  assert.equal(errors.length, 1)
  assert.match(errors[0], /systemPrompt\.renderContextSnapshot/)
  assert.match(errors[0], /invalid-export/)
  assert.doesNotMatch(errors[0], /not callable/)
  assert.throws(
    () => owner.api.renderContextSnapshot({ secret: 'input' }),
    (error) => error instanceof PluginApiFeatureDisabledError
      && error.feature === 'systemPrompt.renderContextSnapshot',
  )
  const sections = []
  assert.equal(owner.api.joinContextSections(sections), sections)
})

test('retained service surfaces are revoked across replacement and stale cleanup', () => {
  const { registry, service } = createService()
  const base = {
    isActive: true,
    section() { return 'base-disposer' },
    renderContextSnapshot() { return 'base-snapshot' },
    joinContextSections() { return 'base-join' },
  }
  service.mountFeature('systemPrompt', base)
  registry.mount('systemPrompt')

  const first = {
    renderContextSnapshot() { return 'first-snapshot' },
    joinContextSections() { return 'first-join' },
  }
  const firstToken = service.mountFeature('officialPassthrough', first)
  registry.mount('officialPassthrough')
  const retainedFirst = service.systemPrompt

  const second = {
    renderContextSnapshot() { return 'second-snapshot' },
    joinContextSections() { return 'second-join' },
  }
  const secondToken = service.mountFeature('officialPassthrough', second)

  assert.equal(service.systemPrompt.renderContextSnapshot(), 'second-snapshot')
  assert.throws(
    () => retainedFirst.renderContextSnapshot(),
    (error) => error instanceof PluginApiFeatureDisabledError
      && error.feature === 'systemPrompt.renderContextSnapshot',
  )
  assert.equal(service.unmountFeature('officialPassthrough', firstToken), false)
  assert.equal(service.systemPrompt.joinContextSections(), 'second-join')
  assert.equal(service.unmountFeature('officialPassthrough', secondToken), true)
  assert.equal(service.systemPrompt.renderContextSnapshot(), 'base-snapshot')
})

test('internal host identity is not added to the public feature snapshot', () => {
  const { registry, service } = createService()
  registry.mount('officialPassthrough')
  assert.equal(service.features.some(({ name }) => name === 'officialPassthrough'), false)
})

test('inactive service rejects helper calls before touching the owner', () => {
  const { service } = createService(false)
  const owner = createOfficialPassthroughHost({
    namespace: {
      renderContextSnapshot() { throw new Error('must not call') },
      joinContextSections() { throw new Error('must not call') },
    },
    active: () => service.isActive,
  })
  service.mountFeature('systemPrompt', { isActive: true })
  service.mountFeature('officialPassthrough', owner.api)

  assert.throws(() => service.systemPrompt.renderContextSnapshot({}), PluginApiInactiveError)
})
