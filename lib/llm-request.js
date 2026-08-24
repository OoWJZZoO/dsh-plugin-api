/**
 * compat request synchronous compatibility transform owner — pluginApi.llm.request.
 *
 * This module owns the raw `llm/stream` listener, the compat request transform registry,
 * operation records, terminal image classification, the image admission image-policy phase
 * driver, normal-form assertions, owner markers, and bounded compatibility
 * re-entry. It is the single translation owner required by
 * docs/specs/pluginApi (contract); `llm/admission` never installs
 * a second stream listener and never re-enters on its own.
 *
 * Substrate contract (B class): DSH's public whole-request continuation cannot
 * accept a replacement request, so a message-only replacement uses one
 * owner-marked public `llm.stream(candidate)` compatibility re-entry instead of
 * the original continuation. The owner never mutates or freezes the official
 * request and never exposes live official state to callbacks.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import {
  cloneRequestWithMessages,
  hasExactAbortSignal,
  immutableSnapshot,
  isSnapshotable,
  sameValue,
  snapshotRequest,
} from './llm-request-snapshot.js'
import {
  TERMINAL_ABSENT,
  TERMINAL_IMAGE,
  TERMINAL_UNKNOWN,
  classifyTerminalMessages,
  hasStrictImageProgress,
  isThenable,
  validateResult,
} from './llm-request-boundary.js'
import {
  LlmInputPolicyError,
  LlmRequestCompatibilityError,
  LlmRequestInvalidResultError,
  LlmRequestTransformError,
  LlmRequestTransformRegistrationError,
} from './errors.js'

export const TRANSFORM_PRIORITIES = Object.freeze(['highest', 'high', 'normal', 'low', 'lowest'])

const OWNER = Symbol('dsh-plugin-api.llm-request.owner')

/**
 * Authoritative resolver bypass scope, shared with `pluginApi.llm.modelInfo()`
 *: both enter this scope before resolving target capability so that
 * an active admission gateway overlay is never observed by owner classification.
 * The gateway resolver wrapper consults
 * `isInAuthoritativeBypass()` and skips its overlay inside this scope.
 */
const bypassStorage = new AsyncLocalStorage()

/** Run `fn` inside the authoritative bypass scope. */
export function runAuthoritative(fn) {
  return bypassStorage.run({ bypass: true }, fn)
}

/** True when the current async context entered the authoritative bypass. */
export function isInAuthoritativeBypass() {
  return Boolean(bypassStorage.getStore()?.bypass)
}

/**
 * Owner-controlled authoritative resolver: always runs the official resolver
 * inside the bypass scope so capability classification observes pre-overlay
 * metadata.
 */
export function createAuthoritativeResolver(llm) {
  return (provider, model, signal) => runAuthoritative(
    () => llm.resolveModelInfo(provider, model, ...(signal === undefined ? [] : [signal])),
  )
}

/**
 * Shared synchronous policy match evaluation (stream owner and admission
 * gateway). Match runs once per policy in snapshot order; a throw, thenable,
 * or non-boolean result is a no-match with one redacted diagnostic. `log`
 * receives `(category, error)`; a missing logger is inert.
 */
export function selectMatchingPolicies(policies, context, log) {
  const selected = []
  for (const entry of policies) {
    let matched
    try {
      matched = entry.match(context)
    } catch (error) {
      if (typeof log === 'function') log(`policy-match:${entry.id}`, error)
      continue
    }
    if (matched === true) {
      selected.push(entry)
    } else if (matched !== false) {
      // thenable or non-boolean: no-match with one redacted diagnostic
      if (isThenable(matched)) {
        Promise.resolve(matched).then(() => {}, () => {})
      }
      if (typeof log === 'function') {
        log(`policy-match:${entry.id}`, new Error('match must return a synchronous boolean'))
      }
    }
  }
  return selected
}

function isObject(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}

/** True only when the resolved info authoritatively declares image input. */
export function isNativeImageCapability(info) {
  return isObject(info) && Array.isArray(info?.inputModalities) && info.inputModalities.includes('image')
}

