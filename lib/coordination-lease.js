/**
 * Host owner for the coordination lease facade (`pluginApi.coordination`).
 *
 * The facade provides bounded ownership (acquire / heartbeat / release /
 * takeover / compareAndSet / watch) for a logical resource while preserving
 * the truth about the backend that supplied each guarantee. Expected
 * conflicts, stale handles, unavailable backends, and unsupported guarantees
 * are discriminated result values with a stable `code`; they are never thrown
 * through a plugin callback, and apply-time failures only disable this
 * feature with a bounded diagnostic.
 *
 * The facade consumes only public host services. A storage-domain bridge
 * adapter is selected only when the host explicitly reports durable scope and
 * atomic operation support; otherwise a memory-scoped, non-durable adapter is
 * used and labeled as such.
 */
import { deepFreeze } from './deep-freeze.js'
import {
  buildAvailability,
  cloneBoundedPublic,
  COORDINATION_DURABILITY,
  COORDINATION_OPERATIONS,
  redactLeaseRecord,
} from './coordination-normalize.js'
import {
  createMemoryCoordinationAdapter,
  createStorageDomainCoordinationAdapter,
} from './coordination-adapters.js'
import {
  normalizeExpectedProof,
  normalizeExpectedVersion,
  normalizeHandle,
  normalizeLeaseMs,
  normalizeOwnerId,
  normalizeProvenance,
  normalizeResource,
} from './coordination-normalize.js'

function isObject(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}

function read(value, key) {
  try {
    return value?.[key]
  } catch {
    return undefined
  }
}

function boundedString(value, max = 160) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const text = String(value).trim()
  return text ? text.slice(0, max) : undefined
}

function resolveOptionalServices(ctx) {
  const out = { storageDomain: null, storage: null, workspaces: null }
  if (typeof ctx?.get !== 'function') return out
  for (const name of Object.keys(out)) {
    try {
      out[name] = ctx.get(name) ?? null
    } catch {
      out[name] = null
    }
  }
  return out
}

/**
 * The only path that selects the durable bridge: an explicit, documented
 * capability report on the public storage service plus a domain unit with
 * read/write. Capability is never inferred from a domain name or service
 * presence alone.
 */
function explicitCoordinationCapabilityReport(services) {
  const service = services?.storage
  if (!isObject(service)) return null
  const reportFn = read(service, 'coordinationCapability')
  if (typeof reportFn !== 'function') return null
  let report
  try {
    report = reportFn('workspace') ?? null
  } catch {
    return null
  }
  if (!isObject(report) || !COORDINATION_DURABILITY.includes(report.durability)) return null
  if (report.atomicCas !== true && report.atomicTakeover !== true) return null
  const unit = read(service, 'domainUnit')
  if (!isObject(unit) || typeof unit.read !== 'function' || typeof unit.write !== 'function') return null
  return { report, unit }
}

function selectAdapter({ ctx, now, idFactory, logger }) {
  const services = resolveOptionalServices(ctx)
  const report = explicitCoordinationCapabilityReport(services)
  if (report) {
    try {
      return createStorageDomainCoordinationAdapter({
        unit: report.unit,
        capabilityReport: report.report,
        now,
        idFactory,
      })
    } catch (error) {
      // A broken bridge degrades to the memory adapter with a bounded log.
      try {
        logger?.error?.(`dsh-plugin-api coordination: durable bridge unavailable (${boundedString(error?.message ?? error, 160)})`)
      } catch {
        // diagnostics must never interrupt the fail-safe path
      }
    }
  }
  return createMemoryCoordinationAdapter({ now, idFactory })
}

function operationAvailability(caps) {
  const base = caps.status ?? 'unknown'
  const operations = {}
  for (const op of COORDINATION_OPERATIONS) {
    if (op === 'takeover') operations[op] = caps.atomicTakeover ? base : 'unsupported'
    else if (op === 'compareAndSet') operations[op] = caps.atomicCas ? base : 'unsupported'
    else if (op === 'watch') operations[op] = caps.watch ? base : 'unsupported'
    else operations[op] = base
  }
  return operations
}

/**
 * @param {{ ctx?: object, logger?: object, now?: () => Date|number|string, idFactory?: () => string }} [options]
 * @returns {{ api: object, dispose: () => boolean, availability: object }}
 */
