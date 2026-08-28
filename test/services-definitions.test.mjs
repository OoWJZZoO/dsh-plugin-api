import test from 'node:test'
import assert from 'node:assert/strict'
import { SERVICE_DEFINITIONS, SERVICES_NAMESPACE_KEYS } from '../lib/services.js'

const EXPECTED_KEYS = [
  'fs',
  'codeRuntime',
  'workspaces',
  'subagents',
  'approval',
  'userQuestions',
  'attachments',
  'skills',
  'storage',
  'sessionProjections',
  'sessionQuery',
  'sessionTitle',
  'sessionTelemetry',
  'sessionReferences',
  'tokenMeter',
  'agentDefaultModel',
  'web',
  'jobs',
  'shellEnv',
  'agentLoop',
  'agentPresets',
  'apiProxy',
  'clientModules',
  'commands',
  'credentials',
  'directoryPicker',
  'e2b',
  'goals',
  'invariants',
  'lsp',
  'messageFeedback',
  'permissionPresets',
  'planMode',
  'sandbox',
  'sandboxPolicy',
  'sessionPersistence',
  'sessionProjectionCache',
  'shell',
  'spillStore',
  'storageDomain',
  'subprocess',
  'terminals',
  'timer',
  'toolResultPruner',
  'typertGateway',
  'webServer',
]

test('SERVICE_DEFINITIONS declares exactly the 46 capability namespace keys', () => {
  assert.deepEqual(SERVICES_NAMESPACE_KEYS, EXPECTED_KEYS)
  assert.equal(SERVICE_DEFINITIONS.length, 46)
  assert.equal(SERVICE_DEFINITIONS.some((d) => d.key === 'compaction'), false, 'compaction is removed with its replacement-owned semantics')
  assert.equal(SERVICE_DEFINITIONS.some((d) => d.key === 'workflows'), false, 'workflows is removed pending a future wrapped surface')
})

test('capability namespace contains only its approved static service definitions', () => {
  for (const def of SERVICE_DEFINITIONS) {
    assert.ok(EXPECTED_KEYS.includes(def.key), `unexpected facade key ${def.key}`)
  }
})

test('official service name mapping matches the design table', () => {
  const mapping = Object.fromEntries(SERVICE_DEFINITIONS.map((def) => [def.key, def.ctxService]))
  assert.equal(mapping.workspaces, 'workspaceRegistry')
  assert.equal(mapping.sessionReferences, 'sessionReferenceResolver')
  for (const def of SERVICE_DEFINITIONS) {
    if (!['workspaces', 'sessionReferences'].includes(def.key)) {
      assert.equal(def.ctxService, def.key)
    }
  }
})

test('every member uses a legal kind and has a name', () => {
  const legalKinds = new Set(['method', 'getter', 'forward'])
  for (const def of SERVICE_DEFINITIONS) {
    assert.ok(Array.isArray(def.members) && def.members.length > 0, `${def.key} has members`)
    for (const member of def.members) {
      assert.ok(legalKinds.has(member.kind), `${def.key}.${member.name} has legal kind`)
      assert.equal(typeof member.name, 'string')
      assert.ok(member.name.length > 0)
    }
  }
})

test('only sessionTelemetry.flush is marked optional', () => {
  for (const def of SERVICE_DEFINITIONS) {
    for (const member of def.members) {
      if (member.optional) {
        assert.equal(def.key, 'sessionTelemetry')
        assert.equal(member.name, 'flush')
      }
    }
  }
})

test('sessionReferences exposes service methods and the two forwarded URI helpers', () => {
  const def = SERVICE_DEFINITIONS.find((d) => d.key === 'sessionReferences')
  assert.ok(def)
  const methodNames = def.members.filter((m) => m.kind === 'method').map((m) => m.name)
  assert.deepEqual(methodNames, ['listCandidates', 'prepare'])
  const forwardNames = def.members.filter((m) => m.kind === 'forward').map((m) => m.name)
  assert.deepEqual(forwardNames, ['encodeSessionReferenceUri', 'decodeSessionReferenceUri'])
})

