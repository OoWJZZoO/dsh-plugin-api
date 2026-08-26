/**
 * Isolated-validation mock row: a tiny Cordis bundle that registers one
 * fixed provider/model on the official `llm.registerAdapter` contract with
 * deterministic completions.
 *
 * This row exists ONLY inside the disposable validation environment (its
 * overlay is composed by the executor at validate time) — it is never written
 * to any real profile and never shipped as a replacement row. Its purpose is
 * to make a headless one-shot boot settle with a clean exit code (the verdict
 * judges boot health and row apply, never inference success).
 */

export const MOCK_PROVIDER = 'plugin-api-validation'
export const MOCK_MODEL = 'deterministic-completion'

/** Registering an adapter needs the official llm service via fiber inject. */
export const inject = ['llm']

export function apply(ctx) {
  const llm = ctx?.llm
  if (!llm || typeof llm.registerAdapter !== 'function') {
    return () => {}
  }
  const adapter = {
    providerInfo(provider) {
      return { id: provider, name: 'Validation Mock' }
    },
    providerRetryPolicy() {
      return undefined
    },
    listModels() {
      return Promise.resolve([{ provider: MOCK_PROVIDER, id: MOCK_MODEL, name: 'Deterministic Completion' }])
    },
    resolveModel(provider, model) {
      return Promise.resolve({
        provider,
        id: model,
        name: 'Deterministic Completion',
        context: { contextWindow: 4096 },
        defaultMaxTokens: 512,
      })
    },
    async *stream() {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'ok' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'ok' } }
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
      yield { type: 'finish', stopReason: 'end_turn' }
    },
  }
  const handle = llm.registerAdapter([MOCK_PROVIDER], adapter)
  return () => {
    try {
      if (typeof handle === 'function') handle()
    } catch {
      // teardown must not throw through the disposable boot
    }
  }
}