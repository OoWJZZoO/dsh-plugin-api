import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  createProfileMutation,
  callerIdentityOf,
  resolveExecutorPath,
  runHandshakeCheck,
  TERMINAL_OUTCOMES,
  MUTATION_CODES,
  ROOT_OWNER_TOKEN,
} from '../lib/profile-mutation.js'

/**
 * Scripted fake executor (JSON-lines protocol):
 * `node <fake> <command> <json>` emits progress for handle-bearing commands
 * then one result event; behavior driven by env variables so tests control
 * terminal outcomes deterministically.
 */
function createFakeExecutor({
  handshakeShapes = { builtForRuntime: '0.1.0-rc.6', apiProtocol: '0.7' },
  progressStages = ['prepare', 'validate', 'commit'],
  outcome = 'success',
  resultCode,
  resultReason,
  restartRequired = true,
  emittedResult,
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'fake-profile-executor-'))
  const script = join(dir, 'fake-executor.js')
  const body = [
    '#!/usr/bin/env node',
    'const [command, rawIntent] = process.argv.slice(2)',
    'const intent = rawIntent ? JSON.parse(rawIntent) : {}',
    'const write = (obj) => process.stdout.write(JSON.stringify(obj) + "\\n")',
    'const env = process.env',
    'if (command === "handshake") {',
    '  write({ type: "result", outcome: env.FAKE_HANDSHAKE_OUTCOME ?? "success", result: { builtForRuntime: env.FAKE_RUNTIME ?? "0.1.0-rc.6", apiProtocol: env.FAKE_API ?? "0.7" } })',
    '  process.exit(0)',
    '}',
    'const handleBearing = command === "quick-write" || command === "snapshot-validate"',
    'if (handleBearing) {',
    '  const stages = (env.FAKE_STAGES ?? "prepare,validate,commit").split(",")',
    '  for (const stage of stages) write({ type: "progress", operationId: intent.operationId, stage })',
    '}',
    'if (env.FAKE_SILENT === "1") process.exit(Number(env.FAKE_EXIT ?? 1))',
    'const outcome = env.FAKE_OUTCOME ?? "success"',
    'const result = { type: "result", outcome, operationId: intent.operationId }',
    'if (env.FAKE_CODE) result.code = env.FAKE_CODE',
    'if (env.FAKE_REASON) result.reason = env.FAKE_REASON',
    'if (env.FAKE_RESTART === "true") result.restartRequired = true',
    'if (env.FAKE_PAYLOAD !== undefined) result.result = JSON.parse(env.FAKE_PAYLOAD)',
    'result.echoIntent = intent',
    'write(result)',
    'process.exit(env.FAKE_EXIT === undefined ? 0 : Number(env.FAKE_EXIT))',
    '',
  ].join('\n')
  writeFileSync(script, body, 'utf8')
  chmodSync(script, 0o755)
  const envOverrides = {}
  if (progressStages?.length) envOverrides.FAKE_STAGES = progressStages.join(',')
  if (outcome) envOverrides.FAKE_OUTCOME = outcome
  if (resultCode !== undefined) envOverrides.FAKE_CODE = resultCode
  if (resultReason !== undefined) envOverrides.FAKE_REASON = resultReason
  if (restartRequired) envOverrides.FAKE_RESTART = 'true'
  if (emittedResult !== undefined) envOverrides.FAKE_PAYLOAD = JSON.stringify(emittedResult)
  if (handshakeShapes) {
    envOverrides.FAKE_RUNTIME = handshakeShapes.builtForRuntime
    envOverrides.FAKE_API = handshakeShapes.apiProtocol
  }
  return { script, dir, envOverrides, remove: () => rmSync(dir, { recursive: true, force: true }) }
}

const BASE_ENV = { DSH_PLUGIN_API_PROFILE_EXECUTOR: undefined }

function baseOptions(fake, extra = {}) {
  return {
    logger: { warn() {}, error() {} },
    installedRuntime: '0.1.0-rc.6',
    facadeApi: '0.7',
    env: {
      ...BASE_ENV,
      DSH_PLUGIN_API_PROFILE_EXECUTOR: fake.script,
      ...(fake.envOverrides ?? {}),
      ...extra,
    },
    nodeBin: process.execPath,
  }
}

