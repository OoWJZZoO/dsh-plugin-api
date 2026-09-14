/**
 * The convergence verifier is part of the delivery gate: the three tables must
 * stay connected to the canonical registry, so the check runs inside the suite
 * rather than only as a manual script.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const script = resolve(import.meta.dirname, '../scripts/convergence-verify.mjs')
const registryPath = resolve(import.meta.dirname, '../docs/specs/plugin-api-m7-public-contract-refactor/public-contract.registry.json')

test('the convergence tables stay connected to the canonical registry', () => {
  const output = execFileSync(process.execPath, [script], { encoding: 'utf8' })
  assert.match(output, /^convergence valid: \d+ member rows, \d+ behavior rows, \d+ fully linked behavior rows/)
})

test('a mapping row whose target no longer ships fails the verifier', () => {
  const registry = JSON.parse(readFileSync(registryPath, 'utf8'))
  const row = registry.oldToTargetMapping.find((entry) => entry.targetPath === 'codec.validate')
  assert.ok(row, 'the frozen mapping inventory still carries the renamed validation leaf')
  row.targetPath = 'codec.validateRenamedAway'
  const dir = mkdtempSync(join(tmpdir(), 'convergence-verify-'))
  const mutated = join(dir, 'registry.json')
  writeFileSync(mutated, JSON.stringify(registry))
  try {
    assert.throws(
      () => execFileSync(process.execPath, [script, mutated], { encoding: 'utf8', stdio: 'pipe' }),
      /convergence verification failed/,
      'an unresolvable mapping target is a verification failure, not a warning',
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
