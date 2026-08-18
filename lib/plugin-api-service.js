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

const durableEpochRecords = new WeakMap()

function createDisabledAdmissionApi(active) {
  return Object.freeze({
    register() {
      if (!active()) throw new PluginApiInactiveError()
      throw new PluginApiFeatureDisabledError('llm/admission')
    },
  })
}

function createDisabledRequestApi(active) {
  return Object.freeze({
    transform() {
      if (!active()) throw new PluginApiInactiveError()
      throw new PluginApiFeatureDisabledError('llm/request')
    },
  })
}

function createDisabledLlmApi(active) {
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('llm')
  }
  return Object.freeze({
    get isActive() {
      return false
    },
    modelInfo: fail,
    prepareCall: fail,
    stream: fail,
    registerAdapter: fail,
    registerConfigurableProviders: fail,
    registerModelDiscovery: fail,
  })
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
  return Object.freeze({
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
  })
}

function createDisabledSystemPromptApi(active) {
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('systemPrompt')
  }
  return Object.freeze({
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
  })
}


function createDisabledAgentApi(active, routeOf) {
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('agent')
  }
  const failA11 = (member) => () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('agent', `A11 member "${member}" is unavailable`)
  }
  const unavailable = {
    create: failA11('create'),
    resume: failA11('resume'),
    register: failA11('register'),
    enter: failA11('provider.enter'),
    announce: failA11('provider.announce'),
    setFactory: failA11('provider.setFactory'),
  }
  return Object.freeze({
    isActive: false,
    get: fail,
    list: fail,
    roots: fail,
    routeOf,
    create: unavailable.create,
    resume: unavailable.resume,
    register: unavailable.register,
    provider: Object.freeze({
      isActive: false,
      enter: unavailable.enter,
      announce: unavailable.announce,
      setFactory: unavailable.setFactory,
    }),
    availability: Object.freeze({
      create: false,
      resume: false,
      register: false,
      provider: Object.freeze({
        enter: false,
        announce: false,
        setFactory: false,
      }),
    }),
  })
}

function createDisabledSessionApi(active) {
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('session')
  }
  return Object.freeze({
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
  })
}

function createDisabledSessionRouteApi(active) {
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('sessionRoute')
  }
  return Object.freeze({ current: fail, on: fail, once: fail, wait: fail })
}

function createDisabledSessionDurableApi(active) {
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('sessionDurable')
  }
  return {
    get durableEventTypes() {
      return fail()
    },
    get durableEventDescriptors() {
      return fail()
    },
    isDurableEventType: fail,
    getDurableEventDescriptor: fail,
    onDurable: fail,
    onceDurable: fail,
    appendMessage: fail,
  }
}

const durableSessionMethodNames = [
  'isDurableEventType',
  'getDurableEventDescriptor',
  'onDurable',
  'onceDurable',
  'appendMessage',
]

function createActiveSessionDurableApi({ availability, epoch, facade }) {
  const assertAvailable = () => {
    const { active, registry } = availability()
    if (!active) throw new PluginApiInactiveError()
    if (!epoch.current || !registry?.isActive?.('sessionDurable')) {
      throw new PluginApiFeatureDisabledError('sessionDurable')
    }
  }
  const api = {
    get durableEventTypes() {
      assertAvailable()
      return facade.durableEventTypes
    },
    get durableEventDescriptors() {
      assertAvailable()
      return facade.durableEventDescriptors
    },
  }
  for (const name of durableSessionMethodNames) {
    api[name] = (...args) => {
      assertAvailable()
      return Reflect.apply(facade[name], facade, args)
    }
  }
  return api
}

function composeSessionApi(baseSessionApi, durableSessionApi) {
  return Object.freeze(Object.defineProperties(
    Object.create(Object.getPrototypeOf(baseSessionApi) ?? Object.prototype),
    {
      ...Object.getOwnPropertyDescriptors(baseSessionApi),
      ...Object.getOwnPropertyDescriptors(durableSessionApi),
    },
  ))
}

function createDisabledSettingsApi(active) {
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('settings')
  }
  return Object.freeze({
    isActive: false,
    register: fail,
    scope: fail,
    describe: fail,
    installSettingsSection: fail,
  })
}

function composeSurface(base, additions = {}) {
  return Object.freeze(Object.defineProperties(
    Object.create(Object.getPrototypeOf(base) ?? Object.prototype),
    { ...Object.getOwnPropertyDescriptors(base), ...Object.getOwnPropertyDescriptors(additions) },
  ))
}

