/**
 * Fail-safe loader-row replacement entry for
 * `@deepseek-ai/dsh-plugin-api-session-channel-gateway`.
 *
 * apply() NEVER throws (a throwing plugin apply kills the harness boot). It
 * runs the boot self-check matrix, then either:
 * - runs the forked official `typert-gateway` host apply (replicated contract)
 *   and attaches the incremental slices (channel method RPC dispatch + remote
 *   namespace extension) when the official row is disabled/absent and every
 *   identity check passes;
 * - runs the official `@deepseek-ai/dsh-api-gateway` apply (official behavior
 *   restored, slices off) on identity mismatch or self-check failure, so the
 *   harness keeps its gateway behavior and nothing double-runs;
 * - stays inert otherwise (loud diagnostic).
 *
 * The official import surface is never covered: the official package remains
 * the module-resolution source and the fallback.
 */
import { createRequire } from 'node:module'
import { TypertGatewayError, TypertGatewayService, default as GatewayService } from './forked-host.js'
import {
  GATEWAY_OWNER_SYMBOL,
} from './shared-vocab.js'
import { attachGatewaySlices } from './slices.js'
import { fullVersionContractsMatch, runtimeIdentityMatches, LOCKED_OWNER_PACKAGE } from './version.js'

export const name = 'plugin-api-session-channel-gateway'
export const inject = ['loader']

const require = createRequire(import.meta.url)

const OFFICIAL_ROW_IDS = new Set(['typert-gateway'])
const OFFICIAL_ROW_NAME = '@deepseek-ai/dsh-api-gateway'
const OWN_PACKAGE_NAME = '@deepseek-ai/dsh-plugin-api-session-channel-gateway'
const MAIN_PACKAGE_NAME = '@deepseek-ai/dsh-plugin-api-main'

/** Default official apply fallback: resolve the official package synchronously. */
const defaultOfficialApply = (() => {
  try {
    return require('@deepseek-ai/dsh-api-gateway')?.default
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
    return undefined
  }
  return fallback
}

function isOwnedGateway(service) {
  return service != null && service[GATEWAY_OWNER_SYMBOL] === true
}

function gatewayCallable(service) {
  return (
    service != null
    && typeof service.claimsEndpoint === 'function'
    && typeof service.invoke === 'function'
    && typeof service.dispatchRpc === 'function'
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
 *   resolvePublish?: Function,
 * }} [overrides]
 */
export function createSessionChannelGatewayApply(overrides = {}) {
  const readVersion = overrides.readPackageVersion ?? readPackageVersion
  const readApi = overrides.readPackageApi ?? readPackageApi
  const ForkedApply = overrides.forkedApply ?? (() => {
    // The official gateway's `apply` is the default export (TypertGatewayService class).
    // The loader instantiates the plugin class. Our forked version mirrors this.
    // For the replacement, we instantiate the forked TypertGatewayService.
    return (ctx) => {
      new TypertGatewayService(ctx)
    }
  })
  const OfficialApply = overrides.officialApply ?? defaultOfficialApply
  const officialAvailable = overrides.officialAvailable ?? (OfficialApply !== undefined)
  const resolveFacade = overrides.resolveFacade ?? ((ctx) => {
    try {
      return ctx.get('pluginApi')?.sessionChannel
    } catch {
      return undefined
    }
  })
  const resolvePublish = overrides.resolvePublish ?? ((ctx) => {
    try {
      return ctx.get('pluginApi')?.remote?.publish
    } catch {
      return undefined
    }
  })

  return function apply(ctx) {
    try {
      const row = inspectComposition(ctx)
      const present = row !== undefined
      const disabled = present ? Boolean(row.disabled) : false

      // Conflict / idempotent re-apply
      let existing
      try {
        existing = ctx.get('typertGateway')
      } catch {
        existing = undefined
      }
      if (existing !== undefined && existing !== null) {
        if (isOwnedGateway(existing)) return
        logDiagnostic(ctx, 'session-channel: another provider already owns ctx.typertGateway; staying inert (conflict)')
        return
      }

      const runtimeOk = readVersion('@deepseek-ai/dsh-api-gateway') === '0.1.0-rc.6'
      const mainConsistent = fullVersionContractsMatch({
        ownVersion: readVersion(OWN_PACKAGE_NAME),
        ownApi: readApi(OWN_PACKAGE_NAME),
        mainVersion: readVersion(MAIN_PACKAGE_NAME),
        mainApi: readApi(MAIN_PACKAGE_NAME),
      })
      const versionOk = runtimeOk && mainConsistent

      const runForked = () => {
        ForkedApply(ctx)
        const gateway = ctx.get('typertGateway')
        Object.defineProperty(gateway, GATEWAY_OWNER_SYMBOL, {
          value: true,
          enumerable: false,
          configurable: false,
          writable: false,
        })

        // Get the connection service for channel RPC route registration
        let connection
        try { connection = ctx.get('connection') } catch { connection = undefined }

        const slices = attachGatewaySlices({
          connection,
          facade: () => resolveFacade(ctx),
          publish: resolvePublish(ctx),
          logger: ctx.logger,
        })

        // Post-register verification
        const verify = gatewayCallable(ctx.get('typertGateway'))
        if (!verify) {
          slices.dispose()
          logDiagnostic(ctx, 'session-channel: post-register verification failed; slices detached and stayed inert')
          return
        }
        logDiagnostic(ctx, 'session-channel: forked gateway host registered with channel RPC dispatch and remote namespace slices')
        return slices.dispose
      }

      if (versionOk) {
        if (present && !disabled) {
          logDiagnostic(ctx, 'session-channel: official typert-gateway row is enabled; leaving the official provider in place')
          return
        }
        let disposer
        try {
          disposer = runForked()
        } catch (error) {
          logDiagnostic(ctx, `session-channel: failed to register the forked gateway host; staying inert: ${error?.name ?? 'Error'}`)
          return
        }
        return disposer
      }

      const mismatchNotes = []
      if (!runtimeOk) mismatchNotes.push('runtime/package identity mismatch')
      if (!mainConsistent) mismatchNotes.push('main facade version mismatch')
      const mismatchNote = mismatchNotes.join(' and ') || 'identity mismatch'

      if (present && !disabled) {
        logDiagnostic(ctx, `session-channel: ${mismatchNote} and the official row is enabled; leaving the official provider in place`)
        return
      }
      const presenceNote = present
        ? 'the official typert-gateway row is disabled'
        : 'the official typert-gateway row is absent'
      if (officialAvailable === false) {
        logDiagnostic(ctx, `session-channel: ${mismatchNote}, ${presenceNote}, and the official dsh-api-gateway package is not resolvable; staying inert`)
        return
      }
      try {
        OfficialApply(ctx, {})
        logDiagnostic(ctx, `session-channel: ${mismatchNote} and ${presenceNote}; replacement slices disabled, registered the official-equivalent fallback gateway host`)
      } catch (error) {
        logDiagnostic(ctx, `session-channel: ${mismatchNote} and fallback registration failed; staying inert: ${error?.name ?? 'Error'}`)
      }
    } catch (error) {
      logDiagnostic(ctx, `session-channel: apply self-check failed; staying inert: ${error?.name ?? 'Error'}`)
    }
  }
}

/** Default fail-safe apply used by the DSH loader. */
export const apply = createSessionChannelGatewayApply()

export { TypertGatewayError, TypertGatewayService }