/**
 * Host owner for the workspace mutation transaction facade
 * (`pluginApi.workspaceTransactions`).
 *
 * The facade provides an explicit transaction boundary (prepare / record /
 * preview / commit / rollback / recover / get / observe) for workspace
 * changes. It consumes the public `pluginApi.coordination` contract (lease /
 * fencing) and the read-only `pluginApi.recovery` vocabulary, plus optional
 * public capability seams through small adapters. Expected conflicts, stale
 * fencing, unavailable capabilities, unsupported guarantees, and disposed
 * surfaces are discriminated typed result values with a stable `code`; they
 * are never thrown through a plugin callback, and apply-time failures only
 * disable this feature with a bounded diagnostic.
 *
 * The registry is a storage-domain bridge only when the host explicitly
 * reports a usable durable scope and conditional write primitive; otherwise a
 * memory-scoped, non-durable registry is used and labeled as such.
 */
import { deepFreeze } from './deep-freeze.js'
import {
  buildAvailability,
  canTransition,
  cloneBoundedPublic,
  normalizeFencingEvidence,
  normalizeIntent,
  normalizeMutationRecord,
  normalizeOwnerId,
  normalizeProvenance,
  normalizeResourceSet,
  normalizeTransactionId,
  normalizeWorkspace,
  redactTransactionRecord,
  resourceKey,
  WS_TX_DURABILITY,
  WS_TX_OPERATIONS,
  WS_TX_SCOPES,
  WS_TX_STATUSES,
} from './workspace-transaction-normalize.js'
import {
  createApprovalAdapter,
  createCheckpointAdapter,
  createFileClaimAdapter,
  createGitRestoreAdapter,
  createLedgerAdapter,
  createMemoryWorkspaceRegistry,
  createSessionBranchAdapter,
  createStorageDomainWorkspaceRegistry,
  createUuidFactory,
  createWorkspaceCapabilityAdapter,
} from './workspace-transaction-adapters.js'

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

function isThenable(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    && typeof value.then === 'function'
}

const isThenableValue = isThenable

