import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { analyzePackageManifest, analyzeParsedFile, compareBaseline, parseSource, readSource, scanRoot } from '../lib/migrate/index.js'

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-plugin-api-analysis-'))
}

test('analyzer detects imports, immutable service aliases, events, dynamics, and client markers', () => {
  const root = tempRoot()
  const file = path.join(root, 'plugin.js')
  fs.writeFileSync(file, [
    "import { connect } from '@deepseek-ai/dsh-client-connection'",
    "import x from '@deepseek-ai/dsh-internal-private'",
    'export const inject = [\'tools\']',
    'export function apply(ctx) {',
    "  const tools = ctx.get('tools')",
    '  tools.register({})',
    "  ctx.on('llm/stream', () => {})",
    "  ctx.on('unknown/event', () => {})",
    '  ctx.emit(eventName)',
    '  tools[method]()',
    '  return dsh.client.remote(slot)',
    '}',
    'exports["./client"] = {}',
  ].join('\n'))
  const parsed = parseSource(readSource({ absolute: file, file: 'plugin.js' }))
  const findings = analyzeParsedFile(parsed, { root })
  assert.ok(findings.some((finding) => finding.kind === 'direct-package' && finding.packageName === '@deepseek-ai/dsh-client-connection'))
  assert.ok(findings.some((finding) => finding.kind === 'direct-package-unsupported'))
  assert.ok(findings.some((finding) => finding.kind === 'service-method' && finding.classification === 'SAFE'))
  assert.ok(findings.some((finding) => finding.kind === 'event-call' && finding.classification === 'REVIEW'))
  assert.ok(findings.some((finding) => finding.kind === 'unknown-event' && finding.classification === 'MANUAL'))
  assert.ok(findings.some((finding) => finding.kind === 'dynamic-event' && finding.classification === 'MANUAL'))
  assert.ok(findings.some((finding) => finding.kind === 'dynamic-access' && finding.classification === 'MANUAL'))
  assert.ok(findings.some((finding) => finding.kind === 'client-marker' && finding.surface === 'client'))
  assert.ok(findings.every((finding) => finding.fingerprint || finding.kind === 'dynamic-event'))
})

test('scan continues after a parse error and emits one parse finding for the broken file', () => {
  const root = tempRoot()
  fs.writeFileSync(path.join(root, 'good.js'), "const tools = ctx.get('tools')\ntools.get()")
  fs.writeFileSync(path.join(root, 'bad.js'), 'const =')
  const report = scanRoot({ root })
  assert.equal(report.success, false)
  const parseFindings = report.findings.filter((finding) => finding.file === 'bad.js' && finding.kind === 'parse-error')
  assert.equal(parseFindings.length, 1)
  assert.equal(parseFindings[0].ruleId, 'infrastructure.parse-error')
  assert.match(parseFindings[0].fingerprint, /^[0-9a-f]{64}$/)
  assert.ok(parseFindings[0].start.byte >= 0)
  assert.ok(report.findings.some((finding) => finding.file === 'good.js'))
})

test('baseline comparison reports added, removed, and unchanged fingerprints', () => {
  const findings = [
    { fingerprint: 'same', severity: 'WARN' },
    { fingerprint: 'new', severity: 'ERROR' },
  ]
  const delta = compareBaseline(findings, { fingerprints: ['same', 'old'] })
  assert.deepEqual(delta.added.map((finding) => finding.fingerprint), ['new'])
  assert.deepEqual(delta.removed, ['old'])
  assert.deepEqual(delta.unchanged.map((finding) => finding.fingerprint), ['same'])
})

test('static non-DSH imports and requires are ignored while computed specifiers are manual', () => {
  const root = tempRoot()
  const file = path.join(root, 'plugin.js')
  fs.writeFileSync(file, [
    "const fs = require('node:fs')",
    "const lodash = import('lodash')",
    'const value = require(packageName)',
    'const other = import(prefix + suffix)',
  ].join('\n'))
  const parsed = parseSource(readSource({ absolute: file, file: 'plugin.js' }))
  const findings = analyzeParsedFile(parsed, { root })
  assert.equal(findings.filter((finding) => finding.kind === 'dynamic-import').length, 2)
})

