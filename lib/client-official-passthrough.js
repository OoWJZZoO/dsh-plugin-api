/**
 * Finite client contract inventory and lease/diagnostic primitives for the
 * official browser service faces.
 *
 * The inventory below is the complete outward contract for the supported
 * runtime. Implementation and tests use this table only; members discovered at
 * runtime are never absorbed into a facade.
 */
import { PluginApiFeatureDisabledError, PluginApiInactiveError } from './errors.js'

export const CLIENT_ENTRY_URL = '@deepseek-ai/dsh-plugin-api-main/client'

/**
 * Closed diagnostic reason vocabulary. Only these six values may appear in a
 * leaf diagnostic or typed error reason.
 */
export const CLIENT_REASONS = Object.freeze({
  missingExport: 'missing-export',
  invalidExport: 'invalid-export',
  missingService: 'missing-service',
  invalidProvider: 'invalid-provider',
  missingMember: 'missing-member',
  invalidMember: 'invalid-member',
})

const REASON_VALUES = new Set(Object.values(CLIENT_REASONS))

export function isClientReason(value) {
  return typeof value === 'string' && REASON_VALUES.has(value)
}

/**
 * The seven audited official client service faces.
 *
 * - `kind` is either `'method'` (typeof function, invoked with the official
 *   provider as receiver) or `'property'` (live value read from the provider,
 *   checked only for presence).
 * - `parentURL` is the facade client entry identifier passed as the second
 *   loader argument; the attributes argument is always a fresh empty record
 *   per call.
 */
export const CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS = Object.freeze([
  Object.freeze({
    surfaceKey: 'client.inputTriggers',
    featureName: 'clientInputTriggers',
    moduleId: '@deepseek-ai/dsh-client-ui-input-trigger',
    constructorExport: 'InputTriggerService',
    serviceName: 'inputTriggers',
    parentURL: CLIENT_ENTRY_URL,
    members: Object.freeze({
      registerSource: 'method',
      sessionOf: 'method',
    }),
  }),
  Object.freeze({
    surfaceKey: 'client.commandUi',
    featureName: 'clientCommandUi',
    moduleId: '@deepseek-ai/dsh-client-ui-commands',
    constructorExport: 'CommandUiRuntime',
    serviceName: 'commandUi',
    parentURL: CLIENT_ENTRY_URL,
    members: Object.freeze({
      register: 'method',
      decorate: 'method',
      popupFor: 'method',
    }),
  }),
  Object.freeze({
    surfaceKey: 'client.modelDirectories',
    featureName: 'clientModelDirectories',
    moduleId: '@deepseek-ai/dsh-client-ui-model-selection',
    constructorExport: 'ModelDirectoryResolver',
    serviceName: 'modelDirectories',
    parentURL: CLIENT_ENTRY_URL,
    members: Object.freeze({
      directoryFor: 'method',
    }),
  }),
  Object.freeze({
    surfaceKey: 'client.conversation',
    featureName: 'clientConversation',
    moduleId: '@deepseek-ai/dsh-client-ui-conversation',
    constructorExport: 'ConversationController',
    serviceName: 'conversation',
    parentURL: CLIENT_ENTRY_URL,
    members: Object.freeze({
      input: 'property',
      blocks: 'property',
      send: 'method',
      updateQueue: 'method',
      cancel: 'method',
      loadOlder: 'method',
    }),
  }),
  Object.freeze({
    surfaceKey: 'client.conversationEvents',
    featureName: 'clientConversationEvents',
    moduleId: '@deepseek-ai/dsh-client-runtime',
    constructorExport: 'ConversationEventRegistry',
    serviceName: 'conversationEvents',
    parentURL: CLIENT_ENTRY_URL,
    members: Object.freeze({
      entries: 'method',
      subscribe: 'method',
      register: 'method',
      registerFallback: 'method',
      fallbackEntry: 'method',
    }),
  }),
  Object.freeze({
    surfaceKey: 'client.conversationViews',
    featureName: 'clientConversationViews',
    moduleId: '@deepseek-ai/dsh-client-runtime',
    constructorExport: 'ConversationViewRegistry',
    serviceName: 'conversationViews',
    parentURL: CLIENT_ENTRY_URL,
    members: Object.freeze({
      entries: 'method',
      subscribe: 'method',
      register: 'method',
    }),
  }),
  Object.freeze({
    surfaceKey: 'client.timer',
    featureName: 'clientTimer',
    moduleId: '@deepseek-ai/dsh-cordis-client-runner',
    constructorExport: 'ClientTimerService',
    serviceName: 'timer',
    parentURL: CLIENT_ENTRY_URL,
    members: Object.freeze({
      setTimeout: 'method',
      setInterval: 'method',
      timeout: 'method',
      interval: 'method',
      throttle: 'method',
      debounce: 'method',
    }),
  }),
])

