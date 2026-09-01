/**
 * Host owner for the task execution observation facade (`pluginApi.tasks`).
 *
 * The facade preserves a business task identity while linking each run and
 * attempt to the actual workflow, agent, execution, session, job, and
 * workspace transaction evidence. It is an aggregation facade: it consumes
 * the public `pluginApi.executions`, `pluginApi.executions.recovery`,
 * `pluginApi.coordination`, `pluginApi.diagnostics`, and
 * `pluginApi.workspaces.transactions` surfaces plus public jobs/workflows/
 * subagents/session seams, and it never becomes a worker scheduler,
 * workflow engine, provider executor, retry loop, route selector, transcript
 * store, lease implementation, or client transport. Expected conflicts,
 * stale fencing, unavailable sources, unsupported guarantees, and disposed
 * surfaces are discriminated typed result values with a stable `code`; they
 * are never thrown through a plugin callback, and apply-time failures only
 * disable this feature with a bounded diagnostic.
 *
 * The registry is a storage-domain bridge only when the host explicitly
 * reports a usable durable scope and conditional write primitive; otherwise a
 * memory-scoped, non-durable registry is used and labeled as such, and
 * reconnect-after-process-loss reconstruction can never be claimed from it.
 */
import { deepFreeze } from './deep-freeze.js'
import {
  buildAvailability,
  canTransition,
  cloneBoundedPublic,
  normalizeIntent,
  normalizeLeaseHandle,
  normalizeOwnerId,
  normalizeProvenance,
  normalizeRunLinks,
  normalizeScope,
  normalizeTaskId,
  redactTaskRecord,
  TASK_OPERATIONS,
  TASK_OUTCOMES,
  TASK_SCOPES,
  TASK_TERMINAL,
} from './task-execution-normalize.js'
import { classifyFailure as classifyRecoveryFailure } from './recovery-classifier.js'
import {
  buildSourceAvailability,
  createCoordinationSourceAdapter,
  createDiagnosticsSourceAdapter,
  createExecutionSourceAdapter,
  createJobsSourceAdapter,
  createMemoryTaskRegistry,
  createRecoverySourceAdapter,
  createSessionSourceAdapter,
  createStorageDomainTaskRegistry,
  createSubagentSourceAdapter,
  createUuidFactory,
  createWorkflowSourceAdapter,
  createWorkspaceTransactionsSourceAdapter,
} from './task-execution-adapters.js'

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

function isThenable(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    && typeof value.then === 'function'
}

function boundedString(value, max = 160) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const text = String(value).trim()
  return text ? text.slice(0, max) : undefined
}

