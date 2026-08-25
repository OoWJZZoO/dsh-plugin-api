import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CODES,
  MAX_CAPABILITIES,
  MAX_SUMMARY_LENGTH,
  MAX_TOOL_NAMES,
  SOURCE_KINDS,
  normalizeConstraintResult,
  normalizeDescriptorSpec,
  normalizeReason,
  normalizeToolDefinitions,
  resolveScopeKey,
  scopeKeyOfContext,
  matchesQuery,
} from '../lib/tool-discovery-normalize.js'

function validSpec(overrides = {}) {
  return {
    id: 'alpha-1',
    owner: 'owner-a',
    summary: 'Alpha tool',
    capabilities: ['vision'],
    activate() {},
    ...overrides,
  }
}

test('descriptor spec: valid spec normalizes with defaults', () => {
  const result = normalizeDescriptorSpec(validSpec())
  assert.equal(result.ok, true)
  assert.equal(typeof result.value.activate, 'function')
  assert.deepEqual({
    id: result.value.id,
    owner: result.value.owner,
    summary: result.value.summary,
    capabilities: result.value.capabilities,
    sourceKind: result.value.sourceKind,
    toolNames: result.value.toolNames,
  }, {
    id: 'alpha-1',
    owner: 'owner-a',
    summary: 'Alpha tool',
    capabilities: ['vision'],
    sourceKind: 'plugin',
    toolNames: undefined,
  })
})

test('descriptor spec: explicit sourceKind and toolNames accepted', () => {
  const result = normalizeDescriptorSpec(validSpec({
    sourceKind: 'mcp',
    toolNames: ['alpha_run'],
  }))
  assert.equal(result.ok, true)
  assert.equal(result.value.sourceKind, 'mcp')
  assert.deepEqual(result.value.toolNames, ['alpha_run'])
})

test('descriptor spec: exhaustive invalid shapes are typed registration failures', () => {
  const cases = [
    { id: '', detail: 'empty id' },
    { id: '  ', detail: 'blank id' },
    { id: undefined, detail: 'missing id' },
    { id: 7, detail: 'non-string id' },
    { owner: '', detail: 'empty owner' },
    { owner: undefined, detail: 'missing owner' },
    { summary: undefined, detail: 'missing summary' },
    { summary: 42, detail: 'non-string summary' },
    { summary: 'x'.repeat(MAX_SUMMARY_LENGTH + 1), detail: 'summary over 200' },
    { capabilities: 'x', detail: 'non-array capabilities' },
    { capabilities: [...Array(MAX_CAPABILITIES + 1)].map((_, i) => `c${i}`), detail: 'capabilities over 16' },
    { capabilities: ['ok', ''], detail: 'blank capability entry' },
    { capabilities: ['ok', 3], detail: 'non-string capability entry' },
    { toolNames: [...Array(MAX_TOOL_NAMES + 1)].map((_, i) => `t${i}`), detail: 'toolNames over 16' },
    { toolNames: ['', 'ok'], detail: 'blank toolNames entry' },
    { sourceKind: 'bogus', detail: 'unknown source kind' },
    { activate: undefined, detail: 'missing activate' },
    { activate: 'nope', detail: 'non-function activate' },
  ]
  for (const item of cases) {
    const result = normalizeDescriptorSpec(validSpec(item))
    assert.equal(result.ok, false, `expected failure for ${item.detail}`)
    assert.equal(result.code, CODES.REGISTRATION_INVALID, `code for ${item.detail}`)
    assert.equal(typeof result.detail, 'string', `detail for ${item.detail}`)
  }
})

test('descriptor spec: summary boundary at exactly 200 characters passes', () => {
  const result = normalizeDescriptorSpec(validSpec({ summary: 'x'.repeat(MAX_SUMMARY_LENGTH) }))
  assert.equal(result.ok, true)
})

test('descriptor spec: exactly 16 capabilities and 16 toolNames pass', () => {
  const caps = [...Array(MAX_CAPABILITIES)].map((_, i) => `c${i}`)
  const names = [...Array(MAX_TOOL_NAMES)].map((_, i) => `t${i}`)
  const result = normalizeDescriptorSpec(validSpec({ capabilities: caps, toolNames: names }))
  assert.equal(result.ok, true)
})

test('descriptor spec: non-object spec is rejected', () => {
  for (const value of [null, undefined, 'spec', 42, []]) {
    const result = normalizeDescriptorSpec(value)
    assert.equal(result.ok, false)
    assert.equal(result.code, CODES.REGISTRATION_INVALID)
  }
})

test('tool definitions: valid definitions normalize with clone-safe parameters', () => {
  const definition = { name: 'alpha_run', description: 'Runs alpha', parameters: { type: 'object', properties: { q: { type: 'string' } } } }
  const result = normalizeToolDefinitions([definition])
  assert.equal(result.ok, true)
  assert.equal(result.tools.length, 1)
  assert.equal(result.tools[0].name, 'alpha_run')
  assert.notEqual(result.tools[0].parameters, definition.parameters, 'parameters are replaced by a structured clone')
  assert.deepEqual(result.tools[0].parameters, definition.parameters)
})