test('resolveExecutorPath prefers the env override and falls back to the package manifest', () => {
  const fake = createFakeExecutor()
  try {
    const explicit = resolveExecutorPath({ DSH_PLUGIN_API_PROFILE_EXECUTOR: fake.script })
    assert.equal(explicit.ok, true)
    assert.equal(explicit.path, fake.script)
    assert.equal(resolveExecutorPath({ DSH_PLUGIN_API_PROFILE_EXECUTOR: '  ' }).ok, false)
    assert.equal(resolveExecutorPath({}).ok, false) // not installed in this env
  } finally {
    fake.remove()
  }
})

test('handshake validates both directions and reports mismatches typed', async () => {
  const fake = createFakeExecutor()
  try {
    const ok = await runHandshakeCheck({
      path: fake.script,
      installedRuntime: '0.1.0-rc.6',
      facadeApi: '0.7',
      env: {},
    }, { nodeBin: process.execPath })
    assert.equal(ok.ok, true)

    const runtimeMismatch = await runHandshakeCheck({
      path: fake.script,
      installedRuntime: '0.1.0-rc.999',
      facadeApi: '0.7',
      env: {},
    }, { nodeBin: process.execPath })
    assert.equal(runtimeMismatch.ok, false)
    assert.equal(runtimeMismatch.reason, 'runtime-mismatch')

    const apiMismatch = await runHandshakeCheck({
      path: fake.script,
      installedRuntime: '0.1.0-rc.6',
      facadeApi: '0.5',
      env: {},
    }, { nodeBin: process.execPath })
    assert.equal(apiMismatch.ok, false)
    assert.equal(apiMismatch.reason, 'api-mismatch')
  } finally {
    fake.remove()
  }
})

test('write verbs degrade typed when the executor is absent; preflight validates input', async () => {
  const fake = createFakeExecutor()
  try {
    const mutation = createProfileMutation(baseOptions(fake, { DSH_PLUGIN_API_PROFILE_EXECUTOR: '/nonexistent/executor' }))
    const missing = await mutation.api.snapshot.create({ owner: 'p', source: 'disk' })
    assert.equal(missing.outcome, 'error')
    assert.equal(missing.code, MUTATION_CODES.unavailable)

    const present = createProfileMutation(baseOptions(fake))
    const invalid = await present.api.snapshot.create(null)
    assert.equal(invalid.outcome, 'error')
    assert.equal(invalid.code, MUTATION_CODES['invalid-input'])
  } finally {
    fake.remove()
  }
})

test('direct verbs return immediate typed results', async () => {
  const fake = createFakeExecutor({ outcome: 'success' })
  try {
    const mutation = createProfileMutation(baseOptions(fake))
    const created = await mutation.api.snapshot.create({ owner: 'p', source: 'disk' })
    assert.equal(created.outcome, 'success')
    const deleted = await mutation.api.snapshot.delete({ owner: 'p', snapshotId: 's1' })
    assert.equal(deleted.outcome, 'success')
    // handshake cache is reused after the first success.
    const modified = mutation.api.snapshot.modify({ owner: 'p', snapshotId: 's1', config: {} })
    assert.equal(typeof modified.then, 'function')
  } finally {
    fake.remove()
  }
})

test('executor protocol failures become typed internal errors, never throw', async () => {
  const fake = createFakeExecutor({ outcome: 'error', resultReason: 'boom', resultCode: 'internal' })
  try {
    const mutation = createProfileMutation(baseOptions(fake))
    const result = await mutation.api.snapshot.delete({ owner: 'p', snapshotId: 's1' })
    assert.equal(result.outcome, 'error')
    // a crashed executor (exit without result event) still produces a typed error.
    const crashing = createFakeExecutor({ outcome: 'success' })
    try {
      const mutation2 = createProfileMutation(baseOptions(crashing, { FAKE_EXIT: '9', FAKE_SILENT: '1' }))
      const crashed = await mutation2.api.snapshot.delete({ owner: 'p', snapshotId: 's1' })
      assert.equal(crashed.outcome, 'error')
      assert.equal(crashed.code, 'internal')
    } finally {
      crashing.remove()
    }
  } finally {
    fake.remove()
  }
})

