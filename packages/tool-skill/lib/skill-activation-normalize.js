/**
 * Pure validation/normalization for the skill activation contract
 * (`packages/tool-skill`).
 *
 * Zero harness dependencies. Every entry point returns a typed result
 * `{ ok: true, value }` or `{ ok: false, code, reason }` and never throws.
 * Codes belong to the shared skill failure vocabulary (see tasks section 1.2).
 */

/** The public skill-name grammar (mirrors the official registry). */
export const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Invocation source classification vocabulary (exposure/audit metadata). */
export const SOURCE_KINDS = Object.freeze([
  'userInvocable',
  'explicit',
  'auto-match',
  'provider-sourced',
])

/** Activation scope kinds. */
export const SCOPE_KINDS = Object.freeze(['session', 'agent', 'turn'])

/** Descriptor summary bound (characters). */
export const SUMMARY_MAX = 200

/** Descriptor capabilities bound (count). */
export const CAPABILITIES_MAX = 16

/** Bounded free-text fields (reason, condition, section keys, ids). */
export const TEXT_MAX = 200

/** Bounded audit query limit. */
export const AUDIT_LIMIT_MAX = 500

const REGISTRATION_INVALID = 'SKILL_REGISTRATION_INVALID'
const SCOPE_UNRESOLVED = 'ACTIVATION_SCOPE_UNRESOLVED'
const ACTIVATION_INVALID = 'ACTIVATION_INVALID'

function ok(value) {
  return { ok: true, value }
}

