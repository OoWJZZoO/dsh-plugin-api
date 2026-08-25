import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildAvailability,
  canTransition,
  cloneBoundedPublic,
  normalizeCapability,
  normalizeEvidenceSide,
  normalizeFencingEvidence,
  normalizeIntent,
  normalizeMutationRecord,
  normalizeMutationSource,
  normalizeOwnerId,
  normalizeProvenance,
  normalizeResource,
  normalizeResourceSet,
  normalizeSideEffectClass,
  normalizeTransactionId,
  normalizeWorkspace,
  redactMutationRecord,
  redactTransactionRecord,
  resourceKey,
  WS_TX_SCOPES,
  WS_TX_SIDE_EFFECTS,
  WS_TX_STATES,
  WS_TX_TERMINAL,
} from '../lib/workspace-transaction-normalize.js'
import { deepFreeze } from '../lib/deep-freeze.js'

const workspace = { scope: 'workspace', key: 'repo-a' }

test('normalizeTransactionId accepts bounded ids and rejects empty/oversized values', () => {
  assert.equal(normalizeTransactionId('tx-1').ok, true)
  assert.equal(normalizeTransactionId('').ok, false)
  assert.equal(normalizeTransactionId(undefined).ok, false)
  assert.equal(normalizeTransactionId('x'.repeat(500)).value.length, 120)
})

test('normalizeWorkspace accepts exactly one valid scope with canonical key; label is display-only', () => {
  const ok = normalizeWorkspace({ ...workspace, label: 'Main repo' })
  assert.equal(ok.ok, true)
  assert.equal(ok.value.scope, 'workspace')
  assert.equal(ok.value.label, 'Main repo')
  assert.equal(normalizeWorkspace({ scope: 'planet', key: 'x' }).ok, false)
  assert.equal(normalizeWorkspace({ scope: 'session' }).ok, false)
  assert.equal(normalizeWorkspace(null).ok, false)
})

test('scope + canonical key is the resource identity; a display label never participates in equality', () => {
  const a = normalizeResource({ kind: 'file', key: 'a.txt', scope: 'workspace', label: 'A' }).value
  const b = normalizeResource({ kind: 'file', key: 'a.txt', scope: 'workspace', label: 'B' }).value
  assert.equal(resourceKey(a), resourceKey(b))
  const c = normalizeResource({ kind: 'file', key: 'a.txt', scope: 'session' }).value
  assert.notEqual(resourceKey(a), resourceKey(c))
})

test('normalizeOwnerId and normalizeIntent bounds', () => {
  assert.equal(normalizeOwnerId('owner-1').ok, true)
  assert.equal(normalizeOwnerId('').ok, false)
  assert.equal(normalizeOwnerId(undefined).ok, false)
  assert.equal(normalizeIntent({ kind: 'edit', summary: 'fix tests' }).ok, true)
  assert.equal(normalizeIntent({ kind: 'edit' }).ok, false)
  assert.equal(normalizeIntent({ summary: 'no kind' }).ok, false)
})

test('normalizeResourceSet requires non-empty, bounded, duplicate-free identities', () => {
  const file = { kind: 'file', key: 'a.txt', scope: 'workspace' }
  const cfg = { kind: 'config', key: 'dsh.json', scope: 'workspace' }
  const ok = normalizeResourceSet([file, cfg])
  assert.equal(ok.ok, true)
  assert.equal(ok.value.length, 2)
  assert.equal(normalizeResourceSet([]).ok, false)
  assert.equal(normalizeResourceSet(null).ok, false)
  assert.equal(normalizeResourceSet([file, file]).ok, false)
  assert.equal(normalizeResourceSet([file, { ...file, label: 'dup' }]).ok, false)
})

test('normalizeFencingEvidence requires the exact lease identity fields', () => {
  const valid = normalizeFencingEvidence({
    generation: 'gen:000000000001',
    fencingToken: 'tok-1',
    ownerId: 'owner-1',
    expiresAt: '2026-08-25T00:00:00.000Z',
  })
  assert.equal(valid.ok, true)
  assert.equal(normalizeFencingEvidence({ generation: 'g' }).ok, false)
  assert.equal(normalizeFencingEvidence({ generation: 'g', fencingToken: 't', ownerId: 'o', expiresAt: 'not-a-time' }).ok, false)
})

