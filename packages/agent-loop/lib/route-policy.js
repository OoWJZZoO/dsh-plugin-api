import { randomUUID } from 'node:crypto'

export const ROUTE_POLICY_ACTIVE_SYMBOL = Symbol.for('dsh-plugin-api.agent-loop.route-policy.contract')
export const ROUTE_POLICY_COMPONENT_SYMBOL = Symbol.for('dsh-plugin-api.agent-loop.contract')
export const ROUTE_POLICY_PACKAGE_NAME = '@deepseek-ai/dsh-plugin-api-agent-loop'

const PRIORITIES = Object.freeze(['lowest', 'low', 'normal', 'high', 'highest', 'monitor'])
const PRIORITY_RANK = new Map(PRIORITIES.map((name, index) => [name, index]))
const DEFAULT_HISTORY_LIMIT = 50
const MAX_HISTORY_LIMIT = 200
const MAX_DIAGNOSTICS = 100
const MAX_REASON_LENGTH = 240

function isObject(value) {
  return value !== null && typeof value === 'object'
}

function isPlainObject(value) {
  if (!isObject(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function boundedText(value, fallback = undefined) {
  if (typeof value !== 'string') return fallback
  const text = value.trim()
  if (!text) return fallback
  return text.length > MAX_REASON_LENGTH ? `${text.slice(0, MAX_REASON_LENGTH - 1)}…` : text
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
}

function scopeKey(scope) {
  if (typeof scope === 'string' && scope.length > 0) return scope
  if (isPlainObject(scope)) return stableStringify(scope)
  return 'unknown'
}

function cloneForSnapshot(value, seen = new WeakMap()) {
  if (value === null || typeof value !== 'object') return value
  if (typeof AbortSignal !== 'undefined' && value instanceof AbortSignal) return value
  if (value instanceof Date) return value.toISOString()
  if (seen.has(value)) return seen.get(value)
  if (Array.isArray(value)) {
    const copy = []
    seen.set(value, copy)
    for (const item of value) copy.push(cloneForSnapshot(item, seen))
    return copy
  }
  if (!isPlainObject(value)) return undefined
  const copy = Object.create(null)
  seen.set(value, copy)
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'function') continue
    const cloned = cloneForSnapshot(item, seen)
    if (cloned !== undefined) copy[key] = cloned
  }
  return copy
}

function freezeSnapshot(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value
  if (typeof AbortSignal !== 'undefined' && value instanceof AbortSignal) return value
  seen.add(value)
  for (const child of Object.values(value)) freezeSnapshot(child, seen)
  return Object.freeze(value)
}

function snapshot(value) {
  return freezeSnapshot(cloneForSnapshot(value))
}

function safeNow(now) {
  try {
    const value = now()
    return value instanceof Date ? value : new Date(value)
  } catch {
    return new Date()
  }
}

function isoNow(now) {
  const date = safeNow(now)
  return Number.isNaN(date.valueOf()) ? new Date().toISOString() : date.toISOString()
}

function makeError(code, message, details = {}) {
  const error = new Error(message)
  error.name = 'RoutePolicyError'
  error.code = code
  if (isPlainObject(details)) Object.assign(error, snapshot(details))
  return error
}

function unavailableError() {
  return makeError('ROUTE_POLICY_UNAVAILABLE', 'route policy capability is unavailable')
}

function assertActive(active) {
  if (!active()) throw unavailableError()
}

function abortIfNeeded(signal) {
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw makeError('ROUTE_POLICY_ABORTED', 'route policy evaluation was aborted')
}

function reasonOf(value, fallbackCode = 'POLICY') {
  if (typeof value === 'string') return { code: fallbackCode, detail: boundedText(value) }
  if (isPlainObject(value)) {
    return {
      code: boundedText(value.code, fallbackCode),
      ...boundedText(value.detail) === undefined ? {} : { detail: boundedText(value.detail) },
    }
  }
  return { code: fallbackCode }
}

function recordDiagnostic(state, code, detail, extra = {}) {
  const entry = snapshot({
    code: boundedText(code, 'ROUTE_POLICY_DIAGNOSTIC'),
    detail: boundedText(detail, 'route policy diagnostic'),
    observedAt: isoNow(state.now),
    ...extra,
  })
  state.diagnostics.push(entry)
  if (state.diagnostics.length > MAX_DIAGNOSTICS) state.diagnostics.splice(0, state.diagnostics.length - MAX_DIAGNOSTICS)
  try {
    state.logger?.warn?.(`dsh-plugin-api agent-loop route policy: ${entry.code}: ${entry.detail}`)
  } catch {
    // Diagnostics are never allowed to change the route outcome.
  }
  return entry
}

function normalizedGeneration(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (value === null || value === undefined) return '0'
  return stableStringify(value)
}

function validIdentity(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function sameGeneration(left, right) {
  return normalizedGeneration(left) === normalizedGeneration(right)
}

function identityOf(definition, label) {
  if (!isPlainObject(definition) || !validIdentity(definition.id)) {
    throw makeError('ROUTE_POLICY_INVALID_REGISTRATION', `${label} registration requires a stable id`)
  }
  if (!validIdentity(definition.ownerId)) {
    throw makeError('ROUTE_POLICY_INVALID_REGISTRATION', `${label} registration requires an ownerId`)
  }
  if (definition.generation === undefined || definition.generation === null) {
    throw makeError('ROUTE_POLICY_INVALID_REGISTRATION', `${label} registration requires a generation`)
  }
  return {
    id: definition.id.trim(),
    ownerId: definition.ownerId.trim(),
    generation: normalizedGeneration(definition.generation),
  }
}

function matchesScope(expected, input) {
  if (expected === undefined || expected === null) return true
  if (typeof expected === 'string') {
    return scopeKey(input?.scope ?? input?.candidate?.scope) === expected
  }
  if (!isPlainObject(expected)) return false
  const source = isPlainObject(input) ? input : {}
  return Object.entries(expected).every(([key, value]) => {
    if (value === undefined) return true
    if (key === 'provider' || key === 'model') {
      return source[key] === value || source.candidate?.[key] === value || source.scope?.[key] === value
    }
    return source[key] === value || source.windowKey?.[key] === value || source.scope?.[key] === value
  })
}

function normalizeCandidate(value, source = 'seed', index = 0) {
  if (!isPlainObject(value)) return null
  const candidateId = value.candidateId ?? value.id ?? `${source}:${index}`
  if (!validIdentity(candidateId) || !validIdentity(value.provider) || !validIdentity(value.model)) return null
  const config = isPlainObject(value.config) ? value.config : {
    provider: value.provider,
    model: value.model,
  }
  const candidate = {
    candidateId: String(candidateId),
    provider: String(value.provider),
    model: String(value.model),
    config,
    source: validIdentity(value.source) ? String(value.source) : source,
    ...value.admission === undefined ? {} : { admission: value.admission },
    ...value.circuit === undefined ? {} : { circuit: value.circuit },
  }
  return snapshot(candidate)
}

function candidateAllowed(candidate) {
  if (candidate?.admission?.state === 'denied') return false
  if (candidate?.circuit?.state === 'open') return false
  return true
}

function normalizeWindowKey(input) {
  const key = input?.windowKey ?? input
  const sessionId = key?.sessionId
  const turn = key?.turn
  const attemptEpoch = key?.attemptEpoch
  if (!validIdentity(sessionId) || !Number.isInteger(turn) || turn < 0 || !validIdentity(String(attemptEpoch))) {
    throw makeError('ROUTE_POLICY_INVALID_WINDOW', 'route decision requires sessionId, turn, and attemptEpoch')
  }
  return snapshot({ sessionId: String(sessionId), turn, attemptEpoch: String(attemptEpoch) })
}

function windowKeyOf(key) {
  return `${key.sessionId}\u0000${key.turn}\u0000${key.attemptEpoch}`
}

function normalizeLimit(value) {
  if (!Number.isInteger(value) || value < 1) return DEFAULT_HISTORY_LIMIT
  return Math.min(value, MAX_HISTORY_LIMIT)
}

function createRegistrationRegistry(state, label, validate) {
  const records = new Map()
  let sequence = 0

  const register = (definition) => {
    assertActive(state.active)
    const identity = identityOf(definition, label)
    validate(definition)
    const record = {
      ...identity,
      definition,
      sequence: sequence++,
      current: true,
    }
    const previous = records.get(identity.id)
    if (previous) previous.current = false
    records.set(identity.id, record)
    let disposed = false
    return () => {
      if (disposed) return false
      disposed = true
      if (records.get(identity.id) !== record) return false
      record.current = false
      records.delete(identity.id)
      return true
    }
  }

  const current = () => [...records.values()].filter((record) => record.current)
  return { register, current }
}

function createCandidateOwner(state) {
  const registry = createRegistrationRegistry(state, 'candidate', (definition) => {
    if (typeof definition.list !== 'function') throw makeError('ROUTE_POLICY_INVALID_REGISTRATION', 'candidate registration requires list(input)')
  })

  async function collect(input) {
    const output = []
    for (const record of registry.current().sort((left, right) => left.sequence - right.sequence)) {
      abortIfNeeded(input?.signal)
      try {
        const value = await record.definition.list(input)
        const list = Array.isArray(value) ? value : value?.candidates
        if (!Array.isArray(list)) {
          recordDiagnostic(state, 'CANDIDATE_INVALID_RESULT', `candidate source "${record.id}" returned a non-array`, { sourceId: record.id })
          continue
        }
        list.forEach((candidate, index) => {
          const normalized = normalizeCandidate(candidate, record.id, index)
          if (normalized) output.push(normalized)
          else recordDiagnostic(state, 'CANDIDATE_INVALID', `candidate source "${record.id}" returned an invalid candidate`, { sourceId: record.id })
        })
      } catch (error) {
        if (input?.signal?.aborted) throw error
        recordDiagnostic(state, 'CANDIDATE_FAILED', `candidate source "${record.id}" failed`, { sourceId: record.id })
      }
    }
    return output
  }

  const register = (...args) => registry.register(...args)
  const api = {
    register,
    list(input = {}) {
      assertActive(state.active)
      return collect(input).then(snapshot)
    },
    get availability() {
      return snapshot({ active: state.active(), registrations: registry.current().length })
    },
  }
  return { registry, collect, api: Object.freeze(api) }
}

function createPolicyOwner(state, candidateOwner) {
  const registry = createRegistrationRegistry(state, 'policy', (definition) => {
    if (definition.scope !== undefined && !isPlainObject(definition.scope) && typeof definition.scope !== 'string') {
      throw makeError('ROUTE_POLICY_INVALID_REGISTRATION', 'policy scope must be an object or string')
    }
    if (definition.match !== undefined && typeof definition.match !== 'function') throw makeError('ROUTE_POLICY_INVALID_REGISTRATION', 'policy match must be a function')
    if (typeof definition.decide !== 'function') throw makeError('ROUTE_POLICY_INVALID_REGISTRATION', 'policy decide must be a function')
    if (definition.priority !== undefined && !PRIORITY_RANK.has(definition.priority)) throw makeError('ROUTE_POLICY_INVALID_REGISTRATION', 'policy priority is invalid')
  })

  async function evaluate(input, candidates) {
    let selected
    let selectedBy
    const evaluated = []
    const records = registry.current().sort((left, right) => {
      const leftRank = PRIORITY_RANK.get(left.definition.priority ?? 'normal')
      const rightRank = PRIORITY_RANK.get(right.definition.priority ?? 'normal')
      return leftRank - rightRank || left.sequence - right.sequence
    })
    const candidateMap = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]))
    for (const record of records) {
      abortIfNeeded(input.signal)
      let matched = true
      try {
        matched = matchesScope(record.definition.scope, input) && (record.definition.match === undefined || await record.definition.match(input))
      } catch (error) {
        if (input.signal?.aborted) throw error
        recordDiagnostic(state, 'POLICY_MATCH_FAILED', `policy "${record.id}" match failed`, { policyId: record.id })
        matched = false
      }
      if (!matched) continue
      evaluated.push(record.id)
      let result
      try {
        result = await record.definition.decide(input)
      } catch (error) {
        if (input.signal?.aborted) throw error
        recordDiagnostic(state, 'POLICY_FAILED', `policy "${record.id}" failed`, { policyId: record.id })
        continue
      }
      if (!isPlainObject(result) || typeof result.action !== 'string') {
        recordDiagnostic(state, 'POLICY_INVALID_RESULT', `policy "${record.id}" returned an invalid result`, { policyId: record.id })
        continue
      }
      if (result.action === 'reject') {
        return { selected: undefined, rejected: true, reason: reasonOf(result.reason, `POLICY_${record.id}`), selectedBy, evaluated }
      }
      if (result.action === 'no-op') continue
      if (result.action === 'select') {
        const candidate = candidateMap.get(result.candidateId)
        if (!candidate || !candidateAllowed(candidate)) {
          recordDiagnostic(state, 'POLICY_INVALID_SELECTION', `policy "${record.id}" selected an unavailable candidate`, { policyId: record.id })
          continue
        }
        selected = candidate
        selectedBy = record.id
        continue
      }
      recordDiagnostic(state, 'POLICY_INVALID_RESULT', `policy "${record.id}" returned an unknown action`, { policyId: record.id })
    }
    return { selected, rejected: false, reason: undefined, selectedBy, evaluated }
  }

  const api = Object.freeze({
    register: (...args) => registry.register(...args),
    get availability() {
      return snapshot({ active: state.active(), registrations: registry.current().length })
    },
  })
  return { registry, evaluate, api, candidateOwner }
}