/**
 * Transform registry (owner-private). Registration validates atomically and
 * returns an identity-bound disposer whose first call returns `true` and later
 * calls return `false`. Disposal removes only the exact registration token, so
 * a newer registration with the same id survives. `snapshot()` returns entries
 * ordered by priority then successful registration sequence.
 */
export function createTransformRegistry() {
  const entries = new Map() // token -> entry
  const byId = new Map() // id -> token (latest registration)
  const mountEpoch = {}
  let sequence = 0
  let closed = false

  function validateSpec(spec) {
    if (!isObject(spec)) {
      throw new LlmRequestTransformRegistrationError('transform spec must be an object')
    }
    const { id, mode, priority, apply, isConverged } = spec
    if (typeof id !== 'string' || id.trim() === '') {
      throw new LlmRequestTransformRegistrationError('transform id must be a non-empty string')
    }
    if (mode !== 'compat') {
      throw new LlmRequestTransformRegistrationError('transform mode must be exactly "compat"')
    }
    const normalized = priority === undefined ? 'normal' : priority
    if (!TRANSFORM_PRIORITIES.includes(normalized)) {
      throw new LlmRequestTransformRegistrationError(`unsupported transform priority ${JSON.stringify(priority)}`)
    }
    if (typeof apply !== 'function' || typeof isConverged !== 'function') {
      throw new LlmRequestTransformRegistrationError('transform apply and isConverged must be functions')
    }
    return { id, priority: normalized, apply, isConverged }
  }

  function register(spec) {
    if (closed) {
      throw new LlmRequestTransformRegistrationError('transform registry is disposed')
    }
    const data = validateSpec(spec)
    if (byId.has(data.id)) {
      throw new LlmRequestTransformRegistrationError(`duplicate transform id "${data.id}"`)
    }
    const token = {}
    const entry = Object.freeze({
      ...data,
      token,
      sequence: sequence++,
      epoch: mountEpoch,
    })
    byId.set(data.id, token)
    entries.set(token, entry)

    let disposed = false
    return () => {
      if (disposed) return false
      disposed = true
      return removeToken(token)
    }
  }

  function removeToken(token) {
    const entry = entries.get(token)
    if (!entry) return false
    if (byId.get(entry.id) === token) byId.delete(entry.id)
    return entries.delete(token)
  }

  function snapshot() {
    return [...entries.values()].sort(
      (a, b) => TRANSFORM_PRIORITIES.indexOf(a.priority) - TRANSFORM_PRIORITIES.indexOf(b.priority)
        || a.sequence - b.sequence,
    )
  }

  function isAvailable(token) {
    const entry = entries.get(token)
    return Boolean(entry && entry.epoch === mountEpoch)
  }

  return {
    register,
    snapshot,
    isAvailable,
    dispose() {
      if (closed) return
      closed = true
      entries.clear()
      byId.clear()
    },
    get size() {
      return entries.size
    },
  }
}

/**
 * Feature-private pipeline handle shared with the admission feature:
 * the admission mounter injects its image admission policy registry source; the request
 * owner only ever reads frozen identity snapshots through this handle and
 * never touches the live registry.
 */
export function createLlmPipelineHandle() {
  let policySource = null // { snapshot(), isAvailable(token) } or null
  return {
    setPolicySource(source) {
      policySource = source
    },
    snapshotPolicies() {
      return typeof policySource?.snapshot === 'function' ? policySource.snapshot() : []
    },
    isPolicyAvailable(token) {
      return Boolean(policySource && typeof policySource.isAvailable === 'function' && policySource.isAvailable(token))
    },
  }
}

function reportOnce(record, category, log, error) {
  const key = `${record.id}:${category}`
  if (record.diagnosticKeys.has(key)) return
  record.diagnosticKeys.add(key)
  const detail = error?.message === undefined ? String(error) : error.message
  const line = `dsh-plugin-api: llm/request operation ${record.id} ${category}: ${detail}`
  try {
    if (typeof log === 'function') {
      log(line)
    } else {
      log?.warn?.(line)
    }
  } catch {
    // a missing or throwing logger is inert and never changes the outcome
  }
}

