import test from 'node:test'
import assert from 'node:assert/strict'
import { createClientLifecycle } from '../lib/client-generation-rebind.js'
import { createClientRemoteContribution } from '../lib/client-remote-contribution.js'

const tick = () => new Promise((resolve) => setImmediate(resolve))

function createFixture({ withGraph = false } = {}) {
  const listeners = new Map()
  const remoteListeners = new Map()
  const slotListeners = new Map()
  const slotLifetimes = new Map()
  const settingsListeners = new Set()
  const slotsByKey = new Map([['details', [{ id: 'details-1', capabilities: ['slot.read'] }]]])
  const loadCache = new Map([['initial', { exports: { marker: 'initial' } }]])
  const graphListeners = new Set()
  let graphVersion = 1
  let settingsRevision = 1
  let connectionVersion = 'runtime-1'
  let remoteMounts = 0
  let remoteDisposals = 0
  let settingsScopeDisposals = 0

  const ctx = {
    on(name, listener) {
      const bucket = listeners.get(name) ?? new Set()
      bucket.add(listener)
      listeners.set(name, bucket)
      return () => bucket.delete(listener)
    },
    emit(name, ...args) {
      for (const listener of [...(listeners.get(name) ?? [])]) listener(...args)
    },
  }

  const remote = {
    $mount(contribution) {
      remoteMounts += 1
      const namespaces = new Set((contribution?.descriptors ?? []).map((descriptor) => descriptor.namespace))
      for (const namespace of namespaces) {
        remote[namespace] ??= { capabilities: ['remote.read'] }
      }
      return () => {
        remoteDisposals += 1
        for (const namespace of namespaces) delete remote[namespace]
      }
    },
    ready: { capabilities: ['remote.read'], payload: 'must-not-project' },
    other: { capabilities: ['remote.read'] },
    observe(name, listener) {
      const bucket = remoteListeners.get(name) ?? new Set()
      bucket.add(listener)
      remoteListeners.set(name, bucket)
      return () => bucket.delete(listener)
    },
  }

  const slots = {
    register() { return () => {} },
    inject(key, listener) {
      const bucket = slotListeners.get(key) ?? new Set()
      bucket.add(listener)
      slotListeners.set(key, bucket)
      const teardown = listener(slotsByKey.get(key))
      slotLifetimes.set(listener, teardown)
      return () => {
        slotLifetimes.get(listener)?.()
        slotLifetimes.delete(listener)
        bucket.delete(listener)
      }
    },
    entries(key) { return slotsByKey.get(key) ?? [] },
    subscribe() { return () => {} },
    onMutate(listener) {
      return ctx.on('slots/changed', listener)
    },
  }

  const settingsScope = {
    bind({ namespace }) {
      assert.equal(namespace, 'settings')
      return {
        getSnapshot() { return { revision: settingsRevision, capabilities: ['settings.read'] } },
        subscribe(listener) {
          settingsListeners.add(listener)
          return () => settingsListeners.delete(listener)
        },
        set() {},
        unset() {},
        dispose() { settingsScopeDisposals += 1 },
      }
    },
  }

  const modules = {
    loadCache,
    async import(id) { return loadCache.get(id)?.exports },
    invalidate(id) {
      loadCache.delete(id)
      graphVersion += 1
      for (const listener of [...graphListeners]) listener({ id, graphVersion })
    },
    onGraphChanged(listener) {
      graphListeners.add(listener)
      return () => graphListeners.delete(listener)
    },
  }
  if (withGraph) {
    modules.graph = () => ({ graphVersion, generation: 'private-must-not-be-read', attempt: 99, public: ['initial'] })
  }

  const connection = {
    rpc: { call() {} },
    api: { settings: {} },
    hostDescription: { getSnapshot() { return { version: connectionVersion } } },
  }

  const collapseSlotDeclaration = (key) => {
    slotsByKey.set(key, [])
    for (const listener of [...(slotListeners.get(key) ?? [])]) {
      slotLifetimes.get(listener)?.()
      slotLifetimes.delete(listener)
    }
  }

  return {
    ctx,
    connection,
    remote,
    slots,
    settingsScope,
    modules,
    get remoteMounts() { return remoteMounts },
    get remoteDisposals() { return remoteDisposals },
    get settingsScopeDisposals() { return settingsScopeDisposals },
    emitRemote(name, ...args) {
      for (const listener of [...(remoteListeners.get(name) ?? [])]) listener(...args)
    },
    setRemoteAvailable(available) {
      if (available) remote.ready = { capabilities: ['remote.read'], payload: 'must-not-project' }
      else delete remote.ready
    },
    setSlotEntries(key, entries) {
      slotsByKey.set(key, entries)
      ctx.emit('slots/changed', key)
    },
    collapseSlotDeclaration,
    replaceSlotDeclaration(key, entries) {
      collapseSlotDeclaration(key)
      slotsByKey.set(key, entries)
      for (const listener of [...(slotListeners.get(key) ?? [])]) {
        slotLifetimes.set(listener, listener(entries))
      }
    },
    setSettingsRevision(revision) {
      settingsRevision = revision
      for (const listener of [...settingsListeners]) listener({ revision })
      ctx.emit('settings/changed', 'settings', revision)
    },
    setConnectionVersion(version) {
      connectionVersion = version
      ctx.emit('connection/reset', version)
    },
    replaceModule(id, exports) {
      loadCache.set(id, { exports })
      graphVersion += 1
      for (const listener of [...graphListeners]) listener({ id, graphVersion })
    },
  }
}

