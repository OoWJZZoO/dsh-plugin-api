/**
 * Read-only projection for the B facade.
 *
 * `observe()` returns a deep-frozen snapshot of channel/subscription state;
 * `onChange(listener)` notifies on state changes. The projection never
 * mutates channel state (api-shape read-only face).
 *
 * @module
 */
/**
 * Create the read-only projection surface over a channel engine.
 * @param {object} engine - channel engine with `onChange(listener)` and a
 *   mutable internal snapshot source.
 */
export function createChannelProjection(engine) {
  const freeze = (value) => {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value
    if (Object.isFrozen(value)) return value
    for (const key of Object.keys(value)) {
      value[key] = freeze(value[key])
    }
    return Object.freeze(value)
  }

  const observe = () => {
    const raw = engine._snapshotRaw?.() ?? { channels: {}, subscriptions: {}, connectionState: 'active' }
    return freeze(raw)
  }

  const onChange = (listener) => engine.onChange(listener)

  return Object.freeze({ observe, onChange })
}