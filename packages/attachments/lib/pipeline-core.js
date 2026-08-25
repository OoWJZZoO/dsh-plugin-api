import { createHash, randomUUID } from 'node:crypto'

export const SCOPES = Object.freeze(['session', 'workspace', 'profile'])
export const ORIGINS = Object.freeze(['original', 'derived'])
export const COMMIT_STATES = Object.freeze(['success', 'error', 'aborted', 'denied', 'superseded'])
export const RASTER_MEDIA_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
export const BLOB_MEDIA_TYPE = 'application/octet-stream'

const OUTCOME_TO_COMMIT = Object.freeze({
  error: 'error',
  unavailable: 'error',
  denied: 'denied',
  aborted: 'aborted',
  superseded: 'superseded',
})

const SENSITIVE_TEXT = /(?:https?:\/\/|ftp:\/\/|file:\/\/|\b[^/\s:@]+:[^/\s@]+@|\b(?:password|passwd|secret|token|credential|authorization|api[-_]?key)\b\s*[:=]|\b(?:bearer|basic)\s+[a-z0-9+/=._~-]+)/i

function containsSensitiveText(value) {
  return typeof value === 'string' && SENSITIVE_TEXT.test(value)
}

export function isSafePublicText(value) {
  return typeof value === 'string' && value.length <= 255 && !containsSensitiveText(value)
}

/** Freeze record-shaped values without attempting to freeze typed arrays. */
export function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value
  seen.add(value)
  for (const key of Object.keys(value)) deepFreeze(value[key], seen)
  try { Object.freeze(value) } catch { /* typed host objects remain copies */ }
  return value
}

export function copyBytes(value) {
  if (value instanceof Uint8Array) return new Uint8Array(value)
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0))
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))
  return null
}

export function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

export function opaqueId(prefix = 'record') {
  return `${prefix}:${randomUUID()}`
}

function boundedMessage(message, fallback = 'attachment operation failed') {
  const value = typeof message === 'string' && message.trim() ? message.trim() : fallback
  if (containsSensitiveText(value)) return fallback
  return value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 240)
}

/** Build a frozen typed result. `status` is the caller-facing failure class. */
export function failure(status, code, message, details) {
  const normalizedStatus = OUTCOME_TO_COMMIT[status] ? status : 'error'
  const safeCode = typeof code === 'string' && !containsSensitiveText(code)
    ? code.slice(0, 96)
    : 'ATTACHMENT_OPERATION_FAILED'
  const result = {
    status: normalizedStatus,
    commitState: OUTCOME_TO_COMMIT[normalizedStatus],
    error: {
      code: safeCode,
      message: boundedMessage(message),
    },
  }
  if (details && typeof details === 'object') {
    const safe = {}
    for (const key of ['source', 'operationId', 'scope', 'ownerId', 'generation']) {
      if (typeof details[key] === 'string' && !containsSensitiveText(details[key])) safe[key] = details[key].slice(0, 160)
    }
    if (Object.keys(safe).length) result.error.details = safe
  }
  return deepFreeze(result)
}

export function success(value) {
  return deepFreeze({ status: 'success', commitState: 'success', value })
}

