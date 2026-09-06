/**
 * Contract-faithful fixtures for the checkpoint feature tests (test-only;
 * mimics the storage-binding facility contract, the owning authority faces and
 * the shared loop slice guest facet). No harness dependencies.
 */

import { deepFreeze } from '../lib/deep-freeze.js'
import { createCheckpointStore } from '../lib/checkpoint-record.js'

/**
 * In-memory durable backend speaking the storage-binding facility contract:
 * `open(input)` with `{ scope, owner, schema, version, name, tables }`
 * resolving to `{ ok, code, envelope, handle: { dispose, purge, domain } }`.
 */
export function createMemoryFacility(options = {}) {
  const domains = new Map()
  const failOpen = typeof options.failOpen === 'function' ? options.failOpen : () => undefined
  return {
    open: async (input) => {
      const forced = failOpen(input)
      if (forced) return forced
      if (domains.has(input.name)) {
        return { ok: false, code: 'conflict', reason: `domain '${input.name}' is already open` }
      }
      const tables = {}
      for (const name of Object.keys(input.tables ?? {})) tables[name] = new Map()
      const domain = {
        name: input.name,
        version: input.version,
        table: (name) => {
          const table = tables[name]
          if (!table) return undefined
          return {
            get: (key) => (table.has(key) ? table.get(key) : undefined),
            put: async (key, value) => { table.set(key, value) },
            delete: async (key) => { table.delete(key) },
            update: async (id, fn) => {
              const current = table.get(id)
              const next = fn(current)
              table.set(id, next)
              return next
            },
            keys: () => [...table.keys()],
            entries: () => [...table.entries()],
            get size() { return table.size },
          }
        },
        global: {
          get: () => domain.globalValue,
          set: async (value) => { domain.globalValue = value },
        },
        close: async () => { domains.delete(input.name) },
      }
      domain.globalValue = input.global?.initial
      domains.set(input.name, domain)
      return {
        ok: true,
        code: 'opened',
        envelope: deepFreeze({ scope: input.scope, owner: input.owner, schema: input.schema, version: input.version, name: input.name }),
        handle: deepFreeze({ dispose: async () => domain.close(), purge: async () => {}, domain }),
      }
    },
  }
}

export function createTestStore(options = {}) {
  const facility = options.facility ?? createMemoryFacility()
  return createCheckpointStore({ facility, logger: options.logger ?? undefined })
}

/** Deterministic id factory for records. */
export function createIdFactory(prefix = 'id') {
  let seq = 0
  return () => `${prefix}-${++seq}`
}

/** Owner derivation stub: reads `caller.owner` (tests simulate plugin identity). */
export function stubOwnerOf(caller) {
  return caller?.owner ?? undefined
}

/** Attempt facts guest facet (shared loop slice contract). */
export function createAttemptFactsFixture(initial = {}) {
  const state = { ...initial }
  const endListeners = new Set()
  let cancelReject = undefined
  return {
    facet: {
      observed: (sessionId) => {
        const entry = state[sessionId]
        if (!entry) return undefined
        return { ...entry }
      },
      cancel: {
        request: async ({ by, cause } = {}) => {
          if (cancelReject) {
            const outcome = typeof cancelReject === 'function' ? cancelReject({ by, cause }) : cancelReject
            return typeof outcome === 'object' && outcome !== null ? outcome : { ok: false, code: 'denied', reason: 'stop request rejected by fixture' }
          }
          return { ok: true, code: 'requested' }
        },
      },
      onEnd: (listener) => {
        endListeners.add(listener)
        return { dispose: () => endListeners.delete(listener) }
      },
    },
    set(sessionId, entry) { state[sessionId] = entry },
    emitEnd(fact) {
      for (const listener of [...endListeners]) listener(fact)
    },
    rejectNextStop(decision) { cancelReject = decision },
  }
}

