/**
 * Symbol-keyed private internal policy enforcement contract.
 *
 * The main host facade publishes a typed, capability-limited internal contract
 * on the root Cordis context after its policy owners are initialized and before
 * optional component owners bind. Component replacement owners read it through
 * `readPolicyAuthority(ctx)`. The contract is NOT a public namespace, runtime
 * registry service, permission system or package identity; a missing contract
 * is a typed unavailable/degraded result at the consuming component, never an
 * implicit allow.
 */
// Global symbol so component replacement packages can read the contract across
// package boundaries without importing main-facade internals (repository-wide
// Symbol.for collaboration convention, see packages/* component markers).
export const POLICY_AUTHORITY = Symbol.for('dsh-plugin-api.policyAuthority')
export const POLICY_AUTHORITY_VERSION = 1

/** @typedef {{ ok: boolean, outcome: string, resource?: string, decisionId?: string, reason?: string, expiresAt?: unknown }} EgressAdmitResult */

/**
 * Read the internal contract defensively. A missing or malformed contract is
 * `null` so the caller reports degraded/unavailable instead of throwing.
 *
 * @param {object|null|undefined} ctx Cordis root context.
 * @returns {null | { version: number, egress: { admit: (target: unknown, context?: unknown) => EgressAdmitResult, release: (handle: unknown) => Promise<object> }, recovery: { decide: (input: unknown) => Promise<object>, commit: (decision: unknown, operation: unknown) => Promise<object> }, policy: { status: (domainOrPath: string) => string } }}
 */
export function readPolicyAuthority(ctx) {
  if (ctx === null || typeof ctx !== 'object') return null
  let contract
  try {
    contract = ctx[POLICY_AUTHORITY]
  } catch {
    return null
  }
  if (contract === null || typeof contract !== 'object') return null
  if (contract.version !== POLICY_AUTHORITY_VERSION) return null
  if (typeof contract.egress?.admit !== 'function' || typeof contract.egress?.release !== 'function') return null
  if (typeof contract.recovery?.decide !== 'function' || typeof contract.recovery?.commit !== 'function') return null
  if (typeof contract.policy?.status !== 'function') return null
  return contract
}
