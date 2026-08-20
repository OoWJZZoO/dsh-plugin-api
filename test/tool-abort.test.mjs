import test from 'node:test'
import assert from 'node:assert/strict'
import { createToolAbortedErrorFactory } from '../lib/tool-abort.js'

// Injectable stand-in for the official `HarnessError` (dsh-llm) — carries a
// stable `code` on the official contract.
class StubHarnessError extends Error {
  constructor(message, code) {
    super(message)
    this.code = code
    this.name = 'StubHarnessError'
  }
}

const TOOL_ABORTED = 'ABORTED'

// Canonical official composition, built with the same stub.
function canonicalComposition() {
  const e = new StubHarnessError('tool call aborted', TOOL_ABORTED)
  e.name = 'AbortError'
  return e
}

const identity = (e) => ({ name: e.name, code: e.code, message: e.message })

test('full mode returns an instance of the injected HarnessError class', () => {
  const make = createToolAbortedErrorFactory({ HarnessError: StubHarnessError, TOOL_ABORTED })
  const e = make()
  assert.ok(e instanceof Error)
  assert.ok(e instanceof StubHarnessError)
})

test('full mode carries the official name/code/message', () => {
  const make = createToolAbortedErrorFactory({ HarnessError: StubHarnessError, TOOL_ABORTED })
  const e = make()
  assert.equal(e.name, 'AbortError')
  assert.equal(e.code, TOOL_ABORTED)
  assert.equal(e.code, 'ABORTED')
  assert.equal(e.message, 'tool call aborted')
})

test('full mode {name, code, message} is deep-equal to the canonical official composition', () => {
  const make = createToolAbortedErrorFactory({ HarnessError: StubHarnessError, TOOL_ABORTED })
  assert.deepEqual(identity(make()), identity(canonicalComposition()))
})

test('full mode materializes error.info-equivalent {name, code} identical to the canonical abort outcome', () => {
  const make = createToolAbortedErrorFactory({ HarnessError: StubHarnessError, TOOL_ABORTED })
  const e = make()
  assert.deepEqual({ name: e.name, code: e.code }, { name: 'AbortError', code: 'ABORTED' })
})

test('each call returns a fresh, unfrozen, mutable instance', () => {
  const make = createToolAbortedErrorFactory({ HarnessError: StubHarnessError, TOOL_ABORTED })
  const a = make()
  const b = make()
  assert.notEqual(a, b)
  assert.equal(Object.isFrozen(a), false)
  a.detail = 'mutable'
  assert.equal(a.detail, 'mutable')
  assert.equal('detail' in b, false)
  // Mutating one result must not leak into a later call.
  a.message = 'changed'
  assert.equal(make().message, 'tool call aborted')
})

test('extra arguments are ignored and the identity is unchanged', () => {
  const make = createToolAbortedErrorFactory({ HarnessError: StubHarnessError, TOOL_ABORTED })
  assert.deepEqual(identity(make('anything', 123)), identity(canonicalComposition()))
})

test('the returned error is a usable throwable and the call itself never throws', () => {
  const make = createToolAbortedErrorFactory({ HarnessError: StubHarnessError, TOOL_ABORTED })
  let thrown
  assert.doesNotThrow(() => { thrown = make() })
  assert.throws(() => { throw thrown }, (err) => err === thrown)
})

test('degraded mode returns a plain Error named AbortError without code', () => {
  const make = createToolAbortedErrorFactory({})
  const e = make()
  assert.ok(e instanceof Error)
  assert.ok(!(e instanceof StubHarnessError))
  assert.equal(e.name, 'AbortError')
  assert.equal(e.code, undefined)
  assert.equal('code' in e, false)
  assert.equal(e.message, 'tool call aborted')
})

test('degraded mode triggers on each missing/malformed dependency branch', () => {
  const cases = [
    { HarnessError: StubHarnessError }, // TOOL_ABORTED missing
    { TOOL_ABORTED }, // HarnessError missing
    { HarnessError: 'not-a-function', TOOL_ABORTED }, // HarnessError not a function
    { HarnessError: StubHarnessError, TOOL_ABORTED: 123 }, // TOOL_ABORTED not a string
    undefined, // no deps at all
  ]
  for (const deps of cases) {
    const e = createToolAbortedErrorFactory(deps)()
    assert.ok(e instanceof Error, `expected Error for deps=${JSON.stringify(deps)}`)
    assert.equal(e.name, 'AbortError')
    assert.equal(e.message, 'tool call aborted')
    assert.equal('code' in e, false)
  }
})

test('each factory mode stays stable across calls within the host lifetime', () => {
  const full = createToolAbortedErrorFactory({ HarnessError: StubHarnessError, TOOL_ABORTED })
  const degraded = createToolAbortedErrorFactory({ HarnessError: StubHarnessError })
  for (let i = 0; i < 3; i += 1) {
    assert.ok(full() instanceof StubHarnessError)
    assert.equal(full().code, 'ABORTED')
    assert.ok(!(degraded() instanceof StubHarnessError))
    assert.equal('code' in degraded(), false)
  }
})
