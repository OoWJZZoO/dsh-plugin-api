/**
 * Deterministic decoration chain executor.
 *
 * The executor drives the ordered wrapper chain for one real adapter
 * operation. It is the single place that enforces the frozen decoration
 * semantics:
 *
 * - one downstream `next()` per wrapper (single-use, never re-entrant into the
 *   public waterfall);
 * - guards before every wrapper call, `next()` invocation, chunk and outcome
 *   commit (owner token, decoration generation, binding generation, terminal
 *   state, cancellation);
 * - terminal arbitration `aborted > superseded > error > timeout-error` with
 *   one committed terminal that later signals cannot rewrite;
 * - wrapper failures become one bounded `DECORATION_FAILED` finish chunk when
 *   the operation is still valid, and are silent otherwise;
 * - the recursion fence records in-flight decoration ids per binding in the
 *   shared `AsyncLocalStorage` so a wrapper re-entering the public `llm/stream`
 *   for the same binding cannot wrap itself.
 */
import { TimeoutReason } from '@deepseek-ai/dsh-timeout'
import {
  BINDING_LIFECYCLE,
  DECORATION_ALS,
  isValidStreamChunk,
} from './decoration-shared.js'

const DECORATION_FAILED_MESSAGE = 'adapter decoration failed'
const ABORTED_MESSAGE = 'adapter decoration aborted'
const TIMEOUT_MESSAGE = 'adapter decoration timed out'

function abortedFinish() {
  return {
    type: 'finish',
    reason: { kind: 'aborted', failure: { message: ABORTED_MESSAGE, code: 'ABORTED' } },
  }
}

function timeoutFinish() {
  return {
    type: 'finish',
    reason: { kind: 'error', failure: { message: TIMEOUT_MESSAGE, code: 'TIMEOUT' } },
  }
}

function decorationFailedFinish() {
  return {
    type: 'finish',
    reason: { kind: 'error', failure: { message: DECORATION_FAILED_MESSAGE, code: 'DECORATION_FAILED' } },
  }
}

/** Iterative deep-freeze for the operation request view (cycle-safe). */
function deepFreeze(value) {
  const seen = new WeakSet()
  const pending = [{ kind: 'visit', node: value }]
  while (pending.length > 0) {
    const task = pending.pop()
    if (!task) continue
    if (task.kind === 'property') {
      pending.push({ kind: 'visit', node: task.source[task.key] })
      continue
    }
    const node = task.node
    if (node === null || typeof node !== 'object') continue
    if (seen.has(node)) continue
    seen.add(node)
    Object.freeze(node)
    const keys = Object.keys(node)
    for (let i = keys.length - 1; i >= 0; i--) {
      pending.push({ kind: 'property', source: node, key: keys[i] })
    }
  }
  return value
}

/** Detached, frozen request view for the operation context (no signal). */
function requestView(request) {
  try {
    const { signal, ...rest } = request ?? {}
    return deepFreeze(structuredClone(rest))
  } catch {
    try {
      return Object.freeze({ ...request })
    } catch {
      return Object.freeze({})
    }
  }
}

/** Combined caller + local revocation signal (never replaces caller abort). */
function combineSignals(callerSignal, localSignal) {
  if (!callerSignal || typeof callerSignal.aborted !== 'boolean') return localSignal
  if (callerSignal.aborted) return callerSignal
  if (typeof AbortSignal.any === 'function') {
    try {
      return AbortSignal.any([callerSignal, localSignal])
    } catch {
      // fall through to manual combination
    }
  }
  const combined = new AbortController()
  const onAbort = () => combined.abort(callerSignal.reason)
  if (callerSignal.aborted) {
    combined.abort(callerSignal.reason)
  } else {
    callerSignal.addEventListener('abort', onAbort, { once: true })
    localSignal.addEventListener('abort', () => combined.abort(localSignal.reason), { once: true })
  }
  return combined.signal
}

function emptyIterable() {
  return {
    [Symbol.asyncIterator]() {
      return {
        next: async () => ({ done: true }),
        return: async () => ({ done: true }),
      }
    },
  }
}

/** One-shot failure iterable: yields a DECORATION_FAILED finish chunk when the operation is still valid. */
function failureIterable(state, message) {
  let emitted = false
  return {
    [Symbol.asyncIterator]() {
      return {
        next: async () => {
          if (emitted) return { done: true }
          emitted = true
          if (state.terminal !== undefined) return { done: true }
          if (!operationStillValid(state)) return { done: true }
          state.terminal = { kind: 'error', reason: 'DECORATION_FAILED', emitted: false, byGuard: false }
          return { done: false, value: decorationFailedFinish() }
        },
        return: async () => {
          emitted = true
          return { done: true }
        },
      }
    },
  }
}

/**
 * Wrap one wrapper-produced iterable so iteration failures are contained as a
 * single bounded decoration failure instead of escaping the chain.
 */
