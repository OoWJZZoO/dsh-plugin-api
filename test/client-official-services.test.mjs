import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CLIENT_SERVICE_MEMBERS,
  CLIENT_SERVICE_NAMES,
  CLIENT_SERVICE_VALUE_MEMBERS,
  createClientOfficialService,
  createClientOfficialServices,
  createDisabledClientOfficialService,
} from '../lib/client-official-services.js'

function makeProvider(name, calls = new Map()) {
  const provider = {}
  const values = new Map()
  for (const member of CLIENT_SERVICE_MEMBERS[name]) {
    if (CLIENT_SERVICE_VALUE_MEMBERS[name].includes(member)) {
      const value = { name, member }
      values.set(member, value)
      Object.defineProperty(provider, member, {
        enumerable: true,
        get() {
          return value
        },
      })
    } else {
      provider[member] = function (...args) {
        assert.equal(this, provider)
        calls.set(member, args)
        return { name, member, args }
      }
    }
  }
  provider.privateImplementation = true
  return { provider, values, calls }
}

test('client service leaves expose exact frozen whitelists and preserve official identity', () => {
  const providers = {}
  const fixtures = {}
  for (const name of CLIENT_SERVICE_NAMES) {
    fixtures[name] = makeProvider(name)
    providers[name] = fixtures[name].provider
  }

  const result = createClientOfficialServices({ providers })
  assert.deepEqual(Object.keys(result.api), ['isActive', ...CLIENT_SERVICE_NAMES])
  assert.equal(result.api.isActive, true)

  for (const name of CLIENT_SERVICE_NAMES) {
    const face = result.api[name]
    const members = CLIENT_SERVICE_MEMBERS[name]
    assert.deepEqual(Object.keys(face), ['isActive', ...members])
    assert.ok(Object.isFrozen(face))
    assert.equal(face.isActive, true)
    assert.equal('privateImplementation' in face, false)

    for (const member of members) {
      if (CLIENT_SERVICE_VALUE_MEMBERS[name].includes(member)) {
        assert.equal(face[member], fixtures[name].values.get(member))
      } else {
        const args = [{ name }, Symbol(member)]
        const resultValue = face[member](...args)
        assert.deepEqual(resultValue, { name, member, args })
        assert.deepEqual(fixtures[name].calls.get(member), args)
      }
    }
  }
})

test('client service provider resolution is lazy and getter values are read at access time', () => {
  const fixture = makeProvider('modules')
  let reads = 0
  const leaf = createClientOfficialService({
    name: 'modules',
    resolveProvider() {
      reads += 1
      return fixture.provider
    },
  })

  assert.equal(reads, 0)
  assert.equal(leaf.api.isActive, true)
  assert.equal(reads, 1)
  assert.equal(leaf.api.version, fixture.values.get('version'))
  assert.equal(reads, 2)
})

test('missing or malformed client providers disable only their own leaf', () => {
  const modules = makeProvider('modules').provider
  const malformedLocale = makeProvider('locale').provider
  delete malformedLocale.bind
  const result = createClientOfficialServices({ providers: { modules, locale: malformedLocale } })

  assert.equal(result.api.modules.isActive, true)
  assert.equal(result.api.locale.isActive, false)
  assert.throws(
    () => result.api.locale.getLocale(),
    (error) => error.code === 'PLUGIN_API_FEATURE_DISABLED' && error.feature === 'client.locale',
  )
  assert.equal(result.api.sessions.isActive, false)
  assert.throws(
    () => result.api.sessions.list(),
    (error) => error.code === 'PLUGIN_API_FEATURE_DISABLED' && error.feature === 'client.sessions',
  )
})

test('method accessors that throw or return non-functions degrade at call time', () => {
  const throwing = {}
  Object.defineProperty(throwing, 'forClosing', {
    get() {
      throw new Error('method getter failed')
    },
  })
  const nonFunction = {}
  Object.defineProperty(nonFunction, 'forClosing', {
    get() {
      return { not: 'callable' }
    },
  })

  for (const provider of [throwing, nonFunction]) {
    const leaf = createClientOfficialService({ name: 'chatFileMentions', provider })
    assert.equal(leaf.api.isActive, true)
    assert.throws(
      () => leaf.api.forClosing(),
      (error) => error.code === 'PLUGIN_API_FEATURE_DISABLED' && error.feature === 'client.chatFileMentions',
    )
    assert.equal(leaf.api.isActive, false)
  }
})

