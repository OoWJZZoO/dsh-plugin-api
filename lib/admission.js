/**
 * Pure admission-intent registry for dsh-plugin-api.
 *
 * This module is harness-free by design: no Cordis, no DSH imports. The
 * registry only stores intents and evaluates synchronous match predicates.
 * `match` is intentionally synchronous because the `llm/stream` waterfall is
 * synchronous; a thenable/non-boolean return is treated as no-match with a
 * rate-limited warning (see docs/specs/llm-image-admission/design.md).
 */

export class AdmissionIntentError extends Error {
  constructor(code) {
    super(`admission intent rejected: ${code}`)
    this.name = 'AdmissionIntentError'
    this.code = code
  }
}

export class AdmissionRegistry {
  #intents = new Map()
  #warn
  #now
  #lastWarnAt = new Map()

  constructor(options = {}) {
    this.#warn = typeof options.warn === 'function' ? options.warn : () => {}
    this.#now = typeof options.now === 'function' ? options.now : Date.now
  }

  get size() {
    return this.#intents.size
  }

  register(intent) {
    const id = intent?.id
    if (typeof id !== 'string' || id.trim() === '') {
      throw new AdmissionIntentError('INVALID_ADMISSION_ID')
    }
    if (typeof intent?.match !== 'function') {
      throw new AdmissionIntentError('INVALID_ADMISSION_INTENT')
    }
    if (typeof intent?.project !== 'function') {
      throw new AdmissionIntentError('PROJECTOR_REQUIRED')
    }
    if (this.#intents.has(id)) {
      throw new AdmissionIntentError('DUPLICATE_ADMISSION_INTENT')
    }
    this.#intents.set(id, intent)
    return () => this.dispose(id)
  }

  dispose(id) {
    return this.#intents.delete(id)
  }

  matches(ctx) {
    return this.#matchingIntents(ctx).length > 0
  }

  matchingProjectors(ctx) {
    return this.#matchingIntents(ctx).map((intent) => intent.project)
  }

  #matchingIntents(ctx) {
    const matched = []
    for (const intent of this.#intents.values()) {
      let result
      try {
        result = intent.match(ctx)
      } catch (error) {
        this.#warnMatch(intent.id, error)
        continue
      }
      if (result === true) {
        matched.push(intent)
        continue
      }
      if (result === false) {
        continue
      }
      // A thenable or any non-boolean value cannot be evaluated by the
      // synchronous waterfall; treat it as no-match. Swallow a thenable's
      // eventual rejection so a misbehaving plugin does not create an
      // unhandled rejection while the gate stays closed.
      if (typeof result?.then === 'function') {
        result.then(
          () => {},
          () => {}
        )
      }
      this.#warnMatch(intent.id, new Error('match must return a synchronous boolean'))
    }
    return matched
  }

  #warnMatch(id, error) {
    const now = this.#now()
    const last = this.#lastWarnAt.get(id)
    if (last !== undefined && now - last < 30_000) return
    this.#lastWarnAt.set(id, now)
    this.#warn(`dsh-plugin-api admission intent "${id}" match failed: ${error?.message ?? error}`)
  }
}
