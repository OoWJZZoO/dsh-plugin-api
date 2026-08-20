/**
 * Replacement catalog slice: the `session-title/candidate` eligibility waterfall
 * introduced by the `@deepseek-ai/dsh-plugin-api-session-title` replacement
 * bundle.
 *
 * This slice is NOT merged at mount time. It is handed to the event bus as a
 * dynamic slice `{ name, entries, isActive }`:
 * - `entries` join the STATIC full catalog for subscription metadata (so facade
 *   `events.on` wraps this name even before the replacement is present);
 * - the PUBLIC `pluginApi.events.catalog` snapshot only includes it while
 *   `isActive(ctx)` is true.
 *
 * The main facade must not import the auxiliary module, so this module only
 * reads the installed auxiliary package metadata and the shared global
 * `Symbol.for(...)` contract literal.
 */
import { parseFacadeVersion } from './version.js'

function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value
  for (const key of Object.keys(value)) deepFreeze(value[key])
  return Object.freeze(value)
}

const CONTAIN = 'contain'
/** The sole contract symbol shared with the auxiliary package. */
export const SESSION_TITLE_CONTRACT_SYMBOL = Symbol.for('dsh-plugin-api.session-title.contract')
const REPLACEMENT_NAME = '@deepseek-ai/dsh-plugin-api-session-title'

/**
 * The entry is host-global (no scope-filtered dispatch): the title dispatch
 * context has no agent parameter, so `scopeKey` is null and `agent` is only a
 * lazily-resolved payload convenience field.
 */
const entries = [
  {
    name: 'session-title/candidate',
    mode: 'waterfall',
    scopeFiltered: false,
    scopeKey: null,
    payload: '{ agent, session, message }; message = {seq, text, source}',
    args: '(payload, next)',
    feature: 'session-title',
    fault: CONTAIN,
    freeze: { deep: ['message'] },
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

/**
 * Build the dynamic catalog slice.
 *
 * `expectedContract` is the main facade's own `{runtime, api}` contract and
 * `auxiliaryManifest` is the installed auxiliary package's `{version, api}`.
 * When both are present and do not match, the slice reports the mismatch once
 * and stays inactive: only this replacement's event feature is disabled while
 * the rest of the facade remains active.
 *
 * @param {{expectedContract?: {runtime: string, api: string}, auxiliaryManifest?: {version?: string, api?: string}, logger?: {warn?: Function}} } [options]
 */
export function createSessionTitleEventsCatalogSlice({ expectedContract, auxiliaryManifest, logger } = {}) {
  let reportedMismatch = false

  const reportMismatch = () => {
    if (reportedMismatch) return
    reportedMismatch = true
    try {
      logger?.warn?.(
        `dsh-plugin-api: auxiliary package ${REPLACEMENT_NAME} version does not match the main facade contract; ` +
        'its replacement events are disabled',
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

      const service = ctx.get('sessionTitle')
      return service != null && service[SESSION_TITLE_CONTRACT_SYMBOL] === true
    } catch {
      return false
    }
  }

  return Object.freeze({
    name: 'session-title',
    entries: frozenEntries,
    isActive,
  })
}

/** Metadata-only default slice for pure catalog consumers. */
export const sessionTitleEventsCatalogSlice = createSessionTitleEventsCatalogSlice()
