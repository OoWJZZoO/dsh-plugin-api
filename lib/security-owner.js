/**
 * Host owner for the `pluginApi.security` facade.
 *
 * Seam bindings (design: 引出机制 table):
 * - `approval/request` waterfall (official dispatch): a converged denial
 *   short-circuits with the official 'rejected' outcome, an allow claims the
 *   official one-shot grant 'allowed-once', ask/no-policy delegates through
 *   `next()` so the official flow is completely unchanged;
 *   categories without an official dispatch point are disclosed as
 *   upstream-required and never emulated.
 * - `tools/pre-execute` waterfall: a denial short-circuits with a deny
 *   `PreToolDecision`; allow/ask/no-policy delegates through `next()`
 *   (never auto-allow).
 * - `tools/post-execute` waterfall: registered redaction rules are offered
 *   the result content; the transformed result is published back through the
 *   official accept-channel (content rewrite only; rebuilding `value` goes
 *   through official schema validation and is a declared out-of-scope
 *   boundary) together with marker/count provenance in the audit record.
 *   The listener composes AFTER `next()` so other listeners'
 *   decisions (spill policies, block) are never clobbered.
 * - `llm/stream` (facade-owned re-entry seam): the listener is registered
 *   after the llm/request owner's listener (FEATURE_MOUNTERS order) so it
 *   evaluates the effective request exactly once per logical model call;
 *   a denial throws a typed error so the request fails closed; ask/allow/
 *   no-policy delegates via `next()`.
 *
 * Fail-safe: a single seam binding failure degrades only that seam
 * (availability reports truthfully); owner setup failure (missing ctx.on)
 * yields null so apply() disables the feature without throwing. A throwing
 * or malformed policy degrades only that policy and is reported through the
 * existing plugin diagnostics facility with owner attribution, falling back
 * to bounded logging when diagnostics are unavailable (never use bare console). No
 * client surface exists: nothing here can be consumed as a registration /
 * decision / grant / mutation authority by client code.
 *
 * Enforcement boundary (disclosed, never emulated): mandatory interception
 * of official outbound paths without an official dispatch point is
 * upstream-required; this facade only provides the opt-in
 * consultation/lease API, and proxy environment detection is never an
 * allowance.
 */
import {
  createSecurityRegistry,
  validatePolicySpec,
  validateRedactionSpec,
  SECURITY_POINTS,
} from './security-policy.js'
import { applyRedaction } from './security-redaction.js'
import { createSecurityEgress } from './security-egress.js'
import { createSecurityAudit } from './security-audit.js'
import { SecurityPolicyDeniedError } from './security-errors.js'
import { deepFreeze } from './deep-freeze.js'

const REDACTION_CHANNEL_AUDIENCES = Object.freeze(['model', 'ui'])
const MAX_REASON = 200
const MAX_DETAIL = 240

