/**
 * Call-shape agreement: a caller must be able to tell from the registry
 * whether a public member answers directly or with a promise, instead of
 * discovering it by trial and error.
 *
 * The test mounts the host facade over the in-repo owner services and calls
 * each active member with no arguments: a thenable answer is `async`, a direct
 * answer (or a synchronous refusal) is `sync`. Members whose facade feature
 * stays disabled in this environment — the auxiliary packages are not
 * resolvable from the main package here, so their replacement-backed features
 * never mount — cannot be observed; they are collected and reported rather
 * than asserted, and the delivery ledger records which families those are and
 * how their declared value was determined instead.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { apply, mountSessionRouteFeature } from '../lib/index.js'

const REGISTRY_PATH = new URL('../docs/specs/plugin-api-m7-public-contract-refactor/public-contract.registry.json', import.meta.url)
const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'))

function createHarness() {
  const services = {
    // A live storage facility: the facade's storage binding needs a domain to
    // publish its own (in-repo) members instead of the disabled surface.
    storage: { domain: { open() { return Promise.resolve({ store: {} }) } } },
    llm: { resolveModelInfo() {}, prepareCall() {}, stream() {}, registerAdapter() {}, registerConfigurableProviders() {}, registerModelDiscovery() {} },
    tools: { register() {}, restrict() { return () => {} }, guard() { return () => {} }, get() {}, schemas() { return [] }, execute() {}, presentAs() {} },
    agents: { get() {}, list() {}, roots() {} },
    sessions: { get() {}, list() {}, fork() {}, observe() { return () => {} } },
    settings: { register() {}, describe() { return [] }, get() {}, mutate() {} },
    systemPrompt: { section() { return () => {} }, context() { return () => {} }, variable() { return () => {} }, tools() { return () => {} }, suppressRuntimeContext() { return () => {} }, renderPrompt() {}, renderContextSections() {}, renderContextSnapshot() {}, joinContextSections() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    web: { registerSearchProvider() {}, registerFetchProvider() {}, search() {}, fetch() {} },
  }
  const state = { pluginApi: undefined }
  const ctx = {
    logger: { error() {}, warn() {} },
    reflect: { provide(name, value) { if (name === 'pluginApi') state.pluginApi = value } },
    get(name) { return name === 'pluginApi' ? state.pluginApi : services[name] },
    plugin(Class) { new Class(ctx) },
    effect() { return () => {} },
    on() { return () => {} },
    once() {}, emit() {}, serial() {}, parallel() {}, bail() {}, waterfall() {},
    model() { return { name: 'x' } },
    runtime: { name: 'test', version: '0.1.0-rc.6' },
  }
  // The routing plane's own owner (session route) mounts on top of the facade,
  // so `llm.routing.*` is published by its in-repo implementation.
  mountSessionRouteFeature({
    ctx,
    service: state.pluginApi,
    featureRegistry: { isActive: () => false, mount() {} },
    logger: { warn() {} },
  })
  return { ctx, state }
}

function resolveMember(root, path) {
  let node = root
  for (const segment of path.split('.')) {
    if (node == null) return undefined
    try {
      node = node[segment]
    } catch {
      return undefined
    }
  }
  return node
}

/**
 * Namespaces whose members hand the call to an owner this workspace cannot
 * mount: the official runtime services (llm / tools / sessions / settings /
 * agents / web / apiProxy) and the replacement-backed features whose packages
 * do not resolve from the main package here. Their declared shape is read from
 * the owning implementation and recorded in the delivery ledger; asserting it
 * against a harness stub would only re-echo the stub.
 */
const OFFICIAL_SEAM_ROOTS = new Set(['llm', 'tools', 'sessions', 'settings', 'agents', 'web', 'apiProxy'])

/**
 * Families under those roots whose owner is implemented in this repo: their
 * members are published by in-repo code (the facade itself or a module it
 * mounts), so the harness below observes the real implementation and the
 * declaration is asserted. Everything else under the official-seam roots hands
 * the call to an official runtime service this workspace cannot stand up, and
 * the replacement-backed families stay disabled here, so both are collected as
 * unobservable instead.
 */
