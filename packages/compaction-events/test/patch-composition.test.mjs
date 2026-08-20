import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { composeEntries } from '@deepseek-ai/dsh-app-boot'

const here = dirname(fileURLToPath(import.meta.url))
const patchFile = readFileSync(join(here, '..', 'cordis.patch.yml'), 'utf8')

const OFFICIAL_ROW = {
  id: 'compaction-basic',
  name: '@deepseek-ai/dsh-compaction-basic',
  config: {},
}
const REPLACEMENT_ROW = {
  id: 'plugin-api-compaction-events',
  name: '@deepseek-ai/dsh-plugin-api-compaction-events',
  config: {},
}

const baseLayer = [{ insert: [OFFICIAL_ROW] }]
const auxLayer = [
  { id: 'compaction-basic', disabled: true },
  { insert: [REPLACEMENT_ROW] },
]

test('cordis.patch.yml declares the official disable + replacement insert', () => {
  assert.match(patchFile, /- id: compaction-basic\s*\n\s+disabled: true/)
  assert.match(patchFile, /- insert:/)
  assert.match(patchFile, /- id: plugin-api-compaction-events/)
  assert.match(patchFile, /name: '@deepseek-ai\/dsh-plugin-api-compaction-events'/)
})

test('composeEntries disables the official row and inserts the replacement row (disable+insert)', () => {
  const entries = composeEntries([baseLayer, auxLayer])
  assert.equal(entries.length, 2)
  assert.equal(entries[0].id, 'compaction-basic')
  assert.equal(entries[0].disabled, true)
  assert.equal(entries[0].name, '@deepseek-ai/dsh-compaction-basic')
  assert.equal(entries[1].id, 'plugin-api-compaction-events')
  assert.equal(entries[1].name, '@deepseek-ai/dsh-plugin-api-compaction-events')
  assert.deepEqual(entries[1].config, {})
})

test('removing the aux bundle restores the official-enabled composition', () => {
  const entries = composeEntries([baseLayer])
  assert.equal(entries.length, 1)
  assert.equal(entries[0].id, 'compaction-basic')
  assert.equal(entries[0].disabled, undefined)
})

test('absent official row: disable patch is skipped with a warning and insert still applies', () => {
  const warnings = []
  const entries = composeEntries([auxLayer], (message) => warnings.push(message))
  assert.equal(entries.length, 1)
  assert.equal(entries[0].id, 'plugin-api-compaction-events')
  assert.equal(entries[0].disabled, undefined)
  assert.ok(
    warnings.some((message) => message.includes('compaction-basic') && message.includes('not found')),
    `expected a not-found warning, got: ${JSON.stringify(warnings)}`,
  )
})
