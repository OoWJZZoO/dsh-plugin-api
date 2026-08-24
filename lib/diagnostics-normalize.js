/**
 * Pure diagnostics vocabulary validation and fail-closed redaction helpers
 * for the plugin-diagnostics projection (`pluginApi.diagnostics`).
 *
 * Deliberately dependency-free (zero imports) and state-free so it can be
 * unit-tested without a cordis/harness context. Every function reduces a plain
 * value to a bounded, classifiable form; a value that cannot be trusted is
 * replaced by a `[redacted]`/`[bounded]` marker instead of leaking raw content
 * (fail-closed). The host owner composes the final frozen snapshot from these
 * primitives.
 */

export const SCOPE_VALUES = Object.freeze(['boot', 'host', 'client', 'plugin'])
export const HEALTH_VALUES = Object.freeze(['healthy', 'degraded', 'failed', 'pending', 'unknown'])
export const AVAILABILITY_VALUES = Object.freeze(['active', 'degraded-active', 'inactive', 'unavailable', 'unknown'])
export const SEVERITY_VALUES = Object.freeze(['info', 'warning', 'error', 'critical'])
export const BLOCKING_VALUES = Object.freeze(['blocking', 'non-blocking', 'unknown'])
export const UNCERTAINTY_VALUES = Object.freeze(['observed', 'inferred', 'unavailable'])
export const REMEDIATION_MODES = Object.freeze(['manual', 'informational'])

/** Allow-listed bounded evidence fields (design §Data Models). */
const EVIDENCE_KEYS = Object.freeze(['package', 'version', 'runtime', 'capability'])
/** Allow-listed reason fields. */
const REASON_KEYS = Object.freeze(['code', 'category', 'boundedDetail'])
/** Allow-listed remediation fields. */
const REMEDIATION_KEYS = Object.freeze(['actionId', 'prerequisite', 'mode'])
/** Allow-listed dependency fields. */
const DEPENDENCY_KEYS = Object.freeze(['id', 'status', 'evidence'])

/** Key names that are secrets by name, matching at path or token boundaries. */
const SECRET_KEY_PATTERN =
  /([-_]|^)(secret|token|authorization|credential|password|passphrase|api[_-]?key|apikey|private[_-]?key|cookie|auth)([-_]|$)/i

/** Value-shaped credentials: bearer tokens, PEM private keys, sk-* keys. */
const CREDENTIAL_VALUE_PATTERN =
  /(Bearer\s+[A-Za-z0-9._~+/=-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|sk-[A-Za-z0-9_-]{8,})/i

export const MAX_DETAIL_CHARS = 200
export const MAX_REDACTION_DEPTH = 3

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/** True when a key name marks its value as a secret regardless of content. */
export function isSecretKey(key) {
  return typeof key === 'string' && SECRET_KEY_PATTERN.test(key)
}

/**
 * Recursively redact an arbitrary value: secret-named keys, credential-shaped
 * strings, and non-plain objects are replaced by bounded markers; nesting is
 * depth-capped; a throwing getter/proxy fails closed to `[redaction-failed]`.
 */
export function redactValue(value, depth = 0) {
  if (depth > MAX_REDACTION_DEPTH) return '[bounded]'
  try {
    if (value === null) return null
    const type = typeof value
    if (type === 'string') return CREDENTIAL_VALUE_PATTERN.test(value) ? '[redacted]' : value
    if (type === 'number' || type === 'boolean' || type === 'bigint') return value
    if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1))
    if (isPlainObject(value)) {
      const out = {}
      for (const key of Object.keys(value)) {
        try {
          out[key] = isSecretKey(key) ? '[redacted]' : redactValue(value[key], depth + 1)
        } catch {
          // a throwing getter/proxy fails closed for that value only
          out[key] = '[redaction-failed]'
        }
      }
      return out
    }
    // functions/symbols/regexps/dates/proxies are never safe to project.
    return '[bounded]'
  } catch {
    return '[redaction-failed]'
  }
}

/**
 * Bound a free-text detail: collapse line breaks, cap length. Returns
 * `undefined` when the input is not a usable string.
 */
