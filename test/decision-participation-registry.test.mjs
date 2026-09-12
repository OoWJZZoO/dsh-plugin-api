import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createDecisionRegistry,
  createTurnStoppingChain,
  validateDecisionSpec,
  classifyAgentPreStepDecision,
  classifyAgentRequestDecision,
  classifyAgentRequestErrorDecision,
  classifyTurnStoppingDecision,
  classifyAssemblyDecision,
  classifyExecutionAroundDecision,
  classifyPostExecuteDecision,
  classifyFsIntentDecision,
  fsIntentDenialErrorOf,
  classifyCompactionRequestDecision,
  classifySessionTitleCandidateDecision,
  DecisionOwnerConflictError,
  FsIntentDeniedError,
} from '../lib/decision-participation.js'
import { PluginApiError } from '../lib/errors.js'

function createLogger(warns = []) {
  return { warn: (message) => warns.push(String(message)) }
}

function createRegistry(overrides = {}) {
  const installed = []
  const warns = []
  const registry = createDecisionRegistry({
    label: 'test-point',
    classify: overrides.classify ?? (() => 'undecided'),
    install: overrides.install ?? ((entry) => {
      installed.push(entry)
      return () => true
    }),
    resolveOwnerId: overrides.resolveOwnerId ?? (() => 'owner-a'),
    logger: overrides.logger ?? createLogger(warns),
  })
  return { registry, installed, warns }
}

test('registry: owner is derived from the injected resolver and falls back to the root token', () => {
  const { registry } = createRegistry({ resolveOwnerId: () => undefined })
  const handle = registry.register({}, { id: 'p', decide: () => undefined })
  assert.equal(handle.ownerId, 'root')
})

test('registry: same owner same id follows latest-wins and the old handle becomes a stale no-op', () => {
  let uninstallCalls = 0
  const { registry } = createRegistry({
    install: () => () => {
      uninstallCalls += 1
      return true
    },
  })
  const first = registry.register({}, { id: 'p', decide: () => 'first' })
  const second = registry.register({}, { id: 'p', decide: () => 'second', priority: 'high' })
  assert.notEqual(first.generation, second.generation)
  assert.equal(first.dispose(), false, 'the old handle is a stale no-op')
  assert.equal(registry.entries().length, 1)
  assert.equal(registry.entries()[0].decide(), 'second')
  assert.equal(registry.entries()[0].priority, 'high')
  assert.equal(uninstallCalls, 1, 'the replaced entry was uninstalled exactly once')
})

test('registry: cross-owner same id raises a typed owner-conflict error', () => {
  const { registry } = createRegistry()
  registry.register({}, { id: 'p', decide: () => undefined })
  let ownerTurn = 0
  const rotating = createDecisionRegistry({
    label: 'rotating',
    classify: () => 'undecided',
    install: () => () => true,
    resolveOwnerId: () => (ownerTurn++ === 0 ? 'owner-a' : 'owner-b'),
  })
  rotating.register({}, { id: 'p', decide: () => undefined })
  assert.throws(
    () => rotating.register({}, { id: 'p', decide: () => undefined }),
    (error) => error instanceof DecisionOwnerConflictError,
  )
  assert.ok(registry)
})

test('registry: disposal is idempotent and identity-bound', () => {
  const { registry } = createRegistry()
  const first = registry.register({}, { id: 'p', decide: () => undefined })
  const second = registry.register({}, { id: 'p', decide: () => undefined })
  assert.equal(first.dispose(), false, 'a replaced handle cannot revoke the newer generation')
  assert.equal(second.dispose(), true)
  assert.equal(second.dispose(), false, 'disposal is idempotent')
  assert.equal(registry.entries().length, 0)
})

test('registry: owner unload isolation removes only that owner entries (other owners keep participating)', () => {
  let currentOwner = 'owner-a'
  const { registry } = createRegistry({ resolveOwnerId: () => currentOwner })
  const handleA = registry.register({}, { id: 'a-entry', decide: () => 'from-a' })
  currentOwner = 'owner-b'
  registry.register({}, { id: 'b-entry', decide: () => 'from-b' })
  handleA.dispose()
  const remaining = registry.entries()
  assert.equal(remaining.length, 1)
  assert.equal(remaining[0].decide(), 'from-b')
})

