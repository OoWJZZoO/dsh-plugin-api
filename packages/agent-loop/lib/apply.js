/**
 * Fail-safe loader-row replacement for the locked agent-loop component.
 *
 * The replacement owns only the loader row's ctx service/event behavior. The
 * official package exports remain the module-resolution source for consumers
 * and for the official fallback path.
 */
import { createRequire } from 'node:module'
import { Service } from '@deepseek-ai/cordis'
import { AgentLoop as OfficialAgentLoop } from '@deepseek-ai/dsh-agent-loop'
import { AgentLoop as ForkedAgentLoop } from './forked-loop.js'
import {
  ROUTE_POLICY_ACTIVE_SYMBOL,
  ROUTE_POLICY_COMPONENT_SYMBOL,
  ROUTE_POLICY_PACKAGE_NAME,
  createRoutePolicyOwner,
} from './route-policy.js'

export const name = 'plugin-api-agent-loop'
export const inject = ['loader']

const require = createRequire(import.meta.url)
const OFFICIAL_ROW_ID = 'agent-loop'
const OFFICIAL_ROW_NAME = '@deepseek-ai/dsh-agent-loop'
const REPLACEMENT_ROW_ID = 'plugin-api-agent-loop'
const MAIN_PACKAGE_NAME = '@deepseek-ai/dsh-plugin-api-main'
const RUNTIME_VERSION = '0.1.0-rc.6'
const DEFAULT_CONFIG = Object.freeze({ maxParallelToolCalls: 10, agents: [] })

function readPackageVersion(packageName) {
  try {
    return require(`${packageName}/package.json`)?.version
  } catch {
    return undefined
  }
}

function readPackageApi(packageName) {
  try {
    return require(`${packageName}/package.json`)?.dsh?.api
  } catch {
    return undefined
  }
}

function log(ctx, message) {
  try {
    ctx?.logger?.warn?.(message)
  } catch {
    // A diagnostic failure never changes activation.
  }
}

function rowOptions(entry) {
  return entry?.options ?? entry ?? {}
}

function rowDisabled(entry) {
  return Boolean(rowOptions(entry).disabled ?? entry?.disabled)
}

function inspectComposition(ctx) {
  const result = { official: undefined, replacements: [], loaderFailed: false }
  try {
    for (const entry of ctx?.loader?.entries?.() ?? []) {
      const options = rowOptions(entry)
      if (options.id === OFFICIAL_ROW_ID || options.name === OFFICIAL_ROW_NAME) {
        if (!result.official || options.id === OFFICIAL_ROW_ID) result.official = entry
      }
      if (options.id === REPLACEMENT_ROW_ID || options.name === ROUTE_POLICY_PACKAGE_NAME) result.replacements.push(entry)
    }
  } catch {
    result.loaderFailed = true
  }
  return result
}

function rootOf(ctx) {
  return ctx?.root ?? ctx
}

function getService(ctx, name) {
  try {
    return ctx?.get?.(name)
  } catch {
    return undefined
  }
}

function parseFullVersion(version) {
  if (typeof version !== 'string') return null
  const match = /^(.+)-(\d+\.\d+)$/.exec(version.trim())
  return match ? { runtime: match[1], api: match[2] } : null
}

export function fullVersionContractsMatch({ ownVersion, ownApi, mainVersion, mainApi } = {}) {
  const own = parseFullVersion(ownVersion)
  const main = parseFullVersion(mainVersion)
  return Boolean(own && main && own.runtime === main.runtime && own.api === main.api && ownApi === own.api && mainApi === main.api)
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0
}

