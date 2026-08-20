import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as invariant from '../lib/invariant.js'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'))

function allSourceText() {
  const libDir = join(here, '..', 'lib')
  return readdirSync(libDir)
    .filter((file) => file.endsWith('.js'))
    .map((file) => readFileSync(join(libDir, file), 'utf8'))
    .join('\n')
}

test('the invariant companion exports the expected { apply, inject, name } shape', () => {
  assert.equal(typeof invariant.apply, 'function')
  assert.deepEqual(invariant.inject, ['invariants'])
  assert.equal(typeof invariant.name, 'string')
  assert.equal(invariant.name, 'session-title-invariant')
})

test('the package declares a resolvable ./invariant export', () => {
  assert.equal(pkg.exports['./invariant'], './lib/invariant.js')
})

test('the companion is a no-op (this replacement bundle introduces no new durable event type)', async () => {
  let registered = null
  const ctx = {
    invariants: {
      register(packageName, install) {
        registered = { packageName, install }
        return { disposed: false }
      },
    },
  }
  await invariant.apply(ctx)
  assert.ok(registered, 'the companion must reserve package ownership')
  assert.equal(registered.packageName, '@deepseek-ai/dsh-plugin-api-session-title')
  assert.equal(typeof registered.install, 'function')
  // The install body must not throw and must not append anything.
  assert.doesNotThrow(() => registered.install())
})

test('the auxiliary package reads main facade metadata but never imports or injects it', () => {
  const source = allSourceText()
  assert.ok(
    !source.includes("from '@deepseek-ai/dsh-plugin-api-main'") &&
    !source.includes("inject = ['pluginApi']"),
    'aux package sources must not import or inject the main facade package',
  )
  assert.ok(
    source.includes("MAIN_PACKAGE_NAME = '@deepseek-ai/dsh-plugin-api-main'") &&
    source.includes('require(`${packageName}/package.json`)'),
    'the version-consistency check must read the main package manifest',
  )
})
