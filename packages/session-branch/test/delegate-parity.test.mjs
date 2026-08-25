import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore, SessionForkError, Session, packChunkRuns, decodeStorageRecord } from '@deepseek-ai/dsh-session'
import { buildSessionDelegate, createOfficialSessionStore, SESSION_BRANCH_MARKER } from '../lib/delegate.js'

/**
 * Replication consistency suite: the thin delegate must be indistinguishable
 * from the official store at the contract level (member behavior, event
 * shapes and ordering, fork typed rejections, veto rollback, flush semantics)
 * and must add only the branch surface and the contract marker.
 */

function makePair() {
  // Official side: the store registers ctx.sessions on its own.
  const officialCtx = new Context()
  const officialStore = createOfficialSessionStore(officialCtx)
  // Delegate side: same store construction, then the value swap performed by
  // the loader replacement.
  const delegateCtx = new Context()
  const store = createOfficialSessionStore(delegateCtx)
  const delegate = buildSessionDelegate({ ctx: delegateCtx, official: store, logger: delegateCtx.logger })
  delegateCtx.set('sessions', delegate)
  return { officialCtx, officialStore, delegateCtx, store, delegate }
}

function collectEvents(ctx) {
  const seen = []
  ctx.on('session/created', (session) => seen.push(['created', session.id]))
  ctx.on('session/disposed', (session) => seen.push(['disposed', session.id]))
  ctx.on('session/event', (session, event) => seen.push(['event', session.id, event.type, event.seq]))
  return seen
}

test('delegate exposes the official eight members plus branches and the contract marker', () => {
  const { delegate, officialStore } = makePair()
  for (const member of ['create', 'prepare', 'enter', 'announce', 'flush', 'get', 'list', 'fork']) {
    assert.equal(typeof delegate[member], 'function', `delegate.${member} must be a function`)
  }
  assert.equal(typeof delegate.branches, 'object')
  for (const member of ['create', 'graph', 'plan', 'preview', 'commit', 'rollback', 'restore', 'availability']) {
    assert.equal(typeof delegate.branches[member], 'function', `delegate.branches.${member} must be a function`)
  }
  assert.equal(delegate[SESSION_BRANCH_MARKER], true)
  assert.equal(officialStore[SESSION_BRANCH_MARKER], undefined)
})

test('create returns live sessions identically; get/list share identity and creation order', () => {
  const { officialCtx, delegateCtx } = makePair()
  const byOfficial = officialCtx.get('sessions')
  const byDelegate = delegateCtx.get('sessions')
  for (const [label, sessions] of [['official', byOfficial], ['delegate', byDelegate]]) {
    const a = sessions.create('one')
    const b = sessions.create('two')
    assert.equal(sessions.get('one'), a, `${label}: get returns the exact live instance`)
    assert.deepEqual(sessions.list().map((session) => session.id), ['one', 'two'], `${label}: list preserves creation order`)
    const detached = sessions.prepare('detached')
    assert.equal(sessions.get('detached'), undefined, `${label}: prepared session is not live`)
  }
})

