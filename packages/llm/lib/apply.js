/**
 * Plugin entry for the replacement bundle
 * `@deepseek-ai/dsh-plugin-api-llm`.
 *
 * apply() is fail-safe by design: it NEVER throws through boot. It runs the
 * boot self-check matrix, then either:
 * - registers the forked LlmRuntime (with the official service/event contract
 *   and the adapter decoration lifecycle) and mounts the decoration facet when
 *   the official row is disabled/absent and every identity check passes;
 * - registers the official-equivalent LlmRuntime fallback (no decoration
 *   surface) when an identity mismatch leaves the replacement feature
 *   disabled;
 * - stays inert with one bounded diagnostic otherwise. It never silently runs
 *   both the official and the replacement rows.
 *
 * Version negotiation matches the main facade policy: this package's full
 * unique version (`<runtime>-<api.major>.<api.minor>`) and `dsh.api` must
 * equal the installed main facade's values, and the locked official package +
 * runtime identity must match. On mismatch only this replacement capability is
 * disabled; unrelated main facade capabilities stay active.
 *
 * The dependency-injection seams exist only so tests can drive the matrix
 * without a real harness.
 */
import { createRequire } from 'node:module'
import { LlmRuntime as OfficialLlmRuntime } from '@deepseek-ai/dsh-llm'
import { LlmRuntime as ForkedLlmRuntime } from './forked-runtime.js'
import { attachDecorationRegistry } from './decoration-registry.js'
import {
  fullVersionContractsMatch,
  runtimeIdentityMatches,
  MAIN_PACKAGE_NAME,
  OWN_PACKAGE_NAME,
  OFFICIAL_PACKAGE_NAME,
} from './version.js'

export const name = 'plugin-api-llm'
export const inject = ['loader']

/** Component owner marker shared with the main facade (`Symbol.for` global). */
export const LLM_COMPONENT_MARKER = Symbol.for('dsh-plugin-api.llm.contract')
/** Where the attached decoration facet is published for the main facade. */
export const LLM_DECORATION_FACET = Symbol.for('dsh-plugin-api.llm.decoration')
/** Symbol-keyed internal policy authority contract published by the main facade. */
const POLICY_AUTHORITY = Symbol.for('dsh-plugin-api.policyAuthority')

/**
 * Read the internal egress gate from the root context. A missing or malformed
 * contract yields null (the replacement reports degraded coverage and does not
 * block the official path); a deny blocks the outbound side effect (fail-closed).
 */
function readEgressGate(ctx) {
  try {
    const contract = ctx?.root?.[POLICY_AUTHORITY] ?? ctx?.[POLICY_AUTHORITY]
    if (contract && typeof contract.egress?.admit === 'function') {
      return (target, component) => {
        try {
          return contract.egress.admit(target, { component })
        } catch {
          return { ok: false, outcome: 'deny', reason: 'egress policy evaluation failed' }
        }
      }
    }
  } catch {
    // fall through to a fail-closed null gate
  }
  return null
}

const require = createRequire(import.meta.url)

/** The official plugin row id this replacement disables and takes over. */
const OFFICIAL_ROW_ID = 'llm'
/** The replacement row id inserted through the bundle patch. */
const REPLACEMENT_ROW_ID = 'plugin-api-llm'
/** Locked official package identity (activation lock, not a semver range). */
const RUNTIME_VERSION = '0.1.0-rc.6'

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
    ctx?.logger?.warn?.(message)
  } catch {
    // diagnostics must never change apply outcomes
  }
}

/**
 * Inspect the loader composition for the llm component.
 * @returns {{ officialPresent: boolean, anyOfficialEnabled: boolean, replacementCount: number }}
 */
export function inspectComposition(ctx) {
  let officialPresent = false
  let anyOfficialEnabled = false
  let replacementCount = 0
  try {
    for (const entry of ctx?.loader?.entries?.() ?? []) {
      const options = entry?.options ?? {}
      const disabled = Boolean(options.disabled ?? entry?.disabled)
      const isOfficial = options.name === OFFICIAL_PACKAGE_NAME || options.id === OFFICIAL_ROW_ID
      if (isOfficial) {
        officialPresent = true
        if (!disabled) anyOfficialEnabled = true
      }
      if (options.id === REPLACEMENT_ROW_ID || options.name === OWN_PACKAGE_NAME) {
        if (!disabled) replacementCount += 1
      }
    }
  } catch {
    // loader enumeration failure is treated as "absent"; never throws through apply.
  }
  return { officialPresent, anyOfficialEnabled, replacementCount }
}

function isForkedRuntime(service) {
  return service != null && service[LLM_COMPONENT_MARKER] === true
}

/** Official public member probes for the post-register verification. */
const OFFICIAL_MEMBERS = [
  'registerAdapter',
  'listProviders',
  'registerConfigurableProviders',
  'listConfigurableProviders',
  'registerModelDiscovery',
  'discoverModels',
  'providerRetryPolicy',
  'listModels',
  'resolveModelInfo',
  'resolveCallConfig',
  'prepareCall',
  'stream',
]

function verifyRuntimeSurface(service) {
  if (service == null) return false
  for (const member of OFFICIAL_MEMBERS) {
    if (typeof service[member] !== 'function') return false
  }
  return true
}