/**
 * Non-contract concrete members that must stay outside the outward faces.
 * Used by negative-boundary tests; never consulted by the runtime. Leaves
 * without an entry expose no non-contract concrete members in the audited
 * runtime and are covered by generic isolation assertions instead.
 */
export const CLIENT_EXCLUDED_MEMBERS = Object.freeze({
  'client.inputTriggers': Object.freeze(['sessions']),
  'client.commandUi': Object.freeze(['bindComposerFocus', 'execute', 'candidates']),
  'client.conversation': Object.freeze(['scopeId', 'draftAttachments', 'sendSession']),
  'client.timer': Object.freeze(['schedule', 'dispose']),
})

/**
 * Namespace contract check: the imported value must be a module namespace
 * (non-null object). A rejected import, a primitive, or `null` is
 * `invalid-export`.
 */
export function validateImportNamespace(value) {
  return typeof value === 'object' && value !== null
}

/**
 * Constructor contract check. Absent export is `missing-member`; a present
 * non-function is `invalid-member`. The constructor identity is never inferred
 * from names.
 *
 * @returns {{ ok: true, Constructor: Function } | { ok: false, reason: string }}
 */
export function resolveConstructorFromNamespace(namespace, exportName) {
  const exported = namespace?.[exportName]
  if (exported === undefined) {
    return { ok: false, reason: CLIENT_REASONS.missingMember }
  }
  if (typeof exported !== 'function') {
    return { ok: false, reason: CLIENT_REASONS.invalidMember }
  }
  return { ok: true, Constructor: exported }
}

/**
 * Complete static member validation against the inventory. Every listed member
 * must have its declared kind before the provider may be used; members outside
 * the inventory are never inspected or surfaced.
 *
 * @param {object} provider
 * @param {Readonly<Record<string, 'method'|'property'>>} members
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function validateStaticMembers(provider, members) {
  for (const [name, kind] of Object.entries(members)) {
    const value = provider?.[name]
    if (value === undefined) {
      return { ok: false, reason: CLIENT_REASONS.missingMember }
    }
    if (kind === 'method' && typeof value !== 'function') {
      return { ok: false, reason: CLIENT_REASONS.invalidMember }
    }
  }
  return { ok: true }
}

/**
 * One leaf record for a disabled/pending/active/retired client surface.
 *
 * - `pending` -- publication state without a guard diagnostic; access throws
 *   the ordinary surface-keyed unavailable error.
 * - `disabled` -- a completed guard failure with one closed reason.
 * - `active` -- holds the module lease for the accepted import generation.
 * - `retired` -- a stale generation (cache identity change or root disposal);
 *   typed-fails and is never silently rebound.
 *
 * `current` is the root-generation token: it is invalidated before any root
 * cleanup so a late continuation can never reactivate an old generation.
 */

/**
 * @param {object} descriptor  a frozen inventory descriptor
 * @param {(surfaceKey: string, reason: string) => void} onDiagnostic
 */
export function createClientLeafRecord(descriptor, onDiagnostic) {
  let logged = false
  const report = (reason) => {
    if (logged) return
    logged = true
    onDiagnostic(descriptor.surfaceKey, reason)
  }
  return {
    descriptor,
    surfaceKey: descriptor.surfaceKey,
    state: 'pending',
    reason: undefined,
    lease: null,
    current: true,
    settleDisabled(reason) {
      if (this.state !== 'pending') return false
      this.state = 'disabled'
      this.reason = reason
      report(reason)
      return true
    },
    activate(namespace, Constructor) {
      if (this.state !== 'pending') return false
      this.state = 'active'
      this.lease = { moduleId: descriptor.moduleId, namespace, Constructor }
      return true
    },
    retire(reason, { silent = false } = {}) {
      if (this.state === 'retired') return false
      this.state = 'retired'
      this.reason = reason
      if (!silent) report(reason)
      return true
    },
    invalidate() {
      this.current = false
      if (this.state !== 'retired') this.retire(undefined, { silent: true })
    },
  }
}

/**
 * Call-time resolver for one active leaf. Order is fixed by the design:
 * root/record currency, cache-lease identity, caller-scoped provider, exact
 * constructor identity, then the complete static member contract. A caller
 * scope that fails yields a typed local error without changing leaf state;
 * a cache identity change retires the leaf generation globally.
 */
