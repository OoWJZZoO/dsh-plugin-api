/**
 * Read-only BASE event catalog for pluginApi.events.
 *
 * The catalog is the source of truth for typed subscriptions: event name,

 * official dispatch mode, scope-filtered status, scope-key resolution, payload
 * shape, provenance, producer ownership, and the per-event fault/freeze
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
 * Owner identities of the facade's own production paths. An event declared as
 * facade-produced may only be dispatched by a caller whose derived owner
 * identity is listed in that event's `producer.owners`.
 */
export const FACADE_PRODUCER_OWNERS = Object.freeze([
  '@deepseek-ai/dsh-plugin-api-main',
  'plugin-api-main',
])

/** No caller may dispatch an event whose producer is the official runtime. */
const OFFICIAL_PRODUCER_OWNERS = Object.freeze([])

/**
 * Producer declaration for an event the facade's own production path produces:
 * a translation path inside the main facade, or a replacement row standing in
 * for the component it replaced.
 *
 * @param {string} authority - capability token naming the producing authority
 * @returns {Readonly<{ kind: 'facade', authority: string, owners: readonly string[] }>}
 */
export function facadeProducer(authority) {
  return Object.freeze({ kind: 'facade', authority, owners: FACADE_PRODUCER_OWNERS })
}

/**
 * Producer declaration for an event the official runtime produces and the
 * facade only observes. The official runtime keeps dispatching it natively
 * (that dispatch never passes through the facade bus), so the facade bus never
 * produces it and every caller is denied.
 *
 * @param {string} authority - capability token naming the producing authority
 * @returns {Readonly<{ kind: 'official', authority: string, owners: readonly string[] }>}
 */
export function officialProducer(authority) {
  return Object.freeze({ kind: 'official', authority, owners: OFFICIAL_PRODUCER_OWNERS })
}

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
 *   producer: Readonly<{ kind: 'facade' | 'official', authority: string, owners: readonly string[] }>,
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
    producer: officialProducer('filesystem'),
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
    producer: officialProducer('filesystem'),
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
    producer: officialProducer('filesystem'),
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
    producer: officialProducer('agent'),
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
    producer: officialProducer('agent'),
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
    producer: officialProducer('agent'),
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
    producer: officialProducer('agent'),
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
    producer: officialProducer('workflow'),
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
    producer: officialProducer('workflow'),
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
    producer: officialProducer('workflow'),
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
    producer: officialProducer('workflow'),
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
    producer: officialProducer('workflow'),
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
    producer: officialProducer('workflow'),
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
    producer: officialProducer('approval'),
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
    producer: officialProducer('commands'),
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
    producer: officialProducer('skills'),
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
    producer: officialProducer('credentials'),
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
    producer: officialProducer('goal'),
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
    producer: officialProducer('session-telemetry'),
  },
]

/** @type {Readonly<Record<string, typeof entries[number]>>} */
export const baseEventsCatalog = deepFreeze(Object.fromEntries(entries.map((entry) => [entry.name, entry])))
