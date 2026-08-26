import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { createSessionBranchApply } from '../lib/apply.js'
import { SESSION_BRANCH_MARKER } from '../lib/delegate.js'

const VERSIONS = {
  '@deepseek-ai/dsh': '0.1.0-rc.6',
  '@deepseek-ai/dsh-llm': '0.1.0-rc.6',
  '@deepseek-ai/dsh-session': '0.1.0-rc.6',
  '@deepseek-ai/dsh-plugin-api-session-branch': '0.1.0-rc.6-0.7',
  '@deepseek-ai/dsh-plugin-api-main': '0.1.0-rc.6-0.7',
}

function goodEnv() {
  return {
    readPackageVersion: (name) => VERSIONS[name],
    readPackageApi: () => '0.7',
  }
}

function fakeStore(ctx) {
  const sessions = new Map()
  const store = {
    name: 'sessions',
    store: sessions,
    create() { return {} },
    prepare() { return {} },
    enter() { return () => {} },
    announce() {},
    async flush() { return false },
    get(id) { return sessions.get(id) },
    list() { return [...sessions.values()] },
    fork() { return {} },
  }
  // Mirrors the real store, which self-registers `ctx.sessions` on construction.
  ctx.set('sessions', store)
  return store
}

function fakeDelegate({ official }) {
  const delegate = {
    name: 'sessions',
    create: official.create.bind(official),
    prepare: official.prepare.bind(official),
    enter: official.enter.bind(official),
    announce: official.announce.bind(official),
    flush: official.flush.bind(official),
    get: official.get.bind(official),
    list: official.list.bind(official),
    fork: official.fork.bind(official),
    branches: {
      create() {}, graph() {}, plan() {}, preview() {}, commit() {}, rollback() {}, restore() {},
      availability() { return Object.freeze({ active: true }) },
    },
  }
  Object.defineProperty(delegate, SESSION_BRANCH_MARKER, { value: true })
  return delegate
}

function makeContext({ entries = [], services = new Map() } = {}) {
  const warns = []
  const ctx = {
    logger: { warn: (message) => warns.push(message) },
    loader: { entries: () => entries },
    get: (name) => services.get(name),
    set(name, value) {
      services.set(name, value)
      return true
    },
    plugin() { throw new Error('unused') },
    serviceMap: services,
    warns,
  }
  return ctx
}

function officialRow({ disabled = true } = {}) {
  return { options: { id: 'session', name: '@deepseek-ai/dsh-session', disabled } }
}

function replacementRow({ disabled = false } = {}) {
  return { options: { id: 'plugin-api-session-branch', name: '@deepseek-ai/dsh-plugin-api-session-branch', disabled } }
}

test('official row enabled: leaves the official provider in place, never double-runs', () => {
  const entries = [officialRow({ disabled: false }), replacementRow()]
  const ctx = makeContext({ entries })
  const apply = createSessionBranchApply({
    ...goodEnv(),
    officialStoreFactory: fakeStore,
    delegateFactory: fakeDelegate,
  })
  apply(ctx)
  assert.equal(ctx.serviceMap.has('sessions'), false, 'no service registered when official is enabled')
  const message = ctx.warns[0]
  assert.match(message, /official session row is enabled/)
})

test('replacement active with matching identity: delegate swapped in with marker', () => {
  const entries = [officialRow({ disabled: true }), replacementRow()]
  const ctx = makeContext({ entries })
  let constructed = 0
  let delegated = 0
  const apply = createSessionBranchApply({
    ...goodEnv(),
    officialStoreFactory: (c) => { constructed += 1; return fakeStore(c) },
    delegateFactory: (deps) => { delegated += 1; return fakeDelegate(deps) },
  })
  apply(ctx)
  const sessions = ctx.serviceMap.get('sessions')
  assert.ok(sessions, 'sessions must be registered')
  assert.equal(sessions[SESSION_BRANCH_MARKER], true)
  assert.equal(constructed, 1)
  assert.equal(delegated, 1)
  assert.match(ctx.warns[0], /replacement active/)
  assert.match(ctx.warns[0], /branch-edit-contract/, 'boot diagnostics reference the registered upstream proposal')
})

test('version mismatch: official fallback registered, replacement contract off', () => {
  const entries = [officialRow({ disabled: true }), replacementRow()]
  const ctx = makeContext({ entries })
  let constructed = 0
  const apply = createSessionBranchApply({
    readPackageVersion: (name) => (name === '@deepseek-ai/dsh-plugin-api-main' ? '0.1.0-rc.6-9.9' : VERSIONS[name]),
    readPackageApi: () => '0.7',
    officialStoreFactory: (c) => { constructed += 1; return fakeStore(c) },
    delegateFactory: fakeDelegate,
  })
  apply(ctx)
  assert.equal(constructed, 1, 'official behavior must be restored under mismatch')
  const sessions = ctx.serviceMap.get('sessions')
  assert.ok(sessions)
  assert.notEqual(sessions[SESSION_BRANCH_MARKER], true, 'no branch contract under mismatch')
  assert.match(ctx.warns[0], /replacement contract disabled/)
})

