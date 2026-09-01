import test from 'node:test'
import assert from 'node:assert/strict'
import { createEventsBus } from '../lib/events-bus.js'
import { baseEventsCatalog } from '../lib/events-catalog.js'
import { agentEventsCatalog } from '../lib/agent-events-catalog.js'
import { llmEventsCatalog } from '../lib/llm-events-catalog.js'
import { toolsEventsCatalog } from '../lib/tools-events-catalog.js'
import { composeCatalogs } from '../lib/catalog-compose.js'

const coreCatalog = composeCatalogs(baseEventsCatalog, agentEventsCatalog, llmEventsCatalog, toolsEventsCatalog)

/**
 * Minimal Cordis-like context: hook registration plus plain dispatch by event
 * name, mirroring the events-bus unit harness used across the event tests.
 */
function createMockCordisCtx() {
  const hooks = new Map()
  const hooksOf = (name) => {
    let list = hooks.get(name)
    if (!list) {
      list = []
      hooks.set(name, list)
    }
    return list
  }
  const ctx = {
    hooksOf,
    on(name, listener) {
      hooksOf(name).push({ callback: listener })
      let removed = false
      return () => {
        if (removed) return false
        removed = true
        const index = hooksOf(name).findIndex((hook) => hook.callback === listener)
        if (index >= 0) {
          hooksOf(name).splice(index, 1)
          return true
        }
        return false
      }
    },
    once(name, listener) {
      const dispose = ctx.on(name, function onceWrapper(...args) {
        dispose()
        return listener.apply(this, args)
      })
      return dispose
    },
    emit(name, ...args) {
      for (const hook of hooksOf(name)) hook.callback(...args)
    },
    serial(name, ...args) {
      for (const hook of hooksOf(name)) hook.callback(...args)
      return undefined
    },
    parallel(name, ...args) {
      for (const hook of hooksOf(name)) hook.callback(...args)
      return undefined
    },
    bail(name, ...args) {
      for (const hook of hooksOf(name)) hook.callback(...args)
      return undefined
    },
    waterfall(name, ...args) {
      const callbacks = hooksOf(name).map((hook) => hook.callback)
      const inner = args.pop()
      const next = () => (callbacks.shift() ?? inner)(...args)
      args.push(next)
      return next()
    },
  }
  return ctx
}

function createBus(options = {}) {
  return createEventsBus({ ctx: createMockCordisCtx(), catalog: coreCatalog, ...options })
}

test('define returns a frozen capability-limited publisher handle', () => {
  const bus = createBus()
  const handle = bus.define({ name: 'plugin-a.thing/crafted', freeze: 'all' })
  assert.deepEqual(
    Object.keys(handle).sort(),
    ['dispose', 'emit', 'generation', 'id', 'name', 'ownerId'],
    'handle exposes the resource/contribution lifecycle identity plus emit and dispose',
  )
  assert.equal(Object.isFrozen(handle), true)
  assert.equal(handle.name, 'plugin-a.thing/crafted')
  assert.equal(handle.ownerId, 'root')
  assert.equal(typeof handle.id, 'string')
  assert.equal(typeof handle.generation, 'string')
  const outcome = handle.emit({ n: 1 })
  assert.deepEqual(outcome, { ok: true, code: 'dispatched', outcome: null })
  assert.equal(handle.dispose(), true)
  assert.equal(handle.dispose(), false, 'disposal is idempotent')
})

test('validate rejects a payload before dispatch and contains validator failures', () => {
  const bus = createBus()
  const handle = bus.define({
    name: 'plugin-a.validated',
    validate: (payload) => payload != null && payload.kind === 'ok',
  })
  const rejected = handle.emit({ kind: 'no' })
  assert.deepEqual(rejected, { ok: false, code: 'rejected', reason: 'payload failed the declared validation of custom event "plugin-a.validated"' })
  const throwing = bus.define({
    name: 'plugin-a.throwing-validator',
    validate: () => {
      throw new Error('validator bug')
    },
  })
  assert.equal(throwing.emit({}).ok, false)
  assert.equal(throwing.emit({}).code, 'rejected')
  const accepted = handle.emit({ kind: 'ok' })
  assert.deepEqual(accepted, { ok: true, code: 'dispatched', outcome: null })
})

