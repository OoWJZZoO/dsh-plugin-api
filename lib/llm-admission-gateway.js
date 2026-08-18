/**
 * L2 private scoped image admission gateway — pluginApi.llm.admission runtime.
 *
 * The gateway is the only replacement for the legacy admission bridge. It
 * wraps `apiProxy.sessions.prompt` / `apiProxy.sessions.selectModel` and
 * `llm.resolveModelInfo` (identity-safe, all-or-nothing via lib/wrap-safety)
 * so that the official image-admission check can be relaxed ONLY for a
 * selected image policy in its scoped RPC, without a public ModelInfo
 * mutation API.
 *
 * Confinement proof for the named official image-admission invocation
 * (requirements §6.7-6.8, design §3): AsyncLocalStorage alone cannot prove
 * that a resolver call inside an RPC is the official admission check. The
 * gateway therefore requires ALL of the following, derived from public
 * behavior only:
 *   1. the resolver call runs inside an ALS scope created exclusively by this
 *      gateway's wrapped prompt/selectModel RPCs;
 *   2. the call is not inside the facade's authoritative bypass scope
 *      (pluginApi.llm.modelInfo() and stream terminal classification);
 *   3. the call's (provider, model) arguments match the RPC's expected
 *      selection: the exact payload selection for selectModel, or — for
 *      prompt, whose payload carries no selection — the first resolver call
 *      in the RPC scope (the official prompt admission check is the only
 *      public resolver consumer in that RPC path);
 *   4. at most one overlay per scope (each official RPC performs the named
 *      check at most once).
 * A raw third-party `ctx.llm.resolveModelInfo()` call inside the same host
 * async scope is NOT claimed to be controlled; if it matches the above
 * confinement it shares the relaxation (requirement §6.8 documents that the
 * facade makes no claim over such calls). Any confinement mismatch leaves the
 * official resolver result untouched and preserves official refusal.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { createWrapSafety } from './wrap-safety.js'
import { isInAuthoritativeBypass, selectMatchingPolicies } from './llm-request.js'

export const ADMISSION_GATEWAY_MARKER = Symbol.for('dsh-plugin-api.llm-request.admission-gateway')

const wrapSafety = createWrapSafety({ marker: ADMISSION_GATEWAY_MARKER })

function isObject(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}

/**
 * @param {object} deps
 * @param {{resolveModelInfo: Function}} deps.llm
 * @param {{sessions: {prompt: Function, selectModel: Function}}} deps.apiProxy
 * @param {{snapshot: Function, isAvailable: Function}} deps.policySource
 *   the L2 policy registry owned by the admission feature
 * @param {{get: Function}} [deps.agents]
 * @param {{warn?: Function}} [deps.logger]
 * @returns {{isActive: () => boolean, dispose: () => void, activeScopeCount: () => number} | null}
 *   null when a required boundary is missing (feature must stay disabled)
 */
