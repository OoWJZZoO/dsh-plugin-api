/**
 * Static capability conservation matrix for the pluginApi root.
 *
 * Neutral, frozen mirror of the public contract registry capabilityMatrix
 * section: one conservation status per capability cluster with its
 * qualifiers, replacement and gap reason. It is intentionally static and
 * harness-free; the registry test suite asserts this table stays in sync
 * with the registry (single source of truth). The query surface exposes no
 * internal mounter, package, replacement row or writable registry object.
 */

function entry(record) {
  return Object.freeze({
    capabilityCluster: record.capabilityCluster,
    status: record.status,
    qualifiers: Object.freeze([...record.qualifiers]),
    replacement: record.replacement,
    gapReason: record.gapReason,
  })
}

export const CAPABILITY_MATRIX = Object.freeze([
  entry({"capabilityCluster": "facade.root", "status": "retained", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "events", "status": "merged", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "llm", "status": "renamed", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "llm.officialPassthrough", "status": "migrated", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "llm.requestTransforms", "status": "renamed", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "llm.admissionPolicies", "status": "retained", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "llm.adapters", "status": "renamed", "qualifiers": ["split"], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "llm.routing", "status": "merged", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "llm.routing.health", "status": "renamed", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "llm.routing.health removals", "status": "deleted", "qualifiers": [], "replacement": "llm.routing.health.probe -> llm.routing.health.probe.register; llm.routing.health.startProbe -> llm.routing.health.probe.register; llm.routing.health.completeProbe -> llm.routing.health.probe.register; probe execution remains caller-driven via the probe registry and health.observe projection; the facade has no automatic probe scheduler", "gapReason": null}),
  entry({"capabilityCluster": "llm.routing.circuit", "status": "renamed", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "llm.routing.decisions", "status": "retained", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "agents", "status": "retained", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "agents.providers", "status": "merged", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "agents.officialPassthrough", "status": "migrated", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "executions", "status": "merged", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "executions.recovery", "status": "migrated", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "executions.recovery internalized", "status": "retained", "qualifiers": ["internalized"], "replacement": "internal facade mechanism", "gapReason": null}),
  entry({"capabilityCluster": "executions.recovery removals", "status": "deleted", "qualifiers": [], "replacement": "executions.recovery.consume -> automatic single consumption: the internal recovery authority decides and commits at most one consumption per operation window on the supported official failure paths (agent/model request, tool dispatch, facade task/transaction); cooperative callers use executions.recovery.evaluate", "gapReason": null}),
  entry({"capabilityCluster": "sessions", "status": "merged", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "sessions.officialPassthrough", "status": "migrated", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "sessions.durable", "status": "merged", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "sessions.branches", "status": "retained", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "sessions.channels", "status": "merged", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "sessions.channels internalized", "status": "retained", "qualifiers": ["internalized"], "replacement": "internal facade mechanism", "gapReason": null}),
  entry({"capabilityCluster": "sessions.channels.auth", "status": "merged", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "sessions.channels.redaction", "status": "renamed", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "tools", "status": "migrated", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "tools.discovery", "status": "renamed", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "skills.activation", "status": "merged", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "prompts", "status": "merged", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "prompts.officialPassthrough", "status": "migrated", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "prompts.provenance", "status": "retained", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "attachments", "status": "retained", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "attachments.pipeline", "status": "renamed", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "attachments.projection", "status": "renamed", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "mcp", "status": "renamed", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "tasks", "status": "renamed", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "coordination", "status": "renamed", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "workspaces.transactions", "status": "retained", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "security.policy", "status": "retained", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "security.redaction", "status": "retained", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "security.egress", "status": "retained", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "security.egress removals", "status": "deleted", "qualifiers": [], "replacement": "security.egress.check -> automatic admission: registered egress policies are evaluated by the internal egress authority before any outbound side effect on the supported official paths (llm model discovery, mcp stdio/http transport); cooperative callers register policies and acquire/release typed leases", "gapReason": null}),
  entry({"capabilityCluster": "security.egress.lease", "status": "retained", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "security.audit", "status": "renamed", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "security", "status": "retained", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "diagnostics", "status": "renamed", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "settings", "status": "renamed", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "settings internalized", "status": "retained", "qualifiers": ["internalized"], "replacement": "internal facade mechanism", "gapReason": null}),
  entry({"capabilityCluster": "settings removals", "status": "deleted", "qualifiers": [], "replacement": "settings.installSettingsSection -> settings.register", "gapReason": null}),
  entry({"capabilityCluster": "settings.officialPassthrough", "status": "migrated", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "settings.remote", "status": "renamed", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "profiles", "status": "retained", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "profiles.snapshot", "status": "retained", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "remotes", "status": "renamed", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "remotes internalized", "status": "retained", "qualifiers": ["internalized"], "replacement": "internal facade mechanism", "gapReason": null}),
  entry({"capabilityCluster": "storage", "status": "migrated", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "storage removals", "status": "deleted", "qualifiers": [], "replacement": "storage.open.handle.dispose: the operation handle destruction verb replaces the deleted close()", "gapReason": null}),
  entry({"capabilityCluster": "services", "status": "retained", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "client.isActive", "status": "retained", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "client.apiVersion", "status": "retained", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "client.assertCompatible", "status": "retained", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "client.capabilities", "status": "retained", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "client.connection", "status": "renamed", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "client.connection internalized", "status": "retained", "qualifiers": ["internalized"], "replacement": "internal facade mechanism", "gapReason": null}),
  entry({"capabilityCluster": "client.events", "status": "merged", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "client.remotes", "status": "merged", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "client.settings", "status": "renamed", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "client.slots", "status": "merged", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "client.lifecycle", "status": "merged", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "client.codec", "status": "renamed", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "client.codec removals", "status": "deleted", "qualifiers": [], "replacement": "codec.zod -> codec facade-owned validation and registration leaves (codec.json, codec.strict, codec.invocation, codec.validate)", "gapReason": null}),
  entry({"capabilityCluster": "client.services", "status": "retained", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "skills", "status": "retained", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "workspaces", "status": "retained", "qualifiers": [], "replacement": null, "gapReason": null}),
  entry({"capabilityCluster": "events.define", "status": "retained", "qualifiers": [], "replacement": null, "gapReason": null}),
])

const BY_CLUSTER = new Map(CAPABILITY_MATRIX.map((record) => [record.capabilityCluster, record]))

/** Frozen conservation view: one row per capability cluster. */
export function capabilityMatrixView() {
  return Object.freeze({ clusters: CAPABILITY_MATRIX })
}

/** @returns {object|undefined} the frozen conservation row for a cluster. */
export function capabilityMatrixCluster(cluster) {
  return BY_CLUSTER.get(cluster)
}
