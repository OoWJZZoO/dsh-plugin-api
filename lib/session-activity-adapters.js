/**
 * Evidence adapters for the session activity projection.
 *
 * Three intake paths feed the shared activity store:
 * - official event subscriptions (agent-loop status/error, session/event
 *   firehose, approval/tools durability mirrored on the firehose) — observe
 *   only, never dispatch/transform/veto;
 * - the durable joiner: cursor-based replay/dedupe of a session's durable log
 *   with seq-gap markers;
 * - the attempt-facts consumption adapter: read-only consumption of the
 *   agent-loop attempt-facts slice (`agent/attempt/start|end`, frozen payload
 *   contract). The slice itself is implemented by the agent-loop owner line;
 *   this module only consumes it, gate-enabled on slice active + version
 *   match. When the slice is inactive or mismatched, no attempt fact is ever
 *   mislabelled observed — the projection degrades per its availability
 *   contract instead.
 *
 * Every adapter is isolated and fail-open: a registration failure or a
 * malformed payload only degrades that source's availability; nothing here
 * throws through mount or dispatch.
 */
import { deriveTerminal } from './session-activity-derivation.js'
import { activityObservationContract } from './session-activity-contract.js'

function isObject(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== ''
}

function nowIso() {
  return new Date().toISOString()
}

function degrade(availability, group, logger, message) {
  if (availability[group] !== 'missing') availability[group] = 'degraded'
  try {
    logger?.warn?.(`dsh-plugin-api session-activity: ${group} source degraded: ${message}`)
  } catch {
    // logging must never escape the fail-safe path
  }
}

function sessionIdOfSession(session) {
  if (!isObject(session)) return undefined
  try {
    const id = session?.id ?? session?.header?.id
    return isNonEmptyString(id) ? id : undefined
  } catch {
    return undefined
  }
}

/**
 * Create and register the evidence adapters.
 *
 * @param {{ ctx: object, store: object, logger?: object, now?: () => string,
 *           observe?: boolean }} options
 * @returns {{
 *   dispose: () => boolean,
 *   availability: Record<string, string>,
 *   setSliceState: ({ active: boolean, versionMatched: boolean }) => void,
 *   sliceState: () => { active: boolean, versionMatched: boolean },
 *   ingestAttemptFact: (event: string, payload: object) => boolean,
 *   joinDurable: (session: object) => object,
 *   lastAppliedSeq: (sessionId: string) => number | undefined,
 * }}
 */
