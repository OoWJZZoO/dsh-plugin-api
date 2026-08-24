/**
 * Source adapters for the execution observation projection.
 *
 * Each adapter reads only its declared public official event/service seam and
 * emits internal ObservationFragments into the shared reducer. Adapters are
 * isolated and fail-open: a registration failure or a malformed payload only
 * degrades that source's availability; it never throws through mount or
 * dispatch and never disables unrelated sources.
 *
 * The official event freezes/catalog semantics are left untouched: adapters
 * never mutate official payload objects and never add events-catalog entries.
 */
function isObject(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== ''
}

function nowIso() {
  return new Date().toISOString()
}

function degrade(availability, sourceKind, logger, message) {
  availability[sourceKind] = 'degraded'
  try {
    logger?.warn?.(`dsh-plugin-api execution: ${sourceKind} source degraded: ${message}`)
  } catch {
    // logging must never escape the fail-safe path
  }
}

function agentKey(payload) {
  if (!isObject(payload)) return undefined
  try {
    const id = payload?.agent?.id ?? payload?.agent?.options?.id
    const turn = payload?.turn
    const step = payload?.step
    if (!isNonEmptyString(id) && turn === undefined && step === undefined) return undefined
    return `agent:${id ?? ''}:${turn ?? ''}:${step ?? ''}`
  } catch {
    return undefined
  }
}

function resultIsError(result) {
  return isObject(result) && (result?.isError === true || (result?.error !== undefined && result?.error !== null))
}

function sessionIdOf(exec) {
  try {
    const id = exec?.agent?.session?.id ?? exec?.sessionId
    return isNonEmptyString(id) ? id : undefined
  } catch {
    return undefined
  }
}

/**
 * Create and register the four source adapters.
 *
 * @param {{ ctx: object, reducer: object, logger?: object }} options
 * @returns {{ dispose: () => boolean, availability: Record<string, string> }}
 */
export function createExecutionSources({ ctx, reducer, logger } = {}) {
  const availability = {
    tools: 'available',
    agent: 'available',
    session: 'available',
    llm: 'available',
  }
  const disposers = []
  let disposed = false

  function subscribe(name, listener) {
    if (typeof ctx?.on !== 'function') return null
    let registered = false
    try {
      const disposer = ctx.on(name, listener)
      if (typeof disposer === 'function') {
        disposers.push(disposer)
        registered = true
      } else if (typeof ctx?.off === 'function') {
        ctx.off(name, listener)
      }
    } catch (error) {
      try {
        ctx?.off?.(name, listener)
      } catch {
        // best-effort detach
      }
      degrade(availability, name.split('/')[0], logger, error?.message ?? String(error))
    }
    return registered ? true : null
  }

  // --- tools adapter -------------------------------------------------------
  subscribe('tools/pre-execute', (exec, next) => {
    try {
      reducer.ingest({
        key: exec,
        sourceKind: 'tools',
        observedAt: nowIso(),
        kind: 'start',
        phase: 'tool-start',
        sessionId: sessionIdOf(exec),
        certainty: 'observed',
      })
    } catch {
      // observe-only; never change the official tool decision
    }
    return next()
  })
  subscribe('tools/execute', (exec, next) => {
    try {
      reducer.ingest({ key: exec, sourceKind: 'tools', observedAt: nowIso(), kind: 'phase', phase: 'tool-execute', sessionId: sessionIdOf(exec) })
    } catch {
      // observe-only
    }
    return next()
  })
  subscribe('tools/result', (exec, result) => {
    try {
      reducer.ingest({
        key: exec,
        sourceKind: 'tools',
        observedAt: nowIso(),
        kind: 'terminal',
        outcome: resultIsError(result) ? 'error' : 'success',
        outcomeReason: resultIsError(result) ? { category: 'tool-error' } : undefined,
        sessionId: sessionIdOf(exec),
      })
    } catch {
      // observe-only
    }
  })

  // --- agent adapter -------------------------------------------------------
  subscribe('agent/request', (payload, next) => {
    try {
      const key = agentKey(payload)
      if (key !== undefined) {
        reducer.ingest({
          key,
          sourceKind: 'agent',
          observedAt: nowIso(),
          kind: 'start',
          phase: 'agent-request',
          agentId: payload?.agent?.id,
          sessionId: payload?.agent?.session?.id,
        })
      }
    } catch {
      // observe-only
    }
    return next()
  })
  subscribe('agent/error', (payload) => {
    try {
      const key = agentKey(payload)
      if (key !== undefined) {
        reducer.ingest({
          key,
          sourceKind: 'agent',
          observedAt: nowIso(),
          kind: 'terminal',
          outcome: 'error',
          outcomeReason: { category: 'agent-error' },
        })
      }
    } catch {
      // observe-only
    }
  })

  // --- session adapter -----------------------------------------------------
  subscribe('session/created', (session) => {
    try {
      if (isObject(session) && isNonEmptyString(session?.id)) {
        // Session lifecycle is context, not an execution; only recorded for
        // source availability. Executions carry their own sessionId.
        availability.session = 'available'
      }
    } catch {
      // observe-only
    }
  })
  subscribe('session/event', () => {
    try {
      availability.session = 'available'
    } catch {
      // observe-only
    }
  })

  // --- llm adapter ---------------------------------------------------------
  subscribe('llm/stream', (options, next) => {
    try {
      reducer.ingest({
        key: options,
        sourceKind: 'llm',
        observedAt: nowIso(),
        kind: 'start',
        phase: 'llm-stream',
        agentId: options?.agent?.id,
        sessionId: options?.session?.id ?? options?.sessionId,
      })
    } catch {
      // observe-only; the official continuation is never bypassed
    }
    let result
    try {
      result = next()
    } catch (error) {
      try {
        reducer.ingest({
          key: options,
          sourceKind: 'llm',
          observedAt: nowIso(),
          kind: 'terminal',
          outcome: 'error',
          outcomeReason: { category: 'llm-stream-sync-error' },
        })
      } catch {
        // observe-only
      }
      throw error
    }
    if (result && typeof result.then === 'function') {
      // Detached observation: never replaces the returned value and never
      // produces an unhandled rejection.
      Promise.resolve(result).then(
        () => {
          try {
            reducer.ingest({ key: options, sourceKind: 'llm', observedAt: nowIso(), kind: 'terminal', outcome: 'success' })
          } catch {
            // observe-only
          }
        },
        () => {
          try {
            reducer.ingest({ key: options, sourceKind: 'llm', observedAt: nowIso(), kind: 'terminal', outcome: 'error' })
          } catch {
            // observe-only
          }
        },
      )
    }
    return result
  })

  const dispose = () => {
    if (disposed) return false
    disposed = true
    for (const disposer of disposers.splice(0)) {
      try {
        disposer()
      } catch {
        // a malformed disposer must not escape the fail-safe path
      }
    }
    return true
  }

  // Any source whose registration could not even be attempted is missing.
  for (const kind of Object.keys(availability)) {
    if (availability[kind] === 'available') {
      try {
        if (typeof ctx?.on !== 'function') availability[kind] = 'missing'
      } catch {
        availability[kind] = 'missing'
      }
    }
  }

  return { dispose, availability }
}
