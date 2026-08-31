/**
 * pluginApi.llm — stabilized host-side passthrough for the official `llm`
 * service (service passthroughs).
 *
 * This module is pure logic plus the injected official `llm` service: it
 * never imports Cordis and never wraps, clones, caches, or re-dispatches
 * anything. `modelInfo` is the only method that post-processes its result:
 * it deep-freezes the detached `LlmResolvedModelInfo` so callers cannot
 * mutate what the facade exposes as read-only model metadata, and it runs
 * inside the owner-controlled authoritative bypass scope so an active
 * admission gateway overlay is never observed.
 */
import { runAuthoritative } from './llm-request.js'

/**
 * @param {object} options
 * @param {import('@deepseek-ai/dsh-llm').LlmRuntime} options.llm
 *   The injected official `llm` service instance.
 * @param {(value: unknown) => unknown} options.deepFreeze
 *   The facade's safe deep-freeze helper (never throws).
 * @returns {object} llmApi for `service.mountFeature('llm', llmApi)`
 */
export function createLlmApi({ llm, deepFreeze }) {
  return {
    get isActive() {
      return true
    },

    /**
     * Read-only exact-model metadata query.
     *
     * @param {string} provider - registered provider route
     * @param {string} model - exact model id passed to the adapter
     * @param {AbortSignal} [signal] - optional cancellation
     * @returns {Promise<import('@deepseek-ai/dsh-llm').LlmResolvedModelInfo>}
     *   the official result, deep-frozen for read-only access
     */
    async modelInfo(provider, model, signal) {
      const info = await runAuthoritative(
        () => llm.resolveModelInfo(provider, model, ...(signal === undefined ? [] : [signal])),
      )
      return deepFreeze(info)
    },

    /**
     * Resolve one call under its current adapter registration.
     *
     * @param {import('@deepseek-ai/dsh-llm').LlmCallConfig} config
     * @param {AbortSignal} [signal]
     * @returns {Promise<import('@deepseek-ai/dsh-llm').PreparedLlmCall>}
     */
    async prepareCall(config, signal) {
      return llm.prepareCall(config, ...(signal === undefined ? [] : [signal]))
    },

    /**
     * Stream one model call through the official `llm/stream` waterfall.
     *
     * @param {import('@deepseek-ai/dsh-llm').GenerateOptions} options
     * @returns {AsyncIterable<import('@deepseek-ai/dsh-llm').StreamChunk>}
     */
    stream(options) {
      return llm.stream(options)
    },



  }
}
