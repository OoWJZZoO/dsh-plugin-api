/**
 * End-to-end acceptance for the controlled workflow entry (`workflows.start`),
 * through the public facade only.
 *
 * Two layers, deliberately separated:
 * - the **real official engine** (`@deepseek-ai/dsh-workflow-worker-thread`)
 *   proves the real chain end to end (worker execution, synchronous refusal
 *   codes, holder-owned terminal) — always disposed in a `finally` because its
 *   worker thread outlives a settled run;
 * - a probed-shape engine double covers the remaining scenarios
 *   deterministically (it reproduces the official synchronous validation and
 *   the holder-owned run contract without spawning a thread).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'

import { createPluginApiService } from '../lib/plugin-api-service.js'
import { createFeatureRegistry } from '../lib/feature-registry.js'
import { mountWorkflowsFeature } from '../lib/workflows-facade.js'
import WorkflowEngine from '@deepseek-ai/dsh-workflow-worker-thread'

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
const FACT_NAMES = ['workflow/start', 'workflow/phase', 'workflow/log', 'workflow/agent-start', 'workflow/agent-end', 'workflow/end']

/**
 * Probed-shape engine double: the official synchronous validation vocabulary
 * (META_INVALID / SCRIPT_PARSE / INVALID_ARGUMENT / AGENT_START) and the
 * holder-owned run contract, without a worker thread.
 */
function doubleEngine({ behaviour = 'complete' } = {}) {
  const runs = []
  const engine = {
    [Symbol.for('test.workflowEngine.double')]: true,
    start(request) {
      if (typeof request?.meta !== 'object' || request.meta === null || typeof request.meta.name !== 'string' || request.meta.name.length === 0) {
        throw Object.assign(new Error('workflow meta is invalid'), { name: 'WorkflowError', code: 'META_INVALID' })
      }
      if (typeof request.script !== 'string' || request.script.includes('export const meta')) {
        throw Object.assign(new Error('workflow script does not parse'), { name: 'WorkflowError', code: 'SCRIPT_PARSE' })
      }
      if (request.subagentProvider !== undefined && request.subagentProvider !== 'spawn') {
        throw Object.assign(new Error('no subagent provider registered'), { name: 'WorkflowError', code: 'AGENT_START' })
      }
      if (request.maxTotalAgents !== undefined && (!Number.isSafeInteger(request.maxTotalAgents) || request.maxTotalAgents < 1)) {
        throw Object.assign(new Error('maxTotalAgents must be a positive safe integer'), { name: 'WorkflowError', code: 'INVALID_ARGUMENT' })
      }
      const id = `double-run-${runs.length + 1}`
      let resolveResult
      const result = new Promise((resolve) => { resolveResult = resolve })
      const run = {
        id,
        meta: Object.freeze({ ...request.meta }),
        parent: request.parent,
        result,
        cancel(reason) {
          run.cancelReason = reason
          run.cancelled = true
        },
        async dispose() { run.disposed = (run.disposed ?? 0) + 1 },
      }
      runs.push({ run, request })
      // Deterministic terminal per behaviour.
      const settleRun = () => {
        if (behaviour === 'abort') resolveResult({ stopReason: 'cancelled', error: 'cancelled by signal', agentsStarted: 0 })
        else if (behaviour === 'error') resolveResult({ stopReason: 'error', error: 'script exploded', agentsStarted: 1 })
        else resolveResult({ stopReason: 'completed', value: { answer: 42 }, agentsStarted: 1 })
      }
      if (behaviour === 'hold') run.release = () => {
        if (run.cancelled) resolveResult({ stopReason: 'cancelled', error: 'cancelled through the handle', agentsStarted: 0 })
        else settleRun()
      }
      else setImmediate(() => {
        if (request.signal?.aborted) resolveResult({ stopReason: 'cancelled', error: 'aborted before start', agentsStarted: 0 })
        else settleRun()
      })
      return run
    },
  }
  return { engine, runs }
}

