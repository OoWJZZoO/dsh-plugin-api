/**
 * Patch composition gate: the bundle patch only disables the official
 * `api-remotes` row and inserts exactly one replacement row, and composes to
 * the intended disable+insert outcome through the official app-boot loader
 * helper.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { composeEntries } from '@deepseek-ai/dsh-app-boot'

const here = dirname(fileURLToPath(import.meta.url))
const patchFile = readFileSync(join(here, '..', 'cordis.patch.yml'), 'utf8')

const OFFICIAL_ROW = { id: 'api-remotes', name: '@deepseek-ai/dsh-api-remotes' }
const REPLACEMENT_ROW = {
  id: 'plugin-api-api-remotes',
  name: '@deepseek-ai/dsh-plugin-api-api-remotes',
  inject: ['loader'],
}

test('cordis.patch.yml declares the official disable + replacement insert only', () => {
  assert.match(patchFile, /- id: api-remotes\s*\n\s+disabled: true/)
  assert.match(patchFile, /- insert:/)
  assert.match(patchFile, /- id: plugin-api-api-remotes/)
  assert.match(patchFile, /name: '@deepseek-ai\/dsh-plugin-api-api-remotes'/)
  assert.match(patchFile, /inject: \[loader\]/)
  // exactly one disabled block and one insert block
  assert.equal(patchFile.match(/- insert:/g).length, 1)
  assert.equal(patchFile.match(/disabled: true/g).length, 1)
})

test('composeEntries disables the official row and inserts the replacement row', () => {
  const baseLayer = [{ insert: [OFFICIAL_ROW] }]
  const auxLayer = [
    { id: 'api-remotes', disabled: true },
    { insert: [REPLACEMENT_ROW] },
  ]
  const entries = composeEntries([baseLayer, auxLayer])
  const byId = new Map(entries.map((entry) => [entry.id ?? entry.options?.id, entry]))
  const official = byId.get('api-remotes')
  const replacement = byId.get('plugin-api-api-remotes')
  assert.ok(official, 'official row must be present')
  assert.equal(official.disabled, true)
  assert.ok(replacement, 'replacement row must be present')
  const replacementOptions = replacement.options ?? replacement
  assert.equal(replacementOptions.name ?? replacement.name, '@deepseek-ai/dsh-plugin-api-api-remotes')
  assert.deepEqual(replacementOptions.inject ?? replacement.inject, ['loader'])
})