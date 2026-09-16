/**
 * Caller-derived owner contract across the semantic namespaces.
 *
 * Evidence for the owner-deriving write paths (caller identity is derived, never
 * accepted from the caller): every member that
 * needs an owner derives it from the *calling* plugin's context, a
 * caller-supplied owner label is ignored rather than trusted, and two callers
 * can never share a resource slot. The caller view is built the way Cordis
 * binds it: `Object.create(service)` with the accessing context as `ctx`, so a
 * method-style getter on the facade sees that context as its receiver. A
 * `get: () => {}` getter cannot do this — it closes over the facade service and
 * would derive the facade's own identity.
 *
 * The prompts contribution face carries the same contract; its cross-owner
 * evidence lives in `test/scoped-agent-contributions-e2e.test.mjs`
 * ("two contributors on one target coexist with owner attribution").
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createFeatureRegistry } from '../lib/feature-registry.js'
import { createPluginApiService } from '../lib/plugin-api-service.js'

function createService() {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  return new ServiceClass({ reflect: { provide() {} } })
}

/** A caller-bound view of the facade for one synthetic plugin fiber. */
function forCaller(service, name) {
  const fiber = { name }
  const ctx = { fiber, loader: { entries: () => [{ fiber, options: { name } }] } }
  const shadow = Object.create(service)
  Object.defineProperty(shadow, 'ctx', { value: ctx, enumerable: true, configurable: true })
  return shadow
}

test('storage.open forwards the caller context the owner label is derived from', async () => {
  const service = createService()
  const received = []
  service.mountFeature('storage', {
    open: async (...args) => {
      received.push(args)
      return { close: async () => {}, table: () => ({ keys: () => [], delete: async () => true }) }
    },
    availability: () => ({ status: 'active' }),
  })

  await forCaller(service, 'plugin-a').storage.open({
    scope: 'workspace', owner: 'someone-else', schema: 'com.example.todo', version: 1, name: 'todos',
  })
  assert.equal(received.length, 1)
  // The facade derives nothing itself: it hands the calling context along as the
  // trailing argument, and the binding turns it into the unit's owner label
  // (the namespaced unit name itself is covered by test/storage-binding.test.mjs).
  assert.equal(received[0][1]?.fiber?.name, 'plugin-a',
    'the caller context rides along, so a supplied owner label cannot claim another namespace')

  await forCaller(service, 'plugin-b').storage.open({
    scope: 'workspace', schema: 'com.example.todo', version: 1, name: 'todos',
  })
  assert.equal(received[1][1]?.fiber?.name, 'plugin-b', 'the second caller is not attributed to the first')
})

test('a namespace view taken by one caller keeps that caller identity when used later', async () => {
  const service = createService()
  const opened = []
  service.mountFeature('storage', {
    open: async (...args) => {
      opened.push(args)
      return { close: async () => {}, table: () => ({ keys: () => [], delete: async () => true }) }
    },
    availability: () => ({ status: 'active' }),
  })

  // A takes the namespace view, then B reads the same namespace, then both use
  // their own views. The binding must live in the view, not in shared state.
  const viewA = forCaller(service, 'plugin-a').storage
  const viewB = forCaller(service, 'plugin-b').storage
  await viewA.open({ scope: 'workspace', schema: 'com.example.todo', version: 1, name: 'alpha' })
  await viewB.open({ scope: 'workspace', schema: 'com.example.todo', version: 1, name: 'beta' })

  assert.equal(opened[0][1]?.fiber?.name, 'plugin-a', 'the earlier view keeps its own caller identity')
  assert.equal(opened[1][1]?.fiber?.name, 'plugin-b', 'a later visitor never rewrites an earlier view')
})

test('a namespace view follows a remounted slot instead of answering for the dead one', async () => {
  const service = createService()
  const first = []
  const second = []
  const spy = (sink) => ({
    open: async (...args) => {
      sink.push(args)
      return { close: async () => {}, table: () => ({ keys: () => [], delete: async () => true }) }
    },
    availability: () => ({ status: 'active' }),
  })

  const token = service.mountFeature('storage', spy(first))
  // One caller receiver reused across both reads: a fresh receiver per read
  // would carry its own empty cache and let an identity-keyed (slot-less)
  // cache pass this test by accident.
  const caller = forCaller(service, 'plugin-a')
  const viewBefore = caller.storage
  assert.equal(typeof viewBefore.open, 'function')

  // Remount: the facade replaces the slot object behind the same namespace.
  service.unmountFeature('storage', token)
  service.mountFeature('storage', spy(second))

  const viewAfter = caller.storage
  assert.notEqual(viewAfter, viewBefore, 'a view is bound to its slot, so a remount yields a fresh view')
  const outcome = await viewAfter.open({ scope: 'workspace', schema: 'com.example.todo', version: 1, name: 'todos' })
  assert.notEqual(outcome?.code, 'disabled', 'the remounted slot must not answer through the dead view')
  assert.equal(second.length, 1, 'the remounted slot received the call')
})

