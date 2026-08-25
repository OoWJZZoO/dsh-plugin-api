import test from 'node:test'
import assert from 'node:assert/strict'
import { createSecurityEgress } from '../lib/security-egress.js'
import { SecurityEgressDeniedError, SecurityEgressRegistrationError } from '../lib/security-errors.js'

let clock = 1000
const now = () => clock
const rng = () => `r${clock}`

function freshEgress({ autoAllow = false, at = 1000 } = {}) {
  clock = at
  const core = createSecurityEgress({ now, rng })
  if (autoAllow) {
    core.registry.register('owner', {
      match: () => true,
      decide: () => ({ outcome: 'allow' }),
    })
  }
  return core
}

const target = { kind: 'subprocess', destination: 'example.org' }

test('check returns a converged decision and defaults to deny (fail-closed)', () => {
  const core = freshEgress()
  const decision = core.check(target)
  assert.equal(decision.outcome, 'deny')
  assert.equal(decision.point, 'egress')
  assert.match(decision.reason, /no egress policy allows/)
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

test('a matching allow policy flips the default', () => {
  const core = freshEgress()
  core.registry.register('a', {
    match: (ctx) => ctx.target.destination === 'allowed.example',
    decide: () => ({ outcome: 'allow' }),
  })
  assert.equal(core.check({ kind: 'http', destination: 'allowed.example' }).outcome, 'allow')
  assert.equal(core.check({ kind: 'http', destination: 'denied.example' }).outcome, 'deny')
})

test('lease acquire requires an allowed check and fails closed on denial', () => {
  const core = freshEgress()
  assert.throws(
    () => core.acquire(target, 60000),
    (error) => error instanceof SecurityEgressDeniedError && error.code === 'SECURITY_EGRESS_DENIED',
  )
})

test('invalid ttl and malformed targets reject with typed errors', () => {
  const core = freshEgress({ autoAllow: true })
  assert.throws(() => core.acquire(target, 0), SecurityEgressDeniedError)
  assert.throws(() => core.acquire(target, -5), SecurityEgressDeniedError)
  assert.throws(() => core.acquire(target, '1s'), SecurityEgressDeniedError)
  assert.throws(() => core.check({ kind: 'carrier-pigeon', destination: 'x' }), SecurityEgressRegistrationError)
  assert.throws(() => core.check(null), SecurityEgressRegistrationError)
  assert.throws(() => core.registry.register('o', { match: () => true }), SecurityEgressRegistrationError)
})

test('lease authorizes its exact target only, until expiry', () => {
  const core = freshEgress()
  // one narrow policy: only the granted http destination is allowed by rule
  core.registry.register('owner', {
    id: 'allow-http',
    match: (ctx) => ctx.target.kind === 'http' && ctx.target.destination === 'granted.example',
    decide: () => ({ outcome: 'allow' }),
  })
  const { lease, revoke } = core.acquire({ kind: 'http', destination: 'granted.example' }, 5000)
  assert.equal(lease.expiresAt, 6000, 'expiresAt = acquire time + ttl')
  assert.equal(typeof lease.generation, 'string')
  assert.ok(lease.generation.startsWith('lease:'))

  assert.equal(core.check({ kind: 'http', destination: 'granted.example' }).outcome, 'allow', 'within grant')
  assert.equal(core.check({ kind: 'http', destination: 'granted.example' }).reason, 'active-lease')
  const outside = core.check({ kind: 'http', destination: 'other.example' })
  assert.equal(outside.outcome, 'deny', 'outside the grant fails closed')
  assert.equal(outside.reason, 'no egress policy allows this target')
  const kindMismatch = core.check({ kind: 'subprocess', destination: 'granted.example' })
  assert.equal(kindMismatch.outcome, 'deny', 'kind mismatch is outside the grant')

  clock = 6001
  assert.equal(core.check({ kind: 'http', destination: 'granted.example' }).outcome, 'deny', 'expired lease fails closed')
  assert.equal(revoke(), true, 'an unrevoked lease still revokes once')
  assert.equal(revoke(), false, 'revocation stays idempotent')
})

test('revocation makes subsequent checks fail closed and is idempotent', () => {
  const core = freshEgress({ autoAllow: true })
  const { revoke } = core.acquire(target, 60000)
  assert.equal(revoke(), true)
  assert.equal(revoke(), false, 'revocation is idempotent')
  assert.equal(core.check(target).outcome, 'deny', 'revoked lease never authorizes again')
})

test('leases never extend retroactively after expiry', () => {
  const core = freshEgress({ autoAllow: true, at: 1000 })
  core.acquire(target, 100)
  clock = 1200 // lease expired at 1100
  const decision = core.check(target)
  assert.equal(decision.outcome, 'deny', 'expired lease is not revived by the pending operation')
})

test('proxy environment detection never becomes an egress allowance', () => {
  const core = freshEgress() // no allow policy
  process.env.HTTP_PROXY = 'http://proxy:8080'
  process.env.NO_PROXY = 'example.org'
  try {
    const decision = core.check({ kind: 'http', destination: 'example.org' })
    assert.equal(decision.outcome, 'deny', 'proxy vars are never an allowance')
    assert.equal(decision.reason, 'no egress policy allows this target')
  } finally {
    delete process.env.HTTP_PROXY
    delete process.env.NO_PROXY
  }
})

test('dispose retracts every lease and clears the registry', () => {
  const core = freshEgress({ autoAllow: true })
  core.acquire(target, 60000)
  assert.equal(core.dispose(), 1)
  assert.equal(core.check(target).outcome, 'deny')
  assert.deepEqual(core.registry.snapshot(), [])
})

test('a throwing egress policy degrades to the point default (deny) and reports owner attribution', () => {
  let reported = null
  const core = createSecurityEgress({
    now,
    rng,
    onPolicyError: (owner, id, error) => { reported = { owner, id, error } },
  })
  core.registry.register('broken', { match: () => true, decide: () => { throw new Error('outbound gate broken') } })
  const decision = core.check(target)
  assert.equal(decision.outcome, 'deny', 'degraded policy falls to the fail-closed default')
  assert.match(decision.reason, /^degraded:/)
  assert.equal(reported.owner, 'broken')
  assert.match(reported.error.message, /outbound gate broken/)
})