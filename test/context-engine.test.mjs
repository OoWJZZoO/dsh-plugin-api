import test from 'node:test'
import assert from 'node:assert/strict'
import { createContextEngine } from '../lib/context-engine.js'

function fakeSources(overrides = {}) {
  const status = (value) => () => value
  return {
    systemPrompt: { status: status('available') },
    sessionSurface: {
      status: status('available'),
      verifySeqBounds: (sessionId, seqs) => ({ ok: true, sessionKey: sessionId, seqs }),
    },
    attachment: { status: status('unavailable') },
    toolExposure: { status: status('unavailable') },
    skillExposure: { status: status('unavailable') },
    compaction: { status: status('available') },
    ...overrides,
  }
}

function makeEngine(options = {}) {
  return createContextEngine({
    sources: fakeSources(options.sources),
    evidenceSource: options.evidenceSource === undefined
      ? { status: () => 'available' }
      : options.evidenceSource,
    now: options.now ?? (() => new Date('2026-08-26T10:00:00.000Z')),
    sessionResolver: options.sessionResolver ?? ((sessionId) => ({ ok: true, sessionId })),
    reportDiagnostics: options.reportDiagnostics ?? (() => {}),
    ...options,
  })
}

function spec(overrides = {}) {
  return {
    id: 'node-1',
    owner: 'plugin-a',
    scope: { kind: 'session', key: 'session-1' },
    phase: 'default',
    priority: 'normal',
    source: { kind: 'systemPrompt', owner: 'plugin-a' },
    sectionKey: 'deployment:persona',
    audience: { model: true, ui: false, diagnostic: true },
    ...overrides,
  }
}

test('contribute registers with a handle, generation token, and idempotent identity-bound disposer', () => {
  const engine = makeEngine()
  const result = engine.contribute(spec())
  assert.equal(result.ok, true)
  assert.equal(result.handle.id, 'node-1')
  assert.equal(result.handle.owner, 'plugin-a')
  assert.match(result.handle.generation, /^\d+$/)
  const dispose = result.handle.dispose()
  assert.deepEqual(dispose, { ok: true, already: false })
  assert.deepEqual(result.handle.dispose(), { ok: true, already: true })
  assert.deepEqual(result.handle.dispose(), { ok: true, already: true })
  // a released handle stays idempotent and never removes a same-id replacement
  const again = engine.contribute(spec())
  assert.equal(again.ok, true)
  assert.deepEqual(result.handle.dispose(), { ok: true, already: true })
  const graph = engine.compose({ sessionId: 'session-1' })
  assert.deepEqual(graph.nodes.map((n) => n.id), ['node-1'])
})

test('contribute rejects invalid specs with typed invalid results and preserves duplicates', () => {
  const engine = makeEngine()
  const invalid = engine.contribute(spec({ audience: undefined }))
  assert.equal(invalid.ok, false)
  assert.equal(invalid.code, 'CONTRIBUTION_INVALID')
  assert.ok(invalid.problems.length > 0)
  const first = engine.contribute(spec())
  assert.equal(first.ok, true)
  const second = engine.contribute(spec())
  assert.equal(second.ok, false)
  assert.equal(second.code, 'CONTRIBUTION_CONFLICT')
  assert.equal(second.existingId, 'node-1')
  // existing contribution preserved: still visible in the composed graph
  const graph = engine.compose({ sessionId: 'session-1' })
  assert.equal(graph.nodes[0].id, 'node-1')
})

test('a disposer never removes another owner s contribution', () => {
  const engine = makeEngine()
  const a = engine.contribute(spec({ id: 'a', owner: 'plugin-a' }))
  const b = engine.contribute(spec({ id: 'a', owner: 'plugin-b' }))
  assert.equal(a.ok, true)
  assert.equal(b.ok, true)
  a.handle.dispose()
  const graph = engine.compose({ sessionId: 'session-1' })
  assert.deepEqual(graph.nodes.map((n) => n.owner), ['plugin-b'])
})

