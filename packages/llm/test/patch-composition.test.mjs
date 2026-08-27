import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { composeEntries } from '@deepseek-ai/dsh-app-boot'

const here = dirname(fileURLToPath(import.meta.url))
const patchFile = readFileSync(join(here, '..', 'cordis.patch.yml'), 'utf8')

const OFFICIAL_ROW = {
  id: 'llm',
  name: '@deepseek-ai/dsh-llm',
  config: {},
}
const REPLACEMENT_ROW = {
  id: 'plugin-api-llm',
  name: '@deepseek-ai/dsh-plugin-api-llm',
}

const baseLayer = [{ insert: [OFFICIAL_ROW] }]
const auxLayer = [{ id: 'llm', disabled: true }, { insert: [REPLACEMENT_ROW] }]

test('cordis.patch.yml declares exactly one disabled official row and one replacement insert', () => {
  const officialDisables = [...patchFile.matchAll(/^\s*- id: llm\s*\n\s+disabled: true/gm)]
  assert.equal(officialDisables.length, 1)
  assert.match(patchFile, /^\s*- insert:/m)
  assert.match(patchFile, /- id: plugin-api-llm/)
  assert.match(patchFile, /name: '@deepseek-ai\/dsh-plugin-api-llm'/)
})

test('cordis.patch.yml does not reference any installed official path', () => {
  assert.ok(!patchFile.includes('/usr/lib/node_modules'))
  assert.ok(!patchFile.includes('node_modules'))
})

test('cordis.patch.yml comment header is semantically neutral (no classification tokens)', () => {
  // The header must describe the replacement boundary in neutral terms and
  // must not leak governance classification letters or ids into the patch.
  assert.match(patchFile, /Replacement boundary/i)
  // Built by concatenation so this audit source itself carries no literal token.
  const tokens = ['A' + '-class', 'R' + '-class', 'U' + '20', 'SPEC' + '1', 'SPEC' + '2', 'SPEC' + '3']
  for (const token of tokens) {
    assert.ok(!patchFile.includes(token), `patch must not contain governance token "${token}"`)
  }
})

test('composeEntries disables the official row and inserts the replacement row (disable+insert)', () => {
  const entries = composeEntries([baseLayer, auxLayer])
  assert.equal(entries.length, 2)
  assert.equal(entries[0].id, 'llm')
  assert.equal(entries[0].disabled, true)
  assert.equal(entries[0].name, '@deepseek-ai/dsh-llm')
  assert.equal(entries[1].id, 'plugin-api-llm')
  assert.equal(entries[1].name, '@deepseek-ai/dsh-plugin-api-llm')
})

test('removing the aux bundle restores the official-enabled composition', () => {
  const entries = composeEntries([baseLayer])
  assert.equal(entries.length, 1)
  assert.equal(entries[0].id, 'llm')
  assert.equal(entries[0].disabled, undefined)
  assert.equal(entries[0].name, '@deepseek-ai/dsh-llm')
})

test('absent official row: disable patch is skipped with a warning and insert still applies', () => {
  const warnings = []
  const entries = composeEntries([auxLayer], (message) => warnings.push(message))
  assert.equal(entries.length, 1)
  assert.equal(entries[0].id, 'plugin-api-llm')
  assert.ok(
    warnings.some((message) => message.includes('llm') && message.includes('not found')),
    `expected a not-found warning, got: ${JSON.stringify(warnings)}`,
  )
})
