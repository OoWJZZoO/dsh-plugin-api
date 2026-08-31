import { deepFreeze } from './deep-freeze.js'
import { PluginApiFeatureDisabledError, PluginApiInactiveError } from './errors.js'

export const CLIENT_LIFECYCLE_FEATURE = 'clientLifecycle'

const DOMAINS = Object.freeze(['connection', 'modules', 'remote', 'slot', 'settings'])
const FACE_KINDS = Object.freeze(['remote', 'slot', 'settings'])
const FACE_STATES = Object.freeze(['available', 'pending', 'unavailable', 'degraded', 'disposed'])
const MAX_REASONS = 8
const MAX_DIAGNOSTICS = 8
let tokenSequence = 0
let identitySequence = 0
const moduleInvalidationFallbacks = new WeakMap()

/**
 * Build the client-only lifecycle facade over the audited public browser
 * services. The constructor intentionally does not throw for missing core
 * services: it returns an inert feature surface so the surrounding client
 * boot can continue.
 */
export function createClientLifecycle(options = {}) {
  const active = activePredicate(options.active)
  const logger = options.logger
  const services = resolveServices(options)

  if (!hasCoreServices(services)) {
    emitDiagnostic(options.publishDiagnostic, {
      feature: CLIENT_LIFECYCLE_FEATURE,
      reason: 'core official client service is unavailable',
    }, options.logger)
    return createDisabledClientLifecycle(active, 'core official client service is unavailable')
  }

  try {
    return createLifecycleController({ ...options, active, logger, services })
  } catch (error) {
    safeLog(logger, 'dsh-plugin-api client lifecycle initialization failed', error)
    emitDiagnostic(options.publishDiagnostic, {
      feature: CLIENT_LIFECYCLE_FEATURE,
      reason: 'client lifecycle initialization failed',
    }, logger)
    return createDisabledClientLifecycle(active, 'client lifecycle initialization failed')
  }
}

