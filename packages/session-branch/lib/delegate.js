/**
 * Thin member-by-member delegation over the official
 * `@deepseek-ai/dsh-session@0.1.0-rc.6` `SessionStore`, plus the branch/edit
 * sub-interface `sessions.branches`.
 *
 * # Replication baseline (locked owner `0.1.0-rc.6`, verified in this file's
 * # repo on 2026-08-26):
 * - `SessionStore extends Service`, constructor `super(ctx, 'sessions')`
 *   registers `ctx.sessions` on the current fiber; the store owns every
 *   publication hook — `session/created` (emit, sync throw veto rolls the
 *   paired effect back), `session/disposed` (emit, contained),
 *   `session/event` (post-commit fire-and-forget, contained), `session/flush`
 *   (parallel awaited) — and the typert `session` lookup. The replacement
 *   re-registers the official instance unchanged and only swaps the exposed
 *   value, so the event face and typert face stay official (zero re-dispatch,
 *   no double-run).
 * - Fidelity guarantees come from delegation, not from re-implementation:
 *   `create/prepare/enter/announce/flush/get/list/fork` forward with receiver,
 *   timing, and typed error identity preserved (`SessionForkError` codes
 *   `SESSION_NOT_FOUND|SESSION_NOT_LIVE|SESSION_ALREADY_EXISTS|INVALID_BOUNDARY|OPEN_TURN`).
 * - Custom metadata events (`branch/created`, `branch/failed`) round-trip
 *   through the official storage path (append -> packChunkRuns ->
 *   decodeStorageRecord -> Session.fromRestore, data equal); edit commits use
 *   surface-eligible `user/message` events carrying the audit block in
 *   `data.edit` (verified: custom types cannot carry surfaceOp; replace
 *   collapses N->1 and cannot expand — content-level rollback restore per the
 *   approved design revision).
 */

import { randomUUID } from 'node:crypto'
import { SessionStore } from '@deepseek-ai/dsh-session'
import {
  BranchChildConflictError,
  BranchFailedError,
  BranchKindInvalidError,
  BranchSourceUnknownError,
  EditCommitFailedError,
  EditCommitUnknownError,
  EditExternalPendingError,
  EditKindInvalidError,
  EditPlanTerminalError,
  EditPlanUnknownError,
  EditRangeInvalidError,
  EditRestoreInvalidError,
  EditTargetUnknownError,
  EditVersionConflictError,
  rollbackAlreadyReverted,
} from './errors.js'
import {
  DEFAULT_BRANCH_VISIBILITY,
  encodeBranchCreated,
  encodeBranchFailed,
  foldBranchGraph,
  inheritanceGapsOf,
  normalizeBranchOptions,
} from './branch-log.js'
import {
  buildCommitEventData,
  buildRestoreEventData,
  buildRevertEventData,
  findCommitEvent,
  getPlan,
  hasRevertMark,
  pendingExternalRefs,
  previewFromSurface,
  registerPlan,
  settlePlan,
  synthesizeRestoreContent,
  validateEditKind,
  verifyRestoreChain,
} from './edit-plan.js'

/** Sole contract symbol between this bundle and the main facade. */
export const SESSION_BRANCH_MARKER = Symbol.for('dsh-plugin-api.session-branch.contract')

/** Owner token prefix for opaque identity generation (owner-domain, never global). */
const OWNER_TOKEN = 'session-branch'

const makeId = (prefix) => `${prefix}-${randomUUID()}`
const makeGeneration = () => `${OWNER_TOKEN}:${randomUUID()}`

/**
 * Instantiate the official session store. It self-registers `ctx.sessions`
 * (fiber-owned); the caller replaces the exposed value with the delegate.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @returns {InstanceType<typeof SessionStore>}
 */
export function createOfficialSessionStore(ctx) {
  return new SessionStore(ctx)
}

function fakeLogger(logger) {
  return {
    warn(message) {
      try {
        logger?.warn?.(message)
      } catch {
        // diagnostics never change branch outcomes
      }
    },
  }
}

/** The live-surface node seqs of a session (numbers in surface order). */
function surfaceSeqs(session) {
  try {
    return [...session.surface.nodes]
  } catch {
    return null
  }
}

/**
 * Build the plain-object delegate that replaces `ctx.sessions`: official
 * members forward verbatim; `branches` adds the branch/edit contract; the
 * contract symbol marks the replacement for the main facade.
 * @param {{ ctx: import('@deepseek-ai/cordis').Context,
 *           official: InstanceType<typeof SessionStore>,
 *           logger?: object }} deps
 * @returns {Record<string, unknown>}
 */
