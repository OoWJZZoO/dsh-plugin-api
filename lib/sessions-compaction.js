import { parseFacadeVersion } from './version.js'

/**
 * Controlled compaction operation (`sessions.compaction`), core module.
 *
 * The compaction engine stays the single mutation owner and fact producer:
 * this module resolves the marker/version gate over the replacement provider's
 * operation sub-face (it never imports the auxiliary package — the shared
 * `Symbol.for` literals are the whole contract), maps the sub-face's
 * discriminated outcome onto the public operation result, and validates the
 * invocation before any engine call.
 */

/** Sole contract symbol of the compaction replacement bundle. */
export const COMPACTION_EVENTS_CONTRACT_MARKER = Symbol.for('dsh-plugin-api.compaction-events.contract')
/** Operation sub-face marker published by the replacement provider. */
export const COMPACTION_OPERATION_MARKER = Symbol.for('dsh-plugin-api.compaction-events.operation')
/** The official row the replacement stands in for. */
export const COMPACTION_OFFICIAL_ROW_ID = 'compaction-basic'
export const COMPACTION_OFFICIAL_ROW_NAME = '@deepseek-ai/dsh-compaction-basic'
const REPLACEMENT_ROW_ID = 'plugin-api-compaction-events'

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)
const isInteger = (value) => Number.isInteger(value)

/**
 * Resolve the four declared gate conditions.
 *
 * @param {object} input
 * @param {object} input.ctx - plugin context (loader + service access)
 * @param {object|undefined} input.auxiliaryManifest - the replacement package manifest
 * @param {object|undefined} input.facadeContract - `{ runtime, api }` of this facade
 * @param {function} [input.readVersion] - version parser seam (test)
 * @returns {{ ok: boolean, reason?: string, versionMismatch?: boolean }}
 */
export function resolveCompactionGate({ ctx, auxiliaryManifest, facadeContract, readVersion } = {}) {
  const parse = typeof readVersion === 'function' ? readVersion : parseFacadeVersion
  const parsed = parse(auxiliaryManifest?.version)
  const api = typeof auxiliaryManifest?.api === 'string' ? auxiliaryManifest.api.trim() : undefined
  const versionOk = Boolean(parsed) && Boolean(facadeContract) && api === facadeContract.api
    && parsed.runtime === facadeContract.runtime && parsed.api === facadeContract.api
  if (!versionOk) {
    return Object.freeze({ ok: false, versionMismatch: true, reason: 'the compaction replacement package version does not match the main facade contract' })
  }

  let entries
  try {
    const loader = typeof ctx?.get === 'function' ? ctx.get('loader') : ctx?.loader
    entries = typeof loader?.entries === 'function' ? loader.entries() : []
  } catch {
    entries = []
  }
  let replacementActive = false
  let officialRowPresent = false
  let officialRowDisabled = false
  try {
    for (const entry of entries ?? []) {
      const options = entry?.options ?? {}
      if (options.id === REPLACEMENT_ROW_ID) replacementActive = true
      if (options.id === COMPACTION_OFFICIAL_ROW_ID) {
        officialRowPresent = true
        officialRowDisabled = Boolean(entry?.disabled)
      }
    }
  } catch {
    return Object.freeze({ ok: false, reason: 'the loader composition cannot be inspected' })
  }
  if (!replacementActive) {
    return Object.freeze({ ok: false, reason: 'the compaction replacement row is not active' })
  }
  if (officialRowPresent && !officialRowDisabled) {
    return Object.freeze({ ok: false, reason: 'the official compaction row is still enabled; the replacement is standing by' })
  }

  let provider
  try {
    provider = typeof ctx?.get === 'function' ? ctx.get('compaction') : undefined
  } catch {
    provider = undefined
  }
  if (!provider || provider[COMPACTION_EVENTS_CONTRACT_MARKER] !== true) {
    return Object.freeze({ ok: false, reason: 'the mounted compaction provider does not carry the replacement contract marker' })
  }
  if (provider[COMPACTION_OPERATION_MARKER] !== true || !isPlainObject(provider.operation) || typeof provider.operation.run !== 'function') {
    return Object.freeze({ ok: false, reason: 'the mounted compaction provider does not expose the operation sub-face' })
  }
  return Object.freeze({ ok: true, provider, subface: provider.operation })
}

const frozen = (value) => Object.freeze(value)

/** Map one sub-face outcome onto the frozen public operation result. */
export function mapCompactionOutcome(outcome) {
  if (!isPlainObject(outcome)) {
    return frozen({ ok: false, code: 'internal', terminal: 'error', reason: 'the compaction provider returned an unexpected outcome shape' })
  }
  switch (outcome.kind) {
    case 'compacted':
      return frozen({
        ok: true,
        code: 'compacted',
        terminal: 'success',
        outcome: 'compacted',
        lineage: outcome.lineage,
      })
    case 'skipped':
      return frozen({
        ok: true,
        code: 'no-candidate',
        terminal: 'success',
        outcome: 'skipped',
        reason: 'no safe useful range is available to compact',
      })
    case 'rejected':
      return frozen({
        ok: false,
        code: 'rejected',
        terminal: 'denied',
        reason: typeof outcome.reason === 'string' && outcome.reason.length > 0 ? outcome.reason : 'rejected',
      })
    case 'aborted':
      return frozen({ ok: false, code: 'aborted', terminal: 'aborted' })
    case 'failed':
      return frozen({
        ok: false,
        code: typeof outcome.code === 'string' && outcome.code.length > 0 ? outcome.code : 'internal',
        terminal: 'error',
        ...(outcome.stage === undefined ? {} : { stage: outcome.stage }),
      })
    default:
      return frozen({ ok: false, code: 'internal', terminal: 'error', reason: 'the compaction provider returned an unknown outcome kind' })
  }
}

/**
 * Validate the invocation before any engine call. Returns a frozen typed
 * result for a refusal, or `null` when the invocation may proceed.
 */
export function validateCompactionRunOptions(options, resolveAgent) {
  if (!isPlainObject(options)) {
    return frozen({ ok: false, code: 'invalid-arguments', terminal: 'error', reason: 'the compaction options must be an object' })
  }
  const agent = options.agent
  const live = typeof resolveAgent === 'function' ? resolveAgent(agent) : undefined
  if (!isPlainObject(agent) || !isPlainObject(agent.session) || live === undefined || live === null) {
    return frozen({ ok: false, code: 'invalid-target', terminal: 'error', reason: 'the target agent reference does not resolve to a live agent' })
  }
  if (options.mode !== 'now' && options.mode !== 'range') {
    return frozen({ ok: false, code: 'invalid-arguments', terminal: 'error', reason: 'the compaction mode must be "now" or "range"' })
  }
  if (options.mode === 'range') {
    const range = options.range
    if (!isPlainObject(range) || !isInteger(range.start) || !isInteger(range.end)) {
      return frozen({ ok: false, code: 'invalid-range', terminal: 'error', reason: 'the range mode requires integer start and end surface seqs' })
    }
    if (range.start > range.end) {
      return frozen({ ok: false, code: 'invalid-range', terminal: 'error', reason: 'the range start must not be after its end' })
    }
  }
  if (options.sourceCommandId !== undefined && typeof options.sourceCommandId !== 'string') {
    return frozen({ ok: false, code: 'invalid-arguments', terminal: 'error', reason: 'the sourceCommandId must be a string' })
  }
  return null
}
