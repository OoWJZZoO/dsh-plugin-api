/**
 * `plugin-diagnostics` host owner (`pluginApi.diagnostics`).
 *
 * A facade projection: plugins contribute structured checks through controlled
 * source registration; the host runs/receives check results, maintains frozen
 * committed snapshots per diagnostic scope, and delivers change notifications
 * with observer epochs. The feature NEVER repairs, reloads, automatically
 * mutates profile/session/workspace state or registers any execution/usage
 * policy (retry happens only when a single check declares it retryable).
 *
 * The owner is pure in-process state (no official DSH hooks); it consumes only
 * `coreActive()`/`registry` (the facade's own public feature state) and an
 * OPTIONAL client `publication` seam. All failure paths are contained to the
 * affected check/consumer; the owner never throws through apply.
 */
import { deepFreeze } from './deep-freeze.js'
import {
  classifyReport,
  redactDependencies,
  sanitizeDetail,
  AVAILABILITY_VALUES,
  SCOPE_VALUES,
} from './diagnostics-normalize.js'

/** Reserved host aggregate owner (facade plane evidence). */
const FACADE_OWNER = 'facade'
const FACADE_CHECK = 'plugin-api-facade'
const FACADE_GENERATION = 'facade'
/** Reserved client-scope owner for client-reported availability. */
const CLIENT_OWNER = 'client'
const CLIENT_CHECK = 'availability'
const CLIENT_GENERATION = 'client'

const DEFAULT_PROBE_TIMEOUT_MS = 10_000
const MAX_DECLARED_RETRY_ATTEMPTS = 3
const MAX_STALE_RECORDS = 3

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function canonicalStringify(value) {
  const sort = (v) => {
    if (Array.isArray(v)) return v.map(sort)
    if (isPlainObject(v)) {
      const out = {}
      for (const key of Object.keys(v).sort()) out[key] = sort(v[key])
      return out
    }
    return v
  }
  return JSON.stringify(sort(value))
}

function isAbortError(error) {
  return Boolean(error && typeof error === 'object' && error.name === 'AbortError')
}

function nowIso() {
  return new Date().toISOString()
}

function isEmptyString(value) {
  return typeof value !== 'string' || value.trim() === ''
}

/**
 * @param {object} [options]
 * @param {object} [options.ctx] resident cordis context (kept for parity)
 * @param {object} [options.logger] { warn?, error?, info?, debug? }
 * @param {() => boolean} [options.coreActive] facade core-active predicate
 * @param {object} [options.registry] feature state registry (snapshot())
 * @param {object} [options.publication] optional client publication seam
 * @param {number} [options.probeTimeoutMs] per-attempt probe timeout
 */
