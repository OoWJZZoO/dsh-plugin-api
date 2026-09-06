/**
 * Fail-safe loader-row replacement entry for
 * `@deepseek-ai/dsh-plugin-api-api-remotes`.
 *
 * apply() NEVER throws (a throwing plugin apply kills the harness boot). It
 * runs the boot self-check matrix, then either:
 * - attaches the attention forwarding slice (the only host-side behavior this
 *   package adds: hub attention updates ride the official host→browser event
 *   stream as `host/remote-event` frames) when the official row is
 *   disabled/absent and every identity check passes;
 * - stays inert with a loud diagnostic on identity mismatch or self-check
 *   failure — the replacement row still serves the official client half
 *   (verbatim bundle) and the official host apply is a no-op, so the
 *   installation never ends up with the official row disabled and no working
 *   official-contract path;
 * - never double-runs: a second apply of this row stays inert.
 *
 * The official import surface is never covered: host-apiproxy (and any
 * third party) keeps importing the whitelist and BFF identity helpers from the
 * official `@deepseek-ai/dsh-api-remotes` package.
 *
 * The dependency-injection seams exist only so tests can drive the matrix
 * without a real harness.
 */
import { createRequire } from 'node:module'
import { API_REMOTE_FORWARDED_EVENTS } from './forked-host.js'
import { createAttentionForwarder } from './attention-forwarder.js'
import {
  ATTENTION_UPDATE_EVENT,
  FORWARDER_OWNER_SYMBOL,
  OFFICIAL_OWNER_PACKAGE,
  OFFICIAL_ROW_ID,
  REPLACEMENT_ROW_ID,
  keepAttentionOutOfAllowlist,
} from './shared-vocab.js'
import { fullVersionContractsMatch, LOCKED_RUNTIME_VERSION } from './version.js'

export const name = REPLACEMENT_ROW_ID
export const inject = ['loader']

const require = createRequire(import.meta.url)

const MAIN_PACKAGE_NAME = '@deepseek-ai/dsh-plugin-api-main'
const OWN_PACKAGE_NAME = '@deepseek-ai/dsh-plugin-api-api-remotes'

function readPackageVersion(packageName) {
  try {
    return require(`${packageName}/package.json`)?.version
  } catch {
    return undefined
  }
}

function readPackageApi(packageName) {
  try {
    return require(`${packageName}/package.json`)?.dsh?.api
  } catch {
    return undefined
  }
}

function logDiagnostic(ctx, message) {
  try {
    ctx.logger?.warn?.(message)
  } catch {
    // diagnostics must never change apply outcomes
  }
}

function inspectComposition(ctx) {
  try {
    for (const entry of ctx.loader.entries()) {
      const options = entry?.options ?? {}
      if (options.id === OFFICIAL_ROW_ID) return entry
    }
  } catch {
    return undefined
  }
  return undefined
}

/**
 * Default hub update source: the host attention hub emits `attention/update`
 * on the host event bus once the integration wave wires the catalog entry and
 * the hub emission; the slice subscribes to that bus so the route rides the
 * official forwarding machinery.
 */
function defaultResolveSource(ctx) {
  if (typeof ctx.on !== 'function') return null
  return {
    subscribe(listener) {
      let off = () => {}
      try {
        off = ctx.on(ATTENTION_UPDATE_EVENT, (message) => listener(message)) ?? off
      } catch {
        // no bus in this context → route unavailable
      }
      return off
    },
  }
}

/**
 * Default browser event stream: the connection's frame push surface. The
 * concrete downlink entry is fixed at the integration wave; when it is not
 * distributed in this composition the stream resolves to null and the route
 * reports unavailable (host hub and host consumers stay served).
 */
function defaultResolveStream(ctx) {
  try {
    const connection = ctx.get('connection')
    if (connection !== null && connection !== undefined && typeof connection.pushFrame === 'function') {
      return { push: (frame) => connection.pushFrame(frame) }
    }
  } catch {
    // connection service absent
  }
  return null
}

/**
 * Default host snapshot resolver: the attention hub exposes its whole-hub
 * redacted snapshot through the mounted facade; the exact access path is
 * fixed at the integration wave. When the hub is not resolvable the route
 * still forwards live deltas (no snapshot seed).
 */
