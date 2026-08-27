import test from 'node:test'
import assert from 'node:assert/strict'
import { createAuthRegistry } from '../lib/session-channel-auth.js'

test('auth: no verifier → open fails closed (unavailable)', () => {
  const auth = createAuthRegistry()
  assert.equal(auth.hasVerifier(), false)
})

test('auth: verifier passes → verifyDevice returns device identity', () => {
  const auth = createAuthRegistry()
  auth.registerVerifier({ id: 'v1', verify: (credential) => ({ deviceId: 'dev1', scope: ['session:read'] }) })
  assert.ok(auth.hasVerifier())
  const result = auth.verifyDevice('cred', {})
  assert.equal(result.deviceId, 'dev1')
  assert.equal(result.scope[0], 'session:read')
})

test('auth: verifier denies → verifyDevice returns denied', () => {
  const auth = createAuthRegistry()
  auth.registerVerifier({ id: 'v1', verify: () => ({ denied: true, reason: 'bad credential' }) })
  const result = auth.verifyDevice('cred', {})
  assert.equal(result.denied, true)
  assert.equal(result.reason, 'bad credential')
})

test('auth: multiple verifiers compose fail-closed AND', () => {
  const auth = createAuthRegistry()
  auth.registerVerifier({ id: 'v1', verify: () => ({ deviceId: 'dev1', scope: [] }) })
  auth.registerVerifier({ id: 'v2', verify: () => ({ denied: true, reason: 'v2 rejects' }) })
  const result = auth.verifyDevice('cred', {})
  assert.equal(result.denied, true)
  assert.equal(result.reason, 'v2 rejects')
})

test('auth: all verifiers pass → device verified', () => {
  const auth = createAuthRegistry()
  auth.registerVerifier({ id: 'v1', verify: () => ({ deviceId: 'dev1', scope: [] }) })
  auth.registerVerifier({ id: 'v2', verify: () => ({ deviceId: 'dev1', scope: [] }) })
  const result = auth.verifyDevice('cred', {})
  assert.equal(result.deviceId, 'dev1')
})

test('auth: duplicate id replaces prior registration', () => {
  const auth = createAuthRegistry()
  auth.registerVerifier({ id: 'v1', verify: () => ({ deviceId: 'old' }) })
  auth.registerVerifier({ id: 'v1', verify: () => ({ deviceId: 'new' }) })
  const result = auth.verifyDevice('cred', {})
  assert.equal(result.deviceId, 'new')
})

test('auth: registration order is preserved', () => {
  const order = []
  const auth = createAuthRegistry()
  auth.registerVerifier({ id: 'v1', verify: () => { order.push('v1'); return { deviceId: 'dev1' } } })
  auth.registerVerifier({ id: 'v2', verify: () => { order.push('v2'); return { deviceId: 'dev1' } } })
  auth.verifyDevice('cred', {})
  assert.deepEqual(order, ['v1', 'v2'])
})

test('auth: verifier throw → contained denied, no throw-through', () => {
  const auth = createAuthRegistry()
  auth.registerVerifier({ id: 'v1', verify: () => { throw new Error('boom') } })
  const result = auth.verifyDevice('cred', {})
  assert.equal(result.denied, true)
})

test('auth: authorizer deny → authorize returns deny', () => {
  const auth = createAuthRegistry()
  auth.registerAuthorizer({ id: 'a1', authorize: () => ({ deny: true, reason: 'method not allowed' }) })
  const result = auth.authorize({ method: 'open', deviceId: 'dev1' })
  assert.equal(result.deny, true)
})

test('auth: all authorizers allow → allow', () => {
  const auth = createAuthRegistry()
  auth.registerAuthorizer({ id: 'a1', authorize: () => ({ allow: true }) })
  auth.registerAuthorizer({ id: 'a2', authorize: () => ({ allow: true }) })
  const result = auth.authorize({ method: 'open', deviceId: 'dev1' })
  assert.equal(result.allow, true)
})

test('auth: pairing initiate/approve/reject flow', () => {
  const auth = createAuthRegistry()
  auth.registerPairingProvider({
    id: 'p1',
    initiate: (device) => ({ pendingToken: 'tok-1' }),
    approve: (token) => token === 'tok-1' ? { deviceCredential: 'cred-1' } : undefined,
    reject: (token) => undefined,
  })
  const initiated = auth.initiatePairing('dev1', {})
  assert.equal(initiated.pendingToken, 'tok-1')
  const approved = auth.approvePairing('tok-1')
  assert.equal(approved.deviceCredential, 'cred-1')
  assert.doesNotThrow(() => auth.rejectPairing('tok-1'))
})

test('auth: disposers remove registrations', () => {
  const auth = createAuthRegistry()
  const disposer = auth.registerVerifier({ id: 'v1', verify: () => ({ deviceId: 'dev1' }) })
  assert.ok(auth.hasVerifier())
  assert.ok(disposer())
  assert.ok(!auth.hasVerifier())
})