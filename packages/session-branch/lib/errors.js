/**
 * Typed error vocabulary for the branch/edit sub-interface
 * `sessions.branches` (replacement bundle
 * `@deepseek-ai/dsh-plugin-api-session-branch`).
 *
 * Every failure that crosses the public branch/edit surface is a typed
 * `SessionBranchError` so callers can switch on the stable capability-word
 * `code`. The single non-throwing outcome is the repeated-rollback no-op, a
 * frozen typed result carried by the idempotency contract.
 */

/** Stable capability-word codes. No governance tokens. */
export const CODES = Object.freeze({
  INACTIVE: 'SESSION_BRANCH_INACTIVE',
  UNSUPPORTED: 'SESSION_BRANCH_UNSUPPORTED',
  BRANCH_KIND_INVALID: 'BRANCH_KIND_INVALID',
  BRANCH_SOURCE_UNKNOWN: 'BRANCH_SOURCE_UNKNOWN',
  BRANCH_CHILD_CONFLICT: 'BRANCH_CHILD_CONFLICT',
  BRANCH_FAILED: 'BRANCH_FAILED',
  EDIT_KIND_INVALID: 'EDIT_KIND_INVALID',
  EDIT_TARGET_UNKNOWN: 'EDIT_TARGET_UNKNOWN',
  EDIT_PLAN_UNKNOWN: 'EDIT_PLAN_UNKNOWN',
  EDIT_PLAN_TERMINAL: 'EDIT_PLAN_TERMINAL',
  EDIT_VERSION_CONFLICT: 'EDIT_VERSION_CONFLICT',
  EDIT_RANGE_INVALID: 'EDIT_RANGE_INVALID',
  EDIT_COMMIT_FAILED: 'EDIT_COMMIT_FAILED',
  EDIT_COMMIT_UNKNOWN: 'EDIT_COMMIT_UNKNOWN',
  EDIT_COMMIT_ALREADY_REVERTED: 'EDIT_COMMIT_ALREADY_REVERTED',
  EDIT_RESTORE_INVALID: 'EDIT_RESTORE_INVALID',
  EDIT_EXTERNAL_PENDING: 'EDIT_EXTERNAL_PENDING',
})

/**
 * Base typed error for the branch/edit surface.
 * @extends Error
 */
export class SessionBranchError extends Error {
  /**
   * @param {string} code stable capability-word code
   * @param {string} message
   * @param {{ cause?: unknown }} [options]
   */
  constructor(code, message, options) {
    super(message, options)
    this.name = 'SessionBranchError'
    this.code = code
  }
}

const define = (name, code) => class extends SessionBranchError {
  constructor(message, options) {
    super(code, message, options)
    this.name = name
  }
}

export const BranchKindInvalidError = define('BranchKindInvalidError', CODES.BRANCH_KIND_INVALID)
export const BranchSourceUnknownError = define('BranchSourceUnknownError', CODES.BRANCH_SOURCE_UNKNOWN)
export const BranchChildConflictError = define('BranchChildConflictError', CODES.BRANCH_CHILD_CONFLICT)
export const BranchFailedError = define('BranchFailedError', CODES.BRANCH_FAILED)
export const EditKindInvalidError = define('EditKindInvalidError', CODES.EDIT_KIND_INVALID)
export const EditTargetUnknownError = define('EditTargetUnknownError', CODES.EDIT_TARGET_UNKNOWN)
export const EditPlanUnknownError = define('EditPlanUnknownError', CODES.EDIT_PLAN_UNKNOWN)
export const EditPlanTerminalError = define('EditPlanTerminalError', CODES.EDIT_PLAN_TERMINAL)
export const EditVersionConflictError = define('EditVersionConflictError', CODES.EDIT_VERSION_CONFLICT)
export const EditRangeInvalidError = define('EditRangeInvalidError', CODES.EDIT_RANGE_INVALID)
export const EditCommitFailedError = define('EditCommitFailedError', CODES.EDIT_COMMIT_FAILED)
export const EditCommitUnknownError = define('EditCommitUnknownError', CODES.EDIT_COMMIT_UNKNOWN)
export const EditRestoreInvalidError = define('EditRestoreInvalidError', CODES.EDIT_RESTORE_INVALID)
export const EditExternalPendingError = define('EditExternalPendingError', CODES.EDIT_EXTERNAL_PENDING)

/**
 * Frozen typed no-op for a repeated rollback of an already-reverted commit.
 * Non-throwing: idempotency results run in caller cleanup paths and must not
 * throw.
 * @param {string} commitId
 * @param {string} detail
 * @returns {Readonly<{ outcome: 'no-op', commitId: string, detail: string }>}
 */
export function rollbackAlreadyReverted(commitId, detail = 'commit already reverted') {
  return Object.freeze({ outcome: 'no-op', commitId, detail })
}

/** Frozen validation failure (used by pure helpers that must not throw). */
export function validationFailure(code, detail) {
  return Object.freeze({ ok: false, code, detail })
}