function opaque(rng) {
  return typeof rng === 'function'
    ? rng()
    : `opaque-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function bounded(message, max = MAX_REASON) {
  const text = String(message ?? '')
  return text ? text.slice(0, max) : undefined
}

/** Read a nested field defensively (a throwing getter never breaks a seam). */
function read(obj, path) {
  try {
    let current = obj
    for (const key of path) {
      if (current === null || current === undefined) return undefined
      current = current[key]
    }
    return current
  } catch {
    return undefined
  }
}

function resolvedIfPresent(value) {
  return value === undefined || value === null ? 'unknown' : 'resolved'
}

/**
 * Create the security facade owner.
 *
 * @param {object} options
 * @param {object} options.ctx cordis context (ctx.on is the mandatory substrate)
 * @param {object} [options.logger] bounded logger ({ warn, error })
 * @param {() => number} [options.now] timestamp source (default Date.now)
 * @param {() => string} [options.rng] opaque token source
 * @param {() => object|null} [options.diagnosticsFacade] lazy resolver of the
 *   plugin diagnostics surface (service.diagnostics); null/undefined disables
 * @returns {{ api: object, dispose: () => boolean } | null} null when the
 *   mandatory substrate is missing (mount then fails safe)
 */
export function createSecurityOwner({ ctx, logger = {}, now = Date.now, rng, diagnosticsFacade = null } = {}) {
  if (typeof ctx?.on !== 'function') return null
  const warn = typeof logger.warn === 'function' ? (message) => logger.warn(message) : () => {}

  const policyStates = new Map() // `${ownerId}:${policyId}` -> { active, error, reported }
  const reportChannel = { state: 'unused' }

  /** Register one failing/degrading policy as a plugin-scoped diagnostics check. */
  const reportPolicyIssue = (ownerId, policyId, error) => {
    const key = `${ownerId}:${policyId}`
    const prior = policyStates.get(key)
    if (!prior) policyStates.set(key, { active: true, error, reported: false })
    else if (prior.active) prior.error = error
    const state = policyStates.get(key)
    if (state.reported) return // one live degraded check per policy (diagnostics reporting)
    state.reported = true
    try {
      const facade = typeof diagnosticsFacade === 'function' ? diagnosticsFacade() : null
      if (!facade || typeof facade.register !== 'function') throw new Error('diagnostics unavailable')
      facade.register({
        ownerId,
        checkId: `policy:${policyId}`,
        scope: 'plugin',
        run: () => {
          const current = policyStates.get(key)
          if (current?.active) {
            return {
              health: 'failed',
              availability: 'inactive',
              severity: 'error',
              blocking: 'non-blocking',
              uncertainty: 'observed',
              reason: { code: 'degraded', boundedDetail: bounded(current.error?.message, MAX_DETAIL) },
            }
          }
          return {
            health: 'unknown',
            availability: 'inactive',
            severity: 'info',
            blocking: 'non-blocking',
            uncertainty: 'observed',
            reason: { code: 'policy-disposed' },
          }
        },
      })
      reportChannel.state = 'available'
    } catch {
      reportChannel.state = 'degraded'
      warn(`dsh-plugin-api security: policy "${policyId}" of owner "${ownerId}" degraded: ${error?.message ?? error}`)
    }
  }

  const onPolicyError = (ownerId, policyId, error) => {
    try {
      reportPolicyIssue(ownerId, policyId, error)
    } catch {
      // attribution reporting must never break decision evaluation
    }
  }

  const nowValue = () => (typeof now === 'function' ? now() : now)
  const audit = createSecurityAudit({ now })

  const policyRegistry = createSecurityRegistry({
    validateSpec: validatePolicySpec,
    now,
    rng,
    onPolicyError,
  })
  const redactionRegistry = createSecurityRegistry({
    validateSpec: validateRedactionSpec,
    point: SECURITY_POINTS.toolAfter,
    now,
    rng,
    onPolicyError,
  })
  const egress = createSecurityEgress({ now, rng, onPolicyError })

  const appendDecision = (decision) => {
    try {
      audit.append({
        auditId: decision.auditId,
        kind: 'decision',
        at: decision.at,
        ownerIds: decision.ownerIds,
        policyIds: decision.consulted,
        summary: {
          point: decision.point,
          outcome: decision.outcome,
          winner: decision.winner,
          reason: decision.reason,
          expiresAt: decision.expiresAt,
        },
        outcome: decision.outcome,
      })
    } catch {
      // audit failures only mark the gap; decisions stay effective
    }
  }

  const decisionContext = (base) => {
    const sessionId = read(base, ['sessionId'])
    const target = read(base, ['target'])
    const toolName = read(base, ['toolName'])
    const reason = read(base, ['reason'])
    return {
      point: read(base, ['point']),
      sessionId,
      agentId: read(base, ['agentId']),
      toolName,
      callId: read(base, ['callId']),
      reason: bounded(reason),
      provider: read(base, ['provider']),
      model: read(base, ['model']),
      kind: target?.kind,
      destination: target?.destination,
      executionRef: read(base, ['executionRef']),
      provenance: resolvedIfPresent(sessionId ?? read(base, ['executionRef'])),
    }
  }

  /* ----------------------------- seams ----------------------------- */

  let approveDisposer = null
  let preDisposer = null
  let postDisposer = null
  let streamDisposer = null

  const seams = {
    approval: 'absent',
    toolBefore: 'absent',
    toolAfter: 'absent',
    modelRequest: 'absent',
  }

  const safeBind = (name, listener, seamKey) => {
    try {
      const disposer = ctx.on(name, listener)
      if (typeof disposer === 'function') {
        seams[seamKey] = 'bound'
        return disposer
      }
      return null
    } catch (error) {
      warn(`dsh-plugin-api security: seam "${name}" binding failed: ${error?.message ?? error}`)
      return null
    }
  }

  // Official semantics: listener returns an outcome to claim the request or
  // calls next() to fall through (dsh-user-approval types).
  approveDisposer = safeBind('approval/request', async (req, next) => {
    const context = decisionContext({
      point: SECURITY_POINTS.approvalBefore,
      agentId: read(req, ['agent', 'id']),
      sessionId: read(req, ['agent', 'session', 'id']),
      toolName: req?.toolName,
      callId: req?.callId,
      reason: req?.reason,
    })
    const decision = policyRegistry.evaluate({ point: SECURITY_POINTS.approvalBefore, context })
    if (!decision) return next()
    appendDecision(decision)
    if (decision.outcome === 'deny') return 'rejected'
    if (decision.outcome === 'allow') return 'allowed-once'
    return next() // ask: fall through to the normal interactive flow
  }, 'approval')

  // Official semantics: return a PreToolDecision to claim or call next().
  preDisposer = safeBind('tools/pre-execute', async (exec, next) => {
    const context = decisionContext({
      point: SECURITY_POINTS.toolBefore,
      agentId: read(exec, ['agent', 'id']),
      sessionId: read(exec, ['agent', 'session', 'id']),
      toolName: exec?.name,
      callId: exec?.callId,
      argumentsSnapshot: read(exec, ['arguments']),
    })
    const decision = policyRegistry.evaluate({ point: SECURITY_POINTS.toolBefore, context })
    if (!decision) return next()
    appendDecision(decision)
    if (decision.outcome === 'deny') {
      return { kind: 'deny', reason: decision.reason ?? 'denied by policy' }
    }
    return next() // allow/ask: the official flow proceeds unchanged
  }, 'toolBefore')

  // Official semantics: an accept decision may replace content (not value);
  // we compose after next() so sibling listeners keep influence.
  postDisposer = safeBind('tools/post-execute', async (exec, result, next) => {
    const rules = redactionRegistry.snapshot().map((entry) => ({
      id: entry.id,
      ownerId: entry.ownerId,
      audiences: entry.spec.audiences,
      match: entry.spec.match,
      action: entry.spec.action,
      mayTouchSecret: entry.spec.mayTouchSecret === true,
    }))
    const root = read(result, ['content'])
    const outcome = applyRedaction({
      root: root ?? result,
      audiences: REDACTION_CHANNEL_AUDIENCES,
      rules,
      secretGate: () => 'deny', // user/profile plane v1: fixed default-deny
    })
    const transformed = outcome.applied.length > 0 || outcome.blocked.length > 0
      || outcome.markers.binary > 0 || outcome.markers.unreadable > 0

    const decision = await Promise.resolve(next())

    if (!transformed) return decision

    try {
      audit.append({
        auditId: `r-${opaque(rng)}`,
        kind: 'redaction',
        at: nowValue(),
        ownerIds: rules.map((rule) => rule.ownerId).filter((value, index, all) => value && all.indexOf(value) === index),
        policyIds: outcome.applied.map((entry) => entry.ruleId),
        summary: {
          audiences: REDACTION_CHANNEL_AUDIENCES,
          applied: outcome.applied,
          blocked: outcome.blocked,
          markers: outcome.markers,
        },
        outcome: 'applied',
      })
    } catch {
      // audit failures only mark the gap
    }

    const preserveContexts = (base) => {
      const additionalContexts = read(base, ['additionalContexts'])
      return additionalContexts === undefined ? {} : { additionalContexts }
    }

    // A block decision carries the downstream listener's corrective feedback;
    // redaction publishes only through the accept channel and never replaces
    // that feedback (sibling decisions keep their influence).
    if (decision?.kind === 'block') {
      return decision
    }
    // accept (with or without content); value rebuilds are out of scope.
    if (decision?.kind === 'accept' && 'value' in (decision ?? {})) {
      return decision // value rewrite channel untouched (declared boundary)
    }
    return { kind: 'accept', content: outcome.content, ...preserveContexts(decision) }
  }, 'toolAfter')

  // Facade-owned re-entry seam: deny fails the request closed via a typed
  // error; everything else delegates through next().
  streamDisposer = safeBind('llm/stream', (options, next) => {
    const context = decisionContext({
      point: SECURITY_POINTS.modelRequestBefore,
      sessionId: read(options, ['sessionId']),
      provider: read(options, ['provider']),
      model: read(options, ['model']),
    })
    const decision = policyRegistry.evaluate({ point: SECURITY_POINTS.modelRequestBefore, context })
    if (!decision) return next()
    appendDecision(decision)
    if (decision.outcome === 'deny') {
      const reason = bounded(decision.reason) ?? 'denied by policy'
      const policyId = decision.winner
      const error = new SecurityPolicyDeniedError(
        `model request denied by policy ${policyId ?? '(no winner)'}: ${reason}`,
      )
      error.policyId = policyId
      error.auditId = decision.auditId
      throw error
    }
    return next()
  }, 'modelRequest')

  /* ----------------------------- public API ----------------------------- */

  const registerOn = (registry, wrapOnError = true) => (ownerId, spec) => {
    let handle
    try {
      handle = registry.register(ownerId, spec)
    } catch (error) {
      // diagnostics reporting: registration-time validation failure is reported with owner
      // attribution before the typed rejection reaches the caller (registration validation).
      try {
        reportPolicyIssue(ownerId, 'registration', error)
      } catch {
        // attribution must never mask the typed rejection
      }
      throw error
    }
    const key = `${ownerId.trim()}:${spec?.id ?? '__default__'}`
    policyStates.set(key, { active: true })
    const originalDispose = handle.dispose
    let disposed = false
    return {
      id: handle.id,
      ownerId: ownerId.trim(),
      generation: handle.generation,
      dispose: () => {
        if (disposed) return false
        disposed = true
        const state = policyStates.get(key)
        if (state) state.active = false
        return originalDispose()
      },
    }
  }

  // Registered automatic enforcement paths (from the policy inventory
  // enforcement matrix). A path outside this set reports unavailable and never
  // inherits a neighbour's status. The automatic enforcement owners bind each
  // path through the host facade.
  const EGRESS_AUTOMATIC_PATHS = Object.freeze([
    'llm/provider', 'llm/modelDiscovery', 'mcp/stdio', 'mcp/http', 'web',
    'web/attachmentRemote', 'subprocess', 'terminal', 'shell', 'connection',
    'telemetry', 'remote',
  ])

  // Automatic path binding probes, installed by the host facade once each
  // official egress owner is wired. A path without a probe (or a probe that
  // reports false) truthfully reports unavailable and never inherits a
  // neighbour's status.
  const automaticProbes = new Map()

  const egressPathStatus = (path) => {
    if (!EGRESS_AUTOMATIC_PATHS.includes(path)) return 'unavailable'
    const probe = automaticProbes.get(path)
    if (typeof probe !== 'function') return 'unavailable'
    try {
      return probe() === true ? 'active' : 'unavailable'
    } catch {
      return 'unavailable'
    }
  }

  const bindProbes = (probes) => {
    if (probes === null || typeof probes !== 'object') return false
    for (const [path, probe] of Object.entries(probes)) {
      if (!EGRESS_AUTOMATIC_PATHS.includes(path)) continue
      if (typeof probe !== 'function') continue
      automaticProbes.set(path, probe)
    }
    return true
  }

  const egressAcquire = async (request) => {
    const outcome = await egress.acquire(request)
    if (outcome.ok && outcome.handle) {
      try {
        audit.append({
          auditId: outcome.decisionId,
          kind: 'egress-grant',
          channel: 'cooperative',
          at: nowValue(),
          summary: {
            resource: outcome.resource,
            expiresAt: outcome.handle.expiresAt,
            reason: 'cooperative egress lease grant',
          },
          outcome: 'allow',
          generation: outcome.handle.generation,
        })
      } catch {
        // audit failures only mark the gap; the grant keeps its effect
      }
    }
    return outcome
  }

  const egressRelease = async (handle) => {
    const outcome = await egress.release(handle)
    if (outcome.ok) {
      try {
        audit.append({
          auditId: `g-${opaque(rng)}`,
          kind: 'egress-grant',
          channel: 'cooperative',
          at: nowValue(),
          summary: { resource: outcome.resource, reason: 'cooperative egress lease release' },
          outcome: 'released',
        })
      } catch {
        // audit failures only mark the gap
      }
    }
    return outcome
  }

  const egressAdmit = (target, context) => egress.admit(target, context)

  const egressCoverage = () => {
    const automatic = {}
    let activeCount = 0
    for (const path of EGRESS_AUTOMATIC_PATHS) {
      const value = egressPathStatus(path)
      automatic[path] = value
      if (value === 'active') activeCount += 1
    }
    const registration = egress ? 'active' : 'unavailable'
    const cooperative = egress ? 'active' : 'unavailable'
    const status = !egress
      ? 'unavailable'
      : activeCount === EGRESS_AUTOMATIC_PATHS.length ? 'active' : 'degraded'
    return deepFreeze({
      status,
      registration,
      cooperative,
      automatic: deepFreeze(automatic),
      observedAt: new Date(nowValue()).toISOString(),
    })
  }

  const policyStatus = (domainOrPath) => {
    // Per-path automatic coverage status. A registered path without a bound
    // automatic owner reports unavailable (never degraded, never inherited
    // from a neighbour), matching the recovery authority vocabulary; each
    // path flips to active when its binding probe reports its official owner
    // is wired.
    if (typeof domainOrPath === 'string' && domainOrPath.startsWith('egress')) {
      const path = domainOrPath.slice('egress'.length).replace(/^\./, '')
      if (path && !EGRESS_AUTOMATIC_PATHS.includes(path)) return 'unavailable'
      if (!path) return 'unavailable'
      return egressPathStatus(path)
    }
    return 'unavailable'
  }

  const api = Object.freeze({
    policy: Object.freeze({ register: registerOn(policyRegistry) }),
    redaction: Object.freeze({ register: registerOn(redactionRegistry) }),
    egress: Object.freeze({
      register: registerOn(egress.registry),
      lease: Object.freeze({ acquire: egressAcquire, release: egressRelease }),
      coverage: egressCoverage,
    }),
    audit: Object.freeze({ list: (filter) => audit.query(filter) }),
    // Private internal enforcement contract consumed by the host facade for
    // the symbol-keyed publication; never part of the public namespace.
    _internal: Object.freeze({
      egress: Object.freeze({
        admit: egressAdmit,
        release: egressRelease,
      }),
      policy: Object.freeze({ status: policyStatus }),
      bindProbes,
    }),
    get availability() {
      const status = audit.status()
      return Object.freeze({
        faces: Object.freeze({
          policy: policyRegistry ? 'active' : 'inert',
          redaction: redactionRegistry ? 'active' : 'inert',
          egress: egress ? 'active' : 'inert',
          audit: status.gapSince === undefined ? 'active' : 'degraded',
        }),
        seams: Object.freeze({ ...seams }),
        secretPolicy: 'default-deny',
        reportChannel: reportChannel.state,
        audit: Object.freeze(status),
      })
    },
  })

  let disposed = false
  const dispose = () => {
    if (disposed) return false
    disposed = true
    for (const disposer of [approveDisposer, preDisposer, postDisposer, streamDisposer]) {
      try {
        disposer?.()
      } catch {
        // disposal must never take down the fail-safe path
      }
    }
    try {
      policyRegistry.disposeAll()
      redactionRegistry.disposeAll()
      egress.dispose()
      audit.dispose()
      policyStates.clear()
    } catch {
      // owner teardown is best-effort
    }
    return true
  }

  return { api, dispose }
}