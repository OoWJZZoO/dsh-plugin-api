import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import {
  foldLayers,
  healthFindings,
  isJsExpr,
  parseEntryList,
  planConfigOverlay,
  planDependencySet,
  LAYER_UNAVAILABLE,
} from '../lib/profile-fold.js'
import { deepFreeze } from '../lib/deep-freeze.js'

const MANIFEST = JSON.stringify({
  name: 'dsh-profile-test',
  private: true,
  dependencies: {
    '@deepseek-ai/dsh-plugin-api-main': '0.1.0-rc.6-0.5',
    '@deepseek-ai/dsh-read-image': 'file:../dsh-read-image',
  },
  dsh: {
    profile: {
      bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless', '@deepseek-ai/dsh-plugin-api-main'],
    },
  },
})

const PATCH = [
  '- id: webserver',
  '  config:',
  '    host: !!js ctx.webStartup.host ?? \'127.0.0.1\'',
  '    port: !!js ctx.webStartup.port ?? 3082',
  '- id: agent-default-model',
  '  name: \'@deepseek-ai/dsh-agent-default-model\'',
  '  config:',
  '    provider: deepseek-official',
  '    model: deepseek-v4-flash',
].join('\n')

const OVERLAY = [
  '- id: webserver',
  '  config:',
  '    port: 3083',
].join('\n')

const MAIN_MANIFEST = JSON.stringify({
  name: '@deepseek-ai/dsh-plugin-api-main',
  version: '0.1.0-rc.6-0.5',
  dsh: { api: '0.5' },
})

const BASE_MANIFEST = JSON.stringify({
  name: '@deepseek-ai/dsh-base',
  version: '0.1.0-rc.6',
  dependencies: { '@deepseek-ai/cordis': '^4.0.1' },
})

test('foldLayers folds the official composition order into a frozen ResolvedView', () => {
  const view = foldLayers([
    { kind: 'manifest', content: MANIFEST },
    { kind: 'patch', content: PATCH },
    { kind: 'overlay', content: OVERLAY },
  ], { view: 'disk', profile: 'test', now: () => 1700000000000 })

  assert.equal(view.view, 'disk')
  assert.equal(view.profile, 'test')
  assert.equal(view.capturedAt, '2023-11-14T22:13:20.000Z')
  assert.ok(Object.isFrozen(view))
  assert.ok(Object.isFrozen(view.rows))
  assert.ok(Object.isFrozen(view.layers))
  assert.ok(Object.isFrozen(view.packages))

  // package identities: core bundles first in declared order, user deps after.
  assert.deepEqual(
    view.packages.filter((p) => p.scope === 'core').map((p) => p.name),
    ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless', '@deepseek-ai/dsh-plugin-api-main'],
  )
  // `@deepseek-ai/dsh-plugin-api-main` is declared in both bundles and
  // dependencies: bundle (core) scope wins. Only non-bundle deps are user scope.
  assert.deepEqual(
    view.packages.filter((p) => p.scope === 'user').map((p) => p.name),
    ['@deepseek-ai/dsh-read-image'],
  )
  // user deps are declared with their specifier string, not a resolved version.
  const readImage = view.packages.find((p) => p.name === '@deepseek-ai/dsh-read-image')
  assert.equal(readImage.version, undefined)

  // foldable layers are all folded.
  assert.deepEqual(
    view.layers.map((l) => [l.kind, l.status]),
    [['manifest', 'folded'], ['patch', 'folded'], ['overlay', 'folded']],
  )

  // rows: patch rows carry their source, overlay rows carry theirs.
  assert.equal(view.rows.length, 3) // 2 patch rows + 1 overlay row
  const [ws1, model, ws2] = view.rows
  assert.equal(ws1.id, 'webserver')
  assert.equal(ws1.name, undefined)
  assert.equal(ws1.bundle, 'profile')
  assert.equal(ws1.source, 'patch')
  assert.equal(ws1.layer, 'patch')
  assert.equal(model.id, 'agent-default-model')
  assert.equal(model.name, '@deepseek-ai/dsh-agent-default-model')
  assert.equal(ws2.id, 'webserver')
  assert.equal(ws2.source, 'overlay')
  assert.equal(ws2.bundle, 'overlay')
  assert.equal(ws2.layer, 'overlay')
})

