/**
 * Shared harness for the credential mutation acceptance tests.
 *
 * The provider under test is the **real** official file-backed implementation
 * (`@deepseek-ai/dsh-credentials-local`): its exclusive operation chain, file
 * lock, reconcile-from-disk, atomic replace, hierarchy and post-commit
 * `credentials/updated` fan-out are what the requirements must hold against, so
 * the harness only supplies a temporary document path and the facade wiring.
 * The facade itself is mounted through the same staged path the assembly uses.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'

import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { createPluginApiService } from '../lib/plugin-api-service.js'
import { createFeatureRegistry } from '../lib/feature-registry.js'
import { createCredentialMutationFeature, mountCredentialMutationFeature } from '../lib/credentials-mutation-facade.js'

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

/** Boot a real cordis tree with the real provider and the mounted facade. */
export async function createHarness(options = {}) {
  // `sharedDocument` lets two harnesses run over one official credential
  // document (two independent plugin trees, one storage authority).
  const shared = typeof options.sharedDocument === 'string'
  const dir = shared ? null : await mkdtemp(join(tmpdir(), 'dsh-credential-e2e-'))
  const documentPath = shared ? options.sharedDocument : join(dir, '.credentials.yaml')
  if (options.seedDocument !== undefined) {
    await writeFile(documentPath, options.seedDocument, { mode: 0o600 })
  }

  const root = new Context()
  const dispatches = []
  for (const [name, value] of Object.entries({
    loader: { entries: () => [] },
    llm: { resolveModelInfo() {}, prepareCall() {}, stream() {}, registerAdapter() {}, registerConfigurableProviders() {}, registerModelDiscovery() {} },
    tools: { register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {}, executionMode() { return 'mode' } },
    agents: { get() {}, list() {}, roots() {} },
    sessions: { get() {}, list() {}, fork() {} },
    settings: { register() {}, describe() { return [] }, get() {}, mutate() {} },
    systemPrompt: { section() {}, context() {}, variable() {}, tools() {}, suppressRuntimeContext() {}, renderPrompt() {}, renderContextSections() {}, renderContextSnapshot() {}, joinContextSections() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    web: { registerSearchProvider() {}, registerFetchProvider() {} },
  })) root.provide(name, value)

  const subscriptionLog = []
  const originalOn = root.on.bind(root)
  root.on = (name, listener) => {
    const entry = { name, active: true }
    const off = originalOn(name, listener)
    entry.off = () => { entry.active = false; return off() }
    subscriptionLog.push(entry)
    return entry.off
  }

  // Record the official facts the provider dispatches after a commit (and
  // after an external edit when the watcher is on).
  root.on('credentials/updated', (ref) => { dispatches.push(ref) })

  // The real official provider over a temporary document.
  if (options.noProvider !== true) {
    root.plugin(LocalCredentialProvider, { path: documentPath, watch: options.watch === true })
  }
  await settle()

  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: () => true })
  root.plugin(ServiceClass)
  await settle()

  const service = root.pluginApi
  let feature = null
  let prepared = null
  if (options.invariantListener === true) {
    // A synchronous listener that fails with the official invariant code: the
    // provider commits the write and then rethrows after every listener ran.
    class InvariantListener {
      constructor(ctx) {
        ctx.on('credentials/updated', () => {
          const error = new Error('injected observer invariant')
          error.code = 'INVARIANT'
          throw error
        })
      }
    }
    root.plugin(InvariantListener)
    await settle()
  }
  if (options.noProvider !== true && options.noFeature !== true) {
    // The facade subscribes to the official fact stream so the revision markers
    // advance with committed changes.
    feature = createCredentialMutationFeature({ ctx: root, service, logger: { warn() {} } })
    prepared = service.prepareFeature('credentials', feature.api)
    prepared.commit()
    registry.mount('credentials')
  }

  const callers = []
  const caller = async (name) => {
    class CallerPlugin {
      static inject = ['pluginApi']
      constructor(ctx) {
        callers.push({ name, ctx, credentials: ctx.pluginApi.credentials })
      }
    }
    Object.defineProperty(CallerPlugin, 'name', { value: name })
    root.plugin(CallerPlugin)
    await settle()
    return callers.find((entry) => entry.name === name)
  }

  const readDocument = async () => {
    try {
      return await readFile(documentPath, 'utf8')
    } catch {
      return null
    }
  }

  const waitForFact = async (ref, timeoutMs = 1500) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (dispatches.includes(ref)) return true
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    return dispatches.includes(ref)
  }

  const cleanup = async () => {
    try {
      feature?.disposer()
    } catch {
      // teardown is best-effort in the harness
    }
    try {
      await root.stop?.()
    } catch {
      // the tree may not need an explicit stop
    }
    if (dir !== null) await rm(dir, { recursive: true, force: true })
  }

  return {
    root,
    service,
    registry,
    feature,
    prepared,
    caller,
    callers,
    documentPath,
    readDocument,
    dispatches,
    waitForFact,
    subscriptions: subscriptionLog,
    resolveOfficial: async (ref) => {
      const provider = root.get?.('credentials') ?? root.credentials
      return provider?.resolve?.(ref)
    },
    cleanup,
    dir,
  }
}

export { mountCredentialMutationFeature }
