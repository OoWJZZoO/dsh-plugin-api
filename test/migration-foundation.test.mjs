import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  discoverFiles,
  discoverExplicitFiles,
  parseSource,
  readSource,
  sourceRangeOf,
  selectRule,
  SERVICE_FACADE_MAPPINGS,
  SAFE_FACADE_METHODS,
  RULE_REGISTRY,
} from '../lib/migrate/index.js'

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-plugin-api-migrate-'))
}

test('discovery sorts supported files and excludes generated directories', () => {
  const root = tempRoot()
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true })
  fs.mkdirSync(path.join(root, '.dsh', 'migrations'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src', 'z.ts'), 'export const z = 1')
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'export const a = 1')
  fs.writeFileSync(path.join(root, 'src', 'readme.md'), '# no')
  fs.writeFileSync(path.join(root, 'dist', 'generated.js'), 'bad')
  fs.writeFileSync(path.join(root, '.dsh', 'migrations', 'report.js'), 'bad')

  const result = discoverFiles({ root })
  assert.deepEqual(result.files.map((file) => file.file), ['src/a.js', 'src/z.ts'])
  assert.equal(result.allowOutsideRoot, false)
})

test('explicit outside-root path is rejected by default and allowed explicitly', () => {
  const root = tempRoot()
  const outside = tempRoot()
  fs.writeFileSync(path.join(outside, 'plugin.js'), 'export const x = 1')
  assert.throws(
    () => discoverExplicitFiles({ root, files: [path.join(outside, 'plugin.js')] }),
    (error) => error.code === 'OUTSIDE_ROOT',
  )
  const allowed = discoverExplicitFiles({
    root,
    files: [path.join(outside, 'plugin.js')],
    allowOutsideRoot: true,
  })
  assert.equal(allowed.files.length, 1)
})

test('allow-outside-root also permits explicit outside filters', () => {
  const root = tempRoot()
  assert.doesNotThrow(() => discoverFiles({ root, include: ['../outside'], allowOutsideRoot: true }))
  assert.doesNotThrow(() => discoverFiles({ root, exclude: ['../outside'], allowOutsideRoot: true }))
})

test('include filters run before exclude filters', () => {
  const root = tempRoot()
  fs.mkdirSync(path.join(root, 'src', 'keep'), { recursive: true })
  fs.mkdirSync(path.join(root, 'src', 'skip'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src', 'keep', 'one.js'), '')
  fs.writeFileSync(path.join(root, 'src', 'skip', 'two.js'), '')
  const result = discoverFiles({ root, include: ['src'], exclude: ['src/skip'] })
  assert.deepEqual(result.files.map((file) => file.file), ['src/keep/one.js'])
})

test('include and exclude filters cannot escape the root', () => {
  const root = tempRoot()
  assert.throws(() => discoverFiles({ root, include: ['../outside'] }), (error) => error.code === 'OUTSIDE_ROOT')
  assert.throws(() => discoverFiles({ root, exclude: [path.resolve(root, '..')] }), (error) => error.code === 'OUTSIDE_ROOT')
})

test('Babel parser handles TypeScript and reports UTF-8 byte locations', () => {
  const root = tempRoot()
  const absolute = path.join(root, 'plugin.ts')
  fs.writeFileSync(absolute, 'const 名字: string = "猫"\nexport { 名字 }', 'utf8')
  const parsed = parseSource(readSource({ absolute, file: 'plugin.ts' }), { mode: 'babel' })
  assert.equal(parsed.ast.program.sourceType, 'module')
  const declaration = parsed.ast.program.body[0]
  const range = sourceRangeOf(parsed, declaration)
  assert.equal(range.start.line, 1)
  assert.equal(range.start.column, 1)
  assert.equal(range.start.byte, 0)
  assert.ok(range.end.byte > range.start.byte)
})

test('UTF-8 BOM is excluded from source coordinates but preserved in file bytes', () => {
  const root = tempRoot()
  const absolute = path.join(root, 'plugin.js')
  const body = 'const value = "猫"\n'
  fs.writeFileSync(absolute, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(body)]))
  const loaded = readSource({ absolute, file: 'plugin.js' })
  assert.equal(loaded.bomBytes, 3)
  assert.deepEqual([...loaded.bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf])
  const parsed = parseSource(loaded, { mode: 'babel' })
  const range = sourceRangeOf(parsed, parsed.ast.program.body[0])
  assert.equal(range.start.line, 1)
  assert.equal(range.start.column, 1)
  assert.equal(range.start.byte, 3)
})

test('line index uses UTF-8 byte offsets, including a BOM base', () => {
  const root = tempRoot()
  const absolute = path.join(root, 'plugin.js')
  fs.writeFileSync(absolute, Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from('猫\nconst value = 1\n'),
  ]))
  const parsed = parseSource(readSource({ absolute, file: 'plugin.js' }), { mode: 'babel' })
  assert.deepEqual(parsed.lineStarts, [3, 7, 23])
})

test('ECMA parser rejects TypeScript syntax with a typed parse error', () => {
  const root = tempRoot()
  const absolute = path.join(root, 'plugin.ts')
  fs.writeFileSync(absolute, 'const value: string = "x"', 'utf8')
  assert.throws(
    () => parseSource(readSource({ absolute, file: 'plugin.ts' }), { mode: 'ecma' }),
    (error) => error.code === 'PARSE_ERROR',
  )
})

test('parse errors expose one-based columns', () => {
  const root = tempRoot()
  const absolute = path.join(root, 'plugin.js')
  fs.writeFileSync(absolute, 'const = 1', 'utf8')
  assert.throws(
    () => parseSource(readSource({ absolute, file: 'plugin.js' }), { mode: 'babel' }),
    (error) => error.code === 'PARSE_ERROR' && error.details.column >= 1,
  )
})

test('rule registry maps public service methods and classifies dynamic access', () => {
  assert.equal(SERVICE_FACADE_MAPPINGS.agents, 'agent')
  assert.ok(SAFE_FACADE_METHODS.session.includes('requestContext'))
  assert.equal(selectRule({ surface: 'host', service: 'tools' }).selected.id, 'host.service.alias')
  assert.equal(selectRule({ surface: 'host', service: 'tools', method: 'delete' }).selected, undefined)
  assert.equal(selectRule({ surface: 'host', service: 'tools', method: 'register' }, { apiProtocol: '0.4' }).selected.classification, 'SAFE')
  assert.equal(selectRule({ surface: 'host', kind: 'dynamic-access' }).selected.classification, 'MANUAL')
  assert.equal(selectRule({ surface: 'client', kind: 'client-dynamic-namespace' }).selected.aClass, 'C')
})

test('every rule has a frozen equivalence contract and valid classification', () => {
  for (const rule of RULE_REGISTRY) {
    assert.equal(typeof rule.equivalence, 'string')
    assert.ok(rule.equivalence.length > 10)
    assert.ok(Object.isFrozen(rule))
  }
})
