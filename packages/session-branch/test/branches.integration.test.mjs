import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { packChunkRuns, decodeStorageRecord, Session } from '@deepseek-ai/dsh-session'
import { buildSessionDelegate, createOfficialSessionStore } from '../lib/delegate.js'
import { SessionBranchError } from '../lib/errors.js'

/**
 * Branch/edit engine integration over the REAL official store through the
 * delegate: branch create -> child lineage, graph folding across a simulated
 * restart, commit collapse (N->1, atomic single append), content-level
 * rollback with idempotency, external-pending bookkeeping, and restore
 * verification (no auto-retry).
 */

function makeCtx() {
  const ctx = new Context()
  const official = createOfficialSessionStore(ctx)
  const delegate = buildSessionDelegate({ ctx, official, logger: ctx.logger })
  ctx.set('sessions', delegate)
  return { ctx, official, delegate }
}

function appendMessage(session, text) {
  return session.append('user/message', {
    id: `m-${session.seq}-${text}`, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }],
  }, { surfaceOp: 'append' })
}

test('branches.create appends a branch record and forks a live child with official lineage', () => {
  const { delegate } = makeCtx()
  const sessions = delegate
  const parent = sessions.create('p-branch')
  appendMessage(parent, 'hello')
  const result = delegate.branches.create(parent, parent.seq - 1, { kind: 'sidechain' })
  assert.equal(result.branch.kind, 'sidechain')
  assert.equal(result.branch.parentSessionId, 'p-branch')
  assert.equal(result.branch.boundarySeq, 0)
  assert.equal(result.branch.childSessionId, result.child.id)
  assert.equal(result.child, sessions.get(result.child.id))
  assert.equal(result.child.header.parentSession, 'p-branch', 'official header carries the lineage')
  assert.equal(result.child.header.seedLength, 1)
  // parent untouched: event count grew only by the branch record
  assert.equal(parent.events.length, 2)
  assert.equal(parent.events.at(-1).type, 'branch/created')
  assert.equal(parent.events.at(-1).data.branchId, result.branch.branchId)
  // graph projection from the parent log, frozen
  const graph = delegate.branches.graph('p-branch')
  assert.equal(graph.branches.length, 1)
  assert.equal(graph.current.branchId, result.branch.branchId)
  assert.deepEqual([...graph.children], [result.child.id])
  assert.deepEqual([...graph.ancestors], [])
  assert.equal(Object.isFrozen(graph), true)
})

test('branches.create rejects unknown kind, unknown source, bad boundary; compensates fork failure', () => {
  const { delegate } = makeCtx()
  const parent = delegate.create('p-fail')
  assert.throws(() => delegate.branches.create(parent, 0, { kind: 'wizard' }), (error) => error.code === 'BRANCH_KIND_INVALID')
  assert.throws(() => delegate.branches.create('ghost', 0, { kind: 'retry' }), (error) => error.code === 'BRANCH_SOURCE_UNKNOWN')
  assert.throws(() => delegate.branches.create(parent, 99, { kind: 'retry' }), (error) => error instanceof SessionBranchError)
  // open-turn boundary propagates the OFFICIAL typed code and leaves a compensation record
  parent.append('turn/start', { turn: 't' })
  assert.throws(() => delegate.branches.create(parent, parent.seq - 1, { kind: 'retry' }), (error) => error.code === 'OPEN_TURN')
  assert.equal(parent.events.at(-1).type, 'branch/failed', 'failed fork must leave a visible compensation record')
})

test('inheritance declaration is recorded; declared members degrade the child with gaps, never fabricated', () => {
  const { delegate } = makeCtx()
  const parent = delegate.create('p-inherit')
  appendMessage(parent, 'hi')
  const result = delegate.branches.create(parent, parent.seq - 1, { kind: 'sidechain', inheritance: { memory: true } })
  assert.deepEqual(result.branch.inheritance, { route: false, memory: true, attachments: false, toolState: false })
  assert.deepEqual(result.branch.gaps, { memory: true })
  // default: nothing declared -> documented minimal default, no gaps
  const plain = delegate.branches.create(parent, parent.seq - 1, { kind: 'rescue' })
  assert.deepEqual(plain.branch.inheritance, { route: false, memory: false, attachments: false, toolState: false })
  assert.equal(plain.branch.gaps, undefined)
})

