import { PluginApiFeatureDisabledError, PluginApiInactiveError } from './errors.js'

export const CLIENT_REMOTE_CONTRIBUTION_FEATURE = 'clientRemoteContribution'

export function createClientRemoteContribution({ ctx, remote, active = true, logger } = {}) {
  const isActive = typeof active === 'function' ? active : () => Boolean(active)
  if (remote === undefined) {
    try { remote = typeof ctx?.get === 'function' ? ctx.get('remote') : ctx?.remote } catch { remote = undefined }
  }
  if (!remote || typeof remote.$mount !== 'function') return createDisabledClientRemoteContribution(isActive)
  const owners = new Map()
  function mountRemote(contribution) {
    if (!isActive()) throw new PluginApiInactiveError()
    const namespaces = validateContribution(contribution)
    const existing = owners.get(contribution.package)
    if (existing) return existing.promise
    const record = { disposed: false, disposer: undefined, promise: undefined }
    record.promise = (async () => {
      try {
        const disposer = await remote.$mount(contribution)
        if (typeof disposer !== 'function') throw new TypeError('official remote.$mount did not return a disposer')
        for (const namespace of namespaces) {
          if (!(namespace in remote)) throw new TypeError(`mounted remote contribution did not publish namespace "${namespace}"`)
        }
        record.disposer = disposer
        return () => disposeRecord(contribution.package, record)
      } catch (error) {
        owners.delete(contribution.package)
        if (record.disposer) await safelyDispose(record.disposer, logger)
        throw error
      }
    })()
    owners.set(contribution.package, record)
    return record.promise
  }
  return Object.freeze({ isActive: true, mountRemote, dispose() { return Promise.all([...owners.entries()].map(([key, record]) => disposeRecord(key, record))) } })
}

export function createDisabledClientRemoteContribution(active = true, reason = 'official remote service is unavailable') {
  const isActive = typeof active === 'function' ? active : () => Boolean(active)
  const fail = () => {
    if (!isActive()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError(CLIENT_REMOTE_CONTRIBUTION_FEATURE, reason)
  }
  return Object.freeze({ isActive: false, mountRemote: fail, dispose() {} })
}

function validateContribution(contribution) {
  if (!contribution || typeof contribution.package !== 'string' || contribution.package.length === 0 || !Array.isArray(contribution.descriptors)) {
    throw new TypeError('remote contribution must have a package and descriptor array')
  }
  const namespaces = new Set()
  for (const descriptor of contribution.descriptors) {
    if (!descriptor || ['id', 'service', 'namespace', 'method'].some((key) => typeof descriptor[key] !== 'string' || descriptor[key].length === 0)) {
      throw new TypeError('remote contribution contains a malformed invocation descriptor')
    }
    namespaces.add(descriptor.namespace)
  }
  if (namespaces.size === 0) throw new TypeError('remote contribution requires at least one descriptor')
  return namespaces
}

async function disposeRecord(key, record) {
  if (record.disposed) return false
  record.disposed = true
  if (record.disposer) await record.disposer()
  return true
}

async function safelyDispose(disposer, logger) {
  try { await disposer() } catch { try { logger?.error?.('dsh-plugin-api client remote contribution rollback failed') } catch {} }
}
