const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const nativeAbortSignalAborted = typeof globalThis.AbortSignal === 'function'
  ? Object.getOwnPropertyDescriptor(globalThis.AbortSignal.prototype, 'aborted')?.get
  : undefined

/**
 * AbortSignal is a live cancellation channel. It must cross the callback and
 * compatibility boundaries by identity, never through structured cloning or
 * freezing.
 */
export function isAbortSignal(value) {
  if (value === null || typeof value !== 'object' || !nativeAbortSignalAborted) return false
  try {
    if (Object.getPrototypeOf(value) !== globalThis.AbortSignal.prototype) return false
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !('value' in descriptor)) return false
    }
    nativeAbortSignalAborted.call(value)
    return true
  } catch {
    return false
  }
}

function isObject(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}

function isPlainRecord(value) {
  if (!isObject(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isDenseArray(value) {
  if (!Array.isArray(value)) return false
  for (let index = 0; index < value.length; index += 1) {
    if (!hasOwn(value, index)) return false
  }
  return true
}

function assertDataGraph(value, seen = new WeakSet()) {
  if (typeof value === 'function') throw new TypeError('request snapshot contains a mutable function')
  if (!isObject(value) || isAbortSignal(value)) return
  if (seen.has(value)) return
  seen.add(value)
  if (!isDenseArray(value) && !isPlainRecord(value)) {
    throw new TypeError('request snapshot contains an unsupported mutable object')
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !('value' in descriptor)) {
      throw new TypeError('request snapshot contains an accessor property')
    }
    assertDataGraph(descriptor.value, seen)
  }
}

function assertCloneable(value, seen = new WeakSet()) {
  assertDataGraph(value, seen)
}

function cloneValue(value, seen) {
  if (!isObject(value) || isAbortSignal(value)) return value
  if (seen.has(value)) return seen.get(value)
  if (!isDenseArray(value) && !isPlainRecord(value)) {
    throw new TypeError('request snapshot contains an unsupported mutable object')
  }

  const out = Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value))
  seen.set(value, out)
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !('value' in descriptor)) {
      throw new TypeError('request snapshot contains an accessor property')
    }
    descriptor.value = cloneValue(descriptor.value, seen)
    Object.defineProperty(out, key, descriptor)
  }
  return out
}

function freezeSnapshot(value, seen = new WeakSet()) {
  if (!isObject(value) || isAbortSignal(value) || seen.has(value)) return value
  seen.add(value)
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor && 'value' in descriptor) freezeSnapshot(descriptor.value, seen)
  }
  try {
    Object.freeze(value)
  } catch {
    // A hostile exotic value is handled by the caller's boundary validation.
  }
  return value
}

function assertRequestBoundary(request) {
  if (!isObject(request)) throw new TypeError('request snapshot requires an object')
  const signal = dataDescriptorValue(request, 'signal')
  if (signal.valid && signal.value !== undefined && !isAbortSignal(signal.value)) {
    throw new TypeError('request snapshot contains an invalid AbortSignal')
  }
  assertDataGraph(request)
}

function cloneSnapshot(value) {
  assertCloneable(value)
  return freezeSnapshot(cloneValue(value, new WeakMap()))
}

/** Return a detached, recursively immutable request snapshot. */
export function snapshotRequest(request) {
  assertRequestBoundary(request)
  return freezeSnapshot(cloneValue(request, new WeakMap()))
}

/** Return a detached, recursively immutable message snapshot. */
export function snapshotMessages(messages) {
  return cloneSnapshot(messages)
}

function ownKeys(value) {
  return Reflect.ownKeys(value)
}

function dataDescriptorValue(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  if (!descriptor || !('value' in descriptor)) return { valid: false, value: undefined }
  return { valid: true, value: descriptor.value }
}

function sameValue(a, b, seen = new WeakMap()) {
  if (Object.is(a, b)) return true
  if (!isObject(a) || !isObject(b) || isAbortSignal(a) || isAbortSignal(b)) return false
  const prior = seen.get(a)
  if (prior === b) return true
  seen.set(a, b)

  if ((!isDenseArray(a) && !isPlainRecord(a)) || (!isDenseArray(b) && !isPlainRecord(b))) return false
  const aKeys = ownKeys(a)
  const bKeys = ownKeys(b)
  if (aKeys.length !== bKeys.length || !aKeys.every((key, index) => Object.is(key, bKeys[index]))) return false
  return aKeys.every((key) => {
    const aDescriptor = Object.getOwnPropertyDescriptor(a, key)
    const bDescriptor = Object.getOwnPropertyDescriptor(b, key)
    if (!aDescriptor || !bDescriptor || !('value' in aDescriptor) || !('value' in bDescriptor)) return false
    return sameValue(aDescriptor.value, bDescriptor.value, seen)
  })
}

