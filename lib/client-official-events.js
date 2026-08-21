import { PluginApiFeatureDisabledError, PluginApiInactiveError } from './errors.js'

export const CLIENT_EVENT_NAMES = Object.freeze([
  'locale/change',
  'theme/change',
  'connection/reset',
  'command/executed',
])

const EVENT_KEYS = Object.freeze({
  'locale/change': 'localeChange',
  'theme/change': 'themeChange',
  'connection/reset': 'connectionReset',
  'command/executed': 'commandExecuted',
})

const ownerTables = new WeakMap()

export function createClientOfficialEvents(options = {}) {
  const active = activePredicate(options.active)
  const records = {}
  const ownerTable = ownerTableFor(options.ownerScope ?? options.ctx ?? options.eventSource ?? options.sources)

  for (const name of CLIENT_EVENT_NAMES) {
    records[name] = createClientOfficialEvent({
      name,
      active,
      logger: options.logger,
      ownerTable,
      resolveSource: resolveEventResolver(name, options) ?? (() => resolveEventSource(name, options)),
      publish: options.publish,
    })
  }

  const api = {}
  Object.defineProperty(api, 'isActive', { enumerable: true, get: () => active() })
  for (const name of CLIENT_EVENT_NAMES) {
    const face = records[name].api
    const key = EVENT_KEYS[name]
    api[key] = face
  }
  api.on = (name, listener) => {
    const record = records[name]
    if (!record) throw new TypeError(`unsupported client event ${String(name)}`)
    return record.on(listener)
  }
  api.dispose = () => disposeRecords(records)
  Object.freeze(api)

  const result = {
    api,
    events: api,
    on: api.on,
    dispose: api.dispose,
    leaves: Object.freeze(Object.fromEntries(CLIENT_EVENT_NAMES.map((name) => [name, records[name]]))),
  }
  Object.defineProperty(result, 'isActive', { enumerable: true, get: () => active() })
  return Object.freeze(result)
}

export function createClientOfficialEvent({
  name,
  source,
  resolveSource,
  active = true,
  logger,
  publish,
  ownerTable,
} = {}) {
  if (!CLIENT_EVENT_NAMES.includes(name)) throw new TypeError(`unsupported client event ${String(name)}`)
  const isRootActive = activePredicate(active)
  const state = {
    // Event sources may be exposed by an observable client getter. Do not
    // resolve them while constructing the leaf.
    enabled: true,
    disposed: false,
    stale: false,
    listeners: [],
    nativeDisposer: undefined,
    publishedDisposer: undefined,
    subscribed: false,
  }
  const resolve = normalizeResolver(source, resolveSource)
  const feature = `client.${EVENT_KEYS[name]}`

  const isAvailable = () => {
    if (!isRootActive() || !state.enabled || state.disposed || state.stale) return false
    const sourceState = readSourceState(resolve, logger)
    if (sourceState.malformed) state.enabled = false
    return sourceState.available
  }

  const assertAvailable = () => {
    if (!isRootActive()) throw new PluginApiInactiveError()
    if (!state.enabled || state.disposed || state.stale) throw new PluginApiFeatureDisabledError(feature)
    const sourceState = readSourceState(resolve, logger)
    if (!sourceState.available) {
      state.enabled = false
      throw new PluginApiFeatureDisabledError(feature)
    }
    return sourceState
  }

  const api = Object.freeze({
    get isActive() { return isAvailable() },
    on(listener) { return addListener(listener) },
    dispose() { return disposeRecord(record, false) },
  })

  const record = Object.freeze({
    name,
    api,
    get isActive() { return isAvailable() },
    on: addListener,
    dispose: () => disposeRecord(record, false),
    _supersede: () => disposeRecord(record, true),
  })

  takeOwnership(ownerTable, name, record)
  if (typeof publish === 'function') {
    try {
      const result = publish(name, api, record)
      if (result !== undefined && typeof result !== 'function') throw new TypeError('client event publisher returned a malformed disposer')
      state.publishedDisposer = result
    } catch (error) {
      state.enabled = false
      safeLog(logger, 'dsh-plugin-api client event publication failed', error)
    }
  }

  function addListener(listener) {
    assertAvailable()
    if (typeof listener !== 'function') throw new TypeError('client event listener must be a function')
    const entry = { listener, active: true }
    state.listeners.push(entry)
    try {
      ensureNativeSubscription()
    } catch (error) {
      entry.active = false
      state.listeners = state.listeners.filter((item) => item !== entry)
      if (state.listeners.length === 0) safelyDisposeNative()
      state.enabled = false
      throw new PluginApiFeatureDisabledError(feature, 'official client event source could not be subscribed')
    }
    return () => disposeListener(entry)
  }

  function ensureNativeSubscription() {
    if (state.subscribed) return
    const sourceState = assertAvailable()
    try {
      const native = subscribeNative(sourceState.source, name, dispatch, sourceState.adapter)
      if (native !== undefined && typeof native !== 'function') throw new TypeError('official client event source returned a malformed disposer')
      state.nativeDisposer = native
      state.subscribed = true
    } catch (error) {
      safeLog(logger, 'dsh-plugin-api client event subscription failed', error)
      throw error
    }
  }

  function dispatch(...args) {
    if (!state.enabled || state.disposed || state.stale) return undefined
    for (const entry of [...state.listeners]) {
      if (!entry.active) continue
      let result
      try {
        result = Reflect.apply(entry.listener, undefined, args)
      } catch (error) {
        safeLog(logger, 'dsh-plugin-api client event listener failed', error)
        continue
      }
      if (isThenable(result)) {
        Promise.resolve(result).catch((error) => safeLog(logger, 'dsh-plugin-api client event listener rejected', error))
      }
    }
    return undefined
  }

  function disposeListener(entry) {
    if (!entry.active) return false
    entry.active = false
    const index = state.listeners.indexOf(entry)
    if (index !== -1) state.listeners.splice(index, 1)
    if (state.listeners.length === 0) safelyDisposeNative()
    return true
  }

  function disposeRecord(owner, superseded) {
    if (state.disposed || state.stale) return false
    state.enabled = false
    if (superseded) state.stale = true
    state.disposed = !superseded
    for (const entry of state.listeners) entry.active = false
    state.listeners = []
    if (ownerTable?.get(name) === owner) ownerTable.delete(name)
    const native = state.nativeDisposer
    state.nativeDisposer = undefined
    state.subscribed = false
    const published = state.publishedDisposer
    state.publishedDisposer = undefined
    safelyDispose(native, logger, 'dsh-plugin-api client event native cleanup failed')
    return runDisposer(published, logger, 'dsh-plugin-api client event cleanup failed', true)
  }

  function safelyDisposeNative() {
    const native = state.nativeDisposer
    state.nativeDisposer = undefined
    state.subscribed = false
    safelyDispose(native, logger, 'dsh-plugin-api client event native cleanup failed')
  }

  return record
}