function defaultResolveSnapshot(ctx) {
  try {
    const pluginApi = ctx.get('pluginApi')
    const hub = pluginApi && pluginApi.attention && typeof pluginApi.attention.hubSnapshot === 'function'
      ? pluginApi.attention
      : undefined
    if (hub !== undefined) return () => hub.hubSnapshot()
  } catch {
    // facade absent
  }
  return null
}

/**
 * Build the plugin `apply` function with optional test seams.
 *
 * @param {{
 *   readPackageVersion?: Function,
 *   readPackageApi?: Function,
 *   resolveSource?: Function,
 *   resolveStream?: Function,
 *   resolveSnapshot?: Function,
 *   logger?: object,
 *   allowlist?: string[],
 * }} [overrides]
 */
export function createApiRemotesApply(overrides = {}) {
  const readVersion = overrides.readPackageVersion ?? readPackageVersion
  const readApi = overrides.readPackageApi ?? readPackageApi
  const resolveSource = overrides.resolveSource ?? defaultResolveSource
  const resolveStream = overrides.resolveStream ?? defaultResolveStream
  const resolveSnapshot = overrides.resolveSnapshot ?? defaultResolveSnapshot

  return function apply(ctx) {
    try {
      const row = inspectComposition(ctx)
      const present = row !== undefined
      const disabled = present ? Boolean(row.disabled) : false

      // Idempotent re-apply / conflict guard: the earliest registered owner
      // claims the attention route; later claimants stay inert.
      try {
        if (ctx[FORWARDER_OWNER_SYMBOL] === true) return
      } catch {
        // context may not accept symbols; treat as absent
      }

      const runtimeOk = readVersion(OFFICIAL_OWNER_PACKAGE) === LOCKED_RUNTIME_VERSION
      const mainConsistent = fullVersionContractsMatch({
        ownVersion: readVersion(OWN_PACKAGE_NAME),
        ownApi: readApi(OWN_PACKAGE_NAME),
        mainVersion: readVersion(MAIN_PACKAGE_NAME),
        mainApi: readApi(MAIN_PACKAGE_NAME),
      })
      const versionOk = runtimeOk && mainConsistent
      if (!versionOk) {
        const notes = []
        if (!runtimeOk) notes.push('runtime/owner identity mismatch')
        if (!mainConsistent) notes.push('main facade version mismatch')
        // No hollow: the official host apply is a no-op and the replacement
        // row still serves the official client half verbatim.
        logDiagnostic(ctx, `api-remotes: attention forwarding disabled (${notes.join(' and ') || 'identity mismatch'})`)
        return
      }

      if (present && !disabled) {
        logDiagnostic(ctx, 'api-remotes: official api-remotes row is enabled; leaving the official provider in place')
        return
      }

      // Official row disabled (patch applied) or absent → attach the slice.
      const source = resolveSource(ctx)
      const stream = resolveStream(ctx)
      const snapshot = resolveSnapshot(ctx)
      const forwarder = createAttentionForwarder({
        logger: overrides.logger ?? ctx.logger,
        allowlist: overrides.allowlist ?? [...API_REMOTE_FORWARDED_EVENTS],
      })
      const attached = forwarder.attach({ source, stream, snapshot: snapshot ?? undefined })
      if (!attached.ok) {
        forwarder.dispose()
        logDiagnostic(ctx, `api-remotes: forwarding route not attached (${attached.reason}); official behavior remains`)
        return
      }
      // Post-register verification: allowlist boundary intact.
      const boundaryOk = keepAttentionOutOfAllowlist({
        forwardedEvents: overrides.allowlist ?? [...API_REMOTE_FORWARDED_EVENTS],
        attentionEvent: ATTENTION_UPDATE_EVENT,
      })
      if (!boundaryOk) {
        forwarder.dispose()
        logDiagnostic(ctx, 'api-remotes: consumer allowlist boundary violated; forwarder detached')
        return
      }
      try {
        Object.defineProperty(ctx, FORWARDER_OWNER_SYMBOL, {
          value: true,
          enumerable: false,
          configurable: false,
          writable: false,
        })
      } catch {
        // marker best-effort; idempotency is additionally guarded by the route
      }
      logDiagnostic(ctx, 'api-remotes: attention forwarding attached')
      return () => forwarder.dispose()
    } catch (error) {
      logDiagnostic(ctx, `api-remotes: apply self-check failed; staying inert: ${error?.name ?? 'Error'}`)
    }
  }
}

/** Default fail-safe apply used by the DSH loader. */
export const apply = createApiRemotesApply()

export { API_REMOTE_FORWARDED_EVENTS }