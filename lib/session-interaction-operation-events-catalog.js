/**
 * Replacement catalog slice: the `agent/attempt/start|end` attempt lifecycle
 * facts introduced by the shared loop boundary interaction slice of the
 * `@deepseek-ai/dsh-plugin-api-agent-loop` replacement bundle.
 *
 * This slice is NOT merged at mount time. It is handed to the event bus as a
 * dynamic slice `{ name, entries, isActive }`:
 * - `entries` join the STATIC full catalog for subscription metadata (so facade
 *   `events.on` wraps these names even before the replacement is present);
 * - the PUBLIC `pluginApi.events.catalog` snapshot only includes them while
 *   `isActive(ctx)` is true.
 *
 * The main facade must not import the auxiliary module, so this module only
 * reads the installed auxiliary package metadata, the shared global
 * `Symbol.for(...)` boundary literal, and the boundary's own availability.
 */
import { parseFacadeVersion } from './version.js'

function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value
  for (const key of Object.keys(value)) deepFreeze(value[key])
  return Object.freeze(value)
}

const CONTAIN = 'contain'
/** The sole boundary marker literal shared with the auxiliary package. */
export const AGENT_ATTEMPT_BOUNDARY_SYMBOL = Symbol.for('dsh-plugin-api.agent-loop.interaction')
const REPLACEMENT_NAME = '@deepseek-ai/dsh-plugin-api-agent-loop'

/**
 * Both facts are host-global (no scope-filtered dispatch): the payload carries
 * `sessionId` but no agent carrier, matching the compaction fact precedent.
 */
const entries = [
  {
    name: 'agent/attempt/start',
    mode: 'emit',
    scopeFiltered: false,
    scopeKey: null,
    payload: '{ attemptId, operationId?, executionId?, sessionId, seq, observedAt }',
    args: '(payload)',
    feature: 'session-interaction-operation',
    fault: CONTAIN,
    freeze: 'all',
  },
  {
    name: 'agent/attempt/end',
    mode: 'emit',
    scopeFiltered: false,
    scopeKey: null,
    payload: '{ attemptId, operationId?, executionId?, sessionId, seq, observedAt, outcome: success|error|aborted|denied|superseded, reason?, classification, followUp: none|queued }',
    args: '(payload)',
    feature: 'session-interaction-operation',
    fault: CONTAIN,
    freeze: 'all',
  },
]

/**
 * @param {object} auxiliaryManifest - installed aux package metadata `{version, api}`
 * @param {object} expectedContract - main facade `{runtime, api}`
 * @returns {boolean | null} false on mismatch, null when metadata is unavailable
 */
function auxiliaryVersionMatches(auxiliaryManifest, expectedContract) {
  if (auxiliaryManifest === undefined || auxiliaryManifest === null) return null
  if (expectedContract === undefined || expectedContract === null) return null
  const parsed = parseFacadeVersion(auxiliaryManifest?.version)
  const api = typeof auxiliaryManifest?.api === 'string' ? auxiliaryManifest.api.trim() : undefined
  if (!parsed || api !== expectedContract.api) return false
  return parsed.runtime === expectedContract.runtime && parsed.api === expectedContract.api
}

/** @type {ReadonlyArray<Readonly<typeof entries[number]>>} */
const frozenEntries = Object.freeze(entries.map((entry) => deepFreeze(entry)))

function boundaryActive(ctx) {
  try {
    const agentLoop = ctx?.get?.('agentLoop')
    const boundary = agentLoop?.[AGENT_ATTEMPT_BOUNDARY_SYMBOL]
    if (!boundary || typeof boundary.availability !== 'function') return false
    const state = boundary.availability()
    return state?.status === 'active'
  } catch {
    return false
  }
}

/**
 * Build the dynamic catalog slice for the attempt fact events.
 *
 * `expectedContract` is the main facade's own `{runtime, api}` contract and
 * `auxiliaryManifest` is the installed auxiliary package's `{version, api}`.
 * When both are present and do not match, the slice reports the mismatch once
 * and stays inactive: only these replacement facts are disabled while the rest
 * of the facade remains active.
 *
 * @param {{expectedContract?: {runtime: string, api: string}, auxiliaryManifest?: {version?: string, api?: string}, logger?: {warn?: Function}} } [options]
 */
export function createAgentAttemptFactsCatalogSlice({ expectedContract, auxiliaryManifest, logger } = {}) {
  let reportedMismatch = false

  const reportMismatch = () => {
    if (reportedMismatch) return
    reportedMismatch = true
    try {
      logger?.warn?.(
        `dsh-plugin-api: auxiliary package ${REPLACEMENT_NAME} interaction boundary does not match the main facade contract; ` +
        'the attempt-fact replacement events are disabled',
      )
    } catch {
      // diagnostics must never change catalog outcomes
    }
  }

  const isActive = (ctx) => {
    try {
      const versionMatch = auxiliaryVersionMatches(auxiliaryManifest, expectedContract)
      if (versionMatch === false) {
        reportMismatch()
        return false
      }

      let rowActive = false
      for (const entry of ctx.loader?.entries?.() ?? []) {
        const options = entry?.options ?? {}
        if (options.name === REPLACEMENT_NAME && entry.fiber !== undefined && !entry.disabled) {
          rowActive = true
          break
        }
      }
      if (!rowActive) return false

      return boundaryActive(ctx)
    } catch {
      return false
    }
  }

  return Object.freeze({
    name: 'session-interaction-operation',
    entries: frozenEntries,
    isActive,
  })
}

/** Metadata-only default slice for pure catalog consumers. */
export const agentAttemptFactsCatalogSlice = createAgentAttemptFactsCatalogSlice()