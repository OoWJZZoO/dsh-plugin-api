import test from 'node:test'
import assert from 'node:assert/strict'
import { apply, mountServicesFeature } from '../lib/index.js'
import { SERVICE_DEFINITIONS, servicesNamespaceBrand } from '../lib/services.js'
import { PluginApiFeatureDisabledError } from '../lib/errors.js'
import { createFeatureRegistry } from '../lib/feature-registry.js'

function serviceNameMap() {
  return new Map(SERVICE_DEFINITIONS.map((def) => [def.ctxService, def.key]))
}

function completeService(def) {
  const service = {}
  for (const member of def.members) {
    if (member.kind === 'method') service[member.name] = () => {}
    else if (member.kind === 'getter') {
      Object.defineProperty(service, member.name, { enumerable: true, get() { return null } })
    }
  }
  return service
}

function createMockCtx(options = {}) {
  const services = { ...(options.services ?? {}) }
  const state = {
    pluginApi: undefined,
    effects: [],
  }
  const ctx = {
    logger: { error() {}, warn() {} },
    reflect: {
      provide(name, value) {
        if (name === 'pluginApi') state.pluginApi = value
      },
    },
    get(name) {
      if (name === 'pluginApi') return state.pluginApi
      if (name in services) return services[name]
      return undefined
    },
    plugin(Class) {
      const instance = new Class(ctx)
      if (options.throwServicesMount) {
        const original = instance.mountFeature.bind(instance)
        instance.mountFeature = (name, api) => {
          if (name === 'services') throw new Error('mount boom')
          return original(name, api)
        }
      }
    },
    effect(fn, label) {
      state.effects.push({ fn, label })
    },
    on(name, listener) {
      return () => {}
    },
    once() {},
    emit() {},
    serial() {},
    parallel() {},
    bail() {},
    waterfall() {},
  }
  return { ctx, state, services }
}

test('apply mounts an active frozen services namespace when all 48 official services are present', () => {
  const allServices = {}
  for (const def of SERVICE_DEFINITIONS) {
    const svc = {}
    for (const member of def.members) {
      if (member.kind === 'method') svc[member.name] = () => {}
      else if (member.kind === 'getter') {
        Object.defineProperty(svc, member.name, { enumerable: true, get() { return null } })
      }
    }
    allServices[def.ctxService] = svc
  }
  // llm/admission and events/web guards need their own probes satisfied too.
  const { ctx, state } = createMockCtx({
    services: {
      ...allServices,
      llm: { resolveModelInfo() {} },
      agents: { get() {} },
      web: {
        registerSearchProvider() {},
        registerFetchProvider() {},
        search() {},
        fetch() {},
      },
    },
  })

  assert.doesNotThrow(() => apply(ctx))

  assert.ok(state.pluginApi)
  assert.equal(state.pluginApi.isActive, true)
  assert.equal(state.pluginApi.services[servicesNamespaceBrand], true)
  assert.ok(Object.isFrozen(state.pluginApi.services))
  assert.equal(Object.keys(state.pluginApi.services).length, 48)
  assert.equal(state.pluginApi.services.fs.isActive, true)
  assert.equal(state.pluginApi.services.compaction.isActive, true)
  assert.equal(state.pluginApi.services.jobs.isActive, true)
  assert.equal(state.pluginApi.services.shellEnv.isActive, true)
})

test('apply mounts services when compaction is the only complete capability service', () => {
  const compaction = completeService(SERVICE_DEFINITIONS.find((def) => def.key === 'compaction'))
  const { ctx, state } = createMockCtx({ services: { compaction } })

  assert.doesNotThrow(() => apply(ctx))

  const feature = state.pluginApi._registry.snapshot().filter((feature) => feature.name !== 'officialPassthrough').find((entry) => entry.name === 'services')
  assert.equal(feature.isActive, true)
  assert.equal(state.pluginApi.services.compaction.isActive, true)
  assert.throws(
    () => state.pluginApi.services.fs.readText({}),
    (error) => error instanceof PluginApiFeatureDisabledError && error.feature === 'services.fs',
  )
  assert.throws(
    () => state.pluginApi.services.web.registerSearchProvider({}),
    (error) => error instanceof PluginApiFeatureDisabledError && error.feature === 'services.web',
  )
  for (const def of SERVICE_DEFINITIONS) {
    if (def.key !== 'compaction') {
      assert.equal(state.pluginApi.services[def.key].isActive, false, `${def.key} is locally disabled`)
    }
  }
})

