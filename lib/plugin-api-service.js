/**
 * Cordis service that exposes the public `pluginApi` facade.
 *
 * This module intentionally imports Cordis (a peerDependency). It is NOT a
 * harness-free pure module; `lib/index.js` is the only importer and will
 * register the returned class through `ctx.plugin(...)`. The service is a thin
 * wrapper: all admission validation/matching logic lives in
 * `lib/admission.js`.
 */
import { Service } from '@deepseek-ai/cordis'

/**
 * @param {object} options
 * @param {import('./admission.js').AdmissionRegistry} options.registry
 * @param {boolean | (() => boolean)} options.isActive  whether the admission
 *   bridge is actually installed; when false, register() returns an inert
 *   no-op dispose instead of touching the registry.
 */
export function createPluginApiService({ registry, isActive = false } = {}) {
  const active = typeof isActive === 'function' ? isActive : () => Boolean(isActive)

  return class PluginApiService extends Service {
    static inject = []

    constructor(ctx, config) {
      super(ctx, 'pluginApi')
      this.llm = {
        admission: {
          register: (intent) => {
            if (active() && registry && typeof registry.register === 'function') {
              return registry.register(intent)
            }
            return () => false
          },
          get isActive() {
            return active()
          },
        },
      }
    }
  }
}
