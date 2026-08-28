import test from 'node:test'
import assert from 'node:assert/strict'
import { PluginApiFeatureDisabledError } from '../lib/errors.js'
import { buildActiveFacade } from '../lib/services.js'
import { OFFICIAL_SERVICE_DEFINITIONS } from '../lib/official-service-definitions.js'

const EXPECTED_DEFINITIONS = [
  ['agentLoop', 'agentLoop', [['config', 'getter'], ['create', 'method'], ['createAgent', 'method'], ['resume', 'method']]],
  ['agentPresets', 'agentPresets', [['list', 'method'], ['resolve', 'method'], ['mount', 'method'], ['composeFrom', 'method'], ['composedPreset', 'method'], ['read', 'method'], ['copy', 'method'], ['remove', 'method'], ['serviceFor', 'method'], ['recompose', 'method'], ['standingKeyFor', 'method']]],
  ['apiProxy', 'apiProxy', [['downloads', 'getter'], ['respond', 'method']]],
  ['clientModules', 'clientModules', [['graph', 'method'], ['clientPath', 'method'], ['rebuilt', 'method'], ['onRebuilt', 'method'], ['onGraphChanged', 'method']]],
  ['commands', 'commands', [['register', 'method'], ['list', 'method'], ['find', 'method'], ['execute', 'method']]],
  ['credentials', 'credentials', [['resolve', 'method'], ['describe', 'method']]],
  ['directoryPicker', 'directoryPicker', [['capability', 'method']]],
  ['e2b', 'e2b', [['cwd', 'getter'], ['runtimeRoot', 'getter'], ['getSandbox', 'method']]],
  ['goals', 'goals', [['get', 'method'], ['disarm', 'method'], ['create', 'method'], ['edit', 'method'], ['pause', 'method'], ['resume', 'method'], ['complete', 'method'], ['block', 'method'], ['clear', 'method'], ['remoteExportCreate', 'method']]],
  ['invariants', 'invariants', [['register', 'method']]],
  ['lsp', 'lsp', [['registerProvider', 'method'], ['query', 'method']]],
  ['messageFeedback', 'messageFeedback', [['list', 'method'], ['put', 'method'], ['delete', 'method']]],
  ['permissionPresets', 'permissionPresets', [['current', 'method'], ['resolve', 'method'], ['optionOf', 'method']]],
  ['planMode', 'planMode', [['get', 'method']]],
  ['sandbox', 'sandbox', [['confine', 'method']]],
  ['sandboxPolicy', 'sandboxPolicy', [['defaultMode', 'getter'], ['workspaceRoot', 'getter'], ['resolve', 'method'], ['overrideOf', 'method']]],
  ['sessionPersistence', 'sessionPersistence', [['locate', 'method'], ['supportsRawArtifacts', 'getter'], ['readRaw', 'method'], ['create', 'method'], ['append', 'method'], ['prepare', 'method'], ['load', 'method'], ['inspect', 'method'], ['readFrom', 'method'], ['list', 'method'], ['listSnapshots', 'method']]],
  ['sessionProjectionCache', 'sessionProjectionCache', [['cachedSnapshot', 'method'], ['coldSnapshot', 'method']]],
  ['shell', 'shell', [['resolve', 'method'], ['run', 'method'], ['start', 'method']]],
  ['spillStore', 'spillStore', [['saveText', 'method']]],
  ['storageDomain', 'storageDomain', [['open', 'method'], ['get', 'method'], ['closeAll', 'method']]],
  ['subprocess', 'subprocess', [['resolveExecutable', 'method'], ['spawn', 'method'], ['spawnTerminal', 'method']]],
  ['terminals', 'terminals', [['registerBackend', 'method'], ['listBackends', 'method'], ['spawn', 'method'], ['hasOwnerActivity', 'method'], ['startSend', 'method'], ['read', 'method'], ['signal', 'method'], ['kill', 'method'], ['list', 'method']]],
  ['timer', 'timer', [['timeout', 'method'], ['interval', 'method'], ['throttle', 'method'], ['debounce', 'method']]],
  ['toolResultPruner', 'toolResultPruner', [['config', 'getter'], ['measureContent', 'method'], ['pruneContent', 'method'], ['pruneSession', 'method']]],
  ['typertGateway', 'typertGateway', [['invoke', 'method']]],
  ['webServer', 'webServer', [['register', 'method'], ['registerUpgrade', 'method'], ['registerFallback', 'method'], ['tapIndex', 'method'], ['applyIndexTaps', 'method']]],
  ['web', 'web', [['registerSearchProvider', 'method'], ['registerFetchProvider', 'method'], ['search', 'method'], ['fetch', 'method']],],
]

function normalizedDefinitions(definitions) {
  return definitions.map((definition) => [
    definition.key,
    definition.ctxService,
    definition.members.map((member) => [member.name, member.kind]),
  ])
}

function assertDeepFrozen(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  assert.ok(Object.isFrozen(value))
  for (const child of Object.values(value)) assertDeepFrozen(child, seen)
}

function createService(definition, omittedName) {
  const service = {
    concreteProvider: { internal: true },
    privateRegistry: new Map(),
    unrelated() {},
  }
  const calls = new Map()
  const values = new Map()

  for (const member of definition.members) {
    if (member.name === omittedName) continue
    const value = { service: definition.key, member: member.name }
    values.set(member.name, value)
    if (member.kind === 'getter') {
      Object.defineProperty(service, member.name, {
        enumerable: true,
        configurable: true,
        get() {
          calls.set(member.name, [])
          return value
        },
      })
    } else {
      service[member.name] = function (...args) {
        assert.equal(this, service)
        calls.set(member.name, args)
        return value
      }
    }
  }

  return { service, calls, values }
}

