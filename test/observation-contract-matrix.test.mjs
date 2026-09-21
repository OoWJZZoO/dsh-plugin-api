/**
 * Observation contract matrix (host).
 *
 * One table drives every observation entry that can be mounted without the
 * full boot harness: each entry must answer the same outer contract — a frozen
 * four-member handle (plus registered extensions), a discriminated release,
 * no-op subscriptions after release, and a read face that never throws.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createAttentionHub } from '../lib/attention-hub.js'
import { createCoordinationLease } from '../lib/coordination-lease.js'
import { createContextEngine } from '../lib/context-engine.js'
import { createDiagnosticsOwner } from '../lib/diagnostics.js'
import { createEventsBus } from '../lib/events-bus.js'
import { baseEventsCatalog } from '../lib/events-catalog.js'
import { createExecutionObservation } from '../lib/execution-observation.js'
import { createFeatureRegistry } from '../lib/feature-registry.js'
import { createSessionActivityProjection } from '../lib/session-activity.js'
import { createSessionRouteOwner } from '../lib/session-route.js'
import { createSessionsPlanModeAuthority } from '../lib/sessions-plan-mode.js'
import { createPermissionPresetAuthority } from '../lib/sessions-permission-presets.js'

const logger = { warn() {}, error() {}, info() {} }

const assertObservationContract = (handle) => {
  assert.ok(Object.isFrozen(handle), 'the handle is frozen')
  for (const key of ['current', 'subscribe', 'dispose', 'epoch']) {
    assert.ok(key in handle, `the handle carries ${key}`)
  }
  assert.equal(typeof handle.current, 'function')
  assert.equal(typeof handle.subscribe, 'function')
  assert.equal(typeof handle.dispose, 'function')
  for (const key of ['listeners', 'disposed', 'stale', 'signal', 'abortHandler']) {
    assert.equal(key in handle, false, `the internal record ${key} never escapes`)
  }
  const released = handle.dispose()
  assert.equal(released.ok, true, 'the first release is a success')
  assert.equal(released.code, 'revoked')
  const stale = handle.dispose()
  assert.equal(stale.ok, false, 'the second release is a typed no-op')
  assert.equal(stale.code, 'stale')
  assert.equal(typeof handle.subscribe(() => {}), 'function', 'subscribing after release is a no-op')
  assert.equal(typeof handle.subscribe('not-a-function'), 'function', 'a non-function listener never throws')
  assert.doesNotThrow(() => handle.current())
}

const contextStub = () => ({
  on: () => () => {},
  once: () => () => {},
  emit() {},
  serial() {},
  parallel() {},
  bail() {},
  waterfall() {},
})

const cases = [
  {
    name: 'events.observe answers the discriminated envelope over the standard handle',
    build() {
      const bus = createEventsBus({ ctx: contextStub(), catalog: baseEventsCatalog })
      const envelope = bus.observe('goal/changed')
      assert.equal(envelope.ok, true)
      assert.equal(envelope.code, 'observed')
      assert.equal('reason' in envelope, false)
      // The canonical subject is the options object, the bare name is the
      // convenience form: both answer the same envelope.
      const canonical = bus.observe({ name: 'goal/changed' })
      assert.equal(canonical.ok, true)
      assert.equal(canonical.code, 'observed')
      assert.equal('reason' in canonical, false)
      canonical.handle.dispose()
      const untyped = bus.observe('plugin-a.custom')
      assert.equal(untyped.ok, true)
      assert.equal(untyped.code, 'untyped')
      assert.equal(typeof untyped.reason, 'string')
      const canonicalUntyped = bus.observe({ name: 'plugin-a.custom' })
      assert.equal(canonicalUntyped.ok, true)
      assert.equal(canonicalUntyped.code, 'untyped')
      assert.equal(typeof canonicalUntyped.reason, 'string')
      canonicalUntyped.handle.dispose()
      return envelope.handle
    },
  },
  {
    name: 'attention.observe answers the standard handle',
    build: () => createAttentionHub({ logger }).observe({ ownerId: 'owner', kind: 'web', scopes: null }),
  },
  {
    name: 'attention.observe answers a same-shape handle on a degraded hub',
    build: () => {
      const hub = createAttentionHub({ logger })
      hub.setAvailability({ status: 'unavailable', reason: 'degraded in the matrix' })
      return hub.observe({ ownerId: 'owner', kind: 'web', scopes: null })
    },
  },
  {
    name: 'coordination.observe answers the handle with the resource extension',
    async build() {
      const owner = createCoordinationLease({ ctx: { get: () => undefined }, logger, now: () => new Date() })
      const handle = await owner.api.watch({ scope: 'workspace', key: 'matrix-resource' })
      assert.equal(handle.resource.key, 'matrix-resource')
      return handle
    },
  },
  {
    name: 'prompts.provenance.observe answers the zero-argument handle',
    build() {
      const engine = createContextEngine({
        sources: {
          systemPrompt: { status: () => 'available' },
          sessionSurface: { status: () => 'available', verifySeqBounds: () => ({ ok: true }) },
          attachment: { status: () => 'unavailable' },
          toolExposure: { status: () => 'unavailable' },
          skillExposure: { status: () => 'unavailable' },
          compaction: { status: () => 'available' },
        },
        evidenceSource: { status: () => 'available' },
        now: () => new Date('2026-09-21T00:00:00.000Z'),
        sessionResolver: (sessionId) => ({ ok: true, sessionId }),
        reportDiagnostics: () => {},
      })
      const handle = engine.observe()
      // Before any delivery the read face is a degraded frame, never a throw.
      assert.equal(handle.current().ok, false)
      return handle
    },
  },
  {
    name: 'sessions.activity.observe answers the standard handle',
    build: () => createSessionActivityProjection({ ctx: { on: () => () => {} }, observe: true }).api.observe({ sessionId: 's1' }),
  },
  {
    name: 'diagnostics.observe answers the single-argument handle',
    build() {
      const owner = createDiagnosticsOwner({
        ctx: {},
        logger,
        coreActive: () => true,
        registry: createFeatureRegistry(),
        probeTimeoutMs: 60,
      })
      // The bare scope is the convenience form of the canonical `{ scope }`,
      // and it answers the same contract, not merely a callable.
      assertObservationContract(owner.api.observe('plugin'))
      return owner.api.observe({ scope: 'plugin' })
    },
  },
  {
    name: 'executions.observe answers the options-subject handle',
    build() {
      const owner = createExecutionObservation({ ctx: contextStub(), logger })
      // The bare session id is the convenience form of the canonical subject,
      // and it answers the same contract.
      assertObservationContract(owner.api.observe('s1'))
      return owner.api.observe({ sessionId: 's1' })
    },
  },
  {
    name: 'llm.routing.observe answers the subject handle without a listener argument',
    build() {
      const session = { id: 's1', firstLiveSeq: 0, requestContext: () => undefined }
      const eventsApi = {
        observe: () => ({
          subscribe: () => () => {},
          dispose: () => true,
        }),
      }
      const owner = createSessionRouteOwner({
        sessions: { get: () => session, list: () => [session] },
        eventsApi,
        logger,
      })
      return owner.api.on(session)
    },
  },
  {
    name: 'sessions.planMode.observe accepts the { agent } subject beside the bare form',
    build() {
      const agent = { session: { id: 's1', events: [] } }
      const authority = createSessionsPlanModeAuthority({
        active: () => true,
        resolvePlanMode: () => ({ get: () => ({ active: false }), set: () => 'committed' }),
        resolveTargetPresence: (id) => id === 's1',
        resolveOwnerId: () => 'plugin-a',
        logger,
        clock: () => new Date('2026-09-21T00:00:00.000Z'),
      })
      const bare = authority.observe(agent)
      assertObservationContract(bare)
      return authority.observe({ agent })
    },
  },
  {
    name: 'sessions.permissionPresets.observe accepts the { session } subject beside the bare form',
    build() {
      const session = { id: 's1', events: [], seq: 0 }
      const official = {
        current: () => 'workspace-write',
        resolve: () => ({}),
        set() {},
        names: ['workspace-write', 'danger-full-access'],
        optionOf: (name) => ({ value: name, name, description: `${name} preset` }),
      }
      const authority = createPermissionPresetAuthority({
        active: () => true,
        resolvePresets: () => official,
        resolveSnapshot: () => (target) => ({
          asOfSeq: target.seq - 1,
          values: { permissions: { options: [], currentValue: 'workspace-write' } },
        }),
        resolveTargetPresence: (id) => id === 's1',
        resolveOwnerId: () => 'plugin-a',
        logger,
        clock: () => new Date('2026-09-21T00:00:00.000Z'),
      })
      const bare = authority.observe(session)
      assertObservationContract(bare)
      return authority.observe({ session })
    },
  },
]

for (const item of cases) {
  test(`observation contract matrix: ${item.name}`, async () => {
    const handle = await item.build()
    assertObservationContract(handle)
  })
}
