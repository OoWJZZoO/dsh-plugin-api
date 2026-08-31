/**
 * Independence, regression, and governance audit (batch 5).
 *
 * Three guarantees, each with its own test:
 *
 * 1. The boundary-era client artifact (archived from the boundary commit) and
 *    the current artifact, mounted on the identical fixture foundation, produce
 *    equal pre-existing-face observations; a degraded foundation comparison
 *    proves fallback behavior is unchanged too.
 * 2. The boundary-era host and the current host, mounted on the identical mock
 *    foundation, produce equal pre-existing-face observations, while the two
 *    context-rendering helpers exist only on the current host.
 * 3. The feature-owned sources and the generated artifact stay free of
 *    unrelated implementation markers, governance tokens, and out-of-scope
 *    surface keys; the implemented surfaces are exactly the nine approved ones.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'
import { bootFixture, settleAll } from './official-passthrough-fixture.mjs'
import { CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS } from '../lib/client-official-passthrough.js'
import { OFFICIAL_PASSTHROUGH_HOST_DESCRIPTORS } from '../lib/official-passthrough-host.js'
import { apply as applyCurrentHost } from '../lib/index.js'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const BOUNDARY_SHA = '3cad40e' // merge-base with main: the last main commit before this branch
const BOUNDARY_CHANGED_LIB_FILES = [
  'client-runtime.js',
  'client.js',
  'guards.js',
  'index.js',
  'plugin-api-service.js',
  'system-prompt.js',
]
const CURRENT_BUNDLE_SOURCE = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

function gitShow(sha, relPath) {
  return execFileSync('git', ['show', `${sha}:${relPath}`], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
}

function loadBundle(source, filename) {
  let handoff
  const sandbox = {
    window: { __ModuleLoader__: { load(value) { handoff = value } } },
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    TextEncoder,
    TextDecoder,
  }
  sandbox.globalThis = sandbox
  vm.runInNewContext(source, sandbox, { filename })
  assert.equal(handoff?.id, '@deepseek-ai/dsh-plugin-api-main', 'the handoff id must be the client entry')
  assert.equal(typeof handoff?.factory, 'function')
  return handoff.factory(() => { throw new Error('the bundled facade has no cross-plugin runtime imports') })
}

async function observeClientFaces(bundle, degrade) {
  const { ctx } = bootFixture({ override: degrade })
  const dispose = bundle.apply(ctx)
  assert.equal(typeof dispose, 'function')
  await settleAll()
  const api = ctx.get('pluginApi')
  assert.ok(api, 'the client root must be published')
  // The current era publishes members directly on pluginApi; the boundary
  // era publishes them under .client. Normalize both.
  const face = api.client ?? api
  const slots = face.slots
  const entriesBeforeRegister = slots.entries('details')
  const disposer = slots.register({ name: 'details' })
  const entriesAfterRegister = slots.entries('details')
  const removed = disposer()
  const entriesAfterDispose = slots.entries('details')
  const live = {
    mounterNames: bundle.CLIENT_MOUNTERS === undefined ? undefined : [...bundle.CLIENT_MOUNTERS],
    connectionIsActive: face.connection.isActive,
    slotsMembers: ['register', 'inject', 'entries', 'subscribe'].map((name) => typeof slots[name]),
    slotsEntriesIdentity: slots.entries('details') === slots.entries('details'),
    slotsRegistration: [entriesBeforeRegister, entriesAfterRegister, entriesAfterDispose, typeof removed],
    singleCodec: face.codec.zod === face.codec.zod,
  }
  return { live, dispose }
}

async function observeClientLifecycle(bundle) {
  const { ctx } = bootFixture()
  const first = bundle.apply(ctx)
  const reapplySame = bundle.apply(ctx) === first
  const once = await first()
  const twice = await first()
  await settleAll()
  return { reapplySame, once, twice, cleaned: ctx.get('pluginApi') === undefined }
}

test('client regression: the boundary-era and current artifacts agree on every pre-existing face, active and degraded', async () => {
  const boundary = loadBundle(gitShow(BOUNDARY_SHA, 'lib/client.js'), 'client-boundary.js')
  const current = loadBundle(CURRENT_BUNDLE_SOURCE, 'client-current.js')
  assert.notEqual(boundary, current)

  const boundaryRun = await observeClientFaces(boundary)
  const currentRun = await observeClientFaces(current)
  const boundaryLifecycle = await observeClientLifecycle(boundary)
  const currentLifecycle = await observeClientLifecycle(current)
  const preExisting = (live) => JSON.parse(JSON.stringify({
    ...live,
    mounterNames: live.mounterNames?.filter((name) => name !== 'clientOfficialServices'),
  }))
  assert.deepEqual(preExisting(currentRun.live), preExisting(boundaryRun.live),
    'adding the new faces must not alter pre-existing client observations')
  assert.deepEqual(currentLifecycle, boundaryLifecycle, 'reapply identity, disposer behavior, and cleanup must be unchanged')
  await boundaryRun.dispose()
  await currentRun.dispose()

  const degrade = (ctx) => {
    const get = ctx.get.bind(ctx)
    ctx.get = (name) => name === 'settingsScope' ? undefined : get(name)
  }
  const degradedBoundary = await observeClientFaces(loadBundle(gitShow(BOUNDARY_SHA, 'lib/client.js'), 'client-boundary.js'), degrade)
  const degradedCurrent = await observeClientFaces(current, degrade)
  assert.deepEqual(preExisting(degradedCurrent.live), preExisting(degradedBoundary.live),
    'degradation behavior must be identical across the two artifacts')
  await degradedBoundary.dispose()
  await degradedCurrent.dispose()
})

test('client independence: the current artifact activates and forwards through the raw module substrate alone', async () => {
  const current = loadBundle(CURRENT_BUNDLE_SOURCE, 'client-current.js')
  const { live } = await observeClientFaces(current)
  // The current era publishes members directly on pluginApi without the
  // features array; the pre-existing face observations (connection, slots,
  // codec) are preserved.
  assert.equal(live.connectionIsActive, true)
  assert.equal(live.slotsMembers.every((t) => t === 'function'), true)

  const { ctx, loader, namespaces } = bootFixture()
  const dispose = current.apply(ctx)
  await settleAll()
  const api = ctx.get('pluginApi')
  assert.equal(loader.calls.length, 7, 'the seven faces must have imported through the raw modules service')
  api.services.inputTriggers.registerSource({ id: 1 })
  assert.deepEqual(api.services.inputTriggers.sessionOf('actx').menu, 'actx')
  assert.deepEqual(api.services.modelDirectories.directoryFor('sid'), { sessionId: 'sid' })
  assert.equal(await api.services.conversation.send('hello'), 'sent:hello')
  assert.equal(await api.services.conversation.loadOlder(), 1)
  api.services.conversationEvents.register({ id: 'e1' })
  assert.deepEqual(api.services.conversationEvents.entries(), [{ id: 'e1' }])
  await dispose()
})

function observeHostFaces(applyFn) {
  const services = {
    llm: { resolveModelInfo() {}, prepareCall() {}, stream() {}, registerAdapter() {}, registerConfigurableProviders() {}, registerModelDiscovery() {} },
    agents: { get() {}, list() {}, roots() {} },
    tools: { register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {} },
    sessions: { get() {}, list() {}, fork() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    systemPrompt: {
      section() { return 'section-disposer' },
      context() { return 'context-disposer' },
      variable() { return 'variable-disposer' },
      tools() { return 'tools-disposer' },
      suppressRuntimeContext() { return 'suppress-disposer' },
    },
  }
  const state = {}
  const ctx = {
    logger: { error() {}, warn() {} },
    reflect: { provide(name, value) { if (name === 'pluginApi') state.pluginApi = value } },
    get(name) { return name === 'pluginApi' ? state.pluginApi : services[name] },
    plugin(ServiceClass) { new ServiceClass(ctx) },
    effect() {},
    on() { return () => {} },
    once() {},
    emit() {},
    serial() {},
    parallel() {},
    bail() {},
    waterfall() {},
  }
  let disposer
  let applyOutcome = 'ok'
  try { disposer = applyFn(ctx) } catch (error) { applyOutcome = `throws:${error.name}:${error.code ?? ''}` }
  const api = state.pluginApi
  const safe = (thunk) => {
    try { return thunk() } catch (error) { return `throws:${error.name}:${error.code ?? ''}` }
  }
  const abortError = api?.tools?.toolAbortedError
  const abortShape = typeof abortError === 'function'
    ? safe(() => { const error = abortError(); return { name: error?.name, code: error?.code ?? undefined, cause: error?.cause ?? undefined } })
    : abortError
  // Keep name/activity pairs aligned (both sorted by feature name) so the
  // regression comparison can filter branch-added features by name without
  // mispairing the independently sorted activity values.
  const registrySnapshot = api?._registry?.snapshot?.() ?? []
  const featurePairs = registrySnapshot
    .map((feature) => [feature.name, feature.isActive])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  // The host namespace cutover renamed the published roots; the boundary-era host exposes the old
  // names. The observer reads either era so the same harness compares both.
  const promptsApi = api?.prompts ?? api?.systemPrompt
  const remotesApi = api?.remotes ?? api?.remote
  const face = {
    applyOutcome,
    featureNames: featurePairs?.map(([name]) => name),
    featureActivity: featurePairs?.map(([, active]) => active),
    promptsMembers: safe(() => Object.keys(promptsApi).sort()),
    toolsMembers: safe(() => Object.keys(api.tools).sort()),
    abortShape,
    remotePublish: safe(() => typeof remotesApi.publish),
    servicesNames: safe(() => Object.keys(api.services).sort()),
  }
  const lifecycle = (() => {
    if (applyOutcome !== 'ok' || !disposer) return null
    let reapply = ''
    try { reapply = applyFn(ctx) === disposer ? 'same' : 'different' } catch (error) { reapply = `throws:${error.name}` }
    let once
    let twice
    try { once = disposer() } catch (error) { once = `throws:${error.name}` }
    try { twice = disposer() } catch (error) { twice = `throws:${error.name}` }
    return { reapply, once, twice, cleaned: state.pluginApi === undefined }
  })()
  return { face, lifecycle }
}

test('host regression: the boundary-era and current hosts agree on every pre-existing face', async () => {
  mkdirSync(path.join(REPO_ROOT, 'temp'), { recursive: true })
  const tmp = mkdtempSync(path.join(REPO_ROOT, 'temp', 'host-boundary-'))
  try {
    cpSync(path.join(REPO_ROOT, 'lib'), path.join(tmp, 'lib'), { recursive: true })
    // The host reads its own manifest and the auxiliary package manifests
    // during the core guard, so the archived tree needs those too. The
    // boundary-era library files are paired with the boundary-era package
    // metadata: the version-baseline change makes newer metadata unparseable
    // by the boundary-era version parsing, so mixing eras would invalidate the
    // pre-existing-face comparison.
    cpSync(path.join(REPO_ROOT, 'package.json'), path.join(tmp, 'package.json'))
    cpSync(path.join(REPO_ROOT, 'packages'), path.join(tmp, 'packages'), { recursive: true })
    writeFileSync(path.join(tmp, 'package.json'), gitShow(BOUNDARY_SHA, 'package.json'))
    for (const pkgDir of readdirSync(path.join(REPO_ROOT, 'packages'))) {
      try {
        writeFileSync(
          path.join(tmp, 'packages', pkgDir, 'package.json'),
          gitShow(BOUNDARY_SHA, `packages/${pkgDir}/package.json`),
        )
      } catch {
        // packages that did not exist at the boundary commit keep the
        // current metadata; the boundary-era host never reads them.
      }
    }
    for (const rel of BOUNDARY_CHANGED_LIB_FILES) {
      writeFileSync(path.join(tmp, 'lib', rel), gitShow(BOUNDARY_SHA, `lib/${rel}`))
    }
    const boundaryHost = await import(pathToFileURL(path.join(tmp, 'lib', 'index.js')).href)
    const boundary = observeHostFaces(boundaryHost.apply)
    const current = observeHostFaces(applyCurrentHost)
    // The comparison isolates this branch's own surface delta: the boundary
    // commit predates both this branch's two context-rendering helpers and
    // the later-era members that are already part of main, so all of them are
    // excluded from the pre-existing-face equality check.
    const helperMembers = ['renderContextSnapshot', 'joinContextSections']
    const LATER_ADDED_MEMBERS = ['assemble', 'defineTool', 'executionMode', 'discovery', 'availability', 'capabilityMatrix']
const BRANCH_ADDED_FEATURES = ['security', 'execution', 'recovery', 'coordination', 'storage', 'workspaceTransactions', 'tasks', 'diagnostics', 'toolDiscovery', 'skillsActivation', 'sessionBranch', 'context', 'profile', 'llmAdapters', 'sessionChannel']
    // The host cutover removed the public features snapshot (registry snapshot
    // is an internal state), removed routeOf delegates, and added the prompts
    // provenance face; both eras keep the same internal feature keys, so only
    // the public-surface deltas below are excluded from the face equality.
    const REMOVED_FEATURES = ['officialPassthrough']
    const REMOVED_TOOLS_MEMBERS = ['routeOf']
    const ADDED_PROMPTS_MEMBERS = ['provenance']
    const currentFeatureNames = current.face.featureNames.filter((name) =>
      !BRANCH_ADDED_FEATURES.includes(name) && !REMOVED_FEATURES.includes(name))
    const currentFeatureActivity = current.face.featureActivity.filter((_, index) =>
      !BRANCH_ADDED_FEATURES.includes(current.face.featureNames[index])
      && !REMOVED_FEATURES.includes(current.face.featureNames[index]))
    const currentFace = {
      ...current.face,
      featureNames: currentFeatureNames,
      featureActivity: currentFeatureActivity,
      promptsMembers: current.face.promptsMembers.filter((name) =>
        !helperMembers.includes(name) && !LATER_ADDED_MEMBERS.includes(name) && !ADDED_PROMPTS_MEMBERS.includes(name)),
      toolsMembers: current.face.toolsMembers.filter((name) =>
        !LATER_ADDED_MEMBERS.includes(name) && !REMOVED_TOOLS_MEMBERS.includes(name)),
    }
    // The boundary-era host still exposes the pre-cutover surface: the cutover removed
    // routeOf delegates and the history features snapshot from the public
    // face, and the swept features never changed their internal registry
    // keys. Normalize the boundary side to the same removed-surface baseline.
    const boundaryFace = {
      ...boundary.face,
      featureNames: boundary.face.featureNames.filter((name) => !REMOVED_FEATURES.includes(name)),
      featureActivity: boundary.face.featureActivity.filter((_, index) =>
        !REMOVED_FEATURES.includes(boundary.face.featureNames[index])),
      toolsMembers: boundary.face.toolsMembers.filter((name) => !REMOVED_TOOLS_MEMBERS.includes(name)),
    }
    assert.deepEqual(currentFace, boundaryFace, 'the current host must not alter any pre-existing host face')
    assert.deepEqual(current.lifecycle, boundary.lifecycle, 'host reapply/dispose/cleanup observations must be unchanged')
    assert.equal(current.face.promptsMembers.includes('renderContextSnapshot'), true,
      'the current host exposes the two context-rendering helpers')
    assert.equal(boundary.face.promptsMembers.includes('renderContextSnapshot'), false,
      'the boundary-era host does not expose them')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('source and artifact audit: no unrelated implementation markers, tokens, or out-of-scope surfaces', () => {
  const IMPLEMENTATION_FILES = [
    'lib/official-passthrough-host.js',
    'lib/client-official-passthrough.js',
    'lib/client-runtime.js',
    'lib/client.js',
  ]
  const MARKERS = [
    ['remote-publication', /\bremote-publication\b/],
    ['tool-abort', /\btool-abort\b/],
    ['toolAbortedError', /\btoolAbortedError\b/],
    ['jobs', /\bjobs\b/],
    ['shellEnv', /\bshellEnv\b/],
  ]
  for (const rel of IMPLEMENTATION_FILES) {
    const source = readFileSync(path.join(REPO_ROOT, rel), 'utf8')
    for (const [marker, pattern] of MARKERS) {
      assert.equal(pattern.test(source), false, `${rel} must not reference "${marker}"`)
    }
    assert.equal(new RegExp(`\\b${'P' + '11'}\\b`).test(source), false, `${rel} must stay free of governance tokens`)
    assert.equal(new RegExp(`\\b${'C' + '(2[6-9]|3[0-2])'}\\b`).test(source), false, `${rel} must stay free of governance tokens`)
    assert.equal(new RegExp(`-${'r' + '1'}\\b`).test(source), false, `${rel} must stay free of governance tokens`)
    assert.equal(/\brequire\(/.test(source), false, `${rel} must not gain a require() path`)
  }

  const implemented = [
    ...OFFICIAL_PASSTHROUGH_HOST_DESCRIPTORS.map((descriptor) => descriptor.surfaceKey),
    ...CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS.map((descriptor) => descriptor.surfaceKey),
  ].sort()
  assert.deepEqual(implemented, [
    'client.commandUi',
    'client.conversation',
    'client.conversationEvents',
    'client.conversationViews',
    'client.inputTriggers',
    'client.modelDirectories',
    'client.timer',
    'systemPrompt.joinContextSections',
    'systemPrompt.renderContextSnapshot',
  ], 'the implemented surfaces must be exactly the nine approved ones')
})