function createLifecycle(fixture, options = {}) {
  const logs = []
  const diagnostics = []
  const lifecycle = createClientLifecycle({
    ...fixture,
    ...options,
    logger: { error(message) { logs.push(message) } },
    publishDiagnostic(record) { diagnostics.push(record) },
  })
  return { lifecycle, logs, diagnostics }
}

function remoteRegistration(faceId, ownerId, bind, extra = {}) {
  return {
    faceId,
    ownerId,
    scope: 'client',
    kind: 'remote',
    require: { contractVersion: 'runtime-1', capabilities: ['remote.read'], remote: { namespace: 'ready' }, ...extra },
    bind,
  }
}

function remoteContribution(packageName, namespace) {
  return {
    package: packageName,
    descriptors: [{
      id: `${packageName}#${namespace}/get`,
      service: namespace,
      namespace,
      method: 'get',
      invocation: { kind: 'direct' },
      parameters: [],
      result: { mode: 'strict', typeSymbol: `${namespace}.Json`, schema: { parse(value) { return value } } },
    }],
  }
}

test('registry exposes frozen owner-local generation, revision, contribution and redacted availability', async () => {
  const fixture = createFixture()
  const { lifecycle } = createLifecycle(fixture)
  const binds = []
  const first = lifecycle.api.register(remoteRegistration('face', 'owner-a', (input, context) => {
    binds.push({ input, context })
    return () => {}
  }))
  const duplicate = lifecycle.api.register(remoteRegistration('face', 'owner-a', () => () => {}))
  const second = lifecycle.api.register(remoteRegistration('face', 'owner-b', () => () => {}))
  await tick()

  assert.equal(first, duplicate)
  assert.notEqual(first.generation, second.generation)
  assert.equal(first.revision, second.revision, 'independent owners may coincidentally use the same local revision')
  assert.equal(binds.length, 1)
  assert.equal(binds[0].context.isCurrent(), true)
  assert.equal(binds[0].context.guard('value'), 'value')

  const snapshot = first.availability()
  assert.equal(snapshot.state, 'available')
  assert.equal(snapshot.provided.contractVersion, 'runtime-1')
  assert.deepEqual(Object.keys(snapshot.epochs), ['connection', 'modules', 'remote', 'slot', 'settings'])
  assert.notEqual(snapshot.contributionId, snapshot.generation)
  assert.equal(Object.isFrozen(snapshot), true)
  assert.equal(Object.isFrozen(snapshot.epochs), true)
  assert.equal(Object.isFrozen(snapshot.reasons), true)
  assert.equal('payload' in snapshot, false)
  assert.equal(JSON.stringify(snapshot).includes('must-not-project'), false)
  assert.equal(lifecycle.api.list().length, 2)
})

