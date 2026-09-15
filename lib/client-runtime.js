import * as zod from 'zod'
import { satisfiesContract } from './version.js'
import { PluginApiCapabilityUnavailableError, PluginApiFeatureDisabledError, PluginApiInactiveError, PluginApiVersionError } from './errors.js'
import { createClientConnection } from './client-connection.js'
import { createClientCodec } from './client-codec.js'
import { createClientRemoteContribution } from './client-remote-contribution.js'
import { createClientSettingsRemote } from './client-settings-remote.js'
import { createClientSettingsScope } from './client-settings-scope.js'
import { createClientSlots, CLIENT_SLOTS_FEATURE } from './client-slots.js'
import { createClientSlotEvents } from './client-slot-events.js'
import { createClientRemoteEvents } from './client-remote-events.js'
import { createClientOfficialServices } from './client-official-services.js'
import { createClientOfficialEvents, CLIENT_EVENT_NAMES } from './client-official-events.js'
import { createClientOfficialConnection } from './client-official-connection.js'
import { createContributionHandle, createPendingContributionHandle } from './contract-kernel.js'

/** Client contributions carry no caller context here; the root token is the honest owner. */
const CLIENT_CONTRIBUTION_OWNER = 'root'
let clientContributionSequence = 0

/**
 * Contribution failure presentation: an unavailable environment is a code, not
 * a throw, and an unusable feature is reported apart from invalid input.
 */
function contributionFailure(error) {
  if (error instanceof PluginApiInactiveError) {
    return Object.freeze({ ok: false, code: 'inactive', reason: String(error?.message ?? error) })
  }
  if (error instanceof PluginApiFeatureDisabledError) {
    return Object.freeze({ ok: false, code: 'unavailable', reason: String(error?.message ?? error) })
  }
  return Object.freeze({ ok: false, code: 'invalid-input', reason: String(error?.message ?? error) })
}
import { createClientLifecycle } from './client-generation-rebind.js'
// attention client face + session interaction client face (integration wave)
import { createClientAttentionFace } from './client-attention-face.js'
import { createClientSessionInteractionOperation } from './client-session-interaction-operation.js'
import { createClientSessionsInteractions } from './client-sessions-interactions.js'
import { createClientSessionsSelection } from './client-sessions-selection.js'
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
/** Read one typed availability probe; a missing/failing probe is unavailable. */
function probeStatus(probe) {
  if (typeof probe !== 'function') return 'unavailable'
  try {
    const status = probe()?.status
    return status === 'active' || status === 'degraded' || status === 'unavailable' ? status : 'unavailable'
  } catch {
    return 'unavailable'
  }
}

/** The frozen three-value descriptor of one leaf. */
function leafDescriptor(available, reason) {
  return available === true
    ? Object.freeze({ status: 'active' })
    : Object.freeze({ status: 'unavailable', reason })
}

/** The root's own self-description members answer active while it is reachable. */
function activeDescriptor() {
  return Object.freeze({ status: 'active' })
}

/**
 * Namespace objects augmented with their `availability()` member, cached per
 * underlying namespace so repeated composition reads hand out the same object.
 * The probes read service-lifetime leaf state, so the first binding stays
 * correct for later reads.
 */
const augmentedNamespaces = new WeakMap()

function augmentNamespace(member, probe) {
  if (member === null || typeof member !== 'object') return member
  if (typeof member.availability === 'function') return member
  const cached = augmentedNamespaces.get(member)
  if (cached) return cached
  const augmented = Object.freeze(Object.defineProperties({ ...member }, {
    availability: { enumerable: true, value: () => probe() },
  }))
  augmentedNamespaces.set(member, augmented)
  return augmented
}

/**
 * Fold the descriptors of the leaves that back one namespace: all active is
 * `active`, none is `unavailable`, and a partial state is `degraded` with the
 * first unavailable reason kept as the caller-facing detail.
 */
function combinedDescriptor(...descriptors) {
  const unavailable = descriptors.filter((descriptor) => descriptor.status === 'unavailable')
  if (unavailable.length === 0) {
    const degraded = descriptors.find((descriptor) => descriptor.status === 'degraded')
    return degraded ?? Object.freeze({ status: 'active' })
  }
  if (unavailable.length === descriptors.length) return unavailable[0]
  return Object.freeze({ status: 'degraded', reason: unavailable[0].reason })
}

