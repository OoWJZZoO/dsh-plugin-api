/**
 * Declarative catalog leaves for the remaining official host events.
 *
 * The integration owner composes the `catalog` member of each slice into the host event catalog
 * after evaluating `isAvailable(ctx)`. This module deliberately owns no
 * native listener, producer bridge, replay, or catalog composition behavior.
 *
 * Every leaf declares the official runtime as the producer: these events are
 * dispatched natively by the official host service the leaf probes, and the
 * facade only observes them.
 */
import { officialProducer } from './events-catalog.js'

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
    producer: officialProducer('agent-loop'),
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
    producer: officialProducer('agent-preset'),
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
    producer: officialProducer('cordis'),
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
    producer: officialProducer('cordis'),
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
    producer: officialProducer('cordis'),
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
    producer: officialProducer('cordis'),
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
    producer: officialProducer('cordis'),
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
    producer: officialProducer('cordis'),
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
    producer: officialProducer('domain'),
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
