/**
 * Read-only event catalog slice: 2 llm events stabilized by plugin-api-llm-m1 (L3/L6).
 *
 * Unified-schema slice module (plugin-api-m1-integration). Merged into the
 * composed `pluginApi.events` catalog at mount time via `composeCatalogs`.
 * Each entry records the official dispatch mode, scope-filtered status,
 * scope-key resolution, fault policy, freeze policy, listener argument shape,
 * payload summary, source feature id, and A/B provenance.
 *
 * The catalog is deeply frozen and must never be mutated at runtime.
 */

function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value
  for (const key of Object.keys(value)) deepFreeze(value[key])
  return Object.freeze(value)
}

const A = 'A'

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
    source: 'L3',
    type: A,
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
    source: 'L6',
    type: A,
  },
]

/** @type {Readonly<Record<string, typeof entries[number]>>} */
export const llmEventsCatalog = deepFreeze(Object.fromEntries(entries.map((entry) => [entry.name, entry])))