test('connection, modules, remote, slot and settings epochs advance independently from public evidence', async () => {
  const fixture = createFixture({ withGraph: true })
  const { lifecycle } = createLifecycle(fixture)
  const handle = lifecycle.api.register(remoteRegistration('face', 'owner', () => () => {}))
  let slotBinds = 0
  let slotCleanups = 0
  let settingsBinds = 0
  let settingsCleanups = 0
  const slotHandle = lifecycle.api.register({
    faceId: 'slot-face', ownerId: 'owner', scope: 'client', kind: 'slot',
    require: { slot: { key: 'details' } }, bind() { slotBinds += 1; return () => { slotCleanups += 1 } },
  })
  const settingsHandle = lifecycle.api.register({
    faceId: 'settings-face', ownerId: 'owner', scope: 'client', kind: 'settings',
    require: { settings: { namespace: 'settings' } }, bind() { settingsBinds += 1; return () => { settingsCleanups += 1 } },
  })
  await tick()
  const initial = handle.availability().epochs
  const initialSlot = slotHandle.availability().epochs
  const initialSettings = settingsHandle.availability().epochs

  fixture.ctx.emit('connection/reset')
  await tick()
  const connection = handle.availability().epochs
  const connectionSlot = slotHandle.availability().epochs
  assert.notEqual(connection.connection, initial.connection)
  assert.equal(connection.modules, initial.modules)
  assert.equal(connection.remote, initial.remote)
  assert.equal(connection.slot, initial.slot)
  assert.equal(connection.settings, initial.settings)
  assert.notEqual(connectionSlot.connection, initialSlot.connection)
  assert.equal(connectionSlot.connection, connection.connection)

  fixture.modules.invalidate('initial')
  await tick()
  const modules = handle.availability().epochs
  assert.notEqual(modules.modules, connection.modules)
  assert.equal(modules.connection, connection.connection)
  assert.equal(modules.remote, connection.remote)
  assert.equal(modules.slot, connection.slot)
  assert.equal(modules.settings, connection.settings)

  fixture.ctx.emit('connection/reset')
  await tick()
  const reconnected = handle.availability().epochs
  assert.notEqual(reconnected.connection, modules.connection)
  assert.equal(reconnected.modules, modules.modules)
  assert.equal(reconnected.remote, modules.remote)
  assert.equal(reconnected.slot, modules.slot)
  assert.equal(reconnected.settings, modules.settings)

  fixture.replaceSlotDeclaration('details', [{ id: 'details-2', capabilities: ['slot.read'] }])
  fixture.setSettingsRevision(2)
  await tick()
  const all = handle.availability().epochs
  const allSlot = slotHandle.availability().epochs
  const allSettings = settingsHandle.availability().epochs
  assert.equal(all.remote, reconnected.remote)
  assert.equal(all.slot, reconnected.slot)
  assert.equal(all.settings, reconnected.settings)
  assert.notEqual(allSlot.slot, initialSlot.slot)
  assert.notEqual(allSettings.settings, initialSettings.settings)
  assert.equal(all.modules, reconnected.modules)
  assert.equal(all.connection, reconnected.connection)

  const ordinarySlotEpoch = allSlot.slot
  const ordinarySlotBinds = slotBinds
  const ordinarySlotCleanups = slotCleanups
  fixture.setSlotEntries('details', [{ id: 'details-entry-only', capabilities: ['slot.read'] }])
  await tick()
  assert.equal(slotHandle.availability().epochs.slot, ordinarySlotEpoch)
  assert.equal(slotBinds, ordinarySlotBinds)
  assert.equal(slotCleanups, ordinarySlotCleanups)

  const graphBeforePrivateChange = all.modules
  fixture.modules.graph = () => ({ graphVersion: 2, generation: 'changed-private', attempt: 1000, public: ['initial'] })
  fixture.modules.generation = 'private-field'
  assert.equal(handle.availability().epochs.modules, graphBeforePrivateChange)
})

