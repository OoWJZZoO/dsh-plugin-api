import { PluginApiInactiveError } from './errors.js'
import { redactValue } from './diagnostics-normalize.js'

/**
 * Controlled permission-preset selection face (`sessions.permissionPresets`),
 * core module.
 *
 * The official `permissionPresets` service owns the state: a selection appends
 * the durable `permission/preset` fact and writes the changed knobs through
 * their canonical setters, and the effective preset is folded back from those
 * events. This module never keeps a second authority — it maps the official
 * write onto a frozen discriminated result, projects the official read and the
 * official `permissions` projection, and derives the change feed from the
 * official `session/event` facts with a verifying re-read.
 *
 * Result mapping (frozen):
 *   before !== name && after === name  -> ok:true  code:'committed' commitState:'success'
 *   before === name                    -> ok:false code:'unchanged' (the idempotent repeat)
 *   after !== name                     -> ok:false code:'not-applied' (the official state
 *                                         cannot evidence the change: never a fake success)
 *   refusals                           -> invalid-input / unavailable / denied /
 *                                         invalid-target / invalid-preset / unknown-preset
 *   official throw                     -> internal
 */

export const PERMISSION_PRESET_AUDIT_CAPACITY = 512
export const CUSTOM_PRESET_NAME = 'custom'

/** The durable knob facts that fold into the effective preset. */
export const KNOB_EVENT_TYPES = new Set(['permission/preset', 'sandbox/mode', 'approval/policy'])

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

/**
 * Bounded non-durable audit ring (authority-internal; no public query member).
 * Overflow drops the oldest record and sets `truncated`; a write failure sets
 * `gapSince` and never fabricates a record (the selection effect is retained).
 */
