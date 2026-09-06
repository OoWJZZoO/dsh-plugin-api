/**
 * Fail-safe apply matrix tests: the boot self-check asserts the
 * official row is disabled (or absent), the replacement row is the active
 * one, identities match, and the route is claimed exactly once — with no
 * double-run and no hollow (official disabled with nothing working).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createApiRemotesApply } from '../lib/apply.js'
import { FORWARDER_OWNER_SYMBOL } from '../lib/shared-vocab.js'

function fakeLoader(rows) {
  return {
    entries: () => rows.map((row) => ({ options: { id: row.id }, disabled: Boolean(row.disabled) })),
  }
}

function makeSource() {
  const listeners = []
  return {
    listeners,
    subscribe(listener) {
      listeners.push(listener)
      return () => {
        const index = listeners.indexOf(listener)
        if (index >= 0) listeners.splice(index, 1)
      }
    },
  }
}

function makeStream() {
  const frames = []
  return { frames, push: (frame) => frames.push(frame) }
}

function fakeCtx({ rows = [], logger } = {}) {
  const logs = []
  const ctx = {
    loader: fakeLoader(rows),
    logger: logger ?? { warn: (m) => logs.push(m), debug() {} },
    rows,
    on() {
      return () => {}
    },
    get() {
      return undefined
    },
  }
  ctx.__logs = logs
  return ctx
}

const VERSIONS = {
  own: '0.1.0-rc.6-0.1.0',
  ownApi: '0.1',
  main: '0.1.0-rc.6-0.1.0',
  mainApi: '0.1',
}

function readVersionOk() {
  return (pkg) => (pkg === '@deepseek-ai/dsh-api-remotes' ? '0.1.0-rc.6' : VERSIONS.own)
}

function testApplyRows(rows, { source, stream, versions } = {}) {
  const src = source ?? makeSource()
  const stm = stream ?? makeStream()
  const apply = createApiRemotesApply({
    readPackageVersion: versions ?? readVersionOk(),
    readPackageApi: () => '0.1',
    resolveSource: () => src,
    resolveStream: () => stm,
  })
  const ctx = fakeCtx({ rows })
  const disposer = apply(ctx)
  return { ctx, disposer, stm, src }
}

test('apply: official row enabled → stays inert, leaves the official provider in place', () => {
  const { ctx, disposer, stm } = testApplyRows([{ id: 'api-remotes', disabled: false }])
  assert.equal(disposer, undefined)
  assert.equal(ctx[FORWARDER_OWNER_SYMBOL], undefined)
  assert.equal(stm.frames.length, 0)
})

test('apply: official row disabled + identities ok → forwarder attaches once', () => {
  const { ctx, disposer, stm, src } = testApplyRows([{ id: 'api-remotes', disabled: true }])
  assert.equal(typeof disposer, 'function')
  assert.equal(ctx[FORWARDER_OWNER_SYMBOL], true)
  src.listeners[0]({ kind: 'attention.delta', epoch: 1, seq: 3, changes: [{ op: 'add', id: 'x' }] })
  assert.equal(stm.frames.length, 1)
  assert.equal(stm.frames[0].type, 'host/remote-event')
  assert.equal(stm.frames[0].event, 'attention/update')
  assert.equal(stm.frames[0].args[0].changes[0].id, 'x')
  disposer()
  assert.equal(src.listeners.length, 0, 'dispose unsubscribes the source listener')
  assert.equal(stm.frames.length, 1)
})

test('apply: absent official row + identities ok → attaches (isolated replacement)', () => {
  const { ctx, disposer, stm } = testApplyRows([])
  assert.equal(typeof disposer, 'function')
  assert.equal(stm.frames.length, 0)
})

test('apply: runtime identity mismatch → inert, attention route not claimed, no hollow', () => {
  const src = makeSource()
  const stm = makeStream()
  const apply = createApiRemotesApply({
    readPackageVersion: () => '0.2.0', // official runtime moved on
    readPackageApi: () => '0.1',
    resolveSource: () => src,
    resolveStream: () => stm,
  })
  const ctx = fakeCtx({ rows: [{ id: 'api-remotes', disabled: true }] })
  const disposer = apply(ctx)
  assert.equal(disposer, undefined)
  assert.equal(ctx[FORWARDER_OWNER_SYMBOL], undefined)
  assert.equal(stm.frames.length, 0)
  assert.ok(ctx.__logs.some((line) => /identity mismatch/.test(line)), 'must diagnose the mismatch')
})

test('apply: main facade version mismatch → inert with diagnostics', () => {
  const src = makeSource()
  const stm = makeStream()
  // the main facade negotiated a newer API protocol than this bundle
  const apply = createApiRemotesApply({
    readPackageVersion: (pkg) => {
      if (pkg === '@deepseek-ai/dsh-api-remotes') return '0.1.0-rc.6'
      if (pkg === '@deepseek-ai/dsh-plugin-api-main') return '0.1.0-rc.6-0.2.0'
      return '0.1.0-rc.6-0.1.0'
    },
    readPackageApi: (pkg) => (pkg === '@deepseek-ai/dsh-plugin-api-main' ? '0.2' : '0.1'),
    resolveSource: () => src,
    resolveStream: () => stm,
  })
  const ctx = fakeCtx({ rows: [{ id: 'api-remotes', disabled: true }] })
  const disposer = apply(ctx)
  assert.equal(disposer, undefined)
  assert.equal(ctx[FORWARDER_OWNER_SYMBOL], undefined)
  assert.ok(ctx.__logs.some((line) => /version mismatch/.test(line)))
})

test('apply: no double-run — the second apply of the same row stays inert', () => {
  const { ctx, stm, src } = testApplyRows([{ id: 'api-remotes', disabled: true }])
  const second = createApiRemotesApply({
    readPackageVersion: readVersionOk(),
    readPackageApi: () => '0.1',
    resolveSource: () => src,
    resolveStream: () => stm,
  })(ctx)
  assert.equal(second, undefined, 'second apply must not attach a second forwarder')
})

test('apply: missing source or stream → route not claimed, official behavior unaffected', () => {
  const apply = createApiRemotesApply({
    readPackageVersion: readVersionOk(),
    readPackageApi: () => '0.1',
    resolveSource: () => null,
    resolveStream: () => null,
  })
  const ctx = fakeCtx({ rows: [{ id: 'api-remotes', disabled: true }] })
  const disposer = apply(ctx)
  assert.equal(disposer, undefined)
  assert.equal(ctx[FORWARDER_OWNER_SYMBOL], undefined)
  assert.ok(ctx.__logs.some((line) => /not attached/.test(line)))
})

test('apply: self-check exception → stays inert and never throws out of apply', () => {
  const apply = createApiRemotesApply({
    readPackageVersion() { throw new Error('boom') },
    readPackageApi: () => '0.1',
    resolveSource: () => null,
    resolveStream: () => null,
  })
  const ctx = { loader: { entries() { throw new Error('loader exploded') } }, logger: { warn() {}, debug() {} } }
  let called
  assert.doesNotThrow(() => { called = apply(ctx) })
  assert.equal(called, undefined)
})