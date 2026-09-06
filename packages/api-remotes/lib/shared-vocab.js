/**
 * Shared vocabulary for the client-attention transport slice
 * (`@deepseek-ai/dsh-plugin-api-api-remotes`).
 *
 * Pure declarations, zero harness dependencies. Local copy kept in sync with
 * the main facade's `lib/attention-wire.js`; a consistency test asserts the
 * shared entries are 1:1 identical. The replacement package does not import
 * the main package's runtime.
 *
 * @module
 */

/** Host event name produced by the attention hub and forwarded by the slice. */
export const ATTENTION_UPDATE_EVENT = 'attention/update'

/** Host event name for a hub-originated full snapshot (rebind/refetch path). */
export const ATTENTION_SNAPSHOT = 'attention.snapshot'

/** Host event name for a hub-originated incremental change. */
export const ATTENTION_DELTA = 'attention.delta'

/** Message kinds of an attention update. */
export const ATTENTION_KINDS = Object.freeze([ATTENTION_SNAPSHOT, ATTENTION_DELTA])

/** Change operations inside a delta message. */
export const ATTENTION_OPS = Object.freeze(['add', 'update', 'remove'])

/** Replacement-owner marker: this package owns the attention forwarder. */
export const FORWARDER_OWNER_SYMBOL = Symbol.for('dsh-plugin-api.api-remotes.contract')

/** Browser-side internal attention receiver channel (not a `$on` key). */
export const ATTENTION_RECEIVER_SYMBOL = Symbol.for('dsh-plugin-api.attention.receiver')

/** The official loader row this package replaces (web profile). */
export const OFFICIAL_ROW_ID = 'api-remotes'

/** The official owner package whose identity this bundle is locked to. */
export const OFFICIAL_OWNER_PACKAGE = '@deepseek-ai/dsh-api-remotes'

/** The replacement loader row id (neutral naming, no governance token). */
export const REPLACEMENT_ROW_ID = 'plugin-api-api-remotes'

/** The replacement package name. */
export const REPLACEMENT_PACKAGE_NAME = '@deepseek-ai/dsh-plugin-api-api-remotes'

/**
 * Build the wiring path check used by the boot self-check: the forwarded
 * attention frames ride the official host→browser event stream and are never
 * exposed under the consumer-side `ctx.remote.$on` key set, which stays the
 * reproduced official allowlist.
 * @param {object} args
 * @param {string[]} args.forwardedEvents - the reproduced official allowlist.
 * @param {string} args.attentionEvent - the attention extension event name.
 * @returns {boolean} whether the extension event is kept out of the allowlist.
 */
export function keepAttentionOutOfAllowlist({ forwardedEvents, attentionEvent }) {
  return !forwardedEvents.includes(attentionEvent)
}