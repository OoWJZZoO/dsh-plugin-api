import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { bootFixture, settleAll } from './official-passthrough-fixture.mjs'

const bundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

function loadClientBundle() {
  let handoff
  const sandbox = {
    window: { __ModuleLoader__: { load(value) { handoff = value } } },
    console,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    AbortController,
    TextEncoder,
    TextDecoder,
  }
  sandbox.globalThis = sandbox
  vm.runInNewContext(bundle, sandbox, { filename: 'client.js' })
  assert.equal(handoff?.id, '@deepseek-ai/dsh-plugin-api-main')
  return handoff.factory(() => { throw new Error('the bundled facade has no cross-plugin runtime imports') })
}

function contribution(packageName, namespace) {
  return {
    package: packageName,
    descriptors: [{
      id: `${packageName}#${namespace}/get`,
      service: 'ready',
      namespace,
      method: 'get',
      invocation: { kind: 'direct' },
      parameters: [],
      result: { mode: 'strict', typeSymbol: `${namespace}.Json`, schema: { parse(value) { return value } } },
    }],
  }
}

test('migration-shaped settings, slot, and remote consumers use official lifecycle adapters', async () => {
  const artifact = loadClientBundle()
  let remoteMounts = 0
  let remoteDisposals = 0
  let settingsDisposals = 0
  let settingsRevision = 1
  let slotEntries = [{ id: 'details-1', capabilities: ['slot.read'] }]
  const settingsListeners = new Set()
  const slotDeclarations = new Map()
  let changeSettings
  let replaceSlotDeclaration
  let mutateSlotEntries

  const { ctx } = bootFixture({
    override(context) {
      const remote = context.get('remote')
      remote.$mount = async function mountOfficial(contributionValue) {
        remoteMounts += 1
        const namespaces = new Set(contributionValue.descriptors.map((descriptor) => descriptor.namespace))
        for (const namespace of namespaces) {
          this[namespace] = { capabilities: ['remote.read'], get() { return { ok: true } } }
        }
        return () => {
          remoteDisposals += 1
          for (const namespace of namespaces) delete this[namespace]
        }
      }

      const rawSettingsScope = context.get('settingsScope')
      rawSettingsScope.bind = ({ namespace }) => {
        assert.equal(namespace, 'migration-settings')
        return {
          getSnapshot() { return { revision: settingsRevision, capabilities: ['settings.read'] } },
          subscribe(listener) {
            settingsListeners.add(listener)
            return () => settingsListeners.delete(listener)
          },
          set() {},
          unset() {},
          dispose() { settingsDisposals += 1 },
        }
      }
      changeSettings = (revision) => {
        settingsRevision = revision
        for (const listener of [...settingsListeners]) listener({ revision })
      }

      const rawSlots = context.get('slots')
      rawSlots.entries = (key) => key === 'details' ? slotEntries : []
      rawSlots.inject = (key, listener) => {
        assert.equal(key, 'details')
        slotDeclarations.set(listener, listener(slotEntries))
        return () => {
          slotDeclarations.get(listener)?.()
          slotDeclarations.delete(listener)
        }
      }
      rawSlots.subscribe = () => () => {}
      replaceSlotDeclaration = (entries) => {
        slotEntries = entries
        for (const listener of [...slotDeclarations.keys()]) {
          slotDeclarations.get(listener)?.()
          slotDeclarations.set(listener, listener(entries))
        }
      }
      mutateSlotEntries = (entries) => { slotEntries = entries }
    },
  })

  const disposeClient = artifact.apply(ctx)
  await settleAll()
  const api = ctx.get('pluginApi')
  assert.equal(api.lifecycle.isActive, true, 'the lifecycle face is active under the direct client root')
  assert.equal(api.modules, undefined, 'migration consumer does not invent a client.modules face')
  assert.equal('dispose' in api.lifecycle, false, 'caller-facing lifecycle has no cross-owner global dispose')

  const counts = { remote: 0, slot: 0, settings: 0 }
  const cleanups = { remote: 0, slot: 0, settings: 0 }
  const bind = (kind) => (input, context) => {
    counts[kind] += 1
    assert.equal(context.guard(input.ownerId), input.ownerId)
    return () => { cleanups[kind] += 1 }
  }
  const remoteFace = api.lifecycle.registerFace({
    faceId: 'migration-remote',
    ownerId: 'migration-consumer',
    scope: 'client',
    kind: 'remote',
    require: { capabilities: ['remote.read'], remote: { namespace: 'migration', contribution: contribution('migration-consumer', 'migration') } },
    bind: bind('remote'),
  })
  const slotFace = api.lifecycle.registerFace({
    faceId: 'migration-slot',
    ownerId: 'migration-consumer',
    scope: 'client',
    kind: 'slot',
    require: { capabilities: ['slot.read'], slot: { key: 'details' } },
    bind: bind('slot'),
  })
  const settingsFace = api.lifecycle.registerFace({
    faceId: 'migration-settings',
    ownerId: 'migration-consumer',
    scope: 'client',
    kind: 'settings',
    require: { capabilities: ['settings.read'], settings: { namespace: 'migration-settings' } },
    bind: bind('settings'),
  })
  await settleAll()

  assert.equal(remoteMounts, 1, 'the lifecycle face uses the official remote $mount exactly once')
  for (const [name, handle] of [['remote', remoteFace], ['slot', slotFace], ['settings', settingsFace]]) {
    const snapshot = handle.availability()
    assert.ok(snapshot, `${name} face must remain registered`)
    assert.equal(snapshot.state, 'available', `${name} face must be available`)
  }
  assert.equal(remoteFace.availability().source, 'official-remote')
  assert.equal(remoteFace.availability().uncertainty, 'observed')
  assert.equal(slotFace.availability().source, 'official-slots')
  assert.equal(settingsFace.availability().source, 'official-settings-scope')
  assert.deepEqual(counts, { remote: 1, slot: 1, settings: 1 })

  const slotEpoch = slotFace.availability().epochs.slot
  mutateSlotEntries([{ id: 'details-entry-only', capabilities: ['slot.read'] }])
  await settleAll()
  assert.equal(slotFace.availability().epochs.slot, slotEpoch)
  assert.equal(counts.slot, 1, 'ordinary slot entry mutation does not rebind the declaration face')

  changeSettings(2)
  await settleAll()
  assert.equal(counts.settings, 2)
  assert.equal(counts.remote, 1)
  assert.equal(counts.slot, 1)

  replaceSlotDeclaration([{ id: 'details-2', capabilities: ['slot.read'] }])
  await settleAll()
  assert.equal(counts.slot, 2)
  assert.equal(cleanups.slot, 1)

  ctx.emit('connection/reset')
  await settleAll()
  assert.deepEqual(counts, { remote: 2, slot: 3, settings: 3 })
  assert.equal(cleanups.remote, 1)
  assert.equal(cleanups.slot, 2)
  assert.equal(cleanups.settings, 2)

  remoteFace.dispose()
  slotFace.dispose()
  settingsFace.dispose()
  await settleAll()
  assert.equal(remoteDisposals, 1, 'the official $mount disposer runs during face cleanup')
  assert.equal(settingsDisposals, 1, 'the bound settings scope is disposed during face cleanup')
  assert.equal(cleanups.remote, 2)
  assert.equal(cleanups.slot, 3)
  assert.equal(cleanups.settings, 3)
  await disposeClient()
})
