import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CONTEXT_SOURCE_KINDS,
  DEFAULT_INSPECT_LIMIT,
  MAX_INSPECT_LIMIT,
  MAX_SOURCE_EVENT_SEQS,
  PRIORITIES,
  applyBudget,
  compareNodes,
  hasContentLikeKeys,
  normalizeAssembledEvidence,
  normalizeBudget,
  normalizeContribution,
  normalizeInspectOptions,
  normalizeReplacementMapping,
} from '../lib/context-normalize.js'

function validSpec(overrides = {}) {
  return {
    id: 'node-1',
    owner: 'plugin-a',
    scope: { kind: 'session', key: 'session-1' },
    phase: 'assemble',
    priority: 'high',
    source: { kind: 'systemPrompt', owner: 'plugin-a' },
    sourceEventSeqs: [3, 4, 5],
    sectionKey: 'deployment:persona',
    expiresAt: '2030-01-01T00:00:00.000Z',
    audience: { model: true, ui: false, diagnostic: true },
    ...overrides,
  }
}

test('normalizeContribution accepts a complete valid contribution and applies defaults', () => {
  const result = normalizeContribution(validSpec({ phase: undefined, priority: undefined }))
  assert.equal(result.ok, true)
  assert.equal(result.contribution.phase, 'default')
  assert.equal(result.contribution.priority, 'normal')
  assert.deepEqual(result.contribution.scope, { kind: 'session', key: 'session-1' })
  assert.deepEqual(result.contribution.source, { kind: 'systemPrompt', owner: 'plugin-a' })
  assert.deepEqual(result.contribution.audience, { model: true, ui: false, diagnostic: true })
  assert.deepEqual(result.contribution.sourceEventSeqs, [3, 4, 5])
})

test('normalizeContribution rejects missing required fields', () => {
  for (const [field, spec] of [
    ['id', validSpec({ id: '' })],
    ['owner', validSpec({ owner: '  ' })],
    ['scope', validSpec({ scope: undefined })],
    ['scope.kind', validSpec({ scope: { kind: 'fiber', key: 'session-1' } })],
    ['scope.key', validSpec({ scope: { kind: 'session', key: '' } })],
    ['source', validSpec({ source: undefined })],
    ['source.kind', validSpec({ source: { kind: 'transcript', owner: 'plugin-a' } })],
    ['source.owner', validSpec({ source: { kind: 'memory', owner: '' } })],
    ['audience', validSpec({ audience: undefined })],
    ['audience.model', validSpec({ audience: { model: 'yes', ui: false, diagnostic: false } })],
  ]) {
    const result = normalizeContribution(spec)
    assert.equal(result.ok, false, `expected rejection for ${field}`)
    assert.ok(Array.isArray(result.problems) && result.problems.length > 0, `problems for ${field}`)
    assert.ok(result.problems.some((p) => p.field === field), `problem names ${field}: ${JSON.stringify(result.problems)}`)
  }
})

test('normalizeContribution rejects malformed optional fields', () => {
  const cases = [
    ['phase', validSpec({ phase: 7 })],
    ['priority', validSpec({ priority: 'urgent' })],
    ['sourceEventSeqs', validSpec({ sourceEventSeqs: [-1, 2] })],
    ['sourceEventSeqs', validSpec({ sourceEventSeqs: Array.from({ length: MAX_SOURCE_EVENT_SEQS + 1 }, (_, i) => i) })],
    ['sourceEventSeqs', validSpec({ sourceEventSeqs: '3,4' })],
    ['refs', validSpec({ refs: ['ok', ''] })],
    ['refs', validSpec({ refs: 'ref' })],
    ['sectionKey', validSpec({ sectionKey: '' })],
    ['expiresAt', validSpec({ expiresAt: 'tomorrow' })],
    ['supersedes', validSpec({ supersedes: 3 })],
  ]
  for (const [field, spec] of cases) {
    const result = normalizeContribution(spec)
    assert.equal(result.ok, false, `expected rejection for ${field}`)
    assert.ok(result.problems.some((p) => p.field === field), `problem names ${field}`)
  }
})

test('normalizeContribution never mutates or reorders provided provenance', () => {
  const result = normalizeContribution(validSpec({ sourceEventSeqs: [9, 1, 7] }))
  assert.equal(result.ok, true)
  assert.deepEqual(result.contribution.sourceEventSeqs, [9, 1, 7])
})

