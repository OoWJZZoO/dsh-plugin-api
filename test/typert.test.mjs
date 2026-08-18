import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createDisabledTypertFacade, createTypertFacade, isTypertRegistry } from '../lib/typert.js'
import { runFeatureGuard } from '../lib/guards.js'

function makeRegistry() {
  const calls = []
  const disposer = async () => {}
  const makeMethods = (key, names) => Object.fromEntries(names.map((name) => [name, function (...args) {
    calls.push({ key, name, receiver: this, args })
    return name === 'register' ? disposer : `${key}:${name}`
  }]))
  const registry = {
    calls,
    register(...args) { calls.push({ key: 'root', name: 'register', receiver: this, args }); return disposer },
    get(...args) { calls.push({ key: 'root', name: 'get', receiver: this, args }); return { args } },
    resolve(...args) { calls.push({ key: 'root', name: 'resolve', receiver: this, args }); return { args } },
    list(...args) { calls.push({ key: 'root', name: 'list', receiver: this, args }); return ['schema'] },
    getPackage(...args) { calls.push({ key: 'root', name: 'getPackage', receiver: this, args }); return { args } },
    listPackages(...args) { calls.push({ key: 'root', name: 'listPackages', receiver: this, args }); return ['package'] },
    toJSONSchema(...args) { calls.push({ key: 'root', name: 'toJSONSchema', receiver: this, args }); return { args } },
    local: makeMethods('local', ['get', 'hasSeen', 'list', 'subscribe']),
    remotes: makeMethods('remotes', ['register', 'get', 'list', 'subscribe']),
    lookups: makeMethods('lookups', ['register', 'configure', 'get', 'definitions', 'keys', 'subscribe']),
    contexts: makeMethods('contexts', ['registerHost', 'configureHost', 'registerClient', 'getHost', 'getClient', 'subscribe']),
  }
  return registry
}

test('isTypertRegistry requires the complete official public contract', () => {
  const registry = makeRegistry()
  assert.equal(isTypertRegistry(registry), true)
  assert.equal(isTypertRegistry({}), false)
  assert.equal(isTypertRegistry({ ...registry, local: {} }), false)
})

test('active facade forwards exact arguments, receiver, return values, and disposer identity', async () => {
  const registry = makeRegistry()
  const facade = createTypertFacade({ ctx: { get(name) { assert.equal(name, 'typert'); return registry } } })
  assert.equal(facade.isActive, true)
  assert.ok(Object.isFrozen(facade))
  assert.ok(Object.isFrozen(facade.local))

  const contribution = { package: 'example', schemas: [], model: {}, invocations: [] }
  assert.equal(facade.register(contribution), registry.register(contribution))
  const localResult = facade.local.get('example#Schema')
  assert.deepEqual(localResult, 'local:get')
  assert.deepEqual(facade.contexts.registerClient('scope', { identity() {} }), 'contexts:registerClient')
  assert.equal(registry.calls[0].receiver, registry)
  assert.equal(registry.calls[0].args[0], contribution)
  assert.equal(registry.calls.at(-2).receiver, registry.local)
  assert.equal(registry.calls.at(-1).receiver, registry.contexts)
  assert.equal(typeof await facade.remotes.register(contribution), 'function')
})

test('disabled facade exposes the same shape and never calls an absent official service', () => {
  const facade = createDisabledTypertFacade(true, 'missing')
  assert.equal(facade.isActive, false)
  assert.ok(Object.isFrozen(facade))
  for (const call of [
    () => facade.register({}),
    () => facade.local.get('x'),
    () => facade.remotes.list(),
    () => facade.lookups.keys(),
    () => facade.contexts.getHost('x'),
  ]) {
    assert.throws(call, (error) => error.code === 'PLUGIN_API_FEATURE_DISABLED' && error.feature === 'services.typert')
  }
})

test('core inactivity wins over the feature-disabled outcome', () => {
  const facade = createDisabledTypertFacade(() => false, 'missing')
  assert.throws(() => facade.list(), (error) => error.code === 'PLUGIN_API_INACTIVE')
})

test('malformed or throwing registry is contained locally', () => {
  const logs = []
  const malformed = createTypertFacade({
    ctx: { get() { return { register() {} } } },
    logger: { error(message) { logs.push(message) } },
  })
  assert.equal(malformed.isActive, false)
  assert.equal(logs.length, 1)

  const throwing = createTypertFacade({
    ctx: { get() { throw new Error('private detail') } },
    logger: { error(message) { logs.push(message) } },
  })
  assert.equal(throwing.isActive, false)
  assert.doesNotMatch(logs.at(-1), /private detail/)
  assert.match(logs.at(-1), /error/)
})

test('package exports expose the Typert artifact boundary without changing official loader files', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.exports['./typert'], './lib/typert.js')
})

test('typert guard is complete and locally fail-closed', () => {
  const healthy = runFeatureGuard('typert', { get(name) { return name === 'typert' ? makeRegistry() : undefined } })
  assert.equal(healthy.ok, true)
  const missing = runFeatureGuard('typert', { get() { return undefined } })
  assert.equal(missing.ok, false)
  assert.doesNotThrow(() => runFeatureGuard('typert', { get() { throw new Error('hostile') } }))
})
