/**
 * Selection facade (host face): read the official selection, disclose its
 * source tier, and submit a switch through the single official seam.
 *
 * Both calls go through the audited apiProxy whitelist's two narrow
 * operations; the facade never keeps a second copy of the value. A caller-side
 * compare-and-set compares the caller's observed snapshot against the official
 * current value *before* submitting, so a write made through the official path
 * (the browser UI, another plugin) produces a typed conflict instead of a
 * silent last-write-wins. The official seam itself has no atomic
 * compare-and-swap, so a write racing inside that window follows official
 * semantics — that residual race is declared, not hidden.
 */
import { createSelectionRouteHandler, installClientRequestRoute } from './client-request-bridge.js'
import { callerIdentityOf } from './profile-mutation.js'
import {
  buildConflictOutcome,
  buildSelectionAvailability,
  buildSelectionView,
  inferSelectionSource,
  mapSelectionFailure,
  mintMuxRequestId,
  normalizeOfficialSelection,
  selectionMatches,
  validateSelectionSet,
} from './sessions-selection.js'

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isoNow(now) {
  try {
    const value = now()
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
  } catch {
    return new Date().toISOString()
  }
}

/**
 * Create the selection authority.
 *
 * @param {object} options
 * @param {object} [options.ctx]
 * @param {(sessionId: string) => object | undefined} [options.readModels]
 *   The official read seam (`apiProxy.sessionsModels`); absent means the feature
 *   reports typed unavailable and never fabricates a selection.
 * @param {(payload: object) => object | undefined} [options.submitSelection]
 *   The official submit seam (`apiProxy.sessionsSelectModel`).
 * @param {(sessionId: string) => object | undefined} [options.loggedConfigOf]
 *   The session's latest logged request config (a fallback tier of the
 *   official precedence), used only to disclose which tier the value came from.
 * @param {() => object | undefined} [options.deploymentDefaultOf]
 * @param {() => Date} [options.now]
 */
