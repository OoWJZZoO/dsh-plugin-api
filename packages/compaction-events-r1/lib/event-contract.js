/**
 * Pure event-contract helpers for the `@deepseek-ai/dsh-plugin-api-compaction-events`
 * R-class replacement bundle. Zero harness dependencies: no Cordis, no DSH service,
 * and no import from the main facade package, so the auxiliary package stays
 * independently installable (design C1/C5/C6).
 *
 * Responsibilities:
 * - canonical `compaction/*` trigger vocabulary;
 * - decision validation for the `compaction/request` policy waterfall;
 * - immutable payload snapshots that leave live `agent`/`session` references
 *   un-frozen while deep-freezing static sub-objects (requirements 5.13);
 * - redacted failure facts (requirements 5.10, design C6).
 */

export const COMPACTION_TRIGGERS = Object.freeze({
  pressure: 'pressure',
  'context-overflow': 'context-overflow',
  manual: 'manual',
  direct: 'direct',
})

export const COMPACTION_TRIGGER_VALUES = Object.freeze(Object.values(COMPACTION_TRIGGERS))

/** Whether `value` is one of the four canonical compaction triggers. */
export function isCompactionTrigger(value) {
  return COMPACTION_TRIGGER_VALUES.includes(value)
}

/** Decision stages a `compaction/request` listener may produce. */
export const DECISION = Object.freeze({
  proceed: 'proceed',
  reject: 'reject',
  replaceRange: 'replace-range',
  malformed: 'malformed',
})

function isPlainRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Interpret the result of the `compaction/request` waterfall.
 *
 * `undefined` means the chain made no decision (proceed). A `reject` decision
 * carries an optional string reason. A `replace-range` decision carries
 * inclusive integer seq boundaries with `start <= end`. Anything else is
 * returned as `malformed`; callers SHALL treat `malformed` as proceed while
 * logging one redacted diagnostic (design C5, requirements 5.6/5.7).
 *
 * @param {unknown} value
 * @returns {{kind:'proceed'}|{kind:'reject', reason?: string}|{kind:'replace-range', start:number, end:number}|{kind:'malformed'}}
 */
export function decideCompactionRequest(value) {
  if (value === undefined) return { kind: DECISION.proceed }
  if (!isPlainRecord(value)) return { kind: DECISION.malformed }
  if (value.kind === 'reject') {
    if (value.reason !== undefined && typeof value.reason !== 'string') return { kind: DECISION.malformed }
    return { kind: DECISION.reject, ...(value.reason === undefined ? {} : { reason: value.reason }) }
  }
  if (value.kind === 'replace-range') {
    const { start, end } = value
    if (!Number.isInteger(start) || !Number.isInteger(end)) return { kind: DECISION.malformed }
    if (start > end) return { kind: DECISION.malformed }
    return { kind: DECISION.replaceRange, start, end }
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
 * Freeze one immutable event payload snapshot. The payload object itself is
 * frozen; every value listed in `staticKeys` is deep-frozen. Keys not listed
 * (notably the live official `agent` and `session` references) are left as
 * live references per design C6 and requirements 5.13.
 *
 * @param {Record<string, unknown>} payload
 * @param {string[]} [staticKeys]
 * @returns {Readonly<Record<string, unknown>>}
 */
export function freezeCompactionPayload(payload, staticKeys = []) {
  if (!isPlainRecord(payload)) throw new TypeError('compaction event payload must be a plain object')
  for (const key of staticKeys) {
    if (key in payload) freezeDeep(payload[key])
  }
  return Object.freeze(payload)
}

/**
 * Build the redacted `failure` fact for the `compaction/failed` event.
 * Never includes message text, summary content, or stack traces (design D7).
 *
 * @param {{stage: 'summary'|'commit', error: unknown}} input
 * @returns {{stage: 'summary'|'commit', name: string, code?: string}}
 */
export function buildRedactedFailure({ stage, error }) {
  if (stage !== 'summary' && stage !== 'commit') {
    throw new TypeError(`buildRedactedFailure: stage must be "summary" or "commit", got ${String(stage)}`)
  }
  const name = (typeof error?.name === 'string' && error.name.length > 0) ? error.name : 'Error'
  const code = typeof error?.code === 'string' && error.code.length > 0 ? error.code : undefined
  return Object.freeze({
    stage,
    name,
    ...(code === undefined ? {} : { code }),
  })
}
