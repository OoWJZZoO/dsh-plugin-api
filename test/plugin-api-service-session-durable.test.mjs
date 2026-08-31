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

function assertFeatureDisabled(callback) {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof PluginApiFeatureDisabledError)
    assert.equal(error.feature, 'sessionDurable')
    return true
  })
}

test('durable session stubs report feature-disabled while core is active', () => {
  const { getCalls, service } = instantiate(true)

  for (const method of DURABLE_METHODS) assertFeatureDisabled(() => service.sessions[method]())
  assertFeatureDisabled(() => service.sessions.durable.list())
  assertFeatureDisabled(() => service.sessions.durable.list())
  assert.deepEqual(getCalls, [])
})

test('durable session stubs report core-inactive while core is inactive', () => {
  const { getCalls, service } = instantiate(false)

  for (const method of DURABLE_METHODS) {
    assert.throws(() => service.sessions[method](), PluginApiInactiveError)
  }
  assert.throws(() => service.sessions.durable.list(), PluginApiInactiveError)
  assert.throws(() => service.sessions.durable.list(), PluginApiInactiveError)
  assert.deepEqual(getCalls, [])
})

test('session composition preserves baseline descriptors without eager getter access', () => {
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
  assert.equal(service.sessions.get('session-1'), 'session-1')
  assert.deepEqual(service.sessions.catalog, ['m1-catalog'])
  assert.equal(getterReads, 1)
  assert.deepEqual(Object.getOwnPropertyDescriptor(service.sessions, 'catalog'), Object.getOwnPropertyDescriptor(sessionApi, 'catalog'))
  assert.equal(Object.getOwnPropertyDescriptor(service.sessions, 'get').value, sessionApi.get)
  assert.equal(Object.getOwnPropertyDescriptor(service.sessions, 'hidden').value, 'hidden value')
  assert.equal(Object.getOwnPropertyDescriptor(service.sessions, symbolKey).value, 'symbol value')
  assert.ok(Object.isFrozen(service.sessions))
  assertFeatureDisabled(() => service.sessions.appendMessage())
  const durableKeys = [
    
    
    'isDurableEventType',
    
    
    
    'appendMessage',
  ]
  assert.deepEqual(
    Reflect.ownKeys(service.sessions).filter((key) => durableKeys.includes(key)).sort(),
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
  assertFeatureDisabled(() => service.sessions.durable.list())
  assertFeatureDisabled(() => service.sessions.durable.observe())

  registry.mount('sessionDurable')
  assert.deepEqual(service.sessions.durable.list(), ['approval/asked'])
  assert.equal(service.sessions.isDurableEventType('approval/asked'), true)
  assert.equal(service.sessions.durable.observe(), 'on', 'the merged observe entry is the standard subscription')
  assert.equal(service.sessions.appendMessage(), 'append')
  assert.equal(service.resetSessionDurable(epoch), true)
  assertFeatureDisabled(() => service.sessions.appendMessage())
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
  const retainedSession = service.sessions

  assert.equal(service.resetSessionDurable(epoch), true)
  assert.equal(closes, 1)
  assert.equal(service.resetSessionDurable(epoch), false)
  assert.equal(closes, 1)
  assertFeatureDisabled(() => retainedSession.appendMessage())
  assertFeatureDisabled(() => retainedSession.durable.list())
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
  assert.equal(service.sessions.get, baseSessionApi.get)
  assert.equal(service.sessions.appendMessage(), 'second')
  assert.equal(service.resetSessionDurable(secondEpoch), true)
  assert.equal(secondCloses, 1)
  assert.equal(service.sessions.get, baseSessionApi.get)
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
  assertFeatureDisabled(() => service.sessions.appendMessage())
})

test('a failed first durable mount leaves feature-disabled available for a later epoch', () => {
  const registry = createFeatureRegistry()
  registry.mount('sessionDurable')
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const service = new ServiceClass({ reflect: { provide() {} } })

  assert.throws(() => service.mountFeature('sessionDurable', { facade: {} }), PluginApiFeatureDisabledError)
  assertFeatureDisabled(() => service.sessions.appendMessage())
  const epoch = service.mountFeature('sessionDurable', {
    facade: { durableEventTypes: [], durableEventDescriptors: {}, isDurableEventType() {}, getDurableEventDescriptor() {}, onDurable() {}, onceDurable() {}, appendMessage: () => 'later epoch' },
    closeEpoch() {},
  })
  assert.equal(service.sessions.appendMessage(), 'later epoch')
  assert.equal(service.resetSessionDurable(epoch), true)
})

test('retained durable facade reports core-inactive after core deactivation', () => {
  let coreActive = true
  const registry = createFeatureRegistry()
  registry.mount('sessionDurable')
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: () => coreActive })
  const service = new ServiceClass({ reflect: { provide() {} } })
  service.mountFeature('sessionDurable', {
    facade: { durableEventTypes: [], durableEventDescriptors: {}, isDurableEventType() {}, getDurableEventDescriptor() {}, onDurable() {}, onceDurable() {}, appendMessage() {} },
    closeEpoch() {},
  })
  const retainedSession = service.sessions

  coreActive = false
  assert.throws(() => retainedSession.appendMessage(), PluginApiInactiveError)
  assert.throws(() => retainedSession.durable.list(), PluginApiInactiveError)
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
  const retainedSession = service.sessions
  const inactiveRegistry = createFeatureRegistry()

  service.reconcile({ registry: inactiveRegistry, coreActive: true })
  assertFeatureDisabled(() => retainedSession.appendMessage())
  service.reconcile({ registry: activeRegistry, coreActive: false })
  assert.throws(() => retainedSession.appendMessage(), PluginApiInactiveError)
})

test('retained feature-disabled durable stubs report core-inactive after reconcile deactivates core', () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const service = new ServiceClass({ reflect: { provide() {} } })
  const retainedSession = service.sessions

  service.reconcile({ registry, coreActive: false })
  assert.throws(() => retainedSession.appendMessage(), PluginApiInactiveError)
  assert.throws(() => retainedSession.durable.list(), PluginApiInactiveError)
})
