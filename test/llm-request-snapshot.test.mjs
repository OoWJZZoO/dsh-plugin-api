import test from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyTerminalMessages,
  hasStrictImageProgress,
  isThenable,
  TERMINAL_ABSENT,
  TERMINAL_IMAGE,
  TERMINAL_UNKNOWN,
  validateResult,
} from '../lib/llm-request-boundary.js'
import {
  cloneRequestWithMessages,
  hasExactAbortSignal,
  isProtectedCandidate,
  immutableSnapshot,
  snapshotRequest,
} from '../lib/llm-request-snapshot.js'

function request(signal = new AbortController().signal) {
  return {
    provider: 'provider-a',
    model: 'model-a',
    messages: [
      {
        id: 'message-1',
        role: 'user',
        source: { kind: 'user' },
        content: [{ type: 'text', text: 'hello' }],
      },
    ],
    system: 'system text',
    tools: [{ type: 'function', function: { name: 'lookup' } }],
    signal,
    nested: { keep: ['value'] },
  }
}

test('snapshotRequest detaches and recursively freezes callback data', () => {
  const original = request()
  const snapshot = snapshotRequest(original)

  assert.notEqual(snapshot, original)
  assert.notEqual(snapshot.messages, original.messages)
  assert.notEqual(snapshot.messages[0], original.messages[0])
  assert.notEqual(snapshot.messages[0].content, original.messages[0].content)
  assert.notEqual(snapshot.nested, original.nested)
  assert.ok(Object.isFrozen(snapshot))
  assert.ok(Object.isFrozen(snapshot.messages))
  assert.ok(Object.isFrozen(snapshot.messages[0]))
  assert.ok(Object.isFrozen(snapshot.messages[0].content[0]))
  assert.ok(Object.isFrozen(snapshot.nested))
  assert.ok(Object.isFrozen(snapshot.nested.keep))
  assert.equal(snapshot.signal, original.signal)
  assert.ok(!Object.isFrozen(snapshot.signal))

  assert.throws(() => {
    snapshot.messages[0].content[0].text = 'mutated'
  }, TypeError)
  assert.equal(original.messages[0].content[0].text, 'hello')
})

test('snapshotRequest never freezes or mutates the official request', () => {
  const original = request()
  const originalText = original.messages[0].content[0].text

  snapshotRequest(original)

  assert.ok(!Object.isFrozen(original))
  assert.ok(!Object.isFrozen(original.messages))
  assert.ok(!Object.isFrozen(original.messages[0]))
  assert.ok(!Object.isFrozen(original.messages[0].content))
  assert.equal(original.messages[0].content[0].text, originalText)
  original.messages[0].content[0].text = 'still mutable'
  assert.equal(original.messages[0].content[0].text, 'still mutable')
})

test('successor snapshots share no mutable request or message graph', () => {
  const original = request()
  const first = snapshotRequest(original)
  const successor = immutableSnapshot({ ...first, messages: first.messages.map((message) => ({
    ...message,
    content: [{ type: 'text', text: 'successor' }],
  })) })

  assert.notEqual(successor, first)
  assert.notEqual(successor.messages, first.messages)
  assert.notEqual(successor.messages[0], first.messages[0])
  assert.notEqual(successor.messages[0].content, first.messages[0].content)
  assert.equal(first.messages[0].content[0].text, 'hello')
  assert.equal(successor.messages[0].content[0].text, 'successor')
  assert.equal(successor.signal, original.signal)
})

test('cloneRequestWithMessages preserves protected fields and exact AbortSignal identity', () => {
  const controller = new AbortController()
  const original = Object.freeze(request(controller.signal))
  const messages = [{
    ...original.messages[0],
    content: [{ type: 'text', text: 'projected' }],
  }]
  const candidate = cloneRequestWithMessages(original, messages)

  assert.ok(candidate)
  assert.notEqual(candidate, original)
  assert.equal(candidate.provider, original.provider)
  assert.equal(candidate.model, original.model)
  assert.equal(candidate.signal, controller.signal)
  assert.equal(candidate.messages[0].content[0].text, 'projected')
  assert.ok(isProtectedCandidate(original, candidate))
  assert.ok(hasExactAbortSignal(original, candidate))
  assert.ok(Object.isFrozen(candidate))
  assert.ok(Object.isFrozen(candidate.messages))
  assert.ok(!Object.isFrozen(candidate.signal))
  assert.equal(original.messages[0].content[0].text, 'hello')
})