function normalizeOutcome(outcome) {
  const value = typeof outcome === 'string' ? outcome : outcome?.state ?? outcome?.outcome
  if (['healthy', 'success', 'ok', 'available', 'closed'].includes(value)) return 'healthy'
  if (['unhealthy', 'failure', 'failed', 'error', 'unavailable', 'open'].includes(value)) return 'unhealthy'
  return 'unknown'
}

function createHealthOwner(state) {
  const circuitPolicies = createRegistrationRegistry(state, 'circuit policy', (definition) => {
    if (definition.scope !== undefined && !isPlainObject(definition.scope) && typeof definition.scope !== 'string') throw makeError('ROUTE_POLICY_INVALID_REGISTRATION', 'circuit policy scope is invalid')
    if (definition.qualify !== undefined && typeof definition.qualify !== 'function') throw makeError('ROUTE_POLICY_INVALID_REGISTRATION', 'circuit policy qualify must be a function')
    if (!Number.isInteger(definition.openAfter) || definition.openAfter < 1) throw makeError('ROUTE_POLICY_INVALID_REGISTRATION', 'circuit policy openAfter must be positive')
    if (definition.reEvaluateAfterMs !== undefined && (!Number.isFinite(definition.reEvaluateAfterMs) || definition.reEvaluateAfterMs < 0)) throw makeError('ROUTE_POLICY_INVALID_REGISTRATION', 'circuit policy reEvaluateAfterMs is invalid')
  })
  const probes = createRegistrationRegistry(state, 'probe', (definition) => {
    if (definition.scope !== undefined && !isPlainObject(definition.scope) && typeof definition.scope !== 'string') throw makeError('ROUTE_POLICY_INVALID_REGISTRATION', 'probe scope is invalid')
    if (typeof definition.run !== 'function') throw makeError('ROUTE_POLICY_INVALID_REGISTRATION', 'probe registration requires run(input)')
  })
  const health = new Map()
  const circuits = new Map()
  const probeOperations = new Map()

  const stateFor = (scope) => {
    const key = scopeKey(scope)
    let value = circuits.get(key)
    if (!value) {
      value = { scope: key, state: 'closed', failureCount: 0, probeCount: 0, reason: undefined, openedAt: undefined, reEvaluateAfter: undefined, observedAt: isoNow(state.now), activeProbe: undefined }
      circuits.set(key, value)
    }
    return value
  }

  const currentEvidence = (scope) => health.get(scopeKey(scope))?.at(-1)

  function policyMatches(policy, scope) {
    return matchesScope(policy.definition.scope, { scope })
  }

  function transition(scope, evidence) {
    const key = scopeKey(scope)
    const circuit = stateFor(scope)
    for (const policy of circuitPolicies.current().sort((left, right) => left.sequence - right.sequence)) {
      if (!policyMatches(policy, scope)) continue
      let qualifies = evidence.outcome === 'unhealthy'
      if (typeof policy.definition.qualify === 'function') {
        try {
          const value = policy.definition.qualify(evidence)
          if (value && typeof value.then === 'function') {
            recordDiagnostic(state, 'CIRCUIT_ASYNC_QUALIFY', `circuit policy "${policy.id}" returned a thenable; observation was not blocked`, { policyId: policy.id })
          } else qualifies = Boolean(value)
        } catch {
          recordDiagnostic(state, 'CIRCUIT_QUALIFY_FAILED', `circuit policy "${policy.id}" failed`, { policyId: policy.id })
          qualifies = false
        }
      }
      if (circuit.state === 'closed') {
        if (qualifies) circuit.failureCount += 1
        else if (evidence.outcome === 'healthy') circuit.failureCount = 0
        if (circuit.failureCount >= policy.definition.openAfter) {
          const now = safeNow(state.now)
          circuit.state = 'open'
          circuit.reason = reasonOf(evidence.reason, 'CIRCUIT_OPEN')
          circuit.openedAt = now.toISOString()
          circuit.reEvaluateAfter = new Date(now.valueOf() + (policy.definition.reEvaluateAfterMs ?? 0)).toISOString()
          circuit.observedAt = now.toISOString()
          circuit.policyId = policy.id
        }
      }
    }
    return key
  }

  function observe(scope, outcome, evidence = {}) {
    assertActive(state.active)
    const key = scopeKey(scope)
    const normalized = normalizeOutcome(outcome)
    const observedAt = typeof evidence?.observedAt === 'string' ? evidence.observedAt : isoNow(state.now)
    const entry = snapshot({
      scope: key,
      outcome: normalized,
      source: boundedText(evidence?.source, 'unknown'),
      observedAt,
      ...boundedText(evidence?.failureClass) === undefined ? {} : { failureClass: boundedText(evidence.failureClass) },
      reason: reasonOf(evidence?.reason, normalized === 'unknown' ? 'HEALTH_UNKNOWN' : normalized === 'healthy' ? 'HEALTHY' : 'HEALTH_FAILURE'),
      ...evidence?.stale === true ? { stale: true } : {},
      ...evidence?.uncertainty === undefined ? {} : { uncertainty: boundedText(evidence.uncertainty, 'unknown') },
    })
    const values = health.get(key) ?? []
    values.push(entry)
    if (values.length > MAX_HISTORY_LIMIT) values.splice(0, values.length - MAX_HISTORY_LIMIT)
    health.set(key, values)
    transition(scope, entry)
    return entry
  }

  function status(scope) {
    assertActive(state.active)
    const value = stateFor(scope)
    const now = safeNow(state.now)
    const eligible = value.state === 'open' && value.reEvaluateAfter !== undefined && now.valueOf() >= Date.parse(value.reEvaluateAfter)
    return snapshot({
      scope: value.scope,
      state: value.state,
      ...value.reason === undefined ? {} : { reason: value.reason },
      ...value.openedAt === undefined ? {} : { openedAt: value.openedAt },
      ...value.reEvaluateAfter === undefined ? {} : { reEvaluateAfter: value.reEvaluateAfter },
      probeCount: value.probeCount,
      ...eligible ? { probeEligible: true } : {},
      observedAt: value.observedAt,
    })
  }

  function matchingProbe(scope) {
    return probes.current().sort((left, right) => left.sequence - right.sequence).find((record) => policyMatches(record, scope))
  }

  function completeProbe(scope, operationId, outcome, detail = {}) {
    const key = scopeKey(scope)
    const circuit = stateFor(scope)
    const operation = probeOperations.get(operationId)
    if (!operation || operation.scopeKey !== key || circuit.activeProbe !== operationId) {
      recordDiagnostic(state, 'PROBE_STALE', 'probe result was stale or superseded', { operationId })
      return snapshot({ operationId, state: 'superseded', scope: key })
    }
    probeOperations.delete(operationId)
    circuit.activeProbe = undefined
    const result = normalizeOutcome(outcome)
    const observedAt = isoNow(state.now)
    if (result === 'healthy') {
      circuit.state = 'closed'
      circuit.failureCount = 0
      circuit.reason = undefined
      circuit.reEvaluateAfter = undefined
    } else if (result === 'unhealthy') {
      circuit.state = 'open'
      circuit.reason = reasonOf(detail?.reason, 'PROBE_FAILED')
      circuit.openedAt = observedAt
      const policy = circuitPolicies.current().find((entry) => policyMatches(entry, scope))
      circuit.reEvaluateAfter = new Date(safeNow(state.now).valueOf() + (policy?.definition.reEvaluateAfterMs ?? 0)).toISOString()
    }
    circuit.observedAt = observedAt
    return snapshot({ operationId, state: result === 'healthy' ? 'success' : result === 'unhealthy' ? 'failure' : result === 'unknown' ? 'aborted' : result, scope: key, observedAt })
  }

  async function probe(scope, options = {}) {
    assertActive(state.active)
    abortIfNeeded(options.signal)
    const circuit = stateFor(scope)
    const now = safeNow(state.now)
    if (circuit.state === 'closed') return snapshot({ state: 'unavailable', reason: { code: 'CIRCUIT_CLOSED' }, scope: circuit.scope })
    if (circuit.state === 'open' && (circuit.reEvaluateAfter === undefined || now.valueOf() < Date.parse(circuit.reEvaluateAfter))) {
      return snapshot({ state: 'unavailable', reason: { code: 'PROBE_NOT_ELIGIBLE' }, scope: circuit.scope })
    }
    if (circuit.activeProbe !== undefined) return snapshot({ state: 'unavailable', reason: { code: 'PROBE_LIMIT' }, scope: circuit.scope })
    const selected = matchingProbe(scope)
    if (!selected) return snapshot({ state: 'unavailable', reason: { code: 'PROBE_MISSING' }, scope: circuit.scope })
    const operationId = `probe-${state.idFactory()}`
    circuit.state = 'half-open'
    circuit.activeProbe = operationId
    circuit.probeCount += 1
    circuit.observedAt = isoNow(state.now)
    const operation = { operationId, scopeKey: circuit.scope, ownerId: selected.ownerId, generation: selected.generation }
    probeOperations.set(operationId, operation)
    let result
    try {
      result = await selected.definition.run(snapshot({ operationId, scope: circuit.scope, probe: true, signal: options.signal }))
      abortIfNeeded(options.signal)
      return completeProbe(scope, operationId, result, result)
    } catch (error) {
      const aborted = options.signal?.aborted === true
      return completeProbe(scope, operationId, aborted ? 'aborted' : 'unhealthy', { reason: aborted ? { code: 'PROBE_ABORTED' } : { code: 'PROBE_FAILED' } })
    }
  }

  const api = Object.freeze({
    observe,
    registerCircuitPolicy: (...args) => circuitPolicies.register(...args),
    registerProbe: (...args) => probes.register(...args),
    probe,
    startProbe: probe,
    completeProbe,
    get(scope) {
      assertActive(state.active)
      return currentEvidence(scope)
    },
    history(scope, options = {}) {
      assertActive(state.active)
      const values = health.get(scopeKey(scope)) ?? []
      const limit = normalizeLimit(options.limit)
      return snapshot({ items: values.slice(-limit), truncated: values.length > limit, nextCursor: values.length > limit ? String(values.length - limit) : undefined })
    },
    get availability() {
      return snapshot({ active: state.active(), evidenceScopes: health.size, circuitPolicies: circuitPolicies.current().length, probes: probes.current().length })
    },
  })
  const circuitApi = Object.freeze({
    status,
    get availability() {
      return snapshot({ active: state.active(), scopes: circuits.size })
    },
  })
  return { api, circuitApi, observe, status, completeProbe }
}

