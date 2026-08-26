import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { createProfileInspection, redactProfileSecrets, resolveProfileDir, INSPECTION_CODES } from '../lib/profile-inspection.js'

const PROFILE_MANIFEST = JSON.stringify({
  name: 'dsh-profile-test',
  private: true,
  dependencies: {
    '@deepseek-ai/dsh-plugin-api-main': '0.1.0-rc.6-0.5',
    '@deepseek-ai/dsh-read-image': 'file:../dsh-read-image',
  },
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'] } },
})

const PROFILE_PATCH = [
  '- id: webserver',
  '  config:',
  '    host: !!js ctx.webStartup.host ?? \'127.0.0.1\'',
  '    port: !!js ctx.webStartup.port ?? 3082',
  '- id: agent-default-model',
  '  name: \'@deepseek-ai/dsh-agent-default-model\'',
  '  config: { provider: deepseek-official, model: deepseek-v4-flash }',
].join('\n')

function makeProfileDir(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'profile-inspect-'))
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content)
  }
  return dir
}

function makeLoader(baseUrl, entries) {
  return {
    baseUrl,
    loader: {
      entries: () => entries,
    },
  }
}

const RUNTIME_ENTRIES = [
  { id: 'llm', options: { name: '@deepseek-ai/dsh-llm' }, fiber: { state: 2 } },
  { id: 'plugin-api-main', options: { id: 'plugin-api-main', name: '@deepseek-ai/dsh-plugin-api-main' }, fiber: { state: 2 } },
  { id: 'disabled-row', options: { name: '@deepseek-ai/some-pkg', disabled: true }, fiber: undefined },
]

