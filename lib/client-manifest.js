/**
 * Pure helper for the official dsh.client package declaration.
 *
 * The host loader owns discovery and boot. This module only validates the
 * declaration and returns a defensive, immutable copy of its official shape.
 */

/**
 * Validate and normalize a package's official web client declaration.
 *
 * @param {{ platform: string, inject?: string[], immediately?: boolean }} input
 * @returns {Readonly<{ platform: 'web', inject?: readonly string[], immediately?: boolean }>}
 */
export function defineManifest(input) {
  if (!isRecord(input)) throw new TypeError('dsh.client manifest must be an object')
  if (input.platform !== 'web') {
    throw new TypeError('dsh.client manifest.platform must be "web"')
  }

  const manifest = { platform: 'web' }
  if (input.inject !== undefined) {
    if (!Array.isArray(input.inject) || input.inject.some((value) => typeof value !== 'string')) {
      throw new TypeError('dsh.client manifest.inject must be a string array')
    }
    manifest.inject = Object.freeze([...input.inject])
  }
  if (input.immediately !== undefined) {
    if (typeof input.immediately !== 'boolean') {
      throw new TypeError('dsh.client manifest.immediately must be a boolean')
    }
    manifest.immediately = input.immediately
  }
  return Object.freeze(manifest)
}

/**
 * Test whether a value has the official dsh.client field shape.
 * Unknown fields are intentionally ignored, matching the official parser.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isManifest(value) {
  if (!isRecord(value) || value.platform !== 'web') return false
  if (value.inject !== undefined && (!Array.isArray(value.inject) || value.inject.some((item) => typeof item !== 'string'))) {
    return false
  }
  return value.immediately === undefined || typeof value.immediately === 'boolean'
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
