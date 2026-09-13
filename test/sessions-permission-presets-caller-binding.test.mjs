/**
 * Caller-binding regression for `sessions.permissionPresets`, on a real cordis
 * tree.
 *
 * The facade's session sub-face is caller-bound: the selection member derives
 * its owner from the calling plugin's fiber. That only works when cordis can
 * hand the accessing context to the namespace accessor as its receiver — which
 * is why the `sessions` getter is method-style, like the `agents`/`llm`/`events`
 * faces. A mock harness cannot observe that receiver semantics, so this file
 * mounts the real service through `@deepseek-ai/cordis` and asserts the
 * consequence: two calling plugins get two distinct sub-surfaces and their
 * selections are attributed to themselves in the authority audit.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { createHarness } from './session-permission-presets-test-kit.mjs'

test('two calling plugins receive distinct permission-preset sub-surfaces and own their selections', async () => {
  let feature = null
  const kit = await createHarness({ onFeature: (mounted) => { feature = mounted } })
  const session = kit.createSession('s1')

  const a = await kit.caller('CallerA')
  const b = await kit.caller('CallerB')

  assert.ok(a?.permissions && b?.permissions, 'both callers received the sub-face')
  assert.notEqual(a.permissions, b.permissions, 'each caller receives its own materialized sub-surface')
  assert.deepEqual(Object.keys(a.permissions).sort(), ['availability', 'current', 'observe', 'options', 'select'])

  // Selection through the public face, attributed per caller.
  assert.equal(a.permissions.select(session, 'danger-full-access').code, 'committed')
  assert.equal(b.permissions.select(session, 'workspace-write').code, 'committed')
  assert.deepEqual(
    feature.authority.audit().records.map((record) => [record.ownerId, record.outcome]),
    [
      ['CallerA', 'attempt'], ['CallerA', 'committed'],
      ['CallerB', 'attempt'], ['CallerB', 'committed'],
    ],
    'ownership is derived from the accessing plugin, never from the facade',
  )

  // A caller context with no plugin identity is refused typed.
  const anonymous = kit.service._sessionPermissionPresetsSlot.api.surfaceFor({})
  assert.equal(anonymous.select(session, 'workspace-write').code, 'denied')
})
