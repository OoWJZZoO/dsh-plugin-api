import test from 'node:test'
import assert from 'node:assert/strict'
import { Session, packChunkRuns, decodeStorageRecord } from '@deepseek-ai/dsh-session'
import {
  PLAN_TERMINAL_STATES,
  buildCommitEventData,
  buildRestoreEventData,
  buildRevertEventData,
  decideTerminalOutcome,
  findCommitEvent,
  getPlan,
  hasRevertMark,
  pendingExternalRefs,
  previewFromSurface,
  registerPlan,
  settlePlan,
  synthesizeRestoreContent,
  validateEditKind,
  verifyRestoreChain,
} from '../lib/edit-plan.js'

function makePlanInput(overrides = {}) {
  return {
    planId: 'plan-1',
    targetSessionId: 's1',
    expectedVersion: 3,
    range: { fromSeq: 1, toSeq: 2 },
    kind: 'user',
    replacement: { role: 'user', content: [{ type: 'text', text: 'rewritten' }] },
    externals: [{ id: 'git-push', sideEffectClass: 'external', description: 'pushed branch' }],
    generation: 'session-branch:gen-1',
    ...overrides,
  }
}

test('terminal vocabulary is final and non-terminal is only draft', () => {
  assert.deepEqual([...PLAN_TERMINAL_STATES], ['success', 'error', 'aborted', 'denied', 'superseded'])
})

test('decideTerminalOutcome honors aborted > superseded > error, timeout as error', () => {
  assert.equal(decideTerminalOutcome({ aborted: true, superseded: true, error: true }), 'aborted')
  assert.equal(decideTerminalOutcome({ superseded: true, error: true }), 'superseded')
  assert.equal(decideTerminalOutcome({ error: true }), 'error')
  assert.equal(decideTerminalOutcome({ timeout: true }), 'error')
  assert.equal(decideTerminalOutcome({}), 'success')
})

test('validateEditKind requires a bounded non-empty string and falls back to caller default', () => {
  assert.equal(validateEditKind('goal').ok, true)
  assert.equal(validateEditKind('deepseek/plugin-x').ok, true)
  const fallback = validateEditKind(undefined, 'plugin-x')
  assert.equal(fallback.ok, true)
  assert.equal(fallback.kind, 'plugin-x')
  for (const bad of ['', 'x'.repeat(65), 1, null, []]) {
    const result = validateEditKind(bad)
    assert.equal(result.ok, false)
    assert.equal(result.code, 'EDIT_KIND_INVALID')
  }
  const missing = validateEditKind(undefined)
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'EDIT_KIND_INVALID')
})

test('registerPlan validates shape, kind, range, replacement, externals vocabulary', () => {
  const registry = new Map()
  const ok = registerPlan(registry, makePlanInput())
  assert.equal(ok.ok, true)
  assert.equal(ok.plan.state, 'draft')
  assert.equal(ok.plan.externals[0].sideEffectClass, 'external')
  assert.equal(Object.isFrozen(ok.plan), true)
  assert.equal(Object.isFrozen(ok.plan.externals), true)

  const dup = registerPlan(registry, makePlanInput())
  assert.equal(dup.ok, false)
  assert.equal(dup.code, 'EDIT_PLAN_CONFLICT')

  const badRange = registerPlan(registry, makePlanInput({ planId: 'plan-2', range: { fromSeq: 5, toSeq: 2 } }))
  assert.equal(badRange.code, 'EDIT_RANGE_INVALID')

  const badKind = registerPlan(registry, makePlanInput({ planId: 'plan-3', kind: '' }))
  assert.equal(badKind.code, 'EDIT_KIND_INVALID')

  const badExternalClass = registerPlan(registry, makePlanInput({
    planId: 'plan-4',
    externals: [{ id: 'x', sideEffectClass: 'wizardry' }],
  }))
  assert.equal(badExternalClass.code, 'EDIT_EXTERNAL_INVALID')

  const badReplacement = registerPlan(registry, makePlanInput({ planId: 'plan-5', replacement: { content: [] } }))
  assert.equal(badReplacement.code, 'EDIT_REPLACEMENT_INVALID')
})

