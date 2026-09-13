import { PluginApiInactiveError } from './errors.js'
import { redactValue } from './diagnostics-normalize.js'

/**
 * Controlled credential mutation face (`credentials.set` / `credentials.unset`),
 * core module.
 *
 * The official credentials provider owns the storage: a write goes through its
 * exclusive operation chain (file lock, reconcile-from-disk, atomic replace)
 * and the provider dispatches `credentials/updated` only after the commit.
 * This module never keeps a second authority — it validates the request and the
 * official backend state before any side effect, wraps the write, verifies the
 * outcome against the **management storage layer** (`source: 'file'`), and
 * derives its per-ref revision markers from the official fact stream.
 *
 * The official seam has no compare-and-set parameter, so the optimistic
 * conflict check below is a declared facade-side simulation (fail-closed): it
 * never presents itself as official arbitration, and the official write chain
 * stays the final mutation owner.
 */

export const CREDENTIAL_REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
export const CREDENTIAL_AUDIT_CAPACITY = 512

/** Marker state for a ref whose propagation failed: unknown, never stale. */
const REVISION_INVALID = Symbol('credential revision invalid')

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)
const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0

function bounded(value, max = 240) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const text = typeof value === 'string' ? redactValue(value) : String(value)
  return text ? text.slice(0, max) : undefined
}

/** Message text from a thrown value, redacted and bounded for reason/log use. */
function boundedError(error) {
  return bounded(error?.message ?? error) ?? 'unknown failure'
}

/** Bounded non-durable audit ring; metadata only, never a credential value. */
export function createCredentialAuditRing({ capacity = CREDENTIAL_AUDIT_CAPACITY, clock = () => new Date() } = {}) {
  const records = []
  let sequence = 0
  let truncated = false
  let gapSince = null

  const stamp = () => {
    try {
      const value = clock()
      return value instanceof Date ? value.toISOString() : String(value)
    } catch {
      return new Date(0).toISOString()
    }
  }

  return Object.freeze({
    record(entry = {}) {
      try {
        const action = entry.action === 'credential.unset' ? 'credential.unset' : 'credential.set'
        const payload = Object.freeze({
          seq: ++sequence,
          at: stamp(),
          ownerId: bounded(entry.ownerId) ?? 'unattributed',
          action,
          ref: bounded(entry.ref) ?? 'unknown',
          outcome: bounded(entry.outcome) ?? 'internal',
          ...(bounded(entry.reason) === undefined ? {} : { reason: bounded(entry.reason) }),
        })
        if (records.length >= capacity) {
          records.shift()
          truncated = true
        }
        records.push(payload)
        return { ok: true, record: payload }
      } catch (error) {
        gapSince = stamp()
        return { ok: false, reason: String(error?.message ?? error) }
      }
    },
    view() {
      return Object.freeze({
        records: Object.freeze(records.map((record) => Object.freeze({ ...record }))),
        truncated,
        gapSince,
      })
    },
    get size() {
      return records.length
    },
  })
}

const frozen = (value) => Object.freeze(value)

const COMMITTED = (ref, revision, persistedAt) => frozen({
  ok: true,
  code: 'committed',
  commitState: 'success',
  ref,
  ...(revision === undefined ? {} : { revision }),
  persistedAt,
})
const UNCHANGED = (ref, revision, reason) => frozen({
  ok: false,
  code: 'unchanged',
  ref,
  ...(revision === undefined ? {} : { revision }),
  reason,
})
const REJECTED = (code, ref, reason, extra = {}) => frozen({
  ok: false,
  code,
  ...(ref === undefined ? {} : { ref }),
  reason,
  ...extra,
})

/** Classify an official write failure into the declared result codes. */
export function classifyWriteFailure(message) {
  const text = typeof message === 'string' ? message : ''
  if (/disposed/i.test(text)) return 'unavailable'
  if (/read-only|shadowed|launching environment/i.test(text)) return 'read-only'
  return 'internal'
}

/**
 * The controlled credential mutation authority. `set`/`unset` are async and
 * never throw across the caller (typed results only); the core-inactive gate is
 * the single typed-throw path, and it is enforced by the facade wrapper.
 */
