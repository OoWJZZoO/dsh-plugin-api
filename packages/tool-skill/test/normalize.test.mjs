import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeAuditQuery,
  normalizeActivationRequest,
  normalizeDescriptorSpec,
  normalizePolicyInput,
  normalizeRegisterSkillInput,
  normalizeScope,
} from '../lib/skill-activation-normalize.js'

test('normalizeScope accepts every kind with a key', () => {
  for (const kind of ['session', 'agent', 'turn']) {
    const result = normalizeScope({ kind, key: `scope-${kind}` })
    assert.equal(result.ok, true)
    assert.deepEqual(result.value, { kind, key: `scope-${kind}` })
    assert.equal(Object.isFrozen(result.value), true)
  }
})

test('normalizeScope rejects malformed references', () => {
  assert.equal(normalizeScope(undefined).ok, false)
  assert.equal(normalizeScope('session').ok, false)
  assert.equal(normalizeScope([]).ok, false)
  assert.equal(normalizeScope({ kind: 'session' }).ok, false)
  assert.equal(normalizeScope({ kind: 'workspace', key: 'x' }).ok, false)
  assert.equal(normalizeScope({ kind: 'session', key: '' }).ok, false)
  const result = normalizeScope({ kind: 'session', key: 'x' })
  assert.equal(result.ok, true)
})

test('activation scope failures carry the resolved scope code', () => {
  const result = normalizeActivationRequest({ scope: { kind: 'session' } })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'ACTIVATION_SCOPE_UNRESOLVED')
})

test('normalizePolicyInput requires a session scope and returns the key', () => {
  const ok = normalizePolicyInput({ kind: 'session', key: 's-1' })
  assert.equal(ok.ok, true)
  assert.equal(ok.value, 's-1')
  assert.equal(normalizePolicyInput({ kind: 'turn', key: 't-1' }).code, 'ACTIVATION_SCOPE_UNRESOLVED')
  assert.equal(normalizePolicyInput({ kind: 'session' }).code, 'ACTIVATION_SCOPE_UNRESOLVED')
})

test('normalizeDescriptorSpec normalizes a full valid spec', () => {
  const result = normalizeDescriptorSpec({
    skillId: 'demo-skill',
    owner: 'plugin-a',
    summary: 'Short summary',
    capabilities: ['vision', 'web'],
    sourceKind: 'userInvocable',
    dependencies: ['dep-skill'],
    tools: [{ entryId: 'demo-tool', generation: 'g-1' }],
    promptSections: ['demo:section'],
    resources: [{ resourceId: 'res-1', metadata: { kind: 'opaque' } }],
  })
  assert.equal(result.ok, true)
  assert.equal(result.value.skillId, 'demo-skill')
  assert.equal(result.value.owner, 'plugin-a')
  assert.equal(result.value.sourceKind, 'userInvocable')
  assert.deepEqual(result.value.tools, [{ entryId: 'demo-tool', generation: 'g-1' }])
  assert.deepEqual(result.value.promptSections, ['demo:section'])
  assert.deepEqual(result.value.resources, [{ resourceId: 'res-1', metadata: { kind: 'opaque' } }])
  assert.equal(Object.isFrozen(result.value), true)
})

test('normalizeDescriptorSpec defaults sourceKind and clamps strings', () => {
  const result = normalizeDescriptorSpec({ skillId: 'demo', owner: 'p', summary: 's' })
  assert.equal(result.ok, true)
  assert.equal(result.value.sourceKind, 'userInvocable')
  const longSummary = normalizeDescriptorSpec({ skillId: 'demo', owner: 'p', summary: 'x'.repeat(201) })
  assert.equal(longSummary.ok, false)
  assert.equal(longSummary.code, 'SKILL_REGISTRATION_INVALID')
  const boundary = normalizeDescriptorSpec({ skillId: 'demo', owner: 'p', summary: 'x'.repeat(200) })
  assert.equal(boundary.ok, true)
})

test('normalizeDescriptorSpec rejects invalid fields', () => {
  const cases = [
    { skillId: 'Bad_Name', owner: 'p', summary: 's' },
    { skillId: 'demo', owner: '', summary: 's' },
    { skillId: 'demo', owner: 'p', summary: '' },
    { skillId: 'demo', owner: 'p', summary: 's', capabilities: new Array(17).fill('c') },
    { skillId: 'demo', owner: 'p', summary: 's', capabilities: ['ok', 3] },
    { skillId: 'demo', owner: 'p', summary: 's', sourceKind: 'manual' },
    { skillId: 'demo', owner: 'p', summary: 's', dependencies: ['BAD name'] },
    { skillId: 'demo', owner: 'p', summary: 's', tools: [{ noEntry: true }] },
    { skillId: 'demo', owner: 'p', summary: 's', promptSections: [''] },
    { skillId: 'demo', owner: 'p', summary: 's', resources: [{ resourceId: '' }] },
  ]
  for (const spec of cases) {
    const result = normalizeDescriptorSpec(spec)
    assert.equal(result.ok, false, JSON.stringify(spec))
    assert.equal(result.code, 'SKILL_REGISTRATION_INVALID')
  }
})