test('declared freeze policy deep-freezes the dispatched payload', () => {
  const bus = createBus()
  const handle = bus.define({ name: 'plugin-a.frozen', freeze: 'all' })
  const payload = { nested: { list: [1, 2] } }
  handle.emit(payload)
  assert.equal(Object.isFrozen(payload), true)
  assert.equal(Object.isFrozen(payload.nested), true)
  assert.equal(Object.isFrozen(payload.nested.list), true)
})

test('custom event definitions observe through the standard projection handle', () => {
  const bus = createBus()
  const handle = bus.define({ name: 'plugin-a.notify' })
  const observed = []
  const projection = bus.observe('plugin-a.notify')
  const detach = projection.subscribe((payload) => observed.push(payload))
  assert.equal(projection.current(), null, 'nothing observed yet')
  handle.emit({ seq: 1 })
  assert.equal(observed.length, 1)
  assert.deepEqual(observed[0], { seq: 1 })
  assert.equal(Object.isFrozen(observed[0]), true, 'custom observers receive the frozen payload')
  assert.deepEqual(projection.current(), { seq: 1 })
  detach()
  handle.emit({ seq: 2 })
  assert.equal(observed.length, 1, 'detached observer no longer receives')
})

test('two normal plugins with the same custom identity conflict deterministically', () => {
  const bus = createBus()
  const first = bus.define({ name: 'shared.identity' })
  assert.throws(
    () => bus.define({ name: 'shared.identity' }),
    (error) => error.code === 'PLUGIN_API_EVENT_DEFINITION_CONFLICT' && error.message.includes('already defined'),
  )
  assert.equal(first.dispose(), true, 'the first owner stays untouched by the rejected registration')
  const second = bus.define({ name: 'shared.identity' })
  assert.notEqual(second.id, first.id)
  assert.equal(second.ownerId, 'root')
})

test('canonical event names and invalid definitions are rejected at define time', () => {
  const bus = createBus()
  for (const invalid of [undefined, null, 42, 'name-only']) {
    assert.throws(() => bus.define(invalid), (error) => error.code === 'PLUGIN_API_EVENT_DEFINITION_INVALID')
  }
  assert.throws(
    () => bus.define({ name: 'tools/change' }),
    (error) => error.code === 'PLUGIN_API_EVENT_DEFINITION_INVALID' && error.message.includes('canonical event'),
  )
  assert.throws(
    () => bus.define({ name: 'plugin-a.bad-validator', validate: 'not-a-function' }),
    (error) => error.code === 'PLUGIN_API_EVENT_DEFINITION_INVALID',
  )
  assert.throws(
    () => bus.define({ name: 'plugin-a.bad-freeze', freeze: 'everything' }),
    (error) => error.code === 'PLUGIN_API_EVENT_DEFINITION_INVALID',
  )
  assert.throws(
    () => bus.define({ name: '' }),
    (error) => error.code === 'PLUGIN_API_EVENT_DEFINITION_INVALID',
  )
})

test('canonical dispatchers reject custom event names and cannot emit them', () => {
  const bus = createBus()
  const handle = bus.define({ name: 'plugin-a.custom' })
  const outcome = bus.emit('plugin-a.custom', { seq: 1 })
  assert.deepEqual(outcome, {
    ok: false,
    code: 'unsupported',
    reason: 'event plugin-a.custom is not part of the facade event vocabulary',
  })
  const serial = bus.serial('plugin-a.custom', { seq: 2 })
  assert.equal(serial.ok, false)
  assert.equal(serial.code, 'unsupported')
  // The canonical path never dispatches the custom identity.
  const observed = []
  handle.emit({ seq: 3 })
  bus.observe('plugin-a.custom').subscribe((payload) => observed.push(payload))
  assert.equal(observed.length, 0, 'the unsupported dispatch did not publish the custom event')
  handle.emit({ seq: 4 })
  assert.deepEqual(observed, [{ seq: 4 }])
})

test('a stale publisher neither dispatches nor removes a newer definition', () => {
  const bus = createBus()
  const first = bus.define({ name: 'plugin-a.replaced' })
  first.dispose()
  const stale = first.emit({ seq: 1 })
  assert.deepEqual(stale, {
    ok: false,
    code: 'stale',
    reason: 'custom event "plugin-a.replaced" publisher is stale after dispose or reload',
  })
  const second = bus.define({ name: 'plugin-a.replaced' })
  assert.equal(first.dispose(), false, 'a stale disposer cannot remove the newer definition')
  const observed = []
  const projection = bus.observe('plugin-a.replaced')
  projection.subscribe((payload) => observed.push(payload))
  assert.equal(first.emit({ seq: 2 }).code, 'stale', 'the stale publisher cannot publish')
  second.emit({ seq: 3 })
  assert.deepEqual(observed, [{ seq: 3 }], 'only the newer publisher dispatches')
})

