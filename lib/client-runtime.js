import * as zod from 'zod'
import { satisfiesContract } from './version.js'
import { PluginApiCapabilityUnavailableError, PluginApiInactiveError, PluginApiVersionError } from './errors.js'
import { createClientConnection } from './client-connection.js'
import { createClientCodec } from './client-codec.js'
import { createClientRemoteContribution } from './client-remote-contribution.js'
import { createClientSettingsRemote } from './client-settings-remote.js'
import { createClientSettingsScope } from './client-settings-scope.js'
import { createClientSlots } from './client-slots.js'
import { createClientSlotEvents } from './client-slot-events.js'
import { createClientRemoteEvents } from './client-remote-events.js'
import { createClientOfficialServices } from './client-official-services.js'
import { createClientOfficialEvents, CLIENT_EVENT_NAMES } from './client-official-events.js'
import { createClientOfficialConnection } from './client-official-connection.js'
import { createClientLifecycle } from './client-generation-rebind.js'
// attention client face + session interaction client face (integration wave)
import { createClientAttentionFace } from './client-attention-face.js'
import { createClientSessionInteractionOperation } from './client-session-interaction-operation.js'
import { createClientRequestTransport } from './client-request-bridge.js'
// attention client face + session interaction client face (integration wave)
import {
  bootstrapClientLeaf,
  CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS,
  createClientLeafFacade,
  createClientLeafRecord,
  CLIENT_REASONS,
} from './client-official-passthrough.js'

export const CLIENT_MOUNTERS = Object.freeze([
  'clientManifest',
  'clientConnection',
  'clientCodec',
  'clientOfficialServices',
  'clientRemoteContribution',
  'clientSettingsRemote',
  'clientSettingsScope',
  'clientSlots',
  'clientSlotEvents',
  'clientRemoteEvents',
])

export const CLIENT_OFFICIAL_LEAVES = Object.freeze(
  CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS.map((descriptor) => descriptor.featureName),
)

// Optional browser services are resolved inside each leaf's own guard, never as
// top-level Cordis injections. A missing service therefore disables only its
// owning leaf instead of leaving the whole client entry pending.
export const inject = []

const clientPluginApiBrand = Symbol.for('@deepseek-ai/dsh-plugin-api/client-pluginApi')

// Client capability inventory mirroring the registry clientDomainTree. The
// registry test asserts this stays in sync with the public contract registry.
export const CLIENT_CAPABILITY_PATHS = Object.freeze([
  'isActive',
  'apiVersion',
  'assertCompatible',
  'capabilities',
  'connection',
  'events',
  'remotes',
  'settings',
  'slots',
  'lifecycle',
  'codec',
  'services',
  'sessions',
  'attention',
])

const CLIENT_API_VERSION = '0.1'

/**
 * Frozen `capabilities` query surface for the browser facade. Same typed
 * vocabulary as the host (active | degraded | unavailable); a leaf is active
 * when the root is active and the named public member resolves a live object.
 */
function createClientCapabilitiesApi({ isActive, resolveAvailability }) {
  const activeOf = (capability) => {
    if (!isActive()) throw new PluginApiInactiveError()
    if (!CLIENT_CAPABILITY_PATHS.includes(capability)) {
      throw new PluginApiCapabilityUnavailableError(capability, { reason: 'unknown capability' })
    }
    let status
    try {
      status = resolveAvailability(capability) ? 'active' : 'unavailable'
    } catch {
      status = 'unavailable'
    }
    return Object.freeze({ capability, status })
  }
  return Object.freeze({
    get: (capability) => activeOf(capability),
    list: ({ prefix } = {}) => {
      if (!isActive()) throw new PluginApiInactiveError()
      return Object.freeze(
        CLIENT_CAPABILITY_PATHS.filter((path) => prefix === undefined || path.startsWith(prefix)),
      )
    },
    require: (capabilities = []) => {
      const missing = []
      for (const capability of capabilities) {
        if (activeOf(capability).status !== 'active') missing.push(capability)
      }
      if (missing.length > 0) {
        throw new PluginApiCapabilityUnavailableError(missing[0], { reason: `required capabilities unavailable: ${missing.join(', ')}` })
      }
      return true
    },
  })
}
const CORDIS_TRACKER = Symbol.for('cordis.tracker')
const CORDIS_ORIGINAL = Symbol.for('cordis.original')
const clientBuilderKey = Symbol('clientBuilder')
const clientDisposeKey = Symbol('clientDispose')
const owners = new WeakMap()

