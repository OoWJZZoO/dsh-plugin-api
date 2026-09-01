/**
 * Automatic recovery consumption slice for the agent-loop replacement row.
 *
 * At the two official failure boundaries owned by this component
 * (`agent/request-error` and tool dispatch/preparation failures) the slice
 * consults the facade's private internal recovery authority (`recovery.decide`
 * + `recovery.commit`) so a registered recovery policy is evaluated and
 * consumed automatically, once per decision window.
 *
 * Rules implemented here (requirement 5, design §3):
 * - a missing or malformed internal contract is fail-safe: the documented
 *   official default (the official retry waterfall / scheduler failure
 *   semantics) governs and nothing is silently approved or blocked;
 * - when no recovery policy matches, `decide` returns a null decision and the
 *   official default governs unchanged;
 * - an accepted retry re-enters the same execution with a distinct attempt
 *   identity; the single-consumption commit guard bounds each window to one
 *   automatic application, so duplicate or stale failures never start a
 *   second attempt;
 * - abort/stop/fork decisions become a terminal outcome applied before the
 *   official error commit;
 * - the operation identity of started calls is preserved; skipped and aborted
 *   calls keep the official ordering and result semantics.
 *
 * The slice reads the authority through the repository-wide `Symbol.for`
 * collaboration convention (same as the egress slices) and never imports
 * main-facade internals. It is additive: the exported surface of the vendored
 * official loop module stays identical.
 */

export const POLICY_AUTHORITY = Symbol.for('dsh-plugin-api.policyAuthority')
/** Owner identity used for capability declarations and decision attribution. */
export const RECOVERY_OWNER_ID = 'agent-loop-replacement'

const MAX_ID = 120
const MAX_STRING = 160
const MAX_BUDGET = 10_000

function boundedString(value, max = MAX_STRING) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const text = String(value).trim()
  return text ? text.slice(0, max) : undefined
}

function readAuthority(loopCtx) {
  try {
    const root = loopCtx?.root ?? loopCtx
    const contract = root?.[POLICY_AUTHORITY] ?? loopCtx?.[POLICY_AUTHORITY]
    if (contract && typeof contract.recovery?.decide === 'function' && typeof contract.recovery?.commit === 'function') {
      return contract
    }
  } catch {
    // fall through to the fail-safe official default
  }
  return null
}

/**
 * Declare the capability describing this component's own operation through
 * the facade's public recovery capability registry. The declaration is
 * best-effort: without it the authority rejects policy retries with a typed
 * bounds error and the consumer falls back to its fail-safe default.
 */
function declareCapability(loopCtx, spec) {
  try {
    const pluginApi = loopCtx?.get?.('pluginApi') ?? loopCtx?.root?.get?.('pluginApi')
    const register = pluginApi?.executions?.recovery?.capability?.register
    if (typeof register !== 'function') return null
    const handle = register(spec)
    return handle && typeof handle.dispose === 'function' ? handle : handle ?? null
  } catch {
    return null
  }
}

function countRetriesThisTurn(session, turn) {
  try {
    let count = 0
    const events = session?.events
    if (!Array.isArray(events)) return 0
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]
      if (event?.type !== 'llm/retry') continue
      if (event.data?.turn === turn) count += 1
    }
    return count
  } catch {
    return 0
  }
}

function commitOutcome(decision, committed) {
  if (!committed?.ok) return { governs: true, terminal: true, decisionId: decision.decisionId }
  const action = decision.action
  if (action === 'retry') {
    return { governs: true, action: { kind: 'retry', cause: decision.reason?.code ?? 'recovery-retry' }, decisionId: decision.decisionId }
  }
  if (action === 'fallback') {
    // Recovery never selects routes; a fallback re-enters the next attempt
    // with a fallback cause so the route owner decides the route.
    return { governs: true, action: { kind: 'retry', cause: 'recovery-fallback' }, decisionId: decision.decisionId }
  }
  return { governs: true, terminal: true, decisionId: decision.decisionId }
}

/**
 * Consult the recovery authority for one model-request failure
 * (`recovery/model` path). Returns `{ governs: false }` when the official
 * default governs, or the converged application result.
 */
