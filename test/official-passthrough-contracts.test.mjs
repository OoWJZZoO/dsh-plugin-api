import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CATALOG_ENTRY_FIELDS,
  CLIENT_CONNECTION_CONTRACT,
  CLIENT_EVENT_CONTRACTS,
  CLIENT_SERVICE_CONTRACTS,
  CONTRACT_CARDINALITIES,
  HOST_EVENT_CONTRACTS,
  HOST_EVENT_SLICES,
  HOST_NAMESPACE_CONTRACTS,
  SERVICE_DEFINITION_CONTRACTS,
} from './official-passthrough-contracts.mjs'
import {
  buildActiveFacade,
  buildDisabledFacade,
  createServicesNamespace,
  SERVICE_DEFINITIONS,
} from '../lib/services.js'
import { PluginApiFeatureDisabledError } from '../lib/errors.js'

function assertFrozenRecursively(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  assert.ok(Object.isFrozen(value))
  for (const child of Object.values(value)) assertFrozenRecursively(child, seen)
}

function memberCount(contracts) {
  return contracts.reduce((count, contract) => count + contract.members.length, 0)
}

function createCompleteService(definition, calls, values) {
  const service = {}
  for (const member of definition.members) {
    if (member.kind === 'method') {
      const result = { key: definition.key, name: member.name }
      values.set(`${definition.key}.${member.name}`, result)
      service[member.name] = function (...args) {
        assert.equal(this, service)
        calls.push({ key: definition.key, name: member.name, args })
        return result
      }
    } else if (member.kind === 'getter') {
      const result = { key: definition.key, name: member.name }
      values.set(`${definition.key}.${member.name}`, result)
      Object.defineProperty(service, member.name, {
        enumerable: true,
        get() {
          return result
        },
      })
    }
  }
  return service
}

function createCompleteContext(definitions) {
  const calls = []
  const values = new Map()
  const services = new Map()
  const helpers = {}

  for (const definition of definitions) {
    services.set(definition.ctxService, createCompleteService(definition, calls, values))
    for (const member of definition.members) {
      if (member.kind !== 'forward') continue
      const result = { key: definition.key, name: member.name }
      values.set(`${definition.key}.${member.name}`, result)
      helpers[member.name] = (...args) => {
        calls.push({ key: definition.key, name: member.name, args })
        return result
      }
    }
  }

  return {
    calls,
    values,
    helpers,
    ctx: { get: (name) => services.get(name) },
  }
}

test('contract fixtures are deeply immutable and match their declared cardinalities', () => {
  for (const fixture of [
    CATALOG_ENTRY_FIELDS,
    HOST_NAMESPACE_CONTRACTS,
    HOST_EVENT_SLICES,
    HOST_EVENT_CONTRACTS,
    CLIENT_SERVICE_CONTRACTS,
    CLIENT_EVENT_CONTRACTS,
    CLIENT_CONNECTION_CONTRACT,
    SERVICE_DEFINITION_CONTRACTS,
    CONTRACT_CARDINALITIES,
  ]) {
    assertFrozenRecursively(fixture)
  }

  assert.equal(CATALOG_ENTRY_FIELDS.length, CONTRACT_CARDINALITIES.catalogFields)
  assert.equal(HOST_NAMESPACE_CONTRACTS.length, CONTRACT_CARDINALITIES.hostNamespaces)
  assert.equal(memberCount(HOST_NAMESPACE_CONTRACTS), CONTRACT_CARDINALITIES.hostNamespaceMembers)
  assert.equal(HOST_EVENT_SLICES.length, CONTRACT_CARDINALITIES.hostEventSlices)
  assert.equal(HOST_EVENT_CONTRACTS.length, CONTRACT_CARDINALITIES.hostEvents)
  assert.equal(CLIENT_SERVICE_CONTRACTS.length, CONTRACT_CARDINALITIES.clientServices)
  assert.equal(memberCount(CLIENT_SERVICE_CONTRACTS), CONTRACT_CARDINALITIES.clientServiceMembers)
  assert.equal(CLIENT_EVENT_CONTRACTS.length, CONTRACT_CARDINALITIES.clientEvents)
  assert.equal(CLIENT_CONNECTION_CONTRACT.members.length, CONTRACT_CARDINALITIES.clientConnectionMembers)
  assert.equal(SERVICE_DEFINITION_CONTRACTS.length, CONTRACT_CARDINALITIES.serviceDefinitionInputs)
})

