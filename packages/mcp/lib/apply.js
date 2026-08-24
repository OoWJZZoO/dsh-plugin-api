/**
 * Replacement plugin entry for `@deepseek-ai/dsh-plugin-api-mcp`.
 *
 * apply() is fail-safe by design (AGENTS.md): it NEVER throws (except the
 * preserved official `failOnStartupError` startup contract). It runs the boot
 * self-check matrix, then either:
 * - registers the shared read-only `ctx.mcpCatalog` service and starts the
 *   faithful MCP connection supervisor for this server when every check
 *   passes;
 * - stays inert with one bounded diagnostic otherwise. It never silently runs
 *   both the official and the replacement rows.
 *
 * Version negotiation follows the main facade policy: this package's full
 * unique version (`<runtime>-<api.major>.<api.minor>`) and `dsh.api` must
 * agree with the installed main facade, and the locked official package +
 * runtime identity must match. On mismatch only this MCP replacement
 * capability is disabled; unrelated main facade capabilities stay active.
 *
 * The dependency-injection seams exist only so tests can drive the matrix
 * without a real harness.
 */
import { createRequire } from 'node:module'
import { Config as OfficialConfig } from '@deepseek-ai/dsh-mcp-client'
import { sharedFor, applyPayload, McpCatalogService } from './catalog.js'
import { startConnection, resolveReconnectPolicy } from './connection.js'
import {
  fullVersionContractsMatch,
  runtimeIdentityMatches,
  MAIN_PACKAGE_NAME,
  OWN_PACKAGE_NAME,
  OFFICIAL_PACKAGE_NAME,
} from './version.js'

export const name = 'plugin-api-mcp'
export const inject = ['loader', 'tools']
/** Official per-server config shape is preserved: one row per MCP server. */
export { OfficialConfig as Config }

const require = createRequire(import.meta.url)

/** The official plugin row id this replacement disables and takes over. */
const OFFICIAL_ROW_ID = 'mcp-client'
/** The replacement row id inserted through the bundle patch. */
const REPLACEMENT_ROW_ID = 'plugin-api-mcp'
/**
 * Component owner marker shared across every replacement that claims the
 * `@deepseek-ai/dsh-mcp-client` component. A replacement records its package
 * identity under this symbol on the root context; any other replacement that
 * finds a different owner there fails safe instead of double-running.
 */
const MCP_OWNER_SYMBOL = Symbol.for('dsh-plugin-api.mcp.contract')

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

/**
 * Inspect the loader composition for the mcp-client component.
 * @returns {{ anyOfficialEnabled: boolean, officialPresent: boolean, replacementCount: number }}
 */
export function inspectComposition(ctx) {
  let anyOfficialEnabled = false
  let officialPresent = false
  let replacementCount = 0
  for (const entry of ctx.loader?.entries?.() ?? []) {
    const options = entry?.options ?? {}
    const isOfficial = options.name === OFFICIAL_PACKAGE_NAME || options.id === OFFICIAL_ROW_ID
    if (isOfficial) {
      officialPresent = true
      if (!options.disabled) anyOfficialEnabled = true
    }
    if (options.id === REPLACEMENT_ROW_ID || options.name === OWN_PACKAGE_NAME) {
      if (!options.disabled) replacementCount += 1
    }
  }
  return { anyOfficialEnabled, officialPresent, replacementCount }
}

/**
 * Build the plugin `apply` function with optional test seams.
 *
 * @param {{
 *   readPackageVersion?: Function,
 *   readPackageApi?: Function,
 *   enumerateLoader?: Function,
 *   startConnectionOverride?: Function,
 * }} [overrides]
 */
