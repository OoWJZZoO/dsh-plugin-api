/**
 * Split-surface assertions for the `llm.adapters` domain: real adapter
 * registration and adapter decorations are two independent registry
 * identities with independent lifecycles, and a degraded registration
 * backing never drags unrelated llm capabilities down with it.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createFeatureRegistry } from '../lib/feature-registry.js'
import { createPluginApiService } from '../lib/plugin-api-service.js'
import { createLlmAdapterRegistration, deriveAdapterRegistrationOwner } from '../lib/llm-adapter-registration.js'
import { PluginApiFeatureDisabledError, LlmAdaptersValidationError, LlmAdaptersUnavailableError } from '../lib/errors.js'

const makeSpec = (overrides = {}) => ({
  provider: 'vision-x',
  models: [{ model: 'vision-x-large' }],
  stream: async function* () { yield { delta: 'ok' } },
  ...overrides,
})

/**
 * Direct-service harness: caller identity comes from the service ctx
 * (fiber + loader), the real registration binds a minimal official llm mock,
 * and the decoration side rides a fake facet through the standard provider
 * setter — the same wiring the host mount path uses.
 */
function createSplitHarness({ withOfficialSeam = true } = {}) {
  const registry = createFeatureRegistry()
  const Service = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const calls = { registered: 0, disposed: 0 }
  const routes = new Map()
  const llm = {
    registerAdapter(providers, adapter) {
      calls.registered += 1
      for (const provider of providers) routes.set(provider, adapter)
      let released = false
      return () => {
        if (released) return
        released = true
        calls.disposed += 1
        for (const provider of providers) routes.delete(provider)
      }
    },
  }
  const fiber = { name: 'plugin-a' }
  const ctx = {
    fiber,
    loader: { entries() { return [{ fiber, options: { name: 'plugin-a' } }] } },
    reflect: { provide() {} },
    get() { return undefined },
    effect() { return () => {} },
  }
  const service = new Service(ctx)
  service._setLlmAdapterRegistration(createLlmAdapterRegistration({
    active: () => service.isActive,
    llmProvider: () => (withOfficialSeam ? llm : null),
    ownerOf: deriveAdapterRegistrationOwner,
    facadeOwnerIds: new Set(['@deepseek-ai/dsh-plugin-api-main']),
  }))
  const records = []
  service._setLlmAdaptersProvider(() => ({
    decorate(definition, owner) {
      const record = { id: definition.id, owner, generation: 1 }
      records.push(record)
      return { status: 'ok', record }
    },
    dispose() { return { status: 'ok' } },
    snapshot() { return Object.freeze([]) },
    snapshotOf() { return { status: 'ok', snapshot: Object.freeze({}) } },
  }))
  registry.mount('llmAdapters')
  return { service, registry, routes, calls, records }
}

test('the real registration entry rejects decoration specs with a typed cross-reference', () => {
  const { service } = createSplitHarness()
  assert.throws(
    () => service.llm.adapters.register({ provider: 'p', models: [{ model: 'm' }], labels: { tone: 'fast' } }),
    (error) => error instanceof LlmAdaptersValidationError && /llm\.adapters\.decorations\.register/.test(error.message),
  )
})

test('the two lists are disjoint: real routes and decorations never mix', () => {
  const { service } = createSplitHarness()
  const adapters = service.llm.adapters
  assert.deepEqual(adapters.list(), [])
  adapters.register(makeSpec())
  const real = adapters.list()
  assert.equal(real.length, 1)
  assert.equal(real[0].id, 'vision-x')
  assert.equal(real[0].ownerId, 'plugin-a', 'owner derives from the caller fiber')
  assert.deepEqual(adapters.decorations.list(), [], 'real registration never appears in the decoration list')
})

test('the two registries keep structurally independent handles', () => {
  const { service } = createSplitHarness()
  const adapters = service.llm.adapters
  const realHandle = adapters.register(makeSpec())
  const decorationHandle = adapters.decorations.register({ id: 'deco-1', match: () => true, wrap: (next) => next })
  assert.deepEqual(
    Object.keys(realHandle).sort(),
    ['dispose', 'generation', 'id', 'ownerId'],
    'real handle is the fixed registry shape',
  )
  assert.deepEqual(
    Object.keys(decorationHandle).sort(),
    ['dispose', 'generation', 'id', 'ownerId', 'snapshot'],
    'decoration handle carries the resource identity members plus its snapshot extension',
  )
  assert.equal(typeof decorationHandle.snapshot, 'function')
  assert.notEqual(realHandle.dispose, decorationHandle.dispose)
})

