/**
 * Restore operation authority — `restore(checkpointId, { plan, signal? })`
 * (Requirement 6/7). One authority commits exactly one terminal
 * (`success | error | aborted | denied | superseded`), driving every step
 * exclusively through its declared owning authority, holding coordination
 * fencing across step boundaries, and expressing partial restore as a domain
 * result field. Running-session targets use stop-then-restore through the
 * shared cancel boundary (the single stop path); a bounded wait that fails
 * closed never rewinds under a live attempt.
 */

import { deepFreeze } from './deep-freeze.js'
import { canonicalize } from './checkpoint-plan.js'

const TERMINALS = ['success', 'error', 'aborted', 'denied', 'superseded']
export const DEFAULT_STOP_WAIT_MS = 30_000
export const DEFAULT_LEASE_MS = 300_000

function isObject(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}

function boundedString(value, max = 200) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const text = String(value).trim()
  return text ? text.slice(0, max) : undefined
}

function frozenHandle({ id, ownerId, status, observe, dispose }) {
  return deepFreeze({ id, ownerId, status, observe, dispose })
}

/**
 * Compose the caller signal with the operation's internal cancel source
 * (handle dispose). Preserves the caller's AbortSignal semantics while adding
 * only the local cancellation source (concurrency-and-cancellation).
 */
function composeSignals(external, internal) {
  if (!external) return internal
  if (typeof AbortSignal.any === 'function') {
    try {
      return AbortSignal.any([external, internal])
    } catch {
      // fall through to manual composition
    }
  }
  if (external.aborted) internal.abort()
  const propagate = () => internal.abort()
  external.addEventListener?.('abort', propagate, { once: true })
  return internal
}

/**
 * Build the restore authority.
 * @param {{
 *   store: object,          // createCheckpointStore
 *   planner: object,        // createRestorePlanner (for preflight recompute)
 *   facts: object,          // createLoopFacts (stop-then-restore)
 *   stepAdapters: object,   // createRestoreStepAdapters result
 *   coordination?: object,  // { acquire, heartbeat, release } face
 *   ownerOf?: Function,
 *   idFactory?: Function,
 *   now?: Function,
 *   waitForTerminal?: Function,  // (attemptId, { timeoutMs, signal }) -> { ok, terminal } | { ok:false, code }
 *   audit?: object,
 *   logger?: object,
 * }} options
 */
