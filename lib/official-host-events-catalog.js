/**
 * Declarative catalog leaves for the remaining official host events.
 *
 * The integration owner composes the `catalog` member of each slice into the host event catalog
 * after evaluating `isAvailable(ctx)`. This module deliberately owns no
 * native listener, producer bridge, replay, or catalog composition behavior.
 */

function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function createCatalog(entries) {
  return deepFreeze(Object.fromEntries(entries.map((entry) => [entry.name, entry])))
}

function hasThenableShape(value) {
  let current = value
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, 'then')
    if (descriptor) {
      return descriptor.get !== undefined || typeof descriptor.value === 'function'
    }
    current = Object.getPrototypeOf(current)
  }
  return false
}

function providerAvailable(providerName) {
  return (ctx) => {
    try {
      if (typeof ctx?.get !== 'function') return false
      const provider = ctx.get(providerName)
      if (provider === null || (typeof provider !== 'object' && typeof provider !== 'function')) return false
      if (hasThenableShape(provider)) return false
      const prototype = Object.getPrototypeOf(provider)
      return Reflect.ownKeys(provider).length > 0 || (prototype !== null && prototype !== Object.prototype)
    } catch {
      return false
    }
  }
}

function createSlice(name, providerName, catalog) {
  return Object.freeze({
    name,
    catalog,
    isAvailable: providerAvailable(providerName),
  })
}

export const agentLoopConfigStartFailedEventsCatalog = createCatalog([
  {
    name: 'agent-loop/config-start-failed',
    mode: 'emit',
    scopeFiltered: false,
    scopeKey: undefined,
    payload: '{ sessionId, error }',
    args: '(payload)',
    fault: 'contain',
    freeze: 'all',
  },
])

export const agentPresetSelectedEventsCatalog = createCatalog([
  {
    name: 'agent-preset/selected',
    mode: 'emit',
    scopeFiltered: false,
    scopeKey: undefined,
    payload: 'sessionId; agentPreset',
    args: '(sessionId, agentPreset)',
    fault: 'contain',
    freeze: 'all',
  },
])

export const cordisDynamicLifecycleEventsCatalog = createCatalog([
  {
    name: 'cordis/dynamic-package',
    mode: 'emit',
    scopeFiltered: false,
    scopeKey: undefined,
    payload: 'DynamicCordisPackage',
    args: '(pkg)',
    fault: 'contain',
    freeze: 'all',
  },
  {
    name: 'cordis/dynamic-retract',
    mode: 'emit',
    scopeFiltered: false,
    scopeKey: undefined,
    payload: 'DynamicCordisRetracted',
    args: '(retracted)',
    fault: 'contain',
    freeze: 'all',
  },
  {
    name: 'cordis/request-run',
    mode: 'emit',
    scopeFiltered: false,
    scopeKey: undefined,
    payload: 'DynamicCordisRunRequest',
    args: '(request)',
    fault: 'contain',
    freeze: 'all',
  },
  {
    name: 'cordis/request-run-resolved',
    mode: 'emit',
    scopeFiltered: false,
    scopeKey: undefined,
    payload: 'DynamicCordisRequestResolved',
    args: '(resolved)',
    fault: 'contain',
    freeze: 'all',
  },
])

export const cordisInspectLifecycleEventsCatalog = createCatalog([
  {
    name: 'cordis/inspect-query',
    mode: 'emit',
    scopeFiltered: false,
    scopeKey: undefined,
    payload: 'CordisInspectQueryRequest',
    args: '(request)',
    fault: 'contain',
    freeze: 'all',
  },
  {
    name: 'cordis/inspect-query-resolved',
    mode: 'emit',
    scopeFiltered: false,
    scopeKey: undefined,
    payload: 'CordisInspectQueryResolved',
    args: '(resolved)',
    fault: 'contain',
    freeze: 'all',
  },
])

export const storageDomainChangedEventsCatalog = createCatalog([
  {
    name: 'domain/changed',
    mode: 'emit',
    scopeFiltered: false,
    scopeKey: undefined,
    payload: 'DomainChanged',
    args: '(change)',
    fault: 'contain',
    freeze: 'all',
  },
])

/**
 * The five independent leaves consumed by the integration owner.
 * Availability probes only resolve the owning provider service and never
 * inspect or invoke its members.
 */
export const officialHostEventCatalogSlices = Object.freeze([
  createSlice('agentLoopConfigStartFailed', 'agentLoop', agentLoopConfigStartFailedEventsCatalog),
  createSlice('agentPresetSelected', 'agentPresets', agentPresetSelectedEventsCatalog),
  createSlice('cordisDynamicLifecycle', 'dynamicCordisRunner', cordisDynamicLifecycleEventsCatalog),
  createSlice('cordisInspectLifecycle', 'cordisInspect', cordisInspectLifecycleEventsCatalog),
  createSlice('storageDomainChanged', 'storageDomain', storageDomainChangedEventsCatalog),
])
