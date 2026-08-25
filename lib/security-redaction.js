/**
 * Pure redaction engine for `pluginApi.security.redaction`.
 *
 * Zero harness dependencies by design: given a content tree, a requested
 * audience set, and registered rules, it returns the transformed tree plus
 * marker/count provenance so consumers always know redaction occurred
 * without ever receiving partially unprotected content (fail-closed).
 *
 * Coverage boundary (declared per design / coverage boundary):
 * - nested plain objects and arrays: recursive; cycles degrade to a marker;
 * - strings: matched by rules in registration order; first match wins per
 *   node (deterministic combination, no silent overwrite);
 * - binary/buffer (Buffer/ArrayBuffer/typed arrays/DataView): substituted by
 *   a `redacted:binary` marker at the metadata layer without deep reading;
 * - exception causes: expanded one level from an error object;
 * - MCP resource content arrives as untrusted text and passes through the
 *   same string rules;
 * - the facade calls this engine only for the model/ui content channel
 *   (result rewrite); 'log'/'debug'-only rules are not consulted by that
 *   channel (the log face carries summary counts through the audit record).
 *   The engine itself applies any audience set passed in, so future log/
 *   debug consumers may reuse it directly.
 * - any undeclared/unreadable node (function, symbol, Map/Set, throwing
 *   getter, broken nesting) is conservatively replaced by a
 *   `redacted:unreadable` marker until declared (coverage boundary): fail-closed, the
 *   rest of the tree stays intact. An entirely unstructureable root degrades
 *   to a whole-tree marker.
 *
 * Secret gate (user/profile policy plane): an `expose` rule whose material is
 * secret-shaped, or whose declaration allows touching secrets, is subject to
 * the user/profile secret policy (v1 binds the fixed default-deny plane). A
 * denied exposure keeps the secret redacted across all audiences
 * (`redacted:<ruleId>` marker) and is reported as blocked (count only, never
 * the value). Secret-shaped material is treated under the secret constraint
 * even when a rule was registered for a narrower audience. `redact` is the
 * protective direction and never needs the gate.
 */

const BINARY_TYPES = new Set(['Uint8Array', 'Uint8ClampedArray', 'Int8Array', 'Uint16Array', 'Int16Array', 'Uint32Array', 'Int32Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array', 'Buffer', 'ArrayBuffer', 'SharedArrayBuffer', 'DataView'])

