/**
 * Read-only event catalog entries for the six tools events stabilized by
 * pluginApi (six tool events).
 *
 * These entries are merged into `pluginApi.events.catalog` when the `tools`
 * feature is active (composed via `composeCatalogs` at mount time). Each
 * entry records the official dispatch mode, scope-filtered status, scope
 * scope-key resolver, freeze policy, listener argument shape, payload summary,
 * provenance.
 *
 * The catalog is deeply frozen and must never be mutated at runtime.
 */

function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value
  for (const key of Object.keys(value)) deepFreeze(value[key])
  return Object.freeze(value)
}


/**
 * @type {Array<{
 *   name: string,
 *   mode: 'on' | 'emit' | 'serial' | 'parallel' | 'bail' | 'waterfall',
 *   scopeFiltered: boolean,
 *   scopeKey: 'args[0].agent' | null | undefined,
 *   freeze?: 'all' | 'except-signal',
 *   payload: string,
 *   args: string,
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
  },
  {
    name: 'tools/pre-execute',
    mode: 'waterfall',
    scopeFiltered: true,
    scopeKey: 'args[0].agent',
    freeze: 'all',
    payload: "exec; PreToolDecision: {kind:'allow'} | {kind:'deny', reason} | {kind:'ask', reason?}",
    args: '(exec, next)',
  },
  {
    name: 'tools/execute',
    mode: 'waterfall',
    scopeFiltered: true,
    scopeKey: 'args[0].agent',
    freeze: 'except-signal',
    payload: 'exec; only exec.signal may be replaced in place (call identity is immutable)',
    args: '(exec, next)',
  },
  {
    name: 'tools/post-execute',
    mode: 'waterfall',
    scopeFiltered: true,
    scopeKey: 'args[0].agent',
    freeze: 'all',
    payload: "exec, result (read-only); PostToolDecision: {kind:'accept', content?|value?} | {kind:'block', feedback}",
    args: '(exec, result, next)',
  },
  {
    name: 'tools/result',
    mode: 'emit',
    scopeFiltered: true,
    scopeKey: 'args[0].agent',
    freeze: 'all',
    payload: 'exec, result (both frozen observe-only)',
    args: '(exec, result)',
  },
  {
    name: 'tools/code-dispatch-log',
    mode: 'waterfall',
    scopeFiltered: true,
    scopeKey: 'args[0].agent',
    freeze: 'all',
    payload: 'dispatch {exec, agent?, subCallId, name, isError, content}; returns ContentBlock[]',
    args: '(dispatch, next)',
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
