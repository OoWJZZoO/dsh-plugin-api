/**
 * Executor command surface: argument parsing, JSON-lines result envelope,
 * terminal-outcome exit-code mapping, and the per-command dispatch table.
 *
 * Protocol (approved design, executor protocol section):
 * - args: `./profile-manager.js <command> [<json-intent>]` — one JSON intent
 *   string on argv per invocation (stable across commands);
 * - stdout: JSON-lines; handle-bearing operations emit zero or more
 *   `{type:'progress', operationId, stage, reason?}` events followed by one
 *   terminal `{type:'result', outcome, ...}`; instant operations emit one
 *   terminal `{type:'result', ...}` event;
 * - exit code mirrors the terminal class: 0 success, 1 error, 2 aborted,
 *   3 denied, 4 superseded.
 */
import { readFileSync, readdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { runHandshake } from './handshake.js'
import { resizeStorage, loadConfig, appendAuditRecord, snapshotDir } from './storage.js'
import { createSnapshot, modifySnapshot, deleteSnapshot, markValidated, readSnapshotRecord } from './snapshot.js'
import { classifyOrphans, deleteOrphans } from './gc.js'
import { runValidation, resolveDshBin, BASIC_LEVEL, BOOT_LEVEL } from './validate.js'
import { recoverSwap } from './commit.js'
import { quickWrite, snapshotApply } from './pipelines.js'
import { installSignalGuard, captureSignalGuard } from './signal-guard.js'

export const TERMINAL_OUTCOME = Object.freeze({
  success: 'success',
  error: 'error',
  aborted: 'aborted',
  denied: 'denied',
  superseded: 'superseded',
})

/** Exit code per terminal outcome (protocol contract). */
export const OUTCOME_EXIT_CODES = Object.freeze({
  success: 0,
  error: 1,
  aborted: 2,
  denied: 3,
  superseded: 4,
})

export const COMMANDS = Object.freeze([
  'handshake',
  'quick-write',
  'snapshot-create',
  'snapshot-modify',
  'snapshot-validate',
  'snapshot-delete',
  'snapshot-apply',
  'gc',
])

/**
 * Pure argv parsing: `[command, jsonIntent?]`.
 * Returns `{ ok: true, command, intent } | { ok: false, reason }`.
 */
export function parseCli(argv) {
  const command = Array.isArray(argv) ? argv[0] : undefined
  if (typeof command !== 'string' || command.length === 0) {
    return { ok: false, reason: 'missing-command' }
  }
  if (!COMMANDS.includes(command)) {
    return { ok: false, reason: `unknown-command:${command}` }
  }
  const raw = Array.isArray(argv) ? argv[1] : undefined
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, command, intent: undefined }
  }
  if (typeof raw !== 'string') {
    return { ok: false, reason: 'invalid-intent' }
  }
  try {
    const intent = JSON.parse(raw)
    return { ok: true, command, intent }
  } catch {
    return { ok: false, reason: 'invalid-intent-json' }
  }
}

/**
 * Writer over an io object ({ stdout, stderr } with write methods). Never
 * throws: a broken pipe degrades to a no-op so the executor can still
 * settle its terminal exit code.
 */
function createEventWriter(io) {
  const write = (line) => {
    try {
      io?.stdout?.write(`${JSON.stringify(line)}\n`)
    } catch {
      // stdout failure must never crash the executor
    }
  }
  return {
    progress(operationId, stage, reason) {
      const event = { type: 'progress', operationId, stage }
      if (typeof reason === 'string') event.reason = reason
      write(event)
    },
    result(record) {
      write({ type: 'result', ...record })
    },
  }
}

/**
 * Content-generation token of a snapshot: the owner-local opaque hash of its
 * config files (the apply gate binds validation to exactly this generation).
 */
function contentGeneration(dir) {
  try {
    const hash = createHash('sha256')
    for (const name of ['package.json', 'cordis.patch.yml', 'cordis.yml']) {
      try {
        const content = readFileSync(join(dir, name), 'utf8')
        hash.update(name)
        hash.update(content)
      } catch {
        // missing optional config files contribute nothing
      }
    }
    return hash.digest('hex').slice(0, 16)
  } catch {
    return undefined
  }
}