test('compareNodes orders by scope tier, phase, priority, registration seq, then id', () => {
  const node = (overrides) => ({
    id: 'n',
    scope: { kind: 'session', key: 's' },
    phase: 'default',
    priority: 'normal',
    registrationSeq: 0,
    ...overrides,
  })
  const sort = (nodes) => [...nodes].sort(compareNodes)
  // scope tier: session before request
  assert.deepEqual(
    sort([node({ id: 'a', scope: { kind: 'request', key: 's' } }), node({ id: 'b', scope: { kind: 'session', key: 's' } })]).map((n) => n.id),
    ['b', 'a'],
  )
  // phase ascending
  assert.deepEqual(
    sort([node({ id: 'a', phase: 'zeta' }), node({ id: 'b', phase: 'alpha' })]).map((n) => n.id),
    ['b', 'a'],
  )
  // priority descending (highest first)
  assert.deepEqual(
    sort([node({ id: 'a', priority: 'low' }), node({ id: 'b', priority: 'highest' }), node({ id: 'c', priority: 'high' })]).map((n) => n.id),
    ['b', 'c', 'a'],
  )
  // registration sequence ascending
  assert.deepEqual(
    sort([node({ id: 'a', registrationSeq: 5 }), node({ id: 'b', registrationSeq: 2 }), node({ id: 'c', registrationSeq: 2, phase: 'default' })]).map((n) => n.id),
    ['b', 'c', 'a'],
  )
  // id ascending as final tie-break (same tier/phase/priority/seq)
  assert.deepEqual(
    sort([node({ id: 'z' }), node({ id: 'a' })]).map((n) => n.id),
    ['a', 'z'],
  )
  // full sort is deterministic across runs
  const pool = [node({ id: 'p', priority: 'highest' }), node({ id: 'q', scope: { kind: 'request', key: 's' }, priority: 'highest' }), node({ id: 'r', phase: 'aa', priority: 'high' }), node({ id: 's', phase: 'bb', priority: 'high' }), node({ id: 't', registrationSeq: 9 })]
  const first = sort(pool).map((n) => n.id).join(',')
  const second = sort([...pool].reverse()).map((n) => n.id).join(',')
  assert.equal(first, second)
})

test('applyBudget truncates with per-node dropped reasons and never silently includes over-budget content', () => {
  const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const result = applyBudget(nodes, { maxNodes: 2 })
  assert.deepEqual(result.kept.map((n) => n.id), ['a', 'b'])
  assert.equal(result.dropped.length, 1)
  assert.equal(result.dropped[0].nodeId, 'c')
  assert.equal(result.dropped[0].reason.code, 'budget-exceeded')
  assert.match(result.dropped[0].reason.detail, /budget of 2 nodes/)
})

test('applyBudget keeps everything without a budget or with a malformed budget', () => {
  assert.deepEqual(applyBudget([{ id: 'a' }, { id: 'b' }], undefined).kept.map((n) => n.id), ['a', 'b'])
  assert.deepEqual(applyBudget([{ id: 'a' }, { id: 'b' }], { maxNodes: 0 }).kept.map((n) => n.id), ['a', 'b'])
  assert.deepEqual(applyBudget([{ id: 'a' }, { id: 'b' }], { maxNodes: Number.MAX_SAFE_INTEGER }).kept.map((n) => n.id), ['a', 'b'])
})

test('normalizeBudget accepts valid budgets and rejects malformed ones', () => {
  assert.deepEqual(normalizeBudget(undefined), { ok: true, budget: { maxNodes: Number.MAX_SAFE_INTEGER } })
  assert.deepEqual(normalizeBudget({ maxNodes: 10 }), { ok: true, budget: { maxNodes: 10 } })
  assert.equal(normalizeBudget({ maxNodes: 0 }).ok, false)
  assert.equal(normalizeBudget({ maxNodes: 1.5 }).ok, false)
  assert.equal(normalizeBudget({ maxNodes: '10' }).ok, false)
  assert.equal(normalizeBudget([]).ok, false)
})

test('normalizeAssembledEvidence accepts a valid identifiers-only payload', () => {
  const payload = {
    sessionId: 'session-1',
    generation: 3,
    systemSections: [{ sectionKey: 'deployment:persona', sourceTags: [] }],
    messageRanges: [{ fromSeq: 10, toSeq: 12, count: 3 }],
    dropped: [{ ref: 'agent:recall', reason: 'rendered-empty' }],
    observedAt: '2026-08-26T10:00:00.000Z',
  }
  const result = normalizeAssembledEvidence(payload)
  assert.equal(result.ok, true)
  assert.deepEqual(result.evidence, payload)
})

