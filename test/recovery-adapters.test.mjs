import test from 'node:test'
import assert from 'node:assert/strict'
import { createRecoveryAdapters } from '../lib/recovery-adapters.js'
import { RecoveryPolicyBoundaryError } from '../lib/errors.js'

test('public agent and tool adapters normalize only explicit evidence and preserve unavailable sources', () => {
  const adapters = createRecoveryAdapters()
  const agent = adapters.fromAgentRequestError({
    failure: { class: 'transient', code: 'TIMEOUT', detail: 'bounded' },
    execution: { executionId: 'e-1', attemptId: 'a-1' },
    turn: 4,
    prompt: 'must not be copied',
  })
  assert.equal(agent.failure.class, 'transient')
  assert.equal(agent.execution.executionId, 'e-1')
  assert.equal(agent.prompt, undefined)
  assert.equal(agent.evidence.source.kind, 'agent-request')
  assert.equal(agent.evidence.route.status, 'unavailable')
  assert.equal(Object.isFrozen(agent), true)

  const tool = adapters.fromToolResult({ execution: { executionId: 'e-2' } }, { error: { code: 'denied' } })
  assert.equal(tool.execution.executionId, 'e-2')
  assert.equal(tool.failure.code, 'denied')
  assert.equal(tool.evidence.source.kind, 'tool-call')
})
test('unsupported durable boundaries are explicit and never represented as in-memory recovery', () => {
  const adapters = createRecoveryAdapters()
  const result = adapters.fromAgentRequestError({ requestedCapability: 'checkpoint-restore' })
  assert.equal(result.unsupported.kind, 'checkpoint-restore')
  assert.throws(() => adapters.unsupported('workspace-transaction'), RecoveryPolicyBoundaryError)
})
