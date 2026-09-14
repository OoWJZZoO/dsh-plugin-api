import {
  createWorkflowRunHandle,
  mapStartRejection,
  validateStartRequest,
} from './workflows-operation.js'
import { deriveAdapterRegistrationOwner } from './llm-adapter-registration.js'
import { PluginApiFeatureDisabledError } from './errors.js'

/**
 * `workflows` feature mount: the controlled entry over the official
 * `workflowEngine` seam.
 *
 * The facade derives the owner from the calling plugin's fiber, verifies the
 * parent reference against the official agent registry (identity comparison
 * against the live agent), forwards the request unchanged, and wraps the
 * holder-owned live run into the public handle. The engine remains the only
 * executor, validator and terminal authority: no second run identity, no second
 * projection owner, no global run registry.
 */
export function createWorkflowsFeature({ ctx, service, logger }) {
  const reportDiagnostics = (message) => {
    try {
      logger?.warn?.(`dsh-plugin-api workflows: ${String(message).slice(0, 240)}`)
    } catch {
      // diagnostics never escape the facade path
    }
  }
  const resolveService = (name) => {
    try {
      return typeof ctx?.get === 'function' ? ctx.get(name) : undefined
    } catch {
      return undefined
    }
  }
  const engine = () => {
    const candidate = resolveService('workflowEngine')
    // A service must not be a thenable (design §3.1: an object existence check
    // alone never proves a usable engine).
    if (!candidate || typeof candidate !== 'object' || typeof candidate.start !== 'function') return null
    if (typeof candidate.then === 'function') return null
    return candidate
  }

  // The parent must be a live agent reference handed out by the facade's own
  // agents surface: the registry resolves its identity and the reference must
  // be that same object (a bare id, a stale or a self-made object is refused).
  const verifyParent = (parent) => {
    try {
      const id = typeof parent?.id === 'string' && parent.id.length > 0 ? parent.id : undefined
      if (id === undefined) return undefined
      const agents = resolveService('agents')
      if (typeof agents?.get !== 'function') return undefined
      const live = agents.get(id)
      return live === parent ? live : undefined
    } catch {
      return undefined
    }
  }

  const subscribeFeed = (listener) => {
    if (typeof ctx?.on !== 'function') return () => {}
    const names = ['workflow/start', 'workflow/phase', 'workflow/log', 'workflow/agent-start', 'workflow/agent-end', 'workflow/end']
    const offs = []
    for (const name of names) {
      try {
        // The registered workflow/* payloads carry the run info block first; the
        // handle filter compares the run identity against it.
        offs.push(ctx.on(name, (info, ...rest) => {
          listener({ id: info?.id, name, info, args: rest })
        }))
      } catch (error) {
        reportDiagnostics(`workflow fact subscription failed for ${name}: ${error?.message ?? error}`)
      }
    }
    return () => {
      for (const off of offs) {
        try {
          off?.()
        } catch {
          // teardown is best-effort
        }
      }
    }
  }

  const availability = () => {
    try {
      if (!engine()) {
        return Object.freeze({ status: 'unavailable', reason: 'the official workflow engine is not resolvable with a start member' })
      }
      return Object.freeze({ status: 'active' })
    } catch {
      return Object.freeze({ status: 'unavailable', reason: 'the workflow engine probe failed' })
    }
  }

  const callerCache = new WeakMap()
  const surfaceFor = (callerCtx) => {
    let cached
    try {
      cached = callerCache.get(callerCtx)
    } catch {
      cached = undefined
    }
    if (cached) return cached
    const surface = Object.freeze({
      start(request) {
        const active = engine()
        if (active === null) {
          throw new PluginApiFeatureDisabledError('workflows', 'the official workflow engine is not available in this installation')
        }
        const refusal = validateStartRequest(request)
        if (refusal !== null) return refusal
        const parent = verifyParent(request.parent)
        if (parent === undefined) {
          return Object.freeze({ ok: false, code: 'parent-unresolved', reason: 'the parent must be a live agent reference from the facade agents surface' })
        }
        const ownerId = (() => {
          try {
            return deriveAdapterRegistrationOwner(callerCtx) ?? 'unattributed'
          } catch {
            return 'unattributed'
          }
        })()
        let run
        try {
          run = active.start({
            script: request.script,
            meta: request.meta,
            parent,
            ...(request.args === undefined ? {} : { args: request.args }),
            ...(request.subagentProvider === undefined ? {} : { subagentProvider: request.subagentProvider }),
            ...(request.maxTotalAgents === undefined ? {} : { maxTotalAgents: request.maxTotalAgents }),
            ...(request.signal === undefined ? {} : { signal: request.signal }),
          })
        } catch (error) {
          reportDiagnostics(`workflow start refused: ${error?.message ?? error}`)
          return mapStartRejection(error)
        }
        return Object.freeze({
          ok: true,
          code: 'started',
          // The control handle is the `operation` member of the start result.
          // No `terminal` rides the result: the run may still be in flight at
          // return time, so the terminal source is `operation.status()`.
          operation: createWorkflowRunHandle({ run, ownerId, subscribeFeed }),
        })
      },
      availability,
    })
    try {
      callerCache.set(callerCtx, surface)
    } catch {
      // a non-object caller context simply skips the cache
    }
    return surface
  }

  return {
    api: Object.freeze({ surfaceFor, availability }),
    disposer: () => {},
  }
}

/** Mount the workflows feature through the staged publication path. */
export function mountWorkflowsFeature({ ctx, service, featureRegistry, logger }) {
  if (typeof featureRegistry?.isActive === 'function' && featureRegistry.isActive('workflows')) {
    return { disposer: () => {}, prepared: null }
  }
  let feature
  try {
    feature = createWorkflowsFeature({ ctx, service, logger })
  } catch (error) {
    try {
      logger?.warn?.(`dsh-plugin-api: workflows mount failed and stays disabled: ${error?.message ?? error}`)
    } catch {
      // diagnostics must never escape the fail-safe mount path
    }
    return null
  }
  let prepared
  try {
    prepared = service.prepareFeature('workflows', feature.api)
  } catch (error) {
    try {
      logger?.warn?.(`dsh-plugin-api: workflows could not be prepared: ${error?.message ?? error}`)
    } catch {
      // diagnostics must never escape the fail-safe mount path
    }
    return null
  }
  return { disposer: feature.disposer, prepared }
}