test('normalizeEvidenceSide enforces the explicit absent marker and rejects empty sides', () => {
  const absent = normalizeEvidenceSide({ absent: true }, 'after')
  assert.equal(absent.ok, true)
  assert.deepEqual(absent.value, deepFreeze({ absent: true }))
  const digest = normalizeEvidenceSide({ digest: 'abc123' }, 'before')
  assert.equal(digest.ok, true)
  assert.equal(digest.value.digest, 'abc123')
  const version = normalizeEvidenceSide({ version: 3 }, 'before')
  assert.equal(version.ok, true)
  assert.equal(version.value.version, 3)
  assert.equal(normalizeEvidenceSide({}, 'before').ok, false)
  assert.equal(normalizeEvidenceSide(undefined, 'before').ok, false)
  assert.equal(normalizeEvidenceSide({ absent: false }, 'before').ok, false)
})

test('normalizeSideEffectClass uses the fixed classification vocabulary', () => {
  for (const cls of WS_TX_SIDE_EFFECTS) {
    assert.equal(normalizeSideEffectClass(cls).ok, true)
  }
  assert.equal(normalizeSideEffectClass('reversible').ok, false)
  assert.equal(normalizeSideEffectClass(undefined).ok, false)
})

test('normalizeCapability requires owner/name with bounded status vocabulary', () => {
  const ok = normalizeCapability({ owner: 'git', name: 'restore', version: '1.0', status: 'available' })
  assert.equal(ok.ok, true)
  assert.equal(normalizeCapability({ owner: 'git', name: 'restore', status: 'magic' }).ok, false)
  assert.equal(normalizeCapability({ name: 'restore', status: 'available' }).ok, false)
})

test('normalizeMutationSource preserves sibling identities and never mints replacements', () => {
  const source = normalizeMutationSource({
    toolId: 'tool-1',
    executionId: 'exec-1',
    sessionId: 'session-1',
    eventSeq: 42,
  })
  assert.equal(source.ok, true)
  assert.equal(source.value.executionId, 'exec-1')
  assert.equal(source.value.eventSeq, 42)
  const empty = normalizeMutationSource(undefined)
  assert.equal(empty.ok, true)
  assert.deepEqual(empty.value, deepFreeze({}))
  const badSeq = normalizeMutationSource({ eventSeq: -1 })
  assert.equal(badSeq.ok, true)
  assert.equal(badSeq.value.eventSeq, undefined)
})

test('normalizeMutationRecord builds a bounded record and rejects missing required members', () => {
  const record = normalizeMutationRecord({
    resource: { kind: 'file', key: 'a.txt', scope: 'workspace' },
    operation: 'write',
    before: { digest: 'old' },
    after: { absent: true },
    sideEffectClass: 'rollbackable',
    capability: { owner: 'fileClaim', name: 'claim', status: 'available' },
    source: { toolId: 'tool-1', executionId: 'exec-1' },
    idempotent: true,
  })
  assert.equal(record.ok, true)
  assert.equal(record.value.idempotent, true)
  assert.equal(record.value.after.absent, true)
  assert.equal(normalizeMutationRecord({ resource: { kind: 'file', key: 'a', scope: 'workspace' } }).ok, false)
  assert.equal(normalizeMutationRecord({ resource: { kind: 'file', key: 'a', scope: 'workspace' }, operation: 'write' }).ok, false)
})

test('normalizeProvenance keeps bounded entries only', () => {
  const ok = normalizeProvenance([
    { kind: 'execution', id: 'exec-1', certainty: 'observed' },
    { kind: 'bogus' },
    'junk',
    { kind: 'task', id: 'task-1', certainty: 'served' },
  ])
  assert.equal(ok.ok, true)
  assert.equal(ok.value.length, 2)
  assert.equal(ok.value[1].certainty, 'served')
  assert.equal(normalizeProvenance('nope').ok, false)
})

