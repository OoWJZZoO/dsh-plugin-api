import test from 'node:test'
import assert from 'node:assert/strict'
import { createRegisterSkillSugar } from '../lib/register-skill-sugar.js'
import { createSkillActivationEngine } from '../lib/skill-activation-engine.js'

function makeService({ engine, ctx, registryNames = () => new Set() }) {
  const registryContains = async (skillId) => registryNames().has(skillId)
  const service = {
    async activate(skillId, request) {
      const descriptor = engine.descriptorOf(skillId)
      if (descriptor === null) return { ok: false, code: 'SKILL_ENTRY_UNKNOWN', reason: 'no descriptor' }
      if (!(await registryContains(skillId))) {
        return { ok: false, code: 'ACTIVATION_DEGRADED', part: 'registry', reason: 'not present' }
      }
      const sourceKind = request.sourceKind ?? descriptor.sourceKind
      if ((sourceKind === 'auto-match' || sourceKind === 'provider-sourced')
        && request.condition !== descriptor.activationSource?.condition) {
        return { ok: false, code: 'ACTIVATION_INVALID', reason: 'condition mismatch' }
      }
      const degraded = []
      for (const dependency of descriptor.dependencies ?? []) {
        if (!(await registryContains(dependency))) degraded.push({ part: 'dependencies', reason: `missing dependency "${dependency}"` })
      }
      return engine.activate({ skillId, scope: request.scope, sourceKind, reason: request.reason, ttl: request.ttl, degraded })
    },
    deactivate(skillId, generation, scope) {
      const scopeKey = scope === undefined ? undefined : `${scope.kind}:${scope.key}`
      return engine.deactivate(skillId, generation, scopeKey)
    },
    exposure(skillId, generation) {
      return engine.exposure(skillId, generation)
    },
  }
  void ctx
  return service
}

function makeFakeCtx({ registry = new Set(['demo-skill', 'dep-skill']), register } = {}) {
  const registered = []
  const ctx = {
    logger: { warn() {} },
    skills: {
      register(spec) {
        if (register) return register(spec)
        registered.push(spec)
        registry.add(spec.name)
        return () => {
          const index = registered.indexOf(spec)
          if (index >= 0) registered.splice(index, 1)
          registry.delete(spec.name)
        }
      },
    },
  }
  return { ctx, registered, registry }
}

test('sugar: composes official content registration then overlay, in order', async () => {
  const { ctx, registered, registry } = makeFakeCtx()
  const engine = createSkillActivationEngine({})
  const service = makeService({ engine, ctx, registryNames: () => registry })
  const sugar = createRegisterSkillSugar({ ctx, engine, service })
  const result = await sugar.registerSkill({
    name: 'demo-skill', owner: 'plugin-a', summary: 'Demo summary', content: 'instructions',
  })
  assert.equal(result.ok, true)
  assert.equal(result.handle.skillId, 'demo-skill')
  assert.equal(result.handle.owner, 'plugin-a')
  assert.equal(typeof result.handle.generation, 'string')
  // Official registration happened first and carries the expected shape.
  assert.deepEqual(registered, [{ name: 'demo-skill', description: 'Demo summary', content: 'instructions' }])
  // Overlay registered afterwards; describable but not active.
  assert.equal(engine.descriptorOf('demo-skill').summary, 'Demo summary')
  assert.equal(engine.activationState('session:s-1', 'demo-skill').status, 'absent')
})

test('sugar: optional activation applies immediately; without it the skill stays inactive', async () => {
  const { ctx, registry } = makeFakeCtx()
  const engine = createSkillActivationEngine({})
  const service = makeService({ engine, ctx, registryNames: () => registry })
  const sugar = createRegisterSkillSugar({ ctx, engine, service })
  const withActivation = await sugar.registerSkill({
    name: 'demo-skill', owner: 'plugin-a', summary: 'Demo summary', content: 'instructions',
    activation: { scope: { kind: 'session', key: 's-1' }, ttl: 1000 },
  })
  assert.equal(withActivation.ok, true)
  assert.equal(withActivation.activation.ok, true)
  assert.equal(engine.activationState('session:s-1', 'demo-skill').status, 'active')
})

test('sugar: failed activation rolls back both halves, leaving nothing visible', async () => {
  const { ctx, registered, registry } = makeFakeCtx()
  const engine = createSkillActivationEngine({})
  const service = makeService({ engine, ctx, registryNames: () => registry })
  const sugar = createRegisterSkillSugar({ ctx, engine, service })
  const result = await sugar.registerSkill({
    name: 'demo-skill', owner: 'plugin-a', summary: 'Demo summary', content: 'instructions',
    activation: { scope: { kind: 'session', key: 's-1' }, sourceKind: 'auto-match', condition: 'declared-condition' },
  })
  // The descriptor declares no auto-match condition, so the activation is
  // rejected with the typed invalid result...
  assert.equal(result.ok, false)
  assert.equal(result.code, 'ACTIVATION_INVALID')
  // ...and both halves were rolled back.
  assert.equal(engine.descriptorOf('demo-skill'), null)
  assert.equal(registered.length, 0)
  assert.equal(registry.has('demo-skill'), false)
})

