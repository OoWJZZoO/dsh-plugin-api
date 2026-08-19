import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createAuditRecorder, readAuditFile } from '../lib/migrate/index.js'

function tempFile() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-plugin-api-audit-'))
  return path.join(root, '.dsh', 'migrations', 'audit.jsonl')
}

test('audit recorder writes explicit null metadata and RFC3339 UTC timestamps', () => {
  const file = tempFile()
  const recorder = createAuditRecorder({ file, clock: () => new Date('2026-01-02T03:04:05.000Z') })
  const entry = recorder.record({ plugin: 'demo', operation: 'ctx.get', location: { file: 'plugin.js', line: 2, column: 4, byte: 9 } })
  assert.equal(entry.module, null)
  assert.equal(entry.ruleId, null)
  assert.equal(entry.timestamp, '2026-01-02T03:04:05.000Z')
  const result = readAuditFile(file)
  assert.deepEqual(result.diagnostics, [])
  assert.deepEqual(result.observations, [entry])
})
test('audit reader preserves valid order and diagnoses malformed lines', () => {
  const file = tempFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify({ schemaVersion: 1, operation: 'a' })}\nnot-json\n${JSON.stringify({ schemaVersion: 1, operation: 'b' })}\n`)
  const result = readAuditFile(file)
  assert.deepEqual(result.observations.map((entry) => entry.operation), ['a', 'b'])
  assert.equal(result.diagnostics.length, 1)
  assert.equal(result.diagnostics[0].line, 2)
})