/**
 * Build the plugin `apply` function with optional test seams.
 *
 * @param {{
 *   readPackageVersion?: Function,
 *   readPackageApi?: Function,
 *   forkedRuntime?: Function,
 *   officialRuntime?: Function,
 *   officialAvailable?: boolean,
 *   attachRegistry?: Function,
 * }} [overrides]
 */
export function createLlmApply(overrides = {}) {
  const readVersion = overrides.readPackageVersion ?? readPackageVersion
  const readApi = overrides.readPackageApi ?? readPackageApi
  const Forked = overrides.forkedRuntime ?? ForkedLlmRuntime
  const Official = overrides.officialRuntime ?? OfficialLlmRuntime
  const officialAvailable = overrides.officialAvailable ?? true
  const attachRegistry = overrides.attachRegistry ?? attachDecorationRegistry

  return function apply(ctx) {
    try {
      const composition = inspectComposition(ctx)

      // Idempotent re-apply: the earliest registered provider owns `ctx.llm`.
      let existing
      try {
        existing = ctx?.get?.('llm')
      } catch {
        existing = undefined
      }
      if (existing !== undefined && existing !== null) {
        if (isForkedRuntime(existing)) return
        logDiagnostic(ctx, 'plugin-api-llm: another provider already owns ctx.llm; staying inert (conflict)')
        return
      }

      const runtimeOk = runtimeIdentityMatches(readVersion('@deepseek-ai/dsh-llm'))
      const mainConsistent = fullVersionContractsMatch({
        ownVersion: readVersion(OWN_PACKAGE_NAME),
        ownApi: readApi(OWN_PACKAGE_NAME),
        mainVersion: readVersion(MAIN_PACKAGE_NAME),
        mainApi: readApi(MAIN_PACKAGE_NAME),
      })
      const versionOk = runtimeOk && mainConsistent

      if (composition.anyOfficialEnabled) {
        logDiagnostic(ctx, 'plugin-api-llm: an official @deepseek-ai/dsh-llm row is still enabled; leaving the official provider in place')
        return
      }
      if (composition.replacementCount !== 1) {
        logDiagnostic(ctx, `plugin-api-llm: expected exactly one active replacement row, found ${composition.replacementCount}; staying inert`)
        return
      }

      if (versionOk) {
        // present-disabled or absent → forked runtime with the decoration surface.
        let disposer
        try {
          disposer = ctx.plugin(Forked, {})
        } catch (error) {
          logDiagnostic(ctx, `plugin-api-llm: failed to register the forked runtime; staying inert: ${error?.name ?? 'Error'}`)
          return
        }
        const runtime = ctx.get('llm')
        if (!verifyRuntimeSurface(runtime)) {
          try {
            disposer?.()
          } catch {
            // rollback must never throw
          }
          logDiagnostic(ctx, 'plugin-api-llm: post-register verification failed; rolled back and stayed inert')
          return
        }
        try {
          runtime[LLM_COMPONENT_MARKER] = true
        } catch {
          // instance marker is best-effort; the surface probes still govern
        }
        try {
          runtime._egressGate = readEgressGate(ctx)
        } catch {
          // a missing gate degrades to no interception (selective-install semantics)
        }
        const attached = attachRegistry(runtime, { logger: ctx?.logger })
        let released = false
        try {
          const root = ctx?.root ?? ctx
          if (root) {
            root[LLM_COMPONENT_MARKER] = {
              package: OWN_PACKAGE_NAME,
              rowId: REPLACEMENT_ROW_ID,
              runtime: RUNTIME_VERSION,
              api: readApi(OWN_PACKAGE_NAME),
            }
            root[LLM_DECORATION_FACET] = attached.facet
          }
        } catch {
          // marker publication is best-effort; the loader checks still govern
        }
        ctx.effect(() => {
          return () => {
            if (released) return
            released = true
            try {
              attached.dispose()
            } catch {
              // disposal must never throw during teardown
            }
          }
        }, 'plugin-api-llm.decoration')
        return
      }

      // Some identity mismatch. Only this replacement feature is disabled;
      // when the official row is disabled/absent we still provide the original
      // service contract through the official-equivalent fallback.
      const mismatchNotes = []
      if (!runtimeOk) mismatchNotes.push('runtime identity mismatch')
      if (!mainConsistent) mismatchNotes.push('main facade version mismatch')
      const mismatchNote = mismatchNotes.join(' and ') || 'identity mismatch'
      const presenceNote = composition.officialPresent
        ? 'the official llm row is disabled'
        : 'the official llm row is absent'
      if (!officialAvailable) {
        logDiagnostic(ctx, `plugin-api-llm: ${mismatchNote}, ${presenceNote}, and the official dsh-llm package is not resolvable; staying inert`)
        return
      }
      try {
        ctx.plugin(Official, {})
        logDiagnostic(ctx, `plugin-api-llm: ${mismatchNote} and ${presenceNote}; replacement feature disabled, registered the official-equivalent fallback runtime`)
      } catch (error) {
        logDiagnostic(ctx, `plugin-api-llm: ${mismatchNote} and fallback registration failed; staying inert: ${error?.name ?? 'Error'}`)
      }
    } catch (error) {
      logDiagnostic(ctx, `plugin-api-llm: apply self-check failed; staying inert: ${error?.name ?? 'Error'}`)
    }
  }
}

/** Default fail-safe apply used by the DSH loader. */
export const apply = createLlmApply()