function validAgentConfig(config) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) return undefined
  const maxParallelToolCalls = config.maxParallelToolCalls ?? DEFAULT_CONFIG.maxParallelToolCalls
  if (!isPositiveInteger(maxParallelToolCalls)) return undefined
  const agents = config.agents ?? []
  if (!Array.isArray(agents)) return undefined
  const ids = new Set()
  const normalizedAgents = []
  for (const agent of agents) {
    if (agent === null || typeof agent !== 'object' || typeof agent.id !== 'string' || agent.id.length === 0 || ids.has(agent.id)) return undefined
    ids.add(agent.id)
    const hasSession = agent.sessionId !== undefined
    const hasResume = agent.resumeSessionId !== undefined && agent.resumeSessionId !== ''
    if (hasSession && typeof agent.sessionId !== 'string') return undefined
    if (hasResume && typeof agent.resumeSessionId !== 'string') return undefined
    if (hasSession && hasResume) return undefined
    if (agent.provider !== undefined && typeof agent.provider !== 'string') return undefined
    if (agent.model !== undefined && typeof agent.model !== 'string') return undefined
    if (agent.cwd !== undefined && typeof agent.cwd !== 'string') return undefined
    if (agent.maxTokens !== undefined && (!Number.isSafeInteger(agent.maxTokens) || agent.maxTokens <= 0)) return undefined
    normalizedAgents.push({ ...agent })
  }
  return { ...config, maxParallelToolCalls, agents: normalizedAgents }
}

function resolveConfig(ctx, composition) {
  const own = composition.replacements.find((entry) => !rowDisabled(entry))
  const ownConfig = rowOptions(own).config ?? ctx?.fiber?.entry?.options?.config
  const officialConfig = rowOptions(composition.official).config
  const ownValid = validAgentConfig(ownConfig)
  const officialValid = validAgentConfig(officialConfig)
  if (officialValid) return officialValid
  if (officialConfig !== undefined && !ownValid) log(ctx, 'plugin-api-agent-loop: official agent-loop config is invalid; using replacement defaults')
  if (ownValid) return ownValid
  if (ownConfig !== undefined) log(ctx, 'plugin-api-agent-loop: replacement agent-loop config is invalid; using replacement defaults')
  return { ...DEFAULT_CONFIG, agents: [] }
}

function fullVersionOk(readVersion, readApi) {
  const ownVersion = readVersion(ROUTE_POLICY_PACKAGE_NAME)
  const mainVersion = readVersion(MAIN_PACKAGE_NAME)
  return readVersion('@deepseek-ai/dsh-llm') === RUNTIME_VERSION &&
    readVersion('@deepseek-ai/dsh-agent-loop') === RUNTIME_VERSION &&
    fullVersionContractsMatch({
      ownVersion,
      ownApi: readApi(ROUTE_POLICY_PACKAGE_NAME),
      mainVersion,
      mainApi: readApi(MAIN_PACKAGE_NAME),
    })
}

function isRoutePolicyService(value) {
  return Boolean(value?.[ROUTE_POLICY_ACTIVE_SYMBOL] === true &&
    typeof value?.policy?.register === 'function' &&
    typeof value?.candidates?.register === 'function' &&
    typeof value?.health?.observe === 'function' &&
    typeof value?.circuit?.status === 'function' &&
    typeof value?.decisions?.get === 'function' &&
    typeof value?.availability === 'function' &&
    typeof value?.decide === 'function')
}

function isAgentLoopService(value, requireRoutePolicy = false) {
  if (!value || typeof value !== 'object') return false
  if (!value.config || typeof value.create !== 'function' || typeof value.createAgent !== 'function' || typeof value.resume !== 'function') return false
  if (requireRoutePolicy && value[ROUTE_POLICY_COMPONENT_SYMBOL]?.package !== ROUTE_POLICY_PACKAGE_NAME) return false
  return true
}

function defineRootMarker(ctx, marker) {
  const root = rootOf(ctx)
  if (!root || (typeof root !== 'object' && typeof root !== 'function')) return false
  try {
    Object.defineProperty(root, ROUTE_POLICY_COMPONENT_SYMBOL, {
      configurable: true,
      enumerable: false,
      value: marker,
      writable: false,
    })
    return true
  } catch {
    return false
  }
}

