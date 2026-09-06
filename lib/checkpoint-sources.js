/**
 * Capture source adapters and restore step adapters, each bound to one
 * declared owning authority (requirements §3 / (requirements §6).
 *
 * v1 source table:
 * - `branch` → `sessions.branches` (session scope)
 * - `workspace-journal` → `workspaces.transactions` (workspace scope)
 * - `workspace-snapshot` → workspace snapshot slice (workspace scope; slice
 *   active only when the replacement workspace row passed its probe).
 *
 * Every adapter is defensive: an absent or malformed authority face yields
 * typed unavailable with the concrete cause; nothing is invented. The
 * production faces are wired at the integration wave; tests use
 * contract-faithful fixtures of the same shapes.
 *
 * Capture outcome:
 *   { ok: true, anchor, components: [{name, status, detail?}], capturedAt }
 *   | { ok: false, code, reason }
 */

import { deepFreeze } from './deep-freeze.js'
import {
  CAPTURE_SOURCE_KINDS,
  CAPTURE_STATUSES,
  RESTOREABILITY_VALUES,
} from './checkpoint-record.js'

function isObject(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}

function boundedString(value, max = 160) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const text = String(value).trim()
  return text ? text.slice(0, max) : undefined
}

function normalizeStatus(value, fallback = 'unavailable') {
  return CAPTURE_STATUSES.includes(value) ? value : fallback
}

function asComponents(value) {
  if (!Array.isArray(value)) return undefined
  const out = []
  for (const item of value) {
    if (!isObject(item) || typeof item.name !== 'string' || !item.name) continue
    out.push(deepFreeze({
      name: item.name.slice(0, 60),
      status: normalizeStatus(item.status),
      ...(item.detail !== undefined ? { detail: boundedString(item.detail) } : {}),
    }))
  }
  return out.length > 0 ? out : undefined
}

/**
 * Normalize an authority capture outcome into the checkpoint capture protocol.
 */
export function normalizeCaptureOutcome(value) {
  if (!isObject(value)) {
    return { ok: false, code: 'unavailable', reason: 'capture source returned no outcome' }
  }
  if (value.ok !== true) {
    return {
      ok: false,
      code: typeof value.code === 'string' ? value.code : 'unavailable',
      reason: isObject(value) && value.reason !== undefined ? boundedString(value.reason) : 'capture source rejected the capture',
    }
  }
  const anchor = value.anchor === undefined ? {} : value.anchor
  if (!isObject(anchor)) {
    return { ok: false, code: 'unavailable', reason: 'capture source returned a malformed anchor' }
  }
  return {
    ok: true,
    anchor,
    components: asComponents(value.components) ?? [deepFreeze({ name: 'source', status: 'captured' })],
    capturedAt: typeof value.capturedAt === 'string' && value.capturedAt ? value.capturedAt : new Date().toISOString(),
  }
}

/**
 * Map a capture component status to a plan-time restoreability hint.
 */
export function captureStatusToRestoreability(status) {
  if (status === 'captured') return 'restoreable'
  if (status === 'partial') return 'partial'
  return 'unavailable'
}

/**
 * Build the `branch` capture source over the `sessions.branches` authority
 * face. The face contract: `{ create(spec) -> outcome, availability() }`.
 * @param {{ branches?: object, logger?: object }} options
 */