test('edit plan: CAS create, preview, atomic commit collapse, terminal success', () => {
  const { delegate } = makeCtx()
  const session = delegate.create('p-edit')
  appendMessage(session, 'one')
  appendMessage(session, 'two')
  const plan = delegate.branches.plan(session, {
    kind: 'user',
    range: { fromSeq: 0, toSeq: 1 },
    replacement: { content: [{ type: 'text', text: 'collapsed' }] },
    expectedVersion: session.seq,
  })
  assert.equal(plan.state, 'draft')

  const preview = delegate.branches.preview(plan)
  assert.deepEqual([...preview.shadowedSeqs], [0, 1])
  assert.equal(Object.isFrozen(preview), true)

  const before = session.deriveMessages().map((message) => message.content?.[0]?.text)
  const committed = delegate.branches.commit(plan, { actor: 'tester' })
  assert.equal(committed.outcome, 'committed')
  const after = session.deriveMessages().map((message) => message.content?.[0]?.text)
  assert.deepEqual(before, ['one', 'two'])
  assert.deepEqual(after, ['collapsed'], 'commit must collapse the range on the derived surface')
  assert.deepEqual([...session.surface.nodes], [committed.seq])
  assert.equal(Object.isFrozen(committed), true)

  // a committed plan is terminal: late commit is a typed no-op rejection
  assert.throws(() => delegate.branches.commit(plan), (error) => error.code === 'EDIT_PLAN_TERMINAL')
})

test('edit plan: version drift at plan-time and commit-time is a typed conflict, state untouched', () => {
  const { delegate } = makeCtx()
  const session = delegate.create('p-cas')
  appendMessage(session, 'one')
  assert.throws(() => delegate.branches.plan(session, {
    kind: 'goal', range: { fromSeq: 0, toSeq: 0 },
    replacement: { content: [{ type: 'text', text: 'x' }] },
    expectedVersion: session.seq + 5,
  }), (error) => error.code === 'EDIT_VERSION_CONFLICT')
  const plan = delegate.branches.plan(session, {
    kind: 'goal', range: { fromSeq: 0, toSeq: 0 },
    replacement: { content: [{ type: 'text', text: 'x' }] },
  })
  appendMessage(session, 'drift') // drift the version after planning
  assert.throws(() => delegate.branches.commit(plan), (error) => error.code === 'EDIT_VERSION_CONFLICT')
  assert.deepEqual(session.deriveMessages().map((message) => message.content?.[0]?.text), ['one', 'drift'])
})

test('edit kind: caller-provided, defaulted to caller plugin id; invalid rejected', () => {
  const { delegate } = makeCtx()
  const session = delegate.create('p-kind')
  appendMessage(session, 'one')
  const plan = delegate.branches.plan(session, {
    kind: 'test-suite', range: { fromSeq: 0, toSeq: 0 },
    replacement: { content: [{ type: 'text', text: 'x' }] },
  })
  assert.throws(() => delegate.branches.plan(session, {
    kind: '', range: { fromSeq: 0, toSeq: 0 },
    replacement: { content: [{ type: 'text', text: 'y' }] },
  }), (error) => error.code === 'EDIT_KIND_INVALID')
  const committed = delegate.branches.commit(plan)
  const commitEvent = session.events.find((event) => event.data?.edit?.commitId === committed.commitId)
  assert.equal(commitEvent.data.edit.kind, 'test-suite')
})

test('rollback restores readable content (content-level), is idempotent, and reports external-pending', () => {
  const { delegate } = makeCtx()
  const session = delegate.create('p-rb')
  appendMessage(session, 'orig-0')
  appendMessage(session, 'orig-1')
  const plan = delegate.branches.plan(session, {
    kind: 'user',
    range: { fromSeq: 0, toSeq: 1 },
    replacement: { content: [{ type: 'text', text: 'collapsed' }] },
    externals: [{ id: 'runner', sideEffectClass: 'external', description: 'background job' }],
  })
  const committed = delegate.branches.commit(plan)

  const reverted = delegate.branches.rollback(committed.commitId, { actor: 'tester' })
  assert.equal(reverted.outcome, 'reverted')
  assert.deepEqual([...reverted.externalPending], [{ id: 'runner', sideEffectClass: 'external' }])
  const derived = session.deriveMessages().map((message) => message.content.map((block) => block.text).join('|'))
  assert.equal(derived.length, 1, 'content-level restore lands a single restore node')
  assert.match(derived[0], /orig-0/)
  assert.match(derived[0], /orig-1/)
  assert.match(derived[0], /\[2\/2\]/)

  // idempotent: second rollback is a typed no-op, nothing else changes
  const again = delegate.branches.rollback(committed.commitId)
  assert.equal(again.outcome, 'no-op')
  assert.equal(again.commitId, committed.commitId)
})

