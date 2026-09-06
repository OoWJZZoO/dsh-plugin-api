/**
 * Checkpoint durable record model and facade-internal store adapter.
 *
 * The checkpoint record is a facade-owned durable envelope (append-only, one
 * durable scope per record). Storage binds to the delivered single-scope
 * durable record base (storage-binding facility pattern): one owner-scoped
 * unit per scope kind (`checkpoints`/`records`), schema id + integer version +
 * owner + scope + keyed tables, validated by this module on read
 * (`unsupported-schema` for unknown future schemas/versions). The v1 record
 * carries: identity (facade-generated checkpointId), single scope, capture
 * source + anchor, per-component capture status, provenance, restoreability,
 * external effects and lineage. Records never delete or rewrite; the store is
 * append-only by construction (write-once keys, no update/delete entry).
 */

import { deepFreeze } from './deep-freeze.js'

export const CHECKPOINT_SCHEMAS = Object.freeze({
  session: 'executions.recovery.checkpoints.session',
  workspace: 'executions.recovery.checkpoints.workspace',
})

/** Durable envelope version of the schema ids above. */
export const RECORD_VERSION = 1

/** Single durable scope vocabulary (contract §2.5). */
export const SCOPE_KINDS = Object.freeze(['session', 'workspace', 'profile'])

/** v1 capture source kinds (each bound to one owning authority). */
export const CAPTURE_SOURCE_KINDS = Object.freeze([
  'branch',
  'workspace-journal',
  'workspace-snapshot',
])

/** Per-component capture status vocabulary (Requirement 2 AC2). */
export const CAPTURE_STATUSES = Object.freeze([
  'captured',
  'partial',
  'missing',
  'unknown',
  'unavailable',
])

/** Restoreability vocabulary (Requirement 5 AC1). */
export const RESTOREABILITY_VALUES = Object.freeze([
  'restoreable',
  'partial',
  'unavailable',
  'not-applicable',
])

/** External effect rollbackability vocabulary (Requirement 10 AC1). */
export const ROLLBACKABILITY_VALUES = Object.freeze([
  'rollbackable',
  'external',
  'unknown',
])

/** Facade-internal store unit owner label (never a caller-supplied owner). */
export const STORE_OWNER = 'checkpoints'

/** Facade-internal store unit name. */
export const STORE_UNIT_NAME = 'records'

function isObject(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}

function boundedString(value, max = 200) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const text = String(value).trim()
  return text ? text.slice(0, max) : undefined
}

function boundedArray(value, max = 64, map = (item) => item) {
  if (!Array.isArray(value)) return undefined
  return value.slice(0, max).map(map).filter(Boolean)
}

/**
 * Normalize a single-scope declaration.
 * @param {string} kind - One of `session | workspace | profile`.
 * @param {string} id - The corresponding resource id.
 * @returns {{ ok: true, scope: { kind: string, id: string } } | { ok: false, reason: string }}
 */
export function normalizeScope(kind, id) {
  if (!SCOPE_KINDS.includes(kind)) {
    return { ok: false, reason: `scope kind must be one of ${SCOPE_KINDS.join(', ')}` }
  }
  if (typeof id !== 'string' || id.trim() === '') {
    return { ok: false, reason: 'scope resource id must be a non-empty string' }
  }
  return { ok: true, scope: deepFreeze({ kind, id }) }
}

function normalizeCaptureStatus(value) {
  return CAPTURE_STATUSES.includes(value) ? value : undefined
}

function normalizeSource(kind, anchor) {
  if (!CAPTURE_SOURCE_KINDS.includes(kind)) return undefined
  if (!isObject(anchor)) return undefined
  return deepFreeze({ kind, anchor: anchor })
}

function normalizeComponent({ name, status, detail } = {}) {
  if (typeof name !== 'string' || name.trim() === '') return undefined
  const normalizedStatus = normalizeCaptureStatus(status)
  if (!normalizedStatus) return undefined
  return deepFreeze({
    name,
    status: normalizedStatus,
    ...(detail !== undefined ? { detail: boundedString(detail, 160) } : {}),
  })
}

