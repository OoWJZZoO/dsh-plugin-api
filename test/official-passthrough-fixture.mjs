/**
 * Shared test substrate for the official passthrough client leaves. Not a
 * test file itself; imported by the official-passthrough test files.
 */
import { Context } from '@deepseek-ai/cordis'
import { CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS } from '../lib/client-official-passthrough.js'
import { PluginApiFeatureDisabledError, PluginApiInactiveError } from '../lib/errors.js'

export const CORDIS_TRACKER = Symbol.for('cordis.tracker')
export const LEAF_KEY = (surfaceKey) => surfaceKey.slice('client.'.length)
export const DESCRIPTOR_BY_SURFACE = new Map(CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS.map((d) => [d.surfaceKey, d]))
export const DESCRIPTOR_BY_KEY = new Map(CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS.map((d) => [LEAF_KEY(d.surfaceKey), d]))
export const OTHERS = CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS.map((d) => d.surfaceKey)
export { PluginApiFeatureDisabledError, PluginApiInactiveError }

/**
 * Raw module loader fake with the public RC.6 contract: three-argument
 * `import`, a `loadCache` map of `{ id, exports }` records, and `invalidate`.
 */
export function createModulesLoader() {
  const loadCache = new Map()
  const calls = []
  return {
    loadCache,
    calls,
    async import(specifier, parentURL, attrs) {
      calls.push({ specifier, parentURL, attrs })
      const record = loadCache.get(specifier)
      if (record) return record.exports
      throw new Error(`no cached module for ${specifier}`)
    },
    invalidate(id) {
      loadCache.delete(id)
    },
  }
}

/** Deferred loader: imports settle only when the test resolves/rejects them. */
export function createDeferredLoader() {
  const base = createModulesLoader()
  const pending = new Map()
  const loader = {
    ...base,
    resolvePending(id, forcedNamespace, index = 0) {
      const queue = pending.get(id)
      if (!queue?.length) throw new Error(`no pending import for ${id}`)
      const entry = queue[index]
      if (!entry) throw new Error(`no pending import index ${index} for ${id}`)
      queue.splice(index, 1)
      entry.resolve(forcedNamespace !== undefined ? forcedNamespace : loader.loadCache.get(id)?.exports)
      if (!queue.length) pending.delete(id)
    },
    rejectPending(id, index = 0) {
      const queue = pending.get(id)
      if (!queue?.length) throw new Error(`no pending import for ${id}`)
      const entry = queue[index]
      if (!entry) throw new Error(`no pending import index ${index} for ${id}`)
      queue.splice(index, 1)
      entry.reject(new Error(`import rejected for ${id}`))
      if (!queue.length) pending.delete(id)
    },
  }
  loader.import = (specifier, parentURL, attrs) => {
    loader.calls.push({ specifier, parentURL, attrs })
    return new Promise((resolve, reject) => {
      const queue = pending.get(specifier) ?? []
      queue.push({ resolve, reject })
      pending.set(specifier, queue)
    })
  }
  return loader
}

/**
 * Namespace fakes grouped by bare module id: the loader cache holds exactly
 * one namespace per module, and `@deepseek-ai/dsh-client-runtime` exports both
 * registry constructors, matching the bundled runtime modules.
 */
