import test from 'node:test'
import assert from 'node:assert/strict'
import { createSecurityEgress } from '../lib/security-egress.js'
import { SecurityEgressRegistrationError } from '../lib/security-errors.js'

let clock = 1000
const now = () => clock
const rng = () => `r${clock}`

function freshEgress({ denyAll = false, at = 1000 } = {}) {
  clock = at
  const core = createSecurityEgress({ now, rng })
  if (denyAll) {
    core.registry.register('owner', {
      id: 'deny-all',
      match: () => true,
      decide: () => ({ outcome: 'deny', reason: 'blocklisted' }),
    })
  }
  return core
}

const target = { kind: 'subprocess', destination: 'example.org' }

test('check returns a converged decision and defaults to allow (denylist baseline)', () => {
  const core = freshEgress()
  const decision = core.check(target)
  assert.equal(decision.outcome, 'allow', 'an empty registry keeps the official outbound behavior')
  assert.equal(decision.point, 'egress')
  assert.match(decision.reason, /no egress policy denies/)
  assert.equal(typeof decision.auditId, 'string')
  assert.ok(Object.isFrozen(decision))
})

test('check converges multiple egress policies (deny still wins)', () => {
  const core = freshEgress()
  core.registry.register('owner', { id: 'allow-a', match: () => true, decide: () => ({ outcome: 'allow' }) })
  core.registry.register('owner', { id: 'deny-b', match: () => true, decide: () => ({ outcome: 'deny', reason: 'blocklisted' }) })
  const decision = core.check(target)
  assert.equal(decision.outcome, 'deny')
  assert.equal(decision.winner, 'deny-b')
  assert.deepEqual(decision.consulted, ['allow-a', 'deny-b'])
})

test('a matching deny policy blocks only the target it matches', () => {
  const core = freshEgress()
  core.registry.register('a', {
    match: (ctx) => ctx.target.destination === 'blocked.example',
    decide: () => ({ outcome: 'deny', reason: 'blocklisted' }),
  })
  const blocked = core.check({ kind: 'http', destination: 'blocked.example' })
  assert.equal(blocked.outcome, 'deny')
  assert.equal(blocked.reason, 'blocklisted')
  const rest = core.check({ kind: 'http', destination: 'allowed.example' })
  assert.equal(rest.outcome, 'allow', 'an unmatched target is not collateral of a deny elsewhere')
})

test('lease acquire is granted by default and denied with a typed outcome when a policy denies', async () => {
  const core = freshEgress()
  const granted = await core.acquire({ target, ttlMs: 60000 })
  assert.equal(granted.ok, true, 'no deny policy means the official outbound behavior is kept')
  assert.equal(granted.code, 'acquired')
  assert.equal(granted.resource, 'egress:subprocess:example.org')
  assert.equal(typeof granted.observedAt, 'string')
  assert.ok(Object.isFrozen(granted))

  const denied = freshEgress({ denyAll: true })
  const outcome = await denied.acquire({ target, ttlMs: 60000 })
  assert.equal(outcome.ok, false)
  assert.equal(outcome.code, 'denied')
  assert.equal(outcome.operation, 'acquire')
  assert.equal(outcome.resource, 'egress:subprocess:example.org')
  assert.match(outcome.reason, /blocklisted/)
  assert.equal(typeof outcome.observedAt, 'string')
  assert.ok(Object.isFrozen(outcome))
})

test('invalid ttl and malformed targets reject with typed invalid-input outcomes', async () => {
  const core = freshEgress()
  for (const ttl of [0, -5, '1s', NaN]) {
    const outcome = await core.acquire({ target, ttlMs: ttl })
    assert.equal(outcome.ok, false, `ttl ${ttl} is rejected`)
    assert.equal(outcome.code, 'invalid-input')
    assert.equal(outcome.operation, 'acquire')
  }
  const malformed = await core.acquire({ target: { kind: 'carrier-pigeon', destination: 'x' }, ttlMs: 60000 })
  assert.equal(malformed.ok, false)
  assert.equal(malformed.code, 'invalid-input')
  assert.throws(() => core.check({ kind: 'carrier-pigeon', destination: 'x' }), SecurityEgressRegistrationError)
  assert.throws(() => core.check(null), SecurityEgressRegistrationError)
  assert.throws(() => core.registry.register('o', { match: () => true }), SecurityEgressRegistrationError)
})

