/**
 * Host / client same-path parity for the settings scope entry.
 *
 * One code body — `scope({ namespace }) -> get() -> watch() -> unsubscribe` — is
 * invoked verbatim against both mounts; only the mount preparation differs.
 * The parity obligation is about the call shape a plugin can write once, not
 * about the two ends answering the same instance: the host reacquires the
 * binding it registered, the client binds the official browser scope, and each
 * end keeps its own declared members (the host handle's release, the official
 * scope's raw members on the client).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { apply as applyHost } from '../lib/index.js'
import { apply as applyClient } from '../lib/client-runtime.js'
import { bootFixture, settleAll } from './official-passthrough-fixture.mjs'

const NAMESPACE = 'sharedScopeBody'
const SNAPSHOT = Object.freeze({ namespace: NAMESPACE, theme: 'dark' })

/**
 * The shared code body. Both ends run this exact function: the canonical object
 * subject, the shared read member, the shared subscribe member, and the
 * unsubscribe it answers.
 */
function sharedScopeCodeBody(api, namespace) {
  const scope = api.settings.scope({ namespace })
  assert.equal(Object.isFrozen(scope), true, 'the scope answer is frozen on both ends')
  const snapshot = scope.get()
  const seen = []
  const unsubscribe = scope.watch((value) => { seen.push(value) })
  assert.equal(typeof unsubscribe, 'function', 'watch answers an unsubscribe on both ends')
  unsubscribe()
  return { scope, snapshot, seen }
}

function createHostMount() {
  const services = {
    llm: { resolveModelInfo() {}, prepareCall() {}, stream() {}, registerAdapter() {}, registerConfigurableProviders() {}, registerModelDiscovery() {} },
    tools: { register() {}, get() {}, schemas() { return [] }, execute() { return { ok: true } } },
    agents: { get() {}, list() {}, roots() {} },
    sessions: { get() {}, list() {}, fork() {} },
    settings: {
      register() {
        return { watch() { return () => true }, update() {}, replace() {} }
      },
      get(namespace) { return { ...SNAPSHOT, namespace } },
      describe() { return [] },
      mutate() { return { ok: true, commitState: 'committed' } },
    },
    systemPrompt: { section() {}, context() {}, variable() {}, tools() {}, suppressRuntimeContext() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
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
  return { ctx, state }
}

/** The client mount binds the official browser scope; its official members stay raw. */
function createClientMount() {
  const scope = {
    getSnapshot() { return { ...SNAPSHOT } },
    subscribe() { return () => true },
    set() {},
    unset() {},
  }
  const { ctx } = bootFixture({
    override(context) {
      const read = context.get.bind(context)
      context.get = (name) => (name === 'settingsScope' ? { bind: () => scope } : read(name))
    },
  })
  return { ctx, scope }
}

test('the same settings scope code body runs against the host and the client mount', async () => {
  const { ctx: hostCtx, state } = createHostMount()
  applyHost(hostCtx)
  const hostApi = state.pluginApi
  // The host reacquires a binding, so its mount registers the namespace first;
  // the code body itself is unchanged.
  hostApi.settings.register(NAMESPACE, { type: 'object' })
  const hostOutcome = sharedScopeCodeBody(hostApi, NAMESPACE)

  const { ctx: clientCtx } = createClientMount()
  const disposeClient = applyClient(clientCtx)
  await settleAll()
  const clientOutcome = sharedScopeCodeBody(clientCtx.get('pluginApi'), NAMESPACE)
  await disposeClient()

  // The shared body answered the same facts through the same member names.
  assert.deepEqual(hostOutcome.snapshot, SNAPSHOT)
  assert.deepEqual(clientOutcome.snapshot, { ...SNAPSHOT })
  assert.deepEqual(hostOutcome.seen, [], 'registering a watcher delivers nothing spontaneously')
  assert.deepEqual(clientOutcome.seen, [])

  // Each end keeps its own declared members rather than a smoothed-over union.
  assert.equal(typeof hostOutcome.scope.dispose, 'function', 'the host handle carries its release')
  assert.equal(hostOutcome.scope.id, NAMESPACE, 'the host handle names the binding it reacquired')
  assert.equal(clientOutcome.scope.dispose, undefined, 'the client view has no facade release to answer')
  for (const member of ['getSnapshot', 'subscribe', 'set', 'unset']) {
    assert.equal(typeof clientOutcome.scope[member], 'function', `the official member ${member} stays available`)
  }
})

test('the bare namespace string stays a declared difference: host convenience, client typed refusal', async () => {
  const { ctx: hostCtx, state } = createHostMount()
  applyHost(hostCtx)
  const hostApi = state.pluginApi
  hostApi.settings.register(NAMESPACE, { type: 'object' })
  // The host keeps the bare string as a convenience form for the same binding.
  assert.equal(hostApi.settings.scope(NAMESPACE).id, NAMESPACE)

  const { ctx: clientCtx } = createClientMount()
  const disposeClient = applyClient(clientCtx)
  await settleAll()
  const clientApi = clientCtx.get('pluginApi')
  // The client refuses anything but the canonical subject, with a typed error.
  assert.throws(
    () => clientApi.settings.scope(NAMESPACE),
    (error) => error.code === 'PLUGIN_API_SETTINGS_SCOPE_INVALID_INPUT',
    'a bare string is a typed input error on the client, never a silent binding',
  )
  await disposeClient()
})
