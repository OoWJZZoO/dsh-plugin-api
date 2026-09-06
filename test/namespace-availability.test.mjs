import test from 'node:test'
import assert from 'node:assert/strict'
import { createNamespaceAvailability } from '../lib/namespace-availability.js'

/**
 * Focused unit tests for the namespace availability decoration, including
 * multi-segment namespace paths (e.g. recovery.checkpoints) which must be
 * decorated in place under their parent object while single-segment
 * behavior stays unchanged.
 */

function makeDecorator(featureStatus = () => true) {
  return createNamespaceAvailability({ resolveFeatureStatus: featureStatus }).decorate
}

function availabilityOf(surface, key) {
  const descriptor = Object.getOwnPropertyDescriptor(surface, key)
  if (typeof descriptor.get === 'function') return descriptor.get.call(surface)
  return descriptor.value
}

test('multi-segment path is decorated in place under its parent object', () => {
  const decorate = makeDecorator()
  let availabilityCalls = 0
  const surface = Object.freeze({
    recovery: Object.freeze({
      checkpoints: Object.freeze({
        create() {},
        list() {
          return { items: [] }
        },
        get availability() {
          availabilityCalls += 1
          return { status: 'active', detail: 'domain availability' }
        },
      }),
    }),
  })
  const out = decorate(surface, ['executions', 'executions.recovery', 'executions.recovery.checkpoints'])

  // the decorated member stays under recovery.checkpoints (never promoted to
  // the top-level surface)
  assert.ok(out.recovery && typeof out.recovery === 'object', 'parent subtree is preserved')
  assert.equal(out.checkpoints, undefined, 'no top-level promotion of a nested namespace')
  const checkpoints = out.recovery.checkpoints
  assert.equal(typeof checkpoints.create, 'function', 'original members survive')
  const descriptor = Object.getOwnPropertyDescriptor(checkpoints, 'availability')
  assert.equal(typeof descriptor.value, 'function', 'availability is replaced by a callable member')
  assert.equal(typeof descriptor.get, 'undefined')

  // the decorated availability admits the domain status and normalizes into
  // the frozen uniform vocabulary
  const report = checkpoints.availability()
  assert.deepEqual(report, { status: 'active' }, 'domain detail is normalized into the uniform vocabulary')
  assert.ok(Object.isFrozen(report))
})

test('multi-segment decoration caches by raw subtree identity', () => {
  const decorate = makeDecorator()
  const checkpointsRaw = Object.freeze({ create() {}, get availability() { return { status: 'unavailable' } } })
  const surface = () => Object.freeze({ recovery: Object.freeze({ checkpoints: checkpointsRaw }) })
  const cache = new WeakMap()

  const first = decorate(surface(), ['executions', 'executions.recovery', 'executions.recovery.checkpoints'], cache)
  const second = decorate(surface(), ['executions', 'executions.recovery', 'executions.recovery.checkpoints'], cache)

  // stable identity for the decorated sub-namespace across surface reads
  assert.equal(first.recovery.checkpoints, second.recovery.checkpoints)
  assert.ok(Object.isFrozen(first.recovery.checkpoints))
  // top-level decorated surfaces stay distinct per read (existing contract)
  assert.notEqual(first, second)
  // the raw subtree is untouched
  assert.equal(Object.hasOwn(checkpointsRaw, 'availability'), true)
})

test('single-segment namespace behavior is unchanged', () => {
  const decorate = makeDecorator((feature) => ['session', 'sessionDurable'].includes(feature))
  const surface = Object.freeze({
    sessions: Object.freeze({ get() {}, list() {} }),
  })
  const out = decorate(surface, ['sessions', 'sessions.views'])
  // a single-segment root namespace (path '') decorates the top-level
  // availability member (existing contract: capability-backed status)
  assert.equal(out.availability().status, 'active')
  assert.equal(typeof out.sessions.get, 'function', 'original members survive')
  const descriptor = Object.getOwnPropertyDescriptor(out, 'availability')
  assert.equal(typeof descriptor.value, 'function')
})

test('missing multi-segment subtrees are left absent without promotion', () => {
  const decorate = makeDecorator()
  const surface = Object.freeze({ recovery: Object.freeze({}) })
  const out = decorate(surface, ['executions', 'executions.recovery', 'executions.recovery.checkpoints'])
  assert.equal(out.recovery.checkpoints, undefined)
  assert.equal(out.checkpoints, undefined)
})