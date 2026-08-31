/**
 * Plugin entry for the replacement bundle
 * `@deepseek-ai/dsh-plugin-api-session-title`.
 *
 * apply() is fail-safe by design by constitution: it NEVER throws. It runs the
 * boot self-check matrix, then either:
 * - registers the forked SessionTitleService (with the `session-title/candidate`
 *   vocabulary and the contract symbol) when the official row is disabled/absent
 *   and every identity check passes;
 * - registers the official-equivalent fallback (no new event) when an identity
 *   mismatch leaves the replacement feature disabled;
 * - stays inert with one clear diagnostic otherwise.
 *
 * Version negotiation matches the main facade policy: this package's full
 * unique version (`<runtime>-<api.major>.<api.minor>`) and `dsh.api` must equal
 * the installed main facade's values. On mismatch only this package's
 * replacement feature is disabled; the row still provides the original service
 * contract through the official-equivalent fallback.
 *
 * Config continuity: a user's custom `session-title` row config is honored even
 * though the row is disabled by this patch (the official patch engine merges
 * config by key without resetting `disabled`); invalid official config falls
 * back to this bundle's config.
 *
 * The dependency-injection seams exist only so tests can drive the matrix
 * without a real harness.
 */
import { createRequire } from 'node:module'
import { SessionTitleService as OfficialSessionTitleService } from '@deepseek-ai/dsh-session-title'
import { SessionTitleService as ForkedService, SESSION_TITLE_ACTIVE_SYMBOL } from './forked-service.js'

export const name = 'dsh-plugin-api-session-title'
export const inject = ['loader']

const require = createRequire(import.meta.url)

const OFFICIAL_ROW_IDS = new Set(['session-title'])
const OFFICIAL_ROW_NAME = '@deepseek-ai/dsh-session-title'
const OWN_PACKAGE_NAME = '@deepseek-ai/dsh-plugin-api-session-title'
const MAIN_PACKAGE_NAME = '@deepseek-ai/dsh-plugin-api-main'
const DEFAULT_CONFIG = Object.freeze({ fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 })

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

/**
 * Parse a full unique package version `<runtime>-<api.major>.<api.minor>`.
 * @returns {{ runtime: string, api: string } | null}
 */
export function parseFullVersion(version) {
  if (typeof version !== 'string') return null
  const match = /^(.+)-(\d+\.\d+)(?:\.(\d+))?$/.exec(version.trim())
    if (!match) return null
  const parsed = { runtime: match[1], api: match[2] }
  if (match[3] !== undefined) parsed.maintenance = match[3]
  return parsed
}

/**
 * The auxiliary package version contract matches the main facade when both
 * packages parse as full unique versions, agree on runtime and API protocol,
 * and each package's `dsh.api` agrees with its own version suffix.
 */
export function fullVersionContractsMatch({ ownVersion, ownApi, mainVersion, mainApi }) {
  const own = parseFullVersion(ownVersion)
  const main = parseFullVersion(mainVersion)
  if (!own || !main) return false
  return own.runtime === main.runtime &&
    own.api === main.api &&
    ownApi === own.api &&
    mainApi === main.api
}