/** Compare two request envelopes while excluding only the messages field. */
export function protectedRequestFieldsEqual(original, candidate) {
  if (!isObject(original) || !isObject(candidate)) return false
  const originalKeys = ownKeys(original).filter((key) => key !== 'messages')
  const candidateKeys = ownKeys(candidate).filter((key) => key !== 'messages')
  if (originalKeys.length !== candidateKeys.length) return false
  if (!originalKeys.every((key, index) => Object.is(key, candidateKeys[index]))) return false
  return originalKeys.every((key) => {
    const originalValue = dataDescriptorValue(original, key)
    const candidateValue = dataDescriptorValue(candidate, key)
    return originalValue.valid && candidateValue.valid && sameValue(originalValue.value, candidateValue.value)
  })
}

function isString(value) {
  return typeof value === 'string'
}

function isValidImageAttachment(value) {
  return isPlainRecord(value)
    && hasOwn(value, 'attachmentId')
    && hasOwn(value, 'mediaType')
    && hasOwn(value, 'bytes')
    && hasOwn(value, 'width')
    && hasOwn(value, 'height')
    && isString(value.attachmentId)
    && ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(value.mediaType)
    && Number.isInteger(value.bytes)
    && Number.isInteger(value.width)
    && Number.isInteger(value.height)
    && (!hasOwn(value, 'name') || value.name === undefined || isString(value.name))
}

function validContentBlock(block, visiting = new WeakSet(), validated = new WeakSet()) {
  if (!isPlainRecord(block) || !hasOwn(block, 'type')) return false
  if (validated.has(block)) return true
  if (visiting.has(block)) return false
  visiting.add(block)
  let valid = false
  switch (block.type) {
    case 'text':
    case 'reasoning':
      valid = isString(block.text)
      break
    case 'image':
      valid = isValidImageAttachment(block.attachment)
      break
    case 'tool-call':
      valid = hasOwn(block, 'id') && hasOwn(block, 'name') && hasOwn(block, 'arguments')
        && isString(block.id) && isString(block.name) && isString(block.arguments)
      break
    case 'tool-result':
      valid = hasOwn(block, 'toolCallId')
        && hasOwn(block, 'content')
        && isString(block.toolCallId)
        && isDenseArray(block.content)
        && block.content.every((item) => validContentBlock(item, visiting, validated))
        && (!hasOwn(block, 'isError') || typeof block.isError === 'boolean')
      break
    default:
      valid = false
  }
  visiting.delete(block)
  if (valid) validated.add(block)
  return valid
}

/** Validate the public DSH content vocabulary, including nested tool results. */
export function isValidMessageContent(content) {
  try {
    assertDataGraph(content)
  } catch {
    return false
  }
  if (!isDenseArray(content)) return false
  const visiting = new WeakSet()
  const validated = new WeakSet()
  return content.every((block) => validContentBlock(block, visiting, validated))
}

/** Validate a complete message list without inspecting request fields. */
export function isValidMessages(messages) {
  try {
    assertDataGraph(messages)
  } catch {
    return false
  }
  return isDenseArray(messages) && messages.every((message) => {
    return isPlainRecord(message)
      && hasOwn(message, 'id')
      && hasOwn(message, 'role')
      && hasOwn(message, 'source')
      && hasOwn(message, 'content')
      && isString(message.id)
      && ['system', 'user', 'assistant'].includes(message.role)
      && isPlainRecord(message.source)
      && hasOwn(message.source, 'kind')
      && typeof message.source.kind === 'string'
      && isValidMessageContent(message.content)
  })
}

function metadataEqualExcept(original, candidate, excludedKey) {
  if (!isObject(original) || !isObject(candidate)) return false
  const originalKeys = ownKeys(original).filter((key) => key !== excludedKey)
  const candidateKeys = ownKeys(candidate).filter((key) => key !== excludedKey)
  if (originalKeys.length !== candidateKeys.length) return false
  if (!originalKeys.every((key, index) => Object.is(key, candidateKeys[index]))) return false
  return originalKeys.every((key) => {
    const originalValue = dataDescriptorValue(original, key)
    const candidateValue = dataDescriptorValue(candidate, key)
    return originalValue.valid && candidateValue.valid && sameValue(originalValue.value, candidateValue.value)
  })
}

function messageMetadataEqual(original, candidate) {
  return metadataEqualExcept(original, candidate, 'content')
}

function contentBlockType(block) {
  const type = dataDescriptorValue(block, 'type')
  return type.valid ? type.value : undefined
}

function isMutableContentBlock(block) {
  const type = contentBlockType(block)
  return type === 'text' || type === 'image'
}

