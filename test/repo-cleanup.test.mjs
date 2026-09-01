import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(import.meta.url), '..', '..')

// Exact tracked paths removed by the repository cleanup. The names carry a
// literal `undefined\` prefix (a historical external test product from the
// pre-refactor cost-meter harness), so both the tracked index and the working
// tree are scanned.
const REMOVED_PATHS = [
  'undefined\\dsh-cost-meter-test-home/storages/cost-meter/ledger.json',
  'undefined\\dsh-cost-meter-test-legacy-home/storages/cost-meter/ledger.json',
  'undefined\\dsh-cost-meter-test-mig-home/storages/cost-meter/ledger.json',
]

function trackedPaths() {
  const output = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
  return output.split('\n').filter(Boolean)
}

function leafDirectories() {
  const entries = readdirSync(root, { withFileTypes: true })
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
}

test('the three cost-meter ledger paths stay removed from index and worktree', () => {
  const tracked = new Set(trackedPaths())
  for (const path of REMOVED_PATHS) {
    assert.equal(tracked.has(path), false, `${path} must stay untracked`)
    assert.equal(existsSync(join(root, ...path.split('/'))), false, `${path} must not exist in the working tree`)
  }
})

test('no root-level cost-meter test home pattern recurs', () => {
  const pattern = /^undefined\\dsh-cost-meter-test-/
  const leftovers = leafDirectories().filter((name) => pattern.test(name))
  assert.deepEqual(leftovers, [], 'no root-level cost-meter test home directory may recur')
})