test('value accessors that throw degrade at read time', () => {
  const provider = {}
  Object.defineProperty(provider, 'version', {
    get() {
      throw new Error('value getter failed')
    },
  })
  Object.defineProperty(provider, 'loadCache', {
    value() {},
  })
  Object.defineProperty(provider, 'import', { value() {} })
  Object.defineProperty(provider, 'registerStatic', { value() {} })
  Object.defineProperty(provider, 'prefetch', { value() {} })
  Object.defineProperty(provider, 'invalidate', { value() {} })

  const leaf = createClientOfficialService({ name: 'modules', provider })
  assert.equal(leaf.api.isActive, true)
  assert.throws(
    () => leaf.api.version,
    (error) => error.code === 'PLUGIN_API_FEATURE_DISABLED' && error.feature === 'client.modules',
  )
  assert.equal(leaf.api.isActive, false)
})

test('root inactivity wins without resolving an official provider', () => {
  let reads = 0
  const fixture = makeProvider('modules')
  const result = createClientOfficialServices({
    active: () => false,
    resolveProvider() {
      reads += 1
      return fixture.provider
    },
  })

  assert.equal(result.api.modules.isActive, false)
  assert.equal(reads, 0)
  assert.throws(() => result.api.modules.loadCache(), (error) => error.code === 'PLUGIN_API_INACTIVE')
})

test('reapplying a leaf supersedes the old owner and protects the new owner from stale cleanup', () => {
  const ownerScope = {}
  const firstFixture = makeProvider('modules')
  const secondFixture = makeProvider('modules')
  const first = createClientOfficialServices({ ownerScope, providers: { modules: firstFixture.provider } })
  const second = createClientOfficialServices({ ownerScope, providers: { modules: secondFixture.provider } })

  assert.equal(first.api.modules.isActive, false)
  assert.equal(second.api.modules.isActive, true)
  assert.throws(() => first.api.modules.loadCache(), (error) => error.code === 'PLUGIN_API_FEATURE_DISABLED')
  assert.equal(first.dispose(), false)
  assert.equal(second.api.modules.loadCache, secondFixture.values.get('loadCache'))
  assert.equal(second.api.modules.isActive, true)
})

test('stale aggregate cleanup reports no-op while active aggregate cleanup reports success', () => {
  const ownerScope = {}
  const first = createClientOfficialServices({ ownerScope, providers: { modules: makeProvider('modules').provider } })
  const second = createClientOfficialServices({ ownerScope, providers: { modules: makeProvider('modules').provider } })

  assert.equal(first.dispose(), false)
  assert.equal(second.dispose(), true)
})

test('publication and cleanup failures remain local and cleanup can be awaited', async () => {
  const logs = []
  const cleanupError = new Error('cleanup failed')
  const fixture = makeProvider('modules')
  const leaf = createClientOfficialService({
    name: 'modules',
    provider: fixture.provider,
    logger: { error(message, error) { logs.push([message, error]) } },
    publish() {
      return () => Promise.reject(cleanupError)
    },
  })

  await leaf.dispose()
  assert.equal(logs.length, 1)
  assert.equal(logs[0][1], cleanupError)
  assert.equal(leaf.api.isActive, false)
})

test('disabled client service faces retain their exact shape and typed failure', () => {
  const leaf = createDisabledClientOfficialService('layout')
  assert.deepEqual(Object.keys(leaf.api), ['isActive', ...CLIENT_SERVICE_MEMBERS.layout])
  assert.equal(leaf.api.isActive, false)
  assert.throws(
    () => leaf.api.openDetails(),
    (error) => error.code === 'PLUGIN_API_FEATURE_DISABLED' && error.feature === 'client.layout',
  )
})
