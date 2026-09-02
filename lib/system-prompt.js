/**
 * pluginApi.prompts — stable host-side facade over the official
 * `dsh-system-prompt` service and its public render exports.
 *
 * system prompt passthroughs forward to the official `systemPrompt` service methods with the same
 * arguments and return the exact official disposer. render passthrough forwards to the public
 * `renderPrompt` / `renderContextSections` exports of
 * `@deepseek-ai/dsh-system-prompt` (public package exports, not module-private
 * variables). This module performs no validation, caching, or wrapping: official
 * errors propagate unchanged and the facade stays active.
 */
import * as dshSystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { PluginApiFeatureDisabledError } from './errors.js'

/**
 * @param {object} options
 * @param {object} options.systemPrompt - official `systemPrompt` service
 * @returns {{
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
  const unavailable = (surfaceKey) => () => {
    throw new PluginApiFeatureDisabledError(surfaceKey)
  }
  return {
    availability() {
      // The prompts leaf mounts only when the official systemPrompt service
      // resolved, so a mounted surface is active by construction.
      return Object.freeze({ status: 'active' })
    },

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

    // These two slots are filled by the independent official passthrough
    // owner after the base systemPrompt surface is mounted.
    renderContextSnapshot: unavailable('systemPrompt.renderContextSnapshot'),
    joinContextSections: unavailable('systemPrompt.joinContextSections'),
  }
}
