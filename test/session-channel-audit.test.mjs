import test from 'node:test'
import assert from 'node:assert/strict'
import { createAuditLog } from '../lib/session-channel-audit.js'

test('audit: append records who/what/when/generation', () => {
  const log = createAuditLog()
  log.append({ who: 'dev1', what: 'open', generation: 'g1' })
  const entries = log.entries()
  assert.equal(entries.length, 1)
  assert.equal(entries[0].who, 'dev1')
  assert.equal(entries[0].what, 'open')
  assert.equal(entries[0].generation, 'g1')
  assert.equal(typeof entries[0].when, 'number')
})

test('audit: raw tokens and session content never enter the log', () => {
  const log = createAuditLog()
  log.append({ who: 'dev1', what: 'open', token: 'raw-token', sessionContent: 'secret', generation: 'g1' })
  const entry = log.entries()[0]
  assert.equal(entry.token, undefined)
  assert.equal(entry.sessionContent, undefined)
})

test('audit: log is bounded', () => {
  const log = createAuditLog(5)
  for (let i = 0; i < 10; i++) {
    log.append({ who: 'dev1', what: `op${i}`, generation: `g${i}` })
  }
  assert.equal(log.entries().length, 5)
})

test('audit: snapshot returns bounded recent entries', () => {
  const log = createAuditLog()
  for (let i = 0; i < 10; i++) {
    log.append({ who: 'dev1', what: `op${i}`, generation: `g${i}` })
  }
  const snap = log.snapshot(3)
  assert.equal(snap.length, 3)
})

test('audit: clear empties the log', () => {
  const log = createAuditLog()
  log.append({ who: 'dev1', what: 'open', generation: 'g1' })
  log.clear()
  assert.equal(log.entries().length, 0)
})