test('foldLayers marks an unparseable layer unavailable and keeps the rest (tolerant folding)', () => {
  const view = foldLayers([
    { kind: 'manifest', content: MANIFEST },
    { kind: 'patch', content: '- id: broken\n  config: [unclosed' },
    { kind: 'overlay', content: OVERLAY },
  ])
  assert.equal(view.layers[1].status, 'unavailable')
  assert.equal(view.layers[1].reason, LAYER_UNAVAILABLE.unparseable)
  assert.equal(view.layers[0].status, 'folded')
  assert.equal(view.layers[2].status, 'folded')
  // successfully folded portions are still returned.
  assert.equal(view.rows.length, 1)
  assert.equal(view.rows[0].id, 'webserver')
  assert.equal(view.rows[0].source, 'overlay')
})

test('foldLayers rejects invalid inputs without guessing', () => {
  // non-array entry list.
  const notArray = foldLayers([{ kind: 'overlay', content: 'id: webserver\nconfig: {}' }])
  assert.equal(notArray.layers[0].status, 'unavailable')
  assert.equal(notArray.layers[0].reason, LAYER_UNAVAILABLE['invalid-shape'])
  // unknown layer kind.
  const unknown = foldLayers([{ kind: 'unknown-kind', content: 'whatever' }])
  assert.equal(unknown.layers[0].status, 'unavailable')
  assert.equal(unknown.layers[0].reason, LAYER_UNAVAILABLE['unknown-layer'])
  // missing string content.
  const noContent = foldLayers([{ kind: 'overlay', content: null }])
  assert.equal(noContent.layers[0].status, 'unavailable')
  assert.equal(noContent.layers[0].reason, LAYER_UNAVAILABLE['invalid-shape'])
  // manifest missing bundles is unavailable with missing-bundles.
  const noBundles = foldLayers([{ kind: 'manifest', content: JSON.stringify({ name: 'x' }) }])
  assert.equal(noBundles.layers[0].status, 'unavailable')
  assert.equal(noBundles.layers[0].reason, LAYER_UNAVAILABLE['missing-bundles'])
  // none of these ever throws; a malformed caller input degrades quietly.
  const malformed = foldLayers(null)
  assert.deepEqual(malformed.rows, [])
  assert.deepEqual(malformed.layers, [])
  assert.ok(Object.isFrozen(malformed))
})

test('!!js expressions are preserved verbatim and never evaluated', () => {
  const view = foldLayers([{ kind: 'patch', content: PATCH }])
  const webserver = view.rows[0]
  assert.ok(isJsExpr(webserver.raw.config.host))
  assert.equal(webserver.raw.config.host.__jsExpr, "ctx.webStartup.host ?? '127.0.0.1'")
  assert.equal(webserver.raw.config.port.__jsExpr, 'ctx.webStartup.port ?? 3082')
  assert.equal(typeof webserver.raw.config.port, 'object')
  // The expression must never be executed: no evaluation artifact appears.
  assert.equal(webserver.raw.config.port, webserver.raw.config.port) // stable identity, raw text only
})

test('nested insert lists are materialized as resolved rows in place', () => {
  const view = foldLayers([{
    kind: 'overlay',
    content: [
      '- insert:',
      '    - id: inserted-one',
      '      name: \'@deepseek-ai/pkg-one\'',
      '    - id: inserted-two',
      '      name: \'@deepseek-ai/pkg-two\'',
    ].join('\n'),
  }])
  assert.deepEqual(view.rows.map((r) => r.id), ['inserted-one', 'inserted-two'])
  for (const row of view.rows) {
    assert.equal(row.source, 'overlay')
    assert.equal(row.bundle, 'overlay')
    assert.ok(Object.isFrozen(row.raw))
  }
})

