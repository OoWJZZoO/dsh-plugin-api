/**
 * Pure event-contract helpers for the `@deepseek-ai/dsh-plugin-api-session-title`
 * replacement replacement bundle. Zero harness dependencies: no Cordis, no DSH
 * service, no import from the main facade package, and no import from the
 * vendored fork, so this module stays independently testable as an independent
 * event contract.
 *
 * Responsibilities:
 * - the canonical `session-title/candidate` event name;
 * - decision validation for the candidate eligibility waterfall
 *;
 * - immutable payload snapshots: `message` and its nested `source` are
 *   deep-frozen while `agent`/`session` stay live references
 *;
 * - replacement-reference resolution against the session log
 *;
 * - redacted diagnostic construction (design Error Handling: no candidate
 *   text, no title text, no session content, and no reason string).
 */

export const SESSION_TITLE_CANDIDATE = 'session-title/candidate'

/** Decision stages a `session-title/candidate` listener may produce. */
export const DECISION = Object.freeze({
  proceed: 'proceed',
  exclude: 'exclude',
  replace: 'replace',
  malformed: 'malformed',
})

function isPlainRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether `value` is a thenable (has a `then` function). */
export function isThenable(value) {
  return value != null && typeof value.then === 'function'
}

/**
 * Converge an async rejection from a listener that returned a thenable without
 * letting it become an unhandled rejection. Returns `true` when `value` was a
 * thenable and a rejection handler was attached.
 *
 * @param {unknown} value
 * @param {(error: unknown) => void} [onRejected]
 * @returns {boolean}
 */
export function convergeThenable(value, onRejected = () => {}) {
  if (!isThenable(value)) return false
  Promise.resolve(value).then(undefined, (error) => {
    try {
      onRejected(error)
    } catch {
      // the convergence callback must never throw
    }
  })
  return true
}

/**
 * Interpret the result of the `session-title/candidate` waterfall.
 *
 * `undefined` means the chain made no decision (proceed). An `exclude` decision
 * carries an optional string reason. A `replace` decision references the
 * `{ seq }` identity of the message to use in place of the candidate
 *. A thenable or any other
 * shape is `malformed`; callers SHALL treat `malformed` as no decision,
 * converge the thenable, and log one redacted diagnostic
 *.
 *
 * @param {unknown} value
 * @returns {{kind:'proceed'}|{kind:'exclude', reason?: string}|{kind:'replace', message:{seq:number}, reason?: string}|{kind:'malformed', thenable?: boolean}}
 */
export function decideSessionTitleCandidate(value) {
  if (value === undefined) return { kind: DECISION.proceed }
  if (isThenable(value)) return { kind: DECISION.malformed, thenable: true }
  if (!isPlainRecord(value)) return { kind: DECISION.malformed }
  if (value.kind === 'exclude') {
    if (value.reason !== undefined && typeof value.reason !== 'string') return { kind: DECISION.malformed }
    return { kind: DECISION.exclude, ...(value.reason === undefined ? {} : { reason: value.reason }) }
  }
  if (value.kind === 'replace') {
    const message = value.message
    if (!isPlainRecord(value.message)) return { kind: DECISION.malformed }
    const seq = message.seq
    if (!Number.isSafeInteger(seq) || seq < 0) return { kind: DECISION.malformed }
    if (value.reason !== undefined && typeof value.reason !== 'string') return { kind: DECISION.malformed }
    return { kind: DECISION.replace, message: { seq }, ...(value.reason === undefined ? {} : { reason: value.reason }) }
  }
  return { kind: DECISION.malformed }
}

function freezeDeep(value) {
  if (isPlainRecord(value)) {
    for (const key of Object.keys(value)) freezeDeep(value[key])
    return Object.freeze(value)
  }
  if (Array.isArray(value)) {
    for (const item of value) freezeDeep(item)
    return Object.freeze(value)
  }
  return value
}

/**
 * Build the immutable `session-title/candidate` payload. The `message` object
 * (with its nested `source`) is deep-frozen so no listener can mutate the
 * candidate through the payload; `agent` and `session` stay live references
 *. The payload object itself is also frozen.
 *
 * @param {unknown} agent - lazily resolved live agent reference (may be undefined).
 * @param {unknown} session - live session reference (deliberately NOT frozen).
 * @param {{seq: number, text: string, source?: object}} message - candidate snapshot.
 * @returns {Readonly<{agent: unknown, session: unknown, message: Readonly<{seq: number, text: string, source: Readonly<object>}>}>}
 */