function makeSeedCandidate(input) {
  const seed = input?.seedCandidate ?? input?.seed ?? input?.requestProposal
  if (!isPlainObject(seed)) return null
  const provider = seed.provider
  const model = seed.model
  return normalizeCandidate({
    candidateId: seed.candidateId ?? 'seed',
    provider,
    model,
    config: seed.config ?? seed,
    source: 'seed',
    admission: seed.admission,
    circuit: seed.circuit,
  }, 'seed', 0)
}

function makeDecision(state, input, decisionId, windowKey, candidates, result, priorDecision) {
  const selected = result.selected
  const denied = result.rejected || !selected
  const decision = {
    decisionId,
    windowKey,
    ...validIdentity(input.executionId) ? { executionId: input.executionId } : {},
    ...validIdentity(input.attemptId) ? { attemptId: input.attemptId } : {},
    ...selected ? { candidateId: selected.candidateId, provider: selected.provider, model: selected.model } : {},
    config: selected?.config ?? {},
    candidates,
    reason: result.rejected ? result.reason : selected ? { code: result.selectedBy ? 'POLICY_SELECTED' : 'OFFICIAL_SEED', detail: result.selectedBy } : { code: 'NO_ELIGIBLE_ROUTE' },
    ...priorDecision?.decisionId ? { fallbackParentId: priorDecision.decisionId } : validIdentity(input.fallbackParentId) ? { fallbackParentId: input.fallbackParentId } : {},
    ...input.fallbackCause === undefined ? {} : { fallbackCause: reasonOf(input.fallbackCause, 'FALLBACK') },
    commitState: denied ? 'denied' : 'success',
    observedAt: isoNow(state.now),
    ...result.evaluated?.length ? { evaluatedPolicies: result.evaluated } : {},
  }
  return snapshot(decision)
}