test('official slot declaration collapse teardown invalidates the old face before redeclare', async () => {
  const fixture = createFixture()
  const { lifecycle } = createLifecycle(fixture)
  let binds = 0
  let cleanups = 0
  const handle = lifecycle.api.register({
    faceId: 'collapse-slot',
    ownerId: 'owner',
    scope: 'client',
    kind: 'slot',
    require: { slot: { key: 'details' } },
    bind() {
      binds += 1
      return () => { cleanups += 1 }
    },
  })
  await tick()
  const initial = handle.availability()
  assert.equal(initial.state, 'available')
  assert.equal(binds, 1)

  fixture.collapseSlotDeclaration('details')
  const collapsed = handle.availability()
  assert.notEqual(collapsed.epochs.slot, initial.epochs.slot)
  assert.equal(cleanups, 1, 'collapse teardown retires the previous contribution synchronously')
  await tick()
  assert.equal(handle.availability().state, 'unavailable')
  assert.equal(binds, 1)

  fixture.replaceSlotDeclaration('details', [{ id: 'details-redeclared', capabilities: ['slot.read'] }])
  await tick()
  assert.equal(handle.availability().state, 'available')
  assert.equal(binds, 2)
  assert.equal(cleanups, 1)
  handle.dispose()
  assert.equal(cleanups, 2)
})

test('public projection is pure and does not observe private graph changes or schedule rebinds', async () => {
  const fixture = createFixture({ withGraph: true })
  const { lifecycle } = createLifecycle(fixture)
  let binds = 0
  let cleanups = 0
  const handle = lifecycle.api.register(remoteRegistration('pure', 'owner', () => {
    binds += 1
    return () => { cleanups += 1 }
  }))
  await tick()
  const before = handle.availability()
  fixture.modules.graph = () => ({ graphVersion: 99, generation: 'private-only', attempt: 999 })
  fixture.modules.loadCache.set('private-only', { exports: { marker: 'not-an-event' } })
  const projected = handle.availability()
  const scanned = lifecycle.api.list()[0]
  assert.equal(projected.epochs.modules, before.epochs.modules)
  assert.equal(scanned.epochs.modules, before.epochs.modules)
  assert.equal(binds, 1)
  assert.equal(cleanups, 0)
  await tick()
  assert.equal(binds, 1)
  assert.equal(cleanups, 0)

  fixture.replaceModule('public-arrival', { marker: 'public' })
  await tick()
  assert.equal(binds, 2)
  assert.equal(cleanups, 1)
  handle.dispose()
})

test('raw modules invalidate fallback is explicit and advances the modules epoch', async () => {
  const fixture = createFixture()
  const originalInvalidate = fixture.modules.invalidate
  delete fixture.modules.onGraphChanged
  const { lifecycle, diagnostics } = createLifecycle(fixture)
  let binds = 0
  let cleanups = 0
  const handle = lifecycle.api.register(remoteRegistration('raw-modules', 'owner', () => {
    binds += 1
    return () => { cleanups += 1 }
  }))
  await tick()
  const before = handle.availability()
  assert.ok(diagnostics.some((record) => record.code === 'modules-invalidate-fallback'))

  fixture.modules.invalidate('initial')
  const during = handle.availability()
  assert.notEqual(during.epochs.modules, before.epochs.modules)
  assert.equal(cleanups, 1)
  await tick()
  assert.equal(binds, 2)
  assert.equal(handle.availability().state, 'available')

  handle.dispose()
  lifecycle.dispose()
  assert.equal(fixture.modules.invalidate, originalInvalidate, 'fallback cleanup restores the official method identity')
})

