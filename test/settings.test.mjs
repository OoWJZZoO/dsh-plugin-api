import test from 'node:test'
import assert from 'node:assert/strict'
import { createSettingsApi } from '../lib/settings.js'
import {
  PluginApiServiceUnavailableError,
  PluginApiSettingsNamespaceError,
} from '../lib/errors.js'

function createMockSettingsService() {
  const registerCalls = []
  const mutateCalls = []
  const getValues = new Map()
  const conflict = () => {
    const error = new Error('settings namespace "a" changed since it was read (expected revision 1, now 2)')
    error.name = 'SettingsConflictError'
    error.code = 'SETTINGS_CONFLICT'
    error.expected = 1
    error.actual = 2
    return error
  }

  const service = {
    registerCalls,
    mutateCalls,
    conflict,
    register(ns, schema, options) {
      registerCalls.push({ ns, schema, options })
      if (ns === 'duplicate') throw new Error('settings namespace "duplicate" is already registered')
      const resolved = { ns, value: 1 }
      getValues.set(ns, resolved)
      const watchCalls = []
      const officialScope = {
        get: () => getValues.get(ns)?.resolved ?? resolved,
        watch(callback) {
          watchCalls.push(callback)
          let removed = false
          return () => {
            removed = true
            return removed
          }
        },
        update(patch) {
          if (patch?.conflict) return Promise.reject(conflict())
          return Promise.resolve(undefined)
        },
        replace(section) {
          if (section?.conflict) return Promise.reject(conflict())
          return Promise.resolve(undefined)
        },
        watchCalls,
      }
      return officialScope
    },
    get(ns) {
      return getValues.get(ns)?.resolved ?? getValues.get(ns)
    },
    mutate(ns, ops, expectedRevision) {
      mutateCalls.push({ ns, ops, expectedRevision })
      if (expectedRevision === 1) return Promise.reject(conflict())
      return Promise.resolve(undefined)
    },
  }
  return service
}

function createMockCtx(settings) {
  return {
    get(name) {
      if (name === 'settings') return settings
      return undefined
    },
  }
}

test('register delegates to official settings.register and returns a scope handle', () => {
  const service = createMockSettingsService()
  const api = createSettingsApi({ ctx: createMockCtx(service) })
  const schema = { toJSON() {} }
  const options = { base: { a: 0 }, applies: 'restart', validate() {} }

  const handle = api.register('a', schema, options)

  assert.equal(service.registerCalls.length, 1)
  assert.equal(service.registerCalls[0].ns, 'a')
  assert.equal(service.registerCalls[0].schema, schema)
  assert.equal(service.registerCalls[0].options, options)
  assert.equal(typeof handle.get, 'function')
  assert.equal(typeof handle.watch, 'function')
  assert.equal(typeof handle.update, 'function')
  assert.equal(typeof handle.replace, 'function')
  assert.equal(typeof handle.mutate, 'function')
})

test('register passes undefined options through when omitted', () => {
  const service = createMockSettingsService()
  const api = createSettingsApi({ ctx: createMockCtx(service) })

  api.register('a', {})
  assert.equal(service.registerCalls[0].options, undefined)
})

test('register lets official duplicate/invalid namespace errors surface unchanged', () => {
  const service = createMockSettingsService()
  const api = createSettingsApi({ ctx: createMockCtx(service) })

  assert.throws(
    () => api.register('duplicate', {}),
    (error) => {
      assert.equal(error.message, 'settings namespace "duplicate" is already registered')
      return true
    },
  )
})

test('scope returns the same handle for a facade-registered namespace', () => {
  const service = createMockSettingsService()
  const api = createSettingsApi({ ctx: createMockCtx(service) })

  const handle = api.register('a', {})
  assert.equal(api.scope('a'), handle)
})

test('scope throws PluginApiSettingsNamespaceError for a non-facade-registered namespace', () => {
  const service = createMockSettingsService()
  const api = createSettingsApi({ ctx: createMockCtx(service) })

  assert.throws(
    () => api.scope('other'),
    (error) => {
      assert.ok(error instanceof PluginApiSettingsNamespaceError)
      assert.equal(error.code, 'PLUGIN_API_SETTINGS_NAMESPACE_NOT_FOUND')
      assert.equal(error.ns, 'other')
      return true
    },
  )
})

test('handle.get delegates to the official provider get(ns)', () => {
  const service = createMockSettingsService()
  const api = createSettingsApi({ ctx: createMockCtx(service) })

  const handle = api.register('a', {})
  const value = handle.get()
  assert.deepEqual(value, { ns: 'a', value: 1 })
})

test('handle.watch delegates to the official scope watch and returns its disposer', () => {
  const service = createMockSettingsService()
  const api = createSettingsApi({ ctx: createMockCtx(service) })

  const handle = api.register('a', {})
  const callback = () => {}
  const disposer = handle.watch(callback)
  assert.equal(typeof disposer, 'function')
  assert.equal(disposer(), true)
})

