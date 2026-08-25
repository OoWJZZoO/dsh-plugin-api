import test from 'node:test'
import assert from 'node:assert/strict'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { createToolDiscoveryEngine } from '../lib/tool-discovery.js'
import { ToolDiscoveryEntryFailedError } from '../lib/tool-discovery-errors.js'

/**
 * Miniature Cordis context that drives the REAL official SystemPrompt service:
 * `effect` accepts the generator-based disposers that dsh-scope ScopedLayers
 * relies on, `waterfall` passes straight through to the innermost callback,
 * and `emit`/`off`/`on`/`once` are inert. `reflect.provide` satisfies the
 * Cordis Service base constructor. All other semantics (per-assemble provider
 * evaluation, structuredClone of parameters, scoped layers, section text
 * evaluation, renderPrompt filtering) are the official implementation.
 */
function createMiniCtx() {
  const disposers = []
  const ctx = {
    reflect: { provide() {} },
    emit() {},
    off() {},
    on() {},
    once() {},
    effect(fn) {
      const generator = fn()
      const undos = []
      let step = generator.next()
      while (!step.done) {
        undos.push(step.value)
        step = generator.next()
      }
      const disposer = () => {
        const pending = undos.splice(0).reverse()
        for (const undo of pending) {
          try { undo() } catch { /* disposer failures never escape */ }
        }
      }
      disposers.push(disposer)
      return disposer
    },
    waterfall(...args) {
      const inner = args.pop()
      return inner(...args.slice(2))
    },
  }
  return { ctx, disposers }
}

function createFixture() {
  const { ctx } = createMiniCtx()
  const systemPrompt = new SystemPrompt(ctx, {})
  const diagnostics = []
  const engine = createToolDiscoveryEngine({
    reportDiagnostics: (owner, detail) => diagnostics.push({ owner, detail }),
    idFactory: (() => { let n = 0; return () => `g${++n}` })(),
    now: () => new Date('2026-08-25T00:00:00.000Z'),
  })
  const providerDisposer = systemPrompt.tools((context) => engine.provider(context))
  const hintDisposer = systemPrompt.section({
    name: 'discovery:hints',
    order: 1000,
    text: (context) => engine.hintText(context),
  })
  const assemble = (sessionId) => systemPrompt.assemble({ scope: { session: { id: sessionId } }, agent: { session: { id: sessionId } } })
  const dispose = () => { providerDisposer(); hintDisposer() }
  return { systemPrompt, engine, diagnostics, assemble, dispose }
}

const DEFS = [{ name: 'alpha_run', description: 'Runs alpha', parameters: { type: 'object', properties: {} } }]

test('registered but unactivated entries leak nothing into the assembled toolset', async () => {
  const fixture = createFixture()
  fixture.engine.catalog.register({ id: 'alpha', owner: 'owner-a', summary: 'Alpha', capabilities: ['vision'], activate: () => DEFS })
  const assembly = await fixture.assemble('s1')
  assert.deepEqual(assembly.tools, [], 'no schema before activation')
  assert.equal(renderPrompt(assembly).includes('Alpha'), false)
  fixture.dispose()
})

test('zero entries: prompt render is byte-identical with the baseline', async () => {
  const baseline = createFixture()
  const withFeature = createFixture()
  const baselineAssembly = await baseline.assemble('s1')
  const featureAssembly = await withFeature.assemble('s1')
  assert.equal(renderPrompt(featureAssembly), renderPrompt(baselineAssembly), 'byte-identical prompt')
  assert.deepEqual(featureAssembly.tools, baselineAssembly.tools)
  baseline.dispose()
  withFeature.dispose()
})

test('activation takes effect at the next assemble (intra-turn rebuild anchor)', async () => {
  const fixture = createFixture()
  fixture.engine.catalog.register({ id: 'alpha', owner: 'owner-a', summary: 'Alpha', capabilities: ['vision'], activate: () => DEFS })
  const before = await fixture.assemble('s1')
  assert.deepEqual(before.tools, [])
  const handle = await fixture.engine.activate('alpha', { session: { id: 's1' }, reason: 'vision task' })
  const after = await fixture.assemble('s1')
  assert.deepEqual(after.tools.map((tool) => tool.name), ['alpha_run'])
  assert.equal(after.tools[0].description, 'Runs alpha')
  assert.deepEqual(after.tools[0].parameters, { type: 'object', properties: {} })
  const hintSection = after.sections.find((section) => section.name === 'discovery:hints')
  assert.ok(hintSection.text.includes('Alpha'), 'hint carries descriptor data')
  assert.ok(hintSection.text.includes('alpha_run'), 'hint carries invocation syntax')
  handle.dispose()
  fixture.dispose()
})