async function createHarness(options = {}) {
  const root = new Context()
  const facts = []
  const childStarts = []
  const parent = { id: 'agent-1', session: { id: 's1' } }
  const services = {
    loader: { entries: () => [] },
    subagents: {
      getProvider: (name) => (name === 'spawn' ? { name } : undefined),
      async start(provider, request) {
        // The provider-owned subagent run contract the engine awaits: an id, a
        // never-rejecting result carrying output/stopReason, and dispose.
        childStarts.push({ provider, parent: request?.parent, prompt: request?.prompt })
        return {
          id: `child-${childStarts.length}`,
          result: Promise.resolve({
            output: [{ type: 'text', text: `child ${childStarts.length} says hi` }],
            stopReason: 'completed',
          }),
          dispose: async () => {},
        }
      },
    },
    llm: { resolveModelInfo() {}, prepareCall() {}, stream() {}, registerAdapter() {}, registerConfigurableProviders() {}, registerModelDiscovery() {} },
    tools: { register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {}, executionMode() { return 'mode' } },
    agents: { get: (id) => (id === parent.id ? parent : undefined), list() {}, roots() {} },
    sessions: { get() {}, list() {}, fork() {}, async flush() {} },
    settings: { register() {}, describe() { return [] }, get() {}, mutate() {} },
    systemPrompt: { section() {}, context() {}, variable() {}, tools() {}, suppressRuntimeContext() {}, renderPrompt() {}, renderContextSections() {}, renderContextSnapshot() {}, joinContextSections() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    web: { registerSearchProvider() {}, registerFetchProvider() {} },
  }
  for (const [name, value] of Object.entries(services)) { if (value !== undefined) root.provide(name, value) }
  const double = options.engine ?? null
  if (options.realEngine === true) {
    // The config is passed explicitly: a direct construction bypasses the
    // Cordis Config schema, so the deployment ceiling must be stated here.
    services.workflowEngine = new WorkflowEngine(root, {
      // The full Config: a direct construction bypasses the Cordis schema, so
      // every limit the child path depends on is stated explicitly.
      provider: 'spawn',
      disposeGraceMs: 200,
      maxTotalAgents: 1000,
      maxConcurrentAgents: 0,
      maxItemsPerCall: 4096,
      syncTimeoutMs: 5000,
    })
  } else if (double !== null && options.noEngine !== true) {
    root.provide('workflowEngine', double.engine)
  }
  if (options.shapeMismatch === true) root.provide('workflowEngine', { start: 'not-a-function' })
  // A mutable registration seam for the recovery scenario (the facade re-probes
  // the engine on every read).
  const engineRegistration = {
    set(value) { root.provide('workflowEngine', value) },
    clear() { services.workflowEngine = undefined },
  }
  for (const name of FACT_NAMES) root.on(name, (info, ...rest) => facts.push({ name, info, rest }))

  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: () => true })
  root.plugin(ServiceClass)
  await settle()
  const service = root.pluginApi
  const mounted = options.noMount === true
    ? null
    : mountWorkflowsFeature({ ctx: root, service, featureRegistry: registry, logger: { warn() {} } })
  mounted?.prepared?.commit?.()
  if (mounted) registry.mount('workflows')
  return { root, service, registry, facts, childStarts, parent, mounted, double, engineRegistration }
}

const faceOf = (kit) => kit.root.pluginApi.workflows

/** Mount one calling plugin and hand back the faces it receives. */
async function callerFaces(kit, name) {
  const faces = []
  class CallerPlugin {
    static inject = ['pluginApi']
    constructor(ctx) {
      faces.push({ name, ctx, workflows: ctx.pluginApi.workflows })
    }
  }
  Object.defineProperty(CallerPlugin, 'name', { value: name })
  kit.root.plugin(CallerPlugin)
  await settle()
  return faces.find((entry) => entry.name === name)
}
const request = (kit, extra = {}) => ({
  script: 'return { answer: 42 }',
  meta: { name: 'probe', description: 'probe workflow' },
  parent: kit.parent,
  ...extra,
})