export async function consumeRequestRecovery({
  loopCtx,
  session,
  turn,
  attemptEpoch,
  provider,
  failure,
  retryPolicy,
  signal,
} = {}) {
  const authority = readAuthority(loopCtx)
  if (!authority) return { governs: false }
  const sessionId = boundedString(session?.id, MAX_ID) ?? 'unknown-session'
  const executionId = boundedString(`agent-loop:${sessionId}:turn-${turn}`, MAX_ID)
  const attemptId = boundedString(attemptEpoch, MAX_ID) ?? '0'
  const generation = boundedString(`${sessionId}:${turn}`, MAX_ID)
  const maxRetries = Number.isInteger(retryPolicy?.maxRetries) && retryPolicy.maxRetries > 0
    ? Math.min(retryPolicy.maxRetries, MAX_BUDGET)
    : retryPolicy?.mode === 'always' ? MAX_BUDGET : 0
  const attemptsRemaining = Math.max(0, maxRetries - countRetriesThisTurn(session, turn))
  declareCapability(loopCtx, {
    operationId: 'agent-loop-model-request',
    ownerId: RECOVERY_OWNER_ID,
    generation,
    scope: 'session',
    idempotent: false,
    retryable: true,
    allowNonIdempotentRetry: true,
    allowedActions: ['retry', 'fallback', 'abort', 'stop'],
    sideEffectClass: 'external',
    ...(maxRetries > 0 ? { retryBudget: { maxAttempts: maxRetries } } : {}),
  })
  let result
  try {
    result = await authority.recovery.decide({
      ownerId: RECOVERY_OWNER_ID,
      generation,
      path: 'recovery/model',
      scope: 'session',
      provider: boundedString(provider, MAX_STRING),
      execution: { executionId, attemptId, active: true, cancellable: true },
      capability: { operationId: 'agent-loop-model-request', ownerId: RECOVERY_OWNER_ID, generation },
      failure: failure ?? undefined,
      signal,
      attemptsRemaining,
    })
  } catch {
    return { governs: false }
  }
  if (!result?.ok || result.decision === null) return { governs: false }
  let committed
  try {
    committed = await authority.recovery.commit(result.decision, {
      operation: { ownerId: RECOVERY_OWNER_ID, generation, executionId, attemptId },
    })
  } catch {
    return { governs: true, terminal: true, decisionId: result.decision.decisionId }
  }
  return commitOutcome(result.decision, committed)
}

/**
 * Consult the recovery authority for one tool dispatch/preparation failure
 * (`recovery/tool` path). The explicit decision window keeps the commit guard
 * bounds to one automatic re-dispatch per call; started calls preserve their
 * operation identity.
 */
export async function consumeToolRecovery({
  loopCtx,
  session,
  turn,
  step,
  callId,
  toolName,
  failure,
  signal,
} = {}) {
  const authority = readAuthority(loopCtx)
  if (!authority) return { governs: false }
  const sessionId = boundedString(session?.id, MAX_ID) ?? 'unknown-session'
  const executionId = boundedString(`agent-loop:${sessionId}:turn-${turn}`, MAX_ID)
  const attemptId = boundedString(`tool:${step}:${callId}`, MAX_ID)
  const generation = boundedString(`${sessionId}:${turn}:${step}`, MAX_ID)
  const windowId = boundedString(`tool:${sessionId}:${turn}:${step}:${callId}`, MAX_ID)
  declareCapability(loopCtx, {
    operationId: 'agent-loop-tool-dispatch',
    ownerId: RECOVERY_OWNER_ID,
    generation,
    scope: 'session',
    idempotent: false,
    retryable: true,
    allowNonIdempotentRetry: true,
    allowedActions: ['retry', 'abort', 'stop'],
    sideEffectClass: 'external',
    retryBudget: { maxAttempts: 2 },
  })
  let result
  try {
    result = await authority.recovery.decide({
      ownerId: RECOVERY_OWNER_ID,
      generation,
      path: 'recovery/tool',
      scope: 'session',
      decisionWindowId: windowId,
      execution: { executionId, attemptId, active: true, cancellable: true },
      capability: { operationId: 'agent-loop-tool-dispatch', ownerId: RECOVERY_OWNER_ID, generation },
      failure: failure ?? undefined,
      signal,
      attemptsRemaining: 1,
    })
  } catch {
    return { governs: false }
  }
  if (!result?.ok || result.decision === null) return { governs: false }
  let committed
  try {
    committed = await authority.recovery.commit(result.decision, {
      operation: { ownerId: RECOVERY_OWNER_ID, generation, executionId, attemptId },
    })
  } catch {
    return { governs: true, terminal: true, decisionId: result.decision.decisionId }
  }
  const outcome = commitOutcome(result.decision, committed)
  return { ...outcome, toolName: boundedString(toolName, MAX_ID) }
}
