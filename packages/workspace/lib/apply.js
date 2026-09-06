/**
 * Fail-safe loader-row replacement entry for
 * `@deepseek-ai/dsh-plugin-api-workspace`.
 *
 * apply() NEVER throws (a throwing plugin apply kills the harness boot). It
 * runs the boot self-check matrix, then either:
 * - swaps in the thin delegate over the official `WorkspaceRegistry`
 *   instance (contract symbol present, snapshot slice live) when the official
 *   `workspace` row is disabled and every identity check passes;
 * - registers the official registry alone (official behavior restored,
 *   snapshot contract off) when an identity mismatch leaves the replacement
 *   disabled;
 * - leaves the official provider in place (or stays inert) otherwise —
 *   headless profiles have no `workspace` row at all, which is a normal
 *   assembly difference, not a fault.
 *
 * Composition semantics: only ONE provider may own `ctx.workspaceRegistry`.
 * The official registry is instantiated by THIS bundle (its constructor
 * registers `ctx.workspaceRegistry` on the current fiber); the exposed value
 * is then swapped to the delegate in the same fiber via
 * `ctx.set`/`ctx.reflect.set`. Every official service/entity member and the
 * (empty) event face stay structurally identical and there is no double-run.
 */

import { createRequire } from 'node:module'
import { buildWorkspaceDelegate, createOfficialWorkspaceRegistry, WORKSPACE_SLICE_MARKER } from './delegate.js'
import { fullVersionContractsMatch, runtimeIdentityMatches } from './version.js'

export const name = 'dsh-plugin-api-workspace'
export const inject = ['loader']

const require = createRequire(import.meta.url)

const OFFICIAL_ROW_ID = 'workspace'
const OFFICIAL_ROW_NAME = '@deepseek-ai/dsh-workspace'
const REPLACEMENT_ROW_ID = 'plugin-api-workspace'
const OWN_PACKAGE_NAME = '@deepseek-ai/dsh-plugin-api-workspace'
const MAIN_PACKAGE_NAME = '@deepseek-ai/dsh-plugin-api-main'
const LOCKED_RUNTIME = '0.1.0-rc.6'
/** Neutral capability reference of the registered upstream proposal. */
const UPSTREAM_PROPOSAL = 'workspace-snapshot-contract'

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

function log(ctx, message) {
  try {
    ctx?.logger?.warn?.(message)
  } catch {
    // A diagnostic failure never changes activation.
  }
}

function rowOptions(entry) {
  return entry?.options ?? entry ?? {}
}

function rowDisabled(entry) {
  return Boolean(rowOptions(entry).disabled ?? entry?.disabled)
}

/**
 * Inspect the loader composition for the official row and every replacement
 * row of this bundle.
 * @returns {{ official: unknown, replacements: unknown[], loaderFailed: boolean }}
 */
function inspectComposition(ctx) {
  const result = { official: undefined, replacements: [], loaderFailed: false }
  try {
    for (const entry of ctx?.loader?.entries?.() ?? []) {
      const options = rowOptions(entry)
      if (options.id === OFFICIAL_ROW_ID || options.name === OFFICIAL_ROW_NAME) {
        if (result.official === undefined || options.id === OFFICIAL_ROW_ID) result.official = entry
      }
      if (options.id === REPLACEMENT_ROW_ID || options.name === OWN_PACKAGE_NAME) {
        result.replacements.push(entry)
      }
    }
  } catch {
    result.loaderFailed = true
  }
  return result
}

function getService(ctx, name) {
  try {
    return ctx?.get?.(name)
  } catch {
    return undefined
  }
}

function setServiceValue(ctx, name, value) {
  if (typeof ctx?.set === 'function') return ctx.set(name, value)
  try {
    return ctx?.reflect?.set?.(name, value)
  } catch {
    return undefined
  }
}

function isDelegate(service) {
  return service != null && service[WORKSPACE_SLICE_MARKER] === true
}

function delegateCallable(service) {
  return isDelegate(service)
    && typeof service.create === 'function'
    && typeof service.get === 'function'
    && typeof service.list === 'function'
    && typeof service.delete === 'function'
    && typeof service.insertBefore === 'function'
    && typeof service.archiveSession === 'function'
    && typeof service.sessionKnown === 'function'
    && typeof service.resolveByPath === 'function'
    && service.snapshot != null
    && typeof service.snapshot.capture === 'function'
    && typeof service.snapshot.get === 'function'
    && typeof service.snapshot.apply === 'function'
    && typeof service.snapshot.availability === 'function'
}

function diagnosticsForMismatch({ runtimeOk, mainOk }) {
  const reasons = []
  if (!runtimeOk) reasons.push('runtime or locked owner package identity mismatch')
  if (!mainOk) reasons.push('main facade version mismatch')
  return reasons.join(' and ') || 'replacement identity mismatch'
}

/**
 * Build the plugin `apply` with optional test seams.
 * @param {{
 *   readPackageVersion?: Function,
 *   readPackageApi?: Function,
 *   registryFactory?: Function,
 *   delegateFactory?: Function,
 *   officialAvailable?: boolean,
 * }} [overrides]
 */