test('apply mounts services when jobs and shellEnv are the only complete capability services', () => {
  const jobs = completeService(SERVICE_DEFINITIONS.find((def) => def.key === 'jobs'))
  const shellEnv = completeService(SERVICE_DEFINITIONS.find((def) => def.key === 'shellEnv'))
  const { ctx, state } = createMockCtx({ services: { jobs, shellEnv } })

  assert.doesNotThrow(() => apply(ctx))

  const feature = state.pluginApi._registry.snapshot().filter((feature) => feature.name !== 'officialPassthrough').find((entry) => entry.name === 'services')
  assert.equal(feature.isActive, true)
  assert.equal(state.pluginApi.services.jobs.isActive, true)
  assert.equal(state.pluginApi.services.shellEnv.isActive, true)
  assert.throws(
    () => state.pluginApi.services.compaction.compactNow({}, {}),
    (error) => error instanceof PluginApiFeatureDisabledError && error.feature === 'services.compaction',
  )
  for (const def of SERVICE_DEFINITIONS) {
    if (def.key !== 'jobs' && def.key !== 'shellEnv') {
      assert.equal(state.pluginApi.services[def.key].isActive, false, `${def.key} is locally disabled`)
    }
  }
})

test('apply keeps jobs/shellEnv siblings active when only one is hostile or incomplete', () => {
  const jobs = completeService(SERVICE_DEFINITIONS.find((def) => def.key === 'jobs'))
  const shellEnv = completeService(SERVICE_DEFINITIONS.find((def) => def.key === 'shellEnv'))
  delete shellEnv.collect
  const { ctx, state } = createMockCtx({ services: { jobs, shellEnv } })

  assert.doesNotThrow(() => apply(ctx))

  assert.equal(state.pluginApi.services.jobs.isActive, true)
  assert.equal(state.pluginApi.services.shellEnv.isActive, false)
  assert.throws(
    () => state.pluginApi.services.shellEnv.collect({}),
    (error) => error instanceof PluginApiFeatureDisabledError && error.feature === 'services.shellEnv',
  )
})

test('apply degrades hostile jobs construction while shellEnv stays active', () => {
  const jobs = completeService(SERVICE_DEFINITIONS.find((def) => def.key === 'jobs'))
  const shellEnv = completeService(SERVICE_DEFINITIONS.find((def) => def.key === 'shellEnv'))
  Object.defineProperty(jobs, 'wait', {
    get() {
      throw new Error('hostile member getter')
    },
  })
  const { ctx, state } = createMockCtx({ services: { jobs, shellEnv } })

  assert.doesNotThrow(() => apply(ctx))

  assert.equal(state.pluginApi.services.jobs.isActive, false)
  assert.equal(state.pluginApi.services.shellEnv.isActive, true)
  assert.throws(
    () => state.pluginApi.services.jobs.wait(),
    (error) => error instanceof PluginApiFeatureDisabledError && error.feature === 'services.jobs',
  )
})

test('apply degrades a missing capability service per-service while keeping the services feature active', () => {
  const allServices = {}
  for (const def of SERVICE_DEFINITIONS) {
    const svc = {}
    for (const member of def.members) {
      if (member.kind === 'method') svc[member.name] = () => {}
      else if (member.kind === 'getter') {
        Object.defineProperty(svc, member.name, { enumerable: true, get() { return null } })
      }
    }
    allServices[def.ctxService] = svc
  }
  delete allServices.fs

  const { ctx, state } = createMockCtx({
    services: {
      ...allServices,
      llm: { resolveModelInfo() {} },
      agents: { get() {} },
      web: {
        registerSearchProvider() {},
        registerFetchProvider() {},
        search() {},
        fetch() {},
      },
    },
  })

  assert.doesNotThrow(() => apply(ctx))

  assert.equal(state.pluginApi.services.fs.isActive, false)
  for (const def of SERVICE_DEFINITIONS) {
    if (def.key !== 'fs') {
      assert.equal(state.pluginApi.services[def.key].isActive, true, `${def.key} stays active`)
    }
  }
  assert.equal(state.pluginApi._registry.snapshot().filter((feature) => feature.name !== 'officialPassthrough').find((f) => f.name === 'services').isActive, true)
})