export function createRestoreAuthority({ store, planner, facts, stepAdapters = {}, coordination, ownerOf, idFactory, now, waitForTerminal, audit, logger } = {}) {
  const makeId = typeof idFactory === 'function' ? idFactory : () => `restore-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`
  const clock = typeof now === 'function' ? now : () => new Date()
  const operations = new Map()
  const listeners = new Map() // operationId -> Set<listener>

  const coordinationFace = () => (isObject(coordination) && typeof coordination.acquire === 'function' ? coordination : undefined)

  const logAudit = async (entry) => {
    if (!audit || typeof audit.log !== 'function') return true
    try {
      const outcome = await audit.log(entry)
      return isObject(outcome) && outcome.ok === true
    } catch {
      return false
    }
  }

  const notify = (operation, event) => {
    const set = listeners.get(operation.id)
    if (!set) return
    for (const listener of [...set]) {
      try {
        listener(deepFreeze(event))
      } catch {
        // listener containment: one listener never breaks the rest
      }
    }
  }

  const terminalOf = (operation, terminal, extra = {}) => {
    if (operation.terminal !== null && operation.terminal !== terminal) {
      return { ok: false, code: 'conflict', reason: `operation '${operation.id}' already committed terminal '${operation.terminal}'` }
    }
    operation.terminal = terminal
    operation.phase = 'terminal'
    operation.observedAt = clock().toISOString()
    Object.assign(operation, extra)
    notify(operation, { id: operation.id, kind: 'terminal', terminal, observedAt: operation.observedAt })
    return { ok: true }
  }

  const acquireFence = async ({ resource, ownerId, signal }) => {
    const face = coordinationFace()
    if (!face) return { ok: false, code: 'unavailable', reason: 'coordination authority is inactive' }
    try {
      const outcome = await face.acquire({ resource, ownerId, leaseMs: DEFAULT_LEASE_MS, ...(signal ? { signal } : {}) })
      if (!isObject(outcome) || outcome.ok !== true || !isObject(outcome.handle)) {
        return {
          ok: false,
          code: isObject(outcome) && typeof outcome.code === 'string' ? outcome.code : 'unavailable',
          reason: isObject(outcome) && outcome.reason !== undefined ? boundedString(outcome.reason) : 'coordination lease could not be acquired',
        }
      }
      return { ok: true, fence: outcome.handle, observed: outcome.observed }
    } catch (error) {
      return { ok: false, code: 'unavailable', reason: `coordination acquire failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  const heartbeatFence = async (fence) => {
    const face = coordinationFace()
    if (!face || typeof face.heartbeat !== 'function') return { ok: false, code: 'unavailable', reason: 'coordination authority is inactive' }
    try {
      const outcome = await face.heartbeat(fence)
      if (!isObject(outcome) || outcome.ok !== true) {
        return { ok: false, code: isObject(outcome) && typeof outcome.code === 'string' ? outcome.code : 'conflict', reason: isObject(outcome) && outcome.reason !== undefined ? boundedString(outcome.reason) : 'fencing lease is no longer held' }
      }
      return { ok: true }
    } catch (error) {
      return { ok: false, code: 'unavailable', reason: `coordination heartbeat failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  const releaseFence = async (fence) => {
    const face = coordinationFace()
    if (!face || typeof face.release !== 'function' || !fence) return
    try {
      await face.release(fence)
    } catch {
      // release after terminal is best-effort (idempotent)
    }
  }

  const runSteps = async ({ operation, plan, fence, signal }) => {
    const done = []
    for (const slice of plan.slices ?? []) {
      for (const step of slice.steps ?? []) {
        if (signal?.aborted) {
          return { ok: false, code: 'aborted', reason: 'cancelled before the next step', done }
        }
        if (operation.terminal !== null) return { ok: false, code: 'conflict', reason: 'operation already committed a terminal' }
        const beat = await heartbeatFence(fence)
        if (!beat.ok) {
          return { ok: false, code: 'lease-lost', reason: beat.reason ?? 'fencing lease was lost', done }
        }
        const adapter = stepAdapters[step.authority]
        if (!adapter || typeof adapter.run !== 'function') {
          return { ok: false, code: 'unavailable', reason: `no restore step adapter for authority '${step.authority}'`, done }
        }
        // Lineage-supersession attribution rides with the session branch step
        // after stop-then-restore (requirements §10): the branch authority
        // writes it; the loop-side terminal adjudication stays with the
        // interaction authority. When the attribution cannot be delivered the
        // outcome still exposes the observed stopped attempt.
        const invocation = { steps: step.steps ?? {}, fence: { fencingToken: fence.fencingToken, generation: fence.generation }, signal }
        if (operation.stoppedAttempt && step.authority === 'sessions.branches.restore') {
          invocation.steps = deepFreeze({ ...(step.steps ?? {}), supersession: { supersededBy: 'restore', attemptId: operation.stoppedAttempt.attemptId, terminal: operation.stoppedAttempt.terminal } })
        }
        const outcome = await adapter.run(invocation)
        if (!outcome.ok) {
          return { ok: false, code: 'step-failed', failedStep: step.stepId, reason: outcome.reason, done }
        }
        // Only completed steps are recorded as `stepsDone`; the failing step is
        // reported separately via `failedStep` (partial-result semantics).
        const result = deepFreeze({
          stepId: step.stepId,
          authority: step.authority,
          ok: true,
          code: outcome.code,
          ...(outcome.reason ? { reason: outcome.reason } : {}),
        })
        done.push(result)
        await logAudit({ kind: 'restore-step', operationId: operation.id, checkpointId: operation.checkpointId, stepId: step.stepId, code: outcome.code, observedAt: clock().toISOString() })
        if (signal?.aborted) {
          return { ok: false, code: 'aborted', reason: 'cancelled after the current step reached its authority boundary', done }
        }
      }
    }
    return { ok: true, code: 'completed', done }
  }

  const stopThenRestore = async ({ operation, plan, signal }) => {
    const live = plan.liveState
    if (!isObject(live) || live.state !== 'running') {
      return { ok: true, stoppedAttempt: null }
    }
    if (plan.stopThenRestore?.available !== true) {
      return { ok: false, code: 'denied', reason: plan.stopThenRestore?.reason ?? 'running session restore is unavailable without the shared cancel boundary' }
    }
    const attemptId = live.attemptId
    const sessionId = plan.slices?.[0]?.resourceId
    const requested = await facts.requestStop({
      sessionId,
      ...(attemptId ? { attemptId } : {}),
      cause: `restore:${operation.id}`,
      signal,
    })
    if (!requested.ok) {
      return { ok: false, code: requested.code === 'unavailable' ? 'unavailable' : 'denied', reason: requested.reason ?? 'stop request was rejected' }
    }
    if (typeof waitForTerminal !== 'function') {
      return { ok: false, code: 'unavailable', reason: 'attempt terminal observation is not available' }
    }
    const waited = await waitForTerminal(attemptId, { timeoutMs: operation.stopWaitMs, signal })
    if (!isObject(waited) || waited.ok !== true || !TERMINALS.includes(waited.terminal)) {
      return { ok: false, code: waited?.code === 'aborted' ? 'aborted' : 'error', reason: waited?.reason ?? 'the live attempt did not reach a terminal within the declared bound' }
    }
    operation.stoppedAttempt = deepFreeze({ attemptId, terminal: waited.terminal })
    return { ok: true, stoppedAttempt: operation.stoppedAttempt }
  }

  const operationAvailability = () => {
    const storeStatus = store.availability('session').status === 'active' || store.availability('workspace').status === 'active'
      ? 'active' : 'unavailable'
    const hasAdapter = Object.values(stepAdapters).some((adapter) => adapter && adapter.available?.())
    const coord = coordinationFace()
    const restoreStatus = storeStatus === 'active' && hasAdapter && coord ? 'active' : 'unavailable'
    const cancel = facts.cancelState()
    return deepFreeze({
      status: restoreStatus,
      ...(restoreStatus !== 'active' ? { reason: !coord ? 'coordination authority is inactive' : !hasAdapter ? 'no restore step authority is active' : 'durable record backend is unavailable' } : {}),
      stopThenRestore: cancel,
    })
  }

  const api = {
    availability: operationAvailability,

    /**
     * Start one restore operation. A valid plan snapshot (from planRestore)
     * is required; preflight re-validates the fingerprint, record, claims and
     * preconditions before any step executes ((requirements §6).
     */
    restore: async (checkpointId, { plan, signal } = {}, caller = {}) => {
      if (typeof checkpointId !== 'string' || !checkpointId) {
        return deepFreeze({ ok: false, code: 'invalid-input', reason: 'checkpointId must be a non-empty string' })
      }
      if (!isObject(plan) || typeof plan.fingerprint !== 'string' || plan.checkpointId !== checkpointId) {
        return deepFreeze({ ok: false, code: 'invalid-input', reason: 'a valid frozen plan for this checkpoint is required' })
      }
      const ownerId = typeof ownerOf === 'function' ? ownerOf(caller) : undefined
      if (!ownerId) {
        return deepFreeze({ ok: false, code: 'unavailable', reason: 'caller owner derivation is unavailable' })
      }
      const observedAt = clock().toISOString()

      // Preflight: recompute the plan from the record + current authority map.
      const recomputed = await planner.planRestore(checkpointId)
      if (!recomputed.ok) {
        return deepFreeze({ ok: false, code: recomputed.code === 'missing' ? 'missing' : recomputed.code, reason: recomputed.reason, observedAt })
      }
      if (recomputed.plan.fingerprint !== plan.fingerprint || canonicalize(plan.slices ?? []) !== canonicalize(recomputed.plan.slices ?? [])) {
        return deepFreeze({ ok: false, code: 'conflict', reason: 'the plan is stale: the checkpoint record or its anchors changed since planning', observedAt })
      }
      if (recomputed.plan.overallRestoreability === 'unavailable' || recomputed.plan.overallRestoreability === 'not-applicable') {
        return deepFreeze({ ok: false, code: 'denied', reason: 'the plan declares no currently restoreable slice', observedAt })
      }
      const unavailableSteps = (recomputed.plan.slices ?? []).flatMap((slice) => (slice.steps ?? []).filter((step) => step.restoreability === 'unavailable'))
      if (unavailableSteps.length > 0) {
        return deepFreeze({ ok: false, code: 'denied', reason: `plan step '${unavailableSteps[0].stepId}' is not currently restoreable`, observedAt })
      }
      for (const slice of recomputed.plan.slices ?? []) {
        for (const step of slice.steps ?? []) {
          const adapter = stepAdapters[step.authority]
          if (!adapter || adapter.available?.() !== true) {
            return deepFreeze({ ok: false, code: 'unavailable', reason: `restore authority '${step.authority}' is inactive`, observedAt })
          }
        }
      }

      const resourceId = recomputed.plan.slices?.[0]?.resourceId
      const sliceKind = recomputed.plan.slices?.[0]?.slice ?? 'session'
      const lease = await acquireFence({
        resource: { scope: sliceKind === 'session' ? 'session' : 'workspace', key: `${sliceKind === 'session' ? 'sessions' : 'workspaces'}.${resourceId}.restore` },
        ownerId,
        signal,
      })
      if (!lease.ok) {
        return deepFreeze({ ok: false, code: lease.code === 'conflict' ? 'conflict' : 'denied', reason: lease.reason ?? 'exclusive control of the target resource could not be acquired', observedAt })
      }

      const operation = {
        id: makeId(),
        checkpointId,
        ownerId,
        phase: 'pending',
        terminal: null,
        attempts: 1,
        epoch: recomputed.plan.epoch,
        stopWaitMs: DEFAULT_STOP_WAIT_MS,
        stoppedAttempt: null,
        result: null,
        reason: undefined,
        observedAt,
        fence: lease.fence,
      }
      // Internal cancel source: handle dispose requests a stop (never forges a
      // terminal); the composed signal preserves the caller's AbortSignal.
      const controller = new AbortController()
      operation.controller = controller
      const composed = composeSignals(signal, controller.signal)
      operations.set(operation.id, operation)
      notify(operation, { id: operation.id, kind: 'started', checkpointId, observedAt })

      const finish = async (terminal, extra = {}) => {
        const committed = terminalOf(operation, terminal, extra)
        await releaseFence(operation.fence)
        if (committed.ok) {
          await logAudit({ kind: 'restore-terminal', operationId: operation.id, checkpointId, terminal, observedAt: clock().toISOString() })
        }
        return committed.ok
      }

      // Stop-then-restore sequencing before any rewind step.
      const stopped = await stopThenRestore({ operation, plan: recomputed.plan, signal: composed })
      if (!stopped.ok) {
        await finish(stopped.code === 'aborted' ? 'aborted' : stopped.code === 'denied' ? 'denied' : 'error', {
          reason: stopped.reason ?? 'stop-then-restore precondition failed',
        })
        const outcome = api.statusOf(operation.id)
        return deepFreeze({ ok: false, code: stopped.code === 'aborted' ? 'aborted' : 'denied', reason: stopped.reason, operation: outcome.operation, handle: api.handleFor(operation.id), observedAt: clock().toISOString() })
      }

      operation.phase = 'running'
      const steps = await runSteps({ operation, plan: recomputed.plan, fence: operation.fence, signal: composed })
      if (steps.ok) {
        await finish('success', {
          result: deepFreeze({ partial: false, stepsDone: steps.done.map((item) => item.stepId), perSlice: (recomputed.plan.slices ?? []).map((slice) => deepFreeze({ slice: slice.slice, status: 'restored' })) }),
        })
      } else if (steps.code === 'lease-lost') {
        await finish('error', {
          reason: steps.reason ?? 'fencing lease was lost',
          result: deepFreeze({ partial: true, stepsDone: steps.done.map((item) => item.stepId), failedStep: undefined, perSlice: [] }),
        })
      } else if (steps.code === 'aborted' || (steps.code === 'step-failed' && composed?.aborted)) {
        await finish('aborted', {
          reason: steps.reason ?? 'cancelled',
          result: deepFreeze({ partial: true, stepsDone: steps.done.map((item) => item.stepId), failedStep: steps.failedStep, perSlice: [] }),
        })
      } else {
        await finish('error', {
          reason: steps.reason ?? 'a restore step failed',
          result: deepFreeze({ partial: true, stepsDone: steps.done.map((item) => item.stepId), failedStep: steps.failedStep, perSlice: [] }),
        })
      }

      return deepFreeze({ ok: true, code: 'started', handle: api.handleFor(operation.id), operation: api.statusOf(operation.id).operation, observedAt: clock().toISOString() })
    },

    /** Operation status snapshot (frozen, terminal-once). */
    statusOf: (operationId) => {
      const operation = operations.get(operationId)
      if (!operation) return deepFreeze({ ok: false, code: 'missing', reason: `no restore operation '${operationId}'` })
      return deepFreeze({
        ok: true,
        code: 'status',
        operation: deepFreeze({
          id: operation.id,
          ownerId: operation.ownerId,
          checkpointId: operation.checkpointId,
          phase: operation.phase,
          attempts: operation.attempts,
          ...(operation.terminal !== null ? { terminal: operation.terminal } : {}),
          ...(operation.result ? { result: operation.result } : {}),
          ...(operation.stoppedAttempt ? { stoppedAttempt: operation.stoppedAttempt } : {}),
          ...(operation.reason !== undefined ? { reason: operation.reason } : {}),
          observedAt: operation.observedAt,
        }),
      })
    },

    /** Standard operation handle factory for the entry outcome. */
    handleFor: (operationId) => {
      const operation = operations.get(operationId)
      if (!operation) return undefined
      const handle = {
        id: operation.id,
        ownerId: operation.ownerId,
        status: () => api.statusOf(operationId).operation,
        observe: (listener) => {
          if (typeof listener !== 'function') {
            return deepFreeze({ ok: false, code: 'invalid-input', reason: 'listener must be a function' })
          }
          if (!listeners.has(operation.id)) listeners.set(operation.id, new Set())
          listeners.get(operation.id).add(listener)
          return deepFreeze({
            ok: true,
            current: () => api.statusOf(operationId).operation,
            subscribe: (fn) => {
              if (typeof fn !== 'function') return deepFreeze({ ok: false, code: 'invalid-input', reason: 'listener must be a function' })
              listeners.get(operation.id)?.add(fn)
              return deepFreeze({ ok: true, dispose: () => listeners.get(operation.id)?.delete(fn) })
            },
            dispose: () => {
              listeners.get(operation.id)?.delete(listener)
              return deepFreeze({ ok: true, code: 'disposed' })
            },
          })
        },
        dispose: () => {
          // Dispose requests a stop; it never forges a terminal.
          if (operation.terminal === null) {
            try {
              operation.controller?.abort()
            } catch {
              // cancellation source is best-effort
            }
          }
          notify(operation, { id: operation.id, kind: 'disposed', observedAt: clock().toISOString() })
          return deepFreeze({ ok: true, code: 'disposed' })
        },
      }
      return frozenHandle(handle)
    },
  }
  return api
}