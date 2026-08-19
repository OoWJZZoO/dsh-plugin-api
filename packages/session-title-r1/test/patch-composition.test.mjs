import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { composeEntries } from '@deepseek-ai/dsh-app-boot'

const here = dirname(fileURLToPath(import.meta.url))
const patchFile = readFileSync(join(here, '..', 'cordis.patch.yml'), 'utf8')

const OFFICIAL_ROW = {
  id: 'session-title',
  name: '@deepseek-ai/dsh-session-title',
  config: { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 },
}
const REPLACEMENT_ROW = {
  id: 'session-title-r1',
  name: '@deepseek-ai/dsh-plugin-api-session-title',
  config: { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 },
}

const baseLayer = [{ insert: [OFFICIAL_ROW] }]
const auxLayer = [
  { id: 'session-title', disabled: true },
  { insert: [REPLACEMENT_ROW] },
]

test('cordis.patch.yml declares the official disable + replacement insert (design C2)', () => {
  assert.match(patchFile, /- id: session-title\s*\n\s+disabled: true/)
  assert.match(patchFile, /- insert:/)
  assert.match(patchFile, /- id: session-title-r1/)
  assert.match(patchFile, /name: '@deepseek-ai\/dsh-plugin-api-session-title'/)
  assert.match(patchFile, /fallbackMaxWords: 5/)
  assert.match(patchFile, /fallbackMaxBytes: 40/)
  assert.match(patchFile, /maxTitleBytes: 80/)
})

test('composeEntries disables the official row and inserts the replacement row (disable+insert)', () => {
  const entries = composeEntries([baseLayer, auxLayer])
  assert.equal(entries.length, 2)
  assert.equal(entries[0].id, 'session-title')
  assert.equal(entries[0].disabled, true)
  assert.equal(entries[0].name, '@deepseek-ai/dsh-session-title')
  assert.equal(entries[1].id, 'session-title-r1')
  assert.equal(entries[1].name, '@deepseek-ai/dsh-plugin-api-session-title')
  assert.deepEqual(entries[1].config, { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 })
})

test('removing the aux bundle restores the official-enabled composition', () => {
  const entries = composeEntries([baseLayer])
  assert.equal(entries.length, 1)
  assert.equal(entries[0].id, 'session-title')
  assert.equal(entries[0].disabled, undefined)
  assert.equal(entries[0].config.fallbackMaxWords, 5)
})

test('absent official row: disable patch is skipped with a warning and insert still applies', () => {
  const warnings = []
  const entries = composeEntries([auxLayer], (message) => warnings.push(message))
  assert.equal(entries.length, 1)
  assert.equal(entries[0].id, 'session-title-r1')
  assert.equal(entries[0].disabled, undefined)
  assert.deepEqual(entries[0].config, { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 })
  assert.ok(
    warnings.some((message) => message.includes('session-title') && message.includes('not found')),
    `expected a not-found warning, got: ${JSON.stringify(warnings)}`,
  )
})

test('a later layer writing only config does not reset disabled (config-continuity premise, design C3)', () => {
  const laterLayer = [
    { id: 'session-title', config: { fallbackMaxWords: 9, fallbackMaxBytes: 30, maxTitleBytes: 90 } },
  ]
  const entries = composeEntries([baseLayer, auxLayer, laterLayer])
  const official = entries.find((entry) => entry.id === 'session-title')
  assert.ok(official, 'the official row must still be present')
  assert.equal(official.disabled, true, 'a config-only layer must not reset disabled')
  assert.deepEqual(official.config, { fallbackMaxWords: 9, fallbackMaxBytes: 30, maxTitleBytes: 90 })
})
