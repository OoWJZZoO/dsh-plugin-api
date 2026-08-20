/**
 * Read-only event catalog slice: 2 llm events stabilized by pluginApi (stream and adapter events).
 *
 * Unified-schema slice module (plugin-api-m1-integration). Merged into the
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
    name: 'llm/stream',
    mode: 'waterfall',
    scopeFiltered: false,
    scopeKey: undefined,
    fault: 'contain',
    freeze: 'all',
    payload: 'GenerateOptions (official dsh-llm type); this binding is the LlmRuntime; next(): AsyncIterable<StreamChunk>',
    args: '(options, next)',
  },
  {
    name: 'llm/adapters-updated',
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
export const llmEventsCatalog = deepFreeze(Object.fromEntries(entries.map((entry) => [entry.name, entry])))
