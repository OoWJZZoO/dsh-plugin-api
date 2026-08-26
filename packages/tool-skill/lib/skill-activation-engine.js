/**
 * Pure skill-activation state machine for `packages/tool-skill`.
 *
 * Zero harness dependencies. Owns the descriptor registry, per-scope
 * activations (latest-wins), TTL expiry (lazy, evaluated on read), degradation
 * records, the bounded audit ring, and the per-session minimal-update policy
 * registry. Returns plain typed outcomes; never throws into callers.
 *
 * Terminal vocabulary per the identity/lifecycle standard: activations settle
 * to `superseded` (replaced or deactivated) or `expired` (TTL); degraded
 * activations stay in state `degraded` (created with degraded parts). No
 * additional terminal words are introduced; timeouts surface as typed results
 * at the wiring layer and never mutate the engine.
 */

/** Default audit ring capacity (bounded audit). */
export const DEFAULT_AUDIT_CAPACITY = 500

const SKILL_ENTRY_CONFLICT = 'SKILL_ENTRY_CONFLICT'
const SKILL_ENTRY_UNKNOWN = 'SKILL_ENTRY_UNKNOWN'
const SKILL_ENTRY_DISPOSED = 'SKILL_ENTRY_DISPOSED'
const SKILL_ENTRY_FAILED = 'SKILL_ENTRY_FAILED'
const DEACTIVATE_STALE_GENERATION = 'DEACTIVATE_STALE_GENERATION'
const EXPOSURE_STALE_GENERATION = 'EXPOSURE_STALE_GENERATION'

function frozen(value) {
  return Object.freeze(value)
}

function fail(code, reason) {
  return frozen({ ok: false, code, reason })
}

/** Composite engine-scope key for one activation scope. */
function scopeKeyOf(scope) {
  return `${scope.kind}:${scope.key}`
}

/**
 * @param {{
 *   now?: () => number,
 *   generateGeneration?: () => string,
 *   auditCapacity?: number,
 *   readSeamStatus?: () => object,
 * }} [options]
 */
