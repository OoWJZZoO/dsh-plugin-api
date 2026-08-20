import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as official from '@deepseek-ai/dsh-session-title'
import * as fork from '../lib/forked-service.js'
import { isNonEmptyTitleText } from '../lib/event-contract.js'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

function sha256Text(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

// Delivery audit: the official DSH
// package files that this replacement bundle forks must never be modified by this
// repository or its deployment. Hardcoded checksums pin the official
// `@deepseek-ai/dsh-session-title@0.1.0-rc.6` checkout; if an official upgrade
// changes them, this guard fails BEFORE any forked-contract drift is observed.
test('official dsh-session-title files are byte-frozen (checksum audit)', () => {
  const packagePath = require.resolve('@deepseek-ai/dsh-session-title/package.json')
  const dir = dirname(packagePath)
  const index = readFileSync(join(dir, 'lib', 'index.js'), 'utf8')
  const invariant = readFileSync(join(dir, 'lib', 'invariant.js'), 'utf8')

  assert.equal(
    sha256Text(index),
    'c1d1dd2debcd11b116fe55d854af9cf5ae99bff44e8364eaa6f1a4c254d5d881',
    'official dsh-session-title lib/index.js must remain unmodified',
  )
  assert.equal(
    sha256Text(invariant),
    'a332486d5032c4e10e6e5a20f8feee6daf3add8bf061e8789e1bacaa528503d2',
    'official dsh-session-title lib/invariant.js must remain unmodified',
  )
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8'))
  assert.equal(pkg.version, '0.1.0-rc.6')
})

test('fork preserves the official public export set plus the contract symbol', () => {
  const officialNames = Object.keys(official).sort()
  const forkNames = Object.keys(fork).sort()
  assert.equal(
    forkNames.length,
    officialNames.length + 1,
    `fork must add exactly SESSION_TITLE_ACTIVE_SYMBOL, got ${JSON.stringify(forkNames)}`,
  )
  for (const name of officialNames) {
    assert.ok(name in fork, `fork must export the official symbol "${name}"`)
  }
  assert.equal(fork.SESSION_TITLE_ACTIVE_SYMBOL, Symbol.for('dsh-plugin-api.session-title.contract'))
  // The fork keeps the official public face identical; the only additional
  // symbol is the replacement contract marker.
  assert.equal(fork.SessionTitleService, fork.default)
})

test('fork preserves static inject, Config key set, and public method arities', () => {
  assert.deepEqual(fork.SessionTitleService.inject, official.SessionTitleService.inject)
  const officialKeys = Object.keys(official.SessionTitleService.Config.dict).sort()
  const forkKeys = Object.keys(fork.SessionTitleService.Config.dict).sort()
  assert.deepEqual(forkKeys, officialKeys, 'static Config key set must match the official schema')
  for (const method of ['get', 'rename', 'refresh', 'register']) {
    assert.equal(
      fork.SessionTitleService.prototype[method].length,
      official.SessionTitleService.prototype[method].length,
      `${method}() arity must match the official contract`,
    )
  }
})

// Requirements 3.5 is conditional: "WHERE the official row dispatches Cordis
// events ... IF the replacement is active THEN the replacement SHALL dispatch
// the same events ...". The official `dsh-session-title` service only listens
// (ctx.on session/event + llm/stream); it dispatches NO events of its own. The
// fork therefore must also dispatch none of its own (its only new dispatch is
// the replacement `session-title/candidate` policy waterfall, which is the approved
// extension, not a replica of an official event face).
test('the official service dispatches no events of its own', () => {
  const packagePath = require.resolve('@deepseek-ai/dsh-session-title/package.json')
  const dir = dirname(packagePath)
  const source = readFileSync(join(dir, 'lib', 'index.js'), 'utf8')
  const dispatchPattern = /(?:this\.)?ctx\.(?:emit|serial|parallel|bail|waterfall)\(/g
  const matches = source.match(dispatchPattern) ?? []
  assert.deepEqual(matches, [], 'official service must not dispatch any event for its own face')
})

// The pure `isNonEmptyTitleText` predicate (event-contract) must agree with the
// official "normalizeSessionTitle(...).length === 0 → not a candidate" check for
// the full control-character class; this guards against drift between the
// vendored regex constants and the official normalize module.
test('isNonEmptyTitleText agrees with the official normalizeSessionTitle emptiness check', () => {
  const samples = [
    '',
    '   ',
    'hello world',
    'hello\u001b[31mred\u001b[0m',
    '\u001b]0;window title\u0007prompt',
    '\u200b\u200b',
    '\u0000',
    '\u0007\u0008',
    '\u001b[1;2;3mA',
    'a\u200bb',
    '\t\n  x  ',
    '中文标题',
    '|||',
  ]
  for (const sample of samples) {
    const officialEmpty = official.normalizeSessionTitle(sample, Number.MAX_SAFE_INTEGER).length === 0
    assert.equal(isNonEmptyTitleText(sample), !officialEmpty, `sample ${JSON.stringify(sample)} must agree with official`)
  }
})
