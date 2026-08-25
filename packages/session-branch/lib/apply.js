/**
 * Fail-safe loader-row replacement entry for `@deepseek-ai/dsh-plugin-api-session-branch`.
 *
 * apply() NEVER throws (a throwing plugin apply kills the harness boot). It
 * runs the boot self-check matrix, then either:
 * - swaps in the thin delegate over the official `SessionStore` instance
 *   (contract symbol present, branch/edit surface live) when the official
 *   `session` row is disabled/absent and every identity check passes;
 * - registers the official store alone (official behavior restored, branch
 *   contract off) when an identity mismatch leaves the replacement disabled;
 * - leaves the official provider in place (or stays inert) otherwise.
 *
 * Composition semantics: only ONE provider may own `ctx.sessions`. The
 * official store is instantiated by THIS bundle (its constructor registers
 * `ctx.sessions` on the current fiber); the exposed value is then swapped to
 * the delegate in the same fiber via `ctx.set`/`ctx.reflect.set`. The official
 * instance keeps every publication hook and the typert lookup, so the
 * service/event face is structurally identical and there is no double-run.
 */

import { createRequire } from 'node:module'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { SESSION_BRANCH_MARKER, buildSessionDelegate, createOfficialSessionStore } from './delegate.js'
import { fullVersionContractsMatch, runtimeIdentityMatches } from './version.js'

export const name = 'dsh-plugin-api-session-branch'
export const inject = ['loader']

const require = createRequire(import.meta.url)

const OFFICIAL_ROW_ID = 'session'
const OFFICIAL_ROW_NAME = '@deepseek-ai/dsh-session'
const REPLACEMENT_ROW_ID = 'plugin-api-session-branch'
const OWN_PACKAGE_NAME = '@deepseek-ai/dsh-plugin-api-session-branch'
const MAIN_PACKAGE_NAME = '@deepseek-ai/dsh-plugin-api-main'
const LOCKED_RUNTIME = '0.1.0-rc.6'
/** Neutral capability reference of the registered upstream proposal. */
const UPSTREAM_PROPOSAL = 'branch-edit-contract'

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
  return service != null && service[SESSION_BRANCH_MARKER] === true
}

function delegateCallable(service) {
  return isDelegate(service)
    && typeof service.create === 'function'
    && typeof service.prepare === 'function'
    && typeof service.enter === 'function'
    && typeof service.announce === 'function'
    && typeof service.flush === 'function'
    && typeof service.get === 'function'
    && typeof service.list === 'function'
    && typeof service.fork === 'function'
    && service.branches != null
    && typeof service.branches.create === 'function'
    && typeof service.branches.graph === 'function'
    && typeof service.branches.availability === 'function'
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
 *   officialStoreFactory?: Function,
 *   delegateFactory?: Function,
 *   officialAvailable?: boolean,
 * }} [overrides]
 */
