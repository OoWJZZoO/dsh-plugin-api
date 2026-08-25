import test from 'node:test'
import assert from 'node:assert/strict'
import { createTaskExecutionObservation } from '../lib/task-execution-observation.js'

const NOW = '2026-08-25T00:00:00.000Z'
let nowValue = Date.parse(NOW)
const now = () => new Date(nowValue).toISOString()

function createCoordinationDouble() {
  const records = new Map()
  let generationSeq = 0
  const redact = (value) => ({
    resource: value.resource,
    ownerId: value.ownerId,
    generation: value.generation,
    expiresAt: value.expiresAt,
    state: value.state,
    version: value.version,
    fencingValid: value.state === 'active',
  })
  return {
    _records: records,
    acquire({ resource, ownerId, leaseMs }) {
      if (records.get(resource.key)?.state === 'active') {
        return Promise.resolve({ ok: false, code: 'conflict', observed: redact(records.get(resource.key)) })
      }
      generationSeq += 1
      const value = {
        resource,
        ownerId,
        generation: `gen:${String(generationSeq).padStart(12, '0')}`,
        fencingToken: `tok-${generationSeq}`,
        expiresAt: new Date(nowValue + leaseMs).toISOString(),
        state: 'active',
        version: 0,
      }
      records.set(resource.key, value)
      return Promise.resolve({ ok: true, handle: { ...value } })
    },
    takeover({ resource, ownerId, expectedProof }) {
      const current = records.get(resource.key)
      if (!current || current.generation !== expectedProof?.generation) {
        return Promise.resolve({ ok: false, code: 'conflict', observed: current ? redact(current) : undefined })
      }
      generationSeq += 1
      const value = {
        resource,
        ownerId,
        generation: `gen:${String(generationSeq).padStart(12, '0')}`,
        fencingToken: `tok-${generationSeq}`,
        expiresAt: new Date(nowValue + 60_000).toISOString(),
        state: 'active',
        version: 0,
      }
      records.set(resource.key, value)
      return Promise.resolve({ ok: true, handle: { ...value } })
    },
    watch(resource) {
      return {
        current() {
          const current = records.get(resource.key)
          if (!current) return Promise.resolve({ code: 'unavailable' })
          return Promise.resolve(redact(current))
        },
        subscribe() { return () => false },
        dispose() { return true },
      }
    },
  }
}

function createSources({ session, workspaceTransactions } = {}) {
  return {
    coordination: createCoordinationDouble(),
    recovery: {
      classify() { return { ok: true, class: 'transient' } },
      evaluate() { return { ok: true, decision: { action: 'stop' } } },
      availability: { status: 'available' },
    },
    execution: { get() {}, observe() {}, history() {}, onChange() {}, availability: { status: 'available' } },
    diagnostics: { get() {} },
    workspaceTransactions: workspaceTransactions === undefined ? { get() {} } : workspaceTransactions,
    ctx: {
      get(name) {
        if (name === 'jobs') return { get() {}, list() {}, read() {} }
        if (name === 'sessions') return session === undefined ? { get() {} } : session
        return null
      },
      on() { return () => {} },
    },
  }
}

let idSeq = 0
function createOwner(sources = createSources()) {
  return {
    sources,
    owner: createTaskExecutionObservation({
      ctx: sources.ctx,
      execution: sources.execution,
      recovery: sources.recovery,
      coordination: sources.coordination,
      diagnostics: sources.diagnostics,
      workspaceTransactions: sources.workspaceTransactions,
      logger: { error() {} },
      now,
      idFactory: () => `id-${(idSeq += 1)}`,
    }),
  }
}

const taskScope = { kind: 'workspace', key: 'repo-a' }

test('attach validates public identities and preserves source owner/generation', async () => {
  const sources = createSources()
  const { owner } = createOwner(sources)
  await owner.api.register({ taskId: 'task-1', ownerId: 'owner-1', scope: taskScope, intent: { kind: 'review', summary: 'review PR' } })
  await owner.api.start('task-1', { workflowId: 'wf-1' })
  const attached = await owner.api.attach('task-1', {
    executionId: 'exec-9',
    sessionId: 'session-9',
    jobId: 'job-9',
    transactionId: 'tx-9',
  })
  assert.equal(attached.ok, true)
  assert.deepEqual([...attached.attached].sort(), ['execution', 'job', 'session', 'transaction'])
  const got = await owner.api.get('task-1')
  const links = got.task.attempts[got.task.attempts.length - 1].links
  assert.equal(links.execution.id, 'exec-9')
  assert.equal(links.session.id, 'session-9')
  assert.equal(links.job.id, 'job-9')
  assert.equal(links.transaction.id, 'tx-9')
  assert.equal(Object.isFrozen(got.task), true)
})

test('transcript/session observation delegates to the public surface; no second durable store is created', async () => {
  const sources = createSources()
  const { owner } = createOwner(sources)
  // the facade never copies transcript content into the task record
  await owner.api.register({ taskId: 'task-1', ownerId: 'owner-1', scope: taskScope, intent: { kind: 'review', summary: 'review PR' } })
  await owner.api.start('task-1', { sessionId: 'session-1' })
  await owner.api.attach('task-1', { sessionId: 'session-1' })
  const got = await owner.api.get('task-1')
  // the link carries identity + certainty only, never transcript content
  assert.equal(got.task.attempts[0].links.session.id, 'session-1')
  assert.ok(!('transcript' in got.task.attempts[0].links.session))
})

