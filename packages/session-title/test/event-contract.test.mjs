import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SESSION_TITLE_CANDIDATE,
  DECISION,
  decideSessionTitleCandidate,
  convergeThenable,
  isThenable,
  buildSessionTitleCandidatePayload,
  extractTitleText,
  isNonEmptyTitleText,
  resolveReplacement,
  redactedDecisionMessage,
} from '../lib/event-contract.js'

test('SESSION_TITLE_CANDIDATE is the canonical event name', () => {
  assert.equal(SESSION_TITLE_CANDIDATE, 'session-title/candidate')
})

test('undefined (no decision / called next()) is proceed', () => {
  assert.deepEqual(decideSessionTitleCandidate(undefined), { kind: DECISION.proceed })
})

test('{ kind: exclude } is an exclude decision with optional string reason', () => {
  assert.deepEqual(decideSessionTitleCandidate({ kind: 'exclude' }), { kind: DECISION.exclude })
  assert.deepEqual(decideSessionTitleCandidate({ kind: 'exclude', reason: 'synthetic' }), {
    kind: DECISION.exclude,
    reason: 'synthetic',
  })
})

test('{ kind: replace, message: { seq } } is a replace decision', () => {
  assert.deepEqual(decideSessionTitleCandidate({ kind: 'replace', message: { seq: 2 } }), {
    kind: DECISION.replace,
    message: { seq: 2 },
  })
  assert.deepEqual(decideSessionTitleCandidate({ kind: 'replace', message: { seq: 2 }, reason: 'use real' }), {
    kind: DECISION.replace,
    message: { seq: 2 },
    reason: 'use real',
  })
})

test('a thenable return is malformed with a thenable flag', () => {
  const decision = decideSessionTitleCandidate(Promise.resolve({ kind: 'exclude' }))
  assert.equal(decision.kind, DECISION.malformed)
  assert.equal(decision.thenable, true)
})

test('malformed shapes are rejected', () => {
  assert.deepEqual(decideSessionTitleCandidate(null), { kind: DECISION.malformed })
  assert.deepEqual(decideSessionTitleCandidate('exclude'), { kind: DECISION.malformed })
  assert.deepEqual(decideSessionTitleCandidate({ kind: 'bogus' }), { kind: DECISION.malformed })
  assert.deepEqual(decideSessionTitleCandidate({ kind: 'exclude', reason: 5 }), { kind: DECISION.malformed })
  assert.deepEqual(decideSessionTitleCandidate({ kind: 'replace', reason: 5 }), { kind: DECISION.malformed })
  assert.deepEqual(decideSessionTitleCandidate({ kind: 'replace' }), { kind: DECISION.malformed })
  assert.deepEqual(decideSessionTitleCandidate({ kind: 'replace', message: null }), { kind: DECISION.malformed })
  assert.deepEqual(decideSessionTitleCandidate({ kind: 'replace', message: { seq: '2' } }), { kind: DECISION.malformed })
  assert.deepEqual(decideSessionTitleCandidate({ kind: 'replace', message: { seq: -1 } }), { kind: DECISION.malformed })
  assert.deepEqual(decideSessionTitleCandidate({ kind: 'replace', message: { seq: Infinity } }), { kind: DECISION.malformed })
  assert.deepEqual(decideSessionTitleCandidate({ kind: 'replace', message: { seq: 1.5 } }), { kind: DECISION.malformed })
})

test('convergeThenable attaches a rejection handler and returns true for thenables only', async () => {
  assert.equal(convergeThenable(undefined), false)
  assert.equal(convergeThenable({}), false)
  assert.equal(convergeThenable('x'), false)

  let settled = false
  let seen
  const p = Promise.reject(new TypeError('boom'))
  assert.equal(convergeThenable(p, (error) => { settled = true; seen = error }), true)
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(settled, true)
  assert.equal(seen?.name, 'TypeError')
})

test('isThenable detects then-like values', () => {
  assert.equal(isThenable(Promise.resolve()), true)
  assert.equal(isThenable({ then() {} }), true)
  assert.equal(isThenable({}), false)
  assert.equal(isThenable(undefined), false)
})

function makeEvent(seq, { type = 'user/message', source = { kind: 'user' }, content = [{ type: 'text', text: `text-${seq}` }] } = {}) {
  return { seq, type, data: { source, content } }
}

// The real service log is a dense array where `events[seq] === <that seq's event>`
// (index 0 may hold a placeholder). `dense()` builds such an array from sparse
// event objects so fixtures read naturally.
function dense(events) {
  const arr = []
  for (const event of events) arr[event.seq] = event
  return arr
}

function makeSession(events) {
  return { id: 'session-1', events }
}

