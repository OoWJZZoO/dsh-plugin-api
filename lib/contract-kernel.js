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

/** The four-state lifecycle of a contribution that takes effect asynchronously. */
export const CONTRIBUTION_PENDING = 'pending'
export const CONTRIBUTION_ACTIVE = 'active'
export const CONTRIBUTION_FAILED = 'failed'
export const CONTRIBUTION_REVOKED = 'revoked'

/** The caller-facing reason of a failed settlement, when the failure has one. */
function failureReason(error) {
  if (error === undefined || error === null) return undefined
  const message = error?.message ?? error
  const text = String(message)
  return text.length > 0 ? text : undefined
}

/**
 * Create a frozen contribution handle for a contribution that takes effect
 * asynchronously: `{ id, ownerId, seq, status(), ...extensions, dispose() }`.
 *
 * `status()` reports the four-state lifecycle `pending | active | failed |
 * revoked` as a frozen `{ state, reason? }` — never as a success flag.
 * `dispose()` is safe in every state: while pending it withdraws the
 * contribution before it can take effect; once active it runs the domain
 * revocation; a settlement that lands after the withdrawal is rolled back
 * through the same revocation instead of resurrecting the contribution.
 *
 * The lifecycle is driven either by the `settle` promise or by the returned
 * controller (`activate` / `fail`), for domains whose completion is not a
 * single thenable.
 *
 * @param {object} spec
 * @param {string} spec.id
 * @param {string} spec.ownerId
 * @param {number|string} spec.seq
 * @param {object} [spec.extensions] - registered domain extension members, copied
 *   by property descriptor so an accessor stays lazy (resolved on each read)
 *   instead of being evaluated once at creation. A pending contribution needs
 *   that for members whose value only exists after the settlement lands.
 * @param {Promise<unknown>|(() => Promise<unknown>)} [spec.settle] - resolution moves
 *   `pending` to `active`, rejection to `failed`; omit it to drive the controller.
 * @param {() => boolean} [spec.revoke] - domain revocation; run once for the live
 *   contribution and once more when a settlement lands after a withdrawal.
 * @param {(error: unknown) => void} [spec.reportError] - containment sink.
 * @returns {{ handle: Readonly<object>, activate: () => void, fail: (error?: unknown) => void, live: () => boolean }}
 */
export function createPendingContributionHandle({ id, ownerId, seq, extensions, settle, revoke, reportError }) {
  let state = CONTRIBUTION_PENDING
  let reason
  let released = false
  const report = typeof reportError === 'function' ? reportError : () => {}

  const rollback = () => {
    if (typeof revoke !== 'function') return
    try {
      revoke()
    } catch (error) {
      report(error)
    }
  }

  const activate = () => {
    if (released || state !== CONTRIBUTION_PENDING) return
    state = CONTRIBUTION_ACTIVE
  }

  const fail = (error) => {
    if (released || state !== CONTRIBUTION_PENDING) return
    state = CONTRIBUTION_FAILED
    reason = failureReason(error)
    if (error !== undefined) report(error)
  }

  if (settle !== undefined) {
    Promise.resolve(typeof settle === 'function' ? settle() : settle).then(
      () => {
        if (released) rollback()
        else activate()
      },
      (error) => fail(error),
    )
  }

  const handle = Object.freeze(Object.defineProperties({
    id,
    ownerId,
    seq,
    status() {
      return Object.freeze({ state, ...(reason !== undefined ? { reason } : {}) })
    },
    dispose() {
      if (released) return staleResult('the contribution is already revoked')
      const previous = state
      released = true
      state = CONTRIBUTION_REVOKED
      reason = undefined
      if (previous === CONTRIBUTION_FAILED) return staleResult('the contribution never took effect')
      if (previous === CONTRIBUTION_PENDING || typeof revoke !== 'function') return releasedResult()
      return runTeardown(revoke, 'the contribution is already revoked')
    },
  }, Object.getOwnPropertyDescriptors(extensions ?? {})))

  return { handle, activate, fail, live: () => !released && state === CONTRIBUTION_ACTIVE }
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
        // A failing domain teardown is reported as a typed failure rather than
        // swallowed into a false success, exactly like the resource handles.
        return runTeardown(() => {
          throw error
        }, 'the observation handle is already released')
      }
      return releasedResult()
    },
  })

  return { handle, publish, live: () => !disposed }
}