export function buildSessionDelegate({ ctx, official, logger }) {
  const log = fakeLogger(logger)
  const branches = createBranchesOwner({ ctx, official, logger: log })
  const delegate = {
    name: 'sessions',
    create(id, options) {
      return official.create(id, options)
    },
    prepare(id, options) {
      return official.prepare(id, options)
    },
    enter(session) {
      return official.enter(session)
    },
    announce(session) {
      return official.announce(session)
    },
    flush(session) {
      return official.flush(session)
    },
    get(id) {
      return official.get(id)
    },
    list() {
      return official.list()
    },
    fork(source, boundary, childSessionId) {
      return official.fork(source, boundary, childSessionId)
    },
    branches,
  }
  Object.defineProperty(delegate, SESSION_BRANCH_MARKER, { value: true })
  return delegate
}

/**
 * Resolve a live session from either a live session object or a store id.
 * @param {import('@deepseek-ai/cordis').Context} ctx ignored (kept for future owner seams)
 * @param {InstanceType<typeof SessionStore>} official
 * @param {unknown} source
 * @returns {import('@deepseek-ai/dsh-session').Session}
 * @throws {BranchSourceUnknownError}
 */
function resolveLiveSession(official, source) {
  if (typeof source === 'string') {
    const session = official.get(source)
    if (session === undefined) {
      throw new BranchSourceUnknownError(`session "${source}" is not live in this store`)
    }
    return session
  }
  if (source !== null && typeof source === 'object' && typeof source.id === 'string') {
    const live = official.get(source.id)
    if (live === undefined) {
      throw new BranchSourceUnknownError(`session "${source.id}" is not live in this store`)
    }
    if (live !== source) {
      throw new BranchSourceUnknownError(`session "${source.id}" is not the live store instance`)
    }
    return source
  }
  throw new BranchSourceUnknownError('branch source must be a live session or a live session id')
}

/**
 * Create the `sessions.branches` sub-interface owner.
 * Fail-safe: every public entry either returns a frozen result or throws a
 * typed `SessionBranchError`; plugin-facing failures never escape as raw
 * exceptions.
 * @param {{ ctx: import('@deepseek-ai/cordis').Context,
 *           official: InstanceType<typeof SessionStore>,
 *           logger?: { warn: (message: string) => void } }} deps
 */