test('buildSessionTitleCandidatePayload deep-freezes message+source but keeps agent/session live', () => {
  const agent = { id: 'agent-1' }
  const session = makeSession([])
  const message = { seq: 1, text: 'hello', source: { kind: 'user', form: 'anchor' } }
  const payload = buildSessionTitleCandidatePayload(agent, session, message)

  assert.equal(payload.message.seq, 1)
  assert.equal(payload.message.text, 'hello')
  assert.equal(payload.message.source.kind, 'user')
  assert.ok(Object.isFrozen(payload.message), 'message must be frozen')
  assert.ok(Object.isFrozen(payload.message.source), 'source must be frozen')
  assert.ok(payload.message.source.form === 'anchor')
  assert.ok(Object.isFrozen(payload), 'payload object itself must be frozen')
  assert.throws(() => { payload.message.source.kind = 'bot' }, 'a listener must not mutate source through the payload')
  assert.throws(() => { payload.message.text = 'edited' }, 'a listener must not mutate text through the payload')

  // agent/session stay live (not frozen).
  assert.ok(!Object.isFrozen(agent))
  assert.ok(!Object.isFrozen(session))
  assert.equal(Object.isFrozen(payload.agent), false)
  assert.equal(Object.isFrozen(payload.session), false)
  payload.agent.id = 'agent-1-renamed'
  assert.equal(agent.id, 'agent-1-renamed', 'agent reference must remain writable')
  assert.equal(payload.agent, agent)
  assert.equal(payload.session, session)
})

test('extractTitleText joins text blocks exactly like the official collector', () => {
  const event = makeEvent(1, { content: [{ type: 'image' }, { type: 'text', text: 'a' }, { type: 'text', text: 'b\nc' }] })
  assert.equal(extractTitleText(event), 'a\nb\nc')
  assert.equal(extractTitleText(makeEvent(2, { content: null })), '')
  assert.equal(extractTitleText({ seq: 3, type: 'user/message', data: null }), '')
})

test('isNonEmptyTitleText mirrors the official non-empty normalization', () => {
  assert.equal(isNonEmptyTitleText('hello'), true)
  assert.equal(isNonEmptyTitleText('   '), false)
  assert.equal(isNonEmptyTitleText('\u001B[31mred\u001B[0m'), true)
  assert.equal(isNonEmptyTitleText('\u200B\u200B'), false)
  assert.equal(isNonEmptyTitleText('\u0000'), false)
  assert.equal(isNonEmptyTitleText(''), false)
  assert.equal(isNonEmptyTitleText(42), false)
})

test('resolveReplacement returns the referenced eligible message (design Data Models)', () => {
  const events = dense([makeEvent(1), makeEvent(2, { source: { kind: 'user', form: 'anchor' } })])
  const session = makeSession(events)
  assert.deepEqual(resolveReplacement(session, { seq: 2 }), { seq: 2, text: 'text-2' })
})

test('resolveReplacement enforces the throughSeq boundary', () => {
  const events = dense([makeEvent(1), makeEvent(2)])
  const session = makeSession(events)
  assert.deepEqual(resolveReplacement(session, { seq: 2 }, 2), { seq: 2, text: 'text-2' })
  assert.equal(resolveReplacement(session, { seq: 2 }, 1), undefined, 'seq beyond the boundary must fail')
})

test('resolveReplacement rejects invalid references', () => {
  const events = dense([
    makeEvent(1, { type: 'internal/placeholder' }),
    makeEvent(2, { source: { kind: 'tool' } }),
    makeEvent(3, { content: [{ type: 'text', text: '   ' }] }),
  ])
  const session = makeSession(events)
  assert.equal(resolveReplacement(session, { seq: 1 }), undefined, 'non user/message must fail')
  assert.equal(resolveReplacement(session, { seq: 2 }), undefined, 'source.kind !== user must fail')
  assert.equal(resolveReplacement(session, { seq: 3 }), undefined, 'empty normalized text must fail')
  assert.equal(resolveReplacement(session, { seq: 99 }), undefined, 'out-of-range seq must fail')
  assert.equal(resolveReplacement(session, { seq: -1 }), undefined, 'negative seq must fail')
  assert.equal(resolveReplacement(session, { seq: 1.5 }), undefined, 'non-integer seq must fail')
  assert.equal(resolveReplacement(session, { seq: '1' }), undefined, 'string seq must fail')
  assert.equal(resolveReplacement(session, null), undefined)
  assert.equal(resolveReplacement(null, { seq: 1 }), undefined)
})

test('resolveReplacement honors a custom eligibility predicate and a seq/event mismatch', () => {
  const events = dense([
    makeEvent(1),
    { seq: 2, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'x' }] } },
  ])
  const session = makeSession(events)
  assert.deepEqual(resolveReplacement(session, { seq: 2 }), { seq: 2, text: 'x' })
  assert.equal(resolveReplacement(session, { seq: 2 }, undefined, () => false), undefined, 'custom predicate may veto')
  // The event stored at index 2 has a different `.seq` → reference must fail.
  const mismatch = [makeEvent(0), makeEvent(1), { seq: 99, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'x' }] } }]
  assert.equal(resolveReplacement(makeSession(mismatch), { seq: 2 }), undefined, 'event.seq must equal the reference seq')
})

test('redactedDecisionMessage never leaks text, title, session content, or reason', () => {
  const message = redactedDecisionMessage(DECISION.malformed, new Error('my secret session body'))
  assert.match(message, /session-title\/candidate/)
  assert.match(message, /malformed/)
  assert.match(message, /Error/)
  assert.ok(!message.includes('secret'))
  assert.ok(!redactedDecisionMessage(DECISION.exclude).includes('secret'))
})
