/**
 * Backend adapters and evidence intake for the workspace mutation transaction
 * facade.
 *
 * The internal adapter contract is capability-oriented and is not exported as
 * a public API. The registry is either memory-scoped (one serialized operation
 * lane per transaction identity, explicitly labeled non-durable) or a
 * storage-domain bridge selected only when the host explicitly reports a
 * usable durable scope and conditional write primitive — capability is never
 * inferred from a domain name. Small capability adapters (file claim,
 * checkpoint, Git/workspace restore, ledger, approval, session branch) resolve
 * the applicable public seam and refuse operations they cannot prove; a
 * missing optional seam yields an explicit `unavailable`/`unsupported`
 * capability for that adapter only and degrades nothing else.
 */
import { randomUUID } from 'node:crypto'
import { deepFreeze } from './deep-freeze.js'
import {
  WS_TX_CERTAINTY,
  WS_TX_SCOPES,
  resourceKey,
} from './workspace-transaction-normalize.js'

export const MEMORY_REGISTRY_ID = 'memory'

const CERTAINTY = WS_TX_CERTAINTY

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

/**
 * Build a bounded evidence reference from an adapter response. The reference
 * carries the adapter's identity, generation/version when available, certainty
 * from the fixed vocabulary, and observed time; raw content never crosses.
 */
export function buildEvidenceReference({ kind, id, generation, version, certainty, observedAt }) {
  const ref = {
    kind: typeof kind === 'string' ? kind.slice(0, 60) : 'adapter',
    id: typeof id === 'string' ? id.slice(0, 120) : 'unknown',
    certainty: certainty && CERTAINTY.includes(certainty) ? certainty : 'unknown',
    observedAt: typeof observedAt === 'string' ? observedAt.slice(0, 160) : nowIso(null),
  }
  if (generation !== undefined) ref.generation = String(generation).slice(0, 120)
  if (version !== undefined && Number.isInteger(version)) ref.version = version
  return deepFreeze(ref)
}

/**
 * The registry adapter bound used by the owner. `read` returns the current
 * record or an explicit unavailable/unknown shape; `writeCas` performs an
 * atomic compare-and-swap on the expected revision and rejects a stale
 * writer; `queryEvents(transactionId)` backs bounded late-event provenance
 * retention (a non-public support surface).
 */
