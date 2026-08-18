import test from 'node:test'
import assert from 'node:assert/strict'
import { createFeatureRegistry } from '../lib/feature-registry.js'
import {
  PluginApiFeatureDisabledError,
  PluginApiInactiveError,
} from '../lib/errors.js'
import { createPluginApiService } from '../lib/plugin-api-service.js'

const DURABLE_METHODS = [
  'isDurableEventType',
  'getDurableEventDescriptor',
  'onDurable',
  'onceDurable',
  'appendMessage',
]

function instantiate(coreActive = true) {
  const registry = createFeatureRegistry()
  const getCalls = []
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive })
  const service = new ServiceClass({
    reflect: { provide() {} },
    get(name) {
      getCalls.push(name)
      return undefined
    },
  })
  return { getCalls, service }
}

function assertP2(callback) {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof PluginApiFeatureDisabledError)
    assert.equal(error.feature, 'sessionDurable')
    return true
  })
}

test('durable session stubs report P2 while core is active', () => {
  const { getCalls, service } = instantiate(true)

  for (const method of DURABLE_METHODS) assertP2(() => service.session[method]())
  assertP2(() => service.session.durableEventTypes)
  assertP2(() => service.session.durableEventDescriptors)
  assert.deepEqual(getCalls, [])
})

test('durable session stubs report P1 while core is inactive', () => {
  const { getCalls, service } = instantiate(false)

  for (const method of DURABLE_METHODS) {
    assert.throws(() => service.session[method](), PluginApiInactiveError)
  }
  assert.throws(() => service.session.durableEventTypes, PluginApiInactiveError)
  assert.throws(() => service.session.durableEventDescriptors, PluginApiInactiveError)
  assert.deepEqual(getCalls, [])
})

test('session composition preserves M1 descriptors without eager getter access', () => {
  const { service } = instantiate(true)
  let getterReads = 0
  const symbolKey = Symbol('m1-private')
  const sessionApi = {}
  Object.defineProperty(sessionApi, symbolKey, { configurable: true, value: 'symbol value' })
  Object.defineProperty(sessionApi, 'hidden', { configurable: true, value: 'hidden value' })
  Object.defineProperty(sessionApi, 'appendMessage', { enumerable: true, value: () => 'base must be overridden' })
  Object.defineProperty(sessionApi, 'catalog', {
    enumerable: true,
    get() {
      getterReads += 1
      return ['m1-catalog']
    },
  })
  Object.defineProperty(sessionApi, 'get', {
    enumerable: true,
    value(id) { return id },
  })

  service.mountFeature('session', sessionApi)

  assert.equal(getterReads, 0)
  assert.equal(service.session.get('session-1'), 'session-1')
  assert.deepEqual(service.session.catalog, ['m1-catalog'])
  assert.equal(getterReads, 1)
  assert.deepEqual(Object.getOwnPropertyDescriptor(service.session, 'catalog'), Object.getOwnPropertyDescriptor(sessionApi, 'catalog'))
  assert.equal(Object.getOwnPropertyDescriptor(service.session, 'get').value, sessionApi.get)
  assert.deepEqual(Object.getOwnPropertyDescriptor(service.session, 'hidden'), Object.getOwnPropertyDescriptor(sessionApi, 'hidden'))
  assert.deepEqual(Object.getOwnPropertyDescriptor(service.session, symbolKey), Object.getOwnPropertyDescriptor(sessionApi, symbolKey))
  assertP2(() => service.session.appendMessage())
  const durableKeys = [
    'durableEventTypes',
    'durableEventDescriptors',
    'isDurableEventType',
    'getDurableEventDescriptor',
    'onDurable',
    'onceDurable',
    'appendMessage',
  ]
  assert.deepEqual(
    Reflect.ownKeys(service.session).filter((key) => durableKeys.includes(key)).sort(),
    durableKeys.slice().sort(),
  )
})

test('sessionDurable remains unsupported until its epoch mount path exists', () => {
  const { service } = instantiate(true)
  assert.throws(
    () => service.mountFeature('sessionDurable', {}),
    (error) => error instanceof PluginApiFeatureDisabledError && error.feature === 'sessionDurable',
  )
})