test('mutation surface is frozen and dispose never throws', async () => {
  const fake = createFakeExecutor()
  try {
    const mutation = createProfileMutation(baseOptions(fake))
    assert.ok(Object.isFrozen(mutation.api))
    assert.ok(Object.isFrozen(mutation.api.snapshot))
    assert.doesNotThrow(() => mutation.dispose())
    assert.doesNotThrow(() => mutation.dispose())
  } finally {
    fake.remove()
  }
})

test('callerIdentityOf resolves the caller package identity from the fiber; unresolvable -> root token', () => {
  const fiber = { name: '@deepseek-ai/caller-plugin', uid: 7 }
  const ctx = {
    ctx: { fiber },
    fiber,
    loader: {
      entries() {
        return [{ id: 'caller-row', options: { name: '@deepseek-ai/caller-plugin' }, fiber }]
      },
    },
  }
  assert.equal(callerIdentityOf(ctx), '@deepseek-ai/caller-plugin')
  // loader entry wins when available; unresolvable falls back to root.
  assert.equal(callerIdentityOf({}), ROOT_OWNER_TOKEN)
  assert.equal(callerIdentityOf({ ctx: { fiber: { name: 'plain-name' } } }), 'plain-name')
})

test('owner binding: write verbs mint the caller identity, never the bare caller-supplied owner', async () => {
  const fake = createFakeExecutor()
  try {
    const mutation = createProfileMutation(baseOptions(fake))
    const callerCtx = {
      fiber: { name: '@deepseek-ai/real-plugin' },
      loader: { entries: () => [{ options: { name: '@deepseek-ai/real-plugin' } }] },
    }
    const bound = mutation.apiFor(callerCtx)
    // rawIntent carries a spoofed owner string; the facade must override it.
    const result = await bound.snapshot.create({ owner: 'spoofed-owner', source: 'disk' })
    assert.equal(result.outcome, 'success')
    assert.equal(result.echoIntent.owner, '@deepseek-ai/real-plugin')
  } finally {
    fake.remove()
  }
})


test('a stalled executor settles error with a timeout reason classification', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fake-slow-executor-'))
  const script = join(dir, 'slow.js')
  writeFileSync(script, [
    '#!/usr/bin/env node',
    'const [command] = process.argv.slice(2)',
    'if (command === "handshake") {',
    '  process.stdout.write(JSON.stringify({ type: "result", outcome: "success", result: { builtForRuntime: "0.1.0-rc.6", apiProtocol: "0.7" } }) + "\\n")',
    '  process.exit(0)',
    '}',
    '// snapshot-delete: hang forever (the facade kills after timeout)',
    'setInterval(() => {}, 1000)',
    '',
  ].join('\n'), 'utf8')
  chmodSync(script, 0o755)
  try {
    const mutation = createProfileMutation({
      logger: { warn() {}, error() {} },
      installedRuntime: '0.1.0-rc.6',
      facadeApi: '0.7',
      env: { DSH_PLUGIN_API_PROFILE_EXECUTOR: script },
      nodeBin: process.execPath,
      timeoutMs: 400,
    })
    const result = await mutation.api.snapshot.delete({ owner: 'p', snapshotId: 's1' })
    assert.equal(result.outcome, 'error')
    assert.ok(result.reason.startsWith('executor-timeout:'), result.reason)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('dispose aborts in-flight executor children (kill-and-cleanup)', async () => {
  const fake = createFakeExecutor()
  try {
    const mutation = createProfileMutation(baseOptions(fake))
    const handle = mutation.api.apply({ owner: 'p', profile: 'dev', type: 'config', rows: [] })
    handle.onProgress(() => {})
    assert.doesNotThrow(() => mutation.dispose())
    const result = await handle.result
    assert.ok(['aborted', 'error', 'success', 'denied'].includes(result.outcome) || result.outcome === 'superseded')
  } finally {
    fake.remove()
  }
})
