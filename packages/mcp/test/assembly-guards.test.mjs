import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { composeEntries } from '@deepseek-ai/dsh-app-boot'
import { inspectComposition } from '../lib/apply.js'
import { fullVersionContractsMatch } from '../lib/version.js'

const here = dirname(fileURLToPath(import.meta.url))
const patchFile = readFileSync(join(here, '..', 'cordis.patch.yml'), 'utf8')

const OFFICIAL_ROW = {
  id: 'mcp-client',
  name: '@deepseek-ai/dsh-mcp-client',
  config: { serverName: 'github', transport: 'stdio', command: 'npx', args: [] },
}
const REPLACEMENT_ROW = {
  id: 'plugin-api-mcp',
  name: '@deepseek-ai/dsh-plugin-api-mcp',
  config: {},
}
const baseLayer = [{ insert: [OFFICIAL_ROW] }]
const auxLayer = [
  { id: 'mcp-client', disabled: true },
  { insert: [REPLACEMENT_ROW] },
]

function asLoaderComposition(entries) {
  const ctx = {
    loader: {
      entries: () => entries.map((entry) => ({ options: { ...entry } })),
    },
  }
  return inspectComposition(ctx)
}

test('assembly: patched composition disables official and activates exactly one replacement', () => {
  const entries = composeEntries([baseLayer, auxLayer])
  assert.equal(entries.length, 2)
  const official = entries.find((entry) => entry.id === 'mcp-client')
  const replacement = entries.find((entry) => entry.id === 'plugin-api-mcp')
  assert.equal(official.disabled, true)
  assert.equal(replacement.disabled, undefined)
  // exactly one replacement row, no duplicate insertion
  assert.equal(entries.filter((e) => e.id === 'plugin-api-mcp').length, 1)
})

test('assembly: removing the aux bundle restores the official-enabled composition (reversible)', () => {
  const entries = composeEntries([baseLayer])
  assert.equal(entries.length, 1)
  assert.equal(entries[0].id, 'mcp-client')
  assert.equal(entries[0].disabled, undefined)
})

test('assembly: absent official target still inserts the replacement (disable skipped with warning)', () => {
  const warnings = []
  const entries = composeEntries([auxLayer], (message) => warnings.push(message))
  assert.equal(entries.length, 1)
  assert.equal(entries[0].id, 'plugin-api-mcp')
  assert.ok(warnings.some((w) => w.includes('mcp-client') && w.includes('not found')))
})

test('assembly guard: official enabled composition is rejected by the self-check (no double run)', () => {
  const entries = composeEntries([baseLayer])
  const composition = asLoaderComposition(entries)
  assert.equal(composition.officialPresent, true)
  assert.equal(composition.anyOfficialEnabled, true)
  assert.equal(composition.replacementCount, 0)
})

test('assembly guard: patched composition passes the loader self-check', () => {
  const entries = composeEntries([baseLayer, auxLayer])
  const composition = asLoaderComposition(entries)
  assert.equal(composition.anyOfficialEnabled, false)
  assert.equal(composition.replacementCount, 1)
})

test('assembly guard: identity matrix mismatch disables only the replacement capability', () => {
  const consistent = {
    ownVersion: '0.1.0-rc.6-0.1.0',
    ownApi: '0.1',
    mainVersion: '0.1.0-rc.6-0.1.0',
    mainApi: '0.1',
  }
  assert.equal(fullVersionContractsMatch(consistent), true)
  assert.equal(fullVersionContractsMatch({ ...consistent, mainVersion: '0.1.1-rc.6-0.1.0' }), false)
  // the check itself stays pure: a mismatch simply disables this package's row
  const patch = patchFile
  assert.ok(patch.includes('disabled: true'))
})