function normalizeProvenance({ correlation, reason, createdAt, autoTrigger } = {}) {
  const correlationOut = {}
  if (typeof correlation?.executionId === 'string' && correlation.executionId) {
    correlationOut.executionId = correlation.executionId
  }
  if (typeof correlation?.activityId === 'string' && correlation.activityId) {
    correlationOut.activityId = correlation.activityId
  }
  if (typeof correlation?.attemptId === 'string' && correlation.attemptId) {
    correlationOut.attemptId = correlation.attemptId
  }
  return deepFreeze({
    ...(Object.keys(correlationOut).length > 0 ? { correlation: correlationOut } : {}),
    ...(reason !== undefined ? { reason: boundedString(reason, 200) } : {}),
    createdAt: typeof createdAt === 'string' && createdAt ? createdAt : new Date().toISOString(),
    ...(autoTrigger === 'attempt-end' || autoTrigger === null
      ? { autoTrigger }
      : { autoTrigger: null }),
  })
}

function normalizeExternalEffect({ name, kind, detail } = {}) {
  if (typeof name !== 'string' || name.trim() === '') return undefined
  if (!ROLLBACKABILITY_VALUES.includes(kind)) return undefined
  return deepFreeze({
    name,
    kind,
    ...(detail !== undefined ? { detail: boundedString(detail, 160) } : {}),
  })
}

function normalizeRestoreability({ summary, perSlice } = {}) {
  const summaryOut = normalizeCaptureStatus(summary)
  if (!summaryOut) return undefined
  const per = boundedArray(
    perSlice,
    32,
    (item) => {
      if (!isObject(item) || typeof item.slice !== 'string') return undefined
      const status = normalizeCaptureStatus(item.status)
      if (!status) return undefined
      return deepFreeze({
        slice: item.slice.slice(0, 40),
        status,
        ...(item.reason !== undefined ? { reason: boundedString(item.reason, 160) } : {}),
      })
    },
  )
  return deepFreeze({ summary: summaryOut, ...(per ? { perSlice: per } : {}) })
}

function normalizeLineage(previousCheckpointId, captureKey) {
  const out = {}
  if (typeof previousCheckpointId === 'string' && previousCheckpointId) {
    out.previousCheckpointId = previousCheckpointId
  }
  if (typeof captureKey === 'string' && captureKey) {
    out.captureKey = captureKey.slice(0, 120)
  }
  return Object.keys(out).length > 0 ? deepFreeze(out) : deepFreeze({})
}

/**
 * Build a checkpoint record envelope. All fields are validated; the returned
 * record is deep-frozen and bounded.
 * @param {{
 *   checkpointId: string,
 *   scopeKind: string,
 *   scopeId: string,
 *   source: { kind: string, anchor: object },
 *   capture: { overall: string, components: Array, capturedAt: string },
 *   provenance: object,
 *   restoreability?: object,
 *   externalEffects?: Array,
 *   lineage?: object,
 * }} input
 * @returns {{ ok: true, record: object } | { ok: false, reason: string }}
 */
export function buildCheckpointRecord(input = {}) {
  if (!isObject(input)) return { ok: false, reason: 'record input must be an object' }
  const { checkpointId, scopeKind, scopeId, source, capture, provenance } = input
  if (typeof checkpointId !== 'string' || !checkpointId) {
    return { ok: false, reason: 'checkpointId must be a non-empty string' }
  }
  const scope = normalizeScope(scopeKind, scopeId)
  if (!scope.ok) return scope
  const normalizedSource = normalizeSource(source?.kind, source?.anchor)
  if (!normalizedSource) {
    return { ok: false, reason: 'source must declare a registered kind and an anchor' }
  }
  const overall = normalizeCaptureStatus(capture?.overall)
  if (!overall) {
    return { ok: false, reason: `capture.overall must be one of ${CAPTURE_STATUSES.join(', ')}` }
  }
  const components = boundedArray(capture?.components, 64, normalizeComponent)
  if (capture?.components !== undefined && !components) {
    return { ok: false, reason: 'capture.components must be an array of component statuses' }
  }
  const provenanceOut = normalizeProvenance(provenance)
  const schema = CHECKPOINT_SCHEMAS[scope.scope.kind]
  const record = {
    schema: schema ?? CHECKPOINT_SCHEMAS.workspace,
    version: RECORD_VERSION,
    owner: boundedString(provenance?.owner, 120) ?? 'unknown',
    scope: deepFreeze({ [scope.scope.kind]: scope.scope.id }),
    id: checkpointId,
    data: deepFreeze({
      source: normalizedSource,
      capture: deepFreeze({
        overall,
        ...(components ? { components } : {}),
        capturedAt: typeof capture?.capturedAt === 'string' && capture.capturedAt
          ? capture.capturedAt
          : new Date().toISOString(),
      }),
      provenance: provenanceOut,
      restoreability: normalizeRestoreability(input.restoreability) ?? deepFreeze({ summary: 'unknown' }),
      externalEffects: boundedArray(input.externalEffects, 32, normalizeExternalEffect) ?? [],
      lineage: normalizeLineage(input.lineage?.previousCheckpointId, input.lineage?.captureKey),
    }),
  }
  return { ok: true, record: deepFreeze(record) }
}

