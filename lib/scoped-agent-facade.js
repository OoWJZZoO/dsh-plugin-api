import { createScopedAgentContributionRegistry } from './scoped-agent-contributions.js'
import { deriveAdapterRegistrationOwner } from './llm-adapter-registration.js'

/**
 * Scoped agent contributions feature: scope-bound handles on the agents
 * domain, target-dimension contributions on the prompts/tools faces, and
 * the per-step selection snapshot consumption cells.
 *
 * Wiring is host-side only: the registry binds the official agents registry
 * (lazy per-call resolution), the lifecycle listeners ride the official
 * `agent/created` / `agent/disposed` facts through the shared event
 * substrate, and every listener contains its own faults (a synchronous
 * throw from an `agent/created` listener would veto official agent
 * publication — this feature must never become that veto source).
 */
export function createScopedAgentContributionsFeature({ ctx, service, logger }) {
  const reportDiagnostics = (message) => {
    try {
      logger?.warn?.(`dsh-plugin-api scoped contributions: ${message}`)
    } catch {
      // diagnostics must never escape the fail-safe mount path
    }
  }
  const safeAgents = () => {
    try {
      const agents = typeof ctx?.get === 'function' ? ctx.get('agents') : null
      return agents && typeof agents.get === 'function' ? agents : null
    } catch {
      return null
    }
  }
  const registry = createScopedAgentContributionRegistry({
    active: () => service.isActive,
    agentsProvider: safeAgents,
    resolveOwnerId: deriveAdapterRegistrationOwner,
    reportDiagnostics,
  })

  let lifecycleDispose = null
  try {
    if (typeof ctx?.on === 'function') {
      lifecycleDispose = registry.attachLifecycle(
        (listener) => ctx.on('agent/created', listener),
        (listener) => ctx.on('agent/disposed', listener),
      )
    } else {
      reportDiagnostics('shared event substrate unavailable; resume/retire handling stays inert')
    }
  } catch (error) {
    reportDiagnostics(`lifecycle attach failed: ${error?.message ?? error}`)
    lifecycleDispose = null
  }

  const providers = Object.freeze({
    agents: (callerCtx) => Object.freeze({
      scopes: Object.freeze({
        register: (spec) => registry.registerScope(spec, callerCtx),
        snapshotOf: (handle) => registry.snapshotCellOf(handle),
      }),
    }),
  })

  return {
    registry,
    providers,
    disposer: () => {
      try {
        lifecycleDispose?.()
      } catch {
        // teardown must never throw through the host path
      }
    },
  }
}

/**
 * Mount the scoped agent contributions feature (fail-safe: every failure
 * degrades the feature with a bounded diagnostic, never the boot).
 */
export function mountScopedAgentContributionsFeature({ ctx, service, featureRegistry, logger }) {
  if (typeof featureRegistry?.isActive === 'function' && featureRegistry.isActive('scopedAgentContributions')) {
    return { disposer: () => {} }
  }

  let feature
  try {
    feature = createScopedAgentContributionsFeature({ ctx, service, logger })
  } catch (error) {
    try {
      logger?.warn?.(`dsh-plugin-api: scoped agent contributions mount failed and stays disabled: ${error?.message ?? error}`)
    } catch {
      // diagnostics must never escape the fail-safe mount path
    }
    try {
      featureRegistry?.disable?.('scopedAgentContributions', 'scoped contributions mount failed')
    } catch {
      // registry disable must never escape the fail-safe mount path
    }
    return { disposer: () => {} }
  }

  try {
    service._setScopedContributionFeature(feature)
    featureRegistry?.mount?.('scopedAgentContributions')
  } catch (error) {
    try {
      logger?.warn?.(`dsh-plugin-api: scoped agent contributions could not attach: ${error?.message ?? error}`)
    } catch {
      // diagnostics must never escape the fail-safe mount path
    }
    try {
      feature?.disposer?.()
    } catch {
      // teardown must never throw through the fail-safe path
    }
    try {
      featureRegistry?.disable?.('scopedAgentContributions', 'scoped contributions attach failed')
    } catch {
      // registry disable must never escape the fail-safe mount path
    }
  }

  return {
    disposer: () => {
      try {
        feature.disposer()
      } catch {
        // teardown must never throw through the host path
      }
      try {
        service._setScopedContributionFeature(null)
      } catch {
        // provider teardown is best-effort
      }
    },
  }
}