function containIterable(state, produced) {
  const inner = toAsyncIterable(produced)
  if (inner === null) return failureIterable(state, 'wrapper returned no async iterable')
  let emitted = false
  return {
    [Symbol.asyncIterator]() {
      const iterator = inner[Symbol.asyncIterator]()
      return {
        next: async () => {
          if (emitted) return { done: true }
          let result
          try {
            result = await iterator.next()
          } catch {
            emitted = true
            if (state.terminal !== undefined) return { done: true }
            if (!operationStillValid(state)) return { done: true }
            state.terminal = { kind: 'error', reason: 'DECORATION_FAILED', emitted: false, byGuard: false }
            return { done: false, value: decorationFailedFinish() }
          }
          if (result.done) emitted = true
          return result
        },
        return: async (value) => {
          if (emitted) return { done: true }
          emitted = true
          try {
            const close = iterator.return?.bind(iterator)
            return close ? await close(value) : { done: true, value }
          } catch {
            return { done: true, value }
          }
        },
      }
    },
  }
}

/** Normalize a wrapper-produced value to an async iterable, or null. */
function toAsyncIterable(produced) {
  if (produced === null || produced === undefined) return null
  if (typeof produced === 'object' && typeof produced[Symbol.asyncIterator] === 'function') return produced
  if (typeof produced === 'object' && typeof produced[Symbol.iterator] === 'function') return produced
  if (typeof produced.then === 'function') {
    // Promise<AsyncIterable>: resolve lazily, contain resolution failures.
    let resolved = null
    return {
      [Symbol.asyncIterator]() {
        let inner = null
        let settled = false
        return {
          next: async () => {
            if (settled && inner === null) return { done: true }
            if (inner === null) {
              let value
              try {
                value = await produced
              } catch {
                settled = true
                return { done: true }
              }
              if (value === null || typeof value !== 'object' ||
                (typeof value[Symbol.asyncIterator] !== 'function' && typeof value[Symbol.iterator] !== 'function')) {
                settled = true
                return { done: true }
              }
              inner = value[Symbol.asyncIterator]()
              settled = false
            }
            try {
              const result = await inner.next()
              if (result.done) settled = true
              return result
            } catch {
              settled = true
              return { done: true }
            }
          },
          return: async (value) => {
            if (inner !== null) {
              try {
                const close = inner.return?.bind(inner)
                return close ? await close(value) : { done: true, value }
              } catch {
                return { done: true, value }
              }
            }
            return { done: true, value }
          },
        }
      },
    }
  }
  return null
}

function operationStillValid(state) {
  if (state.terminal !== undefined) return false
  if (state.combinedSignal?.aborted) return false
  if (state.isSuperseded()) return false
  return true
}

/**
 * Run one decoration chain over a base adapter operation.
 *
 * @param {object[]} chain - ordered decoration layers, outermost first, each
 *   carrying `id`, `ownerSummary`, `ownerIdentity`, `generation`, `definition`
 *   (with `wrap`/`match`/`priority`/`capabilities`), `binding`,
 *   `sourceRoute`, `options`, `signal` and `isCurrent`.
 * @param {(request?: object) => AsyncIterable} baseInvoke - the official
 *   adapter operation; the innermost `next()` calls it exactly once.
 * @returns {AsyncGenerator} the decorated chunk stream.
 */
