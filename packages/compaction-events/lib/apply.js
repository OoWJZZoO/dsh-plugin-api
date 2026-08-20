/**
 * Plugin entry for the replacement bundle
 * `@deepseek-ai/dsh-plugin-api-compaction-events`.
 *
 * apply() is fail-safe by design (AGENTS.md §2.6): it NEVER throws. It runs the
 * boot self-check matrix, then either:
 * - registers the forked `BasicCompactionEngine` (with the compaction/* event
 *   vocabulary) when the official row is disabled/absent and every identity
 *   check passes;
 * - registers the official-equivalent fallback (no events) when an identity
 *   mismatch leaves the replacement events disabled;
 * - stays inert with one clear diagnostic otherwise.
 *
 * Version negotiation matches the main facade policy: this package's full
 * unique version (`<runtime>-<api.major>.<api.minor>`) and `dsh.api` must equal
 * the installed main facade's values. On mismatch only this package's
 * replacement event feature is disabled; the row still provides the original
 * service contract through the official-equivalent fallback.
 *
 * The dependency-injection seams exist only so tests can drive the matrix
 * without a real harness.
 */
import { createRequire } from 'node:module'
import { BasicCompactionEngine as OfficialBasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import { BasicCompactionEngine as ForkedEngine, COMPACTION_EVENTS_ACTIVE_SYMBOL } from './forked-engine.js'

export const name = 'dsh-plugin-api-compaction-events'
export const inject = ['loader']

const require = createRequire(import.meta.url)

const OFFICIAL_ROW_IDS = new Set(['compaction-basic'])
const OFFICIAL_ROW_NAME = '@deepseek-ai/dsh-compaction-basic'
const OWN_PACKAGE_NAME = '@deepseek-ai/dsh-plugin-api-compaction-events'
const MAIN_PACKAGE_NAME = '@deepseek-ai/dsh-plugin-api-main'

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
  const match = /^(.+)-(\d+\.\d+)$/.exec(version.trim())
  return match ? { runtime: match[1], api: match[2] } : null
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

function isForkedProvider(service) {
  return service != null && service[COMPACTION_EVENTS_ACTIVE_SYMBOL] === true
}

function providerCallable(service) {
  return (
    service != null &&
    typeof service.compactIfNeeded === 'function' &&
    typeof service.compactNow === 'function' &&
    typeof service.compactRegion === 'function' &&
    typeof service.summarize === 'function' &&
    service[COMPACTION_EVENTS_ACTIVE_SYMBOL] === true
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
export function createCompactionEventsApply(overrides = {}) {
  const readVersion = overrides.readPackageVersion ?? readPackageVersion
  const readApi = overrides.readPackageApi ?? readPackageApi
  const Forked = overrides.forkedEngine ?? ForkedEngine
  const Official = overrides.officialEngine ?? OfficialBasicCompactionEngine
  const officialAvailable = overrides.officialAvailable ?? true

  return function apply(ctx) {
    try {
      const row = inspectComposition(ctx)
      const present = row !== undefined
      const disabled = present ? Boolean(row.disabled) : false

      // Conflict / idempotent re-apply: the earliest registered provider owns
      // `ctx.compaction`; later claimants stay inert.
      let existing
      try {
        existing = ctx.get('compaction')
      } catch {
        existing = undefined
      }
      if (existing !== undefined && existing !== null) {
        if (isForkedProvider(existing)) return
        logDiagnostic(ctx, 'plugin-api-compaction-events: another provider already owns ctx.compaction; staying inert (conflict)')
        return
      }

      const runtimeOk = readVersion('@deepseek-ai/dsh-llm') === '0.1.0-rc.6'
      const forkBaseOk = readVersion('@deepseek-ai/dsh-compaction-basic') === '0.1.0-rc.6'
      const mainConsistent = fullVersionContractsMatch({
        ownVersion: readVersion(OWN_PACKAGE_NAME),
        ownApi: readApi(OWN_PACKAGE_NAME),
        mainVersion: readVersion(MAIN_PACKAGE_NAME),
        mainApi: readApi(MAIN_PACKAGE_NAME),
      })
      const versionOk = runtimeOk && forkBaseOk && mainConsistent
      const config = ctx.fiber?.entry?.options?.config ?? {}

      if (versionOk) {
        if (present && !disabled) {
          logDiagnostic(ctx, 'plugin-api-compaction-events: official compaction-basic row is enabled; leaving the official provider in place')
          return
        }
        // present-disabled or absent → forked provider with the new vocabulary.
        let disposer
        try {
          disposer = ctx.plugin(Forked, config)
        } catch (error) {
          logDiagnostic(ctx, `plugin-api-compaction-events: failed to register the forked provider; staying inert: ${error?.name ?? 'Error'}`)
          return
        }
        let verify
        try {
          verify = providerCallable(ctx.get('compaction'))
        } catch {
          verify = false
        }
        if (!verify) {
          try {
            disposer?.()
          } catch {
            // rollback must never throw
          }
          logDiagnostic(ctx, 'plugin-api-compaction-events: post-register verification failed; rolled back and stayed inert')
          return
        }
        return
      }

      // Some identity mismatch. Only this package's replacement event feature
      // is disabled; when the official row is disabled/absent we still provide
      // the original service contract through the official-equivalent fallback.
      const mismatchNotes = []
      if (!runtimeOk || !forkBaseOk) mismatchNotes.push('runtime/package identity mismatch')
      if (!mainConsistent) mismatchNotes.push('main facade version mismatch')
      const mismatchNote = mismatchNotes.join(' and ') || 'identity mismatch'

      if (present && !disabled) {
        logDiagnostic(ctx, `plugin-api-compaction-events: ${mismatchNote} and the official row is enabled; leaving the official provider in place`)
        return
      }
      const presenceNote = present
        ? 'the official compaction-basic row is disabled'
        : 'the official compaction-basic row is absent'
      if (!officialAvailable) {
        logDiagnostic(ctx, `plugin-api-compaction-events: ${mismatchNote}, ${presenceNote}, and the official dsh-compaction-basic package is not resolvable; staying inert`)
        return
      }
      try {
        ctx.plugin(Official, config)
        logDiagnostic(ctx, `plugin-api-compaction-events: ${mismatchNote} and ${presenceNote}; replacement events disabled, registered the official-equivalent fallback provider`)
      } catch (error) {
        logDiagnostic(ctx, `plugin-api-compaction-events: ${mismatchNote} and fallback registration failed; staying inert: ${error?.name ?? 'Error'}`)
      }
    } catch (error) {
      logDiagnostic(ctx, `plugin-api-compaction-events: apply self-check failed; staying inert: ${error?.name ?? 'Error'}`)
    }
  }
}

/** Default fail-safe apply used by the DSH loader. */
export const apply = createCompactionEventsApply()