function operationError(record, ErrorClass, category, message, options) {
  const error = new ErrorClass(message, options)
  reportOnce(record, category, record.logger, error)
  return error
}

/**
 * Install the compat request compatibility transform owner.
 *
 * @param {object} deps
 * @param {{on: Function}} deps.ctx
 * @param {{stream: Function, resolveModelInfo: Function}} deps.llm
 * @param {(content: unknown) => boolean} deps.contentHasImage
 *   public DSH image walker; unknown shapes must fail closed (never image-absent)
 * @param {{get?: Function}} [deps.agents]
 * @param {{snapshotPolicies: Function, isPolicyAvailable: Function}} [deps.policyHandle]
 * @param {(provider: string, model: string, signal?: AbortSignal) => Promise<object>} [deps.resolveAuthoritative]
 * @param {{warn?: Function}} [deps.logger]
 * @returns {{ api: object, disposer: () => void, handle: object } | null}
 *   null when a required dependency is missing (feature must stay disabled)
 */
export function mountLlmRequestFeature({
  ctx,
  llm,
  contentHasImage,
  agents,
  policyHandle,
  resolveAuthoritative,
  logger = {},
} = {}) {
  if (
    typeof ctx?.on !== 'function'
    || !llm
    || typeof llm.stream !== 'function'
    || typeof contentHasImage !== 'function'
    || typeof resolveAuthoritative !== 'function'
  ) {
    return null
  }

  const registry = createTransformRegistry()
  const handle = policyHandle ?? createLlmPipelineHandle()
  const authoritative = resolveAuthoritative
  const currentEpoch = {}
  const markers = new WeakMap() // markedCandidate -> { owner, epoch, record }
  const warn = typeof logger.warn === 'function' ? (m) => logger.warn(m) : () => {}

  let nextOperationId = 1
  let disposed = false

  function createRecord() {
    return {
      id: nextOperationId++,
      logger: { warn },
      epoch: currentEpoch,
      status: 'running',
      transforms: [],
      policies: [],
      replacementApplied: false,
      reentryDispatched: false,
      diagnosticKeys: new Set(),
    }
  }

  function settle(record) {
    // Contained terminal cleanup: the record leaves the running set after its
    // continuation path (original continuation, marked bypass, or typed
    // rejection) completed. Marks keyed by the candidate object are released
    // with the candidate graph; a stale disposer cannot reactivate a settled
    // record because every entry re-checks the current epoch.
    if (record.status === 'settled') return
    record.status = 'settled'
  }

  function fail(record, ErrorClass, category, message, options) {
    const error = operationError(record, ErrorClass, category, message, options)
    settle(record)
    return error
  }

  /** Internalize an unexpected snapshot failure as a typed rejection. */
  function snapshotOrReject(record, category, message, fn) {
    try {
      return fn()
    } catch (error) {
      throw fail(record, LlmRequestCompatibilityError, category, message, { cause: error })
    }
  }

  function snapshotTransforms() {
    return registry.snapshot()
  }

  function snapshotPolicies() {
    return handle.snapshotPolicies()
  }

  function evaluatePolicyMatches(policies, context, record) {
    return selectMatchingPolicies(policies, context, (category, error) => {
      reportOnce(record, category, warn, error)
    })
  }

  function scopeContextFor(options) {
    let agent
    if (typeof agents?.get === 'function') {
      try {
        agent = agents.get(options?.sessionId)
      } catch {
        agent = undefined
      }
    }
    return {
      sessionId: options?.sessionId,
      agent,
      provider: options?.provider,
      model: options?.model,
    }
  }

  /** Run the frozen image admission policy list for non-native terminal image input. */
  function runImagePolicyPhase(record, terminal, contentHasImageFn) {
    const policies = record.policies
    if (policies.length === 0) {
      throw fail(record, LlmRequestInvalidResultError, 'policy-rejected',
        'non-native image input has no matching admission policy')
    }

    const selected = evaluatePolicyMatches(policies, scopeContextFor(terminal), record)
    if (selected.length === 0) {
      throw fail(record, LlmRequestInvalidResultError, 'policy-rejected',
        'non-native image input has no matching admission policy')
    }

    let current = terminal
    const processed = []
    for (const entry of selected) {
      const before = classifyTerminalMessages(current.messages, contentHasImageFn)
      if (before.state === TERMINAL_ABSENT) break
      if (before.state === TERMINAL_UNKNOWN) {
        throw fail(record, LlmRequestInvalidResultError, 'policy-rejected',
          `non-native image status is unknown before policy "${entry.id}"`)
      }
      if (!handle.isPolicyAvailable(entry.token)) {
        throw fail(record, LlmInputPolicyError, 'policy-rejected',
          `selected admission policy "${entry.id}" is no longer available`)
      }

      const snapshot = snapshotOrReject(record, 'uninspectable',
        `snapshot failed before policy "${entry.id}" process`, () => immutableSnapshot(current))
      let result
      try {
        result = entry.process(snapshot)
      } catch (error) {
        throw fail(record, LlmInputPolicyError, 'policy-failed',
          `admission policy "${entry.id}" process threw`, { cause: error })
      }
      if (isThenable(result)) {
        throw fail(record, LlmInputPolicyError, 'policy-failed',
          `admission policy "${entry.id}" process returned asynchronously`)
      }
      const validated = validateResult(result)
      if (!validated) {
        throw fail(record, LlmInputPolicyError, 'policy-failed',
          `admission policy "${entry.id}" process returned an invalid result`)
      }
      processed.push(entry)

      if (validated.kind === 'replace-messages') {
        const nextCandidate = cloneRequestWithMessages(current, validated.messages)
        if (!nextCandidate) {
          throw fail(record, LlmRequestInvalidResultError, 'policy-failed',
            `admission policy "${entry.id}" produced invalid replacement messages`)
        }
        if (!hasExactAbortSignal(current, nextCandidate)) {
          throw fail(record, LlmRequestInvalidResultError, 'policy-failed',
            `admission policy "${entry.id}" replaced the AbortSignal`)
        }
        if (!hasStrictImageProgress(current.messages, nextCandidate.messages, contentHasImageFn)) {
          throw fail(record, LlmInputPolicyError, 'policy-failed',
            `admission policy "${entry.id}" did not strictly reduce image content`)
        }
        current = nextCandidate
      }
    }

    const finalState = classifyTerminalMessages(current.messages, contentHasImageFn)
    if (finalState.state !== TERMINAL_ABSENT) {
      throw fail(record, LlmRequestInvalidResultError, 'policy-rejected',
        finalState.state === TERMINAL_UNKNOWN
          ? 'non-native image status is unknown after policy processing'
          : 'image content remains after all selected policies processed')
    }

    for (const entry of processed) {
      const snapshot = snapshotOrReject(record, 'uninspectable',
        `snapshot failed before policy "${entry.id}" validate`, () => immutableSnapshot(current))
      let valid
      try {
        valid = entry.validate(snapshot)
      } catch (error) {
        throw fail(record, LlmInputPolicyError, 'policy-failed',
          `admission policy "${entry.id}" validate threw`, { cause: error })
      }
      if (valid !== true) {
        throw fail(record, LlmInputPolicyError, 'policy-failed',
          `admission policy "${entry.id}" validate must return exactly true`)
      }
    }

    return current
  }

  /** Run assertions and decide the terminal continuation for one operation. */
  function finalize(record, candidate, transforms, next) {
    const terminalSnapshot = snapshotOrReject(record, 'uninspectable',
      'snapshot failed before normal-form assertions', () => immutableSnapshot(candidate))
    for (const entry of transforms) {
      let assertion
      try {
        assertion = entry.isConverged(terminalSnapshot)
      } catch (error) {
        throw fail(record, LlmRequestTransformError, 'assertion-failed',
          `transform "${entry.id}" isConverged threw`, { cause: error })
      }
      if (assertion !== true && assertion !== false) {
        throw fail(record, LlmRequestTransformError, 'assertion-failed',
          `transform "${entry.id}" isConverged must return exactly true or false`)
      }
      if (assertion === false) {
        throw fail(record, LlmRequestTransformError, 'assertion-failed',
          `transform "${entry.id}" did not converge`)
      }
    }

    if (!candidate || !record.replacementApplied) {
      // No effective replacement: original continuation exactly once with the
      // original official request (the captured `next` relays the original args).
      return next()
    }

    // One owner-marked compatibility re-entry; never the original continuation.
    markers.set(candidate, { owner: OWNER, epoch: currentEpoch, record })
    try {
      return llm.stream(candidate)
    } catch (error) {
      if (record.reentryDispatched) {
        // The re-entry became the terminal official execution path: preserve
        // the exact error/rejection reason.
        settle(record)
        throw error
      }
      throw fail(record, LlmRequestCompatibilityError, 'marker-failed',
        'compatibility re-entry could not be established', { cause: error })
    }
  }

  /** Synchronous compat request phase; returns the working candidate and replacement flag. */
  function runSynchronousTransformPhase(record, options) {
    let candidate = options
    let replaced = false

    for (const entry of record.transforms) {
      const snapshot = snapshotOrReject(record, 'uninspectable',
        `snapshot failed before transform "${entry.id}" apply`, () => snapshotRequest(candidate))
      let result
      try {
        result = entry.apply(snapshot)
      } catch (error) {
        throw fail(record, LlmRequestTransformError, 'apply-failed',
          `transform "${entry.id}" apply threw`, { cause: error })
      }
      if (isThenable(result)) {
        throw fail(record, LlmRequestTransformError, 'apply-failed',
          `transform "${entry.id}" apply returned asynchronously`)
      }
      const validated = validateResult(result)
      if (!validated) {
        throw fail(record, LlmRequestInvalidResultError, 'invalid-result',
          `transform "${entry.id}" returned an invalid result`)
      }
      if (validated.kind === 'replace-messages') {
        const nextCandidate = cloneRequestWithMessages(candidate, validated.messages)
        if (!nextCandidate) {
          throw fail(record, LlmRequestInvalidResultError, 'invalid-result',
            `transform "${entry.id}" produced invalid replacement messages`)
        }
        if (!hasExactAbortSignal(candidate, nextCandidate)) {
          throw fail(record, LlmRequestInvalidResultError, 'invalid-result',
            `transform "${entry.id}" replaced the request AbortSignal`)
        }
        if (!sameValue(candidate.messages, nextCandidate.messages)) {
          candidate = nextCandidate
          replaced = true
        }
      }
    }

    return { candidate, replaced }
  }

  /** Decide the continuation for one unmarked operation. */
  function runOperation(record, options, next) {
    if (!isObject(options) || !Array.isArray(options?.messages)) {
      // Non-inspectable input cannot carry image content; fail-open default
      // (semantic-hooks default): pass the official operation through unchanged.
      settle(record)
      return next()
    }

    record.transforms = snapshotTransforms()
    record.policies = snapshotPolicies()

    // An unsnapshotable request cannot be inspected safely. Text-only input
    // needs no translation and can pass through unchanged (default default).
    // Image-bearing or unclassifiable input cannot be proven safe, so it is
    // rejected with a typed error instead of being forwarded.
    if (!isSnapshotable(options)) {
      const initial = classifyTerminalMessages(options.messages, contentHasImage)
      if (initial.state === TERMINAL_ABSENT) {
        reportOnce(record, 'uninspectable', warn,
          new Error('request snapshot unavailable; text-only request passes through unchanged'))
        settle(record)
        return next()
      }
      let cause
      try {
        snapshotRequest(options)
      } catch (error) {
        cause = error
      }
      throw fail(record, LlmRequestInvalidResultError, 'uninspectable',
        'request snapshot is unavailable for image-bearing or unclassifiable input',
        cause === undefined ? undefined : { cause })
    }

    const { candidate, replaced } = runSynchronousTransformPhase(record, options)
    record.replacementApplied = replaced

    const terminal = classifyTerminalMessages(candidate.messages, contentHasImage)
    if (terminal.state === TERMINAL_UNKNOWN) {
      throw fail(record, LlmRequestInvalidResultError, 'invalid-result',
        'terminal image classification is unknown')
    }
    if (terminal.state === TERMINAL_IMAGE) {
      // Image present: target capability must come from the authoritative
      // pre-overlay resolver, never from an overlay inside a gateway scope.
      return runImageOperation(record, candidate, next)
    }

    return finalize(record, candidate, record.transforms, next)
  }

  /** Async extension for terminal image input: capability then image admission phase. */
  async function runImageOperation(record, candidate, next) {
    if (candidate.signal?.aborted) {
      // The official call is already dead; nothing may continue or re-enter.
      settle(record)
      return undefined
    }

    let capability
    try {
      capability = await authoritative(candidate.provider, candidate.model, candidate.signal)
    } catch (error) {
      throw fail(record, LlmRequestCompatibilityError, 'capability-failed',
        'authoritative capability resolution failed', { cause: error })
    }
    if (record.status !== 'running' || record.epoch !== currentEpoch || disposed) {
      throw fail(record, LlmRequestCompatibilityError, 'owner-disposed',
        'llm/request owner disposed during processing')
    }
    if (candidate.signal?.aborted) {
      settle(record)
      return undefined
    }

    let terminal = candidate
    if (!isNativeImageCapability(capability)) {
      if (!isObject(capability)) {
        throw fail(record, LlmRequestCompatibilityError, 'capability-failed',
          'authoritative capability resolution returned an unusable result')
      }
      terminal = runImagePolicyPhase(record, candidate, contentHasImage)
      // A successful image admission phase always eliminates image input, so its terminal
      // candidate is a replacement; a defensive identity check keeps the flag
      // exact.
      if (terminal !== candidate) record.replacementApplied = true
    }

    return finalize(record, terminal, record.transforms, next)
  }

  function listener(options, next) {
    if (isObject(options)) {
      const mark = markers.get(options)
      if (mark && mark.owner === OWNER && mark.epoch === currentEpoch && mark.record.status === 'running') {
        // Our own marked candidate: bypass compat request/image admission/assertions/effects, continue
        // the marked candidate once, and settle the owning record.
        mark.record.reentryDispatched = true
        try {
          return next()
        } finally {
          settle(mark.record)
        }
      }
    }

    const record = createRecord()
    let outcome
    try {
      outcome = runOperation(record, options, next)
    } catch (error) {
      settle(record)
      throw error
    }

    if (isThenable(outcome)) {
      // Deferred continuation: settle after the async decision resolves.
      const promise = Promise.resolve(outcome)
      promise.catch(() => {}) // no unhandled rejection if the caller is gone
      return promise.then(
        (value) => {
          settle(record)
          return value
        },
        (error) => {
          settle(record)
          throw error
        },
      )
    }

    settle(record)
    return outcome
  }

  let dispose
  try {
    dispose = ctx.on('llm/stream', listener)
  } catch (error) {
    warn(`dsh-plugin-api: llm/request could not install its stream listener: ${error?.message ?? error}`)
    return null
  }
  if (typeof dispose !== 'function') {
    warn('dsh-plugin-api: llm/request stream listener produced no disposer')
    return null
  }

  const api = {
    transform: (spec) => registry.register(spec),
  }

  let disposedOnce = false
  const disposer = () => {
    if (disposedOnce) return false
    disposedOnce = true
    disposed = true
    try {
      dispose()
    } catch {
      // disposal must never take down the fail-safe path
    }
    registry.dispose()
    return true
  }

  return { api, disposer, handle, registry }
}