test('the real engine executes the run and the facade maps its terminal', async () => {
  const kit = await createHarness({ realEngine: true })
  let handle = null
  try {
    const face = faceOf(kit)
    assert.equal(face.availability().status, 'active')
    const outcome = face.start(request(kit, { args: { value: 1 } }))
    assert.equal(outcome.ok, true)
    assert.equal(outcome.code, 'started')
    assert.deepEqual(Object.keys(outcome).sort(), ['code', 'ok', 'operation'], 'the control handle rides the operation member')
    assert.equal('handle' in outcome, false)
    assert.equal('terminal' in outcome, false, 'an accepted-but-undecided start carries no terminal')
    handle = outcome.operation
    assert.equal(typeof handle.id, 'string')
    assert.equal(typeof handle.ownerId, 'string')
    assert.equal(Object.isFrozen(handle.meta), true)
    assert.equal(handle.meta.name, 'probe')

    const terminal = await handle.result
    assert.equal(terminal.ok, true)
    assert.equal(terminal.terminal, 'success')
    assert.deepEqual(terminal.value, { answer: 42 })
    assert.equal(handle.status().state, 'settled')
    assert.equal(handle.status().terminal, 'success', 'the settled state reports the unified terminal vocabulary')

    const started = kit.facts.filter((entry) => entry.name === 'workflow/start')
    const ended = kit.facts.filter((entry) => entry.name === 'workflow/end')
    assert.equal(started.length, 1)
    assert.equal(started[0].info.id, handle.id)
    assert.equal(ended.length, 1)
    assert.equal(ended[0].rest[0].stopReason, 'completed')
    assert.equal(ended[0].rest[0].value, undefined, 'the end fact never carries the script value')
  } finally {
    handle?.dispose()
  }
})

test('the real engine refuses a non-parsing body synchronously with the official code', async () => {
  const kit = await createHarness({ realEngine: true })
  const refusal = faceOf(kit).start({ ...request(kit), script: 'export const meta = { name: "x" }' })
  assert.equal(refusal.ok, false)
  assert.equal(refusal.code, 'SCRIPT_PARSE')
  assert.equal(kit.facts.length, 0)
})

test('a started run delivers the mapped terminal for every outcome', async () => {
  for (const [behaviour, expected] of [['complete', 'success'], ['error', 'error'], ['abort', 'aborted']]) {
    const double = doubleEngine({ behaviour })
    const kit = await createHarness({ engine: double })
    const outcome = faceOf(kit).start(request(kit))
    assert.equal(outcome.ok, true)
    const terminal = await outcome.operation.result
    assert.equal(terminal.terminal, expected)
    if (behaviour === 'complete') assert.deepEqual(terminal.value, { answer: 42 })
    if (behaviour === 'error') assert.match(String(terminal.error), /script exploded/)
    if (behaviour === 'abort') assert.equal(terminal.stopReason, 'cancelled')
    assert.equal(outcome.operation.status().state, 'settled')
    outcome.operation.dispose()
  }
})

test('a repeated start creates a new run identity', async () => {
  const kit = await createHarness({ engine: doubleEngine() })
  const first = faceOf(kit).start(request(kit))
  const second = faceOf(kit).start(request(kit))
  assert.notEqual(first.operation.id, second.operation.id, 'an external repeat creates a new run, never a merged identity')
  assert.equal((await first.operation.result).terminal, 'success')
  assert.equal((await second.operation.result).terminal, 'success')
  first.operation.dispose()
  second.operation.dispose()
})

test('the parent must be a live agent reference and reaches the engine unchanged', async () => {
  const double = doubleEngine()
  const kit = await createHarness({ engine: double })
  const face = faceOf(kit)
  assert.equal(face.start({ ...request(kit), parent: 'agent-1' }).code, 'invalid-request', 'a bare id is not a reference')
  assert.equal(face.start({ ...request(kit), parent: { id: 'agent-1', session: { id: 's1' } } }).code, 'parent-unresolved', 'a self-made object is refused')
  assert.equal(face.start({ ...request(kit), parent: { id: 'ghost', session: { id: 's1' } } }).code, 'parent-unresolved')
  assert.equal(double.runs.length, 0, 'no refusal reached the engine')

  const started = face.start(request(kit))
  assert.equal(started.ok, true)
  assert.equal(double.runs[0].request.parent, kit.parent, 'the verified live agent itself is forwarded')
  started.operation.dispose()
})

test('the request-shape refusals never reach the engine', async () => {
  const double = doubleEngine()
  const kit = await createHarness({ engine: double })
  const face = faceOf(kit)
  assert.equal(face.start(null).code, 'invalid-request')
  assert.equal(face.start({}).code, 'invalid-request')
  assert.equal(face.start({ ...request(kit), script: '' }).code, 'invalid-request')
  assert.equal(face.start({ ...request(kit), maxTotalAgents: 1.5 }).code, 'invalid-request')
  assert.equal(double.runs.length, 0)
})

