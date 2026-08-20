/**
 * session type catalogs session type catalogs and type guards.
 *
 * Derives `sessionEventTypes` and `surfaceEventTypes` from the installed
 * dsh-session package at runtime:
 * - `sessionEventTypes` = every key of the official SessionEventMap
 *   (KNOWN_SESSION_EVENT_TYPES) — the appendable session LOG vocabulary.
 * - `surfaceEventTypes` = the subset of those keys that can join the
 *   model-visible surface (official `isSurfaceEligibleType`).
 *
 * The catalogs are sorted and deeply frozen; the type guards are total (never
 * throw). Invalid inputs degrade to `{ ok: false }` with empty catalogs and
 * always-false guards, so callers can keep the session feature mounted.
 *
 * Pure module: no harness dependencies (only the repo-local deepFreeze helper).
 */
import { deepFreeze } from './deep-freeze.js'

function isSetLike(value) {
  return value instanceof Set
}

/**
 * @param {object} options
 * @param {Set<string>} [options.knownSessionEventTypes]
 * @param {(type: string) => boolean} [options.isSurfaceEligibleType]
 * @returns {{
 *   ok: boolean,
 *   sessionEventTypes: readonly string[],
 *   surfaceEventTypes: readonly string[],
 *   isSessionEventType: (value: unknown) => boolean,
 *   isSurfaceEventType: (value: unknown) => boolean,
 * }}
 */
export function createSessionTypeCatalogs({ knownSessionEventTypes, isSurfaceEligibleType } = {}) {
  if (!isSetLike(knownSessionEventTypes) || typeof isSurfaceEligibleType !== 'function') {
    return {
      ok: false,
      sessionEventTypes: Object.freeze([]),
      surfaceEventTypes: Object.freeze([]),
      isSessionEventType: () => false,
      isSurfaceEventType: () => false,
    }
  }

  const sessionEventTypes = deepFreeze([...knownSessionEventTypes].sort())
  const surfaceEventTypes = deepFreeze(
    [...knownSessionEventTypes]
      .filter((type) => isSurfaceEligibleType(type))
      .sort(),
  )

  const isSessionEventType = (value) => {
    return typeof value === 'string' && knownSessionEventTypes.has(value)
  }

  const isSurfaceEventType = (value) => {
    return typeof value === 'string' && surfaceEventTypes.includes(value)
  }

  return {
    ok: true,
    sessionEventTypes,
    surfaceEventTypes,
    isSessionEventType,
    isSurfaceEventType,
  }
}