export function createSessionBranchApply(overrides = {}) {
  const readVersion = overrides.readPackageVersion ?? readPackageVersion
  const readApi = overrides.readPackageApi ?? readPackageApi
  const createStore = overrides.officialStoreFactory ?? createOfficialSessionStore
  const buildDelegate = overrides.delegateFactory ?? buildSessionDelegate
  const officialAvailable = overrides.officialAvailable ?? true

  /**
   * @param {import('@deepseek-ai/cordis').Context} ctx
   * @returns {unknown} cleanup value (or undefined); never throws
   */
  return function apply(ctx) {
    try {
      const composition = inspectComposition(ctx)
      if (composition.loaderFailed) {
        log(ctx, 'dsh-plugin-api-session-branch: loader composition probe failed; staying inert')
        return
      }
      const officialPresent = composition.official !== undefined
      const officialEnabled = officialPresent && !rowDisabled(composition.official)
      const activeReplacements = composition.replacements.filter((entry) => !rowDisabled(entry))

      // Idempotent re-apply / competitor ownership: the earliest registered
      // provider owns `ctx.sessions`.
      const existing = getService(ctx, 'sessions')
      if (isDelegate(existing)) return
      if (existing !== undefined && existing !== null) {
        log(ctx, 'dsh-plugin-api-session-branch: another provider already owns ctx.sessions; staying inert (conflict)')
        return
      }

      if (officialEnabled) {
        log(ctx, 'dsh-plugin-api-session-branch: official session row is enabled; leaving the official provider in place')
        return
      }
      if (activeReplacements.length > 1) {
        log(ctx, `dsh-plugin-api-session-branch: duplicate replacement rows detected (${activeReplacements.length}); staying inert`)
        return
      }
      if (activeReplacements.length === 0) {
        log(ctx, 'dsh-plugin-api-session-branch: replacement row is absent or disabled; staying inert')
        return
      }

      const runtimeOk = runtimeIdentityMatches(readVersion('@deepseek-ai/dsh') ?? readVersion('@deepseek-ai/dsh-llm'))
        && runtimeIdentityMatches(readVersion('@deepseek-ai/dsh-session'))
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
          official = createStore(ctx)
        } catch (error) {
          log(ctx, `dsh-plugin-api-session-branch: official session store could not be instantiated; staying inert: ${error?.name ?? 'Error'}`)
          return
        }
        let delegate
        try {
          delegate = buildDelegate({ ctx, official, logger: ctx?.logger })
        } catch (error) {
          log(ctx, `dsh-plugin-api-session-branch: delegate construction failed; official store remains registered: ${error?.name ?? 'Error'}`)
          return
        }
        let swapped = false
        try {
          setServiceValue(ctx, 'sessions', delegate)
          swapped = true
        } catch (error) {
          log(ctx, `dsh-plugin-api-session-branch: service swap failed; official store remains registered: ${error?.name ?? 'Error'}`)
        }
        const probe = swapped ? getService(ctx, 'sessions') : undefined
        const probeOk = delegateCallable(probe)
        if (!probeOk) {
          if (swapped) {
            try {
              setServiceValue(ctx, 'sessions', official)
            } catch {
              // Rollback is best effort; the official store is never "double run".
            }
          }
          log(ctx, 'dsh-plugin-api-session-branch: post-swap contract probe failed; the official store is left in place')
          return
        }
        log(ctx, `dsh-plugin-api-session-branch: replacement active — sole owner of the sessions component (runtime identity ${LOCKED_RUNTIME}; owner ${OFFICIAL_ROW_NAME}@${LOCKED_RUNTIME}; main facade dsh.api ${String(readApi(MAIN_PACKAGE_NAME))}; upstream proposal ${UPSTREAM_PROPOSAL})`)
        return
      }

      // Some identity mismatch. Only this bundle's replacement contract is
      // disabled; when the official row is disabled/absent we still provide the
      // official service through the official store so the harness keeps its
      // sessions behavior.
      const mismatch = diagnosticsForMismatch({ runtimeOk, mainOk })
      if (officialEnabled) {
        log(ctx, `dsh-plugin-api-session-branch: ${mismatch} and the official row is enabled; leaving the official provider in place`)
        return
      }
      if (!officialAvailable) {
        log(ctx, `dsh-plugin-api-session-branch: ${mismatch} and the official package is not resolvable; staying inert`)
        return
      }
      try {
        createStore(ctx)
        log(ctx, `dsh-plugin-api-session-branch: ${mismatch}; replacement contract disabled, registered the official session store`)
      } catch (error) {
        log(ctx, `dsh-plugin-api-session-branch: ${mismatch} and official registration failed; staying inert: ${error?.name ?? 'Error'}`)
      }
    } catch (error) {
      log(ctx, `dsh-plugin-api-session-branch: apply self-check failed; staying inert: ${error?.name ?? 'Error'}`)
    }
  }
}

/** Default fail-safe apply used by the DSH loader. */
export const apply = createSessionBranchApply()

/** Re-export the official store constructor for tests and parity harnesses. */
export { SessionStore }