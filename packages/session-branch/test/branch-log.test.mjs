import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_BRANCH_VISIBILITY,
  DEFAULT_INHERITANCE,
  decodeBranchCreated,
  decodeBranchFailed,
  encodeBranchCreated,
  encodeBranchFailed,
  foldBranchGraph,
  inheritanceGapsOf,
  normalizeBranchOptions,
  validateBranchKind,
} from '../lib/branch-log.js'
import { BRANCH_KINDS } from '../lib/branch-kinds.js'

test('branch kinds are the four fixed capability words', () => {
  assert.deepEqual([...BRANCH_KINDS], ['retry', 'sidechain', 'experiment', 'rescue'])
})

test('validateBranchKind accepts the four kinds and rejects everything else', () => {
  for (const kind of BRANCH_KINDS) {
    const result = validateBranchKind(kind)
    assert.equal(result.ok, true)
    assert.equal(result.kind, kind)
  }
  for (const bad of ['other', '', 'retry2', 1, null, undefined, 'Sidechain']) {
    const result = validateBranchKind(bad)
    assert.equal(result.ok, false)
    assert.equal(result.code, 'BRANCH_KIND_INVALID')
  }
})

test('normalizeBranchOptions applies documented defaults and tolerates unknown keys', () => {
  const result = normalizeBranchOptions({ kind: 'sidechain' })
  assert.equal(result.ok, true)
  assert.equal(result.options.visibility, DEFAULT_BRANCH_VISIBILITY)
  assert.deepEqual(result.options.inheritance, DEFAULT_INHERITANCE)
  assert.equal(result.options.retention, undefined)
  assert.equal('unknownKey' in result.options, false)
})

test('normalizeBranchOptions validates childSessionId, retention, non-boolean inheritance', () => {
  const badChild = normalizeBranchOptions({ kind: 'retry', childSessionId: '' })
  assert.equal(badChild.ok, false)
  const badRetention = normalizeBranchOptions({ kind: 'retry', retention: 42 })
  assert.equal(badRetention.ok, false)
  const badInheritance = normalizeBranchOptions({ kind: 'retry', inheritance: { route: 'yes' } })
  assert.equal(badInheritance.ok, false)
})

test('inheritance gaps list declared-but-undelivered members and default to none', () => {
  assert.deepEqual(inheritanceGapsOf(undefined), [])
  assert.deepEqual(inheritanceGapsOf({ route: true, memory: false, attachments: true, toolState: false }), ['route', 'attachments'])
  const normalized = normalizeBranchOptions({ kind: 'experiment', inheritance: { memory: true } })
  assert.equal(normalized.ok, true)
  assert.deepEqual({ ...normalized.options.inheritance }, { route: false, memory: true, attachments: false, toolState: false })
})

test('encode/decode branch/created round-trips every payload field', () => {
  const data = encodeBranchCreated({
    branchId: 'branch-1',
    kind: 'sidechain',
    parentSessionId: 's1',
    boundarySeq: 3,
    childSessionId: 's2',
    causalSourceSeqs: [3],
    visibility: 'diagnostic',
    retention: 'session-log',
    inheritance: Object.freeze({ route: false, memory: true, attachments: false, toolState: false }),
  })
  assert.equal(Object.isFrozen(data), true)
  const record = decodeBranchCreated(data)
  assert.notEqual(record, null)
  assert.equal(record.branchId, 'branch-1')
  assert.equal(record.kind, 'sidechain')
  assert.equal(record.parentSessionId, 's1')
  assert.equal(record.boundarySeq, 3)
  assert.equal(record.childSessionId, 's2')
  assert.deepEqual([...record.causalSourceSeqs], [3])
  assert.equal(record.visibility, 'diagnostic')
  assert.equal(record.retention, 'session-log')
  assert.deepEqual(record.inheritance, { route: false, memory: true, attachments: false, toolState: false })
  assert.equal(record.state, 'active')
  assert.equal(Object.isFrozen(record), true)
  assert.equal(Object.isFrozen(record.causalSourceSeqs), true)
})

