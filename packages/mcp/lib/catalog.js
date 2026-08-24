/**
 * Read-only MCP server/tool catalog and lifecycle projection, owned by the
 * replacement `@deepseek-ai/dsh-plugin-api-mcp`.
 *
 * The catalog is shared per `ctx.root`: every replacement instance (one MCP
 * server per row) publishes its own server state through the connection
 * supervisor's `onPublish` hook, and the first active instance registers the
 * `ctx.mcpCatalog` service on the root context. Consumers can only query —
 * they can never register, unregister or mutate MCP tools through this
 * projection, and none of the query parameters trigger any side effect.
 *
 * Vocabulary (design Data Models):
 * - `LifecycleState`: `pending | available | unavailable | disposed`. The
 *   execution-outcome term `superseded` is NEVER written into `lifecycleState`;
 *   a replaced generation is represented as `unavailable`/`disposed`.
 * - `ProvenanceSource`: `config | sync | list_changed | reconnect`.
 */
import { Service } from '@deepseek-ai/cordis'

export const MCP_CATALOG_CHANGED = 'mcp/catalog-changed'
export const CATALOG_SERVICE_NAME = 'mcpCatalog'

/** Deeply freeze an object graph; repeated/cyclic values are left untouched. */
export function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item, seen)
    Object.freeze(value)
    return value
  }
  for (const key of Object.keys(value)) deepFreeze(value[key], seen)
  Object.freeze(value)
  return value
}

function createShared() {
  return {
    servers: new Map(), // serverName -> ServerRecord
    toolsByServer: new Map(), // serverName -> Map<generation, ToolRecord[]>
    current: new Map(), // serverName -> current generation
    service: null,
    emitCtx: null,
    version: 0,
  }
}

const rootRegistry = new WeakMap()

/** Resolve (or create) the shared catalog state for a context root. */
export function sharedFor(ctx) {
  const root = ctx?.root ?? ctx
  let shared = rootRegistry.get(root)
  if (!shared) {
    shared = createShared()
    rootRegistry.set(root, shared)
  }
  return shared
}

function toServerRecord(payload) {
  return {
    serverName: payload.serverName,
    lifecycleState: payload.lifecycleState,
    generation: payload.generation,
    transport: payload.transport,
    observedAt: payload.observedAt,
    ...(payload.reason
      ? {
          reason: {
            code: payload.reason.code,
            ...(payload.reason.category ? { category: payload.reason.category } : {}),
          },
        }
      : {}),
    provenance: {
      source: payload.provenance?.source ?? 'config',
      certainty: payload.provenance?.certainty ?? 'observed',
    },
  }
}

function toToolRecords(payload) {
  const now = payload.observedAt
  const source = payload.provenance?.source ?? 'config'
  return (payload.tools ?? []).map((tool) => ({
    identity: { serverName: payload.serverName, rawName: tool.rawName },
    publicName: tool.publicName,
    generation: payload.generation,
    ...(tool.description ? { description: tool.description } : {}),
    inputSchema: tool.inputSchema ?? 'unavailable',
    outputSchema: tool.outputSchema ?? 'unavailable',
    lifecycleState: tool.lifecycleState ?? payload.lifecycleState,
    provenance: {
      source: tool.provenance?.source ?? source,
      observedAt: tool.provenance?.observedAt ?? now,
    },
  }))
}

function buildSnapshot(shared) {
  const tools = []
  for (const [serverName, genMap] of shared.toolsByServer) {
    const current = shared.current.get(serverName)
    if (current === undefined) continue
    tools.push(...(genMap.get(current) ?? []))
  }
  return { servers: [...shared.servers.values()], tools }
}

/**
 * Apply one connection publication into the shared catalog state and emit a
 * frozen `mcp/catalog-changed` snapshot. Fail-safe: invalid payloads and
 * listener errors never throw through the connection supervisor.
 *
 * @param {object} shared - shared catalog state from {@link sharedFor}.
 * @param {object} rootCtx - root Cordis context used to emit notifications.
 * @param {object} payload - publication from the connection supervisor.
 */
export function applyPayload(shared, rootCtx, payload) {
  if (!payload || typeof payload.serverName !== 'string') return
  shared.servers.set(payload.serverName, toServerRecord(payload))
  if (payload.tools !== undefined) {
    shared.toolsByServer.set(payload.serverName, new Map([[payload.generation, toToolRecords(payload)]]))
    shared.current.set(payload.serverName, payload.generation)
  }
  shared.version += 1
  let snapshot
  try {
    snapshot = deepFreeze(buildSnapshot(shared))
  } catch {
    return
  }
  if (rootCtx && typeof rootCtx.emit === 'function') {
    try {
      rootCtx.emit(MCP_CATALOG_CHANGED, snapshot)
    } catch {
      // listener containment: one bad listener must not propagate
    }
  }
}

/**
 * Pure projection query surface over shared catalog state. Zero harness
 * dependency: callers can drive it with a plain shared state object.
 * Query parameters are read-only filters; they never trigger registration,
 * unregistration, resync or any other side effect.
 */
export function createCatalogQuery(shared) {
  return {
    servers(options = {}) {
      const all = [...shared.servers.values()]
      const filtered = options.includeUnavailable
        ? all
        : all.filter((server) => server.lifecycleState === 'available')
      return deepFreeze(filtered.map((server) => ({ ...server })))
    },

    tools(options = {}) {
      const out = []
      for (const [serverName, genMap] of shared.toolsByServer) {
        const current = shared.current.get(serverName)
        if (current === undefined) continue
        if (options.serverName !== undefined && options.serverName !== serverName) continue
        if (options.generation !== undefined && options.generation !== current) continue
        const server = shared.servers.get(serverName)
        if (server && server.lifecycleState !== 'available' && options.generation === undefined) continue
        out.push(...(genMap.get(current) ?? []))
      }
      return deepFreeze(out.map((tool) => ({ ...tool })))
    },

    resolvePublicName(publicName) {
      for (const genMap of shared.toolsByServer.values()) {
        for (const tools of genMap.values()) {
          for (const tool of tools) {
            if (tool.publicName === publicName) {
              return deepFreeze({
                identity: { serverName: tool.identity.serverName, rawName: tool.identity.rawName },
                publicName: tool.publicName,
              })
            }
          }
        }
      }
      return undefined
    },

    snapshot() {
      return deepFreeze(buildSnapshot(shared))
    },
  }
}

/**
 * Cordis service registering the read-only catalog projection as
 * `ctx.mcpCatalog` on the root context.
 */
export class McpCatalogService extends Service {
  constructor(ctx, shared) {
    super(ctx, CATALOG_SERVICE_NAME)
    this.shared = shared
    Object.assign(this, createCatalogQuery(shared))
  }

  onChange(listener) {
    return this.ctx.on(MCP_CATALOG_CHANGED, listener)
  }
}