function disabledError(definition) {
  return (error) => error instanceof PluginApiFeatureDisabledError
    && error.feature === `services.${definition.key}`
}

function assertFacadeMemberFailure(facade, definition) {
  for (const member of definition.members) {
    if (member.kind === 'getter') {
      assert.throws(() => facade[member.name], disabledError(definition))
    } else {
      assert.throws(() => facade[member.name](), disabledError(definition))
    }
  }
}

test('the fragment has the exact static service and member contract', () => {
  assert.deepEqual(normalizedDefinitions(OFFICIAL_SERVICE_DEFINITIONS), EXPECTED_DEFINITIONS)
  assert.equal(OFFICIAL_SERVICE_DEFINITIONS.length, 28)
  assert.equal(
    OFFICIAL_SERVICE_DEFINITIONS.reduce((count, definition) => count + definition.members.length, 0),
    107,
  )
  assert.equal(new Set(OFFICIAL_SERVICE_DEFINITIONS.map((definition) => definition.key)).size, 28)

  for (const definition of OFFICIAL_SERVICE_DEFINITIONS) {
    assert.deepEqual(Object.keys(definition), ['key', 'ctxService', 'members'])
    for (const member of definition.members) {
      assert.deepEqual(Object.keys(member), ['kind', 'name'])
      assert.ok(member.kind === 'method' || member.kind === 'getter')
      assert.equal('optional' in member, false)
    }
  }
})

test('the fragment is deeply immutable and contains no private surface metadata', () => {
  assertDeepFrozen(OFFICIAL_SERVICE_DEFINITIONS)
  assert.equal('pkg' in OFFICIAL_SERVICE_DEFINITIONS[0], false)
  assert.equal('provenance' in OFFICIAL_SERVICE_DEFINITIONS[0], false)
  assert.equal('classification' in OFFICIAL_SERVICE_DEFINITIONS[0], false)
  assert.equal('proxy' in OFFICIAL_SERVICE_DEFINITIONS[0], false)
  assert.throws(() => OFFICIAL_SERVICE_DEFINITIONS.push({}), TypeError)
  assert.throws(() => OFFICIAL_SERVICE_DEFINITIONS[0].members.push({ kind: 'method', name: 'extra' }), TypeError)
})

test('the active builder preserves exact facade shape, getters, receiver, arguments, and identities', () => {
  for (const definition of OFFICIAL_SERVICE_DEFINITIONS) {
    const { service, calls, values } = createService(definition)
    const facade = buildActiveFacade(definition, service)

    assert.equal(facade.isActive, true)
    assert.deepEqual(Object.keys(facade), ['isActive', ...definition.members.map((member) => member.name)])
    assert.equal('concreteProvider' in facade, false)
    assert.equal('privateRegistry' in facade, false)
    assert.equal('unrelated' in facade, false)

    for (const member of definition.members) {
      const argument = { member: member.name }
      if (member.kind === 'getter') {
        assert.equal(facade[member.name], values.get(member.name))
        assert.deepEqual(calls.get(member.name), [])
      } else {
        assert.equal(facade[member.name](argument), values.get(member.name))
        assert.deepEqual(calls.get(member.name), [argument])
      }
    }
  }
})

test('the active builder preserves falsey values, Promise identity, disposer identity, and errors', async () => {
  const definition = OFFICIAL_SERVICE_DEFINITIONS.find((entry) => entry.key === 'commands')
  const thrown = new Error('official throw')
  const rejected = new Error('official rejection')
  const rejectedPromise = Promise.reject(rejected)
  const disposer = () => 'dispose'
  const service = {
    register() {
      throw thrown
    },
    list() {
      return false
    },
    find() {
      return rejectedPromise
    },
    execute() {
      return disposer
    },
  }
  const facade = buildActiveFacade(definition, service)

  assert.throws(() => facade.register(), (error) => error === thrown)
  assert.equal(facade.list(), false)
  assert.equal(facade.find(), rejectedPromise)
  assert.equal(facade.execute(), disposer)
  await assert.rejects(rejectedPromise, (error) => error === rejected)
})

test('every required service member independently produces a disabled facade when absent', () => {
  for (const definition of OFFICIAL_SERVICE_DEFINITIONS) {
    const { service } = createService(definition, definition.members[0].name)
    const facade = buildActiveFacade(definition, service)
    assert.equal(facade.isActive, false)
    assertFacadeMemberFailure(facade, definition)
  }
})

test('a missing service is locally disabled while the root namespace remains usable', () => {
  const missingKey = 'sessionPersistence'
  const rootEntries = OFFICIAL_SERVICE_DEFINITIONS.map((definition) => {
    const service = definition.key === missingKey ? undefined : createService(definition).service
    return [definition.key, buildActiveFacade(definition, service)]
  })
  const root = Object.freeze(Object.fromEntries(rootEntries))

  assert.equal(Object.keys(root).length, OFFICIAL_SERVICE_DEFINITIONS.length)
  assert.equal(root[missingKey].isActive, false)
  assertFacadeMemberFailure(root[missingKey], OFFICIAL_SERVICE_DEFINITIONS.find((definition) => definition.key === missingKey))
  assert.equal(root.agentLoop.isActive, true)
  assert.equal(root.agentLoop.create({}), rootEntries.find(([key]) => key === 'agentLoop')[1].create({}))
  assert.equal(root.web.isActive, true)
})
