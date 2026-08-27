/**
 * Fail-safe loader-row replacement entry for
 * `@deepseek-ai/dsh-plugin-api-session-channel-connection`.
 *
 * apply() NEVER throws (a throwing plugin apply kills the harness boot). It
 * runs the boot self-check matrix, then either:
 * - runs the forked official `connection` host apply (replicated contract) and
 *   attaches the incremental slices (transport negotiation, connection-layer
 *   channel generation fencing, carrier resume re-attachment) when the
 *   official row is disabled/absent and every identity check passes;
 * - runs the official `@deepseek-ai/dsh-client-connection` apply (official
 *   behavior restored, slices off) on identity mismatch or self-check failure,
 *   so the harness keeps its connection behavior and nothing double-runs;
 * - stays inert otherwise (loud diagnostic).
 *
 * The official import surface is never covered: the official package remains
 * the module-resolution source and the fallback.
 *
 * The dependency-injection seams exist only so tests can drive the matrix
 * without a real harness.
 */
import { createRequire } from 'node:module'
import {
  API_PATH,
  Config,
  HOST_EVENTS_PATH,
  HostConnectionService,
  MUX_EVENTS_PATH,
  apply as forkedApply,
  inject as forkedInject,
  name as forkedName,
} from './forked-host.js'
import {
  ADVERTISED_TRANSPORTS,
  CONNECTION_OWNER_SYMBOL,
} from './shared-vocab.js'
import { attachConnectionSlices, createFencingTable, createResumePrimitive, createTransportNegotiation } from './slices.js'
import { fullVersionContractsMatch, runtimeIdentityMatches, LOCKED_OWNER_PACKAGE } from './version.js'

export const name = 'plugin-api-session-channel-connection'
export const inject = ['loader', 'webRuntime']

const require = createRequire(import.meta.url)

const OFFICIAL_ROW_IDS = new Set(['connection'])
const OFFICIAL_ROW_NAME = '@deepseek-ai/dsh-client-connection'
const OWN_PACKAGE_NAME = '@deepseek-ai/dsh-plugin-api-session-channel-connection'
const MAIN_PACKAGE_NAME = '@deepseek-ai/dsh-plugin-api-main'

/** Default official apply fallback: resolve the official package synchronously. */
const defaultOfficialApply = (() => {
  try {
    return require('@deepseek-ai/dsh-client-connection')?.apply
  } catch {
    return undefined
  }
})()

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
  let fallback
  try {
    for (const entry of ctx.loader.entries()) {
      const options = entry?.options ?? {}
      if (OFFICIAL_ROW_IDS.has(options.id) || options.name === OFFICIAL_ROW_NAME) {
        if (OFFICIAL_ROW_IDS.has(options.id)) return entry
        fallback ??= entry
      }
    }
  } catch {
    // loader enumeration failure is treated as "absent"; never throws through apply.
    return undefined
  }
  return fallback
}

function isOwnedConnection(service) {
  return service != null && service[CONNECTION_OWNER_SYMBOL] === true
}

function connectionCallable(service) {
  return (
    service != null
    && typeof service.rpc?.handle === 'function'
    && typeof service.rpc?.intercept === 'function'
    && typeof service.createSharedFetchHandler === 'function'
    && typeof service.register === 'function'
    && typeof service.registerInterceptor === 'function'
  )
}

/**
 * Build the plugin `apply` function with optional test seams.
 *
 * @param {{
 *   readPackageVersion?: Function,
 *   readPackageApi?: Function,
 *   forkedApply?: Function,
 *   officialApply?: Function,
 *   officialAvailable?: boolean,
 *   resolveFacade?: Function,
 *   advertisedTransports?: string[],
 *   authorizedTransports?: string[],
 *   fencing?: object,
 *   resume?: object,
 * }} [overrides]
 */
