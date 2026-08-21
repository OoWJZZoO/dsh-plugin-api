import { PluginApiFeatureDisabledError, PluginApiInactiveError } from './errors.js'

const SERVICE_DEFINITIONS = [
  ['modules', ['version', 'loadCache', 'import', 'registerStatic', 'prefetch', 'invalidate'], ['version', 'loadCache']],
  ['locale', ['getLocale', 'getSnapshot', 'subscribe', 'setLocale', 'register', 'bind'], []],
  ['sessions', ['list', 'currentProvideInfo', 'searchResultLimit', 'open', 'openSubagent', 'subagentAddress', 'setSubagentCatalogOpen', 'refreshSubagents', 'noteAgentPreset', 'clear', 'search', 'fork', 'provide', 'scope', 'scopeOf', 'sessionOf', 'binding'], ['list', 'currentProvideInfo', 'searchResultLimit']],
  ['workspaces', ['list', 'connectWorkspace', 'startSession', 'create', 'pickDirectory', 'listDirectory', 'createDirectory', 'openPath', 'rename', 'delete', 'insertBefore', 'insertSessionBefore', 'archiveSession'], ['list']],
  ['chatFileMentions', ['forClosing'], []],
  ['layout', ['toggleSidebar', 'openDetails', 'closeDetails'], []],
  ['theme', ['getTheme', 'exportInspectTokens', 'setTheme', 'register', 'overrideTokens'], []],
  ['appShell', ['renderApp'], []],
  ['sessionLogDownload', ['store', 'download', 'dismiss', 'dispose'], []],
  ['cordisInspect', ['register', 'publish', 'query', 'close'], []],
  ['dynamicCordisRunner', ['activeRuns', 'lastRunError', 'renderFailures', 'reconcileApprovals', 'approve', 'decline', 'startUserRun', 'subscribe', 'getSnapshot', 'isLoaded'], ['activeRuns', 'lastRunError', 'renderFailures']],
]

export const CLIENT_SERVICE_NAMES = Object.freeze(SERVICE_DEFINITIONS.map(([name]) => name))
export const CLIENT_SERVICE_MEMBERS = Object.freeze(Object.fromEntries(
  SERVICE_DEFINITIONS.map(([name, members]) => [name, Object.freeze([...members])]),
))
export const CLIENT_SERVICE_VALUE_MEMBERS = Object.freeze(Object.fromEntries(
  SERVICE_DEFINITIONS.map(([name, , values]) => [name, Object.freeze([...values])]),
))

const ownerTables = new WeakMap()

export function createClientOfficialServices(options = {}) {
  const active = activePredicate(options.active)
  const logger = options.logger
  const source = options.providers ?? options.services
  const ownerScope = options.ownerScope ?? options.ctx ?? source ?? options.publisher
  const ownerTable = ownerTableFor(ownerScope)
  const records = {}

  for (const name of CLIENT_SERVICE_NAMES) {
    const record = createClientOfficialService({
      name,
      active,
      logger,
      ownerTable,
      resolveProvider: resolveClientProvider(name, options, source),
      publish: options.publish,
    })
    records[name] = record
  }

  const namespace = Object.create(null)
  Object.defineProperty(namespace, 'isActive', { enumerable: true, get: () => active() })
  for (const name of CLIENT_SERVICE_NAMES) namespace[name] = records[name].api
  Object.freeze(namespace)

  const dispose = () => disposeRecords(records)
  const result = { api: namespace, services: namespace, leaves: namespace, dispose }
  Object.defineProperty(result, 'isActive', { enumerable: true, get: () => active() })
  for (const name of CLIENT_SERVICE_NAMES) Object.defineProperty(result, name, { enumerable: true, value: records[name].api })
  return Object.freeze(result)
}

