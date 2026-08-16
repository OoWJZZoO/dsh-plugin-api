import test from 'node:test'
import assert from 'node:assert/strict'
import { AdmissionRegistry } from '../lib/admission.js'
import { AdmissionProjectionError, applyProjectors, createRequestHasImage, installProjectionGuard } from '../lib/projection-guard.js'

test('applyProjectors returns options unchanged when hasImage is already false', () => {
  const options = { hasImage: false }
  let called = false
  const projectors = [() => {
    called = true
    return { hasImage: false }
  }]

  const result = applyProjectors(options, projectors, (o) => o.hasImage === true)

  assert.equal(result, options)
  assert.equal(called, false)
})

test('applyProjectors applies projectors in order and stops at first no-image result', () => {
  const calls = []
  const options = { hasImage: true }
  const projectors = [
    (o) => {
      calls.push(1)
      return { ...o, hasImage: true }
    },
    (o) => {
      calls.push(2)
      return { ...o, hasImage: false }
    },
    () => {
      calls.push(3)
      throw new Error('should not be called')
    },
  ]

  const result = applyProjectors(options, projectors, (o) => o.hasImage === true)

  assert.equal(result.hasImage, false)
  assert.deepEqual(calls, [1, 2])
})

test('applyProjectors rethrows the same error object when a projector throws', () => {
  const boom = new Error('boom')
  const options = { hasImage: true }
  const projectors = [
    () => {
      throw boom
    },
  ]

  assert.throws(
    () => applyProjectors(options, projectors, (o) => o.hasImage === true),
    (error) => error === boom
  )
})

test('applyProjectors throws AdmissionProjectionError when images remain after all projectors', () => {
  const options = { hasImage: true }
  const projectors = [
    (o) => ({ ...o, hasImage: true }),
    (o) => ({ ...o, hasImage: true }),
  ]

  assert.throws(
    () => applyProjectors(options, projectors, (o) => o.hasImage === true),
    (error) => error instanceof AdmissionProjectionError && error.code === 'ADMISSION_PROJECTION_FAILED'
  )
})

test('applyProjectors throws AdmissionProjectionError when no projectors are available', () => {
  const options = { hasImage: true }

  assert.throws(
    () => applyProjectors(options, [], (o) => o.hasImage === true),
    (error) => error instanceof AdmissionProjectionError
  )
})

test('createRequestHasImage detects image blocks in message content arrays', () => {
  const contentHasImage = (content) => content.some((block) => block.type === 'image')
  const requestHasImage = createRequestHasImage(contentHasImage)

  assert.equal(
    requestHasImage({ messages: [{ content: [{ type: 'image' }] }] }),
    true
  )
  assert.equal(
    requestHasImage({ messages: [{ content: [{ type: 'text', text: 'hi' }] }] }),
    false
  )
  assert.equal(requestHasImage({ messages: [] }), false)
  assert.equal(requestHasImage(null), false)
})

test('createRequestHasImage fails closed when the official walker throws', () => {
  const contentHasImage = () => {
    throw new Error('unexpected content shape')
  }
  const requestHasImage = createRequestHasImage(contentHasImage)

  assert.equal(
    requestHasImage({ messages: [{ content: [{ type: 'unknown' }] }] }),
    true
  )
})

function installGuardForTest({ registry, hasImage, logger }) {
  let listener
  const dispose = () => {
    listener = null
  }
  const ctx = {
    on(name, registered) {
      if (name === 'llm/stream') listener = registered
      return dispose
    },
  }
  const installedDispose = installProjectionGuard({
    ctx,
    registry,
    agents: { get: (sessionId) => ({ sessionId }) },
    hasImage,
    logger,
  })
  return {
    get listener() {
      return listener
    },
    dispose: installedDispose,
  }
}

const hasImage = (o) => Array.isArray(o.messages) && o.messages.some((m) => m.image === true)
const projectImageAway = (o) => ({
  ...o,
  messages: o.messages.map((m) => (m.image ? { ...m, image: false, projected: true } : m)),
})

test('listener returns next() when options has no messages', () => {
  const registry = new AdmissionRegistry()
  const { listener } = installGuardForTest({ registry, hasImage, logger: { error() {} } })
  let called = false
  const next = () => {
    called = true
    return 'next-result'
  }

  const result = listener.call({}, { provider: 'p', model: 'm' }, next)

  assert.equal(result, 'next-result')
  assert.equal(called, true)
})

test('listener returns next() when request has no image blocks', () => {
  const registry = new AdmissionRegistry()
  registry.register({ id: 'i', match: () => true, project: projectImageAway })
  const { listener } = installGuardForTest({ registry, hasImage, logger: { error() {} } })

  let called = false
  const next = () => {
    called = true
    return 'next-result'
  }
  const options = { sessionId: 's1', provider: 'p', model: 'm', messages: [{ text: 'hi' }] }

  const result = listener.call({}, options, next)

  assert.equal(result, 'next-result')
  assert.equal(called, true)
})

