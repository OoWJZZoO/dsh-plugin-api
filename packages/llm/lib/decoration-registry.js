/**
 * Adapter decoration registry.
 *
 * Attached to a forked `LlmRuntime` after boot self-checks pass. The registry
 * observes the official topology commit points through the fork's
 * `_decoration` hooks, keeps owner/id/generation bookkeeping, and produces
 * deterministic decoration chains for real adapter operations.
 *
 * The registry never mutates official registry state, never emits a second
 * `llm/adapters-updated` event, and never creates synthetic adapters. All
 * projections are detached and frozen; the audit ring is bounded and
 * non-durable.
 */
import {
  BINDING_LIFECYCLE,
  CAPABILITY_EXECUTION_KEYS,
  CAPABILITY_METADATA_KEYS,
  DECORATION_ALS,
  EXECUTION_PHASES,
  LIFECYCLE,
  PRIORITY_TIERS,
  RETRY_MODES,
  comparePriority,
} from './decoration-shared.js'

const AUDIT_RING_SIZE = 200
const OWNER_SUMMARY_MAX = 64

/** Iterative deep-freeze for detached projection objects (cycle-safe). */
function deepFreeze(value) {
  const seen = new WeakSet()
  const pending = [{ kind: 'visit', node: value }]
  while (pending.length > 0) {
    const task = pending.pop()
    if (!task) continue
    if (task.kind === 'property') {
      pending.push({ kind: 'visit', node: task.source[task.key] })
      continue
    }
    const node = task.node
    if (node === null || typeof node !== 'object') continue
    if (seen.has(node)) continue
    seen.add(node)
    Object.freeze(node)
    const keys = Object.keys(node)
    for (let i = keys.length - 1; i >= 0; i--) {
      pending.push({ kind: 'property', source: node, key: keys[i] })
    }
  }
  return value
}

/** Typed decoration registration results returned by the facet. */
export const DecorationRegistrationStatus = Object.freeze({
  OK: 'ok',
  CONFLICT: 'conflict',
  VALIDATION: 'validation',
  UNAVAILABLE: 'unavailable',
  OWNER_CONFLICT: 'owner-conflict',
})

function opaque() {
  return {}
}

function boundedOwnerSummary(owner) {
  const text = typeof owner === 'string' ? owner : String(owner ?? 'unknown')
  return text.length <= OWNER_SUMMARY_MAX ? text : `${text.slice(0, OWNER_SUMMARY_MAX - 1)}…`
}

function boundedErrorSummary(error) {
  if (error === null || error === undefined) return 'unknown error'
  if (typeof error === 'string') return error.length <= 120 ? error : `${error.slice(0, 119)}…`
  if (typeof error === 'object' && typeof error.name === 'string') {
    return error.name.length <= 120 ? error.name : `${error.name.slice(0, 119)}…`
  }
  return 'decoration error'
}

function logBounded(logger, message) {
  try {
    logger?.warn?.(message)
  } catch {
    // diagnostics must never change outcomes
  }
}

/**
 * Normalize and validate one decoration definition against the frozen v1
 * capability vocabulary. Returns `{ ok: true, definition }` or
 * `{ ok: false, reason }`.
 */
export function normalizeDecorationDefinition(input) {
  if (input === null || typeof input !== 'object') {
    return { ok: false, reason: 'decoration definition must be an object' }
  }
  const { id, match, priority, capabilities, wrap } = input
  if (typeof id !== 'string' || id.length === 0) {
    return { ok: false, reason: 'decoration id must be a non-empty string' }
  }
  if (typeof match !== 'function') {
    return { ok: false, reason: 'decoration match must be a function' }
  }
  if (typeof wrap !== 'function') {
    return { ok: false, reason: 'decoration wrap must be a function' }
  }
  if (priority !== undefined && !PRIORITY_TIERS.includes(priority)) {
    return { ok: false, reason: `decoration priority must be one of ${PRIORITY_TIERS.join(' | ')}` }
  }
  const normalizedCapabilities = normalizeCapabilities(capabilities)
  if (!normalizedCapabilities.ok) {
    return { ok: false, reason: normalizedCapabilities.reason }
  }
  return {
    ok: true,
    definition: Object.freeze({
      id,
      match,
      wrap,
      priority: priority ?? 'normal',
      capabilities: normalizedCapabilities.value,
    }),
  }
}