test('compose is a pure projection: deterministic ordering, frozen output, no state mutation', () => {
  const engine = makeEngine({ now: () => new Date('2026-08-26T10:00:00.000Z') })
  engine.contribute(spec({ id: 'a', priority: 'low', source: { kind: 'memory', owner: 'p1' } }))
  engine.contribute(spec({ id: 'b', priority: 'highest', phase: 'zeta', source: { kind: 'memory', owner: 'p1' } }))
  engine.contribute(spec({ id: 'c', priority: 'highest', phase: 'alpha', source: { kind: 'memory', owner: 'p1' } }))
  engine.contribute(spec({ id: 'd', scope: { kind: 'request', key: 'session-1' }, phase: 'assemble', source: { kind: 'memory', owner: 'p1' } }))
  const graph = engine.compose({ sessionId: 'session-1', phase: 'assemble' })
  // scope tier (session first), then phase asc ('alpha' < 'default' < 'zeta'),
  // then priority desc, then registration seq
  assert.deepEqual(graph.nodes.map((n) => n.id), ['c', 'a', 'b', 'd'])
  assert.ok(Object.isFrozen(graph))
  assert.ok(Object.isFrozen(graph.nodes[0]))
  assert.equal(graph.generation, 1)
  assert.equal(engine.compose({ sessionId: 'session-1' }).generation, 2)
  // pure projection: engine node state remains contributed after compose
  const inspect = engine.inspect('session-1')
  assert.ok(inspect.served.every((entry) => entry.node.state === 'served'))
})

test('compose resolves scope failures, respects abort signals, and reports budgets honestly', () => {
  const engine = makeEngine()
  assert.equal(engine.compose({}).code, 'COMPOSE_SCOPE_UNRESOLVED')
  assert.equal(engine.compose({ sessionId: '' }).code, 'COMPOSE_SCOPE_UNRESOLVED')
  const controller = new AbortController()
  controller.abort(new Error('user cancelled'))
  const aborted = engine.compose({ sessionId: 'session-1' }, { signal: controller.signal })
  assert.equal(aborted.code, 'COMPOSE_ABORTED')
  assert.match(aborted.reason, /user cancelled/)
  engine.contribute(spec())
  // no budget: applied false, no truncation
  const noBudget = engine.compose({ sessionId: 'session-1' })
  assert.deepEqual(noBudget.budget, { applied: false })
  assert.equal(noBudget.nodes.length, 1)
  // malformed budget: applied false with an explicit reason, never silent
  const malformed = engine.compose({ sessionId: 'session-1' }, { budget: { maxNodes: 0 } })
  assert.equal(malformed.budget.applied, false)
  assert.match(malformed.budget.reason, /maxNodes/)
})

test('compose truncates by budget with per-node dropped reasons', () => {
  const engine = makeEngine()
  engine.contribute(spec({ id: 'a', source: { kind: 'memory', owner: 'p1' } }))
  engine.contribute(spec({ id: 'b', source: { kind: 'memory', owner: 'p1' } }))
  engine.contribute(spec({ id: 'c', source: { kind: 'memory', owner: 'p1' } }))
  const graph = engine.compose({ sessionId: 'session-1' }, { budget: { maxNodes: 2 } })
  assert.deepEqual(graph.nodes.map((n) => n.id), ['a', 'b'])
  assert.equal(graph.dropped.length, 1)
  assert.equal(graph.dropped[0].nodeId, 'c')
  assert.equal(graph.dropped[0].reason.code, 'budget-exceeded')
  assert.deepEqual(graph.budget, { applied: true, maxNodes: 2 })
})

