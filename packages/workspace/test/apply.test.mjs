import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkspaceApply } from '../lib/apply.js'
import { buildWorkspaceDelegate, WORKSPACE_SLICE_MARKER } from '../lib/delegate.js'
import { createOfficialRegistryFixture } from './workspace-fixture.mjs'

function rowEntry(id, name, options = {}) {
  return { options: { id, name, ...options } }
}

function createLoader(rows) {
  return { entries: () => rows }
}

function harness(overrides = {}) {
  const rows = []
  const ctx = {
    loader: createLoader(rows),
    get: (name) => (name === 'workspaceRegistry' ? ctx.value : undefined),
    set: (name, value) => { ctx.value = value },
    reflect: { set: (name, value) => { ctx.value = value } },
    logger: { warn: () => {} },
  }
  const versions = {
    '@deepseek-ai/dsh': '0.1.0-rc.6',
    '@deepseek-ai/dsh-workspace': '0.1.0-rc.6',
    '@deepseek-ai/dsh-plugin-api-workspace': '0.1.0-rc.6-0.1.0',
    '@deepseek-ai/dsh-plugin-api-main': '0.1.0-rc.6-0.1.0',
    ...(overrides.versions ?? {}),
  }
  const apis = {
    '@deepseek-ai/dsh-plugin-api-workspace': '0.1',
    '@deepseek-ai/dsh-plugin-api-main': '0.1',
    ...(overrides.apis ?? {}),
  }
  const readVersion = overrides.readVersion ?? ((name) => versions[name])
  const readApi = overrides.readApi ?? ((name) => apis[name])
  const officialAvailable = overrides.officialAvailable ?? true
  // The official registry constructor self-registers `ctx.workspaceRegistry`
  // on the fiber; the harness fixture mimics that registration side effect.
  const makeRegistry = (givenCtx) => {
    const registry = createOfficialRegistryFixture()
    givenCtx.value = registry
    return registry
  }
  const registryFactory = overrides.registryFactory ?? makeRegistry
  const delegateFactory = overrides.delegateFactory ?? (({ ctx, official }) => buildWorkspaceDelegate({ ctx, official, store: overrides.store }))
  const apply = createWorkspaceApply({ readPackageVersion: readVersion, readPackageApi: readApi, registryFactory, delegateFactory, officialAvailable })
  return { ctx, rows, apply, readVersion, readApi }
}

const applyWith = ({ ctx, rows, apply }) => {
  rows.push(rowEntry('workspace', '@deepseek-ai/dsh-workspace', { disabled: true }))
  rows.push(rowEntry('plugin-api-workspace', '@deepseek-ai/dsh-plugin-api-workspace'))
  apply(ctx)
  return ctx
}

test('apply: swaps in the delegate when the official row is disabled and identity checks pass', () => {
  const h = harness()
  applyWith(h)
  const value = h.ctx.get('workspaceRegistry')
  assert.ok(value, 'a workspace registry is registered')
  assert.equal(value[WORKSPACE_SLICE_MARKER], true, 'the delegate is active (no double-run)')
  assert.equal(typeof value.snapshot.apply, 'function')
})

test('apply: official row enabled → official provider stays in place', () => {
  const h = harness()
  h.rows.push(rowEntry('workspace', '@deepseek-ai/dsh-workspace'))
  h.rows.push(rowEntry('plugin-api-workspace', '@deepseek-ai/dsh-plugin-api-workspace'))
  h.apply(h.ctx)
  assert.equal(h.ctx.get('workspaceRegistry'), undefined, 'no provider is registered by this bundle')
})

test('apply: duplicate replacement rows → staying inert (no double-run)', () => {
  const h = harness()
  h.rows.push(rowEntry('workspace', '@deepseek-ai/dsh-workspace', { disabled: true }))
  h.rows.push(rowEntry('plugin-api-workspace', '@deepseek-ai/dsh-plugin-api-workspace'))
  h.rows.push(rowEntry('plugin-api-workspace', '@deepseek-ai/dsh-plugin-api-workspace'))
  h.apply(h.ctx)
  assert.equal(h.ctx.get('workspaceRegistry'), undefined)
})

test('apply: another provider already owns the workspace component → stays inert (owner conflict)', () => {
  const h = harness()
  h.ctx.value = { some: 'other provider' }
  h.rows.push(rowEntry('workspace', '@deepseek-ai/dsh-workspace', { disabled: true }))
  h.rows.push(rowEntry('plugin-api-workspace', '@deepseek-ai/dsh-plugin-api-workspace'))
  h.apply(h.ctx)
  assert.equal(h.ctx.get('workspaceRegistry').some, 'other provider', 'the existing provider is untouched')
})

test('apply: identity mismatch still provides the official registry — no disabled-without-alternative hole', () => {
  const h = harness({ versions: { '@deepseek-ai/dsh-workspace': '0.1.0-rc.7' } })
  applyWith(h)
  const value = h.ctx.get('workspaceRegistry')
  assert.ok(value, 'a workspace registry is registered')
  assert.equal(value[WORKSPACE_SLICE_MARKER], undefined, 'the snapshot extension stays off on mismatch')
  assert.equal(typeof value.create, 'function', 'official contract behavior remains functional')
})

test('apply: headless profile without the workspace row leaves the slice unavailable and stays inert', () => {
  const h = harness({ officialAvailable: false })
  h.rows.push(rowEntry('plugin-api-workspace', '@deepseek-ai/dsh-plugin-api-workspace'))
  h.apply(h.ctx)
  assert.equal(h.ctx.get('workspaceRegistry'), undefined)
})

test('apply: post-swap contract probe failure rolls back to the official registry', () => {
  const official = createOfficialRegistryFixture()
  const brokenDelegate = { create: 'not-a-function' }
  const h = harness({
    registryFactory: () => official,
    delegateFactory: () => brokenDelegate,
  })
  applyWith(h)
  const value = h.ctx.get('workspaceRegistry')
  assert.equal(value, official, 'the official registry is left in place after a failed probe')
})

test('apply: registry construction failure stays inert without touching the official row', () => {
  const h = harness({
    registryFactory: () => { throw new Error('storageDomain unavailable') },
  })
  applyWith(h)
  assert.equal(h.ctx.get('workspaceRegistry'), undefined)
})

test('apply: never throws — loader probe failure and unexpected errors are contained', () => {
  const h = harness()
  h.ctx.loader = { entries: () => { throw new Error('loader broken') } }
  assert.doesNotThrow(() => h.apply(h.ctx))
  const h2 = harness()
  h2.ctx = undefined
  assert.doesNotThrow(() => h2.apply(undefined))
})

test('apply: main facade version mismatch degrades the extension but keeps the official service', () => {
  const h = harness({ versions: { '@deepseek-ai/dsh-plugin-api-main': '0.1.0-rc.6-0.2.0' } })
  applyWith(h)
  const value = h.ctx.get('workspaceRegistry')
  assert.ok(value)
  assert.equal(value[WORKSPACE_SLICE_MARKER], undefined)
})