function registerMarkerCleanup(ctx, marker) {
  if (typeof ctx?.effect !== 'function') return false
  try {
    ctx.effect(() => () => {
      const root = rootOf(ctx)
      try {
        if (root?.[ROUTE_POLICY_COMPONENT_SYMBOL] === marker) delete root[ROUTE_POLICY_COMPONENT_SYMBOL]
      } catch {
        // Marker cleanup is best effort after owner disposal.
      }
    }, 'plugin-api-agent-loop.marker()')
    return true
  } catch {
    return false
  }
}

function createRoutePolicyServiceClass(ownerFactory = createRoutePolicyOwner) {
  return class RoutePolicyService extends Service {
    static inject = []

    constructor(ctx, config) {
      super(ctx, 'routePolicy')
      const owner = ownerFactory({
        historyLimit: config?.historyLimit,
        logger: ctx?.logger,
      })
      this._routeOwner = owner
      Object.defineProperties(this, Object.getOwnPropertyDescriptors(owner.api))
      if (typeof ctx?.effect === 'function') ctx.effect(() => () => owner.dispose(), 'plugin-api-agent-loop.route-policy()')
    }
  }
}

async function disposeRegistration(value) {
  try {
    if (typeof value === 'function') return await value()
    if (typeof value?.dispose === 'function') return await value.dispose()
  } catch {
    // Rollback is deliberately best effort.
  }
  return undefined
}

function diagnosticsForMismatch({ runtimeOk, mainOk }) {
  const reasons = []
  if (!runtimeOk) reasons.push('runtime or official agent-loop identity mismatch')
  if (!mainOk) reasons.push('main facade version mismatch')
  return reasons.join(' and ') || 'replacement identity mismatch'
}