export function createSessionActivityAdapters({
  ctx,
  store,
  logger,
  now = nowIso,
  observe = true,
} = {}) {
  const availability = {
    session: 'available',
    agent: 'available',
    tools: 'available',
    approval: 'available',
    slice: 'inactive',
  }
  const disposers = []
  const lastSeqs = new Map() // sessionId -> last applied durable seq
  const sliceStateHolder = { active: false, versionMatched: false }
  let disposed = false
  const contract = activityObservationContract()

  function subscribe(name, group, listener) {
    if (!observe || typeof ctx?.on !== 'function') {
      availability[group] = 'missing'
      return null
    }
    try {
      const disposer = ctx.on(name, listener)
      if (typeof disposer === 'function') {
        disposers.push(disposer)
        return true
      }
      availability[group] = 'missing'
      return null
    } catch (error) {
      degrade(availability, group, logger, error?.message ?? String(error))
      return null
    }
  }

  function applyDurable(sessionId, event) {
    const type = event?.type
    const seq = Number.isInteger(event?.seq) ? event.seq : undefined
    const data = isObject(event?.data) ? event.data : {}
    const base = {
      source: 'durable',
      sessionId,
      ...(seq !== undefined ? { seq } : {}),
      observedAt: nowIso(),
    }
    switch (type) {
      case 'turn/start': {
        store.ingest({ ...base, kind: 'start', turn: data.turn })
        break
      }
      case 'turn/end': {
        store.ingest({ ...base, kind: 'turn-end' })
        const cur = store.current(sessionId)
        if (cur) {
          const candidate = data?.reason?.kind === 'completed'
            ? deriveTerminal(cur, {
                turnCompleted: true,
                openApprovals: cur.openApprovals,
                openTools: cur.openTools,
              })
            : null
          if (candidate) {
            store.ingest({ ...base, kind: 'terminal', ...candidate })
          }
        }
        break
      }
      case 'step/start':
        store.ingest({ ...base, kind: 'phase', phase: 'running' })
        break
      case 'step/end':
        store.ingest({ ...base, kind: 'phase', phase: 'running' })
        break
      case 'approval/asked':
        store.ingest({
          ...base,
          kind: 'phase',
          phase: 'waiting',
          waiting: 'approval',
          approvalOpen: true,
        })
        break
      case 'approval/decided':
        if (data?.outcome === 'rejected') {
          store.ingest({
            ...base,
            kind: 'phase',
            approvalOpen: false,
          })
          const cur = store.current(sessionId)
          if (cur) {
            const candidate = deriveTerminal(cur, { approvalRejected: true })
            if (candidate) store.ingest({ ...base, kind: 'terminal', ...candidate })
          }
        } else {
          // the approval wait closed on official durable evidence
          store.ingest({
            ...base,
            kind: 'phase',
            phase: 'running',
            waiting: null,
            approvalOpen: false,
          })
        }
        break
      case 'tool/call':
        store.ingest({
          ...base,
          kind: 'phase',
          phase: 'waiting',
          waiting: 'tool',
          toolOpen: true,
        })
        break
      case 'tool/result':
        store.ingest({ ...base, kind: 'phase', toolOpen: false })
        {
          const cur = store.current(sessionId)
          if (cur && cur.openTools === 0 && cur.status?.waiting?.kind === 'tool') {
            // the tool wait closed; running follows from the still-open turn
            store.ingest({
              ...base,
              kind: 'phase',
              phase: 'running',
              waiting: null,
            })
          }
        }
        break
      default:
        // user/message, assistant/message, assistant/chunk, request/header,
        // approval/policy, session/end-seed, ... are context, not state
        // transitions; they never change the projection by themselves
        // (silence is never inventing facts).
        break
    }
  }

  /** Dedupe/replay gate around the live firehose. */
  function applyDurableDedupe(sessionId, event) {
    const seq = Number.isInteger(event?.seq) ? event.seq : undefined
    const last = lastSeqs.get(sessionId)
    if (seq === undefined) {
      applyDurable(sessionId, event)
      return
    }
    if (last !== undefined && seq <= last) {
      // Duplicate or stale: applied once per activity and cursor; the
      // projection never rewinds.
      return
    }
    if (last !== undefined && seq > last + 1) {
      store.ingest({
        kind: 'gap',
        source: 'durable',
        sessionId,
        fromSeq: last + 1,
        toSeq: seq - 1,
      })
    }
    lastSeqs.set(sessionId, seq)
    applyDurable(sessionId, event)
  }

  // --- session/event firehose (live durable stream) ----------------------
  subscribe('session/event', 'session', (session, event) => {
    if (!isObject(event)) return
    const sessionId = sessionIdOfSession(session)
    if (!sessionId) return
    applyDurableDedupe(sessionId, event)
  })
  subscribe('session/created', 'session', () => {
    // presence probe: the firehose is reachable
  })
  subscribe('session/disposed', 'session', () => {
    // lifecycle context; store records stay bounded by owner lifetime
  })

  // --- agent-loop status / error -----------------------------------------
  subscribe('agent/status', 'agent', (payload) => {
    if (!isObject(payload)) return
    const sessionId = sessionIdOfSession(payload?.agent?.session)
    if (!sessionId || payload?.status !== 'running') return
    store.ingest({
      source: 'agent',
      sessionId,
      kind: 'phase',
      phase: 'running',
    })
  })
  subscribe('agent/error', 'agent', (payload) => {
    const sessionId = sessionIdOfSession(payload?.agent?.session)
    if (!sessionId) return
    const cur = store.current(sessionId)
    if (!cur || cur.fidelity?.sliceObserved) return
    const candidate = deriveTerminal(cur, { agentError: true })
    if (candidate) {
      store.ingest({
        source: 'agent',
        sessionId,
        kind: 'terminal',
        ...candidate,
      })
    }
  })
  subscribe('agent/inbox/inserted', 'agent', () => {})
  subscribe('agent/inbox/claimed', 'agent', () => {})
  subscribe('agent/inbox/discarded', 'agent', () => {})

  // --- tools presence -----------------------------------------------------
  subscribe('tools/change', 'tools', () => {})

  // --- attempt-facts slice consumption (read-only, gate-enabled) ----------
  subscribe('agent/attempt/start', 'slice', (payload) => {
    ingestAttemptFact('agent/attempt/start', payload)
  })
  subscribe('agent/attempt/end', 'slice', (payload) => {
    ingestAttemptFact('agent/attempt/end', payload)
  })

  function ingestAttemptFact(event, payload) {
    if (disposed) return false
    if (!isNonEmptyString(event) || !isObject(payload)) return false
    if (!sliceStateHolder.active || sliceStateHolder.versionMatched !== true) {
      // The slice is inactive or version-mismatched: the fact is refused, the
      // projection degrades per the availability contract; an attempt fact is
      // never mislabelled observed.
      degrade(availability, 'slice', logger, 'attempt fact refused while the slice is not active')
      return false
    }
    let valid = false
    if (event === 'agent/attempt/start') {
      valid = contract.attemptStart.validate(payload)
    } else if (event === 'agent/attempt/end') {
      valid = contract.attemptEnd.validate(payload)
    }
    if (!valid) {
      degrade(availability, 'slice', logger, `invalid attempt fact payload for ${event}`)
      return false
    }
    const sessionId = payload.sessionId
    if (event === 'agent/attempt/start') {
      store.ingest({
        source: 'attempt',
        sessionId,
        kind: 'start',
        executionId: isNonEmptyString(payload.executionId) ? payload.executionId : undefined,
        attemptId: payload.attemptId,
        seq: payload.seq,
        observedAt: payload.observedAt,
      })
    } else {
      store.ingest({
        source: 'attempt',
        sessionId,
        kind: 'terminal',
        executionId: isNonEmptyString(payload.executionId) ? payload.executionId : undefined,
        attemptId: payload.attemptId,
        outcome: payload.outcome,
        followUp: payload.followUp,
        reason: isNonEmptyString(payload.reason) ? payload.reason : undefined,
        classification: isNonEmptyString(payload.classification) ? payload.classification : undefined,
        seq: payload.seq,
        observedAt: payload.observedAt,
      })
    }
    availability.slice = 'active'
    return true
  }

  /** Replay/joinder of one session's durable log with cursor dedupe. */
  function joinDurable(session) {
    if (disposed) return { replayed: 0, skipped: 0, gap: false, unavailable: true }
    const target = isObject(session) && Array.isArray(session?.events)
      ? session
      : undefined
    if (!target && typeof ctx?.get === 'function') {
      try {
        const sessions = ctx.get('sessions')
        if (typeof sessions?.get !== 'function') {
          availability.durable = 'missing'
          return { replayed: 0, skipped: 0, gap: false, unavailable: true }
        }
        const resolved = session != null ? sessions.get(session) : undefined
        if (isObject(resolved) && Array.isArray(resolved?.events)) {
          availability.durable = 'available'
          return joinDurable(resolved)
        }
        if (!session) availability.durable = 'missing'
        return { replayed: 0, skipped: 0, gap: false, unavailable: true }
      } catch (error) {
        degrade(availability, 'durable', logger, error?.message ?? String(error))
        return { replayed: 0, skipped: 0, gap: false, unavailable: true }
      }
    }
    if (!target) {
      availability.durable = 'missing'
      return { replayed: 0, skipped: 0, gap: false, unavailable: true }
    }
    availability.durable = 'available'
    const sessionId = sessionIdOfSession(target)
    if (!sessionId) return { replayed: 0, skipped: 0, gap: false, unavailable: true }
    const last = lastSeqs.get(sessionId)
    let replayed = 0
    let skipped = 0
    let sawGap = false
    let cursor = last ?? -1
    for (const event of target.events) {
      if (!isObject(event) || !Number.isInteger(event.seq)) continue
      if (event.seq <= cursor) {
        skipped += 1
        continue
      }
      if (event.seq > cursor + 1) {
        store.ingest({
          kind: 'gap',
          source: 'durable',
          sessionId,
          fromSeq: cursor + 1,
          toSeq: event.seq - 1,
        })
        sawGap = true
      }
      cursor = event.seq
      lastSeqs.set(sessionId, cursor)
      applyDurable(sessionId, event)
      replayed += 1
    }
    return { replayed, skipped, gap: sawGap, unavailable: false }
  }

  function setSliceState({ active, versionMatched }) {
    sliceStateHolder.active = active === true
    sliceStateHolder.versionMatched = versionMatched === true
    availability.slice = sliceStateHolder.active && sliceStateHolder.versionMatched
      ? 'active'
      : sliceStateHolder.active
        ? 'version-mismatch'
        : 'inactive'
  }

  function sliceState() {
    return { active: sliceStateHolder.active, versionMatched: sliceStateHolder.versionMatched }
  }

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
    lastSeqs.clear()
    return true
  }

  for (const group of ['session', 'agent', 'tools', 'approval']) {
    if (availability[group] === 'available' && (!observe || typeof ctx?.on !== 'function')) {
      availability[group] = 'missing'
    }
  }

  return {
    dispose,
    availability,
    setSliceState,
    sliceState,
    ingestAttemptFact,
    joinDurable,
    lastAppliedSeq: (sessionId) => lastSeqs.get(sessionId),
  }
}