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
import { createDisabledServicesNamespace } from './services.js'
import { satisfiesContract } from './version.js'

export const pluginApiBrand = Symbol.for('@deepseek-ai/dsh-plugin-api/pluginApi')

function createDisabledAdmissionApi(active) {
  return {
    register() {
      if (!active()) throw new PluginApiInactiveError()
      throw new PluginApiFeatureDisabledError('llm/admission')
    },
  }
}

function createDisabledRequestApi(active) {
  return {
    transform() {
      if (!active()) throw new PluginApiInactiveError()
      throw new PluginApiFeatureDisabledError('llm/request')
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





function createDisabledToolsApi(active) {
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
  }
}

function createToolsApi(tools) {
  return {
    isActive: true,
    register(definition) {
      return tools.register(definition)
    },
    restrict(filter) {
      return tools.restrict(filter)
    },
    guard(guard) {
      return tools.guard(guard)
    },
    get(name, scope) {
      return tools.get(name, scope)
    },
    schemas(scope) {
      return tools.schemas(scope)
    },
    execute(input) {
      return tools.execute(input)
    },
    presentAs(...args) {
      return tools.presentAs(...args)
    },
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


function createDisabledAgentApi(active) {
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('agent')
  }
  return {
    isActive: false,
    get: fail,
    list: fail,
    roots: fail,
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
export function createPluginApiService({ apiVersion, registry, coreActive = false } = {}) {
  const active = typeof coreActive === 'function' ? coreActive : () => Boolean(coreActive)

  return class PluginApiService extends Service {
    static inject = []

    constructor(ctx, config) {
      super(ctx, 'pluginApi')
      this[pluginApiBrand] = true
      this.apiVersion = apiVersion
      this._active = active
      this._registry = registry
      this.llm = {
        ...createDisabledLlmApi(active),
        admission: createDisabledAdmissionApi(active),
        request: createDisabledRequestApi(active),
      }
      this.events = createDisabledEventsApi(active)




      this._toolsMounted = false
      this._toolsDisabled = createDisabledToolsApi(active)
      Object.defineProperty(this, 'tools', {
        enumerable: true,
        configurable: false,
        get() {
          if (!this._toolsMounted) return this._toolsDisabled
          // Scope-aware resolution with fail-safe guard (task 2.7): the
          // accessor keeps caller-fiber scope via this.ctx, but a throwing or
          // vanished official service surfaces a typed facade error instead of
          // escaping raw into third-party code.
          let tools
          try {
            tools = typeof this.ctx?.get === 'function' ? this.ctx.get('tools') : undefined
          } catch {
            tools = undefined
          }
          if (tools == null) {
            throw new PluginApiFeatureDisabledError('tools', 'official tools service is no longer resolvable')
          }
          return createToolsApi(tools)
        },
      })
      this.agent = createDisabledAgentApi(active)
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

    /**
     * Mount a feature API. Only known feature names are mountable; the host
     * apply calls this only after the feature guard passed. M1 mounters use
     * this immediate path; B mounters use `prepareFeature` so cleanup
     * registration and registry activation can precede publication.
     */
    mountFeature(name, api) {
      this._assignFeature(name, api)
    }

    /**
     * Staged feature publication (first B facade activation; semantic-hooks
     * M2 A1 transaction gate). Captures the candidate without changing any
     * public facade field. `commit()` publishes through the exact internal
     * assignment path used by `mountFeature`, at most once. `rollback()`
     * discards the candidate and restores the disabled facade surface only
     * while this transaction still owns the published slot, so a stale
     * transaction can never alter a later mount. Both are identity-bound and
     * idempotent; `mountFeature` remains immediate for M1 mounters.
     */
    prepareFeature(name, api) {
      if (!KNOWN_FEATURES.has(name)) {
        throw new PluginApiFeatureDisabledError(name, `cannot prepare unknown feature "${name}"`)
      }
      if (name === 'tools' || name === 'llm') {
        // tools mounts through a private flag and llm merges entries into a
        // shared surface; neither is a replaceable slot, so a stale prepared
        // transaction could not prove slot ownership on rollback.
        throw new PluginApiFeatureDisabledError(name, `staged preparation is not supported for feature "${name}"`)
      }
      const transaction = { name, api, state: 'prepared' }
      return {
        commit: () => {
          if (transaction.state !== 'prepared') return false
          transaction.state = 'committed'
          this._assignFeature(name, api)
          return true
        },
        rollback: () => {
          if (transaction.state === 'rolled-back') return false
          const wasCommitted = transaction.state === 'committed'
          transaction.state = 'rolled-back'
          if (wasCommitted) this._restoreDisabledSurface(name, api)
          return true
        },
      }
    }

    /** Internal assignment path shared by mountFeature and prepared commit. */
    _assignFeature(name, api) {
      if (name === 'llm/admission') {
        this.llm.admission = api
        return
      }
      if (name === 'llm/request') {
        this.llm.request = api
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

    _readSlot(name) {
      if (name === 'llm/admission') return this.llm.admission
      if (name === 'llm/request') return this.llm.request
      if (name === 'llm') return this.llm
      if (name === 'events') return this.events
      if (name === 'agent') return this.agent
      if (name === 'session') return this.session
      if (name === 'systemPrompt') return this.systemPrompt
      if (name === 'settings') return this.settings
      if (name === 'services') return this.services
      return undefined
    }

    _disabledSurfaceFor(name) {
      if (name === 'llm/admission') return createDisabledAdmissionApi(this._active)
      if (name === 'llm/request') return createDisabledRequestApi(this._active)
      if (name === 'llm') return createDisabledLlmApi(this._active)
      if (name === 'events') return createDisabledEventsApi(this._active)
      if (name === 'agent') return createDisabledAgentApi(this._active)
      if (name === 'session') return createDisabledSessionApi(this._active)
      if (name === 'systemPrompt') return createDisabledSystemPromptApi(this._active)
      if (name === 'settings') return createDisabledSettingsApi(this._active)
      if (name === 'services') return createDisabledServicesNamespace(this._active)
      return undefined
    }

    /** Restore the disabled facade only while this transaction owns the slot. */
    _restoreDisabledSurface(name, api) {
      if (this._readSlot(name) === api) {
        const surface = this._disabledSurfaceFor(name)
        if (surface !== undefined) this._assignFeature(name, surface)
      }
    }
  }
}

const KNOWN_FEATURES = new Set([
  'llm/admission',
  'llm/request',
  'llm',
  'events',
  'tools',
  'agent',
  'session',
  'systemPrompt',
  'settings',
  'services',
])
