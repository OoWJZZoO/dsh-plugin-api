import { PluginApiFeatureDisabledError, PluginApiInactiveError } from './errors.js'

export const CLIENT_CONNECTION_METHODS = Object.freeze(['providers', 'models', 'discoverModels'])

const ownerTables = new WeakMap()

export function createClientOfficialConnection(options = {}) {
  const active = activePredicate(options.active)
  const ownerScope = options.ownerScope ?? options.ctx ?? options.connection
  const ownerTable = ownerTableFor(ownerScope)
  const resolve = normalizeResolver(
    options.connection,
    options.resolveConnection
      ?? options.getConnection
      ?? (options.ctx === undefined ? undefined : () => readClientConnection(options.ctx)),
  )
  const logger = options.logger
  // Connection resolution is lazy because the official client service may be
  // exposed through an observable getter.
  const state = { enabled: true, disposed: false, stale: false }
  const feature = 'client.connection'

  const isAvailable = () => {
    if (!active() || !state.enabled || state.disposed || state.stale) return false
    return isValidConnection(readConnection(resolve))
  }

  const assertAvailable = () => {
    if (!active()) throw new PluginApiInactiveError()
    if (!state.enabled || state.disposed || state.stale) throw new PluginApiFeatureDisabledError(feature)
    const current = readConnection(resolve)
    if (!isValidConnection(current)) {
      state.enabled = false
      throw new PluginApiFeatureDisabledError(feature)
    }
    return current
  }

  const llm = {}
  for (const name of CLIENT_CONNECTION_METHODS) {
    Object.defineProperty(llm, name, {
      enumerable: true,
      value: function (...args) {
        const connection = assertAvailable()
        const api = connection.api.llm
        return Reflect.apply(api[name], api, args)
      },
    })
  }
  Object.freeze(llm)

  const api = Object.freeze({
    get isActive() { return isAvailable() },
    api: Object.freeze({ llm }),
  })
  const record = {
    api,
    get isActive() { return isAvailable() },
    dispose: () => disposeRecord(record, false),
    _supersede: () => disposeRecord(record, true),
  }

  takeOwnership(ownerTable, 'connection', record)
  let publishedDisposer
  if (typeof options.publish === 'function') {
    try {
      const result = options.publish(api, record)
      if (result !== undefined && typeof result !== 'function') throw new TypeError('client connection publisher returned a malformed disposer')
      publishedDisposer = result
    } catch (error) {
      state.enabled = false
      safeLog(logger, 'dsh-plugin-api client connection publication failed', error)
    }
  }

  function disposeRecord(owner, superseded) {
    if (state.disposed || state.stale) return false
    state.enabled = false
    if (superseded) state.stale = true
    state.disposed = !superseded
    if (ownerTable?.get('connection') === owner) ownerTable.delete('connection')
    const disposer = publishedDisposer
    publishedDisposer = undefined
    return runDisposer(disposer, logger, 'dsh-plugin-api client connection cleanup failed', true)
  }

  return Object.freeze({
    get isActive() { return record.isActive },
    api,
    connection: api,
    dispose: record.dispose,
    _record: record,
  })
}

export function createDisabledClientOfficialConnection(active = true, reason = 'official client connection is unavailable') {
  const isRootActive = activePredicate(active)
  const fail = () => {
    if (!isRootActive()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('client.connection', reason)
  }
  const llm = Object.freeze(Object.fromEntries(CLIENT_CONNECTION_METHODS.map((name) => [name, fail])))
  const api = Object.freeze({ isActive: false, api: Object.freeze({ llm }) })
  return Object.freeze({ isActive: false, api, connection: api, dispose() { return false } })
}

export const createClientConnection = createClientOfficialConnection

function normalizeResolver(connection, resolver) {
  if (typeof resolver === 'function') return resolver
  return () => connection
}

function readConnection(resolve) {
  try { return resolve() } catch { return undefined }
}

function readClientConnection(ctx) {
  try { return typeof ctx?.get === 'function' ? ctx.get('connection') : ctx?.connection } catch { return undefined }
}

function isValidConnection(connection) {
  try {
    const llm = connection?.api?.llm
    return llm !== null && (typeof llm === 'object' || typeof llm === 'function')
      && CLIENT_CONNECTION_METHODS.every((name) => typeof llm[name] === 'function')
  } catch {
    return false
  }
}

function activePredicate(active) {
  return typeof active === 'function' ? active : () => Boolean(active ?? true)
}

function ownerTableFor(scope) {
  if (scope === null || (typeof scope !== 'object' && typeof scope !== 'function')) return undefined
  let table = ownerTables.get(scope)
  if (!table) {
    table = new Map()
    ownerTables.set(scope, table)
  }
  return table
}

function takeOwnership(table, name, record) {
  const previous = table?.get(name)
  if (previous && previous !== record) previous._supersede()
  table?.set(name, record)
}

function runDisposer(disposer, logger, message, result) {
  if (typeof disposer !== 'function') return result
  try {
    const value = disposer()
    if (isThenable(value)) return Promise.resolve(value).catch((error) => safeLog(logger, message, error)).then(() => result)
  } catch (error) {
    safeLog(logger, message, error)
  }
  return result
}

function safeLog(logger, message, error) {
  try { logger?.error?.(message, error) } catch {}
}

function isThenable(value) {
  try {
    return value !== null && (typeof value === 'object' || typeof value === 'function') && typeof value.then === 'function'
  } catch {
    return false
  }
}
