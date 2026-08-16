import test from 'node:test'
import assert from 'node:assert/strict'
import { createEventsBus } from '../lib/events-bus.js'
import { baseEventsCatalog } from '../lib/events-catalog.js'
import { composeCatalogs } from '../lib/catalog-compose.js'
import { settingsEventsCatalog } from '../lib/settings-events-catalog.js'

const settingsCatalog = composeCatalogs(baseEventsCatalog, settingsEventsCatalog)
import { createFeatureRegistry } from '../lib/feature-registry.js'
import { PluginApiFeatureDisabledError } from '../lib/errors.js'

function createMockCtx() {
  const hooks = new Map()
  const hooksOf = (name) => {
    let list = hooks.get(name)
    if (!list) {
      list = []
      hooks.set(name, list)
    }
    return list
  }
  return {
    hooks,
    on(name, listener) {
      const list = hooksOf(name)
      list.push(listener)
      let removed = false
      return () => {
        if (removed) return false
        removed = true
        const index = list.findIndex((hook) => hook === listener)
        if (index >= 0) {
          list.splice(index, 1)
          return true
        }
        return false
      }
    },
    emit(name, ...args) {
      for (const listener of hooksOf(name)) listener(...args)
    },
  }
}

test('without featureRegistry settings events remain subscribable', () => {
  const ctx = createMockCtx()
  const bus = createEventsBus({ ctx, catalog: settingsCatalog })
  let received
  assert.doesNotThrow(() => {
    bus.on('settings/updated', (...args) => {
      received = args
    })
  })
  ctx.emit('settings/updated', 'my-plugin', { a: 1 }, { a: 0 }, 'update')
  assert.deepEqual(received, ['my-plugin', { a: 1 }, { a: 0 }, 'update'])
})

test('with featureRegistry and active settings feature subscriptions dispatch normally', () => {
  const registry = createFeatureRegistry()
  registry.mount('settings')
  const ctx = createMockCtx()
  const bus = createEventsBus({ ctx, catalog: settingsCatalog, featureRegistry: registry })

  let updated
  let documentUpdated
  bus.on('settings/updated', (...args) => {
    updated = args
  })
  bus.on('settings/document-updated', (...args) => {
    documentUpdated = args
  })

  ctx.emit('settings/updated', 'my-plugin', { a: 1 }, { a: 0 }, 'update')
  ctx.emit('settings/document-updated', 'my-plugin', 7)

  assert.deepEqual(updated, ['my-plugin', { a: 1 }, { a: 0 }, 'update'])
  assert.deepEqual(documentUpdated, ['my-plugin', 7])
})

test('with featureRegistry and disabled settings feature subscriptions throw feature-disabled', () => {
  const registry = createFeatureRegistry()
  registry.disable('settings', 'settings service malformed')
  const ctx = createMockCtx()
  const bus = createEventsBus({ ctx, catalog: settingsCatalog, featureRegistry: registry })

  for (const subscribe of [
    () => bus.on('settings/updated', () => {}),
    () => bus.once('settings/updated', () => {}),
    () => bus.on('settings/document-updated', () => {}),
    () => bus.once('settings/document-updated', () => {}),
  ]) {
    assert.throws(subscribe, (error) => {
      assert.ok(error instanceof PluginApiFeatureDisabledError)
      assert.equal(error.code, 'PLUGIN_API_FEATURE_DISABLED')
      assert.equal(error.feature, 'settings')
      return true
    })
  }
  assert.equal(ctx.hooks.size, 0)
})
