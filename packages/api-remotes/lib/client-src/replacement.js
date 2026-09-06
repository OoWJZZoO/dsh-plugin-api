/**
 * Browser-side replacement wrapper for `@deepseek-ai/dsh-plugin-api-api-remotes`.
 *
 * Appended by `scripts/build-client.mjs` after the official
 * `@deepseek-ai/dsh-api-remotes` browser bundle (kept verbatim). The official
 * contract — module id, the five Typert remote contributions, and the
 * consumer-side `ctx.remote.$on` legal key set (the reproduced eleven-event
 * allowlist) — is preserved untouched.
 *
 * This wrapper only adds an internal (non-`$on`) attention receiver channel.
 * The browser attention runtime (client-runtime slice) subscribes to it; the
 * attention pipe delivers host frames into it. Third-party consumers reach
 * attention content via `ctx.pluginApi.attention`, never through `$on`.
 */
;(() => {
  const receiverSymbol = Symbol.for('dsh-plugin-api.attention.receiver')
  const listeners = new Set()

  const subscribe = (listener) => {
    if (typeof listener !== 'function') return () => {}
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  const receive = (message) => {
    for (const listener of [...listeners]) {
      try {
        listener(message)
      } catch {
        // one faulty listener never breaks the others
      }
    }
  }

  const channel = Object.freeze({ subscribe, receive })

  // Registered once under the fixed symbol; a duplicate registration keeps the
  // first channel so a double-applied bundle never double-runs receivers.
  const globalObject = typeof globalThis !== 'undefined' ? globalThis : {}
  const existing = globalObject[receiverSymbol]
  if (existing === undefined || existing === null) {
    try {
      Object.defineProperty(globalObject, receiverSymbol, {
        value: channel,
        enumerable: false,
        configurable: false,
        writable: false,
      })
    } catch {
      globalObject[receiverSymbol] = channel
    }
  }
})()