export function createSelectionAuthority(options = {}) {
  const ctx = options.ctx
  const readModels = typeof options.readModels === 'function' ? options.readModels : null
  const submitSelection = typeof options.submitSelection === 'function' ? options.submitSelection : null
  const loggedConfigOf = options.loggedConfigOf ?? (() => undefined)
  const deploymentDefaultOf = options.deploymentDefaultOf ?? (() => undefined)
  const now = options.now ?? (() => new Date())

  const revisions = new Map()
  const commitTimes = new Map()
  const auditRing = []
  const auditLimit = options.auditLimit ?? 200
  let gapCount = 0
  let disposed = false

  const log = (message) => {
    try {
      ctx?.logger?.warn?.(`dsh-plugin-api sessions.selection: ${message}`)
    } catch {
      // diagnostics are best-effort
    }
  }

  const recordAudit = (entry) => {
    try {
      auditRing.push(Object.freeze({ at: isoNow(now), ...entry }))
      if (auditRing.length > auditLimit) auditRing.shift()
      return true
    } catch {
      gapCount += 1
      return false
    }
  }

  const available = () => !disposed && typeof readModels === 'function'
  const submittable = () => !disposed && typeof submitSelection === 'function'

  const availability = () => {
    try {
      if (disposed) return buildSelectionAvailability({ status: 'unavailable', reason: 'the selection authority is disposed' })
      if (!available()) return buildSelectionAvailability({ status: 'unavailable', reason: 'the official selection read seam is not available in this installation' })
      if (!submittable()) return buildSelectionAvailability({ status: 'degraded', reason: 'the official selection submit seam is not available; reads remain available' })
      return buildSelectionAvailability({ status: 'active' })
    } catch {
      return buildSelectionAvailability({ status: 'unavailable', reason: 'availability probe failed' })
    }
  }

  /** Read the official current selection plus its observable tier evidence. */
  const readCurrent = (sessionId) => {
    let result
    try {
      result = readModels(sessionId)
    } catch (error) {
      log(`selection read failed: ${error?.name ?? 'Error'}`)
      return { ok: false, code: 'unavailable', reason: 'the official selection read seam threw' }
    }
    if (!isPlainObject(result) || !isPlainObject(result.result)) {
      return { ok: false, code: 'unavailable', reason: 'the official selection read answered a malformed result' }
    }
    if (result.result.ok !== true) {
      return mapSelectionFailure(result.result.error)
    }
    const current = normalizeOfficialSelection(result.result.value?.current)
    if (current === null) {
      return { ok: false, code: 'unavailable', reason: 'the official selection read carried no usable current value' }
    }
    let loggedConfig
    try {
      loggedConfig = normalizeOfficialSelection(loggedConfigOf(sessionId))
    } catch {
      loggedConfig = null
    }
    let deploymentDefault
    try {
      deploymentDefault = normalizeOfficialSelection(deploymentDefaultOf())
    } catch {
      deploymentDefault = null
    }
    return { ok: true, current, source: inferSelectionSource({ current, loggedConfig, deploymentDefault }) }
  }

  const get = (input, callerCtx) => {
    const owner = callerIdentityOf(callerCtx)
    const sessionId = isPlainObject(input) ? input.sessionId : undefined
    if (typeof sessionId !== 'string' || sessionId === '') {
      return Object.freeze({ ok: false, code: 'rejected', reason: 'sessionId must be a non-empty string' })
    }
    if (disposed) return Object.freeze({ ok: false, code: 'unavailable', reason: 'the selection authority is disposed' })
    if (!available()) return Object.freeze({ ok: false, code: 'unavailable', reason: 'the official selection read seam is not available in this installation' })
    const read = readCurrent(sessionId)
    if (read.ok !== true) {
      recordAudit({ owner, sessionId, outcome: read.code, detail: 'read failed' })
      return Object.freeze({ ok: false, code: read.code, reason: read.reason })
    }
    recordAudit({ owner, sessionId, outcome: 'read', source: read.source })
    return Object.freeze({
      ok: true,
      view: buildSelectionView({
        sessionId,
        current: read.current,
        source: read.source,
        revision: revisions.get(sessionId) ?? 0,
        committedAt: commitTimes.get(sessionId),
        observedAt: isoNow(now),
      }),
    })
  }

  const set = (input, callerCtx) => {
    const owner = callerIdentityOf(callerCtx)
    const validation = validateSelectionSet(input)
    if (validation.ok !== true) return Object.freeze({ ok: false, code: 'rejected', reason: validation.reason })
    const value = validation.value
    if (disposed) return Object.freeze({ ok: false, code: 'unavailable', reason: 'the selection authority is disposed' })
    if (!available()) return Object.freeze({ ok: false, code: 'unavailable', reason: 'the official selection read seam is not available in this installation' })
    if (!submittable()) return Object.freeze({ ok: false, code: 'unavailable', reason: 'the official selection submit seam is not available in this installation' })
    if (value.signal?.aborted === true) return Object.freeze({ ok: false, code: 'unavailable', reason: 'the submission was aborted before it started' })

    const read = readCurrent(value.sessionId)
    if (read.ok !== true) return Object.freeze({ ok: false, code: read.code, reason: read.reason })
    if (value.expected !== undefined && !selectionMatches(value.expected, read.current)) {
      recordAudit({ owner, sessionId: value.sessionId, outcome: 'conflict', detail: 'expected snapshot no longer matches' })
      return buildConflictOutcome(read.current)
    }

    // A partial selection means "change these fields": the official seam needs
    // a complete provider/model pair, so the caller's fields are layered over
    // the official current value. Nothing is invented — a field the current
    // value cannot supply refuses the call instead of guessing one.
    // `readCurrent` only answers with a complete provider/model pair, so the
    // completion below always has the pair the official seam requires.
    const effective = {
      provider: value.selection.provider ?? read.current.provider,
      model: value.selection.model ?? read.current.model,
      effort: value.selection.effort ?? read.current.effort,
    }

    let result
    try {
      result = submitSelection({
        sessionId: value.sessionId,
        selection: effective,
        rpcId: mintMuxRequestId(),
      })
    } catch (error) {
      log(`selection submit failed: ${error?.name ?? 'Error'}`)
      return Object.freeze({ ok: false, code: 'unavailable', reason: 'the official selection submit seam threw' })
    }
    if (!isPlainObject(result) || !isPlainObject(result.result)) {
      return Object.freeze({ ok: false, code: 'unavailable', reason: 'the official selection submit answered a malformed result' })
    }
    if (result.result.ok !== true) {
      const mapped = mapSelectionFailure(result.result.error)
      recordAudit({ owner, sessionId: value.sessionId, outcome: mapped.code, detail: 'submit refused' })
      return Object.freeze({ ok: false, code: mapped.code, reason: mapped.reason })
    }
    const selected = normalizeOfficialSelection(result.result.value?.selected)
    if (selected === null) {
      return Object.freeze({ ok: false, code: 'unavailable', reason: 'the official selection submit carried no usable selected value' })
    }
    // Confirm by re-reading the official current value: the disclosure then
    // describes what the authority actually holds after the submit.
    const confirmation = readCurrent(value.sessionId)
    const revision = (revisions.get(value.sessionId) ?? 0) + 1
    revisions.set(value.sessionId, revision)
    const observedAt = isoNow(now)
    commitTimes.set(value.sessionId, observedAt)
    recordAudit({ owner, sessionId: value.sessionId, outcome: 'committed', revision })
    return Object.freeze({
      ok: true,
      code: 'committed',
      revision,
      view: buildSelectionView({
        sessionId: value.sessionId,
        current: confirmation.ok === true ? confirmation.current : selected,
        source: confirmation.ok === true ? confirmation.source : 'committed',
        revision,
        committedAt: observedAt,
        observedAt,
      }),
    })
  }

  const dispose = () => {
    disposed = true
    revisions.clear()
    commitTimes.clear()
  }

  const internalAudit = () => Object.freeze({ records: Object.freeze([...auditRing]), gapCount, truncated: auditRing.length >= auditLimit })

  return Object.freeze({ get, set, availability, dispose, readCurrent, internalAudit })
}