export function createBranchSource({ branches, logger } = {}) {
  const face = () => (isObject(branches) && typeof branches.create === 'function' ? branches : undefined)
  return deepFreeze({
    kind: 'branch',
    scope: 'session',
    availability: () => {
      const active = face()
      if (!active) return deepFreeze({ status: 'unavailable', reason: 'session branch authority is inactive' })
      const reported = active.availability?.()
      if (isObject(reported) && normalizedAvailabilityStatus(reported)) {
        return deepFreeze({ status: normalizedAvailabilityStatus(reported), ...(reported.reason ? { reason: reported.reason } : {}) })
      }
      return deepFreeze({ status: 'active' })
    },
    capture: async ({ resourceId, reason, signal, caller = {} } = {}) => {
      const active = face()
      if (!active) return { ok: false, code: 'unavailable', reason: 'session branch authority is inactive' }
      try {
        const outcome = await active.create({
          sessionId: resourceId,
          ...(reason ? { reason } : {}),
          ...(caller.owner ? { owner: caller.owner } : {}),
          ...(signal ? { signal } : {}),
        })
        if (isObject(outcome) && outcome.ok !== true) {
          return {
            ok: false,
            code: typeof outcome.code === 'string' ? outcome.code : 'unavailable',
            reason: boundedString(outcome.reason) ?? 'session branch authority rejected the branch anchor',
          }
        }
        const branchId = outcome?.handle?.id ?? outcome?.branchId ?? outcome?.id
        if (typeof branchId !== 'string' || !branchId) {
          return { ok: false, code: 'unavailable', reason: 'session branch authority returned no branch id' }
        }
        return normalizeCaptureOutcome({
          ok: true,
          anchor: { branchId, sessionId: resourceId },
          components: Array.isArray(outcome.components) && outcome.components.length > 0
            ? outcome.components
            : [{ name: 'branch', status: 'captured' }],
          capturedAt: outcome?.observedAt,
        })
      } catch (error) {
        return { ok: false, code: 'unavailable', reason: `session branch authority failed: ${error instanceof Error ? error.message : String(error)}` }
      }
    },
  })
}

/**
 * Build the `workspace-journal` capture source over the
 * `workspaces.transactions` authority face. The face contract:
 * `{ prepare(spec) -> outcome with handle.id, record(handleId, input) -> outcome, availability() }`.
 * A journal capture records a checkpoint marker entry into a prepared
 * transaction window; the anchor is the transaction/journal id.
 * @param {{ transactions?: object, logger?: object }} options
 */
export function createWorkspaceJournalSource({ transactions, logger } = {}) {
  const face = () => (isObject(transactions) && typeof transactions.prepare === 'function' && typeof transactions.record === 'function' ? transactions : undefined)
  return deepFreeze({
    kind: 'workspace-journal',
    scope: 'workspace',
    availability: () => {
      const active = face()
      if (!active) return deepFreeze({ status: 'unavailable', reason: 'workspace transaction authority is inactive' })
      const reported = active.availability?.()
      if (isObject(reported) && normalizedAvailabilityStatus(reported)) {
        return deepFreeze({ status: normalizedAvailabilityStatus(reported), ...(reported.reason ? { reason: reported.reason } : {}) })
      }
      return deepFreeze({ status: 'active' })
    },
    capture: async ({ resourceId, reason, signal, caller = {} } = {}) => {
      const active = face()
      if (!active) return { ok: false, code: 'unavailable', reason: 'workspace transaction authority is inactive' }
      try {
        const prepared = await active.prepare({
          workspaceId: resourceId,
          ...(reason ? { reason } : {}),
          ...(caller.owner ? { owner: caller.owner } : {}),
          ...(signal ? { signal } : {}),
        })
        if (isObject(prepared) && prepared.ok !== true) {
          return {
            ok: false,
            code: typeof prepared.code === 'string' ? prepared.code : 'unavailable',
            reason: boundedString(prepared.reason) ?? 'workspace transaction authority rejected the journal prepare',
          }
        }
        const transactionId = prepared?.handle?.id ?? prepared?.transactionId
        if (typeof transactionId !== 'string' || !transactionId) {
          return { ok: false, code: 'unavailable', reason: 'workspace transaction authority returned no transaction id' }
        }
        const recorded = await active.record(transactionId, {
          kind: 'checkpoint-marker',
          ...(reason ? { reason } : {}),
        })
        if (isObject(recorded) && recorded.ok !== true) {
          return {
            ok: false,
            code: typeof recorded.code === 'string' ? recorded.code : 'unavailable',
            reason: boundedString(recorded.reason) ?? 'workspace transaction authority rejected the journal marker',
          }
        }
        return normalizeCaptureOutcome({
          ok: true,
          anchor: { transactionId, workspaceId: resourceId },
          components: Array.isArray(recorded.components) && recorded.components.length > 0
            ? recorded.components
            : [{ name: 'journal', status: 'captured' }],
          capturedAt: recorded?.observedAt,
        })
      } catch (error) {
        return { ok: false, code: 'unavailable', reason: `workspace transaction authority failed: ${error instanceof Error ? error.message : String(error)}` }
      }
    },
  })
}

