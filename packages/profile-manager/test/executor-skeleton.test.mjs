import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs'
import { mkdtempSync, rmSync, readFileSync as readFile } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runCli, parseCli, TERMINAL_OUTCOME, OUTCOME_EXIT_CODES, COMMANDS } from '../lib/cli.js'
import { runHandshake } from '../lib/handshake.js'
import {
  ensureStorageRoot,
  loadConfig,
  appendAuditRecord,
  snapshotDir,
  storagePaths,
  resolveDshHome,
  DEFAULT_CONFIG,
} from '../lib/storage.js'

function createIo() {
  const lines = []
  return {
    lines,
    io: {
      env: { ...process.env },
      stdout: { write(text) { lines.push(text) } },
      stderr: { write() {} },
    },
  }
}

function tempHome() {
  const base = mkdtempSync(join(tmpdir(), 'profile-manager-'))
  const home = join(base, 'dsh')
  mkdirSync(home, { recursive: true })
  return { base, home }
}

test('CLI parses known commands and rejects unknown ones without throwing', () => {
  for (const command of COMMANDS) {
    assert.deepEqual(parseCli([command]), { ok: true, command, intent: undefined })
    assert.deepEqual(parseCli([command, '{"a":1}']), { ok: true, command, intent: { a: 1 } })
  }
  assert.equal(parseCli([]).ok, false)
  assert.equal(parseCli(['nope']).ok, false)
  assert.equal(parseCli(['handshake', '{broken']).ok, false)
})

