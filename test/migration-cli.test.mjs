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