test('settlePlan is final and unique; late submissions lose qualification', () => {
  const registry = new Map()
  registerPlan(registry, makePlanInput())
  const first = settlePlan(registry, 'plan-1', 'success')
  assert.equal(first.changed, true)
  assert.equal(first.plan.state, 'success')
  const late = settlePlan(registry, 'plan-1', 'error')
  assert.equal(late.changed, false)
  assert.equal(late.plan.state, 'success', 'terminal plan is never rewritten')
  const unknown = settlePlan(registry, 'plan-zzz', 'success')
  assert.equal(unknown.ok, false)
})

test('previewFromSurface computes affected range and resulting shape without mutating', () => {
  const result = previewFromSurface([0, 1, 2, 3], { fromSeq: 1, toSeq: 2 }, { role: 'user', content: [] })
  assert.equal(result.ok, true)
  assert.deepEqual([...result.preview.shadowedSeqs], [1, 2])
  assert.deepEqual([...result.preview.resultingNodes], [0, '<replacement>', 3])
  assert.equal(Object.isFrozen(result.preview), true)
  const missing = previewFromSurface([0, 1, 2], { fromSeq: 1, toSeq: 9 }, {})
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'EDIT_RANGE_INVALID')
  const swapped = previewFromSurface([0, 1, 2], { fromSeq: 2, toSeq: 1 }, {})
  assert.equal(swapped.ok, false)
})

test('buildCommitEventData embeds the caller kind and full audit block', () => {
  const registry = new Map()
  registerPlan(registry, makePlanInput({ kind: 'goal' }))
  const plan = getPlan(registry, 'plan-1')
  const data = buildCommitEventData({ plan, commitId: 'commit-1', actor: 'tester', at: 123 })
  assert.equal(data.role, 'user')
  assert.equal(data.edit.op, 'commit')
  assert.equal(data.edit.kind, 'goal')
  assert.equal(data.edit.planId, 'plan-1')
  assert.equal(data.edit.commitId, 'commit-1')
  assert.deepEqual(data.edit.range, { fromSeq: 1, toSeq: 2 })
  assert.equal(data.edit.generation, 'session-branch:gen-1')
  assert.equal(data.edit.actor, 'tester')
  assert.equal(data.edit.at, 123)
  assert.equal(data.edit.externals[0].sideEffectClass, 'external')
  assert.equal(Object.isFrozen(data), true)
  assert.equal(Object.isFrozen(data.edit), true)
})

test('synthesizeRestoreContent annotates roles and boundaries truthfully', () => {
  const content = synthesizeRestoreContent([
    { role: 'user', content: [{ type: 'text', text: 'first question' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'an answer' }, { type: 'text', text: 'more' }] },
  ])
  assert.equal(content.length, 2)
  assert.equal(content[0].text, '[1/2][user] first question')
  assert.equal(content[1].text, '[2/2][assistant] an answer\nmore')
  assert.equal(Object.isFrozen(content), true)
  const empty = synthesizeRestoreContent([])
  assert.deepEqual(empty, [])
})

test('buildRevertEventData marks the revert idempotently with pending externals', () => {
  const data = buildRevertEventData({
    kind: 'user', commitId: 'commit-1', revertId: 'revert-1', at: 5, actor: 'tester',
    externals: [{ id: 'push', sideEffectClass: 'external' }],
    restoredContent: [{ type: 'text', text: '[1/1][user] back' }],
  })
  assert.equal(data.edit.op, 'revert')
  assert.equal(data.edit.commitId, 'commit-1')
  assert.equal(data.edit.revertId, 'revert-1')
  assert.deepEqual(data.edit.externals, [{ id: 'push', sideEffectClass: 'external' }])
})