export function createDisabledClientOfficialEvents(active = true, reason = 'official client event source is unavailable') {
  const isRootActive = activePredicate(active)
  const fail = () => {
    if (!isRootActive()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('client.events', reason)
  }
  const leaves = {}
  for (const name of CLIENT_EVENT_NAMES) {
    const key = EVENT_KEYS[name]
    leaves[key] = Object.freeze({ isActive: false, on: fail, dispose() { return false } })
  }
  const api = Object.freeze({ isActive: false, ...leaves, on: fail, dispose() {} })
  return Object.freeze({ isActive: false, api, events: api, on: fail, dispose() {} })
}

export const createClientEvents = createClientOfficialEvents

function resolveEventSource(name, options) {
  if (options.sources !== undefined) return readNamed(options.sources, name)
  if (options.eventSource !== undefined) return options.eventSource
  if (options.ctx !== undefined) return options.ctx
  return undefined
}

function resolveEventResolver(name, options) {
  if (typeof options.resolveSource === 'function') return () => options.resolveSource(name)
  if (typeof options.resolveEventSource === 'function') return () => options.resolveEventSource(name)
  return undefined
}

function subscribeNative(source, name, dispatch, adapter) {
  if (adapter.kind === 'function') return Reflect.apply(source, undefined, [name, dispatch])
  if (adapter.kind === 'on' || adapter.kind === '$on') return Reflect.apply(adapter.subscribe, source, [name, dispatch])
  if (adapter.kind === 'eventTarget') {
    Reflect.apply(adapter.subscribe, source, [name, dispatch])
    return () => Reflect.apply(adapter.unsubscribe, source, [name, dispatch])
  }
  throw new TypeError('official client event source is malformed')
}

function readSourceState(resolve, logger) {
  const source = readSource(resolve, logger)
  const state = inspectSource(source)
  if (state.error) safeLog(logger, 'dsh-plugin-api client event source inspection failed', state.error)
  return { ...state, source }
}

function inspectSource(source) {
  if (typeof source === 'function') return { available: true, malformed: false, adapter: { kind: 'function' } }
  if (source === null || (typeof source !== 'object' && typeof source !== 'function')) {
    return { available: false, malformed: false, adapter: undefined }
  }
  try {
    const on = source.on
    if (typeof on === 'function') return { available: true, malformed: false, adapter: { kind: 'on', subscribe: on } }
    const dollarOn = source.$on
    if (typeof dollarOn === 'function') return { available: true, malformed: false, adapter: { kind: '$on', subscribe: dollarOn } }
    const addEventListener = source.addEventListener
    if (typeof addEventListener === 'function') {
      const removeEventListener = source.removeEventListener
      if (typeof removeEventListener !== 'function') {
        return {
          available: false,
          malformed: true,
          adapter: undefined,
          error: new TypeError('official client event target has no callable removeEventListener'),
        }
      }
      return {
        available: true,
        malformed: false,
        adapter: { kind: 'eventTarget', subscribe: addEventListener, unsubscribe: removeEventListener },
      }
    }
    return { available: false, malformed: false, adapter: undefined }
  } catch (error) {
    return { available: false, malformed: true, adapter: undefined, error }
  }
}

function readSource(resolve, logger) {
  try { return resolve() } catch (error) {
    safeLog(logger, 'dsh-plugin-api client event source resolution failed', error)
    return undefined
  }
}

function normalizeResolver(value, resolver) {
  if (typeof resolver === 'function') return resolver
  return () => value
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

function disposeRecords(records) {
  const results = Object.values(records).map((record) => record.dispose())
  const pending = results.filter(isThenable)
  if (pending.length === 0) return true
  return Promise.all(pending).then(() => true)
}

function safelyDispose(disposer, logger, message) {
  if (typeof disposer !== 'function') return
  try {
    const result = disposer()
    if (isThenable(result)) Promise.resolve(result).catch((error) => safeLog(logger, message, error))
  } catch (error) {
    safeLog(logger, message, error)
  }
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

function readNamed(source, name) {
  if (source instanceof Map) return source.get(name)
  if (typeof source === 'function') return source(name)
  return source?.[name]
}
