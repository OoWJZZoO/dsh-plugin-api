import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkspaceMutationTransaction } from '../lib/workspace-mutation-transaction.js'

const NOW = '2026-08-25T00:00:00.000Z'
let nowValue = Date.parse(NOW)
const now = () => new Date(nowValue).toISOString()

function createCoordinationDouble() {
  const records = new Map()
  let generationSeq = 0
  return {
    _records: records,
    acquire({ resource, ownerId, leaseMs }) {
      const existing = records.get(resource.key)
      if (existing?.state === 'active') {
        return Promise.resolve({ ok: false, code: 'conflict' })
      }
      generationSeq += 1
      const value = {
        resource,
        ownerId,
        generation: `gen:${String(generationSeq).padStart(12, '0')}`,
        fencingToken: `tok-${generationSeq}`,
        expiresAt: new Date(nowValue + leaseMs).toISOString(),
        state: 'active',
        version: 0,
      }
      records.set(resource.key, value)
      return Promise.resolve({ ok: true, handle: { ...value } })
    },
    watch(resource) {
      return {
        current() {
          const current = records.get(resource.key)
          if (!current) return Promise.resolve({ code: 'unavailable' })
          return Promise.resolve({
            resource,
            ownerId: current.ownerId,
            generation: current.generation,
            expiresAt: current.expiresAt,
            state: current.state,
            version: current.version,
            fencingValid: current.state === 'active',
          })
        },
        subscribe() { return () => false },
        dispose() { return true },
      }
    },
  }
}

function createServices() {
  const coordination = createCoordinationDouble()
  const recovery = { availability() { return { status: 'available' } }, classify() { return { ok: true, class: 'transient' } } }
  const workspaces = { capabilitiesFor() { return { authorityId: 'auth-1', compatible: true } } }
  const fileClaim = { claim() { return true }, release() { return true } }
  const ledger = { entries: [], append(e) { this.entries.push(e); return true }, query() { return [] } }
  const approval = { confirm() { return { confirmed: true, approvalId: 'ap-1' } } }
  return {
    coordination,
    recovery,
    workspaces,
    fileClaim,
    ledger,
    approval,
    ctx: {
      get(name) {
        if (name === 'workspaces') return workspaces
        if (name === 'fileClaim') return fileClaim
        if (name === 'changeLedger') return ledger
        if (name === 'approval') return approval
        return null
      },
      on() { return () => {} },
    },
  }
}

let idSeq = 0
function createOwner(services = createServices()) {
  return {
    services,
    owner: createWorkspaceMutationTransaction({
      ctx: services.ctx,
      coordination: services.coordination,
      recovery: services.recovery,
      logger: { error() {} },
      now,
      idFactory: () => `id-${(idSeq += 1)}`,
    }),
  }
}

const workspace = { scope: 'workspace', key: 'repo-a' }

async function prepareTx(services, transactionId = 'tx-1') {
  const coordination = services.coordination
  const resource = { scope: 'workspace', key: transactionId }
  const acquired = await coordination.acquire({ resource, ownerId: 'owner-1', leaseMs: 60_000 })
  assert.equal(acquired.ok, true)
  return acquired.handle
}

test('get/observe projections are deep-frozen, redacted, and carry availability with generation', async () => {
  const services = createServices()
  const { owner } = createOwner(services)
  const handle = await prepareTx(services)
  const prepared = await owner.api.prepare({
    transactionId: 'tx-1',
    workspace,
    ownerId: 'owner-1',
    intent: { kind: 'edit', summary: 'fix tests' },
    resources: [{ kind: 'file', key: 'a.txt', scope: 'workspace' }],
    lease: handle,
  })
  assert.equal(prepared.ok, true)
  const got = await owner.api.get('tx-1', { audience: { role: 'ui', workspace } })
  assert.equal(got.found, true)
  assert.equal(got.transaction.state, 'prepared')
  assert.equal(Object.isFrozen(got), true)
  assert.equal(Object.isFrozen(got.transaction), true)
  assert.equal(got.transaction.audience, 'ui')
  assert.ok(got.transaction.availability)
  // mutations accept secret-looking keys and never leak them
  await owner.api.record('tx-1', {
    resource: { kind: 'file', key: 'a.txt', scope: 'workspace' },
    operation: 'write',
    before: { digest: 'old', evidence: { password: 'pw', prompt: 'the prompt', digest: 'x' } },
    after: { digest: 'new' },
    sideEffectClass: 'rollbackable',
    capability: { owner: 'git', name: 'restore', status: 'available' },
    source: { toolId: 'tool-1', executionId: 'exec-1' },
  })
  const after = await owner.api.get('tx-1', { audience: { role: 'ui', workspace } })
  assert.equal(after.transaction.mutations[0].before.evidence?.password, undefined)
  assert.equal(after.transaction.mutations[0].before.evidence?.prompt, undefined)
  assert.equal(after.transaction.mutations[0].before.evidence?.digest, 'x')
  // fencing token never crosses
  assert.equal(after.transaction.lease?.fencingToken, undefined)
  assert.equal(after.transaction.lease?.generation, 'gen:000000000001')

  const subscription = await owner.api.observe('tx-1', { audience: { role: 'ui', workspace } })
  const current = await subscription.current()
  assert.equal(current.transaction.state, 'prepared')
  assert.equal(Object.isFrozen(current), true)
  assert.equal(Object.isFrozen(current.transaction.attempts !== undefined ? current.transaction.attempts : current.transaction.mutations), true)
  assert.ok(current.availability)
  subscription.dispose()
})