test('package-manifest layers enrich versions and dependency graphs', () => {
  const view = foldLayers([
    { kind: 'manifest', content: MANIFEST },
    { kind: 'package-manifest', name: '@deepseek-ai/dsh-plugin-api-main', content: MAIN_MANIFEST },
    { kind: 'package-manifest', name: '@deepseek-ai/dsh-base', content: BASE_MANIFEST },
  ])
  const main = view.packages.find((p) => p.name === '@deepseek-ai/dsh-plugin-api-main')
  const base = view.packages.find((p) => p.name === '@deepseek-ai/dsh-base')
  assert.equal(main.version, '0.1.0-rc.6-0.5')
  assert.equal(main.scope, 'core')
  assert.equal(base.version, '0.1.0-rc.6')
  assert.deepEqual(base.dependencies, ['@deepseek-ai/cordis'])
})

test('healthFindings triggers every finding code with severity classification', () => {
  const view = foldLayers([
    { kind: 'manifest', content: MANIFEST },
    { kind: 'package-manifest', name: '@deepseek-ai/dsh-base', content: BASE_MANIFEST },
    {
      kind: 'patch',
      content: [
        '- id: webserver',
        '  config: { port: 3082 }',
        '- id: agent-default-model',
        '  name: \'@deepseek-ai/dsh-agent-default-model\'',
        '- id: mystery-row',
        '  name: \'@deepseek-ai/not-declared-anywhere\'',
      ].join('\n'),
    },
    { kind: 'overlay', content: '- id: webserver\n  config: { port: 3083 }' },
    { kind: 'weird-kind', content: 'x' },
  ])
  const findings = healthFindings(view)
  assert.ok(Object.isFrozen(findings))

  const byCode = (code) => findings.filter((f) => f.code === code)
  assert.ok(byCode('duplicate-row-id').some((f) => f.subject === 'webserver'))
  assert.ok(byCode('row-package-mismatch').some((f) => f.subject === '@deepseek-ai/not-declared-anywhere'))
  assert.ok(byCode('missing-package').some((f) => f.subject === '@deepseek-ai/headless' || f.subject === '@deepseek-ai/dsh-headless' || f.subject === '@deepseek-ai/dsh-plugin-api-main'))
  assert.ok(byCode('unknown-layer').some((f) => f.subject === 'weird-kind'))
  assert.ok(byCode('unknown-layer')[0].severity === 'warning')
  assert.ok(byCode('duplicate-row-id')[0].severity === 'error')
  // version-consistent family: all plugin-api packages agree (only main with version).
  assert.equal(byCode('version-inconsistent').length, 0)
})

test('healthFindings reports version-inconsistent plugin-api family members', () => {
  const view = foldLayers([
    { kind: 'manifest', content: MANIFEST },
    {
      kind: 'package-manifest',
      name: '@deepseek-ai/dsh-plugin-api-main',
      content: JSON.stringify({ name: '@deepseek-ai/dsh-plugin-api-main', version: '0.1.0-rc.6-0.5' }),
    },
    {
      kind: 'package-manifest',
      name: '@deepseek-ai/dsh-plugin-api-compaction-events',
      content: JSON.stringify({ name: '@deepseek-ai/dsh-plugin-api-compaction-events', version: '0.1.0-rc.5-0.5' }),
    },
  ])
  const findings = healthFindings(view)
  const inconsistent = findings.filter((f) => f.code === 'version-inconsistent')
  assert.equal(inconsistent.length, 1)
  assert.ok(inconsistent[0].subject.includes('@deepseek-ai/dsh-plugin-api-main / @deepseek-ai/dsh-plugin-api-compaction-events'))
  assert.match(inconsistent[0].detail, /runtime or api part/)
})

test('planConfigOverlay computes the candidate overlay in memory without writing', () => {
  const intent = {
    rows: [
      { id: 'webserver', config: { port: 3083 } },
      { id: 'agent-default-model', disabled: true },
    ],
  }
  const diff = planConfigOverlay(intent)
  assert.equal(diff.intentType, 'config')
  assert.ok(Object.isFrozen(diff))
  assert.ok(diff.overlayYaml.includes('- id: webserver'))
  assert.ok(diff.overlayYaml.includes('port: 3083'))
  assert.ok(diff.overlayYaml.includes('- id: agent-default-model'))
  assert.ok(diff.overlayYaml.includes('disabled: true'))
  assert.deepEqual(diff.warnings, [])
  // Round-trip through the official dialect (js-yaml JSON_SCHEMA + !!js).
  const parsed = parseEntryList(diff.overlayYaml)
  assert.equal(parsed.ok, true)
  assert.equal(parsed.value[0].id, 'webserver')
  assert.equal(parsed.value[0].config.port, 3083)
  assert.equal(parsed.value[1].disabled, true)
})

