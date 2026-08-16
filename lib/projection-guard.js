/**
 * Projection guard — model-boundary enforcement of the admission contract.
 *
 * Pure logic in this module is harness-free by design. The `llm/stream`
 * listener integration (task 5.2) lives in the same module but is kept
 * separate from the pure `applyProjectors` function.
 */

export class AdmissionProjectionError extends Error {
  constructor() {
    super('admission projection failed: image blocks remain after all projectors ran')
    this.name = 'AdmissionProjectionError'
    this.code = 'ADMISSION_PROJECTION_FAILED'
  }
}

/**
 * Apply synchronous projectors in order until a result contains no image
 * blocks. Fail closed when a projector throws or when image blocks remain
 * after every projector has run.
 *
 * @param options - the request being projected
 * @param projectors - synchronous projector functions
 * @param hasImage - injected image detector (production: dshLlm.contentHasImage)
 * @returns the first projected request without image blocks, or `options`
 *   itself when it already has no image blocks
 */
export function applyProjectors(options, projectors, hasImage) {
  if (!hasImage(options)) return options

  let current = options
  for (const projector of projectors) {
    const projected = projector(current)
    if (!hasImage(projected)) return projected
    current = projected
  }

  throw new AdmissionProjectionError()
}

/**
 * Build a request-level image detector from the official per-content walker.
 * `dshLlm.contentHasImage` expects a content block array; ProjectionGuard
 * operates on full `GenerateOptions` requests, so production passes this
 * wrapper while tests may inject a simpler request-level stub directly.
 *
 * The detector fails closed: if the official walker throws on a content shape
 * it cannot parse, the request is treated as containing an image so the guard
 * refuses to forward rather than silently leak it.
 */
export function createRequestHasImage(contentHasImage) {
  if (typeof contentHasImage !== 'function') return () => false
  return function requestHasImage(request) {
    if (!request || !Array.isArray(request.messages)) return false
    return request.messages.some((message) => {
      if (!Array.isArray(message?.content)) return false
      try {
        return contentHasImage(message.content)
      } catch {
        return true
      }
    })
  }
}

/**
 * Install the synchronous `llm/stream` listener that enforces projection for
 * admitted sessions. Returns the disposer returned by `ctx.on`.
 *
 * The listener is intentionally synchronous: the Cordis waterfall does not
 * await listeners, and an async listener would break the chain.
 *
 * @param {object} deps
 * @param {{on: Function}} deps.ctx
 * @param {import('./admission.js').AdmissionRegistry} deps.registry
 * @param {{get: Function}} deps.agents
 * @param {Function} deps.hasImage  request-level image detector; production
 *   passes createRequestHasImage(dshLlm.contentHasImage), tests inject a stub
 * @param {{error?: Function, warn?: Function}} [deps.logger]
 */
export function installProjectionGuard({ ctx, registry, agents, hasImage, logger } = {}) {
  if (
    typeof ctx?.on !== 'function' ||
    typeof hasImage !== 'function' ||
    !registry ||
    typeof registry.matchingProjectors !== 'function'
  ) {
    logger?.warn?.('dsh-plugin-api: projection guard skipped because a required dependency is unavailable')
    return () => {}
  }

  const listener = function dshPluginApiProjectionGuard(options, next) {
    if (!options || !Array.isArray(options.messages)) return next()
    if (!hasImage(options)) return next()

    const sessionId = options.sessionId
    if (sessionId === undefined || sessionId === null || sessionId === '') return next()

    const agent = typeof agents?.get === 'function' ? agents.get(sessionId) : undefined
    const projectors = registry.matchingProjectors({
      sessionId,
      agent,
      provider: options.provider,
      model: options.model,
    })
    if (projectors.length === 0) return next()

    let projected
    try {
      projected = applyProjectors(options, projectors, hasImage)
    } catch (error) {
      logger?.error?.(`dsh-plugin-api: projection guard failed: ${error?.message ?? error}`)
      throw error
    }

    if (projected === options) return next()
    return this.stream(projected)
  }

  const dispose = ctx.on('llm/stream', listener)
  return typeof dispose === 'function' ? dispose : () => {}
}