/**
 * Root prototype for the client facade. Every public member getter runs with
 * `this.ctx` bound to the consuming context through the Cordis service
 * tracing contract, so each read resolves through a caller-bound composition
 * while shared member identities stay stable.
 */
const clientPluginApiRootPrototype = Object.freeze(Object.defineProperties(
  Object.create(null),
  Object.fromEntries(
    CLIENT_CAPABILITY_PATHS.map((name) => [name, {
      enumerable: true,
      configurable: false,
      get() {
        return this[clientBuilderKey](this.ctx)[name]
      },
    }]),
  ),
))

/**
 * Build the traceable root value. It registers under `pluginApi` through the
 * ordinary reflect provide and carries the Cordis tracker contract, so each
 * caller-bound read resolves `this.ctx` to the actual consuming context.
 */
export function createClientApiRoot(ctx, { clientBuilder, dispose }) {
  const root = Object.create(clientPluginApiRootPrototype)
  root.name = 'pluginApi'
  // `ctx` stays a writable own property: the Cordis tracing proxy must be able
  // to rebind `this.ctx` to the consuming context (proxy invariant holds only
  // for configurable/writable target properties), matching how Service
  // instances expose `ctx`.
  root.ctx = ctx
  root[clientBuilderKey] = clientBuilder
  root[clientPluginApiBrand] = true
  // The symbol-keyed disposer is returned on reapply so that identity is
  // preserved even through the traced service wrapper (string members get
  // wrapped by the tracing layer).
  root[clientDisposeKey] = dispose
  root.__dshPluginApiDispose = dispose
  Object.defineProperty(root, CORDIS_TRACKER, {
    value: { associate: 'pluginApi', property: 'ctx' },
  })
  return root
}

/**
 * Browser-side counterpart of the host facade. The root publishes synchronously
 * with the existing client face, the official browser leaves, and the seven
 * official passthrough leaves; leaf activation is driven by the optional
 * browser module loader and never makes the client fiber pending.
 */