export function createDisabledClientLifecycle(active = true, reason = 'client lifecycle is unavailable') {
  const isActive = activePredicate(active)
  const fail = () => {
    if (!isActive()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError(CLIENT_LIFECYCLE_FEATURE, reason)
  }
  const api = Object.freeze({
    get isActive() { return false },
    register: fail,
    availability: fail,
    observe: fail,
    list() { return Object.freeze([]) },
  })
  return Object.freeze({
    api,
    get isActive() { return false },
    forCaller() { return api },
    dispose() { return false },
  })
}

function createLifecycleController({ active, logger, services, ctx, resolveEvidence, publishDiagnostic } = {}) {
  const state = {
    disposed: false,
    initialized: true,
    domains: Object.fromEntries(DOMAINS.map((domain) => [domain, { revision: 0, token: makeToken(domain) }])),
    faces: new Map(),
    ownerRevisions: new Map(),
    listeners: new Set(),
    rebindListeners: new Set(),
    callerRegistrations: new WeakMap(),
    callerApis: new WeakMap(),
    diagnostics: [],
    subscriptions: [],
    moduleEvidenceMode: 'uninitialized',
    moduleEvidenceCleanup: undefined,
    moduleEvidenceFingerprint: undefined,
    connectionEvidenceFingerprint: undefined,
    connectionEvidenceObserved: false,
  }

  const log = (message, error) => safeLog(logger, message, error)
  const isActive = () => Boolean(active()) && !state.disposed

  const api = Object.freeze({
    get isActive() { return isActive() },
    register: registerFace,
    availability,
    observe(listener) {
      // The merged lifecycle subscription receives both change and rebind
      // notifications (onChange/onRebind merged into the observe entry).
      const offChange = subscribe(state.listeners, listener, isActive, log, 'lifecycle change listener')
      const offRebind = subscribe(state.rebindListeners, listener, isActive, log, 'lifecycle rebind listener')
      let removed = false
      return () => {
        if (removed) return false
        removed = true
        offChange()
        offRebind()
        return true
      }
    },
    list() {
      if (!isActive()) return Object.freeze([])
      return Object.freeze([...state.faces.values()].map((face) => snapshotOf(face)))
    },
  })

  attachPublicSignals()

  return Object.freeze({ api, get isActive() { return isActive() }, forCaller, dispose })

  function forCaller(callerCtx) {
    if (callerCtx === null || (typeof callerCtx !== 'object' && typeof callerCtx !== 'function')) return api
    const existing = state.callerApis.get(callerCtx)
    if (existing) return existing
    const callerApi = Object.freeze({
      get isActive() { return isActive() },
      register(input) {
        const handle = registerFace(input)
        attachCallerFace(callerCtx, input, handle)
        return handle
      },
      availability,
      observe(listener) {
        const disposer = subscribe(state.listeners, listener, isActive, log, 'lifecycle change listener')
        const rebindDisposer = subscribe(state.rebindListeners, listener, isActive, log, 'lifecycle rebind listener')
        const cleanup = attachCallerCleanup(callerCtx, disposer, 'dsh-plugin-api client lifecycle change listener')
        attachCallerCleanup(callerCtx, rebindDisposer, 'dsh-plugin-api client lifecycle rebind listener')
        return cleanup
      },
      onRebind(listener) {
        const disposer = subscribe(state.rebindListeners, listener, isActive, log, 'lifecycle rebind listener')
        return attachCallerCleanup(callerCtx, disposer, 'dsh-plugin-api client lifecycle rebind listener')
      },
      list() {
        if (!isActive()) return Object.freeze([])
        return Object.freeze([...state.faces.values()].map((face) => snapshotOf(face)))
      },
    })
    state.callerApis.set(callerCtx, callerApi)
    return callerApi
  }

  function attachCallerFace(callerCtx, input, handle) {
    const key = faceKey(input.ownerId, input.faceId)
    let keys = state.callerRegistrations.get(callerCtx)
    if (!keys) {
      keys = new Set()
      state.callerRegistrations.set(callerCtx, keys)
    }
    if (keys.has(key)) return handle
    keys.add(key)
    const cleanup = () => {
      keys.delete(key)
      handle.dispose()
    }
    return attachCallerCleanup(callerCtx, cleanup, 'dsh-plugin-api client lifecycle face')
  }

  function attachCallerCleanup(callerCtx, cleanup, label) {
    if (typeof callerCtx?.effect !== 'function') return cleanup
    try {
      // Cordis executes the effect body immediately and collects the
      // disposer it returns. Passing `cleanup` directly would dispose the
      // registration during setup instead of associating it with the caller.
      callerCtx.effect(() => cleanup, label)
    } catch (error) {
      log(`${label} cleanup registration failed`, error)
    }
    return cleanup
  }

  function registerFace(input) {
    assertUsable(isActive)
    const spec = validateRegistration(input)
    const key = faceKey(spec.ownerId, spec.faceId)
    const existing = state.faces.get(key)
    if (existing) return existing.handle

    const face = {
      ...spec,
      key,
      generation: makeToken('generation'),
      revision: nextOwnerRevision(spec.ownerId),
      contributionEpoch: undefined,
      evidence: defaultEvidence(),
      hasBound: false,
      needsNewGeneration: false,
      lastContributionEpoch: undefined,
      current: undefined,
      pending: undefined,
      state: 'pending',
      reasons: [],
      lastSnapshot: undefined,
      lastFingerprint: undefined,
      disposed: false,
      dirty: false,
      scheduled: false,
      evaluating: false,
      externalDisposed: false,
      slotAdapterAttempted: false,
      slotAdapterError: undefined,
      slotSubscription: undefined,
      settingsAdapterAttempted: false,
      settingsAdapterError: undefined,
      settingsBinding: undefined,
      settingsSnapshot: undefined,
      remoteMountAttempted: false,
      remoteMountReady: false,
      remoteMountDisposer: undefined,
      remoteMountError: undefined,
      epochFingerprint: undefined,
      epochTokens: Object.fromEntries(DOMAINS.map((domain) => [domain, state.domains[domain].token])),
    }
    face.handle = Object.freeze({
      get generation() { return face.generation },
      get revision() { return face.revision },
      availability: () => availability(face.faceId, face.ownerId),
      dispose: () => disposeFace(face, 'owner'),
    })
    state.faces.set(key, face)
    ensureFaceEvidence(face)
    evaluate(face, 'owner')
    return face.handle
  }

  function availability(faceId, ownerId) {
    assertUsable(isActive)
    const face = findFace(faceId, ownerId)
    if (!face) return undefined
    return snapshotOf(face)
  }

  function findFace(faceId, ownerId) {
    if (ownerId !== undefined) return state.faces.get(faceKey(ownerId, faceId))
    for (const face of state.faces.values()) {
      if (face.faceId === faceId) return face
    }
    return undefined
  }

  function nextOwnerRevision(ownerId) {
    const next = (state.ownerRevisions.get(ownerId) ?? 0) + 1
    state.ownerRevisions.set(ownerId, next)
    return next
  }

  function evaluate(face, cause) {
    if (face.disposed || !isActive()) return
    if (face.evaluating) {
      face.dirty = true
      return
    }
    face.evaluating = true
    try {
      const evidence = readEvidence(face)
      if (face.current && !epochsEqual(face.current.epochs, face.epochTokens)) {
        invalidate(face, cause, 'epoch-mismatch')
      }
      if (face.pending && !epochsEqual(face.pending.epochs, face.epochTokens)) {
        invalidate(face, cause, 'epoch-mismatch')
      }
      const compatible = compatibility(face, evidence)
      const nextState = evidence.pending
        ? 'pending'
        : compatible.ok && evidence.available
          ? 'available'
          : compatible.reason === 'capability-mismatch' || compatible.reason === 'contract-mismatch'
            ? 'unavailable'
            : evidence.available === false
              ? 'unavailable'
              : 'degraded'

      if (nextState !== 'available') {
        addReason(face, compatible.reason ?? evidence.reason ?? 'evidence-unavailable', evidence.detail)
        if (compatible.reason === 'contract-mismatch' || compatible.reason === 'capability-mismatch' || evidence.reason === 'adapter-failed') {
          noteDiagnostic(face, compatible.reason ?? evidence.reason, compatible.detail ?? evidence.detail, evidence)
        }
        if (face.current || face.pending) invalidate(face, cause, compatible.reason ?? evidence.reason ?? 'evidence-unavailable')
      } else {
        removeTransientReasons(face)
        if (!face.current && !face.pending) startBind(face, evidence, cause)
      }

      const changed = face.state !== nextState
      face.state = nextState
      publishSnapshot(face, changed || Boolean(cause))
    } catch (error) {
      addReason(face, 'adapter-failed', safeDetail(error))
      if (face.current || face.pending) invalidate(face, cause, 'adapter-failed')
      face.state = 'degraded'
      publishSnapshot(face, true)
      log('dsh-plugin-api client lifecycle adapter failed', error)
    } finally {
      face.evaluating = false
      if (face.dirty) {
        face.dirty = false
        schedule(face, 'latest-evidence')
      }
    }
  }

  function schedule(face, cause) {
    if (face.disposed || !isActive()) return
    face.dirty = true
    if (face.scheduled) return
    face.scheduled = true
    scheduleMicrotask(() => {
      face.scheduled = false
      if (!face.disposed && isActive()) {
        face.dirty = false
        evaluate(face, cause)
      }
    })
  }

  function readEvidence(face) {
    const result = {
      ...defaultEvidence(),
      available: true,
      pending: false,
      contractVersion: readContractVersion(services.connection),
    }

    if (typeof resolveEvidence === 'function') {
      try {
        const custom = resolveEvidence(publicFace(face))
        if (custom && typeof custom === 'object') Object.assign(result, custom)
      } catch (error) {
        result.available = false
        result.reason = 'adapter-failed'
        result.detail = safeDetail(error)
        result.adapterFailed = true
      }
    }

    if (!result.adapterFailed && face.kind === 'remote') Object.assign(result, readRemoteEvidence(face, result))
    if (!result.adapterFailed && face.kind === 'slot') Object.assign(result, readSlotEvidence(face, result))
    if (!result.adapterFailed && face.kind === 'settings') Object.assign(result, readSettingsEvidence(face, result))
    result.capabilities = normalizeCapabilities(result.capabilities)
    face.evidence = evidenceSnapshot(result)
    if (result.epochFingerprint !== undefined) face.epochFingerprint = result.epochFingerprint
    return result
  }

  function readRemoteEvidence(face, base) {
    const namespace = face.require.remote?.namespace
    if (typeof namespace !== 'string' || namespace.length === 0) return { available: false, reason: 'remote-namespace-missing' }
    const mountState = ensureRemoteEvidence(face)
    if (mountState === 'pending') return { available: false, pending: true, reason: 'remote-mount-pending', source: 'official-remote-mount', uncertainty: 'inferred' }
    if (mountState === 'failed') return { available: false, reason: 'remote-mount-failed', detail: face.remoteMountError, source: 'official-remote-mount', uncertainty: 'unavailable' }
    let service
    try { service = services.remote?.[namespace] } catch (error) { return { available: false, reason: 'remote-unavailable', detail: safeDetail(error) } }
    if (service == null) return { available: false, pending: true, reason: 'remote-pending', epochFingerprint: 'pending', source: 'official-remote', uncertainty: 'inferred' }
    const capabilities = capabilitiesFrom(service, base.capabilities)
    return { available: true, capabilities, epochFingerprint: `${identityOf(service)}:${capabilities.join(',')}`, source: 'official-remote', uncertainty: 'observed' }
  }

  function ensureRemoteEvidence(face) {
    const contribution = face.require.remote?.contribution
    if (contribution === undefined) return 'ready'
    if (face.remoteMountReady) return 'ready'
    if (face.remoteMountError) return 'failed'
    if (face.remoteMountAttempted) return 'pending'
    face.remoteMountAttempted = true
    const owner = services.remoteContribution
    const mount = typeof owner?.mountRemote === 'function'
      ? () => owner.mountRemote(contribution, face)
      : typeof services.remote?.$mount === 'function'
        ? () => services.remote.$mount(contribution)
        : undefined
    if (!mount) {
      face.remoteMountError = 'official remote mount adapter is unavailable'
      return 'failed'
    }
    let result
    try {
      result = mount()
    } catch (error) {
      face.remoteMountError = safeDetail(error) ?? 'remote mount failed'
      advance('remote', 'remote-mount-failed', (candidate) => candidate === face)
      return 'failed'
    }
    const settle = (disposer) => {
      const normalized = normalizeDisposer(disposer)
      if (!normalized) throw new TypeError('official remote mount did not return a disposer')
      if (face.disposed || !isActive()) {
        safelyDispose(normalized, log, 'dsh-plugin-api client lifecycle stale remote mount cleanup failed')
        return
      }
      face.remoteMountDisposer = normalized
      face.remoteMountReady = true
      advance('remote', 'remote-mount-ready', (candidate) => candidate === face)
    }
    if (isThenable(result)) {
      Promise.resolve(result).then(settle).catch((error) => {
        face.remoteMountError = safeDetail(error) ?? 'remote mount failed'
        advance('remote', 'remote-mount-failed', (candidate) => candidate === face)
      })
      return 'pending'
    }
    try {
      settle(result)
      return face.remoteMountReady ? 'ready' : 'pending'
    } catch (error) {
      face.remoteMountError = safeDetail(error) ?? 'remote mount failed'
      advance('remote', 'remote-mount-failed', (candidate) => candidate === face)
      return 'failed'
    }
  }

  function readSlotEvidence(face, base) {
    const key = face.require.slot?.key
    if (typeof key !== 'string' || key.length === 0) return { available: false, reason: 'slot-key-missing' }
    try {
      if (!ensureSlotEvidence(face)) return { available: false, reason: 'slot-adapter-failed', detail: face.slotAdapterError, source: 'official-slots', uncertainty: 'unavailable' }
      const entries = services.slots?.entries?.(key)
      if (entries === undefined) return { available: false, pending: true, reason: 'slot-pending', epochFingerprint: 'pending', source: 'official-slots', uncertainty: 'inferred' }
      if (!Array.isArray(entries) || entries.length === 0) return { available: false, reason: 'slot-unavailable', source: 'official-slots', uncertainty: 'unavailable' }
      const capabilities = capabilitiesFrom(entries, base.capabilities)
      return {
        available: true,
        capabilities,
        epochFingerprint: `${entries.map((entry) => identityOf(entry?.id ?? entry?.key ?? entry)).join(',')}:${capabilities.join(',')}`,
        source: 'official-slots',
        uncertainty: 'observed',
      }
    } catch (error) {
      return { available: false, reason: 'slot-unavailable', detail: safeDetail(error), source: 'official-slots', uncertainty: 'unavailable' }
    }
  }

  function readSettingsEvidence(face, base) {
    const namespace = face.require.settings?.namespace
    if (typeof namespace !== 'string' || namespace.length === 0) return { available: false, reason: 'settings-namespace-missing' }
    if (!services.settingsScope || typeof services.settingsScope.bind !== 'function') {
      return { available: false, reason: 'settings-unavailable', source: 'official-settings-scope', uncertainty: 'unavailable' }
    }
    if (!ensureSettingsEvidence(face)) return { available: false, reason: 'settings-adapter-failed', detail: face.settingsAdapterError, source: 'official-settings-scope', uncertainty: 'unavailable' }
    let snapshot
    try { snapshot = face.settingsBinding.scope.getSnapshot?.() } catch (error) {
      face.settingsAdapterError = safeDetail(error)
      return { available: false, reason: 'settings-snapshot-failed', detail: face.settingsAdapterError, source: 'official-settings-scope', uncertainty: 'unavailable' }
    }
    face.settingsSnapshot = snapshot
    if (snapshot && (snapshot.status === 'unavailable' || snapshot.available === false)) {
      return { available: false, reason: 'settings-unavailable', epochFingerprint: settingsFingerprint(snapshot), source: 'official-settings-scope', uncertainty: 'unavailable' }
    }
    const capabilities = capabilitiesFrom(snapshot, capabilitiesFrom(face.settingsBinding.scope, base.capabilities))
    return { available: true, capabilities, epochFingerprint: settingsFingerprint(snapshot, capabilities), source: 'official-settings-scope', uncertainty: 'observed' }
  }

  function compatibility(face, evidence) {
    const requiredVersion = face.require.contractVersion
    if (requiredVersion !== undefined && evidence.contractVersion !== requiredVersion) {
      return { ok: false, reason: 'contract-mismatch', detail: `${String(evidence.contractVersion)} !== ${String(requiredVersion)}` }
    }
    const provided = new Set(normalizeCapabilities(evidence.capabilities))
    const missing = face.require.capabilities.filter((capability) => !provided.has(capability))
    if (missing.length > 0) return { ok: false, reason: 'capability-mismatch', detail: missing.join(',') }
    return { ok: true }
  }

  function startBind(face, evidence, cause) {
    const oldGeneration = face.generation
    const oldContributionEpoch = face.lastContributionEpoch
    if (face.hasBound || face.needsNewGeneration) {
      face.revision = nextOwnerRevision(face.ownerId)
      face.generation = makeToken('generation')
    }
    face.needsNewGeneration = false
    face.lastContributionEpoch = undefined
    face.hasBound = true
    face.contributionEpoch = makeToken('contribution')
    const contributionId = makeToken('contribution-id')
    const controller = makeAbortController()
    const binding = {
      contributionId,
      generation: face.generation,
      contributionEpoch: face.contributionEpoch,
      epochs: epochSnapshot(face),
      oldGeneration,
      oldContributionEpoch,
      controller,
      settled: false,
      disposed: false,
    }
    face.pending = binding
    const input = deepFreeze({
      faceId: face.faceId,
      ownerId: face.ownerId,
      kind: face.kind,
      generation: face.generation,
      contributionId,
      contributionEpoch: face.contributionEpoch,
      epochs: binding.epochs,
      capabilities: Object.freeze([...evidence.capabilities]),
      contractVersion: evidence.contractVersion,
      source: evidence.source,
      uncertainty: evidence.uncertainty,
    })
    const context = Object.freeze({
      signal: controller.signal,
      generation: face.generation,
      contributionEpoch: face.contributionEpoch,
      isCurrent: () => isCurrent(face, binding),
      guard: (value) => isCurrent(face, binding) ? value : undefined,
    })

    let result
    try {
      result = face.bind(input, context)
    } catch (error) {
      settleBindFailure(face, binding, error, cause)
      return
    }
    Promise.resolve(result).then(
      (disposer) => settleBindSuccess(face, binding, disposer, cause),
      (error) => settleBindFailure(face, binding, error, cause),
    ).catch((error) => log('dsh-plugin-api client lifecycle bind settlement failed', error))
  }

  function settleBindSuccess(face, binding, disposer, cause) {
    binding.settled = true
    const normalized = normalizeDisposer(disposer)
    if (!isCurrent(face, binding)) {
      safelyDispose(normalized, log, 'dsh-plugin-api client lifecycle stale bind cleanup failed')
      noteDiagnostic(face, 'stale-bind', cause)
      if (face.pending === binding) face.pending = undefined
      return
    }
    if (!normalized) {
      settleBindFailure(face, binding, new TypeError('client lifecycle bind must return a disposer'), cause)
      return
    }
    face.pending = undefined
    face.current = { ...binding, disposer: normalized }
    face.state = 'available'
    publishSnapshot(face, true)
    publishTransition(face, 'rebound', cause, undefined, binding.oldGeneration, binding.generation, binding.oldContributionEpoch, binding.contributionEpoch)
  }

  function settleBindFailure(face, binding, error, cause) {
    binding.settled = true
    const current = isCurrent(face, binding)
    if (face.pending === binding) face.pending = undefined
    if (!current) {
      noteDiagnostic(face, 'stale-bind-failure', cause)
      return
    }
    addReason(face, 'bind-failed', safeDetail(error))
    face.state = 'degraded'
    publishSnapshot(face, true)
    log('dsh-plugin-api client lifecycle bind failed', error)
  }

  function invalidate(face, cause, reason) {
    const current = face.current
    const pending = face.pending
    if (!current && !pending) return false
    if (pending) {
      pending.disposed = true
      abort(pending.controller)
      face.pending = undefined
    }
    if (current) {
      current.disposed = true
      abort(current.controller)
      face.current = undefined
      safelyDispose(current.disposer, log, 'dsh-plugin-api client lifecycle disposer failed')
    }
    if (current || pending) face.lastContributionEpoch = current?.contributionEpoch ?? pending?.contributionEpoch
    if (current || pending) face.needsNewGeneration = true
    publishTransition(
      face,
      'invalidated',
      cause,
      reason,
      current?.generation ?? pending?.generation,
      face.generation,
      current?.contributionEpoch ?? pending?.contributionEpoch,
      face.contributionEpoch,
    )
    return true
  }

  function disposeFace(face, cause = 'owner') {
    if (face.disposed) return false
    invalidate(face, cause, 'disposed')
    face.disposed = true
    face.state = 'disposed'
    if (state.faces.get(face.key) === face) state.faces.delete(face.key)
    safelyDispose(face.slotSubscription, log, 'dsh-plugin-api client lifecycle slot cleanup failed')
    disposeSettingsBinding(face)
    safelyDispose(face.remoteMountDisposer, log, 'dsh-plugin-api client lifecycle remote mount cleanup failed')
    face.slotSubscription = undefined
    face.settingsBinding = undefined
    face.remoteMountDisposer = undefined
    if (!face.externalDisposed) {
      face.externalDisposed = true
      safelyDispose(face.disposeCallback, log, 'dsh-plugin-api client lifecycle owner cleanup failed')
    }
    publishSnapshot(face, true)
    publishTransition(face, 'disposed', cause, 'disposed', face.generation, face.generation)
    return true
  }

  function disposeSettingsBinding(face) {
    const binding = face.settingsBinding
    if (!binding || binding.disposed) return
    binding.disposed = true
    safelyDispose(binding.unsubscribe, log, 'dsh-plugin-api client lifecycle settings unsubscribe failed')
    safelyDispose(binding.scope && typeof binding.scope.dispose === 'function' ? () => binding.scope.dispose() : undefined, log, 'dsh-plugin-api client lifecycle settings scope cleanup failed')
  }

  function dispose() {
    if (state.disposed) return false
    for (const face of [...state.faces.values()]) disposeFace(face, 'owner')
    state.disposed = true
    const moduleEvidenceCleanup = state.moduleEvidenceCleanup
    state.moduleEvidenceCleanup = undefined
    safelyDispose(moduleEvidenceCleanup, log, 'dsh-plugin-api client lifecycle module evidence cleanup failed')
    for (const unsubscribe of state.subscriptions.splice(0)) safelyDispose(unsubscribe, log, 'dsh-plugin-api client lifecycle signal cleanup failed')
    state.listeners.clear()
    state.rebindListeners.clear()
    return true
  }

  function publishSnapshot(face, force) {
    const snapshot = snapshotOf(face)
    const fingerprint = fingerprintOf(snapshot)
    if (!force && face.lastFingerprint === fingerprint) return
    face.lastFingerprint = fingerprint
    face.lastSnapshot = snapshot
    for (const listener of [...state.listeners]) invokeListener(listener, snapshot, log, 'lifecycle change listener')
  }

  function publishTransition(face, kind, cause, reason, oldGeneration = face.generation, newGeneration = face.generation, oldContributionEpoch, newContributionEpoch) {
    const notification = deepFreeze({
      faceId: face.faceId,
      ownerId: face.ownerId,
      oldGeneration,
      newGeneration,
      oldContributionEpoch,
      newContributionEpoch,
      cause: normalizeCause(cause),
      reason: { code: reason ?? kind },
      observedAt: nowIso(),
    })
    for (const listener of [...state.rebindListeners]) invokeListener(listener, notification, log, 'lifecycle rebind listener')
  }

  function snapshotOf(face) {
    const evidence = face.evidence ?? defaultEvidence()
    return deepFreeze({
      faceId: face.faceId,
      ownerId: face.ownerId,
      generation: face.generation,
      revision: face.revision,
      kind: face.kind,
      capabilities: Object.freeze([...evidence.capabilities]),
      state: FACE_STATES.includes(face.state) ? face.state : 'degraded',
      epochs: epochSnapshot(face),
      source: evidence.source,
      uncertainty: evidence.uncertainty,
      required: {
        contractVersion: face.require.contractVersion,
        capabilities: Object.freeze([...face.require.capabilities]),
      },
      provided: {
        contractVersion: evidence.contractVersion,
        capabilities: Object.freeze([...evidence.capabilities]),
      },
      contributionId: face.current?.contributionId,
      contributionEpoch: face.current?.contributionEpoch,
      reasons: Object.freeze(face.reasons.slice(-MAX_REASONS).map((reason) => ({ ...reason }))),
      observedAt: nowIso(),
    })
  }

  function epochSnapshot(face) {
    const source = face?.epochTokens ?? state.domains
    return Object.freeze(Object.fromEntries(DOMAINS.map((domain) => [domain, source[domain].token ?? source[domain]])))
  }

  function addReason(face, code, detail) {
    if (!code) return
    face.reasons.push({ code: String(code), detail: sanitizeDetail(detail), observedAt: nowIso() })
    if (face.reasons.length > MAX_REASONS) face.reasons.splice(0, face.reasons.length - MAX_REASONS)
  }

  function removeTransientReasons(face) {
    face.reasons = face.reasons.filter((reason) => !['adapter-failed', 'remote-pending', 'slot-pending', 'bind-failed'].includes(reason.code))
  }

  function noteDiagnostic(face, code, detail, evidence) {
    const record = {
      faceId: face.faceId,
      ownerId: face.ownerId,
      code: String(code),
      reason: { code: String(code) },
      detail: sanitizeDetail(detail),
      required: safeRequired(face.require),
      provided: safeProvided(evidence),
      observedAt: nowIso(),
    }
    state.diagnostics.push(record)
    if (state.diagnostics.length > MAX_DIAGNOSTICS) state.diagnostics.shift()
    emitDiagnostic(publishDiagnostic, record, logger)
  }

  function isCurrent(face, binding) {
    const pending = face.pending === binding
    const current = face.current?.contributionId === binding.contributionId
      && face.current?.generation === binding.generation
      && face.current?.contributionEpoch === binding.contributionEpoch
    return isActive() && !face.disposed && !binding.disposed && (pending || current)
      && face.generation === binding.generation
      && epochsEqual(binding.epochs, face.epochTokens)
      && !binding.controller.signal.aborted
  }

  function attachPublicSignals() {
    subscribeContext('connection/reset', () => advance('connection', 'connection/reset'))
    subscribeContext('settings/changed', (namespace) => advance('settings', 'settings/changed', faceMatches('settings', namespace)))
    if (subscribePublic(services.modules, ['onGraphChanged', 'onRebuilt'], () => advance('modules', 'module-graph'))) {
      state.moduleEvidenceMode = 'public-events'
    } else if (installModuleInvalidateFallback()) {
      state.moduleEvidenceMode = 'invalidate-fallback'
      noteDiagnosticForSource('modules-invalidate-fallback', new Error('public module graph events are unavailable; invalidate is the observed boundary'))
    } else {
      state.moduleEvidenceMode = 'rejected'
      noteDiagnosticForSource('modules-evidence-rejected', new Error('public module graph events and invalidate fallback are unavailable'))
    }
    subscribePublic(services.connection?.hostDescription, ['subscribe', 'onChange'], () => advance('connection', 'host-description'))
    subscribePublic(services.settingsScope, ['onChange', 'subscribe'], (namespace) => advance('settings', 'settings-scope', faceMatches('settings', namespace)))
    seedPublicEpochEvidence()
  }

  function subscribeContext(event, listener) {
    if (typeof ctx?.on !== 'function') return
    try {
      const disposer = ctx.on(event, listener)
      if (typeof disposer === 'function') state.subscriptions.push(disposer)
      else if (isThenable(disposer)) Promise.resolve(disposer).catch((error) => log(`dsh-plugin-api client lifecycle ${event} subscription failed`, error))
    } catch (error) {
      log(`dsh-plugin-api client lifecycle ${event} subscription failed`, error)
    }
  }

  function subscribePublic(source, names, listener) {
    if (!source) return false
    for (const name of names) {
      let method
      try { method = source[name] } catch { method = undefined }
      if (typeof method !== 'function') continue
      try {
        const disposer = Reflect.apply(method, source, [listener])
        if (typeof disposer === 'function') state.subscriptions.push(disposer)
        else if (isThenable(disposer)) Promise.resolve(disposer).catch((error) => log(`dsh-plugin-api client lifecycle ${name} subscription failed`, error))
        return true
      } catch (error) {
        log(`dsh-plugin-api client lifecycle ${name} subscription failed`, error)
      }
    }
    return false
  }

  function installModuleInvalidateFallback() {
    const modules = services.modules
    let original
    try { original = modules?.invalidate } catch { original = undefined }
    if (typeof original !== 'function' || (typeof modules !== 'object' && typeof modules !== 'function') || modules === null) return false

    const notify = () => {
      for (const listener of [...entry.listeners]) {
        try { listener() } catch (error) { log('dsh-plugin-api client lifecycle module invalidation listener failed', error) }
      }
    }
    let entry = moduleInvalidationFallbacks.get(modules)
    if (entry) {
      const listener = () => advance('modules', 'modules/invalidate')
      entry.listeners.add(listener)
      state.moduleEvidenceCleanup = () => releaseModuleInvalidateFallback(entry, listener)
      return true
    }

    const ownDescriptor = Object.getOwnPropertyDescriptor(modules, 'invalidate')
    if (ownDescriptor && ownDescriptor.configurable === false && ownDescriptor.writable !== true) return false
    entry = {
      modules,
      original,
      ownDescriptor,
      wrapper: undefined,
      listeners: new Set(),
    }
    entry.wrapper = function (...args) {
      const result = Reflect.apply(original, this, args)
      if (isThenable(result)) {
        Promise.resolve(result).then(notify, (error) => log('dsh-plugin-api client lifecycle module invalidation failed', error))
      } else {
        notify()
      }
      return result
    }

    try {
      const descriptor = ownDescriptor
        ? { configurable: ownDescriptor.configurable, enumerable: ownDescriptor.enumerable, writable: true, value: entry.wrapper }
        : { configurable: true, enumerable: true, writable: true, value: entry.wrapper }
      if (!Reflect.defineProperty(modules, 'invalidate', descriptor) || modules.invalidate !== entry.wrapper) return false
    } catch (error) {
      log('dsh-plugin-api client lifecycle module invalidation fallback install failed', error)
      return false
    }

    moduleInvalidationFallbacks.set(modules, entry)
    const listener = () => advance('modules', 'modules/invalidate')
    entry.listeners.add(listener)
    state.moduleEvidenceCleanup = () => releaseModuleInvalidateFallback(entry, listener)
    return true
  }

  function releaseModuleInvalidateFallback(entry, listener) {
    entry.listeners.delete(listener)
    if (entry.listeners.size > 0 || moduleInvalidationFallbacks.get(entry.modules) !== entry) return
    moduleInvalidationFallbacks.delete(entry.modules)
    try {
      if (entry.modules.invalidate !== entry.wrapper) return
      if (entry.ownDescriptor) Reflect.defineProperty(entry.modules, 'invalidate', entry.ownDescriptor)
      else Reflect.deleteProperty(entry.modules, 'invalidate')
    } catch (error) {
      log('dsh-plugin-api client lifecycle module invalidation fallback cleanup failed', error)
    }
  }

  function advance(domain, cause, predicate) {
    if (!DOMAINS.includes(domain) || !isActive()) return
    const stateEntry = state.domains[domain]
    stateEntry.revision += 1
    stateEntry.token = makeToken(domain)
    for (const face of state.faces.values()) {
      if (predicate && !predicate(face)) continue
      face.epochTokens[domain] = stateEntry.token
      // The official evidence callback is the invalidation boundary. Retire
      // the old contribution before scheduling evaluation so a synchronous
      // projection cannot expose a binding whose recorded epoch is already
      // stale; availability itself remains a pure read of stored state.
      if (face.current || face.pending) invalidate(face, cause, 'epoch-mismatch')
      schedule(face, cause)
    }
  }

  function ensureFaceEvidence(face) {
    if (face.kind === 'slot') ensureSlotEvidence(face)
    if (face.kind === 'settings') ensureSettingsEvidence(face)
  }

  function ensureSlotEvidence(face) {
    if (face.slotSubscription || face.slotAdapterAttempted) return !face.slotAdapterError
    face.slotAdapterAttempted = true
    const key = face.require.slot?.key
    if (typeof key !== 'string' || key.length === 0) return false
    try {
      const disposer = services.slots.inject(key, () => {
        // SlotRegistry runs this callback once per declaration lifetime and
        // invokes the returned disposer on collapse before the next
        // declaration is reconciled. Keep the callback local to this face so
        // collapse retires only its declaration contribution.
        let live = true
        if (!face.disposed && isActive()) {
          advance('slot', 'slot-declaration', (candidate) => candidate === face)
        }
        return () => {
          if (!live) return
          live = false
          if (face.disposed || !isActive()) return
          advance('slot', 'slot-declaration-collapse', (candidate) => candidate === face)
        }
      })
      if (isThenable(disposer)) {
        Promise.resolve(disposer).catch((error) => log('dsh-plugin-api client lifecycle slot subscriber failed', error))
        throw new TypeError('official slots.inject returned an asynchronous disposer')
      }
      if (disposer !== undefined && typeof disposer !== 'function') throw new TypeError('official slots.inject returned a malformed disposer')
      face.slotSubscription = disposer
      return true
    } catch (error) {
      face.slotAdapterError = safeDetail(error)
      noteDiagnostic(face, 'slot-subscriber-failed', face.slotAdapterError)
      return false
    }
  }

  function ensureSettingsEvidence(face) {
    if (face.settingsBinding) return true
    if (face.settingsAdapterAttempted) return !face.settingsAdapterError
    face.settingsAdapterAttempted = true
    const namespace = face.require.settings?.namespace
    if (typeof namespace !== 'string' || namespace.length === 0) return false
    let scope
    try {
      scope = services.settingsScope.bind({ namespace })
      if (!isSettingsScopeValue(scope)) throw new TypeError('official settingsScope.bind returned a malformed scope')
      const subscriber = () => advance('settings', 'settings-scope', (candidate) => candidate === face)
      const unsubscribe = scope.subscribe(subscriber)
      if (isThenable(unsubscribe)) {
        Promise.resolve(unsubscribe).catch((error) => log('dsh-plugin-api client lifecycle settings subscriber failed', error))
        throw new TypeError('official settings scope subscribe returned an asynchronous disposer')
      }
      if (unsubscribe !== undefined && typeof unsubscribe !== 'function') throw new TypeError('official settings scope subscribe returned a malformed disposer')
      face.settingsBinding = { scope, unsubscribe, disposed: false }
      return true
    } catch (error) {
      safelyDispose(scope?.dispose ? () => scope.dispose() : undefined, log, 'dsh-plugin-api client lifecycle settings scope rollback failed')
      face.settingsAdapterError = safeDetail(error)
      noteDiagnostic(face, 'settings-subscriber-failed', face.settingsAdapterError)
      return false
    }
  }

  function seedPublicEpochEvidence() {
    const connectionFingerprint = readContractVersion(services.connection)
    state.connectionEvidenceFingerprint = connectionFingerprint
    state.connectionEvidenceObserved = true
    const modulesFingerprint = publicModuleFingerprint(services.modules)
    if (modulesFingerprint !== undefined) state.moduleEvidenceFingerprint = modulesFingerprint
  }

  function publicModuleFingerprint(modules) {
    try {
      if (typeof modules?.graph === 'function') {
        const graph = modules.graph()
        return `graph:${fingerprintOf(publicGraphShape(graph))}`
      }
      const cache = modules?.loadCache
      if (cache && typeof cache.keys === 'function') {
        return `cache:${[...cache.keys()].map((key) => `${String(key)}=${identityOf(cache.get(key)?.exports)}`).join('|')}`
      }
    } catch (error) {
      noteDiagnosticForSource('modules-evidence-failed', error)
    }
    return undefined
  }

  function noteDiagnosticForSource(code, error) {
    const record = { code, detail: safeDetail(error), observedAt: nowIso() }
    state.diagnostics.push(record)
    if (state.diagnostics.length > MAX_DIAGNOSTICS) state.diagnostics.shift()
    emitDiagnostic(publishDiagnostic, record, logger)
  }

  function publicGraphShape(graph) {
    if (graph === null || typeof graph !== 'object') return graph
    if (Array.isArray(graph)) return graph.map((entry) => publicGraphShape(entry))
    const result = {}
    for (const key of Object.keys(graph).sort()) {
      if (['generation', 'attempt'].includes(key)) continue
      const value = graph[key]
      if (typeof value === 'function') continue
      if (value && typeof value === 'object') {
        result[key] = Array.isArray(value) ? value.length : Object.keys(value).sort()
      } else {
        result[key] = value
      }
    }
    return result
  }

  function publicFace(face) {
    return Object.freeze({ faceId: face.faceId, ownerId: face.ownerId, kind: face.kind, require: face.require })
  }

  function faceMatches(domain, value) {
    const key = typeof value === 'string' ? value : value?.namespace ?? value?.key
    if (!key) return undefined
    return (face) => {
      if (face.kind !== domain) return false
      const required = face.require[domain]?.namespace ?? face.require[domain]?.key
      return required === key
    }
  }
}

function resolveServices(options) {
  const ctx = options.ctx
  const get = (name) => {
    try { return typeof ctx?.get === 'function' ? ctx.get(name) : ctx?.[name] } catch { return undefined }
  }
  const publicModules = options.clientModules ?? get('clientModules')
  const rawModules = options.modules ?? get('modules')
  return {
    connection: options.connection ?? get('connection'),
    remote: options.remote ?? get('remote'),
    remoteContribution: options.remoteContribution,
    slots: options.slots ?? get('slots'),
    settingsScope: options.settingsScope ?? get('settingsScope'),
    modules: isModules(publicModules) ? publicModules : rawModules,
  }
}

function hasCoreServices(services) {
  return isConnection(services.connection)
    && isRemote(services.remote)
    && isSlots(services.slots)
    && isSettingsScope(services.settingsScope)
    && isModules(services.modules)
}

function isConnection(value) {
  try { return serviceIsActive(value) && value != null && typeof value.rpc?.call === 'function' && value.api?.settings != null } catch { return false }
}

function isRemote(value) {
  try { return serviceIsActive(value) && value != null && typeof value.$mount === 'function' } catch { return false }
}

function isSlots(value) {
  try { return serviceIsActive(value) && value != null && ['register', 'inject', 'entries', 'subscribe'].every((name) => typeof value[name] === 'function') } catch { return false }
}

function isSettingsScope(value) {
  try { return serviceIsActive(value) && value != null && typeof value.bind === 'function' } catch { return false }
}

function serviceIsActive(value) {
  return value?.isActive !== false
}

function isSettingsScopeValue(value) {
  try {
    return value != null && ['getSnapshot', 'subscribe', 'set', 'unset'].every((name) => typeof value[name] === 'function')
  } catch { return false }
}

function isModules(value) {
  try {
    return serviceIsActive(value) && value != null && (
      (typeof value.import === 'function' && typeof value.invalidate === 'function' && typeof value.loadCache?.get === 'function')
      || (typeof value.graph === 'function' && (typeof value.onGraphChanged === 'function' || typeof value.onRebuilt === 'function'))
    )
  } catch { return false }
}

function validateRegistration(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('client lifecycle registration must be an object')
  for (const key of ['faceId', 'ownerId']) {
    if (typeof input[key] !== 'string' || input[key].length === 0) throw new TypeError(`client lifecycle ${key} must be a non-empty string`)
  }
  if (input.scope !== 'client') throw new TypeError('client lifecycle scope must be client')
  if (!FACE_KINDS.includes(input.kind)) throw new TypeError(`client lifecycle kind must be one of ${FACE_KINDS.join(', ')}`)
  if (typeof input.bind !== 'function') throw new TypeError('client lifecycle bind must be a function')
  if (typeof input.dispose !== 'undefined' && typeof input.dispose !== 'function') throw new TypeError('client lifecycle dispose must be a function when provided')
  if (input.require !== undefined && (!input.require || typeof input.require !== 'object' || Array.isArray(input.require))) throw new TypeError('client lifecycle require must be an object')
  const require = input.require ?? {}
  if (require.contractVersion !== undefined && typeof require.contractVersion !== 'string') throw new TypeError('client lifecycle contractVersion must be a string when provided')
  const capabilities = normalizeCapabilities(require.capabilities)
  const faceRequire = {
    contractVersion: require.contractVersion,
    capabilities,
    remote: require.remote,
    slot: require.slot,
    settings: require.settings,
  }
  return {
    faceId: input.faceId,
    ownerId: input.ownerId,
    scope: input.scope,
    kind: input.kind,
    require: faceRequire,
    bind: input.bind,
    disposeCallback: input.dispose,
  }
}

function readContractVersion(connection) {
  try {
    const description = connection?.hostDescription
    const snapshot = typeof description?.getSnapshot === 'function' ? description.getSnapshot() : description?.snapshot ?? description
    return snapshot?.version
  } catch {
    return undefined
  }
}

function capabilitiesFrom(value, fallback = []) {
  try {
    if (Array.isArray(value)) {
      const nested = value.flatMap((entry) => Array.isArray(entry?.capabilities) ? entry.capabilities : [])
      return nested.length > 0 ? nested : fallback
    }
    if (Array.isArray(value?.capabilities)) return value.capabilities
    if (typeof value?.describe === 'function') {
      const description = value.describe()
      if (Array.isArray(description?.capabilities)) return description.capabilities
    }
  } catch {}
  return fallback
}

function normalizeCapabilities(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item) => typeof item === 'string' && item.length > 0))]
}

