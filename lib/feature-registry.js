/**
 * Pure, dependency-free feature state registry for the pluginApi facade.
 *
 * Each feature is either active or disabled with a readable reason. `mount`
 * and `disable` are idempotent per feature name: the last write wins, and
 * `snapshot()` always reflects the complete current state.
 */
import { PluginApiFeatureDisabledError } from './errors.js'

export function createFeatureRegistry() {
  const states = new Map()

  const stateOf = (name) => states.get(name)

  return {
    mount(name) {
      states.set(name, { name, isActive: true })
    },

    disable(name, reason) {
      states.set(name, { name, isActive: false, reason })
    },

    snapshot() {
      return [...states.values()].map(({ name, isActive, reason }) =>
        reason === undefined ? { name, isActive } : { name, isActive, reason },
      )
    },

    isActive(name) {
      return stateOf(name)?.isActive === true
    },

    assertActive(name) {
      if (this.isActive(name)) return
      const state = stateOf(name)
      throw new PluginApiFeatureDisabledError(name, state?.reason)
    },
  }
}
