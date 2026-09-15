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
