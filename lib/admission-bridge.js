/**
 * Admission bridge — hidden, fail-safe runtime wrapping.
 *
 * The bridge owns the two monkey-patch boundaries that make scoped admission
 * work without leaking a global ModelInfo mutation:
 *   1. apiProxy.sessions.prompt / selectModel are wrapped so their async work
 *      runs inside an AsyncLocalStorage "admission scope" carrying sessionId.
 *   2. llm.resolveModelInfo is wrapped so the image input modality is appended
 *      ONLY while an admission scope is active and a registered intent matches.
 *
 * All wrapping is chain-safe and idempotent through the shared
 * `lib/wrap-safety.js` helper (plugin-api-facade-integrity F0.5).
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { createWrapSafety } from './wrap-safety.js'

export const ADMISSION_WRAPPER_MARKER = Symbol.for('dsh-plugin-api.llm-image-admission')

const wrapSafety = createWrapSafety({ marker: ADMISSION_WRAPPER_MARKER })

/**
 * @param {object} deps
 * @param {{resolveModelInfo: Function}} deps.llm
 * @param {{sessions: {prompt: Function, selectModel: Function}}} deps.apiProxy
 * @param {import('./admission.js').AdmissionRegistry} deps.registry
 * @param {{get: Function}} deps.agents
 * @param {{warn?: Function}} [deps.logger]
 * @returns {{dispose: () => void, isActive: () => boolean}}
 */
export function installAdmissionBridge({ llm, apiProxy, registry, agents, logger } = {}) {
  const sessions = apiProxy?.sessions
  const boundariesValid =
    typeof llm?.resolveModelInfo === 'function' &&
    typeof sessions?.prompt === 'function' &&
    typeof sessions?.selectModel === 'function' &&
    registry &&
    typeof registry.matches === 'function'

  if (!boundariesValid) {
    logger?.warn?.('dsh-plugin-api: admission bridge skipped because an admission boundary is unavailable')
    return {
      isActive: () => false,
      dispose: () => {},
    }
  }

  const scopeStorage = new AsyncLocalStorage()

  const handle = wrapSafety.installWrappers([
    {
      target: llm,
      property: 'resolveModelInfo',
      wrapperFactory: ({ original, isActive }) =>
        async function dshPluginApiResolveModelInfo(provider, model, signal) {
          if (!isActive()) {
            return original.call(llm, provider, model, signal)
          }

          const scope = scopeStorage.getStore()
          if (!scope) {
            return original.call(llm, provider, model, signal)
          }

          const info = await original.call(llm, provider, model, signal)
          if (!info || !Array.isArray(info.inputModalities) || info.inputModalities.includes('image')) {
            return info
          }

          const agent = typeof agents?.get === 'function' ? agents.get(scope.sessionId) : undefined
          const matches = registry.matches({
            sessionId: scope.sessionId,
            agent,
            provider,
            model,
          })
          if (!matches) return info

          return {
            ...info,
            inputModalities: [...info.inputModalities, 'image'],
          }
        },
    },
    {
      target: sessions,
      property: 'prompt',
      wrapperFactory: ({ original, isActive }) =>
        function dshPluginApiPrompt(request) {
          if (!isActive()) {
            return original.call(sessions, request)
          }
          const sessionId = request?.payload?.sessionId
          return scopeStorage.run({ sessionId, kind: 'prompt' }, () => original.call(sessions, request))
        },
    },
    {
      target: sessions,
      property: 'selectModel',
      wrapperFactory: ({ original, isActive }) =>
        function dshPluginApiSelectModel(request) {
          if (!isActive()) {
            return original.call(sessions, request)
          }
          const sessionId = request?.payload?.sessionId
          return scopeStorage.run({ sessionId, kind: 'selectModel' }, () => original.call(sessions, request))
        },
    },
  ], { logger })

  return {
    isActive: () => handle.isActive(),
    dispose: () => handle.dispose(),
  }
}