function fail(code, reason) {
  return { ok: false, code, reason }
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value, max = TEXT_MAX) {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

/**
 * Normalize an activation-scope reference.
 * @param {unknown} reference - `{ kind, key }` with key required.
 * @returns {import('node:util').TypedResult}
 */
export function normalizeScope(reference) {
  if (!isPlainObject(reference)) return fail(SCOPE_UNRESOLVED, 'scope must be an object')
  const { kind, key } = reference
  if (!SCOPE_KINDS.includes(kind)) return fail(SCOPE_UNRESOLVED, `scope kind must be one of ${SCOPE_KINDS.join('/')}`)
  if (!isNonEmptyString(key)) return fail(SCOPE_UNRESOLVED, 'scope key must be a non-empty string')
  return ok(Object.freeze({ kind, key }))
}

/**
 * Normalize a minimal-update policy registration input. The policy is
 * per-session: kind must be `session`, the resolved key is the scope key.
 * @param {unknown} scope
 * @returns {import('node:util').TypedResult}
 */
export function normalizePolicyInput(scope) {
  const scopeResult = normalizeScope(scope)
  if (!scopeResult.ok) return scopeResult
  if (scopeResult.value.kind !== 'session') return fail(SCOPE_UNRESOLVED, 'minimal update policy requires a session scope')
  return ok(scopeResult.value.key)
}

/**
 * Normalize a skill descriptor spec (the activation-policy overlay over an
 * official registry entry; never a second content source).
 * @param {unknown} spec
 * @returns {import('node:util').TypedResult}
 */
export function normalizeDescriptorSpec(spec) {
  if (!isPlainObject(spec)) return fail(REGISTRATION_INVALID, 'descriptor spec must be an object')
  const {
    skillId, owner, summary, capabilities, sourceKind, activationSource,
    dependencies, tools, promptSections, resources,
  } = spec
  if (!isNonEmptyString(skillId) || !SKILL_NAME.test(skillId)) {
    return fail(REGISTRATION_INVALID, 'descriptor skillId must be a valid skill name')
  }
  if (!isNonEmptyString(owner)) return fail(REGISTRATION_INVALID, 'descriptor owner must be a non-empty string')
  if (!isNonEmptyString(summary, SUMMARY_MAX)) {
    return fail(REGISTRATION_INVALID, `descriptor summary must be a non-empty string of at most ${SUMMARY_MAX} characters`)
  }
  let normalizedCapabilities = undefined
  if (capabilities !== undefined) {
    if (!Array.isArray(capabilities) || capabilities.length > CAPABILITIES_MAX) {
      return fail(REGISTRATION_INVALID, `descriptor capabilities must be an array of at most ${CAPABILITIES_MAX} items`)
    }
    const items = []
    for (const item of capabilities) {
      if (!isNonEmptyString(item)) {
        return fail(REGISTRATION_INVALID, 'descriptor capabilities items must be non-empty strings')
      }
      items.push(item)
    }
    normalizedCapabilities = Object.freeze(items)
  }
  const kind = sourceKind ?? 'userInvocable'
  if (!SOURCE_KINDS.includes(kind)) {
    return fail(REGISTRATION_INVALID, `descriptor sourceKind must be one of ${SOURCE_KINDS.join('/')}`)
  }
  let normalizedActivationSource = undefined
  if (activationSource !== undefined || kind === 'auto-match' || kind === 'provider-sourced') {
    if (!isPlainObject(activationSource)) {
      return fail(REGISTRATION_INVALID, `descriptor sourceKind "${kind}" requires a declared activationSource`)
    }
    const { kind: sourceKindValue, condition } = activationSource
    if (sourceKindValue !== kind) {
      return fail(REGISTRATION_INVALID, 'descriptor activationSource.kind must match sourceKind')
    }
    if (!isNonEmptyString(condition)) {
      return fail(REGISTRATION_INVALID, 'descriptor activationSource requires a non-empty condition')
    }
    normalizedActivationSource = Object.freeze({ kind, condition })
  }
  let normalizedDependencies = undefined
  if (dependencies !== undefined) {
    if (!Array.isArray(dependencies)) return fail(REGISTRATION_INVALID, 'descriptor dependencies must be an array of skill names')
    const items = []
    for (const dependency of dependencies) {
      if (!isNonEmptyString(dependency) || !SKILL_NAME.test(dependency)) {
        return fail(REGISTRATION_INVALID, 'descriptor dependencies items must be valid skill names')
      }
      items.push(dependency)
    }
    normalizedDependencies = Object.freeze(items)
  }
  let normalizedTools = undefined
  if (tools !== undefined) {
    if (!Array.isArray(tools)) return fail(REGISTRATION_INVALID, 'descriptor tools must be an array of entry references')
    const items = []
    for (const tool of tools) {
      if (!isPlainObject(tool) || !isNonEmptyString(tool.entryId)) {
        return fail(REGISTRATION_INVALID, 'descriptor tools items must be { entryId, generation? }')
      }
      const generation = tool.generation
      if (generation !== undefined && !isNonEmptyString(generation)) {
        return fail(REGISTRATION_INVALID, 'descriptor tools generation must be a non-empty string when present')
      }
      items.push(Object.freeze(generation === undefined ? { entryId: tool.entryId } : { entryId: tool.entryId, generation }))
    }
    normalizedTools = Object.freeze(items)
  }
  let normalizedSections = undefined
  if (promptSections !== undefined) {
    if (!Array.isArray(promptSections)) return fail(REGISTRATION_INVALID, 'descriptor promptSections must be an array of section keys')
    const items = []
    for (const sectionKey of promptSections) {
      if (!isNonEmptyString(sectionKey)) {
        return fail(REGISTRATION_INVALID, 'descriptor promptSections items must be non-empty strings')
      }
      items.push(sectionKey)
    }
    normalizedSections = Object.freeze(items)
  }
  let normalizedResources = undefined
  if (resources !== undefined) {
    if (!Array.isArray(resources)) return fail(REGISTRATION_INVALID, 'descriptor resources must be an array of resource references')
    const items = []
    for (const resource of resources) {
      if (!isPlainObject(resource) || !isNonEmptyString(resource.resourceId)) {
        return fail(REGISTRATION_INVALID, 'descriptor resources items must be { resourceId, metadata? }')
      }
      const metadata = resource.metadata
      if (metadata !== undefined && !isPlainObject(metadata)) {
        return fail(REGISTRATION_INVALID, 'descriptor resources metadata must be an object when present')
      }
      items.push(Object.freeze({
        resourceId: resource.resourceId,
        ...(metadata === undefined ? {} : { metadata: JSON.parse(JSON.stringify(metadata)) }),
      }))
    }
    normalizedResources = Object.freeze(items)
  }
  return ok(Object.freeze({
    skillId,
    owner,
    summary,
    ...(normalizedCapabilities === undefined ? {} : { capabilities: normalizedCapabilities }),
    sourceKind: kind,
    ...(normalizedActivationSource === undefined ? {} : { activationSource: normalizedActivationSource }),
    ...(normalizedDependencies === undefined ? {} : { dependencies: normalizedDependencies }),
    ...(normalizedTools === undefined ? {} : { tools: normalizedTools }),
    ...(normalizedSections === undefined ? {} : { promptSections: normalizedSections }),
    ...(normalizedResources === undefined ? {} : { resources: normalizedResources }),
  }))
}

/**
 * Normalize an activation request `{ scope, reason?, ttl?, sourceKind?,
 * condition?, deadline? }`. Scope failures map to `ACTIVATION_SCOPE_UNRESOLVED`;
 * malformed remaining fields map to `ACTIVATION_INVALID`.
 * @param {unknown} input
 * @returns {import('node:util').TypedResult}
 */
export function normalizeActivationRequest(input) {
  if (!isPlainObject(input)) return fail(ACTIVATION_INVALID, 'activation request must be an object')
  const scopeResult = normalizeScope(input.scope)
  if (!scopeResult.ok) return scopeResult
  const { reason, ttl, sourceKind, condition, deadline } = input
  if (reason !== undefined && !isNonEmptyString(reason)) {
    return fail(ACTIVATION_INVALID, 'activation reason must be a non-empty string of at most 200 characters')
  }
  if (ttl !== undefined && (!Number.isInteger(ttl) || ttl <= 0)) {
    return fail(ACTIVATION_INVALID, 'activation ttl must be a positive integer (milliseconds) when present')
  }
  if (deadline !== undefined && (!Number.isInteger(deadline) || deadline <= 0)) {
    return fail(ACTIVATION_INVALID, 'activation deadline must be a positive integer (milliseconds) when present')
  }
  if (sourceKind !== undefined && !SOURCE_KINDS.includes(sourceKind)) {
    return fail(ACTIVATION_INVALID, `activation sourceKind must be one of ${SOURCE_KINDS.join('/')}`)
  }
  if ((sourceKind === 'auto-match' || sourceKind === 'provider-sourced')
    && !isNonEmptyString(condition)) {
    return fail(ACTIVATION_INVALID, `activation sourceKind "${sourceKind}" requires a non-empty condition`)
  }
  if (condition !== undefined && !isNonEmptyString(condition)) {
    return fail(ACTIVATION_INVALID, 'activation condition must be a non-empty string of at most 200 characters')
  }
  return ok(Object.freeze({
    scope: scopeResult.value,
    ...(reason === undefined ? {} : { reason }),
    ...(ttl === undefined ? {} : { ttl }),
    ...(deadline === undefined ? {} : { deadline }),
    ...(sourceKind === undefined ? {} : { sourceKind }),
    ...(condition === undefined ? {} : { condition }),
  }))
}

/**
 * Normalize the `registerSkill` sugar input. The descriptor part and the
 * optional activation half are validated with the shared normalizers.
 * @param {unknown} input
 * @returns {import('node:util').TypedResult}
 */
export function normalizeRegisterSkillInput(input) {
  if (!isPlainObject(input)) return fail(REGISTRATION_INVALID, 'registerSkill input must be an object')
  const { name, summary, content, activation } = input
  if (!isNonEmptyString(name) || !SKILL_NAME.test(name)) {
    return fail(REGISTRATION_INVALID, 'registerSkill name must be a valid skill name')
  }
  if (!isNonEmptyString(summary, SUMMARY_MAX)) {
    return fail(REGISTRATION_INVALID, `registerSkill summary must be a non-empty string of at most ${SUMMARY_MAX} characters`)
  }
  if (!isNonEmptyString(content)) {
    return fail(REGISTRATION_INVALID, 'registerSkill content must be a non-empty string')
  }
  const descriptorResult = normalizeDescriptorSpec({
    skillId: name,
    owner: input.owner,
    summary,
    capabilities: input.capabilities,
    sourceKind: input.sourceKind,
    activationSource: input.activationSource,
    dependencies: input.dependencies,
    tools: input.tools,
    promptSections: input.promptSections,
    resources: input.resources,
  })
  if (!descriptorResult.ok) return descriptorResult
  let activationResult = undefined
  if (activation !== undefined) {
    activationResult = normalizeActivationRequest(activation)
    if (!activationResult.ok) return activationResult
  }
  return ok(Object.freeze({
    descriptor: descriptorResult.value,
    content,
    ...(activationResult === undefined ? {} : { activation: activationResult.value }),
  }))
}

/**
 * Normalize an audit query `{ limit? }`.
 * @param {unknown} query
 * @returns {import('node:util').TypedResult}
 */
export function normalizeAuditQuery(query) {
  if (query === undefined || query === null) return ok(Object.freeze({ limit: 50 }))
  if (!isPlainObject(query)) return fail(ACTIVATION_INVALID, 'audit query must be an object')
  let { limit } = query
  if (limit === undefined) limit = 50
  if (!Number.isInteger(limit)) return fail(ACTIVATION_INVALID, 'audit limit must be an integer')
  if (limit < 1) return fail(ACTIVATION_INVALID, 'audit limit must be at least 1')
  return ok(Object.freeze({ limit: Math.min(limit, AUDIT_LIMIT_MAX) }))
}