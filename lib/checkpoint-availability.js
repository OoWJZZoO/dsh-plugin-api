/**
 * Checkpoint availability — `executions.recovery.checkpoints.availability()`
 * (Requirement 11).
 *
 * Frozen `{ status, reason? }` covering the projection, every v1 capture
 * source (`branch`, `workspace-journal`, `workspace-snapshot`), the
 * auto-capture policy and the restore authority (including its
 * stop-then-restore capability). Never throws; a missing source/slice/capability
 * yields typed unavailable with the concrete cause and unrelated faces stay
 * active.
 */

import { deepFreeze } from './deep-freeze.js'
import { CAPTURE_SOURCE_KINDS } from './checkpoint-record.js'

function worstStatus(statuses) {
  // Overall `unavailable` only when every reported face is unavailable; a
  // partial loss (a missing source/slice) degrades the face, it never takes
  // unrelated faces down.
  if (statuses.length === 0) return 'unavailable'
  if (statuses.every((status) => status === 'unavailable')) return 'unavailable'
  if (statuses.some((status) => status === 'unavailable' || status === 'degraded')) return 'degraded'
  return 'active'
}

/**
 * Build the checkpoints availability face.
 * @param {{
 *   active?: Function,        // facade core active check
 *   disabledReason?: string,  // capability-disabled reason
 *   projection?: object,      // { availability() -> {status, reason?} }
 *   capture?: object,         // { sourceAvailability(kind) -> {status, reason?} }
 *   autoCapture?: object,     // { availability() -> {status, reason?} }
 *   restore?: object,         // { availability() -> {status, reason?, stopThenRestore?} }
 * }} options
 */
export function createCheckpointAvailability({ active, disabledReason, projection, capture, autoCapture, restore } = {}) {
  const isActive = typeof active === 'function' ? active : () => true
  const disabled = disabledReason ?? 'checkpoints capability is unknown'

  const api = {
    availability: () => {
      if (!isActive()) return deepFreeze({ status: 'unavailable', reason: 'the plugin api core is inactive' })

      const projectionStatus = safeReport(projection)
      const sourceEntries = {}
      for (const kind of CAPTURE_SOURCE_KINDS) {
        sourceEntries[kind] = safeReport({ availability: () => capture?.sourceAvailability?.(kind) })
      }
      const autoCaptureStatus = safeReport(autoCapture)
      const restoreReport = restore && typeof restore.availability === 'function'
        ? safeReport(restore)
        : deepFreeze({ status: 'unavailable', reason: 'restore authority is not active' })
      const stopThenRestore = isObject(restoreReport.stopThenRestore)
        ? restoreReport.stopThenRestore
        : deepFreeze({ status: 'unavailable', reason: 'restore authority is not active' })

      const statuses = [
        projectionStatus.status,
        ...Object.values(sourceEntries).map((entry) => entry.status),
        autoCaptureStatus.status,
        restoreReport.status,
      ]
      const overall = worstStatus(statuses)

      return deepFreeze({
        status: overall,
        ...(overall !== 'active' ? { reason: firstReason([projectionStatus, autoCaptureStatus, restoreReport, ...Object.values(sourceEntries)]) } : {}),
        projection: projectionStatus,
        sources: deepFreeze(sourceEntries),
        autoCapture: autoCaptureStatus,
        restore: deepFreeze({ status: restoreReport.status, ...(restoreReport.reason ? { reason: restoreReport.reason } : {}), stopThenRestore }),
      })
    },

    /** Per-source capability reporting used by capture. */
    sourceAvailability: (kind) => {
      if (!isActive()) return deepFreeze({ status: 'unavailable', reason: 'the plugin api core is inactive' })
      if (!CAPTURE_SOURCE_KINDS.includes(kind)) {
        return deepFreeze({ status: 'unavailable', reason: `capture source '${kind}' is not a registered v1 source` })
      }
      if (typeof capture?.sourceAvailability !== 'function') {
        return deepFreeze({ status: 'unavailable', reason: disabled })
      }
      return safeReport({ availability: () => capture.sourceAvailability(kind) })
    },
  }
  return api
}

function isObject(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}

function safeReport(face) {
  if (!face || typeof face.availability !== 'function') {
    return deepFreeze({ status: 'unavailable', reason: 'face is not active' })
  }
  try {
    const reported = face.availability()
    if (isObject(reported) && (reported.status === 'active' || reported.status === 'degraded' || reported.status === 'unavailable')) {
      return deepFreeze({
        status: reported.status,
        ...(reported.reason !== undefined ? { reason: String(reported.reason).slice(0, 160) } : {}),
        ...(reported.stopThenRestore !== undefined ? { stopThenRestore: reported.stopThenRestore } : {}),
      })
    }
  } catch {
    return deepFreeze({ status: 'unavailable', reason: 'face availability query failed' })
  }
  return deepFreeze({ status: 'unavailable', reason: 'face reported an unknown availability shape' })
}

function firstReason(reports) {
  for (const report of reports) {
    if (report && report.status !== 'active' && report.reason) return String(report.reason).slice(0, 160)
  }
  return 'one or more checkpoint faces are degraded or unavailable'
}