/**
 * Read-only event catalog slice: 2 settings events stabilized by plugin-api-settings-m1 (ST3).
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
    name: 'settings/updated',
    mode: 'emit',
    scopeFiltered: false,
    scopeKey: undefined,
    fault: 'contain',
    freeze: 'all',
    payload: "ns: SettingsNamespace; next/prev: resolved values; source: 'update' | 'provider'",
    args: '(ns, next, prev, source)',
    source: 'ST3',
    type: A,
  },
  {
    name: 'settings/document-updated',
    mode: 'emit',
    scopeFiltered: false,
    scopeKey: undefined,
    fault: 'contain',
    freeze: 'all',
    payload: 'ns: SettingsNamespace; revision: number',
    args: '(ns, revision)',
    source: 'ST3',
    type: A,
  },
]

/** @type {Readonly<Record<string, typeof entries[number]>>} */
export const settingsEventsCatalog = deepFreeze(Object.fromEntries(entries.map((entry) => [entry.name, entry])))