test('security policy registration receives the caller-derived owner, not a caller-declared one', () => {
  const service = createService()
  const seen = []
  service.mountFeature('security', {
    policy: { register: (ownerId, spec) => { seen.push(ownerId); return { id: spec.id, ownerId, generation: 'g', dispose: () => ({ ok: true, code: 'revoked' }) } } },
    redaction: { register: () => { throw new Error('unused') } },
    egress: { register: () => { throw new Error('unused') }, lease: { acquire() {}, release() {} }, coverage: () => ({}) },
    audit: { list: () => ({ records: [] }) },
    availability: () => ({ status: 'active' }),
  })

  const handle = forCaller(service, 'plugin-a').security.policy.register({ id: 'p-1', point: 'approval-before' })
  assert.equal(seen[0], 'plugin-a', 'the owner argument is the derived caller identity')
  assert.equal(handle.ownerId, 'plugin-a')

  forCaller(service, 'plugin-b').security.policy.register({ id: 'p-1', point: 'approval-before' })
  assert.deepEqual(seen, ['plugin-a', 'plugin-b'], 'each caller binds to its own identity')
})

test('workspaces.transactions.prepare forwards the caller context it derives the owner from', async () => {
  const service = createService()
  const received = []
  const noop = async () => ({ ok: true })
  service.mountFeature('workspaceTransactions', {
    prepare: async (...args) => { received.push(args); return { ok: true, transactionId: 'tx-1', state: 'prepared' } },
    record: noop, preview: noop, commit: noop, rollback: noop, recover: noop, get: noop, observe: () => () => {},
  })

  await forCaller(service, 'plugin-a').workspaces.transactions.prepare({ transactionId: 'tx-1' })
  assert.equal(received[0][0].ownerId, undefined, 'the public spec carries no owner')
  assert.equal(received[0][1]?.fiber?.name, 'plugin-a', 'the caller context rides along as the trailing argument')

  await forCaller(service, 'plugin-b').workspaces.transactions.prepare({ transactionId: 'tx-2' })
  assert.equal(received[1][1]?.fiber?.name, 'plugin-b', 'the second caller is not attributed to the first')
})

/**
 * The registration members below all derive their owner from the caller. Each
 * view is bound to the caller that took it; a later visitor reading the same
 * namespace must not rewrite an earlier view (the failure mode of binding the
 * caller on the shared slot: last accessor wins).
 */
test('llm.requestTransforms.register carries the caller identity from the view that was taken', () => {
  const service = createService()
  const seen = []
  service.mountFeature('llm/request', {
    transform: (spec, callerCtx) => { seen.push(callerCtx?.fiber?.name); return { id: spec.id, ok: true } },
  })

  const leafA = forCaller(service, 'plugin-a').llm.requestTransforms
  const leafB = forCaller(service, 'plugin-b').llm.requestTransforms
  leafA.register({ id: 't-1' })
  leafB.register({ id: 't-2' })

  assert.deepEqual(seen, ['plugin-a', 'plugin-b'], 'each leaf keeps the identity of the caller that took it')
})

test('llm.admissionPolicies.register carries the caller identity from the view that was taken', () => {
  const service = createService()
  const seen = []
  service.mountFeature('llm/admission', {
    register: (policy, callerCtx) => { seen.push(callerCtx?.fiber?.name); return { id: policy.id, ok: true } },
  })

  const leafA = forCaller(service, 'plugin-a').llm.admissionPolicies
  const leafB = forCaller(service, 'plugin-b').llm.admissionPolicies
  leafA.register({ id: 'p-1' })
  leafB.register({ id: 'p-2' })

  assert.deepEqual(seen, ['plugin-a', 'plugin-b'], 'each leaf keeps the identity of the caller that took it')
})

test('diagnostics.register carries the caller identity from the view that was taken', () => {
  const service = createService()
  const seen = []
  service.mountFeature('diagnostics', {
    register: (spec, callerCtx) => { seen.push(callerCtx?.fiber?.name); return { id: spec.id, ok: true } },
    get: () => undefined,
    observe: () => () => {},
  })

  const faceA = forCaller(service, 'plugin-a').diagnostics
  const faceB = forCaller(service, 'plugin-b').diagnostics
  faceA.register({ id: 'check-1' })
  faceB.register({ id: 'check-2' })

  assert.deepEqual(seen, ['plugin-a', 'plugin-b'], 'each face keeps the identity of the caller that took it')
})

test('tools.discovery.catalog.register carries the caller identity from the view that was taken', () => {
  const service = createService()
  const seen = []
  service.mountFeature('tools')
  service.mountFeature('toolDiscovery', {
    catalog: { register: (entry, callerCtx) => { seen.push(callerCtx?.fiber?.name); return { id: entry.id, ok: true } } },
    list: () => [],
    activate: () => ({ ok: true }),
    deactivate: () => ({ ok: true }),
    audit: { list: () => [] },
    availability: () => ({ status: 'active' }),
  })

  const faceA = forCaller(service, 'plugin-a').tools.discovery
  const faceB = forCaller(service, 'plugin-b').tools.discovery
  faceA.catalog.register({ id: 'entry-1' })
  faceB.catalog.register({ id: 'entry-2' })

  assert.deepEqual(seen, ['plugin-a', 'plugin-b'], 'each face keeps the identity of the caller that took it')
})