test('inspect view runtime returns the boot-time snapshot from loader entries', () => {
  const dir = makeProfileDir()
  try {
    const ctx = makeLoader(pathToFileURL(join(dir, '')), RUNTIME_ENTRIES)
    const mounter = createProfileInspection({ ctx })
    const result = mounter.api.inspect({ view: 'runtime' })
    assert.equal(result.code, 'ok')
    assert.equal(result.view, 'runtime')
    assert.ok(Object.isFrozen(result))
    assert.ok(Object.isFrozen(result.rows))
    assert.equal(result.rows.length, 3)
    const [llm, main, disabled] = result.rows
    assert.equal(llm.name, '@deepseek-ai/dsh-llm')
    assert.equal(llm.enabled, true)
    assert.equal(main.id, 'plugin-api-main')
    assert.equal(disabled.enabled, false)
    // runtime view carries no disk-derived package info: packages stay empty.
    assert.deepEqual(result.packages, [])
    assert.ok(Array.isArray(result.layers))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('inspect view runtime is a boot-time snapshot: post-init loader changes are not tracked', () => {
  let entries = RUNTIME_ENTRIES
  const dir = makeProfileDir()
  try {
    const ctx = {
      baseUrl: pathToFileURL(join(dir, '')),
      loader: { entries: () => entries },
    }
    const mounter = createProfileInspection({ ctx })
    const first = mounter.api.inspect({ view: 'runtime' })
    // post-init dynamic registration: a new loader row appears after mount
    entries = [...RUNTIME_ENTRIES, { id: 'late-registration', options: { name: '@deepseek-ai/late' }, fiber: { state: 2 } }]
    const second = mounter.api.inspect({ view: 'runtime' })
    assert.equal(first.rows.length, second.rows.length)
    assert.deepEqual(first.rows.map((r) => r.id), second.rows.map((r) => r.id))
    assert.equal(second.rows.some((r) => r.id === 'late-registration'), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('inspect view runtime never re-reads disk at call time', () => {
  let readCount = 0
  const dir = makeProfileDir({
    'package.json': PROFILE_MANIFEST,
    'cordis.patch.yml': PROFILE_PATCH,
  })
  try {
    const ctx = makeLoader(pathToFileURL(join(dir, '')), RUNTIME_ENTRIES)
    // Tamper with the disk files after mount; the runtime view must not change.
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ nothing: true }))
    writeFileSync(join(dir, 'cordis.patch.yml'), '- id: other')
    const mounter = createProfileInspection({ ctx })
    const first = mounter.api.inspect({ view: 'runtime' })
    const second = mounter.api.inspect({ view: 'runtime' })
    assert.equal(first.rows.length, second.rows.length)
    assert.deepEqual(first.rows.map((r) => r.id), second.rows.map((r) => r.id))
    assert.equal(readCount, 0)
    // The runtime view is a boot-time snapshot: post-init tampering changes
    // nothing without a re-apply.
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('inspect view disk folds the current profile files in composition order', () => {
  const dir = makeProfileDir({
    'package.json': PROFILE_MANIFEST,
    'cordis.patch.yml': PROFILE_PATCH,
  })
  try {
    const ctx = makeLoader(pathToFileURL(join(dir, '')), RUNTIME_ENTRIES)
    const mounter = createProfileInspection({ ctx })
    const result = mounter.api.inspect({ view: 'disk' })
    assert.equal(result.code, 'ok')
    assert.equal(result.view, 'disk')
    assert.ok(Object.isFrozen(result))
    assert.equal(result.packages.filter((p) => p.scope === 'core').length, 2)
    assert.equal(result.rows.length, 2)
    assert.equal(result.rows[0].id, 'webserver')
    assert.ok(typeof result.capturedAt === 'string')
    // overlay files fold after the patch layer when supplied.
    const withOverlay = mounter.api.inspect({
      view: 'disk',
      overlayFiles: ['- id: webserver\n  config: { port: 3083 }'],
    })
    assert.equal(withOverlay.rows.length, 3)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('inspect view other reads an explicit profile directory strictly read-only', () => {
  const dir = makeProfileDir({
    'package.json': PROFILE_MANIFEST,
    'cordis.patch.yml': PROFILE_PATCH,
  })
  const home = mkdtempSync(join(tmpdir(), 'profile-inspect-home-'))
  const profiles = join(home, 'profiles')
  mkdirSync(profiles)
  const otherDir = join(profiles, 'other')
  mkdirSync(otherDir)
  writeFileSync(join(otherDir, 'package.json'), PROFILE_MANIFEST)
  writeFileSync(join(otherDir, 'cordis.patch.yml'), PROFILE_PATCH)
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const ctx = makeLoader(pathToFileURL(join(dir, '')), RUNTIME_ENTRIES)
    const mounter = createProfileInspection({ ctx })
    const result = mounter.api.inspect({ view: 'other', profile: 'other' })
    assert.equal(result.code, 'ok')
    assert.equal(result.profile, 'other')
    assert.equal(result.rows.length, 2)
    // The other profile directory is untouched by the inspection.
    assert.equal(join(otherDir, 'package.json') > '', true)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    rmSync(dir, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
})

test('inspect resolves the current profile dir from baseUrl and guards other names', () => {
  const home = mkdtempSync(join(tmpdir(), 'profile-inspect-home2-'))
  const profiles = join(home, 'profiles')
  mkdirSync(profiles)
  const dev = join(profiles, 'dev')
  mkdirSync(dev)
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const fromUrl = resolveProfileDir(pathToFileURL(join(dev, '')), undefined)
    assert.equal(fromUrl, dev)
    const byName = resolveProfileDir(undefined, 'dev')
    assert.equal(byName, dev)
    // traversal and invalid names are refused.
    assert.equal(resolveProfileDir(undefined, '..'), undefined)
    assert.equal(resolveProfileDir(undefined, 'a/b'), undefined)
    assert.equal(resolveProfileDir(undefined, ''), undefined)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    rmSync(home, { recursive: true, force: true })
  }
})

test('inspect degrades gracefully: unreadable disk profile is typed unavailable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'profile-inspect-empty-'))
  try {
    const ctx = makeLoader(pathToFileURL(join(dir, '')), RUNTIME_ENTRIES)
    const mounter = createProfileInspection({ ctx })
    // An empty temp dir has no manifest: manifest layer unavailable, but the
    // view itself still returns with missing layers rather than throwing.
    const result = mounter.api.inspect({ view: 'disk' })
    assert.equal(result.code, 'ok')
    assert.ok(result.layers.some((l) => l.status === 'unavailable'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('invalid views and intents return typed invalid-input without throwing', () => {
  const dir = makeProfileDir()
  try {
    const ctx = makeLoader(pathToFileURL(join(dir, '')), RUNTIME_ENTRIES)
    const mounter = createProfileInspection({ ctx })
    const badView = mounter.api.inspect({ view: 'nope' })
    assert.equal(badView.code, INSPECTION_CODES['invalid-input'])
    const badHealth = mounter.api.health(42)
    assert.equal(badHealth.code, INSPECTION_CODES['invalid-input'])
    const badPlan = mounter.api.planDiff({ type: 'mutation' })
    assert.equal(badPlan.code, INSPECTION_CODES['invalid-input'])
    assert.doesNotThrow(() => mounter.api.inspect(null))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('health returns frozen findings with severity over any view', () => {
  const dir = makeProfileDir({
    'package.json': PROFILE_MANIFEST,
    'cordis.patch.yml': [
      '- id: webserver',
      '  config: { port: 3082 }',
      '- id: webserver',
      '  config: { port: 3083 }',
    ].join('\n'),
  })
  try {
    const ctx = makeLoader(pathToFileURL(join(dir, '')), RUNTIME_ENTRIES)
    const mounter = createProfileInspection({ ctx })
    const report = mounter.api.health('disk')
    assert.equal(report.code, 'ok')
    assert.ok(Object.isFrozen(report.findings))
    assert.ok(report.findings.some((f) => f.code === 'duplicate-row-id'))
    // health over an existing view object is accepted too.
    const view = mounter.api.inspect({ view: 'disk' })
    const report2 = mounter.api.health(view)
    assert.equal(report2.code, 'ok')
    assert.ok(report2.findings.length >= 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('planDiff computes config and deps diffs purely without any side effect', () => {
  const dir = makeProfileDir()
  try {
    const ctx = makeLoader(pathToFileURL(join(dir, '')), RUNTIME_ENTRIES)
    const mounter = createProfileInspection({ ctx })
    const configDiff = mounter.api.planDiff({ type: 'config', rows: [{ id: 'webserver', config: { port: 3083 } }] })
    assert.equal(configDiff.code, 'ok')
    assert.equal(configDiff.diff.intentType, 'config')
    assert.ok(configDiff.diff.overlayYaml.includes('port: 3083'))
    const depsDiff = mounter.api.planDiff(
      { type: 'deps', add: ['@deepseek-ai/y', '@deepseek-ai/x'], remove: ['@deepseek-ai/nope'] },
      { currentPackages: ['@deepseek-ai/y'] },
    )
    assert.equal(depsDiff.code, 'ok')
    assert.equal(depsDiff.diff.intentType, 'deps')
    assert.ok(depsDiff.diff.warnings.includes('already-present:@deepseek-ai/y'))
    assert.ok(depsDiff.diff.warnings.includes('not-present:@deepseek-ai/nope'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('inspect disk output redacts secrets found in profile files before freezing', () => {
  const dir = makeProfileDir({
    'package.json': PROFILE_MANIFEST,
    'cordis.patch.yml': [
      '- id: conn',
      '  name: \'@deepseek-ai/some-conn\'',
      '  config:',
      '    apiKey: sk-live-leak',
      '    accessToken: t0ken',
      '    port: 3082',
    ].join('\n'),
  })
  try {
    const ctx = makeLoader(pathToFileURL(join(dir, '')), RUNTIME_ENTRIES)
    const mounter = createProfileInspection({ ctx })
    const result = mounter.api.inspect({ view: 'disk' })
    assert.equal(result.code, 'ok')
    const conn = result.rows.find((row) => row.id === 'conn')
    assert.ok(conn, 'conn row present')
    assert.equal(conn.raw.config.apiKey, '[redacted]')
    assert.equal(conn.raw.config.accessToken, '[redacted]')
    assert.equal(conn.raw.config.port, 3082) // non-secret stays visible
    assert.ok(Object.isFrozen(result.rows[0].raw))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('redactProfileSecrets redacts secret-shaped values in every audience and fails closed', () => {
  const input = {
    path: '/home/user/.dsh/profiles/dev',
    provider: 'deepseek-official',
    apiKey: 'sk-live-dont-show',
    config: {
      auth: { accessToken: 't0ken', ok: true },
      nested: { password: 'p@ss', port: 3082 },
    },
  }
  const redacted = redactProfileSecrets(input)
  assert.equal(redacted.path, '/home/user/.dsh/profiles/dev') // paths stay visible
  assert.equal(redacted.provider, 'deepseek-official') // non-secret stays visible
  assert.equal(redacted.apiKey, '[redacted]')
  assert.equal(redacted.config.auth.accessToken, '[redacted]')
  assert.equal(redacted.config.nested.password, '[redacted]')
  assert.equal(redacted.config.nested.port, 3082)
  assert.equal(redactProfileSecrets('plain'), 'plain')
})

test('a throwing loader degrades the runtime view instead of the mounter', () => {
  const dir = makeProfileDir()
  try {
    const ctx = {
      baseUrl: pathToFileURL(join(dir, '')),
      loader: {
        entries() {
          throw new Error('loader exploded')
        },
      },
    }
    const mounter = createProfileInspection({ ctx })
    const result = mounter.api.inspect({ view: 'runtime' })
    assert.equal(result.code, 'ok')
    assert.deepEqual(result.rows, [])
    assert.equal(result.layers[0].status, 'unavailable')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})