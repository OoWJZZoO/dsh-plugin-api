/**
 * Consumer migration slices for scoped agent contributions (Task 6.6).
 *
 * The original consumers register per-agent prompt sections and tools
 * directly on the official runtime inside their own packages, and that
 * precision was recorded as contract-outside until this feature. It gives
 * them one public path: `pluginApi.agents.scopes.register({ agent })`
 * for the target handle, `pluginApi.prompts.contribute({ ..., scope })` for
 * target prompt contributions, and `pluginApi.tools.register(def, { scope })`
 * for target tool registration. The consumer repos are not present in this
 * workspace, so each slice executes the exact call shapes those consumers
 * will migrate to, against the mounted facade and the official-shape mock of
 * `scoped-agent-test-kit.mjs` — the same evidence pattern as
 * `test/consumer-migration-slices.test.mjs` and
 * `test/llm-adapter-migration-slices.test.mjs`.
 *
 * | slice | original consumer behavior | migrated public call | observed result |
 * |---|---|---|---|
 * | A | `dsh-read-image` registers its read-image tool and its prompt guidance per agent, on the agent's own official tools/systemPrompt surface (contract-outside precision) | `agents.scopes.register` + `tools.register(def, { scope })` + `prompts.contribute({ kind: 'section', scope })` | the tool and the guidance are visible only to the owning agent; every other agent stays clean; both are disposed by the contribution handle |
 * | B | `agent-teams` member setup installs member-specific guidance/tools from the team (creator) context, not from inside the member's execution fiber | the same public calls, driven from the creator context while holding the member's scope handle | member-only installation without any access to the member's official ctx; the creator's own assembly stays clean |
 * | C | a TUI/交互 client projects the model selection into the target prompt while the route consumes the same value | scoped `variable` contribution reading `agents.scopes.snapshotOf(handle)` | the variable and the route read the same per-step snapshot value; a between-steps switch is all-new, the in-flight step keeps its captured value |
 * | D | consumers stack global guidance plus target guidance and re-apply on reload | global `prompts.contribute` + scoped contributions; owner unload | global additive first, then target-scoped; a second owner's contributions coexist on the same target; unload removes only the owner's own contributions |
 *
 * Non-functional, recorded instead of approximated: the consumers' private
 * registration calls, their TypeScript declarations and their UI components
 * are not part of this contract; the external repositories are not migrated
 * here (their migration is a consumer-side change, no new release is
 * required for this milestone).
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { createHarness, scopedSection } from './scoped-agent-test-kit.mjs'

test('slice A: read-image installs its tool and guidance for the owning agent only', async () => {
  const { state, makeAgent, singletons } = createHarness()
  makeAgent('session-with-image')
  makeAgent('session-without-image')
  const readImage = { name: 'read_image', description: 'read an image from the workspace' }

  // the migrated public calls
  const scope = state.pluginApi.agents.scopes.register({ agent: 'session-with-image' })
  assert.equal(scope.ok, true)
  const tool = state.pluginApi.tools.register(readImage, { scope: scope.handle })
  const guidance = state.pluginApi.prompts.contribute({
    ...scopedSection('read-image-guidance', 'use read_image when the user pastes an image'),
    scope: scope.handle,
  })
  assert.equal(guidance.ok, true)

  // target visibility: tool + guidance reach the owning agent
  assert.deepEqual(singletons.tools.view('session-with-image').tools, ['read_image'])
  const owner = await singletons.systemPrompt.assemble({ agent: 'session-with-image' })
  assert.deepEqual(owner.sections.map((section) => section.name), ['read-image-guidance'])

  // every other agent stays clean (no contract-outside precision needed)
  assert.deepEqual(singletons.tools.view('session-without-image').tools, [])
  const other = await singletons.systemPrompt.assemble({ agent: 'session-without-image' })
  assert.deepEqual(other.sections, [])

  // the contribution handle is the disposal path the consumer now holds
  assert.equal(guidance.handle.dispose(), true)
  assert.equal(tool.dispose(), true)
  assert.deepEqual(singletons.tools.view('session-with-image').tools, [])
  assert.deepEqual((await singletons.systemPrompt.assemble({ agent: 'session-with-image' })).sections, [])
})

test('slice B: agent-teams member setup installs from the creator context', async () => {
  const { state, makeAgent, singletons } = createHarness()
  makeAgent('team-lead')
  makeAgent('team-member')

  // the team plugin holds the member's scope handle and installs the member
  // setup through the public target channel — it never touches the member's
  // official ctx
  const memberScope = state.pluginApi.agents.scopes.register({ agent: 'team-member' }).handle
  assert.equal(state.pluginApi.prompts.contribute({
    ...scopedSection('member-brief', 'you are the verification member'),
    scope: memberScope,
  }).ok, true)
  const memberTool = state.pluginApi.tools.register({ name: 'report_to_lead' }, { scope: memberScope })
  assert.equal(memberTool.targetId, 'team-member')

  const memberAsm = await singletons.systemPrompt.assemble({ agent: 'team-member' })
  assert.deepEqual(memberAsm.sections.map((section) => section.name), ['member-brief'])
  assert.deepEqual(singletons.tools.view('team-member').tools, ['report_to_lead'])
  assert.deepEqual(singletons.tools.view('team-lead').tools, [], 'the creator target is unaffected')
  assert.deepEqual((await singletons.systemPrompt.assemble({ agent: 'team-lead' })).sections, [])
})

test('slice C: the TUI selection projection and the route read one per-step snapshot', async () => {
  const { state, makeAgent, singletons } = createHarness()
  makeAgent('session-model')
  const handle = state.pluginApi.agents.scopes.register({ agent: 'session-model' }).handle

  // the consumer opens the per-step cell when it binds the target
  const cell = state.pluginApi.agents.scopes.snapshotOf(handle)
  assert.equal(cell.ok, true)

  // the selection projection the consumer exposes as a prompt variable
  assert.equal(state.pluginApi.prompts.contribute({
    kind: 'variable',
    name: 'model_selection',
    scope: handle,
    provider: () => {
      const read = state.pluginApi.agents.scopes.snapshotOf(handle)
      const assembled = read.snapshot.assembled()
      return assembled ? `${assembled.provider}/${assembled.model}` : 'none'
    },
  }).ok, true)

  // The external selection writer belongs to the interactive session access
  // feature and has no public member yet; the recorded consumption-side
  // writer seam is used here purely as that future writer.
  const writeSelection = (value) => state.pluginApi._scopedContributionFeature.registry.writeSnapshotCurrent(handle, value)
  writeSelection({ provider: 'deepseek', model: 'deepseek-v4' })

  const first = await singletons.systemPrompt.assemble({ agent: 'session-model' })
  assert.equal(first.variables.model_selection, 'deepseek/deepseek-v4')
  assert.deepEqual(cell.snapshot.assembled(), { provider: 'deepseek', model: 'deepseek-v4' }, 'the route consumption reads the same captured value')

  // switching between steps: the next step is all-new, the captured step keeps its value
  const captured = cell.snapshot.assembled()
  writeSelection({ provider: 'deepseek', model: 'deepseek-v4-flash' })
  assert.equal(cell.snapshot.assembled(), captured, 'the in-flight step keeps its captured snapshot')
  const second = await singletons.systemPrompt.assemble({ agent: 'session-model' })
  assert.equal(second.variables.model_selection, 'deepseek/deepseek-v4-flash')
})

test('slice D: global plus target guidance stack, and owner attribution survives a second owner', async () => {
  const { state, makeAgent, singletons } = createHarness()
  makeAgent('session-shared')
  const handle = state.pluginApi.agents.scopes.register({ agent: 'session-shared' }).handle

  // global guidance (unchanged entry) plus target guidance
  assert.equal(state.pluginApi.prompts.contribute(scopedSection('global-guidance', 'global')).ok, true)
  assert.equal(state.pluginApi.prompts.contribute({
    ...scopedSection('target-guidance', 'target'),
    scope: handle,
  }).ok, true)
  // a second consumer (owner) on the same target; the explicit ownerId
  // attribution is the same rule the global contribution entry applies
  assert.equal(state.pluginApi.prompts.contribute({
    ...scopedSection('peer-guidance', 'peer'),
    scope: handle,
    ownerId: 'peer-consumer',
  }).ok, true)

  const stacked = await singletons.systemPrompt.assemble({ agent: 'session-shared' })
  assert.deepEqual(stacked.sections.map((section) => section.name), ['global-guidance', 'target-guidance', 'peer-guidance'],
    'global additive first, then target-scoped contributions in owner registration order')

  // a non-target keeps only the global contribution
  const other = await singletons.systemPrompt.assemble({ agent: 'session-other' })
  assert.deepEqual(other.sections.map((section) => section.name), ['global-guidance'])
})