function createFeatureSlot({ active, feature, api, methods, isCurrent }) {
  const record = { current: true, api: null, surface: null }
  const assertAvailable = () => {
    if (!active()) throw new PluginApiInactiveError()
    if (!record.current || isCurrent() !== record) throw new PluginApiFeatureDisabledError(feature)
  }
  const surface = {}
  for (const name of methods) {
    surface[name] = (...args) => {
      assertAvailable()
      return Reflect.apply(api[name], api, args)
    }
  }
  record.api = api
  record.surface = Object.freeze(surface)
  return record
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
      this._sessionRouteSlot = null
      this._routingSurface = null
      this._llmBaseApi = createDisabledLlmApi(active)
      this._llmRequestSlot = null
      this._llmAdmissionSlot = null
      this._installLlmSlot('llm/request', createDisabledRequestApi(active))
      this._installLlmSlot('llm/admission', createDisabledAdmissionApi(active))
      Object.defineProperty(this, 'llm', {
        enumerable: true,
        configurable: false,
        get: () => composeSurface(this._llmBaseApi, {
          admission: this._llmAdmissionSlot.surface,
          request: this._llmRequestSlot.surface,
        }),
      })
      this._eventsSurface = createDisabledEventsApi(active)
      Object.defineProperty(this, 'events', {
        enumerable: true,
        configurable: false,
        get: () => this._eventsSurface,
      })




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
      this._agentFactory = () => createDisabledAgentApi(active, (exec) => this._execRouteDelegate(exec))
      this._agentToken = null
      this._agentExtensions = new Map()
      Object.defineProperty(this, 'agent', {
        enumerable: true,
        configurable: false,
        get() {
          let view = this._agentFactory(this.ctx)
          for (const extension of this._agentExtensions.values()) {
            view = extension(this.ctx, view)
          }
          return composeSurface(view, { routeOf: (exec) => this._execRouteDelegate(exec) })
        },
      })
      this._baseSessionApi = createDisabledSessionApi(active)
      this._durableEpoch = null
      this._durableEpochSequence = 0
      this._durableSessionApi = createDisabledSessionDurableApi(() => this._active())
      this._sessionSurface = null
      Object.defineProperty(this, 'session', {
        enumerable: true,
        configurable: false,
        get: () => this._sessionSurface,
      })
      this._publishSessionApi()
      this._publishRoutingSurface()
      this._systemPromptSurface = createDisabledSystemPromptApi(active)
      this._settingsSurface = createDisabledSettingsApi(active)
      this._servicesSurface = createDisabledServicesNamespace(active)
      Object.defineProperties(this, {
        systemPrompt: { enumerable: true, configurable: false, get: () => this._systemPromptSurface },
        settings: { enumerable: true, configurable: false, get: () => this._settingsSurface },
        services: { enumerable: true, configurable: false, get: () => this._servicesSurface },
        routing: { enumerable: true, configurable: false, get: () => this._routingSurface },
      })
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

    _publishSessionApi() {
      this._sessionSurface = composeSessionApi(this._baseSessionApi, this._durableSessionApi)
    }

    _publishRoutingSurface() {
      // `routing` is a service-lifetime namespace.  Its methods resolve the
      // current owner slots dynamically; remounting a leaf must not replace
      // the public object identity held by consumers.
      if (this._routingSurface) return this._routingSurface
      const service = this
      const core = () => {
        if (!service._active()) throw new PluginApiInactiveError()
      }
      const exec = (value) => {
        core()
        const execToken = service._execRouteToken
        if (!execToken?.current || service._execRouteToken !== execToken) {
          throw new PluginApiFeatureDisabledError('execRoute')
        }
        return Reflect.apply(execToken.api.routeOf, execToken.api, [value])
      }
      const sessionMethod = (name) => (...args) => {
        core()
        const sessionSlot = service._sessionRouteSlot
        if (!sessionSlot?.current || service._sessionRouteSlot !== sessionSlot) {
          throw new PluginApiFeatureDisabledError('sessionRoute')
        }
        return Reflect.apply(sessionSlot.api[name], sessionSlot.api, args)
      }
      this._routingSurface = Object.freeze({
        ofExecution: exec,
        current: sessionMethod('current'),
        on: sessionMethod('on'),
        once: sessionMethod('once'),
        wait: sessionMethod('wait'),
        get availability() {
          core()
          return Object.freeze({
            execution: Boolean(service._registry?.isActive?.('execRoute')),
            session: Boolean(service._registry?.isActive?.('sessionRoute')),
          })
        },
      })
    }

    _installLlmSlot(name, api) {
      const field = name === 'llm/request' ? '_llmRequestSlot' : '_llmAdmissionSlot'
      const methods = name === 'llm/request' ? ['transform'] : ['register']
      const previous = this[field]
      if (previous) previous.current = false
      const record = createFeatureSlot({
        active: () => this._active(),
        feature: name,
        api,
        methods,
        isCurrent: () => this[field],
      })
      this[field] = record
      return record
    }

    _warnSessionDurable(message) {
      try {
        this.ctx?.logger?.warn?.(message)
      } catch {
        // durable cleanup must not depend on logging
      }
    }

    resetSessionDurable(epoch) {
      const record = durableEpochRecords.get(epoch)
      if (this._durableEpoch !== epoch || !record?.current) return false
      record.current = false
      this._durableEpoch = null
      this._durableSessionApi = createDisabledSessionDurableApi(() => this._active())
      this._publishSessionApi()
      try {
        record.closeEpoch()
      } catch {
        this._warnSessionDurable('dsh-plugin-api session durable: epoch cleanup failed')
      }
      return true
    }

    _mountSessionDurable(api) {
      const facade = api?.facade
      const closeEpoch = api?.closeEpoch
      if (!facade || typeof facade !== 'object' || typeof closeEpoch !== 'function') {
        throw new PluginApiFeatureDisabledError('sessionDurable', 'invalid durable epoch')
      }
      const epoch = Object.freeze({})
      const record = { current: true, closeEpoch, sequence: ++this._durableEpochSequence }
      if (this._durableEpoch) this.resetSessionDurable(this._durableEpoch)
      durableEpochRecords.set(epoch, record)
      this._durableEpoch = epoch
      this._durableSessionApi = createActiveSessionDurableApi({
        availability: () => ({ active: this._active(), registry: this._registry }),
        epoch: record,
        facade,
      })
      this._publishSessionApi()
      return epoch
    }

    /**
     * Mount a feature API. Only known feature names are mountable; the host
     * apply calls this only after the feature guard passed. M1 mounters use
     * this immediate path; B mounters use `prepareFeature` so cleanup
     * registration and registry activation can precede publication.
     */
    mountFeature(name, api) {
      return this._assignFeature(name, api)
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
      if (name === 'sessionDurable') {
        const transaction = { state: 'prepared', epoch: null }
        return {
          commit: () => {
            if (transaction.state !== 'prepared') return false
            transaction.epoch = this._mountSessionDurable(api)
            api?.onMounted?.(transaction.epoch)
            transaction.state = 'committed'
            return true
          },
          rollback: () => {
            if (transaction.state === 'rolled-back') return false
            const wasCommitted = transaction.state === 'committed'
            transaction.state = 'rolled-back'
            if (wasCommitted) this.resetSessionDurable(transaction.epoch)
            return true
          },
        }
      }
      if (name === 'sessionRoute') {
        const transaction = { state: 'prepared', token: null }
        return {
          commit: () => {
            if (transaction.state !== 'prepared') return false
            transaction.token = this._assignFeature(name, api)
            transaction.state = 'committed'
            return true
          },
          rollback: () => {
            if (transaction.state === 'rolled-back') return false
            const committed = transaction.state === 'committed'
            transaction.state = 'rolled-back'
            if (committed) this.unmountFeature(name, transaction.token)
            return true
          },
        }
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
      if (name === 'execRoute') {
        if (!api || typeof api.routeOf !== 'function') {
          throw new PluginApiFeatureDisabledError('execRoute', 'execRoute owner is unavailable')
        }
        if (this._execRouteToken) this._execRouteToken.current = false
        const token = { api, current: true }
        this._execRouteDelegate = (exec) => api.routeOf(exec)
        this._execRouteToken = token
        this._publishRoutingSurface()
        return token
      }
      if (name === 'llm/admission') {
        return this._installLlmSlot(name, api)
      }
      if (name === 'llm/request') {
        return this._installLlmSlot(name, api)
      }
      if (name === 'llm') {
        this._llmBaseApi = composeSurface(this._llmBaseApi, api)
        return
      }
      if (name === 'events') {
        this._eventsSurface = composeSurface(api)
        return
      }
      if (name === 'tools') {
        this._toolsMounted = true
        return
      }
      if (name === 'agentExtension') {
        if (!api || typeof api.name !== 'string' || typeof api.compose !== 'function') {
          throw new PluginApiFeatureDisabledError('agent', 'agent extension is unavailable')
        }
        const token = { name: api.name, compose: api.compose }
        this._agentExtensions.set(token, api.compose)
        return token
      }
      if (name === 'agent') {
        if (typeof api !== 'function') {
          throw new PluginApiFeatureDisabledError('agent', 'agent facade factory is unavailable')
        }
        const token = {
          previousFactory: this._agentFactory,
          previousToken: this._agentToken,
        }
        this._agentFactory = api
        this._agentToken = token
        this._agentBaseFactory ??= token.previousFactory
        return token
      }
      if (name === 'session') {
        this._baseSessionApi = api
        this._publishSessionApi()
        return
      }
      if (name === 'sessionRoute') {
        if (!api || typeof api.current !== 'function' || typeof api.on !== 'function'
          || typeof api.once !== 'function' || typeof api.wait !== 'function') {
          throw new PluginApiFeatureDisabledError('sessionRoute', 'session route owner is unavailable')
        }
        if (this._sessionRouteSlot) this._sessionRouteSlot.current = false
        this._sessionRouteSlot = createFeatureSlot({
          active: () => this._active(),
          feature: 'sessionRoute',
          api,
          methods: ['current', 'on', 'once', 'wait'],
          isCurrent: () => this._sessionRouteSlot,
        })
        this._publishRoutingSurface()
        return this._sessionRouteSlot
      }
      if (name === 'sessionDurable') {
        return this._mountSessionDurable(api)
      }
      if (name === 'systemPrompt') {
        this._systemPromptSurface = composeSurface(api)
        return
      }
      if (name === 'settings') {
        this._settingsSurface = composeSurface(api)
        return
      }
      if (name === 'services') {
        this._servicesSurface = composeSurface(api)
        return
      }
      throw new PluginApiFeatureDisabledError(name, `cannot mount unknown feature "${name}"`)
    }

    _readSlot(name) {
      if (name === 'llm/admission') return this._llmAdmissionSlot.api
      if (name === 'llm/request') return this._llmRequestSlot.api
      if (name === 'llm') return this.llm
      if (name === 'events') return this._eventsSurface
      if (name === 'agent') return this.agent
      if (name === 'session') return this._sessionSurface
      if (name === 'sessionRoute') return this._sessionRouteSlot?.api
      if (name === 'systemPrompt') return this._systemPromptSurface
      if (name === 'settings') return this._settingsSurface
      if (name === 'services') return this._servicesSurface
      return undefined
    }

    _disabledSurfaceFor(name) {
      if (name === 'llm/admission') return createDisabledAdmissionApi(this._active)
      if (name === 'llm/request') return createDisabledRequestApi(this._active)
      if (name === 'llm') return createDisabledLlmApi(this._active)
      if (name === 'events') return createDisabledEventsApi(this._active)
      if (name === 'agent') return createDisabledAgentApi(this._active)
      if (name === 'session') return createDisabledSessionApi(this._active)
      if (name === 'sessionRoute') return createDisabledSessionRouteApi(this._active)
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

    _removeAgentExtension(token) {
      return Boolean(token && this._agentExtensions.delete(token))
    }

    _removeAgentExtensionByCompose(compose) {
      if (typeof compose !== 'function') return false
      for (const [token, extension] of this._agentExtensions) {
        if (extension !== compose) continue
        this._agentExtensions.delete(token)
        return true
      }
      return false
    }

    unmountFeature(name, token) {
      if (name === 'agentExtension') {
        return this._removeAgentExtension(token)
      }
      if (name === 'agent' && token === this._agentToken) {
        this._agentFactory = token.previousFactory ?? (() => createDisabledAgentApi(this._active, (exec) => this._execRouteDelegate(exec)))
        this._agentToken = token.previousToken ?? null
        return true
      }
      if (name === 'sessionRoute' && token === this._sessionRouteSlot) {
        token.current = false
        this._sessionRouteSlot = null
        this._publishRoutingSurface()
        return true
      }
      if (name !== 'execRoute' || token !== this._execRouteToken) return false
      if (token) token.current = false
      this._execRouteDelegate = this._execRouteDisabled
      this._execRouteToken = null
      this._publishRoutingSurface()
      return true
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
  'agentExtension',
  'execRoute',
  'sessionRoute',
  'session',
  'sessionDurable',
  'systemPrompt',
  'settings',
  'services',
])