export function createPermissionPresetAuditRing({ capacity = PERMISSION_PRESET_AUDIT_CAPACITY, clock = () => new Date() } = {}) {
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
        const payload = Object.freeze({
          seq: ++sequence,
          at: stamp(),
          ownerId: bounded(entry.ownerId) ?? 'unattributed',
          action: 'permission-preset.select',
          target: bounded(entry.target) ?? 'unknown',
          preset: bounded(entry.preset) ?? 'unknown',
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

/** Frozen discriminative result for one selection attempt. */
export function mapSelectResult({ before, after, requested, appliedAt } = {}) {
  if (before !== requested && after === requested) {
    return Object.freeze({
      ok: true,
      code: 'committed',
      commitState: 'success',
      preset: requested,
      appliedAt,
    })
  }
  if (before === requested) {
    return Object.freeze({
      ok: false,
      code: 'unchanged',
      preset: requested,
      reason: 'the requested preset is already effective',
    })
  }
  return Object.freeze({
    ok: false,
    code: 'not-applied',
    preset: requested,
    reason: 'the official selection state cannot evidence the requested change',
  })
}

function unavailableView(reason) {
  return Object.freeze({
    target: null,
    preset: null,
    observedAt: null,
    source: 'unavailable',
    reason,
  })
}

function degradedPresetView(target, reason) {
  return Object.freeze({
    target,
    preset: null,
    observedAt: null,
    source: 'degraded',
    reason,
  })
}

function unavailableOptionsView(reason) {
  return Object.freeze({
    target: null,
    options: Object.freeze([]),
    currentValue: null,
    observedAt: null,
    source: 'unavailable',
    reason,
  })
}

function degradedOptionsView(target, reason) {
  return Object.freeze({
    target,
    options: Object.freeze([]),
    currentValue: null,
    observedAt: null,
    source: 'degraded',
    reason,
  })
}

/** Normalize the official option table into a frozen, bounded view. */
function optionsOf(raw, maxDescription = 240) {
  if (!Array.isArray(raw)) return null
  const options = []
  for (const entry of raw) {
    if (!isPlainObject(entry) || !isNonEmptyString(entry.value) || !isNonEmptyString(entry.name)) return null
    options.push(Object.freeze({
      value: entry.value,
      name: entry.name,
      ...(isNonEmptyString(entry.description) ? { description: bounded(entry.description, maxDescription) } : {}),
    }))
  }
  return Object.freeze(options)
}

function availabilityOf(service, observeAvailable, optionsAvailable) {
  if (!service) {
    return Object.freeze({ status: 'unavailable', reason: 'the official permission-presets service is not resolvable' })
  }
  if (typeof service.current !== 'function' || typeof service.set !== 'function') {
    return Object.freeze({ status: 'unavailable', reason: 'the official permission-presets service lacks its current/set contract' })
  }
  // Both substrates default to available; a probe (function) or a literal
  // boolean may report them, and the reasons stay exhaustive.
  const resolveFlag = (value) => {
    if (typeof value === 'function') {
      try {
        return value() !== false
      } catch {
        return false
      }
    }
    return value !== false
  }
  const observeOk = resolveFlag(observeAvailable)
  const optionsOk = resolveFlag(optionsAvailable)
  if (!observeOk || !optionsOk) {
    const parts = []
    if (!optionsOk) parts.push('the permissions projection carrier is unavailable; options degrade')
    if (!observeOk) parts.push('the session fact stream is unavailable; observation is inactive')
    return Object.freeze({ status: 'degraded', reason: parts.join('; ') })
  }
  return Object.freeze({ status: 'active' })
}

/**
 * The controlled permission-preset authority. `select`/`current`/`options`/
 * `observe` never throw across the caller (typed results/views only); the
 * core-inactive gate is the single typed-throw path, and it is enforced by the
 * facade wrapper.
 */
export function createPermissionPresetAuthority({
  active,
  resolvePresets,
  resolveSnapshot,
  resolveTargetPresence,
  resolveOwnerId,
  logger,
  clock = () => new Date(),
  observeAvailable = true,
  optionsAvailable = true,
} = {}) {
  const reportDiagnostics = (message) => {
    try {
      logger?.warn?.(`dsh-plugin-api sessions.permissionPresets: ${bounded(message, 240) ?? ''}`)
    } catch {
      // diagnostics never escape the facade path
    }
  }
  const audit = createPermissionPresetAuditRing({ clock })
  const auditRecord = (entry) => {
    const outcome = audit.record(entry)
    if (outcome && outcome.ok === false) {
      reportDiagnostics(`audit record dropped; the selection effect is retained: ${outcome.reason}`)
    }
    return outcome
  }
  /** observe handleId -> handle record */
  const handles = new Map()
  let hubEpoch = 1
  let sequence = 0
  let current = true

  const gates = () => {
    if (typeof active === 'function' && !active()) throw new PluginApiInactiveError()
  }

  const service = () => {
    try {
      const resolved = resolvePresets?.()
      return resolved && typeof resolved === 'object' ? resolved : null
    } catch {
      return null
    }
  }

  /**
   * The target identity of an official session handle. The seam takes the
   * official session object (`{ id, events }`), not an agent.
   */
  const sessionIdOf = (session) => {
    if (!isPlainObject(session) || !isNonEmptyString(session.id)) return null
    return session.id
  }

  // Tri-state presence: true (held by the official store), false (gone) and
  // null (the store itself is unreachable, so liveness is unverifiable).
  const targetPresence = (sessionId) => {
    if (typeof resolveTargetPresence !== 'function') return null
    try {
      const presence = resolveTargetPresence(sessionId)
      if (presence === true) return true
      if (presence === false) return false
      return null
    } catch {
      return null
    }
  }

  const observedAt = () => {
    try {
      const value = clock()
      return value instanceof Date ? value.toISOString() : String(value)
    } catch {
      return new Date(0).toISOString()
    }
  }

  const readPreset = (session) => {
    const target = sessionIdOf(session)
    const presence = target === null ? false : targetPresence(target)
    if (target === null) return unavailableView('the target must be an official session handle')
    if (presence === false) return degradedPresetView(target, `the target session "${bounded(target) ?? 'unknown'}" does not exist or is closed`)
    if (presence !== true) return unavailableView('the official sessions store is unreachable; the target liveness cannot be verified')
    const resolved = service()
    if (!resolved || typeof resolved.current !== 'function') {
      return unavailableView('the official permission-presets service is unavailable')
    }
    try {
      const preset = resolved.current(session.events)
      if (!isNonEmptyString(preset)) {
        return degradedPresetView(target, 'the official preset read returned an unexpected shape')
      }
      return Object.freeze({ target, preset, observedAt: observedAt(), source: 'official' })
    } catch (error) {
      reportDiagnostics(`preset read failed for "${bounded(target) ?? 'unknown'}": ${boundedError(error)}`)
      return degradedPresetView(target, 'the official preset read failed')
    }
  }

  // The seam is a thunk returning the live snapshot reader (or null when the
  // projection carrier is absent); it is re-resolved on every read so a
  // carrier that appears later starts serving options.
  const snapshotReader = () => {
    if (typeof resolveSnapshot !== 'function') return null
    try {
      const reader = resolveSnapshot()
      return typeof reader === 'function' ? reader : null
    } catch {
      return null
    }
  }

  const readOptions = (session) => {
    const target = sessionIdOf(session)
    if (target === null) return unavailableOptionsView('the target must be an official session handle')
    const presence = targetPresence(target)
    if (presence === false) return degradedOptionsView(target, `the target session "${bounded(target) ?? 'unknown'}" does not exist or is closed`)
    if (presence !== true) return unavailableOptionsView('the official sessions store is unreachable; the target liveness cannot be verified')
    const readSnapshot = snapshotReader()
    if (readSnapshot === null) {
      return degradedOptionsView(target, 'the permissions projection carrier is unavailable')
    }
    let payload
    try {
      payload = readSnapshot(session)
    } catch (error) {
      reportDiagnostics(`options read failed: ${boundedError(error)}`)
      return degradedOptionsView(target, 'the permissions projection read failed')
    }
    const projection = isPlainObject(payload) && isPlainObject(payload.values) ? payload.values.permissions : undefined
    if (!isPlainObject(projection)) {
      return degradedOptionsView(target, 'the permissions projection is not registered')
    }
    const options = optionsOf(projection.options)
    if (options === null || !isNonEmptyString(projection.currentValue)) {
      return degradedOptionsView(target, 'the permissions projection returned an unexpected shape')
    }
    return Object.freeze({
      target,
      options,
      currentValue: projection.currentValue,
      observedAt: observedAt(),
      source: 'official',
    })
  }

  // Owner derivation is best-effort and used for audit attribution only.
  const deriveOwner = (callerCtx) => {
    try {
      const ownerId = resolveOwnerId?.(callerCtx)
      return isNonEmptyString(ownerId) ? ownerId : undefined
    } catch {
      return undefined
    }
  }

  const select = (session, name, callerCtx) => {
    gates()
    const target = sessionIdOf(session)
    const presetLabel = isNonEmptyString(name) ? name : 'unknown'
    const auditTarget = target ?? 'unknown'
    // Declared order: parameters, availability, owner, target, preset name.
    if (!isPlainObject(session) || target === null || typeof name !== 'string' || name.length === 0) {
      auditRecord({ target: auditTarget, preset: presetLabel, outcome: 'invalid-input' })
      return Object.freeze({ ok: false, code: 'invalid-input', reason: 'the selection requires an official session handle and a preset name' })
    }
    const resolved = service()
    if (!resolved || typeof resolved.set !== 'function') {
      auditRecord({ target: auditTarget, preset: presetLabel, outcome: 'unavailable' })
      return Object.freeze({ ok: false, code: 'unavailable', reason: 'the official permission-presets service is unavailable' })
    }
    const ownerId = deriveOwner(callerCtx)
    if (ownerId === undefined) {
      auditRecord({ ownerId: 'unattributed', target: auditTarget, preset: presetLabel, outcome: 'denied' })
      return Object.freeze({ ok: false, code: 'denied', reason: 'the caller owner cannot be derived' })
    }
    const presence = targetPresence(target)
    if (presence === false) {
      const reason = `the target session "${bounded(target) ?? 'unknown'}" does not exist or is closed`
      auditRecord({ ownerId, target: auditTarget, preset: presetLabel, outcome: 'invalid-target', reason })
      return Object.freeze({ ok: false, code: 'invalid-target', reason })
    }
    if (presence !== true) {
      const reason = 'the official sessions store is unreachable; the target liveness cannot be verified'
      auditRecord({ ownerId, target: auditTarget, preset: presetLabel, outcome: 'unavailable', reason })
      return Object.freeze({ ok: false, code: 'unavailable', reason })
    }
    if (name === CUSTOM_PRESET_NAME) {
      auditRecord({ ownerId, target: auditTarget, preset: presetLabel, outcome: 'invalid-preset', reason: 'the custom state is derived, never a selection target' })
      return Object.freeze({ ok: false, code: 'invalid-preset', reason: 'the custom state is derived, never a selection target' })
    }
    // Unknown names are rejected before any official read or write (the
    // official resolve() throws); the official option table is the truth.
    if (typeof resolved.resolve === 'function') {
      let known = true
      try {
        resolved.resolve(name)
      } catch {
        known = false
      }
      if (!known) {
        auditRecord({ ownerId, target: auditTarget, preset: presetLabel, outcome: 'unknown-preset', reason: 'the official option table does not offer this preset' })
        return Object.freeze({ ok: false, code: 'unknown-preset', reason: `the official option table does not offer "${bounded(name) ?? 'unknown'}"` })
      }
    }
    let before
    try {
      before = resolved.current(session.events)
    } catch (error) {
      const reason = boundedError(error)
      reportDiagnostics(`pre-selection read failed: ${reason}`)
      auditRecord({ ownerId, target: auditTarget, preset: presetLabel, outcome: 'internal', reason })
      return Object.freeze({ ok: false, code: 'internal', reason: 'the official preset read failed' })
    }
    auditRecord({ ownerId, target: auditTarget, preset: presetLabel, outcome: 'attempt' })
    try {
      resolved.set(session, name)
    } catch (error) {
      const reason = boundedError(error)
      reportDiagnostics(`selection failed for "${bounded(target) ?? 'unknown'}": ${reason}`)
      auditRecord({ ownerId, target: auditTarget, preset: presetLabel, outcome: 'internal', reason })
      return Object.freeze({ ok: false, code: 'internal', reason: 'the official preset write failed' })
    }
    let after
    try {
      after = resolved.current(session.events)
    } catch (error) {
      const reason = boundedError(error)
      reportDiagnostics(`post-selection read failed: ${reason}`)
      auditRecord({ ownerId, target: auditTarget, preset: presetLabel, outcome: 'internal', reason })
      return Object.freeze({ ok: false, code: 'internal', reason: 'the official preset readback failed' })
    }
    const result = mapSelectResult({ before, after, requested: name, appliedAt: observedAt() })
    auditRecord({ ownerId, target: auditTarget, preset: presetLabel, outcome: result.code })
    return result
  }

  /** The composed change signature; priming and delivery share one builder. */
  const signatureOf = (preset, optionsView) => Object.freeze({
    preset,
    currentValue: optionsView.currentValue,
    optionValues: Object.freeze(optionsView.options.map((option) => option.value)),
    optionNames: Object.freeze(optionsView.options.map((option) => option.name)),
    optionsSource: optionsView.source,
  })

  const deliver = (record, sessionId) => {
    if (record.disposed || record.closed) return
    // Liveness verification rides every delivery; an unverifiable presence
    // never fabricates a delivery and never retires the handle.
    const presence = targetPresence(sessionId)
    if (presence === false) {
      record.closed = true
      record.degraded = true
      record.listeners.clear()
      return
    }
    if (presence !== true) {
      record.degraded = true
      return
    }
    const resolved = service()
    if (!resolved || typeof resolved.current !== 'function') {
      record.degraded = true
      return
    }
    let preset
    try {
      preset = resolved.current(record.session.events)
    } catch (error) {
      reportDiagnostics(`observation re-read failed for "${bounded(sessionId) ?? 'unknown'}": ${boundedError(error)}`)
      record.degraded = true
      return
    }
    if (!isNonEmptyString(preset)) {
      record.degraded = true
      return
    }
    const optionsView = readOptions(record.session)
    const signature = signatureOf(preset, optionsView)
    record.degraded = false
    const previous = record.lastDelivered
    if (previous
      && previous.preset === signature.preset
      && previous.currentValue === signature.currentValue
      && previous.optionValues.length === signature.optionValues.length
      && previous.optionValues.every((value, index) => value === signature.optionValues[index] && previous.optionNames[index] === signature.optionNames[index])
      && previous.optionsSource === signature.optionsSource) return
    record.lastDelivered = signature
    const payload = Object.freeze({
      target: sessionId,
      preset,
      options: optionsView.options,
      currentValue: optionsView.currentValue,
      observedAt: observedAt(),
    })
    for (const listener of [...record.listeners]) {
      try {
        const returned = listener(payload)
        if (returned != null && typeof returned.then === 'function') {
          Promise.resolve(returned).catch((error) => reportDiagnostics(`observation listener rejected: ${String(error?.message ?? error)}`))
        }
      } catch (error) {
        reportDiagnostics(`observation listener threw: ${String(error?.message ?? error)}`)
      }
    }
  }

  const observe = (session) => {
    gates()
    const sessionId = sessionIdOf(session)
    const handleId = `permission-presets:${++sequence}`
    const record = {
      id: handleId,
      epoch: hubEpoch,
      session,
      sessionId,
      disposed: false,
      degraded: sessionId === null,
      closed: false,
      listeners: new Set(),
      lastDelivered: null,
    }
    const bound = sessionId !== null
    const live = () => current && !record.disposed && record.epoch === hubEpoch
      && (!bound || handles.get(handleId) === record)
    const handle = Object.freeze({
      epoch: record.epoch,
      current() {
        if (!live()) return degradedPresetView(sessionId, 'the observation handle is stale')
        if (record.closed) return degradedPresetView(sessionId, 'the target session is closed')
        return readPreset(session)
      },
      subscribe(listener) {
        if (typeof listener !== 'function') return () => {}
        if (!live() || !bound || record.closed) return () => {}
        record.listeners.add(listener)
        let subscribed = true
        return () => {
          if (!subscribed) return
          subscribed = false
          record.listeners.delete(listener)
        }
      },
      dispose() {
        if (record.disposed) return false
        record.disposed = true
        record.listeners.clear()
        handles.delete(handleId)
        return true
      },
    })
    if (bound) {
      handles.set(handleId, record)
      const presence = targetPresence(sessionId)
      if (presence === true) {
        try {
          const preset = service()?.current?.(session?.events)
          if (isNonEmptyString(preset)) record.lastDelivered = signatureOf(preset, readOptions(session))
        } catch {
          // priming is best-effort; deliveries re-read anyway
        }
      }
    }
    return handle
  }

  return Object.freeze({
    availability: () => availabilityOf(service(), observeAvailable, optionsAvailable),
    current: (session) => {
      gates()
      return readPreset(session)
    },
    options: (session) => {
      gates()
      return readOptions(session)
    },
    select,
    observe,
    /** Firehose ingest: one official session event for a bound session. */
    ingestSessionEvent(session, event) {
      if (!current) return
      // Only the three knob facts move the composed state; every other fact —
      // including an unreadable one — is ignored without a re-read.
      if (!isPlainObject(event) || !KNOB_EVENT_TYPES.has(event.type)) return
      const sessionId = isPlainObject(session) && isNonEmptyString(session.id) ? session.id : null
      if (sessionId === null) return
      for (const record of handles.values()) {
        if (record.sessionId !== sessionId) continue
        deliver(record, sessionId)
      }
    },
    /** Official close fact for a bound session. */
    ingestSessionDisposed(session) {
      if (!current) return
      const sessionId = isPlainObject(session) && isNonEmptyString(session.id) ? session.id : null
      if (sessionId === null) return
      for (const record of handles.values()) {
        if (record.sessionId !== sessionId) continue
        record.closed = true
        record.degraded = true
        record.listeners.clear()
      }
    },
    audit: () => audit.view(),
    dispose() {
      current = false
      hubEpoch += 1
      for (const record of handles.values()) {
        record.disposed = true
        record.listeners.clear()
      }
      handles.clear()
    },
    inspection: () => Object.freeze({ handles: handles.size, epoch: hubEpoch, audit: audit.size }),
  })
}
