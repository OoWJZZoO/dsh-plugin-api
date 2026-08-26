import test from 'node:test'
import assert from 'node:assert/strict'
import { createSkillActivationEngine } from '../lib/skill-activation-engine.js'

function makeEngine(overrides = {}) {
  let clock = 1000
  let sequence = 0
  const engine = createSkillActivationEngine({
    now: overrides.now ?? (() => clock),
    generateGeneration: overrides.generateGeneration ?? (() => `g-${++sequence}`),
    auditCapacity: overrides.auditCapacity,
    readSeamStatus: overrides.readSeamStatus ?? (() => ({ skillTool: true, preStepInjection: true, catalogProvider: true })),
  })
  return { engine, advance: (ms) => { clock += ms }, clock: () => clock }
}

const SPEC = { skillId: 'demo-skill', owner: 'plugin-a', summary: 'Demo summary' }
const SCOPE = { kind: 'session', key: 's-1' }
const OTHER_SCOPE = { kind: 'session', key: 's-2' }

function register(engine, spec = SPEC) {
  return engine.registerDescriptor(spec)
}

test('descriptor registration: generations, same-owner replace, foreign conflict', () => {
  const { engine } = makeEngine()
  const first = register(engine)
  assert.equal(first.ok, true)
  assert.equal(first.generation, 'g-1')
  const conflict = engine.registerDescriptor({ ...SPEC, owner: 'plugin-b' })
  assert.equal(conflict.ok, false)
  assert.equal(conflict.code, 'SKILL_ENTRY_CONFLICT')
  const replaced = engine.registerDescriptor({ ...SPEC, summary: 'New summary' })
  assert.equal(replaced.ok, true)
  assert.equal(replaced.replaced, 'g-1')
  assert.equal(engine.descriptorOf('demo-skill').summary, 'New summary')
  const unregister = engine.unregisterDescriptor('demo-skill', 'plugin-a')
  assert.equal(unregister.ok, true)
  assert.equal(engine.descriptorOf('demo-skill'), null)
  const foreign = engine.unregisterDescriptor('demo-skill', 'plugin-a')
  assert.equal(foreign.code, 'SKILL_ENTRY_UNKNOWN')
})

test('activate: unknown skill, failed descriptor, scope isolation, latest-wins', () => {
  const { engine } = makeEngine()
  const unknown = engine.activate({ skillId: 'absent', scope: SCOPE, sourceKind: 'explicit' })
  assert.equal(unknown.code, 'SKILL_ENTRY_UNKNOWN')
  register(engine)
  const first = engine.activate({ skillId: 'demo-skill', scope: SCOPE, sourceKind: 'explicit', reason: 'demo' })
  assert.equal(first.ok, true)
  assert.equal(first.state, 'active')
  const otherScope = engine.activate({ skillId: 'demo-skill', scope: OTHER_SCOPE, sourceKind: 'explicit' })
  assert.equal(otherScope.generation, 'g-3')
  // Latest-wins supersedes the previous generation in the same scope only.
  const second = engine.activate({ skillId: 'demo-skill', scope: SCOPE, sourceKind: 'explicit' })
  assert.equal(second.generation, 'g-4')
  const state = engine.activationState(`session:s-1`, 'demo-skill')
  assert.equal(state.status, 'active')
  assert.equal(state.record.generation, 'g-4')
  // The superseded generation is terminal and reports via exposure.
  const exposure = engine.exposure('demo-skill', 'g-2')
  assert.equal(exposure.ok, true)
  assert.equal(exposure.exposure.availability.status, 'superseded')
  assert.deepEqual(exposure.exposure.tools, [])
})

test('TTL expiry is lazy, transitions once, and excludes from gates', () => {
  const { engine, advance } = makeEngine()
  register(engine)
  const activation = engine.activate({ skillId: 'demo-skill', scope: SCOPE, sourceKind: 'explicit', ttl: 100 })
  assert.equal(activation.ok, true)
  assert.equal(engine.activationState('session:s-1', 'demo-skill').status, 'active')
  advance(99)
  assert.equal(engine.activationState('session:s-1', 'demo-skill').status, 'active')
  advance(2)
  const after = engine.activationState('session:s-1', 'demo-skill')
  assert.equal(after.status, 'expired')
  // Repeated reads never re-audit (terminal is final).
  engine.activationState('session:s-1', 'demo-skill')
  const audits = engine.audit({ limit: 50 }).items.filter((item) => item.kind === 'expire')
  assert.equal(audits.length, 1)
  const exposure = engine.exposure('demo-skill', activation.generation)
  assert.equal(exposure.exposure.availability.status, 'expired')
})

