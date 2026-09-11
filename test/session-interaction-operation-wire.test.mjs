/**
 * Client↔host wire tests for the session request/cancel operation
 * (status/observe wiring of the client operation handle).
 *
 * These run the real host route handler against the real client transport over
 * one mock carrier that JSON-serialises every frame the way the connection RPC
 * does, so a same-process object fixture can never mask a wire gap:
 *   - accepted outcomes must be value-only (the client rebuilds the handle),
 *   - `sessions.operation.status` must answer with the authority's real status,
 *   - the client operation handle must observe running → one terminal,
 *   - the caller abort signal must reach the host authority.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSessionInteractionOperation } from '../lib/session-interaction-operation.js'
import { INTERACTION_BOUNDARY_SYMBOL } from '../lib/session-interaction-operation-authority.js'
import {
  createSessionInteractionRouteHandler,
  createClientRequestTransport,
  installClientRequestRoute,
} from '../lib/client-request-bridge.js'
import { createClientSessionInteractionOperation } from '../lib/client-session-interaction-operation.js'

const ROUTE = '/plugin-api/sessions'

const flush = async () => {
  for (let index = 0; index < 12; index += 1) await new Promise((resolve) => setImmediate(resolve))
}

function makeBoundary() {
  return {
    admitted: [],
    cancelled: [],
    admit(spec) {
      this.admitted.push(spec)
      return { accepted: true, attemptRef: { sessionId: spec.sessionId, operationId: spec.operationId } }
    },
    cancelAttempt(ref, input) {
      this.cancelled.push({ ref, by: input?.reason?.by ?? null })
      return { ok: true, code: 'accepted' }
    },
    availability() {
      return { status: 'active' }
    },
  }
}

/** Manually pumped interval source: polling tests stay deterministic. */
function manualTimer() {
  let seq = 0
  const tasks = new Map()
  return {
    setInterval(fn) {
      seq += 1
      tasks.set(seq, fn)
      return seq
    },
    clearInterval(id) {
      tasks.delete(id)
    },
    async tick() {
      for (const fn of [...tasks.values()]) await fn()
      await flush()
    },
    get pending() {
      return tasks.size
    },
  }
}

function makeCarrier() {
  const handlers = new Map()
  const connection = {
    rpc: {
      handle(path, fn) {
        handlers.set(path, fn)
        return () => handlers.delete(path)
      },
      call: async (path, endpoint, args, signal) => {
        const handler = handlers.get(path)
        if (handler === undefined) throw new Error(`no host handler for ${path}`)
        // The carrier propagates the caller's abort into a host-side signal,
        // exactly like the real connection RPC does.
        const controller = new AbortController()
        const forward = () => controller.abort()
        signal?.addEventListener?.('abort', forward, { once: true })
        try {
          const outcome = await handler(endpoint, args, controller.signal)
          // Wire reality: only structured values survive the carrier.
          return JSON.parse(JSON.stringify(outcome))
        } finally {
          signal?.removeEventListener?.('abort', forward)
        }
      },
    },
  }
  return { connection, handlers }
}

function makeHost({ activity } = {}) {
  const boundary = makeBoundary()
  const appends = []
  const ctx = {
    // Owner attribution follows the Cordis fiber (the shared host-side
    // derivation), so the serving context carries a fiber name.
    fiber: { name: 'client-route' },
    get(name) {
      if (name === 'pluginApi') {
        return {
          isActive: true,
          sessions: {
            durable: { appendMessage: async () => ({ ok: true }) },
            ...(activity === undefined ? {} : { activity }),
          },
        }
      }
      if (name === 'sessions') return { get: (id) => (typeof id === 'string' && id.startsWith('s') ? { id } : undefined) }
      if (name === 'agentLoop') return { [INTERACTION_BOUNDARY_SYMBOL]: boundary }
      return undefined
    },
    logger: { warn: () => {} },
  }
  const owner = createSessionInteractionOperation({
    ctx,
    coreActive: () => true,
    durableAppend: async (sessionId, kind, payload) => {
      appends.push({ sessionId, kind, payload })
      return { ok: true, seq: appends.length }
    },
  })
  return { owner, ctx, boundary, appends }
}

function makeWire({ pollIntervalMs = 5, timer = manualTimer(), activity } = {}) {
  const host = makeHost({ activity })
  const carrier = makeCarrier()
  const routeCtx = { get: (name) => (name === 'connection' ? carrier.connection : undefined) }
  const route = installClientRequestRoute({
    ctx: routeCtx,
    path: ROUTE,
    handler: createSessionInteractionRouteHandler({ owner: host.owner, ctx: host.ctx }),
    logger: { warn: () => {} },
  })
  let epoch = 0
  const transport = createClientRequestTransport({
    ctx: routeCtx,
    path: ROUTE,
    epoch: () => epoch,
    pollIntervalMs,
    timer,
  })
  const client = createClientSessionInteractionOperation({
    transport,
    epoch: () => epoch,
    logger: { warn: () => {} },
  })
  return {
    host,
    route,
    transport,
    client,
    timer,
    bumpEpoch: () => {
      epoch += 1
    },
  }
}

