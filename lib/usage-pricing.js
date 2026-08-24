/**
 * Evidence-only pricing registry and cost determination for the pluginApi.usage
 * surface.
 *
 * Pricing registration is evidence-only: it never alters execution routing,
 * provider selection, or approval decisions. Cost is derived from an explicit
 * pricing revision so historical reports stay explainable when prices change;
 * when no matching price exists the usage is retained and cost stays
 * `null`/unknown (never an invented zero or current price). A pricing revision
 * is immutable on a settled record — revaluation is a distinct operation.
 *
 * The module is deterministic and self-contained (zero DSH harness
 * dependencies); prices and results are deep-frozen.
 */

import { deepFreeze } from './deep-freeze.js'

const CERTAINTIES = Object.freeze(['confirmed', 'estimated', 'unknown'])
const PRICEABLE_METRICS = Object.freeze(['input', 'output', 'cache', 'reasoning'])

function isFiniteNonNegativeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '' && value.length <= 512
}

/** Stable registry key for one (provider, model, revision) pricing entry. */
export function pricingKeyOf({ provider, model, revision }) {
  return [provider ?? '*', model ?? '*', revision].join('::')
}

/**
 * Pure cost conversion for one record's metrics against an explicit pricing
 * entry. Returns `cost: null` (cost-unavailable) when no entry exists or no
 * metric has a rate. `sourceCertainty` conveys the record's aggregated usage
 * certainty ('provider-confirmed' | otherwise) so cost certainty does not
 * claim a confirmed bill from estimated usage.
 */
export function computeCost(metrics, entry, sourceCertainty) {
  if (!entry) return { cost: null, certainty: 'unknown' }
  let cost = 0
  let has = false
  for (const key of PRICEABLE_METRICS) {
    const amount = metrics?.[key]
    const rate = entry.rates?.[key]
    if (isFiniteNonNegativeNumber(amount) && isFiniteNonNegativeNumber(rate)) {
      cost += amount * rate
      has = true
    }
  }
  if (!has) return { cost: null, certainty: 'unknown' }
  const certainty = sourceCertainty === 'provider-confirmed' ? 'confirmed' : 'estimated'
  return { cost, certainty }
}

export function createUsagePricing({ logger } = {}) {
  const registry = new Map()
  // `${provider}::${model}` -> registry key of the newest registered revision
  const latest = new Map()
  let disposed = false

  /**
   * register() adds/replaces one evidence-only pricing entry. Idempotent per
   * (provider, model, revision): an identical re-registration is a no-op
   * (`registered`); a differing entry for the same key replaces it
   * (`replaced`); different revision = a distinct entry.
   */
  function register({ provider, model, revision, currency, units, rates } = {}) {
    if (disposed) return { status: 'rejected', detail: 'pricing registry is disposed' }
    const entry = validateEntry({ provider, model, revision, currency, units, rates })
    const key = pricingKeyOf(entry)
    const previous = registry.get(key)
    const identical = previous !== undefined && JSON.stringify(previous) === JSON.stringify(entry)
    registry.set(key, deepFreeze(entry))
    latest.set(`${entry.provider ?? '*'}::${entry.model ?? '*'}`, key)
    return { status: previous === undefined ? 'registered' : identical ? 'registered' : 'replaced', key }
  }

  function validateEntry({ provider, model, revision, currency, units, rates }) {
    if (!isNonEmptyString(revision)) throw new TypeError('pricing revision is required')
    if (!isNonEmptyString(currency)) throw new TypeError('pricing currency is required')
    const entry = { revision, currency, units: isNonEmptyString(units) ? units : 'token' }
    if (isNonEmptyString(provider)) entry.provider = provider
    if (isNonEmptyString(model)) entry.model = model
    if (rates !== undefined) {
      if (rates === null || typeof rates !== 'object') {
        throw new TypeError('rates must be an object')
      }
      const cleaned = {}
      for (const key of Object.keys(rates)) {
        if (!PRICEABLE_METRICS.includes(key)) {
          throw new TypeError(`unknown pricing rate key ${JSON.stringify(key)}`)
        }
        const value = rates[key]
        if (!isFiniteNonNegativeNumber(value)) {
          throw new TypeError(`pricing rate ${key} must be a non-negative finite number`)
        }
        cleaned[key] = value
      }
      entry.rates = Object.freeze(cleaned)
    }
    return Object.freeze(entry)
  }

  /**
   * resolve() returns the newest registered pricing entry matching
   * provider/model (exact provider+model, then provider-only, then
   * model-only, then a global registration), or undefined when none matches.
   */
  function resolve({ provider, model }) {
    const requestedProvider = provider ?? '*'
    const requestedModel = model ?? '*'
    const exactKey = latest.get(`${requestedProvider}::${requestedModel}`)
    if (exactKey !== undefined) return registry.get(exactKey)
    const providerKey = latest.get(`${requestedProvider}::*`)
    if (providerKey !== undefined) return registry.get(providerKey)
    const modelKey = latest.get(`*::${requestedModel}`)
    if (modelKey !== undefined) return registry.get(modelKey)
    const globalKey = latest.get(`*::*`)
    if (globalKey !== undefined) return registry.get(globalKey)
    return undefined
  }

  /**
   * costFor() converts a record's aggregate metrics into cost + pricing
   * metadata. Returns `pricing: undefined` (cost unknown) when no price
   * matches; otherwise a frozen pricing metadata block matching the design's
   * `pricing` shape.
   */
  function costFor({ metrics, source }, { provider, model }) {
    const entry = resolve({ provider, model })
    if (entry === undefined) {
      return { pricing: undefined, cost: null, certainty: 'unknown' }
    }
    const { cost, certainty } = computeCost(metrics, entry, source)
    const sourceCertainty = source === 'provider-confirmed' ? 'confirmed' : 'estimated'
    const pricing = {
      ...(entry.provider !== undefined ? { provider: entry.provider } : {}),
      ...(entry.model !== undefined ? { model: entry.model } : {}),
      revision: entry.revision,
      currency: entry.currency,
      basis: entry.rates !== undefined ? 'rate·disjoint-units' : 'unpriced',
      certainty: CERTAINTIES.includes(certainty) ? certainty : sourceCertainty,
    }
    return { pricing: deepFreeze(pricing), cost, certainty }
  }

  function dispose() {
    if (disposed) return false
    disposed = true
    registry.clear()
    latest.clear()
    return true
  }

  return {
    register,
    resolve,
    costFor,
    dispose,
    get size() {
      return registry.size
    },
    get disposed() {
      return disposed
    },
  }
}
