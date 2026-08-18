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
    const record = { owners, disposed: false, disposer: undefined, promise: undefined }
    record.promise = (async () => {
      let disposer
      try {
        disposer = await remote.$mount(contribution)
        if (typeof disposer !== 'function') throw new TypeError('official remote.$mount did not return a disposer')
        record.disposer = disposer
        for (const namespace of namespaces) {
          if (!(namespace in remote)) throw new TypeError(`mounted remote contribution did not publish namespace "${namespace}"`)
        }
        return () => disposeRecord(contribution.package, record)
      } catch (error) {
        owners.delete(contribution.package)
        if (disposer) await safelyDispose(disposer, logger)
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
    if (!isInvocationDescriptor(descriptor)) {
      throw new TypeError('remote contribution contains a malformed invocation descriptor')
    }
    namespaces.add(descriptor.namespace)
  }
  if (namespaces.size === 0) throw new TypeError('remote contribution requires at least one descriptor')
  return namespaces
}

function isInvocationDescriptor(descriptor) {
  if (!isPlainObject(descriptor) || ['id', 'service', 'namespace', 'method'].some((key) => !isNonEmptyString(descriptor[key]))) return false
  if (descriptor.implementation !== undefined && !isNonEmptyString(descriptor.implementation)) return false
  if (!isPlainObject(descriptor.invocation) || descriptor.invocation.kind !== 'direct' || Object.keys(descriptor.invocation).length !== 1) return false
  if (!Array.isArray(descriptor.parameters) || !descriptor.parameters.every(isParameterDescriptor) || !isCodec(descriptor.result)) return false
  if (descriptor.scope !== undefined && (!isPlainObject(descriptor.scope) || !isNonEmptyString(descriptor.scope.context) || !isNonEmptyString(descriptor.scope.wire))) return false
  if (descriptor.cancellation !== undefined && (!isPlainObject(descriptor.cancellation) || descriptor.cancellation.parameter !== 'signal')) return false
  if (descriptor.sourceLocation !== undefined && (!isPlainObject(descriptor.sourceLocation) || !isNonEmptyString(descriptor.sourceLocation.file) || !Number.isInteger(descriptor.sourceLocation.line) || !Number.isInteger(descriptor.sourceLocation.column))) return false
  return true
}

function isParameterDescriptor(parameter) {
  if (!isPlainObject(parameter) || !isNonEmptyString(parameter.name) || !isNonEmptyString(parameter.wire) || !['json', 'lookup'].includes(parameter.source) || !isCodec(parameter.codec)) return false
  if (parameter.source === 'lookup' ? !isNonEmptyString(parameter.lookup) : parameter.lookup !== undefined) return false
  return parameter.acceptsUndefined === undefined || parameter.acceptsUndefined === true
}

function isCodec(codec) {
  if (!isPlainObject(codec)) return false
  if (codec.mode === 'src-json') return Object.keys(codec).length === 1
  return codec.mode === 'strict' && isNonEmptyString(codec.typeSymbol) && codec.schema !== null && typeof codec.schema?.parse === 'function'
}

function isNonEmptyString(value) { return typeof value === 'string' && value.length > 0 }
function isPlainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }

async function disposeRecord(key, record) {
  if (record.disposed) return false
  record.disposed = true
  try {
    if (record.disposer) await record.disposer()
  } finally {
    if (record.owners.get(key) === record) record.owners.delete(key)
  }
  return true
}

async function safelyDispose(disposer, logger) {
  try { await disposer() } catch { try { logger?.error?.('dsh-plugin-api client remote contribution rollback failed') } catch {} }
}