export function createClientOfficialService({
  name,
  provider,
  resolveProvider,
  active = true,
  logger,
  publish,
  ownerTable,
} = {}) {
  if (!CLIENT_SERVICE_NAMES.includes(name)) throw new TypeError(`unknown client service ${String(name)}`)
  const isRootActive = activePredicate(active)
  const values = new Set(CLIENT_SERVICE_VALUE_MEMBERS[name])
  const members = CLIENT_SERVICE_MEMBERS[name]
  // Resolve the official provider lazily. Client service providers may be
  // Cordis getters whose access is observable during activation.
  const state = { enabled: true, disposed: false, stale: false }
  const resolve = normalizeResolver(provider, resolveProvider)
  const feature = `client.${name}`
  let publishDisposer

  const isAvailable = () => {
    if (!isRootActive() || !state.enabled || state.disposed || state.stale) return false
    return isValidProvider(readProvider(resolve), members, values)
  }

  const assertAvailable = () => {
    if (!isRootActive()) throw new PluginApiInactiveError()
    if (!state.enabled || state.disposed || state.stale) throw new PluginApiFeatureDisabledError(feature)
    const current = readProvider(resolve)
    if (!isValidProvider(current, members, values)) {
      state.enabled = false
      throw new PluginApiFeatureDisabledError(feature)
    }
    return current
  }

  const descriptors = {
    isActive: { enumerable: true, get: isAvailable },
  }
  for (const member of members) {
    if (values.has(member)) {
      descriptors[member] = {
        enumerable: true,
        get() {
          const current = assertAvailable()
          try {
            return current[member]
          } catch (error) {
            state.enabled = false
            safeLog(logger, 'dsh-plugin-api client service value access failed', error)
            throw new PluginApiFeatureDisabledError(feature)
          }
        },
      }
    } else {
      descriptors[member] = {
        enumerable: true,
        value: function (...args) {
          const current = assertAvailable()
          let method
          try {
            method = current[member]
          } catch (error) {
            state.enabled = false
            safeLog(logger, 'dsh-plugin-api client service method access failed', error)
            throw new PluginApiFeatureDisabledError(feature)
          }
          if (typeof method !== 'function') {
            state.enabled = false
            safeLog(logger, 'dsh-plugin-api client service method is not callable', new TypeError(`client service member ${member} is not callable`))
            throw new PluginApiFeatureDisabledError(feature)
          }
          return Reflect.apply(method, current, args)
        },
      }
    }
  }
  const api = Object.freeze(Object.defineProperties({}, descriptors))

  const record = {
    name,
    api,
    get isActive() { return api.isActive },
    dispose: () => disposeRecord(record, false),
    _supersede: () => disposeRecord(record, true),
  }

  takeOwnership(ownerTable, name, record)
  if (typeof publish === 'function') {
    try {
      const result = publish(name, api, record)
      if (result !== undefined && typeof result !== 'function') throw new TypeError('client service publisher returned a malformed disposer')
      publishDisposer = result
    } catch (error) {
      state.enabled = false
      safeLog(logger, 'dsh-plugin-api client service publication failed', error)
    }
  }

  function disposeRecord(owner, superseded) {
    if (state.disposed || state.stale) return false
    state.enabled = false
    if (superseded) state.stale = true
    state.disposed = !superseded
    if (ownerTable?.get(name) === owner) ownerTable.delete(name)
    const disposer = publishDisposer
    publishDisposer = undefined
    return runDisposer(disposer, logger, 'dsh-plugin-api client service cleanup failed', true)
  }

  return Object.freeze(record)
}

export function createDisabledClientOfficialService(name, active = true, reason = 'official client service is unavailable') {
  if (!CLIENT_SERVICE_NAMES.includes(name)) throw new TypeError(`unknown client service ${String(name)}`)
  const isRootActive = activePredicate(active)
  const fail = () => {
    if (!isRootActive()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError(`client.${name}`, reason)
  }
  const descriptors = { isActive: { enumerable: true, value: false } }
  for (const member of CLIENT_SERVICE_MEMBERS[name]) {
    if (CLIENT_SERVICE_VALUE_MEMBERS[name].includes(member)) descriptors[member] = { enumerable: true, get: fail }
    else descriptors[member] = { enumerable: true, value: fail }
  }
  const api = Object.freeze(Object.defineProperties({}, descriptors))
  return Object.freeze({ name, api, isActive: false, dispose() { return false } })
}

export const createClientServices = createClientOfficialServices

function resolveClientProvider(name, options, source) {
  if (typeof options.resolveProvider === 'function') return () => options.resolveProvider(name)
  if (source !== undefined) return () => readNamed(source, name)
  if (options.ctx !== undefined) return () => {
    if (typeof options.ctx?.get === 'function') return options.ctx.get(name)
    return options.ctx?.[name]
  }
  return () => undefined
}

function normalizeResolver(provider, resolver) {
  if (typeof resolver === 'function') return resolver
  return () => provider
}

function readProvider(resolve) {
  try { return resolve() } catch { return undefined }
}

function isValidProvider(provider, members, values) {
  if (provider === null || (typeof provider !== 'object' && typeof provider !== 'function')) return false
  try {
    for (const member of members) {
      if (!(member in provider)) return false
      if (!values.has(member) && !isCallableMemberShape(provider, member)) return false
    }
    return true
  } catch {
    return false
  }
}

function isCallableMemberShape(provider, member) {
  const descriptor = findPropertyDescriptor(provider, member)
  if (!descriptor || Object.prototype.hasOwnProperty.call(descriptor, 'get')) return true
  return typeof descriptor.value === 'function'
}

function findPropertyDescriptor(value, member) {
  let current = value
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, member)
    if (descriptor) return descriptor
    current = Object.getPrototypeOf(current)
  }
  return undefined
}

function readNamed(source, name) {
  if (source instanceof Map) return source.get(name)
  if (typeof source === 'function') return source(name)
  return source?.[name]
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
  if (!results.some(isThenable)) return results.some(Boolean)
  return Promise.all(results.map((result) => Promise.resolve(result))).then((values) => values.some(Boolean))
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