/**
 * Validate a stored record read back from the durable store. Unknown future
 * schemas/versions yield `unsupported-schema` (never guessed, never silently
 * dropped); malformed known-schema records yield `invalid-record`.
 * @param {unknown} raw
 * @returns {{ ok: true, record: object } | { ok: false, code: string, reason: string }}
 */
export function validateStoredRecord(raw) {
  if (!isObject(raw)) return { ok: false, code: 'invalid-record', reason: 'stored checkpoint is not an object' }
  if (raw.schema !== CHECKPOINT_SCHEMAS.session && raw.schema !== CHECKPOINT_SCHEMAS.workspace) {
    return { ok: false, code: 'unsupported-schema', reason: `unknown checkpoint schema '${String(raw.schema)}'` }
  }
  if (raw.version !== RECORD_VERSION) {
    return { ok: false, code: 'unsupported-schema', reason: `unknown checkpoint schema version '${String(raw.version)}'` }
  }
  const rebuilt = buildCheckpointRecord({
    checkpointId: raw.id,
    scopeKind: Object.keys(raw.scope ?? {})[0],
    scopeId: Object.values(raw.scope ?? {})[0],
    source: raw.data?.source,
    capture: raw.data?.capture,
    provenance: { ...raw.data?.provenance, owner: raw.owner },
    restoreability: raw.data?.restoreability,
    externalEffects: raw.data?.externalEffects,
    lineage: raw.data?.lineage,
  })
  if (!rebuilt.ok) return { ok: false, code: 'invalid-record', reason: rebuilt.reason }
  return { ok: true, record: rebuilt.record }
}

/**
 * Host-side redacted projection view of a record: component names/statuses and
 * anchor identities stay, payload content / anchor private state / secrets
 * never appear. The record never stores payload content by construction; this
 * pass additionally strips free-form detail from components and external
 * effects for every projection/plan/outcome exit.
 * @param {object} record
 * @returns {object} frozen redacted view
 */
