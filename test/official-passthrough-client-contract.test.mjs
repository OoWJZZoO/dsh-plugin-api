import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CLIENT_ENTRY_URL,
  CLIENT_EXCLUDED_MEMBERS,
  CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS,
  CLIENT_REASONS,
  isClientReason,
  validateImportNamespace,
  resolveConstructorFromNamespace,
  validateStaticMembers,
} from '../lib/client-official-passthrough.js'

test('the seven official passthrough descriptors freeze exact package identities and member contracts', () => {
  assert.equal(CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS.length, 7)
  const expected = [
    ['client.inputTriggers', 'clientInputTriggers', '@deepseek-ai/dsh-client-ui-input-trigger', 'InputTriggerService', 'inputTriggers', ['registerSource', 'sessionOf']],
    ['client.commandUi', 'clientCommandUi', '@deepseek-ai/dsh-client-ui-commands', 'CommandUiRuntime', 'commandUi', ['register', 'decorate', 'popupFor']],
    ['client.modelDirectories', 'clientModelDirectories', '@deepseek-ai/dsh-client-ui-model-selection', 'ModelDirectoryResolver', 'modelDirectories', ['directoryFor']],
    ['client.conversation', 'clientConversation', '@deepseek-ai/dsh-client-ui-conversation', 'ConversationController', 'conversation', ['input', 'blocks', 'send', 'updateQueue', 'cancel', 'loadOlder']],
    ['client.conversationEvents', 'clientConversationEvents', '@deepseek-ai/dsh-client-runtime', 'ConversationEventRegistry', 'conversationEvents', ['entries', 'subscribe', 'register', 'registerFallback', 'fallbackEntry']],
    ['client.conversationViews', 'clientConversationViews', '@deepseek-ai/dsh-client-runtime', 'ConversationViewRegistry', 'conversationViews', ['entries', 'subscribe', 'register']],
    ['client.timer', 'clientTimer', '@deepseek-ai/dsh-cordis-client-runner', 'ClientTimerService', 'timer', ['setTimeout', 'setInterval', 'timeout', 'interval', 'throttle', 'debounce']],
  ]
  for (const [surfaceKey, featureName, moduleId, constructorExport, serviceName, members] of expected) {
    const descriptor = CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS.find((entry) => entry.surfaceKey === surfaceKey)
    assert.ok(descriptor, `missing descriptor ${surfaceKey}`)
    assert.equal(descriptor.featureName, featureName)
    assert.equal(descriptor.moduleId, moduleId)
    assert.equal(descriptor.constructorExport, constructorExport)
    assert.equal(descriptor.serviceName, serviceName)
    assert.equal(descriptor.parentURL, CLIENT_ENTRY_URL)
    assert.deepEqual(Object.keys(descriptor.members), members)
    for (const kind of Object.values(descriptor.members)) {
      assert.ok(kind === 'method' || kind === 'property', `unknown member kind ${kind}`)
    }
  }
})

test('the conversation leaf declares exactly the live properties and the four scope-addressed methods', () => {
  const conversation = CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS.find((entry) => entry.surfaceKey === 'client.conversation')
  assert.equal(conversation.members.input, 'property')
  assert.equal(conversation.members.blocks, 'property')
  for (const method of ['send', 'updateQueue', 'cancel', 'loadOlder']) {
    assert.equal(conversation.members[method], 'method')
  }
})

test('excluded concrete members stay outside the outward contract inventory', () => {
  assert.equal(CLIENT_EXCLUDED_MEMBERS['client.commandUi'].includes('bindComposerFocus'), true)
  assert.equal(CLIENT_EXCLUDED_MEMBERS['client.timer'].includes('dispose'), true)
  for (const [surfaceKey, members] of Object.entries(CLIENT_EXCLUDED_MEMBERS)) {
    const descriptor = CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS.find((entry) => entry.surfaceKey === surfaceKey)
    assert.ok(descriptor)
    for (const member of members) {
      assert.equal(member in descriptor.members, false, `${surfaceKey}.${member} must stay excluded`)
    }
  }
})

test('the closed diagnostic vocabulary contains exactly the six permitted reasons', () => {
  assert.deepEqual(
    [...Object.values(CLIENT_REASONS)].sort(),
    ['invalid-export', 'invalid-member', 'invalid-provider', 'missing-export', 'missing-member', 'missing-service'].sort(),
  )
  for (const reason of Object.values(CLIENT_REASONS)) assert.equal(isClientReason(reason), true)
  for (const reason of ['missing export', '', 'invalid', undefined, null, 42]) {
    assert.equal(isClientReason(reason), false)
  }
})

test('namespace validation accepts module namespaces and rejects malformed imports', () => {
  assert.equal(validateImportNamespace({}), true)
  assert.equal(validateImportNamespace(Object.create(null)), true)
  assert.equal(validateImportNamespace(function named() {}), false)
  for (const value of [undefined, null, 'ns', 42, true]) {
    assert.equal(validateImportNamespace(value), false, String(value))
  }
})

test('constructor resolution maps absent and non-function exports to fixed reasons', () => {
  const namespace = { InputTriggerService: class InputTriggerService {} }
  const ok = resolveConstructorFromNamespace(namespace, 'InputTriggerService')
  assert.equal(ok.ok, true)
  assert.equal(ok.Constructor, namespace.InputTriggerService)
  assert.equal(resolveConstructorFromNamespace(namespace, 'Missing').ok, false)
  assert.equal(resolveConstructorFromNamespace(namespace, 'Missing').reason, CLIENT_REASONS.missingMember)
  const wrong = { InputTriggerService: { name: 'not a constructor' } }
  assert.equal(resolveConstructorFromNamespace(wrong, 'InputTriggerService').reason, CLIENT_REASONS.invalidMember)
})

test('static member validation enforces the declared kinds for the whole contract', () => {
  const contract = { registerSource: 'method', sessionOf: 'method' }
  assert.deepEqual(validateStaticMembers({ registerSource() {}, sessionOf() {} }, contract), { ok: true })
  assert.equal(validateStaticMembers({ registerSource() {} }, contract).reason, CLIENT_REASONS.missingMember)
  assert.equal(validateStaticMembers({ registerSource: 'noop', sessionOf() {} }, contract).reason, CLIENT_REASONS.invalidMember)
  // Properties are checked only for presence.
  const conversation = { input: { resolve() {} }, blocks: [], send() {} }
  assert.deepEqual(
    validateStaticMembers(conversation, { input: 'property', blocks: 'property', send: 'method' }),
    { ok: true },
  )
  assert.equal(validateStaticMembers({ input: undefined, blocks: [], send() {} }, { input: 'property', blocks: 'property', send: 'method' }).reason,
    CLIENT_REASONS.missingMember)
  // Members outside the contract are never inspected.
  assert.deepEqual(
    validateStaticMembers({ registerSource() {}, sessionOf() {}, hidden: 'secret' }, contract),
    { ok: true },
  )
})

test('the client entry URL is the facade client identifier used as the loader parent URL', () => {
  assert.equal(typeof CLIENT_ENTRY_URL, 'string')
  assert.ok(CLIENT_ENTRY_URL.startsWith('@deepseek-ai/dsh-plugin-api-main'))
})