export function createCoordinationLease({ ctx, logger, now, idFactory } = {}) {
  const adapter = selectAdapter({ ctx, now, idFactory, logger })
  const caps = adapter.capabilities()
  let epochSeq = 0
  let disposed = false

  const mountEpoch = `epoch:${++epochSeq}`

  const observedAt = () => {
    try {
      const value = typeof now === 'function' ? now() : new Date()
      const date = value instanceof Date ? value : new Date(value)
      if (!Number.isNaN(date.getTime())) return date.toISOString()
    } catch {
      // Fall through to a local timestamp.
    }
    return new Date().toISOString()
  }

  const snapshot = (reason) => buildAvailability({
    status: caps.status,
    scope: caps.scope,
    durability: caps.durability,
    operations: operationAvailability(caps),
    backend: { id: caps.backendId, ...(reason ? { reason } : {}) },
    epoch: mountEpoch,
  })

  const mountAvailability = snapshot()

  const setEpoch = (extra) => buildAvailability({
    status: caps.status,
    scope: caps.scope,
    durability: caps.durability,
    operations: operationAvailability(caps),
    backend: { id: caps.backendId, ...(extra ? { reason: extra } : {}) },
    epoch: `epoch:${epochSeq}`,
  })

  const inactive = (operation) => deepFreeze({
    ok: false,
    code: 'inactive',
    operation,
    observedAt: observedAt(),
  })

  const invalid = (reason, { resource, operation, observed } = {}) => deepFreeze({
    ok: false,
    code: 'invalid-input',
    reason,
    ...(resource ? { resource } : {}),
    operation,
    ...(observed ? { observed } : {}),
    observedAt: observedAt(),
  })

  // The facade normalizes stale-family machine codes from the underlying
  // adapters into the closed coordination vocabulary: a stale handle is
  // always `conflict` with the stale condition carried in `reason`.
  const STALE_CODES = new Set(['stale-holder', 'superseded', 'expired', 'compare-conflict', 'stale'])
  const failed = (code, { resource, operation, observed, reason } = {}) => {
    const normalizedCode = STALE_CODES.has(code) ? 'conflict' : code
    const condition = STALE_CODES.has(code)
      ? reason ?? `${code}: stale or superseded coordination credential`
      : reason
    return deepFreeze({
      ok: false,
      code: normalizedCode,
      ...(resource ? { resource } : {}),
      operation,
      ...(observed ? { observed } : {}),
      ...(condition ? { reason: condition } : {}),
      observedAt: observedAt(),
    })
  }

  const succeeded = (code, { resource, operation, handle, version, value } = {}) => deepFreeze({
    ok: true,
    code,
    ...(resource ? { resource } : {}),
    operation,
    ...(handle ? { handle } : {}),
    ...(version !== undefined ? { version } : {}),
    ...(value !== undefined ? { value } : {}),
    observedAt: observedAt(),
  })

  const resourceOf = (handleOrResource) => isObject(handleOrResource) ? handleOrResource.resource : undefined

  async function availability(scope) {
    if (disposed) return setEpoch('facade disposed')
    const requested = boundedString(scope, 40)
    if (requested !== undefined && !['session', 'workspace', 'profile', 'process'].includes(requested)) {
      return buildAvailability({
        status: 'unknown',
        scope: requested,
        durability: caps.durability,
        operations: operationAvailability(caps),
        backend: { id: caps.backendId, reason: `requested scope "${requested}" is not a valid coordination scope` },
        epoch: `epoch:${epochSeq}`,
      })
    }
    if (requested !== undefined && requested !== caps.scope) {
      // A backend that is scoped to `process` cannot truthfully serve
      // `session`- or `workspace`-scoped coordination.
      return buildAvailability({
        status: 'unsupported',
        scope: requested,
        durability: caps.durability,
        operations: operationAvailability({ ...caps }),
        backend: { id: caps.backendId, reason: `requested scope "${requested}" exceeds the ${caps.scope}-scoped backend` },
        epoch: `epoch:${epochSeq}`,
      })
    }
    return setEpoch()
  }

  async function acquire(input = {}) {
    if (disposed) return inactive('acquire')
    const resource = normalizeResource(input.resource)
    if (!resource.ok) return invalid(resource.reason, { operation: 'acquire' })
    const ownerId = normalizeOwnerId(input.ownerId)
    if (!ownerId.ok) return invalid(ownerId.reason, { resource: resource.value, operation: 'acquire' })
    const leaseMs = normalizeLeaseMs(input.leaseMs)
    if (!leaseMs.ok) return invalid(leaseMs.reason, { resource: resource.value, operation: 'acquire' })
    const provenance = input.provenance === undefined ? { ok: true, value: [] }
      : normalizeProvenance(input.provenance)
    if (!provenance.ok) return invalid(provenance.reason, { resource: resource.value, operation: 'acquire' })
    const outcome = await adapter.acquire({
      resource: resource.value,
      ownerId: ownerId.value,
      leaseMs: leaseMs.value,
      provenance: provenance.value,
    })
    if (!outcome.ok) return failed(outcome.code, { resource: resource.value, operation: 'acquire', observed: outcome.observed })
    return succeeded('acquired', { resource: resource.value, operation: 'acquire', handle: outcome.handle })
  }

  async function heartbeat(handle, options = {}) {
    if (disposed) return inactive('heartbeat')
    const normalized = normalizeHandle(handle)
    if (!normalized.ok) return invalid(normalized.reason, { operation: 'heartbeat' })
    const leaseMs = normalizeLeaseMs(options.leaseMs, { allowUndefined: true })
    if (!leaseMs.ok) return invalid(leaseMs.reason, { resource: resourceOf(normalized.value), operation: 'heartbeat' })
    const outcome = await adapter.heartbeat({
      resource: normalized.value.resource,
      handle: normalized.value,
      leaseMs: leaseMs.value,
    })
    if (!outcome.ok) {
      return failed(outcome.code, { resource: normalized.value.resource, operation: 'heartbeat', observed: outcome.observed })
    }
    return succeeded('heartbeated', { resource: normalized.value.resource, operation: 'heartbeat', handle: outcome.handle })
  }

  async function release(handle) {
    if (disposed) return inactive('release')
    const normalized = normalizeHandle(handle)
    if (!normalized.ok) return invalid(normalized.reason, { operation: 'release' })
    const outcome = await adapter.release({ resource: normalized.value.resource, handle: normalized.value })
    if (!outcome.ok) {
      return failed(outcome.code, { resource: normalized.value.resource, operation: 'release', observed: outcome.observed })
    }
    return succeeded('released', { resource: normalized.value.resource, operation: 'release' })
  }

  async function takeover(input = {}) {
    if (disposed) return inactive('takeover')
    const resource = normalizeResource(input.resource)
    if (!resource.ok) return invalid(resource.reason, { operation: 'takeover' })
    const ownerId = normalizeOwnerId(input.ownerId)
    if (!ownerId.ok) return invalid(ownerId.reason, { resource: resource.value, operation: 'takeover' })
    const leaseMs = normalizeLeaseMs(input.leaseMs)
    if (!leaseMs.ok) return invalid(leaseMs.reason, { resource: resource.value, operation: 'takeover' })
    const expectedProof = normalizeExpectedProof(input.expectedProof)
    if (!expectedProof.ok) return invalid(expectedProof.reason, { resource: resource.value, operation: 'takeover' })
    const reason = boundedString(input.reason, 120)
    const provenance = input.provenance === undefined ? { ok: true, value: [] }
      : normalizeProvenance(input.provenance)
    if (!provenance.ok) return invalid(provenance.reason, { resource: resource.value, operation: 'takeover' })
    const outcome = await adapter.takeover({
      resource: resource.value,
      ownerId: ownerId.value,
      leaseMs: leaseMs.value,
      expectedProof: expectedProof.value,
      reason,
      provenance: provenance.value,
    })
    if (!outcome.ok) {
      return failed(outcome.code, { resource: resource.value, operation: 'takeover', observed: outcome.observed })
    }
    return succeeded('taken-over', { resource: resource.value, operation: 'takeover', handle: outcome.handle })
  }

  async function compareAndSet(input = {}) {
    if (disposed) return inactive('compareAndSet')
    const normalized = normalizeHandle(input.handle)
    if (!normalized.ok) return invalid(normalized.reason, { operation: 'compareAndSet' })
    const expectedVersion = normalizeExpectedVersion(input.expectedVersion)
    if (!expectedVersion.ok) return invalid(expectedVersion.reason, { resource: normalized.value.resource, operation: 'compareAndSet' })
    const outcome = await adapter.compareAndSet({
      resource: normalized.value.resource,
      handle: normalized.value,
      expectedVersion: expectedVersion.value,
      value: input.value,
    })
    if (!outcome.ok) {
      return failed(outcome.code, {
        resource: normalized.value.resource,
        operation: 'compareAndSet',
        observed: outcome.observed,
      })
    }
    return succeeded('cas-ok', {
      resource: normalized.value.resource,
      operation: 'compareAndSet',
      handle: outcome.handle,
      version: outcome.version,
      value: cloneBoundedPublic(input.value),
    })
  }

  async function watch(resource, options = {}) {
    if (disposed) return inactive('watch')
    const normalized = normalizeResource(resource)
    if (!normalized.ok) return invalid(normalized.reason, { operation: 'watch' })
    const sinceGeneration = boundedString(options.sinceGeneration, 120)
    const audience = boundedString(options.audience, 40) ?? 'ui'
    const subscription = {
      epoch: `epoch:${++epochSeq}`,
      disposed: false,
      listeners: new Set(),
      resyncReported: false,
      adapterUnsubscribe: null,
      signal: options.signal,
      abortHandler: null,
      resource: normalized.value,
      sinceGeneration,
    }

    subscription.current = async () => {
      if (subscription.disposed) {
        return deepFreeze({ code: 'inactive', resource: normalized.value, epoch: subscription.epoch, observedAt: observedAt() })
      }
      const found = await adapter.read(normalized.value)
      if (!found.ok) {
        return deepFreeze({
          code: 'unavailable',
          resource: normalized.value,
          epoch: subscription.epoch,
          observedAt: observedAt(),
          resync: sinceGeneration !== undefined,
        })
      }
      const projection = redactLeaseRecord(found.record, { audience })
      return deepFreeze({
        ...projection,
        fencingValid: found.record.state === 'active',
        observedAt: observedAt(),
        epoch: subscription.epoch,
        resync: sinceGeneration !== undefined && sinceGeneration !== found.record.generation,
      })
    }

    subscription.subscribe = (fn) => {
      if (subscription.disposed) throw new TypeError('watch subscription is disposed')
      if (typeof fn !== 'function') throw new TypeError('watch listener must be a function')
      subscription.listeners.add(fn)
      let active = true
      const detach = () => {
        if (!active) return false
        active = false
        return subscription.listeners.delete(fn)
      }
      if (watchUnsupported && !subscription.unsupportedReported) {
        subscription.unsupportedReported = true
        deliver(deepFreeze({
          code: 'unsupported',
          reason: 'backend does not support watch notifications',
          resync: sinceGeneration !== undefined,
          observedAt: typeof now === 'function' ? now() : new Date().toISOString(),
          epoch: subscription.epoch,
        }))
      }
      return detach
    }

    const deliver = (event) => {
      if (subscription.disposed) return
      for (const listener of [...subscription.listeners]) {
        try {
          const result = listener(event)
          if (result && typeof result.then === 'function') {
            Promise.resolve(result).catch(() => {})
          }
        } catch {
          // observer failures are contained per subscription
        }
      }
    }

    const onEvent = (event) => {
      if (subscription.disposed) return
      if (sinceGeneration !== undefined && !subscription.resyncReported) {
        subscription.resyncReported = true
        if (event.generation !== sinceGeneration) {
          deliver(deepFreeze({ ...event, resync: true, epoch: subscription.epoch }))
          return
        }
        deliver(deepFreeze({ ...event, resync: false, epoch: subscription.epoch }))
        return
      }
      deliver(deepFreeze({ ...event, epoch: subscription.epoch }))
    }

    subscription.dispose = () => {
      if (subscription.disposed) return false
      subscription.disposed = true
      if (subscription.adapterUnsubscribe) {
        try {
          subscription.adapterUnsubscribe()
        } catch {
          // best-effort detach
        }
        subscription.adapterUnsubscribe = null
      }
      if (subscription.signal && subscription.abortHandler) {
        try {
          subscription.signal.removeEventListener('abort', subscription.abortHandler)
        } catch {
          // best-effort detach
        }
      }
      subscription.listeners.clear()
      return true
    }

    const adapterWatch = adapter.watch({ resource: normalized.value })
    const watchUnsupported = Boolean(adapterWatch && adapterWatch.code === 'unsupported')
    if (!watchUnsupported && adapterWatch && typeof adapterWatch.subscribe === 'function') {
      subscription.adapterUnsubscribe = adapterWatch.subscribe(onEvent)
    }

    if (options.signal) {
      subscription.abortHandler = () => subscription.dispose()
      try {
        options.signal.addEventListener('abort', subscription.abortHandler, { once: true })
      } catch {
        // an invalid signal only degrades this subscription
      }
    }

    return deepFreeze({
      current: subscription.current,
      subscribe: subscription.subscribe,
      dispose: subscription.dispose,
      epoch: subscription.epoch,
      resource: normalized.value,
    })
  }

  const api = Object.freeze({
    availability,
    acquire,
    heartbeat,
    release,
    takeover,
    compareAndSet,
    watch,
  })

  const dispose = () => {
    if (disposed) return false
    disposed = true
    try {
      adapter.dispose()
    } catch {
      // disposal must never escape the fail-safe path
    }
    return true
  }

  return { api, dispose, availability: mountAvailability }
}