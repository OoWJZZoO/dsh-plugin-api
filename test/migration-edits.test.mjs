import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyEdits, hashBytes, parseSource, planMigration, planSafeEdits, readSource, validateEdits, writeReport } from '../lib/migrate/index.js'

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-plugin-api-edits-'))
}

test('safe service alias edit rewrites only the receiver and preserves surrounding bytes', () => {
  const root = tempRoot()
  const file = path.join(root, 'plugin.js')
  const source = "const tools = ctx.get('tools')\n// keep this comment\ntools.register({ value: '猫' })\n"
  fs.writeFileSync(file, source)
  const parsed = parseSource(readSource({ absolute: file, file: 'plugin.js' }))
  const edits = planSafeEdits(parsed)
  assert.equal(edits.length, 1)
  const output = applyEdits(parsed.bytes, edits).toString('utf8')
  assert.equal(output, "const tools = ctx.get('tools')\n// keep this comment\nctx.pluginApi.tools.register({ value: '猫' })\n")
  assert.equal(edits[0].beforeHash, hashBytes(Buffer.from('tools.register')))
})

test('mutable aliases do not receive safe edits and edit conflicts fail before mutation', () => {
  const root = tempRoot()
  const file = path.join(root, 'plugin.js')
  fs.writeFileSync(file, "let tools = ctx.get('tools')\ntools.register({})")
  const parsed = parseSource(readSource({ absolute: file, file: 'plugin.js' }))
  assert.deepEqual(planSafeEdits(parsed), [])
  const bytes = Buffer.from('abcdef')
  const edits = [
    { file: 'x.js', start: { byte: 1 }, end: { byte: 4 }, replacement: 'X' },
    { file: 'x.js', start: { byte: 3 }, end: { byte: 5 }, replacement: 'Y' },
  ]
  assert.throws(() => validateEdits(bytes, edits), /overlapping/)
  assert.equal(bytes.toString(), 'abcdef')
})

test('safe edit application supports multiple variable-length replacements', () => {
  const bytes = Buffer.from('abcdef')
  const output = applyEdits(bytes, [
    { start: { byte: 1 }, end: { byte: 2 }, replacement: 'LONG' },
    { start: { byte: 4 }, end: { byte: 6 }, replacement: 'z' },
  ])
  assert.equal(output.toString(), 'aLONGcdz')
})

test('migration planning includes a deterministic diff and facade injection edits', () => {
  const root = tempRoot()
  const file = path.join(root, 'plugin.js')
  fs.writeFileSync(file, "export function apply(ctx) {\n  const tools = ctx.get('tools')\n  tools.register({})\n}\n")
  const report = planMigration({ root })
  assert.equal(report.success, true)
  assert.ok(report.edits.length >= 3)
  assert.match(report.diff, /ctx\.pluginApi\.tools\.register/)
  assert.match(report.diff, /pluginApi/)
})

test('facade guard is inserted after a directive prologue', () => {
  const root = tempRoot()
  const file = path.join(root, 'plugin.js')
  fs.writeFileSync(file, "export function apply(ctx) {\n  'use strict'\n  const tools = ctx.get('tools')\n  tools.register({})\n}\n")
  const report = planMigration({ root })
  assert.match(report.diff, /'use strict'[\s\S]*if \(!ctx\?\.pluginApi\?\.isActive\) return/)
})

test('injection is inserted before default and variable apply entry wrappers', () => {
  for (const [name, source] of [
    ['default.js', "export default function apply(ctx) {\n  const tools = ctx.get('tools')\n  tools.register({})\n}\n"],
    ['arrow.js', "const apply = (ctx) => {\n  const tools = ctx.get('tools')\n  tools.register({})\n}\nexport { apply }\n"],
  ]) {
    const root = tempRoot()
    fs.writeFileSync(path.join(root, name), source)
    const report = planMigration({ root })
    assert.equal(report.success, true)
    assert.doesNotMatch(report.diff, /export default export|const apply = export/)
  }
})

test('nested apply declarations are not treated as host entry candidates', () => {
  const root = tempRoot()
  fs.writeFileSync(path.join(root, 'plugin.js'), 'function outer() { const apply = () => {} }\n')
  const report = planMigration({ root })
  assert.equal(report.findings.filter((finding) => finding.kind === 'apply-entry').length, 0)
  assert.equal(report.edits.length, 0)
})

test('unexported or cross-file entry candidates block automatic injection', () => {
  const root = tempRoot()
  fs.writeFileSync(path.join(root, 'plugin.js'), "function apply(ctx) {\n  const tools = ctx.get('tools')\n  tools.register({})\n}\n")
  const report = planMigration({ root })
  assert.equal(report.findings.some((finding) => finding.kind === 'apply-entry'), false)
  assert.equal(report.findings.some((finding) => finding.kind === 'facade-injection-required'), false)
})

test('package main plus a different apply entry produces a review-only plan', () => {
  const root = tempRoot()
  const source = "export function apply(ctx) {\n  const tools = ctx.get('tools')\n  tools.register({})\n}\n"
  fs.writeFileSync(path.join(root, 'plugin.js'), source)
  fs.writeFileSync(path.join(root, 'other.js'), source)
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ main: './other.js' }))
  const report = planMigration({ root })
  assert.ok(report.findings.some((finding) => finding.kind === 'facade-injection-required' && finding.entryKind === 'ambiguous'))
  assert.equal(report.edits.length, 0)
})

test('static injection parameters resolve to their declared services', () => {
  const root = tempRoot()
  fs.writeFileSync(path.join(root, 'plugin.js'), "export const inject = ['tools']\nexport function apply(ctx, tools) {\n  tools.register({})\n}\n")
  const report = planMigration({ root })
  assert.ok(report.findings.some((finding) => finding.kind === 'service-method' && finding.service === 'tools'))
  assert.ok(report.edits.some((edit) => edit.replacement === 'ctx.pluginApi.tools.register'))
})

test('arrow apply entries resolve static injection parameters', () => {
  const root = tempRoot()
  fs.writeFileSync(path.join(root, 'plugin.js'), "export const inject = ['tools']\nexport const apply = (ctx, tools) => tools.register({})\n")
  const report = planMigration({ root })
  assert.ok(report.edits.some((edit) => edit.replacement === 'ctx.pluginApi.tools.register'))
})

test('safe edits respect lexical shadowing and do not rewrite unrelated receivers', () => {
  const root = tempRoot()
  fs.writeFileSync(path.join(root, 'plugin.js'), [
    "const tools = ctx.get('tools')",
    'tools.register({})',
    'function nested(tools) { tools.register({}) }',
    '{ const tools = other; tools.register({}) }',
  ].join('\n'))
  const parsed = parseSource(readSource({ absolute: path.join(root, 'plugin.js'), file: 'plugin.js' }))
  const edits = planSafeEdits(parsed)
  assert.equal(edits.filter((edit) => edit.replacement === 'ctx.pluginApi.tools.register').length, 1)
})

test('report writer refuses to overwrite a discovered source file', () => {
  const root = tempRoot()
  const file = path.join(root, 'plugin.js')
  fs.writeFileSync(file, 'const x = 1')
  assert.throws(() => writeReport({ root, files: ['plugin.js'], findings: [], edits: [], diagnostics: [], counts: {}, success: true }, file), /source path/)
  assert.equal(fs.readFileSync(file, 'utf8'), 'const x = 1')
})
