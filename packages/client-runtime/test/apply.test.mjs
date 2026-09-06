/**
 * Fail-safe apply matrix tests: the boot self-check asserts the official row
 * is disabled (or absent), identities match, the replacement browser bundle
 * probe passes, and the runtime route is claimed exactly once — no double-run,
 * no hollow.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createClientRuntimeApply } from '../lib/apply.js'
import { RUNTIME_OWNER_SYMBOL } from '../lib/shared-vocab.js'

function fakeLoader(rows) {
  return {
    entries: () => rows.map((row) => ({ options: { id: row.id }, disabled: Boolean(row.disabled) })),
  }
}

function fakeCtx(rows) {
  const logs = []
  const ctx = {
    loader: fakeLoader(rows),
    logger: { warn: (m) => logs.push(m), debug() {} },
  }
  ctx.__logs = logs
  return ctx
}

function versionsOk() {
  return {
    readPackageVersion: (pkg) => (pkg === '@deepseek-ai/dsh-client-runtime' ? '0.1.0-rc.6' : '0.1.0-rc.6-0.1.0'),
    readPackageApi: () => '0.1',
    probeBundle: () => true,
  }
}

test('apply: official row enabled → stays inert', () => {
  const ctx = fakeCtx([{ id: 'client-runtime', disabled: false }])
  const disposer = createClientRuntimeApply(versionsOk())(ctx)
  assert.equal(disposer, undefined)
  assert.equal(ctx[RUNTIME_OWNER_SYMBOL], undefined)
})

test('apply: official row disabled + identities ok → runtime owned once', () => {
  const ctx = fakeCtx([{ id: 'client-runtime', disabled: true }])
  const disposer = createClientRuntimeApply(versionsOk())(ctx)
  assert.equal(typeof disposer, 'function')
  assert.equal(ctx[RUNTIME_OWNER_SYMBOL], true)
  // duplicate apply stays inert (no double-run)
  const second = createClientRuntimeApply(versionsOk())(ctx)
  assert.equal(second, undefined)
})

test('apply: absent official row + identities ok → runtime claimed', () => {
  const ctx = fakeCtx([])
  const disposer = createClientRuntimeApply(versionsOk())(ctx)
  assert.equal(typeof disposer, 'function')
})

test('apply: identity mismatch → inert with diagnostics, no hollow', () => {
  const ctx = fakeCtx([{ id: 'client-runtime', disabled: true }])
  const disposer = createClientRuntimeApply({
    readPackageVersion: () => '0.2.0',
    readPackageApi: () => '0.1',
    probeBundle: () => true,
  })(ctx)
  assert.equal(disposer, undefined)
  assert.equal(ctx[RUNTIME_OWNER_SYMBOL], undefined)
  assert.ok(ctx.__logs.some((line) => /identity mismatch/.test(line)))
})

test('apply: browser-bundle probe failure → runtime not claimed, official half still served', () => {
  const ctx = fakeCtx([{ id: 'client-runtime', disabled: true }])
  const disposer = createClientRuntimeApply({
    readPackageVersion: (pkg) => (pkg === '@deepseek-ai/dsh-client-runtime' ? '0.1.0-rc.6' : '0.1.0-rc.6-0.1.0'),
    readPackageApi: () => '0.1',
    probeBundle: () => false,
  })(ctx)
  assert.equal(disposer, undefined)
  assert.equal(ctx[RUNTIME_OWNER_SYMBOL], undefined)
  assert.ok(ctx.__logs.some((line) => /bundle probe failed/.test(line)))
})

test('apply: self-check exception never throws out of apply', () => {
  const apply = createClientRuntimeApply({
    readPackageVersion() { throw new Error('boom') },
    readPackageApi: () => '0.1',
    probeBundle: () => true,
  })
  let called
  assert.doesNotThrow(() => { called = apply({ loader: { entries() { throw new Error('x') } }, logger: { warn() {}, debug() {} } }) })
  assert.equal(called, undefined)
})