test('sugar: overlay conflict rolls back the content half', async () => {
  const { ctx, registered, registry } = makeFakeCtx()
  const engine = createSkillActivationEngine({})
  engine.registerDescriptor({ skillId: 'demo-skill', owner: 'plugin-other', summary: 'Other summary' })
  const service = makeService({ engine, ctx, registryNames: () => registry })
  const sugar = createRegisterSkillSugar({ ctx, engine, service })
  const result = await sugar.registerSkill({
    name: 'demo-skill', owner: 'plugin-a', summary: 'Demo summary', content: 'instructions',
  })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'SKILL_ENTRY_CONFLICT')
  assert.equal(registered.length, 0)
  assert.equal(registry.has('demo-skill'), false)
  assert.equal(engine.descriptorOf('demo-skill').owner, 'plugin-other')
})

test('sugar: official first-wins no-op disposer passes through without fabricated ownership', async () => {
  const { ctx, registry } = makeFakeCtx({
    register() {
      return () => {} // official duplicate warning path
    },
  })
  const engine = createSkillActivationEngine({})
  const service = makeService({ engine, ctx, registryNames: () => registry })
  const sugar = createRegisterSkillSugar({ ctx, engine, service })
  const result = await sugar.registerSkill({
    name: 'demo-skill', owner: 'plugin-a', summary: 'Demo summary', content: 'instructions',
  })
  assert.equal(result.ok, true)
  // Disposing the handle must not remove the (foreign) winner.
  const dispose = result.handle.dispose()
  assert.equal(dispose.ok, true)
  assert.equal(registry.has('demo-skill'), true)
  assert.equal(engine.descriptorOf('demo-skill'), null)
})

test('sugar: official registration errors surface as typed registration invalid', async () => {
  const { ctx, registry } = makeFakeCtx({
    register() {
      throw new Error('invalid skill name "Bad_Name"')
    },
  })
  const engine = createSkillActivationEngine({})
  const service = makeService({ engine, ctx, registryNames: () => registry })
  const sugar = createRegisterSkillSugar({ ctx, engine, service })
  const result = await sugar.registerSkill({
    name: 'demo-skill', owner: 'plugin-a', summary: 'Demo summary', content: 'instructions',
  })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'SKILL_REGISTRATION_INVALID')
  assert.match(result.reason, /invalid skill name/)
})

test('sugar: dispose is idempotent and identity-bound; handle methods forward', async () => {
  const { ctx, registry } = makeFakeCtx()
  const engine = createSkillActivationEngine({})
  const service = makeService({ engine, ctx, registryNames: () => registry })
  const sugar = createRegisterSkillSugar({ ctx, engine, service })
  const result = await sugar.registerSkill({
    name: 'demo-skill', owner: 'plugin-a', summary: 'Demo summary', content: 'instructions',
    activation: { scope: { kind: 'session', key: 's-1' } },
  })
  const { handle } = result
  const firstDispose = handle.dispose()
  assert.equal(firstDispose.ok, true)
  assert.equal(firstDispose.overlayDisposed, true)
  const secondDispose = handle.dispose()
  assert.equal(secondDispose.alreadyDisposed, true)
  assert.equal(engine.descriptorOf('demo-skill'), null)
  assert.equal(registry.has('demo-skill'), false)
  // Handle methods forward to the service with typed results.
  const reRegistered = await sugar.registerSkill({
    name: 'demo-skill', owner: 'plugin-a', summary: 'Demo summary', content: 'instructions',
  })
  const activation = await reRegistered.handle.activate({ scope: { kind: 'session', key: 's-1' } })
  assert.equal(activation.ok, true)
  const exposure = reRegistered.handle.exposure(activation.generation)
  assert.equal(exposure.ok, true)
  assert.equal(exposure.exposure.scope.key, 's-1')
  const deactivated = reRegistered.handle.deactivate(activation.generation)
  assert.equal(deactivated.ok, true)
})

test('sugar: active skills resolve through the official registry path; the gate denies inactive ones', async () => {
  const { ctx, registered, registry } = makeFakeCtx()
  const engine = createSkillActivationEngine({})
  const service = makeService({ engine, ctx, registryNames: () => registry })
  const sugar = createRegisterSkillSugar({ ctx, engine, service })
  const result = await sugar.registerSkill({
    name: 'demo-skill', owner: 'plugin-a', summary: 'Demo summary', content: 'instructions',
    activation: { scope: { kind: 'session', key: 's-1' } },
  })
  assert.equal(result.ok, true)
  // The official registry entry created by this composition resolves content.
  assert.deepEqual(registered.map((entry) => ({ name: entry.name, description: entry.description, content: entry.content })), [
    { name: 'demo-skill', description: 'Demo summary', content: 'instructions' },
  ])
  // Inactive after disposal: the load gate denies (covered by the fork), and
  // exposure reports the superseded state through the service.
  result.handle.dispose()
  const exposure = service.exposure('demo-skill', result.handle.generation)
  assert.equal(exposure.ok, false)
  assert.equal(exposure.code, 'SKILL_ENTRY_DISPOSED')
})