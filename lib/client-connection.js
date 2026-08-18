import { PluginApiFeatureDisabledError, PluginApiInactiveError } from './errors.js'

export const CLIENT_CONNECTION_FEATURE = 'clientConnection'

export function createClientConnection({ ctx, connection, active = true } = {}) {
  const isActive = typeof active === 'function' ? active : () => Boolean(active)
  if (connection === undefined) {
    try {
      connection = typeof ctx?.get === 'function' ? ctx.get('connection') : ctx?.connection
    } catch {
      connection = undefined
    }
  }
  if (!isConnection(connection)) return createDisabledClientConnection(isActive)

  const call = (endpoint, args, signal) => {
    assertActive(isActive)
    return connection.rpc.call('/api', endpoint, { args }, signal)
  }
  const settings = new Proxy({}, {
    get(_target, name) {
      if (typeof name !== 'string') return undefined
      return (...args) => {
        assertActive(isActive)
        return connection.api.settings[name](...args)
      }
    },
  })
  return Object.freeze({
    isActive: true,
    rpc: Object.freeze({ call }),
    api: Object.freeze({ settings }),
    dispose() {},
  })
}

export function createDisabledClientConnection(active = true, reason = 'official connection service is unavailable') {
  const isActive = typeof active === 'function' ? active : () => Boolean(active)
  const fail = () => {
    if (!isActive()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError(CLIENT_CONNECTION_FEATURE, reason)
  }
  const settings = new Proxy({}, { get: () => fail })
  return Object.freeze({ isActive: false, rpc: Object.freeze({ call: fail }), api: Object.freeze({ settings }), dispose() {} })
}

export function isConnection(value) {
  try {
    return value != null && typeof value.rpc?.call === 'function' && value.api?.settings != null
  } catch {
    return false
  }
}

function assertActive(isActive) {
  if (!isActive()) throw new PluginApiInactiveError()
}
