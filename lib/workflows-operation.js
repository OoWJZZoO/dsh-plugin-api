/**
 * Controlled workflow run entry (`workflows.start`), core module.
 *
 * The official `workflowEngine` seam owns execution: `start(request)` validates
 * synchronously and returns a holder-owned live run whose `result` never
 * rejects. This module validates the request shape before any engine call,
 * maps the engine's synchronous refusals (open mapping: the official
 * `WorkflowError` code is passed through unchanged) and the settled result onto
 * a frozen discriminated terminal, and wraps the official run into the public
 * handle without minting a second run identity, a second terminal authority or
 * a global run registry.
 */

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

const frozen = (value) => Object.freeze(value)

function bounded(value, max = 240) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const text = String(value)
  return text ? text.slice(0, max) : undefined
}

/**
 * Validate the request shape before any engine call. The engine remains the
 * only validator of the meta block and of the script body (the official
 * synchronous `META_INVALID` / `SCRIPT_PARSE` codes are passed through).
 */
export function validateStartRequest(request) {
  if (!isPlainObject(request)) {
    return frozen({ ok: false, code: 'invalid-request', reason: 'the workflow request must be an object' })
  }
  if (typeof request.script !== 'string' || request.script.length === 0) {
    return frozen({ ok: false, code: 'invalid-request', reason: 'the workflow request requires a non-empty script body' })
  }
  if (!isPlainObject(request.meta)) {
    return frozen({ ok: false, code: 'invalid-request', reason: 'the workflow request requires a meta block' })
  }
  if (!isPlainObject(request.parent)) {
    return frozen({ ok: false, code: 'invalid-request', reason: 'the workflow request requires a parent agent reference' })
  }
  if (request.subagentProvider !== undefined && (typeof request.subagentProvider !== 'string' || request.subagentProvider.length === 0)) {
    return frozen({ ok: false, code: 'invalid-request', reason: 'the subagentProvider must be a non-empty string' })
  }
  if (request.maxTotalAgents !== undefined && !Number.isSafeInteger(request.maxTotalAgents)) {
    return frozen({ ok: false, code: 'invalid-request', reason: 'the maxTotalAgents must be a safe integer' })
  }
  if (request.signal !== undefined && (typeof request.signal !== 'object' || request.signal === null || typeof request.signal.aborted !== 'boolean')) {
    return frozen({ ok: false, code: 'invalid-request', reason: 'the signal must be an AbortSignal' })
  }
  return null
}

/**
 * Map one synchronous engine refusal. The official `WorkflowError` code is
 * passed through unchanged (open mapping: the seam does not fix the
 * synchronous code set); any other wrapper-layer failure is contained as the
 * facade's own `internal` code.
 */
export function mapStartRejection(error) {
  const code = bounded(error?.code, 64)
  if (error?.name === 'WorkflowError' && code !== undefined) {
    return frozen({ ok: false, code, reason: bounded(error?.message) ?? 'the workflow engine refused the request' })
  }
  return frozen({ ok: false, code: 'internal', reason: bounded(error?.message) ?? 'the workflow start failed before a run was created' })
}

/** Deep-freeze one settled JSON value (the value is host JSON data). */
function deepFreezeJson(value, depth = 0) {
  if (depth > 8 || value === null || typeof value !== 'object') return value
  if (Object.isFrozen(value)) return value
  if (Array.isArray(value)) {
    for (const entry of value) deepFreezeJson(entry, depth + 1)
    return Object.freeze(value)
  }
  if (!isPlainObject(value)) return value
  for (const key of Object.keys(value)) deepFreezeJson(value[key], depth + 1)
  return Object.freeze(value)
}

