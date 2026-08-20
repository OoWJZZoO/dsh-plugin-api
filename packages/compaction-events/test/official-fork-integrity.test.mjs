import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'

const require = createRequire(import.meta.url)

function sha256Text(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

// Delivery audit: the official DSH package files that
// this replacement bundle forks must never be modified by this repository or its
// deployment. Hardcoded checksums pin the official `@deepseek-ai/dsh-compaction-basic@0.1.0-rc.6`
// checkout; if an official upgrade changes them, this guard fails BEFORE any
// forked-contract drift can be observed.
test('official dsh-compaction-basic files are byte-frozen (checksum audit)', () => {
  const packagePath = require.resolve('@deepseek-ai/dsh-compaction-basic/package.json')
  const dir = dirname(packagePath)
  const index = readFileSync(join(dir, 'lib', 'index.js'), 'utf8')
  const invariant = readFileSync(join(dir, 'lib', 'invariant.js'), 'utf8')

  assert.equal(
    sha256Text(index),
    '144202a0f150b9b7984842d6316808aefcbdf14e7a890805cb0819f4cc69740f',
    'official dsh-compaction-basic lib/index.js must remain unmodified',
  )
  assert.equal(
    sha256Text(invariant),
    'af48e4ac91598157b75e82a10f34094cbfb5844a198316ea477366769a259318',
    'official dsh-compaction-basic lib/invariant.js must remain unmodified',
  )
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8'))
  assert.equal(pkg.version, '0.1.0-rc.6')
})
