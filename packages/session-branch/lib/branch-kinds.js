/**
 * The four fixed branch kinds (capability words; consumer-facing identity
 * vocabulary of the branch contract).
 */
export const BRANCH_KINDS = Object.freeze([
  'retry',
  'sidechain',
  'experiment',
  'rescue',
])

/** Whether a value is one of the four fixed branch kinds. */
export function isBranchKind(value) {
  return typeof value === 'string' && BRANCH_KINDS.includes(value)
}