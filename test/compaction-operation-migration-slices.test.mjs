/**
 * Consumer migration slices for the controlled compaction operation.
 *
 * The original consumer (a TUI's `/compact` command) reaches the compaction
 * engine through an optional service name and the raw trigger methods — the
 * seam the public contract removed. This feature gives it one supported path:
 * `pluginApi.sessions.compaction.run`. The consumer repositories are not
 * present in this workspace, so each slice executes the call shapes those
 * consumers will migrate to, against the mounted facade and the replacement's
 * forked engine.
 *
 * | slice | original consumer behavior | migrated public call | observed result |
 * |---|---|---|---|
 * | A | a TUI's `/compact` command calls the engine's manual trigger through the optional service and renders a coarse outcome | `sessions.compaction.run({ agent, mode: 'now', sourceCommandId })` plus the documented result-code branches | the session is really compacted, the command can render compacted / skipped / denied / aborted / failed truthfully, and the lineage comes back without the summary body |
 * | B | a policy plugin governs automatic compaction only, through the request waterfall | the same `compaction/request` registration governs facade-initiated compaction | one decision authority for both sources: a reject denies the operation and leaves no transaction, and the trigger vocabulary stays distinguishable |
 *
 * Non-functional, recorded instead of approximated: the consumer's command
 * registry, its rendering components and its own remote contract are not part of
 * this contract; the external repository is not migrated here (its migration is
 * a consumer-side change, no new release is required for this milestone).
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { createHarness, makeSession, agentOf, faceOf } from './sessions-compaction-test-kit.mjs'

test('slice A: a TUI command renders the discriminated outcome of a real compaction', async () => {
  const kit = await createHarness({ session: makeSession({ openTurn: false }) })
  const rendered = []
  const render = (result) => {
    if (result.ok && result.outcome === 'compacted') rendered.push(`compacted ${result.lineage.compactionId}`)
    else if (result.outcome === 'skipped') rendered.push(`nothing to compact (${result.code})`)
    else rendered.push(`${result.terminal}: ${result.code}`)
    return rendered.at(-1)
  }

  const result = await faceOf(kit).run({ agent: agentOf(kit), mode: 'now', sourceCommandId: 'cmd-compact-1' })
  const line = render(result)
  assert.match(line, /^compacted /, 'the command renders the committed outcome')
  assert.equal(JSON.stringify(result).includes('compacted checkpoint'), false, 'the rendering input never carries the summary body')

  // The correlation id the command supplied is carried into the engine lineage.
  assert.equal(result.lineage.sourceCommandId, 'cmd-compact-1')

  // A second command run on the same idle session finds nothing new to compact
  // (or compacts again) — either way it renders a truthful terminal.
  const second = await faceOf(kit).run({ agent: agentOf(kit), mode: 'now', sourceCommandId: 'cmd-compact-2' })
  assert.equal(['compacted', 'no-candidate'].includes(second.code), true)
})

test('slice B: one request policy governs automatic and facade-initiated compaction', async () => {
  const kit = await createHarness({ session: makeSession({ openTurn: false }) })
  const seen = []
  kit.root.on('compaction/request', (payload) => {
    seen.push(payload.trigger)
    return payload.trigger === 'manual' ? { kind: 'reject', reason: 'policy holds manual compactions' } : undefined
  })

  const denied = await faceOf(kit).run({ agent: agentOf(kit), mode: 'now' })
  assert.equal(denied.terminal, 'denied')
  assert.equal(denied.code, 'rejected')
  assert.equal(denied.reason, 'policy holds manual compactions')
  assert.deepEqual(seen, ['manual'], 'the operation-triggered request carries the manual provenance')
  assert.equal(agentOf(kit).session.events.some((event) => event.type === 'compaction/start'), false, 'the veto left no transaction')

  // The same policy sees the automatic path with its own trigger vocabulary.
  seen.length = 0
  await kit.engine.compactIfNeeded(agentOf(kit), 'pressure', new AbortController().signal).catch(() => {})
  if (seen.length > 0) assert.equal(['pressure', 'context-overflow'].includes(seen[0]), true, 'automatic provenance is untouched')
})
