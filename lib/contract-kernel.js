/**
 * Shared outer-contract kernels for the pluginApi facade.
 *
 * Pure module: no harness dependencies, no official imports, no side effects.
 * It carries the shapes that every facade-owned register / contribute /
 * observe member must produce, so those shapes are defined once instead of
 * being re-derived per domain.
 *
 * Three groups:
 *
 * 1. Discriminated results — the shared success/failure vocabulary
 *    (`ok` / `code` / `reason`), with `status` never acting as a success flag.
 * 2. Resource, contribution and operation handles — frozen objects whose
 *    `dispose()` answers with a discriminated result and is idempotent.
 * 3. Projection observer handles — the frozen `{ current, subscribe, dispose,
 *    epoch }` shape, with listener containment and no-op-after-dispose
 *    subscriptions.
 *
 * Domain data stays with the domain. The kernel never interprets a reason, a
 * stage or an outcome, never mints identity on behalf of a domain, and never
 * decides a conflict rule.
 */

/** Success code for releasing a resource (policy / registry / contribution / observer). */
export const REVOKED = 'revoked'

/**
 * No-op code for releasing something that is already released, superseded by a
 * newer generation, or gone. A stale disposer never revokes a newer resource.
 */
export const STALE = 'stale'

/** Success code for an operation handle's `dispose()`: the stop is requested, not adjudicated. */
export const REQUESTED = 'requested'

/** Failure code used when a domain teardown throws and no more specific code is declared. */
export const UNAVAILABLE = 'unavailable'

/**
 * Build one frozen discriminated result.
 *
 * @param {boolean} ok - the success flag.
 * @param {string} code - the stable machine code.
 * @param {string} [reason] - the caller-facing explanation.
 * @returns {Readonly<{ ok: boolean, code: string, reason?: string }>}
 */
export function contractResult(ok, code, reason) {
  return Object.freeze({
    ok: ok === true,
    code: String(code),
    ...(typeof reason === 'string' && reason.length > 0 ? { reason } : {}),
  })
}

/** The "released by this call" result. */
export function releasedResult() {
  return contractResult(true, REVOKED)
}

/** The "nothing left to release" result. */
export function staleResult(reason) {
  return contractResult(false, STALE, reason)
}

/** The "stop requested" result for an operation handle. */
export function stopRequestedResult() {
  return contractResult(true, REQUESTED)
}

/**
 * Normalize one domain teardown outcome into the shared dispose result.
 *
 * A domain teardown answers with `true` when this call revoked the resource
 * and `false` when the resource was already gone (a stale no-op). Anything
 * else is treated as "gone" too, so a disposer can never report a revocation
 * it did not perform.
 *
 * @param {unknown} outcome
 * @param {string} [staleReason]
 * @returns {Readonly<{ ok: boolean, code: string, reason?: string }>}
 */
export function disposeResultOf(outcome, staleReason) {
  return outcome === true ? releasedResult() : staleResult(staleReason)
}

/**
 * Run one domain teardown under the disposer guard rails: it must never throw
 * through the caller, and a throwing teardown is reported as a typed failure
 * rather than swallowed into a false success.
 */
function runTeardown(teardown, staleReason) {
  try {
    return disposeResultOf(teardown() === true, staleReason)
  } catch (error) {
    const message = error?.message ?? error
    return contractResult(false, UNAVAILABLE, `the release failed: ${String(message)}`)
  }
}

/**
 * Create a frozen resource handle: `{ id, ownerId, generation, ...extensions,
 * dispose() }`.
 *
 * `dispose()` is idempotent — the second call is a typed stale no-op — and
 * never throws through the caller. The handle is frozen, so internal mutable
 * bookkeeping must live in the closure, never on the handle.
 *
 * @param {object} spec
 * @param {string} spec.id - the resource identity.
 * @param {string} spec.ownerId - the derived caller identity.
 * @param {string} spec.generation - the owner-minted slot token.
 * @param {object} [spec.extensions] - registered domain extension members, kept verbatim.
 * @param {(record: object) => boolean} spec.revoke - domain revocation; returns
 *   `true` when this call released the resource, `false` for a stale no-op.
 * @returns {Readonly<object>}
 */
