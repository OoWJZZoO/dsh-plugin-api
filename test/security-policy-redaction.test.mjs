import test from 'node:test'
import assert from 'node:assert/strict'
import { applyRedaction, isSecretShapedString, isSecretShapedKey } from '../lib/security-redaction.js'

const allowed = () => 'allow'
const denied = () => 'deny'

test('no applicable rule returns the tree unchanged with empty counts', () => {
  const root = { text: 'password= sensitive-value', nested: [1, 2, 3] }
  const out = applyRedaction({ root, audiences: ['model'], rules: [] })
  assert.equal(out.content, root)
  assert.deepEqual(out.applied, [])
  assert.deepEqual(out.blocked, [])
  assert.deepEqual(out.markers, { binary: 0, unreadable: 0 })
})

test('audience gating: a rule only applies to its declared audiences', () => {
  const rule = { id: 'ui-redact', audiences: ['ui'], match: (v) => v.includes('token=abc'), action: 'redact' }
  const out = applyRedaction({ root: 'token=abc123456789', audiences: ['model'], rules: [rule] })
  assert.equal(out.content, 'token=abc123456789', 'model channel untouched')
  assert.deepEqual(out.applied, [])
  const ui = applyRedaction({ root: 'token=abc123456789', audiences: ['ui'], rules: [rule] })
  assert.match(ui.content, /^redacted:ui-redact$/)
  assert.deepEqual(ui.applied, [{ ruleId: 'ui-redact', count: 1 }])
})

test('nested objects and arrays are redacted recursively with per-rule counts', () => {
  const rules = [{ id: 'secret', audiences: ['model'], match: (v) => v.includes('SECRET_MARKER'), action: 'redact' }]
  const root = {
    top: 'SECRET_MARKER',
    nested: { deep: ['SECRET_MARKER', 'keep-me'], other: { deeper: 'SECRET_MARKER' } },
  }
  const out = applyRedaction({ root, audiences: ['model'], rules })
  assert.equal(out.content.top, 'redacted:secret')
  assert.equal(out.content.nested.deep[0], 'redacted:secret')
  assert.equal(out.content.nested.deep[1], 'keep-me')
  assert.equal(out.content.nested.other.deeper, 'redacted:secret')
  assert.deepEqual(out.applied, [{ ruleId: 'secret', count: 3 }])
})

test('first matching rule wins per node; later rules do not overwrite the marker', () => {
  const rules = [
    { id: 'first', audiences: ['model'], match: (v) => v.includes('abc'), action: 'redact' },
    { id: 'second', audiences: ['model'], match: () => true, action: 'redact' },
  ]
  const out = applyRedaction({ root: 'abc123', audiences: ['model'], rules })
  assert.equal(out.content, 'redacted:first')
  assert.deepEqual(out.applied, [{ ruleId: 'first', count: 1 }])
})

test('expose on non-secret material is allowed (plugin own decision)', () => {
  const rules = [{ id: 'view', audiences: ['model'], match: (v) => v.includes('diagnostic'), action: 'expose' }]
  const out = applyRedaction({ root: 'diagnostic detail ok', audiences: ['model'], rules })
  assert.equal(out.content, 'diagnostic detail ok')
  assert.deepEqual(out.applied, [{ ruleId: 'view', count: 1 }])
})

test('secret gate: expose of secret-shaped material is blocked by default and keeps the value redacted', () => {
  const rules = [{ id: 'leaky', audiences: ['model'], match: (v) => v.includes('sk-'), action: 'expose' }]
  const out = applyRedaction({ root: 'key sk-abcdefghijklmnop12', audiences: ['model'], rules, secretGate: denied })
  assert.match(out.content, /^redacted:leaky$/)
  assert.deepEqual(out.blocked, [{ ruleId: 'leaky', count: 1 }])
  assert.deepEqual(out.applied, [])
})