test('official remote mount and disposer advance the remote epoch without synthetic lifecycle events', async () => {
  const fixture = createFixture()
  const { lifecycle } = createLifecycle(fixture)
  let binds = 0
  let cleanups = 0
  const contribution = remoteContribution('official-remote-owner', 'mounted')
  const handle = lifecycle.api.register(remoteRegistration('remote-face', 'owner', () => {
    binds += 1
    return () => { cleanups += 1 }
  }, { remote: { namespace: 'mounted', contribution } }))
  await tick()
  assert.equal(fixture.remoteMounts, 1)
  assert.equal(handle.availability().state, 'available')
  assert.equal(handle.availability().source, 'official-remote')
  assert.equal(handle.availability().uncertainty, 'observed')
  assert.equal(binds, 1)
  const mountedEpoch = handle.availability().epochs.remote
  handle.dispose()
  await tick()
  assert.equal(cleanups, 1)
  assert.equal(fixture.remoteDisposals, 1)
  assert.equal(handle.availability(), undefined)
  assert.equal(mountedEpoch.startsWith('remote-'), true)
})

test('shared official remote mount leases isolate lifecycle owners', async () => {
  const fixture = createFixture()
  const remoteAdapter = createClientRemoteContribution({ remote: fixture.remote })
  const { lifecycle } = createLifecycle(fixture, { remoteContribution: remoteAdapter })
  const contribution = remoteContribution('shared-remote-owner', 'shared')
  let aCleanups = 0
  let bCleanups = 0
  const a = lifecycle.api.register(remoteRegistration('shared-a', 'owner-a', () => () => { aCleanups += 1 }, {
    remote: { namespace: 'shared', contribution },
  }))
  const b = lifecycle.api.register(remoteRegistration('shared-b', 'owner-b', () => () => { bCleanups += 1 }, {
    remote: { namespace: 'shared', contribution },
  }))
  await tick()

  assert.equal(fixture.remoteMounts, 1, 'package-shared mount is performed once')
  assert.equal(a.availability().state, 'available')
  assert.equal(b.availability().state, 'available')

  a.dispose()
  await tick()
  assert.equal(aCleanups, 1)
  assert.equal(fixture.remoteDisposals, 0, 'owner A releases only its lifecycle lease')
  assert.equal(b.availability().state, 'available', 'owner B keeps the shared remote live')

  b.dispose()
  await tick()
  assert.equal(bCleanups, 1)
  assert.equal(fixture.remoteDisposals, 1, 'the last lifecycle lease owns the official disposer')
})

test('stale bind settlement is cleaned without publishing as current or touching a replacement', async () => {
  const fixture = createFixture()
  const firstGate = {}
  firstGate.promise = new Promise((resolve) => { firstGate.resolve = resolve })
  const secondGate = {}
  secondGate.promise = new Promise((resolve) => { secondGate.resolve = resolve })
  let bindCount = 0
  let firstCleanup = 0
  let secondCleanup = 0
  const notifications = []
  const { lifecycle } = createLifecycle(fixture)
  lifecycle.api.observe((notification) => notifications.push(notification))
  const handle = lifecycle.api.register(remoteRegistration('face', 'owner', () => {
    bindCount += 1
    if (bindCount === 1) return firstGate.promise.then(() => () => { firstCleanup += 1 })
    return secondGate.promise.then(() => () => { secondCleanup += 1 })
  }))

  fixture.ctx.emit('connection/reset')
  await tick()
  assert.equal(bindCount, 2)
  const secondGeneration = handle.generation
  firstGate.resolve()
  await tick()
  assert.equal(firstCleanup, 1)
  assert.equal(handle.generation, secondGeneration)
  assert.equal(handle.availability().contributionId, undefined)

  secondGate.resolve()
  await tick()
  const secondSnapshot = handle.availability()
  assert.equal(secondSnapshot.generation, secondGeneration)
  assert.notEqual(secondSnapshot.contributionId, secondGeneration)
  assert.ok(notifications.some((notification) => notification.oldGeneration !== notification.newGeneration))
  handle.dispose()
  assert.equal(secondCleanup, 1)
  await tick()
  assert.equal(lifecycle.isActive, true)
})