function createDecisionOwner(state, candidateOwner, policyOwner, healthOwner) {
  const windows = new Map()
  const decisions = []

  async function decide(input = {}) {
    assertActive(state.active)
    const windowKey = normalizeWindowKey(input)
    const key = windowKeyOf(windowKey)
    const existing = windows.get(key)
    if (existing) return existing.promise
    const decisionId = `decision-${state.idFactory()}`
    const priorDecision = input.priorDecision ?? input.fallbackParent
    const promise = (async () => {
      abortIfNeeded(input.signal)
      const seed = makeSeedCandidate(input)
      const registered = await candidateOwner.collect(input)
      const all = []
      const seen = new Set()
      for (const candidate of [seed, ...registered, ...(Array.isArray(input.candidates) ? input.candidates : [])]) {
        const normalized = normalizeCandidate(candidate, candidate?.source ?? 'input', all.length)
        if (!normalized || seen.has(normalized.candidateId)) continue
        seen.add(normalized.candidateId)
        all.push(normalized)
      }
      const health = Array.isArray(input.health) ? input.health : []
      const circuit = Array.isArray(input.circuit) ? input.circuit : []
      const decisionInput = snapshot({
        decisionId,
        windowKey,
        ...validIdentity(input.executionId) ? { executionId: input.executionId } : {},
        ...validIdentity(input.attemptId) ? { attemptId: input.attemptId } : {},
        candidates: all,
        health,
        circuit,
        ...input.budget === undefined ? {} : { budget: input.budget },
        ...input.admission === undefined ? {} : { admission: input.admission },
        ...priorDecision ? { priorDecision } : {},
        signal: input.signal,
      })
      const result = await policyOwner.evaluate(decisionInput, all)
      abortIfNeeded(input.signal)
      const decision = makeDecision(state, input, decisionId, windowKey, all, result, priorDecision)
      decisions.push(decision)
      if (decisions.length > state.historyLimit) decisions.splice(0, decisions.length - state.historyLimit)
      return decision
    })()
    windows.set(key, { promise, decisionId })
    try {
      return await promise
    } catch (error) {
      if (windows.get(key)?.decisionId === decisionId) windows.delete(key)
      throw error
    }
  }

  const decisionsApi = Object.freeze({
    get(decisionId) {
      assertActive(state.active)
      return decisions.find((decision) => decision.decisionId === decisionId)
    },
    history(filters = {}, options = {}) {
      assertActive(state.active)
      const limit = normalizeLimit(options.limit)
      const sessionId = filters?.sessionId
      const executionId = filters?.executionId
      const filtered = decisions.filter((decision) => {
        if (sessionId !== undefined && decision.windowKey.sessionId !== sessionId) return false
        if (executionId !== undefined && decision.executionId !== executionId) return false
        return true
      })
      const cursor = Number.isInteger(Number(options.cursor)) ? Math.max(0, Number(options.cursor)) : 0
      const page = filtered.slice(cursor, cursor + limit)
      const nextCursor = cursor + page.length < filtered.length ? String(cursor + page.length) : undefined
      return snapshot({ items: page, truncated: nextCursor !== undefined, nextCursor })
    },
    get availability() {
      return snapshot({ active: state.active(), count: decisions.length, windows: windows.size, limit: state.historyLimit })
    },
  })
  return { decide, decisionsApi }
}

