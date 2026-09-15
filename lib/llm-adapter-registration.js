import {
  LlmAdaptersValidationError,
  LlmAdaptersConflictError,
  LlmAdaptersUnavailableError,
  LlmAdaptersOwnerConflictError,
} from './errors.js'
import { contractResult, releasedResult, staleResult, UNAVAILABLE } from './contract-kernel.js'

/**
 * Real adapter-route registration on the facade face.
 *
 * `llm.adapters.register(spec)` binds the official adapter registration
 * action (`ctx.get('llm').registerAdapter`): the spec is a plain object —
 * route identity, declared models with real capability fields, and a
 * callable `stream` implementation — with no SDK base class and no official
 * private imports. Decorations live on their own entry
 * (`llm.adapters.decorations.*`); a decoration spec arriving here is a typed
 * validation that names the correct entry.
 *
 * The official seam swaps route sets for one adapter instance but cannot
 * swap the implementation object, so each route-id registers exactly one
 * delegating wrapper with the official runtime; the wrapper forwards every
 * adapter method to the facade's current implementation record. Facade-level
 * CAS replacement (`register(spec, { replace: expectedGeneration })`)
 * atomically swaps that record — the official adapter identity and topology
 * stay untouched, so the official producer remains the only source of
 * `llm/adapters-updated`.
 *
 * The module is pure against the harness: it never imports official modules
 * and only touches the llm service through the injected provider.
 */

const DECORATION_VOCABULARY_KEYS = new Set(['labels', 'match', 'wrap', 'phase'])
const DIRECTORY_VOCABULARY_KEYS = new Set(['settingsNs', 'settingsPath', 'displayName'])
const DISCOVERY_VOCABULARY_KEYS = new Set(['discover'])

const isPlainObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0

const freezeDeep = (value) => {
  if (Array.isArray(value)) {
    for (const item of value) freezeDeep(item)
    Object.freeze(value)
    return value
  }
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeDeep(child)
    Object.freeze(value)
    return value
  }
  return value
}

/**
 * Deep-copy a declared value so the frozen snapshot never aliases the
 * caller's mutable objects. Functions (stream implementations) are kept by
 * reference — they are behavior, not snapshot data.
 */
const frozenClone = (value) => {
  if (typeof value === 'function') return value
  try {
    return freezeDeep(structuredClone(value))
  } catch {
    return value
  }
}

/**
 * Normalize one spec model entry. A model item must carry a non-empty id
 * (under `model` or `id`); every other own field is a declared capability
 * and passes through untouched. Unknown shapes fail validation — a silently
 * dropped model would look registered but never be selectable.
 */
function normalizeModelEntries(models) {
  const normalized = []
  for (const item of models) {
    if (!isPlainObject(item)) {
      throw new LlmAdaptersValidationError('each model entry must be a plain object with a model id')
    }
    const id = item.model ?? item.id
    if (!isNonEmptyString(id)) {
      throw new LlmAdaptersValidationError('each model entry must declare a non-empty model id ("model" or "id")')
    }
    const record = { model: id }
    for (const key of Object.keys(item)) {
      if (key !== 'model' && key !== 'id') record[key] = frozenClone(item[key])
    }
    normalized.push(Object.freeze(record))
  }
  return Object.freeze(normalized)
}

/**
 * Spec normalization and four-action discrimination: a spec that belongs to
 * another entry is rejected with a typed validation naming the correct
 * entry, never accepted and misinterpreted.
 */
