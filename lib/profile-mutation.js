/**
 * Profile mutation mounter — the write face of the `pluginApi.profiles`
 * namespace. All write logic lives in the out-of-process companion executor;
 * this module is its safe remote client.
 *
 * Protocol (approved design):
 * - resolution: env override (`DSH_PLUGIN_API_PROFILE_EXECUTOR`), then
 *   `require.resolve` of the executor package manifest → its bin entry; when
 *   absent, every write verb returns typed `unavailable` while the read face
 *   stays fully functional (typed degradation);
 * - handshake: spawn the executor `handshake` subcommand and validate both
 *   directions (① `builtForRuntime` equals the installed official runtime
 *   full identity; ② `apiProtocol` equals the facade `dsh.api` major.minor);
 * - JSON-lines protocol on stdout; handle-bearing operations (quick-write,
 *   snapshot-validate) emit progress events (prepare/validate/commit stages)
 *   then one terminal result;
 * - ownership binding: every write verb mints the owner identity from the
 *   caller's fiber (never from a bare caller-supplied string), so a snapshot
 *   cannot be claimed under a spoofed owner; unresolvable identity falls
 *   back to the root/unknown owner token;
 * - cancellation: cancel() aborts before the commit stage settles `aborted`
 *   at the unified commit point; after the commit stage began, the cancel
 *   request receives typed `too-late` and the operation runs to its terminal
 *   outcome (the executor ignores signals inside the commit window);
 * - bounded execution: a stalled executor settles `error` with a timeout
 *   reason classification instead of hanging the handle;
 * - host shutdown: kill-and-cleanup of in-flight child processes (the
 *   AbortController abort sends SIGTERM; the executor checkpoints at commit).
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { deepFreeze } from './deep-freeze.js'
import { parseFacadeVersion } from './version.js'

export const MUTATION_CODES = Object.freeze({
  'invalid-input': 'invalid-input',
  unavailable: 'unavailable',
  'quota-exceeded': 'quota-exceeded',
  'ownership-conflict': 'ownership-conflict',
  'gate-conflict': 'gate-conflict',
  'cas-conflict': 'cas-conflict',
  'too-late': 'too-late',
  'layer-unavailable': 'layer-unavailable',
  'client-blocking': 'client-blocking',
  internal: 'internal',
})

export const TERMINAL_OUTCOMES = Object.freeze([
  'success',
  'error',
  'aborted',
  'denied',
  'superseded',
])

export const DEFAULT_EXECUTOR_TIMEOUT_MS = 180000

/** Owner token used when the caller identity cannot be resolved. */
export const ROOT_OWNER_TOKEN = 'root'

const require = createRequire(import.meta.url)

/**
 * Resolve the executor CLI path.
 *
 * @returns {{ ok: true, path } | { ok: false, reason }} typed resolution.
 */
export function resolveExecutorPath(env = {}) {
  const explicit = env.DSH_PLUGIN_API_PROFILE_EXECUTOR
  if (typeof explicit === 'string' && explicit.trim().length > 0) {
    return { ok: true, path: explicit.trim() }
  }
  try {
    const manifestPath = require.resolve('@deepseek-ai/dsh-plugin-api-profile-manager/package.json')
    const manifest = JSON.parse(require('node:fs').readFileSync(manifestPath, 'utf8'))
    const bin = manifest?.bin
    const binPath = typeof bin === 'string' ? bin : (bin && typeof bin === 'object' ? Object.values(bin)[0] : undefined)
    if (typeof binPath !== 'string' || binPath.length === 0) {
      return { ok: false, reason: 'executor-bin-missing' }
    }
    return { ok: true, path: require.resolve(binPath, { paths: [require('node:path').dirname(manifestPath)] }) }
  } catch {
    return { ok: false, reason: 'executor-not-installed' }
  }
}

/**
 * Resolve the calling plugin's package identity for ownership binding.
 * The identity comes from the caller fiber's loader entry (row name =
 * package identity), never from caller-supplied strings; when unresolvable
 * it falls back to the root/unknown owner token.
 *
 * @param {object | undefined} callerCtx - the caller's context (from the
 *   service getter's `this`).
 * @returns {string} bound owner identity.
 */