test('expired contributions are excluded from the served view with an explicit reason', () => {
  const engine = makeEngine({ now: () => new Date('2026-08-26T10:00:00.000Z') })
  engine.contribute(spec({ id: 'fresh', expiresAt: '2030-01-01T00:00:00.000Z' }))
  engine.contribute(spec({ id: 'stale', expiresAt: '2020-01-01T00:00:00.000Z' }))
  const graph = engine.compose({ sessionId: 'session-1' })
  assert.deepEqual(graph.nodes.map((n) => n.id), ['fresh'])
  assert.equal(graph.dropped[0].nodeId, 'stale')
  assert.equal(graph.dropped[0].reason.code, 'expired')
})

test('compose policy waterfall: pure functions ordered by priority, a throw degrades only that decision', () => {
  const engine = makeEngine()
  engine.contribute(spec({ id: 'a', source: { kind: 'memory', owner: 'p1' } }))
  engine.contribute(spec({ id: 'b', source: { kind: 'memory', owner: 'p1' } }))
  engine.contribute(spec({ id: 'c', source: { kind: 'memory', owner: 'p1' } }))
  engine.policy.register((nodes) => nodes.filter((n) => n.id !== 'b'), { name: 'drop-b', priority: 'highest' })
  engine.policy.register(() => { throw new Error('boom') }, { name: 'exploder', priority: 'monitor' })
  const graph = engine.compose({ sessionId: 'session-1' })
  assert.deepEqual(graph.nodes.map((n) => n.id), ['a', 'c'])
  assert.equal(graph.dropped[0].nodeId, 'b')
  assert.equal(graph.dropped[0].reason.code, 'policy-excluded')
  assert.equal(graph.policyDegraded.length, 1)
  assert.equal(graph.policyDegraded[0].name, 'exploder')
})

test('policy registration is a fail-safe no-op for non-functions', () => {
  const engine = makeEngine()
  const result = engine.policy.register('nope')
  assert.equal(result.ok, false)
  assert.equal(result.code, 'CONTRIBUTION_INVALID')
})

test('evidence intake transitions matching nodes to sent and records sentBy', () => {
  const engine = makeEngine()
  engine.contribute(spec({ id: 'section', sectionKey: 'deployment:persona' }))
  engine.contribute(spec({ id: 'surface', source: { kind: 'sessionSurface', owner: 'p1' }, scope: { kind: 'request', key: 'session-1' }, phase: 'assemble', sourceEventSeqs: [10, 11, 12] }))
  engine.contribute(spec({ id: 'unmatched', sectionKey: 'other:section', source: { kind: 'systemPrompt', owner: 'p1' } }))
  const applied = engine.intakeEvidence({
    sessionId: 'session-1',
    generation: 1,
    systemSections: [{ sectionKey: 'deployment:persona', sourceTags: [] }],
    messageRanges: [{ fromSeq: 10, toSeq: 12, count: 3 }],
    dropped: [],
    observedAt: '2026-08-26T10:00:00.000Z',
  })
  assert.equal(applied.ok, true)
  assert.equal(applied.stale, false)
  assert.equal(applied.transitionsApplied, 2)
  const graph = engine.compose({ sessionId: 'session-1', phase: 'assemble' })
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  assert.equal(byId.get('section').state, 'sent')
  assert.equal(byId.get('section').sentBy.evidenceId, '1')
  assert.equal(byId.get('surface').state, 'sent')
  assert.equal(byId.get('unmatched').state, 'served')
})

test('evidence dropped refs mark nodes dropped and never sent', () => {
  const engine = makeEngine()
  engine.contribute(spec({ id: 'kept', sectionKey: 'a' }))
  engine.contribute(spec({ id: 'omitted', sectionKey: 'b' }))
  const applied = engine.intakeEvidence({
    sessionId: 'session-1',
    generation: 1,
    systemSections: [{ sectionKey: 'a', sourceTags: [] }],
    messageRanges: [],
    dropped: [{ ref: 'b', reason: 'rendered-empty' }],
    observedAt: '2026-08-26T10:00:00.000Z',
  })
  assert.equal(applied.transitionsApplied, 1)
  const graph = engine.compose({ sessionId: 'session-1' })
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  assert.equal(byId.get('kept').state, 'sent')
  assert.equal(byId.get('omitted').state, 'served')
  assert.equal(byId.get('omitted').droppedReason.code, 'evidence-dropped')
  const inspect = engine.inspect('session-1')
  assert.ok(inspect.dropped.some((entry) => entry.nodeId === 'omitted'))
})