/** Map one settled official result onto the frozen discriminated terminal. */
export function mapWorkflowResult(settled) {
  const stopReason = settled?.stopReason
  const agentsStarted = Number.isSafeInteger(settled?.agentsStarted) ? settled.agentsStarted : undefined
  if (stopReason === 'completed') {
    return frozen({
      ok: true,
      terminal: 'success',
      stopReason: 'completed',
      ...(settled?.value === undefined ? {} : { value: deepFreezeJson(settled.value) }),
      ...(agentsStarted === undefined ? {} : { agentsStarted }),
    })
  }
  if (stopReason === 'cancelled') {
    return frozen({
      ok: false,
      terminal: 'aborted',
      stopReason: 'cancelled',
      // The engine's settlement message is preserved verbatim (design §3.6).
      ...(settled?.error === undefined ? {} : { error: settled.error }),
      ...(agentsStarted === undefined ? {} : { agentsStarted }),
    })
  }
  return frozen({
    ok: false,
    terminal: 'error',
    stopReason: 'error',
    ...(settled?.error === undefined ? {} : { error: settled.error }),
    ...(agentsStarted === undefined ? {} : { agentsStarted }),
  })
}

/**
 * Wrap one official live run into the public handle. The handle is bound to the
 * run identity it was created with (stale operations can never reach another
 * run), `observe` filters the existing event feed by that identity, and every
 * terminal is delivered exactly once through `result`.
 */
/** Freeze the engine-validated meta block for the handle's public view. */
function freezeMeta(meta) {
  if (!isPlainObject(meta)) return meta
  return Object.freeze({
    ...meta,
    ...(Array.isArray(meta.phases) ? { phases: Object.freeze(meta.phases.map((phase) => (isPlainObject(phase) ? Object.freeze({ ...phase }) : phase))) } : {}),
  })
}

export function createWorkflowRunHandle({ run, ownerId, subscribeFeed }) {
  let settled = null
  let disposed = false
  const listeners = new Set()

  const result = Promise.resolve()
    .then(() => run.result)
    .then(
      (value) => {
        settled = mapWorkflowResult(value)
        return settled
      },
      (error) => {
        // The official result never rejects; a rejection here is a wrapper-layer
        // contract breach and is reported fail-closed as an error terminal.
        settled = frozen({
          ok: false,
          terminal: 'error',
          stopReason: 'error',
          error: bounded(error?.message) ?? 'the workflow result could not be mapped',
        })
        return settled
      },
    )

  // Run-scoped observation: the existing workflow/* feed filtered by this run's
  // official identity. No second projection owner is created.
  let unsubscribe = null
  if (typeof subscribeFeed === 'function') {
    try {
      unsubscribe = subscribeFeed((event) => {
        if (disposed) return
        if (!isPlainObject(event) || event.id !== run.id) return
        for (const listener of [...listeners]) {
          try {
            listener(event)
          } catch {
            // containment: one broken listener never affects the others
          }
        }
      })
    } catch {
      unsubscribe = null
    }
  }

  return frozen({
    id: run.id,
    ownerId,
    meta: freezeMeta(run.meta),
    status() {
      if (settled === null) return frozen({ state: 'running' })
      return frozen({
        state: 'settled',
        stopReason: settled.stopReason,
        ...(settled.error === undefined ? {} : { error: settled.error }),
        ...(settled.agentsStarted === undefined ? {} : { agentsStarted: settled.agentsStarted }),
      })
    },
    observe(listener) {
      if (typeof listener !== 'function') return () => {}
      if (disposed) return () => {}
      listeners.add(listener)
      let subscribed = true
      return () => {
        if (!subscribed) return
        subscribed = false
        listeners.delete(listener)
      }
    },
    get result() {
      return result
    },
    cancel(reason) {
      // The engine adjudicates the terminal: cancellation is a signal.
      try {
        run.cancel(reason)
      } catch {
        // a settled run's cancel is the engine's no-op; containment here is the same
      }
    },
    async dispose() {
      if (disposed) return
      disposed = true
      listeners.clear()
      try {
        unsubscribe?.()
      } catch {
        // subscription teardown is best-effort
      }
      await run.dispose()
    },
  })
}
