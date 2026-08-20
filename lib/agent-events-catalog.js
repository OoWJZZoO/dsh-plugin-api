/**
 * Read-only event catalog slice: 12 official agent/* events stabilized by pluginApi (twelve agent events).
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
    name: 'agent/created',
    mode: 'emit',
    scopeFiltered: true,
    scopeKey: 'args[0].agent',
    payload: '{ agent }',
    args: '(payload)',
    fault: 'created', // official: sync throw vetoes publication, async rejection is reported
    freeze: { deep: [] },
  },
  {
    name: 'agent/disposed',
    mode: 'emit',
    scopeFiltered: true,
    scopeKey: 'args[0].agent',
    payload: '{ agent }',
    args: '(payload)',
    fault: 'contain',
    freeze: { deep: [] },
  },
  {
    name: 'agent/status',
    mode: 'emit',
    scopeFiltered: true,
    scopeKey: 'args[0].agent',
    payload: '{ agent, status }',
    args: '(payload)',
    fault: 'contain',
    freeze: { deep: [] },
  },
  {
    name: 'agent/session-start',
    mode: 'emit',
    scopeFiltered: true,
    scopeKey: 'args[0].agent',
    payload: '{ agent, source }',
    args: '(payload)',
    fault: 'contain',
    freeze: { deep: [] },
  },
  {
    name: 'agent/inbox/inserted',
    mode: 'emit',
    scopeFiltered: true,
    scopeKey: 'args[0].agent',
    payload: '{ agent, message }',
    args: '(payload)',
    fault: 'contain',
    freeze: { deep: [] },
  },
  {
    name: 'agent/inbox/claimed',
    mode: 'emit',
    scopeFiltered: true,
    scopeKey: 'args[0].agent',
    payload: '{ agent, message, turn }',
    args: '(payload)',
    fault: 'contain',
    freeze: { deep: [] },
  },
  {
    name: 'agent/inbox/discarded',
    mode: 'emit',
    scopeFiltered: true,
    scopeKey: 'args[0].agent',
    payload: '{ agent, message }',
    args: '(payload)',
    fault: 'contain',
    freeze: { deep: [] },
  },
  {
    name: 'agent/pre-step',
    mode: 'waterfall',
    scopeFiltered: true,
    scopeKey: 'args[0].agent',
    payload: '{ agent, messages, turn, step, signal }',
    args: '(payload, next)',
    fault: 'propagate',
    freeze: { deep: ['messages'] },
  },
  {
    name: 'agent/request',
    mode: 'waterfall',
    scopeFiltered: true,
    scopeKey: 'args[0].agent',
    payload: '{ agent, turn, step, signal }',
    args: '(payload, next)',
    fault: 'propagate',
    freeze: { deep: [] },
  },
  {
    name: 'agent/request-error',
    mode: 'waterfall',
    scopeFiltered: true,
    scopeKey: 'args[0].agent',
    payload: '{ agent, turn, step, provider, failure, retryPolicy, signal }',
    args: '(payload, next)',
    fault: 'propagate',
    freeze: { deep: ['failure'] },
  },
  {
    name: 'agent/turn-stopping',
    mode: 'serial',
    scopeFiltered: true,
    scopeKey: 'args[0].agent',
    payload: '{ agent, turn, signal }',
    args: '(payload)',
    fault: 'propagate',
    freeze: { deep: [] },
  },
  {
    name: 'agent/error',
    mode: 'emit',
    scopeFiltered: true,
    scopeKey: 'args[0].agent',
    payload: '{ agent, turn, step, error }',
    args: '(payload)',
    fault: 'contain',
    freeze: { deep: [] },
  },
]

/** @type {Readonly<Record<string, typeof entries[number]>>} */
export const agentEventsCatalog = deepFreeze(Object.fromEntries(entries.map((entry) => [entry.name, entry])))
