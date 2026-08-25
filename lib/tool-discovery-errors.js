import { PluginApiError } from './errors.js'
import { CODES } from './tool-discovery-normalize.js'
import { deepFreeze } from './deep-freeze.js'

/**
 * Typed errors for the tool discovery catalog surface.
 *
 * Every failure that crosses the public discovery surface is a typed
 * PluginApiError subclass so third-party plugins can keep catching the single
 * base class while switching on `code` for precise handling. Codes are
 * capability words (no governance tokens). The one non-throwing outcome is
 * the stale/foreign generation dispose result (a typed frozen no-op), because
 * disposers run in cleanup paths and must never throw.
 */

export class ToolDiscoveryRegistrationError extends PluginApiError {
  constructor(detail, options) {
    super(CODES.REGISTRATION_INVALID, `tool discovery: catalog registration rejected: ${detail}`, options)
  }
}

export class ToolDiscoveryEntryConflictError extends PluginApiError {
  constructor(entryId, options) {
    super(CODES.ENTRY_CONFLICT, `tool discovery: catalog entry id "${entryId}" is already registered; the existing entry is preserved`, options)
    this.entryId = entryId
  }
}

export class ToolDiscoveryEntryUnknownError extends PluginApiError {
  constructor(entryId, options) {
    super(CODES.ENTRY_UNKNOWN, `tool discovery: catalog entry id "${entryId}" is not registered`, options)
    this.entryId = entryId
  }
}

export class ToolDiscoveryEntryDisposedError extends PluginApiError {
  constructor(entryId, options) {
    super(CODES.ENTRY_DISPOSED, `tool discovery: catalog entry id "${entryId}" has been disposed`, options)
    this.entryId = entryId
  }
}

export class ToolDiscoveryEntryDeactivatedError extends PluginApiError {
  constructor(entryId, options) {
    super(CODES.ENTRY_DEACTIVATED, `tool discovery: catalog entry id "${entryId}" is deactivated and does not accept new activations`, options)
    this.entryId = entryId
  }
}

export class ToolDiscoveryEntryFailedError extends PluginApiError {
  constructor(entryId, detail, options) {
    super(CODES.ENTRY_FAILED, `tool discovery: catalog entry id "${entryId}" failed: ${detail}`, options)
    this.entryId = entryId
  }
}

export class ToolDiscoveryScopeUnresolvedError extends PluginApiError {
  constructor(detail, options) {
    super(CODES.SCOPE_UNRESOLVED, `tool discovery: ${detail ?? 'activation scope cannot be resolved from session or execution'}`, options)
  }
}

export class ToolDiscoveryActivationSupersededError extends PluginApiError {
  constructor(entryId, options) {
    super(CODES.ACTIVATION_SUPERSEDED, `tool discovery: activation of entry id "${entryId}" was superseded before its tool definitions arrived; no exposure was published`, options)
    this.entryId = entryId
  }
}

/**
 * Typed no-op outcome for a stale/foreign generation dispose. Frozen and
 * non-throwing: disposers run in cleanup paths and must never throw.
 */
export function staleGenerationOutcome(reason) {
  return deepFreeze({
    ok: false,
    code: CODES.GENERATION_STALE,
    ...(typeof reason === 'string' && reason.trim() !== '' ? { reason } : {}),
  })
}