test('the official synchronous refusal codes pass through unchanged', async () => {
  const kit = await createHarness({ engine: doubleEngine() })
  const face = faceOf(kit)
  assert.equal(face.start({ ...request(kit), meta: { name: '' } }).code, 'META_INVALID')
  assert.equal(face.start({ ...request(kit), script: 'export const meta = { name: "x" }' }).code, 'SCRIPT_PARSE')
  assert.equal(face.start({ ...request(kit), subagentProvider: 'missing' }).code, 'AGENT_START')
  assert.equal(face.start({ ...request(kit), maxTotalAgents: 0 }).code, 'INVALID_ARGUMENT')
  assert.equal(kit.facts.length, 0, 'a refused request publishes no workflow fact')
})

test('cancellation is a signal and the handle stays bound to its own run', async () => {
  const double = doubleEngine({ behaviour: 'hold' })
  const kit = await createHarness({ engine: double })
  const first = faceOf(kit).start(request(kit))
  const second = faceOf(kit).start(request(kit))
  first.operation.cancel('user asked')
  assert.equal(double.runs[0].run.cancelReason, 'user asked')
  assert.equal(double.runs[1].run.cancelReason, undefined, 'a handle never reaches another run')

  first.operation.cancel('again')
  double.runs[0].run.release()
  double.runs[1].run.release()
  assert.equal((await first.operation.result).terminal, 'aborted', 'the engine adjudicates the cancelled run')
  assert.equal((await second.operation.result).terminal, 'success', 'the other run keeps its own terminal')
  first.operation.dispose()
  second.operation.dispose()
})

test('observation is run-scoped and cancel/dispose are idempotent', async () => {
  const double = doubleEngine({ behaviour: 'hold' })
  const kit = await createHarness({ engine: double })
  const outcome = faceOf(kit).start(request(kit))
  const seen = []
  outcome.operation.observe((event) => seen.push(event.name))
  // Facts for this run and for an unrelated run.
  kit.root.emit('workflow/phase', { id: outcome.operation.id }, 'one')
  kit.root.emit('workflow/phase', { id: 'other-run' }, 'two')
  assert.deepEqual(seen, ['workflow/phase'], 'only this run identity reaches the observer')

  const stopped = outcome.operation.dispose()
  assert.deepEqual({ ...stopped }, { ok: true, code: 'requested' })
  assert.equal(Object.isFrozen(stopped), true)
  assert.deepEqual({ ...outcome.operation.dispose() }, { ok: false, code: 'stale', reason: 'the stop was already requested' })
  assert.equal(double.runs[0].run.disposed, 1, 'dispose is idempotent and reaches the engine once')
  double.runs[0].run.release()
  assert.equal((await outcome.operation.result).terminal, 'success')
  assert.equal(outcome.operation.status().terminal, 'success')
})

test('the engine seam absence degrades this feature alone', async () => {
  const kit = await createHarness({ noEngine: true })
  const face = faceOf(kit)
  assert.equal(face.availability().status, 'unavailable')
  assert.throws(() => face.start(request(kit)), (error) => error?.name === 'PluginApiFeatureDisabledError')
  assert.equal(typeof kit.root.pluginApi.tools.register, 'function')
  assert.equal(typeof kit.root.pluginApi.sessions.get, 'function')
})

test('the facade subscribes to the six registered workflow facts and scopes them per run', async () => {
  const double = doubleEngine({ behaviour: 'hold' })
  const kit = await createHarness({ engine: double })
  const outcome = faceOf(kit).start(request(kit))
  const runId = outcome.operation.id
  // The double does not dispatch engine facts, so the six registered names are
  // delivered explicitly; the real-engine test above is the dispatch evidence
  // (it observes start/end from the engine itself).
  kit.root.emit('workflow/start', { id: runId })
  for (const name of FACT_NAMES) {
    if (name === 'workflow/start' || name === 'workflow/end') continue
    kit.root.emit(name, { id: runId }, name === 'workflow/phase' ? 'title' : 'payload')
  }
  double.runs[0].run.release()
  await outcome.operation.result
  kit.root.emit('workflow/end', { id: runId }, { stopReason: 'completed', agentsStarted: 0 })
  const names = new Set(kit.facts.map((entry) => entry.name))
  for (const name of FACT_NAMES) assert.equal(names.has(name), true, `${name} is observable`)
  assert.equal(kit.facts.every((entry) => entry.name.startsWith('workflow/')), true)
  outcome.operation.dispose()
})