export function createMcpApply(overrides = {}) {
  const readVersion = overrides.readPackageVersion ?? readPackageVersion
  const readApi = overrides.readPackageApi ?? readPackageApi
  const enumerate = overrides.enumerateLoader ?? inspectComposition

  return async function apply(ctx, config) {
    const resolvedConfig = config ?? {}
    const serverName = typeof resolvedConfig.serverName === 'string' ? resolvedConfig.serverName : '(unknown)'
    try {
      const composition = enumerate(ctx)

      if (composition.anyOfficialEnabled) {
        logDiagnostic(ctx, `plugin-api-mcp: an official @deepseek-ai/dsh-mcp-client row is still enabled; staying inert to avoid double registration`)
        return
      }
      if (composition.replacementCount > 1) {
        logDiagnostic(ctx, `plugin-api-mcp: duplicate replacement row detected (${composition.replacementCount} active); staying inert`)
        return
      }

      const runtimeOk = runtimeIdentityMatches(readVersion('@deepseek-ai/dsh-llm'))
      const officialOk = readVersion(OFFICIAL_PACKAGE_NAME) === '0.1.0-rc.6'
      const mainConsistent = fullVersionContractsMatch({
        ownVersion: readVersion(OWN_PACKAGE_NAME),
        ownApi: readApi(OWN_PACKAGE_NAME),
        mainVersion: readVersion(MAIN_PACKAGE_NAME),
        mainApi: readApi(MAIN_PACKAGE_NAME),
      })
      const versionOk = runtimeOk && officialOk && mainConsistent
      if (!versionOk) {
        const notes = []
        if (!runtimeOk) notes.push('runtime identity mismatch')
        if (!officialOk) notes.push('official package identity mismatch')
        if (!mainConsistent) notes.push('main facade version mismatch')
        logDiagnostic(ctx, `plugin-api-mcp: ${notes.join(' and ')}; replacement disabled, host facade kept intact`)
        return
      }

      const root = ctx.root ?? ctx
      const shared = sharedFor(ctx)

      // Component-level unique owner: another replacement already claiming the
      // @deepseek-ai/dsh-mcp-client component on this root is a conflict — fail
      // safe instead of running both replacements.
      const priorOwner = root?.[MCP_OWNER_SYMBOL]
      if (priorOwner && priorOwner.package !== OWN_PACKAGE_NAME) {
        logDiagnostic(ctx, `plugin-api-mcp: another replacement (${priorOwner.package}) already owns the @deepseek-ai/dsh-mcp-client component on this root; staying inert`)
        return
      }

      if (shared.service === null) {
        try {
          shared.service = root.plugin(McpCatalogService, shared)
          shared.emitCtx = root
        } catch (error) {
          logDiagnostic(ctx, `plugin-api-mcp: failed to register the catalog service; staying inert: ${error?.name ?? 'Error'}`)
          return
        }
      }
      if (!root[MCP_OWNER_SYMBOL]) {
        try {
          root[MCP_OWNER_SYMBOL] = { package: OWN_PACKAGE_NAME }
        } catch {
          // owner marker is best-effort; the loader checks still govern
        }
      }
      let probe = false
      try {
        probe = shared.service !== null && (typeof ctx.get !== 'function' || ctx.get('mcpCatalog') != null)
      } catch {
        probe = shared.service !== null
      }
      if (!probe) {
        logDiagnostic(ctx, 'plugin-api-mcp: catalog service post-registration probe failed; staying inert')
        return
      }

      const startConnectionImpl = overrides.startConnectionOverride ?? startConnection
      const reconnect = resolveReconnectPolicy(resolvedConfig.reconnect, `plugin-api-mcp(${serverName}): reconnect`)
      const connection = startConnectionImpl(ctx, resolvedConfig, reconnect, {
        onPublish: (payload) => applyPayload(shared, root, payload),
      })

      let released = false
      ctx.effect(() => {
        return () => {
          if (released) return
          released = true
          Promise.resolve(connection.dispose()).catch(() => {
            // disposal must never throw during teardown
          })
        }
      }, 'plugin-api-mcp.connection')

      const outcome = await connection.ready
      if (outcome.error !== undefined && resolvedConfig.failOnStartupError) {
        throw new Error(`plugin-api-mcp(${serverName}): initial connection or tool synchronization failed`, {
          cause: outcome.error,
        })
      }
    } catch (error) {
      logDiagnostic(ctx, `plugin-api-mcp: apply self-check failed; staying inert: ${error?.name ?? 'Error'}`)
    }
  }
}

/** Default fail-safe apply used by the DSH loader. */
export const apply = createMcpApply()

export { fullVersionContractsMatch, parseFullVersion } from './version.js'