test('late or stale evidence never rewrites committed states and is kept as diagnostics', () => {
  const engine = makeEngine()
  engine.contribute(spec({ id: 'section', sectionKey: 'a' }))
  const payload = (generation) => ({
    sessionId: 'session-1',
    generation,
    systemSections: [{ sectionKey: 'a', sourceTags: [] }],
    messageRanges: [],
    dropped: [],
    observedAt: '2026-08-26T10:00:00.000Z',
  })
  assert.equal(engine.intakeEvidence(payload(1)).transitionsApplied, 1)
  // same generation replayed: stale, no rewrite
  const replay = engine.intakeEvidence(payload(1))
  assert.equal(replay.stale, true)
  assert.equal(replay.transitionsApplied, undefined)
  // newer generation still matches but the node is already committed: never rewritten
  assert.equal(engine.intakeEvidence(payload(3)).transitionsApplied, 0)
  const replayOld = engine.intakeEvidence(payload(2))
  assert.equal(replayOld.stale, true)
  const graph = engine.compose({ sessionId: 'session-1' })
  assert.equal(graph.nodes[0].state, 'sent')
  assert.equal(graph.nodes[0].sentBy.evidenceId, '1')
})

test('without an active evidence source the sent state is unreachable and served is the cap', () => {
  const engine = makeEngine({ evidenceSource: { status: () => 'unavailable' } })
  engine.contribute(spec({ id: 'section', sectionKey: 'a' }))
  const graph = engine.compose({ sessionId: 'session-1' })
  assert.equal(graph.nodes[0].state, 'served')
  assert.equal(engine.availability().sentReachable, false)
  // evidence intake is still logged but cannot fabricate sent
  engine.intakeEvidence({
    sessionId: 'session-1',
    generation: 1,
    systemSections: [{ sectionKey: 'a', sourceTags: [] }],
    messageRanges: [],
    dropped: [],
    observedAt: '2026-08-26T10:00:00.000Z',
  })
  assert.equal(engine.availability().sentReachable, false)
})

test('invalid evidence payloads are rejected with typed evidence results and never break dispatch', () => {
  const engine = makeEngine()
  const invalid = engine.intakeEvidence({ sessionId: 'session-1', content: 'secret' })
  assert.equal(invalid.ok, false)
  assert.equal(invalid.code, 'EVIDENCE_UNAVAILABLE')
})

test('replacement mappings archive matching nodes and record bounded lineage', () => {
  const engine = makeEngine()
  engine.contribute(spec({ id: 'old-1', source: { kind: 'sessionSurface', owner: 'p1' }, sourceEventSeqs: [1, 2] }))
  engine.contribute(spec({ id: 'old-2', source: { kind: 'sessionSurface', owner: 'p1' }, sourceEventSeqs: [3, 4] }))
  engine.contribute(spec({ id: 'untouched' }))
  const recorded = engine.recordMapping({
    sessionId: 'session-1',
    oldNodeIds: ['old-1', 'old-2'],
    newNodeId: 'compaction:c-1',
    reason: 'compacted',
    generation: 'c-1',
    observedAt: '2026-08-26T10:00:00.000Z',
  })
  assert.equal(recorded.ok, true)
  assert.equal(recorded.transitionsApplied, 2)
  const graph = engine.compose({ sessionId: 'session-1' })
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  assert.equal(byId.get('old-1').state, 'archived')
  assert.equal(byId.get('untouched').state, 'served')
  const entries = engine.mapping({ sessionId: 'session-1' })
  assert.equal(entries.ok, true)
  assert.equal(entries.entries.length, 1)
  assert.equal(entries.entries[0].newNodeId, 'compaction:c-1')
  assert.ok(entries.entries[0].oldNodeIds.includes('old-1'))
  assert.equal(engine.mapping({ nodeId: 'untouched' }).entries.length, 0)
})

