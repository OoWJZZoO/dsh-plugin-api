/**
 * Static capability descriptor table for the `pluginApi.capabilities` query
 * surface (host).
 *
 * The table is a neutral, frozen mirror of the public contract registry's
 * host member entries: one entry per public capability path with its effect
 * and the internal feature keys that back it. It is intentionally static and
 * harness-free; the registry test suite asserts that this table stays in
 * sync with `docs/specs/.../public-contract.registry.json` (single source of
 * truth), so a capability can never be added to the registry without its
 * runtime descriptor.
 *
 * The internal `features` field is consumed only to compute current
 * availability; it is never exposed through the query surface.
 */

/**
 * @param {string} capability  public capability path (dot path)
 * @param {string} effect      vocabulary: read | subscribe | register | decide | mutate | execute
 * @param {string[]} features  internal feature keys that back this capability (availability inputs)
 * @param {object} [extra]
 */
function entry(capability, effect, features, extra = {}) {
  return Object.freeze({ capability, effect, features: Object.freeze([...features]), ...extra })
}

export const CAPABILITY_DESCRIPTORS = Object.freeze([
  entry('apiVersion', 'read', ['core']),
  entry('isActive', 'read', ['core']),
  entry('assertCompatible', 'read', ['core']),
  entry('capabilities', 'read', ['core']),
  entry('events', 'subscribe', ['events']),
  entry('llm', 'read', ['llm']),
  entry('llm.requestTransforms', 'register', ['llm/request']),
  entry('llm.admissionPolicies', 'register', ['llm/admission']),
  entry('llm.adapters', 'register', ['llmAdapters']),
  entry('llm.routing', 'read', ['execRoute', 'sessionRoute', 'routePolicy']),
  entry('agents', 'execute', ['agent']),
  entry('executions', 'read', ['execution']),
  entry('executions.recovery', 'read', ['recovery']),
  entry('sessions', 'execute', ['session', 'sessionDurable']),
  entry('sessions.branches', 'mutate', ['sessionBranch']),
  entry('sessions.channels', 'mutate', ['sessionChannel']),
  entry('tools', 'register', ['tools']),
  entry('tools.discovery', 'register', ['toolDiscovery']),
  entry('skills', 'register', ['skillsActivation']),
  entry('prompts', 'register', ['systemPrompt', 'officialPassthrough']),
  entry('prompts.provenance', 'register', ['context']),
  entry('attachments', 'register', ['attachments']),
  entry('mcp', 'read', ['mcp']),
  entry('tasks', 'read', ['tasks']),
  entry('coordination', 'mutate', ['coordination']),
  entry('storage', 'mutate', ['storage']),
  entry('workspaces.transactions', 'mutate', ['workspaceTransactions']),
  entry('security', 'decide', ['security']),
  entry('diagnostics', 'register', ['diagnostics']),
  entry('settings', 'register', ['settings', 'settingsRemote']),
  entry('profiles', 'read', ['profile']),
  entry('remotes', 'register', ['remote']),
  entry('services', 'execute', ['services', 'typert']),
])

/** All capability paths in registry order. */
export const CAPABILITY_PATHS = Object.freeze(CAPABILITY_DESCRIPTORS.map((descriptor) => descriptor.capability))

const BY_PATH = new Map(CAPABILITY_DESCRIPTORS.map((descriptor) => [descriptor.capability, descriptor]))

/** @returns {object|undefined} the frozen descriptor for a capability path. */
export function capabilityDescriptor(capability) {
  return BY_PATH.get(capability)
}