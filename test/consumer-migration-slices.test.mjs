/**
 * Consumer migration slices over the existing approved contract.
 *
 * Each slice records the original consumer behavior, the current public call
 * that carries it, and the observed result — executed against the real facade
 * (no stand-in object injected straight into an internal registry). Slices only
 * cover behavior the current contract already claims; anything that needs a new
 * shape is recorded as a gap instead of being silently approximated.
 *
 * | slice | original behavior | current public call | status |
 * |---|---|---|---|
 * | A | plugin-private event emit/subscribe | `events.define` + `events.observe` | equivalent |
 * | B | inject an official browser service directly | `pluginApi.services.<leaf>` | equivalent once the leaf is active; typed-fails while pending |
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createEventsBus } from '../lib/events-bus.js'
import { baseEventsCatalog } from '../lib/events-catalog.js'
import { composeCatalogs } from '../lib/catalog-compose.js'
import { agentEventsCatalog } from '../lib/agent-events-catalog.js'
import { llmEventsCatalog } from '../lib/llm-events-catalog.js'
import { systemPromptEventsCatalog } from '../lib/system-prompt-events-catalog.js'
import { settingsEventsCatalog } from '../lib/settings-events-catalog.js'
import { apply } from '../lib/client-runtime.js'
import { CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS } from '../lib/client-official-passthrough.js'
import { bootFixture, settleAll } from './official-passthrough-fixture.mjs'

const coreCatalog = composeCatalogs(
  baseEventsCatalog,
  agentEventsCatalog,
  llmEventsCatalog,
  systemPromptEventsCatalog,
  settingsEventsCatalog,
)

function createMockCordisCtx() {
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
    hooksOf,
    on(name, listener) {
      hooksOf(name).push({ callback: listener })
      let removed = false
      return () => {
        if (removed) return false
        removed = true
        const index = hooksOf(name).findIndex((hook) => hook.callback === listener)
        if (index >= 0) hooksOf(name).splice(index, 1)
        return true
      }
    },
    emit(name, ...args) {
      for (const hook of [...hooksOf(name)]) hook.callback(...args)
    },
    serial(name, ...args) {
      let value = args[0]
      for (const hook of [...hooksOf(name)]) value = hook.callback(value)
      return value
    },
    waterfall: undefined,
  }
}

test('slice A: a plugin-private event becomes a defined event with the same payload round-trip', async () => {
  // Original: the plugin emitted and subscribed its own private event names.
  // Current: `events.define` publishes the name, `events.observe` subscribes.
  const ctx = createMockCordisCtx()
  const bus = createEventsBus({ ctx, catalog: coreCatalog })
  const publisher = bus.define({ name: 'plugin-a.custom' })
  const seen = []
  const disposer = bus.observe('plugin-a.custom').subscribe((payload) => seen.push(payload))
  publisher.emit({ kind: 'ping', n: 1 })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(seen, [{ kind: 'ping', n: 1 }], 'the defined event carries the original payload')
  disposer()
  publisher.emit({ kind: 'ping', n: 2 })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(seen.length, 1, 'the disposer stops delivery')
})

test('slice B: an official browser service is consumed through the facade leaf, not by direct injection', async () => {
  // Original: the plugin injected an official browser service directly.
  // Current: `pluginApi.services.<leaf>` publishes the same face through the
  // facade; while the leaf is pending it typed-fails instead of lying.
  const { ctx, loader } = bootFixture({ deferred: true })
  const dispose = apply(ctx)
  const api = ctx.get('pluginApi')
  const descriptor = CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS[0]
  assert.ok(api.services[descriptor.serviceName], 'the leaf face is published synchronously')
  assert.throws(
    () => api.services.conversation.send('x'),
    (error) => error?.feature === 'client.conversation',
    'a pending shell typed-fails instead of silently dropping the call',
  )
  for (const item of CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS) loader.resolvePending(item.moduleId)
  await settleAll()
  assert.equal(api.capabilities.get('services').status, 'active')
  await dispose()
})