function defaultEvidence() {
  return {
    available: false,
    pending: true,
    capabilities: [],
    contractVersion: undefined,
    source: 'official-client-services',
    uncertainty: 'unavailable',
  }
}

function evidenceSnapshot(evidence) {
  return Object.freeze({
    available: evidence?.available !== false,
    pending: evidence?.pending === true,
    capabilities: Object.freeze(normalizeCapabilities(evidence?.capabilities)),
    contractVersion: typeof evidence?.contractVersion === 'string' ? evidence.contractVersion : undefined,
    source: safeSource(evidence?.source),
    uncertainty: ['observed', 'inferred', 'unavailable'].includes(evidence?.uncertainty) ? evidence.uncertainty : 'unavailable',
    reason: typeof evidence?.reason === 'string' ? evidence.reason : undefined,
    detail: sanitizeDetail(evidence?.detail),
  })
}

function safeSource(value) {
  if (typeof value !== 'string' || value.length === 0) return 'official-client-services'
  return sanitizeDetail(value) ?? 'official-client-services'
}

function epochsEqual(left, right) {
  return DOMAINS.every((domain) => left?.[domain] === right?.[domain])
}

function normalizeDisposer(value) {
  if (typeof value === 'function') return value
  if (value && typeof value.dispose === 'function') return () => value.dispose()
  return undefined
}