test('host route outcome is value-only: no operation method rides the wire', async () => {
  const { host } = makeWire()
  const handler = createSessionInteractionRouteHandler({ owner: host.owner, ctx: host.ctx })
  const outcome = await handler({ method: 'sessions.request', payload: { sessionId: 's1', message: { kind: 'user-message', text: 'hello' } } })
  assert.equal(outcome.ok, true)
  assert.equal(outcome.code, 'accepted')
  assert.equal(typeof outcome.operation.id, 'string')
  assert.equal(outcome.operation.ownerId, 'client-route', 'owner is derived from the serving context')
  for (const key of ['status', 'observe', 'dispose']) {
    assert.equal(outcome.operation[key], undefined, `operation.${key} must never cross the wire`)
  }
})

test('host route answers operation status from the authority, unknown ids as typed stale', async () => {
  const { host } = makeWire()
  const handler = createSessionInteractionRouteHandler({ owner: host.owner, ctx: host.ctx })
  const accepted = await handler({ method: 'sessions.request', payload: { sessionId: 's1' } })
  const status = await handler({ method: 'sessions.operation.status', payload: { operationId: accepted.operation.id } })
  assert.equal(status.ok, true)
  assert.equal(status.status.phase, 'accepted')
  assert.equal(status.status.terminal, null)
  const unknown = await handler({ method: 'sessions.operation.status', payload: { operationId: 'op_missing' } })
  assert.equal(unknown.ok, false)
  assert.equal(unknown.code, 'stale')
})

test('client handle status and observe report the real host progress through one terminal', async () => {
  const wire = makeWire()
  const accepted = await wire.client.request({ sessionId: 's1', message: { kind: 'user-message', text: 'go' } })
  assert.equal(accepted.code, 'accepted')
  const operationId = accepted.operation.id

  const seen = []
  const disposer = accepted.operation.observe((snapshot) => seen.push(snapshot))
  await flush()
  assert.ok(seen.length >= 1, 'the first real status is delivered')
  assert.equal(seen.at(-1).phase, 'accepted')

  wire.host.owner.ingestAttemptFact({ name: 'agent/attempt/start', operationId, attemptId: 'at1', observedAt: 't1' })
  await wire.timer.tick()
  assert.equal(seen.at(-1).phase, 'running', 'attempt start is observable over the wire')

  wire.host.owner.ingestAttemptFact({ name: 'agent/attempt/end', operationId, outcome: 'success', classification: 'completed', observedAt: 't2' })
  await wire.timer.tick()
  const terminal = seen.at(-1)
  assert.equal(terminal.phase, 'terminal')
  assert.equal(terminal.terminal.outcome, 'success')
  assert.equal(wire.timer.pending, 0, 'polling stops at the terminal')

  assert.equal(accepted.operation.status().phase, 'terminal', 'cached snapshot is the real one')
  disposer()
})

test('two owners over the wire stay isolated: cancelling one never touches the other', async () => {
  const wire = makeWire()
  const first = await wire.client.request({ sessionId: 's1', message: { kind: 'user-message', text: 'a' } })
  const second = await wire.client.request({ sessionId: 's2', message: { kind: 'user-message', text: 'b' } })
  assert.equal(first.code, 'accepted')
  assert.equal(second.code, 'accepted')
  for (const outcome of [first, second]) {
    wire.host.owner.ingestAttemptFact({ name: 'agent/attempt/start', operationId: outcome.operation.id, attemptId: `at-${outcome.operation.id}`, observedAt: 't1' })
  }
  const cancelled = await wire.client.cancel({ operationId: first.operation.id, by: 'user', reason: 'stop' })
  assert.equal(cancelled.code, 'accepted')
  assert.equal(wire.host.boundary.cancelled.length, 1, 'only the addressed attempt is cancelled')
  wire.host.owner.ingestAttemptFact({ name: 'agent/attempt/end', operationId: first.operation.id, outcome: 'error', classification: 'aborted', observedAt: 't2' })
  await flush()
  const firstStatus = wire.host.owner.operationStatus(first.operation.id)
  assert.equal(firstStatus.phase, 'terminal')
  assert.equal(firstStatus.terminal.outcome, 'aborted')
  assert.equal(wire.host.owner.operationStatus(second.operation.id).phase, 'running', 'the other owner is untouched')
})

