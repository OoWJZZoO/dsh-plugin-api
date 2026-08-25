/**
 * Edit plan state machine — pure core (zero harness dependencies).
 *
 * Plans are in-memory handles bound to an expected version (CAS); a commit is
 * ONE surface-eligible `user/message` append that collapses the target range
 * (replace) and carries the audit block inside the same event data, so the
 * durable mutation and its audit record are atomically visible together.
 * Rollback is a content-level restore node (single reverse replace) marked
 * durably and idempotent via its own event (see design "Edit plan / commit /
 * rollback = append-only 补偿", route B).
 *
 * Event vocabulary (embedded in `data.edit`):
 *   op: 'commit' | 'revert' | 'restore'
 *   kind: caller-provided classification (user / caller plugin id / goal ...)
 */

import { validationFailure } from './errors.js'

/** Terminal outcomes of an edit plan; final and unique. Non-terminal is only 'draft'. */
export const PLAN_TERMINAL_STATES = Object.freeze([
  'success',
  'error',
  'aborted',
  'denied',
  'superseded',
])

/** Non-terminal plan state. */
export const PLAN_DRAFT_STATE = 'draft'

/** External side-effect vocabulary aligned with the delivered transaction bundle. */
export const SIDE_EFFECT_CLASSES = Object.freeze([
  'none',
  'read-only',
  'rollbackable',
  'external',
  'unknown',
])

const MAX_EDIT_KIND_LENGTH = 64
const MAX_PLAN_ID_BYTES = 128
const MAX_REPLACEMENT_BLOCKS = 32
const MAX_EXTERNALS = 16

/**
 * Resolve the terminal outcome within one submission window:
 * `aborted > superseded > error`; a timeout is recorded as `error`.
 * @param {{ aborted?: boolean, superseded?: boolean, error?: boolean, timeout?: boolean }} signals
 * @returns {string} a terminal state
 */
export function decideTerminalOutcome({ aborted = false, superseded = false, error = false, timeout = false } = {}) {
  if (aborted) return 'aborted'
  if (superseded) return 'superseded'
  return error || timeout ? 'error' : 'success'
}

/**
 * Validate a caller-provided edit `kind` classification.
 * Non-empty string within 64 code points; absent falls back to the caller
 * default (usually the caller's plugin id).
 * @param {unknown} kind
 * @param {string} [fallback]
 * @returns {{ ok: true, kind: string } | { ok: false, code: string, detail: string }}
 */
export function validateEditKind(kind, fallback = undefined) {
  if (kind === undefined) {
    if (fallback === undefined) {
      return validationFailure('EDIT_KIND_INVALID', 'edit kind must be supplied or resolvable from the caller')
    }
    return validateEditKind(fallback)
  }
  if (typeof kind !== 'string' || kind.length === 0 || kind.length > MAX_EDIT_KIND_LENGTH) {
    return validationFailure('EDIT_KIND_INVALID', `edit kind must be a non-empty string within ${MAX_EDIT_KIND_LENGTH} characters`)
  }
  return { ok: true, kind }
}

/**
 * Validate one external-effect reference.
 * @param {unknown} input
 * @returns {{ ok: true, external: Readonly<{ id: string, sideEffectClass: string, description?: string }> } | { ok: false, code: string, detail: string }}
 */
export function validateExternalRef(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return validationFailure('EDIT_EXTERNAL_INVALID', 'external ref must be an object')
  }
  const { id, sideEffectClass, description } = input
  if (typeof id !== 'string' || id.length === 0) {
    return validationFailure('EDIT_EXTERNAL_INVALID', 'external ref id must be a non-empty string')
  }
  if (typeof sideEffectClass !== 'string' || !SIDE_EFFECT_CLASSES.includes(sideEffectClass)) {
    return validationFailure('EDIT_EXTERNAL_INVALID', `sideEffectClass must be one of ${SIDE_EFFECT_CLASSES.join('|')}`)
  }
  if (description !== undefined && (typeof description !== 'string' || description.length === 0)) {
    return validationFailure('EDIT_EXTERNAL_INVALID', 'external ref description must be a non-empty string when provided')
  }
  const normalized = { id, sideEffectClass }
  return {
    ok: true,
    external: Object.freeze(description === undefined ? normalized : { ...normalized, description }),
  }
}

