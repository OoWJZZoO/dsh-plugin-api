import test from 'node:test'
import assert from 'node:assert/strict'
import { createFeatureRegistry } from '../lib/feature-registry.js'
import {
  PluginApiFeatureDisabledError,
  PluginApiInactiveError,
} from '../lib/errors.js'
import { createPluginApiService } from '../lib/plugin-api-service.js'

function instantiate(ServiceClass, ctx) {
  return new ServiceClass(ctx)
}

function mockCtx(tools = undefined) {
  const getCalls = []
  return {
    getCalls,
    reflect: { provide() {} },
    get(name) {
      getCalls.push(name)
      return name === 'tools' ? tools : undefined
    },
  }
}

function createMockTools() {
  const calls = []
  const methods = {
    register(definition) {
      calls.push(['register', definition])
      return () => calls.push(['dispose-register'])
    },
    restrict(filter) {
      calls.push(['restrict', filter])
      return () => calls.push(['dispose-restrict'])
    },
    guard(guard) {
      calls.push(['guard', guard])
      return () => calls.push(['dispose-guard'])
    },
    get(name, scope) {
      calls.push(['get', name, scope])
      return { name }
    },
    schemas(scope) {
      calls.push(['schemas', scope])
      return [{ name: 'schema' }]
    },
    execute(input) {
      calls.push(['execute', input])
      return Promise.resolve({ isError: false, content: [] })
    },
    presentAs(...args) {
      calls.push(['presentAs', ...args])
      return () => calls.push(['dispose-presentAs'])
    },
  }
  return { calls, methods }
}

test('inert service exposes disabled tools api that throws inactive error without touching ctx', () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: false })
  const ctx = mockCtx()
  const service = instantiate(ServiceClass, ctx)

  assert.equal(service.tools.isActive, false)
  assert.throws(
    () => service.tools.register({}),
    (error) => error instanceof PluginApiInactiveError,
  )
  assert.equal(ctx.getCalls.length, 0)
})

test('active service with unmounted tools throws feature-disabled error', () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const ctx = mockCtx()
  const service = instantiate(ServiceClass, ctx)

  assert.equal(service.tools.isActive, false)
  assert.throws(
    () => service.tools.guard(() => {}),
    (error) => {
      assert.ok(error instanceof PluginApiFeatureDisabledError)
      assert.equal(error.feature, 'tools')
      return true
    },
  )
  assert.equal(ctx.getCalls.length, 0)
})

test('mountFeature("tools") activates the tools accessor and delegates to the official service', async () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const { calls, methods } = createMockTools()
  const ctx = mockCtx(methods)
  const service = instantiate(ServiceClass, ctx)

  service.mountFeature('tools', { isActive: true })
  assert.equal(service.tools.isActive, true)

  const definition = { name: 'tool', output: {} }
  const filter = { allow: ['tool'] }
  const guard = () => undefined
  const input = { callId: '1', name: 'tool', arguments: {}, signal: new AbortController().signal }
  const scope = { agent: 'agent-1' }

  assert.doesNotThrow(() => service.tools.register(definition))
  assert.doesNotThrow(() => service.tools.restrict(filter))
  assert.doesNotThrow(() => service.tools.guard(guard))
  assert.equal(service.tools.get('tool', scope).name, 'tool')
  assert.deepEqual(service.tools.schemas(scope), [{ name: 'schema' }])
  assert.deepEqual(await service.tools.execute(input), { isError: false, content: [] })
  assert.doesNotThrow(() => service.tools.presentAs('native', 'extra'))

  assert.deepEqual(calls, [
    ['register', definition],
    ['restrict', filter],
    ['guard', guard],
    ['get', 'tool', scope],
    ['schemas', scope],
    ['execute', input],
    ['presentAs', 'native', 'extra'],
  ])
})

test('official tools method errors propagate unchanged through the facade', () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const methods = {
    register() {
      throw new Error('official register rejected')
    },
  }
  const ctx = mockCtx(methods)
  const service = instantiate(ServiceClass, ctx)

  service.mountFeature('tools', { isActive: true })
  assert.throws(() => service.tools.register({ name: 'x' }), /official register rejected/)
})

test('mountFeature still rejects unknown feature names', () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const service = instantiate(ServiceClass, mockCtx())

  assert.throws(
    () => service.mountFeature('unknown/feature', {}),
    (error) => {
      assert.ok(error instanceof PluginApiFeatureDisabledError)
      assert.equal(error.feature, 'unknown/feature')
      return true
    },
  )
})

test('tools accessor fail-safe: throwing or vanished official service yields a typed error (task 2.7)', () => {
  for (const mode of ['throw', 'undefined']) {
    const ServiceClass = createPluginApiService({ apiVersion: '0.1', coreActive: true })
    const ctx = {
      reflect: { provide() {} },
      get(name) {
        if (name === 'tools') {
          if (mode === 'throw') throw new Error('fiber torn down')
          return undefined
        }
        return undefined
      },
    }
    const service = new ServiceClass(ctx, undefined)
    service.mountFeature('tools', { scoped: true })
    assert.throws(
      () => service.tools.register({ name: 'x' }),
      (error) => {
        assert.ok(error instanceof PluginApiFeatureDisabledError)
        assert.equal(error.feature, 'tools')
        return true
      },
      `mode ${mode} must throw typed PluginApiFeatureDisabledError`,
    )
  }
})
