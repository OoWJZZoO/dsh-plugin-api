/**
 * Restore planning — `planRestore(checkpointId)` (Requirement 5).
 *
 * A pure, side-effect-free frozen plan: per-slice steps bound to concrete
 * owning authorities, each step's expected effect, required claims and
 * preconditions, per-slice restoreability, the external-effects statement and
 * a deterministic fingerprint. Repeated calls with the same state SHALL
 * produce the same fingerprint; the plan writes nothing, acquires nothing
 * durably and changes no state.
 *
 * The fingerprint covers stable content (slices/steps/claims/externalEffects/
 * restoreability) and excludes `generatedAt`/`epoch`/`liveState`/
 * `stopThenRestore.available` — restore preflight recomputes the fingerprint
 * from the record + current authority map to detect stale plans
 * (requirements §5 and §6).
 */

import { deepFreeze } from './deep-freeze.js'

function isObject(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}

function boundedString(value, max = 160) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const text = String(value).trim()
  return text ? text.slice(0, max) : undefined
}

function stableKeySort(value) {
  if (Array.isArray(value)) return value.map(stableKeySort)
  if (isObject(value)) {
    const out = {}
    for (const key of Object.keys(value).sort()) out[key] = stableKeySort(value[key])
    return out
  }
  return value
}

/** Deterministic canonical serialization of the stable plan subset. */
export function canonicalize(value) {
  return JSON.stringify(stableKeySort(value))
}

/** Filtered stable subset used for the plan fingerprint. */
function fingerprintInput({ checkpointId, slices, claims, externalEffects, overallRestoreability } = {}) {
  return {
    checkpointId,
    slices: (slices ?? []).map((slice) => ({
      slice: slice.slice,
      resourceId: slice.resourceId,
      steps: (slice.steps ?? []).map((step) => ({
        stepId: step.stepId,
        authority: step.authority,
        effect: step.effect,
        restoreability: step.restoreability,
        compensatable: step.compensatable,
      })),
      overall: slice.overall,
      reasons: slice.reasons ?? [],
    })),
    claims: claims ?? [],
    externalEffects: (externalEffects ?? []).map(({ name, kind }) => ({ name, kind })),
    overallRestoreability,
  }
}

const RESTOREABILITY_RANK = { 'not-applicable': 0, unavailable: 1, partial: 2, restoreable: 3 }

function worstOf(values) {
  let worst = values[0]
  for (const value of values.slice(1)) {
    if ((RESTOREABILITY_RANK[value] ?? 1) < (RESTOREABILITY_RANK[worst] ?? 1)) worst = value
  }
  return worst
}

function rewardsRestoreability(captureStatus) {
  if (captureStatus === 'captured') return 'restoreable'
  if (captureStatus === 'partial') return 'partial'
  return 'unavailable'
}

/**
 * Compute restoreability of one slice from the record capture status, the
 * owning source availability and the live-attempt precondition. A session
 * whose idle state cannot be confirmed is fail-closed (blocked) unless the
 * stop-then-restore path is available; a running/queued session requires the
 * stop path.
 */
export function computeSliceRestoreability({ kind, captureStatus, sourceAvailability, liveState, stopThenRestore }) {
  const reasons = []
  let base = rewardsRestoreability(captureStatus)
  if (sourceAvailability !== 'active') {
    base = RESTOREABILITY_RANK[base] > RESTOREABILITY_RANK.unavailable ? 'unavailable' : base
    reasons.push('owning authority is unavailable')
  }
  if (kind === 'session') {
    if (liveState?.state === 'running' || liveState?.state === 'queued') {
      if (stopThenRestore !== true) {
        base = 'unavailable'
        reasons.push('running session restore is unavailable without the shared cancel boundary')
      }
    } else if (liveState?.state !== 'idle') {
      // No evidence source confirms the session is idle: fail-closed direction.
      if (stopThenRestore !== true) {
        base = 'unavailable'
        reasons.push('session idle state cannot be confirmed (fail-closed)')
      }
    }
  }
  return { status: base, reasons }
}

/**
 * Build the restore planner.
 * @param {{
 *   store: object,     // createCheckpointStore
 *   facts: object,     // createLoopFacts
 *   sources: object,   // map kind -> capture source adapter ({ availability() })
 *   now?: Function,
 *   logger?: object,
 * }} options
 */