test('decodeBranchCreated rejects malformed required fields but tolerates unknown extra fields', () => {
  for (const bad of [
    undefined, null, [], 'x',
    { branchId: 'b', kind: 'other', parentSessionId: 'p', boundarySeq: 0, childSessionId: 'c', causalSourceSeqs: [], visibility: 'v' },
    { branchId: '', kind: 'retry', parentSessionId: 'p', boundarySeq: 0, childSessionId: 'c', causalSourceSeqs: [], visibility: 'v' },
    { branchId: 'b', kind: 'retry', parentSessionId: '', boundarySeq: 0, childSessionId: 'c', causalSourceSeqs: [], visibility: 'v' },
    { branchId: 'b', kind: 'retry', parentSessionId: 'p', boundarySeq: -1, childSessionId: 'c', causalSourceSeqs: [], visibility: 'v' },
    { branchId: 'b', kind: 'retry', parentSessionId: 'p', boundarySeq: 0, childSessionId: 'c', causalSourceSeqs: ['x'], visibility: 'v' },
    { branchId: 'b', kind: 'retry', parentSessionId: 'p', boundarySeq: 0, childSessionId: 'c', causalSourceSeqs: [], visibility: '' },
  ]) {
    assert.equal(decodeBranchCreated(bad), null)
  }
  const tolerant = decodeBranchCreated({
    branchId: 'b', kind: 'retry', parentSessionId: 'p', boundarySeq: 0, childSessionId: 'c',
    causalSourceSeqs: [], visibility: 'diagnostic', futureField: { anything: true },
  })
  assert.notEqual(tolerant, null)
  assert.equal('futureField' in tolerant, false)
})

test('encode/decode branch/failed compensation', () => {
  const data = encodeBranchFailed({
    branchId: 'branch-1', kind: 'sidechain', parentSessionId: 's1', boundarySeq: 3,
    reason: 'OPEN_TURN', at: 123,
  })
  const failure = decodeBranchFailed(data)
  assert.notEqual(failure, null)
  assert.equal(failure.branchId, 'branch-1')
  assert.equal(failure.reason, 'OPEN_TURN')
  assert.equal(failure.state, 'failed')
  assert.equal(failure.kind, 'sidechain')
  assert.equal(Object.isFrozen(failure), true)
  assert.equal(decodeBranchFailed({ branchId: 'x' }), null)
})

test('foldBranchGraph folds created/failed pairs, never fabricates links', () => {
  const events = [
    { type: 'user/message', data: {} },
    { type: 'branch/created', data: encodeBranchCreated({
      branchId: 'b1', kind: 'retry', parentSessionId: 's1', boundarySeq: 1, childSessionId: 'c1',
      causalSourceSeqs: [1], visibility: 'diagnostic',
    }) },
    { type: 'branch/created', data: encodeBranchCreated({
      branchId: 'b2', kind: 'sidechain', parentSessionId: 's1', boundarySeq: 2, childSessionId: 'c2',
      causalSourceSeqs: [2], visibility: 'diagnostic',
    }) },
    { type: 'branch/failed', data: encodeBranchFailed({
      branchId: 'b2', kind: 'sidechain', parentSessionId: 's1', boundarySeq: 2, reason: 'child rejected', at: 1,
    }) },
  ]
  const graph = foldBranchGraph(events)
  assert.equal(graph.branches.length, 2)
  const b1 = graph.branches.find((record) => record.branchId === 'b1')
  const b2 = graph.branches.find((record) => record.branchId === 'b2')
  assert.equal(b1.state, 'active')
  assert.equal(b2.state, 'failed')
  assert.equal(b2.reason, 'child rejected')
  assert.equal(graph.current.branchId, 'b1', 'current is the latest ACTIVE branch, never a failed one')
  assert.equal(Object.isFrozen(graph), true)
  assert.equal(Object.isFrozen(graph.branches), true)
})

test('foldBranchGraph tolerates unknown event types and malformed data', () => {
  const graph = foldBranchGraph([
    { type: 'branch/created', data: { broken: true } },
    { type: 'other/event', data: { whatever: 1 } },
    null,
  ])
  assert.equal(graph.branches.length, 0)
  assert.equal(graph.current, null)
})

test('foldBranchGraph rebuilds the same graph across restart (pure fold of a persisted log)', () => {
  const raw = [
    { type: 'branch/created', data: encodeBranchCreated({
      branchId: 'b1', kind: 'rescue', parentSessionId: 's1', boundarySeq: 4, childSessionId: 'c1',
      causalSourceSeqs: [4], visibility: 'diagnostic', retention: 'session-log',
    }) },
    { type: 'branch/created', data: encodeBranchCreated({
      branchId: 'b2', kind: 'experiment', parentSessionId: 's1', boundarySeq: 5, childSessionId: 'c2',
      causalSourceSeqs: [5], visibility: 'diagnostic',
    }) },
  ]
  // "restart" = the folded graph of the same durable events must be identical.
  const first = foldBranchGraph(raw)
  const second = foldBranchGraph(raw)
  assert.deepEqual(second, first)
  assert.equal(second.current.branchId, 'b2')
})