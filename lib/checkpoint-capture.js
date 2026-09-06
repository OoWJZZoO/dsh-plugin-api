/**
 * Checkpoint capture authority — `create(spec)` (Requirement 3).
 *
 * One mutation entry through the capture authority: resolves the declared
 * v1 source, routes the anchor capture exclusively through the source's
 * owning authority, writes an append-only record with honest per-component
 * statuses, and returns the durable mutation outcome (`commitState` +
 * frozen summary). Unregistered or unavailable sources yield typed
 * outcomes and never produce a fake record. Capture-key dedupe returns the
 * existing record reference; a deliberate re-trigger (new or absent
 * capture key) creates a new record carrying lineage.
 */

import { deepFreeze } from './deep-freeze.js'
import {
  buildCheckpointRecord,
  CAPTURE_SOURCE_KINDS as captureSourcesVocabulary,
  normalizeScope,
  redactRecord,
} from './checkpoint-record.js'
import { resolveCaptureSource, normalizeCaptureOutcome } from './checkpoint-sources.js'

const CAPTURE_CODES = ['created', 'deduplicated']

function isObject(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}

function boundedString(value, max = 160) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const text = String(value).trim()
  return text ? text.slice(0, max) : undefined
}

function boundedReason(value) {
  return boundedString(value) ?? 'capture failed'
}

/** Aggregate a set of per-component capture statuses into the overall status. */
export function overallCaptureStatus(components) {
  const statuses = Array.isArray(components) ? components.map((item) => item?.status) : []
  if (statuses.length === 0) return 'unknown'
  if (statuses.includes('unavailable')) return 'unavailable'
  if (statuses.includes('partial')) return 'partial'
  // Captured + missing means the capture is honestly partial (some captured,
  // some declared points produced no data); only an all-missing capture is
  // overall `missing`.
  if (statuses.includes('captured') && statuses.includes('missing')) return 'partial'
  if (statuses.includes('missing')) return 'missing'
  if (statuses.includes('unknown')) return 'unknown'
  return 'captured'
}

function normalizeCaptureKey(value) {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || !value.trim()) return undefined
  return value.trim().slice(0, 120)
}