test('already-aborted AbortSignal remains exact and live across snapshots and candidates', () => {
  const controller = new AbortController()
  controller.abort(new Error('cancelled'))
  const original = request(controller.signal)
  const snapshot = snapshotRequest(original)
  const candidate = cloneRequestWithMessages(original, [{
    ...original.messages[0],
    content: [{ type: 'text', text: 'candidate' }],
  }])

  assert.equal(snapshot.signal, controller.signal)
  assert.equal(candidate.signal, controller.signal)
  assert.equal(snapshot.signal.aborted, true)
  assert.equal(candidate.signal.aborted, true)
  assert.ok(hasExactAbortSignal(original, candidate))
})

test('cloneRequestWithMessages rejects malformed or unsupported content', () => {
  const original = request()
  const base = original.messages[0]

  assert.equal(cloneRequestWithMessages(original, [{
    ...base,
    content: null,
  }]), undefined)
  assert.equal(cloneRequestWithMessages(original, [{
    ...base,
    content: [{ type: 'audio', data: 'not supported' }],
  }]), undefined)
  assert.equal(cloneRequestWithMessages(original, [{
    ...base,
    content: [{ type: 'tool-result', toolCallId: 'call-1', content: [{ type: 'unknown' }] }],
  }]), undefined)
})

test('cloneRequestWithMessages accepts supported vocabulary while preserving protected content blocks', () => {
  const original = request()
  original.messages[0].content = [
    { type: 'text', text: 'visible' },
    { type: 'reasoning', text: 'private' },
    { type: 'image', attachment: {
      attachmentId: 'attachment-1',
      mediaType: 'image/png',
      bytes: 1,
      width: 1,
      height: 1,
    } },
    { type: 'tool-call', id: 'call-1', name: 'lookup', arguments: '{}' },
    {
      type: 'tool-result',
      toolCallId: 'call-1',
      content: [
        { type: 'text', text: 'result' },
        { type: 'image', attachment: {
          attachmentId: 'attachment-2',
          mediaType: 'image/png',
          bytes: 1,
          width: 1,
          height: 1,
        } },
      ],
      isError: false,
    },
  ]

  const candidate = cloneRequestWithMessages(original, [{
    ...original.messages[0],
    content: [
      { type: 'text', text: 'projected visible' },
      { type: 'reasoning', text: 'private' },
      { type: 'text', text: '[Image #1]' },
      { type: 'tool-call', id: 'call-1', name: 'lookup', arguments: '{}' },
      {
        type: 'tool-result',
        toolCallId: 'call-1',
        content: [
          { type: 'text', text: 'projected result' },
          { type: 'text', text: '[Image #2]' },
        ],
        isError: false,
      },
    ],
  }])

  assert.ok(candidate)
  assert.ok(isProtectedCandidate(original, candidate))
})

test('cloneRequestWithMessages rejects replacement of protected non-image content blocks', () => {
  const original = request()
  const base = original.messages[0]

  assert.equal(cloneRequestWithMessages(original, [{
    ...base,
    content: [{ type: 'tool-call', id: 'call-1', name: 'lookup', arguments: '{}' }],
  }]), undefined)
  assert.equal(cloneRequestWithMessages(original, [{
    ...base,
    content: [{ type: 'reasoning', text: 'new private content' }],
  }]), undefined)

  original.messages[0].content = [{
    type: 'tool-result',
    toolCallId: 'call-1',
    content: [{ type: 'text', text: 'result' }],
  }]
  assert.equal(cloneRequestWithMessages(original, [{
    ...original.messages[0],
    content: [{
      type: 'tool-result',
      toolCallId: 'call-1',
      content: [{ type: 'text', text: 'result' }],
      isError: true,
    }],
  }]), undefined)
})

test('content validation preserves valid repeated block references and rejects cycles', () => {
  const original = request()
  const repeated = { type: 'text', text: 'repeated' }
  const candidate = cloneRequestWithMessages(original, [{
    ...original.messages[0],
    content: [repeated, repeated],
  }])
  assert.ok(candidate)
  assert.equal(candidate.messages[0].content[0], candidate.messages[0].content[1])

  const cyclic = { type: 'tool-result', toolCallId: 'call-1', content: [] }
  cyclic.content.push(cyclic)
  assert.equal(cloneRequestWithMessages(original, [{
    ...original.messages[0],
    content: [cyclic],
  }]), undefined)
})