export function createSkillActivationEngine(options = {}) {
  const now = options.now ?? (() => Date.now())
  const auditCapacity = Number.isInteger(options.auditCapacity) && options.auditCapacity > 0
    ? options.auditCapacity
    : DEFAULT_AUDIT_CAPACITY
  const readSeamStatus = options.readSeamStatus ?? (() => frozen({}))
  let generationSequence = 0
  const generateGeneration = options.generateGeneration
    ?? (() => `gen-${++generationSequence}`)

  /** @type {Map<string, object>} skillId -> descriptor record */
  const descriptors = new Map()
  /** @type {Set<string>} skillIds whose descriptor was disposed (typed disposed results) */
  const disposedSkills = new Set()
  /** @type {Set<string>} skillIds whose verification failed sticky (typed failed results) */
  const failedSkills = new Set()
  /** @type {Map<string, Map<string, object>>} scopeKey -> skillId -> current activation record */
  const activations = new Map()
  /** @type {Map<string, object>} generation -> activation record (every issued generation, for stable exposure) */
  const generations = new Map()
  /** @type {Map<string, {current: boolean}>} scopeKey -> policy token */
  const policyTokens = new Map()
  /** @type {Array<object>} bounded audit ring, oldest first */
  const audit = []
  let auditSequence = 0

  function appendAudit({ kind, skillId, owner, sourceKind, reason, generation }) {
    const record = frozen({
      seq: ++auditSequence,
      at: new Date(now()).toISOString(),
      kind,
      ...(skillId === undefined ? {} : { skillId }),
      ...(owner === undefined ? {} : { owner }),
      ...(sourceKind === undefined ? {} : { sourceKind }),
      ...(reason === undefined ? {} : { reason }),
      ...(generation === undefined ? {} : { generation }),
    })
    audit.push(record)
    if (audit.length > auditCapacity) audit.splice(0, audit.length - auditCapacity)
    return record
  }

  function scopeActivations(scopeKey, create = false) {
    let scope = activations.get(scopeKey)
    if (scope === undefined && create) {
      scope = new Map()
      activations.set(scopeKey, scope)
    }
    return scope
  }

  /**
   * Resolve and lazily expire an activation record. Terminal records are
   * never rewritten; the expire transition happens at most once.
   */
  function activationState(scopeKey, skillId) {
    const scope = scopeActivations(scopeKey)
    const record = scope?.get(skillId)
    if (record === undefined) return frozen({ status: 'absent', record: undefined })
    if ((record.state === 'active' || record.state === 'degraded')
      && record.expiresAt !== undefined
      && record.expiresAt < now()) {
      record.state = 'expired'
      appendAudit({
        kind: 'expire',
        skillId,
        owner: record.owner,
        sourceKind: record.sourceKind,
        reason: record.reason ?? 'ttl-expired',
        generation: record.generation,
      })
    }
    return frozen({ status: record.state, record })
  }

  /** Whether the engine knows a descriptor for the skill (frozen record or null). */
  function descriptorOf(skillId) {
    const record = descriptors.get(skillId)
    return record === undefined ? null : record
  }

  function registerDescriptor(descriptor) {
    disposedSkills.delete(descriptor.skillId)
    failedSkills.delete(descriptor.skillId)
    const existing = descriptors.get(descriptor.skillId)
    if (existing !== undefined && existing.owner !== descriptor.owner) {
      return fail(SKILL_ENTRY_CONFLICT, `descriptor for "${descriptor.skillId}" is owned by "${existing.owner}"`)
    }
    const generation = generateGeneration()
    const record = frozen({
      ...descriptor,
      generation,
      state: 'registered',
    })
    descriptors.set(descriptor.skillId, record)
    appendAudit({
      kind: 'register',
      skillId: descriptor.skillId,
      owner: descriptor.owner,
      sourceKind: descriptor.sourceKind,
      reason: existing === undefined ? 'descriptor-registered' : 'descriptor-replaced',
      generation,
    })
    return frozen({ ok: true, generation, replaced: existing === undefined ? false : existing.generation })
  }

  function unregisterDescriptor(skillId, owner) {
    const existing = descriptors.get(skillId)
    if (existing === undefined) return fail(SKILL_ENTRY_UNKNOWN, `descriptor for "${skillId}" is not registered`)
    if (existing.owner !== owner) {
      return fail(SKILL_ENTRY_CONFLICT, `descriptor for "${skillId}" is owned by "${existing.owner}"`)
    }
    descriptors.delete(skillId)
    for (const scope of activations.values()) scope.delete(skillId)
    for (const [generation, record] of generations) {
      if (record.skillId === skillId) generations.delete(generation)
    }
    disposedSkills.add(skillId)
    appendAudit({
      kind: 'unregister',
      skillId,
      owner,
      sourceKind: existing.sourceKind,
      reason: 'descriptor-disposed',
      generation: existing.generation,
    })
    return frozen({ ok: true, generation: existing.generation })
  }

  /** Presence code for a skillId without a live descriptor. */
  function missingDescriptorReason(skillId) {
    if (disposedSkills.has(skillId)) {
      return fail(SKILL_ENTRY_DISPOSED, `descriptor for "${skillId}" was disposed`)
    }
    if (failedSkills.has(skillId)) {
      return fail(SKILL_ENTRY_FAILED, `descriptor for "${skillId}" is failed`)
    }
    return fail(SKILL_ENTRY_UNKNOWN, `skill "${skillId}" has no registered descriptor`)
  }

  /**
   * Activate a (skillId, scope) pair. Latest-wins: a non-terminal predecessor
   * is superseded; terminal predecessors are simply unlinked.
   * @param {object} input - `{ scope, skillId, sourceKind, reason?, ttl?,
   *   degraded? }` (scope is the normalized `{ kind, key }`).
   */
  function activate(input) {
    const { skillId, sourceKind, reason, ttl } = input
    const descriptor = descriptors.get(skillId)
    if (descriptor === undefined) {
      return missingDescriptorReason(skillId)
    }
    if (failedSkills.has(skillId)) {
      return fail(SKILL_ENTRY_FAILED, `descriptor for "${skillId}" is failed`)
    }
    const scopeKey = scopeKeyOf(input.scope)
    const scope = scopeActivations(scopeKey, true)
    const previous = scope.get(skillId)
    if (previous !== undefined && (previous.state === 'active' || previous.state === 'degraded')) {
      previous.state = 'superseded'
      appendAudit({
        kind: 'supersede',
        skillId,
        owner: previous.owner,
        sourceKind: previous.sourceKind,
        reason: 'replaced-by-newer-activation',
        generation: previous.generation,
      })
    }
    const generation = generateGeneration()
    const degraded = Array.isArray(input.degraded) ? input.degraded.map(frozen) : []
    const expiresAt = ttl === undefined ? undefined : now() + ttl
    const record = {
      skillId,
      owner: descriptor.owner,
      scope: frozen(input.scope),
      scopeKey,
      sourceKind,
      reason: reason === undefined ? undefined : reason,
      ttlMs: ttl === undefined ? undefined : ttl,
      ...(expiresAt === undefined ? {} : { expiresAt }),
      generation,
      state: degraded.length === 0 ? 'active' : 'degraded',
      degraded,
    }
    scope.set(skillId, record)
    generations.set(generation, record)
    appendAudit({
      kind: record.state === 'active' ? 'activate' : 'degrade',
      skillId,
      owner: descriptor.owner,
      sourceKind,
      reason: reason === undefined ? (record.state === 'active' ? 'activated' : 'degraded') : reason,
      generation,
    })
    return frozen({
      ok: true,
      generation,
      state: record.state,
      degraded: frozen(degraded),
      ...(expiresAt === undefined ? {} : { expiresAt }),
    })
  }

  /**
   * Deactivate an activation by generation (optionally constrained to a
   * scope key). A live activation records `superseded` (its eligibility is
   * revoked); stale/foreign generations are typed no-ops.
   */
  function deactivate(skillId, generation, scopeKey) {
    const descriptor = descriptors.get(skillId)
    if (descriptor === undefined) return missingDescriptorReason(skillId)
    const candidates = []
    if (scopeKey !== undefined) {
      const record = scopeActivations(scopeKey)?.get(skillId)
      if (record !== undefined) candidates.push(record)
    } else {
      for (const scope of activations.values()) {
        const record = scope.get(skillId)
        if (record !== undefined) candidates.push(record)
      }
    }
    const record = candidates.find((candidate) => candidate.generation === generation)
    if (record === undefined) {
      return fail(DEACTIVATE_STALE_GENERATION, `activation generation "${generation}" for "${skillId}" is stale or foreign`)
    }
    if (record.state === 'active' || record.state === 'degraded') {
      record.state = 'superseded'
      appendAudit({
        kind: 'deactivate',
        skillId,
        owner: record.owner,
        sourceKind: record.sourceKind,
        reason: record.reason ?? 'deactivated',
        generation,
      })
    }
    return frozen({ ok: true, generation, state: record.state })
  }

  /**
   * Exposure projection for `(skillId, generation)`.
   *
   * Every issued generation of a live descriptor is addressable (settled
   * generations report their truthful terminal status; this is the stable
   * diagnostics channel for superseded/expired activations). Generations that
   * were never issued, or belong to another skill, are typed stale/foreign.
   * @returns {object} typed result; ok carries `{ exposure }`.
   */
  function exposure(skillId, generation) {
    const descriptor = descriptors.get(skillId)
    if (descriptor === undefined) return missingDescriptorReason(skillId)
    const record = generations.get(generation)
    if (record === undefined || record.skillId !== skillId) {
      return fail(EXPOSURE_STALE_GENERATION, `generation "${generation}" for "${skillId}" is stale or foreign`)
    }
    // Lazy expiry applies to the addressed record itself (retired records are
    // already terminal; the live record object is shared with the slot).
    if ((record.state === 'active' || record.state === 'degraded')
      && record.expiresAt !== undefined
      && record.expiresAt < now()) {
      record.state = 'expired'
      appendAudit({
        kind: 'expire',
        skillId,
        owner: record.owner,
        sourceKind: record.sourceKind,
        reason: record.reason ?? 'ttl-expired',
        generation: record.generation,
      })
    }
    const terminal = record.state === 'expired' || record.state === 'superseded'
    return frozen({
      ok: true,
      exposure: frozen({
        skillId,
        owner: descriptor.owner,
        sourceKind: record.sourceKind,
        scope: record.scope,
        generation,
        tools: terminal ? frozen([]) : (descriptor.tools ?? frozen([])),
        promptSections: descriptor.promptSections ?? frozen([]),
        resources: descriptor.resources ?? frozen([]),
        degraded: frozen(record.degraded),
        availability: frozen({
          status: record.state,
          degradedParts: record.degraded.map((part) => part.part),
          seamStatus: readSeamStatus(),
        }),
      }),
    })
  }

  /**
   * Bounded audit query. Returns the newest records first.
   * @param {{ limit: number }} query - normalized query.
   */
  function auditQuery(query) {
    const limit = Math.min(Math.max(1, query.limit), DEFAULT_AUDIT_CAPACITY)
    const items = []
    for (let index = audit.length - 1; index >= 0 && items.length < limit; index -= 1) {
      items.push(audit[index])
    }
    return frozen({ ok: true, items: frozen(items) })
  }

  /**
   * Minimal-update policy: latest-wins registration with an opaque token; a
   * stale token's dispose is a no-op.
   */
  function policyRegister(scopeKey) {
    const previous = policyTokens.get(scopeKey)
    if (previous !== undefined) previous.current = false
    const token = { current: true }
    policyTokens.set(scopeKey, token)
    return frozen({ ok: true, token })
  }

  function policyDispose(scopeKey, token) {
    const current = policyTokens.get(scopeKey)
    if (current === undefined || current !== token || !current.current) {
      return frozen({ ok: true, revoked: false })
    }
    current.current = false
    policyTokens.delete(scopeKey)
    return frozen({ ok: true, revoked: true })
  }

  function minimalPolicyFor(scopeKey) {
    const token = policyTokens.get(scopeKey)
    return token !== undefined && token.current
  }

  /**
   * Mark a skill's descriptor as failed (sticky until re-registration). Used
   * by the wiring layer when the official registry verification of an
   * activation fails, so later activations surface the typed failed result.
   * The failed state rides the mark set (descriptor records are frozen); a
   * live descriptor with the mark rejects activations until re-registered.
   */
  function markDescriptorFailed(skillId) {
    failedSkills.add(skillId)
    disposedSkills.delete(skillId)
    const descriptor = descriptors.get(skillId)
    appendAudit({
      kind: 'degrade',
      skillId,
      owner: descriptor?.owner,
      sourceKind: descriptor?.sourceKind,
      reason: 'descriptor-marked-failed',
      generation: descriptor?.generation,
    })
    return frozen({ ok: true })
  }

  /** Record a catalog-change audit event (resend or minimal update). */
  function recordCatalogChange({ scopeKey, reason }) {
    appendAudit({
      kind: 'catalog-change',
      reason: `${scopeKey}: ${reason}`,
    })
    return frozen({ ok: true })
  }

  /** Engine-state availability (truthful, frozen). */
  function engineAvailability() {
    return frozen({
      status: 'active',
      descriptors: descriptors.size,
      activationScopes: activations.size,
      policies: policyTokens.size,
      audit: audit.length,
      seams: readSeamStatus(),
    })
  }

  return frozen({
    descriptorOf,
    registerDescriptor,
    unregisterDescriptor,
    markDescriptorFailed,
    activate,
    deactivate,
    exposure,
    activationState,
    audit: auditQuery,
    policyRegister,
    policyDispose,
    minimalPolicyFor,
    recordCatalogChange,
    availability: engineAvailability,
  })
}