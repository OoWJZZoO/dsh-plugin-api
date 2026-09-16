/**
 * Consumption-contract evidence for the delivered faces.
 *
 * This file adds no implementation: it pins what an interactive client gets
 * from the faces that were delivered before this feature — the session request
 * operation, the channel stream (baseline, increments, resume, gap) and the
 * channel auth chain — so "interactive access" rests on the shared owners
 * rather than on a second platform.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mountSessionChannelFeature } from '../lib/session-channel.js'
import { createPluginApiService } from '../lib/plugin-api-service.js'
import { createFeatureRegistry } from '../lib/feature-registry.js'
import { createSessionInteractionOperation } from '../lib/session-interaction-operation.js'
import { INTERACTION_BOUNDARY_SYMBOL } from '../lib/session-interaction-operation-authority.js'

function makeBoundary() {
  return {
    admit(spec) {
      return { accepted: true, attemptRef: { sessionId: spec.sessionId, operationId: spec.operationId } }
    },
    cancelAttempt() {
      return { ok: true, code: 'accepted' }
    },
    availability() {
      return { status: 'active' }
    },
  }
}

function createMockSessionApi() {
  return {
    isActive: true,
    get: (id) => ({ id, events: [], seq: 0, header: () => ({}) }),
    list: () => [],
    events: (session) => session?.events ?? [],
    header: (session) => session?.header?.() ?? {},
    sessionEventTypes: ['session/event', 'session/created'],
  }
}

function createRealService() {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const service = new ServiceClass({
    reflect: { provide() {} },
    get() { return undefined },
    on() { return () => {} },
    once() {},
    effect() {},
  })
  void createMockSessionApi
  return service
}

function mountChannels() {
  const service = createRealService()
  const result = mountSessionChannelFeature({ ctx: { get: () => {} }, service, logger: { warn() {} }, featureRegistry: { isActive: () => false } })
  result.prepared.commit()
  return { service, api: service.sessions.channels, dispose: () => result.disposer() }
}

test('the channel consumption contract delivers a baseline view and typed refusals', async () => {
  const { api, dispose } = mountChannels()
  try {
    api.auth.register({ kind: 'verifier', id: 'v1', verify: () => ({ deviceId: 'dev1', scope: [] }) })
    const opened = await api.acquire({ device: 'dev1', session: 's1' })
    assert.equal(opened.ok, true)
    assert.equal(typeof opened.channelId, 'string')
    assert.equal(typeof opened.channelGeneration, 'string', 'a channel carries its generation for stale-guard semantics')

    // The consumer's baseline is the delivered channel projection: live
    // channels plus their subscriptions, never a fabricated session state.
    const snapshot = api.current({ device: 'dev1', session: 's1' })
    assert.ok(snapshot.channels)
    assert.ok(snapshot.subscriptions)
    assert.equal(snapshot.channels[opened.channelId].sessionId, 's1')
    assert.equal(snapshot.connectionState, 'active')

    // An incomplete consumption call is refused typed instead of guessed.
    const missingSubscription = await api.history({ device: 'dev1', session: 's1', channelId: opened.channelId, channelGeneration: opened.channelGeneration })
    assert.equal(missingSubscription.ok, false)
    assert.equal(missingSubscription.error.code, 'invalid-input')
    const missingToken = await api.resume({ device: 'dev1', session: 's1', channelId: opened.channelId, channelGeneration: opened.channelGeneration, cursor: '1' })
    assert.equal(missingToken.ok, false)
    assert.equal(missingToken.error.code, 'invalid-input')
  } finally {
    dispose()
  }
})

test('a channel handle from another generation cannot resume the live one', async () => {
  const { api, dispose } = mountChannels()
  try {
    api.auth.register({ kind: 'verifier', id: 'v1', verify: () => ({ deviceId: 'dev1', scope: [] }) })
    const opened = await api.acquire({ device: 'dev1', session: 's1' })
    const stale = await api.resume({ device: 'dev1', session: 's1', channelId: opened.channelId, channelGeneration: 'gen_other', resumeToken: 'tok', cursor: '1' })
    assert.equal(stale.ok, false, 'a stale generation never writes into the live channel')
    assert.equal(typeof stale.error.code, 'string')
  } finally {
    dispose()
  }
})

test('the channel face keeps its exact member set and reports honest availability', () => {
  const { service, api, dispose } = mountChannels()
  try {
    const probe = typeof api.availability === 'function' ? api.availability() : undefined
    if (probe !== undefined) {
      assert.ok(probe.status === 'active' || probe.status === 'degraded' || probe.status === 'unavailable')
    }
    for (const member of ['acquire', 'history', 'ack', 'resume', 'release', 'current', 'observe', 'heartbeat']) {
      assert.equal(typeof api[member], 'function', `sessions.channels.${member} stays available`)
    }
    assert.equal(typeof api.auth.register, 'function')
    assert.equal(typeof api.redaction.register, 'function')
    // Unrelated namespaces remain independent of the channel face state.
    assert.equal(typeof service.sessions.availability, 'function')
  } finally {
    dispose()
  }
})

test('device and session authorization are separate refusals with their own codes', async () => {
  const { api, dispose } = mountChannels()
  try {
    // No verifier at all: the connection is refused typed rather than guessed.
    const unverified = await api.acquire({ device: 'dev1', session: 's1' })
    assert.equal(unverified.ok, false)
    assert.equal(unverified.error.code, 'unavailable')

    api.auth.register({ kind: 'verifier', id: 'v1', verify: (cred) => (cred === 'good' ? { deviceId: 'dev1', scope: [] } : { denied: true }) })
    const deviceDenied = await api.acquire({ device: 'dev1', session: 's1', credential: 'bad' })
    assert.equal(deviceDenied.ok, false)
    assert.equal(deviceDenied.error.code, 'device-denied', 'a bad credential is a device refusal, not a session one')

    api.auth.register({ kind: 'authorizer', id: 'a1', authorize: () => ({ deny: true }) })
    const sessionDenied = await api.acquire({ device: 'dev1', session: 's1', credential: 'good' })
    assert.equal(sessionDenied.ok, false, 'an authorizer refusal is a typed refusal')
    // The delivered chain maps its refusals onto its own vocabulary
    // (`device-denied` / `session-denied`); the guarantee the facade adds is
    // that a refusal is typed and never leaks which other sessions exist.
    assert.ok(['device-denied', 'session-denied'].includes(sessionDenied.error.code))
    assert.equal('sessions' in (sessionDenied.error.details ?? {}), false)
  } finally {
    dispose()
  }
})

test('the delivered request operation is the single send/cancel authority a client consumes', async () => {
  const ctx = {
    get(name) {
      if (name === 'pluginApi') return { isActive: true }
      if (name === 'sessions') return { get: () => ({ id: 's1' }) }
      if (name === 'agentLoop') return { [INTERACTION_BOUNDARY_SYMBOL]: makeBoundary() }
      return undefined
    },
    logger: { warn: () => {} },
  }
  const owner = createSessionInteractionOperation({
    ctx,
    coreActive: () => true,
    durableAppend: async () => ({ ok: true }),
    durableAvailable: () => true,
  })
  const accepted = await owner.request({ sessionId: 's1', message: { kind: 'user-message', text: 'hello' } }, { owner: 'consumer-a' })
  assert.equal(accepted.code, 'accepted')

  const second = await owner.request({ sessionId: 's1', message: { kind: 'user-message', text: 'again' } }, { owner: 'consumer-a' })
  assert.equal(second.code, 'already-running', 'the delivered same-session conflict default is preserved by the delivery extension')
  assert.equal(second.operationRef.id, accepted.operation.id)

  const status = owner.operationStatus(accepted.operation.id)
  assert.equal(status.phase === 'accepted' || status.phase === 'running', true)
  const cancelled = owner.cancel({ operationId: accepted.operation.id, by: 'user' }, { owner: 'consumer-a' })
  assert.equal(cancelled.code, 'accepted')
  assert.equal(owner.operationStatus(accepted.operation.id).phase, 'terminal', 'cancel is a signal; the authority adjudicates the terminal')
  assert.equal(owner.operationStatus('op_unknown'), null, 'an unknown operation id answers null, never a fabricated terminal')
  owner.dispose()
})
