import test from 'node:test'
import assert from 'node:assert/strict'
import { SERVICE_DEFINITIONS, SERVICES_NAMESPACE_KEYS } from '../lib/services.js'

const EXPECTED_KEYS = [
  'fs',
  'codeRuntime',
  'workspaces',
  'subagents',
  'workflows',
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
]

test('SERVICE_DEFINITIONS declares exactly the 17 capability namespace keys', () => {
  assert.deepEqual(SERVICES_NAMESPACE_KEYS, EXPECTED_KEYS)
  assert.equal(SERVICE_DEFINITIONS.length, 17)
})

test('capability namespace excludes compaction and any other unofficial service', () => {
  assert.ok(!SERVICES_NAMESPACE_KEYS.includes('compaction'))
  for (const def of SERVICE_DEFINITIONS) {
    assert.ok(EXPECTED_KEYS.includes(def.key), `unexpected facade key ${def.key}`)
  }
})

test('official service name mapping matches the design table', () => {
  const mapping = Object.fromEntries(SERVICE_DEFINITIONS.map((def) => [def.key, def.ctxService]))
  assert.equal(mapping.workspaces, 'workspaceRegistry')
  assert.equal(mapping.workflows, 'workflowEngine')
  assert.equal(mapping.sessionReferences, 'sessionReferenceResolver')
  for (const def of SERVICE_DEFINITIONS) {
    if (!['workspaces', 'workflows', 'sessionReferences'].includes(def.key)) {
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

test('SV15 sessionReferences exposes service methods and the two forwarded URI helpers', () => {
  const def = SERVICE_DEFINITIONS.find((d) => d.key === 'sessionReferences')
  assert.ok(def)
  const methodNames = def.members.filter((m) => m.kind === 'method').map((m) => m.name)
  assert.deepEqual(methodNames, ['listCandidates', 'prepare'])
  const forwardNames = def.members.filter((m) => m.kind === 'forward').map((m) => m.name)
  assert.deepEqual(forwardNames, ['encodeSessionReferenceUri', 'decodeSessionReferenceUri'])
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
