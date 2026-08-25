import test from 'node:test'
import assert from 'node:assert/strict'
import { createSecurityAudit, normalizeAuditRecord, AUDIT_KINDS, AUDIT_CAPACITY } from '../lib/security-audit.js'

let clock = 100
const now = () => clock

function record(overrides = {}) {
  return {
    auditId: 'audit-1',
    kind: 'decision',
    at: now(),
    ownerIds: ['owner-a'],
    policyIds: ['policy-a'],
    summary: { point: 'approval-before', outcome: 'deny', reason: 'blocked' },
    outcome: 'deny',
    ...overrides,
  }
}

test('append stores bounded records keyed by auditId and query returns frozen read-only views', () => {
  const audit = createSecurityAudit({ now })
  const result = audit.append(record())
  assert.equal(result.ok, true)
  const view = audit.query({})
  assert.equal(view.records.length, 1)
  assert.equal(view.records[0].auditId, 'audit-1')
  assert.ok(Object.isFrozen(view.records))
  assert.ok(Object.isFrozen(view.records[0]))
  assert.ok(Object.isFrozen(view))
  assert.throws(() => { view.records[0].outcome = 'allow' }, TypeError, 'records are frozen')
})

test('the ledger is bounded: overflow drops the oldest record and sets truncated', () => {
  const audit = createSecurityAudit({ capacity: 2, now })
  audit.append(record({ auditId: 'a1', at: 1 }))
  audit.append(record({ auditId: 'a2', at: 2 }))
  const overflow = audit.append(record({ auditId: 'a3', at: 3 }))
  assert.equal(overflow.truncated, true)
  const view = audit.query({})
  assert.deepEqual(view.records.map((r) => r.auditId), ['a2', 'a3'])
  assert.equal(view.truncated, true)
})

test('query filters by kind, owner, policy, and limit from the newest end', () => {
  const audit = createSecurityAudit({ capacity: 20, now })
  for (let index = 1; index <= 5; index += 1) {
    audit.append(record({ auditId: `d${index}`, ownerIds: index % 2 === 0 ? ['even'] : ['odd'], kind: index === 5 ? 'redaction' : 'decision' }))
  }
  assert.equal(audit.query({ kind: 'redaction' }).records.length, 1)
  assert.equal(audit.query({ ownerId: 'even' }).records.length, 2)
  assert.equal(audit.query({ policyId: 'policy-a' }).records.length, 5)
  assert.deepEqual(audit.query({ kind: 'decision', limit: 2 }).records.map((r) => r.auditId), ['d3', 'd4'])
})

test('append failure marks gapSince and never fabricates the missing record', () => {
  const flaky = {
    append() { throw new Error('storage unavailable') },
  }
  const audit = createSecurityAudit({ now, storage: flaky })
  const result = audit.append(record())
  assert.equal(result.ok, false)
  assert.equal(typeof result.gapSince, 'number')
  const view = audit.query({})
  assert.equal(view.records.length, 0, 'no fabricated record')
  assert.equal(view.gapSince, result.gapSince, 'the gap is exposed on subsequent queries')
  assert.equal(audit.status().gapSince, result.gapSince)
})

test('recovery: a later successful append still exposes the historical gap', () => {
  let fail = true
  const audit = createSecurityAudit({
    now,
    storage: {
      append() { if (fail) throw new Error('down') },
    },
  })
  audit.append(record({ auditId: 'lost' }))
  fail = false
  audit.append(record({ auditId: 'kept' }))
  const view = audit.query({})
  assert.deepEqual(view.records.map((r) => r.auditId), ['kept'])
  assert.equal(typeof view.gapSince, 'number', 'gap history stays visible')
})

test('status truthfully reports the non-durable tier and live size', () => {
  const audit = createSecurityAudit({ capacity: 8, now })
  audit.append(record())
  const status = audit.status()
  assert.equal(status.durable, 'non-durable')
  assert.equal(status.capacity, 8)
  assert.equal(status.size, 1)
  assert.equal(status.truncated, false)
  assert.ok(Object.isFrozen(status))
})

test('query views redact secret-shaped summaries and secret-named fields', () => {
  const audit = createSecurityAudit({ now })
  audit.append(record({
    auditId: 's1',
    summary: {
      point: 'egress',
      destination: 'https://user:pass1234567890@host.example',
      authorization: 'Bearer abcdefghijklmnopqrstuvwxyz',
      applied: 'sk-abcdefghijklmnopqrstuv',
    },
  }))
  const view = audit.query({})
  const summary = view.records[0].summary
  assert.equal(summary.point, 'egress')
  assert.match(summary.destination, /user:pass/, 'destination string is kept when not secret-shaped')
  assert.equal(summary.authorization, '[redacted]', 'secret-named key is redacted')
  assert.equal(summary.applied, '[redacted]', 'secret-shaped value is redacted')
})

test('normalizeAuditRecord enforces the bounded record vocabulary', () => {
  assert.ok(AUDIT_KINDS.includes('decision'))
  assert.ok(AUDIT_KINDS.includes('redaction'))
  assert.ok(AUDIT_KINDS.includes('egress-grant'))
  assert.throws(() => normalizeAuditRecord({ auditId: 'x', kind: 'bogus', at: 1 }), TypeError)
  assert.throws(() => normalizeAuditRecord({ kind: 'decision', at: 1 }), TypeError)
  assert.throws(() => normalizeAuditRecord({ auditId: 'x', kind: 'decision', at: 'now' }), TypeError)
  const normalized = normalizeAuditRecord({
    auditId: 'x', kind: 'decision', at: 123, ownerIds: ['a', 'a', 'b'], policyIds: ['p1', 'p1'],
    summary: { applied: [{ ruleId: 'r1', count: 2 }] }, outcome: 'applied',
  })
  assert.deepEqual(normalized.ownerIds, ['a', 'b'], 'owner ids deduplicate')
  assert.deepEqual(normalized.policyIds, ['p1'], 'policy ids deduplicate')
})

test('dispose is idempotent and empties the ledger', () => {
  const audit = createSecurityAudit({ now })
  audit.append(record())
  assert.equal(audit.dispose(), true)
  assert.equal(audit.dispose(), false)
  assert.equal(audit.query({}).records.length, 0)
})

test('default capacity constant is defined and positive', () => {
  assert.equal(typeof AUDIT_CAPACITY, 'number')
  assert.ok(AUDIT_CAPACITY > 0)
})