/**
 * Read-only BASE event catalog for pluginApi.events.
 *
 * The catalog is the source of truth for typed subscriptions: event name,

 * official dispatch mode, scope-filtered status, scope-key resolution, payload
 * shape, provenance, and the per-event fault/freeze
 * policies used by the event bus.
 *
 * The base catalog covers the 19 baseline event names; the agent catalog
 * extends it with the 12 official `agent/*` events (31 total).
 *
 * The catalog is deeply frozen and must never be mutated at runtime.
 */

function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value
  for (const key of Object.keys(value)) deepFreeze(value[key])
  return Object.freeze(value)
}

const CONTAIN = 'contain'
const FREEZE_ALL = 'all'

/**
 * @type {Array<{
 *   name: string,
 *   mode: 'on' | 'emit' | 'serial' | 'parallel' | 'bail' | 'waterfall',
 *   scopeFiltered: boolean,
 *   scopeKey: 'args[0].agent' | 'args[1].scope' | null | undefined,
 *   payload: string,
 *   args: string,
 *   fault: 'contain' | 'created' | 'propagate',
 *   freeze: 'all' | { deep: string[] },
 *   feature?: string,
 * }>}
 */
const entries = [
  {
    name: 'fs/write-intent',
    mode: 'waterfall',
    scopeFiltered: false,
    scopeKey: undefined,
    payload: 'logical payload {target, exec}; target = {targetKey, displayPath}',
    args: '(target, exec, next)',
    fault: 'contain',
    freeze: 'all',
  },
  {
    name: 'fs/edit-intent',
    mode: 'waterfall',
    scopeFiltered: false,
    scopeKey: undefined,
    payload: 'logical payload {target, exec}; target = {targetKey, displayPath}',
    args: '(target, exec, next)',
    fault: 'contain',
    freeze: 'all',
  },
  {
    name: 'fs/observed',
    mode: 'emit',
    scopeFiltered: false,
    scopeKey: undefined,
    payload: "logical payload {target, observation, actor}; observation.kind: 'present' | 'absent'",
    args: '(target, observation, actor)',
    fault: 'contain',
    freeze: 'all',
  },
  {
    name: 'subagent/start',
    mode: 'emit',
    scopeFiltered: true,
    scopeKey: null, // presence-only: scope key comes from the dispatch carrier, not from args
    payload: '{runId, provider, id, local}',
    args: '(info)',
    fault: 'contain',
    freeze: 'all',
  },
  {
    name: 'subagent/end',
    mode: 'emit',
    scopeFiltered: true,
    scopeKey: null,
    payload: '{runId, provider, id, local, stopReason, lastAssistantMessage?}',
    args: '(info)',
    fault: 'contain',
    freeze: 'all',
  },
  {
    name: 'subagent/provider-added',
    mode: 'emit',
    scopeFiltered: false,
    scopeKey: undefined,
    payload: 'provider',
    args: '(provider)',
    fault: 'contain',
    freeze: 'all',
  },
  {
    name: 'subagent/provider-removed',
    mode: 'emit',
    scopeFiltered: false,
    scopeKey: undefined,
    payload: 'providerName',
    args: '(providerName)',
    fault: 'contain',
    freeze: 'all',
  },
  {
    name: 'workflow/start',
    mode: 'emit',
    scopeFiltered: false,
    scopeKey: undefined,
    payload: 'info {id, meta}',
    args: '(info)',
    fault: 'contain',
    freeze: 'all',
  },
  {
    name: 'workflow/phase',
    mode: 'emit',
    scopeFiltered: false,
    scopeKey: undefined,
    payload: '(info, title)',
    args: '(info, title)',
    fault: 'contain',
    freeze: 'all',
  },
  {
    name: 'workflow/log',
    mode: 'emit',
    scopeFiltered: false,
    scopeKey: undefined,
    payload: '(info, message)',
    args: '(info, message)',
    fault: 'contain',
    freeze: 'all',
  },
  {
    name: 'workflow/agent-start',
    mode: 'emit',
    scopeFiltered: false,
    scopeKey: undefined,
    payload: '(info, agent)',
    args: '(info, agent)',
    fault: 'contain',
    freeze: 'all',
  },
  {
    name: 'workflow/agent-end',
    mode: 'emit',
    scopeFiltered: false,
    scopeKey: undefined,
    payload: '(info, agent)',
    args: '(info, agent)',
    fault: 'contain',
    freeze: 'all',
  },
  {
    name: 'workflow/end',
    mode: 'emit',
    scopeFiltered: false,
    scopeKey: undefined,
    payload: '(info, {stopReason, error?, agentsStarted})',
    args: '(info, settled)',
    fault: 'contain',
    freeze: 'all',
  },
  {
    name: 'approval/request',
    mode: 'waterfall',
    scopeFiltered: true,
    scopeKey: 'args[0].agent',
    payload: "req {agent, toolName, callId?, reason?, signal}; outcome 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'",
    args: '(req, next)',
    fault: 'contain',
    freeze: 'all',
  },
  {
    name: 'commands/change',
    mode: 'emit',
    scopeFiltered: false,
    scopeKey: undefined,
    payload: 'none',
    args: '()',
    fault: 'contain',
    freeze: 'all',
  },
  {
    name: 'skills/change',
    mode: 'emit',
    scopeFiltered: false,
    scopeKey: undefined,
    payload: 'none',
    args: '()',
    fault: 'contain',
    freeze: 'all',
  },
  {
    name: 'credentials/updated',
    mode: 'emit',
    scopeFiltered: false,
    scopeKey: undefined,
    payload: 'ref',
    args: '(ref)',
    fault: 'contain',
    freeze: 'all',
  },
  {
    name: 'goal/changed',
    mode: 'emit',
    scopeFiltered: true,
    scopeKey: 'args[0].agent',
    payload: '{agent, change}',
    args: '(payload)',
    fault: 'contain',
    freeze: 'all',
  },
  {
    name: 'session-telemetry/record',
    mode: 'waterfall',
    scopeFiltered: false,
    scopeKey: undefined,
    payload: 'logical payload {record}',
    args: '(record, next)',
    fault: 'contain',
    freeze: 'all',
  },
]

/** @type {Readonly<Record<string, typeof entries[number]>>} */
export const baseEventsCatalog = deepFreeze(Object.fromEntries(entries.map((entry) => [entry.name, entry])))