export function callerIdentityOf(callerCtx) {
  try {
    if (callerCtx && typeof callerCtx === 'object') {
      const fiber = callerCtx.fiber ?? callerCtx.ctx?.fiber
      const loader = callerCtx.loader ?? callerCtx.ctx?.loader
      if (typeof loader?.entries === 'function') {
        for (const entry of loader.entries()) {
          if (entry?.fiber === fiber) {
            const name = entry?.options?.name
            if (typeof name === 'string' && name.length > 0) return name
            const id = entry?.options?.id ?? entry?.id
            if (typeof id === 'string' && id.length > 0) return id
          }
        }
      }
      if (fiber && typeof fiber.name === 'string' && fiber.name.length > 0) return fiber.name
    }
    return ROOT_OWNER_TOKEN
  } catch {
    return ROOT_OWNER_TOKEN
  }
}

function createReceiver({ onProgress, onResult, logger }) {
  let buffer = ''
  return {
    feed(chunk) {
      buffer += String(chunk)
      let index
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        if (!line.trim()) continue
        let event
        try {
          event = JSON.parse(line)
        } catch {
          try {
            logger?.warn?.(`dsh-plugin-api profile executor emitted a non-JSON line: ${line.slice(0, 120)}`)
          } catch {
            // logging must never throw
          }
          continue
        }
        if (event?.type === 'progress') onProgress?.(event)
        else if (event?.type === 'result') onResult?.(event)
      }
    },
  }
}

/**
 * Spawn one executor command and drive the JSON-lines protocol.
 *
 * @param {object} options - { path, command, intent, signal, onProgress,
 *   logger, nodeBin, env, timeoutMs }.
 * @returns {Promise<object>} terminal `{ outcome, code, reason,
 *   restartRequired, result }` or typed error on spawn/protocol/timeout.
 */
export function runExecutorCommand(options) {
  const { path, command, intent, signal, onProgress, logger, nodeBin = process.execPath, env, timeoutMs = DEFAULT_EXECUTOR_TIMEOUT_MS } = options
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(nodeBin, [path, command, JSON.stringify(intent ?? {})], {
        stdio: ['ignore', 'pipe', 'pipe'],
        signal,
        env: { ...process.env, ...(env ?? {}) },
      })
    } catch (error) {
      resolve({ outcome: 'error', code: 'internal', reason: `spawn-failed:${error?.message ?? String(error)}` })
      return
    }
    const receiver = createReceiver({ onProgress, onResult: resolve, logger })
    let stderr = ''
    child.stdout?.on('data', (chunk) => receiver.feed(chunk))
    child.stderr?.on('data', (chunk) => { stderr += String(chunk) })
    let settled = false
    const settle = (terminal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(terminal)
    }
    // Bounded execution: a stalled executor settles error with a timeout
    // reason classification instead of hanging the handle forever.
    const timer = setTimeout(() => {
      if (settled) return
      settle({
        outcome: 'error',
        code: 'internal',
        reason: `executor-timeout:${timeoutMs}`,
      })
      try {
        child.kill('SIGKILL')
      } catch {
        // best effort
      }
    }, timeoutMs)
    child.on('error', (error) => {
      settle(signal?.aborted
        ? { outcome: 'aborted', reason: 'cancelled' }
        : { outcome: 'error', code: 'internal', reason: `executor-error:${error?.message ?? String(error)}` })
    })
    child.on('close', (code) => {
      if (!settled) {
        settle(signal?.aborted
          ? { outcome: 'aborted', reason: 'cancelled' }
          : {
              outcome: 'error',
              code: 'internal',
              reason: `executor-exited-${code ?? 'unknown'}${stderr ? `:${stderr.trim().slice(0, 200)}` : ''}`,
            })
      }
    })
  })
}

/**
 * Run the handshake and validate both directions.
 *
 * @returns {Promise<{ ok: true, builtForRuntime, apiProtocol } | { ok: false, code, reason }>}
 */
export async function runHandshakeCheck({ path, installedRuntime, facadeApi, env }, options = {}) {
  const terminal = await runExecutorCommand({
    path,
    command: 'handshake',
    intent: {},
    logger: options.logger,
    nodeBin: options.nodeBin,
    env,
    timeoutMs: options.timeoutMs,
  })
  if (terminal.outcome !== 'success') {
    return { ok: false, code: MUTATION_CODES.unavailable, reason: `handshake-${terminal.code ?? terminal.outcome}` }
  }
  const payload = terminal.result ?? terminal
  const builtForRuntime = payload?.builtForRuntime ?? payload?.result?.builtForRuntime
  const apiProtocol = payload?.apiProtocol ?? payload?.result?.apiProtocol
  if (typeof builtForRuntime !== 'string' || typeof apiProtocol !== 'string') {
    return { ok: false, code: MUTATION_CODES.unavailable, reason: 'handshake-invalid-shape' }
  }
  if (builtForRuntime !== installedRuntime) {
    return { ok: false, code: MUTATION_CODES.unavailable, reason: 'runtime-mismatch' }
  }
  if (apiProtocol !== facadeApi) {
    return { ok: false, code: MUTATION_CODES.unavailable, reason: 'api-mismatch' }
  }
  return { ok: true, builtForRuntime, apiProtocol }
}

