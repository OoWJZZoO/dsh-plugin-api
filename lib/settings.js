/**
 * pluginApi.settings — stabilized settings namespace facade (pluginApi).
 *
 * direct passthrough over the official `ctx.settings` service:
 * - `register` delegates to `ctx.settings.register` and wraps the returned
 *   official scope in a facade handle;
 * - `scope(ns)` reacquires a handle previously created by facade `register`;
 * - handle `get`/`mutate` delegate to official provider methods, while
 *   `watch`/`update`/`replace` delegate to the official scope.
 *
 * The official settings service is optional. When it is unavailable at call
 * time, `register`/`scope`/`inspect` throw `PluginApiServiceUnavailableError`.
 */
import { installSettingsSection as officialInstallSettingsSection } from '@deepseek-ai/dsh-settings'
import {
  PluginApiServiceUnavailableError,
  PluginApiSettingsNamespaceError,
} from './errors.js'

function createScopeHandle(ns, officialScope, getSettings) {
  return {
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
  }
}

/**
 * @param {object} options
 * @param {object} options.ctx - Cordis-like host context with `get`
 * @param {{ warn: (message: string) => void, error?: (message: string) => void }} [options.logger]
 */
export function createSettingsApi({ ctx, logger = { warn() {}, error() {} } }) {
  const scopes = new Map()

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

  return {
    isActive: true,

    register(ns, schema, options) {
      const settings = getSettings()
      const officialScope = settings.register(ns, schema, options)
      const handle = createScopeHandle(ns, officialScope, getSettings)
      scopes.set(ns, handle)
      return handle
    },

    scope(ns) {
      getSettings()
      const handle = scopes.get(ns)
      if (!handle) throw new PluginApiSettingsNamespaceError(ns)
      return handle
    },

    inspect(options) {
      return getSettings().describe(options)
    },

    installSettingsSection(ctx, ns, schema, entry, hooks) {
      return officialInstallSettingsSection(ctx, ns, schema, entry, hooks)
    },

    dispose() {
      scopes.clear()
    },
  }
}