function normalizeCorrelation(value) {
  if (!isObject(value)) return undefined
  const out = {}
  for (const key of ['executionId', 'activityId', 'attemptId']) {
    if (typeof value[key] === 'string' && value[key]) out[key] = value[key]
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function normalizeExternalEffect(value) {
  if (typeof value?.name !== 'string' || !value.name) return undefined
  const kinds = ['rollbackable', 'external', 'unknown']
  if (!kinds.includes(value.kind)) return undefined
  return deepFreeze({
    name: value.name.slice(0, 80),
    kind: value.kind,
    ...(value.detail !== undefined ? { detail: boundedString(value.detail) } : {}),
  })
}

/**
 * Build the capture authority.
 * @param {{
 *   store: object,        // createCheckpointStore
 *   authorities?: object, // { branch, journal, snapshot } source faces
 *   ownerOf?: Function,   // derive caller owner from context; returns string | undefined
 *   idFactory?: Function, // checkpointId factory
 *   now?: Function,
 *   audit?: object,       // { log(entry) -> outcome } (failures become gap markers)
 *   logger?: object,
 * }} options
 */
export function createCaptureAuthority({ store, authorities = {}, ownerOf, idFactory, now, audit, logger } = {}) {
  const makeId = typeof idFactory === 'function' ? idFactory : () => `checkpoint-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`
  const clock = typeof now === 'function' ? now : () => new Date()

  const sources = new Map()
  const sourceFor = (kind) => {
    if (!sources.has(kind)) {
      sources.set(kind, resolveCaptureSource({ kind }, authorities))
    }
    return sources.get(kind)
  }

  const logAudit = async (entry) => {
    if (!audit || typeof audit.log !== 'function') return true
    try {
      const outcome = await audit.log(entry)
      return isObject(outcome) && outcome.ok === true
    } catch {
      return false
    }
  }

  /**
   * Create a checkpoint — the single capture entry (Requirement 3).
   * @param {{
   *   scope: { sessionId?: string, workspaceId?: string, profileId?: string },
   *   source: { kind: string },
   *   captureKey?: string,
   *   reason?: string,
   *   correlation?: object,
   *   externalEffects?: Array,
   *   signal?: AbortSignal,
   * }} spec
   * @param {object} [caller] - caller context for owner derivation.
   */
  const create = async (spec = {}, caller = {}) => {
    if (!isObject(spec)) return deepFreeze({ ok: false, code: 'invalid-input', reason: 'create spec must be an object' })
    const owner = typeof ownerOf === 'function' ? ownerOf(caller) : undefined
    if (!owner) {
      return deepFreeze({ ok: false, code: 'unavailable', reason: 'caller owner derivation is unavailable; nothing was captured' })
    }
    const scopeKind = spec.scope?.sessionId !== undefined ? 'session'
      : spec.scope?.workspaceId !== undefined ? 'workspace'
        : spec.scope?.profileId !== undefined ? 'profile'
          : undefined
    const scopeId = scopeKind === 'session' ? spec.scope.sessionId
      : scopeKind === 'workspace' ? spec.scope.workspaceId
        : scopeKind === 'profile' ? spec.scope.profileId
          : undefined
    const scope = normalizeScope(scopeKind, scopeId)
    if (!scope.ok) return deepFreeze({ ok: false, code: 'invalid-input', reason: scope.reason })
    if (scopeKind === 'profile') {
      return deepFreeze({ ok: false, code: 'unavailable', reason: 'profile-scope capture has no v1 capture source; no record was produced' })
    }
    const kind = spec.source?.kind
    if (typeof kind !== 'string' || !kind) {
      return deepFreeze({ ok: false, code: 'invalid-input', reason: 'source.kind is required' })
    }
    const source = sourceFor(kind)
    if (!source || !captureSourcesVocabulary.includes(kind)) {
      return deepFreeze({ ok: false, code: 'unsupported', reason: `capture source '${kind}' is not a registered v1 source` })
    }
    const captureKey = normalizeCaptureKey(spec.captureKey)
    const reason = boundedString(spec.reason)
    const correlation = normalizeCorrelation(spec.correlation)
    const externalEffects = Array.isArray(spec.externalEffects)
      ? spec.externalEffects.map(normalizeExternalEffect).filter(Boolean)
      : []
    const observedAt = clock().toISOString()
    const checkpointId = makeId()

    // Dedupe: same (owner, scope, captureKey) effort returns the existing record.
    if (captureKey) {
      const existing = await store.keyGet(owner, captureKey, scopeKind)
      if (existing.ok && isObject(existing.row) && typeof existing.row.recordId === 'string') {
        const record = await store.get(existing.row.recordId)
        if (record.ok) {
          const outcome = deepFreeze({
            ok: true,
            code: 'deduplicated',
            commitState: 'committed',
            idempotent: true,
            record: redactRecord(record.record),
            observedAt,
          })
          await logAudit({ kind: 'capture', code: 'deduplicated', owner, checkpointId: existing.row.recordId, scope: scope.scope, source: kind, observedAt })
          return outcome
        }
        if (existing.row.phase === 'pending') {
          return deepFreeze({ ok: false, code: 'conflict', reason: 'a capture with this capture key is already in flight', observedAt })
        }
      }
    }

    // Reserve the capture-key row before anchor capture (dedupe window).
    const keyRow = deepFreeze({ recordId: checkpointId, phase: 'pending', createdAt: observedAt })
    if (captureKey) {
      const reserved = await store.keyPut(owner, captureKey, scopeKind, keyRow)
      if (!reserved.ok) {
        return deepFreeze({ ok: false, code: reserved.code ?? 'unavailable', reason: boundedReason(reserved.reason), observedAt })
      }
    }

    // Anchor capture through the declared owning authority.
    const captured = await source.capture({
      resourceId: scopeId,
      reason,
      signal: spec.signal,
      caller: { owner },
    })
    if (!captured.ok) {
      if (captureKey) {
        await store.keyPut(owner, captureKey, scopeKind, deepFreeze({ recordId: checkpointId, phase: 'released', createdAt: observedAt }))
      }
      return deepFreeze({ ok: false, code: captured.code ?? 'unavailable', reason: boundedReason(captured.reason), observedAt })
    }
    const outcome = normalizeCaptureOutcome(captured)
    if (!outcome.ok) {
      if (captureKey) {
        await store.keyPut(owner, captureKey, scopeKind, deepFreeze({ recordId: checkpointId, phase: 'released', createdAt: observedAt }))
      }
      return deepFreeze({ ok: false, code: outcome.code ?? 'unavailable', reason: boundedReason(outcome.reason), observedAt })
    }

    const components = outcome.components
    const overall = overallCaptureStatus(components)
    const previous = await store.lastFor(scopeKind, scopeId)
    const recordResult = buildCheckpointRecord({
      checkpointId,
      scopeKind,
      scopeId,
      source: { kind, anchor: outcome.anchor },
      capture: { overall, components, capturedAt: outcome.capturedAt },
      provenance: {
        owner,
        correlation,
        reason,
        createdAt: observedAt,
        autoTrigger: spec.autoTrigger === 'attempt-end' ? 'attempt-end' : null,
      },
      restoreability: {
        summary: overall,
        perSlice: deepFreeze([{ slice: scopeKind, status: overall }]),
      },
      externalEffects,
      lineage: {
        previousCheckpointId: previous?.id,
        captureKey,
      },
    })
    if (!recordResult.ok) {
      if (captureKey) {
        await store.keyPut(owner, captureKey, scopeKind, deepFreeze({ recordId: checkpointId, phase: 'released', createdAt: observedAt }))
      }
      return deepFreeze({ ok: false, code: 'invalid-input', reason: recordResult.reason, observedAt })
    }

    const written = await store.put(recordResult.record)
    if (!written.ok) {
      if (captureKey) {
        await store.keyPut(owner, captureKey, scopeKind, deepFreeze({ recordId: checkpointId, phase: 'released', createdAt: observedAt }))
      }
      return deepFreeze({ ok: false, code: written.code === 'conflict' ? 'conflict' : 'unavailable', reason: boundedReason(written.reason), observedAt })
    }
    if (captureKey) {
      await store.keyPut(owner, captureKey, scopeKind, deepFreeze({ recordId: checkpointId, phase: 'committed', createdAt: observedAt }))
    }

    const auditGap = !(await logAudit({
      kind: 'capture',
      code: 'created',
      owner,
      checkpointId,
      scope: scope.scope,
      source: kind,
      anchor: outcome.anchor,
      overall,
      observedAt,
    }))

    return deepFreeze({
      ok: true,
      code: 'created',
      commitState: 'committed',
      idempotent: false,
      record: redactRecord(recordResult.record),
      summary: deepFreeze({
        checkpointId,
        scope: scope.scope,
        source: kind,
        overall,
        components: components.map(({ name, status }) => deepFreeze({ name, status })),
        anchor: deepFreeze({ ...outcome.anchor }),
        ...(captureKey ? { captureKey } : {}),
        ...(auditGap ? { auditGap: true } : {}),
      }),
      observedAt,
    })
  }

  /** Per-source availability for the availability face. */
  const sourceAvailability = (kind) => {
    if (typeof kind !== 'string' || !captureSourcesVocabulary.includes(kind)) {
      return deepFreeze({ status: 'unavailable', reason: `capture source '${kind}' is not a registered v1 source` })
    }
    return sourceFor(kind).availability()
  }

  return deepFreeze({ create, sourceAvailability })
}