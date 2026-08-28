/**
 * Minimal, dependency-free version contract utilities for the facade.
 *
 * The facade API contract is intentionally major.minor. Patch and prerelease
 * differences are considered compatible: `0.1.0-rc.6`, `0.1.0`, and `0.1`
 * all normalize to `0.1`.
 */

const VERSION_PREFIX = /^v?(\d+)\.(\d+)/

/**
 * Normalize any version-like string to `major.minor`.
 * Returns `null` when the input is missing or has no parseable major.minor.
 *
 * @param {string | undefined | null} version
 * @returns {string | null}
 */
export function normalizeVersion(version) {
  if (typeof version !== 'string') return null
  const match = VERSION_PREFIX.exec(version.trim())
  if (!match) return null
  return `${match[1]}.${match[2]}`
}

/**
 * Parse a facade API contract. Only bare `major.minor` is accepted.
 *
 * @param {string | undefined | null} contract
 * @returns {string | null}
 */
export function parseContract(contract) {
  if (typeof contract !== 'string') return null
  const value = contract.trim()
  if (!/^\d+\.\d+$/.test(value)) return null
  return value
}

/**
 * Parse the facade's full unique version string:
 * `<runtime-full-version>-<api-generation>.<api-increment>.<maintenance>`,
 * for example `0.1.0-rc.6-0.1.0` = built for runtime `0.1.0-rc.6`,
 * API protocol `0.1`, package maintenance component `0`.
 *
 * The runtime part keeps the full unique runtime version (including rc/prerelease
 * suffixes); the trailing `-<major>.<minor>.<maintenance>` segment is our own
 * package version. The maintenance component is optional for legacy
 * `<runtime>-<major>.<minor>` strings and is absent from the parsed record when
 * the input has no maintenance component.
 *
 * Returns `{ runtime, api, maintenance }` or `null` when unparseable.
 *
 * @param {string | undefined | null} version
 * @returns {{ runtime: string, api: string, maintenance?: string } | null}
 */
export function parseFacadeVersion(version) {
  if (typeof version !== 'string') return null
  const match = /^(.+)-(\d+\.\d+)(?:\.(\d+))?$/.exec(version.trim())
  if (!match) return null
  const parsed = { runtime: match[1], api: match[2] }
  if (match[3] !== undefined) parsed.maintenance = match[3]
  return parsed
}

/**
 * Whether the actual `major.minor` API protocol satisfies the declared
 * `major.minor` contract.
 * Per the version contract: the generation `B` must match exactly, and the
 * actual compatible increment `C` must be at least the required `C`
 * (`<B>.<C>` semantics; different `B` generations are incompatible).
 *
 * @param {string | undefined | null} declared
 * @param {string | undefined | null} actual
 * @returns {boolean}
 */
export function satisfiesContract(declared, actual) {
  const contract = parseContract(declared)
  const version = normalizeVersion(actual)
  if (contract === null || version === null) return false
  const [declaredGeneration, declaredIncrement] = contract.split('.').map(Number)
  const [actualGeneration, actualIncrement] = version.split('.').map(Number)
  if (declaredGeneration !== actualGeneration) return false
  return actualIncrement >= declaredIncrement
}
