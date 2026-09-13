/**
 * Consumer migration slices for the controlled permission-preset face.
 *
 * The original consumers switch presets by driving the official component
 * directly (the raw `services.permissionPresets` setter before the public
 * contract subtraction, or a direct `set(session, name)` call inside their own
 * packages), which the contract records as an unsupported escape hatch. This
 * feature gives them one public path: `pluginApi.sessions.permissionPresets`
 * (`current`/`options`/`select`/`observe`). The consumer repositories are not
 * present in this workspace, so each slice executes the exact call shapes those
 * consumers will migrate to, against the mounted facade and the official-shape
 * harness — the same evidence pattern as `test/consumer-migration-slices.test.mjs`
 * and `test/llm-adapter-migration-slices.test.mjs`.
 *
 * | slice | original consumer behavior | migrated public call | observed result |
 * |---|---|---|---|
 * | A | a settings panel / TUI renders the preset table and switches through the raw official setter | `options(session)` for the table + `select(session, name)` for the switch + `observe(session)` for the badge | the panel renders only official options, the switch returns the official arbitration verb, and the badge follows the official fact stream, including switches the facade never issued |
 * | B | an orchestration consumer constrains its own behavior by the active preset, reading the official projection or private state | `current(session)` + `observe(session)` | the constraint reads the official preset; a change delivered through the feed re-evaluates it; a closed or unavailable target degrades typed instead of guessing |
 *
 * Non-functional, recorded instead of approximated: the consumers' UI
 * components, their own state stores and their command registrations are not
 * part of this contract; the external repositories are not migrated here
 * (their migration is a consumer-side change, no new release is required for
 * this milestone).
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { createHarness } from './session-permission-presets-test-kit.mjs'

test('slice A: a settings panel renders official options and follows the official feed', async () => {
  const kit = await createHarness()
  const session = kit.createSession('s1')
  const caller = await kit.caller('settings-panel')
  const face = caller.permissions

  // The panel renders exactly the official table (identity, label, bounded text).
  const rendered = face.options(session)
  assert.deepEqual(rendered.options.map((option) => option.value), ['workspace-write', 'danger-full-access'])
  assert.equal(rendered.currentValue, 'workspace-write')
  assert.equal(rendered.options.every((option) => typeof option.name === 'string' && option.name.length > 0), true)

  const badge = { value: null, updates: 0 }
  const handle = face.observe(session)
  handle.subscribe((payload) => {
    badge.value = payload.currentValue
    badge.updates += 1
  })

  // The user picks a row: the official arbitration decides the result.
  assert.equal(face.select(session, 'danger-full-access').code, 'committed')
  assert.equal(badge.value, 'danger-full-access', 'the badge follows the official selection')
  assert.equal(badge.updates >= 1, true)

  // A switch issued outside the facade (the official command path) reaches the
  // same badge.
  const before = badge.updates
  kit.presets.service.set(session, 'workspace-write')
  kit.emitFact(session, 'permission/preset', { preset: 'workspace-write' })
  assert.equal(badge.value, 'workspace-write')
  assert.equal(badge.updates > before, true)

  // Re-selecting the effective preset is the declared idempotent result.
  assert.equal(face.select(session, 'workspace-write').code, 'unchanged')
  handle.dispose()
})

test('slice B: an orchestration consumer constrains itself by the official preset', async () => {
  const kit = await createHarness()
  const session = kit.createSession('s1')
  const caller = await kit.caller('orchestrator')
  const face = caller.permissions

  // The consumer reads the preset to decide whether it may act unattended.
  const mayActUnattended = () => face.current(session).preset !== 'danger-full-access'
  assert.equal(face.current(session).source, 'official')
  assert.equal(mayActUnattended(), true)

  const decisions = []
  const handle = face.observe(session)
  handle.subscribe((payload) => decisions.push(payload.preset !== 'danger-full-access'))

  face.select(session, 'danger-full-access')
  assert.equal(decisions.at(-1), false, 'the no-approval preset suspends unattended work')
  assert.equal(mayActUnattended(), false)

  face.select(session, 'workspace-write')
  assert.equal(decisions.at(-1), true)
  assert.equal(mayActUnattended(), true)

  // The target closes: the consumer gets a typed degradation, never a guess.
  kit.sessions.delete('s1')
  kit.root.emit('session/disposed', session)
  assert.equal(handle.current().source, 'degraded')
  assert.equal(face.select(session, 'workspace-write').code, 'invalid-target')
  handle.dispose()
})
