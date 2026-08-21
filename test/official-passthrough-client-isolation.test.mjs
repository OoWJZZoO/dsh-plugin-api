import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/client-runtime.js'
import {
  CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS,
  CLIENT_EXCLUDED_MEMBERS,
} from '../lib/client-official-passthrough.js'
import { PluginApiFeatureDisabledError } from '../lib/errors.js'
import {
  DESCRIPTOR_BY_SURFACE,
  bootFixture,
  leafState,
  settleAll,
} from './official-passthrough-fixture.mjs'

const ALL_SURFACES = CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS.map((d) => d.surfaceKey)

function moduleIndex(descriptor) {
  return CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS
    .filter((other) => other.moduleId === descriptor.moduleId)
    .findIndex((other) => other.surfaceKey === descriptor.surfaceKey)
}

function firstMethod(descriptor) {
  return Object.entries(descriptor.members).find(([, kind]) => kind === 'method')[0]
}

function callLeaf(api, surfaceKey, descriptor) {
  const face = api.client[surfaceKey.slice('client.'.length)]
  return () => face[firstMethod(descriptor)]()
}

/**
 * Build the failure fixture for one leaf, settle every other leaf, and assert
 * the exact local failure contract: the leaf disabled with the fixed reason,
 * the six siblings active, typed surface-keyed errors, and a safe diagnostic
 * that never leaks provider content.
 */
async function runIsolation({ kind, surfaceKey, reason }) {
  const descriptor = DESCRIPTOR_BY_SURFACE.get(surfaceKey)
  const deferred = ['rejectedImport', 'malformedNamespace', 'staleNamespace'].includes(kind)
  const { ctx, loader, logs } = bootFixture({
    deferred,
    omit: kind === 'missingProvider' ? [surfaceKey] : [],
    override: (context, namespaces) => {
      applyStaticFault({ kind, surfaceKey, descriptor, context, namespaces })
    },
  })
  apply(ctx)
  if (deferred) {
    // Resolve in boot order: siblings of a shared module that boot before the
    // target first, then the target's fault, then everything else.
    for (const sibling of CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS) {
      if (sibling.surfaceKey === surfaceKey) continue
      if (sibling.moduleId === descriptor.moduleId && moduleIndex(sibling) < moduleIndex(descriptor)) {
        loader.resolvePending(sibling.moduleId, undefined, 0)
      }
    }
    applyDeferredFault({ kind, loader, descriptor })
    for (const other of CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS) {
      if (other.surfaceKey === surfaceKey) continue
      if (other.moduleId === descriptor.moduleId && moduleIndex(other) < moduleIndex(descriptor)) continue
      if (other.moduleId === descriptor.moduleId && moduleIndex(other) > moduleIndex(descriptor)) {
        loader.resolvePending(other.moduleId, undefined, 0)
      } else if (other.moduleId !== descriptor.moduleId) {
        loader.resolvePending(other.moduleId, undefined, 0)
      }
    }
  }
  await settleAll()
  const api = ctx.get('pluginApi')
  assert.equal(leafState(api, surfaceKey), false, `${surfaceKey} must be locally disabled for ${kind}`)
  for (const otherKey of ALL_SURFACES.filter((key) => key !== surfaceKey)) {
    assert.equal(leafState(api, otherKey), true, `${otherKey} must stay active when ${surfaceKey} fails with ${kind}`)
  }
  assert.throws(callLeaf(api, surfaceKey, descriptor), (error) =>
    error instanceof PluginApiFeatureDisabledError && error.feature === surfaceKey)
  assert.ok(logs.some((line) => line.includes(surfaceKey) && line.includes(reason)),
    `expected diagnostic ${surfaceKey}/${reason} for ${kind}; got: ${JSON.stringify(logs)}`)
  for (const line of logs) {
    assert.doesNotMatch(line, /secret-provider-state|sensitive-value|raw-error/, 'diagnostics never leak provider content')
  }
}

function applyDeferredFault({ kind, loader, descriptor }) {
  // By this point every same-module sibling that boots before the target has
  // been resolved, so the target's entry is the next one in the queue.
  if (kind === 'rejectedImport') {
    loader.rejectPending(descriptor.moduleId, 0)
  } else if (kind === 'malformedNamespace') {
    loader.resolvePending(descriptor.moduleId, 42, 0)
  } else if (kind === 'staleNamespace') {
    loader.resolvePending(descriptor.moduleId, { stale: true }, 0)
  }
}