export function createAgentLoopApply(overrides = {}) {
  const readVersion = overrides.readPackageVersion ?? readPackageVersion
  const readApi = overrides.readPackageApi ?? readPackageApi
  const Forked = overrides.forkedAgentLoop ?? ForkedAgentLoop
  const Official = overrides.officialAgentLoop ?? OfficialAgentLoop
  const ownerFactory = overrides.routePolicyOwner ?? createRoutePolicyOwner
  const officialAvailable = overrides.officialAvailable ?? true
  const createService = overrides.createRoutePolicyService ?? (() => createRoutePolicyServiceClass(ownerFactory))

  return async function apply(ctx) {
    let routeRegistration
    try {
      const composition = inspectComposition(ctx)
      if (composition.loaderFailed) {
        log(ctx, 'plugin-api-agent-loop: loader composition probe failed; staying inert')
        return
      }
      const officialPresent = composition.official !== undefined
      const officialEnabled = officialPresent && !rowDisabled(composition.official)
      const activeReplacements = composition.replacements.filter((entry) => !rowDisabled(entry))
      const root = rootOf(ctx)
      const existingMarker = root?.[ROUTE_POLICY_COMPONENT_SYMBOL]
      if (existingMarker && existingMarker.package !== ROUTE_POLICY_PACKAGE_NAME) {
        log(ctx, 'plugin-api-agent-loop: another replacement owns the agent-loop component; staying inert')
        return
      }
      if (activeReplacements.length > 1) {
        log(ctx, `plugin-api-agent-loop: duplicate replacement rows detected (${activeReplacements.length}); staying inert`)
        return
      }
      if (officialEnabled) {
        log(ctx, 'plugin-api-agent-loop: official agent-loop row is enabled; staying inert to avoid double registration')
        return
      }
      const existingAgent = getService(ctx, 'agentLoop')
      const existingRoute = getService(ctx, 'routePolicy')
      if (isAgentLoopService(existingAgent, true) && isRoutePolicyService(existingRoute)) return
      if (existingAgent || existingRoute) {
        log(ctx, 'plugin-api-agent-loop: an unrelated agent-loop or route-policy service already exists; staying inert')
        return
      }
      if (activeReplacements.length === 0) {
        log(ctx, 'plugin-api-agent-loop: replacement row is absent or disabled; staying inert')
        return
      }

      const runtimeOk = readVersion('@deepseek-ai/dsh-llm') === RUNTIME_VERSION && readVersion('@deepseek-ai/dsh-agent-loop') === RUNTIME_VERSION
      const mainOk = fullVersionContractsMatch({
        ownVersion: readVersion(ROUTE_POLICY_PACKAGE_NAME),
        ownApi: readApi(ROUTE_POLICY_PACKAGE_NAME),
        mainVersion: readVersion(MAIN_PACKAGE_NAME),
        mainApi: readApi(MAIN_PACKAGE_NAME),
      })
      const identityOk = fullVersionOk(readVersion, readApi)
      const config = resolveConfig(ctx, composition)
      if (identityOk) {
        if (typeof ctx?.effect !== 'function' || typeof ctx?.plugin !== 'function') {
          log(ctx, 'plugin-api-agent-loop: required registration or cleanup primitive is unavailable; staying inert')
          return
        }
        const marker = {
          package: ROUTE_POLICY_PACKAGE_NAME,
          rowId: REPLACEMENT_ROW_ID,
          runtime: RUNTIME_VERSION,
          api: readApi(ROUTE_POLICY_PACKAGE_NAME),
        }
        if (!defineRootMarker(ctx, marker) || !registerMarkerCleanup(ctx, marker)) {
          log(ctx, 'plugin-api-agent-loop: component marker could not be installed; staying inert')
          return
        }
        try {
          routeRegistration = await ctx.plugin(createService(), {})
          const routeService = getService(ctx, 'routePolicy')
          if (!isRoutePolicyService(routeService)) throw new Error('route-policy service contract probe failed')
          const registration = await ctx.plugin(Forked, config)
          const agentLoop = getService(ctx, 'agentLoop')
          if (!isAgentLoopService(agentLoop, true)) throw new Error('forked agent-loop service contract probe failed')
          if (!isRoutePolicyService(getService(ctx, 'routePolicy'))) throw new Error('route-policy service disappeared')
          log(ctx, 'plugin-api-agent-loop: replacement active')
          return registration
        } catch (error) {
          await disposeRegistration(routeRegistration)
          routeRegistration = undefined
          try {
            const rootValue = rootOf(ctx)
            if (rootValue?.[ROUTE_POLICY_COMPONENT_SYMBOL] === marker) delete rootValue[ROUTE_POLICY_COMPONENT_SYMBOL]
          } catch {}
          log(ctx, `plugin-api-agent-loop: replacement registration rolled back; staying inert: ${error?.name ?? 'Error'}`)
          return
        }
      }

      const mismatch = diagnosticsForMismatch({ runtimeOk, mainOk })
      if (!officialAvailable) {
        log(ctx, `plugin-api-agent-loop: ${mismatch}; official fallback package is unavailable; staying inert`)
        return
      }
      try {
        await ctx.plugin(Official, config)
        const fallback = getService(ctx, 'agentLoop')
        if (!isAgentLoopService(fallback, false)) throw new Error('official agent-loop fallback contract probe failed')
        log(ctx, `plugin-api-agent-loop: ${mismatch}; registered official agent-loop fallback with route policy disabled`)
      } catch (error) {
        log(ctx, `plugin-api-agent-loop: ${mismatch}; official fallback registration failed; staying inert: ${error?.name ?? 'Error'}`)
      }
    } catch (error) {
      await disposeRegistration(routeRegistration)
      log(ctx, `plugin-api-agent-loop: apply self-check failed; staying inert: ${error?.name ?? 'Error'}`)
    }
  }
}

export const apply = createAgentLoopApply()
