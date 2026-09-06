import test from 'node:test'
import assert from 'node:assert/strict'
import { createCheckpointAvailability } from '../lib/checkpoint-availability.js'
import { createLoopFacts } from '../lib/checkpoint-facts.js'
import { createAttemptFactsFixture, createBranchAuthorityFixture, createSnapshotSliceFixture } from './checkpoint-test-kit.mjs'

function report(status, reason) {
  return { availability: () => ({ status, ...(reason ? { reason } : {}) }) }
}

function harness(options = {}) {
  const branch = options.branch ?? createBranchAuthorityFixture()
  const snapshot = options.snapshot ?? createSnapshotSliceFixture()
  const attempts = options.attempts ?? createAttemptFactsFixture()
  const facts = createLoopFacts({ facts: attempts.facet })
  const availability = createCheckpointAvailability({
    active: options.active ?? (() => true),
    disabledReason: 'checkpoints capability is unknown',
    projection: report('active'),
    capture: {
      sourceAvailability: (kind) => {
        if (kind === 'branch') return branch.face.availability()
        if (kind === 'workspace-snapshot') return snapshot.face.availability()
        return { status: 'unavailable', reason: 'workspace journal authority is inactive' }
      },
    },
    autoCapture: report('active'),
    restore: {
      availability: () => ({
        status: 'active',
        stopThenRestore: facts.cancelState(),
      }),
    },
  })
  return { availability, branch, snapshot, facts }
}

test('availability: covers projection, every v1 source, auto-capture and restore; never throws', async () => {
  const { availability, snapshot } = harness()
  snapshot.setActive(false, 'slice probe failed')
  const availabilityReport = availability.availability()
  assert.ok(Object.isFrozen(availabilityReport))
  assert.equal(availabilityReport.projection.status, 'active')
  assert.equal(availabilityReport.sources.branch.status, 'active')
  assert.equal(availabilityReport.sources['workspace-snapshot'].status, 'unavailable')
  assert.match(availabilityReport.sources['workspace-snapshot'].reason, /inactive|probe/)
  assert.equal(availabilityReport.autoCapture.status, 'active')
  assert.equal(availabilityReport.restore.status, 'active')
  assert.equal(availabilityReport.restore.stopThenRestore.status, 'active')
  assert.equal(availabilityReport.status, 'degraded')
  assert.ok(availabilityReport.reason)
})

test('availability: an absent source never takes down unrelated faces', async () => {
  const { availability, branch } = harness()
  branch.setActive(false, 'branch owner inactive')
  const availabilityReport = availability.availability()
  assert.equal(availabilityReport.sources.branch.status, 'unavailable')
  assert.equal(availabilityReport.projection.status, 'active')
  assert.equal(availabilityReport.autoCapture.status, 'active')
  assert.equal(availabilityReport.restore.status, 'active')
})

test('availability: inactive core yields unavailable with reason, no throw', async () => {
  const { availability } = harness({ active: () => false })
  const availabilityReport = availability.availability()
  assert.equal(availabilityReport.status, 'unavailable')
  assert.match(availabilityReport.reason, /core is inactive/)
})

test('availability: per-source capability report is typed for unregistered kinds', async () => {
  const { availability } = harness()
  const unregistered = availability.sourceAvailability('time-machine')
  assert.equal(unregistered.status, 'unavailable')
  assert.match(unregistered.reason, /not a registered v1 source/)
  const branch = availability.sourceAvailability('branch')
  assert.equal(branch.status, 'active')
})

test('availability: loop slice absence degrades stop-then-restore with a concrete reason', async () => {
  const { availability } = harness()
  const facts = createLoopFacts({ facts: undefined })
  const availability2 = createCheckpointAvailability({
    active: () => true,
    projection: report('active'),
    capture: { sourceAvailability: () => ({ status: 'active' }) },
    autoCapture: report('active'),
    restore: { availability: () => ({ status: 'active', stopThenRestore: facts.cancelState() }) },
  })
  const availabilityReport = availability2.availability()
  assert.equal(availabilityReport.restore.stopThenRestore.status, 'unavailable')
  assert.match(availabilityReport.restore.stopThenRestore.reason, /inactive/)
})