test('runtime identity mismatch: official fallback registered', () => {
  const entries = [officialRow({ disabled: true }), replacementRow()]
  const ctx = makeContext({ entries })
  let constructed = 0
  const apply = createSessionBranchApply({
    readPackageVersion: (name) => (name === '@deepseek-ai/dsh-session' ? '0.1.0-rc.7' : VERSIONS[name]),
    readPackageApi: () => '0.7',
    officialStoreFactory: (c) => { constructed += 1; return fakeStore(c) },
    delegateFactory: fakeDelegate,
  })
  apply(ctx)
  assert.equal(constructed, 1)
  assert.match(ctx.warns[0], /identity mismatch/)
})

test('official row absent + replacement active: delegate swapped in (same branch as disabled)', () => {
  const entries = [replacementRow()]
  const ctx = makeContext({ entries })
  const apply = createSessionBranchApply({
    ...goodEnv(),
    officialStoreFactory: fakeStore,
    delegateFactory: fakeDelegate,
  })
  apply(ctx)
  const sessions = ctx.serviceMap.get('sessions')
  assert.ok(sessions, 'sessions must be registered with the official row absent')
  assert.equal(sessions[SESSION_BRANCH_MARKER], true)
  assert.match(ctx.warns[0], /replacement active/)
})

test('competitor already owns ctx.sessions: conflict, stay inert', () => {
  const entries = [officialRow({ disabled: true }), replacementRow()]
  const services = new Map([['sessions', { name: 'sessions', list() { return [] } }]])
  const ctx = makeContext({ entries, services })
  let constructed = 0
  const apply = createSessionBranchApply({
    ...goodEnv(),
    officialStoreFactory: (c) => { constructed += 1; return fakeStore(c) },
    delegateFactory: fakeDelegate,
  })
  apply(ctx)
  assert.equal(constructed, 0)
  assert.match(ctx.warns[0], /another provider already owns ctx\.sessions/)
})

test('duplicate replacement rows: fail safe, stay inert', () => {
  const entries = [officialRow({ disabled: true }), replacementRow(), replacementRow()]
  const ctx = makeContext({ entries })
  let constructed = 0
  const apply = createSessionBranchApply({
    ...goodEnv(),
    officialStoreFactory: (c) => { constructed += 1; return fakeStore(c) },
    delegateFactory: fakeDelegate,
  })
  apply(ctx)
  assert.equal(constructed, 0)
  assert.match(ctx.warns[0], /duplicate replacement rows/)
})

test('no active replacement row: inert', () => {
  const entries = [officialRow({ disabled: true }), replacementRow({ disabled: true })]
  const ctx = makeContext({ entries })
  let constructed = 0
  const apply = createSessionBranchApply({
    ...goodEnv(),
    officialStoreFactory: (c) => { constructed += 1; return fakeStore(c) },
    delegateFactory: fakeDelegate,
  })
  apply(ctx)
  assert.equal(constructed, 0)
  assert.match(ctx.warns[0], /replacement row is absent or disabled/)
})

test('idempotent re-apply when the delegate already owns the service', () => {
  const entries = [officialRow({ disabled: true }), replacementRow()]
  const delegate = { [SESSION_BRANCH_MARKER]: true, name: 'sessions' }
  const ctx = makeContext({ entries, services: new Map([['sessions', delegate]]) })
  let constructed = 0
  const apply = createSessionBranchApply({
    ...goodEnv(),
    officialStoreFactory: (c) => { constructed += 1; return fakeStore(c) },
    delegateFactory: fakeDelegate,
  })
  apply(ctx)
  assert.equal(constructed, 0, 're-apply must be a no-op')
  assert.equal(ctx.warns.length, 0)
})

test('observation: loader enumeration failure stays inert', () => {
  const ctx = makeContext()
  ctx.loader = { entries: () => { throw new Error('boom') } }
  const apply = createSessionBranchApply({ ...goodEnv(), officialStoreFactory: fakeStore, delegateFactory: fakeDelegate })
  apply(ctx)
  assert.equal(ctx.serviceMap.has('sessions'), false)
  assert.match(ctx.warns[0], /loader composition probe failed/)
})

test('end-to-end on a real context: apply swaps a real official store for the delegate', () => {
  const ctx = new Context()
  ctx.loader = {
    entries: () => [
      { options: { id: 'session', name: '@deepseek-ai/dsh-session', disabled: true } },
      { options: { id: 'plugin-api-session-branch', name: '@deepseek-ai/dsh-plugin-api-session-branch', disabled: false } },
    ],
  }
  const apply = createSessionBranchApply({ ...goodEnv() })
  apply(ctx)
  const sessions = ctx.get('sessions')
  assert.ok(sessions, 'a sessions service must exist after apply')
  assert.equal(sessions[SESSION_BRANCH_MARKER], true)
  assert.equal(typeof sessions.branches.create, 'function')
  const session = sessions.create('e2e')
  assert.equal(sessions.get('e2e'), session, 'delegate create must behave like the official store')
  session.append('user/message', { id: 'm', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'x' }] }, { surfaceOp: 'append' })
  assert.equal(session.deriveMessages().length, 1)
})