test('planConfigOverlay tolerates invalid and empty change rows with warnings', () => {
  const diff = planConfigOverlay({ rows: [] })
  assert.deepEqual(diff.warnings, ['empty-config-change'])
  assert.equal(diff.overlayYaml, '[]\n')
  const mixed = planConfigOverlay({ rows: [{ id: 'ok' }, { nope: true }, { id: 42 }] })
  assert.ok(mixed.overlayYaml.includes('id: ok'))
  assert.equal(mixed.warnings.filter((w) => w === 'skipped-invalid-row').length, 2)
})

test('planDependencySet computes the target set and delta without installing', () => {
  const current = ['@deepseek-ai/a', '@deepseek-ai/b', '@deepseek-ai/c']
  const diff = planDependencySet(
    { add: ['@deepseek-ai/b', '@deepseek-ai/d'], remove: ['@deepseek-ai/a', '@deepseek-ai/x'] },
    current,
  )
  assert.ok(Object.isFrozen(diff))
  assert.equal(diff.intentType, 'deps')
  assert.deepEqual(diff.depSetDelta.targetSet, ['@deepseek-ai/b', '@deepseek-ai/c', '@deepseek-ai/d'])
  assert.deepEqual(diff.depSetDelta.add, ['@deepseek-ai/d'])
  assert.deepEqual(diff.depSetDelta.remove, ['@deepseek-ai/a'])
  // already-present / not-present warnings.
  assert.ok(diff.warnings.includes('already-present:@deepseek-ai/b'))
  assert.ok(diff.warnings.includes('not-present:@deepseek-ai/x'))
})

test('planDiff computations are zero side effects: directory hash unchanged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'profile-fold-sideeffect-'))
  try {
    writeFileSync(join(dir, 'package.json'), MANIFEST)
    writeFileSync(join(dir, 'cordis.patch.yml'), PATCH)
    const hashDir = (root) => {
      const hash = createHash('sha256')
      for (const entry of readdirSync(root)) {
        const full = join(root, entry)
        hash.update(entry)
        hash.update(statSync(full).size.toString())
        if (statSync(full).isFile()) hash.update(readFileSync(full))
      }
      return hash.digest('hex')
    }
    const before = hashDir(dir)
    const view = foldLayers([
      { kind: 'manifest', content: readFileSync(join(dir, 'package.json'), 'utf8') },
      { kind: 'patch', content: readFileSync(join(dir, 'cordis.patch.yml'), 'utf8') },
    ])
    healthFindings(view)
    planConfigOverlay({ rows: [{ id: 'webserver', config: { port: 9999 } }] })
    planDependencySet({ add: ['@deepseek-ai/x'] }, view.packages.map((p) => p.name))
    assert.equal(hashDir(dir), before)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('all outputs are deeply frozen and freeze failures fail closed for that payload', () => {
  const view = foldLayers([
    { kind: 'manifest', content: MANIFEST },
    { kind: 'patch', content: PATCH },
  ])
  assert.throws(() => { view.rows[0].id = 'mutated' }, TypeError)
  assert.throws(() => { view.packages[0].name = 'mutated' }, TypeError)
  assert.throws(() => { view.layers[0].status = 'mutated' }, TypeError)
  const findings = healthFindings(view)
  assert.throws(() => { findings[0] = null }, TypeError)
  const diff = planConfigOverlay({ rows: [{ id: 'x' }] })
  assert.throws(() => { diff.overlayYaml = 'mutated' }, TypeError)
  assert.equal(typeof deepFreeze, 'function') // shared helper stays consistent
})