test('slot and settings adapters retain official bind/inject ownership and clean their subscriptions', async () => {
  const fixture = createFixture()
  let slotBinds = 0
  let settingsBinds = 0
  const originalInject = fixture.slots.inject
  fixture.slots.inject = (...args) => { slotBinds += 1; return originalInject(...args) }
  const originalBind = fixture.settingsScope.bind
  fixture.settingsScope.bind = (...args) => { settingsBinds += 1; return originalBind.apply(fixture.settingsScope, args) }
  const { lifecycle } = createLifecycle(fixture)
  const slot = lifecycle.api.register({
    faceId: 'slot-face', ownerId: 'owner', scope: 'client', kind: 'slot',
    require: { contractVersion: 'runtime-1', slot: { key: 'details' } }, bind() { return () => {} },
  })
  const settings = lifecycle.api.register({
    faceId: 'settings-face', ownerId: 'owner', scope: 'client', kind: 'settings',
    require: { contractVersion: 'runtime-1', settings: { namespace: 'settings' } }, bind() { return () => {} },
  })
  await tick()
  assert.equal(slot.availability().state, 'available')
  assert.equal(settings.availability().state, 'available')
  assert.equal(slotBinds, 1)
  assert.equal(settingsBinds, 1)
  slot.dispose()
  settings.dispose()
  assert.equal(lifecycle.api.list().length, 0)
  assert.equal(fixture.settingsScopeDisposals, 1)
})

test('settings scope initialization failure disposes the partial scope and keeps the facade operational', async () => {
  const fixture = createFixture()
  const originalBind = fixture.settingsScope.bind
  fixture.settingsScope.bind = ({ namespace }) => {
    const scope = originalBind({ namespace })
    scope.subscribe = () => { throw new Error('settings subscriber failed') }
    return scope
  }
  const { lifecycle, diagnostics } = createLifecycle(fixture)
  let goodBinds = 0
  const settings = lifecycle.api.register({
    faceId: 'settings-failure', ownerId: 'owner', scope: 'client', kind: 'settings',
    require: { settings: { namespace: 'settings' } }, bind() { throw new Error('must not bind') },
  })
  const good = lifecycle.api.register(remoteRegistration('good-after-settings-failure', 'owner', () => {
    goodBinds += 1
    return () => {}
  }))
  await tick()
  assert.equal(lifecycle.isActive, true)
  assert.equal(settings.availability().state, 'unavailable')
  assert.equal(good.availability().state, 'available')
  assert.equal(goodBinds, 1)
  assert.equal(fixture.settingsScopeDisposals, 1)
  assert.ok(diagnostics.some((record) => record.code === 'settings-subscriber-failed'))
})

test('caller-bound lifecycle cleanup owns only that caller registration and no global public dispose exists', async () => {
  const fixture = createFixture()
  const { lifecycle } = createLifecycle(fixture)
  const callerA = { cleanups: [], effect(execute) { this.cleanups.push(execute()) } }
  const callerB = { cleanups: [], effect(execute) { this.cleanups.push(execute()) } }
  const apiA = lifecycle.forCaller(callerA)
  const apiB = lifecycle.forCaller(callerB)
  assert.equal('dispose' in apiA, false)
  assert.equal('dispose' in apiB, false)
  assert.equal('dispose' in lifecycle.api, false)
  let aCleanups = 0
  let bCleanups = 0
  const a = apiA.register(remoteRegistration('caller-a', 'owner-a', () => () => { aCleanups += 1 }))
  const b = apiB.register(remoteRegistration('caller-b', 'owner-b', () => () => { bCleanups += 1 }))
  await tick()
  assert.equal(apiA.list().length, 2)
  assert.equal(apiB.list().length, 2)
  assert.equal(callerA.cleanups.length, 1)
  assert.equal(callerB.cleanups.length, 1)

  callerA.cleanups[0]()
  assert.equal(a.availability(), undefined)
  assert.equal(aCleanups, 1)
  assert.equal(b.availability().state, 'available')
  assert.equal(bCleanups, 0)
  assert.equal(lifecycle.api.list().length, 1)
  b.dispose()
  assert.equal(bCleanups, 1)
})

