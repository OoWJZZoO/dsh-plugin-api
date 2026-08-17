/**
 * Cordis service that exposes the public `pluginApi` facade.
 *
 * The service is the recommended, supported entry point for third-party
 * plugins. It is a thin state/version facade:
 * - `isActive` reflects the CORE guard result;
 * - `features` reflects the per-feature state registry;
 * - `assertCompatible(requirement, pluginName?)` implements plugin->facade
 *   version negotiation;
 * - feature APIs (currently `llm.admission`) are injected by the host apply
 *   through `mountFeature`. Until mounted, they throw a typed disabled error.
 *
 * Rule: in inactive/disabled states every API method throws BEFORE touching
 * any official service (this module performs no official-service calls at all).
 */
import { Service } from '@deepseek-ai/cordis'
import { PluginApiFeatureDisabledError, PluginApiInactiveError, PluginApiVersionError } from './errors.js'
import { featureFailNotice, writeGuardLog } from './guards.js'
import { createDisabledServicesNamespace } from './services.js'
import { satisfiesContract } from './version.js'

export const pluginApiBrand = Symbol.for('@deepseek-ai/dsh-plugin-api/pluginApi')

function createDisabledAdmissionApi(active) {
  return {
    register() {
      if (!active()) throw new PluginApiInactiveError()
      throw new PluginApiFeatureDisabledError('llm/admission')
    },
    get isActive() {
      return false
    },
  }
}

function createDisabledLlmApi(active) {
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('llm')
  }
  return {
    get isActive() {
      return false
    },
    modelInfo: fail,
    prepareCall: fail,
    stream: fail,
    registerAdapter: fail,
    registerConfigurableProviders: fail,
    registerModelDiscovery: fail,
  }
}

function createDisabledEventsApi(active) {
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('events')
  }
  return {
    catalog: undefined,
    on: fail,
    once: fail,
    emit: fail,
    serial: fail,
    parallel: fail,
    bail: fail,
    waterfall: fail,
  }
}





function createDisabledToolsApi(active, routeOf) {
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('tools')
  }
  return {
    isActive: false,
    register: fail,

    restrict: fail,
    guard: fail,
    get: fail,
    schemas: fail,
    execute: fail,
    presentAs: fail,
    routeOf,
  }
}

function createToolsApi(resolveTools, routeOf) {
  const tools = () => {
    let service
    try {
      service = resolveTools()
    } catch {
      service = undefined
    }
    if (service == null) {
      throw new PluginApiFeatureDisabledError('tools', 'official tools service is no longer resolvable')
    }
    return service
  }
  return {
    isActive: true,
    register(definition) {
      return tools().register(definition)
    },
    restrict(filter) {
      return tools().restrict(filter)
    },
    guard(guard) {
      return tools().guard(guard)
    },
    get(name, scope) {
      return tools().get(name, scope)
    },
    schemas(scope) {
      return tools().schemas(scope)
    },
    execute(input) {
      return tools().execute(input)
    },
    presentAs(...args) {
      return tools().presentAs(...args)
    },
    routeOf,
  }
}

function createDisabledSystemPromptApi(active) {
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('systemPrompt')
  }
  return {
    section: fail,
    context: fail,
    variable: fail,
    tools: fail,
    suppressRuntimeContext: fail,
    render: fail,
    renderContextSections: fail,
    get isActive() {
      return false
    },
  }
}


function createDisabledAgentApi(active, routeOf) {
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('agent')
  }
  return {
    isActive: false,
    get: fail,
    list: fail,
    roots: fail,
    routeOf,
  }
}

function createDisabledSessionApi(active) {
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('session')
  }
  return {
    on: fail,
    once: fail,
    get: fail,
    list: fail,
    fork: fail,
    header: fail,
    events: fail,
    seq: fail,
    surface: fail,
    requestHeader: fail,
    requestContext: fail,
    deriveMessages: fail,
    isSessionEventType: fail,
    isSurfaceEventType: fail,
    sessionEventTypes: undefined,
    surfaceEventTypes: undefined,
  }
}

function createDisabledSettingsApi(active) {
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('settings')
  }
  return {
    isActive: false,
    register: fail,
    scope: fail,
    describe: fail,
    installSettingsSection: fail,
  }
}

/**
 * @param {object} options
 * @param {string} options.apiVersion  facade API contract (major.minor)
 * @param {object} options.registry  feature state registry
 * @param {boolean | (() => boolean)} options.coreActive
 */
