/**
 * Executor handshake: the companion CLI reports its own build identity so
 * the facade can run the two-direction version check (constitution):
 * direction ① `builtForRuntime` (runtime part of the full unique version)
 * must equal the installed official runtime full identity; direction ②
 * `apiProtocol` (`dsh.api` major.minor) must match the main facade's
 * contract. The check itself is performed by the facade; the executor only
 * reports truthfully from its own manifest.
 */

/**
 * @param {object | undefined} manifest - own package.json.
 * @param {string | undefined} _storage - reserved for storage-aware
 *   handshake extensions; kept out of the result shape.
 * @returns {object} frozen terminal result:
 *   `{ outcome: 'success', builtForRuntime, apiProtocol, version }`
 *   or `{ outcome: 'error', code, reason }` when the manifest is unreadable.
 */
export function runHandshake(manifest, _storage) {
  if (!manifest) {
    return {
      outcome: 'error',
      code: 'internal',
      reason: 'own-manifest-unreadable',
    }
  }
  const version = typeof manifest.version === 'string' ? manifest.version : undefined
  const apiProtocol = typeof manifest.dsh?.api === 'string' ? manifest.dsh.api.trim() : undefined
  const builtForRuntime = typeof version === 'string' ? version.match(/^(.+)-\d+\.\d+(?:\.\d+)?$/)?.[1] : undefined
  if (typeof builtForRuntime !== 'string' || typeof apiProtocol !== 'string') {
    return {
      outcome: 'error',
      code: 'internal',
      reason: 'own-manifest-invalid-version-shape',
    }
  }
  return {
    outcome: 'success',
    code: undefined,
    reason: undefined,
    builtForRuntime,
    apiProtocol,
    version,
  }
}