function normalizeCapabilities(capabilities) {
  if (capabilities === undefined || capabilities === null) {
    return {
      ok: true,
      value: Object.freeze({
        metadata: Object.freeze({ labels: false }),
        execution: Object.freeze({ phases: Object.freeze([...EXECUTION_PHASES]), requestTransform: false, chunkTransform: false, retry: 'none' }),
      }),
    }
  }
  if (typeof capabilities !== 'object') {
    return { ok: false, reason: 'decoration capabilities must be an object' }
  }
  for (const key of Object.keys(capabilities)) {
    if (key !== 'metadata' && key !== 'execution') {
      return { ok: false, reason: `unknown capability "${key}"` }
    }
  }
  const metadata = capabilities.metadata
  if (metadata !== undefined && metadata !== null) {
    if (typeof metadata !== 'object') return { ok: false, reason: 'capabilities.metadata must be an object' }
    for (const key of Object.keys(metadata)) {
      if (!CAPABILITY_METADATA_KEYS.includes(key)) return { ok: false, reason: `unknown metadata capability "${key}"` }
    }
    if (metadata.labels !== undefined && typeof metadata.labels !== 'boolean') {
      return { ok: false, reason: 'capabilities.metadata.labels must be a boolean' }
    }
  }
  const execution = capabilities.execution
  if (execution === undefined || execution === null) {
    return { ok: false, reason: 'capabilities.execution is required (phases must contain exactly "stream")' }
  }
  if (typeof execution !== 'object') return { ok: false, reason: 'capabilities.execution must be an object' }
  for (const key of Object.keys(execution)) {
    if (!CAPABILITY_EXECUTION_KEYS.includes(key)) return { ok: false, reason: `unknown execution capability "${key}"` }
  }
  const phases = execution.phases
  if (!Array.isArray(phases) || phases.length !== 1 || phases[0] !== 'stream') {
    return { ok: false, reason: 'capabilities.execution.phases must contain exactly "stream"' }
  }
  const requestTransform = execution.requestTransform ?? false
  const chunkTransform = execution.chunkTransform ?? false
  if (typeof requestTransform !== 'boolean' || typeof chunkTransform !== 'boolean') {
    return { ok: false, reason: 'requestTransform and chunkTransform must be booleans' }
  }
  const retry = execution.retry ?? 'none'
  if (!RETRY_MODES.includes(retry)) {
    return { ok: false, reason: `capabilities.execution.retry must be one of ${RETRY_MODES.join(' | ')}` }
  }
  return {
    ok: true,
    value: Object.freeze({
      metadata: Object.freeze({ labels: metadata?.labels ?? false }),
      execution: Object.freeze({
        phases: Object.freeze([...phases]),
        requestTransform,
        chunkTransform,
        retry,
      }),
    }),
  }
}

/** Equivalent normalized definitions share id, scalars, and function refs. */
function definitionsEquivalent(a, b) {
  if (a.priority !== b.priority) return false
  if (a.capabilities.metadata.labels !== b.capabilities.metadata.labels) return false
  if (a.capabilities.execution.requestTransform !== b.capabilities.execution.requestTransform) return false
  if (a.capabilities.execution.chunkTransform !== b.capabilities.execution.chunkTransform) return false
  if (a.capabilities.execution.retry !== b.capabilities.execution.retry) return false
  return a.match === b.match && a.wrap === b.wrap
}

/**
 * Create the decoration registry for one forked runtime.
 *
 * @param {object} options
 * @param {object} [options.logger] - bounded diagnostic sink (`warn`).
 * @returns {{
 *   facet: { decorate(definition, owner): object, snapshot(): object },
 *   adapter: object,  // the `_decoration` hook surface for the fork
 *   dispose(): void,
 * }}
 */
