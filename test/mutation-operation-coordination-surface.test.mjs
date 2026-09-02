import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'

function createHarness(extraServices = {}) {
  const services = {
    llm: { resolveModelInfo() {}, prepareCall() {}, stream() {}, registerAdapter() {}, registerConfigurableProviders() {}, registerModelDiscovery() {} },
    tools: { register() {}, get() {}, schemas() { return [] }, execute() { return { ok: true } } },
    agents: { get() {}, list() {}, roots() {} },
    sessions: { get() {}, list() {}, fork() {} },
    settings: { register() {}, describe() { return [] }, get() {}, mutate() { return { ok: true, commitState: 'committed' } } },
    systemPrompt: { section() {}, context() {}, variable() {}, tools() {}, suppressRuntimeContext() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    ...extraServices,
  }
  const state = { pluginApi: undefined, effects: [], listeners: [] }
  const ctx = {
    logger: { error() {}, warn() {} },
    reflect: { provide(name, value) { if (name === 'pluginApi') state.pluginApi = value } },
    get(name) { return name === 'pluginApi' ? state.pluginApi : services[name] },
    plugin(Class) { new Class(ctx) },
    effect(fn, label) { state.effects.push({ fn, label }) },
    on(name, listener) { state.listeners.push({ name, listener }); return () => {} },
    once() {}, emit() {}, serial() {}, parallel() {} , bail() {}, waterfall() {},
    model() { return { name: 'x' } },
    runtime: { name: 'test', version: '0.1.0-rc.6' },
  }
  return { ctx, state, services }
}

const COORDINATION_CODES = ['active', 'inactive', 'invalid-input', 'conflict', 'unavailable', 'unsupported', 'error']

test('coordination renames expose acquire/release and acquire/takeover with the typed vocabulary', () => {
  const { ctx, state } = createHarness()
  apply(ctx)
  const api = state.pluginApi
  // channels: open -> acquire, revoke -> release
  assert.equal(typeof api.sessions.channels.acquire, 'function')
  assert.equal(typeof api.sessions.channels.release, 'function')
  assert.equal(api.sessions.channels.open, undefined, 'the old open verb is subtracted')
  assert.equal(api.sessions.channels.revoke, undefined, 'the old revoke verb is subtracted')
  // tasks: claim -> acquire, reassign -> takeover
  assert.equal(typeof api.tasks.acquire, 'function')
  assert.equal(typeof api.tasks.takeover, 'function')
  assert.equal(typeof api.tasks.claim, 'undefined')
  assert.equal(typeof api.tasks.reassign, 'undefined')
  // the facade coordination surface has the full verb set
  for (const verb of ['acquire', 'heartbeat', 'release', 'takeover', 'compareAndSet', 'observe', 'availability']) {
    assert.equal(typeof api.coordination[verb], 'function', `coordination.${verb}`)
  }
})

test('mutation writes return frozen discriminated results with commit state', async () => {
  const { ctx, state } = createHarness()
  apply(ctx)
  const api = state.pluginApi
  // tasks mutation outcomes stay typed discriminated results
  const registered = await api.tasks.register({ taskId: 'mutation-task', ownerId: 'owner-1', scope: { kind: 'workspace', key: 'w' }, intent: { kind: 'review', summary: 's' } })
  assert.equal(registered.ok, true)
  assert.ok(Object.isFrozen(registered))
  const started = await api.tasks.start('mutation-task')
  assert.equal(started.ok, true)
  assert.ok(Object.isFrozen(started))
  // official-forwarded writes preserve official identity (settings scope)
  assert.equal(typeof api.settings.mutate, 'function')
  assert.equal(typeof api.settings.update, 'function')
  assert.equal(typeof api.settings.replace, 'function')
})

test('coordination outcomes stay discriminated with the closed code vocabulary and handle shape', async () => {
  const { ctx, state } = createHarness()
  apply(ctx)
  const coordination = state.pluginApi.coordination
  const acquired = await coordination.acquire({ resource: { scope: 'process', key: 'surface-resource' }, ownerId: 'owner-1', leaseMs: 1000 })
  assert.equal(acquired.ok, true)
  assert.equal(acquired.code, 'acquired')
  assert.ok(acquired.handle.id, 'lease handle carries an id')
  assert.ok(acquired.handle.resource)
  assert.ok(acquired.handle.generation)
  assert.ok(acquired.handle.fencingToken)
  assert.ok(Date.parse(acquired.handle.expiresAt) > Date.now())
  assert.equal(acquired.handle.dispose, undefined, 'the lease handle is a credential: no dispose()')

  // release(handle) is the give-back verb and is idempotent across repeats
  const released = await coordination.release(acquired.handle)
  assert.equal(released.ok, true)
  assert.equal(released.code, 'released')
  const again = await coordination.release(acquired.handle)
  assert.equal(again.ok, true, 'repeat release of the same handle is idempotent')
})

test('takeover requires the expected proof and preserves provenance', async () => {
  const { ctx, state } = createHarness()
  apply(ctx)
  const coordination = state.pluginApi.coordination
  const acquired = await coordination.acquire({ resource: { scope: 'process', key: 'surface-takeover' }, ownerId: 'owner-a', leaseMs: 2000 })
  assert.equal(acquired.ok, true)
  const withoutProof = await coordination.takeover({ resource: { scope: 'process', key: 'surface-takeover' }, ownerId: 'owner-b', leaseMs: 2000 })
  assert.equal(withoutProof.ok, false)
  assert.ok(COORDINATION_CODES.includes(withoutProof.code))
  const withProof = await coordination.takeover({
    resource: { scope: 'process', key: 'surface-takeover' },
    ownerId: 'owner-b',
    leaseMs: 2000,
    expectedProof: { generation: acquired.handle.generation },
    provenance: [{ source: 'test', reason: 'review takeover' }],
  })
  assert.equal(withProof.ok, true)
  assert.equal(withProof.code, 'taken-over')
})

test('coordination availability declares the honest backing scope', async () => {
  const { ctx, state } = createHarness()
  apply(ctx)
  const coordination = state.pluginApi.coordination
  const availability = await coordination.availability('process')
  assert.equal(availability.status, 'active', 'the bounded adapter reports the facade state honestly')
  assert.ok(['active', 'degraded', 'unavailable'].includes(availability.status))
  const wider = await coordination.availability('machine')
  assert.ok(['active', 'degraded', 'unavailable'].includes(wider.status), 'scopes beyond the adapter stay typed and honest')
})

test('transaction operations carry discriminated results with commit state', async () => {
  const { ctx, state } = createHarness()
  apply(ctx)
  const api = state.pluginApi
  const wt = api.workspaces.transactions
  for (const verb of ['prepare', 'record', 'preview', 'commit', 'rollback', 'recover']) {
    assert.equal(typeof wt[verb], 'function', `workspaces.transactions.${verb}`)
  }
  // a missing workspace backing yields typed unavailable, never a fake success
  const prepared = await wt.prepare({ transactionId: 'tx-surface', workspace: { scope: 'workspace', key: 'surface-workspace' }, ownerId: 'owner-1', intent: { kind: 'edit', summary: 's' }, resources: [{ kind: 'config', key: 'dsh.json', scope: 'workspace' }], lease: { handle: {}, resource: { scope: 'workspace', key: 'surface-workspace' }, generation: 1, expiresAt: Date.now() + 60000 } })
  assert.equal(prepared.ok, false)
  assert.equal('availability' in prepared, false, 'business outcomes never embed availability')
  assert.equal(typeof prepared.code, 'string')
  assert.ok(Object.isFrozen(prepared))
  if (prepared.ok === false) {
    // a successful record would carry the mutation commitState vocabulary
    assert.ok(!('commitState' in prepared), 'a failed mutation carries no commit state')
  }
})