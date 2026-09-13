/**
 * Consumer migration slices for the controlled plan-mode face.
 *
 * The original consumers switch and read plan mode by driving the official
 * component directly (the `/plan` command path, the official projection, or
 * private state reads inside their own packages), which the contract recorded
 * as an unsupported escape hatch. This feature gives them one public path:
 * `pluginApi.sessions.planMode.select(agent, boolean)` for the switch,
 * `.get(agent)` for the read and `.observe(agent)` for the change feed. The
 * consumer repositories are not present in this workspace, so each slice
 * executes the exact call shapes those consumers will migrate to, against the
 * mounted facade and the official-shape mock used by the e2e file — the same
 * evidence pattern as `test/consumer-migration-slices.test.mjs` and
 * `test/llm-adapter-migration-slices.test.mjs`.
 *
 * | slice | original consumer behavior | migrated public call | observed result |
 * |---|---|---|---|
 * | A | a TUI/independent frontend implements its own `/plan` toggle by driving the official seam and mirroring the mode in local UI state | `sessions.planMode.select(agent, active)` + `sessions.planMode.observe(agent)` driving the badge | the switch returns the official arbitration verb; the badge follows the official fact stream, including switches the facade never issued, and never a local mirror |
 * | B | an automation/orchestration consumer constrains its own behavior by plan mode, reading the official projection or private state | `sessions.planMode.get(agent)` + `.observe(agent)` | the constraint reads the official mode; a mode change delivered through the feed re-evaluates the constraint; a closed or unavailable target degrades typed instead of guessing |
 *
 * Non-functional, recorded instead of approximated: the consumers' UI
 * components, their own state stores and their command registrations are not
 * part of this contract; the external repositories are not migrated here
 * (their migration is a consumer-side change, no new release is required for
 * this milestone).
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { createHarness, mountOfficialSession } from './session-plan-mode-test-kit.mjs'

test('slice A: a frontend toggle drives the switch and follows the official feed', () => {
  const kit = createHarness()
  const { session, agent } = mountOfficialSession(kit, 's1')
  const planMode = kit.state.pluginApi.sessions.planMode

  // The frontend's badge is fed by the observation face, not by a local mirror.
  const badge = { mode: null, updates: 0 }
  const handle = planMode.observe(agent)
  handle.subscribe((payload) => {
    badge.mode = payload.view.active ? 'plan' : 'default'
    badge.updates += 1
  })

  // The user presses the toggle: the official arbitration decides the result.
  const entered = planMode.select(agent, true)
  assert.equal(entered.code, 'committed')
  kit.emitFact(session, { type: 'plan/mode', active: true })
  assert.equal(badge.mode, 'plan')
  assert.equal(badge.updates, 1)

  const exited = planMode.select(agent, false)
  assert.equal(exited.code, 'committed')
  kit.emitFact(session, { type: 'plan/mode', active: false })
  assert.equal(badge.mode, 'default')
  assert.equal(badge.updates, 2)

  // A switch issued by the official `/plan` command path (never through the
  // facade) reaches the same badge.
  kit.official.service.set(agent, true)
  kit.emitFact(session, { type: 'plan/mode', active: true })
  assert.equal(badge.mode, 'plan')
  assert.equal(badge.updates, 3, 'the badge follows the official fact stream, not the facade')
})

test('slice B: an orchestration consumer constrains itself by the official mode', () => {
  const kit = createHarness()
  const { session, agent } = mountOfficialSession(kit, 's2')
  const planMode = kit.state.pluginApi.sessions.planMode

  // The consumer decides whether it may act on its own, from the official read.
  const mayAct = () => planMode.get(agent).active !== true
  assert.equal(planMode.get(agent).source, 'official')
  assert.equal(mayAct(), true, 'the default mode lets the automation act')

  const handle = planMode.observe(agent)
  const decisions = []
  handle.subscribe((payload) => decisions.push(payload.view.active !== true))

  planMode.select(agent, true)
  kit.emitFact(session, { type: 'plan/mode', active: true })
  assert.deepEqual(decisions, [false], 'entering plan mode suspends the automation')
  assert.equal(mayAct(), false)

  planMode.select(agent, false)
  kit.emitFact(session, { type: 'plan/mode', active: false })
  assert.deepEqual(decisions, [false, true], 'leaving plan mode resumes it')

  // The target closes: the consumer gets a typed degradation, never a guess.
  kit.sessions.delete('s2')
  kit.ctx.emit('session/disposed', session)
  assert.equal(handle.current().source, 'degraded')
  assert.equal(planMode.select(agent, true).code, 'invalid-target')
})