test('apply degrades hostile compaction construction while another capability remains active', () => {
  const fs = completeService(SERVICE_DEFINITIONS.find((def) => def.key === 'fs'))
  const compaction = completeService(SERVICE_DEFINITIONS.find((def) => def.key === 'compaction'))
  Object.defineProperty(compaction, 'compactNow', {
    get() {
      throw new Error('hostile member getter')
    },
  })
  const { ctx, state } = createMockCtx({ services: { fs, compaction } })

  assert.doesNotThrow(() => apply(ctx))

  const feature = state.pluginApi._registry.snapshot().filter((feature) => feature.name !== 'officialPassthrough').find((entry) => entry.name === 'services')
  assert.equal(feature.isActive, true)
  assert.equal(state.pluginApi.services.fs.isActive, true)
  assert.equal(state.pluginApi.services.compaction.isActive, false)
  assert.throws(
    () => state.pluginApi.services.compaction.compactNow(),
    (error) => error instanceof PluginApiFeatureDisabledError && error.feature === 'services.compaction',
  )
})

test('apply keeps the facade active and disables services when none of the services is present', () => {
  const { ctx, state } = createMockCtx({
    services: {
      llm: { resolveModelInfo() {} },
      agents: { get() {} },
      apiProxy: undefined,
    },
  })

  assert.doesNotThrow(() => apply(ctx))

  assert.equal(state.pluginApi.isActive, true)
  const feature = state.pluginApi._registry.snapshot().filter((feature) => feature.name !== 'officialPassthrough').find((f) => f.name === 'services')
  assert.equal(feature.isActive, false)
  assert.match(feature.reason, /capability services/)
  assert.throws(
    () => state.pluginApi.services.fs.readText({}),
    (error) => {
      assert.ok(error instanceof PluginApiFeatureDisabledError)
      assert.equal(error.feature, 'services')
      return true
    },
  )
})

test('apply never throws when services mount throws and disables the services feature', () => {
  const allServices = {}
  for (const def of SERVICE_DEFINITIONS) {
    const svc = {}
    for (const member of def.members) {
      if (member.kind === 'method') svc[member.name] = () => {}
      else if (member.kind === 'getter') {
        Object.defineProperty(svc, member.name, { enumerable: true, get() { return null } })
      }
    }
    allServices[def.ctxService] = svc
  }

  const { ctx, state } = createMockCtx({
    throwServicesMount: true,
    services: {
      ...allServices,
      llm: { resolveModelInfo() {} },
      agents: { get() {} },
      apiProxy: { sessions: { prompt() {}, selectModel() {} } },
      web: {
        registerSearchProvider() {},
        registerFetchProvider() {},
        search() {},
        fetch() {},
      },
    },
  })

  assert.doesNotThrow(() => apply(ctx))

  assert.equal(state.pluginApi.isActive, true)
  const feature = state.pluginApi._registry.snapshot().filter((feature) => feature.name !== 'officialPassthrough').find((f) => f.name === 'services')
  assert.equal(feature.isActive, false)
  assert.match(feature.reason, /did not produce a disposer|mount/)
})

test('mountServicesFeature injects uriHelpers into the sessionReferences forward members', () => {
  const service = {
    isActive: true,
    services: {},
    mountFeature(name, api) {
      if (name === 'services') this.services = api
    },
  }
  const ctx = {
    get(name) {
      if (name === 'sessionReferenceResolver') {
        return { listCandidates() {}, prepare() {} }
      }
      return {}
    },
  }
  const calls = []
  const uriHelpers = {
    encodeSessionReferenceUri(sessionId) {
      calls.push(['encode', sessionId])
      return `encoded:${sessionId}`
    },
    decodeSessionReferenceUri(uri) {
      calls.push(['decode', uri])
      return `decoded:${uri}`
    },
  }

  const disposer = mountServicesFeature({ ctx, service, logger: { error() {}, warn() {} }, uriHelpers })

  assert.equal(typeof disposer, 'function')
  assert.equal(service.services[servicesNamespaceBrand], true)
  assert.equal(service.services.sessionReferences.encodeSessionReferenceUri('s1'), 'encoded:s1')
  assert.equal(service.services.sessionReferences.decodeSessionReferenceUri('u1'), 'decoded:u1')
  assert.deepEqual(calls, [['encode', 's1'], ['decode', 'u1']])
})

test('mountServicesFeature is idempotent when the services feature is already mounted', () => {
  const service = {
    isActive: true,
    services: { [servicesNamespaceBrand]: true, fs: { isActive: true } },
    mountFeature() {
      throw new Error('must not remount')
    },
  }
  const featureRegistry = createFeatureRegistry()
  featureRegistry.mount('services')
  const disposer = mountServicesFeature({ ctx: {}, service, logger: { error() {}, warn() {} }, uriHelpers: {}, featureRegistry })
  assert.equal(typeof disposer, 'function')
  assert.equal(service.services.fs.isActive, true)
})