export function createDiagnosticsOwner({
  ctx,
  logger,
  coreActive = () => true,
  registry,
  publication,
  probeTimeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
} = {}) {
  /** scope -> ownerId -> checkId -> record */
  const checks = new Map()
  const listeners = new Set()
  const pendingKeys = new Set()
  let ownerDisposed = false
  let flushScheduled = false
  let epochSequence = 0
  let generationSequence = 0
  let clientRecord = null
  let clientReport = null
  let publicationActive = false
  let publicationBrokenReason = null
  let unsubscribeClientReport = null

  const log = (level, message) => {
    try {
      logger?.[level]?.(`dsh-plugin-api diagnostics: ${message}`)
    } catch {
      // diagnostics must never depend on logging
    }
  }

  const recordsOf = (scope) => {
    let owners = checks.get(scope)
    if (!owners) {
      owners = new Map()
      checks.set(scope, owners)
    }
    return owners
  }

  const resolveRecord = (scope, ownerId, checkId) => {
    const owners = checks.get(scope)
    return owners?.get(ownerId)?.get(checkId)
  }

  const recordKey = (record) => `${record.scope}\u0000${record.ownerId}\u0000${record.checkId}`

  const deleteRecord = (record) => {
    if (!record) return
    const owners = checks.get(record.scope)
    const byId = owners?.get(record.ownerId)
    byId?.delete(record.checkId)
    if (byId && byId.size === 0) owners.delete(record.ownerId)
    if (owners && owners.size === 0) checks.delete(record.scope)
  }

  const noteStale = (record, kind, detail) => {
    const list = record.stale ?? []
    list.push({ kind, detail: sanitizeDetail(detail) })
    if (list.length > MAX_STALE_RECORDS) list.shift()
    record.stale = list
  }

  /** Deterministic no-op check: equal content commits share a fingerprint. */
  const fingerprintOf = (record, report) =>
    canonicalStringify({
      scope: record.scope,
      ownerId: record.ownerId,
      checkId: record.checkId,
      generation: record.generation,
      dependencies: record.dependencies,
      ...report,
    })

  const stampTimestamps = (record, stamped) => {
    const first = record.committed?.firstObservedAt ?? stamped
    return { first, last: stamped }
  }

  const commit = (record, report) => {
    if (ownerDisposed || record.disposed) return false
    const fingerprint = fingerprintOf(record, report)
    if (record.fingerprint === fingerprint) return false
    const stamped = nowIso()
    const { first, last } = stampTimestamps(record, stamped)
    const snapshot = {
      scope: record.scope,
      ownerId: record.ownerId,
      checkId: record.checkId,
      health: report.health,
      availability: report.availability,
      severity: report.severity,
      blocking: report.blocking,
      generation: record.generation,
      firstObservedAt: first,
      lastUpdatedAt: last,
      uncertainty: report.uncertainty ?? 'unavailable',
    }
    if (record.dependencies !== undefined) snapshot.dependencies = record.dependencies
    if (report.evidence !== undefined) snapshot.evidence = report.evidence
    if (report.reason !== undefined) snapshot.reason = report.reason
    if (report.remediation !== undefined) snapshot.remediation = report.remediation
    record.committed = deepFreeze(snapshot)
    record.fingerprint = fingerprint
    scheduleNotify(record)
    return true
  }

  const scheduleNotify = (record) => {
    if (ownerDisposed) return
    pendingKeys.add(recordKey(record))
    if (!flushScheduled) {
      flushScheduled = true
      queueMicrotask(flush)
    }
  }

  const aggregateState = (snapshots) => {
    if (!snapshots?.length) return 'unknown'
    if (snapshots.some((item) => item.health === 'failed')) return 'failed'
    if (snapshots.some((item) => ['degraded', 'pending', 'unknown'].includes(item.health))) return 'degraded'
    return 'healthy'
  }

  const flush = () => {
    if (ownerDisposed) return
    flushScheduled = false
    if (pendingKeys.size === 0) return
    const keys = [...pendingKeys]
    pendingKeys.clear()
    let changed = false
    for (const key of keys) {
      const [scope, ownerId, checkId] = key.split('\u0000')
      const record = resolveRecord(scope, ownerId, checkId)
      if (!record?.committed || !record.fingerprint) continue
      changed = true
      for (const sub of listeners) {
        if (sub.lastFingerprint === record.fingerprint) continue
        if (sub.scope != null && sub.scope !== record.scope) continue
        if (sub.ownerId != null && sub.ownerId !== record.ownerId) continue
        sub.lastFingerprint = record.fingerprint
        try {
          sub.listener({ snapshot: record.committed, observerEpoch: sub.epoch })
        } catch (error) {
          log('warn', `listener failed: ${error?.message ?? error}`)
        }
      }
    }
    if (changed) publishClientSnapshot()
  }

  /* ----------------------------- probe machinery ----------------------------- */

  const commitState = (record, report) => {
    commit(record, report)
  }

  const finalizeProbe = (record, kind, payload) => {
    if (ownerDisposed || record.disposed || record.finalized) return
    record.finalized = true
    if (kind === 'ok') {
      commitState(record, payload)
    } else if (kind === 'no-result') {
      commitState(record, {
        health: 'unknown',
        availability: 'unavailable',
        severity: 'info',
        blocking: 'unknown',
        uncertainty: 'unavailable',
        reason: { code: 'no-result' },
      })
    } else if (kind === 'invalid') {
      commitState(record, {
        health: 'failed',
        availability: 'unavailable',
        severity: 'error',
        blocking: 'unknown',
        uncertainty: 'unavailable',
        reason: { code: 'invalid-result' },
      })
    } else if (kind === 'aborted') {
      commitState(record, {
        health: 'unknown',
        availability: 'unavailable',
        severity: 'info',
        blocking: 'unknown',
        uncertainty: 'unavailable',
        reason: { code: 'aborted' },
      })
    } else if (kind === 'failure') {
      commitState(record, {
        health: 'failed',
        availability: 'unavailable',
        severity: 'error',
        blocking: 'unknown',
        uncertainty: 'unavailable',
        reason: { code: payload },
      })
    }
  }

  const startProbe = (record) => {
    const maxAttempts = record.retryDeclared
      ? Math.min(MAX_DECLARED_RETRY_ATTEMPTS, Math.max(1, record.maxAttempts ?? 2))
      : 1
    let attempts = 0

    const settleValue = (value) => {
      if (value === undefined || value === null) {
        finalizeProbe(record, 'no-result')
        return
      }
      const classified = classifyReport(value)
      if (classified.invalid) finalizeProbe(record, 'invalid')
      else finalizeProbe(record, 'ok', classified.report)
    }

    const settleError = (error) => {
      if (isAbortError(error)) {
        // Cancellation is provenance, never a healthy result.
        noteStale(record, 'aborted', 'probe aborted')
        finalizeProbe(record, 'aborted')
        return
      }
      if (record.retryDeclared && attempts < maxAttempts) {
        runOnce()
        return
      }
      finalizeProbe(record, 'failure', 'probe-failed')
    }

    const settleTimeout = () => {
      if (record.retryDeclared && attempts < maxAttempts) {
        runOnce()
        return
      }
      finalizeProbe(record, 'failure', 'probe-timeout')
    }

    function runOnce() {
      if (ownerDisposed || record.disposed || record.finalized) return
      attempts += 1
      let finished = false
      const finish = (fn, arg) => {
        if (finished) return
        finished = true
        clearTimeout(timeout)
        fn(arg)
      }
      const timeout = setTimeout(() => {
        if (!finished) {
          finished = true
          settleTimeout()
        }
      }, probeTimeoutMs)

      let result
      try {
        result = record.run({ signal: record.controller.signal, generation: record.generation })
      } catch (error) {
        clearTimeout(timeout)
        if (!finished) {
          finished = true
          settleError(error)
        }
        return
      }

      if (result && typeof result.then === 'function') {
        result.then(
          (value) => finish(settleValue, value),
          (error) => finish(settleError, error),
        )
      } else {
        finish(settleValue, result)
      }
    }

    runOnce()
  }

  /* -------------------------- facade host aggregate -------------------------- */

  const buildFacadeAggregate = () => {
    const coreOk = Boolean(coreActive())
    let features = []
    try {
      if (typeof registry?.snapshot === 'function') features = registry.snapshot()
    } catch {
      features = []
    }
    const disabled = features.filter((entry) => entry.isActive !== true)
    const snapshot = {
      scope: 'host',
      ownerId: FACADE_OWNER,
      checkId: FACADE_CHECK,
      health: coreOk ? 'healthy' : 'failed',
      availability: coreOk ? 'active' : 'unavailable',
      severity: coreOk ? 'info' : 'critical',
      blocking: coreOk ? 'non-blocking' : 'blocking',
      generation: FACADE_GENERATION,
      lastUpdatedAt: nowIso(),
      uncertainty: 'observed',
      evidence: { capability: FACADE_CHECK },
    }
    if (disabled.length > 0) {
      snapshot.reason = {
        code: 'capability-unavailable',
        boundedDetail: sanitizeDetail(disabled.map((entry) => `${entry.name}:${entry.reason ?? 'inactive'}`).join('; ')),
      }
    }
    return snapshot
  }

  /* ---------------------------- client publication --------------------------- */

  const buildClientAvailability = () => {
    if (!publicationActive || publicationBrokenReason) return 'unavailable'
    return clientReport?.availability ?? 'unknown'
  }

  const handleClientReport = (info) => {
    if (ownerDisposed) return
    if (!isPlainObject(info) || !AVAILABILITY_VALUES.includes(info.availability)) {
      log('warn', 'unsupported client availability report ignored')
      return
    }
    clientReport = { availability: info.availability }
    const report = {
      health: 'unknown',
      availability: info.availability,
      severity: 'info',
      blocking: 'unknown',
      uncertainty: 'unavailable',
    }
    if (clientRecord) {
      commit(clientRecord, report)
    } else {
      clientRecord = {
        scope: 'client',
        ownerId: CLIENT_OWNER,
        checkId: CLIENT_CHECK,
        generation: CLIENT_GENERATION,
        dependencies: undefined,
        retryDeclared: false,
        maxAttempts: 1,
        run: null,
        controller: new AbortController(),
        disposed: false,
        finalized: true,
        committed: null,
        fingerprint: null,
        stale: [],
      }
      const byId = recordsOf('client').get(CLIENT_OWNER) ?? new Map()
      byId.set(CLIENT_CHECK, clientRecord)
      recordsOf('client').set(CLIENT_OWNER, byId)
      commit(clientRecord, report)
    }
  }

  const buildClientPayload = () => ({
    version: 1,
    scope: 'client',
    clientAvailability: buildClientAvailability(),
    // The client consumes the host snapshot (requirements: client is a
    // read-only host-snapshot consumer); its own availability is separate.
    snapshot: get({ scope: 'host', audience: 'consumer' }),
  })

  const publishClientSnapshot = () => {
    if (ownerDisposed || !publicationActive || publicationBrokenReason) return
    try {
      publication.publish(deepFreeze(buildClientPayload()))
    } catch (error) {
      publicationBrokenReason = 'publication-failed'
      log('warn', `client publication failed: ${error?.message ?? error}`)
    }
  }

  /* ------------------------------- public API -------------------------------- */

  /**
   * Contribute one diagnostic check. Same `(ownerId, checkId, scope)` re-registers
   * deterministic latest-wins for THIS owner only; another owner's check is never
   * touched. Returns an idempotent, identity-bound disposer.
   */
  const register = ({ ownerId, checkId, scope, dependencies, retry = {}, run } = {}) => {
    if (isEmptyString(ownerId) || isEmptyString(checkId)) {
      throw new TypeError('diagnostics.register requires non-empty ownerId and checkId')
    }
    if (typeof run !== 'function') throw new TypeError('diagnostics.register requires a run function')
    if (!SCOPE_VALUES.includes(scope)) {
      throw new TypeError(`diagnostics.register scope must be one of: ${SCOPE_VALUES.join(', ')}`)
    }
    const retryDeclared = retry.declared === true
    const maxAttempts = typeof retry.maxAttempts === 'number' && Number.isFinite(retry.maxAttempts)
      ? Math.floor(retry.maxAttempts)
      : 2

    // Deterministic latest-wins: replace only this owner's prior generation.
    const prior = resolveRecord(scope, ownerId, checkId)
    if (prior) {
      prior.disposed = true
      try {
        prior.controller.abort()
      } catch {
        // abort must never break registration
      }
      noteStale(prior, 'superseded', 'replaced by a newer generation of the same owner')
      log('info', `duplicate check replaced for owner "${ownerId}" check "${checkId}" (latest-wins)`)
    }

    const record = {
      scope,
      ownerId,
      checkId,
      generation: `g-${++generationSequence}`,
      controller: new AbortController(),
      retryDeclared,
      maxAttempts,
      dependencies: redactDependencies(dependencies),
      run,
      disposed: false,
      finalized: false,
      committed: null,
      fingerprint: null,
      stale: [],
    }
    const byId = recordsOf(scope).get(ownerId) ?? new Map()
    byId.set(checkId, record)
    recordsOf(scope).set(ownerId, byId)

    // A registration is immediately observable as pending, never as healthy.
    commitState(record, {
      health: 'pending',
      availability: 'unknown',
      severity: 'info',
      blocking: 'unknown',
      uncertainty: 'unavailable',
      reason: { code: 'pending' },
    })
    startProbe(record)

    let disposed = false
    /** Idempotent + identity-bound: removes only the caller's current generation. */
    const disposer = () => {
      if (disposed || record.disposed) return false
      if (resolveRecord(scope, ownerId, checkId) !== record) return false
      disposed = true
      record.disposed = true
      try {
        record.controller.abort()
      } catch {
        // abort must never break disposal
      }
      deleteRecord(record)
      return true
    }
    return disposer
  }

  /** `consumer` audience drops internal diagnostic detail (not secrets). */
  const projectForAudience = (snapshot, audience) => {
    if (audience !== 'consumer') return snapshot
    const copy = { ...snapshot }
    delete copy.evidence
    delete copy.remediation
    if (isPlainObject(copy.reason)) copy.reason = { code: copy.reason.code }
    if (Array.isArray(copy.dependencies)) {
      copy.dependencies = copy.dependencies.map((dep) => ({ id: dep.id, status: dep.status }))
    }
    return copy
  }

  /**
   * Return committed frozen snapshots for a scope (+ optional ownerId filter),
   * with a scope-level aggregate state. Empty/invalid scopes return explicit
   * `unknown`, never a healthy claim.
   */
  const get = ({ scope, ownerId, audience } = {}) => {
    const owners = checks.get(scope)
    const snapshots = []
    if (owners) {
      for (const [candidateOwner, byId] of owners) {
        if (ownerId != null && candidateOwner !== ownerId) continue
        for (const record of byId.values()) {
          if (record.committed) snapshots.push(record.committed)
        }
      }
    }
    if (scope === 'host' && (ownerId == null || ownerId === FACADE_OWNER)) {
      snapshots.push(deepFreeze(buildFacadeAggregate()))
    }
    snapshots.sort((left, right) => {
      const byOwner = left.ownerId.localeCompare(right.ownerId)
      return byOwner !== 0 ? byOwner : left.checkId.localeCompare(right.checkId)
    })
    const projected = snapshots.map((snapshot) => projectForAudience(snapshot, audience))
    return deepFreeze({ scope, checks: projected, state: aggregateState(snapshots) })
  }

  /**
   * Subscribe to per-check change notifications. Each subscription carries its
   * own observer epoch (delivery metadata, never merged into the snapshot).
   * Returns an idempotent disposer that removes only this listener.
   */
  const onChange = ({ scope, ownerId }, listener) => {
    if (typeof listener !== 'function') throw new TypeError('diagnostics.onChange requires a listener function')
    if (scope != null && !SCOPE_VALUES.includes(scope)) {
      throw new TypeError(`diagnostics.onChange scope must be one of: ${SCOPE_VALUES.join(', ')}`)
    }
    const sub = { scope, ownerId, listener, epoch: `e-${++epochSequence}`, lastFingerprint: null }
    listeners.add(sub)
    let removed = false
    const disposer = () => {
      if (removed) return false
      removed = true
      return listeners.delete(sub)
    }
    return disposer
  }

  /** Dispose the whole owner: abort probes, drop client wiring, stop publishes. */
  const dispose = () => {
    if (ownerDisposed) return
    ownerDisposed = true
    for (const owners of checks.values()) {
      for (const byId of owners.values()) {
        for (const record of byId.values()) {
          record.disposed = true
          try {
            record.controller.abort()
          } catch {
            // abort must never break disposal
          }
        }
      }
    }
    if (typeof unsubscribeClientReport === 'function') {
      try {
        unsubscribeClientReport()
      } catch {
        // client wiring cleanup must never throw through dispose
      }
      unsubscribeClientReport = null
    }
    listeners.clear()
    pendingKeys.clear()
  }

  /* --------------------------- mount-time client wiring ---------------------- */

  if (publication && typeof publication === 'object') {
    let available = false
    try {
      available = Boolean(publication.available?.())
    } catch {
      available = false
    }
    if (available) {
      publicationActive = true
      if (typeof publication.onClientReport === 'function') {
        try {
          unsubscribeClientReport = publication.onClientReport((info) => handleClientReport(info)) ?? null
        } catch {
          unsubscribeClientReport = null
        }
      }
      publishClientSnapshot()
    } else {
      publicationBrokenReason = 'publication-unavailable'
    }
  } else {
    publicationBrokenReason = 'no-publication-channel'
  }

  return {
    api: Object.freeze({ register, get, onChange }),
    dispose,
  }
}
