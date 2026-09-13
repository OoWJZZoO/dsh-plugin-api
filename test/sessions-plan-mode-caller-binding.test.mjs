/**
 * Caller-binding regression for `sessions.planMode`, on a real cordis tree.
 *
 * The facade's session sub-face is caller-bound: the write member derives its
 * owner from the calling plugin's fiber. That only works when cordis can hand
 * the accessing context to the namespace accessor as its receiver — which is
 * why the `sessions` getter is method-style, like the `agents`/`llm`/`events`
 * faces. A mock harness cannot observe that receiver semantics, so this file
 * mounts the real service through `@deepseek-ai/cordis` and asserts the
 * consequence: two calling plugins get two distinct, stable sub-surfaces.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'

import { createPluginApiService } from '../lib/plugin-api-service.js'
import { createFeatureRegistry } from '../lib/feature-registry.js'
import { createSessionsPlanModeFeature } from '../lib/sessions-plan-mode-facade.js'

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

async function boot() {
  const root = new Context()
  const sessions = new Map()
  const setCalls = []
  const official = {
    get(agent) {
      const session = agent.session
      return { active: sessions.get(session.id)?.active === true }
    },
    set(agent, active) {
      setCalls.push({ sessionId: agent.session.id, active })
      sessions.get(agent.session.id).active = active
      return 'committed'
    },
  }
  for (const [name, value] of Object.entries({
    loader: { entries: () => [] },
    llm: { resolveModelInfo() {}, prepareCall() {}, stream() {}, registerAdapter() {}, registerConfigurableProviders() {}, registerModelDiscovery() {} },
    tools: { register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {}, executionMode() { return 'mode' } },
    agents: { get() {}, list() {}, roots() {} },
    sessions: { get: (id) => sessions.get(id), list: () => [...sessions.values()], fork() {} },
    settings: { register() {}, describe() { return [] }, get() {}, mutate() {} },
    systemPrompt: { section() {}, context() {}, variable() {}, tools() {}, suppressRuntimeContext() {}, renderPrompt() {}, renderContextSections() {}, renderContextSnapshot() {}, joinContextSections() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    web: { registerSearchProvider() {}, registerFetchProvider() {} },
    planMode: official,
  })) root.provide(name, value)

  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: () => true })
  root.plugin(ServiceClass)
  await settle()
  const service = root.pluginApi
  assert.ok(service, 'the facade service registers on the real tree')
  const feature = createSessionsPlanModeFeature({ ctx: root, service, logger: { warn() {} } })
  service.mountFeature('sessionPlanMode', feature.api)
  registry.mount('sessionPlanMode')
  return { root, service, official, sessions, setCalls, feature }
}

test('two calling plugins receive distinct, stable plan-mode sub-surfaces (real cordis receiver)', async () => {
  const { root, service, sessions, setCalls, feature } = await boot()
  sessions.set('s1', { id: 's1', active: false })
  const agent = { session: sessions.get('s1') }
  const seen = []

  class CallerA {
    static inject = ['pluginApi']
    constructor(ctx) {
      seen.push({ name: 'a', face: ctx.pluginApi.sessions.planMode, again: ctx.pluginApi.sessions.planMode, ctx })
    }
  }
  class CallerB {
    static inject = ['pluginApi']
    constructor(ctx) {
      seen.push({ name: 'b', face: ctx.pluginApi.sessions.planMode, again: ctx.pluginApi.sessions.planMode, ctx })
    }
  }
  root.plugin(CallerA)
  root.plugin(CallerB)
  await settle()

  assert.equal(seen.length, 2, 'both callers were constructed')
  const a = seen.find((entry) => entry.name === 'a')
  const b = seen.find((entry) => entry.name === 'b')
  assert.notEqual(a.face, b.face, 'each caller receives its own materialized sub-surface')
  assert.deepEqual(Object.keys(a.face).sort(), Object.keys(a.again).sort(), 'the member shape stays identical across reads')
  assert.equal(typeof a.face.select, 'function')

  // The write path works through the public face for both callers, and the
  // audit attributes every switch to the *calling* plugin, never to the facade.
  assert.equal(a.face.select(agent, true).code, 'committed')
  assert.equal(b.face.select(agent, false).code, 'committed')
  assert.deepEqual(setCalls, [{ sessionId: 's1', active: true }, { sessionId: 's1', active: false }])
  assert.equal(a.face.get(agent).active, false, 'the read face reflects the official authority')
  assert.deepEqual(
    feature.authority.audit().records.map((record) => [record.ownerId, record.outcome]),
    [['CallerA', 'attempt'], ['CallerA', 'committed'], ['CallerB', 'attempt'], ['CallerB', 'committed']],
    'ownership is derived from the accessing plugin, never from the facade',
  )

  // A context that carries no usable fiber is refused typed, never guessed.
  const authorityFace = service._sessionPlanModeSlot.api.surfaceFor({})
  assert.equal(authorityFace.select(agent, true).code, 'denied')
})
