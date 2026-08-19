import { PluginApiFeatureDisabledError, PluginApiInactiveError } from './errors.js'

export const CLIENT_REMOTE_CONTRIBUTION_FEATURE = 'clientRemoteContribution'

const DISPOSED = 'disposed'     // active record torn down (terminal)
const PENDING = 'pending'       // official $mount in flight
const ACTIVE = 'active'         // mounted and published
const STALE = 'stale'           // pending record disposed before $mount settled

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
    const record = { owners, state: PENDING, disposer: undefined, promise: undefined }
    record.promise = (async () => {
      let disposer
      try {
        disposer = await remote.$mount(contribution)
        if (typeof disposer !== 'function') throw new TypeError('official remote.$mount did not return a disposer')
        // The gateway publishes Cordis dynamic services. Resolve through the
        // official dynamic-service accessor (`remote[namespace]`), accepting
        // getter-backed/Cordis dynamic properties; never use `in`/own-property
        // enumeration, which would reject a successfully mounted dynamic service.
        for (const namespace of namespaces) {
          if (remote[namespace] == null) throw new TypeError(`mounted remote contribution did not publish namespace "${namespace}"`)
        }
        if (record.state === STALE || record.state === DISPOSED) {
          // Disposed while pending: the mount committed, so invoke the official
          // disposer exactly once here instead of leaving a leaked owner.
          await safelyDispose(disposer, logger)
          return () => false
        }
        record.disposer = disposer
        record.state = ACTIVE
        return () => disposeRecord(contribution.package, record)
      } catch (error) {
        // Only remove an owner when this record is still the one behind the key;
        // a late failure must never remove or disable a newer owner.
        if (record.owners.get(contribution.package) === record) record.owners.delete(contribution.package)
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

function disposeRecord(key, record) {
  if (record.state === DISPOSED || record.state === STALE) return false
  if (record.state === PENDING) {
    // Dispose while pending: drop the addressable owner now so a replacement
    // mount can proceed, and defer official cleanup to the $mount settlement.
    record.state = STALE
    if (record.owners.get(key) === record) record.owners.delete(key)
    return true
  }
  record.state = DISPOSED
  const disposer = record.disposer
  record.disposer = undefined
  return (async () => {
    try { if (disposer) await disposer() } finally { if (record.owners.get(key) === record) record.owners.delete(key) }
    return true
  })()
}

async function safelyDispose(disposer, logger) {
  try { await disposer() } catch { try { logger?.error?.('dsh-plugin-api client remote contribution rollback failed') } catch {} }
}