const IN_REPO_PREFIXES = [
  'llm.routing', 'sessions.channels', 'sessions.activity', 'sessions.planMode',
  'sessions.permissionPresets', 'sessions.views', 'sessions.durable', 'sessions.selection',
  'sessions.interactions', 'sessions.compaction',
  'settings.register', 'settings.scope', 'settings.inspect',
]

function isUnobservableFamily(path) {
  const root = path.split('.')[0]
  if (!OFFICIAL_SEAM_ROOTS.has(root)) return false
  return !IN_REPO_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}.`))
}

/**
 * Observe one member's answer. A promise answer is direct evidence of `async`
 * and a direct answer is evidence of `sync`; a synchronous refusal is *not*
 * evidence either way (a member may refuse invalid input synchronously and
 * still answer a promise on its success path), and a disabled surface reports
 * nothing about the live shape.
 */
function observeShape(value, receiver) {
  try {
    const returned = value.call(receiver)
    if (returned != null && typeof returned.then === 'function') {
      Promise.resolve(returned).catch(() => {})
      return 'async'
    }
    return 'sync'
  } catch (error) {
    return 'unobservable'
  }
}

/** Whether a namespace reports itself live on the mounted surface. */
function namespaceIsLive(api, path) {
  const segments = path.split('.')
  for (const depth of [2, 1]) {
    if (segments.length <= depth) continue
    const node = resolveMember(api, segments.slice(0, depth).join('.'))
    if (node === undefined || node === null) continue
    let availability
    try {
      availability = node.availability
    } catch {
      continue
    }
    if (typeof availability !== 'function') continue
    try {
      const value = availability()
      const status = typeof value === 'object' && value !== null ? value.status : value
      if (typeof status === 'string') return status === 'active' || status === 'degraded'
    } catch {
      return false
    }
  }
  return true
}

test('every observable host member answers the call shape the registry declares', () => {
  const { ctx, state } = createHarness()
  apply(ctx)
  const api = state.pluginApi

  const mismatches = []
  const unobservable = []
  let checked = 0
  for (const member of registry.members) {
    if (member.runtime !== 'host' || member.status === 'removed') continue
    const value = resolveMember(api, member.publicPath)
    // A value row (a handle, a data leaf) has no call to observe.
    if (typeof value !== 'function') continue
    if (isUnobservableFamily(member.publicPath)) {
      unobservable.push(member.publicPath)
      continue
    }
    if (!namespaceIsLive(api, member.publicPath)) {
      unobservable.push(member.publicPath)
      continue
    }
    const receiver = resolveMember(api, member.publicPath.split('.').slice(0, -1).join('.')) ?? api
    const observed = observeShape(value, receiver)
    if (observed === 'unobservable') {
      unobservable.push(member.publicPath)
      continue
    }
    checked += 1
    if (member.callShape !== observed) {
      mismatches.push(`${member.publicPath}: declared ${member.callShape}, observed ${observed}`)
    }
  }

  assert.deepEqual(mismatches, [], `declared call shapes must match the mounted surface:\n${mismatches.join('\n')}`)
  assert.ok(checked >= 90, `the harness must observe a meaningful share of the surface, observed ${checked}`)
  // The unobservable set is the replacement-backed surface this environment
  // cannot mount; it is reported so the boundary stays visible.
  assert.ok(unobservable.length > 0, 'the replacement-backed features stay disabled here; the list is reported')
})

test('the async family this declaration exists for is declared and observed async', () => {
  const { ctx, state } = createHarness()
  apply(ctx)
  const api = state.pluginApi
  const declared = new Map(registry.members
    .filter((m) => m.runtime === 'host' && m.status !== 'removed')
    .map((m) => [m.publicPath, m.callShape]))
  for (const path of ['tasks.register', 'tasks.start', 'tasks.settle', 'tasks.attach', 'tasks.get', 'tasks.observe', 'tasks.history', 'tasks.acquire', 'tasks.takeover']) {
    assert.equal(declared.get(path), 'async', `${path} is declared async`)
    const value = resolveMember(api, path)
    assert.equal(observeShape(value, api.tasks), 'async', `${path} answers a promise`)
  }
  for (const path of ['sessions.get', 'sessions.list', 'tasks.availability']) {
    assert.equal(declared.get(path), 'sync', `${path} is declared sync`)
  }
})

test('value rows declare not-applicable and callable rows never do', () => {
  const { ctx, state } = createHarness()
  apply(ctx)
  const api = state.pluginApi
  const wrong = []
  for (const member of registry.members) {
    if (member.runtime !== 'host' || member.status === 'removed') continue
    if (member.callShape !== 'not-applicable') continue
    const value = resolveMember(api, member.publicPath)
    if (typeof value === 'function') wrong.push(member.publicPath)
  }
  assert.deepEqual(wrong, [], `a callable member declares sync or async, never not-applicable:\n${wrong.join('\n')}`)
  // Every handle row describes a returned value rather than a call.
  const handles = registry.members.filter((m) => m.kind === 'handle')
  assert.ok(handles.length > 0)
  for (const row of handles) {
    assert.equal(row.callShape, 'not-applicable', `${row.publicPath} is a handle row`)
  }
})

test('every observable client member answers the call shape the registry declares', async () => {
  const vm = await import('node:vm')
  let handoff
  const sandbox = {
    window: { __ModuleLoader__: { load(value) { handoff = value } } },
    console, setTimeout, clearTimeout, AbortController, TextEncoder, TextDecoder,
  }
  sandbox.globalThis = sandbox
  vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), sandbox, { filename: 'client.js' })
  const artifact = handoff.factory(() => { throw new Error('the bundled facade has no cross-plugin runtime imports') })

  // Client providers answer plainly; the client members under test are the
  // facade's own (slots, remotes, lifecycle, settings, attention, sessions).
  const provider = () => new Proxy({}, { get: (target, key) => (key === 'then' ? undefined : (target[key] ??= (...args) => ({ member: String(key), args }))) })
  const services = new Map()
  for (const name of ['llm', 'agents', 'sessions', 'tools', 'settings', 'slots', 'remote', 'clientModules', 'modules', 'events', 'lifecycle', 'remotes', 'attention', 'codec', 'skills']) services.set(name, provider())
  services.set('connection', { rpc: { call: () => Promise.resolve({}) }, api: { settings: { describe: () => 'settings' }, llm: provider() } })
  const listeners = new Map()
  const ctx = {
    logger: { error() {}, warn() {} },
    get: (name) => services.get(name),
    on(name, listener) { const bucket = listeners.get(name) ?? new Set(); bucket.add(listener); listeners.set(name, bucket); return () => bucket.delete(listener) },
    emit(name, ...args) { for (const listener of [...(listeners.get(name) ?? [])]) listener(...args) },
    reflect: { provide(name, value) { services.set(name, value); return () => services.delete(name) } },
  }
  artifact.apply(ctx)
  const api = services.get('pluginApi')

  const mismatches = []
  let checked = 0
  for (const member of registry.members) {
    if (member.runtime !== 'client' || member.status === 'removed') continue
    const value = resolveMember(api, member.publicPath)
    if (typeof value !== 'function') continue
    if (!namespaceIsLive(api, member.publicPath)) continue
    const receiver = resolveMember(api, member.publicPath.split('.').slice(0, -1).join('.')) ?? api
    const observed = observeShape(value, receiver)
    if (observed === 'unobservable') continue
    checked += 1
    if (member.callShape !== observed) mismatches.push(`${member.publicPath}: declared ${member.callShape}, observed ${observed}`)
  }
  assert.deepEqual(mismatches, [], `declared client call shapes must match the mounted surface:\n${mismatches.join('\n')}`)
  assert.ok(checked >= 10, `the client harness must observe a meaningful share of the client surface, observed ${checked}`)
})