export function createBranchesOwner({ ctx, official, logger }) {
  const plans = new Map()
  const pendingRecovery = new Set()
  const log = fakeLogger(logger)
  const flagRecovery = (sessionId) => {
    pendingRecovery.add(sessionId)
    if (pendingRecovery.size > 64) pendingRecovery.delete(pendingRecovery.values().next().value)
  }

  /** @type {Record<string, unknown>} */
  const branches = {
    availability() {
      return Object.freeze({
        active: true,
        contract: true,
        recoveryPending: Object.freeze([...pendingRecovery]),
      })
    },

    /** -- branch creation -- */

    create(parent, boundary, options = {}) {
      const normalized = normalizeBranchOptions(options)
      if (!normalized.ok) {
        throw new BranchKindInvalidError(normalized.detail, normalized.code === 'BRANCH_KIND_INVALID' ? undefined : { cause: `code:${normalized.code}` })
      }
      const parentSession = resolveLiveSession(official, parent)
      const boundarySeq = boundary === undefined ? (parentSession.events.at(-1)?.seq ?? -1) : boundary
      if (!Number.isSafeInteger(boundarySeq) || boundarySeq < 0) {
        throw new BranchSourceUnknownError(`branch boundary ${String(boundary)} is not a valid seq for session "${parentSession.id}"`)
      }
      const lastSeq = parentSession.events.at(-1)?.seq
      if (lastSeq === undefined || boundarySeq > lastSeq || parentSession.events[boundarySeq]?.seq !== boundarySeq) {
        // Pre-validation of the requested boundary (fail-closed, before any log
        // write); the official `fork` member below still surfaces the official
        // typed codes (INVALID_BOUNDARY/OPEN_TURN/...) with a compensation record
        // when a state change races in between.
        throw new BranchFailedError(`branch boundary ${boundarySeq} does not exist in session "${parentSession.id}"`)
      }
      if (options.kind === undefined) {
        throw new BranchKindInvalidError('branch kind is required')
      }
      const branchId = makeId('branch')
      const inherited = normalized.options.inheritance
      const gaps = inheritanceGapsOf(inherited)
      const childSessionId = typeof normalized.options.childSessionId === 'string'
        ? normalized.options.childSessionId
        : undefined
      if (childSessionId !== undefined && official.get(childSessionId) !== undefined) {
        throw new BranchChildConflictError(`child session "${childSessionId}" already exists`)
      }

      const record = {
        branchId,
        kind: normalized.options.kind,
        parentSessionId: parentSession.id,
        boundarySeq,
        childSessionId: childSessionId ?? makeId('session'),
        causalSourceSeqs: [boundarySeq],
        visibility: normalized.options.visibility,
        ...(normalized.options.retention === undefined ? {} : { retention: normalized.options.retention }),
        inheritance: inherited,
        ...(gaps.length > 0
          ? { gaps: Object.freeze(Object.fromEntries(gaps.map((member) => [member, true]))) }
          : {}),
      }
      const createdData = Object.freeze({ ...encodeBranchCreated(record), ...(gaps.length > 0 ? { gaps: record.gaps } : {}) })
      const createdEvent = parentSession.append('branch/created', createdData)
      let child
      try {
        child = official.fork(parentSession, boundarySeq, record.childSessionId)
      } catch (error) {
        try {
          parentSession.append('branch/failed', encodeBranchFailed({
            branchId,
            kind: normalized.options.kind,
            parentSessionId: parentSession.id,
            boundarySeq,
            reason: error instanceof Error ? error.message : String(error),
            ...(official.get(record.childSessionId) !== undefined ? { childSessionId: record.childSessionId } : {}),
            at: Date.now(),
          }))
        } catch (compensationError) {
          log.warn(`session-branch: compensation append failed after branch fork error: ${compensationError?.message ?? 'Error'}`)
        }
        throw error
      }
      return Object.freeze({
        branch: Object.freeze({
          branchId: record.branchId,
          kind: record.kind,
          parentSessionId: record.parentSessionId,
          boundarySeq: record.boundarySeq,
          childSessionId: child.id,
          causalSourceSeqs: Object.freeze([...record.causalSourceSeqs]),
          visibility: record.visibility,
          ...(record.retention === undefined ? {} : { retention: record.retention }),
          inheritance: record.inheritance,
          ...(gaps.length > 0 ? { gaps: record.gaps } : {}),
          state: 'active',
          recordSeq: createdEvent.seq,
        }),
        child,
      })
    },

    /** -- branch graph projection -- */

    graph(sessionId) {
      const session = official.get(sessionId)
      if (session === undefined) {
        throw new BranchSourceUnknownError(`session "${sessionId}" is not live in this store`)
      }
      const folded = foldBranchGraph(session.events)
      const ancestors = []
      let cursor = session.header?.parentSession
      const guard = new Set()
      while (typeof cursor === 'string' && cursor.length > 0 && !guard.has(cursor)) {
        guard.add(cursor)
        ancestors.push(cursor)
        const parent = official.get(cursor)
        cursor = parent?.header?.parentSession
        if (parent === undefined) break
      }
      return Object.freeze({
        sessionId,
        branches: folded.branches,
        current: folded.current,
        children: Object.freeze(folded.branches
          .filter((record) => record.state === 'active')
          .map((record) => record.childSessionId)),
        ancestors: Object.freeze(ancestors),
      })
    },

    /** -- edit plans -- */

    plan(sessionOrId, input = {}) {
      const session = resolveLiveSession(official, sessionOrId)
      const kind = validateEditKind(input.kind, pluginsDefaultKind(ctx, 'edit'))
      if (!kind.ok) throw new EditKindInvalidError(kind.detail)
      const expectedVersion = input.expectedVersion ?? session.seq
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion !== session.seq) {
        throw new EditVersionConflictError(
          `plan expectedVersion ${String(expectedVersion)} does not match current seq ${session.seq} of session "${session.id}"`,
        )
      }
      const result = registerPlan(plans, {
        planId: input.planId ?? makeId('plan'),
        targetSessionId: session.id,
        expectedVersion,
        range: input.range,
        kind: kind.kind,
        replacement: input.replacement,
        externals: input.externals,
        generation: makeGeneration(),
      })
      if (!result.ok) {
        if (result.code === 'EDIT_RANGE_INVALID') throw new EditRangeInvalidError(result.detail)
        if (result.code === 'EDIT_KIND_INVALID') throw new EditKindInvalidError(result.detail)
        throw new EditPlanUnknownError(result.detail)
      }
      return Object.freeze({
        planId: result.plan.planId,
        targetSessionId: result.plan.targetSessionId,
        expectedVersion: result.plan.expectedVersion,
        state: result.plan.state,
      })
    },

    preview(planIdOrHandle) {
      const planId = typeof planIdOrHandle === 'string' ? planIdOrHandle : planIdOrHandle?.planId
      const plan = getPlan(plans, planId)
      if (plan === null) throw new EditPlanUnknownError(`plan "${String(planId)}" is not registered`)
      const session = official.get(plan.targetSessionId)
      if (session === undefined) throw new EditTargetUnknownError(`target session "${plan.targetSessionId}" is not live`)
      const seqs = surfaceSeqs(session)
      const result = previewFromSurface(seqs ?? [], plan.range, plan.replacement)
      if (!result.ok) throw new EditRangeInvalidError(result.detail)
      return result.preview
    },

    commit(planIdOrHandle, { actor } = {}) {
      const planId = typeof planIdOrHandle === 'string' ? planIdOrHandle : planIdOrHandle?.planId
      const plan = getPlan(plans, planId)
      if (plan === null) throw new EditPlanUnknownError(`plan "${String(planId)}" is not registered`)
      if (plan.state !== 'draft') throw new EditPlanTerminalError(`plan "${planId}" is already ${plan.state}`)
      const session = official.get(plan.targetSessionId)
      if (session === undefined) throw new EditTargetUnknownError(`target session "${plan.targetSessionId}" is not live`)
      if (plan.expectedVersion !== session.seq) {
        throw new EditVersionConflictError(
          `plan "${planId}" expected seq ${plan.expectedVersion} but session "${session.id}" is at ${session.seq}`,
        )
      }
      const seqs = surfaceSeqs(session)
      const positional = seqs === null
        ? { ok: false, detail: 'surface unavailable' }
        : previewFromSurface(seqs, plan.range, plan.replacement)
      if (!positional.ok) {
        throw new EditVersionConflictError(`plan "${planId}" range is stale against the live surface: ${positional.detail}`)
      }
      const commitId = makeId('commit')
      const at = Date.now()
      const data = buildCommitEventData({ plan, commitId, actor: actor ?? 'anonymous', at })
      let event
      try {
        event = session.append('user/message', data, {
          surfaceOp: { op: 'replace', start: plan.range.fromSeq, end: plan.range.toSeq },
          sourceEventSeqs: [...positional.preview.shadowedSeqs],
        })
      } catch (error) {
        settlePlan(plans, planId, 'error')
        throw new EditCommitFailedError(
          `plan "${planId}" commit append was rejected: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        )
      }
      settlePlan(plans, planId, 'success')
      return Object.freeze({
        outcome: 'committed',
        planId,
        commitId,
        seq: event.seq,
        generation: plan.generation,
        range: Object.freeze({ fromSeq: plan.range.fromSeq, toSeq: plan.range.toSeq }),
      })
    },

    /** -- rollback (content-level restore, idempotent) -- */

    rollback(commitId, { actor, kind } = {}) {
      const located = locateCommitSession(official, commitId)
      if (located === null) throw new EditCommitUnknownError(`commit "${commitId}" is not present in any live session log`)
      const { session, event } = located
      if (hasRevertMark(session.events, commitId)) {
        return rollbackAlreadyReverted(commitId)
      }
      const seqs = surfaceSeqs(session) ?? []
      if (!seqs.includes(event.seq)) {
        // The commit node was itself shadowed by a later rewrite: reverting it
        // would tear down a newer legitimate commit.
        return rollbackAlreadyReverted(commitId, 'commit superseded by a later surface rewrite')
      }
      const shadowedSeqs = Array.isArray(event.sourceEventSeqs) ? event.sourceEventSeqs : []
      const originals = shadowedSeqs
        .map((seq) => session.deriveEventMessage(session.events[seq]))
        .filter((message) => message !== null)
      const restoredContent = synthesizeRestoreContent(originals)
      const validatedKind = validateEditKind(kind, event.data.edit.kind)
      if (!validatedKind.ok) throw new EditKindInvalidError(validatedKind.detail)
      const revertId = makeId('revert')
      const at = Date.now()
      const data = buildRevertEventData({
        kind: validatedKind.kind,
        commitId,
        revertId,
        at,
        actor: actor ?? 'anonymous',
        externals: Array.isArray(event.data.edit.externals) ? event.data.edit.externals : [],
        restoredContent,
      })
      let revertEvent
      try {
        revertEvent = session.append('user/message', data, {
          surfaceOp: { op: 'replace', start: event.seq, end: event.seq },
          sourceEventSeqs: [event.seq],
        })
      } catch (error) {
        throw new EditCommitFailedError(
          `revert of commit "${commitId}" was rejected: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        )
      }
      return Object.freeze({
        outcome: 'reverted',
        commitId,
        revertId,
        seq: revertEvent.seq,
        externalPending: pendingExternalRefs([event]),
      })
    },

    /** -- restore (verify-then-append, no auto-retry) -- */

    restore(commitId, { acknowledgments = [], actor, kind } = {}) {
      const located = locateCommitSession(official, commitId)
      if (located === null) throw new EditCommitUnknownError(`commit "${commitId}" is not present in any live session log`)
      const { session, event } = located
      if (hasRevertMark(session.events, commitId)) {
        throw new EditRestoreInvalidError(`commit "${commitId}" was reverted; restore is not valid against a reverted commit`)
      }
      const verified = verifyRestoreChain(session.events, [commitId])
      if (!verified.ok) {
        flagRecovery(session.id)
        if (verified.code === 'EDIT_COMMIT_UNKNOWN') throw new EditCommitUnknownError(verified.detail)
        throw new EditRestoreInvalidError(verified.detail)
      }
      const pending = pendingExternalRefs([event])
      const ackSet = new Set(Array.isArray(acknowledgments) ? acknowledgments : [])
      const missing = pending.filter((ref) => !ackSet.has(ref.id))
      if (missing.length > 0) {
        flagRecovery(session.id)
        throw new EditExternalPendingError(
          `restore of "${commitId}" requires explicit acknowledgment for: ${missing.map((ref) => `${ref.id}(${ref.sideEffectClass})`).join(', ')}`,
        )
      }
      const seqs = surfaceSeqs(session)
      if (seqs === null || !seqs.includes(event.seq)) {
        flagRecovery(session.id)
        throw new EditRestoreInvalidError(`restore target of "${commitId}" is no longer on the live surface`)
      }
      const validatedKind = validateEditKind(kind, event.data.edit.kind)
      if (!validatedKind.ok) throw new EditKindInvalidError(validatedKind.detail)
      const restoreId = makeId('restore')
      const data = buildRestoreEventData({
        kind: validatedKind.kind,
        commitId,
        restoreId,
        at: Date.now(),
        actor: actor ?? 'anonymous',
        message: event.data,
      })
      let restoreEvent
      try {
        restoreEvent = session.append('user/message', data, {
          surfaceOp: { op: 'replace', start: event.seq, end: event.seq },
          sourceEventSeqs: [event.seq],
        })
      } catch (error) {
        flagRecovery(session.id)
        throw new EditCommitFailedError(
          `restore of "${commitId}" was rejected: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        )
      }
      return Object.freeze({
        outcome: 'restored',
        commitId,
        restoreId,
        seq: restoreEvent.seq,
        externalAcknowledged: Object.freeze([...missing]),
      })
    },
  }

  return branches
}

/**
 * The default caller `kind` classification: the caller's plugin id when
 * resolvable, else a neutral default.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {string} fallback
 * @returns {string}
 */
function pluginsDefaultKind(ctx, fallback) {
  try {
    const id = ctx?.fiber?.entry?.options?.id
    if (typeof id === 'string' && id.length > 0 && id !== 'plugin-api-session-branch') return id
  } catch {
    // fall through to the neutral default
  }
  return fallback
}

/**
 * Locate the live session whose log contains an edit-commit event with the
 * given commitId.
 * @param {InstanceType<typeof SessionStore>} official
 * @param {string} commitId
 * @returns {{ session: import('@deepseek-ai/dsh-session').Session,
 *             event: Readonly<Record<string, unknown>> } | null}
 */
function locateCommitSession(official, commitId) {
  for (const session of official.list()) {
    const event = findCommitEvent(session.events, commitId)
    if (event !== null) return { session, event }
  }
  return null
}

export { DEFAULT_BRANCH_VISIBILITY }