export function createWorkspaceApply(overrides = {}) {
  const readVersion = overrides.readPackageVersion ?? readPackageVersion
  const readApi = overrides.readPackageApi ?? readPackageApi
  const createRegistry = overrides.registryFactory ?? createOfficialWorkspaceRegistry
  const buildDelegate = overrides.delegateFactory ?? buildWorkspaceDelegate
  const officialAvailable = overrides.officialAvailable ?? true

  /**
   * @param {import('@deepseek-ai/cordis').Context} ctx
   * @returns {unknown} cleanup value (or undefined); never throws
   */
  return function apply(ctx) {
    try {
      const composition = inspectComposition(ctx)
      if (composition.loaderFailed) {
        log(ctx, 'dsh-plugin-api-workspace: loader composition probe failed; staying inert')
        return
      }
      const officialPresent = composition.official !== undefined
      const officialEnabled = officialPresent && !rowDisabled(composition.official)
      const activeReplacements = composition.replacements.filter((entry) => !rowDisabled(entry))

      // Idempotent re-apply / competitor ownership: the earliest registered
      // provider owns `ctx.workspaceRegistry`.
      const existing = getService(ctx, 'workspaceRegistry')
      if (isDelegate(existing)) return
      if (existing !== undefined && existing !== null) {
        log(ctx, 'dsh-plugin-api-workspace: another provider already owns ctx.workspaceRegistry; staying inert (conflict)')
        return
      }

      if (officialEnabled) {
        log(ctx, 'dsh-plugin-api-workspace: official workspace row is enabled; leaving the official provider in place')
        return
      }
      if (activeReplacements.length > 1) {
        log(ctx, `dsh-plugin-api-workspace: duplicate replacement rows detected (${activeReplacements.length}); staying inert`)
        return
      }
      if (activeReplacements.length === 0) {
        log(ctx, 'dsh-plugin-api-workspace: replacement row is absent or disabled; staying inert')
        return
      }
      if (!officialPresent && !officialAvailable) {
        log(ctx, 'dsh-plugin-api-workspace: headless profile without a workspace row; snapshot slice unavailable (normal assembly difference)')
        return
      }
      if (!officialPresent && officialAvailable) {
        // The official row is not composed but the package exists (e.g. a test
        // profile that omits the row): register the official registry so the
        // workspace service face still exists, without the snapshot extension.
        try {
          createRegistry(ctx)
          log(ctx, 'dsh-plugin-api-workspace: official workspace row is absent; registered the official registry (snapshot slice off)')
        } catch (error) {
          log(ctx, `dsh-plugin-api-workspace: official registry registration failed; staying inert: ${error?.name ?? 'Error'}`)
        }
        return
      }

      const runtimeOk = runtimeIdentityMatches(readVersion('@deepseek-ai/dsh') ?? readVersion('@deepseek-ai/dsh-workspace'))
        && runtimeIdentityMatches(readVersion('@deepseek-ai/dsh-workspace'))
      const mainOk = fullVersionContractsMatch({
        ownVersion: readVersion(OWN_PACKAGE_NAME),
        ownApi: readApi(OWN_PACKAGE_NAME),
        mainVersion: readVersion(MAIN_PACKAGE_NAME),
        mainApi: readApi(MAIN_PACKAGE_NAME),
      })
      const identityOk = runtimeOk && mainOk

      if (identityOk) {
        let official
        try {
          official = createRegistry(ctx)
        } catch (error) {
          log(ctx, `dsh-plugin-api-workspace: official workspace registry could not be instantiated; staying inert: ${error?.name ?? 'Error'}`)
          return
        }
        let delegate
        try {
          delegate = buildDelegate({ ctx, official, logger: ctx?.logger })
        } catch (error) {
          log(ctx, `dsh-plugin-api-workspace: delegate construction failed; official registry remains registered: ${error?.name ?? 'Error'}`)
          return
        }
        let swapped = false
        try {
          setServiceValue(ctx, 'workspaceRegistry', delegate)
          swapped = true
        } catch (error) {
          log(ctx, `dsh-plugin-api-workspace: service swap failed; official registry remains registered: ${error?.name ?? 'Error'}`)
        }
        const probe = swapped ? getService(ctx, 'workspaceRegistry') : undefined
        const probeOk = delegateCallable(probe)
        if (!probeOk) {
          if (swapped) {
            try {
              setServiceValue(ctx, 'workspaceRegistry', official)
            } catch {
              // Rollback is best effort; the official registry is never "double run".
            }
          }
          log(ctx, 'dsh-plugin-api-workspace: post-swap contract probe failed; the official registry is left in place')
          return
        }
        log(ctx, `dsh-plugin-api-workspace: replacement active — sole owner of the workspace component (runtime identity ${LOCKED_RUNTIME}; owner ${OFFICIAL_ROW_NAME}@${LOCKED_RUNTIME}; main facade dsh.api ${String(readApi(MAIN_PACKAGE_NAME))}; upstream proposal ${UPSTREAM_PROPOSAL})`)
        return
      }

      // Some identity mismatch. Only this bundle's replacement contract is
      // disabled; when the official row is disabled/absent we still provide
      // the official service through the official registry so the harness
      // keeps its workspace behavior (no "official row disabled with no
      // working official-contract path" hole).
      const mismatch = diagnosticsForMismatch({ runtimeOk, mainOk })
      if (officialEnabled) {
        log(ctx, `dsh-plugin-api-workspace: ${mismatch} and the official row is enabled; leaving the official provider in place`)
        return
      }
      if (!officialAvailable || !officialPresent) {
        log(ctx, `dsh-plugin-api-workspace: ${mismatch} and the official package is not resolvable; staying inert`)
        return
      }
      try {
        createRegistry(ctx)
        log(ctx, `dsh-plugin-api-workspace: ${mismatch}; replacement contract disabled, registered the official workspace registry`)
      } catch (error) {
        log(ctx, `dsh-plugin-api-workspace: ${mismatch} and official registration failed; staying inert: ${error?.name ?? 'Error'}`)
      }
    } catch (error) {
      log(ctx, `dsh-plugin-api-workspace: apply self-check failed; staying inert: ${error?.name ?? 'Error'}`)
    }
  }
}

/** Default fail-safe apply used by the DSH loader. */
export const apply = createWorkspaceApply()

/** Re-export the official registry constructor for tests and parity harnesses. */
export { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'