test('canTransition encodes the design transition table with terminal protection and fenced-only superseded', () => {
  // prepared fan-out
  assert.equal(canTransition('prepared', 'committing'), true)
  assert.equal(canTransition('prepared', 'rolling-back'), true)
  assert.equal(canTransition('prepared', 'recovering'), true)
  assert.equal(canTransition('prepared', 'failed'), true)
  assert.equal(canTransition('prepared', 'superseded'), true)
  // committing
  assert.equal(canTransition('committing', 'committed'), true)
  assert.equal(canTransition('committing', 'recovering'), true)
  assert.equal(canTransition('committing', 'failed'), true)
  assert.equal(canTransition('committing', 'superseded'), true)
  // rolling-back
  assert.equal(canTransition('rolling-back', 'rolled-back'), true)
  assert.equal(canTransition('rolling-back', 'recovering'), true)
  assert.equal(canTransition('rolling-back', 'failed'), true)
  assert.equal(canTransition('rolling-back', 'superseded'), true)
  // recovering
  assert.equal(canTransition('recovering', 'committed'), true)
  assert.equal(canTransition('recovering', 'rolled-back'), true)
  assert.equal(canTransition('recovering', 'failed'), true)
  assert.equal(canTransition('recovering', 'unknown'), true)
  assert.equal(canTransition('recovering', 'superseded'), true)
  // terminal immutability
  for (const terminal of ['committed', 'rolled-back', 'failed', 'superseded']) {
    for (const state of WS_TX_STATES) {
      if (state === terminal) continue
      assert.equal(canTransition(terminal, state), false, `${terminal} -> ${state} must be rejected`)
    }
  }
  // the single encoded unknown exception: only an explicit new recover() may
  // reclassify it, encoded as the unknown -> recovering continuation edge.
  assert.equal(canTransition('unknown', 'recovering'), true)
  for (const state of WS_TX_STATES) {
    if (state === 'recovering') continue
    assert.equal(canTransition('unknown', state), false, `unknown -> ${state} must be rejected`)
  }
  // same-state and unknown-state transitions
  assert.equal(canTransition('prepared', 'prepared'), false)
  assert.equal(canTransition('bogus', 'committed'), false)
  assert.equal(canTransition('prepared', 'bogus'), false)
  // superseded only from active/non-terminal states, never from a timeout
  // (there is no time-based transition in the table)
  assert.equal(canTransition('prepared', 'superseded'), true)
  assert.equal(canTransition('committed', 'superseded'), false)
})

test('buildAvailability is a truth-subset: session/workspace durable merges to durable, memory stays memory', () => {
  const durableWorkspace = buildAvailability({
    status: 'available',
    scope: 'workspace',
    durability: 'workspace',
    operations: { prepare: 'available' },
    backend: { id: 'storage-domain' },
    epoch: 'epoch:1',
  })
  assert.equal(durableWorkspace.durability, 'durable')
  assert.equal(durableWorkspace.scope, 'workspace')
  const memory = buildAvailability({
    status: 'available',
    scope: 'process',
    durability: 'memory',
    operations: { recover: 'unsupported' },
    backend: { id: 'memory' },
  })
  assert.equal(memory.durability, 'memory')
  assert.equal(memory.operations.recover, 'unsupported')
  assert.equal(memory.operations.commit, 'unknown')
  const unknown = buildAvailability({ durability: 'bogus', operations: { bogus: 'x' } })
  assert.equal(unknown.durability, 'unknown')
  assert.equal(unknown.status, 'unknown')
  // unknown/invalid operation members degrade to unknown, never invented
  const strict = buildAvailability({ operations: { commit: 'available', bogus: 'available' } })
  assert.equal(strict.operations.commit, 'available')
  assert.equal(strict.operations.bogus, undefined)
})

test('cloneBoundedPublic drops secret keys, caps depth and size, and never throws on hostile getters', () => {
  const hostile = {}
  Object.defineProperty(hostile, 'secretKey', {
    enumerable: true,
    get() { throw new Error('boom') },
  })
  assert.doesNotThrow(() => cloneBoundedPublic(hostile))
  const cloned = cloneBoundedPublic({
    credential: 'super-secret',
    prompt: 'system prompt',
    digest: 'abc',
    content: 'raw body',
    nested: { password: 'pw', safe: 1 },
    list: [1, 2, 3],
  })
  assert.equal(cloned.credential, undefined)
  assert.equal(cloned.prompt, undefined)
  assert.equal(cloned.digest, 'abc')
  assert.equal(cloned.content, undefined)
  assert.equal(cloned.nested.password, undefined)
  assert.equal(cloned.nested.safe, 1)
  assert.deepEqual(cloned.list, [1, 2, 3])
  const circular = { a: 1 }
  circular.self = circular
  assert.doesNotThrow(() => cloneBoundedPublic(circular))
})