export function createRestorePlanner({ store, facts, sources = {}, now, logger } = {}) {
  const clock = typeof now === 'function' ? now : () => new Date()

  const sourceAvailabilityOf = (kind) => {
    const source = sources[kind]
    if (!source || typeof source.availability !== 'function') {
      return { status: 'unavailable', reason: `owning authority for source '${kind}' is inactive` }
    }
    let reported
    try {
      reported = source.availability()
    } catch {
      return { status: 'unavailable', reason: `owning authority for source '${kind}' could not be queried` }
    }
    if (isObject(reported) && (reported.status === 'active' || reported.status === 'degraded' || reported.status === 'unavailable')) {
      return { status: reported.status, ...(reported.reason ? { reason: boundedString(reported.reason) } : {}) }
    }
    return { status: 'degraded', reason: 'owning authority returned an unknown availability shape' }
  }

  const recognizeAuthority = (kind) => {
    if (kind === 'branch') return 'sessions.branches.restore'
    if (kind === 'workspace-journal') return 'workspaces.transactions.recover'
    if (kind === 'workspace-snapshot') return 'workspaces.snapshot.restore'
    return undefined
  }

  const stepEffectOf = (authority, resourceId) => {
    if (authority === 'sessions.branches.restore') return `restore session '${resourceId}' to the captured branch`
    if (authority === 'workspaces.transactions.recover') return `recover workspace '${resourceId}' transaction journal window`
    if (authority === 'workspaces.snapshot.restore') return `apply workspace '${resourceId}' snapshot`
    return 'apply the captured state'
  }

  const stepsPayloadOf = (record) => {
    const data = record?.data ?? {}
    const anchor = data.source?.anchor ?? {}
    const kind = data.source?.kind
    if (kind === 'branch') return { sessionId: record.scope?.session, branchId: anchor.branchId }
    if (kind === 'workspace-journal') return { workspaceId: record.scope?.workspace, transactionId: anchor.transactionId }
    if (kind === 'workspace-snapshot') return { workspaceId: record.scope?.workspace, snapshotId: anchor.snapshotId }
    return {}
  }

  const api = {
    /**
     * Compute a frozen restore plan (pure). NULL writes/acquisitions; the
     * same state always produces the same fingerprint.
     * @param {string} checkpointId
     */
    planRestore: async (checkpointId) => {
      if (typeof checkpointId !== 'string' || !checkpointId) {
        return deepFreeze({ ok: false, code: 'invalid-input', reason: 'checkpointId must be a non-empty string' })
      }
      const found = await store.get(checkpointId)
      if (!found.ok) {
        return deepFreeze({
          ok: false,
          code: found.code === 'unsupported-schema' ? 'unsupported-schema' : found.code === 'missing' ? 'missing' : 'unavailable',
          reason: found.reason,
          observedAt: clock().toISOString(),
        })
      }
      const record = found.record
      const data = record.data ?? {}
      const kind = data.source?.kind
      const resourceId = record.scope?.session ?? record.scope?.workspace
      const captureStatus = data.capture?.overall ?? 'unknown'
      const authority = recognizeAuthority(kind)

      const liveState = record.scope?.session !== undefined
        ? facts.observed(record.scope.session)
        : deepFreeze({ evidence: 'unknown', reason: 'workspace slices have no live-attempt precondition in v1' })
      const cancel = facts.cancelState()
      const stopThenRestore = {
        available: record.scope?.session !== undefined && cancel.status === 'active',
        ...(cancel.status !== 'active' ? { reason: boundedString(cancel.reason) ?? 'shared cancel boundary is inactive' } : {}),
      }

      if (!authority) {
        const slices = []
        const reasons = ['the checkpoint declares no restorable v1 slice']
        const plan = deepFreeze({
          checkpointId,
          generatedAt: clock().toISOString(),
          epoch: String(clock().getTime()),
          fingerprint: 'unavailable',
          slices,
          liveState,
          stopThenRestore,
          claims: [],
          externalEffects: data.externalEffects ?? [],
          overallRestoreability: 'not-applicable',
          reasons,
        })
        return deepFreeze({ ok: true, plan })
      }

      const sourceAvailability = sourceAvailabilityOf(kind)
      const sliceKind = record.scope?.session !== undefined ? 'session' : 'workspace'
      const { status: sliceStatus, reasons } = computeSliceRestoreability({
        kind: sliceKind,
        captureStatus,
        sourceAvailability: sourceAvailability.status,
        liveState,
        stopThenRestore: stopThenRestore.available,
      })
      const step = deepFreeze({
        stepId: `${kind}-restore`,
        authority,
        effect: stepEffectOf(authority, resourceId),
        precondition: liveState.evidence === 'observed' || liveState.evidence === 'reconstructed'
          ? deepFreeze({ liveAttempt: { state: liveState.state, ...(liveState.attemptId ? { attemptId: liveState.attemptId } : {}) } })
          : deepFreeze({ liveAttempt: { state: 'unknown' } }),
        restoreability: sliceStatus,
        compensatable: false,
        steps: stepsPayloadOf(record),
      })
      const slice = deepFreeze({
        slice: record.scope?.session !== undefined ? 'session' : 'workspace',
        resourceId,
        steps: [step],
        overall: sliceStatus,
        reasons: [...reasons, ...(sourceAvailability.status !== 'active' && sourceAvailability.reason ? [boundedString(sourceAvailability.reason)] : [])].filter(Boolean),
      })
      const slices = [slice]
      const claims = deepFreeze([{
        resource: `${slice.slice === 'session' ? 'sessions' : 'workspaces'}.${resourceId}.restore`,
        mode: 'exclusive',
      }])
      const externalEffects = data.externalEffects ?? []
      const overallRestoreability = worstOf([sliceStatus])
      const fingerprint = canonicalize(fingerprintInput({ checkpointId, slices, claims, externalEffects, overallRestoreability }))
      const plan = deepFreeze({
        checkpointId,
        generatedAt: clock().toISOString(),
        epoch: String(clock().getTime()),
        fingerprint,
        slices,
        liveState,
        stopThenRestore,
        claims,
        externalEffects,
        overallRestoreability,
      })
      return deepFreeze({ ok: true, plan })
    },
  }
  return api
}