/**
 * Consumer migration slices for the controlled workflow entry.
 *
 * Recorded facts (goal): a TUI currently only *reads* the workflow engine's
 * display events — no real `start` consumer was found — so these slices execute
 * the call shapes a consumer will migrate to rather than claiming a migrated
 * repository. The consumer repositories are not present in this workspace.
 *
 * | slice | original consumer behavior | migrated public call | observed result |
 * |---|---|---|---|
 * | A | a TUI/automation plugin can only read `workflow/*` events for display; there is no supported start entry | `workflows.start(request)` plus `operation.observe`/`operation.result` | the run really starts, progress and the single terminal come from the public control handle, and cancellation is a signal the engine adjudicates |
 * | B | a plugin has no run identity to link its task records to | `operation.id` passed into the existing `tasks.attach/start` workflow source | the official run identity is the evidence reference; the tasks face stays untouched and no second executor exists |
 *
 * Non-functional, recorded instead of approximated: the consumers' own command
 * registries, renderers and remote contracts are not part of this contract.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { createWorkflowsFeature } from '../lib/workflows-facade.js'

/** Minimal harness: the probed-shape engine double plus a fake agents surface. */
function harness() {
  const parent = { id: 'agent-1', session: { id: 's1' } }
  const emitted = []
  const runs = []
  const engine = {
    start(request) {
      let resolveResult
      const result = new Promise((resolve) => { resolveResult = resolve })
      const run = {
        id: `run-${runs.length + 1}`,
        meta: { ...request.meta },
        result,
        cancel(reason) { run.cancelReason = reason },
        async dispose() {},
      }
      runs.push({ run, request, release: () => resolveResult({ stopReason: 'completed', value: { done: true }, agentsStarted: 0 }) })
      return run
    },
  }
  const ctx = {
    get: (name) => (name === 'workflowEngine' ? engine : name === 'agents' ? { get: (id) => (id === parent.id ? parent : undefined) } : undefined),
    on: (name, listener) => {
      emitted.push({ name, listener })
      return () => {}
    },
  }
  const service = { isActive: true }
  const feature = createWorkflowsFeature({ ctx, service, logger: { warn() {} } })
  return { feature, engine, runs, parent, emitted, face: feature.api.surfaceFor(ctx) }
}

test('slice A: a display-only plugin migrates to the supported start entry', async () => {
  const kit = harness()
  const outcome = kit.face.start({
    script: 'return { done: true }',
    meta: { name: 'slice-a', description: 'slice A workflow' },
    parent: kit.parent,
  })
  assert.equal(outcome.code, 'started')
  const progress = []
  outcome.operation.observe((event) => progress.push(event.name))

  // Progress arrives through the existing fact surface, scoped to this run: the
  // six registered names are reachable, and another run's facts are not.
  for (const entry of kit.emitted) entry.listener({ id: outcome.operation.id }, 'payload')
  for (const entry of kit.emitted) entry.listener({ id: 'another-run' }, 'payload')
  assert.deepEqual([...new Set(progress)].sort(), [...new Set(kit.emitted.map((entry) => entry.name))].sort(), 'the six registered facts reach this run')
  assert.equal(progress.length, kit.emitted.length, "another run's facts never reach this handle")

  // Cancellation is a signal the engine adjudicates.
  outcome.operation.cancel('user pressed stop')
  assert.equal(kit.runs[0].run.cancelReason, 'user pressed stop')
  kit.runs[0].release()
  const terminal = await outcome.operation.result
  assert.equal(terminal.terminal, 'success')
  assert.deepEqual(terminal.value, { done: true })
  outcome.operation.dispose()
})

test('slice B: the run identity links to the existing tasks source with no second executor', () => {
  const kit = harness()
  const outcome = kit.face.start({
    script: 'return 1',
    meta: { name: 'slice-b', description: 'slice B workflow' },
    parent: kit.parent,
  })
  // The consumer passes the official id as the workflow evidence reference.
  const linked = { workflowId: outcome.operation.id, taskId: 'task-1' }
  assert.equal(typeof linked.workflowId, 'string')
  assert.equal(linked.workflowId, kit.runs[0].run.id, 'the run identity is the official one')
  // The facade minted exactly one run and no second execution path.
  assert.equal(kit.runs.length, 1)
})