function subscribe(table, listener, active, log, label) {
  assertUsable(active)
  if (typeof listener !== 'function') throw new TypeError(`${label} must be a function`)
  table.add(listener)
  return () => {
    if (!table.has(listener)) return false
    table.delete(listener)
    return true
  }
}

function invokeListener(listener, value, log, label) {
  try {
    const result = listener(value)
    if (result && typeof result.then === 'function') Promise.resolve(result).catch((error) => log(`dsh-plugin-api ${label} rejected`, error))
  } catch (error) {
    log(`dsh-plugin-api ${label} failed`, error)
  }
}

function safelyDispose(disposer, log, label) {
  if (typeof disposer !== 'function') return
  try {
    const result = disposer()
    if (result && typeof result.then === 'function') Promise.resolve(result).catch((error) => log(label, error))
  } catch (error) {
    log(label, error)
  }
}

function isThenable(value) {
  return value != null && (typeof value === 'object' || typeof value === 'function') && typeof value.then === 'function'
}

function makeAbortController() {
  try { return new AbortController() } catch { return { signal: { aborted: false }, abort() { this.signal.aborted = true } } }
}

function abort(controller) {
  try { controller?.abort?.() } catch {}
}

function assertUsable(active) {
  if (!active()) throw new PluginApiInactiveError()
}