export function redactRecord(record) {
  if (!isObject(record)) return deepFreeze({})
  const data = record.data ?? {}
  const capture = data.capture ?? {}
  return deepFreeze({
    schema: record.schema,
    version: record.version,
    scope: record.scope,
    id: record.id,
    data: {
      source: {
        kind: data.source?.kind,
        anchor: data.source?.anchor && typeof data.source.anchor === 'object'
          ? Object.fromEntries(
              Object.entries(data.source.anchor)
                .filter(([, value]) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
                .map(([key, value]) => [key.slice(0, 60), value]),
            )
          : undefined,
      },
      capture: {
        overall: capture.overall,
        components: Array.isArray(capture.components)
          ? capture.components.map(({ name, status }) => deepFreeze({ name, status }))
          : undefined,
        capturedAt: capture.capturedAt,
      },
      provenance: {
        ...(data.provenance?.correlation ? { correlation: data.provenance.correlation } : {}),
        ...(data.provenance?.reason ? { reason: data.provenance.reason } : {}),
        createdAt: data.provenance?.createdAt,
        ...(data.provenance?.autoTrigger ? { autoTrigger: data.provenance.autoTrigger } : {}),
      },
      restoreability: data.restoreability,
      externalEffects: Array.isArray(data.externalEffects)
        ? data.externalEffects.map(({ name, kind }) => deepFreeze({ name, kind }))
        : [],
      lineage: data.lineage,
    },
  })
}

/** Pass-through value schema for the facade-internal units (schema/decoder ownership stays in this module). */
function passThroughSchema() {
  return { parse: (value) => value }
}

function tableOf(domain, name) {
  try {
    const table = domain?.table?.(name)
    return table && typeof table.put === 'function' ? table : undefined
  } catch {
    return undefined
  }
}

/**
 * Facade-internal checkpoint store over the delivered single-scope durable
 * record base. The facility contract mirrors the storage-binding face:
 * `facility.open(spec)` resolves to `{ ok, code, envelope, handle: { domain } }`
 * or a typed failure; a missing facility/backend yields typed unavailable.
 * The store refuses to open a unit twice (`already-open` ⇒ `conflict`).
 * @param {{ facility?: object, logger?: object }} options
 */
export function createCheckpointStore({ facility, logger } = {}) {
  const units = new Map()

  const unitKey = (scopeKind) => STORE_OWNER + '__' + scopeKind

  const openUnit = async (scopeKind) => {
    if (!SCOPE_KINDS.includes(scopeKind)) {
      return { ok: false, code: 'invalid-input', reason: `unknown scope kind '${scopeKind}'` }
    }
    if (scopeKind === 'profile') {
      return { ok: false, code: 'unavailable', reason: 'profile-scope capture has no v1 capture source' }
    }
    const cached = units.get(unitKey(scopeKind))
    if (cached) return cached
    if (!facility || typeof facility.open !== 'function') {
      const result = { ok: false, code: 'unavailable', reason: 'durable record backend is unavailable' }
      units.set(unitKey(scopeKind), result)
      return result
    }
    const opened = await facility.open({
      scope: scopeKind,
      owner: STORE_OWNER,
      schema: CHECKPOINT_SCHEMAS[scopeKind],
      version: RECORD_VERSION,
      name: `${scopeKind}__${STORE_OWNER}__${STORE_UNIT_NAME}`,
      tables: {
        records: { valueSchema: passThroughSchema() },
        keys: { valueSchema: passThroughSchema() },
      },
    })
    if (!opened.ok || !opened.handle?.domain) {
      const code = opened?.code === 'unsupported-schema' || opened?.code === 'conflict'
        ? opened.code
        : 'unavailable'
      const result = { ok: false, code, reason: opened?.reason ?? 'durable record backend unavailable' }
      units.set(unitKey(scopeKind), result)
      return result
    }
    const domain = opened.handle.domain
    const unit = { ok: true, code: 'opened', domain, envelope: opened.envelope }
    units.set(unitKey(scopeKind), unit)
    return unit
  }

  const tableOfUnit = async (scopeKind, tableName) => {
    const unit = await openUnit(scopeKind)
    if (!unit.ok) return unit
    const table = tableOf(unit.domain, tableName)
    if (!table) return { ok: false, code: 'unavailable', reason: `checkpoint store table '${tableName}' is unavailable` }
    return { ok: true, table }
  }

  const api = {
    /** Store-level availability (per scope kind). */
    availability: (scopeKind) => {
      const unit = units.get(unitKey(scopeKind))
      if (!unit) return deepFreeze({ status: 'active' })
      if (!unit.ok) return deepFreeze({ status: 'unavailable', reason: unit.reason })
      return deepFreeze({ status: 'active' })
    },

    /** Open the durable unit for a scope kind (idempotent). */
    open: async (scopeKind) => {
      const unit = await openUnit(scopeKind)
      if (unit.ok) return deepFreeze({ ok: true, code: 'opened' })
      return deepFreeze({ ok: false, code: unit.code ?? 'unavailable', reason: unit.reason })
    },

    /** Append one record; write-once keys are enforced (conflict on reuse). */
    put: async (record) => {
      const scopeKind = Object.keys(record?.scope ?? {})[0]
      const resolved = await tableOfUnit(scopeKind, 'records')
      if (!resolved.ok) return resolved
      const existing = resolved.table.get(record.id)
      if (existing !== undefined) {
        return { ok: false, code: 'conflict', reason: `checkpoint '${record.id}' already exists` }
      }
      try {
        await resolved.table.put(record.id, record)
      } catch (error) {
        return {
          ok: false,
          code: 'unavailable',
          reason: `checkpoint record write failed: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
      return { ok: true, code: 'written' }
    },

    /** Read one record; missing vs unsupported schema vs availability are distinct. */
    get: async (checkpointId) => {
      let found
      let openFailed = undefined
      for (const scopeKind of ['session', 'workspace']) {
        const resolved = await tableOfUnit(scopeKind, 'records')
        if (!resolved.ok) {
          if (!openFailed) openFailed = resolved
          continue
        }
        const raw = resolved.table.get(checkpointId)
        if (raw === undefined) continue
        found = raw
        break
      }
      if (found === undefined && openFailed) {
        return { ...openFailed, reason: openFailed.reason ?? 'durable record backend is unavailable' }
      }
      if (found === undefined) {
        return { ok: false, code: 'missing', reason: `checkpoint '${checkpointId}' does not exist` }
      }
      const validated = validateStoredRecord(found)
      if (!validated.ok) return validated
      return { ok: true, record: validated.record }
    },

    /**
     * Ordered frozen page over records with optional single-scope filtering.
     * `cursor` is an opaque continuation (last returned record id); pages
     * continue in insertion order.
     */
    list: async ({ scopeKind, resourceId, cursor, limit } = {}) => {
      const wanted = scopeKind === undefined ? ['session', 'workspace'] : [scopeKind]
      const records = []
      let openFailed = undefined
      for (const kind of wanted) {
        const resolved = await tableOfUnit(kind, 'records')
        if (!resolved.ok) {
          if (!openFailed) openFailed = resolved
          continue
        }
        for (const [id, raw] of resolved.table.entries()) {
          const validated = validateStoredRecord(raw)
          if (!validated.ok) continue
          const record = validated.record
          if (resourceId !== undefined && record.scope[kind] !== resourceId) continue
          records.push(record)
        }
      }
      if (records.length === 0 && openFailed) {
        return deepFreeze({ ok: false, code: openFailed.code === 'conflict' ? 'unavailable' : openFailed.code ?? 'unavailable', reason: openFailed.reason ?? 'durable record backend is unavailable' })
      }
      if (records.length === 0 && wanted.length === 1 && wanted[0] === 'profile') {
        return deepFreeze({ ok: true, code: 'listed', items: [] })
      }
      records.sort((left, right) => String(left.id).localeCompare(String(right.id)))
      let start = 0
      if (cursor !== undefined && cursor !== null && cursor !== '') {
        const index = records.findIndex((record) => record.id === cursor)
        if (index >= 0) start = index + 1
      }
      const pageLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 50
      const page = records.slice(start, start + pageLimit)
      const nextCursor = start + pageLimit < records.length ? page[page.length - 1].id : undefined
      return deepFreeze({
        ok: true,
        code: 'listed',
        items: page.map(redactRecord),
        ...(nextCursor !== undefined ? { cursor: nextCursor } : {}),
      })
    },

    /** Dedupe index: read a capture-key row (owner + scope scoped). */
    keyGet: async (owner, captureKey, scopeKind) => {
      if (typeof captureKey !== 'string' || !captureKey) return { ok: false, code: 'invalid-input', reason: 'captureKey must be a non-empty string' }
      const resolved = await tableOfUnit(scopeKind, 'keys')
      if (!resolved.ok) return { ok: false, code: 'unavailable', reason: 'checkpoint record backend is unavailable' }
      const row = resolved.table.get(`${owner}:${captureKey}`)
      return row === undefined
        ? { ok: false, code: 'missing' }
        : { ok: true, row }
    },

    /** Reserve or update a capture-key row (phase pending/committed). */
    keyPut: async (owner, captureKey, scopeKind, row) => {
      const resolved = await tableOfUnit(scopeKind, 'keys')
      if (!resolved.ok) return resolved
      try {
        await resolved.table.put(`${owner}:${captureKey}`, row)
      } catch (error) {
        return { ok: false, code: 'unavailable', reason: `capture-key write failed: ${error instanceof Error ? error.message : String(error)}` }
      }
      return { ok: true }
    },

    /** Last record for a scope resource (lineage linkage). */
    lastFor: async (scopeKind, resourceId) => {
      const resolved = await tableOfUnit(scopeKind, 'records')
      if (!resolved.ok) return undefined
      let last
      for (const [id, raw] of resolved.table.entries()) {
        const validated = validateStoredRecord(raw)
        if (!validated.ok) continue
        if (validated.record.scope[scopeKind] !== resourceId) continue
        if (!last || String(id).localeCompare(String(last.id)) > 0) last = validated.record
      }
      return last
    },
  }
  return api
}