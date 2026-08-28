/**
 * Version-negotiation helpers for the replacement bundle
 * `@deepseek-ai/dsh-plugin-api-tool-skill`.
 *
 * Pure functions (zero harness dependencies). The full unique package version
 * is `<runtime full version>-<api protocol major.minor>`; direction ① pins the
 * runtime and the replaced owner package identity, direction ② compares the
 * main facade's negotiated API protocol.
 */

/** The locked runtime/owner identity this bundle is built against. */
export const LOCKED_RUNTIME_VERSION = '0.1.0-rc.6'

/** Locked replacement owner package name. */
export const LOCKED_OWNER_PACKAGE = '@deepseek-ai/dsh-tool-skill'

/**
 * Parse a full unique package version `<runtime>-<api.major>.<api.minor>`.
 * @param {unknown} version
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
 * Whether two full unique versions agree on runtime and API protocol, and each
 * package's `dsh.api` agrees with its own version suffix.
 * @param {{ ownVersion?: unknown, ownApi?: unknown, mainVersion?: unknown, mainApi?: unknown }} input
 * @returns {boolean}
 */
export function fullVersionContractsMatch({ ownVersion, ownApi, mainVersion, mainApi } = {}) {
  const own = parseFullVersion(ownVersion)
  const main = parseFullVersion(mainVersion)
  return Boolean(
    own
    && main
    && own.runtime === main.runtime
    && own.api === main.api
    && ownApi === own.api
    && mainApi === main.api,
  )
}

/**
 * Whether an installed package identity exactly equals a locked value.
 * @param {unknown} installed
 * @param {string} [locked]
 * @returns {boolean}
 */
export function runtimeIdentityMatches(installed, locked = LOCKED_RUNTIME_VERSION) {
  return installed === locked
}