/**
 * Catalog composition helper.
 *
 * The pluginApi.events bus accepts exactly one catalog object. Host features
 * each own a slice of the stable event catalog; this module merges those
 * slices into one deeply frozen catalog. Duplicate event names are a coding
 * error and fail loud — silently letting one feature overwrite another's
 * entry would hide a scope collision.
 *
 * Pure module: no harness dependencies.
 */
import { deepFreeze } from './deep-freeze.js'

/**
 * Merge one or more event catalog objects into a single deeply frozen catalog.
 *
 * @param {...object} catalogs - frozen or unfrozen catalog objects
 * @returns {object} a new deeply frozen catalog containing every entry
 * @throws {Error} when any input is not an object or when two inputs share an event name
 */
export function composeCatalogs(...catalogs) {
  const composed = {}

  for (const catalog of catalogs) {
    if (catalog === null || typeof catalog !== 'object' || Array.isArray(catalog)) {
      throw new TypeError('composeCatalogs: every catalog must be an object')
    }

    for (const name of Object.keys(catalog)) {
      if (Object.hasOwn(composed, name)) {
        throw new Error(`composeCatalogs: duplicate catalog entry "${name}"`)
      }
      composed[name] = deepFreeze(catalog[name])
    }
  }

  return deepFreeze(composed)
}