test('contract and capability mismatches degrade only one face and diagnostics are fail-closed', async () => {
  const fixture = createFixture()
  const { lifecycle, diagnostics } = createLifecycle(fixture)
  let goodBinds = 0
  const bad = lifecycle.api.register(remoteRegistration('bad', 'owner', () => { throw new Error('must not bind') }, {
    contractVersion: 'runtime-999',
  }))
  const good = lifecycle.api.register(remoteRegistration('good', 'owner', () => { goodBinds += 1; return () => {} }))
  await tick()
  assert.equal(bad.availability().state, 'unavailable')
  assert.equal(good.availability().state, 'available')
  assert.equal(goodBinds, 1)
  assert.ok(diagnostics.some((record) => record.faceId === 'bad'))
  assert.equal(JSON.stringify(diagnostics).includes('must-not-project'), false)
})

test('listener, subscriber, disposer and diagnostic failures remain contained', async () => {
  const fixture = createFixture()
  const logs = []
  const lifecycle = createClientLifecycle({
    ...fixture,
    logger: { error(message) { logs.push(message) } },
    publishDiagnostic() { throw new Error('diagnostic sink failed') },
  })
  lifecycle.api.observe(() => { throw new Error('listener failed') })
  lifecycle.api.observe(() => Promise.reject(new Error('listener rejected')))
  lifecycle.api.observe(() => { throw new Error('rebind listener failed') })
  const first = lifecycle.api.register(remoteRegistration('first', 'owner', () => () => { throw new Error('cleanup failed') }))
  const second = lifecycle.api.register(remoteRegistration('second', 'owner', () => () => {}, { remote: { namespace: 'other' } }))
  await tick()
  fixture.ctx.emit('connection/reset')
  await tick()
  assert.equal(lifecycle.isActive, true)
  assert.equal(first.availability().state, 'available')
  assert.equal(second.availability().state, 'available')
  assert.equal(typeof lifecycle.api.register(remoteRegistration('third', 'owner', () => () => {})).dispose, 'function')
  await tick()
  assert.ok(logs.length > 0)
})

test('evidence subscriber failure and lifecycle initialization failure use separate fail-safe layers', async () => {
  const fixture = createFixture()
  fixture.modules.onGraphChanged = () => Promise.reject(new Error('module subscriber rejected'))
  const logs = []
  const operational = createClientLifecycle({
    ...fixture,
    logger: { error(message) { logs.push(message) } },
  })
  assert.equal(operational.isActive, true)
  const handle = operational.api.register(remoteRegistration('face', 'owner', () => () => {}))
  await tick()
  assert.equal(handle.availability().state, 'available')
  assert.ok(logs.some((message) => /subscription failed/i.test(message)))

  const badContext = {}
  Object.defineProperty(badContext, 'on', { get() { throw new Error('registry init failed') } })
  const diagnostics = []
  const inert = createClientLifecycle({
    ...fixture,
    ctx: badContext,
    publishDiagnostic(record) { diagnostics.push(record) },
  })
  assert.equal(inert.isActive, false)
  assert.equal(inert.api.isActive, false)
  assert.equal(diagnostics.some((record) => record.reason === 'client lifecycle initialization failed'), true)
})

test('missing core official services produce only the disabled lifecycle surface', () => {
  const diagnostics = []
  const lifecycle = createClientLifecycle({
    connection: { rpc: { call() {} }, api: { settings: {} } },
    remote: { $mount() {} },
    slots: { register() {}, inject() {}, entries() {}, subscribe() {} },
    settingsScope: { bind() {} },
    publishDiagnostic(record) { diagnostics.push(record) },
  })
  assert.equal(lifecycle.isActive, false)
  assert.equal(lifecycle.api.isActive, false)
  assert.deepEqual(lifecycle.api.list(), [])
  assert.throws(() => lifecycle.api.register({}), (error) => error.code === 'PLUGIN_API_FEATURE_DISABLED' && error.feature === 'clientLifecycle')
  assert.equal(diagnostics[0].reason, 'core official client service is unavailable')
})