function scheduleMicrotask(task) {
  try {
    if (typeof queueMicrotask === 'function') return queueMicrotask(task)
  } catch {}
  try {
    return Promise.resolve().then(task).catch(() => {})
  } catch {
    try { return setTimeout(task, 0) } catch {}
  }
}

function activePredicate(active) {
  return typeof active === 'function' ? active : () => Boolean(active ?? true)
}

function faceKey(ownerId, faceId) {
  return `${ownerId}\u0000${faceId}`
}

function makeToken(prefix) {
  tokenSequence += 1
  return `${prefix}-${tokenSequence}`
}

const identityTable = new WeakMap()

function identityOf(value) {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return String(value)
  let identity = identityTable.get(value)
  if (!identity) {
    identitySequence += 1
    identity = `object-${identitySequence}`
    identityTable.set(value, identity)
  }
  return identity
}

function settingsFingerprint(snapshot, capabilities = []) {
  return fingerprintOf({
    status: snapshot?.status,
    available: snapshot?.available,
    revision: snapshot?.revision,
    capabilities: normalizeCapabilities(snapshot?.capabilities ?? capabilities),
  })
}

function fingerprintOf(value) {
  try { return JSON.stringify(value, (_key, item) => item === undefined ? '__undefined__' : item) } catch { return String(value) }
}