function makeAvailability(state, candidateOwner, policyOwner, healthOwner, decisionsApi) {
  return () => snapshot({
    status: state.active() ? 'active' : 'unavailable',
    active: state.active(),
    policy: policyOwner.api.availability,
    candidates: candidateOwner.api.availability,
    health: healthOwner.api.availability,
    decisions: decisionsApi.availability,
  })
}

export function createRoutePolicyOwner(options = {}) {
  let disposed = false
  const state = {
    idFactory: typeof options.idFactory === 'function' ? options.idFactory : () => randomUUID(),
    now: typeof options.now === 'function' ? options.now : () => new Date(),
    logger: options.logger,
    historyLimit: normalizeLimit(options.historyLimit ?? DEFAULT_HISTORY_LIMIT),
    diagnostics: [],
    active: () => !disposed,
  }
  const candidateOwner = createCandidateOwner(state)
  const policyOwner = createPolicyOwner(state, candidateOwner)
  const healthOwner = createHealthOwner(state)
  const decisionOwner = createDecisionOwner(state, candidateOwner, policyOwner, healthOwner)
  const availability = makeAvailability(state, candidateOwner, policyOwner, healthOwner, decisionOwner.decisionsApi)
  const api = {
    policy: policyOwner.api,
    candidates: candidateOwner.api,
    health: healthOwner.api,
    circuit: healthOwner.circuitApi,
    decisions: decisionOwner.decisionsApi,
    availability,
  }
  Object.defineProperty(api, ROUTE_POLICY_ACTIVE_SYMBOL, { enumerable: false, value: true })
  Object.defineProperty(api, 'decide', { enumerable: false, value: decisionOwner.decide })
  Object.defineProperty(api, 'diagnostics', { enumerable: false, get: () => snapshot(state.diagnostics) })
  Object.defineProperty(api, 'dispose', { enumerable: false, value: () => { disposed = true; return true } })
  return {
    api: Object.freeze(api),
    decide: decisionOwner.decide,
    dispose() {
      if (disposed) return false
      disposed = true
      return true
    },
    isActive: () => !disposed,
    diagnostics: () => snapshot(state.diagnostics),
  }
}

export function routePolicyContract(value) {
  return Boolean(value?.[ROUTE_POLICY_ACTIVE_SYMBOL] === true && typeof value?.decide === 'function' && typeof value?.availability === 'function')
}

export { PRIORITIES as ROUTE_POLICY_PRIORITIES, normalizeCandidate, normalizeWindowKey, scopeKey }