test('contract fixtures pin exact names, members, and catalog metadata', () => {
  assert.deepEqual(CATALOG_ENTRY_FIELDS, [
    'name', 'mode', 'scopeFiltered', 'scopeKey', 'payload', 'args', 'fault', 'freeze',
  ])
  assert.deepEqual(HOST_NAMESPACE_CONTRACTS.map((contract) => [contract.name, contract.members]), [
    ['llm', ['listProviders', 'listConfigurableProviders', 'discoverModels', 'providerRetryPolicy', 'listModels', 'resolveCallConfig', 'contentHasImage', 'createUserMessage', 'BlockAssembler']],
    ['agent', ['currentInitiator', 'requireInitiator', 'withInitiator', 'withoutInitiator', 'isOwnedBy', 'options']],
    ['session', ['create', 'prepare', 'enter', 'announce', 'flush', 'append', 'deriveEventMessage']],
    ['tools', ['toolAbortedError', 'executionMode', 'defineTool']],
    ['systemPrompt', ['assemble']],
    ['settings', ['writable', 'prepareDocument', 'get', 'update', 'replace', 'mutate']],
  ])
  assert.deepEqual(HOST_EVENT_SLICES.map((slice) => slice.events), [
    ['agent-loop/config-start-failed'],
    ['agent-preset/selected'],
    ['cordis/dynamic-package', 'cordis/dynamic-retract', 'cordis/request-run', 'cordis/request-run-resolved'],
    ['cordis/inspect-query', 'cordis/inspect-query-resolved'],
    ['domain/changed'],
  ])
  assert.deepEqual(HOST_EVENT_CONTRACTS.map((entry) => Object.keys(entry)), HOST_EVENT_CONTRACTS.map(() => CATALOG_ENTRY_FIELDS))
  for (const entry of HOST_EVENT_CONTRACTS) {
    assert.equal(entry.mode, 'emit')
    assert.equal(entry.scopeFiltered, false)
    assert.equal(entry.scopeKey, undefined)
    assert.equal(entry.fault, 'contain')
    assert.equal(entry.freeze, 'all')
  }
  assert.deepEqual(CLIENT_SERVICE_CONTRACTS.map((contract) => contract.name), [
    'modules', 'locale', 'sessions', 'workspaces', 'chatFileMentions', 'layout',
    'theme', 'appShell', 'sessionLogDownload', 'cordisInspect', 'dynamicCordisRunner',
  ])
  assert.deepEqual(CLIENT_EVENT_CONTRACTS.map((contract) => [contract.name, contract.args]), [
    ['locale/change', '(snapshot)'],
    ['theme/change', '(snapshot)'],
    ['connection/reset', '(official payload)'],
    ['command/executed', '(sessionId, commandName, result)'],
  ])
  assert.deepEqual(CLIENT_CONNECTION_CONTRACT, {
    name: 'llm',
    members: ['providers', 'models', 'discoverModels'],
  })
  assert.deepEqual(SERVICE_DEFINITION_CONTRACTS.map((definition) => Object.keys(definition)), SERVICE_DEFINITION_CONTRACTS.map(() => ['key', 'ctxService', 'members']))
  assert.equal(SERVICE_DEFINITION_CONTRACTS.find((definition) => definition.key === 'web').members.length, 4)
})

test('the existing service table preserves the shared facade-builder behavior', () => {
  const context = createCompleteContext(SERVICE_DEFINITIONS)
  const namespace = createServicesNamespace({
    ctx: context.ctx,
    active: true,
    uriHelpers: context.helpers,
  })

  assert.ok(Object.isFrozen(namespace))

  for (const definition of SERVICE_DEFINITIONS) {
    const service = context.ctx.get(definition.ctxService)
    const direct = buildActiveFacade(definition, service, context.helpers, true)
    const fromNamespace = namespace[definition.key]
    assert.equal(fromNamespace.isActive, true)
    assert.deepEqual(Object.keys(fromNamespace), Object.keys(direct))

    for (const member of definition.members) {
      const value = context.values.get(`${definition.key}.${member.name}`)
      if (member.kind === 'getter') {
        assert.equal(fromNamespace[member.name], value)
        assert.equal(direct[member.name], value)
      } else {
        const argument = { member: member.name }
        assert.equal(fromNamespace[member.name](argument), value)
        assert.equal(direct[member.name](argument), value)
      }
    }
  }
  assert.ok(context.calls.length > 0)
})

test('a static definition fragment receives the existing active and disabled facade behavior', () => {
  const definition = {
    key: 'example',
    ctxService: 'example',
    members: [{ kind: 'method', name: 'run' }, { kind: 'getter', name: 'state' }],
  }
  const result = { ok: true }
  const state = { ready: true }
  const service = {
    run(value) {
      assert.equal(this, service)
      return value === result ? result : undefined
    },
    get state() {
      return state
    },
  }
  const active = buildActiveFacade(definition, service, {}, true)
  assert.equal(active.isActive, true)
  assert.equal(active.run(result), result)
  assert.equal(active.state, state)

  const disabled = buildDisabledFacade(
    definition,
    () => true,
    'official service "example" is unavailable',
    'services.example',
  )
  assert.equal(disabled.isActive, false)
  assert.throws(
    () => disabled.run(),
    (error) => error instanceof PluginApiFeatureDisabledError && error.feature === 'services.example',
  )
  assert.throws(
    () => disabled.state,
    (error) => error instanceof PluginApiFeatureDisabledError && error.feature === 'services.example',
  )

  const allDisabled = createServicesNamespace({
    ctx: { get: () => undefined },
    active: true,
  })
  assert.equal(allDisabled.fs.isActive, false)
  assert.throws(
    () => allDisabled.fs.readText(),
    (error) => error instanceof PluginApiFeatureDisabledError && error.feature === 'services',
  )
})
