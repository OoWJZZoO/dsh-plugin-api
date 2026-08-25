/**
 * Version negotiation helpers for the replacement bundle
 * `@deepseek-ai/dsh-plugin-api-mcp`.
 *
 * The replacement follows the shared main-facade policy: the full unique
 * version is `<runtime full version>-<api protocol major.minor>` (e.g.
 * `0.1.0-rc.6-0.5`), and each package's `dsh.api` carries only the protocol
 * part. The auxiliary package must agree with the installed main facade on
 * both the runtime identity and the API protocol; on mismatch only this
 * package's replacement capability is disabled.
 *
 * Pure functions only — zero harness dependency.
 */

const RUNTIME_VERSION = '0.1.0-rc.6'
const API_PROTOCOL = '0.6'

export const MAIN_PACKAGE_NAME = '@deepseek-ai/dsh-plugin-api-main'
export const OWN_PACKAGE_NAME = '@deepseek-ai/dsh-plugin-api-mcp'
export const OFFICIAL_PACKAGE_NAME = '@deepseek-ai/dsh-mcp-client'

/**
 * Parse a full unique package version `<runtime>-<api.major>.<api.minor>`.
 * @param {string|undefined} version
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
  return (
    own.runtime === main.runtime &&
    own.api === main.api &&
    ownApi === own.api &&
    mainApi === main.api
  )
}

/**
 * @returns {boolean} true when the exact locked runtime identity is the
 * installed `dsh-llm` runtime version.
 */
export function runtimeIdentityMatches(runtimeVersion) {
  return runtimeVersion === RUNTIME_VERSION
}

export { RUNTIME_VERSION, API_PROTOCOL }
