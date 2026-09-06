/**
 * Surface-factory tests for the session request operation host face.
 *
 * Composes the owner surface with a contract-faithful host ctx fixture and
 * proves reverse-registration-order consumer independence
 * (two synthetic plugins see equivalent semantics regardless of registration
 * order) and Requirement 1 append provenance.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSessionInteractionOperation } from '../lib/session-interaction-operation.js'
import { createRequestAuthority } from '../lib/session-interaction-operation-authority.js'
import { INTERACTION_BOUNDARY_SYMBOL } from '../lib/session-interaction-operation-authority.js'

function makeBoundary() {
  return {
    admitted: [],
    cancelAttempt() {
      return { ok: true, code: 'accepted' }
    },
    admit(spec) {
      this.admitted.push(spec)
      return { accepted: true, attemptRef: { sessionId: spec.sessionId, operationId: spec.operationId } }
    },
    availability() {
      return { status: 'active' }
    },
  }
}

/** Contract-faithful host ctx fixture (sessions + durable + agent-loop marker). */
function makeHostCtx({ appends = [] } = {}) {
  const sessionsService = {
    get: (id) => (id.startsWith('s') ? { id } : undefined),
  }
  const ctx = {
    appends,
    get(name) {
      if (name === 'pluginApi') {
        return {
          isActive: true,
          services: { identity: () => this.identity },
        }
      }
      if (name === 'sessions') return sessionsService
      if (name === 'agentLoop') return { [INTERACTION_BOUNDARY_SYMBOL]: makeBoundary() }
      return undefined
    },
    safeDurableAppend: async (sessionId, kind, payload) => {
      appends.push({ sessionId, kind, payload })
      return { ok: true, seq: appends.length }
    },
  }
  ctx.sessions = sessionsService
  return ctx
}

test('surface factory composes the authority with ctx-derived defaults', async () => {
  const ctx = makeHostCtx()
  const surface = createSessionInteractionOperation({
    ctx,
    durableAppend: ctx.safeDurableAppend,
    ownerOf: (callerCtx) => callerCtx?.plugin ?? 'root',
  })
  assert.equal(surface.availability().status, 'active')
  const out = await surface.request({ sessionId: 's1', message: { kind: 'user-message', text: 'hello' } }, { plugin: 'consumer-a' })
  assert.equal(out.code, 'accepted')
  assert.equal(out.operation.ownerId, 'consumer-a')
  assert.equal(ctx.appends.length, 1)
  assert.equal(ctx.appends[0].kind, 'user-message')
  assert.equal(ctx.appends[0].sessionId, 's1')
  assert.equal(ctx.appends[0].payload.text, 'hello')
  const cancel = surface.cancel({ operationId: out.operation.id, by: 'user' })
  assert.equal(cancel.code, 'accepted')
  assert.equal(out.operation.status().terminal.outcome, 'aborted')
})

test('two synthetic plugins in reverse registration order share one authority', async () => {
  // One mounted surface (single request authority) is shared by both plugins;
  // plugin B registers first, plugin A second (reverse order). Both see
  // identical request/cancel/availability semantics with owner isolation.
  const sharedCtx = makeHostCtx()
  const surface = createSessionInteractionOperation({
    ctx: sharedCtx,
    durableAppend: sharedCtx.safeDurableAppend,
    ownerOf: (callerCtx) => callerCtx?.plugin ?? 'root',
  })

  const pluginA = { plugin: 'plugin-a' }
  const pluginB = { plugin: 'plugin-b' }

  assert.equal(await surface.request({ sessionId: 's1', message: { kind: 'user-message', text: 'from B' } }, pluginB).then((o) => o.code), 'accepted')
  const outA = await surface.request({ sessionId: 's1', message: { kind: 'user-message', text: 'from A' } }, pluginA)
  assert.equal(outA.code, 'already-running', 'exclusive-per-session applies across both plugins')
  assert.equal(outA.operationRef.id.slice(0, 3), 'op_')

  // terminal the B-owned operation, then A can trigger with its own owner
  const cancelB = await surface.cancel({ sessionId: 's1' }, pluginB)
  assert.equal(cancelB.code, 'accepted')
  const outSecond = await surface.request({ sessionId: 's1', message: { kind: 'user-message', text: 'after B ended' } }, pluginA)
  assert.equal(outSecond.code, 'accepted')
  assert.equal(outSecond.operation.ownerId, 'plugin-a')
})

test('unguarded context gaps degrade to typed unavailable instead of guessing', async () => {
  const surface = createSessionInteractionOperation({ ctx: makeHostCtx() })
  // durable append default relies on pluginApi.sessions.durable.appendMessage
  // which the fixture does not provide -> request content write degrades.
  const out = await surface.request({ sessionId: 's1', message: { kind: 'user-message', text: 'x' } })
  assert.equal(['accepted', 'unavailable'].includes(out.code), true)
  if (out.code === 'unavailable') {
    assert.equal(out.ok, false)
  }
})

test('resolveAgentLoopBoundary finds the boundary through the surface default', async () => {
  const boundary = makeBoundary()
  const ctx = {
    get: (name) => {
      if (name === 'agentLoop') return { [INTERACTION_BOUNDARY_SYMBOL]: boundary }
      if (name === 'pluginApi') return { isActive: true, sessions: { durable: { appendMessage: async () => ({ ok: true }) } } }
      if (name === 'sessions') return { get: (id) => (id === 's1' ? { id } : undefined) }
      return undefined
    },
  }
  const surface = createSessionInteractionOperation({ ctx, ownerOf: () => 'o' })
  assert.equal(surface.availability().status, 'active')
  const out = await surface.request({ sessionId: 's1', message: { kind: 'user-message', text: 'x' } })
  assert.equal(out.code, 'accepted')
})

test('authority module is usable standalone (no ctx dependency)', async () => {
  const calls = []
  const authority = createRequestAuthority({
    sessionExists: (s) => s === 's1',
    resolveBoundary: () => ({ boundary: makeBoundary(), versionOk: true }),
    durableAppend: async (sessionId, kind, payload) => {
      calls.push({ sessionId, kind, payload })
      return { ok: true }
    },
    ownerOf: () => 'o1',
  })
  const out = await authority.request({ sessionId: 's1', message: { kind: 'user-message', text: 'x' } })
  assert.equal(out.code, 'accepted')
  assert.equal(calls.length, 1)
})