test('event shapes and ordering match the official store exactly', async () => {
  const { officialCtx, delegateCtx } = makePair()
  const officialSeen = collectEvents(officialCtx)
  const delegateSeen = collectEvents(delegateCtx)

  const officialSessions = officialCtx.get('sessions')
  const delegateSessions = delegateCtx.get('sessions')
  const o = officialSessions.create('s1')
  const d = delegateSessions.create('s1')
  o.append('user/message', { id: 'm1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] }, { surfaceOp: 'append' })
  d.append('user/message', { id: 'm1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] }, { surfaceOp: 'append' })

  assert.deepEqual(delegateSeen, officialSeen, 'event stream (created/event) must be identical')
  // flush semantics: participation count equality on a subscriber-backed ctx
  const officialFlushCtx = new Context()
  const delegateFlushCtx = new Context()
  let officialParticipated = 0
  let delegateParticipated = 0
  officialFlushCtx.on('session/flush', () => { officialParticipated += 1 })
  delegateFlushCtx.on('session/flush', () => { delegateParticipated += 1 })
  const officialFlushStore = new SessionStore(officialFlushCtx)
  const delegateStore = new SessionStore(delegateFlushCtx)
  const delegateFlush = buildSessionDelegate({ ctx: delegateFlushCtx, official: delegateStore, logger: delegateFlushCtx.logger })
  delegateFlushCtx.set('sessions', delegateFlush)
  const sOfficial = officialFlushStore.create('f1')
  const sDelegate = delegateStore.create('f1')
  const participatedOfficial = await officialFlushStore.flush(sOfficial)
  const participatedDelegate = await delegateFlush.flush(sDelegate)
  assert.equal(participatedDelegate, participatedOfficial)
  assert.equal(participatedOfficial, true)
  assert.equal(officialParticipated, 1)
  assert.equal(delegateParticipated, 1)
})

test('fork typed rejection codes (the five) are preserved verbatim through the delegate', () => {
  const { delegateCtx, officialCtx } = makePair()
  const sessions = delegateCtx.get('sessions')
  const official = officialCtx.get('sessions')
  const parent = sessions.create('p1')
  const expectations = [
    ['SESSION_NOT_FOUND', () => sessions.fork('ghost')],
    ['SESSION_NOT_LIVE', () => {
      // the id resolves to a live instance, but this object is not it
      return sessions.fork({ id: 'p1', marker: 'not-the-live-instance' })
    }],
    ['SESSION_ALREADY_EXISTS', () => sessions.fork('p1', 0, 'p1')],
    ['INVALID_BOUNDARY', () => sessions.fork('p1', 42)],
    ['OPEN_TURN', () => {
      parent.append('turn/start', { turn: 't1' })
      return sessions.fork('p1', parent.seq - 1)
    }],
  ]
  for (const [code, invoke] of expectations) {
    assert.throws(invoke, (error) => {
      assert.ok(error instanceof SessionForkError, `expected SessionForkError for ${code}`)
      assert.equal(error.code, code)
      return true
    })
  }
  // the official store rejects identically (structure guarantee)
  const officialParent = official.create('op1')
  assert.throws(() => official.fork('op1', 42), (error) => error.code === 'INVALID_BOUNDARY')
})

test('session/created veto rolls back via the delegate exactly as officially', () => {
  const { delegateCtx } = makePair()
  const disposals = []
  delegateCtx.on('session/created', () => { throw new Error('creation vetoed') })
  delegateCtx.on('session/disposed', (session) => disposals.push(session.id))
  const sessions = delegateCtx.get('sessions')
  assert.throws(() => sessions.create('veto-1'), /creation vetoed/)
  assert.equal(sessions.get('veto-1'), undefined, 'vetoed session must not remain live')
  assert.deepEqual(disposals, ['veto-1'], 'paired disposal must be emitted after the veto')
})

test('custom branch/created metadata event round-trips through the official storage path', () => {
  const { delegateCtx } = makePair()
  const sessions = delegateCtx.get('sessions')
  const session = sessions.create('rt-s')
  const data = {
    branchId: 'startup-branch', kind: 'rescue', parentSessionId: 'rt-s', boundarySeq: 0,
    childSessionId: 'rt-child', causalSourceSeqs: [0], visibility: 'diagnostic', state: 'active',
  }
  session.append('branch/created', data)
  const branch = session.events.at(-1)
  assert.equal(branch.type, 'branch/created')
  assert.deepEqual(branch.data, data)
  const rows = packChunkRuns(session.events)
  const decoded = decodeStorageRecord(rows).flat()
  const restored = Session.fromRestore('rt-s', decoded, session.header)
  const back = restored.events.find((event) => event.type === 'branch/created')
  assert.deepEqual(back?.data, data, 'branch record must survive the official storage path byte-for-byte')
  assert.equal(restored.deriveMessages().length, 0, 'metadata events never enter the derived history')
})