export function buildSessionTitleCandidatePayload(agent, session, message) {
  if (!isPlainRecord(message)) throw new TypeError('session-title/candidate message snapshot must be a plain object')
  const frozenMessage = freezeDeep({
    ...message,
    source: freezeDeep({ ...(message.source ?? {}) }),
  })
  return Object.freeze({ agent, session, message: frozenMessage })
}

/**
 * Operating-system-command escape sequences, including unterminated tails.
 * These five control-character classes mirror the official
 * `dsh-session-title/lib/index.js` normalize module exactly.
 */
const OSC_SEQUENCE = /(?:\u001B\]|\u009D)(?:(?!\u0007|\u001B\\)[\s\S])*(?:\u0007|\u001B\\|$)/gu
/** Control-sequence-introducer escapes such as SGR color codes. */
const CSI_SEQUENCE = /(?:\u001B\[|\u009B)[0-?]*[ -/]*[@-~]/gu
/** Remaining two-byte ESC control sequences. */
const ESC_SEQUENCE = /\u001B[@-_]/gu
/** Non-whitespace C0/C1 control characters. */
const CONTROL_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu
/** Directional and invisible controls that can make a displayed title deceptive. */
const DIRECTIONAL_CONTROL = /[\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/gu

/** Remove controls and produce one trimmed, whitespace-normalized line (official `cleanTitleText` mirror). */
function cleanTitleText(input) {
  return input.replace(OSC_SEQUENCE, '')
    .replace(CSI_SEQUENCE, '')
    .replace(ESC_SEQUENCE, '')
    .replace(CONTROL_CHARACTER, '')
    .replace(DIRECTIONAL_CONTROL, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

/**
 * Whether a message text normalizes to non-empty under the official
 * normalization semantics (a title candidate must have visible text).
 * Pure mirror of `normalizeSessionTitle(text, Number.MAX_SAFE_INTEGER).length > 0`.
 * The vendored-fork tests cross-check this predicate against the official
 * `normalizeSessionTitle` (design Data Models).
 *
 * @param {unknown} text
 * @returns {boolean}
 */
export function isNonEmptyTitleText(text) {
  return typeof text === 'string' && cleanTitleText(text).length > 0
}

/**
 * Extract the joined text-block content of a user/message event in the exact
 * shape the official `collectSessionTitleMessages` uses.
 *
 * @param {unknown} event
 * @returns {string}
 */
export function extractTitleText(event) {
  const content = event?.data?.content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block?.type === 'text')
    .map((block) => block?.text ?? '')
    .join('\n')
}

/**
 * Resolve a `replace` decision's referenced message against the session log,
 * enforcing the official candidate invariants (design Data Models):
 * - the referenced seq must be a safe, non-negative integer;
 * - `session.events[seq]` must exist with `event.seq === seq`;
 * - the event must be a `user/message` with `source.kind === 'user'`;
 * - its normalized text must be non-empty;
 * - when this collection is bounded by `throughSeq`, `seq <= throughSeq`
 *   (keeping the official provider face "candidates are within the generation
 *   boundary" contract).
 * Resolution failure yields `undefined`; the caller keeps the original
 * candidate and logs one redacted diagnostic.
 *
 * @param {unknown} session - live session whose `.events` is the log.
 * @param {{seq: number}} message - the decision's referenced message identity.
 * @param {number | undefined} [throughSeq]
 * @param {(text: string) => boolean} [isEligible]
 * @returns {{seq: number, text: string} | undefined}
 */
export function resolveReplacement(session, message, throughSeq, isEligible = isNonEmptyTitleText) {
  if (!isPlainRecord(message)) return undefined
  const seq = message.seq
  if (!Number.isSafeInteger(seq) || seq < 0) return undefined
  const events = session?.events
  if (!Array.isArray(events) || seq >= events.length) return undefined
  const event = events[seq]
  if (event === undefined || event.seq !== seq) return undefined
  if (event.type !== 'user/message') return undefined
  if (event.data?.source?.kind !== 'user') return undefined
  if (throughSeq !== undefined && seq > throughSeq) return undefined
  const text = extractTitleText(event)
  if (!isEligible(text)) return undefined
  return { seq, text }
}

/**
 * Build a redacted decision diagnostic. Never includes candidate text, title
 * text, session content, or the reason string; only the event name, the
 * decision kind, and (optionally) the error class name are surfaced
 * (design Error Handling).
 *
 * @param {string} kind - one of the DECISION values.
 * @param {unknown} [error]
 * @returns {string}
 */
export function redactedDecisionMessage(kind, error) {
  const base = `session-title/candidate policy decision "${String(kind)}"`
  if (error === undefined) return base
  const name = typeof error?.name === 'string' && error.name.length > 0 ? error.name : 'Error'
  return `${base} contained: ${name}`
}