export function apply(ctx) {
  const existing = safelyGet(ctx, 'pluginApi')
  if (existing?.[clientPluginApiBrand]) return existing[clientDisposeKey] ?? existing.__dshPluginApiDispose

  const active = { value: true }
  const isActive = () => active.value
  const logger = safeLogger(ctx)
  let api = null
  let unregister = null

  try {
    const connection = createClientConnection({ ctx, active: isActive })
    const codec = createClientCodec(zod)
    // Official browser leaves mount through the declared join order. Their
    // aggregate results already carry the exported faces and disposers, so
    // the central join composes them directly.
    const officialServices = createClientOfficialServices({ ctx, active: isActive, logger })
    const officialEvents = createClientOfficialEvents({ ctx, active: isActive, logger })
    const officialConnection = createClientOfficialConnection({ ctx, active: isActive, logger })
    const remoteContribution = createClientRemoteContribution({ ctx, active: isActive, logger })
    const settingsRemote = createClientSettingsRemote({
      remoteContribution,
      remote: safelyGet(ctx, 'remote'),
      codec,
      logger,
    })
    const settingsScope = createClientSettingsScope({ ctx, active: isActive })
    const slotEvents = createClientSlotEvents({ ctx, active: isActive, logger })
    const slots = createClientSlots({ ctx, active: isActive })
    const remoteEvents = createClientRemoteEvents({ ctx, active: isActive, logger })
    const lifecycle = createClientLifecycle({
      ctx,
      active: isActive,
      logger,
      connection: safelyGet(ctx, 'connection'),
      remote: safelyGet(ctx, 'remote'),
      remoteContribution,
      slots,
      settingsScope,
      clientModules: safelyGet(ctx, 'clientModules'),
      modules: safelyGet(ctx, 'modules'),
    })

    // Client-side rebind epoch: every lifecycle change/rebind notification
    // bumps the counter so in-flight session requests on a stale generation
    // resolve as typed unavailable (never a stale write on a new epoch).
    let clientEpoch = 0
    try {
      lifecycle.api.observe(() => {
        clientEpoch += 1
      })
    } catch {
      // a missing lifecycle observer leaves the epoch constant
    }
    const epochOf = () => clientEpoch

    // Attention runtime resolution: the client-runtime replacement module
    // publishes the browser attention runtime under the internal contract
    // symbol; before it executes (or in headless shells) the face degrades to
    // a typed unavailable projection with the stable member shape.
    const attentionRuntimeSource = () => {
      try {
        const g = typeof globalThis !== 'undefined' ? globalThis : {}
        return g[Symbol.for('dsh-plugin-api.attention.runtime')] ?? null
      } catch {
        return null
      }
    }
    const buildClientAttentionFace = () => {
      const runtime = attentionRuntimeSource()
      if (!runtime || typeof runtime.current !== 'function') {
        const unavailable = Object.freeze({ status: 'unavailable', reason: 'attention runtime is not installed' })
        const unavailableCall = () => Promise.resolve(Object.freeze({ ok: false, code: 'unavailable', reason: 'attention runtime is not installed' }))
        return Object.freeze({
          current: () => Object.freeze([]),
          list: () => Object.freeze({ items: [], nextCursor: undefined }),
          observe: () => Object.freeze({ current: () => Object.freeze([]), subscribe: () => () => false, dispose() {}, epoch: 0 }),
          contribute: unavailableCall,
          dismiss: unavailableCall,
          invoke: unavailableCall,
          availability: () => unavailable,
        })
      }
      return createClientAttentionFace({ kind: 'web', runtime })
    }

    // The llm face rides the existing connection face; an unavailable
    // official api.llm keeps the face in its failing leaf shape.
    const connectionApi = {}
    if (officialConnection.api.api.llm) connectionApi.llm = officialConnection.api.api.llm

    const officialServicesApi = officialServices.api
    // The seven audited official browser leaves ride under services.* as pure
    // official passthrough faces (conversation, conversation events/views,
    // timer, command UI, input triggers, model directories).
    const m3Members = Object.freeze({
      connection: Object.freeze({
        rpc: connection.rpc,
        get: connection.api.settings,
        api: Object.freeze(connectionApi),
      }),
      codec,
      events: Object.freeze({
        observe(name, listener) { return officialEvents.api.on(name, listener) },
      }),
      remotes: Object.freeze({
        observe: remoteEvents.observe,
        dispatch: remoteEvents.dispatch,
        contribute: remoteContribution.mountRemote,
      }),
      settings: Object.freeze({
        scope: settingsScope,
        remote: Object.freeze({
          contribute: settingsRemote.contribute,
        }),
      }),
      slots: Object.freeze({
        contribute: slots.register,
        list: slots.entries,
        observe: slotEvents.on,
      }),
    })

    // Root state: one record per leaf, published as a pending shell before any
    // module import starts. The leaf records outlive the caller-bound client
    // compositions and are the only authority for leaf state.
    const modules = safelyGet(ctx, 'modules')
    const rootState = {
      active: isActive,
      current: true,
      ownerCtx: ctx,
      modules: modules ?? null,
      leaves: new Map(),
    }
    const reportLeaf = (surfaceKey, reason) => {
      logger.error(`dsh-plugin-api client unavailable (${surfaceKey}, ${reason})`)
    }
    for (const descriptor of CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS) {
      rootState.leaves.set(descriptor.surfaceKey, createClientLeafRecord(descriptor, reportLeaf))
    }
    if (!rootState.modules) {
      for (const record of rootState.leaves.values()) {
        record.settleDisabled(CLIENT_REASONS.missingService)
      }
    }

    const buildClient = (callerCtx) => {
      const composition = {}
      Object.assign(composition, m3Members)
      composition.lifecycle = lifecycle.forCaller(callerCtx)
      // Sessions request/cancel client face + attention client face
      // (integration wave): absent carriers/runtimes degrade to typed
      // unavailable surfaces, never queued or fabricated.
      const sessionsTransport = createClientRequestTransport({ ctx, path: '/plugin-api/sessions', epoch: epochOf })
      const sessionsFace = createClientSessionInteractionOperation({
        transport: sessionsTransport,
        availabilityProbe: () => (sessionsTransport.active ? { status: 'active' } : { status: 'unavailable', reason: 'session request carrier is not wired' }),
        epoch: epochOf,
        logger,
      })
      composition.sessions = Object.freeze({
        request: sessionsFace.request,
        cancel: sessionsFace.cancel,
        availability: sessionsFace.availability,
      })
      composition.attention = buildClientAttentionFace()
      // Official browser leaves ride under services.* with caller-bound
      // resolution; leaf activation stays owner-local and fail-safe.
      const services = Object.create(null)
      for (const [key, value] of Object.entries(officialServicesApi)) {
        services[key] = value
      }
      for (const descriptor of CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS) {
        services[descriptor.serviceName] = createClientLeafFacade(
          rootState.leaves.get(descriptor.surfaceKey),
          rootState,
          callerCtx,
        )
      }
      composition.services = Object.freeze(services)
      const capabilities = createClientCapabilitiesApi({
        isActive,
        resolveAvailability: (capability) => {
          if (!active.value) return false
          return composition[capability] !== undefined
        },
      })
      return Object.freeze(Object.defineProperties(composition, {
        isActive: { enumerable: true, get: () => active.value },
        apiVersion: { enumerable: true, value: CLIENT_API_VERSION },
        capabilities: { enumerable: true, value: capabilities },
        assertCompatible: {
          enumerable: true,
          value(requirement, pluginName) {
            if (!active.value) throw new PluginApiInactiveError()
            if (!satisfiesContract(requirement, CLIENT_API_VERSION)) {
              throw new PluginApiVersionError({
                declared: CLIENT_API_VERSION,
                required: requirement,
                pluginName,
              })
            }
            return true
          },
        },
      }))
    }

    const dispose = async () => {
      if (!active.value) return false
      active.value = false
      for (const record of rootState.leaves.values()) record.invalidate()
      rootState.current = false
      for (const surface of [lifecycle, remoteEvents, slotEvents, slots, settingsScope, settingsRemote, remoteContribution, officialConnection, officialEvents, officialServices, connection]) {
        try { await surface.dispose?.() } catch { logger.error('dsh-plugin-api client cleanup failed') }
      }
      if (owners.get(ctx) === record) owners.delete(ctx)
      if (unwrapService(safelyGet(ctx, 'pluginApi')) === api) {
        try { await unregister?.() } catch { logger.error('dsh-plugin-api client unregister failed') }
      }
      return true
    }
    api = createClientApiRoot(ctx, { clientBuilder: buildClient, dispose })
    unregister = ctx.reflect.provide('pluginApi', api)
    if (unregister !== undefined && typeof unregister !== 'function') {
      throw new TypeError('ctx.reflect.provide returned a malformed disposer')
    }

    if (rootState.modules) {
      for (const descriptor of CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS) {
        const task = bootstrapClientLeaf(rootState, rootState.leaves.get(descriptor.surfaceKey))
        task.catch(() => {}) // explicit rejection boundary; bootstrap never rejects
      }
    }

    const record = { api, dispose }
    owners.set(ctx, record)
    return dispose
  } catch (error) {
    active.value = false
    try { unregister?.() } catch {}
    if (owners.get(ctx)?.api === api) owners.delete(ctx)
    logger.error('dsh-plugin-api client apply disabled')
    return () => false
  }
}

function safelyGet(ctx, name) {
  try { return typeof ctx?.get === 'function' ? ctx.get(name) : ctx?.[name] } catch { return undefined }
}

function unwrapService(value) {
  if (!value) return value
  return value[CORDIS_ORIGINAL] ?? value
}

function safeLogger(ctx) {
  return Object.freeze({
    error(message) {
      try { ctx?.logger?.error?.(message) } catch {}
    },
  })
}