export function createMemoryWorkspaceRegistry({ now, idFactory } = {}) {
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

  const read = (transactionId) => {
    if (disposed) return Promise.resolve({ ok: false, code: 'unavailable' })
    return laneFor(String(transactionId)).run(() => {
      const record = records.get(String(transactionId))
      if (!record) return { ok: false, code: 'unavailable' }
      return { ok: true, record }
    }).catch(failSafe)
  }

  const writeCas = (transactionId, expectedRevision, record) => {
    if (disposed) return Promise.resolve({ ok: false, code: 'unavailable' })
    const key = String(transactionId)
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

  const queryEvents = (transactionId) => {
    if (disposed) return Promise.resolve({ ok: false, code: 'unavailable' })
    const events = eventLogs.get(String(transactionId)) ?? []
    return Promise.resolve({ ok: true, events: deepFreeze([...events]) })
  }

  const prependEvent = (transactionId, event) => {
    const key = String(transactionId)
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
 * Storage-domain registry bridge. Persists transaction records through a
 * domain unit only when the host explicitly reported durable scope and an
 * atomic compare-and-swap primitive; each record write is one atomic CAS and
 * an unconfirmed capability returns explicit unsupported/unavailable/unknown —
 * never emulated or inferred from a domain name.
 */
export function createStorageDomainWorkspaceRegistry({ unit, capabilityReport, now } = {}) {
  if (!isObject(unit) || typeof unit.read !== 'function' || typeof unit.write !== 'function') {
    throw new TypeError('storage-domain workspace registry requires a domain unit with read/write')
  }
  const durable = read(capabilityReport, 'durability') === 'durable'
    || read(capabilityReport, 'durability') === 'session'
    || read(capabilityReport, 'durability') === 'workspace'
  const atomicCas = read(capabilityReport, 'atomicCas') === true
  const scope = read(capabilityReport, 'scope') && WS_TX_SCOPES.includes(read(capabilityReport, 'scope'))
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
  const domainKey = (transactionId) => `workspace-transaction:${String(transactionId)}`
  const epoch = () => `epoch:${epochSeq}`

  const unitRead = (key) => {
    try {
      const result = unit.read(key)
      if (isThenable(result)) return { ok: false, code: 'unknown' }
      const record = isObject(result) ? result : null
      if (!record) return { ok: false, code: 'unavailable' }
      if (typeof record.transactionId !== 'string' || typeof record.revision !== 'number') {
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

  const readRecord = (transactionId) => {
    if (disposed) return Promise.resolve({ ok: false, code: 'unavailable' })
    const key = String(transactionId)
    return laneFor(key).run(() => {
      const found = unitRead(domainKey(key))
      if (!found.ok) return found
      return { ok: true, record: found.record }
    }).catch(failSafe)
  }

  const writeCas = (transactionId, expectedRevision, record) => {
    if (disposed) return Promise.resolve({ ok: false, code: 'unavailable' })
    const key = String(transactionId)
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
 * Workspace capability adapter: probes the public workspace seam per scope
 * and returns capability evidence whose authority data feeds prepare's
 * incompatible-authority rejection and preview's precondition/stale detection.
 */
export function createWorkspaceCapabilityAdapter({ ctx, now } = {}) {
  const currently = () => nowIso(now)
  const resolveWorkspaces = () => {
    if (typeof ctx?.get !== 'function') return null
    try {
      return ctx.get('workspaces') ?? null
    } catch {
      return null
    }
  }
  const capabilities = (scope) => {
    const requested = String(scope ?? 'process').slice(0, 40)
    const workspaces = resolveWorkspaces()
    const reportFn = workspaces && typeof workspaces.capabilitiesFor === 'function'
      ? workspaces.capabilitiesFor
      : (workspaces && typeof workspaces.capability === 'function' ? workspaces.capability : null)
    if (!reportFn) {
      return deepFreeze({
        ok: false,
        code: 'unavailable',
        authority: 'none',
        evidence: buildEvidenceReference({
          kind: 'workspace-authority',
          id: requested,
          certainty: 'unavailable',
          observedAt: currently(),
        }),
      })
    }
    let report
    try {
      report = reportFn(requested) ?? null
    } catch {
      return deepFreeze({
        ok: false,
        code: 'unavailable',
        authority: 'none',
        evidence: buildEvidenceReference({
          kind: 'workspace-authority',
          id: requested,
          certainty: 'unavailable',
          observedAt: currently(),
        }),
      })
    }
    if (!isObject(report) || typeof report.authorityId !== 'string' || typeof report.compatible !== 'boolean') {
      return deepFreeze({
        ok: false,
        code: 'unknown',
        authority: 'unknown',
        evidence: buildEvidenceReference({
          kind: 'workspace-authority',
          id: requested,
          certainty: 'unknown',
          observedAt: currently(),
        }),
      })
    }
    return deepFreeze({
      ok: report.compatible,
      code: report.compatible ? 'compatible' : 'incompatible',
      authority: report.authorityId.slice(0, 120),
      evidence: buildEvidenceReference({
        kind: 'workspace-authority',
        id: report.authorityId,
        generation: report.generation,
        certainty: 'observed',
        observedAt: currently(),
      }),
    })
  }
  return { capabilities }
}

/**
 * Small capability adapters. Each resolves the applicable public seam and
 * refuses an operation it cannot prove: a missing seam yields an explicit
 * `unavailable`/`unsupported` capability for that adapter only, and no adapter
 * may report an external effect as rollbackable merely because a local command
 * completed.
 */
export function createFileClaimAdapter({ ctx, now } = {}) {
  const currently = () => nowIso(now)
  const resolveSeam = () => {
    if (typeof ctx?.get !== 'function') return null
    try {
      return ctx.get('fileClaim') ?? null
    } catch {
      return null
    }
  }
  const capability = () => {
    const seam = resolveSeam()
    if (!isObject(seam) || typeof seam.claim !== 'function' || typeof seam.release !== 'function') {
      return deepFreeze({ status: 'unavailable', owner: 'fileClaim', name: 'claim', certainty: 'unavailable' })
    }
    return deepFreeze({ status: 'available', owner: 'fileClaim', name: 'claim', certainty: 'observed' })
  }
  const claim = (resource, lease) => {
    const seam = resolveSeam()
    if (!isObject(seam) || typeof seam.claim !== 'function') {
      return Promise.resolve(deepFreeze({ ok: false, code: 'unsupported', capability: capability() }))
    }
    let result
    try {
      result = seam.claim(resource, lease)
    } catch {
      return Promise.resolve(deepFreeze({ ok: false, code: 'unavailable', capability: capability() }))
    }
    if (isThenable(result)) return Promise.resolve(deepFreeze({ ok: false, code: 'unknown', capability: capability() }))
    return Promise.resolve(deepFreeze({
      ok: result === true,
      code: result === true ? 'claimed' : 'conflict',
      capability: capability(),
      evidence: buildEvidenceReference({ kind: 'file-claim', id: resourceKey(resource), certainty: 'observed', observedAt: currently() }),
    }))
  }
  const release = (resource, lease) => {
    const seam = resolveSeam()
    if (!isObject(seam) || typeof seam.release !== 'function') {
      return Promise.resolve(deepFreeze({ ok: false, code: 'unsupported', capability: capability() }))
    }
    try {
      const result = seam.release(resource, lease)
      if (isThenable(result)) {
        return Promise.resolve(deepFreeze({ ok: false, code: 'unknown', capability: capability() }))
      }
      return Promise.resolve(deepFreeze({
        ok: result === true,
        code: result === true ? 'released' : 'conflict',
        capability: capability(),
      }))
    } catch {
      return Promise.resolve(deepFreeze({ ok: false, code: 'unavailable', capability: capability() }))
    }
  }
  return { capability, claim, release }
}

export function createCheckpointAdapter({ ctx, now } = {}) {
  const currently = () => nowIso(now)
  const resolveSeam = () => {
    if (typeof ctx?.get !== 'function') return null
    try {
      return ctx.get('checkpoints') ?? ctx.get('checkpoint') ?? null
    } catch {
      return null
    }
  }
  const capability = () => {
    const seam = resolveSeam()
    if (!isObject(seam) || typeof seam.describe !== 'function') {
      return deepFreeze({ status: 'unavailable', owner: 'checkpoint', name: 'describe', certainty: 'unavailable' })
    }
    return deepFreeze({ status: 'available', owner: 'checkpoint', name: 'describe', certainty: 'observed' })
  }
  const describe = (ref) => {
    const seam = resolveSeam()
    if (!isObject(seam) || typeof seam.describe !== 'function') {
      return Promise.resolve(deepFreeze({ ok: false, code: 'unsupported', capability: capability() }))
    }
    try {
      const result = seam.describe(ref)
      if (isThenable(result)) {
        return Promise.resolve(deepFreeze({ ok: false, code: 'unknown', capability: capability() }))
      }
      if (!isObject(result)) return Promise.resolve(deepFreeze({ ok: false, code: 'unavailable', capability: capability() }))
      return Promise.resolve(deepFreeze({
        ok: true,
        code: 'described',
        checkpoint: { id: String(result.id).slice(0, 120), capability: capability() },
        evidence: buildEvidenceReference({ kind: 'checkpoint', id: String(result.id), certainty: 'observed', observedAt: currently() }),
      }))
    } catch {
      return Promise.resolve(deepFreeze({ ok: false, code: 'unavailable', capability: capability() }))
    }
  }
  const create = (input) => {
    const seam = resolveSeam()
    if (!isObject(seam) || typeof seam.create !== 'function') {
      return Promise.resolve(deepFreeze({ ok: false, code: 'unsupported', capability: capability() }))
    }
    try {
      const result = seam.create(input)
      if (isThenable(result)) {
        return Promise.resolve(deepFreeze({ ok: false, code: 'unknown', capability: capability() }))
      }
      if (!isObject(result) || typeof result.id !== 'string') {
        return Promise.resolve(deepFreeze({ ok: false, code: 'unavailable', capability: capability() }))
      }
      return Promise.resolve(deepFreeze({
        ok: true,
        code: 'created',
        checkpoint: { id: result.id.slice(0, 120), capability: capability() },
        evidence: buildEvidenceReference({ kind: 'checkpoint', id: result.id, certainty: 'observed', observedAt: currently() }),
      }))
    } catch {
      return Promise.resolve(deepFreeze({ ok: false, code: 'unavailable', capability: capability() }))
    }
  }
  const restore = (ref, boundary) => {
    const seam = resolveSeam()
    if (!isObject(seam) || typeof seam.restore !== 'function') {
      return Promise.resolve(deepFreeze({ ok: false, code: 'unsupported', capability: capability() }))
    }
    try {
      const result = seam.restore(ref, boundary)
      if (isThenable(result)) {
        return Promise.resolve(deepFreeze({ ok: false, code: 'unknown', capability: capability() }))
      }
      return Promise.resolve(deepFreeze({
        ok: result === true,
        code: result === true ? 'restored' : 'conflict',
        capability: capability(),
        evidence: buildEvidenceReference({ kind: 'checkpoint-restore', id: String(ref), certainty: 'observed', observedAt: currently() }),
      }))
    } catch {
      return Promise.resolve(deepFreeze({ ok: false, code: 'unavailable', capability: capability() }))
    }
  }
  return { capability, describe, create, restore }
}

export function createGitRestoreAdapter({ ctx, now } = {}) {
  const currently = () => nowIso(now)
  const resolveSeam = () => {
    if (typeof ctx?.get !== 'function') return null
    try {
      return ctx.get('workspaceRestore') ?? ctx.get('git') ?? null
    } catch {
      return null
    }
  }
  const capability = () => {
    const seam = resolveSeam()
    if (!isObject(seam) || typeof seam.preview !== 'function' || typeof seam.restore !== 'function') {
      return deepFreeze({ status: 'unavailable', owner: 'git', name: 'restore', certainty: 'unavailable' })
    }
    return deepFreeze({ status: 'available', owner: 'git', name: 'restore', certainty: 'observed' })
  }
  const preview = (boundary) => {
    const seam = resolveSeam()
    if (!isObject(seam) || typeof seam.preview !== 'function') {
      return Promise.resolve(deepFreeze({ ok: false, code: 'unsupported', capability: capability() }))
    }
    try {
      const result = seam.preview(boundary)
      if (isThenable(result)) {
        return Promise.resolve(deepFreeze({ ok: false, code: 'unknown', capability: capability() }))
      }
      return Promise.resolve(deepFreeze({
        ok: isObject(result),
        code: isObject(result) ? 'previewed' : 'unavailable',
        evidence: isObject(result)
          ? buildEvidenceReference({ kind: 'git-preview', id: String(result.revision ?? boundary), certainty: 'observed', observedAt: currently() })
          : undefined,
        capability: capability(),
      }))
    } catch {
      return Promise.resolve(deepFreeze({ ok: false, code: 'unavailable', capability: capability() }))
    }
  }
  const apply = (boundary) => {
    const seam = resolveSeam()
    if (!isObject(seam) || typeof seam.apply !== 'function') {
      return Promise.resolve(deepFreeze({ ok: false, code: 'unsupported', capability: capability() }))
    }
    try {
      const result = seam.apply(boundary)
      if (isThenable(result)) {
        return Promise.resolve(deepFreeze({ ok: false, code: 'unknown', capability: capability() }))
      }
      return Promise.resolve(deepFreeze({
        ok: result === true,
        code: result === true ? 'applied' : 'conflict',
        capability: capability(),
        evidence: buildEvidenceReference({ kind: 'git-apply', id: String(boundary), certainty: 'observed', observedAt: currently() }),
      }))
    } catch {
      return Promise.resolve(deepFreeze({ ok: false, code: 'unavailable', capability: capability() }))
    }
  }
  const restore = (boundary) => {
    const seam = resolveSeam()
    if (!isObject(seam) || typeof seam.restore !== 'function') {
      return Promise.resolve(deepFreeze({ ok: false, code: 'unsupported', capability: capability() }))
    }
    try {
      const result = seam.restore(boundary)
      if (isThenable(result)) {
        return Promise.resolve(deepFreeze({ ok: false, code: 'unknown', capability: capability() }))
      }
      return Promise.resolve(deepFreeze({
        ok: result === true,
        code: result === true ? 'restored' : 'conflict',
        capability: capability(),
        evidence: buildEvidenceReference({ kind: 'git-restore', id: String(boundary), certainty: 'observed', observedAt: currently() }),
      }))
    } catch {
      return Promise.resolve(deepFreeze({ ok: false, code: 'unavailable', capability: capability() }))
    }
  }
  return { capability, preview, apply, restore }
}

export function createLedgerAdapter({ ctx, now } = {}) {
  const currently = () => nowIso(now)
  const resolveSeam = () => {
    if (typeof ctx?.get !== 'function') return null
    try {
      return ctx.get('changeLedger') ?? null
    } catch {
      return null
    }
  }
  const capability = () => {
    const seam = resolveSeam()
    if (!isObject(seam) || typeof seam.append !== 'function') {
      return deepFreeze({ status: 'unavailable', owner: 'ledger', name: 'append', certainty: 'unavailable' })
    }
    return deepFreeze({ status: 'available', owner: 'ledger', name: 'append', certainty: 'observed' })
  }
  const append = (entry) => {
    const seam = resolveSeam()
    if (!isObject(seam) || typeof seam.append !== 'function') {
      return Promise.resolve(deepFreeze({ ok: false, code: 'unsupported', capability: capability() }))
    }
    try {
      const result = seam.append(entry)
      if (isThenable(result)) {
        return Promise.resolve(deepFreeze({ ok: false, code: 'unknown', capability: capability() }))
      }
      return Promise.resolve(deepFreeze({
        ok: result === true,
        code: result === true ? 'appended' : 'conflict',
        capability: capability(),
        evidence: buildEvidenceReference({
          kind: 'ledger-append',
          id: String(entry?.transactionId ?? 'unknown'),
          certainty: 'observed',
          observedAt: currently(),
        }),
      }))
    } catch {
      return Promise.resolve(deepFreeze({ ok: false, code: 'unavailable', capability: capability() }))
    }
  }
  const query = (transactionId) => {
    const seam = resolveSeam()
    if (!isObject(seam) || typeof seam.query !== 'function') {
      return Promise.resolve(deepFreeze({ ok: false, code: 'unsupported', capability: capability() }))
    }
    try {
      const result = seam.query(transactionId)
      if (isThenable(result)) {
        return Promise.resolve(deepFreeze({ ok: false, code: 'unknown', capability: capability() }))
      }
      if (!Array.isArray(result)) return Promise.resolve(deepFreeze({ ok: false, code: 'unavailable', capability: capability() }))
      return Promise.resolve(deepFreeze({
        ok: true,
        code: 'queried',
        entries: deepFreeze(result.slice(0, 32)),
        capability: capability(),
      }))
    } catch {
      return Promise.resolve(deepFreeze({ ok: false, code: 'unavailable', capability: capability() }))
    }
  }
  return { capability, append, query }
}

export function createApprovalAdapter({ ctx, now } = {}) {
  const currently = () => nowIso(now)
  const resolveSeam = () => {
    if (typeof ctx?.get !== 'function') return null
    try {
      return ctx.get('approval') ?? null
    } catch {
      return null
    }
  }
  const capability = () => {
    const seam = resolveSeam()
    if (!isObject(seam) || typeof seam.confirm !== 'function') {
      return deepFreeze({ status: 'unavailable', owner: 'approval', name: 'confirm', certainty: 'unavailable' })
    }
    return deepFreeze({ status: 'available', owner: 'approval', name: 'confirm', certainty: 'observed' })
  }
  const confirm = (request) => {
    const seam = resolveSeam()
    if (!isObject(seam) || typeof seam.confirm !== 'function') {
      return Promise.resolve(deepFreeze({ ok: false, code: 'unsupported', capability: capability() }))
    }
    try {
      const result = seam.confirm(request)
      if (isThenable(result)) {
        return Promise.resolve(deepFreeze({ ok: false, code: 'unknown', capability: capability() }))
      }
      if (!isObject(result) || typeof result.confirmed !== 'boolean' || typeof result.approvalId !== 'string') {
        return Promise.resolve(deepFreeze({ ok: false, code: 'unavailable', capability: capability() }))
      }
      return Promise.resolve(deepFreeze({
        ok: result.confirmed,
        code: result.confirmed ? 'confirmed' : 'denied',
        approval: { approvalId: result.approvalId.slice(0, 120), capability: capability() },
        evidence: buildEvidenceReference({
          kind: 'approval',
          id: result.approvalId,
          certainty: result.confirmed ? 'observed' : 'stale',
          observedAt: currently(),
        }),
      }))
    } catch {
      return Promise.resolve(deepFreeze({ ok: false, code: 'unavailable', capability: capability() }))
    }
  }
  return { capability, confirm }
}

/**
 * Conditional session-branch adapter: enabled only when a public
 * session-branch capability exists on the host, following the same
 * degradation rules as checkpoint and file claim. Never a local simulation.
 */
export function createSessionBranchAdapter({ ctx, now } = {}) {
  const currently = () => nowIso(now)
  const resolveSeam = () => {
    if (typeof ctx?.get !== 'function') return null
    try {
      return ctx.get('sessionBranch') ?? null
    } catch {
      return null
    }
  }
  const capability = () => {
    const seam = resolveSeam()
    if (!isObject(seam) || typeof seam.preview !== 'function' || typeof seam.restore !== 'function') {
      return deepFreeze({ status: 'unsupported', owner: 'sessionBranch', name: 'branch', certainty: 'unavailable' })
    }
    return deepFreeze({ status: 'available', owner: 'sessionBranch', name: 'branch', certainty: 'observed' })
  }
  const preview = (boundary) => {
    const seam = resolveSeam()
    if (!isObject(seam) || typeof seam.preview !== 'function') {
      return Promise.resolve(deepFreeze({ ok: false, code: 'unsupported', capability: capability() }))
    }
    try {
      const result = seam.preview(boundary)
      if (isThenable(result)) {
        return Promise.resolve(deepFreeze({ ok: false, code: 'unknown', capability: capability() }))
      }
      return Promise.resolve(deepFreeze({
        ok: isObject(result),
        code: isObject(result) ? 'previewed' : 'unavailable',
        capability: capability(),
        evidence: buildEvidenceReference({ kind: 'session-branch-preview', id: String(boundary), certainty: 'observed', observedAt: currently() }),
      }))
    } catch {
      return Promise.resolve(deepFreeze({ ok: false, code: 'unavailable', capability: capability() }))
    }
  }
  const apply = (boundary) => {
    const seam = resolveSeam()
    if (!isObject(seam) || typeof seam.apply !== 'function') {
      return Promise.resolve(deepFreeze({ ok: false, code: 'unsupported', capability: capability() }))
    }
    try {
      const result = seam.apply(boundary)
      if (isThenable(result)) {
        return Promise.resolve(deepFreeze({ ok: false, code: 'unknown', capability: capability() }))
      }
      return Promise.resolve(deepFreeze({
        ok: result === true,
        code: result === true ? 'applied' : 'conflict',
        capability: capability(),
      }))
    } catch {
      return Promise.resolve(deepFreeze({ ok: false, code: 'unavailable', capability: capability() }))
    }
  }
  const restore = (boundary) => {
    const seam = resolveSeam()
    if (!isObject(seam) || typeof seam.restore !== 'function') {
      return Promise.resolve(deepFreeze({ ok: false, code: 'unsupported', capability: capability() }))
    }
    try {
      const result = seam.restore(boundary)
      if (isThenable(result)) {
        return Promise.resolve(deepFreeze({ ok: false, code: 'unknown', capability: capability() }))
      }
      return Promise.resolve(deepFreeze({
        ok: result === true,
        code: result === true ? 'restored' : 'conflict',
        capability: capability(),
        evidence: buildEvidenceReference({ kind: 'session-branch-restore', id: String(boundary), certainty: 'observed', observedAt: currently() }),
      }))
    } catch {
      return Promise.resolve(deepFreeze({ ok: false, code: 'unavailable', capability: capability() }))
    }
  }
  return { capability, preview, apply, restore }
}

/**
 * Sidecar evidence intake for the mounter. `fs/write-intent` and
 * `fs/edit-intent` waterfall observers call `next()` and pass its result
 * through unchanged while recording bounded before/after observation evidence;
 * a `tools/pre-execute` observer records source tool/execution provenance.
 * A missing optional hook disables only the corresponding evidence field and
 * never pretends a mutation was observed. `dispose()` is idempotent.
 */
export function createMutationEvidenceIntake({ ctx, logger, now } = {}) {
  const currently = () => nowIso(now)
  const observations = []
  const detachers = []
  let disposed = false

  const recordObservation = (entry) => {
    observations.push(deepFreeze({
      kind: String(entry.kind).slice(0, 60),
      resource: entry.resource,
      before: deepFreeze(entry.before ?? {}),
      after: deepFreeze(entry.after ?? {}),
      source: deepFreeze(entry.source ?? {}),
      observedAt: currently(),
    }))
    if (observations.length > 64) observations.splice(0, observations.length - 64)
  }

  if (typeof ctx?.on === 'function') {
    for (const eventName of ['fs/write-intent', 'fs/edit-intent']) {
      let detach = () => false
      try {
        detach = ctx.on(eventName, (payload, next) => {
          try {
            if (isObject(payload)) {
              recordObservation({
                kind: eventName,
                resource: payload.resource ?? payload.path,
                before: payload.before,
                after: payload.after,
                source: payload.source ?? {},
              })
            }
          } catch (error) {
            try {
              logger?.error?.(`dsh-plugin-api workspace-transaction: ${eventName} evidence intake failed (${String(error?.message ?? error).slice(0, 160)})`)
            } catch {
              // diagnostics must never interrupt the fail-safe path
            }
          }
          if (typeof next === 'function') return next()
          return undefined
        })
      } catch {
        try {
          logger?.error?.(`dsh-plugin-api workspace-transaction: cannot attach ${eventName} evidence intake`)
        } catch {
          // diagnostics must never interrupt the fail-safe path
        }
      }
      detachers.push(() => {
        try {
          detach()
        } catch {
          // best-effort detach
        }
      })
    }
    try {
      detachers.push(ctx.on('tools/pre-execute', (payload, next) => {
        try {
          if (isObject(payload)) {
            recordObservation({
              kind: 'tool-execution',
              resource: payload.toolId,
              before: {},
              after: {},
              source: {
                toolId: payload.toolId,
                executionId: payload.executionId,
                sessionId: payload.sessionId,
              },
            })
          }
        } catch (error) {
          try {
            logger?.error?.(`dsh-plugin-api workspace-transaction: tools/pre-execute evidence intake failed (${String(error?.message ?? error).slice(0, 160)})`)
          } catch {
            // diagnostics must never interrupt the fail-safe path
          }
        }
        if (typeof next === 'function') return next()
        return undefined
      }))
    } catch {
      try {
        logger?.error?.('dsh-plugin-api workspace-transaction: cannot attach tools/pre-execute evidence intake')
      } catch {
        // diagnostics must never interrupt the fail-safe path
      }
    }
  }

  const latest = (kind) => {
    for (let index = observations.length - 1; index >= 0; index -= 1) {
      if (observations[index].kind === kind) return observations[index]
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
    observations,
    latest,
    dispose,
    get size() {
      return observations.length
    },
  }
}