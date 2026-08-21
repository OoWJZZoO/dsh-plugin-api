import {
  PluginApiFeatureDisabledError,
  PluginApiInactiveError,
  PluginApiServiceUnavailableError,
} from './errors.js'

const LLM_METHODS = Object.freeze([
  'listProviders',
  'listConfigurableProviders',
  'discoverModels',
  'providerRetryPolicy',
  'listModels',
  'resolveCallConfig',
])

const LLM_ARTIFACTS = Object.freeze([
  'contentHasImage',
  'createUserMessage',
  'BlockAssembler',
])

const AGENT_METHODS = Object.freeze([
  'currentInitiator',
  'requireInitiator',
  'withInitiator',
  'withoutInitiator',
  'isOwnedBy',
])

const SESSION_STORE_METHODS = Object.freeze([
  'create',
  'prepare',
  'enter',
  'announce',
  'flush',
])

const SESSION_METHODS = Object.freeze(['append', 'deriveEventMessage'])
const TOOLS_METHODS = Object.freeze(['executionMode', 'defineTool'])
const SETTINGS_METHODS = Object.freeze(['prepareDocument', 'get', 'update', 'replace', 'mutate'])

function hasOwn(value, key) {
  return value !== null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key)
}

function normalizeInput(input, secondary) {
  if (input !== null && typeof input === 'object') return input
  return { source: input, publicExports: secondary }
}

function pick(input, keys) {
  for (const key of keys) if (hasOwn(input, key) && input[key] !== undefined) return input[key]
  return undefined
}

function readMember(source, name) {
  try {
    return source === null || source === undefined ? undefined : source[name]
  } catch {
    return undefined
  }
}

function rootIsActive(value) {
  try {
    return typeof value === 'function' ? value() === true : value !== false
  } catch {
    return false
  }
}

function createLifecycle(input, feature) {
  const token = input.token ?? {}
  let disposed = false

  const current = () => {
    try {
      if (typeof input.isCurrent === 'function') return input.isCurrent(token) === true
      if (typeof input.currentToken === 'function') return input.currentToken() === token
      if (hasOwn(input, 'currentToken')) return input.currentToken === token
      return true
    } catch {
      return false
    }
  }

  const assertAvailable = () => {
    if (!rootIsActive(input.active ?? input.isRootActive ?? true)) throw new PluginApiInactiveError()
    if (disposed || !current()) throw new PluginApiFeatureDisabledError(feature)
  }

  const dispose = () => {
    if (disposed) return false
    disposed = true
    if (!current()) return false
    try {
      input.onDispose?.(token)
    } catch {
      // Cleanup is a fail-safe boundary; invalidation has already completed.
    }
    return true
  }

  return {
    token,
    assertAvailable,
    dispose,
    isActive: () => !disposed && rootIsActive(input.active ?? input.isRootActive ?? true) && current(),
  }
}

function methodMember(lifecycle, feature, source, name) {
  return function forwardedOfficialMember(...args) {
    lifecycle.assertAvailable()
    const method = readMember(source, name)
    if (typeof method !== 'function') throw new PluginApiFeatureDisabledError(feature)
    return Reflect.apply(method, source, args)
  }
}

function defineArtifact(api, lifecycle, feature, source, name) {
  Object.defineProperty(api, name, {
    enumerable: true,
    get() {
      lifecycle.assertAvailable()
      const artifact = readMember(source, name)
      if (typeof artifact !== 'function') throw new PluginApiFeatureDisabledError(feature)
      // Public constructors and helpers intentionally keep their official identity.
      return artifact
    },
  })
}

function freezeApi(api) {
  return Object.freeze(api)
}

function finishLeaf(api, lifecycle) {
  const frozenApi = freezeApi(api)
  return Object.freeze({
    api: frozenApi,
    facade: frozenApi,
    token: lifecycle.token,
    dispose: lifecycle.dispose,
    disposer: lifecycle.dispose,
    get isActive() {
      return lifecycle.isActive()
    },
  })
}

