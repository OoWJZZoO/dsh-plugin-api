/**
 * R-class catalog slice: the `session-title/candidate` eligibility waterfall
 * introduced by the `@deepseek-ai/dsh-plugin-api-session-title` replacement
 * bundle (plugin-api-session-title-r1).
 *
 * Like compaction-events-r1's slice this slice is NOT merged at mount time. It
 * is handed to the event bus as an `rSlice` `{ name, entries, isActive }`:
 * - `entries` join the STATIC full catalog for subscription metadata (so facade
 *   `events.on` wraps this name even before the replacement is present);
 * - the PUBLIC `pluginApi.events.catalog` snapshot only includes it while
 *   `isActive(ctx)` is true (requirements 6.1/6.4, design C5).
 *
 * The main facade must not import the auxiliary package (requirements 1.5),
 * so this module uses the same global `Symbol.for(...)` contract literal.
 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value
  for (const key of Object.keys(value)) deepFreeze(value[key])
  return Object.freeze(value)
}

const R = 'R'
const CONTAIN = 'contain'
/** The sole contract symbol shared with the aux package (design C1). */
const SESSION_TITLE_ACTIVE_SYMBOL = Symbol.for('dsh-plugin-api.session-title-r1.active')
const REPLACEMENT_NAME = '@deepseek-ai/dsh-plugin-api-session-title'

/**
 * The entry is host-global (no scope-filtered dispatch): the title dispatch
 * context has no agent parameter, so `scopeKey` is null and `agent` is only a
 * lazily-resolved payload convenience field (design C5 / requirements 6.1).
 */
const entries = [
  {
    name: 'session-title/candidate',
    mode: 'waterfall',
    scopeFiltered: false,
    scopeKey: null,
    payload: '{ agent, session, message }; message = {seq, text, source}',
    args: '(payload, next)',
    source: 'U9 (R)',
    feature: 'plugin-api-session-title-r1',
    type: R,
    fault: CONTAIN,
    freeze: { deep: ['message'] },
  },
]

/**
 * Whether the `session-title/candidate` replacement row is currently active in
 * this composition: the aux loader entry is loaded (has a fiber), is not
 * disabled, and the `ctx.sessionTitle` service carries the shared contract
 * symbol. The whole guard is try/caught and defaults to false (requirements 6.4).
 */
export function isSessionTitleReplacementActive(ctx) {
  try {
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
    return service != null && service[SESSION_TITLE_ACTIVE_SYMBOL] === true
  } catch {
    return false
  }
}

/** @type {ReadonlyArray<Readonly<typeof entries[number]>>} */
const frozenEntries = Object.freeze(entries.map((entry) => deepFreeze(entry)))

export const sessionTitleEventsCatalogSlice = Object.freeze({
  name: 'session-title-r1',
  entries: frozenEntries,
  isActive: isSessionTitleReplacementActive,
})