/** Session branch source fixture (owning authority face). */
export function createBranchAuthorityFixture(initial = {}) {
  const state = {
    active: initial.active ?? true,
    reason: initial.reason,
    branches: initial.branches ?? [],
  }
  return {
    face: {
      availability: () => deepFreeze(state.active ? { status: 'active' } : { status: 'unavailable', reason: state.reason ?? 'fixture inactive' }),
      create: async (spec) => {
        if (!state.active) return { ok: false, code: 'unavailable', reason: state.reason ?? 'fixture inactive' }
        const branchId = `branch-${state.branches.length + 1}`
        state.branches.push({ branchId, sessionId: spec.sessionId })
        return { ok: true, code: 'created', handle: { id: branchId }, observedAt: new Date().toISOString() }
      },
      restore: async ({ sessionId, branchId, fence, supersession } = {}) => {
        if (!state.active) return { ok: false, code: 'unavailable', reason: state.reason ?? 'fixture inactive' }
        state.branches.push({ branchId, sessionId, restored: true, supersession })
        return { ok: true, code: 'restored' }
      },
      availabilityReport: () => state.active,
    },
    setActive(active, reason) { state.active = active; state.reason = reason },
    branches: () => state.branches,
  }
}

/** Workspace transaction authority fixture. */
export function createTransactionsAuthorityFixture(initial = {}) {
  const state = {
    active: initial.active ?? true,
    reason: initial.reason,
    transactions: initial.transactions ?? [],
    failRecover: initial.failRecover,
  }
  return {
    face: {
      availability: () => deepFreeze(state.active ? { status: 'active' } : { status: 'unavailable', reason: state.reason ?? 'fixture inactive' }),
      prepare: async (spec) => {
        if (!state.active) return { ok: false, code: 'unavailable', reason: state.reason ?? 'fixture inactive' }
        const transactionId = `txn-${state.transactions.length + 1}`
        state.transactions.push({ transactionId, workspaceId: spec.workspaceId, entries: [] })
        return { ok: true, code: 'prepared', handle: { id: transactionId } }
      },
      record: async (transactionId, input) => {
        const txn = state.transactions.find((item) => item.transactionId === transactionId)
        if (!txn) return { ok: false, code: 'missing', reason: 'unknown transaction' }
        txn.entries.push({ kind: input.kind, reason: input.reason })
        return { ok: true, code: 'recorded', observedAt: new Date().toISOString() }
      },
      recover: async (transactionId, { fence } = {}) => {
        if (!state.active) return { ok: false, code: 'unavailable', reason: state.reason ?? 'fixture inactive' }
        const txn = state.transactions.find((item) => item.transactionId === transactionId)
        if (!txn) return { ok: false, code: 'missing', reason: 'unknown transaction' }
        if (state.failRecover) return { ok: false, code: state.failRecover, reason: 'fixture recover failure' }
        txn.recovered = true
        return { ok: true, code: 'recovered' }
      },
      rollback: async (transactionId) => {
        const txn = state.transactions.find((item) => item.transactionId === transactionId)
        if (!txn) return { ok: false, code: 'missing', reason: 'unknown transaction' }
        txn.rolledBack = true
        return { ok: true, code: 'rolled-back' }
      },
      availabilityReport: () => state.active,
    },
    setActive(active, reason) { state.active = active; state.reason = reason },
    setFailRecover(code) { state.failRecover = code },
    transactions: () => state.transactions,
  }
}

/** Workspace snapshot slice guest facet (replacement row additive face). */
export function createSnapshotSliceFixture(initial = {}) {
  const state = {
    active: initial.active ?? true,
    reason: initial.reason,
    snapshots: initial.snapshots ?? new Map(),
    failApply: initial.failApply,
    seq: 0,
  }
  return {
    face: {
      availability: () => deepFreeze(state.active ? { status: 'active' } : { status: 'unavailable', reason: state.reason ?? 'fixture inactive' }),
      capture: async (spec) => {
        if (!state.active) return { ok: false, code: 'unavailable', reason: state.reason ?? 'fixture inactive' }
        const snapshotId = `snap-${++state.seq}`
        const entry = {
          workspaceId: spec.workspaceId,
          workspaceIds: [],
          records: {},
          archivedSessionIds: [],
          capturedAt: new Date().toISOString(),
        }
        state.snapshots.set(snapshotId, entry)
        return {
          ok: true,
          anchor: { snapshotId, workspaceId: spec.workspaceId },
          components: [{ name: 'workspace-state', status: 'captured' }],
          capturedAt: entry.capturedAt,
        }
      },
      apply: async ({ state: snapshot, fence } = {}) => {
        if (!state.active) return { ok: false, code: 'unavailable', reason: state.reason ?? 'fixture inactive' }
        if (state.failApply) return { ok: false, code: state.failApply, reason: 'fixture apply failure' }
        if (!fence?.fencingToken) return { ok: false, code: 'denied', reason: 'apply requires the restore operation fencing' }
        state.lastApplied = snapshot
        return { ok: true, code: 'applied' }
      },
      get: (snapshotId) => (state.snapshots.has(snapshotId) ? state.snapshots.get(snapshotId) : undefined),
      availabilityReport: () => state.active,
    },
    setActive(active, reason) { state.active = active; state.reason = reason },
    setFailApply(code) { state.failApply = code },
    lastApplied: () => state.lastApplied,
    snapshots: () => state.snapshots,
  }
}

