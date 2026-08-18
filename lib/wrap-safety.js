/**
 * Shared chain-safety helper for facade wrappers.
 *
 * The helper implements the F0.5 contract:
 * - install records the original target reference for every wrapped property;
 * - dispose restores an original only when the current target is still OUR
 *   wrapper;
 * - when another plugin wrapped after us, dispose degrades the whole handle to
 *   transparent (active=false) and never removes or restores any foreign
 *   reference;
 * - repeated install with the same marker never nests;
 * - dispose is idempotent.
 *
 * This module is dependency-free and never throws; failures are reported
 * through the returned handle.
 */

export function createWrapSafety({ marker = Symbol('dsh-plugin-api.wrap-safety') } = {}) {
  function mark(wrapper) {
    Object.defineProperty(wrapper, marker, {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false,
    })
    return wrapper
  }

  function isMarked(value) {
    return typeof value === 'function' && value[marker] === true
  }

  function noopDispose() {}

  /**
   * @param {Array<{target: object, property: string|symbol, wrapperFactory: Function}>} specs
   * @param {{warn?: Function}} [deps]
   */
  function installWrappers(specs, { logger } = {}) {
    const entries = Array.isArray(specs) ? specs : []
    const warn = typeof logger?.warn === 'function' ? (m) => logger.warn(m) : () => {}

    // 1. Validate everything first: never install a partial wrapper set.
    for (const spec of entries) {
      const { target, property } = spec ?? {}
      const valid =
        target !== null &&
        typeof target === 'object' &&
        (typeof property === 'string' || typeof property === 'symbol') &&
        typeof target[property] === 'function'
      if (!valid) {
        return {
          installed: false,
          invalid: true,
          reason: `invalid wrap target for property ${String(property)}`,
          isActive: () => false,
          dispose: noopDispose,
        }
      }
    }

    // 2. Never nest: if any target is already marked, an earlier install owns
    //    the chain. `isActive:true` retains the existing wrapper baseline
    //    semantics: the chain is owned by the facade, not that every wrapper
    //    is currently executing its effect.
    if (entries.some(({ target, property }) => isMarked(target[property]))) {
      return {
        installed: false,
        alreadyWrapped: true,
        isActive: () => true,
        dispose: noopDispose,
      }
    }

    // 3. Install: record originals, create and mark wrappers, then assign.
    let active = true
    let disposed = false

    const installed = entries.map(({ target, property, wrapperFactory }) => {
      const original = target[property]
      const wrapper = mark(
        wrapperFactory({
          original,
          isActive: () => active,
        }),
      )
      target[property] = wrapper
      return { target, property, original, wrapper }
    })

    // 4. Shared active flag: any degraded property disables all wrappers in
    //    this handle (matching the facade's all-or-nothing semantics).
    function dispose() {
      if (disposed) return
      disposed = true
      active = false

      const degraded = []
      for (const { target, property, original, wrapper } of installed) {
        if (target[property] === wrapper) {
          target[property] = original
        } else if (target[property] !== original) {
          degraded.push(String(property))
        }
      }

      if (degraded.length > 0) {
        warn(`dsh-plugin-api: wrapper chain degraded to transparent because other plugins wrapped: ${degraded.join(', ')}`)
      }
    }

    return {
      installed: true,
      isActive: () => active,
      dispose,
    }
  }

  return { installWrappers }
}