test('handle.update and handle.replace delegate to the official scope', async () => {
  const service = createMockSettingsService()
  const api = createSettingsApi({ ctx: createMockCtx(service) })

  const handle = api.register('a', {})
  await assert.doesNotReject(() => handle.update({ b: 1 }))
  await assert.doesNotReject(() => handle.replace({ c: 2 }))
})

test('handle.mutate delegates to official provider mutate with the namespace', async () => {
  const service = createMockSettingsService()
  const api = createSettingsApi({ ctx: createMockCtx(service) })

  const handle = api.register('a', {})
  const ops = [{ op: 'set', path: ['b'], value: 1 }]
  await assert.doesNotReject(() => handle.mutate(ops, 2))

  assert.equal(service.mutateCalls.length, 1)
  assert.equal(service.mutateCalls[0].ns, 'a')
  assert.equal(service.mutateCalls[0].ops, ops)
  assert.equal(service.mutateCalls[0].expectedRevision, 2)
})

test('update/replace/mutate SettingsConflictError passes through unchanged', async () => {
  const service = createMockSettingsService()
  const api = createSettingsApi({ ctx: createMockCtx(service) })

  const handle = api.register('a', {})
  await assert.rejects(() => handle.update({ conflict: true }), (error) => {
    assert.equal(error.code, 'SETTINGS_CONFLICT')
    return true
  })
  await assert.rejects(() => handle.replace({ conflict: true }), (error) => {
    assert.equal(error.code, 'SETTINGS_CONFLICT')
    return true
  })
  await assert.rejects(() => handle.mutate([], 1), (error) => {
    assert.equal(error.code, 'SETTINGS_CONFLICT')
    return true
  })
})

test('register and scope throw PluginApiServiceUnavailableError when settings service is absent', () => {
  const api = createSettingsApi({ ctx: createMockCtx(undefined) })

  assert.throws(() => api.register('a', {}), PluginApiServiceUnavailableError)
  assert.throws(() => api.scope('a'), PluginApiServiceUnavailableError)
})

test('dispose clears the facade scope registry', () => {
  const service = createMockSettingsService()
  const api = createSettingsApi({ ctx: createMockCtx(service) })

  api.register('a', {})
  api.dispose()
  assert.throws(() => api.scope('a'), PluginApiSettingsNamespaceError)
})

test('describe delegates to official settings.inspect and returns its result', () => {
  const service = createMockSettingsService()
  const descriptors = [{ ns: 'a', schema: {}, value: { a: 1 }, revision: 1, applies: 'live' }]
  service.describe = (options) => {
    service.describeCalls = (service.describeCalls ?? 0) + 1
    service.describeOptions = options
    return descriptors
  }
  const api = createSettingsApi({ ctx: createMockCtx(service) })

  assert.equal(api.inspect({ redactSecrets: true }), descriptors)
  assert.equal(service.describeCalls, 1)
  assert.deepEqual(service.describeOptions, { redactSecrets: true })
})

test('describe throws PluginApiServiceUnavailableError when settings service is absent', () => {
  const api = createSettingsApi({ ctx: createMockCtx(undefined) })
  assert.throws(() => api.inspect(), PluginApiServiceUnavailableError)
})

test('installSettingsSection wires attach through ctx.inject with base entry and validate', () => {
  const service = createMockSettingsService()
  const api = createSettingsApi({ ctx: createMockCtx(service) })

  const calls = []
  const hooks = {
    setSource(source) {
      calls.push(['setSource', source()])
    },
    onChange() {
      calls.push(['onChange'])
    },
    validate() {},
  }

  const sctx = {
    settings: service,
    effect(callback) {
      const cleanup = callback()
      calls.push(['effect', typeof cleanup])
    },
  }
  const pluginCtx = {
    fiber: { state: 0 },
    inject(deps, callback) {
      if (deps[0] === 'settings') callback(sctx)
    },
  }

  api.installSettingsSection(pluginCtx, 'a', {}, { x: 1 }, hooks)

  assert.equal(service.registerCalls.length, 1)
  assert.deepEqual(service.registerCalls[0].options.base, { x: 1 })
  assert.equal(service.registerCalls[0].options.validate, hooks.validate)
  assert.ok(calls.some(([kind]) => kind === 'setSource'))
  assert.ok(calls.some(([kind]) => kind === 'onChange'))
})

test('installSettingsSection does not throw when settings service is never mounted', () => {
  const api = createSettingsApi({ ctx: createMockCtx(undefined) })
  const hooks = { setSource() {}, onChange() {} }
  const pluginCtx = {
    fiber: { state: 0 },
    inject() {
      // settings service never becomes available; official helper simply never runs
    },
  }
  assert.doesNotThrow(() => api.installSettingsSection(pluginCtx, 'a', {}, { x: 1 }, hooks))
})
