import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as official from '@deepseek-ai/dsh-mcp-client'
import { MAX_PUBLIC_NAME_LENGTH, HASH_LENGTH, INVALID_NAME_CHARS } from '../lib/tools.js'
import { RECONNECT_DEFAULTS, GENERATION_CLOSE_TIMEOUT_MS } from '../lib/connection.js'

const officialIndexPath = fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-mcp-client'))
const officialPkgPath = fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-mcp-client/package.json'))
const here = dirname(fileURLToPath(import.meta.url))

test('official dsh-mcp-client identity is the locked 0.1.0-rc.6 package', () => {
  const pkg = JSON.parse(readFileSync(officialPkgPath, 'utf8'))
  assert.equal(pkg.name, '@deepseek-ai/dsh-mcp-client')
  assert.equal(pkg.version, '0.1.0-rc.6')
})

test('official plugin surface stays the namespace plugin we replicate', () => {
  assert.equal(official.name, 'mcp-client')
  assert.ok(official.inject.includes('tools'))
})

test('official source still carries the naming contract constants', () => {
  const src = readFileSync(officialIndexPath, 'utf8')
  assert.match(src, /MAX_PUBLIC_NAME_LENGTH = 64/)
  assert.match(src, /const INVALID_NAME_CHARS = \/\[\^A-Za-z0-9_-\]\/g/)
  assert.match(src, /const HASH_LENGTH = 12/)
})

test('official source still carries the connection contracts', () => {
  const src = readFileSync(officialIndexPath, 'utf8')
  assert.match(src, /const SERVER_NAME_PATTERN = \/\^\[A-Za-z0-9_-\]\{1,32\}\$/)
  assert.match(src, /const DEFAULT_TOOL_CALL_TIMEOUT_MS = 6e4/)
  assert.match(src, /const GENERATION_CLOSE_TIMEOUT_MS = 5e3/)
  assert.match(src, /initialDelayMs: 500,/)
  assert.match(src, /maxDelayMs: 3e4,/)
  assert.match(src, /maxAttempts: 10/)
})

test('fork constants agree with the locked official contract', () => {
  assert.equal(MAX_PUBLIC_NAME_LENGTH, 64)
  assert.equal(HASH_LENGTH, 12)
  assert.deepEqual(RECONNECT_DEFAULTS, {
    enabled: true,
    initialDelayMs: 500,
    maxDelayMs: 30000,
    maxAttempts: 10,
  })
  assert.equal(GENERATION_CLOSE_TIMEOUT_MS, 5000)
  assert.equal(String(INVALID_NAME_CHARS), '/[^A-Za-z0-9_-]/g')
})

test('fork imposes no governance tokens in its runtime identifiers', () => {
  // The replacement row/plugin identifiers are capability-named and carry no
  // governance suffixes.
  const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'))
  assert.equal(pkg.name, '@deepseek-ai/dsh-plugin-api-mcp')
  assert.ok(!/r\d/i.test(pkg.name))
})
