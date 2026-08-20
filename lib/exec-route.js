import { deepFreeze } from './deep-freeze.js'

function isObject(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== ''
}

function writeDiagnostic(logger) {
  try {
    logger?.error?.('dsh-plugin-api exec-route tools/pre-execute resolution-failure')
  } catch {
    // diagnostics must never affect official tool execution
  }
}

/**
 * Create the private execution-route authority for one mounted feature owner.
 * Route state remains external to official DSH objects and is available only
 * after the native pre-execute observation has captured an outcome.
 *
 * @param {{ ctx?: object, logger?: { error?: (message: string) => void }, epoch?: object, isCurrentEpoch?: (epoch: object) => boolean, onCurrentDispose?: () => void }} [options]
 */
export function createExecRouteOwner({ ctx, logger, epoch = {}, isCurrentEpoch = () => true, onCurrentDispose = () => {} } = {}) {
  const observed = new WeakSet()
  const outcomes = new WeakMap()
  const diagnostics = new WeakSet()
  let disposed = false
  let removeHook = null

  function cache(exec, outcome) {
    outcomes.set(exec, outcome)
    return outcome
  }

  function diagnoseOnce(exec) {
    if (diagnostics.has(exec)) return
    diagnostics.add(exec)
    writeDiagnostic(logger)
  }

  function capture(exec) {
    if (disposed || !isObject(exec) || observed.has(exec)) return

    try {
      observed.add(exec)
      const agent = exec.agent
      if (!isObject(agent)) return cache(exec, undefined)

      const session = agent.session
      if (!isObject(session)) return cache(exec, undefined)

      const requestContext = session.requestContext
      if (typeof requestContext !== 'function') return cache(exec, undefined)

      const context = requestContext.call(session)
      if (!isObject(context)) return cache(exec, undefined)

      const provider = context.provider
      const model = context.model
      if (!isNonEmptyString(provider) || !isNonEmptyString(model)) {
        return cache(exec, undefined)
      }

      return cache(exec, deepFreeze({ provider, model }))
    } catch {
      try {
        cache(exec, undefined)
        diagnoseOnce(exec)
      } catch {
        // State bookkeeping must not surface through the official hook.
      }
    }
  }

  const owner = {
    routeOf(exec) {
      if (!isObject(exec) || !observed.has(exec)) return undefined
      return outcomes.get(exec)
    },

    capture,

    dispose() {
      if (disposed) return
      disposed = true
      const remove = removeHook
      removeHook = null
      try {
        remove?.()
      } catch {
        // A hook cleanup failure must not escape the fail-safe path.
      }
      try {
        if (!isCurrentEpoch(epoch)) return
        onCurrentDispose()
      } catch {
        // The owner cannot safely affect a newer or unknown mount state.
      }
    },
  }

  try {
    if (typeof ctx?.on !== 'function') {
      throw new TypeError('ctx.on is required for execRoute capture')
    }
    const disposer = ctx.on('tools/pre-execute', function captureRoute(exec, next) {
      try {
        capture(exec)
      } catch {
        // Capture is fail-open; preserve the native waterfall continuation.
      }
      return next()
    }, { prepend: true })
    if (typeof disposer !== 'function') {
      throw new TypeError('tools/pre-execute hook did not produce a disposer')
    }
    removeHook = disposer
  } catch (error) {
    owner.dispose()
    throw error
  }

  return owner
}