test('acquire returns a frozen coordination lease bound to the exact target', async () => {
  const core = freshEgress()
  const outcome = await core.acquire({ target: { kind: 'http', destination: 'granted.example' }, ttlMs: 5000 })
  assert.equal(outcome.ok, true)
  assert.equal(outcome.code, 'acquired')
  assert.equal(outcome.resource, 'egress:http:granted.example')
  const handle = outcome.handle
  assert.equal(handle.resource, 'egress:http:granted.example')
  assert.equal(handle.expiresAt, '1970-01-01T00:00:06.000Z', 'expiresAt = acquire time + ttl (ISO)')
  assert.equal(typeof handle.id, 'string')
  assert.ok(handle.id.startsWith('lease:'))
  assert.equal(typeof handle.generation, 'string')
  assert.ok(handle.generation.startsWith('lease:'))
  assert.equal(typeof handle.fencingToken, 'string')
  assert.ok(Object.isFrozen(handle), 'the lease credential is frozen')
  assert.equal(handle.dispose, undefined, 'no dispose() on a lease credential')
  assert.equal(handle.revoke, undefined, 'no legacy revoke() on a lease credential')

  assert.equal(core.check({ kind: 'http', destination: 'granted.example' }).outcome, 'allow', 'within grant')
  assert.equal(core.check({ kind: 'http', destination: 'granted.example' }).reason, 'active-lease')
  const outside = core.check({ kind: 'http', destination: 'other.example' })
  assert.equal(outside.outcome, 'allow', 'outside the grant falls back to the denylist baseline')
  assert.equal(outside.reason, 'no egress policy denies this target')
  const kindMismatch = core.check({ kind: 'subprocess', destination: 'granted.example' })
  assert.equal(kindMismatch.outcome, 'allow', 'a kind mismatch is outside the grant')

  clock = 6001
  assert.equal(
    core.check({ kind: 'http', destination: 'granted.example' }).outcome,
    'allow',
    'an expired lease falls back to the denylist baseline, not to a stale grant',
  )
})

test('release is the idempotent give-back verb; stale handles are typed conflicts', async () => {
  const core = freshEgress()
  const outcome = await core.acquire({ target, ttlMs: 60000 })
  assert.equal(outcome.ok, true)
  const released = await core.release(outcome.handle)
  assert.equal(released.ok, true)
  assert.equal(released.code, 'released')
  assert.equal(released.resource, outcome.resource)
  assert.equal(
    core.check(target).reason,
    'no egress policy denies this target',
    'a released lease never authorizes again',
  )
  const again = await core.release(outcome.handle)
  assert.equal(again.ok, false)
  assert.equal(again.code, 'conflict', 'a repeated release is a stale conflict with the condition in reason')
  assert.match(again.reason, /already released/)
  const unknown = await core.release({ id: 'lease:nonexistent' })
  assert.equal(unknown.ok, false)
  assert.equal(unknown.code, 'conflict')
})

test('leases never extend retroactively after expiry', async () => {
  const core = freshEgress({ at: 1000 })
  await core.acquire({ target, ttlMs: 100 })
  clock = 1200 // lease expired at 1100
  const decision = core.check(target)
  assert.equal(decision.reason, 'no egress policy denies this target', 'an expired lease is not revived by the pending operation')
})

test('proxy environment detection never becomes an egress decision', () => {
  const core = freshEgress() // no policy at all
  process.env.HTTP_PROXY = 'http://proxy:8080'
  process.env.NO_PROXY = 'example.org'
  try {
    const decision = core.check({ kind: 'http', destination: 'example.org' })
    assert.equal(decision.outcome, 'allow', 'proxy vars neither allow nor deny')
    assert.equal(decision.reason, 'no egress policy denies this target')
  } finally {
    delete process.env.HTTP_PROXY
    delete process.env.NO_PROXY
  }
})

test('dispose retracts every lease and clears the registry', async () => {
  const core = freshEgress()
  await core.acquire({ target, ttlMs: 60000 })
  assert.equal(core.dispose(), 1)
  assert.equal(core.check(target).outcome, 'allow', 'dispose leaves the denylist baseline')
  assert.deepEqual(core.registry.snapshot(), [])
})

test('a throwing egress policy degrades to the point default (allow) and reports owner attribution', () => {
  let reported = null
  const core = createSecurityEgress({
    now,
    rng,
    onPolicyError: (owner, id, error) => { reported = { owner, id, error } },
  })
  core.registry.register('broken', { match: () => true, decide: () => { throw new Error('outbound gate broken') } })
  const decision = core.check(target)
  assert.equal(decision.outcome, 'allow', 'a degraded policy falls back to the denylist baseline')
  assert.match(decision.reason, /^degraded:/)
  assert.equal(reported.owner, 'broken')
  assert.match(reported.error.message, /outbound gate broken/)
})

test('a throwing policy never masks a deny from another policy', () => {
  const core = freshEgress()
  core.registry.register('broken', { match: () => true, decide: () => { throw new Error('outbound gate broken') } })
  core.registry.register('blocker', { id: 'deny-bad', match: () => true, decide: () => ({ outcome: 'deny', reason: 'blocklisted' }) })
  const decision = core.check(target)
  assert.equal(decision.outcome, 'deny', 'deny still wins over a degraded policy')
  assert.equal(decision.winner, 'deny-bad')
})
