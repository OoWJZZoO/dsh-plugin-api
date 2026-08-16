import test from 'node:test'
import assert from 'node:assert/strict'
import { createWrapSafety } from '../lib/wrap-safety.js'

const noopLogger = () => ({ warns: [], warn(m) { this.warns.push(m) } })

function makeSpecs() {
  const target = {
    a(x) { return { path: 'original-a', x } },
    b(x) { return { path: 'original-b', x } },
  }
  const originalA = target.a
  const originalB = target.b
  return { target, originalA, originalB }
}

function installTwo(safety, target, logger = noopLogger()) {
  const specs = [
    {
      target,
      property: 'a',
      wrapperFactory: ({ original, isActive }) => (...args) =>
        isActive() ? { path: 'wrapped-a', args } : original(...args),
    },
    {
      target,
      property: 'b',
      wrapperFactory: ({ original, isActive }) => (...args) =>
        isActive() ? { path: 'wrapped-b', args } : original(...args),
    },
  ]
  return safety.installWrappers(specs, { logger })
}

test('install wraps properties and dispose restores all originals', () => {
  const safety = createWrapSafety()
  const { target, originalA, originalB } = makeSpecs()
  const handle = installTwo(safety, target)

  assert.equal(handle.installed, true)
  assert.equal(handle.isActive(), true)
  assert.notEqual(target.a, originalA)
  assert.notEqual(target.b, originalB)
  assert.deepEqual(target.a(1), { path: 'wrapped-a', args: [1] })

  handle.dispose()

  assert.equal(target.a, originalA)
  assert.equal(target.b, originalB)
  assert.equal(handle.isActive(), false)
})

test('foreign-wrapper degrade keeps foreign wrapper and our wrapper becomes transparent', () => {
  const safety = createWrapSafety()
  const { target } = makeSpecs()
  const logger = noopLogger()
  const handle = installTwo(safety, target, logger)

  const ourWrapper = target.a
  const otherWrapper = (...args) => ourWrapper(...args)
  target.a = otherWrapper

  handle.dispose()

  assert.equal(target.a, otherWrapper)
  assert.equal(handle.isActive(), false)
  assert.ok(logger.warns.length > 0)
  // our wrapper is still in the chain but transparent: original result passes through.
  assert.deepEqual(target.a(7), { path: 'original-a', x: 7 })
})

test('repeated install with same marker does not nest and returns no-op owner', () => {
  const safety = createWrapSafety()
  const { target, originalA } = makeSpecs()
  const first = installTwo(safety, target)
  const firstWrapper = target.a

  const second = installTwo(safety, target)

  assert.equal(second.installed, false)
  assert.equal(second.alreadyWrapped, true)
  assert.equal(target.a, firstWrapper)

  second.dispose()
  assert.equal(target.a, firstWrapper)

  first.dispose()
  assert.equal(target.a, originalA)
})

test('double dispose is a no-op the second time', () => {
  const safety = createWrapSafety()
  const { target, originalA } = makeSpecs()
  const handle = installTwo(safety, target)

  handle.dispose()
  assert.equal(target.a, originalA)

  const afterFirst = target.a
  handle.dispose()
  assert.equal(target.a, afterFirst)
})

test('malformed target or non-function property returns invalid without partial install', () => {
  const safety = createWrapSafety()
  const { target, originalA } = makeSpecs()

  const badTarget = safety.installWrappers([
    { target: null, property: 'a', wrapperFactory: () => () => {} },
  ])
  assert.equal(badTarget.installed, false)
  assert.equal(badTarget.invalid, true)
  assert.ok(badTarget.reason)

  const badProperty = safety.installWrappers([
    { target, property: 'nope', wrapperFactory: () => () => {} },
  ])
  assert.equal(badProperty.installed, false)
  assert.equal(badProperty.invalid, true)
  assert.equal(target.a, originalA)
})

test('one invalid spec among several leaves all properties untouched', () => {
  const safety = createWrapSafety()
  const { target, originalA, originalB } = makeSpecs()
  const handle = safety.installWrappers([
    { target, property: 'a', wrapperFactory: () => () => {} },
    { target, property: 'missing', wrapperFactory: () => () => {} },
  ])

  assert.equal(handle.installed, false)
  assert.equal(handle.invalid, true)
  assert.equal(target.a, originalA)
  assert.equal(target.b, originalB)
})