/**
 * Validate a plan input and register it against the expected version (CAS at
 * creation). Range and replacement validation are shape-level; the live
 * surface check happens at commit time against the current node list.
 * @param {Map<string, Readonly<Record<string, unknown>>>} registry
 * @param {{ planId: string, targetSessionId: string, expectedVersion: number,
 *           range: { fromSeq: number, toSeq: number }, kind: string,
 *           replacement: { role: 'user', content: readonly unknown[] },
 *           externals?: unknown, generation: string }} input
 * @returns {{ ok: true, plan: Readonly<Record<string, unknown>> } | { ok: false, code: string, detail: string }}
 */
export function registerPlan(registry, input) {
  if (typeof input?.planId !== 'string' || input.planId.length === 0 || input.planId.length > MAX_PLAN_ID_BYTES) {
    return validationFailure('EDIT_PLAN_INVALID', 'planId must be a non-empty string')
  }
  if (registry.has(input.planId)) {
    return validationFailure('EDIT_PLAN_CONFLICT', `plan "${input.planId}" is already registered`)
  }
  if (typeof input.targetSessionId !== 'string' || input.targetSessionId.length === 0) {
    return validationFailure('EDIT_PLAN_INVALID', 'targetSessionId must be a non-empty string')
  }
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) {
    return validationFailure('EDIT_PLAN_INVALID', 'expectedVersion must be a non-negative safe integer')
  }
  const range = input.range
  if (!range || !Number.isSafeInteger(range.fromSeq) || !Number.isSafeInteger(range.toSeq)
    || range.fromSeq < 0 || range.toSeq < range.fromSeq) {
    return validationFailure('EDIT_RANGE_INVALID', 'range must be a non-empty seq interval { fromSeq, toSeq }')
  }
  const kind = validateEditKind(input.kind)
  if (!kind.ok) return kind
  const replacement = input.replacement
  if (!replacement || typeof replacement !== 'object'
    || !Array.isArray(replacement.content) || replacement.content.length === 0
    || replacement.content.length > MAX_REPLACEMENT_BLOCKS) {
    return validationFailure('EDIT_REPLACEMENT_INVALID', `replacement content must hold 1..${MAX_REPLACEMENT_BLOCKS} content blocks`)
  }
  const externals = []
  if (input.externals !== undefined) {
    if (!Array.isArray(input.externals) || input.externals.length > MAX_EXTERNALS) {
      return validationFailure('EDIT_EXTERNAL_INVALID', `externals must be an array of at most ${MAX_EXTERNALS} refs`)
    }
    for (const ref of input.externals) {
      const result = validateExternalRef(ref)
      if (!result.ok) return result
      externals.push(result.external)
    }
  }
  const plan = Object.freeze({
    planId: input.planId,
    targetSessionId: input.targetSessionId,
    expectedVersion: input.expectedVersion,
    range: Object.freeze({ fromSeq: range.fromSeq, toSeq: range.toSeq }),
    kind: kind.kind,
    replacement: Object.freeze({ role: 'user', content: Object.freeze([...replacement.content]) }),
    externals: Object.freeze(externals),
    generation: input.generation,
    state: PLAN_DRAFT_STATE,
  })
  registry.set(plan.planId, plan)
  return { ok: true, plan }
}

/**
 * Resolve one plan record from the registry.
 * @param {Map<string, Readonly<Record<string, unknown>>>} registry
 * @param {string} planId
 * @returns {Readonly<Record<string, unknown>> | null}
 */
export function getPlan(registry, planId) {
  return registry.get(planId) ?? null
}

/**
 * Mark a plan terminal. Final and unique: a terminal plan never changes again,
 * and late submissions lose qualification.
 * @param {Map<string, Readonly<Record<string, unknown>>>} registry
 * @param {string} planId
 * @param {string} outcome one of PLAN_TERMINAL_STATES
 * @returns {{ ok: boolean, plan: Readonly<Record<string, unknown>> | null, changed: boolean }}
 */
export function settlePlan(registry, planId, outcome) {
  const current = registry.get(planId)
  if (current === undefined) return { ok: false, plan: null, changed: false }
  if (current.state !== PLAN_DRAFT_STATE) return { ok: false, plan: current, changed: false }
  const terminal = PLAN_TERMINAL_STATES.includes(outcome) ? outcome : 'error'
  const plan = Object.freeze({ ...current, state: terminal })
  registry.set(planId, plan)
  return { ok: true, plan, changed: true }
}