function applyStaticFault({ kind, surfaceKey, descriptor, context, namespaces }) {
  const namespace = namespaces.get(descriptor.moduleId)
  if (kind === 'missingConstructor') {
    delete namespace[descriptor.constructorExport]
    return
  }
  if (kind === 'invalidConstructor') {
    namespace[descriptor.constructorExport] = { name: 'not-a-constructor' }
    return
  }
  if (kind === 'invalidProvider') {
    context.reflect.set(descriptor.serviceName, { wrong: 'provider' })
    return
  }
  const Constructor = namespace[descriptor.constructorExport]
  // Faults target a method member: property members are constructor-assigned
  // in some providers and property-kind only checks presence.
  const target = Object.keys(descriptor.members).find((name) => descriptor.members[name] === 'method')
  if (kind === 'missingMember') {
    class Missing extends Constructor {}
    Missing.prototype[target] = undefined
    context.reflect.set(descriptor.serviceName, new Missing())
    return
  }
  if (kind === 'invalidMember') {
    class Bad extends Constructor {}
    Bad.prototype[target] = 'not-a-function'
    context.reflect.set(descriptor.serviceName, new Bad())
    return
  }
  if (kind === 'throwingMember') {
    class Throwing extends Constructor {}
    Object.defineProperty(Throwing.prototype, target, {
      configurable: true,
      get() { throw new Error('secret-provider-state') },
    })
    context.reflect.set(descriptor.serviceName, new Throwing())
    return
  }
  void surfaceKey
}

test('every inventory member is exposed with its declared kind and nothing else leaks', async () => {
  const { ctx } = bootFixture()
  apply(ctx)
  await settleAll()
  const api = ctx.get('pluginApi')
  for (const descriptor of CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS) {
    const face = api.client[descriptor.surfaceKey.slice('client.'.length)]
    for (const [member, kind] of Object.entries(descriptor.members)) {
      if (kind === 'method') assert.equal(typeof face[member], 'function', `${descriptor.surfaceKey}.${member}`)
      else assert.notEqual(face[member], undefined, `${descriptor.surfaceKey}.${member} live value`)
    }
    for (const excluded of CLIENT_EXCLUDED_MEMBERS[descriptor.surfaceKey] ?? []) {
      assert.equal(face[excluded], undefined, `${descriptor.surfaceKey}.${excluded} must stay excluded`)
    }
    assert.equal(face.undocumented, undefined, 'unlisted provider members are never discovered')
    assert.equal(face.constructor, Object, 'no provider constructor leaks through the facade')
  }
})

for (const surfaceKey of ALL_SURFACES) {
  test(`rejected import disables only ${surfaceKey} with the fixed reason`, async () => {
    await runIsolation({ kind: 'rejectedImport', surfaceKey, reason: 'invalid-export' })
  })

  test(`malformed namespace disables only ${surfaceKey} with the fixed reason`, async () => {
    await runIsolation({ kind: 'malformedNamespace', surfaceKey, reason: 'invalid-export' })
  })

  test(`stale namespace disables only ${surfaceKey} with the fixed reason`, async () => {
    await runIsolation({ kind: 'staleNamespace', surfaceKey, reason: 'invalid-export' })
  })

  test(`missing constructor disables only ${surfaceKey} with the fixed reason`, async () => {
    await runIsolation({ kind: 'missingConstructor', surfaceKey, reason: 'missing-member' })
  })

  test(`invalid constructor disables only ${surfaceKey} with the fixed reason`, async () => {
    await runIsolation({ kind: 'invalidConstructor', surfaceKey, reason: 'invalid-member' })
  })

  test(`missing provider disables only ${surfaceKey} with the fixed reason`, async () => {
    await runIsolation({ kind: 'missingProvider', surfaceKey, reason: 'missing-service' })
  })

  test(`invalid provider disables only ${surfaceKey} with the fixed reason`, async () => {
    await runIsolation({ kind: 'invalidProvider', surfaceKey, reason: 'invalid-provider' })
  })

  test(`missing member disables only ${surfaceKey} with the fixed reason`, async () => {
    await runIsolation({ kind: 'missingMember', surfaceKey, reason: 'missing-member' })
  })

  test(`invalid member disables only ${surfaceKey} with the fixed reason`, async () => {
    await runIsolation({ kind: 'invalidMember', surfaceKey, reason: 'invalid-member' })
  })

  test(`throwing member disables only ${surfaceKey} and never leaks the exception`, async () => {
    await runIsolation({ kind: 'throwingMember', surfaceKey, reason: 'invalid-member' })
  })
}