export function createDecorationRegistry({ logger } = {}) {
  /** provider -> BindingRecord */
  const bindings = new Map()
  /** registration ownership token -> Set<provider> */
  const registrationProviders = new Map()
  /** owner token -> Map<id, DecorationRecord> */
  const recordsByOwner = new Map()
  /** flat set of every live record (active + degraded) */
  const liveRecords = new Set()
  /** bounded non-durable audit ring */
  const audit = []
  /** registry epoch: bumped on every official mutation boundary and reconcile */
  let epoch = 0
  /** monotonic commit sequence within the current epoch (cross-owner) */
  let nextSequence = 0
  /** stable summary counters for detached projections */
  let bindingCounter = 0
  let generationCounter = 0

  const auditEntry = (entry) => {
    audit.push(entry)
    if (audit.length > AUDIT_RING_SIZE) audit.shift()
  }

  const reSequence = () => {
    const ordered = [...liveRecords].sort((a, b) => a.sequence - b.sequence)
    nextSequence = 0
    for (const record of ordered) record.sequence = nextSequence++
  }

  const bumpEpoch = () => {
    epoch += 1
    reSequence()
  }

  const ownerRecords = (owner) => {
    let map = recordsByOwner.get(owner)
    if (!map) {
      map = new Map()
      recordsByOwner.set(owner, map)
    }
    return map
  }

  const matchInputFor = (binding) => ({
    provider: binding.provider,
    adapterIdentity: binding.adapterIdentity,
    generation: binding.adapterGeneration,
    providerInfo: binding.adapterInfo,
  })

  /** Re-evaluate every live decoration against the current bindings. */
  const reconcile = () => {
    bumpEpoch()
    const activeBindings = [...bindings.values()].filter((b) => b.lifecycleState === BINDING_LIFECYCLE.ACTIVE)
    for (const record of liveRecords) {
      record.matches.clear()
      let degraded = false
      for (const binding of activeBindings) {
        let matched
        try {
          matched = record.definition.match(matchInputFor(binding))
        } catch (error) {
          degraded = true
          record.degradedReason = boundedErrorSummary(error)
          break
        }
        if (matched === true) record.matches.set(binding.adapterIdentity, binding)
      }
      if (degraded) {
        record.lifecycleState = LIFECYCLE.DEGRADED
      } else if (record.lifecycleState === LIFECYCLE.DEGRADED) {
        record.lifecycleState = LIFECYCLE.ACTIVE
      }
    }
  }

  /** Official route commit (initial registration or atomic replace). */
  const onAdapterRoutesCommitted = (owned, registrations, ownership) => {
    try {
      const newProviders = registrations.map((r) => r.provider.id)
      const previous = registrationProviders.get(ownership) ?? new Set()
      for (const provider of previous) {
        if (newProviders.includes(provider)) continue
        const binding = bindings.get(provider)
        if (binding && binding.registrationIdentity === ownership) {
          binding.lifecycleState = BINDING_LIFECYCLE.REVOKED
          bindings.delete(provider)
        }
      }
      for (const registration of registrations) {
        const provider = registration.provider.id
        // Detached frozen provider metadata: the match predicate must never be
        // handed a live reference into the official registry.
        const detachedProvider = Object.freeze({ id: registration.provider.id, name: registration.provider.name })
        const existing = bindings.get(provider)
        if (existing && existing.registrationIdentity === ownership) {
          // A replace rebuilds the binding: the old binding object is revoked
          // (so in-flight chains detect supersession) and a fresh binding with
          // a new generation replaces it. The adapter identity is kept.
          existing.lifecycleState = BINDING_LIFECYCLE.REVOKED
          bindingCounter += 1
          generationCounter += 1
          bindings.set(provider, {
            provider,
            registrationIdentity: ownership,
            adapterIdentity: existing.adapterIdentity,
            adapterIdentitySummary: existing.adapterIdentitySummary,
            adapterGeneration: opaque(),
            adapterGenerationSummary: `generation-${generationCounter}`,
            lifecycleState: BINDING_LIFECYCLE.ACTIVE,
            adapterInfo: detachedProvider,
            registration,
          })
        } else {
          bindingCounter += 1
          generationCounter += 1
          bindings.set(provider, {
            provider,
            registrationIdentity: ownership,
            adapterIdentity: opaque(),
            adapterIdentitySummary: `binding-${bindingCounter}`,
            adapterGeneration: opaque(),
            adapterGenerationSummary: `generation-${generationCounter}`,
            lifecycleState: BINDING_LIFECYCLE.ACTIVE,
            adapterInfo: detachedProvider,
            registration,
          })
        }
      }
      registrationProviders.set(ownership, new Set(newProviders))
      reconcile()
    } catch (error) {
      logBounded(logger, `llm: decoration reconcile after adapter route commit failed: ${boundedErrorSummary(error)}`)
    }
  }

  /** Official registration disposal: revoke only this registration's bindings. */
  const onAdapterRoutesDisposed = (providersSnapshot, ownership) => {
    try {
      for (const provider of providersSnapshot ?? []) {
        const binding = bindings.get(provider)
        if (binding && binding.registrationIdentity === ownership) {
          binding.lifecycleState = BINDING_LIFECYCLE.REVOKED
          bindings.delete(provider)
        }
      }
      registrationProviders.delete(ownership)
      reconcile()
    } catch (error) {
      logBounded(logger, `llm: decoration reconcile after adapter route disposal failed: ${boundedErrorSummary(error)}`)
    }
  }

  const onDirectoryCommitted = () => {
    try {
      reconcile()
    } catch (error) {
      logBounded(logger, `llm: decoration reconcile after directory commit failed: ${boundedErrorSummary(error)}`)
    }
  }

  const onDirectoryDisposed = () => {
    try {
      reconcile()
    } catch (error) {
      logBounded(logger, `llm: decoration reconcile after directory disposal failed: ${boundedErrorSummary(error)}`)
    }
  }

  const onDiscoveryCommitted = () => {
    try {
      reconcile()
    } catch (error) {
      logBounded(logger, `llm: decoration reconcile after discovery commit failed: ${boundedErrorSummary(error)}`)
    }
  }

  const onDiscoveryDisposed = () => {
    try {
      reconcile()
    } catch (error) {
      logBounded(logger, `llm: decoration reconcile after discovery disposal failed: ${boundedErrorSummary(error)}`)
    }
  }

  /** Whether a decoration generation is still the current, live record. */
  const isDecorationCurrent = (owner, id, generation) => {
    try {
      const record = recordsByOwner.get(owner)?.get(id)
      return (
        record !== undefined &&
        record.generation === generation &&
        record.lifecycleState !== LIFECYCLE.DISPOSED &&
        record.lifecycleState !== LIFECYCLE.REVOKED
      )
    } catch {
      return false
    }
  }

  /**
   * Build the deterministic decoration chain for one real adapter operation.
   * Returns null when no decoration applies; the caller then uses the plain
   * official path.
   */
  const chainFor = ({ provider, model, options, signal }) => {
    try {
      const binding = bindings.get(provider)
      if (!binding || binding.lifecycleState !== BINDING_LIFECYCLE.ACTIVE) return null
      const store = DECORATION_ALS.getStore()
      const inFlight = store && typeof store.get === 'function' ? (store.get(binding) ?? null) : null
      const matched = []
      for (const record of liveRecords) {
        if (record.lifecycleState === LIFECYCLE.DISPOSED || record.lifecycleState === LIFECYCLE.REVOKED) continue
        if (inFlight && inFlight.has(`${record.ownerIdentity}:${record.id}`)) continue // recursion fence: no self-match
        let ok
        try {
          ok = record.definition.match(matchInputFor(binding))
        } catch (error) {
          record.lifecycleState = LIFECYCLE.DEGRADED
          record.degradedReason = boundedErrorSummary(error)
          logBounded(logger, `llm: decoration "${record.id}" match threw for provider "${provider}"; excluded from this chain (owner: ${record.ownerSummary})`)
          continue
        }
        if (ok !== true) continue
        if (record.lifecycleState === LIFECYCLE.DEGRADED) record.lifecycleState = LIFECYCLE.ACTIVE
        record.matches.set(binding.adapterIdentity, binding)
        record.lastReconciledAt = Date.now()
        matched.push(record)
      }
      if (matched.length === 0) return null
      matched.sort((a, b) => {
        const tier = comparePriority(a.definition.priority, b.definition.priority)
        return tier !== 0 ? tier : a.sequence - b.sequence
      })
      return matched.map((record) => ({
        id: record.id,
        ownerSummary: record.ownerSummary,
        ownerIdentity: record.ownerIdentity,
        generation: record.generation,
        definition: record.definition,
        binding,
        sourceRoute: { provider, model },
        options,
        signal,
        isCurrent: () => isDecorationCurrent(record.ownerIdentity, record.id, record.generation),
      }))
    } catch (error) {
      logBounded(logger, `llm: decoration chain build failed: ${boundedErrorSummary(error)}`)
      return null
    }
  }

  /** Facade-facing projection of one record's decoration snapshot. */
  const recordSnapshot = (record) => {
    const bindingsOut = []
    for (const binding of record.matches.values()) {
      bindingsOut.push({
        provider: binding.provider,
        adapterIdentity: binding.adapterIdentitySummary,
        generation: binding.adapterGenerationSummary,
        lifecycleState: binding.lifecycleState,
        overlay: Object.freeze({ labels: [] }),
      })
    }
    return Object.freeze({
      id: record.id,
      owner: record.ownerSummary,
      priority: record.definition.priority,
      capabilities: Object.freeze({
        metadata: record.definition.capabilities.metadata,
        execution: record.definition.capabilities.execution,
      }),
      lifecycleState: record.lifecycleState,
      bindings: Object.freeze(bindingsOut),
      observedAt: record.lastReconciledAt ?? record.createdAt,
    })
  }

  const registrySnapshot = () => {
    const records = [...liveRecords]
      .filter((r) => r.lifecycleState !== LIFECYCLE.DISPOSED && r.lifecycleState !== LIFECYCLE.REVOKED)
      .sort((a, b) => a.sequence - b.sequence)
      .map(recordSnapshot)
    return deepFreeze(structuredClone({ epoch, decorations: records }))
  }

  const decorate = (definition, owner) => {
    if (typeof owner !== 'string' || owner.length === 0) {
      return { status: DecorationRegistrationStatus.UNAVAILABLE, reason: 'decoration owner is unavailable' }
    }
    const normalized = normalizeDecorationDefinition(definition)
    if (!normalized.ok) {
      return { status: DecorationRegistrationStatus.VALIDATION, reason: normalized.reason }
    }
    const { definition: def } = normalized
    const ownerMap = ownerRecords(owner)
    const existing = ownerMap.get(def.id)
    if (existing) {
      if (existing.lifecycleState === LIFECYCLE.DISPOSED || existing.lifecycleState === LIFECYCLE.REVOKED) {
        return { status: DecorationRegistrationStatus.CONFLICT, reason: 'decoration id is already disposed for this owner' }
      }
      if (definitionsEquivalent(existing.definition, def)) {
        return { status: DecorationRegistrationStatus.OK, record: existing, existing: true }
      }
      return { status: DecorationRegistrationStatus.CONFLICT, reason: 'decoration id conflicts with an existing registration' }
    }
    const record = {
      ownerIdentity: owner,
      ownerSummary: boundedOwnerSummary(owner),
      id: def.id,
      definition: def,
      registrationSequence: ownerMap.size,
      sequence: nextSequence++,
      lifecycleState: LIFECYCLE.ACTIVE,
      generation: opaque(),
      matches: new Map(),
      createdAt: Date.now(),
      lastReconciledAt: undefined,
      degradedReason: undefined,
    }
    ownerMap.set(def.id, record)
    liveRecords.add(record)
    auditEntry({
      owner: record.ownerSummary,
      decorationId: record.id,
      provider: undefined,
      adapterIdentity: undefined,
      generation: record.ownerSummary,
      lifecycle: 'registered',
      outcome: 'ok',
      errorCode: undefined,
      observedAt: Date.now(),
    })
    reconcile()
    return { status: DecorationRegistrationStatus.OK, record }
  }

  /** Identity-bound disposal: exact owner + id + generation. */
  const disposeDecoration = (owner, id, generation) => {
    const ownerMap = recordsByOwner.get(owner)
    const record = ownerMap?.get(id)
    if (!record || record.generation !== generation) {
      return { status: DecorationRegistrationStatus.UNAVAILABLE, reason: 'stale or unknown decoration handle' }
    }
    if (record.lifecycleState === LIFECYCLE.DISPOSED || record.lifecycleState === LIFECYCLE.REVOKED) {
      return { status: DecorationRegistrationStatus.UNAVAILABLE, reason: 'decoration is already disposed' }
    }
    record.lifecycleState = LIFECYCLE.DISPOSED
    record.matches.clear()
    liveRecords.delete(record)
    ownerMap.delete(id)
    if (ownerMap.size === 0) recordsByOwner.delete(owner)
    auditEntry({
      owner: record.ownerSummary,
      decorationId: record.id,
      provider: undefined,
      adapterIdentity: undefined,
      generation: record.ownerSummary,
      lifecycle: 'disposed',
      outcome: 'ok',
      errorCode: undefined,
      observedAt: Date.now(),
    })
    return { status: DecorationRegistrationStatus.OK }
  }

  const handleSnapshot = (owner, id, generation) => {
    const ownerMap = recordsByOwner.get(owner)
    const record = ownerMap?.get(id)
    if (!record || record.generation !== generation) {
      return { status: DecorationRegistrationStatus.UNAVAILABLE, reason: 'stale or unknown decoration handle' }
    }
    return { status: DecorationRegistrationStatus.OK, snapshot: recordSnapshot(record) }
  }

  const handleDispose = (owner, id, generation) => {
    const outcome = disposeDecoration(owner, id, generation)
    return { status: outcome.status, reason: outcome.reason }
  }

  const dispose = () => {
    // Registry disposal revokes every record without touching official state.
    for (const record of liveRecords) {
      record.lifecycleState = LIFECYCLE.DISPOSED
      record.matches.clear()
    }
    liveRecords.clear()
    recordsByOwner.clear()
    bindings.clear()
    registrationProviders.clear()
  }

  return {
    facet: {
      decorate,
      snapshot: registrySnapshot,
      dispose: handleDispose,
      snapshotOf: handleSnapshot,
    },
    adapter: {
      onAdapterRoutesCommitted,
      onAdapterRoutesDisposed,
      onDirectoryCommitted,
      onDirectoryDisposed,
      onDiscoveryCommitted,
      onDiscoveryDisposed,
      chainFor,
    },
    dispose,
    /** identity-bound handle helpers (facet-side) */
    handleDispose,
    handleSnapshot,
    /** test seams */
    _epoch: () => epoch,
    _liveRecords: () => liveRecords.size,
    _audit: () => audit,
  }
}

/**
 * Attach a decoration registry to a forked runtime.
 *
 * @param {object} runtime - the forked LlmRuntime instance.
 * @param {{ logger?: object }} [options]
 * @returns {{ facet: object, dispose(): void, registry: object }}
 */
export function attachDecorationRegistry(runtime, { logger } = {}) {
  const registry = createDecorationRegistry({ logger })
  runtime._decoration = registry.adapter
  return {
    facet: registry.facet,
    dispose: registry.dispose,
    registry,
  }
}