test('mapping is explicitly unavailable when the compaction seam is unavailable', () => {
  const engine = makeEngine({ sources: { compaction: { status: () => 'unavailable' } } })
  const result = engine.mapping({})
  assert.equal(result.ok, false)
  assert.equal(result.code, 'MAPPING_UNAVAILABLE')
})

test('superseded mappings transition nodes to the superseded lineage state', () => {
  const engine = makeEngine()
  engine.contribute(spec({ id: 'old', source: { kind: 'sessionSurface', owner: 'p1' }, sourceEventSeqs: [1] }))
  engine.recordMapping({
    sessionId: 'session-1',
    oldNodeIds: ['old'],
    newNodeId: 'replacement-1',
    reason: 'superseded',
    generation: 'g-2',
    observedAt: '2026-08-26T10:00:00.000Z',
  })
  const inspect = engine.inspect('session-1')
  const entry = inspect.archived.find((item) => item.node.id === 'old')
  assert.equal(entry.node.state, 'superseded')
})

test('inspect returns frozen bounded buckets and paginates deterministically', () => {
  const engine = makeEngine()
  for (let i = 0; i < 10; i += 1) {
    engine.contribute(spec({ id: `node-${i}`, source: { kind: 'memory', owner: 'p1' } }))
  }
  engine.compose({ sessionId: 'session-1' })
  const result = engine.inspect('session-1', { limit: 3 })
  assert.equal(result.truncated, true)
  assert.equal(result.served.length, 3)
  assert.equal(typeof result.nextCursor, 'string')
  assert.ok(Object.isFrozen(result))
  assert.ok(Object.isFrozen(result.served[0]))
  const next = engine.inspect('session-1', { limit: 3, cursor: result.nextCursor })
  assert.equal(next.served.length, 3)
  assert.notEqual(next.served[0].node.id, result.served[0].node.id)
  // out-of-scope or missing sessions are typed unavailable without existence disclosure
  const blocked = makeEngine({ sessionResolver: () => ({ ok: false }) })
  assert.equal(blocked.inspect('session-1').code, 'INSPECT_UNAVAILABLE')
})

test('inspect respects an abort signal with a typed aborted outcome', () => {
  const engine = makeEngine()
  engine.contribute(spec())
  const controller = new AbortController()
  controller.abort(new Error('stop'))
  const result = engine.inspect('session-1', { signal: controller.signal })
  assert.equal(result.aborted, true)
  assert.match(result.reason, /stop/)
})

test('inspect applies audience envelopes (default deny) and redaction fail-closed', () => {
  const engine = makeEngine()
  engine.contribute(spec({ id: 'ui-node', audience: { model: true, ui: true, diagnostic: false }, content: { text: 'hello' } }))
  engine.contribute(spec({ id: 'denied-node', audience: { model: true, ui: false, diagnostic: false }, content: { text: 'secret-ish' } }))
  engine.compose({ sessionId: 'session-1' })
  // default: no content anywhere
  const plain = engine.inspect('session-1')
  assert.equal(plain.served[0].node.content, undefined)
  assert.equal(plain.served[1].node.content, undefined)
  // ui audience: only ui-allowed nodes carry content
  const ui = engine.inspect('session-1', { audience: 'ui' })
  const byId = (result) => new Map(result.served.map((entry) => [entry.node.id, entry]))
  assert.deepEqual(byId(ui).get('ui-node').content, { text: 'hello' })
  assert.equal(byId(ui).get('denied-node').content, undefined)
  // redaction failure: uncloneable content transitions the node to redacted fail-closed
  const bad = makeEngine()
  bad.contribute(spec({ id: 'poison', audience: { model: true, ui: true, diagnostic: false }, content: { fn: () => {} } }))
  const failed = bad.inspect('session-1', { audience: 'ui' })
  assert.equal(failed.redactionFailures.length, 1)
  assert.equal(failed.redactionFailures[0].code, 'REDACTION_FAILED')
  assert.equal(failed.served.length, 0)
  const after = bad.inspect('session-1')
  assert.equal(after.archived[0].node.state, 'redacted')
})

