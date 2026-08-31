import test from 'node:test'
import assert from 'node:assert/strict'
import { createAgentCreateExtension } from '../lib/agent-create-api.js'

function createRegistry(overrides = {}) {
  const calls = []
  const results = {
    create: Promise.resolve({ agent: { id: 'created' }, dispose() {} }),
    resume: Promise.resolve({ agent: { id: 'resumed' }, dispose() {} }),
    register: () => {},
    enter: () => {},
    announce: undefined,
    setFactory: () => {},
  }
  const registry = {}
  for (const name of ['create', 'resume', 'register', 'enter', 'announce', 'setFactory']) {
    registry[name] = function (...args) {
      calls.push({ name, args, receiver: this })
      return results[name]
    }
  }
  return { registry: Object.assign(registry, overrides), calls, results }
}

function createExtension(registry, options = {}) {
  return createAgentCreateExtension({
    probeRegistry: () => registry,
    resolveRegistry: (ctx) => ctx.registry,
    ...options,
  })
}

test('all agent extension members preserve exact arguments, receiver, and raw return identities', () => {
  const { registry, calls, results } = createRegistry()
  const api = createExtension(registry).createView({ registry })
  const options = {}
  const resume = {}
  const agent = {}
  const owner = {}
  const factory = {}

  assert.equal(api.create(options), results.create)
  assert.equal(api.resume(resume), results.resume)
  assert.equal(api.register(agent), results.register)
  assert.equal(api.providers.enter(agent, owner), results.enter)
  assert.equal(api.providers.announce(agent), results.announce)
  assert.equal(api.providers.setFactory(factory), results.setFactory)
  assert.deepEqual(calls.map(({ name, args, receiver }) => [name, args, receiver]), [
    ['create', [options], registry],
    ['resume', [resume], registry],
    ['register', [agent], registry],
    ['enter', [agent, owner], registry],
    ['announce', [agent], registry],
    ['setFactory', [factory], registry],
  ])
})

test('create and resume return the official registry promises and their exact handles', async () => {
  const handle = { agent: {}, dispose() {} }
  const createPromise = Promise.resolve(handle)
  const resumePromise = Promise.resolve(handle)
  const { registry } = createRegistry({ create: () => createPromise, resume: () => resumePromise })
  const api = createExtension(registry).createView({ registry })

  assert.equal(api.create({}), createPromise)
  assert.equal(api.resume({}), resumePromise)
  assert.equal(await createPromise, handle)
  assert.equal(await resumePromise, handle)
})

test('calls resolve the registry from each consumer context instead of the probe registry', () => {
  const probe = createRegistry().registry
  const first = createRegistry()
  const second = createRegistry()
  const extension = createExtension(probe)

  extension.createView({ registry: first.registry }).register({ id: 'first' })
  extension.createView({ registry: second.registry }).register({ id: 'second' })

  assert.equal(first.calls[0].receiver, first.registry)
  assert.equal(second.calls[0].receiver, second.registry)
  assert.equal(probe.register, probe.register)
})

test('official errors and rejections pass through unchanged without diagnostics', async () => {
  const thrown = new Error('duplicate agent')
  const rejected = new Error('factory failed')
  const logs = []
  const { registry } = createRegistry({
    register() { throw thrown },
    create() { return Promise.reject(rejected) },
  })
  const api = createExtension(registry, { logger: { error(message) { logs.push(message) } } }).createView({ registry })

  assert.throws(() => api.register({}), (error) => error === thrown)
  await assert.rejects(() => api.create({}), (error) => error === rejected)
  assert.deepEqual(logs, [])
})

test('availability has frozen exact shape and provider is active only for three available members', () => {
  const { registry } = createRegistry({ announce: undefined })
  const extension = createExtension(registry)
  const availability = extension.availability
  const view = extension.createView({ registry })

  assert.deepEqual(availability, {
    create: true,
    resume: true,
    register: true,
    providers: { enter: true, announce: false, setFactory: true, register: false },
  })
  assert.ok(Object.isFrozen(availability))
  assert.ok(Object.isFrozen(availability.providers))
  assert.equal(view.providers.isActive, false)
  assert.throws(() => view.providers.announce({}), (error) => {
    assert.equal(error.code, 'PLUGIN_API_FEATURE_DISABLED')
    assert.equal(error.feature, 'agents')
    assert.match(error.message, /providers\.announce/)
    return true
  })
})

test('a throwing probe marks only that member unavailable and preserves siblings', () => {
  const { registry } = createRegistry()
  Object.defineProperty(registry, 'enter', { get() { throw new Error('probe boom') } })
  const extension = createExtension(registry)
  const view = extension.createView({ registry })

  assert.equal(extension.availability.providers.enter, false)
  assert.equal(extension.availability.create, true)
  assert.equal(view.providers.isActive, false)
  assert.equal(typeof view.create, 'function')
})

test('late resolution failure degrades only the affected member once and never invokes it', () => {
  const { registry, calls } = createRegistry()
  const logs = []
  let failCreate = false
  const extension = createAgentCreateExtension({
    probeRegistry: () => registry,
    resolveRegistry() {
      if (failCreate) return { ...registry, create: undefined }
      return registry
    },
    logger: { error(message) { logs.push(message) } },
  })
  const view = extension.createView({})

  failCreate = true
  assert.throws(() => view.create({}), /agents extension member "create" is unavailable/)
  assert.throws(() => view.create({}), /agents extension member "create" is unavailable/)
  assert.equal(extension.availability.create, false)
  assert.equal(calls.length, 0)
  assert.deepEqual(logs, ['dsh-plugin-api agent create is unavailable (call-resolution)'])
})