test('listener returns next() when sessionId is empty', () => {
  const registry = new AdmissionRegistry()
  registry.register({ id: 'i', match: () => true, project: projectImageAway })
  const { listener } = installGuardForTest({ registry, hasImage, logger: { error() {} } })

  let called = false
  const next = () => {
    called = true
    return 'next-result'
  }
  const options = { sessionId: '', provider: 'p', model: 'm', messages: [{ image: true }] }

  const result = listener.call({}, options, next)

  assert.equal(result, 'next-result')
  assert.equal(called, true)
})

test('listener returns next() when sessionId is undefined or null', () => {
  const registry = new AdmissionRegistry()
  registry.register({ id: 'i', match: () => true, project: projectImageAway })
  const { listener } = installGuardForTest({ registry, hasImage, logger: { error() {} } })

  for (const sessionId of [undefined, null]) {
    let called = false
    const next = () => {
      called = true
      return 'next-result'
    }
    const options = { sessionId, provider: 'p', model: 'm', messages: [{ image: true }] }

    const result = listener.call({}, options, next)

    assert.equal(result, 'next-result')
    assert.equal(called, true)
  }
})

test('installProjectionGuard returns the ctx.on disposer and it clears the listener', () => {
  const registry = new AdmissionRegistry()
  const guard = installGuardForTest({ registry, hasImage, logger: { error() {} } })

  assert.equal(typeof guard.dispose, 'function')
  assert.equal(typeof guard.listener, 'function')
  guard.dispose()
  assert.equal(guard.listener, null)
})

test('listener returns next() when no admission intent matches', () => {
  const registry = new AdmissionRegistry()
  registry.register({ id: 'i', match: () => false, project: projectImageAway })
  const { listener } = installGuardForTest({ registry, hasImage, logger: { error() {} } })

  let called = false
  const next = () => {
    called = true
    return 'next-result'
  }
  const options = { sessionId: 's1', provider: 'p', model: 'm', messages: [{ image: true }] }

  const result = listener.call({}, options, next)

  assert.equal(result, 'next-result')
  assert.equal(called, true)
})

test('listener applies matching projector and re-enters this.stream with projected request', () => {
  const registry = new AdmissionRegistry()
  registry.register({ id: 'i', match: () => true, project: projectImageAway })
  const logger = { errors: [], error(m) { this.errors.push(m) } }
  const { listener } = installGuardForTest({ registry, hasImage, logger })

  const streamCalls = []
  const thisObj = {
    stream(projected) {
      streamCalls.push(projected)
      return 'stream-result'
    },
  }
  let nextCalled = false
  const next = () => {
    nextCalled = true
    return 'next-result'
  }
  const options = { sessionId: 's1', provider: 'p', model: 'm', messages: [{ image: true }] }

  const result = listener.call(thisObj, options, next)

  assert.equal(result, 'stream-result')
  assert.equal(nextCalled, false)
  assert.equal(streamCalls.length, 1)
  assert.equal(streamCalls[0].messages[0].image, false)

  // Second pass with the projected (no-image) request goes straight through.
  const secondResult = listener.call(thisObj, streamCalls[0], next)
  assert.equal(secondResult, 'next-result')
})

test('listener rethrows projector error and does not forward or re-enter', () => {
  const boom = new Error('boom')
  const registry = new AdmissionRegistry()
  registry.register({
    id: 'i',
    match: () => true,
    project: () => {
      throw boom
    },
  })
  const logger = { errors: [], error(m) { this.errors.push(m) } }
  const { listener } = installGuardForTest({ registry, hasImage, logger })

  let nextCalled = false
  let streamCalled = false
  const next = () => {
    nextCalled = true
    return 'next-result'
  }
  const thisObj = {
    stream() {
      streamCalled = true
      return 'stream-result'
    },
  }
  const options = { sessionId: 's1', provider: 'p', model: 'm', messages: [{ image: true }] }

  assert.throws(
    () => listener.call(thisObj, options, next),
    (error) => error === boom
  )
  assert.equal(nextCalled, false)
  assert.equal(streamCalled, false)
  assert.equal(logger.errors.length, 1)
})

test('listener rethrows AdmissionProjectionError when image remains after all projectors', () => {
  const registry = new AdmissionRegistry()
  registry.register({ id: 'i', match: () => true, project: (o) => ({ ...o }) })
  const logger = { errors: [], error(m) { this.errors.push(m) } }
  const { listener } = installGuardForTest({ registry, hasImage, logger })

  let nextCalled = false
  let streamCalled = false
  const next = () => {
    nextCalled = true
    return 'next-result'
  }
  const thisObj = {
    stream() {
      streamCalled = true
      return 'stream-result'
    },
  }
  const options = { sessionId: 's1', provider: 'p', model: 'm', messages: [{ image: true }] }

  assert.throws(
    () => listener.call(thisObj, options, next),
    (error) => error instanceof AdmissionProjectionError && error.code === 'ADMISSION_PROJECTION_FAILED'
  )
  assert.equal(nextCalled, false)
  assert.equal(streamCalled, false)
  assert.equal(logger.errors.length, 1)
})
