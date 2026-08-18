import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createClientCodec } from '../lib/client-codec.js'

const require = createRequire('/usr/lib/node_modules/@deepseek-ai/dsh/package.json')
const zod = require('zod')

test('codec uses actual zod v4 objects and rejects invalid descriptor data', () => {
  const codec = createClientCodec(zod)
  assert.ok(codec.json._zod)
  assert.deepEqual(codec.json.parse({ a: [1, true] }), { a: [1, true] })
  assert.throws(() => codec.json.parse({ value: undefined }))
  const strict = codec.strict(zod.string(), 'example#Value')
  const descriptor = codec.invocation({ id: 'pkg#svc/get', service: 'svc', namespace: 'svc', method: 'get', result: strict })
  assert.equal(descriptor.result.schema, strict.schema)
  assert.throws(() => codec.invocation({ id: '', service: 'svc', namespace: 'svc', method: 'get', result: strict }))
})