test('redaction: secret keys and raw contents never cross; bounded change evidence is preserved; failure fails closed', () => {
  const record = {
    transactionId: 'tx-1',
    workspace: { scope: 'workspace', key: 'repo-a' },
    ownerId: 'owner-1',
    intent: { kind: 'edit', summary: 'fix tests' },
    state: 'prepared',
    revision: 2,
    lease: { generation: 'gen:1', fencingToken: 'tok-secret' },
    checkpoint: { id: 'cp-1', capability: { owner: 'checkpoint', name: 'describe', status: 'available' } },
    mutations: [{
      resource: { kind: 'file', key: 'a.txt', scope: 'workspace' },
      operation: 'write',
      before: { digest: 'old' },
      after: { absent: true },
      sideEffectClass: 'rollbackable',
      capability: { owner: 'fileClaim', name: 'claim', status: 'available' },
      source: { toolId: 'tool-1', executionId: 'exec-1' },
      idempotent: true,
      order: 0,
      observedAt: '2026-08-25T00:00:00.000Z',
    }],
    approvals: [{ approvalId: 'ap-1' }],
    provenance: [{ kind: 'execution', id: 'exec-1', certainty: 'observed' }],
    availability: { status: 'available' },
  }
  const redacted = redactTransactionRecord(record, { audience: 'ui' })
  assert.equal(redacted.transactionId, 'tx-1')
  assert.equal(redacted.ownerId, 'owner-1')
  assert.equal(redacted.state, 'prepared')
  assert.equal(redacted.revision, 2)
  assert.equal(redacted.mutations.length, 1)
  assert.equal(redacted.mutations[0].resource.key, 'a.txt')
  assert.equal(redacted.mutations[0].sideEffectClass, 'rollbackable')
  assert.equal(redacted.mutations[0].observedAt, '2026-08-25T00:00:00.000Z')
  // fencing token never leaves the host
  assert.equal(redacted.lease?.fencingToken, undefined)
  assert.equal(redacted.checkpoint?.id, 'cp-1')
  assert.equal(redacted.provenance[0].id, 'exec-1')
  assert.equal(Object.isFrozen(redacted), true)
  assert.equal(Object.isFrozen(redacted.mutations[0]), true)
  // mutation-level redaction keeps bounded evidence and drops secrets
  const mutation = redactMutationRecord(record.mutations[0])
  assert.equal(mutation.operation, 'write')
  assert.equal(mutation.before.digest, 'old')
  assert.equal(mutation.after.absent, true)
})

test('normalize helpers never throw on malformed or hostile input', () => {
  const hostile = {}
  Object.defineProperty(hostile, 'scope', {
    enumerable: true,
    get() { throw new Error('boom') },
  })
  for (const fn of [
    () => normalizeWorkspace(hostile),
    () => normalizeResource(hostile),
    () => normalizeIntent(hostile),
    () => normalizeMutationRecord(hostile),
    () => normalizeEvidenceSide(hostile, 'before'),
    () => normalizeCapability(hostile),
    () => normalizeFencingEvidence(hostile),
    () => normalizeProvenance(hostile),
    () => redactTransactionRecord(hostile),
  ]) {
    assert.doesNotThrow(fn)
  }
})

test('workspace scope vocabulary is the fixed four-kind set', () => {
  assert.deepEqual(WS_TX_SCOPES, ['session', 'workspace', 'profile', 'process'])
  assert.ok(WS_TX_TERMINAL.includes('committed'))
  assert.ok(WS_TX_TERMINAL.includes('rolled-back'))
  assert.ok(WS_TX_TERMINAL.includes('failed'))
  assert.ok(WS_TX_TERMINAL.includes('superseded'))
  assert.ok(WS_TX_TERMINAL.includes('unknown'))
})