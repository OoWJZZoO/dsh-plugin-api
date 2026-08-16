/**
 * pluginApi.systemPrompt — stable host-side facade over the official
 * `dsh-system-prompt` service and its public render exports.
 *
 * P1–P5 forward to the official `systemPrompt` service methods with the same
 * arguments and return the exact official disposer. P8 forwards to the public
 * `renderPrompt` / `renderContextSections` exports of
 * `@deepseek-ai/dsh-system-prompt` (public package exports, not module-private
 * variables). This module performs no validation, caching, or wrapping: official
 * errors propagate unchanged and the facade stays active.
 */
import * as dshSystemPrompt from '@deepseek-ai/dsh-system-prompt'

/**
 * @param {object} options
 * @param {object} options.systemPrompt - official `systemPrompt` service
 * @returns {{
 *   isActive: true,
 *   section(section: object): () => void,
 *   context(context: object): () => void,
 *   variable(name: string, provider: Function): () => void,
 *   tools(provider: Function): () => void,
 *   suppressRuntimeContext(): () => void,
 *   render(assembly: object): string,
 *   renderContextSections(assembly: object): Array<{name: string, text: string}>,
 * }}
 */
export function createSystemPromptApi({ systemPrompt }) {
  return {
    isActive: true,

    section(section) {
      return systemPrompt.section(section)
    },

    context(context) {
      return systemPrompt.context(context)
    },

    variable(name, provider) {
      return systemPrompt.variable(name, provider)
    },

    tools(provider) {
      return systemPrompt.tools(provider)
    },

    suppressRuntimeContext() {
      return systemPrompt.suppressRuntimeContext()
    },

    render(assembly) {
      return dshSystemPrompt.renderPrompt(assembly)
    },

    renderContextSections(assembly) {
      return dshSystemPrompt.renderContextSections(assembly)
    },
  }
}