function protectedContentBlockEqual(original, candidate) {
  const type = contentBlockType(original)
  if (type !== contentBlockType(candidate)) return false
  if (type === 'reasoning' || type === 'tool-call') return sameValue(original, candidate)
  if (type !== 'tool-result' || !metadataEqualExcept(original, candidate, 'content')) return false

  const originalContent = dataDescriptorValue(original, 'content')
  const candidateContent = dataDescriptorValue(candidate, 'content')
  return originalContent.valid
    && candidateContent.valid
    && isDenseArray(originalContent.value)
    && isDenseArray(candidateContent.value)
    && protectedContentEqual(originalContent.value, candidateContent.value)
}

/**
 * Only text and compat image blocks may change in a replacement. Other content
 * blocks remain in order with their metadata intact, including nested
 * tool-result envelopes, while their nested text/image content can project.
 */
function protectedContentEqual(original, candidate) {
  let originalIndex = 0
  let candidateIndex = 0

  while (true) {
    while (originalIndex < original.length && isMutableContentBlock(original[originalIndex])) {
      originalIndex += 1
    }
    while (candidateIndex < candidate.length && isMutableContentBlock(candidate[candidateIndex])) {
      candidateIndex += 1
    }

    if (originalIndex === original.length || candidateIndex === candidate.length) {
      return originalIndex === original.length && candidateIndex === candidate.length
    }
    if (!protectedContentBlockEqual(original[originalIndex], candidate[candidateIndex])) return false
    originalIndex += 1
    candidateIndex += 1
  }
}

/**
 * Build a candidate with only message content replaced. The candidate is
 * detached and recursively immutable, while the original request is untouched.
 */
export function cloneRequestWithMessages(original, messages) {
  if (!isObject(original) || !Array.isArray(messages)) return undefined
  try {
    assertRequestBoundary(original)
    assertDataGraph(messages)
  } catch {
    return undefined
  }
  const originalMessages = dataDescriptorValue(original, 'messages')
  if (!originalMessages.valid || !isDenseArray(originalMessages.value)) return undefined
  if (messages.length !== originalMessages.value.length || !isValidMessages(messages)) return undefined
  for (let index = 0; index < messages.length; index += 1) {
    const originalMessage = originalMessages.value[index]
    const candidateMessage = messages[index]
    if (!messageMetadataEqual(originalMessage, candidateMessage)) return undefined
    if (!protectedContentEqual(originalMessage.content, candidateMessage.content)) return undefined
  }

  const seen = new WeakMap()
  const candidate = Array.isArray(original) ? [] : Object.create(Object.getPrototypeOf(original))
  seen.set(original, candidate)
  for (const key of Reflect.ownKeys(original)) {
    const descriptor = Object.getOwnPropertyDescriptor(original, key)
    if (!descriptor) continue
    if (key === 'messages' && 'value' in descriptor) {
      descriptor.value = cloneValue(messages, new WeakMap())
    } else {
      descriptor.value = cloneValue(descriptor.value, seen)
    }
    Object.defineProperty(candidate, key, descriptor)
  }
  const frozen = freezeSnapshot(candidate)
  // Re-validate the trusted clone: a stateful source may have passed the
  // pre-clone checks and smuggled unvalidated content into the copy.
  if (!isValidMessages(frozen.messages) || !isProtectedCandidate(original, frozen)) return undefined
  return frozen
}

/** Validate that a candidate changed no protected request field or message metadata. */
export function isProtectedCandidate(original, candidate) {
  try {
    assertDataGraph(original)
    assertDataGraph(candidate)
  } catch {
    return false
  }
  if (!protectedRequestFieldsEqual(original, candidate)) return false
  const originalMessages = dataDescriptorValue(original, 'messages')
  const candidateMessages = dataDescriptorValue(candidate, 'messages')
  if (!originalMessages.valid || !candidateMessages.valid) return false
  if (!isDenseArray(originalMessages.value) || !isDenseArray(candidateMessages.value)) return false
  if (originalMessages.value.length !== candidateMessages.value.length) return false
  return originalMessages.value.every((message, index) => (
    messageMetadataEqual(message, candidateMessages.value[index])
      && protectedContentEqual(message.content, candidateMessages.value[index].content)
  ))
}

/** Keep the exact signal object while checking that a candidate did not replace it. */
export function hasExactAbortSignal(original, candidate) {
  const originalSignal = dataDescriptorValue(original ?? {}, 'signal')
  const candidateSignal = dataDescriptorValue(candidate ?? {}, 'signal')
  if (!originalSignal.valid) return !candidateSignal.valid || candidateSignal.value === undefined
  return candidateSignal.valid && candidateSignal.value === originalSignal.value
}

/** Cheap inspectability preflight: true when the value can be snapshotted. */
export function isSnapshotable(value) {
  try {
    assertRequestBoundary(value)
    return true
  } catch {
    return false
  }
}

/** Freeze a detached value without changing the official request object. */
export function immutableSnapshot(value) {
  return cloneSnapshot(value)
}

// Exported for focused tests and later pipeline modules; it intentionally does
// not expose the mutable clone graph used internally by the helpers above.
export { sameValue }
