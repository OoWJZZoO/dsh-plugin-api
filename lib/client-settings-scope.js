import { PluginApiError, PluginApiFeatureDisabledError, PluginApiInactiveError } from './errors.js'

export const CLIENT_SETTINGS_SCOPE_FEATURE = 'clientSettingsScope'

/**
 * Client settings scope binding.
 *
 * `scope(spec)` is the same call pattern the host namespace offers — the same
 * object subject (`{ namespace, ... }`), and the same read / subscribe member
 * names (`get` / `watch`). What the two answer differs: the host facade returns
 * its own settings handle, while the client returns a frozen view over the
 * official scope (the browser-side settings service owns that binding) whose
 * official members (`getSnapshot` / `subscribe` / `set` / `unset`) remain
 * available as extension members. The difference is an environment difference
 * and is registered as such, not smoothed over.
 */
export function createClientSettingsScope({ ctx, settingsScope, active = true } = {}) {
  const isActive = typeof active === 'function' ? active : () => Boolean(active)
  if (settingsScope === undefined) {
    try { settingsScope = typeof ctx?.get === 'function' ? ctx.get('settingsScope') : ctx?.settingsScope } catch { settingsScope = undefined }
  }
  if (!settingsScope || typeof settingsScope.bind !== 'function') return createDisabledClientSettingsScope(isActive)
  return Object.freeze({
    isActive: true,
    scope(spec) {
      if (!isActive()) throw new PluginApiInactiveError()
      validateSpec(spec)
      const scope = settingsScope.bind(spec)
      if (!isSettingsScope(scope)) {
        throw new PluginApiError('PLUGIN_API_SETTINGS_SCOPE_UNAVAILABLE', 'official settingsScope.bind returned a malformed scope')
      }
      // Every official member (the lifecycle disposer included) stays
      // available as an extension member, so face cleanup keeps working; the
      // read / subscribe members additionally carry the same names the host
      // namespace uses, so a caller can read the environment difference
      // straight off the value.
      const officials = {}
      for (const key of Object.keys(scope)) {
        const value = scope[key]
        officials[key] = typeof value === 'function' ? (...args) => scope[key](...args) : value
      }
      return Object.freeze({
        ...officials,
        get: () => scope.getSnapshot(),
        watch: (callback) => scope.subscribe(callback),
      })
    },
    dispose() {},
  })
}

export function createDisabledClientSettingsScope(active = true, reason = 'official settingsScope service is unavailable') {
  const isActive = typeof active === 'function' ? active : () => Boolean(active)
  const fail = () => {
    if (!isActive()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError(CLIENT_SETTINGS_SCOPE_FEATURE, reason)
  }
  return Object.freeze({ isActive: false, scope: fail, dispose() {} })
}

export function isSettingsScope(scope) {
  try { return scope != null && ['getSnapshot', 'subscribe', 'set', 'unset'].every((name) => typeof scope[name] === 'function') } catch { return false }
}

function validateSpec(spec) {
  const invalid = (message) => new PluginApiError('PLUGIN_API_SETTINGS_SCOPE_INVALID_INPUT', message)
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw invalid('settings scope spec must be an object')
  if (typeof spec.namespace !== 'string' || spec.namespace.length === 0) throw invalid('settings scope spec.namespace must be a non-empty string')
  if (spec.decode !== undefined && typeof spec.decode !== 'function') throw invalid('settings scope spec.decode must be a function when provided')
}
