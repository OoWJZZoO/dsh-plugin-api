import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('../', import.meta.url)

test('attachment patch disables exactly attachment-local and inserts one replacement row', () => {
  const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  assert.equal((patch.match(/id: attachment-local/g) ?? []).length, 1)
  assert.equal((patch.match(/id: plugin-api-attachments/g) ?? []).length, 1)
  assert.match(patch, /disabled: true/)
})

test('full patch contains one attachment-owned row after the existing replacements', () => {
  const patch = readFileSync(join(new URL('../../..', import.meta.url).pathname, 'packages/full/cordis.patch.yml'), 'utf8')
  assert.equal((patch.match(/id: attachment-local/g) ?? []).length, 1)
  assert.equal((patch.match(/id: plugin-api-attachments/g) ?? []).length, 1)
})