function resolveOptionalServices(ctx) {
  const out = { storage: null, workspaces: null, fileClaim: null }
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
 * The only path that selects the durable registry bridge: an explicit,
 * documented capability report on the public storage service plus a domain
 * unit with read/write and compare-and-swap. Capability is never inferred
 * from a domain name or service presence alone.
 */
function explicitTransactionCapabilityReport(services) {
  const service = services?.storage
  if (!isObject(service)) return null
  const reportFn = read(service, 'transactionCapability')
  if (typeof reportFn !== 'function') return null
  let report
  try {
    report = reportFn('workspace') ?? null
  } catch {
    return null
  }
  if (!isObject(report)) return null
  const durability = boundedString(report.durability, 40)
  if (!durability || !['durable', 'session', 'workspace'].includes(durability)) return null
  if (report.atomicCas !== true) return null
  const unit = read(service, 'domainUnit')
  if (!isObject(unit) || typeof unit.read !== 'function' || typeof unit.write !== 'function'
    || typeof unit.compareAndSwap !== 'function') {
    return null
  }
  return { report, unit }
}

function createSerialLane() {
  let tail = Promise.resolve()
  return {
    run(fn) {
      const next = tail.then(() => fn())
      tail = next.then(() => undefined, () => undefined)
      return next
    },
  }
}

/**
 * @param {{ ctx?: object, coordination?: object, recovery?: object, logger?: object, now?: () => Date|number|string, idFactory?: () => string }} [options]
 * @returns {{ api: object, dispose: () => boolean, availability: object }}
 */
export function createWorkspaceMutationTransaction({ ctx, coordination, recovery, logger, now, idFactory } = {}) {
  const nextId = typeof idFactory === 'function' ? idFactory : createUuidFactory()
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

  const services = resolveOptionalServices(ctx)
  const registryReport = explicitTransactionCapabilityReport(services)
  let registry = null
  if (registryReport) {
    try {
      registry = createStorageDomainWorkspaceRegistry({
        unit: registryReport.unit,
        capabilityReport: registryReport.report,
        now,
      })
    } catch (error) {
      try {
        logger?.error?.(`dsh-plugin-api workspace-transaction: durable registry unavailable (${boundedString(error?.message ?? error, 160)})`)
      } catch {
        // diagnostics must never interrupt the fail-safe path
      }
    }
  }
  if (!registry) registry = createMemoryWorkspaceRegistry({ now })

  const registryCaps = registry.capabilities()
  const workspaceAdapter = createWorkspaceCapabilityAdapter({ ctx, now })
  const fileClaimAdapter = createFileClaimAdapter({ ctx, now })
  const checkpointAdapter = createCheckpointAdapter({ ctx, now })
  const gitAdapter = createGitRestoreAdapter({ ctx, now })
  const ledgerAdapter = createLedgerAdapter({ ctx, now })
  const approvalAdapter = createApprovalAdapter({ ctx, now })
  const sessionBranchAdapter = createSessionBranchAdapter({ ctx, now })

  const claimLanes = new Map()
  const observers = new Map()
  let epochSeq = 0
  let disposed = false

  const mountEpoch = `epoch:${++epochSeq}`
  const caps = registryCaps

  const operationAvailability = () => {
    const base = caps.status ?? 'unknown'
    const operations = {}
    for (const op of WS_TX_OPERATIONS) {
      if (op === 'recover') operations[op] = caps.durability === 'durable' ? base : 'unsupported'
      else operations[op] = base
    }
    return operations
  }

  const availabilitySnapshot = (reason) => buildAvailability({
    status: caps.status,
    scope: caps.scope,
    durability: caps.durability,
    operations: operationAvailability(caps),
    backend: { id: caps.backendId, ...(reason ? { reason } : {}) },
    epoch: mountEpoch,
  })

  const setEpoch = (reason) => buildAvailability({
    status: caps.status,
    scope: caps.scope,
    durability: caps.durability,
    operations: operationAvailability(caps),
    backend: { id: caps.backendId, ...(reason ? { reason } : {}) },
    epoch: `epoch:${epochSeq}`,
  })

  const mountAvailability = availabilitySnapshot()

  const inactive = (operation) => deepFreeze({
    ok: false,
    code: 'inactive',
    operation,
    observedAt: observedAt(),
    availability: setEpoch('facade disposed'),
  })

  const invalid = (reasonValue, { transactionId, operation, observed } = {}) => deepFreeze({
    ok: false,
    code: 'invalid-input',
    reason: reasonValue,
    ...(transactionId ? { transactionId } : {}),
    operation,
    ...(observed ? { observed } : {}),
    observedAt: observedAt(),
    availability: setEpoch(),
  })

  const failed = (code, { transactionId, operation, reason, observed, recoveryClassification } = {}) => deepFreeze({
    ok: false,
    code,
    ...(transactionId ? { transactionId } : {}),
    operation,
    ...(reason ? { reason } : {}),
    ...(observed ? { observed } : {}),
    ...(recoveryClassification ? { recoveryClassification } : {}),
    observedAt: observedAt(),
    availability: setEpoch(),
  })

  const succeeded = (code, payload) => deepFreeze({
    ok: true,
    code,
    ...payload,
    observedAt: observedAt(),
    availability: setEpoch(),
  })

  /** Read-only recovery vocabulary source; a failure degrades to no evidence. */
  const recoveryEvidence = (kind, id) => {
    if (!isObject(recovery) || typeof recovery.availability !== 'function') return []
    try {
      const availability = recovery.availability()
      if (isObject(availability) && availability.status === 'available') {
        return [{ kind: kind ?? 'recovery', id: boundedString(id ?? 'available', 120) ?? 'available', certainty: 'observed' }]
      }
    } catch {
      // classification evidence must never interrupt the fail-safe path
    }
    return []
  }

  const classifyFailure = (error) => {
    if (!isObject(recovery) || typeof recovery.classify !== 'function') return undefined
    try {
      const result = recovery.classify(error)
      if (result?.ok && result.class) return boundedString(result.class, 40)
    } catch {
      // classification evidence must never interrupt the fail-safe path
    }
    return undefined
  }

  const claimLaneFor = (key) => {
    let lane = claimLanes.get(key)
    if (!lane) {
      lane = createSerialLane()
      claimLanes.set(key, lane)
    }
    return lane
  }

  const notify = (transactionId, event) => {
    const listeners = observers.get(String(transactionId))
    if (!listeners || listeners.size === 0) return
    const frozen = deepFreeze(event)
    for (const listener of [...listeners]) {
      try {
        const result = listener(frozen)
        if (isThenable(result)) {
          Promise.resolve(result).catch(() => {})
        }
      } catch {
        // observer failures are contained per subscription
      }
    }
  }

  const recoveryClassificationEntry = (error) => {
    const cls = classifyFailure(error)
    return cls ? [{ kind: 'recovery-classification', id: cls, certainty: 'observed' }] : []
  }

  /**
   * Validate the current fencing of a transaction record against the live
   * coordination projection. A missing coordination facade is an explicit
   * `unsupported`; a superseded/expired generation is `stale-fencing`.
   */
  const validateFencing = async (record) => {
    const lease = read(record, 'lease')
    if (!isObject(coordination) || typeof coordination.watch !== 'function') {
      return { ok: false, code: 'unsupported', reason: 'coordination facade is unavailable' }
    }
    const resource = read(lease, 'resource')
    let subscription
    try {
      subscription = await coordination.watch(resource)
    } catch {
      return { ok: false, code: 'unsupported', reason: 'coordination facade is unavailable' }
    }
    if (isThenableValue(subscription)) {
      try {
        subscription = await subscription
      } catch {
        return { ok: false, code: 'unsupported', reason: 'coordination facade is unavailable' }
      }
    }
    if (!isObject(subscription) || typeof subscription.current !== 'function') {
      return { ok: false, code: 'unsupported', reason: 'coordination facade is unavailable' }
    }
    let current
    try {
      current = await subscription.current()
    } catch {
      return { ok: false, code: 'unavailable', reason: 'coordination state could not be verified' }
    } finally {
      try {
        subscription.dispose?.()
      } catch {
        // best-effort detach
      }
    }
    if (!isObject(current)) return { ok: false, code: 'unavailable', reason: 'coordination state could not be verified' }
    if (current.fencingValid !== true) {
      return { ok: false, code: 'stale-fencing', reason: 'lease is no longer valid', observed: { generation: current.generation } }
    }
    if (current.generation !== read(lease, 'generation')) {
      return { ok: false, code: 'stale-fencing', reason: 'lease generation was superseded', observed: { generation: current.generation } }
    }
    return { ok: true }
  }

  const normalizeAudience = (input) => {
    if (typeof input === 'string') return { role: input }
    if (!isObject(input)) return {}
    const role = boundedString(read(input, 'role'), 40)
    const workspace = read(input, 'workspace')
    const audience = {}
    if (role) audience.role = role
    if (isObject(workspace)) {
      const scope = boundedString(read(workspace, 'scope'), 40)
      const key = boundedString(read(workspace, 'key'), 120)
      if (scope && WS_TX_SCOPES.includes(scope) && key) audience.workspace = { scope, key }
    }
    return audience
  }

  /**
   * Scope denial: a caller that declares a workspace scope different from the
   * transaction's workspace receives the exact unavailable shape of a missing
   * transaction, never an existence hint.
   */
  const scopeDenies = (record, audience) => {
    const declared = read(audience, 'workspace')
    if (!declared) return false
    const workspace = read(record, 'workspace')
    return declared.scope !== read(workspace, 'scope') || declared.key !== read(workspace, 'key')
  }

  const readRecord = async (transactionId, audience) => {
    const found = await registry.read(transactionId)
    if (!found.ok) return { ok: false, code: 'unavailable', reason: 'transaction is not found' }
    if (scopeDenies(found.record, audience)) {
      return { ok: false, code: 'unavailable', reason: 'transaction is not found' }
    }
    return { ok: true, record: found.record }
  }

  const publishTransition = async (record, nextState, reason) => {
    const previousState = record.state
    if (!canTransition(previousState, nextState)) {
      return { ok: false, code: 'conflict', reason: `cannot transition ${previousState} -> ${nextState}` }
    }
    const next = {
      ...record,
      state: nextState,
      revision: record.revision + 1,
      updatedAt: observedAt(),
    }
    const written = await registry.writeCas(record.transactionId, record.revision, next)
    if (!written.ok) {
      return { ok: false, code: written.code, reason: written.code === 'compare-conflict' ? 'revision conflict' : 'registry write failed' }
    }
    const event = {
      transactionId: record.transactionId,
      previousState,
      nextState,
      reason: boundedString(reason, 120) ?? 'transition',
      revision: written.record.revision,
      epoch: `epoch:${epochSeq}`,
      leaseGeneration: read(record.lease, 'generation'),
      evidence: cloneBoundedPublic(read(record, 'provenance')) ?? [],
      observedAt: observedAt(),
    }
    try {
      registry.prependEvent?.(record.transactionId, event)
    } catch {
      // late-event provenance retention is best effort
    }
    ++epochSeq
    notify(record.transactionId, event)
    return { ok: true, record: written.record, event }
  }

  async function prepare(input = {}) {
    if (disposed) return inactive('prepare')
    const transactionId = normalizeTransactionId(input.transactionId)
    if (!transactionId.ok) return invalid(transactionId.reason, { operation: 'prepare' })
    const workspace = normalizeWorkspace(input.workspace)
    if (!workspace.ok) return invalid(workspace.reason, { transactionId: transactionId.value, operation: 'prepare' })
    const ownerId = normalizeOwnerId(input.ownerId)
    if (!ownerId.ok) return invalid(ownerId.reason, { transactionId: transactionId.value, operation: 'prepare' })
    const intent = normalizeIntent(input.intent)
    if (!intent.ok) return invalid(intent.reason, { transactionId: transactionId.value, operation: 'prepare' })
    const resources = normalizeResourceSet(input.resources)
    if (!resources.ok) return invalid(resources.reason, { transactionId: transactionId.value, operation: 'prepare' })
    const lease = normalizeFencingEvidence(input.lease)
    if (!lease.ok) return invalid(lease.reason, { transactionId: transactionId.value, operation: 'prepare' })
    const provenance = normalizeProvenance(input.provenance)
    if (!provenance.ok) return invalid(provenance.reason, { transactionId: transactionId.value, operation: 'prepare' })

    // Reused identity: conflicting owner/scope/intent fails closed and never
    // merges records; equivalent metadata on a `prepared` record is an
    // idempotent replay; a terminal identity must be reused by a new id.
    const existing = await registry.read(transactionId.value)
    if (existing.ok) {
      const record = existing.record
      const sameIdentity = record.ownerId === ownerId.value
        && read(record.workspace, 'scope') === workspace.value.scope
        && read(record.workspace, 'key') === workspace.value.key
        && read(record.intent, 'kind') === intent.value.kind
        && read(record.intent, 'summary') === intent.value.summary
      if (!sameIdentity) {
        return failed('conflict', {
          transactionId: transactionId.value,
          operation: 'prepare',
          reason: 'transaction identity is already in use with conflicting owner, scope, or intent',
          observed: { state: record.state, revision: record.revision },
        })
      }
      if (record.state === 'prepared') {
        return succeeded('prepared', {
          transactionId: transactionId.value,
          transaction: redactTransactionRecord(record, { audience: 'ui' }),
        })
      }
      return failed('conflict', {
        transactionId: transactionId.value,
        operation: 'prepare',
        reason: `transaction identity is already in terminal state ${record.state}`,
        observed: { state: record.state, revision: record.revision },
      })
    }

    // Incompatible workspace/profile/session authority is rejected outright
    // before any mutation is published (incompatible-authority rejection).
    const authority = workspaceAdapter.capabilities(workspace.value.scope)
    if (authority.ok === false && authority.code === 'incompatible') {
      return failed('conflict', {
        transactionId: transactionId.value,
        operation: 'prepare',
        reason: `workspace scope is governed by an incompatible authority (${authority.authority})`,
        observed: authority.evidence,
      })
    }

    // Declared-required capabilities: a checkpoint input requires the
    // checkpoint adapter, and file-kind resources require the file-claim
    // adapter. An unavailable declared-required capability never produces a
    // commit-ready transaction (declared-required capability refusal).
    const checkpointCapability = checkpointAdapter.capability()
    const fileClaimCapability = fileClaimAdapter.capability()
    const hasFileResources = resources.value.some((resource) => resource.kind === 'file')
    if (input.checkpoint !== undefined && checkpointCapability.status !== 'available') {
      return failed(checkpointCapability.status === 'unsupported' ? 'unsupported' : 'unavailable', {
        transactionId: transactionId.value,
        operation: 'prepare',
        reason: 'declared checkpoint capability is unavailable',
      })
    }
    if (hasFileResources && fileClaimCapability.status !== 'available') {
      return failed(fileClaimCapability.status === 'unsupported' ? 'unsupported' : 'unavailable', {
        transactionId: transactionId.value,
        operation: 'prepare',
        reason: 'declared file-claim capability is unavailable for file resources',
      })
    }

    // Bind lease/fencing: claim file resources through the serialized claim
    // lane only after every capability precondition passed. The coordination
    // lease handle's own resource identity is the fencing target; when the
    // caller did not carry one, the transaction identity scoped to the
    // declared workspace is the fallback binding.
    const leaseResource = read(lease.value, 'resource') ?? { scope: workspace.value.scope, key: transactionId.value }
    const fencing = await validateFencing({ lease: { ...lease.value, resource: leaseResource } })
    if (!fencing.ok) {
      return failed(fencing.code, {
        transactionId: transactionId.value,
        operation: 'prepare',
        reason: fencing.reason,
        observed: fencing.observed,
      })
    }

    if (hasFileResources) {
      const claimResults = []
      for (const resource of resources.value) {
        if (resource.kind !== 'file') continue
        const claim = await claimLaneFor(resourceKey(resource)).run(() => fileClaimAdapter.claim(resource, lease.value))
        claimResults.push(claim)
        if (!claim.ok) {
          // Release only this transaction's own temporary claims.
          for (const seen of resources.value) {
            if (seen.kind !== 'file') continue
            try {
              await claimLaneFor(resourceKey(seen)).run(() => fileClaimAdapter.release(seen, lease.value))
            } catch {
              // best-effort cleanup
            }
          }
          return failed(claim.code === 'unsupported' ? 'unsupported' : 'unavailable', {
            transactionId: transactionId.value,
            operation: 'prepare',
            reason: `file claim failed for ${resource.kind}:${resource.key}`,
          })
        }
      }
    }

    const checkpoint = input.checkpoint !== undefined
      ? await checkpointAdapter.describe(input.checkpoint)
      : { ok: false, code: 'unsupported' }
    if (input.checkpoint !== undefined && !checkpoint.ok) {
      return failed(checkpoint.code === 'unsupported' ? 'unsupported' : 'unavailable', {
        transactionId: transactionId.value,
        operation: 'prepare',
        reason: 'declared checkpoint could not be bound',
      })
    }

    const approvals = []
    if (input.approval !== undefined) {
      const confirmed = await approvalAdapter.confirm(input.approval)
      if (!confirmed.ok || confirmed.code === 'denied') {
        return failed(confirmed.code === 'denied' ? 'unavailable' : 'unsupported', {
          transactionId: transactionId.value,
          operation: 'prepare',
          reason: 'declared approval could not be confirmed',
        })
      }
      approvals.push({ approvalId: confirmed.approval.approvalId, ...confirmed.approval, evidence: confirmed.evidence })
    }

    const record = {
      transactionId: transactionId.value,
      workspace: workspace.value,
      ownerId: ownerId.value,
      generation: lease.value.generation,
      lease: { ...lease.value, resource: leaseResource },
      intent: intent.value,
      state: 'prepared',
      revision: 0,
      resources: resources.value,
      mutations: [],
      approvals,
      authority: authority.ok ? { authority: authority.authority, compatible: true } : undefined,
      checkpoint: input.checkpoint !== undefined && checkpoint.ok ? checkpoint.checkpoint : undefined,
      capabilities: {
        checkpoint: checkpointCapability,
        fileClaim: fileClaimCapability,
        git: gitAdapter.capability(),
        ledger: ledgerAdapter.capability(),
        approval: approvalAdapter.capability(),
        sessionBranch: sessionBranchAdapter.capability(),
      },
      provenance: [
        ...provenance.value,
        ...recoveryEvidence('recovery', 'available'),
        { kind: 'lease', id: lease.value.generation, certainty: 'observed' },
      ],
      availability: setEpoch(),
      updatedAt: observedAt(),
    }

    const written = await registry.writeCas(transactionId.value, 0, record)
    if (!written.ok) {
      return failed(written.code === 'compare-conflict' ? 'conflict' : 'unavailable', {
        transactionId: transactionId.value,
        operation: 'prepare',
        reason: written.code === 'compare-conflict' ? 'revision conflict' : 'registry write failed',
      })
    }
    const event = {
      transactionId: transactionId.value,
      previousState: undefined,
      nextState: 'prepared',
      reason: 'prepared',
      revision: written.record.revision,
      epoch: `epoch:${epochSeq}`,
      leaseGeneration: lease.value.generation,
      evidence: cloneBoundedPublic(record.provenance) ?? [],
      observedAt: observedAt(),
    }
    try {
      registry.prependEvent?.(transactionId.value, event)
    } catch {
      // late-event provenance retention is best effort
    }
    ++epochSeq
    notify(transactionId.value, event)
    return succeeded('prepared', {
      transactionId: transactionId.value,
      transaction: redactTransactionRecord(written.record, { audience: 'ui' }),
    })
  }

  async function record(transactionId, input = {}) {
    if (disposed) return inactive('record')
    const normalizedId = normalizeTransactionId(transactionId)
    if (!normalizedId.ok) return invalid(normalizedId.reason, { operation: 'record' })
    const mutation = normalizeMutationRecord(input)
    if (!mutation.ok) return invalid(mutation.reason, { transactionId: normalizedId.value, operation: 'record' })

    const found = await registry.read(normalizedId.value)
    if (!found.ok) {
      return failed('unavailable', {
        transactionId: normalizedId.value,
        operation: 'record',
        reason: 'transaction is not found',
      })
    }
    const recordValue = found.record
    if (recordValue.state !== 'prepared') {
      return failed('conflict', {
        transactionId: normalizedId.value,
        operation: 'record',
        reason: `transaction is in state ${recordValue.state}; mutations require an active prepared transaction`,
        observed: { state: recordValue.state, revision: recordValue.revision },
      })
    }

    const inScope = recordValue.resources.some(
      (resource) => resourceKey(resource) === resourceKey(mutation.value.resource),
    ) && mutation.value.resource.scope === read(recordValue.workspace, 'scope')
    if (!inScope) {
      return failed('conflict', {
        transactionId: normalizedId.value,
        operation: 'record',
        reason: 'resource is outside the declared resource set or workspace scope',
      })
    }

    const fencing = await validateFencing(recordValue)
    if (!fencing.ok) {
      return failed(fencing.code, {
        transactionId: normalizedId.value,
        operation: 'record',
        reason: fencing.reason,
        observed: fencing.observed,
      })
    }

    const identity = `${resourceKey(mutation.value.resource)}:${mutation.value.operation}`
    const existing = recordValue.mutations.find((item) => item.identity === identity)
    if (existing) {
      const equivalent = existing.operation === mutation.value.operation
        && JSON.stringify(existing.before) === JSON.stringify(mutation.value.before)
        && JSON.stringify(existing.after) === JSON.stringify(mutation.value.after)
        && existing.sideEffectClass === mutation.value.sideEffectClass
        && existing.capability.name === mutation.value.capability.name
      if (equivalent) {
        return succeeded('recorded', {
          transactionId: normalizedId.value,
          operation: 'record',
          mutation: redactMutationForResult(existing),
          idempotent: true,
        })
      }
      return failed('conflict', {
        transactionId: normalizedId.value,
        operation: 'record',
        reason: 'repeated operation identity conflicts with the existing record',
        observed: { order: existing.order },
      })
    }

    const entry = {
      ...mutation.value,
      mutationId: nextId(),
      identity,
      order: recordValue.mutations.length,
      observedAt: observedAt(),
      capability: mutation.value.capability,
    }
    const next = { ...recordValue, mutations: [...recordValue.mutations, entry], updatedAt: observedAt() }
    const written = await registry.writeCas(normalizedId.value, recordValue.revision, next)
    if (!written.ok) {
      return failed(written.code === 'compare-conflict' ? 'conflict' : 'unavailable', {
        transactionId: normalizedId.value,
        operation: 'record',
        reason: written.code === 'compare-conflict' ? 'revision conflict' : 'registry write failed',
      })
    }
    return succeeded('recorded', {
      transactionId: normalizedId.value,
      operation: 'record',
      mutation: redactMutationForResult(entry),
      idempotent: false,
    })
  }

  function redactMutationForResult(entry) {
    const sideEffectClass = boundedString(read(entry, 'sideEffectClass'), 40)
    return deepFreeze({
      mutationId: boundedString(read(entry, 'mutationId'), 120) ?? 'unknown',
      resource: entry.resource,
      operation: boundedString(read(entry, 'operation'), 60) ?? 'unknown',
      sideEffectClass: sideEffectClass && ['none', 'read-only', 'rollbackable', 'external', 'unknown'].includes(sideEffectClass)
        ? sideEffectClass
        : 'unknown',
      idempotent: read(entry, 'idempotent') === true,
      order: Number.isInteger(read(entry, 'order')) ? read(entry, 'order') : 0,
      observedAt: boundedString(read(entry, 'observedAt'), 160) ?? 'unknown',
    })
  }

  async function preview(transactionId, options = {}) {
    if (disposed) return inactive('preview')
    const normalizedId = normalizeTransactionId(transactionId)
    if (!normalizedId.ok) return invalid(normalizedId.reason, { operation: 'preview' })
    const audience = normalizeAudience(options.audience)
    const found = await readRecord(normalizedId.value, audience)
    if (!found.ok) {
      return failed(found.code, { transactionId: normalizedId.value, operation: 'preview', reason: found.reason })
    }
    const recordValue = found.record
    const previewable = ['prepared', 'recovering'].includes(recordValue.state)

    // Precondition/stale detection: when the current workspace authority no
    // longer matches the recorded precondition, report stale/conflict
    // evidence and never silently refresh the transaction into a different change.
    const authority = workspaceAdapter.capabilities(read(recordValue.workspace, 'scope'))
    const stale = authority.ok === false && authority.code === 'incompatible'
      ? { code: 'conflict', authority: authority.authority, evidence: authority.evidence }
      : undefined

    const external = recordValue.mutations.filter((item) => ['external', 'unknown'].includes(item.sideEffectClass))
    const rollbackable = recordValue.mutations.filter((item) => item.sideEffectClass === 'rollbackable')
    const requiredApprovals = external.map((item) => ({
      resource: item.resource,
      operation: item.operation,
      sideEffectClass: item.sideEffectClass,
    }))

    const projection = {
      transactionId: normalizedId.value,
      workspace: recordValue.workspace,
      ownerId: recordValue.ownerId,
      state: recordValue.state,
      revision: recordValue.revision,
      previewable,
      resourceChanges: recordValue.mutations.map((item) => ({
        resource: item.resource,
        operation: item.operation,
        before: item.before,
        after: item.after,
        source: item.source,
        sideEffectClass: item.sideEffectClass,
        capability: item.capability,
        idempotent: item.idempotent,
        order: item.order,
        observedAt: item.observedAt,
      })),
      requiredApprovals,
      rollbackBoundary: {
        covered: rollbackable.length,
        external: external.length,
        // Effects classified external/unknown are explicitly not covered by
        // automatic rollback (explicit limitation labeling).
        notCoveredByAutomaticRollback: external.map((item) => ({ resource: item.resource, operation: item.operation })),
      },
      capabilityEvidence: recordValue.capabilities,
      approvals: recordValue.approvals,
      provenance: recordValue.provenance,
      availability: setEpoch(),
    }
    if (stale) projection.stale = stale
    if (options.includeExternal !== true && projection.rollbackBoundary.external > 0) {
      projection.externalEffectsWarning = 'external or unknown effects are not covered by automatic rollback'
    }
    return succeeded('preview', {
      transactionId: normalizedId.value,
      operation: 'preview',
      projection: deepFreeze(projection),
    })
  }

  async function commit(transactionId, options = {}) {
    if (disposed) return inactive('commit')
    const normalizedId = normalizeTransactionId(transactionId)
    if (!normalizedId.ok) return invalid(normalizedId.reason, { operation: 'commit' })
    const audience = normalizeAudience(options.audience)
    const found = await readRecord(normalizedId.value, audience)
    if (!found.ok) {
      return failed(found.code, { transactionId: normalizedId.value, operation: 'commit', reason: found.reason })
    }
    const recordValue = found.record

    // Terminal retry with equivalent terminal evidence returns the existing
    // terminal result without duplicating effects (terminal retry idempotency).
    if (recordValue.state === 'committed') {
      return succeeded('committed', {
        transactionId: normalizedId.value,
        operation: 'commit',
        transaction: redactTransactionRecord(recordValue, { audience: 'ui' }),
        leaseGeneration: read(recordValue.lease, 'generation'),
        idempotent: true,
      })
    }
    if (recordValue.state !== 'prepared') {
      return failed('conflict', {
        transactionId: normalizedId.value,
        operation: 'commit',
        reason: `cannot commit a transaction in state ${recordValue.state}`,
        observed: { state: recordValue.state, revision: recordValue.revision },
      })
    }

    // A caller-declared expectedRevision precondition must match the current
    // record revision; a mismatch leaves the transaction non-committed and
    // identifies the failed boundary (declared-revision precondition).
    const expectedRevision = read(options, 'expectedRevision')
    if (Number.isInteger(expectedRevision) && expectedRevision !== recordValue.revision) {
      return failed('conflict', {
        transactionId: normalizedId.value,
        operation: 'commit',
        reason: `precondition failed: expected revision ${expectedRevision} but the transaction is at revision ${recordValue.revision}`,
        observed: { revision: recordValue.revision, expectedRevision },
      })
    }

    const fencing = await validateFencing(recordValue)
    if (!fencing.ok) {
      return failed(fencing.code, {
        transactionId: normalizedId.value,
        operation: 'commit',
        reason: fencing.reason,
        observed: fencing.observed,
      })
    }

    // External side effects require the declared approval/confirmation
    // recorded in `approvals` (external-effect approval gate).
    const externalMutations = recordValue.mutations.filter((item) => ['external', 'unknown'].includes(item.sideEffectClass))
    let approvals = recordValue.approvals
    if (externalMutations.length > 0) {
      const hasApproval = approvals.length > 0
      if (!hasApproval && options.confirmation !== undefined) {
        const confirmed = await approvalAdapter.confirm(options.confirmation)
        if (confirmed.ok && confirmed.code === 'confirmed') {
          approvals = [...approvals, { approvalId: confirmed.approval.approvalId, ...confirmed.approval }]
        }
      }
      if (approvals.length === 0) {
        return failed('conflict', {
          transactionId: normalizedId.value,
          operation: 'commit',
          reason: 'external side effects require declared approval/confirmation',
        })
      }
    }

    // Preconditions: workspace authority still compatible and all declared
    // capability evidence still available (precondition validation).
    const authority = workspaceAdapter.capabilities(read(recordValue.workspace, 'scope'))
    if (authority.ok === false && authority.code === 'incompatible') {
      return failed('conflict', {
        transactionId: normalizedId.value,
        operation: 'commit',
        reason: `workspace authority became incompatible (${authority.authority})`,
        observed: authority.evidence,
      })
    }

    // Carry the confirmed approvals into the transition record so the
    // authoritative record and its projection reflect the approval evidence.
    const approvalsRecord = approvals.length !== recordValue.approvals.length
      ? { ...recordValue, approvals, updatedAt: observedAt() }
      : recordValue

    const committing = await publishTransition(approvalsRecord, 'committing', 'commit started')
    if (!committing.ok) {
      return failed(committing.code, {
        transactionId: normalizedId.value,
        operation: 'commit',
        reason: committing.reason,
      })
    }

    // Apply adapter-confirmed effects; a partial adapter success leaves the
    // transaction failed or recovering, never committed (partial-adapter truthfulness).
    const ledgerCapability = ledgerAdapter.capability()
    if (ledgerCapability.status === 'available') {
      const appended = await ledgerAdapter.append({
        transactionId: normalizedId.value,
        mutations: recordValue.mutations,
        timestamp: observedAt(),
      })
      if (!appended.ok) {
        await publishTransition(committing.record, 'failed', `ledger append failed (${appended.code})`)
        return failed('unavailable', {
          transactionId: normalizedId.value,
          operation: 'commit',
          reason: `change ledger append failed (${appended.code})`,
          recoveryClassification: classifyFailure(new Error(appended.code)),
        })
      }
    }

    const committed = await publishTransition(committing.record, 'committed', 'committed')
    if (!committed.ok) {
      await publishTransition(committing.record, 'failed', `commit publication failed (${committed.code})`)
      return failed(committed.code, {
        transactionId: normalizedId.value,
        operation: 'commit',
        reason: committed.reason,
      })
    }

    return succeeded('committed', {
      transactionId: normalizedId.value,
      operation: 'commit',
      transaction: redactTransactionRecord(committed.record, { audience: 'ui' }),
      mutationSummary: {
        total: committed.record.mutations.length,
        external: committed.record.mutations.filter((item) => ['external', 'unknown'].includes(item.sideEffectClass)).length,
        notCoveredByAutomaticRollback: externalMutations.length > 0,
      },
      provenance: cloneBoundedPublic(committed.record.provenance) ?? [],
      leaseGeneration: read(committed.record.lease, 'generation'),
    })
  }

  async function rollback(transactionId, options = {}) {
    if (disposed) return inactive('rollback')
    const normalizedId = normalizeTransactionId(transactionId)
    if (!normalizedId.ok) return invalid(normalizedId.reason, { operation: 'rollback' })
    const audience = normalizeAudience(options.audience)
    const found = await readRecord(normalizedId.value, audience)
    if (!found.ok) {
      return failed(found.code, { transactionId: normalizedId.value, operation: 'rollback', reason: found.reason })
    }
    const recordValue = found.record

    if (recordValue.state === 'rolled-back') {
      return succeeded('rolled-back', {
        transactionId: normalizedId.value,
        operation: 'rollback',
        transaction: redactTransactionRecord(recordValue, { audience: 'ui' }),
        idempotent: true,
      })
    }
    if (recordValue.state === 'committed') {
      return failed('conflict', {
        transactionId: normalizedId.value,
        operation: 'rollback',
        reason: 'a committed transaction cannot be rolled back',
      })
    }

    // Stale owner or fencing token is rejected unless an explicit, fenced
    // takeover recovery path is requested (stale-owner rejection).
    let fencing = await validateFencing(recordValue)
    let takeoverEvidence = undefined
    if (!fencing.ok && options.takeover !== undefined) {
      const takeover = normalizeFencingEvidence(options.takeover)
      if (takeover.ok) {
        const verified = await validateFencing({ lease: { ...takeover.value, resource: read(recordValue.lease, 'resource') } })
        if (verified.ok) {
          fencing = verified
          takeoverEvidence = takeover.value
        }
      }
    }
    if (!fencing.ok) {
      return failed(fencing.code, {
        transactionId: normalizedId.value,
        operation: 'rollback',
        reason: fencing.reason,
        observed: fencing.observed,
      })
    }

    if (recordValue.state === 'committing') {
      // An interrupted commit can continue through recovery only; rollback of
      // a committing transaction goes to recovering with durable evidence.
      const recovering = await publishTransition(recordValue, 'recovering', 'interrupted commit discovered; continuing via recovery')
      if (!recovering.ok) {
        return failed(recovering.code, {
          transactionId: normalizedId.value,
          operation: 'rollback',
          reason: recovering.reason,
        })
      }
      return succeeded('recovering', {
        transactionId: normalizedId.value,
        operation: 'rollback',
        transaction: redactTransactionRecord(recovering.record, { audience: 'ui' }),
        message: 'commit was interrupted; recovery path is active',
      })
    }

    const rollingBack = await publishTransition(recordValue, 'rolling-back', takeoverEvidence ? 'fenced takeover rollback' : 'rollback started')
    if (!rollingBack.ok) {
      return failed(rollingBack.code, {
        transactionId: normalizedId.value,
        operation: 'rollback',
        reason: rollingBack.reason,
      })
    }

    // Restore only adapter-confirmed rollbackable resources;
    // external/unknown classification is preserved and never claimed undone
    // external/unknown classification is preserved and never claimed undone.
    const unrestored = []
    const rollbackableMutations = rollingBack.record.mutations.filter((item) => item.sideEffectClass === 'rollbackable')
    for (const mutation of rollbackableMutations) {
      const capabilityOwner = read(mutation.capability, 'owner')
      let restored = false
      if (capabilityOwner === 'git' && gitAdapter.capability().status === 'available') {
        const result = await gitAdapter.restore(mutation.resource.key)
        restored = result.ok
      } else if (capabilityOwner === 'checkpoint' && checkpointAdapter.capability().status === 'available') {
        const ref = read(rollingBack.record.checkpoint, 'id')
        const result = ref ? await checkpointAdapter.restore(ref, mutation.resource) : { ok: false }
        restored = result.ok
      } else if (capabilityOwner === 'fileClaim' && fileClaimAdapter.capability().status === 'available') {
        const result = await claimLaneFor(resourceKey(mutation.resource))
          .run(() => fileClaimAdapter.release(mutation.resource, read(rollingBack.record.lease, 'generation')))
        restored = result.ok
      } else if (capabilityOwner === 'sessionBranch' && sessionBranchAdapter.capability().status === 'available') {
        const result = await sessionBranchAdapter.restore(mutation.resource.key)
        restored = result.ok
      }
      if (!restored) unrestored.push({ resource: mutation.resource, operation: mutation.operation })
    }

    if (unrestored.length > 0) {
      // A partial restore leaves the transaction failed or recovering, never
      // rolled-back. The memory registry cannot continue a rollback after
      // process loss, so it fails; the durable bridge can continue.
      const durableContinue = caps.durability === 'durable'
      const nextState = durableContinue ? 'recovering' : 'failed'
      const outcome = await publishTransition(rollingBack.record, nextState, durableContinue
        ? 'durable evidence allows continuing the rollback'
        : 'unrestored resources without a recovery path')
      return failed('unavailable', {
        transactionId: normalizedId.value,
        operation: 'rollback',
        reason: `unrestored resources: ${unrestored.map((item) => `${item.resource.kind}:${item.resource.key}`).join(', ')}`,
        observed: { state: outcome.ok ? outcome.record.state : rollingBack.record.state, unrestored },
        recoveryClassification: classifyFailure(new Error('partial rollback')),
      })
    }

    const rolledBack = await publishTransition(rollingBack.record, 'rolled-back', 'all confirmed rollbackable resources restored')
    if (!rolledBack.ok) {
      await publishTransition(rollingBack.record, 'failed', `rollback publication failed (${rolledBack.code})`)
      return failed(rolledBack.code, {
        transactionId: normalizedId.value,
        operation: 'rollback',
        reason: rolledBack.reason,
      })
    }
    return succeeded('rolled-back', {
      transactionId: normalizedId.value,
      operation: 'rollback',
      transaction: redactTransactionRecord(rolledBack.record, { audience: 'ui' }),
      restored: rollbackableMutations.map((item) => ({ resource: item.resource, operation: item.operation })),
      externalPreserved: rollingBack.record.mutations
        .filter((item) => ['external', 'unknown'].includes(item.sideEffectClass))
        .map((item) => ({ resource: item.resource, operation: item.operation, sideEffectClass: item.sideEffectClass })),
      leaseGeneration: read(rollingBack.record.lease, 'generation'),
    })
  }

  async function recover(transactionId, options = {}) {
    if (disposed) return inactive('recover')
    const normalizedId = normalizeTransactionId(transactionId)
    if (!normalizedId.ok) return invalid(normalizedId.reason, { operation: 'recover' })
    const audience = normalizeAudience(options.audience)
    const found = await readRecord(normalizedId.value, audience)
    if (!found.ok) {
      return failed(found.code, { transactionId: normalizedId.value, operation: 'recover', reason: found.reason })
    }
    const recordValue = found.record

    // Reconstruct only from durable evidence; a memory-scoped registry cannot
    // prove recovery after process loss (durable-evidence boundary).
    if (caps.durability !== 'durable') {
      return failed('unsupported', {
        transactionId: normalizedId.value,
        operation: 'recover',
        reason: 'the registry is memory-scoped and non-durable; recovery requires durable evidence',
      })
    }

    if (recordValue.state === 'unknown') {
      // The single encoded exception: `unknown` may be reclassified only by a
      // new explicit recover() with sufficient durable evidence. Durable
      // registry presence with a known continuation state is that evidence.
      const continuation = await publishTransition(recordValue, 'recovering', 'durable evidence reclassified unknown state')
      if (!continuation.ok) {
        return failed('unavailable', {
          transactionId: normalizedId.value,
          operation: 'recover',
          reason: 'durable evidence is insufficient to reclassify the unknown state',
        })
      }
      return recover(normalizedId.value, { ...options })
    }

    if (!['committing', 'rolling-back', 'recovering'].includes(recordValue.state)) {
      return succeeded('recovered', {
        transactionId: normalizedId.value,
        operation: 'recover',
        transaction: redactTransactionRecord(recordValue, { audience: 'ui' }),
        found: { state: recordValue.state, revision: recordValue.revision },
        settled: recordValue.mutations.map((item) => ({ resource: item.resource, operation: item.operation })),
        unavailableActions: [],
      })
    }

    // Continue settlement from durable evidence: query the change ledger when
    // available to decide whether the interrupted commit/rollback was
    // confirmed by the authority.
    let settled = false
    if (recordValue.state === 'committing' && ledgerAdapter.capability().status === 'available') {
      const queried = await ledgerAdapter.query(normalizedId.value)
      settled = queried.ok && queried.entries.length > 0
    }
    if (settled) {
      const committed = await publishTransition(recordValue, 'committed', 'durable ledger evidence confirms the commit')
      if (!committed.ok) {
        return failed('unavailable', {
          transactionId: normalizedId.value,
          operation: 'recover',
          reason: 'durable evidence could not be consolidated',
        })
      }
      return succeeded('recovered', {
        transactionId: normalizedId.value,
        operation: 'recover',
        transaction: redactTransactionRecord(committed.record, { audience: 'ui' }),
        found: { state: 'committing', settledResources: committed.record.mutations.length },
        settled: committed.record.mutations.map((item) => ({ resource: item.resource, operation: item.operation })),
        unavailableActions: [],
        leaseGeneration: read(committed.record.lease, 'generation'),
      })
    }

    // Without sufficient durable evidence the observation state becomes
    // `unknown` through the design's continuation edges (`committing/
    // rolling-back -> recovering -> unknown`); the result reports what was
    // found and which actions remain unavailable.
    let evidenceRecord = recordValue
    if (recordValue.state === 'committing' || recordValue.state === 'rolling-back') {
      const continued = await publishTransition(recordValue, 'recovering', 'continuing interrupted settlement through recovery')
      if (!continued.ok) {
        return failed('unavailable', {
          transactionId: normalizedId.value,
          operation: 'recover',
          reason: 'durable evidence is insufficient to continue the interrupted transaction',
        })
      }
      evidenceRecord = continued.record
    }
    const unknown = await publishTransition(evidenceRecord, 'unknown', 'insufficient durable evidence; reporting unknown observation state')
    if (!unknown.ok) {
      return failed('unavailable', {
        transactionId: normalizedId.value,
        operation: 'recover',
        reason: 'durable evidence is insufficient to settle the interrupted transaction',
      })
    }
    return failed('unavailable', {
      transactionId: normalizedId.value,
      operation: 'recover',
      reason: 'durable evidence is insufficient to settle the interrupted transaction',
      observed: { state: 'unknown' },
    })
  }

  async function get(transactionId, options = {}) {
    if (disposed) return inactive('get')
    const normalizedId = normalizeTransactionId(transactionId)
    if (!normalizedId.ok) return invalid(normalizedId.reason, { operation: 'get' })
    const audience = normalizeAudience(options.audience)
    const found = await readRecord(normalizedId.value, audience)
    if (!found.ok) {
      return succeeded('found', {
        transactionId: normalizedId.value,
        operation: 'get',
        found: false,
        transaction: deepFreeze({
          transactionId: normalizedId.value,
          state: 'unknown',
          availability: setEpoch('no record'),
        }),
      })
    }
    return succeeded('found', {
      transactionId: normalizedId.value,
      operation: 'get',
      found: true,
      transaction: redactTransactionRecord(found.record, { audience: audience.role ?? 'ui' }),
    })
  }

  async function observe(transactionId, options = {}) {
    if (disposed) return inactive('observe')
    const normalizedId = normalizeTransactionId(transactionId)
    if (!normalizedId.ok) return invalid(normalizedId.reason, { operation: 'observe' })
    const audience = normalizeAudience(options.audience)

    let initialRecord = null
    const found = await readRecord(normalizedId.value, audience)
    if (found.ok) initialRecord = found.record

    const subscription = {
      epoch: `epoch:${++epochSeq}`,
      disposed: false,
      listeners: new Set(),
      signal: options.signal,
      abortHandler: null,
      transactionId: normalizedId.value,
    }

    subscription.current = async () => {
      if (subscription.disposed) {
        return deepFreeze({ code: 'inactive', transactionId: normalizedId.value, epoch: subscription.epoch, observedAt: observedAt(), availability: setEpoch() })
      }
      const currentFound = await readRecord(normalizedId.value, audience)
      if (!currentFound.ok) {
        return deepFreeze({
          code: 'unavailable',
          transactionId: normalizedId.value,
          epoch: subscription.epoch,
          observedAt: observedAt(),
          availability: setEpoch('no record'),
          resync: true,
        })
      }
      return deepFreeze({
        transaction: redactTransactionRecord(currentFound.record, { audience: audience.role ?? 'ui' }),
        transactionId: normalizedId.value,
        epoch: subscription.epoch,
        observedAt: observedAt(),
        availability: setEpoch(),
      })
    }

    subscription.subscribe = (fn) => {
      if (subscription.disposed) throw new TypeError('observe subscription is disposed')
      if (typeof fn !== 'function') throw new TypeError('observe listener must be a function')
      subscription.listeners.add(fn)
      let active = true
      const detach = () => {
        if (!active) return false
        active = false
        return subscription.listeners.delete(fn)
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
      deliver(deepFreeze({ ...event, epoch: subscription.epoch }))
    }

    const attach = () => {
      let listeners = observers.get(normalizedId.value)
      if (!listeners) {
        listeners = new Set()
        observers.set(normalizedId.value, listeners)
      }
      listeners.add(onEvent)
      return () => {
        if (subscription.disposed) return false
        subscription.disposed = true
        listeners.delete(onEvent)
        if (listeners.size === 0) observers.delete(normalizedId.value)
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
    }

    subscription.dispose = attach()

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
      transactionId: normalizedId.value,
      initialState: initialRecord
        ? redactTransactionRecord(initialRecord, { audience: audience.role ?? 'ui' })
        : deepFreeze({ transactionId: normalizedId.value, state: 'unknown', availability: setEpoch('no record') }),
    })
  }

  const api = Object.freeze({
    prepare,
    record,
    preview,
    commit,
    rollback,
    recover,
    get,
    observe,
  })

  const dispose = () => {
    if (disposed) return false
    disposed = true
    try {
      registry.dispose()
    } catch {
      // disposal must never escape the fail-safe path
    }
    claimLanes.clear()
    observers.clear()
    return true
  }

  return { api, dispose, availability: mountAvailability }
}