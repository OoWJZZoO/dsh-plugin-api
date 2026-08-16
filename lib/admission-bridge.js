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
 * All wrapping is chain-safe and idempotent (see design.md Component 4).
 */
import { AsyncLocalStorage } from 'node:async_hooks'

export const ADMISSION_WRAPPER_MARKER = Symbol.for('dsh-plugin-api.llm-image-admission')

function mark(wrapper) {
  Object.defineProperty(wrapper, ADMISSION_WRAPPER_MARKER, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  })
  return wrapper
}

function isMarked(value) {
  return typeof value === 'function' && value[ADMISSION_WRAPPER_MARKER] === true
}

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

  // Another install (e.g. HMR before dispose, or a repeated call) already
  // owns the wrapper chain. Do not nest a second wrapper around it.
  if (isMarked(llm.resolveModelInfo) || isMarked(sessions.prompt) || isMarked(sessions.selectModel)) {
    return {
      isActive: () => true,
      dispose: () => {},
    }
  }

  const originalResolveModelInfo = llm.resolveModelInfo
  const originalPrompt = sessions.prompt
  const originalSelectModel = sessions.selectModel

  const scopeStorage = new AsyncLocalStorage()
  let admissionActive = true
  let disposed = false

  const wrappedResolveModelInfo = mark(async function dshPluginApiResolveModelInfo(provider, model, signal) {
    const scope = scopeStorage.getStore()
    if (!scope || !admissionActive) {
      return originalResolveModelInfo.call(llm, provider, model, signal)
    }

    const info = await originalResolveModelInfo.call(llm, provider, model, signal)
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
  })

  const wrappedPrompt = mark(function dshPluginApiPrompt(request) {
    const sessionId = request?.payload?.sessionId
    return scopeStorage.run({ sessionId, kind: 'prompt' }, () => originalPrompt.call(sessions, request))
  })

  const wrappedSelectModel = mark(function dshPluginApiSelectModel(request) {
    const sessionId = request?.payload?.sessionId
    return scopeStorage.run({ sessionId, kind: 'selectModel' }, () => originalSelectModel.call(sessions, request))
  })

  sessions.prompt = wrappedPrompt
  sessions.selectModel = wrappedSelectModel
  llm.resolveModelInfo = wrappedResolveModelInfo

  const handle = {
    isActive: () => admissionActive,
    dispose() {
      if (disposed) return
      disposed = true
      admissionActive = false

      const degraded = []

      if (llm.resolveModelInfo === wrappedResolveModelInfo) {
        llm.resolveModelInfo = originalResolveModelInfo
      } else if (llm.resolveModelInfo !== originalResolveModelInfo) {
        admissionActive = false
        degraded.push('llm.resolveModelInfo')
      }

      if (sessions.prompt === wrappedPrompt) {
        sessions.prompt = originalPrompt
      } else if (sessions.prompt !== originalPrompt) {
        admissionActive = false
        degraded.push('apiProxy.sessions.prompt')
      }

      if (sessions.selectModel === wrappedSelectModel) {
        sessions.selectModel = originalSelectModel
      } else if (sessions.selectModel !== originalSelectModel) {
        admissionActive = false
        degraded.push('apiProxy.sessions.selectModel')
      }

      if (degraded.length > 0) {
        logger?.warn?.(`dsh-plugin-api: admission bridge degraded to transparent because other plugins wrapped: ${degraded.join(', ')}`)
      }
    },
  }

  return handle
}
