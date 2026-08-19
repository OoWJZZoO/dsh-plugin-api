/**
 * Plugin entry for the R-class replacement bundle
 * `@deepseek-ai/dsh-plugin-api-compaction-events`.
 *
 * apply() is fail-safe by design (AGENTS.md §2.6): it NEVER throws. It runs the
 * boot self-check matrix from requirements §4 and design C3, then either:
 * - registers the forked `BasicCompactionEngine` (with the compaction/* event
 *   vocabulary) when the official row is disabled/absent and identity matches;
 * - registers the official-equivalent fallback (no events) on identity mismatch;
 * - stays inert with one clear diagnostic otherwise.
 *
 * The dependency-injection seams (`readPackageVersion`, `forkedEngine`,
 * `officialEngine`, `officialAvailable`) exist only so tests can drive the
 * full 3×2 matrix without a real harness.
 */
import { createRequire } from 'node:module'
import { BasicCompactionEngine as OfficialBasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import { BasicCompactionEngine as ForkedEngine, COMPACTION_EVENTS_ACTIVE_SYMBOL } from './forked-engine.js'

export const name = 'dsh-plugin-api-compaction-events'
export const inject = ['loader']

const require = createRequire(import.meta.url)

const OFFICIAL_ROW_IDS = new Set(['compaction-basic'])
const OFFICIAL_ROW_NAME = '@deepseek-ai/dsh-compaction-basic'

function readPackageVersion(packageName) {
  try {
    return require(`${packageName}/package.json`)?.version
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
    // loader enumeration failure is treated as "absent" and handled by the
    // versionOk/absent branch; never throws through apply (requirements 4.5).
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
 * @param {{readPackageVersion?: Function, forkedEngine?: Function, officialEngine?: Function, officialAvailable?: boolean}} [overrides]
 */
export function createCompactionEventsApply(overrides = {}) {
  const readVersion = overrides.readPackageVersion ?? readPackageVersion
  const Forked = overrides.forkedEngine ?? ForkedEngine
  const Official = overrides.officialEngine ?? OfficialBasicCompactionEngine
  const officialAvailable = overrides.officialAvailable ?? true

  return function apply(ctx) {
    try {
      const row = inspectComposition(ctx)
      const present = row !== undefined
      const disabled = present ? Boolean(row.disabled) : false

      // 4.6 conflict / idempotent re-apply: the earliest registered provider
      // owns `ctx.compaction`; later claimants stay inert.
      let existing
      try {
        existing = ctx.get('compaction')
      } catch {
        existing = undefined
      }
      if (existing !== undefined && existing !== null) {
        if (isForkedProvider(existing)) return
        logDiagnostic(ctx, 'compaction-events-r1: another provider already owns ctx.compaction; staying inert (conflict)')
        return
      }

      const runtimeOk = readVersion('@deepseek-ai/dsh-llm') === '0.1.0-rc.6'
      const forkBaseOk = readVersion('@deepseek-ai/dsh-compaction-basic') === '0.1.0-rc.6'
      const versionOk = runtimeOk && forkBaseOk
      const config = ctx.fiber?.entry?.options?.config ?? {}

      if (versionOk) {
        if (present && !disabled) {
          logDiagnostic(ctx, 'compaction-events-r1: official compaction-basic row is enabled; leaving the official provider in place')
          return
        }
        // present-disabled or absent → forked provider with the new vocabulary.
        let disposer
        try {
          disposer = ctx.plugin(Forked, config)
        } catch (error) {
          logDiagnostic(ctx, `compaction-events-r1: failed to register the forked provider; staying inert: ${error?.name ?? 'Error'}`)
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
          logDiagnostic(ctx, 'compaction-events-r1: post-register verification failed; rolled back and stayed inert')
          return
        }
        return
      }

      // version mismatch → official-equivalent fallback or inert (4.4)
      if (present && !disabled) {
        logDiagnostic(ctx, 'compaction-events-r1: runtime/package identity mismatch and the official row is enabled; leaving the official provider in place')
        return
      }
      const presenceNote = present
        ? 'the official compaction-basic row is disabled'
        : 'the official compaction-basic row is absent'
      if (!officialAvailable) {
        logDiagnostic(ctx, `compaction-events-r1: runtime/package identity mismatch, ${presenceNote}, and the official dsh-compaction-basic package is not resolvable; staying inert`)
        return
      }
      try {
        ctx.plugin(Official, config)
        logDiagnostic(ctx, `compaction-events-r1: runtime/package identity mismatch and ${presenceNote}; registered the official-equivalent fallback provider without events`)
      } catch (error) {
        logDiagnostic(ctx, `compaction-events-r1: runtime/package identity mismatch and fallback registration failed; staying inert: ${error?.name ?? 'Error'}`)
      }
    } catch (error) {
      logDiagnostic(ctx, `compaction-events-r1: apply self-check failed; staying inert: ${error?.name ?? 'Error'}`)
    }
  }
}

/** Default fail-safe apply used by the DSH loader. */
export const apply = createCompactionEventsApply()