/** Conservative secret-shape heuristics (credentials, keys, tokens). */
const SECRET_VALUE_PATTERN =
  /(Bearer\s+[A-Za-z0-9._~+/=-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|sk-[A-Za-z0-9_-]{12,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|(?:api[_-]?key|password|passphrase|secret|token|authorization|credential|private[_-]?key)["' ]*[:=]["' ]*[A-Za-z0-9._~+/=-]{8,})/i

/** Secret-shaped object keys (matches at path/token boundaries). */
const SECRET_KEY_PATTERN =
  /([-_]|^)(secret|token|authorization|credential|password|passphrase|api[_-]?key|apikey|private[_-]?key|cookie|auth)([-_]|$)/i

const MARKER_REDACTED = 'redacted'
const MARKER_BINARY = 'redacted:binary'
const MARKER_UNREADABLE = 'redacted:unreadable'

export function isSecretShapedKey(key) {
  return typeof key === 'string' && SECRET_KEY_PATTERN.test(key)
}

export function isSecretShapedString(value) {
  return typeof value === 'string' && SECRET_VALUE_PATTERN.test(value)
}

function isBinary(value) {
  if (value === null || typeof value !== 'object') return false
  const ctor = value.constructor
  if (typeof ctor !== 'function') return false
  const name = ctor.name
  if (!BINARY_TYPES.has(name)) return false
  return typeof value.byteLength === 'number' || name === 'DataView'
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function isErrorLike(value) {
  return value instanceof Error || (value !== null && typeof value === 'object' && typeof value.message === 'string' && value.stack !== undefined)
}

function ruleApplies(rule, audiences) {
  if (!Array.isArray(rule.audiences) || rule.audiences.length === 0) return false
  return rule.audiences.some((audience) => audiences.includes(audience))
}

/**
 * Walk one node. `state` carries counters and the cycle guard; `causeDepth`
 * limits exception-cause expansion to one level.
 */
function walkNode(value, rules, audiences, secretGate, state, causeDepth = 0) {
  if (value === null || value === undefined) return value
  const type = typeof value
  if (type === 'string') return applyStringRules(value, rules, audiences, secretGate, state)
  if (type === 'number' || type === 'boolean' || type === 'bigint') return value
  if (type !== 'object') {
    // functions/symbols: undeclared, fail-closed marker
    state.markers.unreadable += 1
    return MARKER_UNREADABLE
  }

  if (isBinary(value)) {
    state.markers.binary += 1
    return MARKER_BINARY
  }

  if (state.seen.has(value)) {
    state.markers.unreadable += 1
    return MARKER_UNREADABLE
  }
  state.seen.add(value)

  const isError = isErrorLike(value)
  if (!isPlainObject(value) && !isError && !Array.isArray(value)) {
    // Map/Set/Date/URL/proxy/exotic: undeclared, fail-closed marker
    state.markers.unreadable += 1
    state.seen.delete(value)
    return MARKER_UNREADABLE
  }

  try {
    if (Array.isArray(value)) {
      const out = []
      for (const item of value) {
        out.push(walkNode(item, rules, audiences, secretGate, state, causeDepth))
      }
      state.seen.delete(value)
      return out
    }

    const out = {}
    // Error's `message` is non-enumerable; walk it explicitly alongside the
    // enumerable own keys. The exception boundary expands `cause` exactly one
    // level: deeper causes are opaque (conservative marker).
    const keys = isError ? ['message', ...Object.keys(value)] : Object.keys(value)
    for (const key of keys) {
      let child
      try {
        child = value[key]
      } catch {
        state.markers.unreadable += 1
        child = MARKER_UNREADABLE
      }
      if (isError && key === 'cause') {
        if (causeDepth === 0) {
          out[key] = walkNode(child, rules, audiences, secretGate, state, causeDepth + 1)
        } else {
          state.markers.unreadable += 1
          out[key] = MARKER_UNREADABLE
        }
      } else {
        out[key] = walkNode(child, rules, audiences, secretGate, state, causeDepth)
      }
    }
    state.seen.delete(value)
    return out
  } catch {
    // node-level failure: fail closed for this node only, siblings survive
    state.markers.unreadable += 1
    state.seen.delete(value)
    return MARKER_UNREADABLE
  }
}

function applyStringRules(value, rules, audiences, secretGate, state) {
  // already-processed markers are final (idempotent convergence): no rule may
  // re-wrap or expose a previously redacted node
  if (value.startsWith(`${MARKER_REDACTED}:`)) return value
  const applicable = rules.filter((rule) => ruleApplies(rule, audiences))
  if (applicable.length === 0) return value
  const rule = applicable.find((candidate) => {
    try {
      return candidate.match(value) === true
    } catch {
      // a failing matcher degrades to "no match" for this node
      return false
    }
  })
  if (!rule) return value

  const ruleId = rule.id ?? rule.ownerId ?? 'unknown'
  if (rule.action === 'redact') {
    state.applied.set(ruleId, (state.applied.get(ruleId) ?? 0) + 1)
    return `${MARKER_REDACTED}:${ruleId}`
  }

  // 'expose' direction: elevation is the plugin's own decision for non-secret
  // material, but secret-shaped material (or declared secret touching) is
  // subject to the user/profile secret policy (default deny).
  const touchesSecret = rule.mayTouchSecret === true || isSecretShapedString(value)
  if (!touchesSecret) {
    state.applied.set(ruleId, (state.applied.get(ruleId) ?? 0) + 1)
    return value
  }
  let decision = 'deny'
  try {
    decision = secretGate({ ruleId, ownerId: rule.ownerId, audience: audiences[0], material: value })
  } catch {
    decision = 'deny'
  }
  if (decision === 'allow') {
    state.applied.set(ruleId, (state.applied.get(ruleId) ?? 0) + 1)
    return value
  }
  state.blocked.set(ruleId, (state.blocked.get(ruleId) ?? 0) + 1)
  return `${MARKER_REDACTED}:${ruleId}`
}

/**
 * Apply registered rules to one content tree for the requested audiences.
 *
 * @param {object} input
 * @param {unknown} input.root content tree (tool result content, object,
 *   array, string, error, binary, ...)
 * @param {string[]} input.audiences audience set of this consumer channel
 * @param {Array<{id?: string, ownerId?: string, audiences: string[], match: (value: string) => boolean, action?: 'redact'|'expose', mayTouchSecret?: boolean}>} input.rules active redaction rules
 * @param {(ctx: {ruleId?: string, ownerId?: string, audience?: string, material: string}) => 'allow'|'deny'} [input.secretGate] user/profile secret policy (default deny)
 * @returns {{ content: unknown, applied: Array<{ruleId: string, count: number}>, blocked: Array<{ruleId: string, count: number}>, markers: { binary: number, unreadable: number } }}
 *   The transformed tree plus provenance counts. When no applicable
 *   rule exists the tree is returned unchanged with empty counts.
 */
export function applyRedaction({ root, audiences, rules = [], secretGate = () => 'deny' } = {}) {
  const state = {
    seen: new WeakSet(),
    applied: new Map(),
    blocked: new Map(),
    markers: { binary: 0, unreadable: 0 },
  }
  const applicableCount = rules.filter((rule) => ruleApplies(rule, audiences ?? [])).length
  let content
  if (applicableCount === 0) {
    content = root
  } else {
    try {
      content = walkNode(root, rules, audiences ?? [], secretGate, state)
    } catch {
      // entire input unstructureable: whole-tree substitution (fail-closed)
      content = MARKER_UNREADABLE
      state.markers.unreadable += 1
    }
  }
  return {
    content,
    applied: [...state.applied.entries()]
      .map(([ruleId, count]) => ({ ruleId, count }))
      .sort((a, b) => a.ruleId.localeCompare(b.ruleId)),
    blocked: [...state.blocked.entries()]
      .map(([ruleId, count]) => ({ ruleId, count }))
      .sort((a, b) => a.ruleId.localeCompare(b.ruleId)),
    markers: { binary: state.markers.binary, unreadable: state.markers.unreadable },
  }
}