export function installLlmAdmissionGateway({ llm, apiProxy, policySource, agents, logger = {} } = {}) {
  const sessions = apiProxy?.sessions
  if (
    !llm
    || typeof llm.resolveModelInfo !== 'function'
    || !sessions
    || typeof sessions.prompt !== 'function'
    || typeof sessions.selectModel !== 'function'
    || !policySource
    || typeof policySource.snapshot !== 'function'
  ) {
    return null
  }

  const warn = typeof logger.warn === 'function' ? (m) => logger.warn(m) : () => {}
  const scopeStorage = new AsyncLocalStorage()
  const gatewayEpoch = {}
  const activeScopes = new Set()
  let stopping = false

  const handle = wrapSafety.installWrappers([
    {
      target: llm,
      property: 'resolveModelInfo',
      wrapperFactory: ({ original, isActive }) =>
        async function dshPluginApiGatewayResolveModelInfo(provider, model, signal) {
          if (!isActive() || isInAuthoritativeBypass()) {
            return original.call(llm, provider, model, ...(signal === undefined ? [] : [signal]))
          }

          const scope = scopeStorage.getStore()
          if (
            !scope
            || scope.gatewayEpoch !== gatewayEpoch
            || scope.state !== 'active'
            || scope.selected.length === 0
            || scope.overlayed
          ) {
            return original.call(llm, provider, model, ...(signal === undefined ? [] : [signal]))
          }

          // Argument confinement: only the named official admission check may
          // observe the overlay.
          if (!expectedSelectionMatches(scope, provider, model)) {
            return original.call(llm, provider, model, ...(signal === undefined ? [] : [signal]))
          }

          const info = await original.call(llm, provider, model, ...(signal === undefined ? [] : [signal]))
          // Re-verify after the await: disposal, settling, or a concurrent
          // resolver call that already claimed the overlay must never change
          // an already running admission outcome.
          if (!isActive() || scope.state !== 'active' || scope.gatewayEpoch !== gatewayEpoch || scope.overlayed) {
            return info
          }
          if (!isObject(info) || !Array.isArray(info.inputModalities) || info.inputModalities.includes('image')) {
            return info
          }

          scope.overlayed = true
          return { ...info, inputModalities: [...info.inputModalities, 'image'] }
        },
    },
    {
      target: sessions,
      property: 'prompt',
      wrapperFactory: ({ original, isActive }) =>
        function dshPluginApiGatewayPrompt(request) {
          if (!isActive() || stopping) {
            return original.call(sessions, request)
          }
          return enterRpcScope('prompt', request, original, isActive)
        },
    },
    {
      target: sessions,
      property: 'selectModel',
      wrapperFactory: ({ original, isActive }) =>
        function dshPluginApiGatewaySelectModel(request) {
          if (!isActive() || stopping) {
            return original.call(sessions, request)
          }
          return enterRpcScope('selectModel', request, original, isActive)
        },
    },
  ], { logger })

  if (!handle.installed) {
    warn(`dsh-plugin-api: llm/admission gateway could not install its wrappers: ${handle.reason ?? 'unknown'}`)
    return null
  }

  /** Synchronous pre-callback selection; the scope enters ALS only on success. */
  function enterRpcScope(kind, request, original, isActive) {
    const sessionId = request?.payload?.sessionId
    let agent
    if (typeof agents?.get === 'function') {
      try {
        agent = agents.get(sessionId)
      } catch {
        agent = undefined
      }
    }

    const payloadProvider = kind === 'selectModel' ? request?.payload?.provider : undefined
    const payloadModel = kind === 'selectModel' ? request?.payload?.model : undefined
    const context = {
      sessionId,
      agent,
      provider: payloadProvider,
      model: payloadModel,
    }

    const policies = policySource.snapshot()
    const selected = selectMatchingPolicies(policies, context, (category, error) => {
      warn(`dsh-plugin-api: llm/admission scope ${category}: ${error?.message ?? error}`)
    })

    const scope = {
      gatewayEpoch,
      scopeId: {},
      kind,
      sessionId,
      policies,
      selected,
      // selectModel carries the exact payload selection; prompt's selection is
      // not in the payload, so the first resolver call in the scope becomes
      // the named check (the only public resolver consumer in that RPC path).
      expectedProvider: payloadProvider,
      expectedModel: payloadModel,
      overlayed: false,
      state: 'active',
    }

    activeScopes.add(scope)
    let settled = false
    const settle = () => {
      if (settled) return
      settled = true
      activeScopes.delete(scope)
      scope.state = 'settled'
    }

    let result
    try {
      result = scopeStorage.run(scope, () => original.call(sessions, request))
    } catch (error) {
      settle()
      throw error
    }
    if (result !== null && typeof result === 'object' && typeof result.then === 'function') {
      return Promise.resolve(result).then(
        (value) => {
          settle()
          return value
        },
        (error) => {
          settle()
          throw error
        },
      )
    }
    settle()
    return result
  }

  /** Argument confinement for the named check. */
  function expectedSelectionMatches(scope, provider, model) {
    if (scope.kind === 'selectModel') {
      return provider === scope.expectedProvider && model === scope.expectedModel
    }
    // prompt: the first public resolver call in the scope is the official
    // admission check (at-most-one overlay per scope enforces it stays the
    // only overlaid call).
    return true
  }

  let disposed = false
  function dispose() {
    if (disposed) return false
    disposed = true
    stopping = true
    // In-flight RPCs finish with their original resolver results only; the
    // identity-safe detach below stops any new overlay for later calls.
    for (const scope of activeScopes) scope.state = 'settling'
    try {
      handle.dispose()
    } catch {
      // disposal must never take down the fail-safe path
    }
    return true
  }

  return {
    isActive: () => handle.isActive(),
    activeScopeCount: () => activeScopes.size,
    dispose,
  }
}