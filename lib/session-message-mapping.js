/**
 * Public request message → durable/inbox message mapping (host face).
 *
 * One mapping serves both delivery paths: the durable append (source-audited
 * `user/message`) and the official inbox splice (`agent.steer`/`agent.followup`
 * take the same `{ id, role, content, source }` message). Keeping it in one
 * place is what makes "one logical message" hold across both paths: a request
 * mints exactly one message identity, and the content blocks are built once.
 *
 * The module is pure: it owns no state, touches no service, and never imports
 * a harness package. Resolution of attachment references is injected by the
 * caller so the authority and the facade share the exact same fail-closed
 * semantics.
 */
import { mintId } from './session-interaction-operation-normalize.js'

/**
 * Public request message kind → durable surface message kind.
 *
 * The public contract speaks source-audited request kinds (`user-message`);
 * the durable layer only accepts surface message kinds carrying a complete
 * message shape (`{ id, role, content, source }`). The facade adapts between
 * the two vocabularies here so neither leaks into the other.
 */
const SURFACE_KIND_BY_REQUEST_KIND = new Map([['user-message', 'user/message']])

/**
 * Build the durable surface message for one public request message.
 *
 * The content array preserves the caller's fidelity: the text block comes
 * first and every attachment reference becomes exactly one image block
 * (`{ type: 'image', attachment: <ref> }`) in the caller's order — the shape the
 * official durable content model, the attachments authority and the model
 * projection all speak. Attachments are never shrunk to text, merged,
 * reordered or replaced by placeholder blocks; unresolved references are
 * refused by `resolveAttachmentRefs` before this function runs.
 *
 * @param {string} kind public request message kind
 * @param {object} payload `{ text, attachmentRefs }`
 * @param {readonly object[]} [canonicalRefs] verified references, same order
 */
function toSurfaceMessage(kind, payload, canonicalRefs = []) {
  const surfaceKind = SURFACE_KIND_BY_REQUEST_KIND.get(kind)
  if (surfaceKind === undefined) return { ok: false, reason: `unsupported durable message kind "${kind}"` }
  const text = payload?.text
  if (typeof text !== 'string' || text.length === 0) return { ok: false, reason: 'message text is required' }
  const content = [Object.freeze({ type: 'text', text })]
  for (const ref of canonicalRefs) {
    content.push(Object.freeze({ type: 'image', attachment: ref }))
  }
  return {
    ok: true,
    kind: surfaceKind,
    message: Object.freeze({
      id: mintId('msg'),
      role: 'user',
      source: Object.freeze({ kind: 'user' }),
      content: Object.freeze(content),
    }),
  }
}

/** Bounded per-reference reason: the declared id plus the failure class. */
function attachmentFailureReason(ref, error) {
  const id = typeof ref?.attachmentId === 'string' && ref.attachmentId !== '' ? ref.attachmentId : 'unknown'
  const code = typeof error?.code === 'string' && error.code !== '' ? error.code : 'unreadable'
  return `attachment "${id}" cannot be resolved (${code})`
}

/**
 * Resolve every declared attachment reference through the attachments
 * authority before anything is written.
 *
 * Fail-closed by contract: one unresolvable reference refuses the whole
 * request with a per-reference bounded reason, and the returned references are
 * the authority's own canonical ones (so the durable block carries exactly the
 * object the store verifies). A missing store, a missing member or a throwing
 * read all degrade to the same typed refusal — no partial message, no silent
 * text-only fallback.
 *
 * @param {readonly object[]} refs declared references (already shape-checked)
 * @param {(ref: object, signal?: AbortSignal) => Promise<object>} readImage
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ok: true, refs: object[]} | {ok: false, reason: string}>}
 */
async function resolveAttachmentRefs(refs, readImage, signal) {
  if (refs.length === 0) return { ok: true, refs: [] }
  if (typeof readImage !== 'function') {
    return { ok: false, reason: 'the attachments authority is unavailable; attachments cannot be resolved' }
  }
  const resolved = []
  for (const ref of refs) {
    try {
      const stored = await readImage(ref, signal)
      const canonical = stored?.ref
      if (canonical === undefined || canonical === null || typeof canonical !== 'object') {
        return { ok: false, reason: attachmentFailureReason(ref, undefined) }
      }
      resolved.push(Object.freeze({ ...canonical }))
    } catch (error) {
      return { ok: false, reason: attachmentFailureReason(ref, error) }
    }
  }
  return { ok: true, refs: resolved }
}


export { resolveAttachmentRefs, toSurfaceMessage }
