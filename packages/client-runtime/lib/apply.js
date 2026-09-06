/**
 * Fail-safe loader-row replacement entry for
 * `@deepseek-ai/dsh-plugin-api-client-runtime`.
 *
 * apply() NEVER throws (a throwing plugin apply kills the harness boot). The
 * official `client-runtime` row is a browser-roster row whose host apply is a
 * no-op; its real contract lives in the browser half (`./client` bundle),
 * which this replacement preserves verbatim and extends with the attention
 * runtime. This apply runs the boot self-check matrix and then either marks
 * the attention runtime as owned by this row, or stays inert with a loud
 * diagnostic — the installation is never left with the official row disabled
 * and no working official-contract path, and nothing double-runs.
 *
 * The official import surface is never covered:
 * `import "@deepseek-ai/dsh-client-runtime"` still resolves the official
 * package.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import {
  OFFICIAL_OWNER_PACKAGE,
  OFFICIAL_ROW_ID,
  REPLACEMENT_ROW_ID,
  RUNTIME_OWNER_SYMBOL,
} from './shared-vocab.js'
import { fullVersionContractsMatch, LOCKED_RUNTIME_VERSION } from './version.js'

export const name = REPLACEMENT_ROW_ID
export const inject = ['loader']

const require = createRequire(import.meta.url)

const MAIN_PACKAGE_NAME = '@deepseek-ai/dsh-plugin-api-main'
const OWN_PACKAGE_NAME = '@deepseek-ai/dsh-plugin-api-client-runtime'

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
 * Cheap key-contract probe: the replacement bundle must actually carry the
 * official browser module (self-built bundle registered under the official
 * module id). This is the host-side verifiable half of the browser contract.
 */
function probeBrowserBundle() {
  try {
    const bundle = readFileSync(
      fileURLToPath(new URL('./client.js', import.meta.url)),
      'utf8',
    )
    return bundle.includes('@deepseek-ai/dsh-client-runtime')
  } catch {
    return false
  }
}

/**
 * Build the plugin `apply` function with optional test seams.
 *
 * @param {{
 *   readPackageVersion?: Function,
 *   readPackageApi?: Function,
 *   probeBundle?: Function,
 * }} [overrides]
 */
export function createClientRuntimeApply(overrides = {}) {
  const readVersion = overrides.readPackageVersion ?? readPackageVersion
  const readApi = overrides.readPackageApi ?? readPackageApi
  const probeBundle = overrides.probeBundle ?? probeBrowserBundle

  return function apply(ctx) {
    try {
      const row = inspectComposition(ctx)
      const present = row !== undefined
      const disabled = present ? Boolean(row.disabled) : false

      // Idempotent re-apply / conflict guard: the earliest registered owner
      // claims the browser attention runtime; later claimants stay inert.
      try {
        if (ctx[RUNTIME_OWNER_SYMBOL] === true) return
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
        // row still serves the official browser half verbatim.
        logDiagnostic(ctx, `client-runtime: attention runtime disabled (${notes.join(' and ') || 'identity mismatch'})`)
        return
      }

      if (present && !disabled) {
        logDiagnostic(ctx, 'client-runtime: official client-runtime row is enabled; leaving the official provider in place')
        return
      }

      const bundleOk = probeBundle()
      if (!bundleOk) {
        logDiagnostic(ctx, 'client-runtime: browser bundle probe failed; attention runtime not claimed')
        return
      }

      try {
        Object.defineProperty(ctx, RUNTIME_OWNER_SYMBOL, {
          value: true,
          enumerable: false,
          configurable: false,
          writable: false,
        })
      } catch {
        // marker best-effort; idempotency is additionally guarded by the route
      }
      logDiagnostic(ctx, 'client-runtime: browser attention runtime owned by this row')
      return () => {
        // teardown is marker best-effort; the browser runtime lifecycle is
        // owned by the replaced module itself.
      }
    } catch (error) {
      logDiagnostic(ctx, `client-runtime: apply self-check failed; staying inert: ${error?.name ?? 'Error'}`)
    }
  }
}

/** Default fail-safe apply used by the DSH loader. */
export const apply = createClientRuntimeApply()

export { apply as forkedApply }