test('snapshot boundary rejects mutable exotic containers and forged AbortSignals', () => {
  assert.throws(() => snapshotRequest({ ...request(), nested: new Map([['key', 'value']]) }), /unsupported mutable object/)
  assert.throws(() => immutableSnapshot(new Set(['value'])), /unsupported mutable object/)

  const real = new AbortController().signal
  const derived = Object.create(real)
  assert.throws(() => snapshotRequest({ ...request(), signal: derived }), /invalid AbortSignal/)
  const proxied = new Proxy(real, {})
  const proxiedSnapshot = snapshotRequest({ ...request(), signal: proxied })
  assert.equal(proxiedSnapshot.signal, proxied)

  let accessorReads = 0
  const forgedSignal = { nested: { mutable: true } }
  Object.defineProperty(forgedSignal, 'aborted', {
    enumerable: true,
    get() {
      accessorReads += 1
      return false
    },
  })
  assert.throws(() => snapshotRequest({ ...request(), signal: forgedSignal }), /invalid AbortSignal/)
  assert.equal(accessorReads, 0)
})

test('protected comparison rejects exotic values and never executes their accessors', () => {
  const original = request()
  const candidate = cloneRequestWithMessages(original, [{
    ...original.messages[0],
    content: [{ type: 'text', text: 'candidate' }],
  }])
  assert.ok(candidate)

  const exoticOriginal = { ...original, nested: new Date() }
  const exoticCandidate = { ...candidate, nested: new Date() }
  Object.defineProperty(exoticOriginal.nested, 'getTime', {
    configurable: true,
    get() {
      throw new Error('getter must not run')
    },
  })
  assert.equal(isProtectedCandidate(exoticOriginal, exoticCandidate), false)
})

test('protected comparison includes non-enumerable request fields', () => {
  const original = request()
  Object.defineProperty(original, 'secret', { value: 'original', enumerable: false, writable: true, configurable: true })
  const candidate = cloneRequestWithMessages(original, [{
    ...original.messages[0],
    content: [{ type: 'text', text: 'candidate' }],
  }])
  assert.ok(candidate)
  const altered = Object.create(Object.getPrototypeOf(candidate))
  for (const key of Reflect.ownKeys(candidate)) {
    const descriptor = Object.getOwnPropertyDescriptor(candidate, key)
    if (key === 'secret') descriptor.value = 'changed'
    Object.defineProperty(altered, key, descriptor)
  }
  assert.equal(isProtectedCandidate(original, altered), false)
})

test('cloneRequestWithMessages rejects function-valued request fields', () => {
  const original = request()
  original.transform = () => 'shared state'
  const messages = original.messages.map((message) => ({
    ...message,
    content: [{ type: 'text', text: 'candidate' }],
  }))

  assert.equal(cloneRequestWithMessages(original, messages), undefined)
  assert.throws(() => snapshotRequest(original), /mutable function/)
})

test('candidate and content validation reject accessor and sparse arrays without reading accessors', () => {
  const original = request()
  const messages = original.messages.map((message) => ({
    ...message,
    content: [{ type: 'text', text: 'candidate' }],
  }))
  let reads = 0
  Object.defineProperty(messages[0], 'source', {
    enumerable: true,
    get() {
      reads += 1
      return { kind: 'user' }
    },
  })
  assert.equal(cloneRequestWithMessages(original, messages), undefined)
  assert.equal(reads, 0)

  let requestMessagesReads = 0
  const accessorRequest = request()
  Object.defineProperty(accessorRequest, 'messages', {
    enumerable: true,
    get() {
      requestMessagesReads += 1
      return original.messages
    },
  })
  assert.equal(cloneRequestWithMessages(accessorRequest, original.messages), undefined)
  assert.equal(requestMessagesReads, 0)

  const sparseMessages = new Array(1)
  const sparseContent = new Array(1)
  assert.equal(cloneRequestWithMessages(original, sparseMessages), undefined)
  assert.equal(cloneRequestWithMessages(original, [{
    ...original.messages[0],
    content: sparseContent,
  }]), undefined)
  assert.equal(cloneRequestWithMessages(original, [{
    ...original.messages[0],
    content: [{ type: 'tool-result', toolCallId: 'call-1', content: new Array(1) }],
  }]), undefined)
})

