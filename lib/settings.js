/**
 * pluginApi.settings — stabilized settings namespace facade (pluginApi).
 *
 * direct passthrough over the official `ctx.settings` service:
 * - `register` delegates to `ctx.settings.register` and wraps the returned
 *   official scope into the standard resource handle `{ id, ownerId,
 *   generation, dispose() }`; its registered domain extension members are
 *   `get` / `watch` / `update` / `replace` / `mutate`;
 * - `scope(ns)` reacquires the same handle previously created by `register`;
 * - the handle's `dispose()` releases the facade binding and discloses the
 *   official registration boundary honestly: the official registration is a
 *   ctx effect that lives as long as the facade and settings service do, so a
 *   caller unload does not remove it and there is no per-handle release path
 *   for it.
 *
 * The official settings service is optional. When it is unavailable at call
 * time, `register`/`scope`/`inspect` throw `PluginApiServiceUnavailableError`.
 * A duplicate registration of the same namespace is decided by the official
 * authority: the facade maps the refusal into the typed error family without
 * rewriting the fact. A namespace already registered by one owner cannot be
 * re-registered by another — that is a typed owner conflict raised before the
 * official call.
 */
import {
  PluginApiError,
  PluginApiServiceUnavailableError,
  PluginApiSettingsNamespaceError,
} from './errors.js'
import { staleResult } from './contract-kernel.js'
import { callerIdentityOf } from './profile-mutation.js'

function ownerOf(callerCtx) {
  try {
    const derived = callerIdentityOf(callerCtx)
    if (typeof derived === 'string' && derived.length > 0) return derived
  } catch {
    // an unresolvable caller keeps the neutral root token
  }
  return 'root'
}

/**
 * @param {object} options
 * @param {object} options.ctx - Cordis-like host context with `get`
 * @param {{ warn: (message: string) => void, error?: (message: string) => void }} [options.logger]
 */
export function createSettingsApi({ ctx, logger = { warn() {}, error() {} } }) {
  const scopes = new Map()
  let generationSeq = 0

  function getSettings() {
    try {
      const settings = typeof ctx?.get === 'function' ? ctx.get('settings') : undefined
      if (settings == null) throw new PluginApiServiceUnavailableError('settings')
      return settings
    } catch (error) {
      if (error instanceof PluginApiServiceUnavailableError) throw error
      throw new PluginApiServiceUnavailableError('settings')
    }
  }

  function createScopeHandle({ ns, ownerId, officialScope }) {
    let released = false
    return Object.freeze({
      id: ns,
      ownerId,
      generation: `${ownerId}:${ns}:${++generationSeq}`,
      get() {
        return getSettings().get(ns)
      },
      watch(callback) {
        return officialScope.watch(callback)
      },
      update(patch) {
        return officialScope.update(patch)
      },
      replace(section) {
        return officialScope.replace(section)
      },
      mutate(ops, expectedRevision) {
        return getSettings().mutate(ns, ops, expectedRevision)
      },
      dispose() {
        if (released) return staleResult('the settings binding is already released')
        released = true
        scopes.delete(ns)
        return Object.freeze({
          ok: true,
          code: 'revoked',
          reason: 'the facade binding is released; the official namespace registration persists for the lifetime of the facade and settings service (a caller unload does not remove it) and has no per-handle release path',
        })
      },
    })
  }

  return {
    register(ns, schema, options, callerCtx) {
      const settings = getSettings()
      const ownerId = ownerOf(callerCtx)
      const existing = scopes.get(ns)
      if (existing && existing.ownerId !== ownerId) {
        throw new PluginApiError(
          'PLUGIN_API_SETTINGS_OWNER_CONFLICT',
          `settings namespace "${ns}" is already registered by another owner`,
        )
      }
      let officialScope
      try {
        officialScope = settings.register(ns, schema, options)
      } catch (error) {
        if (error instanceof PluginApiError) throw error
        // The official authority decides a duplicate registration; the facade
        // only maps the refusal into the typed family, rewriting no fact.
        throw new PluginApiError(
          'PLUGIN_API_SETTINGS_REGISTRATION_REFUSED',
          `settings namespace "${ns}" registration was refused by the official authority: ${error?.message ?? error}`,
          { cause: error },
        )
      }
      const handle = createScopeHandle({ ns, ownerId, officialScope })
      scopes.set(ns, handle)
      return handle
    },

    scope(subject) {
      getSettings()
      // The canonical subject is `{ namespace, ... }`; the bare namespace
      // string stays accepted as the convenience form.
      const spec = subject !== null && typeof subject === 'object' && !Array.isArray(subject)
        ? subject
        : { namespace: subject }
      const ns = spec.namespace
      const handle = scopes.get(ns)
      if (!handle) throw new PluginApiSettingsNamespaceError(ns)
      return handle
    },

    inspect(options) {
      return getSettings().describe(options)
    },

    dispose() {
      scopes.clear()
    },
  }
}
