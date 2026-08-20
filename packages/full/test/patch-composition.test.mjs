import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { composeEntries } from '@deepseek-ai/dsh-app-boot'

const here = dirname(fileURLToPath(import.meta.url))
const patchFile = readFileSync(join(here, '..', 'cordis.patch.yml'), 'utf8')
const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'))

const MAIN_ROW = { id: 'plugin-api-main', name: '@deepseek-ai/dsh-plugin-api-main', config: {} }
const COMPACTION_OFFICIAL = { id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic', config: {} }
const COMPACTION_REPLACEMENT = { id: 'plugin-api-compaction-events', name: '@deepseek-ai/dsh-plugin-api-compaction-events', config: {} }
const TITLE_OFFICIAL = {
  id: 'session-title',
  name: '@deepseek-ai/dsh-session-title',
  config: { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 },
}
const TITLE_REPLACEMENT = {
  id: 'plugin-api-session-title',
  name: '@deepseek-ai/dsh-plugin-api-session-title',
  config: { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 },
}

const officialBaseLayer = [
  { insert: [COMPACTION_OFFICIAL, TITLE_OFFICIAL] },
]

const fullLayer = [
  { insert: [MAIN_ROW] },
  { id: 'compaction-basic', disabled: true },
  { insert: [COMPACTION_REPLACEMENT] },
  { id: 'session-title', disabled: true },
  { insert: [TITLE_REPLACEMENT] },
]

test('the full package follows the unified full-version and dsh.api policy', () => {
  assert.equal(pkg.name, '@deepseek-ai/dsh-plugin-api-full')
  assert.equal(pkg.version, '0.1.0-rc.6-0.5')
  assert.equal(pkg.dsh.api, '0.5')
  assert.match(pkg.version, /^(.+)-(\d+\.\d+)$/)
  assert.equal(pkg.version.match(/^(.+)-(\d+\.\d+)$/)[2], pkg.dsh.api)
})

test('the full package depends on the main facade and every auxiliary package at workspace-consistent versions', () => {
  assert.deepEqual(pkg.dependencies, {
    '@deepseek-ai/dsh-plugin-api-main': 'workspace:*',
    '@deepseek-ai/dsh-plugin-api-compaction-events': 'workspace:*',
    '@deepseek-ai/dsh-plugin-api-session-title': 'workspace:*',
  })
})

test('the full patch assembles main and all replacement rows in deterministic order', () => {
  const entries = composeEntries([fullLayer])
  assert.deepEqual(entries, [MAIN_ROW, COMPACTION_REPLACEMENT, TITLE_REPLACEMENT])
})

test('composing over an official base disables both official rows and appends the deterministic assembly', () => {
  const entries = composeEntries([officialBaseLayer, fullLayer])
  assert.deepEqual(entries, [
    { ...COMPACTION_OFFICIAL, disabled: true },
    { ...TITLE_OFFICIAL, disabled: true },
    MAIN_ROW,
    COMPACTION_REPLACEMENT,
    TITLE_REPLACEMENT,
  ])
})

test('the full patch text keeps the deterministic order and adds no extra row', () => {
  const mainIndex = patchFile.indexOf("name: '@deepseek-ai/dsh-plugin-api-main'")
  const compactionIndex = patchFile.indexOf("id: plugin-api-compaction-events")
  const titleIndex = patchFile.indexOf("id: plugin-api-session-title")
  assert.ok(mainIndex >= 0 && compactionIndex > mainIndex && titleIndex > compactionIndex, 'rows must appear main → compaction → session-title')
  assert.equal((patchFile.match(/- insert:/g) ?? []).length, 3, 'exactly main + two replacement inserts')
  assert.equal((patchFile.match(/disabled: true/g) ?? []).length, 2, 'exactly two official rows disabled')
})
