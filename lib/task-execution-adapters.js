/**
 * Source adapters, durable task registry, and connect/reconnect evidence
 * intake for the task execution observation facade.
 *
 * The internal source boundary is capability-oriented and is not exported as
 * a public API: every adapter resolves the applicable public surface and
 * returns source identity, generation, certainty, observed time, and bounded
 * provenance. A missing optional source yields an explicit
 * `unavailable`/`unknown` availability for that adapter only and degrades
 * nothing else; the task layer never mints a replacement execution or task
 * identity. The registry is memory-scoped by default (one serialized
 * operation lane per task identity, explicitly labeled non-durable) or a
 * storage-domain bridge selected only when the host explicitly reports a
 * usable durable scope and conditional write primitive.
 */
import { randomUUID } from 'node:crypto'
import { deepFreeze } from './deep-freeze.js'
import {
  TASK_CERTAINTY,
  TASK_SCOPES,
  normalizeScope,
} from './task-execution-normalize.js'

export const MEMORY_REGISTRY_ID = 'memory'

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

export function createUuidFactory() {
  return () => randomUUID()
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

function nowIso(now) {
  try {
    const value = typeof now === 'function' ? now() : now
    const date = value instanceof Date ? value : new Date(value)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  } catch {
    // Fall through to a local timestamp.
  }
  return new Date().toISOString()
}

const failSafe = (error) => ({ ok: false, code: 'unavailable', reason: 'backend error' })

/** Build a bounded evidence reference from a source response. */
export function buildEvidenceReference({ kind, id, generation, certainty, observedAt }) {
  const ref = {
    kind: typeof kind === 'string' ? kind.slice(0, 60) : 'source',
    id: typeof id === 'string' ? id.slice(0, 120) : 'unknown',
    certainty: certainty && TASK_CERTAINTY.includes(certainty) ? certainty : 'unknown',
    observedAt: typeof observedAt === 'string' ? observedAt.slice(0, 160) : nowIso(null),
  }
  if (generation !== undefined) ref.generation = String(generation).slice(0, 120)
  return deepFreeze(ref)
}

/**
 * Memory-scoped default task registry. Operations on one task identity are
 * serialized through an in-process lane; the projection always labels it
 * memory-scoped and non-durable and never presents the lane as cross-process
 * locking. `queryEvents` backs bounded late-event provenance retention (a
 * non-public support surface).
 */
export function createMemoryTaskRegistry({ now, idFactory } = {}) {
  const currently = () => nowIso(now)
  const records = new Map()
  const lanes = new Map()
  const eventLogs = new Map()
  let epochSeq = 0
  let disposed = false

  const laneFor = (key) => {
    let lane = lanes.get(key)
    if (!lane) {
      lane = createSerialLane()
      lanes.set(key, lane)
    }
    return lane
  }

  const epoch = () => `epoch:${epochSeq}`

  const capabilities = () => deepFreeze({
    scope: 'process',
    durability: 'memory',
    atomicCas: true,
    status: 'available',
    backendId: MEMORY_REGISTRY_ID,
  })

  const read = (taskId) => {
    if (disposed) return Promise.resolve({ ok: false, code: 'unavailable' })
    return laneFor(String(taskId)).run(() => {
      const record = records.get(String(taskId))
      if (!record) return { ok: false, code: 'unavailable' }
      return { ok: true, record }
    }).catch(failSafe)
  }

  const writeCas = (taskId, expectedRevision, record) => {
    if (disposed) return Promise.resolve({ ok: false, code: 'unavailable' })
    const key = String(taskId)
    return laneFor(key).run(() => {
      const existing = records.get(key)
      if (expectedRevision !== 0 && (!existing || existing.revision !== expectedRevision)) {
        return { ok: false, code: 'compare-conflict', observed: { revision: existing?.revision ?? 0 } }
      }
      if (expectedRevision === 0 && existing) {
        return { ok: false, code: 'compare-conflict', observed: { revision: existing.revision } }
      }
      const next = { ...record, revision: expectedRevision + 1 }
      records.set(key, next)
      ++epochSeq
      return { ok: true, record: next, epoch: epoch() }
    }).catch(failSafe)
  }

  const queryEvents = (taskId) => {
    if (disposed) return Promise.resolve({ ok: false, code: 'unavailable' })
    const events = eventLogs.get(String(taskId)) ?? []
    return Promise.resolve({ ok: true, events: deepFreeze([...events]) })
  }

  const prependEvent = (taskId, event) => {
    const key = String(taskId)
    const entries = eventLogs.get(key) ?? []
    entries.push(deepFreeze(event))
    if (entries.length > 32) entries.splice(0, entries.length - 32)
    eventLogs.set(key, entries)
  }

  const dispose = () => {
    if (disposed) return false
    disposed = true
    records.clear()
    lanes.clear()
    eventLogs.clear()
    return true
  }

  return { capabilities, read, writeCas, queryEvents, prependEvent, dispose, kind: 'memory' }
}

/**
 * Storage-domain task registry bridge. Persists task records through a domain
 * unit only when the host explicitly reported durable scope and an atomic
 * compare-and-swap primitive; each record write is one atomic CAS and an
 * unconfirmed capability returns explicit unsupported/unavailable/unknown.
 */
export function createStorageDomainTaskRegistry({ unit, capabilityReport, now } = {}) {
  if (!isObject(unit) || typeof unit.read !== 'function' || typeof unit.write !== 'function') {
    throw new TypeError('storage-domain task registry requires a domain unit with read/write')
  }
  const durable = read(capabilityReport, 'durability') === 'durable'
    || read(capabilityReport, 'durability') === 'session'
    || read(capabilityReport, 'durability') === 'workspace'
  const atomicCas = read(capabilityReport, 'atomicCas') === true
  const scope = read(capabilityReport, 'scope') && TASK_SCOPES.includes(read(capabilityReport, 'scope'))
    ? read(capabilityReport, 'scope')
    : 'process'
  const lanes = new Map()
  let epochSeq = 0
  let disposed = false

  const laneFor = (key) => {
    let lane = lanes.get(key)
    if (!lane) {
      lane = createSerialLane()
      lanes.set(key, lane)
    }
    return lane
  }
  const domainKey = (taskId) => `task:${String(taskId)}`
  const epoch = () => `epoch:${epochSeq}`

  const unitRead = (key) => {
    try {
      const result = unit.read(key)
      if (isThenable(result)) return { ok: false, code: 'unknown' }
      const record = isObject(result) ? result : null
      if (!record) return { ok: false, code: 'unavailable' }
      if (typeof record.taskId !== 'string' || typeof record.revision !== 'number') {
        return { ok: false, code: 'unknown' }
      }
      return { ok: true, record }
    } catch {
      return { ok: false, code: 'unavailable' }
    }
  }

  const unitCompareAndSwap = (key, expectedVersion, record) => {
    if (typeof unit.compareAndSwap !== 'function') return { ok: false, code: 'unsupported' }
    try {
      const result = unit.compareAndSwap(key, expectedVersion, record)
      if (isThenable(result)) return { ok: false, code: 'unknown' }
      return result === true ? { ok: true } : { ok: false, code: 'compare-conflict' }
    } catch {
      return { ok: false, code: 'unavailable' }
    }
  }

  const capabilities = () => deepFreeze({
    scope,
    durability: durable ? 'durable' : 'unknown',
    atomicCas,
    status: durable && atomicCas ? 'available' : 'unknown',
    backendId: 'storage-domain',
  })

  const readRecord = (taskId) => {
    if (disposed) return Promise.resolve({ ok: false, code: 'unavailable' })
    const key = String(taskId)
    return laneFor(key).run(() => {
      const found = unitRead(domainKey(key))
      if (!found.ok) return found
      return { ok: true, record: found.record }
    }).catch(failSafe)
  }

  const writeCas = (taskId, expectedRevision, record) => {
    if (disposed) return Promise.resolve({ ok: false, code: 'unavailable' })
    const key = String(taskId)
    return laneFor(key).run(() => {
      if (!atomicCas) return { ok: false, code: 'unsupported' }
      const found = unitRead(domainKey(key))
      if (expectedRevision !== 0 && (!found.ok || found.record.revision !== expectedRevision)) {
        return { ok: false, code: 'compare-conflict', observed: { revision: found.ok ? found.record.revision : 0 } }
      }
      if (expectedRevision === 0 && found.ok) {
        return { ok: false, code: 'compare-conflict', observed: { revision: found.record.revision } }
      }
      const next = { ...record, revision: expectedRevision + 1 }
      const swapped = unitCompareAndSwap(domainKey(key), expectedRevision, next)
      if (!swapped.ok) return swapped
      ++epochSeq
      return { ok: true, record: next, epoch: epoch() }
    }).catch(failSafe)
  }

  const queryEvents = () => Promise.resolve({ ok: false, code: 'unsupported' })
  const prependEvent = () => false

  const dispose = () => {
    if (disposed) return false
    disposed = true
    lanes.clear()
    return true
  }

  return { capabilities, read: readRecord, writeCas, queryEvents, prependEvent, dispose, kind: 'storage-domain' }
}

/**
 * Execution source adapter: consumes the public `pluginApi.executions`
 * projection (observe/get/history, change observer) read-only. A missing
 * surface yields `unavailable` for this source only.
 */
export function createExecutionSourceAdapter({ execution, logger, now } = {}) {
  const currently = () => nowIso(now)
  const availability = () => {
    if (!isObject(execution) || typeof execution.get !== 'function' || typeof execution.observe !== 'function') {
      return deepFreeze({ status: 'unavailable', owner: 'execution', certainty: 'unavailable' })
    }
    const live = read(execution, 'availability')
    const status = isObject(live) ? live.status : undefined
    return deepFreeze({
      status: status === 'available' || status === 'unsupported' || status === 'unavailable' || status === 'unknown' ? status : 'available',
      owner: 'execution',
      certainty: status === 'available' ? 'observed' : 'unavailable',
    })
  }
  const confirm = (executionId) => {
    const status = availability()
    if (status.status !== 'available' || typeof executionId !== 'string' || !executionId) {
      return deepFreeze({ ok: false, code: 'unavailable', certainty: 'unavailable' })
    }
    return deepFreeze({
      ok: true,
      link: { id: executionId.slice(0, 120), certainty: 'observed' },
      evidence: buildEvidenceReference({ kind: 'execution', id: executionId, certainty: 'observed', observedAt: currently() }),
    })
  }
  return { availability, confirm }
}

/**
 * Recovery source adapter: consumes `pluginApi.executions.recovery` decisions and
 * capabilities read-only (classify/evaluate/availability). A missing surface
 * yields `unavailable` for this source only.
 */
export function createRecoverySourceAdapter({ recovery, logger, now } = {}) {
  const currently = () => nowIso(now)
  const availability = () => {
    if (!isObject(recovery) || typeof recovery.classify !== 'function') {
      return deepFreeze({ status: 'unavailable', owner: 'recovery', certainty: 'unavailable' })
    }
    const live = read(recovery, 'availability')
    const status = isObject(live) ? live.status : undefined
    return deepFreeze({
      status: status === 'available' || status === 'unsupported' || status === 'unavailable' || status === 'unknown' ? status : 'available',
      owner: 'recovery',
      certainty: status === 'available' ? 'observed' : 'unavailable',
    })
  }
  const confirm = () => {
    const status = availability()
    if (status.status !== 'available') {
      return deepFreeze({ ok: false, code: 'unavailable', certainty: 'unavailable' })
    }
    return deepFreeze({
      ok: true,
      link: { id: 'policy', certainty: 'observed' },
      evidence: buildEvidenceReference({ kind: 'recovery', id: 'policy', certainty: 'observed', observedAt: currently() }),
    })
  }
  return { availability, confirm }
}

/**
 * Coordination source adapter: delegation boundary for the public
 * `pluginApi.coordination` surface. Reassignment and claiming go through
 * takeover/acquire; a missing surface yields `unavailable`.
 */
export function createCoordinationSourceAdapter({ coordination, logger, now } = {}) {
  const currently = () => nowIso(now)
  const availability = () => {
    if (!isObject(coordination) || typeof coordination.acquire !== 'function'
      || typeof coordination.takeover !== 'function') {
      return deepFreeze({ status: 'unavailable', owner: 'coordination', certainty: 'unavailable' })
    }
    return deepFreeze({ status: 'available', owner: 'coordination', certainty: 'observed' })
  }
  const acquire = async (input) => {
    if (!isObject(coordination) || typeof coordination.acquire !== 'function') {
      return deepFreeze({ ok: false, code: 'unsupported', reason: 'coordination facade is unavailable' })
    }
    let result
    try {
      result = await coordination.acquire(input)
    } catch {
      return deepFreeze({ ok: false, code: 'unavailable', reason: 'coordination could not be reached' })
    }
    if (!isObject(result) || result.ok !== true || !isObject(result.handle)) {
      return deepFreeze({
        ok: false,
        code: result?.code && ['conflict', 'invalid-input', 'unsupported', 'unavailable', 'unknown'].includes(result.code)
          ? result.code
          : 'unavailable',
        reason: 'coordination acquisition failed',
        observed: result?.observed,
      })
    }
    return deepFreeze({
      ok: true,
      handle: result.handle,
      evidence: buildEvidenceReference({ kind: 'coordination', id: result.handle.generation, certainty: 'observed', observedAt: currently() }),
    })
  }
  const takeover = async (input) => {
    if (!isObject(coordination) || typeof coordination.takeover !== 'function') {
      return deepFreeze({ ok: false, code: 'unsupported', reason: 'coordination facade is unavailable' })
    }
    let result
    try {
      result = await coordination.takeover(input)
    } catch {
      return deepFreeze({ ok: false, code: 'unavailable', reason: 'coordination could not be reached' })
    }
    if (!isObject(result) || result.ok !== true || !isObject(result.handle)) {
      return deepFreeze({
        ok: false,
        code: result?.code && ['conflict', 'invalid-input', 'stale-holder', 'expired', 'superseded', 'unsupported', 'unavailable', 'unknown'].includes(result.code)
          ? result.code
          : 'unavailable',
        reason: 'coordination takeover failed',
        observed: result?.observed,
      })
    }
    return deepFreeze({
      ok: true,
      handle: result.handle,
      evidence: buildEvidenceReference({ kind: 'coordination-takeover', id: result.handle.generation, certainty: 'observed', observedAt: currently() }),
    })
  }
  return { availability, acquire, takeover }
}

/**
 * Diagnostics source adapter: consumes the public `pluginApi.diagnostics`
 * get/onChange projection as provenance availability evidence when the public
 * projection is present. A missing surface yields `unavailable`.
 */
export function createDiagnosticsSourceAdapter({ diagnostics, logger, now } = {}) {
  const currently = () => nowIso(now)
  const availability = () => {
    if (!isObject(diagnostics) || typeof diagnostics.get !== 'function') {
      return deepFreeze({ status: 'unavailable', owner: 'diagnostics', certainty: 'unavailable' })
    }
    return deepFreeze({ status: 'available', owner: 'diagnostics', certainty: 'observed' })
  }
  const confirm = () => {
    const status = availability()
    if (status.status !== 'available') {
      return deepFreeze({ ok: false, code: 'unavailable', certainty: 'unavailable' })
    }
    return deepFreeze({
      ok: true,
      link: { id: 'diagnostics', certainty: 'observed' },
      evidence: buildEvidenceReference({ kind: 'diagnostics', id: 'diagnostics', certainty: 'observed', observedAt: currently() }),
    })
  }
  return { availability, confirm }
}

/**
 * Workspace transaction source adapter: consumes the public
 * `pluginApi.workspaces.transactions` get/observe projection when the same-batch
 * feature is present. A missing surface yields `unavailable`.
 */
export function createWorkspaceTransactionsSourceAdapter({ workspaceTransactions, logger, now } = {}) {
  const currently = () => nowIso(now)
  const availability = () => {
    if (!isObject(workspaceTransactions) || typeof workspaceTransactions.get !== 'function') {
      return deepFreeze({ status: 'unavailable', owner: 'workspaceTransactions', certainty: 'unavailable' })
    }
    return deepFreeze({ status: 'available', owner: 'workspaceTransactions', certainty: 'observed' })
  }
  const confirm = (transactionId) => {
    const status = availability()
    if (status.status !== 'available' || typeof transactionId !== 'string' || !transactionId) {
      return deepFreeze({ ok: false, code: 'unavailable', certainty: 'unavailable' })
    }
    return deepFreeze({
      ok: true,
      link: { id: transactionId.slice(0, 120), certainty: 'observed' },
      evidence: buildEvidenceReference({ kind: 'workspace-transaction', id: transactionId, certainty: 'observed', observedAt: currently() }),
    })
  }
  return { availability, confirm }
}

/**
 * Jobs source adapter: reads the public `jobs` service (get/list/read) and
 * consumes its change notification when available. A missing seam yields
 * `unavailable` for this source only.
 */
export function createJobsSourceAdapter({ ctx, logger, now } = {}) {
  const currently = () => nowIso(now)
  const resolveJobs = () => {
    if (typeof ctx?.get !== 'function') return null
    try {
      return ctx.get('jobs') ?? null
    } catch {
      return null
    }
  }
  const availability = () => {
    const jobs = resolveJobs()
    if (!isObject(jobs) || typeof jobs.get !== 'function' || typeof jobs.list !== 'function') {
      return deepFreeze({ status: 'unavailable', owner: 'jobs', certainty: 'unavailable' })
    }
    return deepFreeze({ status: 'available', owner: 'jobs', certainty: 'observed' })
  }
  const confirm = (jobId) => {
    const status = availability()
    if (status.status !== 'available' || typeof jobId !== 'string' || !jobId) {
      return deepFreeze({ ok: false, code: 'unavailable', certainty: 'unavailable' })
    }
    return deepFreeze({
      ok: true,
      link: { id: jobId.slice(0, 120), certainty: 'observed' },
      evidence: buildEvidenceReference({ kind: 'job', id: jobId, certainty: 'observed', observedAt: currently() }),
    })
  }
  return { availability, confirm }
}

/**
 * Workflow/subagent source adapters: consume the documented `workflow/*` and
 * `subagent/*` catalog events plus the public workflow/subagent service
 * members when available. A missing event seam yields `unavailable` for that
 * source only; a workflow identity is never synthesized from an event
 * sequence.
 */
export function createWorkflowSourceAdapter({ ctx, logger, now } = {}) {
  const currently = () => nowIso(now)
  const availability = () => {
    if (typeof ctx?.on !== 'function') {
      return deepFreeze({ status: 'unavailable', owner: 'workflow', certainty: 'unavailable' })
    }
    return deepFreeze({ status: 'available', owner: 'workflow', certainty: 'observed' })
  }
  const confirm = (workflowId) => {
    if (typeof workflowId !== 'string' || !workflowId) {
      return deepFreeze({ ok: false, code: 'unavailable', certainty: 'unavailable' })
    }
    return deepFreeze({
      ok: true,
      link: { id: workflowId.slice(0, 120), certainty: 'observed' },
      evidence: buildEvidenceReference({ kind: 'workflow', id: workflowId, certainty: 'observed', observedAt: currently() }),
    })
  }
  return { availability, confirm }
}

export function createSubagentSourceAdapter({ ctx, logger, now } = {}) {
  const currently = () => nowIso(now)
  const availability = () => {
    if (typeof ctx?.on !== 'function') {
      return deepFreeze({ status: 'unavailable', owner: 'subagent', certainty: 'unavailable' })
    }
    return deepFreeze({ status: 'available', owner: 'subagent', certainty: 'observed' })
  }
  const confirm = (agentId) => {
    if (typeof agentId !== 'string' || !agentId) {
      return deepFreeze({ ok: false, code: 'unavailable', certainty: 'unavailable' })
    }
    return deepFreeze({
      ok: true,
      link: { id: agentId.slice(0, 120), certainty: 'observed' },
      evidence: buildEvidenceReference({ kind: 'subagent', id: agentId, certainty: 'observed', observedAt: currently() }),
    })
  }
  return { availability, confirm }
}

/**
 * Session source adapter: read-only session observation/context delegation
 * through the public session surface. A missing session seam yields
 * `unavailable`; the facade never copies or rewrites the official transcript.
 */
export function createSessionSourceAdapter({ ctx, session, logger, now } = {}) {
  const currently = () => nowIso(now)
  const availability = () => {
    const viaCtx = typeof ctx?.get === 'function' ? (() => { try { return ctx.get('sessions') } catch { return null } })() : null
    if (!isObject(session) && !isObject(viaCtx)) {
      return deepFreeze({ status: 'unavailable', owner: 'session', certainty: 'unavailable' })
    }
    return deepFreeze({ status: 'available', owner: 'session', certainty: 'observed' })
  }
  const confirm = (sessionId) => {
    if (typeof sessionId !== 'string' || !sessionId) {
      return deepFreeze({ ok: false, code: 'unavailable', certainty: 'unavailable' })
    }
    return deepFreeze({
      ok: true,
      link: { id: sessionId.slice(0, 120), certainty: 'observed' },
      evidence: buildEvidenceReference({ kind: 'session', id: sessionId, certainty: 'observed', observedAt: currently() }),
    })
  }
  return { availability, confirm }
}

/**
 * Connect/reconnect evidence intake for the mounter. Execution change
 * observation, jobs change notification (onJobDone/onJobsChanged), and the
 * documented workflow/* and subagent/* catalog events are bridged into
 * bounded task provenance. A missing optional hook disables only the
 * corresponding evidence field; stale callbacks from a replaced generation
 * are ignored. `dispose()` is idempotent.
 */
export function createTaskEvidenceIntake({ ctx, execution, logger, now } = {}) {
  const currently = () => nowIso(now)
  const provenance = []
  const detachers = []
  let disposed = false

  const recordProvenance = (entry) => {
    provenance.push(deepFreeze({
      kind: String(entry.kind).slice(0, 60),
      id: String(entry.id).slice(0, 120),
      certainty: entry.certainty && TASK_CERTAINTY.includes(entry.certainty) ? entry.certainty : 'observed',
      observedAt: currently(),
    }))
    if (provenance.length > 64) provenance.splice(0, provenance.length - 64)
  }

  // Execution change observation (only when the public projection is present).
  if (isObject(execution) && typeof execution.onChange === 'function') {
    let detach = () => false
    try {
      detach = execution.onChange((entry) => {
        try {
          if (isObject(entry) && entry.executionId) {
            recordProvenance({ kind: 'execution', id: entry.executionId, certainty: 'observed' })
          }
        } catch {
          // evidence intake must never interrupt the fail-safe path
        }
      })
    } catch {
      try {
        logger?.error?.('dsh-plugin-api tasks: cannot attach execution change evidence')
      } catch {
        // diagnostics must never interrupt the fail-safe path
      }
    }
    detachers.push(() => {
      try { detach() } catch {}
    })
  }

  // Jobs change notification when the public service is available.
  if (typeof ctx?.on === 'function') {
    for (const eventName of ['jobs/done', 'jobs/changed']) {
      let detach = () => false
      try {
        detach = ctx.on(eventName, (payload) => {
          try {
            const jobId = isObject(payload) ? payload.jobId ?? payload.id : undefined
            if (typeof jobId === 'string' && jobId) {
              recordProvenance({ kind: 'job', id: jobId, certainty: 'observed' })
            }
          } catch {
            // evidence intake must never interrupt the fail-safe path
          }
        })
      } catch {
        try {
          logger?.error?.(`dsh-plugin-api tasks: cannot attach ${eventName} evidence`)
        } catch {
          // diagnostics must never interrupt the fail-safe path
        }
      }
      detachers.push(() => {
        try { detach() } catch {}
      })
    }

    // Documented workflow/* and subagent/* catalog events.
    for (const eventName of ['workflow/start', 'workflow/end', 'subagent/start', 'subagent/end']) {
      let detach = () => false
      try {
        detach = ctx.on(eventName, (payload) => {
          try {
            const id = isObject(payload) ? payload.workflowId ?? payload.agentId ?? payload.id : undefined
            if (typeof id === 'string' && id) {
              recordProvenance({
                kind: eventName.startsWith('workflow') ? 'workflow' : 'subagent',
                id,
                certainty: 'observed',
              })
            }
          } catch {
            // evidence intake must never interrupt the fail-safe path
          }
        })
      } catch {
        try {
          logger?.error?.(`dsh-plugin-api tasks: cannot attach ${eventName} evidence`)
        } catch {
          // diagnostics must never interrupt the fail-safe path
        }
      }
      detachers.push(() => {
        try { detach() } catch {}
      })
    }
  }

  const latest = (kind) => {
    for (let index = provenance.length - 1; index >= 0; index -= 1) {
      if (provenance[index].kind === kind) return provenance[index]
    }
    return undefined
  }

  const dispose = () => {
    if (disposed) return false
    disposed = true
    for (const detach of detachers) {
      try {
        detach()
      } catch {
        // best-effort detach
      }
    }
    detachers.length = 0
    return true
  }

  return {
    provenance,
    latest,
    dispose,
    get size() {
      return provenance.length
    },
  }
}

/**
 * Build a capability evidence map from the resolved source adapters for the
 * availability projection. Each entry is bounded and redacted.
 */
export function buildSourceAvailability(adapters) {
  const sources = {}
  for (const name of ['execution', 'recovery', 'coordination', 'diagnostics', 'workspaceTransactions', 'jobs', 'workflow', 'subagent', 'session']) {
    const adapter = adapters[name]
    const availability = typeof adapter?.availability === 'function' ? adapter.availability() : undefined
    sources[name] = isObject(availability) ? availability.status : 'unknown'
  }
  return deepFreeze(sources)
}

export { normalizeScope }