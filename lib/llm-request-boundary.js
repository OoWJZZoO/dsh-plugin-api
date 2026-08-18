import {
  isValidMessageContent,
  isValidMessages,
  snapshotMessages,
} from './llm-request-snapshot.js'

const RESULT_KEYS = {
  pass: ['kind'],
  replace: ['kind', 'messages'],
}

function isObject(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}

function ownDataDescriptor(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  if (!descriptor || !('value' in descriptor)) return undefined
  return descriptor
}

function findPropertyDescriptor(value, key) {
  let current = value
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key)
    if (descriptor) return descriptor
    current = Object.getPrototypeOf(current)
  }
  return undefined
}

/**
 * Detect thenables without reading or invoking a user-controlled `then`
 * getter. A visible `then` property is itself invalid for the exact callback
 * result union, so it is treated conservatively as thenable-like even if its
 * descriptor currently holds a non-callable value.
 */
export function isThenable(value) {
  if (!isObject(value)) return false
  try {
    return findPropertyDescriptor(value, 'then') !== undefined || typeof value.then === 'function'
  } catch {
    return true
  }
}

function exactKeys(value, expected) {
  let keys
  try {
    keys = Reflect.ownKeys(value)
  } catch {
    return false
  }
  return keys.length === expected.length && expected.every((key) => keys.includes(key))
}

function isPlainRecord(value) {
  if (!isObject(value)) return false
  try {
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
  } catch {
    return false
  }
}

/**
 * Validate the synchronous transform/policy result union without invoking
 * plugin accessors. The returned object contains only the trusted fields the
 * owner needs; the plugin's result object is never retained.
 */
export function validateResult(result) {
  if (isThenable(result) || !isPlainRecord(result)) return undefined

  try {
    const kind = ownDataDescriptor(result, 'kind')?.value
    if (kind === 'pass') {
      return exactKeys(result, RESULT_KEYS.pass) ? { kind: 'pass' } : undefined
    }
    if (kind === 'replace-messages') {
      const messages = ownDataDescriptor(result, 'messages')?.value
      if (!exactKeys(result, RESULT_KEYS.replace) || !Array.isArray(messages)) return undefined
      if (!isValidMessages(messages)) return undefined
      return { kind: 'replace-messages', messages }
    }
  } catch {
    return undefined
  }
  return undefined
}

export const TERMINAL_IMAGE = 'image'
export const TERMINAL_ABSENT = 'absent'
export const TERMINAL_UNKNOWN = 'unknown'

function countImageBlocks(content) {
  let count = 0
  for (const block of content) {
    if (block.type === 'image') count += 1
    else if (block.type === 'tool-result') count += countImageBlocks(block.content)
  }
  return count
}

function classifyContent(content, contentHasImage) {
  if (!isValidMessageContent(content) || typeof contentHasImage !== 'function') {
    return { state: TERMINAL_UNKNOWN, count: undefined }
  }

  let hasImage
  try {
    hasImage = contentHasImage(content)
  } catch {
    return { state: TERMINAL_UNKNOWN, count: undefined }
  }
  if (typeof hasImage !== 'boolean') return { state: TERMINAL_UNKNOWN, count: undefined }

  let count
  try {
    count = countImageBlocks(content)
  } catch {
    return { state: TERMINAL_UNKNOWN, count: undefined }
  }
  if (hasImage !== (count > 0)) return { state: TERMINAL_UNKNOWN, count: undefined }
  return hasImage
    ? { state: TERMINAL_IMAGE, count }
    : { state: TERMINAL_ABSENT, count: 0 }
}

/**
 * Classify every message content using the public DSH image walker. Unknown
 * message/content shapes never collapse into the image-absent state.
 */
export function classifyTerminalMessages(messages, contentHasImage) {
  let detached
  try {
    detached = snapshotMessages(messages)
  } catch {
    return { state: TERMINAL_UNKNOWN, count: undefined }
  }
  if (!Array.isArray(detached) || !isValidMessages(detached)) {
    return { state: TERMINAL_UNKNOWN, count: undefined }
  }

  let count = 0
  try {
    for (const message of detached) {
      const result = classifyContent(message.content, contentHasImage)
      if (result.state === TERMINAL_UNKNOWN) return result
      count += result.count
    }
  } catch {
    return { state: TERMINAL_UNKNOWN, count: undefined }
  }
  return count > 0
    ? { state: TERMINAL_IMAGE, count }
    : { state: TERMINAL_ABSENT, count: 0 }
}

/** Return true only when both terminal scans are known and image count drops. */
export function hasStrictImageProgress(beforeMessages, afterMessages, contentHasImage) {
  const before = classifyTerminalMessages(beforeMessages, contentHasImage)
  const after = classifyTerminalMessages(afterMessages, contentHasImage)
  return before.state === TERMINAL_IMAGE
    && (after.state === TERMINAL_IMAGE || after.state === TERMINAL_ABSENT)
    && after.count < before.count
}

/** Small exported predicate for tests and owner diagnostics. */
export function isExactResultShape(result, kind) {
  const validated = validateResult(result)
  return validated?.kind === kind
}