/**
 * Operation handle for handle-bearing verbs (quick-write, snapshot-validate):
 * stable operation id, progress subscription, cancel, and the settled
 * terminal result. Frozen once settled; five-word terminal outcome
 * vocabulary; timeout recorded as error with a timeout reason classification.
 */
/** Tracks every live operation controller so the mounter dispose can
 * kill-and-cleanup in-flight executor children (host lifecycle rule). */
const activeControllers = new Set()

function createOperationHandle({ operationId, kind, run }) {
  const state = {
    operationId,
    kind,
    settled: null,
    listeners: new Set(),
    controller: null,
    enteredCommit: false,
  }
  const promise = (async () => {
    state.controller = new AbortController()
    activeControllers.add(state.controller)
    try {
      const terminal = await run({
      operationId,
      signal: state.controller.signal,
      onProgress(event) {
        if (event?.stage === 'commit') state.enteredCommit = true
        for (const listener of state.listeners) {
          try {
            listener(event)
          } catch {
            // a throwing progress listener never disturbs the operation
          }
        }
      },
      })
      return finalize(terminal)
    } finally {
      activeControllers.delete(state.controller)
    }
  })()
  const finalize = (terminal) => {
    const outcome = TERMINAL_OUTCOMES.includes(terminal?.outcome) ? terminal.outcome : 'error'
    const record = Object.freeze({
      operationId: state.operationId,
      kind: state.kind,
      outcome,
      code: typeof terminal?.code === 'string' ? terminal.code : undefined,
      reason: typeof terminal?.reason === 'string' ? terminal.reason : undefined,
      restartRequired: Boolean(terminal?.restartRequired),
      result: deepFreeze(terminal?.result ?? undefined),
    })
    state.settled = record
    return record
  }
  return Object.freeze({
    operationId: state.operationId,
    kind: state.kind,
    onProgress(listener) {
      if (typeof listener !== 'function') return () => {}
      state.listeners.add(listener)
      return () => state.listeners.delete(listener)
    },
    async cancel() {
      if (state.settled) return state.settled
      if (state.enteredCommit) {
        return finalize({ outcome: 'denied', code: MUTATION_CODES['too-late'], reason: 'commit-already-began' })
      }
      try {
        state.controller?.abort()
      } catch {
        // abort is best effort; the executor checkpoints at its commit point
      }
      return state.settled ?? (await promise)
    },
    settled() {
      return state.settled
    },
    result: promise,
  })
}

/**
 * Create the mutation surface consumed by the service's profile getter.
 * Every write verb:
 * - mints the owner from the caller context (never trusts a caller-supplied
 *   owner string) — the binding handle is cast per access;
 * - mints its own operation id (facade-generated execution identity);
 * - resolves the executor lazily and degrades typed when absent or
 *   handshake-mismatched;
 * - never throws through plugin callbacks.
 *
 * @param {object} options - { logger, installedRuntime, facadeApi, env,
 *   nodeBin, resolveCallerIdentity, invokeFactory }.
 * @returns {{ api: object, dispose: () => void }} frozen `apply(intent)`,
 *   `snapshot.{create,modify,validate,delete,apply}`.
 */