test('registry: install failure leaves the registry and any previous entry untouched', () => {
  let shouldFail = false
  const { registry } = createRegistry({
    install: (entry) => {
      if (shouldFail) throw new Error('install exploded')
      return () => true
    },
  })
  const first = registry.register({}, { id: 'p', decide: () => 'first' })
  shouldFail = true
  assert.throws(() => registry.register({}, { id: 'p', decide: () => 'second' }), PluginApiError)
  assert.equal(registry.entries().length, 1)
  assert.equal(registry.entries()[0].decide(), 'first')
  assert.equal(first.dispose(), true, 'the previous handle still governs its own entry')
})

test('registry: spec validation rejects malformed registrations with typed errors', () => {
  const { registry } = createRegistry()
  assert.throws(() => registry.register({}, { id: '', decide: () => undefined }), /id must be a non-empty string/)
  assert.throws(() => registry.register({}, { id: 'p', decide: 'nope' }), /decide must be a function/)
  assert.throws(() => registry.register({}, { id: 'p', decide: () => undefined, priority: 'monitor' }), /unsupported decision participation priority/)
})

test('classifiers: agent/pre-step accepts reject and enter, rejects anything else', () => {
  assert.equal(classifyAgentPreStepDecision({ kind: 'reject' }), 'decision')
  assert.equal(classifyAgentPreStepDecision({ kind: 'reject', reason: 'why' }), 'decision')
  assert.equal(classifyAgentPreStepDecision({ kind: 'reject', reason: 42 }), 'malformed')
  assert.equal(classifyAgentPreStepDecision({ kind: 'enter', messages: [] }), 'decision')
  assert.equal(classifyAgentPreStepDecision({ kind: 'enter' }), 'malformed')
  assert.equal(classifyAgentPreStepDecision({ kind: 'enter', messages: 'nope' }), 'malformed')
  assert.equal(classifyAgentPreStepDecision({}), 'malformed')
})

test('classifiers: agent/request requires provider and model config objects', () => {
  assert.equal(classifyAgentRequestDecision({ provider: 'p', model: 'm' }), 'decision')
  assert.equal(classifyAgentRequestDecision({ provider: 'p', model: 'm', reasoningEffort: 'high' }), 'decision')
  assert.equal(classifyAgentRequestDecision({ provider: '', model: 'm' }), 'malformed')
  assert.equal(classifyAgentRequestDecision({ model: 'm' }), 'malformed')
  assert.equal(classifyAgentRequestDecision('config'), 'malformed')
})

test('classifiers: agent/request-error accepts only the retry decision', () => {
  assert.equal(classifyAgentRequestErrorDecision({ kind: 'retry' }), 'decision')
  assert.equal(classifyAgentRequestErrorDecision({ kind: 'give-up' }), 'malformed')
  assert.equal(classifyAgentRequestErrorDecision('retry'), 'malformed')
})

test('classifiers: turn-stopping accepts explicit proceed and valid continue decisions', () => {
  assert.equal(classifyTurnStoppingDecision({ kind: 'proceed' }), 'undecided')
  assert.equal(classifyTurnStoppingDecision({ kind: 'continue', message: { role: 'user', content: [{ type: 'text', text: 'go on' }] } }), 'decision')
  assert.equal(classifyTurnStoppingDecision({ kind: 'continue' }), 'malformed')
  assert.equal(classifyTurnStoppingDecision({ kind: 'continue', message: Promise.resolve({}) }), 'malformed')
  assert.equal(classifyTurnStoppingDecision({ kind: 'stop' }), 'malformed')
})

test('classifiers: assembly requires a rewritten assembly record with sections', () => {
  assert.equal(classifyAssemblyDecision({ sections: [], contexts: [], tools: [], variables: {} }), 'decision')
  assert.equal(classifyAssemblyDecision({ sections: 'nope' }), 'malformed')
  assert.equal(classifyAssemblyDecision(null), 'malformed')
})

