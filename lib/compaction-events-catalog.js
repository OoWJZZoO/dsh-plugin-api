/**
 * R-class catalog slice: the five `compaction/*` events introduced by the
 * `@deepseek-ai/dsh-plugin-api-compaction-events` replacement bundle
 * (plugin-api-compaction-events-r1).
 *
 * Unlike A/B slices this slice is NOT merged at mount time. It is handed to the
 * event bus as an `rSlice` `{ name, entries, isActive }`:
 * - `entries` join the STATIC full catalog for subscription metadata (so facade
 *   `events.on` wraps these names even before the replacement is present);
 * - the PUBLIC `pluginApi.events.catalog` snapshot only includes them while
 *   `isActive(ctx)` is true (requirements 6.1/6.4, design C7).
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
/** The sole contract symbol shared with the aux package (design D5). */
const COMPACTION_EVENTS_ACTIVE_SYMBOL = Symbol.for('dsh-plugin-api.compaction-events-r1.active')
const REPLACEMENT_NAME = '@deepseek-ai/dsh-plugin-api-compaction-events'

/**
 * All five entries are host-global (no scope-filtered dispatch) because
 * compaction is a session-owning host service rather than an agent-scoped
 * event (requirements 6.1, design C6).
 */
const entries = [
  {
    name: 'compaction/request',
    mode: 'waterfall',
    scopeFiltered: false,
    scopeKey: null,
    payload: '{ agent, session, trigger, range: {start,end}, sourceCommandId? }',
    args: '(payload, next)',
    source: 'R1',
    feature: 'compaction-events-r1',
    type: R,
    fault: CONTAIN,
    freeze: { deep: ['range'] },
  },
  {
    name: 'compaction/started',
    mode: 'emit',
    scopeFiltered: false,
    scopeKey: null,
    payload: '{ agent, session, trigger, range: {start,end}, sourceCommandId? }',
    args: '(payload)',
    source: 'R1',
    feature: 'compaction-events-r1',
    type: R,
    fault: CONTAIN,
    freeze: { deep: ['range'] },
  },
  {
    name: 'compaction/completed',
    mode: 'emit',
    scopeFiltered: false,
    scopeKey: null,
    payload: '{ agent, session, trigger, range: {start,end}, result: { compactionId, shadowedRange, shadowedSeqs, shadowedTokenCount, startSeq, summarySeq, endSeq, sourceCommandId? } }',
    args: '(payload)',
    source: 'R1',
    feature: 'compaction-events-r1',
    type: R,
    fault: CONTAIN,
    freeze: { deep: ['range', 'result'] },
  },
  {
    name: 'compaction/failed',
    mode: 'emit',
    scopeFiltered: false,
    scopeKey: null,
    payload: '{ agent, session, trigger, range: {start,end}, failure: { stage, name, code? } }',
    args: '(payload)',
    source: 'R1',
    feature: 'compaction-events-r1',
    type: R,
    fault: CONTAIN,
    freeze: { deep: ['range', 'failure'] },
  },
  {
    name: 'compaction/skipped',
    mode: 'emit',
    scopeFiltered: false,
    scopeKey: null,
    payload: '{ agent, session, trigger, range: {start,end}, reason }',
    args: '(payload)',
    source: 'R1',
    feature: 'compaction-events-r1',
    type: R,
    fault: CONTAIN,
    freeze: { deep: ['range'] },
  },
]

/**
 * Whether the `compaction/*` replacement row is currently active in this
 * composition: the aux loader entry is loaded (has a fiber), is not disabled,
 * and the `ctx.compaction` service carries the shared contract symbol.
 * The whole guard is try/caught and defaults to false (requirements 6.4).
 */
export function isCompactionEventsReplacementActive(ctx) {
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
    const service = ctx.get('compaction')
    return service != null && service[COMPACTION_EVENTS_ACTIVE_SYMBOL] === true
  } catch {
    return false
  }
}

/** @type {ReadonlyArray<Readonly<typeof entries[number]>>} */
const frozenEntries = Object.freeze(entries.map((entry) => deepFreeze(entry)))

export const compactionEventsCatalogSlice = Object.freeze({
  name: 'compaction-events-r1',
  entries: frozenEntries,
  isActive: isCompactionEventsReplacementActive,
})
