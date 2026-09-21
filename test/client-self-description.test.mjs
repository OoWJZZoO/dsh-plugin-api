/**
 * Client self-description.
 *
 * Every public namespace answers a frozen three-value `availability()`, and the
 * root `capabilities.*` query reads the same leaf state — a namespace is never
 * advertised as active merely because an object exists at its name.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { bootFixture, settleAll } from './official-passthrough-fixture.mjs'
import { apply } from '../lib/client-runtime.js'
import { CLIENT_CAPABILITY_PATHS } from '../lib/client-runtime.js'
import { PluginApiCapabilityUnavailableError } from '../lib/errors.js'

const STATUSES = ['active', 'degraded', 'unavailable']
const SELF_DESCRIBING = ['connection', 'events', 'remotes', 'settings', 'slots', 'codec', 'lifecycle']

test('every self-describing client namespace answers a frozen three-value availability', async () => {
  const { ctx } = bootFixture()
  const dispose = apply(ctx)
  const api = ctx.get('pluginApi')
  await settleAll()

  for (const name of SELF_DESCRIBING) {
    const member = api[name]
    assert.equal(typeof member.availability, 'function', `${name}.availability must be a member`)
    const descriptor = member.availability()
    assert.ok(Object.isFrozen(descriptor), `${name}.availability() must be frozen`)
    assert.ok(STATUSES.includes(descriptor.status), `${name} reports a three-value status, saw ${descriptor.status}`)
    assert.equal(descriptor.status, 'active', `${name} is backed by a live official service in this fixture`)
    if (descriptor.status !== 'active') assert.equal(typeof descriptor.reason, 'string', `${name} explains its status`)
  }

  // The capability query and the namespace member read the same state.
  for (const name of SELF_DESCRIBING) {
    assert.equal(api.capabilities.get(name).status, api[name].availability().status, `${name}: the two views agree`)
  }
  assert.equal(api.capabilities.list().length, CLIENT_CAPABILITY_PATHS.length)
  await dispose()
})

test('capabilities accept member-level client paths and refuse unknown members', async () => {
  const { ctx } = bootFixture()
  const dispose = apply(ctx)
  const api = ctx.get('pluginApi')
  await settleAll()

  // A member-level path answers the same state as the namespace that owns it:
  // the member has no separate lifecycle and is never reported active on its
  // own account.
  for (const [path, root] of [['slots.contribute', 'slots'], ['slots.inspect', 'slots'], ['remotes.observe', 'remotes'],
    ['lifecycle.register', 'lifecycle'], ['lifecycle.observe', 'lifecycle'], ['codec.validate', 'codec'], ['settings.scope', 'settings']]) {
    const descriptor = api.capabilities.get(path)
    assert.equal(descriptor.capability, path, 'the query echoes the requested path')
    assert.equal(descriptor.status, api[root].availability().status, `${path} answers the state of ${root}`)
  }
  // The roots stay addressable, and the inventory still enumerates them.
  assert.equal(api.capabilities.list().length, CLIENT_CAPABILITY_PATHS.length)
  assert.equal(api.capabilities.require(['slots.contribute', 'remotes.observe', 'codec.validate']), true)

  // A path that is not a member of the namespace answers the unknown-capability
  // result instead of throwing, so a generic preflight probe never needs a
  // try/catch; `require` keeps its typed throw for unknown and unavailable
  // paths alike.
  for (const unknown of ['slots.not-a-member', 'connection.api.deep', 'nope', 'slots.contribute.deep', 'services.locale']) {
    const descriptor = api.capabilities.get(unknown)
    assert.equal(descriptor.capability, unknown, 'the query echoes the requested path')
    assert.equal(descriptor.status, 'unavailable', `${unknown} is not an addressable capability path`)
    assert.equal(descriptor.reason, 'unknown capability')
  }
  assert.throws(
    () => api.capabilities.require(['slots.not-a-member']),
    PluginApiCapabilityUnavailableError,
  )
  await dispose()
})

test('a leaf whose official service is missing reports unavailable instead of active', async () => {
  // `slots` and `settingsScope` are both withheld: only the namespaces backed
  // by them may degrade, everything else stays active.
  const withheld = new Set(['slots', 'settingsScope'])
  const { ctx } = bootFixture({
    override(context) {
      const get = context.get.bind(context)
      context.get = (name) => (withheld.has(name) ? undefined : get(name))
    },
  })
  const dispose = apply(ctx)
  const api = ctx.get('pluginApi')
  await settleAll()

  // `slots` is backed by a single missing service, so the namespace is
  // unavailable; `settings` is backed by two leaves of which only one is
  // missing, so it is degraded rather than unavailable. Neither claims active.
  assert.equal(api.slots.availability().status, 'unavailable', 'slots must not claim active without its official service')
  assert.equal(typeof api.slots.availability().reason, 'string', 'slots must explain why')
  const settings = api.settings.availability()
  assert.equal(settings.status, 'degraded', 'a namespace with one live and one missing leaf is degraded')
  assert.equal(typeof settings.reason, 'string', 'the degraded state names the missing leaf')
  for (const name of ['slots', 'settings']) {
    assert.equal(api.capabilities.get(name).status, api[name].availability().status, `${name}: the two views agree`)
  }
  assert.equal(api.connection.availability().status, 'active', 'an unrelated namespace stays active')
  assert.equal(api.slots.contribute({ name: 'details' }).ok, false, 'the disabled leaf still answers its idiom')
  await dispose()
})

test('lifecycle namespace availability answers the three-value vocabulary, not the face snapshot', async () => {
  const { ctx } = bootFixture()
  const dispose = apply(ctx)
  const api = ctx.get('pluginApi')
  await settleAll()

  const descriptor = api.lifecycle.availability()
  assert.deepEqual(Object.keys(descriptor).sort(), ['status'], 'the namespace member is a zero-argument probe')
  assert.equal(descriptor.status, 'active')

  const face = api.lifecycle.register({
    faceId: 'probe-face',
    scope: 'client',
    kind: 'remote',
    require: { remote: { namespace: 'probe', contribution: { package: 'probe', descriptors: [{ id: 'p#get', service: 'ready', namespace: 'probe', method: 'get', invocation: { kind: 'direct' }, parameters: [], result: { mode: 'strict', typeSymbol: 'probe.Json', schema: { parse: (value) => value } } }] } } },
    bind: () => () => {},
  })
  await settleAll()

  assert.equal(api.lifecycle.availability().status, 'active', 'the probe does not change with a face registration')
  // The handle keeps its own richer extension member, which is where per-face
  // state is read.
  assert.equal(face.availability().state, 'available', 'the handle extension still answers the face snapshot')
  assert.equal(typeof face.availability().epochs, 'object', 'the face snapshot keeps its domain detail')
  await dispose()
})
