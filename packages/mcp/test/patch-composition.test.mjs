import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { composeEntries } from '@deepseek-ai/dsh-app-boot'

const here = dirname(fileURLToPath(import.meta.url))
const patchFile = readFileSync(join(here, '..', 'cordis.patch.yml'), 'utf8')

const OFFICIAL_ROW = {
  id: 'mcp-client',
  name: '@deepseek-ai/dsh-mcp-client',
  config: {
    serverName: 'github',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
  },
}
const REPLACEMENT_ROW = {
  id: 'plugin-api-mcp',
  name: '@deepseek-ai/dsh-plugin-api-mcp',
  config: {},
}

const baseLayer = [{ insert: [OFFICIAL_ROW] }]
const auxLayer = [{ id: 'mcp-client', disabled: true }, { insert: [REPLACEMENT_ROW] }]

test('cordis.patch.yml declares the official disable + replacement insert', () => {
  assert.match(patchFile, /- id: mcp-client\s*\n\s+disabled: true/)
  assert.match(patchFile, /- insert:/)
  assert.match(patchFile, /- id: plugin-api-mcp/)
  assert.match(patchFile, /name: '@deepseek-ai\/dsh-plugin-api-mcp'/)
})

test('composeEntries disables the official row and inserts the replacement row (disable+insert)', () => {
  const entries = composeEntries([baseLayer, auxLayer])
  assert.equal(entries.length, 2)
  assert.equal(entries[0].id, 'mcp-client')
  assert.equal(entries[0].disabled, true)
  assert.equal(entries[0].name, '@deepseek-ai/dsh-mcp-client')
  assert.equal(entries[1].id, 'plugin-api-mcp')
  assert.equal(entries[1].name, '@deepseek-ai/dsh-plugin-api-mcp')
  assert.deepEqual(entries[1].config, {})
})

test('removing the aux bundle restores the official-enabled composition', () => {
  const entries = composeEntries([baseLayer])
  assert.equal(entries.length, 1)
  assert.equal(entries[0].id, 'mcp-client')
  assert.equal(entries[0].disabled, undefined)
})

test('absent official row: disable patch is skipped with a warning and insert still applies', () => {
  const warnings = []
  const entries = composeEntries([auxLayer], (message) => warnings.push(message))
  assert.equal(entries.length, 1)
  assert.equal(entries[0].id, 'plugin-api-mcp')
  assert.equal(entries[0].disabled, undefined)
  assert.ok(
    warnings.some((message) => message.includes('mcp-client') && message.includes('not found')),
    `expected a skip warning, got: ${JSON.stringify(warnings)}`,
  )
})
