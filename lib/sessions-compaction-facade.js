import {
  mapCompactionOutcome,
  resolveCompactionGate,
  validateCompactionRunOptions,
} from './sessions-compaction.js'
import { PluginApiFeatureDisabledError } from './errors.js'

/**
 * `sessions.compaction` feature mount: the controlled compaction operation
 * projected over the compaction replacement's operation sub-face.
 *
 * The gate is resolved lazily on every invocation (design: the main package and
 * the replacement row may load in either order), and a failed gate is a typed
 * disabled error on `run()` plus an honest `unavailable` availability — never a
 * thrown apply and never a bypass of the marker. The engine remains the single
 * executor and fact producer: this facade only validates the invocation, routes
 * exactly one request to the sub-face, and maps the discriminated outcome.
 */
export function mountSessionCompactionFeature({ ctx, service, featureRegistry, logger, auxiliaryManifests, facadeContract }) {
  if (typeof featureRegistry?.isActive === 'function' && featureRegistry.isActive('sessionCompaction')) {
    return { disposer: () => {}, prepared: null }
  }
  let mismatchReported = false
  const gate = () => {
    const resolved = resolveCompactionGate({ ctx, auxiliaryManifest: auxiliaryManifests?.compactionEvents, facadeContract })
    if (resolved.ok !== true && resolved.versionMismatch === true && !mismatchReported) {
      mismatchReported = true
      try {
        logger?.warn?.('dsh-plugin-api: the compaction replacement package version does not match the main facade contract; the sessions.compaction surface is disabled')
      } catch {
        // diagnostics must never change mount outcomes
      }
    }
    return resolved
  }

  // Resolve the target agent through the facade's own agents surface: the
  // public contract takes the same live agent reference the other
  // agent-scoped faces hand out.
  // The declared target semantics: the agent must resolve to a live agent
  // through the facade's own agents surface. An object that cannot be verified
  // (no identity, or an unreachable registry) is refused typed rather than
  // handed to the engine.
  const resolveAgent = (agent) => {
    try {
      if (!agent || typeof agent !== 'object') return undefined
      const id = typeof agent.id === 'string' && agent.id.length > 0 ? agent.id : undefined
      if (id === undefined) return undefined
      const agents = ctx?.get?.('agents')
      if (typeof agents?.get !== 'function') return undefined
      const live = agents.get(id)
      return live ?? undefined
    } catch {
      return undefined
    }
  }

  const ownerApi = {
    async run(options) {
      // The gate is a feature-level fact: a gated feature is unavailable
      // regardless of the submitted arguments, so it is checked first.
      const resolved = gate()
      if (resolved.ok !== true) {
        throw new PluginApiFeatureDisabledError('sessions.compaction', resolved.reason ?? 'the compaction replacement is not active')
      }
      const refusal = validateCompactionRunOptions(options, resolveAgent)
      if (refusal !== null) return refusal
      if (options.signal?.aborted === true) {
        return Object.freeze({ ok: false, code: 'aborted', terminal: 'aborted' })
      }
      let outcome
      try {
        outcome = await resolved.subface.run({
          agent: options.agent,
          mode: options.mode,
          ...(options.range === undefined ? {} : { range: { start: options.range.start, end: options.range.end } }),
          ...(options.signal === undefined ? {} : { signal: options.signal }),
          ...(options.sourceCommandId === undefined ? {} : { sourceCommandId: options.sourceCommandId }),
        })
      } catch (error) {
        // The sub-face contains its own failures; a throw here is a contract
        // breach and is reported typed, never propagated.
        try {
          logger?.warn?.(`dsh-plugin-api: sessions.compaction sub-face failed: ${error?.name ?? 'Error'}`)
        } catch {
          // diagnostics must never change results
        }
        return Object.freeze({ ok: false, code: 'internal', terminal: 'error', reason: 'the compaction provider failed unexpectedly' })
      }
      return mapCompactionOutcome(outcome)
    },
    availability() {
      try {
        const resolved = gate()
        return Object.freeze({
          status: resolved.ok === true ? 'active' : 'unavailable',
          ...(resolved.ok === true ? {} : { reason: resolved.reason ?? 'the compaction replacement is not active' }),
        })
      } catch {
        return Object.freeze({ status: 'unavailable', reason: 'the compaction gate probe failed' })
      }
    },
  }

  let prepared
  try {
    prepared = service.prepareFeature('sessionCompaction', ownerApi)
  } catch (error) {
    try {
      logger?.warn?.(`dsh-plugin-api: sessions.compaction could not be prepared: ${error?.message ?? error}`)
    } catch {
      // diagnostics must never escape the fail-safe mount path
    }
    return null
  }
  return {
    disposer: () => {},
    prepared,
  }
}