function sourceFor(input, names) {
  return pick(input, names) ?? (hasOwn(input, 'source') ? input.source : input)
}

function publicExportsFor(input, source, names) {
  return pick(input, names) ?? source
}

function createAgentOptionsSnapshot(input, registry) {
  let explicit
  let explicitSource = false
  try {
    if (hasOwn(input, 'agentOptions')) {
      explicit = input.agentOptions
      explicitSource = true
    } else if (hasOwn(input, 'optionsSnapshot')) {
      explicit = input.optionsSnapshot
      explicitSource = true
    }
  } catch {
    return undefined
  }

  let raw = explicit
  let malformed = false
  if (raw === undefined && !explicitSource) {
    try {
      if (hasOwn(input, 'agent')) raw = input.agent
    } catch {
      return undefined
    }
  }
  if (typeof raw === 'function') {
    try {
      raw = raw()
    } catch {
      return undefined
    }
  }

  if (raw === undefined && registry !== undefined && typeof readMember(registry, 'currentInitiator') === 'function') {
    try {
      raw = Reflect.apply(registry.currentInitiator, registry, [])
    } catch {
      return undefined
    }
  }

  if (raw !== undefined && raw !== null && typeof raw === 'object' && !explicitSource) {
    try {
      raw = raw.options
    } catch {
      malformed = true
      raw = undefined
    }
  }

  if (raw === undefined) {
    if (malformed) return undefined
    if (registry !== undefined && typeof readMember(registry, 'currentInitiator') === 'function') {
      return Object.freeze({ provider: undefined, model: undefined, maxTokens: undefined })
    }
    return undefined
  }
  if (raw === null || typeof raw !== 'object') return undefined

  let provider
  let model
  let maxTokens
  try {
    provider = raw.provider
    model = raw.model
    maxTokens = raw.maxTokens
  } catch {
    return undefined
  }

  if (provider !== undefined && typeof provider !== 'string') return undefined
  if (model !== undefined && typeof model !== 'string') return undefined
  if (maxTokens !== undefined && (typeof maxTokens !== 'number' || !Number.isFinite(maxTokens))) return undefined
  return Object.freeze({ provider, model, maxTokens })
}

function createOfficialLlmLeaf(input = {}, secondary) {
  input = normalizeInput(input, secondary)
  const lifecycle = createLifecycle(input, 'llm')
  const service = sourceFor(input, ['llm', 'service', 'official', 'runtime'])
  const artifacts = publicExportsFor(input, service, ['publicExports', 'exports', 'artifacts', 'dshLlm'])
  const api = {}
  for (const name of LLM_METHODS) api[name] = methodMember(lifecycle, 'llm', service, name)
  for (const name of LLM_ARTIFACTS) defineArtifact(api, lifecycle, 'llm', artifacts, name)
  return finishLeaf(api, lifecycle)
}

function createOfficialAgentLeaf(input = {}, secondary) {
  input = normalizeInput(input, secondary)
  const lifecycle = createLifecycle(input, 'agent')
  const registry = sourceFor(input, ['registry', 'agents', 'service', 'official', 'runtime'])
  const api = {}
  for (const name of AGENT_METHODS) api[name] = methodMember(lifecycle, 'agent', registry, name)
  let snapshotReady = false
  let snapshot
  Object.defineProperty(api, 'options', {
    enumerable: true,
    get() {
      lifecycle.assertAvailable()
      if (!snapshotReady) {
        snapshot = createAgentOptionsSnapshot(input, registry)
        snapshotReady = true
      }
      if (snapshot === undefined) throw new PluginApiFeatureDisabledError('agent')
      return snapshot
    },
  })
  return finishLeaf(api, lifecycle)
}

function createSessionMethodMember(lifecycle, store, input, name) {
  const fixedTarget = pick(input, ['session', 'sessionSource', 'appendSource'])
  return function targetSessionMember(...args) {
    lifecycle.assertAvailable()
    const source = fixedTarget ?? store
    const method = readMember(source, name)
    if (typeof method !== 'function') throw new PluginApiFeatureDisabledError('session')
    return Reflect.apply(method, source, args)
  }
}