test('caller abort signal crosses the carrier and reaches the host authority', async () => {
  const wire = makeWire()
  const controller = new AbortController()
  // Abort while the request is still in flight: the signal must cross the
  // carrier and must not leave a running operation behind.
  const pending = wire.client.request({ sessionId: 's1', message: { kind: 'user-message', text: 'go' } }, { signal: controller.signal })
  controller.abort()
  const accepted = await pending
  await flush()
  assert.equal(accepted.code, 'accepted')
  assert.equal(wire.host.boundary.cancelled.length, 1, 'the caller abort crossed the carrier into the loop boundary')
  assert.equal(wire.host.boundary.cancelled[0].by, 'owner')
  const status = wire.host.owner.operationStatus(accepted.operation.id)
  assert.equal(status.phase, 'terminal')
  assert.equal(status.terminal.outcome, 'aborted')
})

test('client handle dispose cancels exactly the caller operation', async () => {
  const wire = makeWire()
  const accepted = await wire.client.request({ sessionId: 's1', message: { kind: 'user-message', text: 'go' } })
  assert.equal(accepted.code, 'accepted')
  accepted.operation.dispose()
  await flush()
  assert.equal(wire.host.owner.operationStatus(accepted.operation.id).phase, 'terminal')
})

test('rebind stops wire polling: a stale generation never observes the new one', async () => {
  const wire = makeWire()
  const accepted = await wire.client.request({ sessionId: 's1', message: { kind: 'user-message', text: 'go' } })
  const seen = []
  accepted.operation.observe((snapshot) => seen.push(snapshot))
  await flush()
  wire.bumpEpoch()
  await wire.timer.tick()
  const delivered = seen.length
  wire.host.owner.ingestAttemptFact({ name: 'agent/attempt/start', operationId: accepted.operation.id, attemptId: 'at1', observedAt: 't1' })
  await wire.timer.tick()
  assert.equal(seen.length, delivered, 'no delivery into the stale generation')
})

test('operationStatus is a read-only projection: unknown and disposed ids never forge a terminal', async () => {
  const { host } = makeWire()
  assert.equal(host.owner.operationStatus('op_missing'), null)
  const accepted = await host.owner.request({ sessionId: 's1', message: { kind: 'user-message', text: 'x' } })
  const status = host.owner.operationStatus(accepted.operation.id)
  assert.equal(status.phase, 'accepted')
  assert.equal(status.terminal, null)
  host.owner.dispose()
  assert.equal(host.owner.operationStatus(accepted.operation.id), null, 'a disposed authority answers null, not a terminal')
})

test('a host without the status method degrades honestly: the client never invents progress', async () => {
  const host = makeHost()
  const carrier = makeCarrier()
  // Legacy host route: request/cancel only, no `sessions.operation.status`.
  const route = installClientRequestRoute({
    ctx: { get: (name) => (name === 'connection' ? carrier.connection : undefined) },
    path: ROUTE,
    handler: async (args) => {
      const method = typeof args?.method === 'string' ? args.method : ''
      if (method === 'sessions.request') {
        const outcome = await host.owner.request(args.payload ?? {}, host.ctx)
        return { ok: outcome.ok, code: outcome.code, operation: { id: outcome.operation?.id, ownerId: outcome.operation?.ownerId } }
      }
      if (method === 'sessions.cancel') return host.owner.cancel(args.payload ?? {}, host.ctx)
      return { ok: false, code: 'unsupported', reason: `unsupported client method '${method}'` }
    },
    logger: { warn: () => {} },
  })
  const transport = createClientRequestTransport({
    ctx: { get: (name) => (name === 'connection' ? carrier.connection : undefined) },
    path: ROUTE,
    pollIntervalMs: 5,
    timer: manualTimer(),
  })
  const client = createClientSessionInteractionOperation({ transport, logger: { warn: () => {} } })
  const accepted = await client.request({ sessionId: 's1', message: { kind: 'user-message', text: 'go' } })
  assert.equal(accepted.code, 'accepted')
  const seen = []
  accepted.operation.observe((snapshot) => seen.push(snapshot))
  await flush()
  await flush()
  // No status answer means "not observed": pending with a null terminal, never
  // a fabricated success/error outcome.
  const status = accepted.operation.status()
  assert.equal(status.terminal, null)
  assert.equal(status.phase, 'pending')
  assert.deepEqual(seen, [])
  route.dispose()
})

test('a disposed route answers typed unavailable without queueing or forging', async () => {
  const wire = makeWire()
  const first = await wire.client.request({ sessionId: 's1', message: { kind: 'user-message', text: 'go' } })
  assert.equal(first.code, 'accepted')
  wire.route.dispose()
  const after = await wire.client.request({ sessionId: 's1', message: { kind: 'user-message', text: 'again' } })
  assert.equal(after.ok, false)
  assert.equal(after.code, 'unavailable')
  assert.equal(wire.host.owner.operationStatus(first.operation.id).phase, 'accepted', 'nothing was queued or committed')
})