test('published durable epoch stays unavailable until the registry activates it', () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const service = new ServiceClass({ reflect: { provide() {} } })
  const facade = {
    durableEventTypes: Object.freeze(['approval/asked']),
    durableEventDescriptors: Object.freeze({}),
    isDurableEventType: (value) => value === 'approval/asked',
    getDurableEventDescriptor: () => undefined,
    onDurable: () => 'on',
    onceDurable: () => 'once',
    appendMessage: () => 'append',
  }

  const epoch = service.mountFeature('sessionDurable', { facade, closeEpoch() {} })
  assertP2(() => service.session.durableEventTypes)
  assertP2(() => service.session.onDurable())

  registry.mount('sessionDurable')
  assert.deepEqual(service.session.durableEventTypes, ['approval/asked'])
  assert.equal(service.session.isDurableEventType('approval/asked'), true)
  assert.equal(service.session.onDurable(), 'on')
  assert.equal(service.session.onceDurable(), 'once')
  assert.equal(service.session.appendMessage(), 'append')
  assert.equal(service.resetSessionDurable(epoch), true)
  assertP2(() => service.session.appendMessage())
})

test('durable reset revokes retained session facades and closes an epoch once', () => {
  const registry = createFeatureRegistry()
  registry.mount('sessionDurable')
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const service = new ServiceClass({ reflect: { provide() {} } })
  let closes = 0
  const epoch = service.mountFeature('sessionDurable', {
    facade: {
      durableEventTypes: [],
      durableEventDescriptors: {},
      isDurableEventType() {},
      getDurableEventDescriptor() {},
      onDurable() {},
      onceDurable() {},
      appendMessage() {},
    },
    closeEpoch() { closes += 1 },
  })
  const retainedSession = service.session

  assert.equal(service.resetSessionDurable(epoch), true)
  assert.equal(closes, 1)
  assert.equal(service.resetSessionDurable(epoch), false)
  assert.equal(closes, 1)
  assertP2(() => retainedSession.appendMessage())
  assertP2(() => retainedSession.durableEventTypes)
})

test('stale durable cleanup cannot reset a later epoch or its base session API', () => {
  const registry = createFeatureRegistry()
  registry.mount('sessionDurable')
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const service = new ServiceClass({ reflect: { provide() {} } })
  const baseSessionApi = { get: () => 'm1 session' }
  service.mountFeature('session', baseSessionApi)
  let firstCloses = 0
  let secondCloses = 0
  const firstEpoch = service.mountFeature('sessionDurable', {
    facade: { durableEventTypes: ['first'], durableEventDescriptors: {}, isDurableEventType() {}, getDurableEventDescriptor() {}, onDurable() {}, onceDurable() {}, appendMessage: () => 'first' },
    closeEpoch() { firstCloses += 1 },
  })
  const secondEpoch = service.mountFeature('sessionDurable', {
    facade: { durableEventTypes: ['second'], durableEventDescriptors: {}, isDurableEventType() {}, getDurableEventDescriptor() {}, onDurable() {}, onceDurable() {}, appendMessage: () => 'second' },
    closeEpoch() { secondCloses += 1 },
  })

  assert.equal(firstCloses, 1)
  assert.equal(service.resetSessionDurable(firstEpoch), false)
  assert.equal(service.session.get, baseSessionApi.get)
  assert.equal(service.session.appendMessage(), 'second')
  assert.equal(service.resetSessionDurable(secondEpoch), true)
  assert.equal(secondCloses, 1)
  assert.equal(service.session.get, baseSessionApi.get)
})

test('durable reset contains close and logger failures', () => {
  const registry = createFeatureRegistry()
  registry.mount('sessionDurable')
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const service = new ServiceClass({
    logger: { warn() { throw new Error('logger failure') } },
    reflect: { provide() {} },
  })
  const epoch = service.mountFeature('sessionDurable', {
    facade: { durableEventTypes: [], durableEventDescriptors: {}, isDurableEventType() {}, getDurableEventDescriptor() {}, onDurable() {}, onceDurable() {}, appendMessage() {} },
    closeEpoch() { throw new Error('close failure') },
  })

  assert.doesNotThrow(() => service.resetSessionDurable(epoch))
  assertP2(() => service.session.appendMessage())
})

test('a failed first durable mount leaves P2 available for a later epoch', () => {
  const registry = createFeatureRegistry()
  registry.mount('sessionDurable')
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const service = new ServiceClass({ reflect: { provide() {} } })

  assert.throws(() => service.mountFeature('sessionDurable', { facade: {} }), PluginApiFeatureDisabledError)
  assertP2(() => service.session.appendMessage())
  const epoch = service.mountFeature('sessionDurable', {
    facade: { durableEventTypes: [], durableEventDescriptors: {}, isDurableEventType() {}, getDurableEventDescriptor() {}, onDurable() {}, onceDurable() {}, appendMessage: () => 'later epoch' },
    closeEpoch() {},
  })
  assert.equal(service.session.appendMessage(), 'later epoch')
  assert.equal(service.resetSessionDurable(epoch), true)
})