test('classifiers: around execution treats any defined return as the chain result', () => {
  assert.equal(classifyExecutionAroundDecision({ ok: true }), 'decision')
  assert.equal(classifyExecutionAroundDecision('wrapped'), 'decision')
})

test('classifiers: post-execute follows the official PostToolDecision algebra', () => {
  assert.equal(classifyPostExecuteDecision({ kind: 'accept' }), 'decision')
  assert.equal(classifyPostExecuteDecision({ kind: 'accept', content: [{ type: 'text', text: 'x' }] }), 'decision')
  assert.equal(classifyPostExecuteDecision({ kind: 'accept', value: 7 }), 'decision')
  assert.equal(classifyPostExecuteDecision({ kind: 'accept', content: [{ type: 'text', text: 'x' }], value: 7 }), 'malformed', 'content and value are mutually exclusive (official TypeError path)')
  assert.equal(classifyPostExecuteDecision({ kind: 'accept', additionalContexts: [] }), 'decision')
  assert.equal(classifyPostExecuteDecision({ kind: 'accept', additionalContexts: 'nope' }), 'malformed')
  assert.equal(classifyPostExecuteDecision({ kind: 'block', feedback: [{ type: 'text', text: 'no' }] }), 'decision')
  assert.equal(classifyPostExecuteDecision({ kind: 'block' }), 'malformed')
  assert.equal(classifyPostExecuteDecision({ kind: 'other' }), 'malformed')
})

test('classifiers: fs intent accepts deny decisions and builds typed denial errors', () => {
  assert.equal(classifyFsIntentDecision({ kind: 'deny' }), 'decision')
  assert.equal(classifyFsIntentDecision({ kind: 'deny', reason: 'captured' }), 'decision')
  assert.equal(classifyFsIntentDecision({ kind: 'deny', reason: 5 }), 'malformed')
  assert.equal(classifyFsIntentDecision({ kind: 'allow' }), 'malformed')
  const error = fsIntentDenialErrorOf({ kind: 'deny', reason: 'captured first' })
  assert.ok(error instanceof FsIntentDeniedError)
  assert.match(error.message, /captured first/)
})

test('classifiers: compaction/request uses the owning producer flat replace-range contract', () => {
  assert.equal(classifyCompactionRequestDecision({ kind: 'reject' }), 'decision')
  assert.equal(classifyCompactionRequestDecision({ kind: 'reject', reason: 'busy' }), 'decision')
  assert.equal(classifyCompactionRequestDecision({ kind: 'replace-range', start: 3, end: 9 }), 'decision')
  assert.equal(classifyCompactionRequestDecision({ kind: 'replace-range', start: 9, end: 3 }), 'malformed', 'start must not exceed end')
  assert.equal(classifyCompactionRequestDecision({ kind: 'replace-range', range: { start: 3, end: 9 } }), 'malformed', 'the nested range shape is malformed per the producer contract')
  assert.equal(classifyCompactionRequestDecision({ kind: 'replace-range', start: 1.5, end: 9 }), 'malformed')
})

test('classifiers: session-title/candidate accepts exclude and replace with optional reason', () => {
  assert.equal(classifySessionTitleCandidateDecision({ kind: 'exclude' }), 'decision')
  assert.equal(classifySessionTitleCandidateDecision({ kind: 'exclude', reason: 'off-topic' }), 'decision')
  assert.equal(classifySessionTitleCandidateDecision({ kind: 'replace', message: { seq: 4 } }), 'decision')
  assert.equal(classifySessionTitleCandidateDecision({ kind: 'replace', message: { seq: 4 }, reason: 'better' }), 'decision', 'replace may carry an optional reason per the producer contract')
  assert.equal(classifySessionTitleCandidateDecision({ kind: 'replace', message: { seq: -1 } }), 'malformed')
  assert.equal(classifySessionTitleCandidateDecision({ kind: 'replace', message: {} }), 'malformed')
  assert.equal(classifySessionTitleCandidateDecision(Promise.resolve({ kind: 'exclude' })), 'malformed', 'thenable decisions are malformed (family precedent)')
})