/** Coordination fixture (acquire/heartbeat/release, conflict + lease-lost). */
export function createCoordinationFixture(initial = {}) {
  const leases = new Map()
  let seq = 0
  const fail = typeof initial.fail === 'function' ? initial.fail : () => undefined
  const state = { lostAt: initial.lostAfterHeartbeats, heartbeats: 0 }
  return {
    face: {
      acquire: async ({ resource, ownerId, leaseMs }) => {
        const forced = fail('acquire', { resource, ownerId })
        if (forced) return forced
        const key = `${resource.scope}:${resource.key}`
        if (leases.has(key) && leases.get(key).active) {
          return { ok: false, code: 'conflict', reason: `resource '${key}' is held by another owner`, observed: { generation: leases.get(key).generation, state: 'active' } }
        }
        const handle = { id: `lease-${++seq}`, resource: key, ownerId, generation: `g-${seq}`, fencingToken: `fence-${seq}`, expiresAt: new Date(Date.now() + leaseMs).toISOString() }
        leases.set(key, { ...handle, active: true })
        return { ok: true, code: 'acquired', handle }
      },
      heartbeat: async (handle) => {
        const forced = fail('heartbeat', handle)
        if (forced) return forced
        const lease = leases.get(handle.resource)
        if (!lease || !lease.active || lease.fencingToken !== handle.fencingToken) {
          return { ok: false, code: 'conflict', reason: 'lease is no longer held' }
        }
        state.heartbeats += 1
        if (state.lostAt !== undefined && state.heartbeats >= state.lostAt) {
          lease.active = false
          return { ok: false, code: 'conflict', reason: 'lease expired (fixture)' }
        }
        return { ok: true, code: 'heartbeated' }
      },
      release: async (handle) => {
        const lease = leases.get(handle.resource)
        if (lease) lease.active = false
        return { ok: true, code: 'released' }
      },
    },
    heldBy: (resource) => {
      const lease = leases.get(`${resource.scope}:${resource.key}`)
      return lease?.active ? lease : undefined
    },
    setLostAfter(heartbeats) { state.lostAt = heartbeats },
  }
}

/** Bounded attempt-terminal waiter fixture. */
export function createTerminalWaiterFixture(initial = {}) {
  const pending = new Map()
  const options = { terminal: initial.terminal ?? 'aborted', delayMs: initial.delayMs ?? 0, code: initial.code }
  return {
    waiter: async (attemptId, { timeoutMs, signal } = {}) => {
      if (options.code === 'timeout') return { ok: false, code: 'timeout', reason: 'attempt did not reach a terminal in time' }
      if (signal?.aborted) return { ok: false, code: 'aborted', reason: 'wait cancelled' }
      if (options.delayMs > 0) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, Math.min(options.delayMs, timeoutMs ?? 30_000))
          signal?.addEventListener?.('abort', () => { clearTimeout(timer); reject(Object.assign(new Error('aborted'), { code: 'aborted' })) }, { once: true })
        })
      }
      pending.set(attemptId, options.terminal)
      return { ok: true, terminal: options.terminal }
    },
    terminalOf: (attemptId) => pending.get(attemptId),
    setTerminal(terminal) { options.terminal = terminal },
    setCode(code) { options.code = code },
  }
}

/** Audit face fixture: failures become gap markers. */
export function createAuditFixture(initial = {}) {
  const entries = []
  const options = { fail: initial.fail ?? false }
  return {
    face: {
      log: async (entry) => {
        entries.push(deepFreeze({ ...entry }))
        return { ok: !options.fail }
      },
    },
    entries: () => entries,
    setFail(fail) { options.fail = fail },
  }
}