test('normalizeAssembledEvidence rejects missing, malformed, or content-bearing payloads', () => {
  const base = {
    sessionId: 'session-1',
    generation: 1,
    systemSections: [{ sectionKey: 's', sourceTags: [] }],
    messageRanges: [{ fromSeq: 1, toSeq: 1, count: 1 }],
    dropped: [],
    observedAt: '2026-08-26T10:00:00.000Z',
  }
  assert.equal(normalizeAssembledEvidence(undefined).ok, false)
  assert.equal(normalizeAssembledEvidence({ ...base, sessionId: '' }).ok, false)
  assert.equal(normalizeAssembledEvidence({ ...base, generation: 0 }).ok, false)
  assert.equal(normalizeAssembledEvidence({ ...base, generation: '3' }).ok, false)
  assert.equal(normalizeAssembledEvidence({ ...base, systemSections: [{ sectionKey: 's', sourceTags: ['a'], text: 'leak' }] }).ok, false)
  assert.equal(normalizeAssembledEvidence({ ...base, systemSections: [{ sectionKey: '', sourceTags: [] }] }).ok, false)
  assert.equal(normalizeAssembledEvidence({ ...base, messageRanges: [{ fromSeq: 5, toSeq: 3, count: -1 }] }).ok, false)
  assert.equal(normalizeAssembledEvidence({ ...base, messageRanges: [{ fromSeq: 10, toSeq: 12, count: 4 }] }).ok, false)
  assert.equal(normalizeAssembledEvidence({ ...base, dropped: [{ ref: '', reason: 'x' }] }).ok, false)
  assert.equal(normalizeAssembledEvidence({ ...base, observedAt: 'yesterday' }).ok, false)
  // identifiers-only invariant: content/secret anywhere is rejected
  assert.equal(normalizeAssembledEvidence({ ...base, content: 'x' }).ok, false)
  assert.equal(normalizeAssembledEvidence({ ...base, secret: 'x' }).ok, false)
  assert.equal(normalizeAssembledEvidence({ ...base, systemSections: [{ sectionKey: 's', sourceTags: [], secret: { value: 1 } }] }).ok, false)
  assert.equal(normalizeAssembledEvidence({ ...base, messageRanges: [{ fromSeq: 1, toSeq: 1, count: 1, content: [1, 2] }] }).ok, false)
})

test('hasContentLikeKeys detects content/secret anywhere in nested graphs', () => {
  assert.equal(hasContentLikeKeys({ a: { b: [{ content: 1 }] } }), true)
  assert.equal(hasContentLikeKeys({ a: { secret: 's' } }), true)
  assert.equal(hasContentLikeKeys({ a: { b: 'plain' } }), false)
  assert.equal(hasContentLikeKeys([{ x: 1 }]), false)
})

test('normalizeReplacementMapping validates mapping records', () => {
  const valid = { oldNodeIds: ['n1', 'n2'], newNodeId: 'n3', reason: 'compacted', generation: 'g-1', observedAt: '2026-08-26T10:00:00.000Z' }
  assert.deepEqual(normalizeReplacementMapping(valid), { ok: true, mapping: valid })
  assert.equal(normalizeReplacementMapping({ ...valid, oldNodeIds: [] }).ok, false)
  assert.equal(normalizeReplacementMapping({ ...valid, newNodeId: '' }).ok, false)
  assert.equal(normalizeReplacementMapping({ ...valid, reason: '' }).ok, false)
  assert.equal(normalizeReplacementMapping({ ...valid, generation: 5 }).ok, false)
  assert.equal(normalizeReplacementMapping({ ...valid, observedAt: 'nope' }).ok, false)
  assert.equal(normalizeReplacementMapping(undefined).ok, false)
})

test('normalizeInspectOptions clamps pagination bounds and keeps cursors', () => {
  assert.deepEqual(normalizeInspectOptions({}), { limit: DEFAULT_INSPECT_LIMIT, cursor: undefined })
  assert.deepEqual(normalizeInspectOptions({ limit: 10, cursor: 'abc' }), { limit: 10, cursor: 'abc' })
  assert.deepEqual(normalizeInspectOptions({ limit: 9999 }), { limit: MAX_INSPECT_LIMIT, cursor: undefined })
  assert.deepEqual(normalizeInspectOptions({ limit: -1 }).limit, DEFAULT_INSPECT_LIMIT)
  assert.deepEqual(normalizeInspectOptions({ cursor: '' }).cursor, undefined)
})

test('source-kind and priority vocabularies cover the documented sets', () => {
  assert.deepEqual(CONTEXT_SOURCE_KINDS, ['systemPrompt', 'sessionSurface', 'attachment', 'toolExposure', 'skillExposure', 'memory', 'compaction', 'assembledEvidence'])
  assert.deepEqual(PRIORITIES, ['lowest', 'low', 'normal', 'high', 'highest', 'monitor'])
})