import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { parseCliArgs, main } from '../scripts/migrate-cli.js'

test('top-level help is a zero-exit command', async () => {
  const lines = []
  const code = await main(['--help'], { log: (value) => lines.push(value), error: () => {} })
  assert.equal(code, 0)
  assert.match(lines.join('\n'), /dsh-plugin-api-migrate/)
  assert.equal(parseCliArgs(['-h']).command, 'help')
})

test('CLI parses repeatable root options without treating flags as commands', () => {
  const options = parseCliArgs(['scan', 'plugin', '--include', 'src', '--exclude', 'dist', '--json'])
  assert.equal(options.command, 'scan')
  assert.deepEqual(options.positionals, ['plugin'])
  assert.deepEqual(options.include, ['src'])
  assert.deepEqual(options.exclude, ['dist'])
  assert.equal(options.json, true)
})

test('the executable script prints help when launched as a child process', () => {
  const script = path.resolve('scripts/migrate-cli.js')
  const output = execFileSync(process.execPath, [script, '--help'], { encoding: 'utf8' })
  assert.match(output, /Usage:/)
})

test('CLI rejects an invalid fail-on threshold before scanning', async () => {
  const logs = []
  const errors = []
  const { main } = await import('../scripts/migrate-cli.js')
  const code = await main(['check', '.', '--fail-on', 'bogus'], { log: (value) => logs.push(value), error: (value) => errors.push(value) })
  assert.equal(code, 2)
  assert.equal(logs.length, 0)
  assert.match(errors[0], /invalid --fail-on/)
})

test('audit --read emits the standard JSON report', async () => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cli-audit-'))
  const file = path.join(root, 'audit.jsonl')
  fs.writeFileSync(file, `${JSON.stringify({ schemaVersion: 1, operation: 'ctx.get' })}\n`)
  const logs = []
  const { main } = await import('../scripts/migrate-cli.js')
  const code = await main(['audit', '--read', file, '--json'], { log: (value) => logs.push(value), error: () => {} })
  assert.equal(code, 0)
  const report = JSON.parse(logs[0])
  assert.equal(report.auditObservations[0].operation, 'ctx.get')
})

test('write mode validates the report target before mutating source files', async () => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cli-write-'))
  const file = path.join(root, 'plugin.js')
  const source = "export function apply(ctx) {\n  const tools = ctx.get('tools')\n  tools.register({})\n}\n"
  fs.writeFileSync(file, source)
  const errors = []
  const code = await main(['migrate', root, '--write', '--report', file, '--exclude', 'plugin.js'], { log: () => {}, error: (value) => errors.push(value) })
  assert.equal(code, 1)
  assert.match(errors[0], /source path/)
  assert.equal(fs.readFileSync(file, 'utf8'), source)
})
