/**
 * Connection supervisor — faithful replication of the official
 * `@deepseek-ai/dsh-mcp-client` connection lifecycle (official-contract parity), extended
 * with a fail-safe catalog publication hook.
 *
 * One outage shares one attempt budget (bounded exponential backoff). A
 * connection that stays up past the stability window closes the outage.
 * Exhaustion unregisters the server's tools and stops; disposal (including
 * HMR) is the only way back. The added `onPublish` hook observes the same
 * state transitions without changing official timing, payload, return,
 * disposer or error identity: publication is fire-and-forget and can never
 * alter connection outcomes.
 */
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import { createTransport, transportKind, transportTarget } from './transports.js'
import { syncTools } from './sync.js'

/**
 * Symbol-keyed internal policy authority contract published by the main facade
 * (`lib/policy-authority.js`). Global symbol so the replacement package reads
 * it across the package boundary.
 */
const POLICY_AUTHORITY = Symbol.for('dsh-plugin-api.policyAuthority')

/**
 * Read the internal egress gate from the root context. The egress face is a
 * denylist, so a missing or malformed contract means no deny policy can be
 * consulted: no gate is installed and the official outbound behavior is kept.
 * A throwing policy evaluation is contained to an allow for the same reason;
 * only an explicit deny blocks.
 */
function readEgressGate(ctx) {
  try {
    const contract = ctx?.root?.[POLICY_AUTHORITY] ?? ctx?.[POLICY_AUTHORITY]
    if (contract && typeof contract.egress?.admit === 'function') {
      return (target, component) => {
        try {
          return contract.egress.admit(target, { component })
        } catch {
          return { ok: true, outcome: 'allow', reason: 'egress policy evaluation failed' }
        }
      }
    }
  } catch {
    // fall through: no gate, the official outbound behavior is kept
  }
  return null
}

function boundedReason(decision) {
  try {
    const reason = decision?.reason
    if (typeof reason === 'string' && reason) return reason.slice(0, 160)
  } catch {
    // bounded best-effort
  }
  return 'egress policy denied this target'
}

/** Defaults shared by the Config schema and {@link resolveReconnectPolicy}. */
export const RECONNECT_DEFAULTS = Object.freeze({
  enabled: true,
  initialDelayMs: 500,
  maxDelayMs: 30000,
  maxAttempts: 10,
})
export const GENERATION_CLOSE_TIMEOUT_MS = 5000

let generationSeq = 0
function nextGenerationId(serverName) {
  generationSeq += 1
  return `${serverName}#${generationSeq}`
}

function defaultCreateClient() {
  return new Client(
    { name: 'dsh-mcp-client', version: '0.0.1' },
    { capabilities: {} },
  )
}

/**
 * The one explicit resolve step from raw reconnect config to the policy the
 * supervisor runs. Programmatic construction may bypass Schemastery
 * normalization, so every default and bound is re-judged here.
 *
 * @param {object|undefined} config - Raw `reconnect` config; omission uses defaults.
 * @param {string} path - Diagnostic prefix naming the config location.
 * @returns {Readonly<{enabled: boolean, initialDelayMs: number, maxDelayMs: number, maxAttempts: number}>}
 */
