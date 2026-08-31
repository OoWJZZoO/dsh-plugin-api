/**
 * Neutral integration verification for the official passthrough surfaces
 * (task statement: nine host event names, 46 service keys, exact service
 * member lists, and all approved client public faces). Every assertion here
 * is driven by the reviewed contract fixtures and the real integrated facade paths
 * (host `apply` and the bundled client `apply`); no inventory identifiers or
 * governance classifications appear in this file.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { apply } from '../lib/index.js'
import { composeCatalogs } from '../lib/catalog-compose.js'
import { baseEventsCatalog } from '../lib/events-catalog.js'
import { agentEventsCatalog } from '../lib/agent-events-catalog.js'
import { llmEventsCatalog } from '../lib/llm-events-catalog.js'
import { systemPromptEventsCatalog } from '../lib/system-prompt-events-catalog.js'
import { settingsEventsCatalog } from '../lib/settings-events-catalog.js'
import { sessionLifecycleEventsCatalog } from '../lib/session-events-catalog.js'
import { toolsEventsCatalog } from '../lib/tools-events-catalog.js'
import { SERVICE_DEFINITIONS, SERVICES_NAMESPACE_KEYS } from '../lib/services.js'
import {
  CATALOG_ENTRY_FIELDS,
  HOST_EVENT_CONTRACTS,
  SERVICE_DEFINITION_CONTRACTS,
  CLIENT_SERVICE_CONTRACTS,
  CLIENT_EVENT_CONTRACTS,
  CLIENT_CONNECTION_CONTRACT,
  CONTRACT_CARDINALITIES,
} from './official-passthrough-contracts.mjs'
import { CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS } from '../lib/client-official-passthrough.js'

function noOp() {}

function createTypertRegistry() {
  return {
    register: noOp, get: noOp, resolve: noOp, list: noOp, getPackage: noOp, listPackages: noOp, toJSONSchema: noOp,
    local: { get: noOp, hasSeen: noOp, list: noOp, subscribe: noOp },
    remotes: { register: noOp, get: noOp, list: noOp, subscribe: noOp },
    lookups: { register: noOp, configure: noOp, get: noOp, definitions: noOp, keys: noOp, subscribe: noOp },
    contexts: { registerHost: noOp, configureHost: noOp, registerClient: noOp, getHost: noOp, getClient: noOp, subscribe: noOp },
  }
}

// -- host fixture: every declared capability seam plus the mandatory services --

function createServiceStubs() {
  const stubs = {}
  const calls = {}
  for (const def of SERVICE_DEFINITIONS) {
    const stub = {}
    const callLog = {}
    for (const member of def.members) {
      if (member.optional) continue
      if (member.kind === 'method') {
        stub[member.name] = function (...args) {
          ;(callLog[member.name] ??= []).push([this, args])
          return { member: member.name }
        }
      } else if (member.kind === 'getter') {
        stub[member.name] = { marker: `${def.key}.${member.name}` }
      }
      // forward members are served by the session-reference uri helpers
    }
    stubs[def.ctxService] = stub
    calls[def.key] = callLog
  }
  return { stubs, calls }
}

function createHostCtx() {
  const { stubs, calls } = createServiceStubs()
  const apiProxy = stubs.apiProxy
  apiProxy.sessions = { prompt() {}, selectModel() {} }
  // The host event slices probe provider presence for these two client-facing
  // names; plain owned-key objects satisfy the probe.
  stubs.dynamicCordisRunner = { activeRuns: { marker: 'dynamicCordisRunner.activeRuns' } }
  stubs.cordisInspect = { register: noOp }

  const services = {
    llm: {
      resolveModelInfo() {}, prepareCall() {}, stream() {}, registerAdapter() {},
      registerConfigurableProviders() {}, registerModelDiscovery() {},
    },
    agents: { get() {}, list() {}, roots() {} },
    tools: { register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {} },
    sessions: { get() {}, list() {}, fork() {} },
    settings: { register() {}, describe() { return [] }, get() {}, mutate() {} },
    typert: createTypertRegistry(),
    systemPrompt: { section() {}, context() {}, variable() {}, tools() {}, suppressRuntimeContext() {} },
    ...stubs,
  }
  const state = { pluginApi: undefined }
  const ctx = {
    logger: { error() {}, warn() {} },
    reflect: {
      provide(name, value) {
        if (name === 'pluginApi') {
          state.pluginApi = value
          return () => { state.pluginApi = undefined }
        }
        return () => false
      },
    },
    get(name) {
      if (name === 'pluginApi') return state.pluginApi
      if (name in services) return services[name]
      return undefined
    },
    plugin(Class) { new Class(ctx) },
    effect() {},
    on() { return () => {} },
    once() {}, emit() {}, serial() {}, parallel() {}, bail() {}, waterfall() {},
  }
  return { ctx, state, stubs, calls }
}

// -- client fixture: the bundled facade over faithful browser service shapes --

const bundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

function loadClientBundle() {
  let handoff
  const sandbox = {
    window: { __ModuleLoader__: { load(value) { handoff = value } } },
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    TextEncoder,
    TextDecoder,
  }
  sandbox.globalThis = sandbox
  vm.runInNewContext(bundle, sandbox, { filename: 'client.js' })
  assert.equal(handoff?.id, '@deepseek-ai/dsh-plugin-api-main')
  return handoff.factory(() => { throw new Error('the bundled facade has no cross-plugin runtime imports') })
}

function createClientCtx({ connection } = {}) {
  const services = new Map()
  const listeners = new Map()
  const providers = {}
  for (const { name, members } of CLIENT_SERVICE_CONTRACTS) {
    const provider = {}
    for (const member of members) provider[member] = () => ({ member })
    providers[name] = provider
    services.set(name, provider)
  }
  if (connection !== undefined) services.set('connection', connection)
  const ctx = {
    logger: { error() {} },
    get(name) { return services.get(name) },
    on(name, listener) {
      const bucket = listeners.get(name) ?? new Set()
      bucket.add(listener)
      listeners.set(name, bucket)
      return () => bucket.delete(listener)
    },
    emit(name, ...args) {
      for (const listener of [...(listeners.get(name) ?? [])]) listener(...args)
    },
    reflect: {
      provide(name, value) {
        services.set(name, value)
        return () => services.get(name) === value && services.delete(name)
      },
    },
  }
  return { ctx, providers }
}

function createLlmConnection() {
  const llm = {
    providers() { return Promise.resolve({ providers: [] }) },
    models() { return Promise.resolve([]) },
    discoverModels() { return Promise.resolve({}) },
  }
  return {
    rpc: { call() { return Promise.resolve({}) } },
    api: { settings: { describe() { return 'settings' } }, llm },
  }
}

// -- host integration assertions --

test('host event contracts: all nine names are cataloged with the exact contract fields', () => {
  assert.equal(CONTRACT_CARDINALITIES.hostEvents, 9)
  assert.equal(HOST_EVENT_CONTRACTS.length, 9)
  assert.equal(CONTRACT_CARDINALITIES.catalogFields, CATALOG_ENTRY_FIELDS.length)

  const { ctx, state } = createHostCtx()
  assert.doesNotThrow(() => apply(ctx))
  const catalog = state.pluginApi.events.catalog()
  assert.ok(catalog, 'the mounted facade owns a live catalog')

  // The 47-name baseline union stays intact inside the mounted catalog.
  const baseline = composeCatalogs(
    baseEventsCatalog,
    agentEventsCatalog,
    llmEventsCatalog,
    systemPromptEventsCatalog,
    settingsEventsCatalog,
    sessionLifecycleEventsCatalog,
    toolsEventsCatalog,
  )
  for (const name of Object.keys(baseline)) {
    assert.ok(catalog[name], `baseline event ${name} stays cataloged`)
  }

  for (const entry of HOST_EVENT_CONTRACTS) {
    const mounted = catalog[entry.name]
    assert.ok(mounted, `host event ${entry.name} is cataloged`)
    for (const field of CATALOG_ENTRY_FIELDS) {
      assert.deepEqual(mounted[field], entry[field], `${entry.name}.${field} matches the reviewed contract`)
    }
  }
})

test('service definitions: 46 unique keys with exact reviewed member lists', () => {
  assert.equal(CONTRACT_CARDINALITIES.finalServiceKeys, 46)
  assert.equal(SERVICE_DEFINITIONS.length, 46)
  assert.equal(new Set(SERVICES_NAMESPACE_KEYS).size, 46)
  assert.deepEqual(SERVICE_DEFINITIONS.map((def) => def.key), SERVICES_NAMESPACE_KEYS)

  // The reviewed fragment (28 inputs incl. web) merges 1:1 into the central
  // table with identical member kind/name order.
  for (const contract of SERVICE_DEFINITION_CONTRACTS) {
    const def = SERVICE_DEFINITIONS.find((entry) => entry.key === contract.key)
    assert.ok(def, `contract service ${contract.key} exists in the central table`)
    assert.deepEqual(def.members, contract.members, `${contract.key} keeps its approved member list`)
  }
})

test('mounted services namespace: all 46 seams expose exact active member surfaces and receivers', () => {
  const { ctx, state, stubs, calls } = createHostCtx()
  assert.doesNotThrow(() => apply(ctx))
  const services = state.pluginApi.services
  assert.deepEqual(Object.keys(services).slice(0, 46), SERVICES_NAMESPACE_KEYS, '46 seam keys in table order')

  for (const def of SERVICE_DEFINITIONS) {
    const face = services[def.key]
    const expected = ['isActive', ...def.members.filter((m) => !m.optional).map((m) => m.name)]
    assert.deepEqual(Object.keys(face), expected, `${def.key} exposes exactly its declared members`)
    assert.equal(face.isActive, true, `${def.key} is active`)
    for (const member of def.members) {
      if (member.optional) continue
      if (member.kind === 'getter') {
        assert.equal(face[member.name], stubs[def.ctxService][member.name], `${def.key}.${member.name} forwards the getter value`)
      } else if (member.kind === 'method') {
        assert.equal(typeof face[member.name], 'function', `${def.key}.${member.name} is callable`)
        face[member.name]()
        const latest = calls[def.key][member.name]?.at(-1)
        assert.equal(latest[0], stubs[def.ctxService], `${def.key}.${member.name} keeps the official receiver`)
      } else {
        assert.equal(typeof face[member.name], 'function', `${def.key}.${member.name} forwards`)
      }
    }
  }
})

// -- client integration assertions --

test('bundled client services: all approved service faces with exact member surfaces', () => {
  assert.equal(CONTRACT_CARDINALITIES.clientServices, CLIENT_SERVICE_CONTRACTS.length)
  const { ctx } = createClientCtx({ connection: createLlmConnection() })
  const artifact = loadClientBundle()
  const dispose = artifact.apply(ctx)
  const api = ctx.get('pluginApi')
  const services = api.services

  assert.equal(services.isActive, true)
  const names = CLIENT_SERVICE_CONTRACTS.map((entry) => entry.name)
  const passthroughNames = CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS.map((descriptor) => descriptor.serviceName)
  assert.deepEqual(Object.keys(services), ['isActive', ...names, ...passthroughNames], 'client services namespace in approved order')
  assert.equal(
    names.reduce((total, name) => total + CLIENT_SERVICE_CONTRACTS.find((entry) => entry.name === name).members.length, 0),
    CONTRACT_CARDINALITIES.clientServiceMembers,
  )
  for (const { name, members } of CLIENT_SERVICE_CONTRACTS) {
    const face = services[name]
    assert.deepEqual(Object.keys(face), ['isActive', ...members], `client service ${name} exposes exactly its approved members`)
    assert.equal(face.isActive, true, `client service ${name} is active`)
    for (const member of members) assert.equal(typeof face[member], 'function', `client service ${name}.${member} is callable`)
  }
  dispose()
})

test('bundled client events: the four approved events with slim isActive/on faces', () => {
  assert.equal(CONTRACT_CARDINALITIES.clientEvents, CLIENT_EVENT_CONTRACTS.length)
  const { ctx } = createClientCtx({ connection: createLlmConnection() })
  const artifact = loadClientBundle()
  const dispose = artifact.apply(ctx)
  const events = ctx.get('pluginApi').events

  const faceNames = {
    'locale/change': 'localeChange',
    'theme/change': 'themeChange',
    'connection/reset': 'connectionReset',
    'command/executed': 'commandExecuted',
  }
  assert.deepEqual(Object.keys(events), ['isActive', ...Object.values(faceNames), 'on'])
  assert.equal(events.isActive, true)
  for (const { name, args } of CLIENT_EVENT_CONTRACTS) {
    const face = events[faceNames[name]]
    assert.ok(face, `event face ${faceNames[name]} exists`)
    assert.equal(face.isActive, true)
    assert.equal(typeof face.on, 'function')
    assert.equal(typeof args, 'string', `event ${name} documents call args`)
  }
  assert.equal(typeof events.on, 'function')
  dispose()
})

test('bundled client connection: the nested llm face exposes its three approved members', () => {
  assert.deepEqual(CLIENT_CONNECTION_CONTRACT.members, ['providers', 'models', 'discoverModels'])
  assert.equal(CLIENT_CONNECTION_CONTRACT.members.length, CONTRACT_CARDINALITIES.clientConnectionMembers)
  const { ctx } = createClientCtx({ connection: createLlmConnection() })
  const artifact = loadClientBundle()
  const dispose = artifact.apply(ctx)
  const connection = ctx.get('pluginApi').connection

  assert.equal(connection.isActive, true)
  assert.equal(typeof connection.rpc.call, 'function')
  const llm = connection.api.llm
  assert.ok(llm, 'nested llm face stays mounted from the official connection leaf')
  assert.deepEqual(Object.keys(llm), CLIENT_CONNECTION_CONTRACT.members)
  for (const member of CLIENT_CONNECTION_CONTRACT.members) {
    assert.equal(typeof llm[member], 'function', `connection.llm.${member} is callable`)
  }
  dispose()
})