export function createSessionChannelConnectionApply(overrides = {}) {
  const readVersion = overrides.readPackageVersion ?? readPackageVersion
  const readApi = overrides.readPackageApi ?? readPackageApi
  const ForkedApply = overrides.forkedApply ?? forkedApply
  const OfficialApply = overrides.officialApply ?? defaultOfficialApply
  const officialAvailable = overrides.officialAvailable ?? (OfficialApply !== undefined)
  const resolveFacade = overrides.resolveFacade ?? ((ctx) => {
    try {
      return ctx.get('pluginApi')?.sessionChannel
    } catch {
      return undefined
    }
  })

  return function apply(ctx) {
    try {
      const row = inspectComposition(ctx)
      const present = row !== undefined
      const disabled = present ? Boolean(row.disabled) : false

      // Conflict / idempotent re-apply: the earliest registered provider owns
      // `ctx.connection`; later claimants stay inert.
      let existing
      try {
        existing = ctx.get('connection')
      } catch {
        existing = undefined
      }
      if (existing !== undefined && existing !== null) {
        if (isOwnedConnection(existing)) return
        logDiagnostic(ctx, 'session-channel: another provider already owns ctx.connection; staying inert (conflict)')
        return
      }

      const runtimeOk = readVersion('@deepseek-ai/dsh-client-connection') === '0.1.0-rc.6'
      const mainConsistent = fullVersionContractsMatch({
        ownVersion: readVersion(OWN_PACKAGE_NAME),
        ownApi: readApi(OWN_PACKAGE_NAME),
        mainVersion: readVersion(MAIN_PACKAGE_NAME),
        mainApi: readApi(MAIN_PACKAGE_NAME),
      })
      const versionOk = runtimeOk && mainConsistent
      const config = ctx.fiber?.entry?.options?.config ?? {}

      const runForked = () => {
        ForkedApply(ctx, config)
        const connection = ctx.get('connection')
        Object.defineProperty(connection, CONNECTION_OWNER_SYMBOL, {
          value: true,
          enumerable: false,
          configurable: false,
          writable: false,
        })
        const transport = createTransportNegotiation({
          advertised: config?.advertisedTransports ?? overrides.advertisedTransports ?? ADVERTISED_TRANSPORTS,
          authorized: config?.authorizedTransports ?? overrides.authorizedTransports ?? [],
        })
        const fencing = overrides.fencing ?? createFencingTable({ facade: () => resolveFacade(ctx), logger: ctx.logger })
        const resume = overrides.resume ?? createResumePrimitive({ logger: ctx.logger })
        const slices = attachConnectionSlices(connection, { transport, fencing, resume })
        fencing.attach()
        // Post-register verification: the official contract surface must be
        // callable and the owner marker present.
        const verify = connectionCallable(ctx.get('connection'))
        if (!verify) {
          slices.dispose()
          logDiagnostic(ctx, 'session-channel: post-register verification failed; slices detached and stayed inert')
          return
        }
        logDiagnostic(ctx, 'session-channel: forked connection host registered with transport/fencing/resume slices')
        return slices.dispose
      }

      if (versionOk) {
        if (present && !disabled) {
          logDiagnostic(ctx, 'session-channel: official connection row is enabled; leaving the official provider in place')
          return
        }
        // present-disabled or absent → forked host with the incremental slices.
        let disposer
        try {
          disposer = runForked()
        } catch (error) {
          logDiagnostic(ctx, `session-channel: failed to register the forked connection host; staying inert: ${error?.name ?? 'Error'}`)
          return
        }
        return disposer
      }

      // Some identity mismatch. Only this package's replacement slices are
      // disabled; when the official row is disabled/absent we still provide
      // the original service contract through the official-equivalent fallback.
      const mismatchNotes = []
      if (!runtimeOk) mismatchNotes.push('runtime/package identity mismatch')
      if (!mainConsistent) mismatchNotes.push('main facade version mismatch')
      const mismatchNote = mismatchNotes.join(' and ') || 'identity mismatch'

      if (present && !disabled) {
        logDiagnostic(ctx, `session-channel: ${mismatchNote} and the official row is enabled; leaving the official provider in place`)
        return
      }
      const presenceNote = present
        ? 'the official connection row is disabled'
        : 'the official connection row is absent'
      if (officialAvailable === false) {
        logDiagnostic(ctx, `session-channel: ${mismatchNote}, ${presenceNote}, and the official dsh-client-connection package is not resolvable; staying inert`)
        return
      }
      try {
        OfficialApply(ctx, config)
        logDiagnostic(ctx, `session-channel: ${mismatchNote} and ${presenceNote}; replacement slices disabled, registered the official-equivalent fallback connection host`)
      } catch (error) {
        logDiagnostic(ctx, `session-channel: ${mismatchNote} and fallback registration failed; staying inert: ${error?.name ?? 'Error'}`)
      }
    } catch (error) {
      logDiagnostic(ctx, `session-channel: apply self-check failed; staying inert: ${error?.name ?? 'Error'}`)
    }
  }
}

/** Default fail-safe apply used by the DSH loader. */
export const apply = createSessionChannelConnectionApply()

export { API_PATH, Config, HOST_EVENTS_PATH, HostConnectionService, MUX_EVENTS_PATH, forkedApply, forkedInject, forkedName }