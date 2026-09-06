/**
 * Host event catalog slice for the attention domain: the single
 * `attention/update` observation event produced by the host attention hub.
 *
 * Unlike the replacement catalog slices (compaction/attempt-facts) this slice
 * is a static host slice merged at mount time: the hub lives in the main
 * facade and its producer authority is the attention hub itself. Consumers
 * subscribe through the facade event bus; the browser side receives the same
 * update through the api-remotes replacement forwarder along the official
 * host→browser event stream (never through the `$on` legal key set).
 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value
  for (const key of Object.keys(value)) deepFreeze(value[key])
  return Object.freeze(value)
}

const CONTAIN = 'contain'

const entries = [
  {
    name: 'attention/update',
    mode: 'emit',
    scopeFiltered: false,
    scopeKey: null,
    payload: 'AttentionUpdate { kind: attention.snapshot | attention.delta, epoch, seq, changes?: [{op, item?, id?, reason?}], items?: [...] }',
    args: '(message)',
    feature: 'attention',
    fault: CONTAIN,
    freeze: 'all',
  },
]

/** @type {Readonly<Record<string, typeof entries[number]>>} */
export const attentionEventsCatalog = deepFreeze(
  Object.fromEntries(entries.map((entry) => [entry.name, entry])),
)