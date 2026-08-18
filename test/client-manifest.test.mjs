import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { defineManifest, isManifest } from '../lib/client-manifest.js'

test('defineManifest preserves the official web declaration and omits absent optional fields', () => {
  const manifest = defineManifest({ platform: 'web' })
  assert.deepEqual(manifest, { platform: 'web' })
  assert.ok(Object.isFrozen(manifest))
  assert.equal('inject' in manifest, false)
  assert.equal('immediately' in manifest, false)
})

test('defineManifest copies and freezes inject while preserving immediately', () => {
  const inject = ['core', 'settings']
  const manifest = defineManifest({ platform: 'web', inject, immediately: true })
  assert.deepEqual(manifest, { platform: 'web', inject: ['core', 'settings'], immediately: true })
  assert.ok(Object.isFrozen(manifest.inject))
  inject.push('later')
  assert.deepEqual(manifest.inject, ['core', 'settings'])
  assert.throws(() => { manifest.inject.push('blocked') }, TypeError)
})

test('defineManifest rejects malformed official fields before side effects', () => {
  assert.throws(() => defineManifest(null), /must be an object/)
  assert.throws(() => defineManifest({ platform: '' }), /platform.*non-empty string/)
  assert.throws(() => defineManifest({ platform: 'web', inject: 'bad' }), /inject.*string array/)
  assert.throws(() => defineManifest({ platform: 'web', inject: ['ok', 1] }), /inject.*string array/)
  assert.throws(() => defineManifest({ platform: 'web', immediately: 'yes' }), /immediately.*boolean/)
})

test('isManifest is a side-effect-free shape predicate and ignores unknown metadata', () => {
  assert.equal(isManifest({ platform: 'web', extra: 'ignored' }), true)
  assert.equal(isManifest({ platform: 'web', inject: ['a'], immediately: false }), true)
  assert.equal(isManifest({ platform: 'node' }), true)
  assert.equal(isManifest({ platform: 'web', inject: [1] }), false)
  assert.equal(isManifest({ platform: 'web', immediately: 1 }), false)
})

test('package metadata preserves the official client export boundary', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.exports['./client'], './lib/client.js')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.deepEqual(pkg.dsh.client.inject, [
    '@deepseek-ai/dsh-client-connection',
    '@deepseek-ai/dsh-client-runtime',
    '@deepseek-ai/dsh-api-remotes',
    '@deepseek-ai/dsh-client-ui-settings',
  ])
  assert.equal(pkg.dsh.client.immediately, true)
})