function logDiagnostic(ctx, message) {
  try {
    ctx?.logger?.warn?.(message)
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

function isPositiveInt(value) {
  return Number.isInteger(value) && value > 0
}

/**
 * Official-equivalent config validation: the three Config fields are positive
 * integers and `fallbackMaxBytes <= maxTitleBytes`. Returns a fresh normalized
 * object or `undefined` when invalid.
 */
function validateConfig(config) {
  if (config === null || typeof config !== 'object') return undefined
  const candidate = config
  if (!isPositiveInt(candidate.fallbackMaxWords) || !isPositiveInt(candidate.fallbackMaxBytes) || !isPositiveInt(candidate.maxTitleBytes)) return undefined
  if (candidate.fallbackMaxBytes > candidate.maxTitleBytes) return undefined
  return { fallbackMaxWords: candidate.fallbackMaxWords, fallbackMaxBytes: candidate.fallbackMaxBytes, maxTitleBytes: candidate.maxTitleBytes }
}

/**
 * Config continuity resolution: start from this bundle's own config; when the
 * (disabled) official row still carries a valid custom config, honor the user's
 * config; an invalid official config falls back to this bundle's config with
 * one diagnostic. Everything is try/caught and falls back to builtin defaults
 * (5/40/80) so apply never throws.
 */
function resolveSessionTitleConfig(ctx, ownConfig, officialRow) {
  try {
    let config = validateConfig(ownConfig)
    if (config === undefined) {
      if (ownConfig !== null && typeof ownConfig === 'object') {
        logDiagnostic(ctx, 'plugin-api-session-title: invalid own config; falling back to builtin defaults (5/40/80)')
      }
      config = { ...DEFAULT_CONFIG }
    }
    if (officialRow !== undefined) {
      const official = validateConfig(officialRow.options?.config)
      if (official !== undefined) return official
      logDiagnostic(ctx, 'plugin-api-session-title: official session-title row config is invalid; using this bundle config')
    }
    return config
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

function isForkedProvider(service) {
  return service != null && service[SESSION_TITLE_ACTIVE_SYMBOL] === true
}

function providerCallable(ctx, service) {
  return (
    service != null &&
    typeof service.get === 'function' &&
    typeof service.rename === 'function' &&
    typeof service.refresh === 'function' &&
    typeof service.register === 'function' &&
    service[SESSION_TITLE_ACTIVE_SYMBOL] === true &&
    typeof ctx?.waterfall === 'function'
  )
}

/**
 * Build the plugin `apply` function with optional test seams.
 *
 * @param {{
 *   readPackageVersion?: Function,
 *   readPackageApi?: Function,
 *   forkedEngine?: Function,
 *   officialEngine?: Function,
 *   officialAvailable?: boolean,
 * }} [overrides]
 */
export function createSessionTitleApply(overrides = {}) {
  const readVersion = overrides.readPackageVersion ?? readPackageVersion
  const readApi = overrides.readPackageApi ?? readPackageApi
  const Forked = overrides.forkedEngine ?? ForkedService
  const Official = overrides.officialEngine ?? OfficialSessionTitleService
  const officialAvailable = overrides.officialAvailable ?? true

  return function apply(ctx) {
    try {
      const row = inspectComposition(ctx)
      const present = row !== undefined
      const disabled = present ? Boolean(row.disabled) : false

      // Conflict / idempotent re-apply: the earliest registered provider owns
      // `ctx.sessionTitle`; later claimants stay inert.
      let existing
      try {
        existing = ctx.get('sessionTitle')
      } catch {
        existing = undefined
      }
      if (existing !== undefined && existing !== null) {
        if (isForkedProvider(existing)) return
        logDiagnostic(ctx, 'plugin-api-session-title: another provider already owns ctx.sessionTitle; staying inert (conflict)')
        return
      }

      const runtimeOk = readVersion('@deepseek-ai/dsh-llm') === '0.1.0-rc.6'
      const forkBaseOk = readVersion('@deepseek-ai/dsh-session-title') === '0.1.0-rc.6'
      const mainConsistent = fullVersionContractsMatch({
        ownVersion: readVersion(OWN_PACKAGE_NAME),
        ownApi: readApi(OWN_PACKAGE_NAME),
        mainVersion: readVersion(MAIN_PACKAGE_NAME),
        mainApi: readApi(MAIN_PACKAGE_NAME),
      })
      const versionOk = runtimeOk && forkBaseOk && mainConsistent
      const ownConfig = ctx.fiber?.entry?.options?.config ?? {}
      const config = resolveSessionTitleConfig(ctx, ownConfig, row)

      if (versionOk) {
        if (present && !disabled) {
          logDiagnostic(ctx, 'plugin-api-session-title: official session-title row is enabled; leaving the official provider in place')
          return
        }
        // present-disabled or absent → forked provider with the new vocabulary.
        let disposer
        try {
          disposer = ctx.plugin(Forked, config)
        } catch (error) {
          logDiagnostic(ctx, `plugin-api-session-title: failed to register the forked provider; staying inert: ${error?.name ?? 'Error'}`)
          return
        }
        let verify
        try {
          verify = providerCallable(ctx, ctx.get('sessionTitle'))
        } catch {
          verify = false
        }
        if (!verify) {
          try {
            disposer?.()
          } catch {
            // rollback must never throw
          }
          logDiagnostic(ctx, 'plugin-api-session-title: post-register verification failed; rolled back and stayed inert')
          return
        }
        return
      }

      // Some identity mismatch. Only this package's replacement feature is
      // disabled; when the official row is disabled/absent we still provide the
      // original service contract through the official-equivalent fallback.
      const mismatchNotes = []
      if (!runtimeOk || !forkBaseOk) mismatchNotes.push('runtime/package identity mismatch')
      if (!mainConsistent) mismatchNotes.push('main facade version mismatch')
      const mismatchNote = mismatchNotes.join(' and ') || 'identity mismatch'

      if (present && !disabled) {
        logDiagnostic(ctx, `plugin-api-session-title: ${mismatchNote} and the official row is enabled; leaving the official provider in place`)
        return
      }
      const presenceNote = present
        ? 'the official session-title row is disabled'
        : 'the official session-title row is absent'
      if (!officialAvailable) {
        logDiagnostic(ctx, `plugin-api-session-title: ${mismatchNote}, ${presenceNote}, and the official dsh-session-title package is not resolvable; staying inert`)
        return
      }
      try {
        ctx.plugin(Official, config)
        logDiagnostic(ctx, `plugin-api-session-title: ${mismatchNote} and ${presenceNote}; replacement feature disabled, registered the official-equivalent fallback provider`)
      } catch (error) {
        logDiagnostic(ctx, `plugin-api-session-title: ${mismatchNote} and fallback registration failed; staying inert: ${error?.name ?? 'Error'}`)
      }
    } catch (error) {
      logDiagnostic(ctx, `plugin-api-session-title: apply self-check failed; staying inert: ${error?.name ?? 'Error'}`)
    }
  }
}

/** Default fail-safe apply used by the DSH loader. */
export const apply = createSessionTitleApply()
