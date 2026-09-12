/**
 * `llm.models.list` projection: one frozen, read-time-merged catalog view of
 * official adapter routes and facade-registered declarations, with honest
 * per-entry availability and a strict truth boundary (decorations never
 * feed it, official passthrough members are never rewritten).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createLlmModelsProjection } from '../lib/llm-models-projection.js'
import { PluginApiInactiveError, PluginApiFeatureDisabledError } from '../lib/errors.js'

const isFrozenDeep = (value) => {
  if (value === null || typeof value !== 'object') return true
  if (!Object.isFrozen(value)) return false
  return Object.values(value).every((child) => child === null || typeof child !== 'object' || isFrozenDeep(child))
}

function createOfficialLlm({ failProvider, providers, models } = {}) {
  const state = {
    providers: providers ?? [{ id: 'deepseek', name: 'DeepSeek' }],
    models: models ?? { deepseek: [{ provider: 'deepseek', id: 'deepseek-chat', name: 'DeepSeek Chat' }] },
    directory: [{ provider: 'config-p', displayName: 'Config P', settingsNs: 'config-p', settingsPath: ['a'] }],
  }
  const counts = { listProviders: 0, listModels: 0 }
  const llm = {
    listProviders() {
      counts.listProviders += 1
      return state.providers.map((provider) => ({ ...provider }))
    },
    async listModels(provider) {
      counts.listModels += 1
      if (provider === failProvider) throw Object.assign(new Error('catalog endpoint down'), { name: 'LlmError' })
      return (state.models[provider] ?? []).map((model) => ({ ...model }))
    },
    listConfigurableProviders() {
      return state.directory.map((entry) => ({ ...entry, settingsPath: [...entry.settingsPath] }))
    },
  }
  return { llm, state, counts }
}

function createProjection({ llm, facadeRoutes = () => [], active = () => true } = {}) {
  const resolved = llm ?? createOfficialLlm()
  return {
    projection: createLlmModelsProjection({
      active,
      llmProvider: () => (llm === undefined ? resolved.llm : llm),
      facadeRoutes,
    }),
    ...resolved,
  }
}

test('the projection merges official routes with facade-registered declarations', async () => {
  // Production reality: the facade route went through the official action,
  // so the official topology lists it — with only the whitelist fields.
  const official = createOfficialLlm({
    providers: [{ id: 'deepseek', name: 'DeepSeek' }, { id: 'vision-x', name: 'vision-x' }],
    models: {
      deepseek: [{ provider: 'deepseek', id: 'deepseek-chat', name: 'DeepSeek Chat' }],
      'vision-x': [{ provider: 'vision-x', id: 'vision-x-large', name: 'vision-x-large', inputModalities: ['image'] }],
    },
  })
  const facadeRoutes = () => [{
    id: 'vision-x',
    ownerId: 'plugin-a',
    generation: 1,
    models: [{ model: 'vision-x-large', inputModalities: ['image'], contextWindow: 128000 }],
    availability: 'active',
  }]
  const { projection } = createProjection({ llm: official.llm, facadeRoutes })
  const rows = await projection.list()
  assert.equal(rows.length, 3, 'official provider + facade variant provider + dormant directory entry')

  const deepseek = rows.find((row) => row.provider === 'deepseek')
  assert.equal(deepseek.registered, true)
  assert.equal(deepseek.availability, 'active')
  assert.deepEqual(deepseek.models, [{ provider: 'deepseek', id: 'deepseek-chat', name: 'DeepSeek Chat' }])

  const variant = rows.find((row) => row.provider === 'vision-x')
  assert.equal(variant.registered, true)
  assert.equal(variant.models.length, 1)
  assert.equal(variant.models[0].id, 'vision-x-large')
  assert.deepEqual(variant.models[0].inputModalities, ['image'], 'declared real capability is projected')
  assert.equal(variant.models[0].contextWindow, 128000, 'declared fields the official whitelist drops are restored')
})

test('variant and original model coexist as independent entries', async () => {
  const official = createOfficialLlm({
    providers: [{ id: 'deepseek', name: 'DeepSeek' }, { id: 'deepseek-variants', name: 'deepseek-variants' }],
    models: {
      deepseek: [{ provider: 'deepseek', id: 'deepseek-chat', name: 'DeepSeek Chat' }],
      'deepseek-variants': [{ provider: 'deepseek-variants', id: 'deepseek-chat-image', name: 'deepseek-chat-image' }],
    },
  })
  const facadeRoutes = () => [{
    id: 'deepseek-variants',
    ownerId: 'plugin-a',
    generation: 1,
    models: [{ model: 'deepseek-chat-image', inputModalities: ['image'] }],
    availability: 'active',
  }]
  const { projection } = createProjection({ llm: official.llm, facadeRoutes })
  const rows = await projection.list()
  const base = rows.find((row) => row.provider === 'deepseek').models.find((model) => model.id === 'deepseek-chat')
  const variant = rows.find((row) => row.provider === 'deepseek-variants').models[0]
  assert.ok(base, 'original model stays present and untouched')
  assert.equal(base.inputModalities, undefined)
  assert.equal(variant.id, 'deepseek-chat-image')
  assert.deepEqual(variant.inputModalities, ['image'])
})

test('the snapshot is deeply frozen and reflects registry changes on each read', async () => {
  const facadeRows = []
  const { projection } = createProjection({ facadeRoutes: () => facadeRows })
  const first = await projection.list()
  assert.ok(isFrozenDeep(first))

  facadeRows.push({
    id: 'late-route', ownerId: 'plugin-b', generation: 1,
    models: [{ model: 'late-model' }], availability: 'active',
  })
  const second = await projection.list()
  assert.ok(second.some((row) => row.provider === 'late-route'), 'next read sees the new registration')
  assert.ok(isFrozenDeep(second))
})

test('a broken catalog read marks that entry unavailable without throwing through', async () => {
  const { projection } = createProjection({ llm: createOfficialLlm({ failProvider: 'deepseek' }).llm })
  const rows = await projection.list()
  const deepseek = rows.find((row) => row.provider === 'deepseek')
  assert.equal(deepseek.availability, 'unavailable')
  assert.match(deepseek.reason, /catalog endpoint down/)
  assert.deepEqual(deepseek.models, [])
  assert.ok(rows.some((row) => row.provider === 'config-p'), 'dormant directory rows still surface')
})

test('dormant configurable providers appear as unregistered directory entries', async () => {
  const { projection } = createProjection()
  const rows = await projection.list()
  const dormant = rows.find((row) => row.provider === 'config-p')
  assert.ok(dormant)
  assert.equal(dormant.registered, false)
  assert.equal(dormant.availability, 'dormant')
  assert.deepEqual(dormant.models, [])
})

test('the projection never mutates official objects; the wiring reads only real registrations', async () => {
  const official = createOfficialLlm()
  const before = JSON.stringify(official.state)
  const projection = createLlmModelsProjection({
    active: () => true,
    llmProvider: () => official.llm,
    facadeRoutes: () => [],
  })
  const rows = await projection.list()
  assert.ok(rows.length > 0)
  assert.equal(JSON.stringify(official.state), before, 'official state untouched')

  // The host wiring must feed the projection from the real registration
  // records only — decoration metadata can never reach the catalog view.
  const source = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.match(source, /facadeRoutes: \(\) => service\._llmAdapterRegistration/, 'wiring anchor: real registrations only')
  assert.doesNotMatch(source, /facadeRoutes: [^\n]*decoration/i)
})

test('official passthrough members keep their shapes and are not merged', async () => {
  const official = createOfficialLlm()
  const providers = official.llm.listProviders()
  assert.deepEqual(providers, [{ id: 'deepseek', name: 'DeepSeek' }], 'official passthrough unchanged by the projection')
  const models = await official.llm.listModels('deepseek')
  assert.deepEqual(models, [{ provider: 'deepseek', id: 'deepseek-chat', name: 'DeepSeek Chat' }])
  const facadeRoutes = () => [{ id: 'deepseek', ownerId: 'p', generation: 1, models: [{ model: 'overlay' }], availability: 'active' }]
  const { projection } = createProjection({ llm: official.llm, facadeRoutes })
  const rows = await projection.list()
  // the projection overlays declared ids onto its own view only
  assert.ok(rows.find((row) => row.provider === 'deepseek').models.some((model) => model.id === 'overlay'))
  assert.deepEqual(await official.llm.listModels('deepseek'), [{ provider: 'deepseek', id: 'deepseek-chat', name: 'DeepSeek Chat' }])
})

test('the projection is typed unavailable without an official seam or when inactive', async () => {
  const { projection } = createProjection({ llm: null })
  await assert.rejects(() => projection.list(), PluginApiFeatureDisabledError)
  const inert = createLlmModelsProjection({
    active: () => false,
    llmProvider: () => createOfficialLlm().llm,
    facadeRoutes: () => [],
  })
  await assert.rejects(() => inert.list(), PluginApiInactiveError)
})