test('runCli emits the JSON-lines result envelope and maps exit codes', async () => {
  const { home } = tempHome()
  try {
    const captured = []
    const io = {
      env: { ...process.env, DSH_HOME: home },
      stdout: { write(text) { captured.push(text.trim()) } },
      stderr: { write() {} },
    }
    const code = await runCli(['handshake'], io)
    assert.equal(code, OUTCOME_EXIT_CODES.success)
    assert.equal(captured.length, 1)
    const event = JSON.parse(captured[0])
    assert.equal(event.type, 'result')
    assert.equal(event.outcome, 'success')
    assert.equal(typeof event.result.builtForRuntime, 'string')
    assert.equal(event.result.builtForRuntime, '0.1.0-rc.6')
    assert.equal(event.result.apiProtocol, '0.7')
    assert.ok(event.auditability === undefined || event.auditability === true)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('runCli rejects malformed invocations with error exit and typed invalid-input', async () => {
  const captured = []
  const io = {
    env: { ...process.env },
    stdout: { write(text) { captured.push(text.trim()) } },
    stderr: { write() {} },
  }
  const code = await runCli([], io)
  assert.equal(code, OUTCOME_EXIT_CODES.error)
  const event = JSON.parse(captured[0])
  assert.equal(event.type, 'result')
  assert.equal(event.outcome, 'error')
  assert.equal(event.code, 'invalid-input')
})

test('handshake reports the executor build identity from its own manifest', () => {
  const manifest = { name: '@deepseek-ai/dsh-plugin-api-profile-manager', version: '0.1.0-rc.6-0.7', dsh: { api: '0.7' } }
  const result = runHandshake(manifest, undefined)
  assert.equal(result.outcome, 'success')
  assert.equal(result.builtForRuntime, '0.1.0-rc.6')
  assert.equal(result.apiProtocol, '0.7')
  assert.equal(result.version, '0.1.0-rc.6-0.7')
})

test('handshake degrades on an invalid own manifest', () => {
  assert.equal(runHandshake(undefined, undefined).outcome, 'error')
  assert.equal(runHandshake({ version: '1.2.3' }, undefined).outcome, 'error')
  assert.equal(runHandshake({ version: '0.1.0-rc.6-0.7' }, undefined).outcome, 'error')
})

test('storage scope resolves under $DSH_HOME and creates the layout', () => {
  const { home } = tempHome()
  try {
    const root = ensureStorageRoot({ env: { DSH_HOME: home } })
    assert.ok(root)
    assert.ok(root.endsWith(join('plugin-api', 'profile-manager')))
    const paths = storagePaths(root)
    for (const dir of [paths.snapshots, paths.seed, paths.backups, paths.tmp]) {
      assert.ok(existsSync(dir), `missing ${dir}`)
    }
    assert.equal(resolveDshHome({ DSH_HOME: home }), home)
    assert.ok(resolveDshHome({ DSH_HOME: '   ' }).endsWith('.dsh'))
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('config.json applies defaults fail-closed and never relaxes quotas', () => {
  const { home } = tempHome()
  try {
    const root = join(home, 'plugin-api', 'profile-manager')
    mkdirSync(root, { recursive: true })
    assert.deepEqual(loadConfig(root), DEFAULT_CONFIG)
    writeFileSync(join(root, 'config.json'), JSON.stringify({ quotaPerOwnerMb: 128, quotaTotalMb: 512, backupRetentionN: 3 }))
    const config = loadConfig(root)
    assert.equal(config.quotaPerOwnerMb, 128)
    assert.equal(config.quotaTotalMb, 512)
    assert.equal(config.backupRetentionN, 3)
    // malformed values fall back to defaults instead of relaxing.
    writeFileSync(join(root, 'config.json'), JSON.stringify({ quotaPerOwnerMb: -5, quotaTotalMb: 'x', backupRetentionN: 0 }))
    const clamped = loadConfig(root)
    assert.equal(clamped.quotaPerOwnerMb, DEFAULT_CONFIG.quotaPerOwnerMb)
    assert.equal(clamped.quotaTotalMb, DEFAULT_CONFIG.quotaTotalMb)
    assert.equal(clamped.backupRetentionN, DEFAULT_CONFIG.backupRetentionN)
    writeFileSync(join(root, 'config.json'), '{broken json')
    assert.deepEqual(loadConfig(root), DEFAULT_CONFIG)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('audit.log appends JSONL records and never exposes a public write entry', () => {
  const { home } = tempHome()
  try {
    const root = join(home, 'plugin-api', 'profile-manager')
    mkdirSync(root, { recursive: true })
    const ok = appendAuditRecord({
      at: '2026-08-25T00:00:00.000Z',
      owner: '@deepseek-ai/some-plugin',
      op: 'snapshot-create',
      target: 'sna-1',
      outcome: 'success',
      reasons: [],
      generation: 'gen-7',
    }, root)
    assert.equal(ok, true)
    const lines = readFileSync(join(root, 'audit.log'), 'utf8').trim().split('\n')
    assert.equal(lines.length, 1)
    const record = JSON.parse(lines[0])
    assert.equal(record.owner, '@deepseek-ai/some-plugin')
    assert.equal(record.op, 'snapshot-create')
    assert.equal(record.outcome, 'success')
    assert.equal(record.generation, 'gen-7')
    assert.equal(record.at, '2026-08-25T00:00:00.000Z')
    // append-only: a second record appends, never overwrites.
    appendAuditRecord({ at: '2026-08-25T00:00:01.000Z', owner: 'x', op: 'handshake', target: '', outcome: 'success', reasons: [], generation: undefined }, root)
    assert.equal(readFileSync(join(root, 'audit.log'), 'utf8').trim().split('\n').length, 2)
    assert.equal(appendAuditRecord({}, undefined), false)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('snapshotDir enforces containment for owner and snapshot id', () => {
  const root = '/home/u/.dsh/plugin-api/profile-manager'
  assert.ok(snapshotDir(root, 'owner-a', 'sna-1').endsWith(join('snapshots', 'owner-a', 'sna-1')))
  assert.equal(snapshotDir(root, '../escape', 'sna-1'), undefined)
  assert.equal(snapshotDir(root, 'owner', '../sna'), undefined)
  assert.equal(snapshotDir(root, '', 'sna'), undefined)
  assert.equal(snapshotDir(undefined, 'owner', 'sna'), undefined)
})

test('an audit failure degrades the auditability flag in the result', async () => {
  const { home } = tempHome()
  const root = join(home, 'plugin-api', 'profile-manager')
  const captured = []
  const io = {
    env: { ...process.env, DSH_HOME: home },
    stdout: { write(text) { captured.push(text.trim()) } },
    stderr: { write() {} },
  }
  // first op: audit append succeeds -> auditability true on success.
  let code = await runCli(['snapshot-create', JSON.stringify({ owner: 'plugin-a', source: 'disk' })], io)
  assert.equal(code, OUTCOME_EXIT_CODES.success)
  let event = JSON.parse(captured[0])
  assert.equal(event.outcome, 'success')
  assert.equal(event.auditability, true)
  // break append: replace audit.log with a directory so appendFileSync fails.
  const auditPath = join(root, 'audit.log')
  rmSync(auditPath, { force: true })
  mkdirSync(auditPath, { recursive: true })
  captured.length = 0
  code = await runCli(['snapshot-create', JSON.stringify({ owner: 'plugin-a', source: 'disk' })], io)
  assert.equal(code, OUTCOME_EXIT_CODES.success)
  event = JSON.parse(captured[0])
  assert.equal(event.outcome, 'success')
  assert.equal(event.auditability, false)
})

test('runCli wires every terminal state into the audit log', async () => {
  const { home } = tempHome()
  try {
    const captured = []
    const io = {
      env: { ...process.env, DSH_HOME: home },
      stdout: { write(text) { captured.push(text.trim()) } },
      stderr: { write() {} },
    }
    const code = await runCli(['snapshot-create', JSON.stringify({ owner: 'plugin-a', source: 'disk' })], io)
    assert.equal(code, OUTCOME_EXIT_CODES.success)
    const root = join(home, 'plugin-api', 'profile-manager')
    const lines = readFile(join(root, 'audit.log'), 'utf8').trim().split('\n')
    assert.ok(lines.length >= 1)
    const audit = JSON.parse(lines[0])
    assert.equal(audit.op, 'snapshot-create')
    assert.equal(audit.outcome, 'success')
    assert.equal(audit.owner, 'plugin-a')
    // unwired commands still produce a typed error terminal and an audit line.
    const captured2 = []
    const io2 = {
      env: { ...process.env, DSH_HOME: home },
      stdout: { write(text) { captured2.push(text.trim()) } },
      stderr: { write() {} },
    }
    const code2 = await runCli(['snapshot-validate', JSON.stringify({ owner: 'plugin-a', snapshotId: 'x', level: 'basic' })], io2)
    assert.equal(code2, OUTCOME_EXIT_CODES.error)
    const audit2 = JSON.parse(readFile(join(root, 'audit.log'), 'utf8').trim().split('\n').at(-1))
    assert.equal(audit2.op, 'snapshot-validate')
    assert.equal(audit2.outcome, 'error')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})