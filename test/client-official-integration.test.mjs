/**
 * Central integration tests: official client leaves wired into the joined
 * client outer facade (services namespace, event faces, nested llm face).
 *
 * These tests drive the real bundled `apply(ctx)` mount path with faithful
 * official browser service shapes and assert exact surface keys, member
 * identity and forwarding, event subscription through the live event source,
 * per-leaf degradation, fail-open optional providers, reapply, and
 * disposal. The joined facade stays publishable when a leaf is absent or
 * malformed.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

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

const SERVICE_NAMES = Object.freeze([
  'modules', 'locale', 'sessions', 'workspaces', 'chatFileMentions', 'layout',
  'theme', 'appShell', 'sessionLogDownload', 'cordisInspect', 'dynamicCordisRunner',
])

const SERVICE_MEMBERS = Object.freeze({
  modules: ['version', 'loadCache', 'import', 'registerStatic', 'prefetch', 'invalidate'],
  locale: ['getLocale', 'getSnapshot', 'subscribe', 'setLocale', 'register', 'bind'],
  sessions: ['list', 'currentProvideInfo', 'searchResultLimit', 'open', 'openSubagent', 'subagentAddress', 'setSubagentCatalogOpen', 'refreshSubagents', 'noteAgentPreset', 'clear', 'search', 'fork', 'provide', 'scope', 'scopeOf', 'sessionOf', 'binding'],
  workspaces: ['list', 'connectWorkspace', 'startSession', 'create', 'pickDirectory', 'listDirectory', 'createDirectory', 'openPath', 'rename', 'delete', 'insertBefore', 'insertSessionBefore', 'archiveSession'],
  chatFileMentions: ['forClosing'],
  layout: ['toggleSidebar', 'openDetails', 'closeDetails'],
  theme: ['getTheme', 'exportInspectTokens', 'setTheme', 'register', 'overrideTokens'],
  appShell: ['renderApp'],
  sessionLogDownload: ['store', 'download', 'dismiss', 'dispose'],
  cordisInspect: ['register', 'publish', 'query', 'close'],
  dynamicCordisRunner: ['activeRuns', 'lastRunError', 'renderFailures', 'reconcileApprovals', 'approve', 'decline', 'startUserRun', 'subscribe', 'getSnapshot', 'isLoaded'],
})

const VALUE_MEMBERS = Object.freeze({
  modules: new Set(['version', 'loadCache']),
  sessions: new Set(['list', 'currentProvideInfo', 'searchResultLimit']),
  workspaces: new Set(['list']),
  sessionLogDownload: new Set(['store']),
  dynamicCordisRunner: new Set(['activeRuns', 'lastRunError', 'renderFailures']),
})

function createCtx({ omit = [], providers = {}, connection } = {}) {
  const services = new Map()
  const listeners = new Map()
  for (const [name, value] of Object.entries(providers)) services.set(name, value)
  if (connection !== undefined) services.set('connection', connection)
  const ctx = {
    logger: { error() {} },
    get(name) {
      return services.get(name)
    },
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
  return ctx
}

function makeProvider(name) {
  const calls = []
  const provider = {}
  for (const member of SERVICE_MEMBERS[name]) {
    if (VALUE_MEMBERS[name]?.has(member)) {
      const value = { marker: `${name}.${member}` }
      provider[member] = value
      continue
    }
    provider[member] = (...args) => {
      calls.push([member, this, args])
      return { member, args, self: provider }
    }
  }
  return { provider, calls }
}

function makeAllProviders(overrides = {}) {
  const providers = {}
  const fixtures = {}
  for (const name of SERVICE_NAMES) {
    const fixture = overrides[name] ?? makeProvider(name)
    fixtures[name] = fixture
    providers[name] = fixture.provider
  }
  return { providers, fixtures }
}

function makeConnection({ withLlm = true } = {}) {
  const llmCalls = []
  const llm = {
    providers(payload) {
      llmCalls.push(['providers', payload])
      return Promise.resolve({ providers: payload })
    },
    models(signal) {
      llmCalls.push(['models', signal])
      return signal
    },
    discoverModels(payload, signal) {
      llmCalls.push(['discoverModels', payload, signal])
      return Promise.resolve({ payload, signal })
    },
  }
  const connection = {
    rpc: { call(_base, endpoint, body, signal) { return Promise.resolve({ endpoint, body, signal }) } },
    api: { settings: { describe() { return 'settings' } } },
  }
  if (withLlm) connection.api.llm = llm
  return { connection, llm, llmCalls }
}

test('joined client surface exposes exact services, event, and llm faces with identity', () => {
  const { providers, fixtures } = makeAllProviders()
  const { connection } = makeConnection()
  const artifact = loadClientBundle()
  const ctx = createCtx({ providers, connection })
  const dispose = artifact.apply(ctx)
  const api = ctx.get('pluginApi')

  assert.ok(api?.client)
  assert.deepEqual(Object.keys(api.client.services), ['isActive', ...SERVICE_NAMES])
  assert.equal(api.client.services.isActive, true)
  assert.deepEqual(Object.keys(api.client.events), ['isActive', 'localeChange', 'themeChange', 'connectionReset', 'commandExecuted', 'on'])

  for (const name of SERVICE_NAMES) {
    const face = api.client.services[name]
    assert.deepEqual(Object.keys(face), ['isActive', ...SERVICE_MEMBERS[name]])
    assert.equal(face.isActive, true)
    for (const member of SERVICE_MEMBERS[name]) {
      if (VALUE_MEMBERS[name]?.has(member)) {
        assert.equal(face[member], fixtures[name].provider[member], `${name}.${member} value identity`)
      } else {
        const args = [name, 42]
        const returned = face[member](...args)
        assert.equal(returned.self, fixtures[name].provider, `${name}.${member} receiver identity`)
        assert.deepEqual(returned.args, args, `${name}.${member} argument identity`)
      }
    }
  }

  assert.equal(api.client.connection.isActive, true)
  assert.equal(typeof api.client.connection.api.settings.describe, 'function')
  const llm = api.client.connection.api.llm
  assert.deepEqual(Object.keys(llm), ['providers', 'models', 'discoverModels'])
  assert.equal(llm.isActive, undefined, 'the llm face carries only the approved members')
  assert.equal(typeof llm.providers, 'function')
  assert.equal(typeof llm.models, 'function')
  assert.equal(typeof llm.discoverModels, 'function')

  dispose()
})

test('llm connection delegates receiver, payload, signal, and Promise identity', async () => {
  const { connection, llm, llmCalls } = makeConnection()
  const artifact = loadClientBundle()
  const ctx = createCtx({ providers: {}, connection })
  const dispose = artifact.apply(ctx)
  const api = ctx.get('pluginApi')
  const face = api.client.connection.api.llm

  const signal = new AbortController().signal
  const promise = face.providers({ routes: ['x'] })
  assert.ok(promise instanceof Promise)
  assert.deepEqual(await promise, { providers: { routes: ['x'] } })
  const outer = { k: 1 }
  assert.equal(face.models(signal), signal)
  const discovered = face.discoverModels(outer, signal)
  assert.deepEqual(await discovered, { payload: outer, signal })
  assert.deepEqual(llmCalls, [
    ['providers', { routes: ['x'] }],
    ['models', signal],
    ['discoverModels', outer, signal],
  ])
  dispose()
})

test('client events subscribe through the live source with identity, order, and contained failures', () => {
  const artifact = loadClientBundle()
  const ctx = createCtx({ providers: {} })
  const dispose = artifact.apply(ctx)
  const api = ctx.get('pluginApi')
  const events = api.client.events

  const delivered = []
  const first = { id: 1 }
  const second = { id: 2 }
  const off = events.localeChange.on((...args) => delivered.push(['a', ...args]))
  events.themeChange.on(() => { throw new Error('observer failure must be contained') })
  events.themeChange.on((...args) => delivered.push(['b', ...args]))
  events.localeChange.on((...args) => delivered.push(['c', ...args]))

  ctx.emit('locale/change', first)
  ctx.emit('theme/change', second)
  assert.deepEqual(delivered, [['a', first], ['c', first], ['b', second]])
  assert.equal(typeof off, 'function')
  assert.equal(off(), true, 'the disposer unregisters only its own listener')
  ctx.emit('locale/change', first)
  assert.deepEqual(delivered, [['a', first], ['c', first], ['b', second], ['c', first]])

  events.commandExecuted.on((sessionId, commandName, result) => {
    delivered.push(['e', sessionId, commandName, result])
  })
  ctx.emit('command/executed', 's-1', 'run', { ok: true })
  assert.deepEqual(delivered.at(-1), ['e', 's-1', 'run', { ok: true }])
  assert.throws(() => events.on('unsupported/event', () => {}), /unsupported client event/)
  dispose()
})

test('a malformed provider disables only its owning leaf while unrelated leaves stay active', () => {
  const { providers } = makeAllProviders()
  const malformed = { getLocale() {}, getSnapshot() {} }
  providers.locale = malformed
  const artifact = loadClientBundle()
  const ctx = createCtx({ providers })
  const dispose = artifact.apply(ctx)
  const api = ctx.get('pluginApi')

  const locale = api.client.services.locale
  assert.equal(locale.isActive, false)
  assert.throws(() => locale.setLocale('en'), (error) => error.code === 'PLUGIN_API_FEATURE_DISABLED' && error.feature === 'client.locale')
  assert.equal(api.client.services.modules.isActive, true)
  assert.equal(api.client.services.isActive, true, 'a disabled leaf keeps the namespace publishable')
  dispose()
})

test('absent optional providers fail open: faces publish in disabled shape and the facade stays usable', () => {
  const artifact = loadClientBundle()
  // The connection service is present without an api.llm face, so the
  // existing connection face stays active while the llm face fails locally.
  const { connection } = makeConnection({ withLlm: false })
  const ctx = createCtx({ providers: {}, connection })
  const dispose = artifact.apply(ctx)
  const api = ctx.get('pluginApi')

  assert.ok(api?.client)
  assert.equal(api.client.services.isActive, true, 'the services namespace reflects root activity, not per-leaf providers')
  for (const name of SERVICE_NAMES) {
    const face = api.client.services[name]
    assert.equal(face.isActive, false)
    const valueMember = SERVICE_MEMBERS[name].find((member) => VALUE_MEMBERS[name]?.has(member))
    if (valueMember) {
      assert.throws(() => face[valueMember], (error) => error.code === 'PLUGIN_API_FEATURE_DISABLED' && error.feature === `client.${name}`)
    }
    const methodMember = SERVICE_MEMBERS[name].find((member) => !VALUE_MEMBERS[name]?.has(member))
    assert.throws(() => face[methodMember](), (error) => error.code === 'PLUGIN_API_FEATURE_DISABLED' && error.feature === `client.${name}`)
  }
  const llm = api.client.connection.api.llm
  assert.deepEqual(Object.keys(llm), ['providers', 'models', 'discoverModels'])
  assert.throws(() => llm.providers(), (error) => error.code === 'PLUGIN_API_FEATURE_DISABLED' && error.feature === 'client.connection')
  assert.equal(api.client.connection.isActive, true, 'the existing connection face is independent of the llm face')
  dispose()
})

test('the joined facade keeps connection.isActive when the connection service is absent', () => {
  const { providers } = makeAllProviders()
  const artifact = loadClientBundle()
  const ctx = createCtx({ providers }) // no connection service
  const dispose = artifact.apply(ctx)
  const api = ctx.get('pluginApi')

  assert.equal(api.client.connection.isActive, false, 'the existing connection face degrades through its own path')
  assert.throws(() => api.client.connection.api.settings.describe(), (error) => error.code === 'PLUGIN_API_FEATURE_DISABLED' && error.feature === 'clientConnection')
  assert.throws(() => api.client.connection.api.llm.providers(), (error) => error.code === 'PLUGIN_API_FEATURE_DISABLED' && error.feature === 'client.connection')
  dispose()
})

test('reapply reuses the active facade and disposal fully unregisters the surface', async () => {
  const { providers } = makeAllProviders()
  const artifact = loadClientBundle()
  const ctx = createCtx({ providers })
  const dispose = artifact.apply(ctx)
  assert.equal(artifact.apply(ctx), dispose, 'reapply reuses the live facade')
  const api = ctx.get('pluginApi')
  assert.equal(api.client.services.modules.isActive, true)

  assert.equal(await dispose(), true)
  assert.equal(ctx.get('pluginApi'), undefined, 'the provided pluginApi is unregistered on disposal')
  assert.equal(await dispose(), false, 'a second disposal is a no-op')

  const dispose2 = artifact.apply(ctx)
  const api2 = ctx.get('pluginApi')
  assert.ok(api2?.client)
  assert.equal(api2.client.services.modules.isActive, true)
  dispose2()
})