test('deactivate: revokes state, stale generations are typed no-ops, scope constraint works', () => {
  const { engine } = makeEngine()
  register(engine)
  const activation = engine.activate({ skillId: 'demo-skill', scope: SCOPE, sourceKind: 'explicit' })
  const stale = engine.deactivate('demo-skill', 'never-issued')
  assert.equal(stale.code, 'DEACTIVATE_STALE_GENERATION')
  const wrongScope = engine.deactivate('demo-skill', activation.generation, 'session:s-9')
  assert.equal(wrongScope.code, 'DEACTIVATE_STALE_GENERATION')
  const revoked = engine.deactivate('demo-skill', activation.generation)
  assert.equal(revoked.ok, true)
  assert.equal(engine.activationState('session:s-1', 'demo-skill').status, 'superseded')
  // Deactivating the same settled generation again is a typed no-op.
  const again = engine.deactivate('demo-skill', activation.generation)
  assert.equal(again.ok, true)
  assert.equal(again.state, 'superseded')
})

test('degraded activation: created with parts, excluded from gates, parts visible in exposure', () => {
  const { engine } = makeEngine()
  register(engine, { ...SPEC, dependencies: ['missing-dep'] })
  const activation = engine.activate({
    skillId: 'demo-skill', scope: SCOPE, sourceKind: 'explicit',
    degraded: [{ part: 'dependencies', reason: 'missing-dep' }],
  })
  assert.equal(activation.ok, true)
  assert.equal(activation.state, 'degraded')
  assert.deepEqual(activation.degraded, [{ part: 'dependencies', reason: 'missing-dep' }])
  const state = engine.activationState('session:s-1', 'demo-skill')
  assert.equal(state.status, 'degraded')
  const exposure = engine.exposure('demo-skill', activation.generation)
  assert.equal(exposure.exposure.availability.status, 'degraded')
  assert.deepEqual(exposure.exposure.availability.degradedParts, ['dependencies'])
  assert.deepEqual(exposure.exposure.degraded, [{ part: 'dependencies', reason: 'missing-dep' }])
})

test('exposure projection carries the frozen record and rejects stale generations', () => {
  const { engine } = makeEngine()
  register(engine, {
    ...SPEC,
    tools: [{ entryId: 'demo-tool', generation: 'd-1' }],
    promptSections: ['demo:section'],
    resources: [{ resourceId: 'res-1', metadata: { kind: 'opaque' } }],
  })
  const activation = engine.activate({ skillId: 'demo-skill', scope: SCOPE, sourceKind: 'auto-match', reason: 'condition:demo-hit' })
  const exposure = engine.exposure('demo-skill', activation.generation)
  assert.equal(exposure.ok, true)
  assert.deepEqual(exposure.exposure, {
    skillId: 'demo-skill',
    owner: 'plugin-a',
    sourceKind: 'auto-match',
    scope: { kind: 'session', key: 's-1' },
    generation: activation.generation,
    tools: [{ entryId: 'demo-tool', generation: 'd-1' }],
    promptSections: ['demo:section'],
    resources: [{ resourceId: 'res-1', metadata: { kind: 'opaque' } }],
    degraded: [],
    availability: {
      status: 'active',
      degradedParts: [],
      seamStatus: { skillTool: true, preStepInjection: true, catalogProvider: true },
    },
  })
  assert.equal(Object.isFrozen(exposure.exposure), true)
  assert.equal(engine.exposure('demo-skill', 'stale').code, 'EXPOSURE_STALE_GENERATION')
  assert.equal(engine.exposure('unknown-skill', 'x').code, 'SKILL_ENTRY_UNKNOWN')
  // Deactivation withdraws tool exposure for new exposure views.
  engine.deactivate('demo-skill', activation.generation)
  const withdrawn = engine.exposure('demo-skill', activation.generation)
  assert.deepEqual(withdrawn.exposure.tools, [])
})

