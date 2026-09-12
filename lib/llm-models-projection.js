import { PluginApiInactiveError, PluginApiFeatureDisabledError } from './errors.js'
import { deepFreeze } from './deep-freeze.js'

/**
 * Read-time model-catalog projection (`llm.models.list`).
 *
 * One unified, deeply frozen view per read: the official adapter routes with
 * their advisory catalogs, enriched with the declared capability fields of
 * facade-registered routes (the official catalog whitelist drops declared
 * fields like a context window), plus dormant configurable-provider
 * directory entries. Pure and side-effect free — nothing is cached and no
 * official object is mutated. Decoration metadata is never consulted here:
 * only real declarations reach the projection, so a label overlay can never
 * masquerade as an official capability value.
 */
export function createLlmModelsProjection({ active, llmProvider, facadeRoutes }) {
  const officialLlm = () => {
    try {
      const llm = llmProvider?.()
      return llm && typeof llm.listProviders === 'function' ? llm : null
    } catch {
      return null
    }
  }

  const declaredByProvider = () => {
    try {
      const rows = facadeRoutes?.()
      return Array.isArray(rows) ? rows : []
    } catch {
      return []
    }
  }

  /**
   * Overlay the declared capability fields of a facade-registered route onto
   * the official advisory catalog. Official entries win on their own truth
   * fields; declared entries add fields the official whitelist drops and
   * append declared-only model ids.
   */
  const mergeDeclared = (officialModels, declaredRow) => {
    if (!declaredRow || !Array.isArray(declaredRow.models) || declaredRow.models.length === 0) {
      return officialModels
    }
    const extrasById = new Map()
    for (const model of declaredRow.models) {
      const extras = { ...model }
      delete extras.model
      extrasById.set(model.model, extras)
    }
    const merged = []
    const seen = new Set()
    for (const official of officialModels) {
      const extras = extrasById.get(official.id)
      merged.push(extras ? { ...official, ...extras } : { ...official })
      seen.add(official.id)
    }
    for (const [id, extras] of extrasById) {
      if (seen.has(id)) continue
      merged.push({
        provider: declaredRow.id,
        id,
        name: typeof extras.name === 'string' && extras.name.length > 0 ? extras.name : id,
        ...extras,
      })
    }
    return merged
  }

  return Object.freeze({
    async list() {
      if (typeof active === 'function' && !active()) throw new PluginApiInactiveError()
      const llm = officialLlm()
      if (!llm) {
        throw new PluginApiFeatureDisabledError('llm.models', 'model catalog projection is unavailable')
      }
      const declared = declaredByProvider()
      const rows = []
      let officialProviders = []
      try {
        officialProviders = llm.listProviders()
      } catch {
        officialProviders = []
      }
      for (const provider of officialProviders) {
        const row = {
          provider: provider.id,
          name: provider.name,
          registered: true,
          models: [],
        }
        try {
          const models = await llm.listModels(provider.id)
          row.models = mergeDeclared(Array.isArray(models) ? models : [], declared.find((entry) => entry.id === provider.id))
          row.availability = 'active'
        } catch (error) {
          // Honest per-entry marking: one broken catalog read must not throw
          // through the read side nor poison the other providers.
          row.availability = 'unavailable'
          row.reason = error?.message ?? 'catalog read failed'
        }
        rows.push(row)
      }
      try {
        if (typeof llm.listConfigurableProviders === 'function') {
          for (const entry of llm.listConfigurableProviders()) {
            if (rows.some((row) => row.provider === entry.provider)) continue
            rows.push({
              provider: entry.provider,
              name: typeof entry.displayName === 'string' && entry.displayName.length > 0 ? entry.displayName : entry.provider,
              registered: false,
              availability: 'dormant',
              models: [],
            })
          }
        }
      } catch {
        // a broken directory read just leaves the adapter-route rows
      }
      // Declared routes not (yet) visible in the official topology — e.g. the
      // registration seam degraded mid-flight — surface honestly as
      // unavailable instead of silently disappearing from the view.
      for (const entry of declared) {
        if (rows.some((row) => row.provider === entry.id)) continue
        rows.push({
          provider: entry.id,
          name: entry.id,
          registered: true,
          availability: 'unavailable',
          reason: 'route is not visible in the official adapter topology',
          models: [],
        })
      }
      return deepFreeze(rows)
    },
  })
}