export function createNamespaceFakes() {
  const namespaces = new Map()
  namespaces.set('@deepseek-ai/dsh-client-ui-input-trigger', { InputTriggerService: class InputTriggerService {
    constructor() { this.sources = []; this.lastController = null; this.sourcesDisposer = null }
    registerSource(src) {
      this.sources.push(src)
      this.sourcesDisposer = () => { this.sources = this.sources.filter((x) => x !== src) }
      return this.sourcesDisposer
    }
    sessionOf(actx) { this.lastController = { menu: actx, pick() {}, dismiss() {} }; return this.lastController }
    // Real non-contract concrete member of the audited runtime.
    sessions() { return this.sources }
  } })
  namespaces.set('@deepseek-ai/dsh-client-ui-commands', { CommandUiRuntime: class CommandUiRuntime {
    constructor() { this.lastDisposer = null; this.lastPopup = null; this.focusHooks = new Map() }
    register(contribution) { this.lastDisposer = () => contribution; return this.lastDisposer }
    decorate(decoration) { this.lastDisposer = () => decoration; return this.lastDisposer }
    popupFor(actx) { this.lastPopup = { actx }; return this.lastPopup }
    // Real non-contract concrete members of the audited runtime.
    bindComposerFocus(id, focus) { this.focusHooks.set(id, focus); return () => { this.focusHooks.delete(id) } }
    execute() {}
    candidates() { return [] }
    sessions() { return [] }
  } })
  namespaces.set('@deepseek-ai/dsh-client-ui-model-selection', { ModelDirectoryResolver: class ModelDirectoryResolver {
    constructor() { this.lastDirectory = null }
    directoryFor(sessionId) { this.lastDirectory = { sessionId }; return this.lastDirectory }
  } })
  namespaces.set('@deepseek-ai/dsh-client-ui-conversation', { ConversationController: class ConversationController {
    constructor() {
      this.input = { draft: '' }
      this.blocks = []
      this.draftAttachments = []
      this.rejectionReason = new Error('conversation rejects')
      this.sendPromise = Promise.resolve('sent:hello')
      this.queuePromise = Promise.resolve({ id: 'q1', action: 'replace' })
      this.cancelPromise = Promise.resolve()
      this.loadOlderPromise = Promise.resolve(1)
    }
    send(text) { return text === 'boom' ? Promise.reject(this.rejectionReason) : this.sendPromise }
    updateQueue(id, action) { return this.queuePromise }
    cancel() { return this.cancelPromise }
    loadOlder() { return this.loadOlderPromise }
    // Real non-contract concrete members of the audited runtime.
    scopeId() { return null }
    sendSession() { return this.sendPromise }
    createDraftImages() {}
    releaseDraftImage() {}
    serializeImages() {}
  } })
  namespaces.set('@deepseek-ai/dsh-client-runtime', {
    ConversationEventRegistry: class ConversationEventRegistry {
      constructor() { this.definitions = []; this.listeners = []; this.lastDisposer = null; this.disposeLast = () => {} }
      entries() { return [...this.definitions] }
      subscribe(listener) { this.listeners.push(listener); return () => { this.listeners = this.listeners.filter((l) => l !== listener) } }
      register(definition) {
        this.definitions.push(definition)
        this.lastDisposer = () => { this.definitions = this.definitions.filter((e) => e !== definition) }
        this.disposeLast = this.lastDisposer
        for (const listener of [...this.listeners]) listener()
        return this.lastDisposer
      }
      registerFallback(definition) {
        this.lastDisposer = () => { this.fallback = undefined }
        this.disposeLast = this.lastDisposer
        this.fallback = definition
        return this.lastDisposer
      }
      fallbackEntry() { return this.fallback }
    },
    ConversationViewRegistry: class ConversationViewRegistry {
      constructor() { this.definitions = []; this.listeners = []; this.lastDisposer = null; this.disposeLast = () => {} }
      entries() { return [...this.definitions] }
      subscribe(listener) { this.listeners.push(listener); return () => { this.listeners = this.listeners.filter((l) => l !== listener) } }
      register(definition) {
        this.definitions.push(definition)
        this.lastDisposer = () => { this.definitions = this.definitions.filter((e) => e !== definition) }
        this.disposeLast = this.lastDisposer
        for (const listener of [...this.listeners]) listener()
        return this.lastDisposer
      }
    },
  })
  namespaces.set('@deepseek-ai/dsh-cordis-client-runner', { ClientTimerService: class ClientTimerService {
    constructor() {
      this.lastDisposer = null
      this.timeoutPromise = Promise.resolve(50)
      this.timeoutRejection = new Error('timer rejects')
      this.intervalIterator = (async function* gen() { yield 60 })()
      this.throttleDisposer = () => {}
      this.debounceDisposer = () => {}
    }
    setTimeout(callback, ms) { this.lastDisposer = () => ms; return this.lastDisposer }
    setInterval(callback, ms) { this.lastDisposer = () => ms; return this.lastDisposer }
    timeout(callback, ms) {
      if (typeof callback === 'function') { this.lastDisposer = () => ms; return this.lastDisposer }
      if (callback === 51) return Promise.reject(this.timeoutRejection)
      this.timeoutPromise = Promise.resolve(callback)
      return this.timeoutPromise
    }
    interval(callback, ms) {
      if (typeof callback === 'function') { this.lastDisposer = () => ms; return this.lastDisposer }
      return this.intervalIterator
    }
    throttle(fn, ms) { return Object.assign((...args) => fn(...args), { dispose: this.throttleDisposer }) }
    debounce(fn, ms) { return Object.assign((...args) => fn(...args), { dispose: this.debounceDisposer }) }
    // Real non-contract concrete member of the audited runtime; the service
    // itself declares no public dispose member.
    schedule() { return null }
  } })
  return namespaces
}

