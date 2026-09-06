/**
 * Shared vocabulary for the browser attention runtime slice
 * (`@deepseek-ai/dsh-plugin-api-client-runtime`).
 *
 * Pure declarations, zero harness dependencies. The internal runtime contract
 * consumed by the main facade client face is shape-defined; marker symbols
 * fix the cross-package seams.
 *
 * @module
 */

/** Browser-side internal runtime contract symbol (main facade client face). */
export const ATTENTION_RUNTIME_SYMBOL = Symbol.for('dsh-plugin-api.attention.runtime')

/** Client→host request channel symbol (registered by the transport consumer). */
export const ATTENTION_REQUEST_CHANNEL_SYMBOL = Symbol.for('dsh-plugin-api.attention.request-channel')

/** Replacement-owner marker: this package owns the browser attention runtime. */
export const RUNTIME_OWNER_SYMBOL = Symbol.for('dsh-plugin-api.client-runtime.contract')

/** The official loader row this package replaces (web profile). */
export const OFFICIAL_ROW_ID = 'client-runtime'

/** The official owner package whose identity this bundle is locked to. */
export const OFFICIAL_OWNER_PACKAGE = '@deepseek-ai/dsh-client-runtime'

/** The replacement loader row id (neutral naming, no governance token). */
export const REPLACEMENT_ROW_ID = 'plugin-api-client-runtime'

/** The replacement package name. */
export const REPLACEMENT_PACKAGE_NAME = '@deepseek-ai/dsh-plugin-api-client-runtime'

/** Official browser-module contract surface this slice reproduces. */
export const OFFICIAL_BROWSER_CONTRACT = Object.freeze([
  'slots',
  'slots/changed',
  'conversationEvents',
  'conversationViews',
  'connection/reset',
  'sessions',
  'workspaces',
])