test('commit/revert round-trips through official storage; restart graph rebuilds from the log', async () => {
  const { delegate } = makeCtx()
  const session = delegate.create('p-rt')
  appendMessage(session, 'a')
  appendMessage(session, 'b')
  const plan = delegate.branches.plan(session, {
    kind: 'goal', range: { fromSeq: 0, toSeq: 1 },
    replacement: { content: [{ type: 'text', text: 'summary' }] },
  })
  delegate.branches.commit(plan)
  const branch = delegate.branches.create(session, session.seq - 1, { kind: 'retry' })

  const rows = packChunkRuns(session.events)
  const decoded = decodeStorageRecord(rows).flat()
  const restored = Session.fromRestore(session.id, decoded, session.header)
  assert.equal(restored.surface.nodes.length, 1, 'restored surface keeps the collapsed node')
  // branch graph rebuilds purely from the durable log (no sidecar)
  const { foldBranchGraph } = await import('../lib/branch-log.js')
  const folded = foldBranchGraph(restored.events)
  assert.equal(folded.branches.length, 1)
  assert.ok(folded.branches[0].branchId.length > 0)
  assert.equal(folded.branches[0].kind, 'retry')
})

test('rollback never reverts newer legitimate commits (shadowed commit -> typed no-op)', () => {
  const { delegate } = makeCtx()
  const session = delegate.create('p-shadow')
  appendMessage(session, 'base')
  const first = delegate.branches.plan(session, {
    kind: 'user', range: { fromSeq: 0, toSeq: 0 },
    replacement: { content: [{ type: 'text', text: 'first' }] },
  })
  const c1 = delegate.branches.commit(first)
  const second = delegate.branches.plan(session, {
    kind: 'user', range: { fromSeq: c1.seq, toSeq: c1.seq },
    replacement: { content: [{ type: 'text', text: 'second' }] },
  })
  delegate.branches.commit(second)
  const result = delegate.branches.rollback(c1.commitId)
  assert.equal(result.outcome, 'no-op', 'older shadowed commit must not be reverted through a newer one')
})

test('restore verifies integrity and acknowledgment before appending; failures flag recovery pending', () => {
  const { delegate } = makeCtx()
  const session = delegate.create('p-restore')
  appendMessage(session, 'one')
  const plan = delegate.branches.plan(session, {
    kind: 'user', range: { fromSeq: 0, toSeq: 0 },
    replacement: { content: [{ type: 'text', text: 'edited' }] },
    externals: [{ id: 'fs-write', sideEffectClass: 'external' }],
  })
  const committed = delegate.branches.commit(plan)

  // missing acknowledgment -> typed error + recovery pending, no append
  assert.throws(() => delegate.branches.restore(committed.commitId, {}), (error) => error.code === 'EDIT_EXTERNAL_PENDING')
  assert.deepEqual([...delegate.branches.availability().recoveryPending], ['p-restore'])

  // unknown commit -> typed error
  assert.throws(() => delegate.branches.restore('commit-ghost', { acknowledgments: [] }), (error) => error.code === 'EDIT_COMMIT_UNKNOWN')

  // verified + acknowledged -> restore lands and re-applies the state
  const restored = delegate.branches.restore(committed.commitId, { acknowledgments: ['fs-write'], actor: 'tester' })
  assert.equal(restored.outcome, 'restored')
  const derived = session.deriveMessages().map((message) => message.content?.[0]?.text)
  assert.deepEqual(derived, ['edited'])
})

test('availability reports active contract and bounded recovery pending', () => {
  const { delegate } = makeCtx()
  const availability = delegate.branches.availability()
  assert.equal(availability.active, true)
  assert.equal(availability.contract, true)
  assert.deepEqual([...availability.recoveryPending], [])
  assert.equal(Object.isFrozen(availability), true)
})