/**
 * Mount the selection members.
 *
 * @returns {{surface: object, dispose: () => void}}
 */
export function mountSelectionFeature({ ctx, authority } = {}) {
  const surface = Object.freeze({
    get: (input, callerCtx) => authority.get(input, callerCtx),
    set: (input, callerCtx) => authority.set(input, callerCtx),
    availability: () => authority.availability(),
  })
  const dispose = () => {
    try {
      authority.dispose()
    } catch {
      // disposal is best-effort
    }
  }
  void ctx
  return { surface, dispose }
}

/**
 * Mount the selection feature onto the main facade.
 *
 * The two official seams are addressed through the audited apiProxy
 * whitelist's narrow deep members; when an installation's apiProxy does not
 * carry them the feature degrades typed (reads unavailable, or reads-only when
 * only the submit seam is missing) without touching the rest of the facade.
 */
export function mountSessionsSelectionFeature({ ctx, service, featureRegistry, logger } = {}) {
  if (typeof featureRegistry?.isActive === 'function' && featureRegistry.isActive('sessionSelection')) {
    return { disposer: () => {}, prepared: null }
  }
  const apiProxy = () => {
    try {
      return ctx?.get?.('apiProxy')
    } catch {
      return undefined
    }
  }
  // The official ApiProxyService exposes the selection operations on its
  // `sessions` bus (`sessions.models` / `sessions.selectModel`), which is the
  // shape the audited apiProxy whitelist's two path-addressed members forward.
  // The mounter consumes that official shape directly; when an installation
  // does not carry the member the seam is left absent so the authority reports
  // honest typed degradation instead of a function that always fails.
  const officialSeam = (leaf) => {
    const service = apiProxy()
    const owner = service?.sessions
    const seam = owner?.[leaf]
    return typeof seam === 'function' ? seam.bind(owner) : null
  }
  const modelsSeam = officialSeam('models')
  const selectSeam = officialSeam('selectModel')
  const readModels = modelsSeam === null
    ? undefined
    : (sessionId) => modelsSeam({ rpcId: mintMuxRequestId(), payload: { sessionId } })
  const submitSelection = selectSeam === null
    ? undefined
    : ({ sessionId, selection, rpcId }) => selectSeam({
      rpcId,
      payload: {
        sessionId,
        provider: selection.provider,
        model: selection.model,
        ...(selection.effort === undefined || selection.effort === null ? {} : { reasoningEffort: selection.effort }),
      },
    })
  // The two observable fallback tiers of the official precedence, read only to
  // disclose where the effective value came from.
  const loggedConfigOf = (sessionId) => {
    try {
      const sessions = ctx?.get?.('sessions')
      const session = typeof sessions?.get === 'function' ? sessions.get(sessionId) : undefined
      const header = session?.requestHeader?.()
      return header?.config
    } catch {
      return undefined
    }
  }
  const deploymentDefaultOf = () => {
    try {
      const defaults = ctx?.get?.('agentDefaultModel')
      return typeof defaults?.currentSelection === 'function' ? defaults.currentSelection() : undefined
    } catch {
      return undefined
    }
  }
  const authority = createSelectionAuthority({ ctx, readModels, submitSelection, loggedConfigOf, deploymentDefaultOf, now: () => new Date() })
  const ownerApi = {
    surfaceFor: () => mountedSurface,
    availability: () => {
      try {
        return authority.availability()
      } catch {
        return buildSelectionAvailability({ status: 'unavailable', reason: 'the selection availability probe failed' })
      }
    },
  }
  const mountedSurface = Object.freeze({
    get: (input, callerCtx) => authority.get(input, callerCtx),
    set: (input, callerCtx) => authority.set(input, callerCtx),
    availability: () => authority.availability(),
  })
  const route = installClientRequestRoute({
    ctx,
    path: '/plugin-api/sessions/selection',
    handler: createSelectionRouteHandler({ selection: mountedSurface, ctx }),
    logger,
  })
  let prepared
  try {
    prepared = service.prepareFeature('sessionSelection', ownerApi)
  } catch (error) {
    try {
      logger?.warn?.(`dsh-plugin-api: sessions.selection could not be prepared: ${error?.message ?? error}`)
    } catch {
      // diagnostics must never escape the fail-safe mount path
    }
    route.dispose()
    authority.dispose()
    return null
  }
  return {
    disposer: () => {
      route.dispose()
      authority.dispose()
    },
    prepared,
  }
}