test('retained durable facade reports P1 after core deactivation', () => {
  let coreActive = true
  const registry = createFeatureRegistry()
  registry.mount('sessionDurable')
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: () => coreActive })
  const service = new ServiceClass({ reflect: { provide() {} } })
  service.mountFeature('sessionDurable', {
    facade: { durableEventTypes: [], durableEventDescriptors: {}, isDurableEventType() {}, getDurableEventDescriptor() {}, onDurable() {}, onceDurable() {}, appendMessage() {} },
    closeEpoch() {},
  })
  const retainedSession = service.session

  coreActive = false
  assert.throws(() => retainedSession.appendMessage(), PluginApiInactiveError)
  assert.throws(() => retainedSession.durableEventTypes, PluginApiInactiveError)
})

test('durable epoch token is opaque and cannot bypass subsequent cleanup', () => {
  const registry = createFeatureRegistry()
  registry.mount('sessionDurable')
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const service = new ServiceClass({ reflect: { provide() {} } })
  let firstCloses = 0
  let secondCloses = 0
  const firstEpoch = service.mountFeature('sessionDurable', {
    facade: { durableEventTypes: [], durableEventDescriptors: {}, isDurableEventType() {}, getDurableEventDescriptor() {}, onDurable() {}, onceDurable() {}, appendMessage() {} },
    closeEpoch() { firstCloses += 1 },
  })

  assert.deepEqual(Reflect.ownKeys(firstEpoch), [])
  assert.equal(Object.isFrozen(firstEpoch), true)
  assert.equal(firstEpoch.closeEpoch, undefined)
  assert.throws(() => { firstEpoch.current = false }, TypeError)
  service.mountFeature('sessionDurable', {
    facade: { durableEventTypes: [], durableEventDescriptors: {}, isDurableEventType() {}, getDurableEventDescriptor() {}, onDurable() {}, onceDurable() {}, appendMessage() {} },
    closeEpoch() { secondCloses += 1 },
  })
  assert.equal(firstCloses, 1)
  assert.equal(secondCloses, 0)
})

test('durable cleanup invokes its registration owner exactly once', () => {
  const registry = createFeatureRegistry()
  registry.mount('sessionDurable')
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const service = new ServiceClass({ reflect: { provide() {} } })
  const disposed = []
  const epoch = service.mountFeature('sessionDurable', {
    facade: { durableEventTypes: [], durableEventDescriptors: {}, isDurableEventType() {}, getDurableEventDescriptor() {}, onDurable() {}, onceDurable() {}, appendMessage() {} },
    closeEpoch() {
      for (const dispose of [
        () => disposed.push('first'),
        () => { disposed.push('throwing'); throw new Error('contained by owner') },
        () => disposed.push('last'),
      ]) {
        try { dispose() } catch {}
      }
    },
  })

  assert.equal(service.resetSessionDurable(epoch), true)
  assert.deepEqual(disposed, ['first', 'throwing', 'last'])
  assert.equal(service.resetSessionDurable(epoch), false)
  assert.deepEqual(disposed, ['first', 'throwing', 'last'])
})

test('reconcile dynamically revokes published durable entry points', () => {
  const activeRegistry = createFeatureRegistry()
  activeRegistry.mount('sessionDurable')
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry: activeRegistry, coreActive: true })
  const service = new ServiceClass({ reflect: { provide() {} } })
  service.mountFeature('sessionDurable', {
    facade: { durableEventTypes: [], durableEventDescriptors: {}, isDurableEventType() {}, getDurableEventDescriptor() {}, onDurable() {}, onceDurable() {}, appendMessage() {} },
    closeEpoch() {},
  })
  const retainedSession = service.session
  const inactiveRegistry = createFeatureRegistry()

  service.reconcile({ registry: inactiveRegistry, coreActive: true })
  assertP2(() => retainedSession.appendMessage())
  service.reconcile({ registry: activeRegistry, coreActive: false })
  assert.throws(() => retainedSession.appendMessage(), PluginApiInactiveError)
})

test('retained P2 durable stubs report P1 after reconcile deactivates core', () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const service = new ServiceClass({ reflect: { provide() {} } })
  const retainedSession = service.session

  service.reconcile({ registry, coreActive: false })
  assert.throws(() => retainedSession.appendMessage(), PluginApiInactiveError)
  assert.throws(() => retainedSession.durableEventTypes, PluginApiInactiveError)
})
