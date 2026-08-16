/**
 * Read-only BASE event catalog for pluginApi.events.
 *
 * The catalog is the source of truth for typed subscriptions: event name,

 * official dispatch mode, scope-filtered status, scope-key resolution, payload
 * shape, source feature id, A/B provenance, and the per-event fault/freeze
 * policies used by the event bus.
 *
 * First version covered exactly the 19 in-scope event names of
 * plugin-api-events-m1. plugin-api-agent-m1 extends it with the 12 official
 * `agent/*` events (31 total).
 *
 * The catalog is deeply frozen and must never be mutated at runtime.
 */

function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value
  for (const key of Object.keys(value)) deepFreeze(value[key])
  return Object.freeze(value)
}

const A = 'A'
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
 *   source: string,
 *   type: 'A' | 'B',
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
    source: 'O1',
    type: A,
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
    source: 'O2',
    type: A,
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
    source: 'O3',
    type: A,
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
    source: 'O4',
    type: A,
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
    source: 'O4',
    type: A,
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
    source: 'O5',
    type: A,
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
    source: 'O5',
    type: A,
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
    source: 'O6',
    type: A,
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
    source: 'O6',
    type: A,
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
    source: 'O6',
    type: A,
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
    source: 'O6',
    type: A,
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
    source: 'O6',
    type: A,
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
    source: 'O6',
    type: A,
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
    source: 'O7',
    type: A,
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
    source: 'O9',
    type: A,
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
    source: 'O10',
    type: A,
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
    source: 'O11',
    type: A,
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
    source: 'O12',
    type: A,
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
    source: 'O16',
    type: A,
    fault: 'contain',
    freeze: 'all',
  },
]

/** @type {Readonly<Record<string, typeof entries[number]>>} */
export const baseEventsCatalog = deepFreeze(Object.fromEntries(entries.map((entry) => [entry.name, entry])))

/**
 * @param {string} name - event name
 * @returns {typeof entries[number] | undefined} the frozen base catalog entry, if cataloged
 */
export function catalogEntryOf(name) {
  return baseEventsCatalog[name]
}
