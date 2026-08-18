import { PluginApiFeatureDisabledError, PluginApiInactiveError } from './errors.js'

export const CLIENT_SETTINGS_SCOPE_FEATURE = 'clientSettingsScope'

export function createClientSettingsScope({ ctx, settingsScope, active = true } = {}) {
  const isActive = typeof active === 'function' ? active : () => Boolean(active)
  if (settingsScope === undefined) {
    try { settingsScope = typeof ctx?.get === 'function' ? ctx.get('settingsScope') : ctx?.settingsScope } catch { settingsScope = undefined }
  }
  if (!settingsScope || typeof settingsScope.bind !== 'function') return createDisabledClientSettingsScope(isActive)
  return Object.freeze({
    isActive: true,
    bind(spec) {
      if (!isActive()) throw new PluginApiInactiveError()
      validateSpec(spec)
      const scope = settingsScope.bind(spec)
      if (!isSettingsScope(scope)) throw new TypeError('official settingsScope.bind returned a malformed scope')
      return scope
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
  return Object.freeze({ isActive: false, bind: fail, dispose() {} })
}

export function isSettingsScope(scope) {
  try { return scope != null && ['getSnapshot', 'subscribe', 'set', 'unset'].every((name) => typeof scope[name] === 'function') } catch { return false }
}

function validateSpec(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new TypeError('settings scope spec must be an object')
}