test('observer epoch: listeners receive frozen snapshots and stale listeners are silenced after dispose', () => {
  const engine = makeEngine()
  const seen = []
  const sub = engine.observe((snapshot) => seen.push(snapshot))
  assert.equal(sub.ok, true)
  assert.equal(typeof sub.disposer, 'function')
  engine.contribute(spec({ id: 'section', sectionKey: 'a' }))
  engine.intakeEvidence({
    sessionId: 'session-1',
    generation: 1,
    systemSections: [{ sectionKey: 'a', sourceTags: [] }],
    messageRanges: [],
    dropped: [],
    observedAt: '2026-08-26T10:00:00.000Z',
  })
  assert.ok(seen.some((snapshot) => snapshot.kind === 'evidence'))
  assert.ok(seen.some((snapshot) => snapshot.kind === 'node-state' && snapshot.state === 'sent'))
  assert.ok(seen.every((snapshot) => Object.isFrozen(snapshot)))
  const before = seen.length
  sub.disposer()
  engine.recordMapping({
    sessionId: 'session-1',
    oldNodeIds: ['section'],
    newNodeId: 'c-1',
    reason: 'compacted',
    generation: 'c-1',
    observedAt: '2026-08-26T10:00:00.000Z',
  })
  assert.equal(seen.length, before)
  // a throwing listener never escapes ingestion
  const throwing = makeEngine()
  throwing.observe(() => { throw new Error('listener exploded') })
  throwing.contribute(spec({ id: 'section', sectionKey: 'a' }))
  throwing.intakeEvidence({
    sessionId: 'session-1',
    generation: 1,
    systemSections: [{ sectionKey: 'a', sourceTags: [] }],
    messageRanges: [],
    dropped: [],
    observedAt: '2026-08-26T10:00:00.000Z',
  })
  assert.equal(engine.availability().active, true)
})

test('per-session capacity evicts the oldest contributed node with a dropped reason', () => {
  const engine = makeEngine()
  const first = engine.contribute(spec({ id: 'n-0', source: { kind: 'memory', owner: 'p1' } }))
  assert.equal(first.ok, true)
  for (let i = 1; i < 1005; i += 1) {
    const result = engine.contribute(spec({ id: `n-${i}`, source: { kind: 'memory', owner: 'p1' } }))
    assert.equal(result.ok, true)
  }
  // the evicted node's handle reports the node as gone
  assert.equal(first.handle.dispose().code, 'CONTRIBUTION_UNKNOWN')
  const graph = engine.compose({ sessionId: 'session-1' })
  assert.equal(graph.nodes.length, 1000)
  // dropped records sit at the end of the deterministic bucket order; walk pages to reach them
  let cursor
  let seen = null
  for (let page = 0; page < 8 && seen === null; page += 1) {
    const inspect = engine.inspect('session-1', { limit: 200, cursor })
    if (inspect.dropped.some((entry) => entry.nodeId === 'n-0')) seen = inspect
    cursor = inspect.nextCursor
  }
  assert.ok(seen !== null, 'capacity-dropped record reachable by pagination')
})

test('dispose is idempotent and the disposed engine returns typed inactive results', () => {
  const engine = makeEngine()
  engine.contribute(spec())
  engine.dispose()
  engine.dispose()
  assert.equal(engine.contribute(spec()).code, 'INACTIVE')
  assert.equal(engine.compose({ sessionId: 'session-1' }).code, 'INACTIVE')
  assert.equal(engine.inspect('session-1').code, 'INACTIVE')
  assert.equal(engine.availability().active, false)
})