/**
 * Normalize another module's typed availability answer onto the public
 * three-value vocabulary, keeping its domain detail. A module that answers
 * nothing usable is unavailable, never active.
 */
function probeDescriptor(probe, fallbackReason) {
  if (typeof probe !== 'function') return Object.freeze({ status: 'unavailable', reason: fallbackReason })
  try {
    const value = probe()
    const status = value?.status
    if (status === 'active' || status === 'degraded' || status === 'unavailable') {
      return Object.freeze({ ...value, status })
    }
    return Object.freeze({ status: 'unavailable', reason: typeof status === 'string' ? status : fallbackReason })
  } catch {
    return Object.freeze({ status: 'unavailable', reason: fallbackReason })
  }
}

/**
 * Namespace roots whose members are addressable as member-level capability
 * paths.
 *
 * The four self-description members are not namespaces, and `services` is the
 * aggregate of the official browser leaves: those leaves report their own
 * official `isActive` state and are inventoried by the official service
 * whitelist, so addressing one of them through the aggregate would answer a
 * status it does not own.
 */
const CLIENT_NAMESPACE_ROOTS = Object.freeze(
  CLIENT_CAPABILITY_PATHS.filter((path) => !['isActive', 'apiVersion', 'assertCompatible', 'capabilities', 'services'].includes(path)),
)

