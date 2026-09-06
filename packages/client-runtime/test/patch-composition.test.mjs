/**
 * Patch composition gate: the bundle patch only disables the official
 * `client-runtime` row and inserts exactly one replacement row.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { composeEntries } from '@deepseek-ai/dsh-app-boot'

const here = dirname(fileURLToPath(import.meta.url))
const patchFile = readFileSync(join(here, '..', 'cordis.patch.yml'), 'utf8')

const OFFICIAL_ROW = { id: 'client-runtime', name: '@deepseek-ai/dsh-client-runtime' }
const REPLACEMENT_ROW = {
  id: 'plugin-api-client-runtime',
  name: '@deepseek-ai/dsh-plugin-api-client-runtime',
  inject: ['loader'],
}

test('cordis.patch.yml declares the official disable + replacement insert only', () => {
  assert.match(patchFile, /- id: client-runtime\s*\n\s+disabled: true/)
  assert.match(patchFile, /- insert:/)
  assert.match(patchFile, /- id: plugin-api-client-runtime/)
  assert.match(patchFile, /name: '@deepseek-ai\/dsh-plugin-api-client-runtime'/)
  assert.equal(patchFile.match(/- insert:/g).length, 1)
  assert.equal(patchFile.match(/disabled: true/g).length, 1)
})

test('composeEntries disables the official row and inserts the replacement row', () => {
  const entries = composeEntries([
    [{ insert: [OFFICIAL_ROW] }],
    [{ id: 'client-runtime', disabled: true }, { insert: [REPLACEMENT_ROW] }],
  ])
  const byId = new Map(entries.map((entry) => [entry.id ?? entry.options?.id, entry]))
  assert.equal(byId.get('client-runtime').disabled, true)
  const replacement = byId.get('plugin-api-client-runtime')
  assert.ok(replacement)
  const options = replacement.options ?? replacement
  assert.equal(options.name ?? replacement.name, '@deepseek-ai/dsh-plugin-api-client-runtime')
  assert.deepEqual(options.inject ?? replacement.inject, ['loader'])
})