function resolveOptionalServices(ctx) {
  const out = { storage: null, jobs: null, sessions: null }
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
function explicitTaskRegistryCapabilityReport(services) {
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

/**
 * @param {{ ctx?: object, execution?: object, recovery?: object, coordination?: object, diagnostics?: object, workspaceTransactions?: object, logger?: object, now?: () => Date|number|string, idFactory?: () => string }} [options]
 * @returns {{ api: object, dispose: () => boolean, availability: object }}
 */
export function createTaskExecutionObservation({
  ctx,
  execution,
  recovery,
  coordination,
  diagnostics,
  workspaceTransactions,
  logger,
  now,
  idFactory,
} = {}) {
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
  const registryReport = explicitTaskRegistryCapabilityReport(services)
  let registry = null
  if (registryReport) {
    try {
      registry = createStorageDomainTaskRegistry({
        unit: registryReport.unit,
        capabilityReport: registryReport.report,
        now,
      })
    } catch (error) {
      try {
        logger?.error?.(`dsh-plugin-api tasks: durable registry unavailable (${boundedString(error?.message ?? error, 160)})`)
      } catch {
        // diagnostics must never interrupt the fail-safe path
      }
    }
  }
  if (!registry) registry = createMemoryTaskRegistry({ now })

  const registryCaps = registry.capabilities()

  // Source adapters: each resolves its public surface and degrades per source.
  const sources = {
    execution: createExecutionSourceAdapter({ execution, logger, now }),
    recovery: createRecoverySourceAdapter({ recovery, logger, now }),
    coordination: createCoordinationSourceAdapter({ coordination, logger, now }),
    diagnostics: createDiagnosticsSourceAdapter({ diagnostics, logger, now }),
    workspaceTransactions: createWorkspaceTransactionsSourceAdapter({ workspaceTransactions, logger, now }),
    jobs: createJobsSourceAdapter({ ctx, logger, now }),
    workflow: createWorkflowSourceAdapter({ ctx, logger, now }),
    subagent: createSubagentSourceAdapter({ ctx, logger, now }),
    session: createSessionSourceAdapter({ ctx, session: read(services, 'sessions'), logger, now }),
  }

  const observers = new Map()
  let epochSeq = 0
  let disposed = false

  // Facade-owned recovery authority consumption (recovery/task path). The
  // shared private authority is the recovery owner's internal decide/commit
  // pair; a missing or malformed authority degrades to the official
  // settlement path and never silently approves or blocks.
  const resolveRecoveryAuthority = () => {
    if (isObject(recovery) && isObject(recovery._internal)
      && typeof recovery._internal.decide === 'function'
      && typeof recovery._internal.commit === 'function') {
      return recovery._internal
    }
    return null
  }

  const consultSettlementRecovery = async ({ taskId, attemptId, outcome, reason, revision }) => {
    const authority = resolveRecoveryAuthority()
    if (!authority) return null
    const generation = boundedString(String(revision), 120)
    try {
      if (isObject(recovery) && typeof recovery.capability?.register === 'function') {
        recovery.capability.register({
          operationId: 'task-settlement',
          ownerId: 'facade-task-owner',
          generation,
          scope: 'workspace',
          idempotent: false,
          retryable: true,
          allowNonIdempotentRetry: true,
          allowedActions: ['retry', 'fallback', 'abort', 'stop'],
          sideEffectClass: 'external',
          retryBudget: { maxAttempts: 2 },
        })
      }
    } catch {
      // capability declaration is best-effort; without it the authority
      // rejects retries with a typed bounds error (fail-safe stop)
    }
    let result
    try {
      result = await authority.decide({
        ownerId: 'facade-task-owner',
        generation,
        path: 'recovery/task',
        scope: 'workspace',
        decisionWindowId: boundedString(`task:${taskId}:${attemptId}`, 120),
        execution: {
          executionId: boundedString(`task:${taskId}`, 120),
          attemptId,
          active: true,
          cancellable: outcome === 'error',
        },
        capability: { operationId: 'task-settlement', ownerId: 'facade-task-owner', generation },
        failure: { code: outcome, message: boundedString(reason, 160) },
        attemptsRemaining: 1,
      })
    } catch {
      return null
    }
    if (!result?.ok || result.decision === null) return null
    const decision = result.decision
    let committed
    try {
      committed = await authority.commit(decision, {
        operation: {
          ownerId: 'facade-task-owner',
          generation,
          executionId: boundedString(`task:${taskId}`, 120),
          attemptId,
        },
      })
    } catch {
      committed = null
    }
    if (!committed?.ok) return null
    const evidence = {
      decisionId: decision.decisionId,
      action: decision.action,
      reason: decision.reason?.code ?? null,
      observedAt: decision.observedAt,
    }
    return { retry: decision.action === 'retry', evidence }
  }

  const mountEpoch = `epoch:${++epochSeq}`
  const sourceAvailability = buildSourceAvailability(sources)

  const operationAvailability = () => {
    const base = registryCaps.status ?? 'unknown'
    const operations = {}
    for (const op of TASK_OPERATIONS) {
      if (op === 'history' || op === 'observe') operations[op] = registryCaps.durability === 'durable' ? base : base
      else operations[op] = base
    }
    return operations
  }

  const availabilitySnapshot = (reason) => buildAvailability({
    status: registryCaps.status,
    scope: registryCaps.scope,
    durability: registryCaps.durability,
    operations: operationAvailability(),
    sources: sourceAvailability,
    backend: { id: registryCaps.backendId, ...(reason ? { reason } : {}) },
    epoch: mountEpoch,
  })

  const setEpoch = (reason) => buildAvailability({
    status: registryCaps.status,
    scope: registryCaps.scope,
    durability: registryCaps.durability,
    operations: operationAvailability(),
    sources: sourceAvailability,
    backend: { id: registryCaps.backendId, ...(reason ? { reason } : {}) },
    epoch: `epoch:${epochSeq}`,
  })

  const mountAvailability = availabilitySnapshot()

  const inactive = (operation) => deepFreeze({
    ok: false,
    code: 'inactive',
    operation,
    observedAt: observedAt(),
  })

  const invalid = (reasonValue, { taskId, operation } = {}) => deepFreeze({
    ok: false,
    code: 'invalid-input',
    reason: reasonValue,
    ...(taskId ? { taskId } : {}),
    operation,
    observedAt: observedAt(),
  })

  const failed = (code, { taskId, operation, reason, observed, attemptId, recovery } = {}) => deepFreeze({
    ok: false,
    code,
    ...(taskId ? { taskId } : {}),
    ...(attemptId ? { attemptId } : {}),
    operation,
    ...(reason ? { reason } : {}),
    ...(observed ? { observed } : {}),
    ...(recovery ? { recovery } : {}),
    observedAt: observedAt(),
  })

  const succeeded = (code, payload) => deepFreeze({
    ok: true,
    code,
    ...payload,
    observedAt: observedAt(),
  })

  const notify = (taskId, event) => {
    const listeners = observers.get(String(taskId))
    if (!listeners || listeners.size === 0) return
    const frozen = deepFreeze(event)
    for (const listener of [...listeners]) {
      try {
        const result = listener(frozen)
        if (result && typeof result.then === 'function') {
          Promise.resolve(result).catch(() => {})
        }
      } catch {
        // observer failures are contained per subscription
      }
    }
  }

  const readRecord = async (taskId, audience) => {
    const found = await registry.read(taskId)
    if (!found.ok) return { ok: false, code: 'unavailable', reason: 'task is not found' }
    if (scopeDenies(found.record, audience)) {
      return { ok: false, code: 'unavailable', reason: 'task is not found' }
    }
    return { ok: true, record: found.record }
  }

  const scopeDenies = (record, audience) => {
    const declared = read(audience, 'workspace')
    if (!declared) return false
    const scope = read(record, 'scope')
    return declared.kind !== read(scope, 'kind') || declared.key !== read(scope, 'key')
  }

  const normalizeAudience = (input) => {
    if (typeof input === 'string') return { role: input }
    if (!isObject(input)) return {}
    const role = boundedString(read(input, 'role'), 40)
    const workspace = read(input, 'workspace')
    const audience = {}
    if (role) audience.role = role
    if (isObject(workspace)) {
      const kind = boundedString(read(workspace, 'kind'), 40)
      const key = boundedString(read(workspace, 'key'), 120)
      if (kind && TASK_SCOPES.includes(kind) && key) audience.workspace = { kind, key }
    }
    return audience
  }

  const writeTransition = async (record, nextState, reason) => {
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
    const written = await registry.writeCas(record.taskId, record.revision, next)
    if (!written.ok) {
      return { ok: false, code: written.code, reason: written.code === 'compare-conflict' ? 'revision conflict' : 'registry write failed' }
    }
    const event = {
      taskId: record.taskId,
      previousState,
      nextState,
      reason: boundedString(reason, 120) ?? 'transition',
      revision: written.record.revision,
      epoch: `epoch:${epochSeq}`,
      activeAttemptId: read(written.record, 'activeAttemptId'),
      observedAt: observedAt(),
    }
    try {
      registry.prependEvent?.(record.taskId, event)
    } catch {
      // late-event provenance retention is best effort
    }
    ++epochSeq
    notify(record.taskId, event)
    return { ok: true, record: written.record, event }
  }

  const sameImmutableMetadata = (record, ownerId, scope, intent) => {
    const recordScope = read(record, 'scope')
    const recordIntent = read(record, 'intent')
    return record.ownerId === ownerId
      && read(recordScope, 'kind') === scope.kind
      && read(recordScope, 'key') === scope.key
      && read(recordIntent, 'kind') === intent.kind
      && read(recordIntent, 'summary') === intent.summary
  }

  async function register(input = {}) {
    if (disposed) return inactive('register')
    const taskId = normalizeTaskId(input.taskId)
    if (!taskId.ok) return invalid(taskId.reason, { operation: 'register' })
    const ownerId = normalizeOwnerId(input.ownerId)
    if (!ownerId.ok) return invalid(ownerId.reason, { taskId: taskId.value, operation: 'register' })
    const scope = normalizeScope(input.scope)
    if (!scope.ok) return invalid(scope.reason, { taskId: taskId.value, operation: 'register' })
    const intent = normalizeIntent(input.intent)
    if (!intent.ok) return invalid(intent.reason, { taskId: taskId.value, operation: 'register' })
    const provenance = normalizeProvenance(input.provenance)
    if (!provenance.ok) return invalid(provenance.reason, { taskId: taskId.value, operation: 'register' })

    const existing = await registry.read(taskId.value)
    if (existing.ok) {
      if (sameImmutableMetadata(existing.record, ownerId.value, scope.value, intent.value)) {
        return succeeded('registered', {
          taskId: taskId.value,
          operation: 'register',
          task: redactTaskRecord(existing.record, { audience: 'ui' }),
          idempotent: true,
        })
      }
      return failed('identity-conflict', {
        taskId: taskId.value,
        operation: 'register',
        reason: 'task identity is already in use with conflicting owner, scope, or immutable metadata',
        observed: { state: existing.record.state, revision: existing.record.revision },
      })
    }

    const record = {
      taskId: taskId.value,
      ownerId: ownerId.value,
      scope: scope.value,
      intent: intent.value,
      state: 'registered',
      revision: 0,
      attempts: [],
      provenance: [
        ...provenance.value,
        { kind: 'registration', id: taskId.value, certainty: 'observed' },
      ],
      updatedAt: observedAt(),
    }

    const written = await registry.writeCas(taskId.value, 0, record)
    if (!written.ok) {
      return failed(written.code === 'compare-conflict' ? 'identity-conflict' : 'unavailable', {
        taskId: taskId.value,
        operation: 'register',
        reason: written.code === 'compare-conflict' ? 'duplicate registration' : 'registry write failed',
      })
    }
    const event = {
      taskId: taskId.value,
      previousState: undefined,
      nextState: 'registered',
      reason: 'registered',
      revision: written.record.revision,
      epoch: `epoch:${epochSeq}`,
      observedAt: observedAt(),
    }
    try {
      registry.prependEvent?.(taskId.value, event)
    } catch {
      // late-event provenance retention is best effort
    }
    ++epochSeq
    notify(taskId.value, event)
    return succeeded('registered', {
      taskId: taskId.value,
      operation: 'register',
      task: redactTaskRecord(written.record, { audience: 'ui' }),
      idempotent: false,
    })
  }

  async function start(taskId, options = {}) {
    if (disposed) return inactive('start')
    const normalizedId = normalizeTaskId(taskId)
    if (!normalizedId.ok) return invalid(normalizedId.reason, { operation: 'start' })
    const audience = normalizeAudience(options.audience)
    const found = await readRecord(normalizedId.value, audience)
    if (!found.ok) {
      return failed(found.code, { taskId: normalizedId.value, operation: 'start', reason: found.reason })
    }
    const record = found.record
    if (record.state !== 'registered' && record.state !== 'active' && record.state !== 'reassigning') {
      return failed('conflict', {
        taskId: normalizedId.value,
        operation: 'start',
        reason: `cannot start a run on a task in state ${record.state}`,
        observed: { state: record.state, revision: record.revision },
      })
    }

    // Run/attempt lineage: distinct attempt and run identities under the
    // parent task; links preserved only when the source confirms them.
    const runId = options.runId ? boundedString(options.runId, 120) : nextId()
    const attemptId = nextId()
    const links = {}
    const linkSources = [
      ['workflow', options.workflowId, sources.workflow],
      ['agent', options.agentId, sources.subagent],
      ['execution', options.executionId, sources.execution],
      ['session', options.sessionId, sources.session],
      ['job', options.jobId, sources.jobs],
    ]
    for (const [name, id, source] of linkSources) {
      if (id === undefined || id === null) continue
      const confirmed = source.confirm(id)
      if (confirmed.ok && confirmed.link) links[name] = confirmed.link
    }

    const attempt = {
      attemptId,
      runId,
      ownerId: record.ownerId,
      generation: undefined,
      fencingToken: undefined,
      state: 'registered',
      links,
      startedAt: observedAt(),
      provenance: [
        { kind: 'run', id: runId, certainty: 'observed' },
        ...(options.provenance !== undefined
          ? normalizeProvenance(options.provenance).ok ? normalizeProvenance(options.provenance).value : []
          : []),
      ],
    }

    const next = {
      ...record,
      attempts: [...record.attempts, attempt],
      activeAttemptId: attemptId,
      updatedAt: observedAt(),
    }
    const written = await registry.writeCas(normalizedId.value, record.revision, next)
    if (!written.ok) {
      return failed(written.code === 'compare-conflict' ? 'conflict' : 'unavailable', {
        taskId: normalizedId.value,
        operation: 'start',
        reason: written.code === 'compare-conflict' ? 'revision conflict' : 'registry write failed',
      })
    }
    const event = {
      taskId: normalizedId.value,
      previousState: record.state,
      nextState: record.state,
      reason: 'run started with a new attempt link',
      revision: written.record.revision,
      epoch: `epoch:${epochSeq}`,
      activeAttemptId: attemptId,
      observedAt: observedAt(),
    }
    try {
      registry.prependEvent?.(normalizedId.value, event)
    } catch {
      // late-event provenance retention is best effort
    }
    ++epochSeq
    notify(normalizedId.value, event)
    return succeeded('started', {
      taskId: normalizedId.value,
      operation: 'start',
      runId,
      attemptId,
      links,
      provenance: attempt.provenance,
    })
  }

  /**
   * Validate a coordination lease handle against the live coordination
   * facade. The handle must be a valid coordination handle; when the facade
   * exposes watch/current, the generation and fencing validity are verified
   * against the live projection.
   */
  const validateLease = async (handle) => {
    const normalized = normalizeLeaseHandle(handle)
    if (!normalized.ok) return { ok: false, code: 'invalid-input', reason: normalized.reason }
    const source = sources.coordination
    if (source.availability().status !== 'available' || typeof coordination?.watch !== 'function') {
      return { ok: false, code: 'unsupported', reason: 'coordination facade is unavailable' }
    }
    let subscription
    try {
      subscription = await coordination.watch(normalized.value.resource)
    } catch {
      return { ok: false, code: 'unsupported', reason: 'coordination facade is unavailable' }
    }
    if (isThenable(subscription)) {
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
    if (current.generation !== normalized.value.generation) {
      return { ok: false, code: 'stale-fencing', reason: 'lease generation was superseded', observed: { generation: current.generation } }
    }
    return { ok: true, handle: normalized.value }
  }

  async function claim(taskId, options = {}) {
    if (disposed) return inactive('claim')
    const normalizedId = normalizeTaskId(taskId)
    if (!normalizedId.ok) return invalid(normalizedId.reason, { operation: 'claim' })
    const ownerId = normalizeOwnerId(options.ownerId)
    if (!ownerId.ok) return invalid(ownerId.reason, { taskId: normalizedId.value, operation: 'claim' })
    const audience = normalizeAudience(options.audience)
    const found = await readRecord(normalizedId.value, audience)
    if (!found.ok) {
      return failed(found.code, { taskId: normalizedId.value, operation: 'claim', reason: found.reason })
    }
    const record = found.record

    // A task with an active attempt owned by another valid generation is a
    // deterministic conflict; never silently replace the active attempt.
    const activeAttempt = record.attempts.find((attempt) => attempt.state === 'active')
    if (activeAttempt && activeAttempt.ownerId !== ownerId.value) {
      return failed('conflict', {
        taskId: normalizedId.value,
        operation: 'claim',
        reason: 'task has an active attempt owned by another generation',
        observed: { attemptId: activeAttempt.attemptId, state: record.state, revision: record.revision },
      })
    }
    if (activeAttempt) {
      const validated = await validateLease({
        ...options.lease,
        ownerId: ownerId.value,
        resource: { scope: read(record.scope, 'kind'), key: `${read(record.scope, 'key')}:task` },
      })
      if (!validated.ok) {
        return failed(validated.code, {
          taskId: normalizedId.value,
          operation: 'claim',
          reason: validated.reason,
          observed: validated.observed,
        })
      }
    }

    const lease = options.lease !== undefined
      ? await validateLease({
        ...options.lease,
        ownerId: ownerId.value,
        resource: { scope: read(record.scope, 'kind'), key: `${read(record.scope, 'key')}:task` },
      })
      : { ok: false, code: 'invalid-input', reason: 'claim requires a coordination lease handle' }
    if (!lease.ok) {
      return failed(lease.code === 'invalid-input' ? 'invalid-input' : lease.code, {
        taskId: normalizedId.value,
        operation: 'claim',
        reason: lease.reason,
        observed: lease.observed,
      })
    }

    const attempt = record.attempts.find((item) => item.attemptId === record.activeAttemptId && item.state === 'registered')
    if (!attempt) {
      return failed('conflict', {
        taskId: normalizedId.value,
        operation: 'claim',
        reason: 'no registered attempt is pending claim on this task',
        observed: { state: record.state, revision: record.revision },
      })
    }

    const nextAttempts = record.attempts.map((item) => {
      if (item.attemptId !== attempt.attemptId) return item
      return {
        ...item,
        ownerId: ownerId.value,
        generation: lease.handle.generation,
        fencingToken: lease.handle.fencingToken,
        state: 'active',
        links: { ...item.links, ...(lease.handle.resource ? { coordination: { id: lease.handle.resource.key, certainty: 'observed' } } : {}) },
        provenance: [...item.provenance, { kind: 'claim', id: lease.handle.generation, certainty: 'observed' }],
      }
    })

    const publish = async (stateRecord, nextState) => {
      const next = {
        ...stateRecord,
        state: nextState,
        attempts: nextAttempts,
        activeAttemptId: attempt.attemptId,
        updatedAt: observedAt(),
      }
      const written = await registry.writeCas(normalizedId.value, stateRecord.revision, next)
      if (!written.ok) {
        return { ok: false, code: written.code === 'compare-conflict' ? 'conflict' : 'unavailable' }
      }
      return { ok: true, record: written.record }
    }

    let claimed
    if (record.state === 'registered') {
      claimed = await publish(record, 'active')
    } else if (record.state === 'reassigning') {
      claimed = await publish(record, 'active')
    } else {
      return failed('conflict', {
        taskId: normalizedId.value,
        operation: 'claim',
        reason: `cannot claim a task in state ${record.state}`,
        observed: { state: record.state, revision: record.revision },
      })
    }
    if (!claimed.ok) {
      return failed(claimed.code, {
        taskId: normalizedId.value,
        operation: 'claim',
        reason: 'registry write failed',
      })
    }
    const event = {
      taskId: normalizedId.value,
      previousState: record.state,
      nextState: 'active',
      reason: boundedString(options.reason, 120) ?? 'attempt claimed',
      revision: claimed.record.revision,
      epoch: `epoch:${epochSeq}`,
      activeAttemptId: attempt.attemptId,
      observedAt: observedAt(),
    }
    try {
      registry.prependEvent?.(normalizedId.value, event)
    } catch {
      // late-event provenance retention is best effort
    }
    ++epochSeq
    notify(normalizedId.value, event)
    return succeeded('active', {
      taskId: normalizedId.value,
      operation: 'claim',
      attemptId: attempt.attemptId,
      generation: lease.handle.generation,
      reason: event.reason,
      task: redactTaskRecord(claimed.record, { audience: 'ui' }),
    })
  }

  async function reassign(taskId, options = {}) {
    if (disposed) return inactive('reassign')
    const normalizedId = normalizeTaskId(taskId)
    if (!normalizedId.ok) return invalid(normalizedId.reason, { operation: 'reassign' })
    const ownerId = normalizeOwnerId(options.ownerId)
    if (!ownerId.ok) return invalid(ownerId.reason, { taskId: normalizedId.value, operation: 'reassign' })
    const expectedGeneration = boundedString(options.expectedGeneration, 120)
    if (!expectedGeneration) {
      return invalid('reassign requires the expected generation of the prior attempt', { taskId: normalizedId.value, operation: 'reassign' })
    }
    const reason = boundedString(options.reason, 120)
    const audience = normalizeAudience(options.audience)
    const found = await readRecord(normalizedId.value, audience)
    if (!found.ok) {
      return failed(found.code, { taskId: normalizedId.value, operation: 'reassign', reason: found.reason })
    }
    const record = found.record
    if (record.state !== 'registered' && record.state !== 'active') {
      return failed('conflict', {
        taskId: normalizedId.value,
        operation: 'reassign',
        reason: `cannot reassign a task in state ${record.state}`,
        observed: { state: record.state, revision: record.revision },
      })
    }

    const resource = { scope: read(record.scope, 'kind'), key: `${read(record.scope, 'key')}:task` }
    const takeoverResult = await sources.coordination.takeover({
      resource,
      ownerId: ownerId.value,
      leaseMs: 60_000,
      expectedProof: { generation: expectedGeneration },
      reason: reason ?? 'task reassigned',
    })
    if (!takeoverResult.ok) {
      return failed(takeoverResult.code === 'conflict' ? 'conflict' : takeoverResult.code, {
        taskId: normalizedId.value,
        operation: 'reassign',
        reason: takeoverResult.reason ?? 'coordination takeover failed',
        observed: takeoverResult.observed,
      })
    }

    const runId = nextId()
    const attemptId = nextId()
    const attempts = record.attempts.map((item) => {
      if (item.state === 'active' && item.generation === expectedGeneration) {
        return { ...item, state: 'superseded' }
      }
      return item
    })
    const newAttempt = {
      attemptId,
      runId,
      ownerId: ownerId.value,
      generation: takeoverResult.handle.generation,
      fencingToken: takeoverResult.handle.fencingToken,
      state: 'active',
      links: {},
      startedAt: observedAt(),
      provenance: [
        { kind: 'reassign', id: expectedGeneration, certainty: 'observed' },
        { kind: 'reason', id: reason ?? 'reassigned', certainty: 'observed' },
      ],
    }

    const reassigning = { ...record, state: 'reassigning', updatedAt: observedAt() }
    const writtenReassigning = await registry.writeCas(normalizedId.value, record.revision, reassigning)
    if (!writtenReassigning.ok) {
      return failed(writtenReassigning.code === 'compare-conflict' ? 'conflict' : 'unavailable', {
        taskId: normalizedId.value,
        operation: 'reassign',
        reason: writtenReassigning.code === 'compare-conflict' ? 'revision conflict' : 'registry write failed',
      })
    }

    const next = {
      ...writtenReassigning.record,
      state: 'active',
      attempts: [...attempts, newAttempt],
      activeAttemptId: attemptId,
      updatedAt: observedAt(),
    }
    const written = await registry.writeCas(normalizedId.value, writtenReassigning.record.revision, next)
    if (!written.ok) {
      return failed(written.code === 'compare-conflict' ? 'conflict' : 'unavailable', {
        taskId: normalizedId.value,
        operation: 'reassign',
        reason: written.code === 'compare-conflict' ? 'revision conflict' : 'registry write failed',
      })
    }
    const event = {
      taskId: normalizedId.value,
      previousState: 'reassigning',
      nextState: 'active',
      reason: reason ?? 'task reassigned with a new attempt and generation',
      revision: written.record.revision,
      epoch: `epoch:${epochSeq}`,
      activeAttemptId: attemptId,
      observedAt: observedAt(),
    }
    try {
      registry.prependEvent?.(normalizedId.value, event)
    } catch {
      // late-event provenance retention is best effort
    }
    ++epochSeq
    notify(normalizedId.value, event)
    return succeeded('reassigned', {
      taskId: normalizedId.value,
      operation: 'reassign',
      attemptId,
      runId,
      generation: takeoverResult.handle.generation,
      task: redactTaskRecord(written.record, { audience: 'ui' }),
    })
  }

  async function settle(taskId, options = {}) {
    if (disposed) return inactive('settle')
    const normalizedId = normalizeTaskId(taskId)
    if (!normalizedId.ok) return invalid(normalizedId.reason, { operation: 'settle' })
    const attemptId = boundedString(options.attemptId, 120)
    if (!attemptId) return invalid('settle requires the attempt identity', { taskId: normalizedId.value, operation: 'settle' })
    const audience = normalizeAudience(options.audience)
    const found = await readRecord(normalizedId.value, audience)
    if (!found.ok) {
      return failed(found.code, { taskId: normalizedId.value, operation: 'settle', reason: found.reason })
    }
    const record = found.record

    // A terminal task cannot be rewritten by a duplicate or late callback;
    // the existing terminal record is returned and the late evidence is kept
    // only as bounded provenance (terminal-record preservation).
    if (TASK_TERMINAL.includes(record.state)) {
      const late = {
        attemptId,
        outcome: options.outcome,
        reason: options.reason,
        observedAt: observedAt(),
      }
      try {
        registry.prependEvent?.(normalizedId.value, deepFreeze({
          taskId: normalizedId.value,
          kind: 'late-settlement',
          late,
          revision: record.revision,
          observedAt: observedAt(),
        }))
      } catch {
        // late-event provenance retention is best effort
      }
      return succeeded(record.state, {
        taskId: normalizedId.value,
        operation: 'settle',
        task: redactTaskRecord(record, { audience: 'ui' }),
        idempotent: true,
        late: true,
      })
    }

    const attempt = record.attempts.find((item) => item.attemptId === attemptId)
    if (!attempt) {
      return failed('conflict', {
        taskId: normalizedId.value,
        operation: 'settle',
        attemptId,
        reason: 'no such attempt on this task',
        observed: { state: record.state, revision: record.revision },
      })
    }
    if (attempt.state === 'settled' || attempt.state === 'superseded') {
      // Duplicate settlement of the same attempt with equivalent evidence is
      // an idempotent no-op; a stale attempt can never settle a newer one.
      if (attempt.outcome === options.outcome) {
        return succeeded('settled', {
          taskId: normalizedId.value,
          operation: 'settle',
          task: redactTaskRecord(record, { audience: 'ui' }),
          idempotent: true,
        })
      }
      return failed('conflict', {
        taskId: normalizedId.value,
        operation: 'settle',
        attemptId,
        reason: `attempt is already ${attempt.state}; a stale attempt cannot settle the task`,
        observed: { attemptState: attempt.state, state: record.state, revision: record.revision },
      })
    }
    if (attempt.attemptId !== record.activeAttemptId) {
      return failed('conflict', {
        taskId: normalizedId.value,
        operation: 'settle',
        attemptId,
        reason: 'only the current fenced attempt may settle',
        observed: { activeAttemptId: record.activeAttemptId, state: record.state, revision: record.revision },
      })
    }
    if (attempt.state !== 'active') {
      return failed('conflict', {
        taskId: normalizedId.value,
        operation: 'settle',
        attemptId,
        reason: `attempt is in state ${attempt.state}; only an active attempt may settle`,
      })
    }

    const outcome = boundedString(options.outcome, 40)
    if (!outcome || !TASK_OUTCOMES.includes(outcome)) {
      return invalid('outcome must be one of success, error, aborted, denied, or superseded', {
        taskId: normalizedId.value,
        operation: 'settle',
      })
    }

    // Recovery safety classification consumed read-only; never
    // mark aborted/denied/superseded as retry-safe (outcome preservation).
    const safety = []
    if (isObject(recovery) && typeof recovery.evaluate === 'function') {
      try {
        const classified = classifyRecoveryFailure({
          kind: outcome,
          reason: options.reason,
        })
        if (classified?.class) {
          safety.push({ kind: 'recovery-classification', id: boundedString(classified.class, 40) ?? 'unknown', certainty: 'observed' })
        }
      } catch {
        // safety evidence must never interrupt the fail-safe path
      }
    }
    const nonRetrySafe = ['aborted', 'denied', 'superseded'].includes(outcome)
    if (nonRetrySafe && safety.length === 0) {
      safety.push({ kind: 'recovery-classification', id: boundedString(outcome, 40) ?? outcome, certainty: 'observed' })
    }

    // Facade-owned recovery consumption: a failed settlement consults the
    // shared private authority once per attempt window before the terminal
    // commit. A retry decision withholds the terminal commit (the attempt
    // stays active so the worker can retry); other actions commit the
    // terminal outcome with bounded decision provenance. No policy or an
    // unavailable authority keeps the official settlement path unchanged.
    let recoveryEvidence = []
    if (outcome !== 'success') {
      const gate = await consultSettlementRecovery({
        taskId: normalizedId.value,
        attemptId,
        outcome,
        reason: options.reason,
        revision: record.revision,
      })
      if (gate?.retry) {
        return failed('conflict', {
          taskId: normalizedId.value,
          operation: 'settle',
          attemptId,
          reason: 'recovery policy selected retry before terminal commit',
          observed: { state: record.state, revision: record.revision },
          recovery: gate.evidence,
        })
      }
      if (gate?.evidence) {
        recoveryEvidence = [{ kind: 'recovery-decision', id: gate.evidence.decisionId, certainty: 'observed' }]
      }
    }

    const settling = { ...record, state: 'settling', updatedAt: observedAt() }
    const writtenSettling = await registry.writeCas(normalizedId.value, record.revision, settling)
    if (!writtenSettling.ok) {
      return failed(writtenSettling.code === 'compare-conflict' ? 'conflict' : 'unavailable', {
        taskId: normalizedId.value,
        operation: 'settle',
        attemptId,
        reason: writtenSettling.code === 'compare-conflict' ? 'revision conflict' : 'registry write failed',
      })
    }

    // A caller-supplied bounded source reference (e.g. the workflow run or job
    // that produced the outcome) is preserved as settlement provenance;
    // malformed sources are dropped, never synthesized.
    let sourceProvenance = []
    if (isObject(options.source)) {
      const sourceId = boundedString(read(options.source, 'id'), 120)
      const sourceKind = boundedString(read(options.source, 'kind'), 60)
      if (sourceId && sourceKind) {
        sourceProvenance = [{ kind: sourceKind, id: sourceId, certainty: 'observed' }]
      }
    }

    const settledAttempts = writtenSettling.record.attempts.map((item) => {
      if (item.attemptId !== attemptId) return item
      return {
        ...item,
        state: 'settled',
        settledAt: observedAt(),
        outcome,
        reason: boundedString(options.reason, 160),
        provenance: [...item.provenance, ...safety, ...recoveryEvidence, ...sourceProvenance],
      }
    })

    const outcomeUncertain = outcome === 'error' && (options.evidence === undefined || !isObject(options.evidence))
    const terminalOutcome = outcomeUncertain ? undefined : outcome
    const finalState = outcomeUncertain ? 'unknown' : 'settled'
    const next = {
      ...writtenSettling.record,
      state: finalState,
      terminalOutcome,
      attempts: settledAttempts,
      updatedAt: observedAt(),
    }
    const written = await registry.writeCas(normalizedId.value, writtenSettling.record.revision, next)
    if (!written.ok) {
      return failed(written.code === 'compare-conflict' ? 'conflict' : 'unavailable', {
        taskId: normalizedId.value,
        operation: 'settle',
        attemptId,
        reason: written.code === 'compare-conflict' ? 'revision conflict' : 'registry write failed',
      })
    }
    const event = {
      taskId: normalizedId.value,
      previousState: 'settling',
      nextState: finalState,
      reason: boundedString(options.reason, 120) ?? `settled with outcome ${outcome}`,
      revision: written.record.revision,
      epoch: `epoch:${epochSeq}`,
      activeAttemptId: attemptId,
      observedAt: observedAt(),
    }
    try {
      registry.prependEvent?.(normalizedId.value, event)
    } catch {
      // late-event provenance retention is best effort
    }
    ++epochSeq
    notify(normalizedId.value, event)
    return succeeded(finalState === 'settled' ? 'settled' : 'unknown', {
      taskId: normalizedId.value,
      operation: 'settle',
      attemptId,
      outcome,
      state: finalState,
      terminalOutcome,
      safety,
      task: redactTaskRecord(written.record, { audience: 'ui' }),
    })
  }

  async function attach(taskId, options = {}) {
    if (disposed) return inactive('attach')
    const normalizedId = normalizeTaskId(taskId)
    if (!normalizedId.ok) return invalid(normalizedId.reason, { operation: 'attach' })
    const audience = normalizeAudience(options.audience)
    const found = await readRecord(normalizedId.value, audience)
    if (!found.ok) {
      return failed(found.code, { taskId: normalizedId.value, operation: 'attach', reason: found.reason })
    }
    const record = found.record
    if (record.state !== 'registered' && record.state !== 'active') {
      return failed('conflict', {
        taskId: normalizedId.value,
        operation: 'attach',
        reason: `cannot attach to a task in state ${record.state}`,
        observed: { state: record.state, revision: record.revision },
      })
    }

    const attempts = record.attempts.map((item) => ({ ...item }))
    const targetIndex = attempts.length - 1
    const target = attempts[targetIndex]
    if (!target) {
      return failed('conflict', {
        taskId: normalizedId.value,
        operation: 'attach',
        reason: 'task has no run to attach to; start a run first',
        observed: { state: record.state, revision: record.revision },
      })
    }
    const links = { ...(target?.links ?? {}) }
    const linkSources = [
      ['workflow', options.workflowId, sources.workflow],
      ['agent', options.agentId, sources.subagent],
      ['execution', options.executionId, sources.execution],
      ['session', options.sessionId, sources.session],
      ['job', options.jobId, sources.jobs],
      ['transaction', options.transactionId, sources.workspaceTransactions],
    ]
    const attached = []
    const unavailable = []
    for (const [name, id, source] of linkSources) {
      if (id === undefined || id === null) continue
      const confirmed = source.confirm(id)
      if (confirmed.ok && confirmed.link && id) {
        links[name] = confirmed.link
        attached.push(name)
      } else {
        unavailable.push(name)
      }
    }
    if (target) {
      attempts[targetIndex] = { ...target, links }
    }
    const next = {
      ...record,
      attempts,
      updatedAt: observedAt(),
    }
    const written = await registry.writeCas(normalizedId.value, record.revision, next)
    if (!written.ok) {
      return failed(written.code === 'compare-conflict' ? 'conflict' : 'unavailable', {
        taskId: normalizedId.value,
        operation: 'attach',
        reason: written.code === 'compare-conflict' ? 'revision conflict' : 'registry write failed',
      })
    }
    return succeeded('attached', {
      taskId: normalizedId.value,
      operation: 'attach',
      attached,
      unavailable: unavailable.map((name) => ({ name, code: 'unavailable' })),
      task: redactTaskRecord(written.record, { audience: 'ui' }),
    })
  }

  async function get(taskId, options = {}) {
    if (disposed) return inactive('get')
    const normalizedId = normalizeTaskId(taskId)
    if (!normalizedId.ok) return invalid(normalizedId.reason, { operation: 'get' })
    const audience = normalizeAudience(options.audience)
    const found = await readRecord(normalizedId.value, audience)
    if (!found.ok) {
      return succeeded('found', {
        taskId: normalizedId.value,
        operation: 'get',
        found: false,
        task: deepFreeze({
          taskId: normalizedId.value,
          state: 'unknown',
        }),
      })
    }
    return succeeded('found', {
      taskId: normalizedId.value,
      operation: 'get',
      found: true,
      task: redactTaskRecord(found.record, { audience: audience.role ?? 'ui' }),
    })
  }

  async function observe(taskId, options = {}) {
    if (disposed) return inactive('observe')
    const normalizedId = normalizeTaskId(taskId)
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
      taskId: normalizedId.value,
    }

    subscription.current = async () => {
      if (subscription.disposed) {
        return deepFreeze({ code: 'inactive', taskId: normalizedId.value, epoch: subscription.epoch, observedAt: observedAt() })
      }
      const currentFound = await readRecord(normalizedId.value, audience)
      if (!currentFound.ok) {
        return deepFreeze({
          code: 'unavailable',
          taskId: normalizedId.value,
          epoch: subscription.epoch,
          observedAt: observedAt(),
          resync: true,
        })
      }
      return deepFreeze({
        task: redactTaskRecord(currentFound.record, { audience: audience.role ?? 'ui' }),
        taskId: normalizedId.value,
        epoch: subscription.epoch,
        observedAt: observedAt(),
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
      taskId: normalizedId.value,
      initialState: initialRecord
        ? redactTaskRecord(initialRecord, { audience: audience.role ?? 'ui' })
        : deepFreeze({ taskId: normalizedId.value, state: 'unknown' }),
    })
  }

  async function history(taskId, options = {}) {
    if (disposed) return inactive('history')
    const normalizedId = normalizeTaskId(taskId)
    if (!normalizedId.ok) return invalid(normalizedId.reason, { operation: 'history' })
    const audience = normalizeAudience(options.audience)
    const found = await readRecord(normalizedId.value, audience)
    if (!found.ok) {
      return failed(found.code, { taskId: normalizedId.value, operation: 'history', reason: found.reason })
    }
    const record = found.record
    const queried = await registry.queryEvents(normalizedId.value)
    const events = queried.ok ? queried.events : []
    const limit = Number.isInteger(options.limit) && options.limit > 0 ? Math.min(options.limit, 64) : 64
    const cursor = options.cursor !== undefined ? boundedString(options.cursor, 120) : undefined
    let window = events
    if (cursor) {
      const cursorIndex = events.findIndex((entry) => entry.revision === Number(cursor))
      if (cursorIndex >= 0) window = events.slice(cursorIndex + 1)
    }
    const truncated = window.length > limit
    const page = truncated ? window.slice(window.length - limit) : window
    const nextCursor = truncated && page.length > 0 ? String(page[page.length - 1].revision) : undefined
    return succeeded('history', {
      taskId: normalizedId.value,
      operation: 'history',
      events: deepFreeze(page),
      truncated,
      ...(nextCursor ? { nextCursor } : {}),
      provenance: record.provenance,
    })
  }

  const api = Object.freeze({
    register,
    start,
    claim,
    reassign,
    settle,
    attach,
    get,
    observe,
    history,
    availability: mountAvailability,
  })

  const dispose = () => {
    if (disposed) return false
    disposed = true
    try {
      registry.dispose()
    } catch {
      // disposal must never escape the fail-safe path
    }
    observers.clear()
    return true
  }

  return { api, dispose, availability: mountAvailability }
}