export function createCredentialMutationAuthority({
  active,
  resolveCredentials,
  resolveOwnerId,
  logger,
  clock = () => new Date(),
  observeAvailable = true,
} = {}) {
  const reportDiagnostics = (message) => {
    try {
      logger?.warn?.(`dsh-plugin-api credentials: ${bounded(message, 240) ?? ''}`)
    } catch {
      // diagnostics never escape the facade path
    }
  }
  const audit = createCredentialAuditRing({ clock })
  const auditRecord = (entry) => {
    const outcome = audit.record(entry)
    if (outcome && outcome.ok === false) {
      reportDiagnostics(`audit record dropped; the credential effect is retained: ${outcome.reason}`)
    }
    return outcome
  }

  /** ref -> monotonic marker, or REVISION_INVALID after a propagation failure. */
  const markers = new Map()
  /** refs with an unsettled official write (per-ref single-flight gate). */
  const inFlight = new Set()
  let current = true

  const gates = () => {
    if (typeof active === 'function' && !active()) throw new PluginApiInactiveError()
  }

  const service = () => {
    try {
      const resolved = resolveCredentials?.()
      return resolved && typeof resolved === 'object' ? resolved : null
    } catch {
      return null
    }
  }
  const writeService = () => {
    const resolved = service()
    if (!resolved || typeof resolved.set !== 'function' || typeof resolved.unset !== 'function') return null
    return resolved
  }

  const observedAt = () => {
    try {
      const value = clock()
      return value instanceof Date ? value.toISOString() : String(value)
    } catch {
      return new Date(0).toISOString()
    }
  }

  const markerOf = (ref) => {
    const marker = markers.get(ref)
    return typeof marker === 'number' ? marker : undefined
  }

  const availability = () => {
    if (!service()) {
      return frozen({ status: 'unavailable', reason: 'the official credentials service is not resolvable' })
    }
    if (!writeService()) {
      return frozen({ status: 'unavailable', reason: 'the official credentials service lacks its set/unset write contract' })
    }
    let observeOk = true
    if (typeof observeAvailable === 'function') {
      try {
        observeOk = observeAvailable() !== false
      } catch {
        observeOk = false
      }
    } else {
      observeOk = observeAvailable !== false
    }
    if (!observeOk) {
      return frozen({ status: 'degraded', reason: 'the official credentials fact stream is unavailable; revision tracking is inactive' })
    }
    return frozen({ status: 'active' })
  }

  /** Read the official describe result without throwing. */
  const describeOf = async (official, ref) => {
    if (typeof official?.describe !== 'function') return { ok: false, reason: 'the official describe member is unavailable' }
    try {
      const described = await official.describe(ref)
      if (!isPlainObject(described)) return { ok: false, reason: 'the official describe result has an unexpected shape' }
      return { ok: true, described }
    } catch (error) {
      return { ok: false, reason: boundedError(error) }
    }
  }

  /** Read the official resolve result without throwing; the value stays host-side. */
  const resolveOf = async (official, ref) => {
    if (typeof official?.resolve !== 'function') return { ok: false }
    try {
      const resolved = await official.resolve(ref)
      if (resolved === undefined) return { ok: true, present: false }
      if (!isPlainObject(resolved)) return { ok: false }
      return { ok: true, present: true, source: resolved.source, value: resolved.value }
    } catch {
      return { ok: false }
    }
  }

  const preflight = async (operation, ref, value, callerCtx) => {
    const official = service()
    if (!official || !writeService()) {
      // The ref has not been validated yet: the result must not echo caller
      // input (secret-shaped or oversized) back to any outlet.
      return { ok: false, result: REJECTED('unavailable', undefined, 'the official credentials write seam is unavailable') }
    }
    const ownerId = (() => {
      try {
        const resolved = resolveOwnerId?.(callerCtx)
        return isNonEmptyString(resolved) ? resolved : undefined
      } catch {
        return undefined
      }
    })()
    if (ownerId === undefined) {
      return { ok: false, result: REJECTED('denied', undefined, 'the caller owner cannot be derived') }
    }
    if (typeof ref !== 'string' || !CREDENTIAL_REF_PATTERN.test(ref)) {
      return { ok: false, result: REJECTED('invalid-input', undefined, 'the credential ref must match the official POSIX identifier pattern') }
    }
    // From here the ref is validated; it still gets bounded before it can
    // appear in a result (the pattern permits arbitrarily long identifiers).
    const safeRef = bounded(ref, 240)
    if (operation === 'set' && (typeof value !== 'string' || value.length === 0)) {
      return { ok: false, result: REJECTED('invalid-input', safeRef, 'a credential value must be a non-empty string; use unset to remove one') }
    }
    if (typeof official.describe !== 'function') {
      return { ok: false, result: REJECTED('unavailable', safeRef, 'the official describe member is unavailable; the backend state cannot be verified') }
    }
    const described = await describeOf(official, ref)
    if (!described.ok) {
      return { ok: false, result: REJECTED('unavailable', safeRef, 'the official backend state cannot be verified') }
    }
    if (described.described.writable === false) {
      return {
        ok: false,
        result: REJECTED('read-only', safeRef, `the ref is supplied read-only by the launching environment (source "${bounded(described.described.source) ?? 'unknown'}"); change it in the shell that starts the host`),
      }
    }
    return { ok: true, ownerId, official, managementSource: described.described.source }
  }

  /**
   * The declared optimistic compare (facade-side simulation) plus the per-ref
   * single-flight gate, executed in one synchronous segment.
   */
  const beginAttempt = (ref, expectedRevision, safeRef) => {
    if (inFlight.has(ref)) {
      return { ok: false, result: REJECTED('conflict', safeRef, 'a racing write for this ref is unsettled') }
    }
    if (expectedRevision !== undefined) {
      if (typeof expectedRevision !== 'number' || !Number.isFinite(expectedRevision)) {
        return { ok: false, result: REJECTED('invalid-input', safeRef, 'expectedRevision must be a finite number') }
      }
      const marker = markers.get(ref)
      if (marker === REVISION_INVALID) {
        return { ok: false, result: REJECTED('revision-unknown', safeRef, 'the revision tracking for this ref is unavailable (fail-closed)') }
      }
      if (typeof marker !== 'number') {
        return { ok: false, result: REJECTED('revision-unknown', safeRef, 'this ref has no observed revision yet (fail-closed)') }
      }
      if (marker !== expectedRevision) {
        return {
          ok: false,
          result: REJECTED('conflict', safeRef, 'the observed revision does not match the current one', {
            expectedRevision,
            currentRevision: marker,
          }),
        }
      }
    }
    inFlight.add(ref)
    return { ok: true }
  }

  const set = async (ref, value, options = {}, callerCtx) => {
    gates()
    const pre = await preflight('set', ref, value, callerCtx)
    if (!pre.ok) {
      auditRecord({ ownerId: pre.ownerId, action: 'credential.set', ref, outcome: pre.result.code, reason: pre.result.reason })
      return pre.result
    }
    const attempt = beginAttempt(ref, isPlainObject(options) ? options.expectedRevision : undefined, bounded(ref, 240))
    if (!attempt.ok) {
      auditRecord({ ownerId: pre.ownerId, action: 'credential.set', ref, outcome: attempt.result.code, reason: attempt.result.reason })
      return attempt.result
    }
    try {
      // Idempotent skip: only a management-layer value that already equals the
      // submission is skipped, and the comparison never leaves the host. The
      // same pre-write reading is the baseline that proves a later commit.
      const stored = await resolveOf(pre.official, ref)
      const alreadyStored = stored.ok && stored.present && stored.source === 'file' && stored.value === value
      if (alreadyStored) {
        return UNCHANGED(bounded(ref, 240), markerOf(ref), 'value already stored')
      }
      auditRecord({ ownerId: pre.ownerId, action: 'credential.set', ref, outcome: 'attempt' })
      try {
        await pre.official.set(ref, value)
      } catch (error) {
        const reason = boundedError(error)
        reportDiagnostics(`set failed for "${bounded(ref) ?? 'unknown'}": ${reason}`)
        const committed = await verifySetCommitted(pre.official, ref, value, alreadyStored)
        if (committed) {
          auditRecord({ ownerId: pre.ownerId, action: 'credential.set', ref, outcome: 'committed', reason: 'the official observer reported an invariant failure after the write committed' })
          return COMMITTED(bounded(ref, 240), markerOf(ref), observedAt())
        }
        const code = classifyWriteFailure(reason)
        auditRecord({ ownerId: pre.ownerId, action: 'credential.set', ref, outcome: code, reason })
        return REJECTED(code, bounded(ref, 240), 'the official credential write failed; the previous value remains in effect')
      }
      auditRecord({ ownerId: pre.ownerId, action: 'credential.set', ref, outcome: 'committed' })
      return COMMITTED(bounded(ref, 240), markerOf(ref), observedAt())
    } finally {
      inFlight.delete(ref)
    }
  }

  const unset = async (ref, options = {}, callerCtx) => {
    gates()
    const pre = await preflight('unset', ref, undefined, callerCtx)
    if (!pre.ok) {
      auditRecord({ ownerId: pre.ownerId, action: 'credential.unset', ref, outcome: pre.result.code, reason: pre.result.reason })
      return pre.result
    }
    const attempt = beginAttempt(ref, isPlainObject(options) ? options.expectedRevision : undefined, bounded(ref, 240))
    if (!attempt.ok) {
      auditRecord({ ownerId: pre.ownerId, action: 'credential.unset', ref, outcome: attempt.result.code, reason: attempt.result.reason })
      return attempt.result
    }
    const heldByManagement = pre.managementSource === 'file'
    try {
      auditRecord({ ownerId: pre.ownerId, action: 'credential.unset', ref, outcome: 'attempt' })
      try {
        await pre.official.unset(ref)
      } catch (error) {
        const reason = boundedError(error)
        reportDiagnostics(`unset failed for "${bounded(ref) ?? 'unknown'}": ${reason}`)
        const removed = await verifyUnsetCommitted(pre.official, ref, heldByManagement)
        if (removed) {
          auditRecord({ ownerId: pre.ownerId, action: 'credential.unset', ref, outcome: 'committed', reason: 'the official observer reported an invariant failure after the write committed' })
          return COMMITTED(bounded(ref, 240), markerOf(ref), observedAt())
        }
        const code = classifyWriteFailure(reason)
        auditRecord({ ownerId: pre.ownerId, action: 'credential.unset', ref, outcome: code, reason })
        return REJECTED(code, bounded(ref, 240), 'the official credential removal failed; the previous value remains in effect')
      }
      if (!heldByManagement) {
        auditRecord({ ownerId: pre.ownerId, action: 'credential.unset', ref, outcome: 'unchanged' })
        return UNCHANGED(bounded(ref, 240), markerOf(ref), 'ref absent from managed storage; nothing to remove')
      }
      auditRecord({ ownerId: pre.ownerId, action: 'credential.unset', ref, outcome: 'committed' })
      return COMMITTED(bounded(ref, 240), markerOf(ref), observedAt())
    } finally {
      inFlight.delete(ref)
    }
  }

  /**
   * Post-reject evidence for set: only the management layer proves a commit,
   * and only when the stored value actually changed to the submission (a value
   * that was already there — e.g. in the `.env` fallback layer — proves
   * nothing about this write).
   */
  const verifySetCommitted = async (official, ref, value, alreadyStored) => {
    if (alreadyStored) return false
    const described = await describeOf(official, ref)
    if (!described.ok || described.described.source !== 'file') return false
    const stored = await resolveOf(official, ref)
    return stored.ok && stored.present && stored.source === 'file' && stored.value === value
  }

  /** Post-reject evidence for unset: the management layer no longer holds it. */
  const verifyUnsetCommitted = async (official, ref, heldByManagement) => {
    const described = await describeOf(official, ref)
    if (!described.ok) return false
    if (!heldByManagement) return false
    return described.described.source !== 'file'
  }

  return frozen({
    availability: () => {
      try {
        return availability()
      } catch {
        return frozen({ status: 'unavailable', reason: 'the credential availability probe failed' })
      }
    },
    set: (ref, value, options, callerCtx) => set(ref, value, options, callerCtx),
    unset: (ref, options, callerCtx) => unset(ref, options, callerCtx),
    /**
     * Official fact ingest: a committed credential change advances (or
     * establishes) the ref's marker. A propagation failure invalidates the
     * marker — a stale known marker would let an outdated expectedRevision
     * "match" and silently overwrite, which the contract forbids.
     */
    observeUpdated(ref) {
      if (!current) return
      if (!isNonEmptyString(ref)) return
      try {
        const marker = markers.get(ref)
        markers.set(ref, typeof marker === 'number' ? marker + 1 : 1)
        return
      } catch (error) {
        reportDiagnostics(`revision propagation failed; the ref marker is invalidated: ${boundedError(error)}`)
      }
      // A stale known marker would let an outdated expectedRevision "match" and
      // silently overwrite: invalidate instead (fail-closed).
      try {
        markers.set(ref, REVISION_INVALID)
      } catch {
        // the table itself is unusable; every compare below fails closed
        markers.clear()
        markers.set(ref, REVISION_INVALID)
      }
    },
    /** Test/verification seam: the current marker state for one ref. */
    revisionOf: (ref) => {
      const marker = markers.get(ref)
      if (marker === REVISION_INVALID) return frozen({ known: false, invalid: true })
      if (typeof marker !== 'number') return frozen({ known: false, invalid: false })
      return frozen({ known: true, invalid: false, revision: marker })
    },
    /** Test/verification seam: force a marker invalidation (propagation failure). */
    invalidateRevision: (ref) => {
      markers.set(ref, REVISION_INVALID)
    },
    audit: () => audit.view(),
    dispose() {
      current = false
      markers.clear()
      inFlight.clear()
    },
    inspection: () => frozen({ refs: markers.size, unsettled: inFlight.size, epoch: current, audit: audit.size }),
  })
}
