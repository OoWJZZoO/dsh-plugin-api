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
  handshakeShapes = { builtForRuntime: '0.1.0-rc.6', apiProtocol: '0.6' },
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
    '  write({ type: "result", outcome: env.FAKE_HANDSHAKE_OUTCOME ?? "success", result: { builtForRuntime: env.FAKE_RUNTIME ?? "0.1.0-rc.6", apiProtocol: env.FAKE_API ?? "0.6" } })',
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
    facadeApi: '0.6',
    env: {
      ...BASE_ENV,
      DSH_PLUGIN_API_PROFILE_EXECUTOR: fake.script,
      ...(fake.envOverrides ?? {}),
      ...extra,
    },
    nodeBin: process.execPath,
  }
}


test('handle-bearing verbs expose progress, terminal outcomes, and restartRequired', async () => {
  const fake = createFakeExecutor({
    progressStages: ['prepare', 'validate', 'commit'],
    restartRequired: true,
  })
  try {
    const mutation = createProfileMutation(baseOptions(fake))
    const handle = mutation.api.apply({ owner: 'p', profile: 'dev', type: 'config', rows: [] })
    assert.equal(typeof handle.operationId, 'string')
    assert.equal(handle.kind, 'quick-write')
    const progress = []
    handle.onProgress((event) => progress.push(event.stage))
    const result = await handle.result
    assert.equal(result.outcome, 'success')
    assert.equal(result.restartRequired, true)
    assert.ok(progress.includes('commit'))
    assert.equal(handle.settled(), result)
    assert.ok(TERMINAL_OUTCOMES.includes(result.outcome))
  } finally {
    fake.remove()
  }
})

test('cancel before commit settles aborted; cancel after commit is too-late', async () => {
  const fake = createFakeExecutor({
    progressStages: ['prepare', 'validate', 'commit'],
    outcome: 'aborted',
  })
  try {
    const mutation = createProfileMutation(baseOptions(fake))
    const handle = mutation.api.apply({ owner: 'p', profile: 'dev', type: 'config', rows: [] })
    // cancel immediately: the executor settles aborted at its commit point.
    handle.onProgress(() => {})
    const settled = await handle.cancel()
    assert.equal(settled.outcome, 'aborted')

    // a handle that saw commit progress reports too-late for cancel.
    const lateHandle = mutation.api.apply({ owner: 'p', profile: 'dev', type: 'config', rows: [] })
    const sawCommit = new Promise((resolve) => {
      lateHandle.onProgress((event) => {
        if (event.stage === 'commit') resolve(true)
      })
    })
    await sawCommit
    const lateRecord = await lateHandle.cancel()
    assert.equal(lateRecord.code, MUTATION_CODES['too-late'])
    const result = await lateHandle.result
    assert.ok(result.outcome === 'success' || result.outcome === 'aborted')
  } finally {
    fake.remove()
  }
})

test('snapshot-validate is handle-bearing with the five-word outcome vocabulary', async () => {
  const fake = createFakeExecutor({ outcome: 'denied', resultCode: MUTATION_CODES['gate-conflict'] })
  try {
    const mutation = createProfileMutation(baseOptions(fake))
    const handle = mutation.api.snapshot.validate({ owner: 'p', snapshotId: 's1', level: 'basic' })
    assert.equal(handle.kind, 'snapshot-validate')
    const result = await handle.result
    assert.equal(result.outcome, 'denied')
    assert.equal(result.code, MUTATION_CODES['gate-conflict'])
    assert.ok(TERMINAL_OUTCOMES.includes(result.outcome))
  } finally {
    fake.remove()
  }
})