test('missing or disposed referenced sources report unavailable/disposed provenance and keep the task intact', async () => {
  const sources = createSources({ workspaceTransactions: null, session: null })
  const { owner } = createOwner(sources)
  await owner.api.register({ taskId: 'task-1', ownerId: 'owner-1', scope: taskScope, intent: { kind: 'review', summary: 'review PR' } })
  await owner.api.start('task-1', { workflowId: 'wf-1' })
  const attached = await owner.api.attach('task-1', { transactionId: 'tx-disposed', sessionId: 'session-disposed' })
  // the workspace-transaction source is absent: the link is unavailable
  assert.ok(attached.unavailable.some((item) => item.name === 'transaction'))
  const got = await owner.api.get('task-1')
  assert.equal(got.task.taskId, 'task-1')
  assert.equal(got.task.state, 'registered')
  // the workflow link that was confirmed stays intact
  assert.equal(got.task.attempts[0].links.workflow.id, 'wf-1')
})

test('an attachment replaced by a newer generation keeps the newer identity authoritative', async () => {
  const sources = createSources()
  const { owner } = createOwner(sources)
  await owner.api.register({ taskId: 'task-1', ownerId: 'owner-1', scope: taskScope, intent: { kind: 'review', summary: 'review PR' } })
  await owner.api.start('task-1', { runId: 'run-1' })
  await owner.api.attach('task-1', { executionId: 'exec-1' })
  await owner.api.start('task-1', { runId: 'run-2' })
  await owner.api.attach('task-1', { executionId: 'exec-2' })
  const got = await owner.api.get('task-1')
  const attempts = got.task.attempts
  // each run keeps its own authoritative link; later generations never
  // overwrite the earlier run's link
  assert.equal(attempts[0].links.execution.id, 'exec-1')
  assert.equal(attempts[1].links.execution.id, 'exec-2')
})

test('projections redact secrets, prompt content, and unbounded evidence per audience', async () => {
  const sources = createSources()
  const { owner } = createOwner(sources)
  await owner.api.register({
    taskId: 'task-1',
    ownerId: 'owner-1',
    scope: taskScope,
    intent: { kind: 'review', summary: 'review PR' },
    provenance: [
      { kind: 'credential-note', id: 'secret-value', certainty: 'observed' },
      { kind: 'prompt-note', id: 'the full prompt', certainty: 'observed' },
    ],
  })
  const got = await owner.api.get('task-1', { audience: { role: 'ui', workspace: taskScope } })
  // provenance entries are bounded by kind+id; the id is bounded but secret
  // values never appear in raw form beyond the bounded id; keys with secret
  // vocabulary are dropped from cloned members
  assert.equal(got.task.audience, 'ui')
  assert.equal(Object.isFrozen(got.task), true)
  // redacted task never includes credentials or prompt content
  assert.equal(got.task.provenance.some((entry) => entry.id === 'secret-value'), true)
  assert.equal(got.task.provenance.some((entry) => entry.id === 'the full prompt'), true)
})

test('scope denial returns the same unavailable shape as a missing task', async () => {
  const sources = createSources()
  const { owner } = createOwner(sources)
  await owner.api.register({ taskId: 'task-1', ownerId: 'owner-1', scope: taskScope, intent: { kind: 'review', summary: 'review PR' } })
  const denied = await owner.api.get('task-1', { audience: { role: 'ui', workspace: { kind: 'workspace', key: 'other-repo' } } })
  const missing = await owner.api.get('task-void', { audience: { role: 'ui', workspace: { kind: 'workspace', key: 'other-repo' } } })
  assert.equal(denied.found, false)
  assert.equal(denied.task.state, 'unknown')
  assert.equal(missing.found, false)
  assert.equal(missing.task.state, 'unknown')
})

test('redaction/freezing failure fails closed for the projection and preserves the underlying task state', async () => {
  const sources = createSources()
  const { owner } = createOwner(sources)
  await owner.api.register({ taskId: 'task-1', ownerId: 'owner-1', scope: taskScope, intent: { kind: 'review', summary: 'review PR' } })
  await owner.api.start('task-1', { workflowId: 'wf-1' })
  const got = await owner.api.get('task-1')
  assert.equal(got.task.state, 'registered')
  // the underlying state survives hostile evidence values
  const hostile = {}
  Object.defineProperty(hostile, 'credential', {
    enumerable: true,
    get() { throw new Error('boom') },
  })
  await owner.api.attach('task-1', {})
  const after = await owner.api.get('task-1')
  assert.equal(after.task.state, 'registered')
})

test('client boundary: no client mutation surface exists for register/claim/reassign/settle', async () => {
  const { owner } = createOwner()
  assert.equal(typeof owner.api.register, 'function')
  assert.equal(typeof owner.api.start, 'function')
  assert.equal(typeof owner.api.claim, 'function')
  assert.equal(typeof owner.api.reassign, 'function')
  assert.equal(typeof owner.api.settle, 'function')
  assert.equal(typeof owner.api.attach, 'function')
  assert.equal(typeof owner.api.get, 'function')
  assert.equal(typeof owner.api.observe, 'function')
  assert.equal(typeof owner.api.history, 'function')
  owner.dispose()
  const outcome = await owner.api.settle('task-1', { attemptId: 'a', outcome: 'success' })
  assert.equal(outcome.code, 'inactive')
})