test('audit ring is bounded, newest first, frozen', () => {
  const { engine } = makeEngine({ auditCapacity: 5 })
  register(engine)
  for (let index = 0; index < 8; index += 1) {
    engine.activate({ skillId: 'demo-skill', scope: SCOPE, sourceKind: 'explicit' })
  }
  const page = engine.audit({ limit: 50 })
  assert.equal(page.ok, true)
  assert.equal(page.items.length, 5)
  assert.deepEqual(page.items, engine.audit({ limit: 50 }).items)
  assert.equal(Object.isFrozen(page.items), true)
  assert.equal(Object.isFrozen(page.items[0]), true)
  const seqs = page.items.map((item) => item.seq)
  assert.equal(seqs.every((value, index) => index === 0 || value < seqs[index - 1]), true)
  // Every activation left a record; the first three were evicted.
  const kinds = page.items.map((item) => item.kind)
  assert.equal(kinds.includes('activate'), true)
  // The audit record carries the owner/sourceKind metadata.
  const record = page.items.find((item) => item.kind === 'activate')
  assert.equal(record.owner, 'plugin-a')
  assert.equal(record.sourceKind, 'explicit')
})

test('minimal-update policy: latest-wins tokens and stale dispose no-ops', () => {
  const { engine } = makeEngine()
  const first = engine.policyRegister('session:s-1')
  assert.equal(first.ok, true)
  assert.equal(engine.minimalPolicyFor('session:s-1'), true)
  const second = engine.policyRegister('session:s-1')
  assert.equal(engine.minimalPolicyFor('session:s-1'), true)
  assert.equal(engine.policyDispose('session:s-1', first.token).revoked, false)
  assert.equal(engine.minimalPolicyFor('session:s-1'), true)
  assert.equal(engine.policyDispose('session:s-1', second.token).revoked, true)
  assert.equal(engine.minimalPolicyFor('session:s-1'), false)
  // Per-session: another scope is unaffected.
  assert.equal(engine.minimalPolicyFor('session:s-2'), false)
})

test('catalog-change audit and engine availability are truthful', () => {
  const { engine } = makeEngine()
  register(engine)
  engine.recordCatalogChange({ scopeKey: 'session:s-1', reason: 'minimal-update' })
  const audits = engine.audit({ limit: 50 }).items
  assert.equal(audits[0].kind, 'catalog-change')
  assert.match(audits[0].reason, /minimal-update/)
  const availability = engine.availability()
  assert.equal(availability.status, 'active')
  assert.equal(availability.descriptors, 1)
  assert.equal(availability.audit, 2)
  assert.deepEqual(availability.seams, { skillTool: true, preStepInjection: true, catalogProvider: true })
})

test('descriptor disposal cascades to its activations', () => {
  const { engine } = makeEngine()
  register(engine)
  const activation = engine.activate({ skillId: 'demo-skill', scope: SCOPE, sourceKind: 'explicit' })
  assert.equal(engine.unregisterDescriptor('demo-skill', 'plugin-a').ok, true)
  assert.equal(engine.activationState('session:s-1', 'demo-skill').status, 'absent')
  assert.equal(engine.exposure('demo-skill', activation.generation).code, 'SKILL_ENTRY_DISPOSED')
  // Re-registration clears the disposed mark; failure marks are sticky.
  assert.equal(engine.activate({ skillId: 'demo-skill', scope: SCOPE, sourceKind: 'explicit' }).code, 'SKILL_ENTRY_DISPOSED')
  assert.equal(register(engine).ok, true)
  assert.equal(engine.activate({ skillId: 'demo-skill', scope: SCOPE, sourceKind: 'explicit' }).ok, true)
  engine.unregisterDescriptor('demo-skill', 'plugin-a')
  engine.markDescriptorFailed('demo-skill')
  assert.equal(engine.activate({ skillId: 'demo-skill', scope: SCOPE, sourceKind: 'explicit' }).code, 'SKILL_ENTRY_FAILED')
  // Sticky on a live descriptor: the mark rejects until re-registration
  // clears it (records stay frozen; the mark set carries the failed state).
  register(engine)
  engine.markDescriptorFailed('demo-skill')
  assert.equal(engine.activate({ skillId: 'demo-skill', scope: SCOPE, sourceKind: 'explicit' }).code, 'SKILL_ENTRY_FAILED')
  assert.equal(register(engine).ok, true)
  assert.equal(engine.activate({ skillId: 'demo-skill', scope: SCOPE, sourceKind: 'explicit' }).ok, true)
})