/**
 * Independent fixture: a raw `modules` service, seven valid namespaces with
 * matching loadCache identities, and provider instances of the namespace
 * constructors. The pre-existing client substrates are provided in their
 * minimal official shape. No client.modules facade is registered anywhere.
 *
 * `omit` excludes the listed surface keys from provider registration and
 * namespace seeding; `override` runs after the base setup with
 * `(ctx, namespaces, loader)` and can mutate any part of the fixture.
 */
export function bootFixture({ deferred = false, omit = [], override = undefined } = {}) {
  const ctx = new Context()
  const logs = []
  ctx.logger.error = (line) => logs.push(line)
  const loader = deferred ? createDeferredLoader() : createModulesLoader()
  const namespaces = createNamespaceFakes()
  for (const descriptor of CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS) {
    const namespace = namespaces.get(descriptor.moduleId)
    loader.loadCache.set(descriptor.moduleId, { exports: namespace })
    if (omit.includes(descriptor.surfaceKey)) continue
    const Constructor = namespace[descriptor.constructorExport]
    ctx.reflect.provide(descriptor.serviceName, new Constructor())
  }
  ctx.reflect.provide('modules', loader)
  ctx.reflect.provide('connection', {
    rpc: { call(_base, endpoint, body, signal) { return Promise.resolve({ endpoint, body, signal }) } },
    api: { settings: { describe() {} } },
  })
  const remoteListeners = new Map()
  ctx.reflect.provide('remote', {
    $on(name, listener) {
      const bucket = remoteListeners.get(name) ?? new Set()
      bucket.add(listener)
      remoteListeners.set(name, bucket)
      return () => bucket.delete(listener)
    },
    $dispatch(name, args) {
      for (const listener of [...(remoteListeners.get(name) ?? [])]) listener(...args)
    },
    async $mount(contribution) {
      for (const descriptorRow of contribution.descriptors) {
        this[descriptorRow.namespace] ??= { [descriptorRow.method]: () => ({ ok: true }) }
      }
      return () => true
    },
  })
  ctx.reflect.provide('settingsScope', { bind() { return { getSnapshot() {}, subscribe() {}, set() {}, unset() {} } } })
  ctx.reflect.provide('slots', {
    register() { return () => {} },
    inject() { return () => {} },
    entries() { return [] },
    subscribe() { return () => {} },
  })
  override?.(ctx, namespaces, loader)
  return { ctx, loader, namespaces, logs }
}

export async function settleAll() {
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
}

/**
 * Side-effect-free probe member per leaf: the fixture providers expose these
 * methods/properties with no state mutation beyond a harmless last-* field, so
 * probing leaves the official behaviors asserted by the leaf tests untouched.
 */
const PROBE_MEMBER = Object.freeze({
  'client.inputTriggers': 'sessionOf',
  'client.commandUi': 'popupFor',
  'client.modelDirectories': 'directoryFor',
  'client.conversation': 'input',
  'client.conversationEvents': 'entries',
  'client.conversationViews': 'entries',
  'client.timer': 'timeout',
})

/**
 * Check whether a client leaf is active. Probes the leaf facade under
 * `api.services.*`: a disabled or inactive leaf typed-fails on any member
 * access (PluginApiFeatureDisabledError / PluginApiInactiveError), while an
 * active leaf resolves the member (property) or the member call succeeds
 * (method). The probe member is chosen to be side-effect free.
 */
export const leafState = (api, surfaceKey) => {
  const descriptor = DESCRIPTOR_BY_SURFACE.get(surfaceKey)
  const face = descriptor ? api.services[surfaceKey.slice('client.'.length)] : undefined
  if (!face) return false
  const memberName = PROBE_MEMBER[surfaceKey]
  if (!(memberName in descriptor.members)) return false
  try {
    const value = face[memberName]
    if (descriptor.members[memberName] === 'method') value()
    return true
  } catch (error) {
    // Code-based checks stay valid across the bundle's vm realm, where the
    // typed error classes are not identical to the lib/errors.js classes.
    const code = error?.code ?? error?.name
    if (code === 'PLUGIN_API_FEATURE_DISABLED' || code === 'PLUGIN_API_INACTIVE') return false
    throw error
  }
}