test('approved subtraction: writable singleton setters are gone from the whitelist', () => {
  const memberNames = (key) => SERVICE_DEFINITIONS.find((d) => d.key === key)?.members.map((m) => m.name) ?? []
  for (const [key, gone] of [
    ['approval', ['setPolicy']],
    ['planMode', ['set']],
    ['permissionPresets', ['set', 'selectFor']],
    ['credentials', ['set', 'unset']],
    ['sessionProjectionCache', ['write']],
  ]) {
    for (const name of gone) {
      assert.equal(memberNames(key).includes(name), false, `services.${key}.${name} must be removed`)
    }
  }
  // The vetoed member stays: agentDefaultModel.saveSelection is retained.
  assert.equal(memberNames('agentDefaultModel').includes('saveSelection'), true,
    'agentDefaultModel.saveSelection stays per the second approval decision')
  // Retained read/query members survive next to the removed setters.
  for (const [key, kept] of [
    ['approval', ['request', 'overrideOf']],
    ['planMode', ['get']],
    ['permissionPresets', ['current', 'resolve', 'optionOf']],
    ['credentials', ['resolve', 'describe']],
    ['sessionProjectionCache', ['cachedSnapshot', 'coldSnapshot']],
  ]) {
    for (const name of kept) {
      assert.equal(memberNames(key).includes(name), true, `services.${key}.${name} must be retained`)
    }
  }
})

test('jobs exposes exactly the nine public abstract JobRegistry operations', () => {
  const def = SERVICE_DEFINITIONS.find((d) => d.key === 'jobs')
  assert.ok(def)
  assert.equal(def.ctxService, 'jobs')
  assert.equal('pkg' in def, false)
  assert.equal(def.members.length, 9)
  const kinds = new Set(def.members.map((m) => m.kind))
  assert.deepEqual([...kinds], ['method'])
  assert.deepEqual(
    def.members.map((m) => m.name),
    ['start', 'list', 'get', 'read', 'kill', 'wait', 'onJobDone', 'onJobsChanged', 'attachController'],
  )
  assert.equal(def.members.some((m) => m.optional), false)
  assert.equal(def.members.some((m) => m.kind === 'getter'), false)
  assert.equal(def.members.some((m) => m.kind === 'forward'), false)
})

test('shellEnv exposes exactly the three public ShellEnvRegistry operations', () => {
  const def = SERVICE_DEFINITIONS.find((d) => d.key === 'shellEnv')
  assert.ok(def)
  assert.equal(def.ctxService, 'shellEnv')
  assert.equal('pkg' in def, false)
  assert.equal(def.members.length, 3)
  assert.deepEqual(
    def.members.map((m) => m.name),
    ['register', 'collect', 'list'],
  )
  assert.equal(def.members.some((m) => m.optional), false)
  assert.equal(def.members.some((m) => m.kind === 'getter'), false)
  assert.equal(def.members.some((m) => m.kind === 'forward'), false)
})

test('fs, workspaces, skills surfaces contain the corrected official method names', () => {
  const methodNames = (key) => SERVICE_DEFINITIONS
    .find((d) => d.key === key).members
    .filter((m) => m.kind === 'method')
    .map((m) => m.name)

  for (const name of ['resolve', 'processPath', 'fileUrl', 'contains', 'stat', 'lstat', 'readText', 'streamText', 'readBytes', 'listDir', 'writeText', 'editText']) {
    assert.ok(methodNames('fs').includes(name), `fs.${name}`)
  }
  for (const name of ['create', 'get', 'list', 'delete', 'insertBefore', 'archiveSession', 'resolveByPath']) {
    assert.ok(methodNames('workspaces').includes(name), `workspaces.${name}`)
  }
  for (const name of ['registerProvider', 'register', 'list', 'snapshot', 'get']) {
    assert.ok(methodNames('skills').includes(name), `skills.${name}`)
  }
})