test('one terminal stays terminal: repeated status reads never rewrite the outcome', async () => {
  const wire = makeWire()
  const accepted = await wire.client.request({ sessionId: 's1', message: { kind: 'user-message', text: 'go' } })
  wire.host.owner.ingestAttemptFact({ name: 'agent/attempt/start', operationId: accepted.operation.id, attemptId: 'at1', observedAt: 't1' })
  wire.host.owner.ingestAttemptFact({ name: 'agent/attempt/end', operationId: accepted.operation.id, outcome: 'success', classification: 'completed', observedAt: 't2' })
  await flush()
  const first = wire.host.owner.operationStatus(accepted.operation.id)
  assert.equal(first.phase, 'terminal')
  assert.equal(first.terminal.outcome, 'success')
  wire.host.owner.ingestAttemptFact({ name: 'agent/attempt/end', operationId: accepted.operation.id, outcome: 'error', classification: 'failed', observedAt: 't3' })
  await flush()
  const second = wire.host.owner.operationStatus(accepted.operation.id)
  assert.deepEqual(second.terminal, first.terminal, 'late signals never rewrite a committed terminal')
})

test('owner attribution follows the caller fiber, never a caller-reported string', async () => {
  const { host } = makeWire()
  const callerA = { fiber: { name: 'plugin-a' } }
  const callerB = { fiber: { name: 'plugin-b' } }
  const a = await host.owner.request({ sessionId: 's1', message: { kind: 'user-message', text: 'a' } }, callerA)
  const b = await host.owner.request({ sessionId: 's2', message: { kind: 'user-message', text: 'b' } }, callerB)
  assert.equal(a.operation.ownerId, 'plugin-a')
  assert.equal(b.operation.ownerId, 'plugin-b')
  // Over the wire the owner comes from the serving context, not the payload.
  const handler = createSessionInteractionRouteHandler({ owner: host.owner, ctx: host.ctx })
  const viaWire = await handler({ method: 'sessions.request', payload: { sessionId: 's3' } })
  assert.equal(viaWire.operation.ownerId, 'client-route')
  assert.equal(viaWire.operation.ownerId, host.ctx.fiber.name)
})

test('the evidenced activity correlation rides the carrier as a value and reaches the client handle', async () => {
  const records = []
  const activity = {
    availability: () => ({ status: 'active' }),
    current: () => ({ snapshot: records[records.length - 1] }),
    get: (activityId) => ({ snapshot: records.find((record) => record.activityId === activityId) }),
    history: () => ({ items: records }),
  }
  const wire = makeWire({ activity })
  const accepted = await wire.client.request({ sessionId: 's1', message: { kind: 'user-message', text: 'hello' } })
  assert.equal(accepted.code, 'accepted')
  assert.equal(accepted.activity.confidence, 'unknown', 'a healthy projection without evidence stays unknown across the carrier')
  assert.equal(accepted.activity.activityId, null)

  // The projection evidences the execution identity the host handed out.
  records.push({
    activityId: 'act_wire',
    execution: { executionId: accepted.activity.executionId, correlationConfidence: 'observed' },
  })
  const handler = createSessionInteractionRouteHandler({ owner: wire.host.owner, ctx: wire.host.ctx })
  const status = await handler({ method: 'sessions.operation.status', payload: { operationId: accepted.operation.id } })
  assert.equal(status.ok, true)
  assert.deepEqual(status.status.activity, {
    activityId: 'act_wire',
    executionId: accepted.activity.executionId,
    confidence: 'observed',
  })
  assert.equal(typeof status.status.activity.status, 'undefined', 'the wire carries values only, never facade methods')

  // The client handle reads the same correlation back through the carrier.
  accepted.operation.status() // first read kicks the on-demand refresh
  await flush()
  const snapshot = accepted.operation.status()
  assert.equal(snapshot.activity.activityId, 'act_wire')
  assert.equal(snapshot.activity.confidence, 'observed')

  // Waiting evidence reaches the client handle as the waiting phase through
  // the same carrier, and clears the same way.
  records[0].status = { phase: 'waiting', waiting: { kind: 'approval', confidence: 'observed' } }
  const waited = await handler({ method: 'sessions.operation.status', payload: { operationId: accepted.operation.id } })
  assert.equal(waited.status.phase, 'waiting')
  const phases = []
  accepted.operation.observe((snapshot) => phases.push(snapshot.phase))
  await wire.timer.tick()
  assert.equal(phases.at(-1), 'waiting', 'the waiting phase is delivered to the client observer')
  records[0].status = null
  await wire.timer.tick()
  assert.equal(phases.at(-1), 'accepted', 'the wait ends with the evidence (no attempt had started here)')
})