test('reload isolation invalidates publishers from a previous bus', () => {
  const firstBus = createBus()
  const handle = firstBus.define({ name: 'plugin-a.session' })
  assert.equal(handle.emit({ seq: 1 }).ok, true)
  firstBus.dispose()
  assert.equal(handle.emit({ seq: 2 }).code, 'stale', 'the old handle cannot dispatch after bus teardown')
  assert.equal(handle.dispose(), false)
  const secondBus = createBus()
  const fresh = secondBus.define({ name: 'plugin-a.session' })
  assert.equal(fresh.emit({ seq: 3 }).ok, true, 'a fresh bus can redefine the freed identity')
  assert.equal(handle.emit({ seq: 4 }).code, 'stale')
  assert.equal(secondBus.observe('plugin-a.session').current(), null)
})

test('observer failure containment preserves unrelated custom and canonical events', () => {
  const bus = createBus()
  const handle = bus.define({ name: 'plugin-a.noisy' })
  const clean = bus.define({ name: 'plugin-a.clean' })
  const seenNoisy = []
  const seenClean = []
  const noisyProjection = bus.observe('plugin-a.noisy')
  noisyProjection.subscribe(() => {
    throw new Error('observer bug')
  })
  noisyProjection.subscribe((payload) => seenNoisy.push(payload))
  bus.observe('plugin-a.clean').subscribe((payload) => seenClean.push(payload))
  assert.doesNotThrow(() => handle.emit({ n: 1 }), 'a throwing custom observer is contained')
  assert.deepEqual(seenNoisy, [{ n: 1 }], 'peer custom observers still receive the payload')
  clean.emit({ n: 2 })
  assert.deepEqual(seenClean, [{ n: 2 }], 'the unrelated custom event keeps dispatching')
  const canonicalSeen = []
  bus.observe('tools/change').subscribe((payload) => canonicalSeen.push(payload))
  bus.emit('tools/change', { tool: 'x' })
  assert.equal(canonicalSeen.length, 1, 'canonical dispatch is unaffected by custom registrations')
})

test('caller-bound owner identity is derived from the caller context when traced', () => {
  const bus = createBus({
    resolveOwnerId: (callerCtx) => {
      const fiber = callerCtx?.fiber ?? callerCtx?.ctx?.fiber
      return typeof fiber?.name === 'string' && fiber.name.length > 0 ? fiber.name : undefined
    },
  })
  const callerCtx = { ctx: { fiber: { name: '@deepseek-ai/third-party-plugin' } } }
  const traced = bus.define.call(callerCtx, { name: 'plugin-a.traced' })
  assert.equal(traced.ownerId, '@deepseek-ai/third-party-plugin')
  const untraced = bus.define({ name: 'plugin-a.untraced' })
  assert.equal(untraced.ownerId, 'root', 'an untraceable caller falls back to the root token')
  // Derivation failure must not gate availability or registration.
  const failing = createBus({
    resolveOwnerId: () => {
      throw new Error('resolver failure')
    },
  })
  const resilient = failing.define({ name: 'plugin-a.resilient' })
  assert.equal(resilient.ownerId, 'root')
  assert.equal(resilient.emit({}).ok, true)
})

test('reverse registration order and definition replacement stay order-independent', () => {
  const bus = createBus()
  const later = bus.define({ name: 'plugin-a.z-later' })
  const earlier = bus.define({ name: 'plugin-a.a-earlier' })
  assert.equal(later.emit({}).ok, true)
  assert.equal(earlier.emit({}).ok, true)
  earlier.dispose()
  later.dispose()
  const again = bus.define({ name: 'plugin-a.z-later' })
  assert.equal(again.emit({}).ok, true)
})

test('a custom event name stays out of the canonical catalog', () => {
  const bus = createBus()
  bus.define({ name: 'plugin-a.hidden' })
  assert.equal(bus.catalog()['plugin-a.hidden'], undefined, 'custom events never enter the canonical catalog')
  assert.equal(bus.availability().status, 'active')
})