export function resolveReconnectPolicy(config, path) {
  if (config !== undefined) {
    for (const key of Object.keys(config)) {
      if (!Object.hasOwn(RECONNECT_DEFAULTS, key)) throw new Error(`${path}.${key} is not a reconnect option`)
    }
  }
  const enabled = config?.enabled ?? RECONNECT_DEFAULTS.enabled
  const initialDelayMs = config?.initialDelayMs ?? RECONNECT_DEFAULTS.initialDelayMs
  const maxDelayMs = config?.maxDelayMs ?? RECONNECT_DEFAULTS.maxDelayMs
  const maxAttempts = config?.maxAttempts ?? RECONNECT_DEFAULTS.maxAttempts
  if (!Number.isFinite(initialDelayMs) || initialDelayMs <= 0 || initialDelayMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`${path}.initialDelayMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  if (!Number.isFinite(maxDelayMs) || maxDelayMs <= 0 || maxDelayMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`${path}.maxDelayMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  if (initialDelayMs > maxDelayMs) throw new Error(`${path}.initialDelayMs must be less than or equal to maxDelayMs`)
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error(`${path}.maxAttempts must be a positive integer`)
  return Object.freeze({ enabled, initialDelayMs, maxDelayMs, maxAttempts })
}

/**
 * Start the supervised connection for one MCP server and keep it alive per the
 * reconnect policy.
 *
 * @param {object} ctx - Cordis context providing the `tools` registry and logger.
 * @param {object} config - Resolved plugin config selecting transport and server identity.
 * @param {object} policy - Resolved reconnect policy.
 * @param {{ onPublish?: (payload: object) => void, createClient?: () => object }} [hooks]
 *   `onPublish` receives a fail-safe catalog publication describing the server
 *   state, generation and current tool set; `createClient` is an injectable
 *   seam for tests.
 * @returns {PromiseLike<{ ready: Promise<object>, dispose: () => Promise<void> }>}
 */
export function startConnection(ctx, config, policy, hooks = {}) {
  const { onPublish, createClient = defaultCreateClient, createTransport: makeTransport = createTransport, gate = readEgressGate(ctx) } = hooks
  const label = `mcp-client(${config.serverName})`
  const transport = transportKind(config)
  const opts = {
    registrationFailure: 'contain',
    serverName: config.serverName,
    toolCallTimeoutMs: config.toolCallTimeoutMs,
  }
  const startupOpts = config.failOnStartupError
    ? { ...opts, registrationFailure: 'throw' }
    : opts

  /** Fail-safe publication: diagnostics can never change connection outcomes. */
  function publish(payload) {
    try {
      onPublish?.(payload)
    } catch {
      // publication is fire-and-forget
    }
  }

  const genIdByClient = new WeakMap()

  let disposed = false
  let client
  let clientClosed
  let disposers = new Map()
  let reconnectTimer
  let failedAttempts = 0
  let connectedAt
  let firstAttemptError

  const isCurrent = (generation) => !disposed && client === generation

  /** Serializes every syncTools call so two syncs never interleave their swap. */
  let syncChain = Promise.resolve()
  function enqueueSync(generation, syncOpts = opts, source = 'config') {
    const run = syncChain.then(async () => {
      if (!isCurrent(generation)) return
      const previous = disposers
      const generationOpts = {
        ...syncOpts,
        isCurrent: () => isCurrent(generation),
      }
      disposers = await syncTools(generation, ctx, generationOpts, previous, (metas) => {
        // A sync that finished after a newer generation took over must not
        // publish the stale generation's tool set as current.
        if (!isCurrent(generation)) return
        publishAvailable(genIdByClient.get(generation), source, metas)
      })
    })
    syncChain = run.catch(() => {})
    return run
  }

  function publishAvailable(genId, source, metas) {
    const observedAt = new Date().toISOString()
    publish({
      serverName: config.serverName,
      transport,
      lifecycleState: 'available',
      generation: genId,
      observedAt,
      reason: undefined,
      provenance: { source, certainty: 'observed' },
      tools: metas.map((meta) => ({
        ...meta,
        lifecycleState: 'available',
        provenance: { source, observedAt },
      })),
    })
  }

  function publishUnavailable(genId, reasonCode, source) {
    publish({
      serverName: config.serverName,
      transport,
      lifecycleState: 'unavailable',
      generation: genId,
      observedAt: new Date().toISOString(),
      reason: { code: reasonCode },
      provenance: { source, certainty: 'observed' },
      tools: [],
    })
  }

  function publishDisposed(genId) {
    publish({
      serverName: config.serverName,
      transport,
      lifecycleState: 'disposed',
      generation: genId,
      observedAt: new Date().toISOString(),
      reason: { code: 'disposed' },
      provenance: { source: 'config', certainty: 'observed' },
      tools: [],
    })
  }

  /** One disconnect decision per generation: isCurrent makes racing close/error signals idempotent. */
  function generationDown(generation) {
    if (!isCurrent(generation)) return
    client = undefined
    clientClosed = undefined
    publishUnavailable(genIdByClient.get(generation), 'connection-lost', 'reconnect')
    scheduleReconnect()
  }

  /** Wait for the transport-owned close signal without letting a broken transport wedge teardown forever. */
  function waitForClose(closed) {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve(false)
      }, GENERATION_CLOSE_TIMEOUT_MS)
      timeout.unref()
      closed.then(() => {
        clearTimeout(timeout)
        resolve(true)
      })
    })
  }

  function scheduleReconnect() {
    const lostEstablishedConnection = connectedAt !== undefined
    if (!policy.enabled) {
      const message = lostEstablishedConnection
        ? 'connection lost and reconnect is disabled — registered tools will fail until an HMR reload or Host restart'
        : 'connection failed and reconnect is disabled — no tools were registered; reload the plugin or restart the Host to connect'
      ctx.logger.error(`${label}: ${message}`)
      publishUnavailable(currentGenId(), 'reconnect-disabled', 'reconnect')
      return
    }
    if (connectedAt !== undefined && Date.now() - connectedAt >= policy.maxDelayMs) failedAttempts = 0
    connectedAt = undefined
    failedAttempts += 1
    if (failedAttempts > policy.maxAttempts) {
      syncChain = syncChain.then(() => {
        for (const dispose of disposers.values()) dispose()
        disposers = new Map()
      })
      ctx.logger.error(
        `${label}: giving up after ${policy.maxAttempts} consecutive failed reconnect attempts — tools unregistered; reload the plugin or restart the Host to reconnect`,
      )
      publishUnavailable(currentGenId(), 'reconnect-exhausted', 'reconnect')
      return
    }
    const delayMs = Math.min(policy.maxDelayMs, policy.initialDelayMs * 2 ** (failedAttempts - 1))
    const action = lostEstablishedConnection ? 'connection lost; reconnecting' : 'connection failed; retrying'
    ctx.logger.warn(`${label}: ${action} in ${delayMs}ms (attempt ${failedAttempts}/${policy.maxAttempts})`)
    publishUnavailable(currentGenId(), 'reconnecting', 'reconnect')
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined
      settling = connectGeneration(false)
    }, delayMs)
    reconnectTimer.unref()
  }

  function currentGenId() {
    if (client !== undefined) return genIdByClient.get(client)
    return `${config.serverName}#current`
  }

  /**
   * One connection attempt: fresh transport + client, connect, then queue the
   * initial tool sync. Every failure funnels through {@link generationDown};
   * success arms the onclose-driven disconnect path. Never rejects.
   */
  async function connectGeneration(startup) {
    const generation = createClient()
    const genId = nextGenerationId(config.serverName)
    genIdByClient.set(generation, genId)
    const closed = Promise.withResolvers()
    let attemptSettled = false
    let closeObserved = false
    const hasClosed = () => closeObserved
    client = generation
    clientClosed = closed.promise
    generation.onclose = () => {
      closeObserved = true
      closed.resolve()
      if (attemptSettled) generationDown(generation)
    }
    generation.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
      if (!isCurrent(generation)) return
      ctx.logger.info(`${label}: tool list changed, re-syncing`)
      try {
        await enqueueSync(generation, opts, 'list_changed')
      } catch (error) {
        if (!disposed) ctx.logger.error(`${label}: tool re-sync failed: ${String(error)}`)
      }
    })
    publish({
      serverName: config.serverName,
      transport,
      lifecycleState: 'pending',
      generation: genId,
      observedAt: new Date().toISOString(),
      reason: undefined,
      provenance: { source: startup ? 'config' : 'reconnect', certainty: 'inferred' },
      tools: [],
    })
    // Egress gate: the denylist is evaluated before any transport creation or
    // connection establishment. Only an explicit deny blocks the outbound side
    // effect; reconnect re-evaluates each attempt.
    if (gate) {
      const target = transportTarget(config)
      let decision
      try {
        decision = gate(target, 'mcp')
      } catch {
        // a throwing gate cannot deny: the official outbound behavior is kept
        decision = { ok: true, outcome: 'allow', reason: 'egress policy evaluation failed' }
      }
      if (decision?.outcome === 'deny') {
        if (isCurrent(generation)) {
          ctx.logger.warn(`${label}: egress policy denied ${transportKind(config)} target: ${boundedReason(decision)}`)
        }
        publishUnavailable(genId, 'egress-denied', 'config')
        try {
          await generation.close()
        } catch {
          // best-effort close of the unconnected generation
        }
        attemptSettled = true
        if (!isCurrent(generation)) return
        client = undefined
        clientClosed = undefined
        if (!disposed) scheduleReconnect()
        return
      }
    }
    let runtimeTransport
    try {
      runtimeTransport = makeTransport(config, { gate })
    } catch (error) {
      if (isCurrent(generation)) ctx.logger.warn(`${label}: transport creation failed: ${String(error)}`)
      try {
        await generation.close()
      } catch {
        // best-effort close
      }
      attemptSettled = true
      if (!isCurrent(generation)) return
      generationDown(generation)
      return
    }
    try {
      await generation.connect(runtimeTransport)
      if (hasClosed()) {
        attemptSettled = true
        generationDown(generation)
        return
      }
      await enqueueSync(generation, startup ? startupOpts : opts, startup ? 'config' : 'reconnect')
    } catch (error) {
      if (firstAttemptError === undefined) firstAttemptError = error
      if (isCurrent(generation)) ctx.logger.warn(`${label}: connection attempt failed: ${String(error)}`)
      try {
        await generation.close()
      } catch {
        // best-effort close
      }
      const quiesced = hasClosed() || (await waitForClose(closed.promise))
      attemptSettled = true
      if (!isCurrent(generation)) return
      if (!quiesced) {
        client = undefined
        clientClosed = undefined
        ctx.logger.error(
          `${label}: failed generation did not close within ${GENERATION_CLOSE_TIMEOUT_MS}ms — reconnect stopped to avoid overlapping server processes; reload the plugin or restart the Host to retry`,
        )
        publishUnavailable(genId, 'close-timeout', 'reconnect')
        return
      }
      generationDown(generation)
      return
    }
    attemptSettled = true
    if (hasClosed()) {
      generationDown(generation)
      return
    }
    if (!isCurrent(generation)) return
    connectedAt = Date.now()
    if (failedAttempts > 0) {
      ctx.logger.info(`${label}: reconnected and re-synced tools (attempt ${failedAttempts}/${policy.maxAttempts})`)
    }
  }

  /** The in-flight (or last settled) connection attempt; dispose awaits it for quiescence. */
  let settling = connectGeneration(true)
  return {
    ready: settling.then(() => {
      if (client !== undefined) return {}
      return { error: firstAttemptError ?? new Error(`${label}: initial connection failed`) }
    }),
    async dispose() {
      disposed = true
      if (reconnectTimer !== undefined) {
        clearTimeout(reconnectTimer)
        reconnectTimer = undefined
      }
      const current = client
      const currentClosed = clientClosed
      client = undefined
      clientClosed = undefined
      if (current !== undefined) {
        try {
          await current.close()
        } catch {
          // best-effort close
        }
        if (currentClosed !== undefined && !(await waitForClose(currentClosed))) {
          ctx.logger.error(
            `${label}: generation did not close within ${GENERATION_CLOSE_TIMEOUT_MS}ms during disposal — server shutdown may be incomplete`,
          )
        }
      }
      await settling
      await syncChain
      for (const dispose of disposers.values()) dispose()
      disposers = new Map()
      publishDisposed(current !== undefined ? genIdByClient.get(current) : `${config.serverName}#disposed`)
    },
  }
}