test('findCommitEvent / hasRevertMark / verifyRestoreChain scan committed events only', () => {
  const events = [
    { type: 'user/message', seq: 0, data: { message: 'plain', edit: undefined }, sourceEventSeqs: [] },
    { type: 'user/message', seq: 1, data: { edit: { op: 'commit', commitId: 'c1', range: { fromSeq: 0, toSeq: 0 } } }, sourceEventSeqs: [0] },
    { type: 'user/message', seq: 2, data: { edit: { op: 'revert', commitId: 'c1', revertId: 'r1' } }, sourceEventSeqs: [1] },
  ]
  const commit = findCommitEvent(events, 'c1')
  assert.notEqual(commit, null)
  assert.equal(commit.seq, 1)
  assert.equal(findCommitEvent(events, 'c2'), null)
  assert.equal(hasRevertMark(events, 'c1'), true)
  assert.equal(hasRevertMark(events, 'c2'), false)
  const verified = verifyRestoreChain(events, ['c1'])
  assert.equal(verified.ok, false, 'reverted commit must not verify for restore')
  assert.equal(verified.code, 'EDIT_RESTORE_INVALID')
  const chain = verifyRestoreChain([
    { type: 'user/message', seq: 0, data: { edit: { op: 'commit', commitId: 'a' } } },
    { type: 'user/message', seq: 1, data: { edit: { op: 'commit', commitId: 'b' } } },
  ], ['a', 'b'])
  assert.equal(chain.ok, true)
  assert.deepEqual(chain.commits.map((event) => event.seq), [0, 1])
  const outOfOrder = verifyRestoreChain(chain.commits, ['b', 'a'])
  assert.equal(outOfOrder.ok, false)
})

test('pendingExternalRefs skips none/read-only/rollbackable and deduplicates', () => {
  const pending = pendingExternalRefs([
    { data: { edit: { externals: [
      { id: 'a', sideEffectClass: 'none' },
      { id: 'b', sideEffectClass: 'read-only' },
      { id: 'c', sideEffectClass: 'rollbackable' },
      { id: 'd', sideEffectClass: 'external' },
      { id: 'e', sideEffectClass: 'unknown' },
      { id: 'd', sideEffectClass: 'external' },
    ] } } },
  ])
  assert.deepEqual([...pending], [
    { id: 'd', sideEffectClass: 'external' },
    { id: 'e', sideEffectClass: 'unknown' },
  ])
  assert.equal(Object.isFrozen(pending), true)
})

test('buildRestoreEventData re-applies the historical message with a restore marker', () => {
  const data = buildRestoreEventData({
    kind: 'goal', commitId: 'c1', restoreId: 'restore-1', at: 9, actor: 't',
    message: { id: 'message-c1', role: 'user', source: { kind: 'plugin', plugin: 'x' }, content: [{ type: 'text', text: 'state' }], edit: { op: 'commit', commitId: 'c1' } },
  })
  assert.equal(data.edit.op, 'restore')
  assert.equal(data.edit.commitId, 'c1')
  assert.equal(data.id, 'message-c1')
  assert.equal(data.edit.kind, 'goal')
  assert.equal(data.role, 'user')
})

test('commit event data round-trips through official storage with the edit block intact', () => {
  const registry = new Map()
  registerPlan(registry, makePlanInput({ kind: 'plugin-x' }))
  const plan = getPlan(registry, 'plan-1')
  const data = buildCommitEventData({ plan, commitId: 'commit-rt', actor: 't', at: 42 })
  const session = Session.create('rt')
  session.append('user/message', { id: 'm0', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'orig' }] }, { surfaceOp: 'append' })
  const event = session.append('user/message', data, { surfaceOp: { op: 'replace', start: 0, end: 0 }, sourceEventSeqs: [0] })
  const rows = packChunkRuns(session.events)
  const decoded = decodeStorageRecord(rows).flat()
  const restored = Session.fromRestore('rt', decoded, session.header)
  const back = restored.events.find((candidate) => candidate.data?.edit?.commitId === 'commit-rt')
  assert.notEqual(back, undefined)
  assert.equal(back.data.edit.kind, 'plugin-x')
  assert.equal(back.data.edit.op, 'commit')
  assert.equal(back.data.message, undefined)
  assert.equal(back.data.content[0].text, 'rewritten')
  // derived messages reflect only the message content, never the edit block
  const derived = restored.deriveMessages()
  assert.deepEqual(derived.map((message) => message.content?.[0]?.text), ['rewritten'])
})