export function createPluginApiService({ apiVersion, registry, coreActive = false, logWriter = writeGuardLog, featureNotice = featureFailNotice } = {}) {
  const active = typeof coreActive === 'function' ? coreActive : () => Boolean(coreActive)

  return class PluginApiService extends Service {
    static inject = []

    constructor(ctx, config) {
      super(ctx, 'pluginApi')
      this[pluginApiBrand] = true
      this.apiVersion = apiVersion
      this._active = active
      this._registry = registry
      this._execRouteDisabled = (exec) => {
        if (!this._active()) throw new PluginApiInactiveError()
        throw new PluginApiFeatureDisabledError('execRoute')
      }
      this._execRouteDelegate = this._execRouteDisabled
      this._execRouteToken = null
      this._execRouteP2Diagnostics = new Set()
      this.llm = {
        ...createDisabledLlmApi(active),
        admission: createDisabledAdmissionApi(active),
      }
      this.events = createDisabledEventsApi(active)




      this._toolsMounted = false
      this._toolsDisabled = createDisabledToolsApi(active, (exec) => this._execRouteDelegate(exec))
      Object.defineProperty(this, 'tools', {
        enumerable: true,
        configurable: false,
        get() {
          if (!this._toolsMounted) return this._toolsDisabled
          // Official tools methods retain caller-fiber resolution at invocation.
          // routeOf is feature-owned and therefore never resolves tools.
          return createToolsApi(
            () => (typeof this.ctx?.get === 'function' ? this.ctx.get('tools') : undefined),
            (exec) => this._execRouteDelegate(exec),
          )
        },
      })
      this.agent = createDisabledAgentApi(active, (exec) => this._execRouteDelegate(exec))
      this.session = createDisabledSessionApi(active)
      this.systemPrompt = createDisabledSystemPromptApi(active)
      this.settings = createDisabledSettingsApi(active)
      this.services = createDisabledServicesNamespace(active)
    }

    get isActive() {
      return this._active()
    }

    /**
     * Reconcile a reused service instance during idempotent re-apply: point it
     * at the current feature registry and core-active state.
     */
    reconcile({ registry, coreActive } = {}) {
      if (registry) this._registry = registry
      this._active = typeof coreActive === 'function' ? coreActive : () => Boolean(coreActive)
    }

    get features() {
      return this._registry && typeof this._registry.snapshot === 'function'
        ? this._registry.snapshot()
        : []
    }

    /**
     * Plugin -> facade version negotiation. Throws when core is inert or when
     * the running facade does not satisfy the plugin's declared requirement.
     */
    assertCompatible(requirement, pluginName) {
      if (!this.isActive) {
        throw new PluginApiInactiveError()
      }
      if (!satisfiesContract(requirement, this.apiVersion)) {
        throw new PluginApiVersionError({
          declared: this.apiVersion,
          required: requirement,
          pluginName,
        })
      }
      return true
    }

    reportExecRouteP2Once(phase, category, problems) {
      const key = `${phase}:${category}`
      if (this._execRouteP2Diagnostics.has(key)) return false
      this._execRouteP2Diagnostics.add(key)
      let logPath = null
      try {
        logPath = logWriter(problems)
      } catch {
        // P2 diagnostic failures must remain inert.
      }
      try {
        this.ctx?.logger?.error?.(featureNotice('execRoute', logPath))
      } catch {
        // P2 diagnostic failures must remain inert.
      }
      return true
    }

    /**
     * Mount a feature API. Only known feature names are mountable; the host
     * apply calls this only after the feature guard passed.
     */
    mountFeature(name, api) {
      if (name === 'execRoute') {
        if (!api || typeof api.routeOf !== 'function') {
          throw new PluginApiFeatureDisabledError('execRoute', 'execRoute owner is unavailable')
        }
        const token = {}
        this._execRouteDelegate = (exec) => api.routeOf(exec)
        this._execRouteToken = token
        return token
      }
      if (name === 'llm/admission') {
        this.llm.admission = api
        return
      }
      if (name === 'llm') {
        for (const [key, value] of Object.entries(api)) this.llm[key] = value
        return
      }
      if (name === 'events') {
        this.events = api
        return
      }





      if (name === 'tools') {
        this._toolsMounted = true
        return
      }
      if (name === 'agent') {
        api.routeOf = (exec) => this._execRouteDelegate(exec)
        this.agent = api
        return
      }
      if (name === 'session') {
        this.session = api
        return
      }
      if (name === 'systemPrompt') {
        this.systemPrompt = api
        return
      }
      if (name === 'settings') {
        this.settings = api
        return
      }
      if (name === 'services') {
        this.services = api
        return
      }
      throw new PluginApiFeatureDisabledError(name, `cannot mount unknown feature "${name}"`)
    }

    unmountFeature(name, token) {
      if (name !== 'execRoute' || token !== this._execRouteToken) return false
      this._execRouteDelegate = this._execRouteDisabled
      this._execRouteToken = null
      return true
    }
  }
}
