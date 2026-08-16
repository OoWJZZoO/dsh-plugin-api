/**
 * dsh-plugin-api host plugin — llm-image-admission vertical slice.
 *
 * apply() is fail-safe by design: it NEVER throws. The only safe failure mode
 * for a DSH plugin is returning normally (fiber stays active) while installing
 * nothing but, when possible, an inert `pluginApi` service. A thrown apply()
 * would take the whole harness boot down.
 */
import * as dshLlm from '@deepseek-ai/dsh-llm'
import { AdmissionRegistry } from './admission.js'
import { installAdmissionBridge } from './admission-bridge.js'
import { checkHostEnvironment, guardFailNotice, writeGuardLog } from './guards.js'
import { createPluginApiService } from './plugin-api-service.js'
import { createRequestHasImage, installProjectionGuard } from './projection-guard.js'

export const name = 'dsh-plugin-api'
export const inject = ['llm', 'agents']

export function apply(ctx) {
  const guard = checkHostEnvironment(ctx, { dshLlm })
  const registry = new AdmissionRegistry()

  // The admission bridge is installed by a later task. Until then (and
  // whenever the bridge cannot be installed) the public service reports
  // `isActive: false` and register() returns an inert no-op dispose.
  let admissionActive = false

  const logError = (message) => {
    try {
      ctx?.logger?.error?.(message)
    } catch {
      // logging must never take down the fail-safe path
    }
  }

  const logWarn = (message) => {
    try {
      ctx?.logger?.warn?.(message)
    } catch {
      // logging must never take down the fail-safe path
    }
  }

  const registerService = () => {
    try {
      if (typeof ctx?.plugin !== 'function') return false
      ctx.plugin(createPluginApiService({ registry, isActive: () => admissionActive }))
      return true
    } catch (error) {
      logError(`dsh-plugin-api failed to register pluginApi service: ${error?.message ?? error}`)
      return false
    }
  }

  const guardFailed = !guard.skipped && !guard.ok

  if (guardFailed) {
    // R1.3: when the guard fails but ctx.plugin exists, still register an
    // INERT pluginApi service so third-party plugins get a clear
    // "feature not active" signal instead of a missing-service boot failure.
    const registered = registerService()
    const logPath = writeGuardLog(guard.problems)
    logError(guardFailNotice(logPath))
    if (!registered) {
      // ctx.plugin itself is missing (a core guard problem). There is no way
      // to provide the service; the guard log + notice are the only option.
    }
    return
  }

  // Guard passed (or was explicitly disabled): register the service. The
  // admission effect stays inactive until the bridge is wired in a later task.
  const registered = registerService()
  if (!registered) {
    const problems = [
      { name: 'ctx.plugin', detail: 'fiber context cannot register the pluginApi service (apply-time check)' },
    ]
    const logPath = writeGuardLog(problems)
    logError(guardFailNotice(logPath))
    return
  }

  // Wire the admission bridge only when apiProxy is available and well-formed.
  // apiProxy is deliberately NOT in `inject`: headless profiles may not mount
  // it, and injecting a missing service would pend this plugin and kill boot.
  try {
    if (typeof ctx?.get !== 'function') {
      logWarn('dsh-plugin-api: ctx.get is unavailable; admission effect stays inactive')
    } else {
      const apiProxy = ctx.get('apiProxy')
      const apiProxyShapeOk =
        typeof apiProxy?.sessions?.prompt === 'function' &&
        typeof apiProxy?.sessions?.selectModel === 'function'

      if (!apiProxyShapeOk) {
        logWarn('dsh-plugin-api: apiProxy.sessions is unavailable or malformed; admission effect stays inactive')
      } else if (typeof ctx?.effect !== 'function') {
        logWarn('dsh-plugin-api: ctx.effect is unavailable; admission bridge skipped because cleanup cannot be registered')
      } else {
        const bridge = installAdmissionBridge({
          llm: ctx.llm,
          apiProxy,
          registry,
          agents: ctx.agents,
          logger: ctx.logger,
        })

        if (!bridge.isActive()) {
          logWarn('dsh-plugin-api: admission bridge did not become active; admission effect stays inactive')
        } else {
          admissionActive = true
          try {
            ctx.effect(() => () => {
              bridge.dispose()
              admissionActive = false
            }, 'dsh-plugin-api: admission bridge cleanup')
          } catch (error) {
            bridge.dispose()
            admissionActive = false
            logWarn(`dsh-plugin-api: failed to register admission bridge cleanup: ${error?.message ?? error}`)
          }
        }
      }
    }
  } catch (error) {
    logWarn(`dsh-plugin-api: admission bridge setup failed: ${error?.message ?? error}`)
  }

  // Wire the projection guard. This is only reached when the guard passed (or
  // was explicitly disabled); the guard-failure path returns before this point,
  // so a failed self-check never installs the llm/stream listener.
  try {
    if (typeof ctx?.effect !== 'function') {
      logWarn('dsh-plugin-api: ctx.effect is unavailable; projection guard skipped because cleanup cannot be registered')
    } else {
      const disposeProjectionGuard = installProjectionGuard({
        ctx,
        registry,
        agents: ctx.agents,
        hasImage: createRequestHasImage(dshLlm?.contentHasImage),
        logger: ctx.logger,
      })
      try {
        ctx.effect(() => disposeProjectionGuard, 'dsh-plugin-api: projection guard cleanup')
      } catch (error) {
        try {
          disposeProjectionGuard()
        } catch {
          // disposal must never take down the fail-safe path
        }
        logWarn(`dsh-plugin-api: failed to register projection guard cleanup: ${error?.message ?? error}`)
      }
    }
  } catch (error) {
    logWarn(`dsh-plugin-api: projection guard setup failed: ${error?.message ?? error}`)
  }
}