/**
 * Pure preview: derive the affected surface positions and resulting node
 * sequence for a plan against the CURRENT surface node list. Read-only.
 * @param {readonly { seq: number }[] | readonly number[]} surfaceNodes current surface node list (seqs)
 * @param {{ fromSeq: number, toSeq: number }} range
 * @returns {{ ok: true, preview: Readonly<{ fromSeq: number, toSeq: number,
 *           shadowedSeqs: readonly number[], resultingNodes: readonly number[],
 *           replacementMessage: Readonly<Record<string, unknown>> }> }
 *           | { ok: false, code: string, detail: string }}
 */
export function previewFromSurface(surfaceNodes, range, replacement) {
  const seqs = surfaceNodes.map((node) => (typeof node === 'number' ? node : node?.seq))
  const fromIdx = seqs.indexOf(range.fromSeq)
  if (fromIdx === -1) {
    return validationFailure('EDIT_RANGE_INVALID', `range start seq ${range.fromSeq} is not a current surface node`)
  }
  const toIdx = seqs.indexOf(range.toSeq)
  if (toIdx === -1 || toIdx < fromIdx) {
    return validationFailure('EDIT_RANGE_INVALID', `range end seq ${range.toSeq} is not a surface node at or after the start`)
  }
  const shadowedSeqs = Object.freeze(seqs.slice(fromIdx, toIdx + 1))
  const resultingNodes = Object.freeze([
    ...seqs.slice(0, fromIdx),
    ...(replacement === undefined ? [] : ['<replacement>']),
    ...seqs.slice(toIdx + 1),
  ])
  return {
    ok: true,
    preview: Object.freeze({
      fromSeq: range.fromSeq,
      toSeq: range.toSeq,
      shadowedSeqs,
      resultingNodes,
      replacementMessage: replacement === undefined ? null : Object.freeze({ ...replacement }),
    }),
  }
}

/**
 * Build the single-append commit event data: a `user/message` payload whose
 * `edit` audit block makes the event recognizable as an edit commit. Caller
 * carries surface metadata (`replace` over the shadowed range).
 * @param {{ plan: Readonly<Record<string, unknown>>, commitId: string,
 *           actor: string, at: number }} input
 * @returns {Readonly<Record<string, unknown>>} frozen data
 */
export function buildCommitEventData({ plan, commitId, actor, at }) {
  const range = plan.range
  return Object.freeze({
    id: `message-${commitId}`,
    role: 'user',
    source: Object.freeze({ kind: 'plugin', plugin: 'dsh-plugin-api-session-branch' }),
    content: plan.replacement.content,
    edit: Object.freeze({
      op: 'commit',
      kind: plan.kind,
      planId: plan.planId,
      commitId,
      range: Object.freeze({ fromSeq: range.fromSeq, toSeq: range.toSeq }),
      generation: plan.generation,
      actor,
      at,
      externals: plan.externals,
    }),
  })
}

/**
 * Synthesize the content-level restore node content blocks for the messages
 * shadowed by a commit: one annotated text block per original message
 * (role and boundary annotated truthfully; never fabricating per-message
 * shape).
 * @param {readonly { role?: string, content?: readonly { type?: string, text?: string }[] }[]} originals
 * @returns {readonly Readonly<Record<string, unknown>>[]} frozen content blocks
 */
export function synthesizeRestoreContent(originals) {
  const blocks = []
  for (const [index, original] of (originals ?? []).entries()) {
    const parts = []
    for (const block of original?.content ?? []) {
      if (block?.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
        parts.push(block.text)
      }
    }
    const body = parts.join('\n')
    if (body.length === 0) continue
    blocks.push(Object.freeze({
      type: 'text',
      text: `[${index + 1}/${(originals ?? []).length}][${original?.role ?? 'unknown'}] ${body}`,
    }))
  }
  return Object.freeze(blocks)
}

/**
 * Build the single-append revert event data: a content-level restore node
 * whose `edit` block marks this commit as reverted (idempotency marker).
 * @param {{ kind: string, commitId: string, revertId: string, at: number,
 *           actor: string, externals: readonly Readonly<Record<string, unknown>>[],
 *           restoredContent: readonly Readonly<Record<string, unknown>>[] }} input
 * @returns {Readonly<Record<string, unknown>>} frozen data
 */
export function buildRevertEventData({ kind, commitId, revertId, at, actor, externals, restoredContent }) {
  return Object.freeze({
    id: `message-${revertId}`,
    role: 'user',
    source: Object.freeze({ kind: 'plugin', plugin: 'dsh-plugin-api-session-branch' }),
    content: restoredContent,
    edit: Object.freeze({
      op: 'revert',
      kind,
      commitId,
      revertId,
      at,
      actor,
      externals: Object.freeze([...externals]),
    }),
  })
}