export function runDecorationStream(chain, baseInvoke) {
  const first = chain[0]
  const binding = first.binding
  const provider = binding.provider
  const model = first.sourceRoute.model
  const callerSignal = first.signal
  const operationIdentity = {}

  const state = {
    operationIdentity,
    bindingIdentity: binding.adapterIdentity,
    terminal: undefined,
    committedAt: undefined,
    combinedSignal: null,
    isSuperseded: null,
  }

  const localAbort = new AbortController()
  const combinedSignal = combineSignals(callerSignal, localAbort.signal)
  state.combinedSignal = combinedSignal

  const isSuperseded = () => {
    try {
      if (binding.lifecycleState !== BINDING_LIFECYCLE.ACTIVE) return true
      for (const layer of chain) {
        if (typeof layer.isCurrent === 'function' && layer.isCurrent() === false) return true
      }
      return false
    } catch {
      return true
    }
  }
  state.isSuperseded = isSuperseded

  const commitTerminal = (kind, reason, byGuard) => {
    if (state.terminal !== undefined) return false
    state.terminal = { kind, reason, emitted: false, byGuard: Boolean(byGuard) }
    state.committedAt = Date.now()
    return true
  }

  const guardStatus = () => {
    if (state.terminal !== undefined) return { action: 'stop', terminal: state.terminal }
    if (combinedSignal.aborted) {
      const reason = combinedSignal.reason
      // The harness timeout mechanism aborts with an official TimeoutReason
      // (from @deepseek-ai/dsh-timeout); a deadline maps to error+timeout.
      const isTimeout = reason instanceof TimeoutReason
      if (isTimeout) {
        commitTerminal('error', 'timeout', true)
        return { action: 'timeout', terminal: state.terminal }
      }
      commitTerminal('aborted', undefined, true)
      return { action: 'aborted', terminal: state.terminal }
    }
    if (isSuperseded()) {
      commitTerminal('superseded', undefined, true)
      return { action: 'superseded', terminal: state.terminal }
    }
    return { action: 'ok', terminal: undefined }
  }

  const applyRequestTransform = (layer, transformed, request) => {
    if (transformed === undefined) return { ok: true, request }
    if (!layer.definition.capabilities.execution.requestTransform) {
      return { ok: false, reason: 'request transform is not declared for this decoration' }
    }
    if (transformed === null || typeof transformed !== 'object' || Array.isArray(transformed)) {
      return { ok: false, reason: 'transformed request must be a plain object' }
    }
    if (transformed.provider !== request.provider || transformed.model !== request.model) {
      return { ok: false, reason: 'transformed request must preserve the provider and model route' }
    }
    return { ok: true, request: transformed }
  }

  const produce = (index, request) => {
    if (index >= chain.length) {
      return baseInvoke(request)
    }
    const layer = chain[index]
    let nextCalled = false
    const op = {
      adapter: {
        provider: binding.provider,
        adapterIdentity: binding.adapterIdentity,
        generation: binding.adapterGeneration,
        providerInfo: binding.adapterInfo,
      },
      sourceRoute: { provider, model },
      operation: {
        executionIdentity: undefined,
        operationIdentity,
        request: requestView(request),
      },
      signal: combinedSignal,
      next: (transformedRequest) => {
        if (nextCalled) {
          return failureIterable(state, 'decoration invoked next() more than once')
        }
        nextCalled = true
        const g = guardStatus()
        if (g.action !== 'ok') return emptyIterable()
        const applied = applyRequestTransform(layer, transformedRequest, request)
        if (!applied.ok) return failureIterable(state, applied.reason)
        return produce(index + 1, applied.request)
      },
    }
    let produced
    try {
      produced = layer.definition.wrap(op)
    } catch {
      return failureIterable(state, 'decoration wrapper threw')
    }
    return containIterable(state, produced)
  }

  const stream = (async function* () {
    const initial = guardStatus()
    if (initial.action === 'aborted') {
      state.terminal.emitted = true
      yield abortedFinish()
      return
    }
    if (initial.action === 'timeout') {
      state.terminal.emitted = true
      yield timeoutFinish()
      return
    }
    if (initial.action === 'superseded') return

    const outer = produce(0, first.options)
    const it = outer[Symbol.asyncIterator]()
    try {
      while (true) {
        let result
        try {
          result = await it.next()
        } catch {
          // Safety net: layer failures are contained upstream; this only
          // guards against executor-level surprises.
          const g = guardStatus()
          if (g.action === 'aborted') {
            state.terminal.emitted = true
            yield abortedFinish()
            return
          }
          if (g.action === 'timeout') {
            state.terminal.emitted = true
            yield timeoutFinish()
            return
          }
          if (g.action === 'superseded' || state.terminal !== undefined) return
          state.terminal = { kind: 'error', reason: 'DECORATION_FAILED', emitted: true, byGuard: false }
          yield decorationFailedFinish()
          return
        }
        if (result.done) break
        const chunk = result.value
        if (state.terminal !== undefined) {
          // A terminal is committed: publish its in-flight finish marker once,
          // then keep unwinding so wrappers finish their post-`next()` work.
          if (!state.terminal.emitted && isValidStreamChunk(chunk) && chunk.type === 'finish') {
            state.terminal.emitted = true
            yield chunk
          }
          continue
        }
        const g = guardStatus()
        if (g.action === 'aborted') {
          state.terminal.emitted = true
          yield abortedFinish()
          return
        }
        if (g.action === 'timeout') {
          state.terminal.emitted = true
          yield timeoutFinish()
          return
        }
        if (g.action === 'superseded') return
        if (!isValidStreamChunk(chunk)) {
          state.terminal = { kind: 'error', reason: 'DECORATION_FAILED', emitted: true, byGuard: false }
          yield decorationFailedFinish()
          continue
        }
        if (chunk.type === 'finish') {
          state.terminal = {
            kind: chunk.reason?.kind === 'aborted' ? 'aborted' : chunk.reason?.kind === 'error' ? 'error' : 'success',
            emitted: true,
            byGuard: false,
          }
          yield chunk
          continue
        }
        yield chunk
      }
    } finally {
      try {
        await it.return?.()
      } catch {
        // cleanup must not throw
      }
    }
    // Normal completion: flush a guard-committed terminal that was not emitted
    // (e.g. `next()` returned empty after an abort/timeout).
    if (state.terminal !== undefined && !state.terminal.emitted && state.terminal.byGuard) {
      state.terminal.emitted = true
      if (state.terminal.kind === 'aborted') {
        yield abortedFinish()
        return
      }
      if (state.terminal.kind === 'error' && state.terminal.reason === 'timeout') {
        yield timeoutFinish()
        return
      }
    }
  })()

  const store = new Map()
  store.set(binding, new Set(chain.map((layer) => `${layer.ownerIdentity}:${layer.id}`)))

  return {
    [Symbol.asyncIterator]() {
      const it = stream[Symbol.asyncIterator]()
      return {
        next() {
          return DECORATION_ALS.run(store, () => it.next())
        },
        return(value) {
          return DECORATION_ALS.run(store, () => it.return(value))
        },
      }
    },
  }
}