function normalizeCause(cause) {
  if (['connection', 'modules', 'remote', 'slot', 'settings', 'owner'].includes(cause)) return cause
  if (typeof cause === 'string') {
    for (const domain of ['connection', 'modules', 'remote', 'slot', 'settings']) {
      if (cause.startsWith(`${domain}-`) || cause.startsWith(`${domain}/`)) return domain
    }
  }
  return 'owner'
}

function safeRequired(require) {
  return {
    contractVersion: require?.contractVersion,
    capabilities: Object.freeze(normalizeCapabilities(require?.capabilities)),
  }
}

function safeProvided(evidence) {
  if (!evidence) return undefined
  return {
    contractVersion: typeof evidence.contractVersion === 'string' ? evidence.contractVersion : undefined,
    capabilities: Object.freeze(normalizeCapabilities(evidence.capabilities)),
  }
}

function sanitizeDetail(value) {
  if (typeof value !== 'string') return undefined
  const detail = value.replace(/[\r\n]+/g, ' ').trim()
  if (/(?:credential|password|secret|token|payload|request|settings?\s+value)/i.test(detail)) return undefined
  return detail.length > 200 ? `${detail.slice(0, 200)}…` : detail || undefined
}

function safeDetail(error) {
  try {
    if (typeof error === 'string') return sanitizeDetail(error)
    return sanitizeDetail(error?.name ?? 'operation-failed')
  } catch { return undefined }
}

function safeLog(logger, message, error) {
  try {
    const result = logger?.error?.(message, error)
    if (isThenable(result)) Promise.resolve(result).catch(() => {})
  } catch {}
}

function emitDiagnostic(publisher, record, logger) {
  if (typeof publisher !== 'function' && typeof publisher?.publish !== 'function') return
  const safeRecord = deepFreeze({
    feature: record?.feature,
    faceId: record?.faceId,
    ownerId: record?.ownerId,
    code: record?.code,
    reason: record?.reason,
    detail: sanitizeDetail(record?.detail),
    required: record?.required ? safeRequired(record.required) : undefined,
    provided: record?.provided ? safeProvided(record.provided) : undefined,
    observedAt: record?.observedAt ?? nowIso(),
  })
  try {
    const publish = typeof publisher === 'function' ? publisher : publisher.publish
    const result = publish(safeRecord)
    if (result && typeof result.then === 'function') Promise.resolve(result).catch((error) => safeLog(logger, 'dsh-plugin-api client lifecycle diagnostic emission failed', error))
  } catch (error) {
    safeLog(logger, 'dsh-plugin-api client lifecycle diagnostic emission failed', error)
  }
}

function nowIso() {
  try { return new Date().toISOString() } catch { return 'unknown' }
}
