/**
 * Read-only event catalog slice: 2 system-prompt events stabilized by pluginApi (assemble and change events).
 *
 * Unified-schema slice module from the earlier integration. Merged into the
 * composed `pluginApi.events` catalog at mount time via `composeCatalogs`.
 * Each entry records the official dispatch mode, scope-filtered status,
 * scope-key resolution, fault policy, freeze policy, listener argument shape,
 * payload summary, provenance.
 *
 * The catalog is deeply frozen and must never be mutated at runtime.
 */

function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value
  for (const key of Object.keys(value)) deepFreeze(value[key])
  return Object.freeze(value)
}


const entries = [
  {
    name: 'system-prompt/assemble',
    mode: 'waterfall',
    scopeFiltered: true,
    scopeKey: 'args[1].scope',
    fault: 'propagate',
    freeze: 'waterfall',
    payload: 'assembly {sections, contexts, tools, variables}; context {scope?, signal?}',
    args: '(assembly, context, next)',
  },
  {
    name: 'system-prompt/change',
    mode: 'emit',
    scopeFiltered: false,
    scopeKey: undefined,
    fault: 'contain',
    freeze: 'all',
    payload: 'none',
    args: '()',
  },
]

/** @type {Readonly<Record<string, typeof entries[number]>>} */
export const systemPromptEventsCatalog = deepFreeze(Object.fromEntries(entries.map((entry) => [entry.name, entry])))