function createOfficialSessionLeaf(input = {}, secondary) {
  input = normalizeInput(input, secondary)
  const lifecycle = createLifecycle(input, 'session')
  const store = sourceFor(input, ['sessions', 'service', 'official', 'runtime'])
  const api = {}
  for (const name of SESSION_STORE_METHODS) api[name] = methodMember(lifecycle, 'session', store, name)
  for (const name of SESSION_METHODS) api[name] = createSessionMethodMember(lifecycle, store, input, name)
  return finishLeaf(api, lifecycle)
}

function createOfficialToolsLeaf(input = {}, secondary) {
  input = normalizeInput(input, secondary)
  const lifecycle = createLifecycle(input, 'tools')
  const service = sourceFor(input, ['tools', 'service', 'official', 'runtime'])
  const artifacts = publicExportsFor(input, service, ['publicExports', 'exports', 'artifacts', 'dshTools'])
  const api = {}
  api.executionMode = methodMember(lifecycle, 'tools', service, 'executionMode')
  api.defineTool = methodMember(lifecycle, 'tools', artifacts, 'defineTool')
  return finishLeaf(api, lifecycle)
}

function createOfficialSystemPromptLeaf(input = {}, secondary) {
  input = normalizeInput(input, secondary)
  const lifecycle = createLifecycle(input, 'systemPrompt')
  const service = sourceFor(input, ['systemPrompt', 'service', 'official', 'runtime'])
  return finishLeaf({ assemble: methodMember(lifecycle, 'systemPrompt', service, 'assemble') }, lifecycle)
}

function resolveSettingsService(input) {
  try {
    if (hasOwn(input, 'settings') && input.settings !== undefined) {
      const service = input.settings
      if (service !== null && (typeof service === 'object' || typeof service === 'function')) return service
      throw new Error('settings lookup unavailable')
    }
    if (typeof input.ctx?.get !== 'function') throw new Error('settings lookup unavailable')
    const service = input.ctx.get('settings')
    if (service === null || (typeof service !== 'object' && typeof service !== 'function')) throw new Error('settings lookup unavailable')
    return service
  } catch {
    throw new PluginApiServiceUnavailableError('settings')
  }
}

function settingsMethodMember(lifecycle, input, name) {
  return function forwardedSettingsMember(...args) {
    lifecycle.assertAvailable()
    let service
    try {
      service = resolveSettingsService(input)
    } catch (error) {
      throw error
    }
    const method = readMember(service, name)
    if (typeof method !== 'function') throw new PluginApiFeatureDisabledError('settings')
    return Reflect.apply(method, service, args)
  }
}

function createOfficialSettingsLeaf(input = {}, secondary) {
  input = normalizeInput(input, secondary)
  const lifecycle = createLifecycle(input, 'settings')
  const api = {}
  Object.defineProperty(api, 'writable', {
    enumerable: true,
    get() {
      lifecycle.assertAvailable()
      const service = resolveSettingsService(input)
      let writable
      try {
        writable = service.writable
      } catch {
        throw new PluginApiFeatureDisabledError('settings')
      }
      if (typeof writable !== 'boolean') throw new PluginApiFeatureDisabledError('settings')
      return writable
    },
  })
  for (const name of SETTINGS_METHODS) api[name] = settingsMethodMember(lifecycle, input, name)
  return finishLeaf(api, lifecycle)
}

export {
  AGENT_METHODS,
  LLM_ARTIFACTS,
  LLM_METHODS,
  SESSION_METHODS,
  SESSION_STORE_METHODS,
  SETTINGS_METHODS,
  TOOLS_METHODS,
  createOfficialAgentLeaf,
  createOfficialLlmLeaf,
  createOfficialSessionLeaf,
  createOfficialSettingsLeaf,
  createOfficialSystemPromptLeaf,
  createOfficialToolsLeaf,
}