test('result validation accepts only the synchronous exact union', () => {
  assert.deepEqual(validateResult({ kind: 'pass' }), { kind: 'pass' })
  const messages = request().messages
  assert.deepEqual(validateResult({ kind: 'replace-messages', messages }), {
    kind: 'replace-messages',
    messages,
  })

  assert.equal(validateResult(undefined), undefined)
  assert.equal(validateResult({ kind: 'pass', extra: true }), undefined)
  assert.equal(validateResult({ kind: 'replace-messages', messages, extra: true }), undefined)
  assert.equal(validateResult({ kind: 'replace-messages', messages: null }), undefined)
  assert.equal(validateResult({ kind: 'continue' }), undefined)

  let reads = 0
  const result = { kind: 'pass' }
  Object.defineProperty(result, 'then', {
    enumerable: true,
    get() {
      reads += 1
      throw new Error('must not read then')
    },
  })
  assert.equal(isThenable(result), true)
  assert.equal(validateResult(result), undefined)
  assert.equal(reads, 0)
})

test('thenable detection treats inherited callable then as asynchronous', () => {
  const thenable = Object.create({ then() {} })
  assert.equal(isThenable(thenable), true)
  assert.equal(validateResult(thenable), undefined)
  assert.equal(isThenable({}), false)

  const hiddenThen = new Proxy({ kind: 'pass' }, {
    get(target, key, receiver) {
      if (key === 'then') return () => {}
      return Reflect.get(target, key, receiver)
    },
  })
  assert.equal(isThenable(hiddenThen), true)
  assert.equal(validateResult(hiddenThen), undefined)
})

test('terminal image classification is recursive and fails closed', () => {
  const contentHasImage = (content) => content.some((block) => (
    block.type === 'image' || (block.type === 'tool-result' && contentHasImage(block.content))
  ))
  const textMessages = request().messages
  const imageMessages = [{
    ...textMessages[0],
    content: [{
      type: 'tool-result',
      toolCallId: 'call-1',
      content: [{ type: 'image', attachment: {
        attachmentId: 'attachment-1',
        mediaType: 'image/png',
        bytes: 1,
        width: 1,
        height: 1,
      } }],
    }],
  }]

  assert.deepEqual(classifyTerminalMessages(textMessages, contentHasImage), {
    state: TERMINAL_ABSENT,
    count: 0,
  })
  assert.deepEqual(classifyTerminalMessages(imageMessages, contentHasImage), {
    state: TERMINAL_IMAGE,
    count: 1,
  })
  assert.deepEqual(classifyTerminalMessages([{
    ...textMessages[0],
    content: [{ type: 'audio', data: 'unsupported' }],
  }], contentHasImage), {
    state: TERMINAL_UNKNOWN,
    count: undefined,
  })
  assert.deepEqual(classifyTerminalMessages(imageMessages, () => {
    throw new Error('classifier unavailable')
  }), {
    state: TERMINAL_UNKNOWN,
    count: undefined,
  })

  let hostileReads = 0
  const hostileMessage = new Proxy(textMessages[0], {
    get(target, key, receiver) {
      if (key === 'content') {
        hostileReads += 1
        throw new Error('live message getter must not escape')
      }
      return Reflect.get(target, key, receiver)
    },
  })
  assert.deepEqual(classifyTerminalMessages([hostileMessage], contentHasImage), {
    state: TERMINAL_ABSENT,
    count: 0,
  })
  assert.equal(hostileReads, 0)
})

test('strict image progress requires a known lower image-bearing count', () => {
  const contentHasImage = (content) => content.some((block) => (
    block.type === 'image' || (block.type === 'tool-result' && contentHasImage(block.content))
  ))
  const base = request().messages[0]
  const image = {
    type: 'image',
    attachment: {
      attachmentId: 'attachment-1',
      mediaType: 'image/png',
      bytes: 1,
      width: 1,
      height: 1,
    },
  }
  const before = [{ ...base, content: [image, image] }]
  const oneImage = [{ ...base, content: [image] }]
  const absent = [{ ...base, content: [{ type: 'text', text: '[Image #1]' }] }]

  assert.equal(hasStrictImageProgress(before, oneImage, contentHasImage), true)
  assert.equal(hasStrictImageProgress(before, absent, contentHasImage), true)
  assert.equal(hasStrictImageProgress(oneImage, oneImage, contentHasImage), false)
  assert.equal(hasStrictImageProgress(before, [{ ...base, content: [{ type: 'audio' }] }], contentHasImage), false)
  assert.equal(hasStrictImageProgress([{ ...base, content: [{ type: 'text', text: 'plain' }] }], absent, contentHasImage), false)
})