test('tool definitions: missing description/parameters become empty defaults', () => {
  const result = normalizeToolDefinitions([{ name: 'bare' }])
  assert.equal(result.ok, true)
  assert.equal(result.tools[0].description, '')
  assert.deepEqual(result.tools[0].parameters, {})
})

test('tool definitions: malformed outputs fail the whole activation with ENTRY_FAILED', () => {
  const cases = [
    undefined, null, 'nope', 42, {}, // not an array
    [{ name: '' }],
    [{ name: '  ' }],
    [{ name: 7 }],
    [{ name: 'ok', parameters: 'schema' }],
    [{ name: 'ok', description: 42 }],
    [null],
    ['bad'],
    [{ name: 'ok' }, { name: '' }], // one bad element fails the whole set
  ]
  for (const output of cases) {
    const result = normalizeToolDefinitions(output)
    assert.equal(result.ok, false, `expected failure for ${JSON.stringify(output)?.slice(0, 40)}`)
    assert.equal(result.code, CODES.ENTRY_FAILED)
  }
})

test('tool definitions: non-cloneable parameters (function) are rejected', () => {
  const result = normalizeToolDefinitions([{ name: 'fn_param', parameters: { evil() {} } }])
  assert.equal(result.ok, false)
  assert.equal(result.code, CODES.ENTRY_FAILED)
  assert.match(result.detail, /clone/i)
})

test('descriptor spec: empty capabilities array is allowed (at most 16)', () => {
  const result = normalizeDescriptorSpec(validSpec({ capabilities: [] }))
  assert.equal(result.ok, true)
})

test('tool definitions: symbols inside parameters are rejected as non-cloneable', () => {
  const result = normalizeToolDefinitions([{ name: 'sym_param', parameters: { marker: Symbol('x') } }])
  assert.equal(result.ok, false)
  assert.equal(result.code, CODES.ENTRY_FAILED)
  assert.match(result.detail, /clone/i)
})

test('scope key: resolves from session, then execution.agent.session, then execution.sessionId', () => {
  assert.deepEqual(resolveScopeKey({ session: { id: 's1' } }), { ok: true, scopeKey: 's1' })
  assert.deepEqual(resolveScopeKey({ execution: { agent: { session: { id: 's2' } } } }), { ok: true, scopeKey: 's2' })
  assert.deepEqual(resolveScopeKey({ execution: { sessionId: 's3' } }), { ok: true, scopeKey: 's3' })
  const failed = resolveScopeKey({ session: { id: '' }, execution: {} })
  assert.equal(failed.ok, false)
  assert.equal(failed.code, CODES.SCOPE_UNRESOLVED)
})

test('scope key of assemble context: scope.session.id with agent fallback', () => {
  assert.equal(scopeKeyOfContext({ scope: { session: { id: 's1' } }, agent: { session: { id: 's9' } } }), 's1')
  assert.equal(scopeKeyOfContext({ scope: {}, agent: { session: { id: 's2' } } }), 's2')
  assert.equal(scopeKeyOfContext({ scope: {} }), undefined)
  assert.equal(scopeKeyOfContext(null), undefined)
})

test('reason normalization: only non-empty strings survive', () => {
  assert.equal(normalizeReason('why'), 'why')
  assert.equal(normalizeReason(''), undefined)
  assert.equal(normalizeReason(42), undefined)
  assert.equal(normalizeReason(undefined), undefined)
})

test('query matching: case-insensitive substring over id/summary/capabilities', () => {
  const descriptor = { id: 'Alpha-ONE', summary: 'Vision analysis tool', capabilities: ['vision', 'OCR'] }
  assert.equal(matchesQuery(descriptor, 'alpha'), true)
  assert.equal(matchesQuery(descriptor, 'VISION'), true)
  assert.equal(matchesQuery(descriptor, 'analysis'), true)
  assert.equal(matchesQuery(descriptor, 'ocr'), true)
  assert.equal(matchesQuery(descriptor, 'nope'), false)
  assert.equal(matchesQuery(descriptor, ''), true, 'empty query matches everything')
  assert.equal(matchesQuery(descriptor, undefined), true)
})

test('constraint result: normalizes defensive shapes', () => {
  assert.deepEqual(normalizeConstraintResult(null), { status: 'none', forbidden: [] })
  assert.deepEqual(normalizeConstraintResult({ status: 'none' }), { status: 'none', forbidden: [] })
  assert.deepEqual(
    normalizeConstraintResult({ status: 'applied', source: 'route-policy', reason: 'route-denied', forbidden: [{ entryId: 'b', reason: 'r' }] }),
    { status: 'applied', source: 'route-policy', reason: 'route-denied', forbidden: [{ entryId: 'b', reason: 'r' }] },
  )
  assert.equal(normalizeConstraintResult({ status: 'bogus' }).status, 'unknown')
  assert.equal(normalizeConstraintResult({ status: 'applied', forbidden: [{ entryId: '' }] }).forbidden.length, 0)
  assert.equal(normalizeConstraintResult({ status: 'applied', forbidden: 'x' }).forbidden.length, 0)
})

test('source kinds are the approved enum', () => {
  assert.deepEqual([...SOURCE_KINDS], ['plugin', 'skill', 'mcp', 'builtin-ref'])
})