export function sanitizeDetail(text) {
  if (typeof text !== 'string') return undefined
  const single = text.replace(/[\r\n\u2028\u2029]+/g, ' ').trim()
  if (single === '') return undefined
  return single.length > MAX_DETAIL_CHARS ? `${single.slice(0, MAX_DETAIL_CHARS)}…` : single
}

/** Keep only the allow-listed bounded evidence fields, redacted. */
export function redactEvidence(value) {
  if (!isPlainObject(value)) return undefined
  const out = {}
  for (const key of EVIDENCE_KEYS) {
    const item = value[key]
    if (item === undefined) continue
    out[key] = redactValue(item, 1)
  }
  return Object.keys(out).length === 0 ? undefined : out
}

/** Keep only allow-listed reason fields, with a bounded detail. */
export function redactReason(value) {
  if (!isPlainObject(value)) return undefined
  const code = typeof value.code === 'string' && value.code.trim() !== '' ? value.code.trim() : undefined
  if (!code) return undefined
  const out = { code }
  const category = typeof value.category === 'string' && value.category.trim() !== '' ? value.category.trim() : undefined
  if (category !== undefined) out.category = category
  const detail = sanitizeDetail(value.boundedDetail)
  if (detail !== undefined) out.boundedDetail = detail
  return out
}

/** Keep only allow-listed remediation fields; invalid mode defaults safely. */
export function redactRemediation(value) {
  if (!isPlainObject(value)) return undefined
  const actionId = typeof value.actionId === 'string' && value.actionId.trim() !== '' ? value.actionId.trim() : undefined
  if (!actionId) return undefined
  const mode = REMEDIATION_MODES.includes(value.mode) ? value.mode : 'informational'
  const out = { actionId, mode }
  const prerequisite = sanitizeDetail(value.prerequisite)
  if (prerequisite !== undefined) out.prerequisite = prerequisite
  return out
}

/** Normalize a dependency summary array into bounded {id, status, evidence?}. */
export function redactDependencies(value) {
  if (!Array.isArray(value)) return undefined
  const deps = []
  for (const item of value) {
    if (!isPlainObject(item)) continue
    const id = typeof item.id === 'string' && item.id.trim() !== '' ? item.id.trim() : undefined
    if (!id) continue
    const dep = { id, status: typeof item.status === 'string' && item.status !== '' ? item.status : 'unknown' }
    const evidence = redactEvidence(item.evidence)
    if (evidence !== undefined) dep.evidence = evidence
    deps.push(dep)
  }
  return deps.length === 0 ? undefined : deps
}

/**
 * Validate and coerce a probe result into a report of bounded vocabulary.
 *
 * A non-object / undefined / null result or any out-of-vocabulary primary
 * field makes the whole report invalid (the host then marks only that check
 * failed/unavailable with `reason.code === 'invalid-result'`). Missing fields
 * get neutral defaults — never a healthy claim.
 */
export function classifyReport(value) {
  if (!isPlainObject(value)) return { invalid: true }
  const pick = (key, values, fallback) => {
    if (value[key] === undefined) return { value: fallback }
    if (!values.includes(value[key])) return { invalid: true }
    return { value: value[key] }
  }
  const health = pick('health', HEALTH_VALUES, 'unknown')
  if (health.invalid) return { invalid: true }
  const availability = pick('availability', AVAILABILITY_VALUES, 'unknown')
  if (availability.invalid) return { invalid: true }
  const severity = pick('severity', SEVERITY_VALUES, 'info')
  if (severity.invalid) return { invalid: true }
  const blocking = pick('blocking', BLOCKING_VALUES, 'unknown')
  if (blocking.invalid) return { invalid: true }
  const uncertainty = pick('uncertainty', UNCERTAINTY_VALUES, 'inferred')
  if (uncertainty.invalid) return { invalid: true }

  const report = {
    health: health.value,
    availability: availability.value,
    severity: severity.value,
    blocking: blocking.value,
    uncertainty: uncertainty.value,
  }
  const evidence = redactEvidence(value.evidence)
  if (evidence !== undefined) report.evidence = evidence
  const reason = redactReason(value.reason)
  if (reason !== undefined) report.reason = reason
  const remediation = redactRemediation(value.remediation)
  if (remediation !== undefined) report.remediation = remediation
  return { report }
}