export function normalizeAdapterSpec(spec) {
  if (!isPlainObject(spec)) {
    throw new LlmAdaptersValidationError('adapter registration requires a plain-object spec')
  }
  const vocabulary = new Set(Object.keys(spec))
  const decorationKeys = [...DECORATION_VOCABULARY_KEYS].filter((key) => vocabulary.has(key))
  const directoryKeys = [...DIRECTORY_VOCABULARY_KEYS].filter((key) => vocabulary.has(key))
  const discoveryKeys = [...DISCOVERY_VOCABULARY_KEYS].filter((key) => vocabulary.has(key))

  if (!isNonEmptyString(spec.provider)) {
    throw new LlmAdaptersValidationError('spec.provider must be a non-empty provider route id')
  }
  if (!Array.isArray(spec.models) || spec.models.length === 0) {
    throw new LlmAdaptersValidationError('spec.models must be a non-empty array of model entries')
  }
  const models = normalizeModelEntries(spec.models)

  if (typeof spec.stream !== 'function') {
    if (decorationKeys.length > 0) {
      throw new LlmAdaptersValidationError(
        `this spec looks like an adapter decoration (labels/wrap vocabulary); decorations belong to llm.adapters.decorations.register, not llm.adapters.register (found: ${decorationKeys.join(', ')})`,
      )
    }
    if (discoveryKeys.length > 0) {
      throw new LlmAdaptersValidationError(
        `this spec looks like dynamic model discovery; discovery belongs to llm.models.register, not llm.adapters.register (found: ${discoveryKeys.join(', ')})`,
      )
    }
    if (directoryKeys.length > 0) {
      throw new LlmAdaptersValidationError(
        `this spec looks like a configurable-provider directory entry; directory entries belong to llm.providers.register, not llm.adapters.register (found: ${directoryKeys.join(', ')})`,
      )
    }
    throw new LlmAdaptersValidationError('spec.stream must be a callable stream implementation for a real adapter route')
  }

  return Object.freeze({
    provider: spec.provider,
    providerName: isNonEmptyString(spec.providerName) ? spec.providerName : null,
    models,
    stream: spec.stream,
    listModels: typeof spec.listModels === 'function' ? spec.listModels : null,
    resolveModel: typeof spec.resolveModel === 'function' ? spec.resolveModel : null,
    providerRetryPolicy: typeof spec.providerRetryPolicy === 'function' ? spec.providerRetryPolicy : null,
  })
}

/**
 * Content equivalence for idempotent re-registration: the declarative route
 * content (provider id + model declarations). The stream function is an
 * implementation, not content — an identical re-apply keeps the already
 * registered implementation instead of hot-swapping it behind the caller's
 * back (an implementation change is an explicit `replace`).
 */
function declarativeContent(models) {
  return JSON.stringify(models.map((entry) => ({ ...entry })))
}

/**
 * The reverse direction of the four-action discrimination: the directory /
 * discovery entries (`llm.providers.register`, `llm.models.register`) never
 * bind a callable stream backend — a spec carrying one is rejected with a
 * typed validation naming `llm.adapters.register`.
 */
export function rejectStreamBackendEntry(entry, correctEntry) {
  const candidates = Array.isArray(entry) ? entry : [entry]
  for (const item of candidates) {
    if (isPlainObject(item) && 'stream' in item) {
      throw new LlmAdaptersValidationError(
        `a callable stream backend belongs to llm.adapters.register, not ${correctEntry}`,
      )
    }
  }
}

/**
 * Derive the calling plugin's owner identity from the caller's shadowed
 * context (fiber → loader entry row name/id), shared mechanics with the
 * decoration owner derivation. Unresolvable identities return undefined;
 * the facade never attributes registrations to itself.
 */
export function deriveAdapterRegistrationOwner(callerCtx) {
  try {
    if (callerCtx && typeof callerCtx === 'object') {
      const fiber = callerCtx.fiber ?? callerCtx.ctx?.fiber
      const loader = callerCtx.loader ?? callerCtx.ctx?.loader
      if (typeof loader?.entries === 'function') {
        for (const entry of loader.entries()) {
          if (entry?.fiber === fiber) {
            const name = entry?.options?.name
            if (typeof name === 'string' && name.length > 0) return name
            const id = entry?.options?.id ?? entry?.id
            if (typeof id === 'string' && id.length > 0) return id
          }
        }
      }
      if (fiber && typeof fiber.name === 'string' && fiber.name.length > 0) return fiber.name
    }
    return undefined
  } catch {
    return undefined
  }
}