test('inactive state wins before registry resolution', () => {
  const { registry } = createRegistry()
  let resolved = 0
  const extension = createAgentCreateExtension({
    probeRegistry: () => registry,
    resolveRegistry() { resolved += 1; return registry },
    active: false,
  })

  assert.throws(() => extension.createView({}).create({}), (error) => error.code === 'PLUGIN_API_INACTIVE')
  assert.equal(resolved, 0)
})

test('official disposer and AgentHandle.dispose remain unwrapped after containment', async () => {
  let disposed = 0
  const disposer = () => { disposed += 1 }
  const handle = { dispose: disposer }
  const { registry } = createRegistry({
    create: () => Promise.resolve(handle),
    setFactory: () => disposer,
  })
  const extension = createExtension(registry)
  const view = extension.createView({ registry })
  const returnedHandle = await view.create({})

  assert.equal(returnedHandle, handle)
  assert.equal(returnedHandle.dispose, disposer)
  assert.equal(view.providers.setFactory({}), disposer)
  returnedHandle.dispose()
  assert.equal(disposed, 1)
})

test('missing factory and occupied provider slot remain official call-time outcomes', () => {
  const noFactory = new Error('no factory')
  const occupied = new Error('occupied')
  const { registry } = createRegistry({
    create() { return Promise.reject(noFactory) },
    setFactory() { throw occupied },
  })
  const extension = createExtension(registry)
  const view = extension.createView({ registry })

  assert.throws(() => view.providers.setFactory({}), (error) => error === occupied)
  assert.equal(extension.availability.providers.setFactory, true)
  assert.equal(extension.availability.create, true)
  return assert.rejects(() => view.create({}), (error) => error === noFactory)
})

test('direct and facade calls preserve receiver ownership for all ownership-sensitive members', () => {
  const direct = createRegistry()
  const facade = createRegistry()
  const extension = createExtension(direct.registry)
  const options = {}
  const agent = {}
  const factory = {}

  direct.registry.create(options)
  direct.registry.resume(options)
  direct.registry.register(agent)
  direct.registry.setFactory(factory)
  extension.createView({ registry: facade.registry }).create(options)
  extension.createView({ registry: facade.registry }).resume(options)
  extension.createView({ registry: facade.registry }).register(agent)
  extension.createView({ registry: facade.registry }).providers.setFactory(factory)

  assert.deepEqual(direct.calls.map(({ name, receiver }) => [name, receiver]), [
    ['create', direct.registry],
    ['resume', direct.registry],
    ['register', direct.registry],
    ['setFactory', direct.registry],
  ])
  assert.deepEqual(facade.calls.map(({ name, receiver }) => [name, receiver]), [
    ['create', facade.registry],
    ['resume', facade.registry],
    ['register', facade.registry],
    ['setFactory', facade.registry],
  ])
})

test('every agent extension leaf independently degrades for missing, non-function, and throwing probes', () => {
  for (const member of ['create', 'resume', 'register', 'enter', 'announce', 'setFactory']) {
    for (const mode of ['missing', 'non-function', 'throwing']) {
      const { registry } = createRegistry()
      if (mode === 'missing') delete registry[member]
      if (mode === 'non-function') registry[member] = null
      if (mode === 'throwing') {
        Object.defineProperty(registry, member, { get() { throw new Error(`${member} probe`) } })
      }
      const extension = createExtension(registry)
      const availability = extension.availability
      assert.equal(
        member === 'enter' || member === 'announce' || member === 'setFactory'
          ? availability.providers[member]
          : availability[member],
        false,
        `${member} ${mode}`,
      )
    }
  }
})

test('logger failure is inert during member degradation', () => {
  const { registry } = createRegistry({ announce: undefined })
  const extension = createAgentCreateExtension({
    probeRegistry: () => registry,
    resolveRegistry: () => registry,
    logger: { error() { throw new Error('logger failure') } },
  })

  assert.throws(() => extension.createView({}).providers.announce({}), (error) => {
    assert.equal(error.code, 'PLUGIN_API_FEATURE_DISABLED')
    assert.match(error.message, /providers\.announce/)
    return true
  })
})

test('call-resolution containment does not intercept other returned handles or disposers', async () => {
  let disposed = 0
  const handleDispose = () => { disposed += 1 }
  const registerDispose = () => { disposed += 10 }
  const enterDispose = () => { disposed += 100 }
  const factoryDispose = () => { disposed += 1000 }
  const { registry } = createRegistry({
    create: () => Promise.resolve({ dispose: handleDispose }),
    register: () => registerDispose,
    enter: () => enterDispose,
    setFactory: () => factoryDispose,
  })
  let failAnnounce = false
  const extension = createAgentCreateExtension({
    probeRegistry: () => registry,
    resolveRegistry() {
      return failAnnounce ? { ...registry, announce: undefined } : registry
    },
  })
  const view = extension.createView({})

  failAnnounce = true
  assert.throws(() => view.providers.announce({}), /providers\.announce/)
  const handle = await view.create({})
  assert.equal(handle.dispose, handleDispose)
  assert.equal(view.register({}), registerDispose)
  assert.equal(view.providers.enter({}, undefined), enterDispose)
  assert.equal(view.providers.setFactory({}), factoryDispose)
  handle.dispose()
  registerDispose()
  enterDispose()
  factoryDispose()
  assert.equal(disposed, 1111)
})
