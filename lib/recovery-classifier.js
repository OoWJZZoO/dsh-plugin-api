import { deepFreeze } from './deep-freeze.js'

export const FAILURE_CLASSES = Object.freeze([
  'transient',
  'permanent',
  'aborted',
  'denied',
  'superseded',
])

const FAILURE_CLASS_SET = new Set(FAILURE_CLASSES)
const MAX_CODE_LENGTH = 80
const MAX_CATEGORY_LENGTH = 80
const MAX_DETAIL_LENGTH = 160
const MAX_SOURCE_LENGTH = 80

function isObject(value) {
  return value !== null && typeof value === 'object'
}

function read(value, key) {
  try {
    return value?.[key]
  } catch {
    return undefined
  }
}

function boundedString(value, max) {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (!text) return undefined
  return text.slice(0, max)
}

function asClass(value) {
  const text = boundedString(value, MAX_CODE_LENGTH)
  return text && FAILURE_CLASS_SET.has(text) ? text : undefined
}

function firstClass(values) {
  const classes = []
  for (const value of values) {
    const valueClass = asClass(value)
    if (valueClass && !classes.includes(valueClass)) classes.push(valueClass)
  }
  return {
    value: classes.length === 1 ? classes[0] : undefined,
    contradictory: classes.length > 1,
  }
}

function hasExplicitTimeout(failure, options) {
  if (options?.deadlineExpired === true || options?.timedOut === true) return true
  const values = [
    read(failure, 'code'),
    read(failure, 'name'),
    read(failure, 'reason'),
    read(read(failure, 'reason'), 'code'),
  ]
  return values.some((value) => {
    const text = boundedString(value, MAX_CODE_LENGTH)?.toLowerCase()
    return text === 'timeout' || text === 'timed_out' || text === 'timed-out'
      || text === 'deadline_exceeded' || text === 'deadline-exceeded'
  })
}

function hasAbortSignal(value) {
  try {
    return value?.aborted === true
  } catch {
    return false
  }
}

function inferClass(failure, options) {
  const abortRequested = options?.aborted === true
    || read(failure, 'aborted') === true
    || hasAbortSignal(options?.signal)
  const superseded = options?.superseded === true
    || read(failure, 'superseded') === true
    || read(failure, 'replaced') === true

  // A cancellation signal is the strongest evidence in this adapter. It is
  // an observation only; the execution owner still decides its final outcome.
  if (abortRequested) return 'aborted'
  if (superseded) return 'superseded'

  const failureCode = boundedString(read(failure, 'code'), MAX_CODE_LENGTH)?.toLowerCase()
  const failureStatus = boundedString(read(failure, 'status'), MAX_CODE_LENGTH)?.toLowerCase()
  if (failureCode === 'denied' || failureCode === 'forbidden' || failureStatus === 'denied') return 'denied'
  if (failureCode === 'aborted' || failureCode === 'cancelled' || failureCode === 'canceled') return 'aborted'
  if (failureCode === 'superseded' || failureCode === 'replaced') return 'superseded'
  if (failureCode === 'transient' || read(failure, 'retryable') === true) return 'transient'
  if (failureCode === 'permanent' || read(failure, 'retryable') === false) return 'permanent'
  if (hasExplicitTimeout(failure, options)) return 'transient'
  return undefined
}

function sourceOf(failure, options) {
  const source = options?.source ?? read(failure, 'source')
  const sourceKind = typeof source === 'string'
    ? source
    : read(source, 'kind')
  const kind = boundedString(sourceKind, MAX_SOURCE_LENGTH) ?? 'recovery'
  const observedAt = boundedString(
    options?.observedAt ?? read(source, 'observedAt'),
    MAX_SOURCE_LENGTH,
  ) ?? new Date().toISOString()
  return {
    kind,
    observedAt,
  }
}

function reasonOf(failure, options, classification, contradictory) {
  const failureReason = read(failure, 'reason')
  const timeout = hasExplicitTimeout(failure, options)
  const explicitCode = options?.reason?.code
    ?? read(options?.reason, 'code')
    ?? read(failureReason, 'code')
    ?? (typeof failureReason === 'string' ? failureReason : undefined)
    ?? read(failure, 'code')
    ?? read(failure, 'name')
  const code = timeout ? 'timeout' : boundedString(explicitCode, MAX_CODE_LENGTH)
    ?? (contradictory ? 'classification-contradictory' : undefined)
    ?? (classification === undefined ? 'classification-unavailable' : undefined)
    ?? 'failure'
  const category = boundedString(
    options?.reason?.category ?? read(failureReason, 'category') ?? read(failure, 'category'),
    MAX_CATEGORY_LENGTH,
  )
  const detail = boundedString(
    options?.reason?.boundedDetail ?? options?.reason?.detail
      ?? read(failureReason, 'boundedDetail') ?? read(failureReason, 'detail')
      ?? read(failure, 'boundedDetail') ?? read(failure, 'detail'),
    MAX_DETAIL_LENGTH,
  )
  const result = { code: code.toLowerCase() }
  if (category) result.category = category
  if (detail) result.boundedDetail = detail
  return result
}

/**
 * Normalize a public failure observation into the shared recovery vocabulary.
 * The function never throws and does not inspect private Error messages or
 * causes. Unknown input deliberately produces a fail-closed classification
 * marker that the decision owner maps to `stop`.
 */
export function classifyFailure(failure, options = {}) {
  try {
    const sourceFailure = isObject(failure) || typeof failure === 'function' ? failure : {}
    const explicit = firstClass([
      options.class,
      options.classification,
      read(sourceFailure, 'class'),
      read(sourceFailure, 'classification'),
      read(read(sourceFailure, 'reason'), 'class'),
    ])
    const inferred = inferClass(sourceFailure, options)
    const cancellationClass = inferred === 'aborted' || inferred === 'superseded' ? inferred : undefined
    const classValue = cancellationClass ?? explicit.value ?? inferred
    const contradictory = explicit.contradictory
      || (!cancellationClass && explicit.value !== undefined && inferred !== undefined && explicit.value !== inferred)
    const finalClass = classValue ?? 'permanent'
    const result = {
      class: finalClass,
      outcome: 'error',
      reason: reasonOf(sourceFailure, options, classValue, contradictory),
      source: sourceOf(sourceFailure, options),
    }
    return deepFreeze(result)
  } catch {
    return deepFreeze({
      class: 'permanent',
      outcome: 'error',
      reason: { code: 'classification-unavailable' },
      source: { kind: 'recovery', observedAt: new Date().toISOString() },
    })
  }
}

export function isClassification(value) {
  return isObject(value)
    && FAILURE_CLASS_SET.has(value.class)
    && value.outcome === 'error'
    && isObject(value.reason)
    && typeof value.reason.code === 'string'
    && isObject(value.source)
    && typeof value.source.kind === 'string'
    && typeof value.source.observedAt === 'string'
}