export function validateFiniteNonNegativeMs(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

export function validatePositiveFiniteMs(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

export function validateScope(scope) {
  return typeof scope === 'string' && SCOPES.includes(scope)
}

export function validateIdentity(options = {}) {
  if (!options || typeof options !== 'object') return failure('unavailable', 'ATTACHMENT_IDENTITY_REQUIRED', 'ownerId, generation, and scope are required')
  if (typeof options.ownerId !== 'string' || options.ownerId.trim() === '') return failure('unavailable', 'ATTACHMENT_OWNER_REQUIRED', 'ownerId is required')
  if (typeof options.generation !== 'string' || options.generation.trim() === '') return failure('unavailable', 'ATTACHMENT_GENERATION_REQUIRED', 'generation is required')
  if (!isSafePublicText(options.ownerId) || !isSafePublicText(options.generation)) return failure('unavailable', 'ATTACHMENT_IDENTITY_INVALID', 'attachment identity contains sensitive or oversized text')
  if (!validateScope(options.scope)) return failure('unavailable', 'ATTACHMENT_SCOPE_REQUIRED', 'scope must be session, workspace, or profile')
  return null
}

export function sanitizeName(value) {
  if (value === undefined) return undefined
  if (typeof value !== 'string') return undefined
  const clean = value.replace(/[\\/]+/g, '/').split('/').pop().replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 255)
  if (containsSensitiveText(clean)) return undefined
  return clean || undefined
}

export function sourceProvenance(source, options = {}, observedAt = new Date().toISOString()) {
  const entry = {
    kind: source?.kind,
    observedAt,
  }
  if (options.hostAudit === true && source?.kind === 'file' && typeof source.path === 'string') {
    entry.displayPath = sanitizeName(source.path)
  }
  return deepFreeze([entry])
}

export function parseDataUri(uri) {
  if (typeof uri !== 'string') return failure('error', 'ATTACHMENT_SOURCE_INVALID', 'data URI must be a string')
  const match = /^data:([^;,\s]+)(;base64)?,([\s\S]*)$/i.exec(uri)
  if (!match) return failure('error', 'ATTACHMENT_DATA_URI_INVALID', 'data URI is malformed')
  const mediaType = match[1].toLowerCase()
  try {
    const data = match[2]
      ? new Uint8Array(Buffer.from(match[3], 'base64'))
      : new Uint8Array(Buffer.from(decodeURIComponent(match[3]), 'utf8'))
    return { mediaType, data }
  } catch {
    return failure('error', 'ATTACHMENT_DATA_URI_INVALID', 'data URI payload is malformed')
  }
}

export function normalizeMediaType(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : undefined
}

export function isTimedMedia(mediaType) {
  return typeof mediaType === 'string' && (mediaType.startsWith('audio/') || mediaType.startsWith('video/'))
}

export function isRasterMedia(mediaType) {
  return RASTER_MEDIA_TYPES.includes(mediaType)
}

export function validateDurationPolicy({ maxDurationMs, observedDurationMs } = {}) {
  if (!Object.prototype.hasOwnProperty.call(arguments[0] ?? {}, 'maxDurationMs') || maxDurationMs === undefined) {
    return failure('unavailable', 'ATTACHMENT_MEDIA_UNSUPPORTED', 'timed media requires a configured duration limit')
  }
  if (!validateFiniteNonNegativeMs(maxDurationMs)) {
    return failure('unavailable', 'ATTACHMENT_POLICY_INVALID', 'maxDurationMs must be a finite non-negative millisecond value')
  }
  if (!validateFiniteNonNegativeMs(observedDurationMs)) {
    return failure('unavailable', 'ATTACHMENT_MEDIA_UNSUPPORTED', 'approved decoder metadata must provide a finite non-negative duration')
  }
  if (observedDurationMs > maxDurationMs) {
    return failure('denied', 'ATTACHMENT_DURATION_TOO_LONG', 'media duration exceeds the configured limit')
  }
  return null
}

export function effectiveMinimum(...values) {
  const present = values.filter((value) => value !== undefined)
  if (present.some((value) => typeof value !== 'number' || !Number.isFinite(value))) return Number.NaN
  return present.length ? Math.min(...present) : undefined
}

export function effectiveTransformPolicy(pipelinePolicy = {}, operationPolicy = {}, caller = {}) {
  const policy = {
    maxBytes: effectiveMinimum(pipelinePolicy.maxBytes, operationPolicy.maxBytes, caller.maxBytes),
    deadlineMs: effectiveMinimum(pipelinePolicy.deadlineMs, operationPolicy.deadlineMs, caller.deadlineMs),
    concurrency: effectiveMinimum(pipelinePolicy.concurrency, operationPolicy.concurrency, caller.concurrency),
    maxDurationMs: effectiveMinimum(pipelinePolicy.maxDurationMs, operationPolicy.maxDurationMs, caller.maxDurationMs),
  }
  if (policy.maxBytes !== undefined && (!Number.isFinite(policy.maxBytes) || policy.maxBytes <= 0)) return null
  if (policy.deadlineMs !== undefined && (!validatePositiveFiniteMs(policy.deadlineMs))) return null
  if (policy.concurrency !== undefined && (!Number.isInteger(policy.concurrency) || policy.concurrency <= 0)) return null
  if (policy.maxDurationMs !== undefined && !validateFiniteNonNegativeMs(policy.maxDurationMs)) return null
  return deepFreeze(policy)
}

/**
 * Persist only the finite, effective transform limits.  Provenance is public
 * audit data, so it must not contain arbitrary caller objects or unbounded
 * strings while still explaining which policy governed publication.
 */
export function transformPolicyEvidence(policy = {}) {
  const evidence = {}
  for (const key of ['maxBytes', 'deadlineMs', 'concurrency', 'maxDurationMs']) {
    if (typeof policy[key] === 'number' && Number.isFinite(policy[key])) evidence[key] = policy[key]
  }
  return deepFreeze(evidence)
}

export function transformPolicyFailure() {
  return failure('unavailable', 'ATTACHMENT_POLICY_INVALID', 'transform policy is invalid')
}

export function validateTransformRegistration(capability) {
  if (!capability || typeof capability !== 'object') return failure('unavailable', 'ATTACHMENT_TRANSFORM_INVALID', 'transform capability is invalid')
  if (typeof capability.id !== 'string' || !capability.id.trim()) return failure('unavailable', 'ATTACHMENT_TRANSFORM_INVALID', 'transform id is required')
  if (typeof capability.ownerId !== 'string' || !capability.ownerId.trim()) return failure('unavailable', 'ATTACHMENT_OWNER_REQUIRED', 'transform ownerId is required')
  if (typeof capability.generation !== 'string' || !capability.generation.trim()) return failure('unavailable', 'ATTACHMENT_GENERATION_REQUIRED', 'transform generation is required')
  if (typeof capability.run !== 'function') return failure('unavailable', 'ATTACHMENT_TRANSFORM_INVALID', 'transform run must be a function')
  if (!Array.isArray(capability.mediaTypes) || capability.mediaTypes.length === 0 || capability.mediaTypes.some((type) => typeof type !== 'string')) {
    return failure('unavailable', 'ATTACHMENT_TRANSFORM_INVALID', 'transform mediaTypes are required')
  }
  const policy = effectiveTransformPolicy({}, capability.policy ?? {})
  if (!policy) return transformPolicyFailure()
  return null
}

export function admissionEvidence(value) {
  if (!value || typeof value !== 'object') return null
  const keys = Object.keys(value).sort()
  if (keys.join('\u0000') !== ['accepted', 'observedAt', 'source'].join('\u0000')) return null
  if (typeof value.accepted !== 'boolean' || typeof value.source !== 'string' || typeof value.observedAt !== 'string' || containsSensitiveText(value.source) || containsSensitiveText(value.observedAt)) return null
  return deepFreeze({ accepted: value.accepted, source: value.source.slice(0, 160), observedAt: value.observedAt.slice(0, 80) })
}

export function createRecord({ ownerId, generation, scope, attachmentId, media, name, origin, parent, operation, sourceProvenance: provenance, commitState = 'success', createdAt = new Date().toISOString(), recordId = opaqueId('record') }) {
  const identityFailure = validateIdentity({ ownerId, generation, scope })
  if (identityFailure) return identityFailure
  if (typeof attachmentId !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(attachmentId)) return failure('error', 'ATTACHMENT_ID_INVALID', 'attachmentId must be a sha256 digest')
  if (!media || typeof media.mediaType !== 'string' || !Number.isInteger(media.bytes) || media.bytes < 0) return failure('error', 'ATTACHMENT_MEDIA_INVALID', 'attachment media metadata is invalid')
  if (!ORIGINS.includes(origin)) return failure('error', 'ATTACHMENT_ORIGIN_INVALID', 'origin must be original or derived')
  if (!COMMIT_STATES.includes(commitState)) return failure('error', 'ATTACHMENT_COMMIT_STATE_INVALID', 'commitState is not in the frozen vocabulary')
  const record = {
    recordId: String(recordId),
    ownerId,
    generation,
    scope,
    attachmentId,
    media: { ...media },
    origin,
    sourceProvenance: Array.isArray(provenance) ? provenance.map((item) => ({ ...item })) : [],
    commitState,
    createdAt,
  }
  const cleanName = sanitizeName(name)
  if (cleanName) record.name = cleanName
  if (parent && isSafePublicText(String(parent.recordId)) && isSafePublicText(String(parent.generation))) {
    record.parent = { recordId: String(parent.recordId), generation: String(parent.generation) }
  }
  if (operation && isSafePublicText(String(operation.id)) && isSafePublicText(String(operation.ownerId))) {
    record.operation = { id: String(operation.id), ownerId: String(operation.ownerId) }
  }
  return deepFreeze(record)
}

export function clonePublicRecord(record) {
  if (!record || typeof record !== 'object') return undefined
  return deepFreeze(JSON.parse(JSON.stringify(record)))
}