test('handle dispose hides the toolset at the next assemble', async () => {
  const fixture = createFixture()
  fixture.engine.catalog.register({ id: 'alpha', owner: 'owner-a', summary: 'Alpha', capabilities: [], activate: () => DEFS })
  const handle = await fixture.engine.activate('alpha', { session: { id: 's1' } })
  assert.equal((await fixture.assemble('s1')).tools.length, 1)
  handle.dispose()
  assert.deepEqual((await fixture.assemble('s1')).tools, [], 'disposed generation disappears on the next assemble')
  fixture.dispose()
})

test('toolsets never leak across sessions', async () => {
  const fixture = createFixture()
  fixture.engine.catalog.register({ id: 'alpha', owner: 'owner-a', summary: 'Alpha', capabilities: [], activate: () => DEFS })
  const handle = await fixture.engine.activate('alpha', { session: { id: 's1' } })
  assert.equal((await fixture.assemble('s1')).tools.length, 1)
  assert.deepEqual((await fixture.assemble('s2')).tools, [], 'unrelated session sees nothing')
  handle.dispose()
  fixture.dispose()
})

test('a failing entry is contained: other entries keep exposing schemas', async () => {
  const fixture = createFixture()
  fixture.engine.catalog.register({ id: 'bad', owner: 'owner-b', summary: 'Bad', capabilities: [], activate: () => { throw new Error('boom') } })
  fixture.engine.catalog.register({ id: 'good', owner: 'owner-a', summary: 'Good', capabilities: [], activate: () => DEFS })
  await assert.rejects(fixture.engine.activate('bad', { session: { id: 's1' } }), ToolDiscoveryEntryFailedError)
  const handle = await fixture.engine.activate('good', { session: { id: 's1' } })
  const assembly = await fixture.assemble('s1')
  assert.deepEqual(assembly.tools.map((tool) => tool.name), ['alpha_run'], 'the good entry still assembles')
  assert.ok(fixture.diagnostics.some((entry) => entry.owner === 'owner-b'), 'failure attributed to its owner')
  handle.dispose()
  fixture.dispose()
})

test('non-cloneable parameters never reach the official assemble and fail the entry', async () => {
  const fixture = createFixture()
  fixture.engine.catalog.register({
    id: 'evil',
    owner: 'owner-e',
    summary: 'Evil',
    capabilities: [],
    activate: () => [{ name: 'evil_tool', description: 'x', parameters: { fn() {} } }],
  })
  await assert.rejects(fixture.engine.activate('evil', { session: { id: 's1' } }), /clone/i)
  const assembly = await fixture.assemble('s1')
  assert.deepEqual(assembly.tools, [], 'assemble survives the hostile definition')
  fixture.dispose()
})

test('a poisoned provider context degrades to empty output and never breaks assembling', async () => {
  const fixture = createFixture()
  fixture.engine.catalog.register({ id: 'alpha', owner: 'owner-a', summary: 'Alpha', capabilities: [], activate: () => DEFS })
  const handle = await fixture.engine.activate('alpha', { session: { id: 's1' } })
  const assembly = await fixture.systemPrompt.assemble({ scope: { get session() { throw new Error('poison') } } })
  assert.deepEqual(assembly.tools, [], 'provider returned empty output')
  assert.ok(fixture.diagnostics.some((entry) => entry.detail.includes('provider')), 'degradation recorded via diagnostics')
  const healthy = await fixture.assemble('s1')
  assert.equal(healthy.tools.length, 1, 'later healthy assemblies still work')
  handle.dispose()
  fixture.dispose()
})

test('hint contributes zero bytes when no entries are active for the scope', async () => {
  const fixture = createFixture()
  fixture.engine.catalog.register({ id: 'alpha', owner: 'owner-a', summary: 'Alpha', capabilities: [], activate: () => DEFS })
  const assembly = await fixture.assemble('s1')
  const hintSection = assembly.sections.find((section) => section.name === 'discovery:hints')
  assert.equal(hintSection.text, '', 'registered but not active: zero bytes')
  fixture.dispose()
})