/**
 * Build the single-append restore event data (re-applies the historical
 * commit's own state after verification).
 * @param {{ kind: string, commitId: string, restoreId: string, at: number, actor: string,
 *           message: Readonly<Record<string, unknown>> }} input
 * @returns {Readonly<Record<string, unknown>>} frozen data
 */
export function buildRestoreEventData({ kind, commitId, restoreId, at, actor, message }) {
  return Object.freeze({
    ...message,
    edit: Object.freeze({
      op: 'restore',
      kind,
      commitId,
      restoreId,
      at,
      actor,
      externals: Object.freeze([]),
    }),
  })
}

function isCommitLike(event) {
  return event?.type === 'user/message'
    && event?.data?.edit instanceof Object
    && typeof event.data.edit.op === 'string'
}

/**
 * Locate the session event carrying an edit block with the given commitId.
 * @param {readonly { type?: string, data?: { edit?: { commitId?: unknown } } }[]} events
 * @param {string} commitId
 * @returns {Readonly<Record<string, unknown>> | null}
 */
export function findCommitEvent(events, commitId) {
  for (const event of events ?? []) {
    if (!isCommitLike(event)) continue
    if (event.data.edit.commitId === commitId) return event
  }
  return null
}

/**
 * Whether a revert marker exists for a commitId in the log.
 * @param {readonly { data?: { edit?: { op?: unknown, commitId?: unknown } } }[]} events
 * @param {string} commitId
 * @returns {boolean}
 */
export function hasRevertMark(events, commitId) {
  return (events ?? []).some((event) => isCommitLike(event)
    && event.data.edit.op === 'revert'
    && event.data.edit.commitId === commitId)
}

/**
 * Verify a historical commit chain for restore: every commitId exists in
 * order, none of them was reverted, and each commit's shadowed range is fully
 * inside the log.
 * @param {readonly { seq: number, type?: string, data?: { edit?: { op?: unknown, commitId?: unknown } } }[]} events
 * @param {readonly string[]} commitIds
 * @returns {{ ok: true, commits: readonly Readonly<Record<string, unknown>>[] }
 *           | { ok: false, code: string, detail: string }}
 */
export function verifyRestoreChain(events, commitIds) {
  if (!Array.isArray(commitIds) || commitIds.length === 0) {
    return validationFailure('EDIT_RESTORE_INVALID', 'restore requires a non-empty commit sequence')
  }
  const commits = []
  let lastSeq = -1
  for (const commitId of commitIds) {
    if (hasRevertMark(events, commitId)) {
      return validationFailure('EDIT_RESTORE_INVALID', `commit "${commitId}" was reverted; restore is not valid against a reverted commit`)
    }
    const event = findCommitEvent(events, commitId)
    if (event === null) {
      return validationFailure('EDIT_COMMIT_UNKNOWN', `commit "${commitId}" is not present in the session log`)
    }
    if (event.seq <= lastSeq) {
      return validationFailure('EDIT_RESTORE_INVALID', `commit "${commitId}" is out of order in the declared sequence`)
    }
    if (event.data.edit.op !== 'commit') {
      return validationFailure('EDIT_RESTORE_INVALID', `event for "${commitId}" is not a commit marker`)
    }
    lastSeq = event.seq
    commits.push(event)
  }
  return { ok: true, commits: Object.freeze(commits) }
}

/**
 * Audit the external side effects of a commit sequence for restore/rollback:
 * returns refs that require acknowledgment (every class except
 * none/read-only/rollbackable).
 * @param {readonly { data?: { edit?: { externals?: readonly Record<string, unknown>[] } } }[]} events
 * @returns {readonly Readonly<Record<string, unknown>>[]} frozen pending refs
 */
export function pendingExternalRefs(events) {
  const pending = []
  const seen = new Set()
  for (const event of events ?? []) {
    for (const ref of event?.data?.edit?.externals ?? []) {
      const cls = typeof ref?.sideEffectClass === 'string' ? ref.sideEffectClass : 'unknown'
      if (cls === 'none' || cls === 'read-only' || cls === 'rollbackable') continue
      if (seen.has(ref?.id) || typeof ref?.id !== 'string') continue
      seen.add(ref.id)
      pending.push(Object.freeze({ id: ref.id, sideEffectClass: cls }))
    }
  }
  return Object.freeze(pending)
}