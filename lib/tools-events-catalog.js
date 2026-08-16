/**
 * Read-only event catalog entries for the six tools events stabilized by
 * plugin-api-tools-m1 (T2–T7).
 *
 * These entries are merged into `pluginApi.events.catalog` when the `tools`
 * feature is active (composed via `composeCatalogs` at mount time). Each
 * entry records the official dispatch mode, scope-filtered status, scope
 * scope-key resolver, freeze policy, listener argument shape, payload summary,
 * source feature id, and A/B provenance.
 *
 * The catalog is deeply frozen and must never be mutated at runtime.
 */

function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value
  for (const key of Object.keys(value)) deepFreeze(value[key])
  return Object.freeze(value)
}

const A = 'A'

/**
 * @type {Array<{
 *   name: string,
 *   mode: 'on' | 'emit' | 'serial' | 'parallel' | 'bail' | 'waterfall',
 *   scopeFiltered: boolean,
 *   scopeKey: 'args[0].agent' | null | undefined,
 *   freeze?: 'all' | 'except-signal',
 *   payload: string,
 *   args: string,
 *   source: string,
 *   type: 'A' | 'B',
 * }>}
 */
const entries = [
  {
    name: 'tools/change',
    mode: 'emit',
    scopeFiltered: false,
    scopeKey: undefined,
    freeze: 'all',
    payload: 'none',
    args: '()',
    source: 'T2',
    type: A,
  },
  {
    name: 'tools/pre-execute',
    mode: 'waterfall',
    scopeFiltered: true,
    scopeKey: 'args[0].agent',
    freeze: 'all',
    payload: "exec; PreToolDecision: {kind:'allow'} | {kind:'deny', reason} | {kind:'ask', reason?}",
    args: '(exec, next)',
    source: 'T3',
    type: A,
  },
  {
    name: 'tools/execute',
    mode: 'waterfall',
    scopeFiltered: true,
    scopeKey: 'args[0].agent',
    freeze: 'except-signal',
    payload: 'exec; only exec.signal may be replaced in place (call identity is immutable)',
    args: '(exec, next)',
    source: 'T4',
    type: A,
  },
  {
    name: 'tools/post-execute',
    mode: 'waterfall',
    scopeFiltered: true,
    scopeKey: 'args[0].agent',
    freeze: 'all',
    payload: "exec, result (read-only); PostToolDecision: {kind:'accept', content?|value?} | {kind:'block', feedback}",
    args: '(exec, result, next)',
    source: 'T5',
    type: A,
  },
  {
    name: 'tools/result',
    mode: 'emit',
    scopeFiltered: true,
    scopeKey: 'args[0].agent',
    freeze: 'all',
    payload: 'exec, result (both frozen observe-only)',
    args: '(exec, result)',
    source: 'T6',
    type: A,
  },
  {
    name: 'tools/code-dispatch-log',
    mode: 'waterfall',
    scopeFiltered: true,
    scopeKey: 'args[0].agent',
    freeze: 'all',
    payload: 'dispatch {exec, agent?, subCallId, name, isError, content}; returns ContentBlock[]',
    args: '(dispatch, next)',
    source: 'T7',
    type: A,
  },
]

/** @type {Readonly<Record<string, typeof entries[number]>>} */
export const toolsEventsCatalog = deepFreeze(Object.fromEntries(entries.map((entry) => [entry.name, entry])))

/**
 * @param {string} name - event name
 * @returns {typeof entries[number] | undefined} the frozen catalog entry, if cataloged
 */
export function toolsCatalogEntryOf(name) {
  return toolsEventsCatalog[name]
}