/**
 * Build the `workspace-snapshot` capture source over the workspace snapshot
 * slice (the replacement workspace row's additive face). The face contract:
 * `{ snapshot: { capture(spec) -> outcome, availability() } }`.
 * The source is active only when the slice is installed AND its probe passed;
 * otherwise it reports unavailable without inventing a capability.
 * @param {{ snapshot?: object, logger?: object }} options
 */
export function createWorkspaceSnapshotSource({ snapshot, logger } = {}) {
  const face = () => (isObject(snapshot) && typeof snapshot.capture === 'function' ? snapshot : undefined)
  return deepFreeze({
    kind: 'workspace-snapshot',
    scope: 'workspace',
    availability: () => {
      const active = face()
      if (!active) return deepFreeze({ status: 'unavailable', reason: 'workspace snapshot slice is inactive' })
      const reported = active.availability?.()
      if (isObject(reported) && normalizedAvailabilityStatus(reported)) {
        return deepFreeze({ status: normalizedAvailabilityStatus(reported), ...(reported.reason ? { reason: reported.reason } : {}) })
      }
      return deepFreeze({ status: 'active' })
    },
    capture: async ({ resourceId, reason, signal, caller = {} } = {}) => {
      const active = face()
      if (!active) return { ok: false, code: 'unavailable', reason: 'workspace snapshot slice is inactive' }
      try {
        const outcome = await active.capture({
          workspaceId: resourceId,
          ...(reason ? { reason } : {}),
          ...(caller.owner ? { owner: caller.owner } : {}),
          ...(signal ? { signal } : {}),
        })
        return normalizeCaptureOutcome(outcome)
      } catch (error) {
        return { ok: false, code: 'unavailable', reason: `workspace snapshot slice failed: ${error instanceof Error ? error.message : String(error)}` }
      }
    },
  })
}

function normalizedAvailabilityStatus(reported) {
  if (reported?.status === 'active' || reported?.status === 'degraded' || reported?.status === 'unavailable') {
    return reported.status
  }
  return undefined
}

/**
 * Resolve a v1 capture source by kind. Unknown kinds resolve to a typed
 * unsupported adapter (never a fake capture).
 * @param {{ kind: string, scopeKind: string }} declared
 * @param {{ branch?: object, journal?: object, snapshot?: object }} authorities
 */
export function resolveCaptureSource({ kind, scopeKind } = {}, authorities = {}) {
  if (!CAPTURE_SOURCE_KINDS.includes(kind)) {
    const unsupported = deepFreeze({
      kind,
      scope: scopeKind,
      availability: () => deepFreeze({ status: 'unavailable', reason: `capture source '${kind}' is not a registered v1 source` }),
      capture: async () => ({ ok: false, code: 'unsupported', reason: `capture source '${kind}' is not a registered v1 source` }),
    })
    return unsupported
  }
  if (kind === 'branch') return createBranchSource({ branches: authorities.branch })
  if (kind === 'workspace-journal') return createWorkspaceJournalSource({ transactions: authorities.journal })
  return createWorkspaceSnapshotSource({ snapshot: authorities.snapshot })
}

/**
 * Restore step adapters: each bound to the declared owning authority invoked
 * by the restore authority ((requirements §6). Face contracts:
 * - branch: `branches.restore({ sessionId, commitId/branchId, fence?, attribution?, signal? })`
 * - journal: `transactions.recover(handleOrId, { fence?, signal? })` or
 *   `transactions.rollback(...)` per the plan-declared step authority key
 * - snapshot: `snapshot.apply({ state, fence, signal? })` (fail-closed
 *   official-API reconstruction; first driven here in batch B).
 * Every adapter maps absence/malformed outcomes to typed results and never
 * retries beyond the declared capability.
 * @param {{ branches?: object, transactions?: object, snapshot?: object }} authorities
 */