test('the real engine refuses every cannot-begin case synchronously with its official code', async () => {
  const kit = await createHarness({ realEngine: true })
  const face = faceOf(kit)
  assert.equal(face.start({ ...request(kit), meta: { name: '' } }).code, 'META_INVALID')
  assert.equal(face.start({ ...request(kit), script: 'export const meta = { name: "x" }' }).code, 'SCRIPT_PARSE')
  assert.equal(face.start({ ...request(kit), subagentProvider: 'not-registered' }).code, 'AGENT_START')
  assert.equal(face.start({ ...request(kit), maxTotalAgents: 0 }).code, 'INVALID_ARGUMENT')
  assert.equal(face.start({ ...request(kit), maxTotalAgents: 10 ** 9 }).code, 'INVALID_ARGUMENT')
  assert.equal(kit.facts.length, 0, 'a refused request publishes no workflow fact')
})

test('the real engine invokes a child agent attributed to the verified parent', async () => {
  const kit = await createHarness({ realEngine: true })
  let handle = null
  try {
    const outcome = faceOf(kit).start(request(kit, {
      // The engine flattens the child's text blocks into the value `agent()` resolves.
      script: 'const childText = await agent("do the thing")\nreturn { childText }',
    }))
    assert.equal(outcome.ok, true)
    handle = outcome.operation
    const terminal = await handle.result
    assert.equal(terminal.terminal, 'success')
    assert.equal(kit.childStarts.length, 1, 'the script really invoked the subagent seam')
    assert.equal(kit.childStarts[0].parent, kit.parent, 'the child start carries the verified parent agent')
    assert.equal(terminal.value?.childText, 'child 1 says hi', 'the child result reaches the script')
    assert.equal(terminal.agentsStarted, 1)
    const names = kit.facts.map((entry) => entry.name)
    assert.equal(names.includes('workflow/agent-start'), true, 'the engine dispatches the child lifecycle facts')
    assert.equal(names.includes('workflow/agent-end'), true)
  } finally {
    handle?.dispose()
  }
})

test('the caller-supplied args and correlation data reach the engine unchanged', async () => {
  const double = doubleEngine()
  const kit = await createHarness({ engine: double })
  const outcome = faceOf(kit).start(request(kit, { args: { value: 7, nested: { a: 1 } } }))
  assert.equal(outcome.ok, true)
  assert.deepEqual(double.runs[0].request.args, { value: 7, nested: { a: 1 } })
  outcome.operation.dispose()
})

test('a pre-aborted signal and an explicit cancel both settle as aborted', async () => {
  const double = doubleEngine({ behaviour: 'hold' })
  const kit = await createHarness({ engine: double })
  const controller = new AbortController()
  controller.abort()
  const outcome = faceOf(kit).start(request(kit, { signal: controller.signal }))
  assert.equal(outcome.ok, true, 'an aborted signal is a cancellation, not a refusal')
  assert.equal(double.runs[0].request.signal, controller.signal, 'the caller signal is forwarded verbatim')
  assert.equal(double.runs[0].request.signal.aborted, true)
  double.runs[0].run.cancel('workflow start signal already aborted')
  double.runs[0].run.release()
  const terminal = await outcome.operation.result
  assert.equal(terminal.terminal, 'aborted')
  assert.equal(terminal.stopReason, 'cancelled')
  outcome.operation.dispose()
})

test('cancel after settlement is a no-op and never rewrites the terminal', async () => {
  const double = doubleEngine()
  const kit = await createHarness({ engine: double })
  const outcome = faceOf(kit).start(request(kit))
  const terminal = await outcome.operation.result
  assert.equal(terminal.terminal, 'success')
  outcome.operation.cancel('too late')
  assert.equal(double.runs[0].run.cancelReason, 'too late', 'the cancel is delegated as a signal')
  assert.equal((await outcome.operation.result).terminal, 'success', 'the settled terminal is never rewritten')
  outcome.operation.dispose()
})

