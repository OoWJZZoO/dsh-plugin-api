/**
 * Browser-side replacement wrapper for
 * `@deepseek-ai/dsh-plugin-api-client-runtime`.
 *
 * Appended by `scripts/build-client.mjs` after the official
 * `@deepseek-ai/dsh-client-runtime` browser bundle (kept verbatim) and the
 * inlined attention runtime state machine. The official browser-module
 * contract — slots, conversationEvents, conversationViews, connection/reset
 * and the sessions/workspaces reflect faces — is preserved untouched.
 *
 * This wrapper instantiates the attention runtime and registers it under the
 * internal runtime contract symbol the main facade client face consumes. On
 * module reload (HMR) it replaces the stale runtime with a fresh instance so
 * the client face re-establishes without consumer `$mount` glue.
 */
;(() => {
  const g = globalThis

  const requestChannel = g[Symbol.for('dsh-plugin-api.attention.request-channel')]
  const send = typeof requestChannel === 'function'
    ? requestChannel
    : (requestChannel !== null && requestChannel !== undefined && typeof requestChannel.send === 'function'
        ? (request) => requestChannel.send(request)
        : null)

  const receiver = g[Symbol.for('dsh-plugin-api.attention.receiver')]

  const runtime = createBrowserAttentionRuntime({
    receive: receiver,
    send,
    fetchSnapshot: send === null
      ? null
      : () => send({ kind: 'attention.request', op: 'snapshot' })
          .then((outcome) => (outcome !== null && outcome !== undefined && outcome.ok === true ? (outcome.snapshot ?? null) : null)),
    onReset: null, // the official connection lifecycle rebinds the module; the
                   // reset→reload seam is fixed at the integration wave.
  })

  // HMR / rebind: a re-executed module replaces the stale runtime so the
  // client face rebuilds its projection from the host snapshot.
  const runtimeSymbol = Symbol.for('dsh-plugin-api.attention.runtime')
  const existing = g[runtimeSymbol]
  if (existing !== null && existing !== undefined && typeof existing.dispose === 'function') {
    try {
      existing.dispose()
    } catch {
      // stale runtime teardown is best-effort
    }
  }
  try {
    Object.defineProperty(g, runtimeSymbol, {
      value: runtime,
      enumerable: false,
      configurable: false,
      writable: false,
    })
  } catch {
    g[runtimeSymbol] = runtime
  }

  runtime.attach()
})()