test('secret gate may allow when the user/profile policy grants the exposure', () => {
  const rules = [{ id: 'leaky', audiences: ['model'], match: (v) => v.includes('sk-'), action: 'expose' }]
  const out = applyRedaction({ root: 'key sk-abcdefghijklmnop12', audiences: ['model'], rules, secretGate: allowed })
  assert.equal(out.content, 'key sk-abcdefghijklmnop12')
  assert.deepEqual(out.applied, [{ ruleId: 'leaky', count: 1 }])
})

test('mayTouchSecret rules are subject to the gate regardless of material shape', () => {
  const rules = [{ id: 'touchy', audiences: ['model'], match: (v) => v.includes('anything'), action: 'expose', mayTouchSecret: true }]
  const out = applyRedaction({ root: 'anything plain', audiences: ['model'], rules, secretGate: denied })
  assert.match(out.content, /^redacted:touchy$/)
  assert.deepEqual(out.blocked, [{ ruleId: 'touchy', count: 1 }])
})

test('incidental secret-shaped matches stay under the secret constraint (narrower audience cannot escape)', () => {
  const rules = [{ id: 'ui-expose', audiences: ['ui'], match: () => true, action: 'expose' }]
  const out = applyRedaction({ root: 'api_key=super-secret-value-123456', audiences: ['ui'], rules, secretGate: denied })
  assert.match(out.content, /^redacted:ui-expose$/)
  assert.deepEqual(out.blocked, [{ ruleId: 'ui-expose', count: 1 }])
})

test('redact action on secret-shaped material is the protective direction (no gate needed)', () => {
  const rules = [{ id: 'hide', audiences: ['log'], match: (v) => v.includes('token='), action: 'redact' }]
  const out = applyRedaction({ root: 'token=abc123456789012345678', audiences: ['log'], rules })
  assert.match(out.content, /^redacted:hide$/)
  assert.deepEqual(out.applied, [{ ruleId: 'hide', count: 1 }])
  assert.deepEqual(out.blocked, [])
})

test('binary/buffer nodes are marked at the metadata layer without deep reading', () => {
  const rule = { id: 'r', audiences: ['model'], match: (v) => v.includes('x'), action: 'redact' }
  const root = { data: new Uint8Array([1, 2, 3]), text: 'x123' }
  const out = applyRedaction({ root, audiences: ['model'], rules: [rule] })
  assert.equal(out.content.data, 'redacted:binary')
  assert.equal(out.content.text, 'redacted:r')
  assert.deepEqual(out.markers, { binary: 1, unreadable: 0 })
})

test('Buffer and ArrayBuffer also degrade to the binary marker', () => {
  const rule = { id: 'r', audiences: ['model'], match: () => true, action: 'redact' }
  const out = applyRedaction({ root: { a: Buffer.from([7]), b: new ArrayBuffer(4) }, audiences: ['model'], rules: [rule] })
  assert.equal(out.content.a, 'redacted:binary')
  assert.equal(out.content.b, 'redacted:binary')
})

test('exception cause is expanded one level, sub-causes degrade conservatively', () => {
  const rule = { id: 'r', audiences: ['model'], match: (v) => v.includes('cause-secret'), action: 'redact' }
  const root = new Error('cause-secret top error')
  root.cause = new Error('cause-secret value here')
  root.cause.cause = new Error('should stay hidden: cause-secret inside sub-cause')
  const out = applyRedaction({ root, audiences: ['model'], rules: [rule] })
  assert.match(out.content.message, /^redacted:r$/, 'top-level own message is redacted')
  assert.match(out.content.cause.message, /^redacted:r$/, 'one-level cause is redacted')
  assert.match(out.content.cause.cause, /^redacted:unreadable$/, 'sub-cause beyond one level is conservative')
})

