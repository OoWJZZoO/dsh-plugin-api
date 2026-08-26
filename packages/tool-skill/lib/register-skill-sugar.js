/**
 * `registerSkill` sugar: one call composes the official runtime content
 * registration with the activation overlay, optionally activating right away.
 *
 * The official registry remains the single content owner: this sugar only
 * chains the official `ctx.skills.register()` call, the overlay registration
 * and (optionally) one activation, and returns a single identity-bound handle.
 * Official first-wins semantics pass through verbatim (a duplicate name yields
 * the official no-op disposer; the sugar never fabricates ownership of the
 * existing content registration). Any failed half rolls back the halves this
 * call already completed.
 */

import { normalizeRegisterSkillInput } from './skill-activation-normalize.js'

/**
 * @param {{
 *   ctx: object,
 *   engine: object,
 *   service: object,
 * }} options - `service` is the published activation service (typed async
 *   activate plus typed deactivate/exposure).
 */
export function createRegisterSkillSugar({ ctx, engine, service }) {
  /**
   * @param {object} input - `{ name, owner, summary, content, capabilities?,
   *   sourceKind?, activationSource?, dependencies?, tools?, promptSections?,
   *   resources?, activation? }`.
   * @returns {Promise<object>} typed result; ok carries the handle.
   */
  async function registerSkill(input) {
    const norm = normalizeRegisterSkillInput(input)
    if (!norm.ok) return norm

    const { descriptor, content, activation } = norm.value
    const { skillId, owner } = descriptor

    // Half 1: official content registration (official validations verbatim;
    // first-wins duplicates receive the official no-op disposer).
    let contentDisposer
    try {
      contentDisposer = ctx.skills.register({
        name: skillId,
        description: descriptor.summary,
        content,
      })
    } catch (error) {
      return Object.freeze({
        ok: false,
        code: 'SKILL_REGISTRATION_INVALID',
        reason: `official skill registration failed: ${error?.message ?? error}`,
      })
    }

    // Half 2: activation overlay. Roll back the content half on failure.
    const overlay = engine.registerDescriptor(descriptor)
    if (!overlay.ok) {
      try {
        contentDisposer()
      } catch {
        // rollback is best effort; the official disposer owns the winner
      }
      return overlay
    }

    // Optional immediate activation. A failed activation rolls back both
    // halves so the call never leaves a half-registered skill visible.
    let activationResult
    if (activation !== undefined) {
      activationResult = await service.activate(skillId, activation)
      if (!activationResult.ok) {
        engine.unregisterDescriptor(skillId, owner)
        try {
          contentDisposer()
        } catch {
          // rollback is best effort
        }
        return activationResult
      }
    }

    let disposed = false
    const handle = Object.freeze({
      skillId,
      owner,
      generation: overlay.generation,
      activate: (request) => service.activate(skillId, request),
      deactivate: (generation, scope) => service.deactivate(skillId, generation, scope),
      exposure: (generation) => service.exposure(skillId, generation),
      dispose: () => {
        if (disposed) return Object.freeze({ ok: true, alreadyDisposed: true })
        disposed = true
        const overlayDispose = engine.unregisterDescriptor(skillId, owner)
        try {
          contentDisposer()
        } catch {
          // disposal must never throw through the fail-safe apply
        }
        return Object.freeze({ ok: true, overlayDisposed: overlayDispose.ok })
      },
    })
    return Object.freeze({
      ok: true,
      handle,
      ...(activationResult === undefined ? {} : { activation: activationResult }),
    })
  }

  return Object.freeze({ registerSkill })
}