test('reassigned service aliases are manual rather than silently ignored', () => {
  const root = tempRoot()
  const file = path.join(root, 'plugin.js')
  fs.writeFileSync(file, "let tools = ctx.get('tools')\ntools = other\ntools.register({})")
  const parsed = parseSource(readSource({ absolute: file, file: 'plugin.js' }))
  const findings = analyzeParsedFile(parsed, { root })
  assert.ok(findings.some((finding) => finding.kind === 'dynamic-access' && finding.classification === 'MANUAL'))
})

test('service methods named on are not mistaken for DSH event receivers', () => {
  const root = tempRoot()
  const file = path.join(root, 'plugin.js')
  fs.writeFileSync(file, "const tools = ctx.get('tools')\ntools.on('totally-not-events', fn)")
  const parsed = parseSource({
    absolute: file,
    file: 'plugin.js',
    bytes: fs.readFileSync(file),
  })
  const findings = analyzeParsedFile(parsed, { root })
  assert.equal(findings.some((finding) => finding.kind === 'unknown-event'), false)
})

test('analyzer does not classify shadowed service aliases as facade methods', () => {
  const root = tempRoot()
  const file = path.join(root, 'plugin.js')
  fs.writeFileSync(file, "const tools = ctx.get('tools')\nfunction nested(tools) { tools.register({}) }")
  const parsed = parseSource(readSource({ absolute: file, file: 'plugin.js' }))
  const findings = analyzeParsedFile(parsed, { root })
  assert.equal(findings.filter((finding) => finding.kind === 'service-method').length, 0)
})

test('dynamic service/event and reflection accesses are reported while unrelated objects stay quiet', () => {
  const root = tempRoot()
  const file = path.join(root, 'plugin.js')
  fs.writeFileSync(file, [
    'const tools = ctx.get(serviceName)',
    'const known = ctx.get(\'tools\')',
    "known['delete']()",
    'Object.getPrototypeOf(known)',
    'ctx[eventMethod](name)',
    "obj.on('fake', fn)",
    'obj.remote = value',
    'local._private = value',
  ].join('\n'))
  const parsed = parseSource(readSource({ absolute: file, file: 'plugin.js' }))
  const findings = analyzeParsedFile(parsed, { root })
  assert.ok(findings.some((finding) => finding.kind === 'dynamic-service-access'))
  assert.ok(findings.some((finding) => finding.kind === 'dynamic-access'))
  assert.ok(findings.some((finding) => finding.kind === 'dynamic-event'))
  assert.equal(findings.filter((finding) => finding.kind === 'event-call' || finding.kind === 'unknown-event').length, 0)
  assert.equal(findings.filter((finding) => finding.kind === 'client-contract').length, 0)
  assert.equal(findings.filter((finding) => finding.kind === 'monkey-patch').length, 0)
})

test('package manifest client markers are included in scan evidence', () => {
  const root = tempRoot()
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dsh: { client: { remote: true } }, exports: { './client': './client.js' } }))
  const manifest = analyzePackageManifest(root)
  assert.equal(manifest.present, true)
  assert.equal(manifest.findings.length, 2)
  const report = scanRoot({ root })
  assert.ok(report.files.includes('package.json'))
  assert.ok(report.findings.some((finding) => finding.kind === 'client-manifest'))
  assert.ok(report.entryKinds.includes('exports.client'))
})

test('package main is recorded as an entry kind without selecting an unsafe edit', () => {
  const root = tempRoot()
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ main: './lib/index.js' }))
  const report = scanRoot({ root })
  assert.ok(report.findings.some((finding) => finding.kind === 'entry-kind' && finding.entryKind === 'package.main'))
  assert.ok(report.entryKinds.includes('package.main'))
})

test('client dynamic namespaces are C-class unsupported and CommonJS client bindings are recognized', () => {
  const root = tempRoot()
  const file = path.join(root, 'client.cjs')
  fs.writeFileSync(file, [
    "const client = require('@deepseek-ai/dsh-client-connection')",
    'client.remote[namespace]()',
    'client.settingsScope[name]()',
    'client.remote.static()',
  ].join('\n'))
  const parsed = parseSource(readSource({ absolute: file, file: 'client.cjs' }))
  const findings = analyzeParsedFile(parsed, { root })
  const dynamic = findings.filter((finding) => finding.kind === 'client-dynamic-namespace')
  assert.equal(dynamic.length, 2)
  assert.ok(dynamic.every((finding) => finding.classification === 'UNSUPPORTED' && finding.aClass === 'C'))
  assert.ok(findings.some((finding) => finding.kind === 'client-contract' && finding.contract === 'remote'))
})