export function resolveLeafProvider(record, rootState, callerCtx) {
  if (!rootState.active()) throw new PluginApiInactiveError()
  if (!record.current) throw new PluginApiFeatureDisabledError(record.surfaceKey)
  if (record.state === 'pending') throw new PluginApiFeatureDisabledError(record.surfaceKey)
  if (record.state !== 'active') throw new PluginApiFeatureDisabledError(record.surfaceKey, record.reason)

  const lease = record.lease
  let cacheExports
  try {
    cacheExports = rootState.modules?.loadCache?.get?.(lease.moduleId)?.exports
  } catch {
    cacheExports = undefined
  }
  if (!rootState.modules || cacheExports !== lease.namespace) {
    // The lease no longer matches the loader cache; retire once and typed-fail.
    record.retire(CLIENT_REASONS.invalidExport)
    throw new PluginApiFeatureDisabledError(record.surfaceKey, record.reason)
  }

  let provider
  try {
    provider = callerCtx.get(record.descriptor.serviceName)
  } catch {
    provider = undefined
  }
  if (provider === undefined) {
    throw new PluginApiFeatureDisabledError(record.surfaceKey, CLIENT_REASONS.missingService)
  }
  if (!(provider instanceof lease.Constructor)) {
    throw new PluginApiFeatureDisabledError(record.surfaceKey, CLIENT_REASONS.invalidProvider)
  }
  const check = validateStaticMembers(provider, record.descriptor.members)
  if (!check.ok) {
    throw new PluginApiFeatureDisabledError(record.surfaceKey, check.reason)
  }
  return provider
}

/**
 * Caller-bound outward face for one leaf. A fresh face is created for every
 * client composition; its members resolve through the shared leaf record at
 * every access, so a reference acquired while the root was pending observes
 * the later active state without caching a provider.
 */
export function createClientLeafFacade(record, rootState, callerCtx) {
  const resolve = () => resolveLeafProvider(record, rootState, callerCtx)
  const surface = {}
  for (const [memberName, kind] of Object.entries(record.descriptor.members)) {
    if (kind === 'property') {
      Object.defineProperty(surface, memberName, {
        enumerable: true,
        get() {
          return resolve()[memberName]
        },
      })
    } else {
      surface[memberName] = (...args) => {
        const provider = resolve()
        return Reflect.apply(provider[memberName], provider, args)
      }
    }
  }
  return Object.freeze(surface)
}

/**
 * Start the module bootstrap for one leaf. The import runs with the exact
 * three-argument loader contract and a fresh empty attributes record. Every
 * failure converts to one closed reason and disables only this leaf; the
 * returned promise never rejects.
 */
export function bootstrapClientLeaf(rootState, record) {
  const descriptor = record.descriptor
  const modules = rootState.modules
  if (!modules || typeof modules.import !== 'function') {
    record.settleDisabled(CLIENT_REASONS.invalidExport)
    return Promise.resolve()
  }
  let importing
  try {
    importing = modules.import(descriptor.moduleId, descriptor.parentURL, {})
  } catch {
    record.settleDisabled(CLIENT_REASONS.invalidExport)
    return Promise.resolve()
  }
  return Promise.resolve(importing).then(
    (namespace) => {
      if (!rootState.current) return
      const accepted = acceptImport(rootState, record, namespace)
      if (!accepted.ok) record.settleDisabled(accepted.reason)
    },
    () => {
      if (!rootState.current) return
      record.settleDisabled(CLIENT_REASONS.invalidExport)
    },
  )
}

function acceptImport(rootState, record, namespace) {
  const descriptor = record.descriptor
  const modules = rootState.modules
  if (!modules || typeof modules.loadCache?.get !== 'function') {
    return { ok: false, reason: CLIENT_REASONS.invalidExport }
  }
  let cached
  try {
    cached = modules.loadCache.get(descriptor.moduleId)?.exports
  } catch {
    cached = undefined
  }
  // Linearization point: the import is accepted only while the cache still
  // exposes exactly the imported namespace. A mismatch means the import
  // completed for a stale generation and the leaf cannot establish a lease.
  if (cached !== namespace) {
    return { ok: false, reason: CLIENT_REASONS.invalidExport }
  }
  if (!validateImportNamespace(namespace)) {
    return { ok: false, reason: CLIENT_REASONS.invalidExport }
  }
  const resolved = resolveConstructorFromNamespace(namespace, descriptor.constructorExport)
  if (!resolved.ok) return resolved
  let provider
  try {
    provider = rootState.ownerCtx.get(descriptor.serviceName)
  } catch {
    provider = undefined
  }
  if (provider === undefined) {
    return { ok: false, reason: CLIENT_REASONS.missingService }
  }
  if (!(provider instanceof resolved.Constructor)) {
    return { ok: false, reason: CLIENT_REASONS.invalidProvider }
  }
  const check = validateStaticMembers(provider, descriptor.members)
  if (!check.ok) return check
  record.activate(namespace, resolved.Constructor)
  return { ok: true }
}