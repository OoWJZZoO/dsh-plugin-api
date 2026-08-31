/**
 * Bounded in-memory audit ledger for `pluginApi.security.audit`.
 *
 * v1 durability tier: NON-durable in-memory ring buffer, truthfully labeled
 * (durable-state-and-scope rule: no cross-restart promise, no claimed scope
 * tier). Records are keyed by the decision's `auditId` (records stay bounded). Overflow
 * drops the oldest record and sets a `truncated` flag; an append failure sets
 * a `gapSince` marker exposed on every subsequent query (gaps stay visible) — missing
 * records are never fabricated. Queries return deep-frozen read-only views
 * with secret-shaped values redacted (views stay redacted); records never carry raw
 * secret text by construction (summaries only).
 */
import { isSecretShapedKey, isSecretShapedString } from './security-redaction.js'
import { deepFreeze } from './deep-freeze.js'

export const AUDIT_KINDS = Object.freeze(['decision', 'redaction', 'egress-grant'])
export const AUDIT_CAPACITY = 512
const MAX_SUMMARY = 240

function bounded(value, max = MAX_SUMMARY) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const text = String(value)
  return text ? text.slice(0, max) : undefined
}

function redactRecordView(record) {
  const view = { ...record }
  view.summary = redactSummary(record.summary)
  return view
}

function redactSummary(summary) {
  if (summary === null || typeof summary !== 'object') return summary
  const out = {}
  for (const key of Object.keys(summary)) {
    const value = summary[key]
    if (isSecretShapedKey(key)) {
      out[key] = '[redacted]'
    } else if (Array.isArray(value)) {
      out[key] = value.map((item) => (isSecretShapedString(item) ? '[redacted]' : item))
    } else if (typeof value === 'string') {
      out[key] = isSecretShapedString(value) ? '[redacted]' : value
    } else if (typeof value === 'object' && value !== null) {
      out[key] = redactSummary(value)
    } else {
      out[key] = value
    }
  }
  return out
}

/**
 * Normalize an audit record for storage (records stay bounded): bounded fields only, no
 * raw secret text. Throws on unusable input so the caller can decide between
 * gap accounting and fail-closed behavior (gaps stay visible).
 */
export function normalizeAuditRecord({ auditId, at, kind, ownerIds, policyIds, summary, outcome, generation } = {}) {
  if (typeof auditId !== 'string' || !auditId) throw new TypeError('auditId is required')
  if (!AUDIT_KINDS.includes(kind)) throw new TypeError(`kind must be one of: ${AUDIT_KINDS.join(', ')}`)
  if (typeof at !== 'number' || !Number.isFinite(at)) throw new TypeError('at must be a finite number')
  const owners = Array.isArray(ownerIds) ? [...new Set(ownerIds.map((id) => bounded(id, 120)).filter(Boolean))] : []
  const policies = Array.isArray(policyIds) ? [...new Set(policyIds.map((id) => bounded(id, 120)).filter(Boolean))] : []
  const reason = typeof summary === 'string' ? bounded(summary) : undefined
  return {
    auditId,
    seq: 0,
    at,
    kind,
    ownerIds: owners,
    policyIds: policies,
    summary: reason ?? summary,
    outcome: typeof outcome === 'string' ? outcome : undefined,
    generation: typeof generation === 'string' ? generation : undefined,
  }
}

export function createSecurityAudit({ capacity = AUDIT_CAPACITY, now = Date.now, storage = null } = {}) {
  const records = [] // oldest first
  const ringCapacity = Number.isInteger(capacity) && capacity > 0 ? capacity : AUDIT_CAPACITY
  let seq = 0
  let truncated = false
  let gapSince = undefined
  let closed = false
  const atValue = () => (typeof now === 'function' ? now() : now)

  const append = (input) => {
    const record = normalizeAuditRecord(input)
    record.seq = ++seq
    if (record.at === undefined) record.at = atValue()
    try {
      if (storage && typeof storage.append === 'function') {
        storage.append(record)
      }
      records.push(record)
      if (records.length > ringCapacity) {
        records.shift()
        truncated = true
      }
      return { ok: true, truncated }
    } catch {
      // audit storage failure: mark the gap, never fabricate the record
      gapSince ??= atValue()
      record.seq = 0
      return { ok: false, gapSince }
    }
  }

  const query = ({ kind, ownerId, policyId, limit } = {}) => {
    let view = records
    if (kind !== undefined) view = view.filter((record) => record.kind === kind)
    if (ownerId !== undefined) view = view.filter((record) => record.ownerIds.includes(ownerId))
    if (policyId !== undefined) view = view.filter((record) => record.policyIds.includes(policyId))
    if (Number.isInteger(limit) && limit >= 0) view = view.slice(-limit)
    return deepFreeze({
      records: view.map((record) => deepFreeze(redactRecordView(record))),
      truncated,
      gapSince,
    })
  }

  const status = () =>
    Object.freeze({
      durable: 'non-durable',
      capacity: ringCapacity,
      size: records.length,
      truncated,
      gapSince,
    })

  const dispose = () => {
    if (closed) return false
    closed = true
    records.length = 0
    return true
  }

  return Object.freeze({ append, query, status, dispose })
}