export function createProfileMutation(options) {
  const { logger, installedRuntime, facadeApi, env = {}, nodeBin, resolveCallerIdentity = callerIdentityOf, timeoutMs } = options

  let executorPath = null
  let handshakeCache = null
  let resolved = false

  const resolveExecutor = () => {
    if (!resolved) {
      const result = resolveExecutorPath(env)
      executorPath = result.ok ? result.path : undefined
      resolved = true
    }
    return executorPath
  }

  const ensureHandshake = async () => {
    if (handshakeCache?.ok) return handshakeCache
    const path = resolveExecutor()
    if (!path) {
      return { ok: false, code: MUTATION_CODES.unavailable, reason: 'executor-absent' }
    }
    const check = await runHandshakeCheck({ path, installedRuntime, facadeApi, env }, { logger, nodeBin })
    if (check.ok) handshakeCache = check
    return check
  }

  // Boot-init orphan scan (orphan rule): fire once per process on the first
  // successful handshake, best-effort and never blocking write verbs. The
  // runtime view owner set comes from the facade's boot-time snapshot so the
  // executor can classify snapshots whose owner is absent everywhere.
  let bootGcFired = false
  const triggerBootGc = async (runtimeView = []) => {
    if (bootGcFired) return
    bootGcFired = true
    const path = resolveExecutor()
    if (!path) return
    try {
      await runExecutorCommand({
        path,
        command: 'gc',
        intent: { runtimeView, owner: 'host' },
        logger,
        nodeBin,
        env,
      })
    } catch {
      // best effort: a broken gc never disturbs the facade
    }
  }

  const preflight = async (intent) => {
    if (!intent || typeof intent !== 'object') {
      return { ok: false, code: MUTATION_CODES['invalid-input'], reason: 'invalid-intent' }
    }
    return ensureHandshake()
  }

  const terminalResult = (outcome, code, reason) => ({
    outcome,
    code,
    reason,
    restartRequired: false,
    auditability: true,
  })

  const invoke = (command, intent, options = {}) => {
    const path = resolveExecutor()
    if (!path) {
      return Promise.resolve(terminalResult('error', MUTATION_CODES.unavailable, 'executor-absent'))
    }
    return runExecutorCommand({ path, command, intent, logger, nodeBin, env, timeoutMs, ...options })
  }

  /**
   * Build the per-caller frozen surface. The caller context captured by the
   * service getter is bound into every verb: ownership is minted from the
   * caller's fiber/loader entry, never from a bare caller-supplied string.
   */
  const apiFor = (callerCtx) => {
    const bindOwner = (intent) => {
      const owner = resolveCallerIdentity(callerCtx)
      return { ...intent, owner }
    }

    const requireIntent = (rawIntent) => {
      if (!rawIntent || typeof rawIntent !== 'object' || Array.isArray(rawIntent)) {
        return Promise.resolve(terminalResult('error', MUTATION_CODES['invalid-input'], 'invalid-intent'))
      }
      return null
    }

    const handleVerb = (kind, command, buildIntent) => (rawIntent) => {
      const invalid = requireIntent(rawIntent)
      if (invalid) return invalid
      const operationId = randomUUID() // facade-minted execution identity
      return createOperationHandle({
        operationId,
        kind,
        run: async ({ operationId: id, signal, onProgress }) => {
          const bound = bindOwner(rawIntent)
          const pre = await preflight(buildIntent(bound, id))
          if (!pre.ok) {
            return terminalResult('error', pre.code, pre.reason)
          }
          return invoke(command, buildIntent(bound, id), { signal, onProgress, logger })
        },
      })
    }

    const directVerb = (command) => (rawIntent) => {
      const invalid = requireIntent(rawIntent)
      if (invalid) return invalid
      return preflight(bindOwner(rawIntent)).then((pre) => {
        if (!pre.ok) {
          return terminalResult('error', pre.code, pre.reason)
        }
        return invoke(command, bindOwner(rawIntent))
      })
    }

    return Object.freeze({
      apply: handleVerb('quick-write', 'quick-write', (intent, operationId) => ({
        ...intent,
        operationId,
      })),
      snapshot: Object.freeze({
        create: directVerb('snapshot-create'),
        modify: directVerb('snapshot-modify'),
        validate: handleVerb('snapshot-validate', 'snapshot-validate', (intent, operationId) => ({
          ...intent,
          operationId,
        })),
        delete: directVerb('snapshot-delete'),
        apply: directVerb('snapshot-apply'),
      }),
    })
  }

  return {
    api: apiFor(undefined),
    apiFor,
    triggerBootGc,
    dispose() {
      // kill-and-cleanup: terminate every in-flight executor child.
      for (const controller of activeControllers) {
        try {
          controller.abort()
        } catch {
          // best effort
        }
      }
      activeControllers.clear()
      try {
        logger?.warn?.('dsh-plugin-api profile mutation mounter disposed')
      } catch {
        // disposal must never throw
      }
    },
  }
}

/**
 * Resolve the installed runtime full identity (direction ① anchor).
 */
export function installedRuntimeVersion(resolveModule = require) {
  try {
    const pkg = resolveModule('@deepseek-ai/dsh-llm/package.json')
    return typeof pkg?.version === 'string' ? pkg.version : undefined
  } catch {
    return undefined
  }
}

/**
 * Resolve the facade api protocol from the facade's own version string
 * (direction ② anchor).
 */
export function facadeApiProtocol(facadeVersion = readFacadeVersion()) {
  const parsed = parseFacadeVersion(facadeVersion)
  return parsed?.api
}

function readFacadeVersion() {
  try {
    const manifest = require('../package.json')
    return manifest?.version
  } catch {
    return undefined
  }
}