export function createRestoreStepAdapters(authorities = {}) {
  const adapters = {
    'sessions.branches.restore': {
      slice: 'session',
      available: () => isObject(authorities.branches) && typeof authorities.branches.restore === 'function',
      reason: 'session branch restore authority is inactive',
      run: async ({ steps = {}, fence, signal } = {}) => {
        if (!adapters['sessions.branches.restore'].available()) {
          return { ok: false, code: 'unavailable', reason: adapters['sessions.branches.restore'].reason }
        }
        try {
          const outcome = await authorities.branches.restore({
            ...steps,
            ...(fence ? { fence } : {}),
            ...(signal ? { signal } : {}),
          })
          return normalizeStepOutcome(outcome, 'session branch restore failed')
        } catch (error) {
          return { ok: false, code: 'unavailable', reason: `session branch restore failed: ${error instanceof Error ? error.message : String(error)}` }
        }
      },
    },
    'workspaces.transactions.recover': {
      slice: 'workspace',
      available: () => isObject(authorities.transactions) && typeof authorities.transactions.recover === 'function',
      reason: 'workspace transaction recover authority is inactive',
      run: async ({ steps = {}, fence, signal } = {}) => {
        if (!adapters['workspaces.transactions.recover'].available()) {
          return { ok: false, code: 'unavailable', reason: adapters['workspaces.transactions.recover'].reason }
        }
        try {
          const outcome = await authorities.transactions.recover(steps.transactionId, {
            ...(fence ? { fence } : {}),
            ...(signal ? { signal } : {}),
          })
          return normalizeStepOutcome(outcome, 'workspace transaction recover failed')
        } catch (error) {
          return { ok: false, code: 'unavailable', reason: `workspace transaction recover failed: ${error instanceof Error ? error.message : String(error)}` }
        }
      },
    },
    'workspaces.transactions.rollback': {
      slice: 'workspace',
      available: () => isObject(authorities.transactions) && typeof authorities.transactions.rollback === 'function',
      reason: 'workspace transaction rollback authority is inactive',
      run: async ({ steps = {}, fence, signal } = {}) => {
        if (!adapters['workspaces.transactions.rollback'].available()) {
          return { ok: false, code: 'unavailable', reason: adapters['workspaces.transactions.rollback'].reason }
        }
        try {
          const outcome = await authorities.transactions.rollback(steps.transactionId, {
            ...(fence ? { fence } : {}),
            ...(signal ? { signal } : {}),
          })
          return normalizeStepOutcome(outcome, 'workspace transaction rollback failed')
        } catch (error) {
          return { ok: false, code: 'unavailable', reason: `workspace transaction rollback failed: ${error instanceof Error ? error.message : String(error)}` }
        }
      },
    },
    'workspaces.snapshot.restore': {
      slice: 'workspace',
      available: () => isObject(authorities.snapshot) && typeof authorities.snapshot.apply === 'function',
      reason: 'workspace snapshot restore path is inactive',
      run: async ({ steps = {}, fence, signal } = {}) => {
        if (!adapters['workspaces.snapshot.restore'].available()) {
          return { ok: false, code: 'unavailable', reason: adapters['workspaces.snapshot.restore'].reason }
        }
        // The durable snapshot state is fetched from the slice by snapshot id
        // (fresh read at execution time; validated by the apply path's
        // fail-closed fingerprint check).
        let state = steps.state
        if (!isObject(state) && typeof steps.snapshotId === 'string' && typeof authorities.snapshot.get === 'function') {
          try {
            state = await authorities.snapshot.get(steps.snapshotId)
          } catch {
            return { ok: false, code: 'unavailable', reason: 'workspace snapshot state could not be read' }
          }
        }
        if (!isObject(state)) {
          return { ok: false, code: 'unavailable', reason: 'workspace snapshot state is missing' }
        }
        try {
          const outcome = await authorities.snapshot.apply({
            state,
            ...(fence ? { fence } : {}),
            ...(signal ? { signal } : {}),
          })
          return normalizeStepOutcome(outcome, 'workspace snapshot restore failed')
        } catch (error) {
          return { ok: false, code: 'unavailable', reason: `workspace snapshot restore failed: ${error instanceof Error ? error.message : String(error)}` }
        }
      },
    },
  }
  return deepFreeze(adapters)
}

function normalizeStepOutcome(value, fallbackReason) {
  if (!isObject(value)) return { ok: false, code: 'unavailable', reason: fallbackReason }
  if (value.ok === true) return { ok: true, code: typeof value.code === 'string' ? value.code : 'done', ...(value.detail !== undefined ? { detail: value.detail } : {}) }
  return {
    ok: false,
    code: typeof value.code === 'string' ? value.code : 'error',
    reason: boundedString(value.reason) ?? fallbackReason,
  }
}

/**
 * Restoreability declaration helpers for plan computation.
 */
export function restoreabilityOf(status) {
  return RESTOREABILITY_VALUES.includes(status) ? status : 'unavailable'
}