test('executions.visibility.register derives the owner from the caller that reads the namespace', () => {
  const service = createService()
  const seen = []
  service.mountFeature('execution', {
    observe: () => () => {},
    get: () => undefined,
    history: () => ({ items: [] }),
    visibility: {
      register: (spec) => {
        seen.push(spec.ownerId)
        return () => true
      },
    },
    availability: () => ({ status: 'active' }),
  })

  const viewA = forCaller(service, 'plugin-a')
  const first = viewA.executions.visibility.register({ id: 'v-1', ownerId: 'someone-else', filter: () => true })
  const second = forCaller(service, 'plugin-b').executions.visibility.register({ id: 'v-1', ownerId: 'someone-else', filter: () => true })
  const third = viewA.executions.visibility.register({ id: 'v-2', ownerId: 'someone-else', filter: () => true })

  assert.deepEqual(seen, ['plugin-a', 'plugin-b', 'plugin-a'], 'each caller binds to its own derived identity')
  assert.equal(first.ownerId, 'plugin-a')
  assert.equal(second.ownerId, 'plugin-b')
  // The generation sequence is the service's, not the view's: consecutive
  // registrations across two views advance 1 → 2 → 3. A per-view counter
  // would hand out 1 → 1 → 2 and fail here.
  const sequence = [first, second, third].map((handle) => Number(`${handle.generation}`.split(':').pop()))
  assert.deepEqual(sequence, [1, 2, 3], 'the service keeps one advancing generation sequence')
  const later = forCaller(service, 'plugin-a').executions.visibility.register({ id: 'v-3', filter: () => true })
  assert.equal(Number(`${later.generation}`.split(':').pop()), 4, 'a fresh view continues the service sequence')
  assert.equal(first.dispose().code, 'revoked')
  assert.equal(first.dispose().code, 'stale')
})

test('prompts.provenance.contribute carries the caller identity of the view that took it', () => {
  const service = createService()
  const seen = []
  service.mountFeature('context', {
    contribute: (spec) => {
      seen.push(spec.owner)
      return { ok: true, handle: { id: spec.id, dispose: () => ({ ok: true, already: false }) } }
    },
    compose: () => ({ nodes: [] }),
    inspect: () => ({}),
    mapping: () => ({}),
    policy: { register: () => ({ id: 'p', ownerId: 'o', generation: 'g', dispose: () => ({ ok: true, code: 'revoked' }) }) },
    observe: () => () => {},
    availability: () => ({ status: 'active' }),
  })

  // Each caller takes its own prompts view; the contribution owner must follow
  // that view's identity rather than the facade's own.
  const first = forCaller(service, 'plugin-a').prompts.provenance.contribute({ id: 'node-1', owner: 'someone-else', kind: 'section' })
  const second = forCaller(service, 'plugin-b').prompts.provenance.contribute({ id: 'node-1', owner: 'someone-else', kind: 'section' })

  assert.deepEqual(seen, ['plugin-a', 'plugin-b'], 'the engine receives each caller identity')
  assert.equal(first.handle.ownerId, 'plugin-a')
  assert.equal(second.handle.ownerId, 'plugin-b')
})

test('a taken registration view survives a later visitor and a remount', () => {
  const service = createService()
  const first = []
  const second = []
  const catalog = (sink) => ({
    catalog: { register: (entry, callerCtx) => { sink.push(callerCtx?.fiber?.name); return { id: entry.id, ok: true } } },
    list: () => [],
    activate: () => ({ ok: true }),
    deactivate: () => ({ ok: true }),
    audit: { list: () => [] },
    availability: () => ({ status: 'active' }),
  })

  service.mountFeature('tools')
  const token = service.mountFeature('toolDiscovery', catalog(first))
  const caller = forCaller(service, 'plugin-a')
  const viewBefore = caller.tools.discovery

  // A later visitor must not steal the binding held by the earlier view.
  forCaller(service, 'plugin-b').tools.discovery.catalog.register({ id: 'other' })
  viewBefore.catalog.register({ id: 'alpha' })
  assert.deepEqual(first.map((name, index) => [index, name]), [[0, 'plugin-b'], [1, 'plugin-a']],
    'the earlier view still reports its own caller')

  // A remounted slot yields a fresh view that answers for the live surface.
  service.unmountFeature('toolDiscovery', token)
  service.mountFeature('toolDiscovery', catalog(second))
  const viewAfter = caller.tools.discovery
  assert.notEqual(viewAfter, viewBefore, 'a view is bound to its slot, so a remount yields a fresh view')
  viewAfter.catalog.register({ id: 'beta' })
  assert.deepEqual(second, ['plugin-a'], 'the remounted slot receives the call')
})