/**
 * The real-registration surface. `llmProvider` resolves the official llm
 * service lazily (null/absent → typed unavailable for register/list, honest
 * entry marking in list). `ownerOf(callerCtx)` derives the owner identity
 * per invocation. The instance holds one owner record per route id; the
 * official runtime holds exactly one delegating wrapper per registered id.
 */
export function createLlmAdapterRegistration({ active, llmProvider, ownerOf, facadeOwnerIds }) {
  const entries = new Map()
  const officialLlm = () => {
    try {
      const llm = llmProvider?.()
      return llm && typeof llm.registerAdapter === 'function' ? llm : null
    } catch {
      return null
    }
  }

  const gates = () => {
    if (typeof active === 'function' && !active()) throw new LlmAdaptersUnavailableError('the facade is not active')
  }

  const isFacadeOwner = (owner) =>
    owner === undefined || (facadeOwnerIds instanceof Set && facadeOwnerIds.has(owner))

  const buildWrapper = (entry) => ({
    providerInfo(provider) {
      const impl = entry.current
      if (impl && typeof impl.providerInfo === 'function') {
        const info = impl.providerInfo(provider)
        if (isPlainObject(info) && info.id === provider && isNonEmptyString(info.name)) return info
      }
      if (impl?.providerName) return { id: provider, name: impl.providerName }
      return { id: provider, name: provider }
    },
    providerRetryPolicy(provider) {
      const impl = entry.current
      return impl && typeof impl.providerRetryPolicy === 'function'
        ? impl.providerRetryPolicy(provider)
        : undefined
    },
    listModels(provider) {
      const impl = entry.current
      if (impl && typeof impl.listModels === 'function') {
        return Promise.resolve(impl.listModels(provider))
      }
      // Advisory catalog from the declaration when the implementation does
      // not provide dynamic discovery.
      return Promise.resolve(entry.declaredModels.map((model) => ({
        provider,
        id: model.model,
        name: typeof model.name === 'string' && model.name.length > 0 ? model.name : model.model,
        ...(model.inputModalities !== undefined ? { inputModalities: model.inputModalities } : {}),
      })))
    },
    resolveModel(provider, model, signal) {
      const impl = entry.current
      if (impl && typeof impl.resolveModel === 'function') {
        return Promise.resolve(impl.resolveModel(provider, model, signal))
      }
      return Promise.resolve({ provider, id: model, name: model })
    },
    stream(options) {
      const impl = entry.current
      if (!impl || typeof impl.stream !== 'function') {
        throw new LlmAdaptersUnavailableError(`adapter route "${entry.id}" no longer has an implementation`)
      }
      return impl.stream(options)
    },
  })

  const registerOfficial = (entry) => {
    const llm = officialLlm()
    if (!llm) {
      throw new LlmAdaptersUnavailableError('the official adapter registration seam is unavailable')
    }
    const wrapper = buildWrapper(entry)
    entry.wrapper = wrapper
    try {
      entry.officialHandle = llm.registerAdapter([entry.id], wrapper)
    } catch (error) {
      // Official all-or-nothing validation surfaces as typed validation; the
      // official error identity (message) is preserved in the reason.
      throw new LlmAdaptersValidationError(
        `official adapter registration rejected the route "${entry.id}": ${error?.message ?? String(error)}`,
      )
    }
  }

  const revokeOfficial = (entry) => {
    const handle = entry.officialHandle
    if (typeof handle === 'function') {
      try {
        handle()
      } catch (error) {
        // the handle stays attached so a retry can revoke through it
        throw new LlmAdaptersUnavailableError(
          `official adapter revocation failed for route "${entry.id}": ${error?.message ?? String(error)}`,
        )
      }
    }
    entry.officialHandle = null
  }

  const disposeEntry = (entry, handleGeneration) => {
    // Stale / foreign disposer: a typed no-op that never revokes another
    // owner's or a newer generation's registration (idempotent dispose).
    const live = entries.get(entry.id)
    if (live !== entry || (handleGeneration !== undefined && live.generation !== handleGeneration)) {
      return staleResult(`route "${entry.id}" is already revoked or superseded`)
    }
    // Revoke through the official action first: if the official revocation
    // fails, the facade record stays in place so the two views never
    // diverge and the caller can retry the dispose.
    revokeOfficial(entry)
    entries.delete(entry.id)
    return releasedResult()
  }

  const buildHandle = (entry, callerCtx) => {
    const handleGeneration = entry.generation
    let teardownBound = false
    try {
      if (typeof callerCtx?.effect === 'function') {
        callerCtx.effect(() => () => {
          try {
            disposeEntry(entry, handleGeneration)
          } catch {
            // identity-bound disposal must never throw through teardown
          }
        })
        teardownBound = true
      }
    } catch {
      teardownBound = false
    }
    if (!teardownBound) {
      throw new LlmAdaptersUnavailableError('caller fiber teardown is unavailable')
    }
    return Object.freeze({
      id: entry.id,
      ownerId: entry.ownerIdentity,
      generation: entry.generation,
      dispose() {
        try {
          return disposeEntry(entry, handleGeneration)
        } catch (error) {
          return contractResult(false, UNAVAILABLE, error?.message ?? 'registration disposal failed')
        }
      },
    })
  }

  return Object.freeze({
    register(spec, callerCtx, options) {
      gates()
      const owner = ownerOf?.(callerCtx)
      if (isFacadeOwner(owner)) {
        throw new LlmAdaptersUnavailableError('registration owner is unavailable')
      }
      const normalized = normalizeAdapterSpec(spec)
      const id = normalized.provider
      const existing = entries.get(id)
      if (existing) {
        if (existing.ownerIdentity !== owner) {
          throw new LlmAdaptersOwnerConflictError(
            `route "${id}" is already owned by another owner`,
          )
        }
        if (typeof options?.replace === 'number') {
          if (options.replace !== existing.generation) {
            throw new LlmAdaptersConflictError(
              `route "${id}" replacement expected generation ${options.replace} but current generation is ${existing.generation}; nothing was swapped`,
            )
          }
          // Atomic CAS swap: the implementation record changes in one step;
          // the official wrapper identity and topology stay untouched, so
          // the official producer remains the only change-event source.
          existing.current = normalized
          existing.generation += 1
          existing.declaredModels = normalized.models
          return buildHandle(existing, callerCtx)
        }
        if (declarativeContent(existing.declaredModels) === declarativeContent(normalized.models)) {
          return buildHandle(existing, callerCtx)
        }
        throw new LlmAdaptersConflictError(
          `route "${id}" is already registered by this owner with different content; supply { replace: <current generation> } for an explicit swap (current generation ${existing.generation})`,
        )
      }
      const entry = {
        id,
        ownerIdentity: owner,
        generation: 1,
        current: normalized,
        declaredModels: normalized.models,
        wrapper: null,
        officialHandle: null,
      }
      registerOfficial(entry)
      entries.set(id, entry)
      return buildHandle(entry, callerCtx)
    },

    list() {
      gates()
      const llm = officialLlm()
      const rows = []
      for (const entry of entries.values()) {
        rows.push(Object.freeze({
          id: entry.id,
          ownerId: entry.ownerIdentity,
          generation: entry.generation,
          models: Object.freeze(entry.declaredModels.map((model) => frozenClone(model))),
          // Honest availability: a route whose official backing cannot be
          // resolved right now is marked unavailable, not active.
          availability: llm ? 'active' : 'unavailable',
        }))
      }
      return Object.freeze(rows)
    },
  })
}