/** Terminal-result builder with the stable envelope fields. */
export function terminalResult({ outcome, operationId, code, reason, restartRequired, auditability, payload, result, ...rest }) {
  const record = { outcome }
  if (operationId !== undefined) record.operationId = operationId
  if (code !== undefined) record.code = code
  if (reason !== undefined) record.reason = reason
  if (typeof restartRequired === 'boolean') record.restartRequired = restartRequired
  if (typeof auditability === 'boolean') record.auditability = auditability
  const body = payload ?? result
  if (body !== undefined && body !== null) record.result = body
  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined) record[key] = value
  }
  return record
}

function readOwnManifest(require) {
  try {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))
    return pkg
  } catch {
    return undefined
  }
}

/**
 * Run one CLI invocation.
 *
 * @param {string[]} argv
 * @param {{ env: object, stdout: object, stderr: object }} io
 * @returns {Promise<number>} process exit code.
 */
export async function runCli(argv, io = {}) {
  installSignalGuard()
  const env = io.env ?? {}
  const parsed = parseCli(argv)
  if (!parsed.ok) {
    const writer = createEventWriter(io)
    writer.result(terminalResult({
      outcome: TERMINAL_OUTCOME.error,
      code: 'invalid-input',
      reason: parsed.reason,
      auditability: false,
    }))
    return OUTCOME_EXIT_CODES.error
  }
  const { command } = parsed
  const writer = createEventWriter(io)
  const storage = resizeStorage({ env })
  // heal any interrupted config swap before touching the real profile
  if (storage && typeof parsed?.intent?.profile === 'string' && parsed.intent.profile.length > 0) {
    try {
      recoverSwap(join(storage, '..', '..', 'profiles', parsed.intent.profile))
    } catch {
      // recovery is best effort; the next operation re-checks
    }
  }
  const intentOwner = typeof parsed?.intent?.owner === 'string' ? parsed.intent.owner : undefined
  const intentTarget = typeof parsed?.intent?.snapshotId === 'string'
    ? parsed.intent.snapshotId
    : (typeof parsed?.intent?.profile === 'string' ? parsed.intent.profile : undefined)

  let terminal
  try {
    if (command === 'handshake') {
      const handshake = runHandshake(readOwnManifest(), storage)
      const payload = handshake.outcome === 'success'
        ? { builtForRuntime: handshake.builtForRuntime, apiProtocol: handshake.apiProtocol, version: handshake.version }
        : undefined
      terminal = terminalResult({ outcome: handshake.outcome, code: handshake.code, reason: handshake.reason, payload })
    } else if (command === 'snapshot-create') {
      const config = loadConfig(storage)
      const result = await createSnapshot({ root: storage, intent: parsed.intent, config })
      terminal = terminalResult(result)
    } else if (command === 'snapshot-modify') {
      const result = await modifySnapshot({ root: storage, intent: parsed.intent })
      terminal = terminalResult(result)
    } else if (command === 'snapshot-delete') {
      const result = await deleteSnapshot({ root: storage, intent: parsed.intent })
      terminal = terminalResult(result)
    } else if (command === 'snapshot-validate') {
      const snapshotId = parsed?.intent?.snapshotId
      const owner = parsed?.intent?.owner
      const dir = snapshotDir(storage, owner, snapshotId)
      const record = dir ? readSnapshotRecord(dir) : undefined
      if (!record) {
        terminal = terminalResult({ outcome: TERMINAL_OUTCOME.error, code: 'invalid-input', reason: 'snapshot-not-found', auditability: true, owner, target: snapshotId })
      } else {
        const level = parsed?.intent?.level ?? `${BASIC_LEVEL}+${BOOT_LEVEL}`
        const operationId = typeof parsed?.intent?.operationId === 'string' ? parsed.intent.operationId : undefined
        if (operationId) writer.progress(operationId, 'validate')
        const result = await runValidation({
          snapshotDir: dir,
          level,
          dshBin: resolveDshBin(env),
          env,
          managerRoot: storage,
          profileName: typeof record.sourceProfile === 'string' ? record.sourceProfile : undefined,
        })
        if (result.code === 'ok') {
          // the validated-generation rule: validation pass persists validated state bound to the
          // current content generation.
          const generation = contentGeneration(dir)
          const marked = await markValidated({ root: storage, intent: { owner, snapshotId }, generation })
          terminal = terminalResult({
            outcome: marked.outcome,
            code: marked.code,
            reason: marked.reason,
            owner,
            target: snapshotId,
            payload: {
              code: 'ok',
              verdict: result.verdict,
              lifecycleState: marked.result?.lifecycleState,
              validatedGeneration: marked.result?.validatedGeneration,
            },
            generation,
          })
        } else {
          terminal = terminalResult({
            outcome: TERMINAL_OUTCOME.error,
            code: 'client-blocking',
            reason: result.blocking.map((entry) => entry.detail ?? entry.code).join('; ') || 'validation-failed',
            owner,
            target: snapshotId,
            auditability: true,
            payload: { verdict: result.verdict, blocking: result.blocking },
          })
        }
      }
    } else if (command === 'quick-write') {
      const operationId = typeof parsed?.intent?.operationId === 'string' ? parsed.intent.operationId : undefined
      if (operationId) writer.progress(operationId, 'prepare')
      // commit window: SIGTERM is captured (ignored) so the atomic swap and
      // backup rotation always finish; the facade reports too-late after the
      // commit stage started.
      const release = captureSignalGuard(() => {})
      try {
        const result = await quickWrite({ root: storage, intent: parsed.intent, env })
        if (operationId) {
          writer.progress(operationId, result.outcome === 'success' ? 'commit' : 'failed')
        }
        terminal = terminalResult(result)
      } finally {
        release()
      }
    } else if (command === 'snapshot-apply') {
      const release = captureSignalGuard(() => {})
      try {
        const result = await snapshotApply({ root: storage, intent: parsed.intent, env })
        terminal = terminalResult(result)
      } finally {
        release()
      }
    } else if (command === 'gc') {
      const snapshotsRoot = storage ? join(storage, 'snapshots') : undefined
      const runtimeView = new Set(Array.isArray(parsed?.intent?.runtimeView) ? parsed.intent.runtimeView : [])
      const profilesHome = storage ? join(storage, '..', '..', 'profiles') : undefined
      // The GC target is the profile the snapshot manages (recorded at
      // create/apply time as sourceProfile), never the owner package name.
      // A snapshot without a recorded target stays conservatively alive when
      // its owner is in the runtime view (never guessed from the owner).
      const resolveOwnerProfile = (owner, record) => {
        if (!profilesHome) return undefined
        const managed = typeof record?.sourceProfile === 'string' && record.sourceProfile.length > 0
          ? record.sourceProfile
          : undefined
        if (typeof managed !== 'string' || managed.length === 0) return undefined
        return { profileDir: join(profilesHome, managed) }
      }
      const classified = classifyOrphans({ snapshotsRoot, runtimeView, resolveOwnerProfile })
      const deleted = deleteOrphans({ snapshotsRoot, orphaned: classified.orphaned })
      // staging residuals from interrupted operations are reclaimed by GC.
      let tmpCleaned = 0
      const tmpDir = storage ? join(storage, 'tmp') : undefined
      if (tmpDir && existsSync(tmpDir)) {
        for (const entry of readdirSync(tmpDir)) {
          const full = join(tmpDir, entry)
          try {
            rmSync(full, { recursive: true, force: true })
            tmpCleaned += 1
          } catch {
            // one stale entry must not stop the rest of the scan
          }
        }
      }
      terminal = terminalResult({
        outcome: 'success',
        payload: { orphaned: classified.orphaned, keptCount: classified.keptCount, deleted: deleted.deleted, tmpCleaned },
        owner: intentOwner,
      })
    } else {
      terminal = terminalResult({ outcome: TERMINAL_OUTCOME.error, code: 'unavailable', reason: `command-not-wired:${command}`, auditability: false })
    }
  } catch (error) {
    terminal = terminalResult({
      outcome: TERMINAL_OUTCOME.error,
      code: 'internal',
      reason: error?.message ?? String(error),
      auditability: false,
    })
  }

  // Audit every terminal state in the executor process (append-only). An
  // audit failure degrades the result's auditability flag, never the outcome.
  const audit = appendAuditRecord({
    at: new Date().toISOString(),
    owner: intentOwner,
    op: command,
    target: intentTarget ?? '',
    outcome: terminal.outcome,
    reasons: Array.isArray(terminal.reasons) ? terminal.reasons : (terminal.reason ? [terminal.reason] : []),
    generation: terminal.generation,
  }, storage)
  // An audit failure degrades the auditability flag in the result (never
  // crashes the operation after commit): the append outcome is authoritative
  // and overrides any pre-set true.
  terminal.auditability = audit

  const record = terminalResult(terminal)
  writer.result(record)
  return OUTCOME_EXIT_CODES[record.outcome] ?? OUTCOME_EXIT_CODES.error
}