test('undeclared/unreadable nodes are conservatively replaced; siblings survive', () => {
  const rule = { id: 'r', audiences: ['model'], match: (v) => v.includes('x'), action: 'redact' }
  const root = { fn: () => 1, sym: Symbol('s'), ok: 'x-value', map: new Map([['a', 1]]) }
  const out = applyRedaction({ root, audiences: ['model'], rules: [rule] })
  assert.equal(out.content.ok, 'redacted:r')
  assert.equal(out.content.fn, 'redacted:unreadable')
  assert.equal(out.content.sym, 'redacted:unreadable')
  assert.equal(out.content.map, 'redacted:unreadable')
  assert.equal(out.markers.unreadable, 3)
})

test('a throwing getter fails closed for that node only', () => {
  const rule = { id: 'r', audiences: ['model'], match: () => true, action: 'redact' }
  const root = { safe: 'abc', guarded: {} }
  Object.defineProperty(root.guarded, 'explode', {
    enumerable: true,
    get() { throw new Error('boom') },
  })
  const out = applyRedaction({ root, audiences: ['model'], rules: [rule] })
  assert.equal(out.content.safe, 'redacted:r')
  assert.equal(out.content.guarded.explode, 'redacted:unreadable')
})

test('a throwing matcher degrades to no-match for that node', () => {
  const rule = { id: 'r', audiences: ['model'], match: () => { throw new Error('bad matcher') }, action: 'redact' }
  const out = applyRedaction({ root: 'any text', audiences: ['model'], rules: [rule] })
  assert.equal(out.content, 'any text')
  assert.deepEqual(out.applied, [])
})

test('cycles degrade to the unreadable marker instead of looping', () => {
  const rule = { id: 'r', audiences: ['model'], match: () => true, action: 'redact' }
  const root = { name: 'x1' }
  root.self = root
  const out = applyRedaction({ root, audiences: ['model'], rules: [rule] })
  assert.equal(out.content.name, 'redacted:r')
  assert.equal(out.content.self, 'redacted:unreadable')
})

test('a fully unstructureable root degrades to a whole-tree marker', () => {
  const rule = { id: 'r', audiences: ['model'], match: () => true, action: 'redact' }
  const out = applyRedaction({ root: () => {}, audiences: ['model'], rules: [rule] })
  assert.equal(out.content, 'redacted:unreadable')
  assert.equal(out.markers.unreadable, 1)
})

test('secret-shape heuristics cover credentials, private keys, JWT-style tokens', () => {
  assert.ok(isSecretShapedString('Bearer abcdefghijklmnopqrstuvwxyz'))
  assert.ok(isSecretShapedString('-----BEGIN RSA PRIVATE KEY-----'))
  assert.ok(isSecretShapedString('sk-abcdefghijklmnopqrstuv'))
  // JWT-style token assembled so the fixture itself carries no governance
  // letter+digit tokens (the identifier-splitting audit must stay clean)
  const jwt = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJ1c2VyMTIzIn0', 's0me_s1gn4tureV4lueHeader'].join('.')
  assert.ok(isSecretShapedString(jwt))
  assert.ok(isSecretShapedString('api_key = abcdef1234567890'))
  assert.ok(!isSecretShapedString('plain diagnostic output'))
  assert.ok(!isSecretShapedString(''))
  assert.ok(isSecretShapedKey('private_key'))
  assert.ok(isSecretShapedKey('authorization_header'))
  assert.ok(isSecretShapedKey('api-key'))
  assert.ok(!isSecretShapedKey('summary'))
})

test('rules without ids fall back to the owner attribution for the marker', () => {
  const rules = [{ ownerId: 'plugin-a', audiences: ['model'], match: () => true, action: 'redact' }]
  const out = applyRedaction({ root: 'abc', audiences: ['model'], rules })
  assert.equal(out.content, 'redacted:plugin-a')
})

test('marker/count structure survives for log audience consumers (counts only, no full text)', () => {
  const rules = [{ id: 'log-rule', audiences: ['log'], match: (v) => v.includes('trace'), action: 'redact' }]
  const out = applyRedaction({ root: 'trace log line', audiences: ['log'], rules })
  assert.equal(out.content, 'redacted:log-rule')
  assert.deepEqual(out.applied, [{ ruleId: 'log-rule', count: 1 }])
})