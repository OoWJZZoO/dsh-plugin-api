/**
 * Current capability projection for the pluginApi root (generated).
 *
 * One row per live capability cluster: the cluster name, its current status
 * (a three-value token, never a migration action), the limitations it carries
 * today — the paths the cluster designates that the facade does not publish —
 * and, for a cluster that is unavailable, the gap reason. The
 * migration ledger — rename / merge / migrate / delete / internalize and the
 * replacement notes — lives in the public contract registry's registration
 * face and deliberately does not appear here.
 *
 * Rebuild with `node scripts/capability-matrix-sync.mjs`; the registry test
 * suite asserts the projection stays derived from the registry.
 */
export const CAPABILITY_MATRIX = Object.freeze([
  {
    capabilityCluster: "facade.root",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "events",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "llm",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "llm.officialPassthrough",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "llm.requestTransforms",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "llm.admissionPolicies",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "llm.adapters",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "llm.routing",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "llm.routing.health",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "llm.routing.circuit",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "llm.routing.decisions",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "agents",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "agents.providers",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "agents.officialPassthrough",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "agents.decisions",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "executions",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "executions.recovery",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "sessions",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "sessions.officialPassthrough",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "sessions.durable",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "sessions.branches",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "sessions.channels",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "sessions.channels.auth",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "sessions.channels.redaction",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "tools",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "tools.discovery",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "skills.activation",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "prompts",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "prompts.officialPassthrough",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "prompts.provenance",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "attachments",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "attachments.pipeline",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "attachments.projection",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "mcp",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "tasks",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "coordination",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "workspaces.transactions",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "security.policy",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "security.redaction",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "security.egress",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "security.egress.lease",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "security.audit",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "security",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "diagnostics",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "settings",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "settings.officialPassthrough",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "settings.remote",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "profiles",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "profiles.snapshot",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "remotes",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "storage",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "services",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "client.isActive",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "client.apiVersion",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "client.assertCompatible",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "client.capabilities",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "client.connection",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "client.events",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "client.remotes",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "client.settings",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "client.slots",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "client.lifecycle",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "client.codec",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "client.services",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "skills",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "workspaces",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "events.define",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "sessions.activity",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "sessions.planMode",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "sessions.permissionPresets",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "credentials",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "sessions.compaction",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "workflows",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "sessions.activity.attempt-facts",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "sessions.request",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "sessions.cancel",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "attention",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "executions.recovery.checkpoints",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "executions.recovery.checkpoints.capture.branch",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "executions.recovery.checkpoints.capture.workspace-journal",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "executions.recovery.checkpoints.capture.workspace-snapshot",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "executions.recovery.checkpoints.restore",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "executions.recovery.checkpoints.restore.stop-then-restore",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "client.sessions",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "client.attention",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "agents.scopes",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "sessions.interactions",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "sessions.selection",
    status: "active",
    limitations: [],
    gapReason: null,
  },
  {
    capabilityCluster: "services.appExit",
    status: "active",
    limitations: [],
    gapReason: null,
  },
].map((record) => Object.freeze({ ...record, limitations: Object.freeze([...record.limitations]) })))

const BY_CLUSTER = new Map(CAPABILITY_MATRIX.map((record) => [record.capabilityCluster, record]))

/** Frozen current-capability view: one row per live capability cluster. */
export function capabilityMatrixView() {
  return Object.freeze({ clusters: CAPABILITY_MATRIX })
}

/** @returns {object|undefined} the frozen projection row for a cluster. */
export function capabilityMatrixCluster(cluster) {
  return BY_CLUSTER.get(cluster)
}
