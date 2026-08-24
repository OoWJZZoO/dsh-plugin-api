import test from 'node:test'
import assert from 'node:assert/strict'
import {
  publicToolName,
  extractText,
  createExecutor,
  supportedOutputSchema,
  classifySchema,
  MAX_PUBLIC_NAME_LENGTH,
  HASH_LENGTH,
} from '../lib/tools.js'

test('publicToolName: clean identity passes through verbatim', () => {
  assert.equal(publicToolName('github', 'list_repos'), 'mcp__github__list_repos')
})

test('publicToolName: lossy normalization appends a deterministic identity hash', () => {
  const a = publicToolName('my.server', 'tool/x')
  assert.ok(a.startsWith('mcp__my_server__tool_x_'), a)
  const hash = a.slice(a.lastIndexOf('_') + 1)
  assert.match(hash, /^[0-9a-f]{12}$/)
  // deterministic
  assert.equal(publicToolName('my.server', 'tool/x'), a)
})

test('publicToolName: two distinct identities never collapse into one name', () => {
  // both collide after normalization
  const a = publicToolName('a.b', 'tool')
  const b = publicToolName('a-b', 'tool')
  assert.notEqual(a, b)
  const a2 = publicToolName('srv', 'x-y')
  const b2 = publicToolName('srv', 'x_y')
  assert.notEqual(a2, b2)
})

test('publicToolName: long identities are truncated within the 64-char budget plus hash', () => {
  const longServer = 's'.repeat(40)
  const longRaw = 'r'.repeat(40)
  const name = publicToolName(longServer, longRaw)
  assert.ok(name.length <= MAX_PUBLIC_NAME_LENGTH, `${name.length} <= ${MAX_PUBLIC_NAME_LENGTH}`)
  assert.match(name, /_([0-9a-f]{12})$/)
  assert.equal(name.length, MAX_PUBLIC_NAME_LENGTH)
})

test('publicToolName: raw names are never recovered from a public name (no inverse parsing need)', () => {
  const pub = publicToolName('github', 'create-issue')
  // The raw name is the trailing segment after the server segment; but callers
  // SHALL use the stored raw name, never parse the public name.
  assert.ok(pub.includes('__github__'))
})

test('supportedOutputSchema: valid JSON schema is kept, unsupported falls back', () => {
  const schema = { type: 'object', properties: { ok: { type: 'string' } } }
  assert.deepEqual(supportedOutputSchema(schema), schema)
  assert.equal(supportedOutputSchema(undefined), undefined)
  // something unsupported by assertSupportedJsonSchema
  assert.equal(supportedOutputSchema({ not: 'a-schema-uniformly' }), undefined)
  assert.equal(supportedOutputSchema(null), undefined)
})

test('classifySchema: input/output schema availability classification', () => {
  assert.equal(classifySchema('input', { type: 'object' }), 'available')
  assert.equal(classifySchema('input', undefined), 'fallback')
  assert.equal(classifySchema('output', undefined), 'unavailable')
  assert.equal(classifySchema('output', { type: 'object', properties: {} }), 'available')
  assert.equal(classifySchema('output', { unsupported: true }), 'fallback')
})

test('extractText: joins text blocks and discards binary/resource content', () => {
  const out = extractText(
    [
      { type: 'text', text: 'hello' },
      { type: 'text', text: 'world' },
      { type: 'image', mimeType: 'image/png' },
    ],
    'tool',
  )
  assert.equal(out, 'hello\nworld\n[image: image/png, content discarded]')
})

test('extractText: defensive fallbacks on a network trust boundary', () => {
  assert.equal(extractText([{ type: 'audio' }], 't'), '[audio: unknown, content discarded]')
  assert.equal(extractText([{ type: 'resource' }], 't'), '[resource: content discarded]')
  assert.equal(extractText([{ type: 'nope' }], 't'), '[unsupported content type: nope]')
  assert.equal(extractText([42], 't'), '[unsupported content type: unknown]')
  assert.equal(extractText([], 't'), '(t returned no text content)')
  assert.equal(extractText([{ type: 'text' }], 't'), '(t returned no text content)')
})

test('createExecutor: raw name goes on the wire and results map to content blocks', async () => {
  const calls = []
  const client = {
    request(params) {
      calls.push(params)
      return Promise.resolve({ content: [{ type: 'text', text: 'ok' }] })
    },
  }
  const opts = { toolCallTimeoutMs: 1000 }
  const exec = createExecutor(client, 'raw-tool', false, opts)
  const result = await exec({ a: 1 }, { signal: undefined })
  assert.equal(calls[0].params.name, 'raw-tool')
  assert.deepEqual(calls[0].params.arguments, { a: 1 })
  assert.deepEqual(result.content, [{ type: 'text', text: 'ok' }])
})

test('createExecutor: isError results reject', async () => {
  const client = {
    request() {
      return Promise.resolve({ content: [{ type: 'text', text: 'boom' }], isError: true })
    },
  }
  const exec = createExecutor(client, 't', false, { toolCallTimeoutMs: 1000 })
  await assert.rejects(() => exec({}, {}), /boom/)
})

test('createExecutor: task-required tools are rejected before the wire', async () => {
  const called = []
  const client = {
    request() {
      called.push(1)
      return Promise.resolve({ content: [] })
    },
  }
  const exec = createExecutor(client, 't', true, { toolCallTimeoutMs: 1000 })
  await assert.rejects(() => exec({}, {}), /requires task-based execution/)
  assert.equal(called.length, 0)
})

test('createExecutor: toolResult shape renders a text projection', async () => {
  const client = {
    request() {
      return Promise.resolve({ toolResult: { n: 2 }, structuredContent: { n: 2 } })
    },
  }
  const exec = createExecutor(client, 't', false, { toolCallTimeoutMs: 1000 })
  const result = await exec({}, {})
  assert.equal(result.content[0].text, '{"n":2}')
  assert.deepEqual(result.structuredContent, { n: 2 })
})