test('an engine with the wrong shape degrades typed, and the namespace recovers when it appears', async () => {
  const double = doubleEngine()
  // The harness starts without an engine: the probe reports unavailable and the
  // entry is refused typed.
  const kit = await createHarness({ noEngine: true })
  assert.equal(faceOf(kit).availability().status, 'unavailable')
  assert.throws(() => faceOf(kit).start(request(kit)), (error) => error?.name === 'PluginApiFeatureDisabledError')
  // The engine appears at runtime: availability recovers without a remount.
  kit.engineRegistration.set(double.engine)
  assert.equal(faceOf(kit).availability().status, 'active')
  const outcome = faceOf(kit).start(request(kit))
  assert.equal(outcome.ok, true)
  outcome.operation.dispose()

  // An object that exists but is not a usable engine is refused too.
  const mismatch = await createHarness({ shapeMismatch: true })
  assert.equal(faceOf(mismatch).availability().status, 'unavailable')
  assert.throws(() => faceOf(mismatch).start(request(mismatch)), (error) => error?.name === 'PluginApiFeatureDisabledError')

  // A thenable is never accepted as an engine.
  const thenable = await createHarness({ noEngine: true })
  thenable.engineRegistration.set({ start() {}, then() {} })
  assert.equal(faceOf(thenable).availability().status, 'unavailable')
})

test('an unmounted feature keeps its member set and answers typed', async () => {
  const kit = await createHarness({ noMount: true })
  const face = faceOf(kit)
  assert.deepEqual(Object.keys(face).sort(), ['availability', 'start'])
  assert.equal(face.availability().status, 'unavailable')
  assert.throws(() => face.start(request(kit)), (error) => error?.name === 'PluginApiFeatureDisabledError')
})

test('two calling plugins receive their own sub-surface and own their runs', async () => {
  const double = doubleEngine({ behaviour: 'hold' })
  const kit = await createHarness({ engine: double })
  const first = await callerFaces(kit, 'CallerA')
  const second = await callerFaces(kit, 'CallerB')
  assert.notEqual(first.workflows, second.workflows, 'each caller receives its own materialized sub-surface')

  const runA = first.workflows.start(request(kit))
  const runB = second.workflows.start(request(kit))
  assert.equal(runA.operation.ownerId, 'CallerA')
  assert.equal(runB.operation.ownerId, 'CallerB')
  assert.notEqual(runA.operation.id, runB.operation.id)

  // Each owner's cancel reaches only its own run.
  runA.operation.cancel('A stops')
  assert.equal(double.runs[0].run.cancelReason, 'A stops')
  assert.equal(double.runs[1].run.cancelReason, undefined)
  double.runs[0].run.release()
  double.runs[1].run.release()
  assert.equal((await runA.operation.result).terminal, 'aborted')
  assert.equal((await runB.operation.result).terminal, 'success')
  runA.operation.dispose()
  runB.operation.dispose()
})

test('the real engine mints an official UUID run identity', async () => {
  const kit = await createHarness({ realEngine: true })
  let handle = null
  try {
    const outcome = faceOf(kit).start(request(kit))
    handle = outcome.operation
    assert.match(handle.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, 'the official engine mints the run identity')
    await handle.result
  } finally {
    handle?.dispose()
  }
})

test('unmounting and an inert core keep the namespace typed and retire old handles', async () => {
  const double = doubleEngine({ behaviour: 'hold' })
  const kit = await createHarness({ engine: double })
  const outcome = faceOf(kit).start(request(kit))
  const handle = outcome.operation
  assert.equal(handle.status().state, 'running')

  // The assembly's unload sequence: slot rollback, then owner cleanup.
  assert.equal(kit.mounted.prepared.rollback(), true)
  const after = faceOf(kit)
  assert.deepEqual(Object.keys(after).sort(), ['availability', 'start'])
  assert.equal(after.availability().status, 'unavailable')
  assert.throws(() => after.start(request(kit)), (error) => error?.name === 'PluginApiFeatureDisabledError')

  // An old handle still settles its own run: the rollback never reaches it, and
  // its operations cannot touch another run.
  double.runs[0].run.release()
  assert.equal((await handle.result).terminal, 'success')
  handle.dispose()
})

test('an inert core keeps the member set and answers typed without throwing on availability', async () => {
  const kit = await createHarness({ engine: doubleEngine() })
  const previous = process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL
  process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL = '1'
  try {
    kit.service.reconcile({ registry: kit.service._registry, coreActive: () => false })
    const face = faceOf(kit)
    assert.deepEqual(Object.keys(face).sort(), ['availability', 'start'])
    assert.equal(face.availability().status, 'unavailable')
    assert.throws(() => face.start(request(kit)), (error) => error?.name === 'PluginApiInactiveError')
  } finally {
    if (previous === undefined) delete process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL
    else process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL = previous
  }
})