test('auto-match and provider-sourced descriptors must declare a condition', () => {
  for (const sourceKind of ['auto-match', 'provider-sourced']) {
    const missing = normalizeDescriptorSpec({ skillId: 'demo', owner: 'p', summary: 's', sourceKind })
    assert.equal(missing.ok, false)
    assert.equal(missing.code, 'SKILL_REGISTRATION_INVALID')
    const wrongKind = normalizeDescriptorSpec({
      skillId: 'demo', owner: 'p', summary: 's', sourceKind,
      activationSource: { kind: 'userInvocable', condition: 'c' },
    })
    assert.equal(wrongKind.ok, false)
    const declared = normalizeDescriptorSpec({
      skillId: 'demo', owner: 'p', summary: 's', sourceKind,
      activationSource: { kind: sourceKind, condition: 'matches demo intent' },
    })
    assert.equal(declared.ok, true)
    assert.deepEqual(declared.value.activationSource, { kind: sourceKind, condition: 'matches demo intent' })
  }
  // Declaring an activationSource for a plain classification is rejected.
  const stray = normalizeDescriptorSpec({
    skillId: 'demo', owner: 'p', summary: 's',
    activationSource: { kind: 'auto-match', condition: 'c' },
  })
  assert.equal(stray.ok, false)
})

test('normalizeActivationRequest validates ttl, deadline, sourceKind and condition', () => {
  const base = { scope: { kind: 'session', key: 's-1' } }
  assert.equal(normalizeActivationRequest({ ...base, ttl: 0 }).code, 'ACTIVATION_INVALID')
  assert.equal(normalizeActivationRequest({ ...base, ttl: 1.5 }).code, 'ACTIVATION_INVALID')
  assert.equal(normalizeActivationRequest({ ...base, deadline: -1 }).code, 'ACTIVATION_INVALID')
  assert.equal(normalizeActivationRequest({ ...base, sourceKind: 'nope' }).code, 'ACTIVATION_INVALID')
  assert.equal(normalizeActivationRequest({ ...base, reason: '' }).code, 'ACTIVATION_INVALID')
  assert.equal(normalizeActivationRequest({ ...base, sourceKind: 'auto-match' }).code, 'ACTIVATION_INVALID')
  const ok = normalizeActivationRequest({
    ...base, ttl: 5000, deadline: 200, sourceKind: 'auto-match', condition: 'demo-hit', reason: 'why',
  })
  assert.equal(ok.ok, true)
  assert.equal(ok.value.ttl, 5000)
  assert.equal(ok.value.deadline, 200)
  assert.equal(ok.value.sourceKind, 'auto-match')
})

test('normalizeRegisterSkillInput composes descriptor plus optional activation', () => {
  const withoutActivation = normalizeRegisterSkillInput({
    name: 'demo', owner: 'p', summary: 's', content: 'instructions',
  })
  assert.equal(withoutActivation.ok, true)
  assert.equal(withoutActivation.value.descriptor.skillId, 'demo')
  assert.equal(withoutActivation.value.content, 'instructions')
  assert.equal(withoutActivation.value.activation, undefined)

  const withActivation = normalizeRegisterSkillInput({
    name: 'demo', owner: 'p', summary: 's', content: 'instructions',
    activation: { scope: { kind: 'session', key: 's-1' }, ttl: 1000 },
  })
  assert.equal(withActivation.ok, true)
  assert.equal(withActivation.value.activation.ttl, 1000)

  assert.equal(normalizeRegisterSkillInput({ name: 'Bad', owner: 'p', summary: 's', content: 'x' }).ok, false)
  assert.equal(normalizeRegisterSkillInput({ name: 'demo', owner: 'p', summary: '', content: 'x' }).ok, false)
  assert.equal(normalizeRegisterSkillInput({ name: 'demo', owner: 'p', summary: 's', content: '' }).ok, false)
  const badActivation = normalizeRegisterSkillInput({
    name: 'demo', owner: 'p', summary: 's', content: 'x',
    activation: { scope: { kind: 'session', key: 's-1' }, ttl: -3 },
  })
  assert.equal(badActivation.ok, false)
  assert.equal(badActivation.code, 'ACTIVATION_INVALID')
})

test('normalizeAuditQuery clamps and defaults', () => {
  assert.deepEqual(normalizeAuditQuery(undefined).value, { limit: 50 })
  assert.deepEqual(normalizeAuditQuery({}).value, { limit: 50 })
  assert.deepEqual(normalizeAuditQuery({ limit: 1 }).value, { limit: 1 })
  assert.deepEqual(normalizeAuditQuery({ limit: 999 }).value, { limit: 500 })
  assert.equal(normalizeAuditQuery({ limit: 0 }).ok, false)
  assert.equal(normalizeAuditQuery({ limit: 1.5 }).ok, false)
  assert.equal(normalizeAuditQuery('all').ok, false)
})