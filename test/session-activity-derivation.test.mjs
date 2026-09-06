import test from 'node:test'
import assert from 'node:assert/strict'
import {
  adjudicateTerminals,
  deriveTerminalCandidates,
  deriveTerminal,
  DERIVATION_RULES,
} from '../lib/session-activity-derivation.js'
import { createActivityStore } from '../lib/session-activity-store.js'

function openRecord(sliceObserved = false) {
  const store = createActivityStore({ now: () => '2026-09-06T00:00:00.000Z' })
  store.ingest({
    source: 'durable', sessionId: 's1', kind: 'start', turn: 1, seq: 0,
    observedAt: '2026-09-06T00:00:00.000Z',
  })
  const record = store.current('s1')
  record.fidelity.sliceObserved = sliceObserved
  return record
}

test('derivation: turn-completed-idle succeeds only when the record is idle of pending blocks', () => {
  const record = openRecord()
  const candidates = deriveTerminalCandidates(record, {
    turnCompleted: true,
    openApprovals: 0,
    openTools: 0,
  })
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].outcome, 'success')
  assert.equal(candidates[0].confidence, 'reconstructed')
  assert.equal(candidates[0].ruleName, 'turn-completed-idle')
  // pending approval or tool blocks keep the activity open: silence is not success
  assert.equal(deriveTerminal(record, { turnCompleted: true, openApprovals: 1, openTools: 0 }), null)
  assert.equal(deriveTerminal(record, { turnCompleted: true, openApprovals: 0, openTools: 2 }), null)
})

test('derivation: agent-error maps to reconstructed error', () => {
  const record = openRecord()
  const terminal = deriveTerminal(record, { agentError: true })
  assert.deepEqual(terminal, {
    outcome: 'error',
    confidence: 'reconstructed',
    ruleName: 'agent-error',
    classification: 'agent-error',
  })
})

test('derivation: approval-rejected maps to reconstructed denied', () => {
  const record = openRecord()
  const terminal = deriveTerminal(record, { approvalRejected: true })
  assert.deepEqual(terminal, {
    outcome: 'denied',
    confidence: 'reconstructed',
    ruleName: 'denied-by-approval',
    classification: 'denied-by-approval',
  })
})

test('derivation: timeout evidence maps to error with timeout classification, no new terminal word', () => {
  const record = openRecord()
  const terminal = deriveTerminal(record, { timeout: 'approval wait exceeded' })
  assert.equal(terminal.outcome, 'error')
  assert.equal(terminal.classification, 'timeout')
  assert.equal(terminal.ruleName, 'timeout')
  assert.equal(terminal.reason, 'approval wait exceeded')
})

test('derivation: slice-observed records never take heuristics', () => {
  const record = openRecord(true)
  assert.deepEqual(deriveTerminalCandidates(record, { agentError: true }), [])
  assert.deepEqual(deriveTerminalCandidates(record, { turnCompleted: true, openApprovals: 0, openTools: 0 }), [])
  assert.deepEqual(deriveTerminalCandidates(record, { approvalRejected: true }), [])
})

test('derivation: adjudication applies the shared priority exactly once', () => {
  const error = { outcome: 'error', ruleName: 'agent-error' }
  const denied = { outcome: 'denied', ruleName: 'denied-by-approval' }
  const success = { outcome: 'success', ruleName: 'turn-completed-idle' }
  const timeout = { outcome: 'error', classification: 'timeout', ruleName: 'timeout' }
  assert.equal(adjudicateTerminals([error, denied]).outcome, 'error')
  assert.equal(adjudicateTerminals([denied, success]).outcome, 'denied')
  assert.equal(adjudicateTerminals([success, error]).outcome, 'error')
  assert.equal(adjudicateTerminals([timeout, success]).outcome, 'error')
  assert.equal(adjudicateTerminals([timeout, error]).ruleName, 'agent-error')
  assert.equal(adjudicateTerminals([aborted(), superseded()]).outcome, 'aborted')
  assert.equal(adjudicateTerminals([]), null)
  assert.equal(adjudicateTerminals(null), null)
})

function aborted() {
  return { outcome: 'aborted', ruleName: 'x' }
}
function superseded() {
  return { outcome: 'superseded', ruleName: 'x' }
}

test('derivation: every rule is named and registered in DERIVATION_RULES', () => {
  for (const name of DERIVATION_RULES) {
    assert.equal(typeof name, 'string')
  }
  assert.ok(DERIVATION_RULES.includes('superseded-by-boundary'))
  assert.ok(DERIVATION_RULES.includes('turn-completed-idle'))
  assert.ok(DERIVATION_RULES.includes('agent-error'))
  assert.ok(DERIVATION_RULES.includes('denied-by-approval'))
  assert.ok(DERIVATION_RULES.includes('timeout'))
})

test('derivation: aborted has no derivation rule — absence stays unknown, never guessed', () => {
  const record = openRecord()
  // no evidence produces no candidate at all
  assert.equal(deriveTerminalCandidates(record, {}).length, 0)
  // an aborted signal is not a derivable rule: nothing is guessed
  assert.equal(deriveTerminalCandidates(record, { abortedSignal: true }).length, 0)
  assert.equal(deriveTerminal(record, { agentError: true }).outcome, 'error')
})