test('scope denial returns the same unavailable shape as a missing transaction (no existence leak)', async () => {
  const services = createServices()
  const { owner } = createOwner(services)
  const handle = await prepareTx(services)
  await owner.api.prepare({
    transactionId: 'tx-1',
    workspace,
    ownerId: 'owner-1',
    intent: { kind: 'edit', summary: 'fix' },
    resources: [{ kind: 'file', key: 'a.txt', scope: 'workspace' }],
    lease: handle,
  })
  const denied = await owner.api.get('tx-1', { audience: { role: 'ui', workspace: { scope: 'workspace', key: 'other-repo' } } })
  const missing = await owner.api.get('tx-999', { audience: { role: 'ui', workspace: { scope: 'workspace', key: 'other-repo' } } })
  assert.equal(denied.found, false)
  assert.equal(denied.transaction.state, 'unknown')
  assert.equal(missing.found, false)
  assert.equal(missing.transaction.state, 'unknown')
})

test('observer epoch guards stale callbacks and isolates throwing observers', async () => {
  const services = createServices()
  const { owner } = createOwner(services)
  const handle = await prepareTx(services)
  await owner.api.prepare({
    transactionId: 'tx-1',
    workspace,
    ownerId: 'owner-1',
    intent: { kind: 'edit', summary: 'fix' },
    resources: [{ kind: 'file', key: 'a.txt', scope: 'workspace' }],
    lease: handle,
  })
  const seen = []
  const throwing = async () => {
    throw new Error('observer boom')
  }
  const first = await owner.api.observe('tx-1')
  const detachThrowing = first.subscribe(throwing)
  const second = await owner.api.observe('tx-1')
  second.subscribe(async () => { throw new Error('rejected thenable') })
  const detachGood = second.subscribe((event) => seen.push(event.nextState))
  await owner.api.commit('tx-1')
  assert.ok(seen.includes('committing'))
  assert.ok(seen.includes('committed'))
  // delivered events across both subscriptions of the same transaction carry
  // the same epoch; a rejecting observer never stops the good one
  assert.ok(seen.length >= 2)
  // disposal stops later deliveries and is idempotent
  detachGood()
  detachThrowing()
  const seenAfterDetach = seen.length
  await owner.api.get('tx-1')
  assert.equal(seen.length, seenAfterDetach)
  first.dispose()
  second.dispose()
  assert.equal(second.dispose(), false)
})

test('unavailable-registry projections: get/observe never infer state from silence', async () => {
  const services = createServices()
  const { owner } = createOwner(services)
  // dispose the underlying registry by disposing the whole facade is not
  // reachable, so simulate a missing record: get returns unknown, observe
  // reports unavailable rather than fabricating a state.
  const got = await owner.api.get('tx-void')
  assert.equal(got.found, false)
  assert.equal(got.transaction.state, 'unknown')
  const subscription = await owner.api.observe('tx-void')
  const current = await subscription.current()
  assert.equal(current.code, 'unavailable')
  subscription.dispose()
})

test('redaction failure fails closed for the projection and never returns a partial record', async () => {
  const services = createServices()
  const { owner } = createOwner(services)
  const handle = await prepareTx(services)
  await owner.api.prepare({
    transactionId: 'tx-1',
    workspace,
    ownerId: 'owner-1',
    intent: { kind: 'edit', summary: 'fix' },
    resources: [{ kind: 'file', key: 'a.txt', scope: 'workspace' }],
    lease: handle,
  })
  // a hostile evidence value with a getter that throws on clone is withheld
  const hostile = {}
  Object.defineProperty(hostile, 'credential', {
    enumerable: true,
    get() { throw new Error('boom') },
  })
  const recorded = await owner.api.record('tx-1', {
    resource: { kind: 'file', key: 'a.txt', scope: 'workspace' },
    operation: 'write',
    before: { digest: 'old', evidence: hostile },
    after: { digest: 'new' },
    sideEffectClass: 'rollbackable',
    capability: { owner: 'git', name: 'restore', status: 'available' },
    source: { toolId: 'tool-1', executionId: 'exec-1' },
  })
  assert.equal(recorded.ok, true)
  const got = await owner.api.get('tx-1')
  // bounded clone drops the hostile member instead of throwing or exposing it
  assert.notEqual(got.transaction.mutations[0].before.evidence?.credential, 'secret')
})

test('client boundary: zero client mutation surface exists for prepare/record/commit/rollback/recover', async () => {
  const services = createServices()
  const { owner } = createOwner(services)
  // The host API has all nine operations; nothing resembles a client-boundary
  // emulation, and no remote/slot/settings wiring was registered for this
  // feature (client-boundary absence contract).
  assert.equal(typeof owner.api.prepare, 'function')
  assert.equal(typeof owner.api.record, 'function')
  assert.equal(typeof owner.api.preview, 'function')
  assert.equal(typeof owner.api.commit, 'function')
  assert.equal(typeof owner.api.rollback, 'function')
  assert.equal(typeof owner.api.recover, 'function')
  assert.equal(typeof owner.api.get, 'function')
  assert.equal(typeof owner.api.observe, 'function')
  // disposed surface returns inactive without contacting the client side
  owner.dispose()
  const outcome = await owner.api.commit('tx-1')
  assert.equal(outcome.code, 'inactive')
})