test('validateDecisionSpec: normalizes priority default and preserves scope', () => {
  const normalized = validateDecisionSpec({ id: 'p', decide: () => undefined })
  assert.deepEqual(normalized, { id: 'p', priority: 'normal', decide: normalized.decide })
  const scoped = validateDecisionSpec({ id: 'p', decide: () => undefined, scope: { id: 'agent' } })
  assert.deepEqual(scoped.scope, { id: 'agent' })
})

test('turn-stopping chain: last explicit continue wins and no-decision slots never overwrite', async () => {
  const { registry } = createRegistry({
    classify: (value) => {
      if (value?.kind === 'proceed') return 'undecided'
      if (value?.kind === 'continue') return 'decision'
      return 'malformed'
    },
    install: () => () => true,
  })
  registry.register({}, { id: 'first', decide: () => ({ kind: 'continue', message: { seq: 1 } }) })
  registry.register({}, { id: 'second', decide: () => undefined })
  registry.register({}, { id: 'third', decide: () => ({ kind: 'proceed' }) })
  registry.register({}, { id: 'fourth', decide: () => ({ kind: 'continue', message: { seq: 4 } }) })
  const chain = createTurnStoppingChain({ registry, logger: createLogger() })
  const decision = await chain.invoke({ agent: { id: 'a' }, turn: 3, signal: null })
  assert.deepEqual(decision, { kind: 'continue', message: { seq: 4 } })
})

test('turn-stopping chain: no participants, all no-decisions, or malformed decisions converge to official-equivalent null', async () => {
  const warns = []
  const { registry } = createRegistry({
    classify: classifyTurnStoppingDecision,
    install: () => () => true,
    logger: createLogger(warns),
  })
  registry.register({}, { id: 'bad', decide: () => ({ kind: 'continue' }) })
  const chain = createTurnStoppingChain({ registry, logger: createLogger(warns) })
  assert.equal(await chain.invoke({ agent: { id: 'a' }, turn: 1, signal: null }), null)
  assert.equal(warns.some((message) => message.includes('malformed')), true, 'a malformed decision leaves a bounded diagnostic')
})

test('turn-stopping chain: failing participants are contained and the chain still converges', async () => {
  const warns = []
  const { registry } = createRegistry({
    classify: (value) => (value?.kind === 'continue' ? 'decision' : 'malformed'),
    install: () => () => true,
    logger: createLogger(warns),
  })
  registry.register({}, { id: 'throws', decide: () => { throw new Error('participant bug') } })
  registry.register({}, { id: 'rejects', decide: () => Promise.reject(new Error('participant rejection')) })
  registry.register({}, { id: 'good', decide: () => ({ kind: 'continue', message: { seq: 2 } }) })
  const chain = createTurnStoppingChain({ registry, logger: createLogger(warns) })
  const decision = await chain.invoke({ agent: { id: 'a' }, turn: 2, signal: null })
  assert.deepEqual(decision, { kind: 'continue', message: { seq: 2 } })
  assert.equal(warns.filter((message) => message.includes('contained')).length, 2)
})

test('turn-stopping chain: scope-bound participants are skipped for non-matching agents', async () => {
  const agentA = { id: 'a' }
  const agentB = { id: 'b' }
  const { registry } = createRegistry({
    classify: (value) => (value?.kind === 'continue' ? 'decision' : 'malformed'),
    install: () => () => true,
  })
  registry.register({}, { id: 'bound', decide: (payload) => ({ kind: 'continue', message: { seq: payload.turn } }), scope: agentA })
  const chain = createTurnStoppingChain({ registry })
  assert.equal(await chain.invoke({ agent: agentB, turn: 1, signal: null }), null)
  const decision = await chain.invoke({ agent: agentA, turn: 7, signal: null })
  assert.deepEqual(decision, { kind: 'continue', message: { seq: 7 } })
})

test('turn-stopping chain: the payload is frozen before participants see it', async () => {
  const { registry } = createRegistry({ install: () => () => true })
  let observed = null
  registry.register({}, { id: 'observer', decide: (payload) => { observed = payload } })
  const chain = createTurnStoppingChain({ registry })
  await chain.invoke({ agent: { id: 'a' }, turn: 1, signal: null })
  assert.equal(Object.isFrozen(observed), true)
})
