/**
 * Read-only event catalog for pluginApi.events (M1 base).
 *
 * The catalog is the source of truth for typed subscriptions: event name,
 * official dispatch mode, scope-filtered status, subject resolution, payload
 * shape, source feature id, and A/B provenance. This first version covers
 * exactly the 25 in-scope features of plugin-api-events-m1 (19 event names;
 * O15 is a service passthrough and therefore has no catalog entry).
 *
 * The catalog is deeply frozen and must never be mutated at runtime.
 */

function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value
  for (const key of Object.keys(value)) deepFreeze(value[key])
  return Object.freeze(value)
}

const A = 'A'

/**
 * @type {Array<{
 *   name: string,
 *   mode: 'on' | 'emit' | 'serial' | 'parallel' | 'bail' | 'waterfall',
 *   scopeFiltered: boolean,
 *   subject: 'args[0].agent' | null | undefined,
 *   payload: string,
 *   args: string,
 *   source: string,
 *   type: 'A' | 'B',
 * }>}
 */
const entries = [
  {
    name: 'fs/write-intent',
    mode: 'waterfall',
    scopeFiltered: false,
    subject: undefined,
    payload: 'logical payload {target, exec}; target = {targetKey, displayPath}',
    args: '(target, exec, next)',
    source: 'O1',
    type: A,
  },
  {
    name: 'fs/edit-intent',
    mode: 'waterfall',
    scopeFiltered: false,
    subject: undefined,
    payload: 'logical payload {target, exec}; target = {targetKey, displayPath}',
    args: '(target, exec, next)',
    source: 'O2',
    type: A,
  },
  {
    name: 'fs/observed',
    mode: 'emit',
    scopeFiltered: false,
    subject: undefined,
    payload: "logical payload {target, observation, actor}; observation.kind: 'present' | 'absent'",
    args: '(target, observation, actor)',
    source: 'O3',
    type: A,
  },
  {
    name: 'subagent/start',
    mode: 'emit',
    scopeFiltered: true,
    subject: null, // presence-only: scope key comes from the dispatch carrier, not from args
    payload: '{runId, provider, id, local}',
    args: '(info)',
    source: 'O4',
    type: A,
  },
  {
    name: 'subagent/end',
    mode: 'emit',
    scopeFiltered: true,
    subject: null,
    payload: '{runId, provider, id, local, stopReason, lastAssistantMessage?}',
    args: '(info)',
    source: 'O4',
    type: A,
  },
  {
    name: 'subagent/provider-added',
    mode: 'emit',
    scopeFiltered: false,
    subject: undefined,
    payload: 'provider',
    args: '(provider)',
    source: 'O5',
    type: A,
  },
  {
    name: 'subagent/provider-removed',
    mode: 'emit',
    scopeFiltered: false,
    subject: undefined,
    payload: 'providerName',
    args: '(providerName)',
    source: 'O5',
    type: A,
  },
  {
    name: 'workflow/start',
    mode: 'emit',
    scopeFiltered: false,
    subject: undefined,
    payload: 'info {id, meta}',
    args: '(info)',
    source: 'O6',
    type: A,
  },
  {
    name: 'workflow/phase',
    mode: 'emit',
    scopeFiltered: false,
    subject: undefined,
    payload: '(info, title)',
    args: '(info, title)',
    source: 'O6',
    type: A,
  },
  {
    name: 'workflow/log',
    mode: 'emit',
    scopeFiltered: false,
    subject: undefined,
    payload: '(info, message)',
    args: '(info, message)',
    source: 'O6',
    type: A,
  },
  {
    name: 'workflow/agent-start',
    mode: 'emit',
    scopeFiltered: false,
    subject: undefined,
    payload: '(info, agent)',
    args: '(info, agent)',
    source: 'O6',
    type: A,
  },
  {
    name: 'workflow/agent-end',
    mode: 'emit',
    scopeFiltered: false,
    subject: undefined,
    payload: '(info, agent)',
    args: '(info, agent)',
    source: 'O6',
    type: A,
  },
  {
    name: 'workflow/end',
    mode: 'emit',
    scopeFiltered: false,
    subject: undefined,
    payload: '(info, {stopReason, error?, agentsStarted})',
    args: '(info, settled)',
    source: 'O6',
    type: A,
  },
  {
    name: 'approval/request',
    mode: 'waterfall',
    scopeFiltered: true,
    subject: 'args[0].agent',
    payload: "req {agent, toolName, callId?, reason?, signal}; outcome 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'",
    args: '(req, next)',
    source: 'O7',
    type: A,
  },
  {
    name: 'commands/change',
    mode: 'emit',
    scopeFiltered: false,
    subject: undefined,
    payload: 'none',
    args: '()',
    source: 'O9',
    type: A,
  },
  {
    name: 'skills/change',
    mode: 'emit',
    scopeFiltered: false,
    subject: undefined,
    payload: 'none',
    args: '()',
    source: 'O10',
    type: A,
  },
  {
    name: 'credentials/updated',
    mode: 'emit',
    scopeFiltered: false,
    subject: undefined,
    payload: 'ref',
    args: '(ref)',
    source: 'O11',
    type: A,
  },
  {
    name: 'goal/changed',
    mode: 'emit',
    scopeFiltered: true,
    subject: 'args[0].agent',
    payload: '{agent, change}',
    args: '(payload)',
    source: 'O12',
    type: A,
  },
  {
    name: 'session-telemetry/record',
    mode: 'waterfall',
    scopeFiltered: false,
    subject: undefined,
    payload: 'logical payload {record}',
    args: '(record, next)',
    source: 'O16',
    type: A,
  },
]

/** @type {Readonly<Record<string, typeof entries[number]>>} */
export const eventsCatalog = deepFreeze(Object.fromEntries(entries.map((entry) => [entry.name, entry])))

/**
 * @param {string} name - event name
 * @returns {typeof entries[number] | undefined} the frozen catalog entry, if cataloged
 */
export function catalogEntryOf(name) {
  return eventsCatalog[name]
}
