/**
 * Plugin entry for the R-class replacement bundle
 * `@deepseek-ai/dsh-plugin-api-session-title`.
 *
 * apply() is fail-safe by design (AGENTS.md §2.6): it NEVER throws. It runs the
 * boot self-check matrix from requirements §4 and design C3, then either:
 * - registers the forked SessionTitleService (with the `session-title/candidate`
 *   vocabulary and the contract symbol) when the official row is disabled/absent
 *   and identity matches;
 * - registers the official-equivalent fallback (no new event) on identity mismatch;
 * - stays inert with one clear diagnostic otherwise.
 *
 * Config continuity (design C3): a user's custom `session-title` row config is
 * honored even though the row is disabled by this patch (the official patch
 * engine merges config by key without resetting `disabled`); invalid official
 * config falls back to this bundle's config.
 *
 * The dependency-injection seams (`readPackageVersion`, `forkedEngine`,
 * `officialEngine`, `officialAvailable`) exist only so tests can drive the full
 * 3×2 matrix without a real harness.
 */
import { createRequire } from 'node:module'
import { SessionTitleService as OfficialSessionTitleService } from '@deepseek-ai/dsh-session-title'
import { SessionTitleService as ForkedService, SESSION_TITLE_ACTIVE_SYMBOL } from './forked-service.js'

export const name = 'dsh-plugin-api-session-title'
export const inject = ['loader']

const require = createRequire(import.meta.url)

const OFFICIAL_ROW_IDS = new Set(['session-title'])
const OFFICIAL_ROW_NAME = '@deepseek-ai/dsh-session-title'
const DEFAULT_CONFIG = Object.freeze({ fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 })

function readPackageVersion(packageName) {
  try {
    return require(`${packageName}/package.json`)?.version
  } catch {
    return undefined
  }
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
    // loader enumeration failure is treated as "absent" and handled by the
    // versionOk/absent branch; never throws through apply (requirements 4.5).
    return undefined
  }
  return fallback
}

function isPositiveInt(value) {
  return Number.isInteger(value) && value > 0
}

/**
 * Official-equivalent config validation (design C3): the three Config fields are
 * positive integers and `fallbackMaxBytes <= maxTitleBytes`. Returns a fresh
 * normalized object or `undefined` when invalid.
 */
function validateConfig(config) {
  if (config === null || typeof config !== 'object') return undefined
  const candidate = config
  if (!isPositiveInt(candidate.fallbackMaxWords) || !isPositiveInt(candidate.fallbackMaxBytes) || !isPositiveInt(candidate.maxTitleBytes)) return undefined
  if (candidate.fallbackMaxBytes > candidate.maxTitleBytes) return undefined
  return { fallbackMaxWords: candidate.fallbackMaxWords, fallbackMaxBytes: candidate.fallbackMaxBytes, maxTitleBytes: candidate.maxTitleBytes }
}

/**
 * Config continuity resolution (design C3/D5): start from this bundle's own
 * config; when the (disabled) official row still carries a valid custom config,
 * honor the user's config; an invalid official config falls back to this
 * bundle's config with one diagnostic. Everything is try/caught and falls back
 * to builtin defaults (5/40/80) so apply never throws (requirements 4.5).
 */
function resolveSessionTitleConfig(ctx, ownConfig, officialRow) {
  try {
    let config = validateConfig(ownConfig)
    if (config === undefined) {
      if (ownConfig !== null && typeof ownConfig === 'object') {
        logDiagnostic(ctx, 'session-title-r1: invalid own config; falling back to builtin defaults (5/40/80)')
      }
      config = { ...DEFAULT_CONFIG }
    }
    if (officialRow !== undefined) {
      const official = validateConfig(officialRow.options?.config)
      if (official !== undefined) return official
      logDiagnostic(ctx, 'session-title-r1: official session-title row config is invalid; using this bundle config')
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
 * @param {{readPackageVersion?: Function, forkedEngine?: Function, officialEngine?: Function, officialAvailable?: boolean}} [overrides]
 */
export function createSessionTitleApply(overrides = {}) {
  const readVersion = overrides.readPackageVersion ?? readPackageVersion
  const Forked = overrides.forkedEngine ?? ForkedService
  const Official = overrides.officialEngine ?? OfficialSessionTitleService
  const officialAvailable = overrides.officialAvailable ?? true

  return function apply(ctx) {
    try {
      const row = inspectComposition(ctx)
      const present = row !== undefined
      const disabled = present ? Boolean(row.disabled) : false

      // 4.6 conflict / idempotent re-apply: the earliest registered provider
      // owns `ctx.sessionTitle`; later claimants stay inert.
      let existing
      try {
        existing = ctx.get('sessionTitle')
      } catch {
        existing = undefined
      }
      if (existing !== undefined && existing !== null) {
        if (isForkedProvider(existing)) return
        logDiagnostic(ctx, 'session-title-r1: another provider already owns ctx.sessionTitle; staying inert (conflict)')
        return
      }

      const runtimeOk = readVersion('@deepseek-ai/dsh-llm') === '0.1.0-rc.6'
      const forkBaseOk = readVersion('@deepseek-ai/dsh-session-title') === '0.1.0-rc.6'
      const versionOk = runtimeOk && forkBaseOk
      const ownConfig = ctx.fiber?.entry?.options?.config ?? {}
      const config = resolveSessionTitleConfig(ctx, ownConfig, row)

      if (versionOk) {
        if (present && !disabled) {
          logDiagnostic(ctx, 'session-title-r1: official session-title row is enabled; leaving the official provider in place')
          return
        }
        // present-disabled or absent → forked provider with the new vocabulary.
        let disposer
        try {
          disposer = ctx.plugin(Forked, config)
        } catch (error) {
          logDiagnostic(ctx, `session-title-r1: failed to register the forked provider; staying inert: ${error?.name ?? 'Error'}`)
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
          logDiagnostic(ctx, 'session-title-r1: post-register verification failed; rolled back and stayed inert')
          return
        }
        return
      }

      // version mismatch → official-equivalent fallback or inert (4.4)
      if (present && !disabled) {
        logDiagnostic(ctx, 'session-title-r1: runtime/package identity mismatch and the official row is enabled; leaving the official provider in place')
        return
      }
      const presenceNote = present
        ? 'the official session-title row is disabled'
        : 'the official session-title row is absent'
      if (!officialAvailable) {
        logDiagnostic(ctx, `session-title-r1: runtime/package identity mismatch, ${presenceNote}, and the official dsh-session-title package is not resolvable; staying inert`)
        return
      }
      try {
        ctx.plugin(Official, config)
        logDiagnostic(ctx, `session-title-r1: runtime/package identity mismatch and ${presenceNote}; registered the official-equivalent fallback provider without events`)
      } catch (error) {
        logDiagnostic(ctx, `session-title-r1: runtime/package identity mismatch and fallback registration failed; staying inert: ${error?.name ?? 'Error'}`)
      }
    } catch (error) {
      logDiagnostic(ctx, `session-title-r1: apply self-check failed; staying inert: ${error?.name ?? 'Error'}`)
    }
  }
}

/** Default fail-safe apply used by the DSH loader. */
export const apply = createSessionTitleApply()