export function createResourceHandle({ id, ownerId, generation, extensions, revoke }) {
  let released = false
  return Object.freeze({
    id,
    ownerId,
    generation,
    ...(extensions ?? {}),
    dispose() {
      if (released) return staleResult('the resource is already released')
      released = true
      return runTeardown(revoke, 'the resource is already released')
    },
  })
}

/**
 * Create a frozen contribution handle: `{ id, ownerId, seq, ...extensions,
 * dispose() }`.
 *
 * Contributions order by `seq` and never carry a generation.
 *
 * @param {object} spec
 * @param {string} spec.id
 * @param {string} spec.ownerId
 * @param {number|string} spec.seq
 * @param {object} [spec.extensions]
 * @param {(record: object) => boolean} spec.revoke
 * @returns {Readonly<object>}
 */
export function createContributionHandle({ id, ownerId, seq, extensions, revoke }) {
  let released = false
  return Object.freeze({
    id,
    ownerId,
    seq,
    ...(extensions ?? {}),
    dispose() {
      if (released) return staleResult('the contribution is already revoked')
      released = true
      return runTeardown(revoke, 'the contribution is already revoked')
    },
  })
}

/**
 * Create a frozen operation handle: `{ id, ownerId, ...extensions, dispose() }`.
 *
 * `dispose()` means "request stop", not "adjudicate the terminal state": a
 * first call answers `requested` and later calls answer `stale`. The terminal
 * state is read through the handle's own `status()`.
 *
 * @param {object} spec
 * @param {string} spec.id
 * @param {string} spec.ownerId
 * @param {object} [spec.extensions]
 * @param {() => boolean} spec.requestStop - returns `true` when this call
 *   actually asked the authority to stop, `false` when the operation already
 *   settled or the stop was already requested.
 * @returns {Readonly<object>}
 */
export function createOperationHandle({ id, ownerId, extensions, requestStop }) {
  let requested = false
  return Object.freeze({
    id,
    ownerId,
    ...(extensions ?? {}),
    dispose() {
      if (requested) return staleResult('the stop was already requested')
      requested = true
      try {
        return requestStop() === true
          ? stopRequestedResult()
          : staleResult('the operation has already settled')
      } catch (error) {
        const message = error?.message ?? error
        return contractResult(false, UNAVAILABLE, `the stop request failed: ${String(message)}`)
      }
    },
  })
}

/**
 * Create a projection observer handle plus its feed.
 *
 * The returned handle is frozen and carries exactly the four public members
 * `{ current(), subscribe(listener), dispose(), epoch }`; the listener set and
 * the liveness flag live in the closure so no internal mutable record can leak
 * to the caller.
 *
 * Semantics:
 * - `subscribe(listener)` answers with an unsubscribe function; from a
 *   disposed handle it answers with a no-op unsubscribe function instead of
 *   throwing.
 * - a listener that throws (or rejects) only degrades itself: the other
 *   listeners and the source are unaffected.
 * - `current()` delegates to the domain read face and is told whether the
 *   handle is still live, so a stale handle can answer a degraded view rather
 *   than an error.
 *
 * @param {object} spec
 * @param {number|string} spec.epoch - the subscription generation token.
 * @param {(live: boolean) => unknown} spec.current - the domain read face.
 * @param {() => void} [spec.onDispose] - domain teardown, run once.
 * @param {(error: unknown) => void} [spec.reportError] - containment sink.
 * @returns {{ handle: Readonly<object>, publish: (payload: unknown) => void, live: () => boolean }}
 */
export function createObserverHandle({ epoch, current, onDispose, reportError }) {
  const listeners = new Set()
  let disposed = false
  const report = typeof reportError === 'function' ? reportError : () => {}

  const publish = (payload) => {
    if (disposed) return
    for (const listener of [...listeners]) {
      try {
        const returned = listener(payload)
        if (returned != null && typeof returned.then === 'function') {
          Promise.resolve(returned).catch((error) => report(error))
        }
      } catch (error) {
        report(error)
      }
    }
  }

  const handle = Object.freeze({
    epoch,
    current() {
      return current(!disposed)
    },
    subscribe(listener) {
      if (disposed || typeof listener !== 'function') return () => {}
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose() {
      if (disposed) return staleResult('the observation handle is already released')
      disposed = true
      listeners.clear()
      try {
        if (typeof onDispose === 'function') onDispose()
      } catch (error) {
        report(error)
      }
      return releasedResult()
    },
  })

  return { handle, publish, live: () => !disposed }
}
