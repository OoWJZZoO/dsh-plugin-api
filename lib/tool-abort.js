/**
 * Tool-abort error factory — pure module, zero imports, zero harness dependency.
 *
 * Stabilizes the official "tool call aborted" error identity behind a single
 * facade entry: `new HarnessError('tool call aborted', TOOL_ABORTED)` with
 * `name = 'AbortError'` (the exact composition used by the official
 * `dsh-tool-bash` / `dsh-tool-pwsh`). The official public exports are injected
 * (`HarnessError` from `@deepseek-ai/dsh-llm`, `TOOL_ABORTED` from
 * `@deepseek-ai/dsh-tools`) so this module stays fully unit-testable with
 * stubs and can never break a host boot.
 *
 * Fail-safe: whenever either official export is unavailable, the factory
 * degrades to a plain `Error` named "AbortError" (which the agent loop also
 * recognizes), never throwing a resolution error. The mode is decided once at
 * factory creation and stays stable for the host lifetime (requirements
 * 3.1/3.3). Each call returns a newly constructed, unfrozen, throwable
 * `Error`; extra call arguments are ignored.
 */

/**
 * @param {{ HarnessError?: Function, TOOL_ABORTED?: string }} deps — official
 *   public exports; either one missing/non-matching picks the degraded mode.
 * @returns {() => Error} stable factory; each call returns a new Error.
 */
export function createToolAbortedErrorFactory(deps) {
  const { HarnessError, TOOL_ABORTED } = deps ?? {}
  const full = typeof HarnessError === 'function' && typeof TOOL_ABORTED === 'string'
  if (full) {
    return function toolAbortedError() {
      const error = new HarnessError('tool call aborted', TOOL_ABORTED)
      error.name = 'AbortError'
      return error
    }
  }
  return function toolAbortedError() {
    const error = new Error('tool call aborted')
    error.name = 'AbortError'
    return error
  }
}
