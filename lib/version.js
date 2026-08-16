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
 * Whether `actual` satisfies the declared `major.minor` contract.
 * Per spec: normalize both sides to major.minor and compare for equality.
 *
 * @param {string | undefined | null} declared
 * @param {string | undefined | null} actual
 * @returns {boolean}
 */
export function satisfiesContract(declared, actual) {
  const contract = parseContract(declared)
  const version = normalizeVersion(actual)
  if (contract === null || version === null) return false
  return contract === version
}