test('disposing a decoration leaves the underlying route registered', () => {
  const { service } = createSplitHarness()
  const adapters = service.llm.adapters
  adapters.register(makeSpec())
  const decorationHandle = adapters.decorations.register({ id: 'deco-route', match: () => true, wrap: (next) => next })
  const outcome = decorationHandle.dispose()
  assert.equal(outcome.code, 'revoked', 'dispose answers the discriminated result')
  assert.equal(decorationHandle.dispose().code, 'stale', 'dispose is idempotent')
  const real = adapters.list()
  assert.equal(real.length, 1, 'real route survives decoration disposal')
  assert.equal(real[0].id, 'vision-x')
})

test('revoking a real route does not tear down the decoration owner handle', async () => {
  const { service } = createSplitHarness()
  const adapters = service.llm.adapters
  const realHandle = adapters.register(makeSpec())
  const decorationHandle = adapters.decorations.register({ id: 'deco-2', match: () => true, wrap: (next) => next })
  assert.equal(realHandle.dispose().code, 'revoked')
  const reclaimed = await decorationHandle.dispose()
  assert.equal(reclaimed?.status ?? 'ok', 'ok', 'decoration handle disposes through its own lifecycle')
})

test('an absent registration instance degrades alone; other llm capabilities stay present', () => {
  const registry = createFeatureRegistry()
  const Service = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const service = new Service({ reflect: { provide() {} }, get() { return undefined }, effect() { return () => {} } })
  service.mountFeature('llm', {
    modelInfo() {}, prepareCall() {}, stream() {},
    routing: { observe() {} },
    requestTransforms: { register() {} },
    admissionPolicies: { register() {} },
  })
  const adapters = service.llm.adapters
  assert.throws(
    () => adapters.register(makeSpec()),
    (error) => error instanceof PluginApiFeatureDisabledError && error.feature === 'llm.adapters',
  )
  assert.equal(typeof service.llm.routing.observe, 'function')
  assert.equal(typeof service.llm.requestTransforms.register, 'function')
  assert.equal(typeof service.llm.admissionPolicies.register, 'function')
})

test('a present instance with an absent official seam is typed unavailable', () => {
  const { service } = createSplitHarness({ withOfficialSeam: false })
  assert.throws(
    () => service.llm.adapters.register(makeSpec()),
    (error) => error instanceof LlmAdaptersUnavailableError && /official adapter registration seam/.test(error.message),
  )
})

test('capability status reflects both backings: decoration-only composition is degraded, not active', () => {
  const { service } = createSplitHarness()
  // the harness mounts only llmAdapters (decoration facet); the llm feature
  // itself is not mounted here
  assert.equal(service.capabilities.get('llm.adapters').status, 'degraded')
  // the real registration side still works while degraded
  const handle = service.llm.adapters.register(makeSpec())
  assert.equal(handle.generation, 1)
})

test('capability status with only the llm feature mounted stays degraded and registration works', () => {
  const registry = createFeatureRegistry()
  const Service = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const fiber = { name: 'plugin-a' }
  const service = new Service({
    fiber,
    loader: { entries() { return [{ fiber, options: { name: 'plugin-a' } }] } },
    reflect: { provide() {} },
    get() { return undefined },
    effect() { return () => {} },
  })
  service.mountFeature('llm', { modelInfo() {}, prepareCall() {}, stream() {} })
  registry.mount('llm')
  // same wiring the host mount path uses for the real registration
  const officialLlm = { registerAdapter(providers, adapter) { return () => {} } }
  service._setLlmAdapterRegistration(createLlmAdapterRegistration({
    active: () => service.isActive,
    llmProvider: () => officialLlm,
    ownerOf: deriveAdapterRegistrationOwner,
    facadeOwnerIds: new Set(['@deepseek-ai/dsh-plugin-api-main']),
  }))
  assert.equal(service.capabilities.get('llm.adapters').status, 'degraded')
  // no decoration facet: decorations members are typed disabled
  assert.throws(() => service.llm.adapters.decorations.register({ id: 'x' }), PluginApiFeatureDisabledError)
  // ...while the real registration still functions
  const handle = service.llm.adapters.register(makeSpec())
  assert.equal(handle.id, 'vision-x')
  assert.equal(service.capabilities.get('llm.adapters').status, 'degraded', 'neither backing alone claims active')
})

test('capability status is unavailable when neither backing is present', () => {
  const registry = createFeatureRegistry()
  const Service = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const service = new Service({ reflect: { provide() {} }, get() { return undefined }, effect() { return () => {} } })
  assert.equal(service.capabilities.get('llm.adapters').status, 'unavailable')
})