function createClientCapabilitiesApi({ isActive, resolveAvailability, namespaceMembers }) {
  // The host accepts the public semantic dot paths of its capability
  // inventory; the client accepts its namespace roots and their members, so a
  // consumer asks about `slots.contribute` rather than being told the only
  // addressable names are fourteen roots. A member path is admitted only when
  // the member really exists on that namespace's live surface — an unknown
  // member is refused instead of inheriting a status it does not own.
  const resolvePath = (capability) => {
    if (CLIENT_CAPABILITY_PATHS.includes(capability)) return { root: capability }
    const separator = capability.indexOf('.')
    if (separator <= 0) return null
    const root = capability.slice(0, separator)
    const member = capability.slice(separator + 1)
    if (!CLIENT_NAMESPACE_ROOTS.includes(root)) return null
    if (member.includes('.') || !namespaceMembers(root).includes(member)) return null
    return { root }
  }
  const activeOf = (capability) => {
    if (!isActive()) throw new PluginApiInactiveError()
    const resolved = resolvePath(typeof capability === 'string' ? capability : String(capability))
    if (!resolved) {
      throw new PluginApiCapabilityUnavailableError(capability, { reason: 'unknown capability' })
    }
    let reported
    try {
      reported = resolveAvailability(resolved.root)
    } catch {
      reported = 'unavailable'
    }
    // Typed vocabulary shared with the host: a member answers with
    // `active | degraded | unavailable` (a boolean existence probe is read as
    // active/unavailable for the members that own no finer-grained state).
    let status = 'unavailable'
    if (reported === 'degraded') status = 'degraded'
    else if (reported === 'active' || reported === true) status = 'active'
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
        // Same gate as the host: only `unavailable` blocks a consumer. A
        // degraded capability is a real partial state and stays callable, so
        // it must be discoverable through `get` rather than hidden here.
        if (activeOf(capability).status === 'unavailable') missing.push(capability)
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
    const slots = createClientSlots({ ctx, active: isActive })
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

    // Client-side rebind epoch: the lifecycle controller owns the counter and
    // bumps it on every change/rebind notification, so in-flight session
    // requests on a stale generation resolve as typed unavailable (never a
    // stale write on a new epoch) and each observation handle can report the
    // epoch it was taken at.
    const epochOf = () => {
      try { return lifecycle.epoch() } catch { return 0 }
    }
    const slotEvents = createClientSlotEvents({ ctx, active: isActive, logger, epoch: epochOf })
    const remoteEvents = createClientRemoteEvents({ ctx, active: isActive, logger, epoch: epochOf })

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
    const connectionApi = { settings: connection.api.settings }
    if (officialConnection.api.api.llm) connectionApi.llm = officialConnection.api.api.llm

    const officialServicesApi = officialServices.api
    // The seven audited official browser leaves ride under services.* as pure
    // official passthrough faces (conversation, conversation events/views,
    // timer, command UI, input triggers, model directories).
    const m3Members = Object.freeze({
      connection: Object.freeze({
        // The navigation member carries the object role: `settings` is a
        // namespace accessor under `connection.api`, symmetric with
        // `connection.api.llm`, and no `get` name masks it.
        rpc: connection.rpc,
        api: Object.freeze(connectionApi),
      }),
      codec,
      events: Object.freeze({
        // Observation is the supported entry: a standard handle, a queryable
        // catalog, and a typed result for an unknown name.
        list: () => officialEvents.api.catalog(),
        observe: (name) => officialEvents.api.observe(name),
      }),
      remotes: Object.freeze({
        observe: (event) => remoteEvents.observe(event),
        dispatch: remoteEvents.dispatch,
        // The official mount is asynchronous: the caller gets a pending handle
        // it can dispose safely before the mount settles, and a settlement that
        // lands after the withdrawal is rolled back instead of resurrecting it.
        contribute: (contribution, leaseKey) => {
          let disposer
          let mounted
          try {
            mounted = remoteContribution.mountRemote(contribution, leaseKey)
          } catch (error) {
            return contributionFailure(error)
          }
          const settle = Promise.resolve(mounted).then((value) => {
            disposer = value
            return value
          })
          const { handle } = createPendingContributionHandle({
            id: typeof contribution?.package === 'string' && contribution.package.length > 0 ? contribution.package : 'remotes',
            ownerId: CLIENT_CONTRIBUTION_OWNER,
            seq: ++clientContributionSequence,
            settle,
            revoke: () => {
              if (typeof disposer !== 'function') return false
              const release = disposer
              disposer = undefined
              release()
              return true
            },
          })
          return Object.freeze({ ok: true, code: 'contributed', handle })
        },
      }),
      settings: Object.freeze({
        // The same call pattern as the host namespace; the client answers the
        // official scope object verbatim (see client-settings-scope.js).
        scope: settingsScope.scope,
        remote: Object.freeze({
          contribute: settingsRemote.contribute,
        }),
      }),
      slots: Object.freeze({
        // The official slots registration is synchronous; the facade answers
        // the contribution idiom (a discriminated result plus the standard
        // handle) while the official runtime keeps ownership of the lifetime.
        contribute: (options, component) => {
          let disposer
          try {
            disposer = slots.register(options, component)
          } catch (error) {
            return contributionFailure(error)
          }
          if (typeof disposer !== 'function') {
            return Object.freeze({ ok: false, code: 'unavailable', reason: 'the official slots runtime did not return a disposer' })
          }
          const handle = createContributionHandle({
            id: typeof options?.id === 'string' && options.id.length > 0 ? options.id : (options?.name ?? 'slot'),
            ownerId: CLIENT_CONTRIBUTION_OWNER,
            seq: ++clientContributionSequence,
            revoke: () => {
              disposer()
              return true
            },
          })
          return Object.freeze({ ok: true, code: 'contributed', handle })
        },
        // The declaration projection reports what the official runtime declares
        // for a key (`declared` / `missing` / `unavailable`) and hands out the
        // official declaration facts read-only; `list` answers the same status
        // with the entries view, so "undeclared" and "declared but empty" are
        // never the same answer.
        declaration: (key) => slots.declaration(key),
        list: (key) => slots.list(key),
        // The observation answers the standard handle; without the official
        // slots service the channel has nothing to report, so the member is
        // refused with the namespace's own typed state instead of handing out
        // an observation that can never deliver.
        observe: (event) => {
          if (!slots.isActive) throw new PluginApiFeatureDisabledError(CLIENT_SLOTS_FEATURE, 'the official slots service is unavailable')
          return slotEvents.observe(event)
        },
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
      // Pending interactions and model/effort selection ride their own typed
      // routes; both degrade to typed unavailable when the carrier is absent.
      const interactionsTransport = createClientRequestTransport({ ctx, path: '/plugin-api/sessions/interactions', epoch: epochOf })
      const interactionsFace = createClientSessionsInteractions({
        transport: interactionsTransport,
        epoch: epochOf,
        logger,
      })
      const selectionTransport = createClientRequestTransport({ ctx, path: '/plugin-api/sessions/selection', epoch: epochOf })
      const selectionFace = createClientSessionsSelection({
        transport: selectionTransport,
        epoch: epochOf,
        logger,
      })
      composition.sessions = Object.freeze({
        request: sessionsFace.request,
        cancel: sessionsFace.cancel,
        availability: sessionsFace.availability,
        interactions: Object.freeze({
          list: interactionsFace.list,
          get: interactionsFace.get,
          respond: interactionsFace.respond,
          availability: interactionsFace.availability,
        }),
        selection: Object.freeze({
          get: selectionFace.get,
          set: selectionFace.set,
          availability: selectionFace.availability,
        }),
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
      // `services` is an aggregate of the official browser leaves: report the
      // real per-leaf state instead of the facade's object shape, so pending
      // or disabled leaves are never advertised as an active capability.
      const servicesAvailability = () => {
        const records = [...rootState.leaves.values()]
        if (records.length === 0) return 'unavailable'
        let activeCount = 0
        for (const record of records) {
          if (record.state === 'active') activeCount += 1
        }
        if (activeCount === records.length) return 'active'
        return activeCount === 0 ? 'unavailable' : 'degraded'
      }
      /**
       * One availability probe per public namespace.
       *
       * The namespace's own `availability()` member and the root
       * `capabilities.*` query both read this table, so the two can never
       * disagree and a namespace is never reported active just because an
       * object exists at its name. A probe may read another module's typed
       * availability (whose domain detail is preserved) or report the state of
       * the leaf that backs the namespace.
       */
      const namespaceAvailability = {
        connection: () => leafDescriptor(connection.isActive, 'the official connection service is unavailable'),
        events: () => leafDescriptor(officialEvents.isActive, 'the official client event bus is unavailable'),
        remotes: () => combinedDescriptor(
          leafDescriptor(remoteContribution.isActive, 'the official remote mount owner is unavailable'),
          leafDescriptor(remoteEvents.isActive, 'the official remote event channel is unavailable'),
        ),
        settings: () => combinedDescriptor(
          leafDescriptor(settingsScope.isActive, 'the official settings scope service is unavailable'),
          leafDescriptor(settingsRemote.isActive, 'the official remote mount owner is unavailable'),
        ),
        slots: () => leafDescriptor(slots.isActive, 'the official slots service is unavailable'),
        codec: () => leafDescriptor(isActive(), 'codec helpers are unavailable'),
        lifecycle: () => lifecycle.availability(),
      }
      // Self-description members are reachable only while the facade is active,
      // so they report active; `sessions` / `attention` / `services` read the
      // faces and leaf records that actually back them.
      const capabilityProbes = {
        ...namespaceAvailability,
        isActive: activeDescriptor,
        apiVersion: activeDescriptor,
        assertCompatible: activeDescriptor,
        capabilities: activeDescriptor,
        sessions: () => probeDescriptor(sessionsFace.availability, 'the session request carrier is not wired'),
        attention: () => probeDescriptor(composition.attention?.availability, 'the attention runtime is unavailable'),
        services: () => Object.freeze({ status: servicesAvailability() }),
      }
      // Attach the namespace-level probe to the namespaces that own one. The
      // augmented object is cached per underlying namespace, so a namespace
      // keeps one identity across reads while its members keep their own.
      for (const [name, probe] of Object.entries(namespaceAvailability)) {
        composition[name] = augmentNamespace(composition[name], probe)
      }
      const capabilities = createClientCapabilitiesApi({
        isActive,
        // The live namespace surface is the membership authority for
        // member-level paths: a namespace that is absent contributes no member.
        namespaceMembers: (root) => {
          const surface = composition[root]
          if (surface === null || (typeof surface !== 'object' && typeof surface !== 'function')) return []
          try {
            return Object.keys(surface)
          } catch {
            return []
          }
        },
        resolveAvailability: (capability) => {
          if (!active.value) return 'unavailable'
          // The namespace member and this query read the same probe table, so
          // a leaf can never be advertised as active merely because an object
          // exists at its name.
          return capabilityProbes[capability]?.().status ?? 'unavailable'
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
