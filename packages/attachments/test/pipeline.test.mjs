import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mkdtemp, readFile, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { LocalAttachmentStore } from '../lib/forked-store.js'
import { BLOB_MEDIA_TYPE } from '../lib/pipeline-core.js'

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010804000000b51c0c020000000b4944415478da6364f80f00010501012718e3660000000049454e44ae426082', 'hex')

async function start(config = {}, existingHome = undefined) {
  const ctx = new Context()
  const home = existingHome ?? await mkdtemp(`${tmpdir()}/dsh-attachments-`)
  const fiber = ctx.plugin(LocalAttachmentStore, { dshHome: home, ...config })
  await new Promise((resolve) => setImmediate(resolve))
  return { ctx, fiber, home, pipeline: ctx.get('attachmentsPipeline') }
}

async function stop(fiber) {
  await fiber?.dispose?.()
}

function identity(generation = 'g1') {
  return { ownerId: 'owner-a', generation, scope: 'session' }
}

test('official raster admission remains full-decode and pipeline records are immutable', async () => {
  const { fiber, pipeline } = await start()
  try {
    const result = await pipeline.pipeline.ingest({ kind: 'paste', bytes: PNG, mediaType: 'image/png', name: 'photo.png' }, identity())
    assert.equal(result.status, 'success')
    assert.equal(result.value.attachmentId.startsWith('sha256:'), true)
    assert.equal(result.value.media.width, 1)
    assert.equal(result.value.origin, 'original')
    assert.equal(Object.isFrozen(result.value), true)
    assert.throws(() => { result.value.ownerId = 'other' }, TypeError)
    const opened = await pipeline.projection.open({ ...identity(), attachmentId: result.value.attachmentId })
    assert.equal(opened.status, 'success')
    assert.deepEqual([...opened.value.data], [...PNG])
  } finally {
    await stop(fiber)
  }
})

test('same bytes from different source kinds keep content identity but record provenance', async () => {
  const { fiber, pipeline } = await start()
  try {
    const first = await pipeline.pipeline.ingest({ kind: 'paste', bytes: new Uint8Array([1, 2, 3]), mediaType: 'application/octet-stream' }, identity('paste'))
    const uri = `data:application/octet-stream;base64,${Buffer.from([1, 2, 3]).toString('base64')}`
    const second = await pipeline.pipeline.ingest({ kind: 'data-uri', uri }, identity('uri'))
    assert.equal(first.status, 'success')
    assert.equal(second.status, 'success')
    assert.equal(first.value.attachmentId, second.value.attachmentId)
    assert.equal(first.value.sourceProvenance[0].kind, 'paste')
    assert.equal(second.value.sourceProvenance[0].kind, 'data-uri')
  } finally {
    await stop(fiber)
  }
})

test('file, remote, and MCP sources use bounded public seams and never publish source paths', async () => {
  const { ctx, fiber, pipeline, home } = await start()
  try {
    const path = `${home}/input.bin`
    await writeFile(path, Buffer.from([4, 5, 6]))
    ctx.reflect.provide('fs', {
      resolve: async (value, options) => {
        if (options?.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
        return { displayPath: value, targetKey: value }
      },
      readBytes: async (target, signal, maxBytes) => {
        if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
        const bytes = new Uint8Array(await readFile(target.targetKey))
        if (bytes.byteLength > maxBytes) throw Object.assign(new Error('too large'), { code: 'FS_TOO_LARGE' })
        return bytes
      },
    })
    ctx.reflect.provide('web', {
      fetch: async (request, signal) => {
        assert.deepEqual(request, { url: 'https://example.invalid/a' })
        assert.equal(signal?.aborted, false)
        return { url: request.url, statusCode: 200, body: { kind: 'text', content: '\u0004\u0005\u0006' }, truncated: false }
      },
    })
    const file = await pipeline.pipeline.ingest({ kind: 'file', path, mediaType: BLOB_MEDIA_TYPE }, identity('file'))
    const remote = await pipeline.pipeline.ingest({ kind: 'remote', url: 'https://example.invalid/a', trust: 'trusted', mediaType: BLOB_MEDIA_TYPE }, identity('remote'))
    const mcp = await pipeline.pipeline.ingest({ kind: 'mcp-resource', trust: true, resource: { uri: 'mcp://resource', mediaType: BLOB_MEDIA_TYPE, data: new Uint8Array([4, 5, 6]) } }, identity('mcp'))
    for (const result of [file, remote, mcp]) assert.equal(result.status, 'success')
    assert.equal(file.value.attachmentId, remote.value.attachmentId)
    assert.equal(remote.value.attachmentId, mcp.value.attachmentId)
    assert.equal('displayPath' in file.value.sourceProvenance[0], false)
    assert.equal(JSON.stringify(file.value).includes(path), false)
    assert.deepEqual([...await readFile(path)], [4, 5, 6])
  } finally {
    await stop(fiber)
  }
})

test('source failure redaction fails closed for URLs and credentials', async () => {
  const { ctx, fiber, pipeline } = await start()
  try {
    const secretUrl = 'https://user:password@example.invalid/a?token=secret'
    ctx.reflect.provide('web', {
      fetch: async () => { throw new Error(`request ${secretUrl} Authorization: Bearer top-secret`) },
    })
    const result = await pipeline.pipeline.ingest({ kind: 'remote', url: secretUrl, trust: true }, identity('redaction'))
    assert.equal(result.status, 'error')
    assert.equal(result.error.message, 'attachment operation failed')
    assert.equal(result.error.message.includes(secretUrl), false)
    assert.equal(result.error.message.includes('top-secret'), false)
  } finally {
    await stop(fiber)
  }
})

test('source deadline and concurrency bounds fail closed without publication', async () => {
  const { ctx, fiber, pipeline } = await start({ maxPipelineConcurrency: 1, maxPipelineDeadlineMs: 500 })
  try {
    let release
    let pending = new Promise((resolve) => { release = resolve })
    ctx.reflect.provide('web', { fetch: async () => pending })
    const first = pipeline.pipeline.ingest({ kind: 'remote', url: 'https://example.invalid/slow', trust: true, mediaType: BLOB_MEDIA_TYPE }, identity('source-1'))
    await new Promise((resolve) => setImmediate(resolve))
    const concurrent = await pipeline.pipeline.ingest({ kind: 'remote', url: 'https://example.invalid/other', trust: true, mediaType: BLOB_MEDIA_TYPE }, identity('source-2'))
    assert.equal(concurrent.status, 'unavailable')
    assert.equal(concurrent.error.code, 'ATTACHMENT_SOURCE_UNAVAILABLE')
    release({ url: 'https://example.invalid/slow', statusCode: 200, body: { kind: 'text', content: '\u0001' }, truncated: false })
    assert.equal((await first).status, 'success')

    pending = new Promise((resolve) => { release = resolve })
    const deadline = pipeline.pipeline.ingest({ kind: 'remote', url: 'https://example.invalid/timeout', trust: true, mediaType: BLOB_MEDIA_TYPE }, { ...identity('source-timeout'), deadlineMs: 30 })
    const timedOut = await deadline
    assert.equal(timedOut.status, 'unavailable')
    assert.equal(timedOut.error.code, 'ATTACHMENT_SOURCE_UNAVAILABLE')
    release({ url: 'https://example.invalid/timeout', statusCode: 200, body: { kind: 'text', content: '\u0002' }, truncated: false })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal((await pipeline.journal.list('session', 'owner-a')).length, 1)
  } finally {
    await stop(fiber)
  }
})

test('batch admission is all-or-nothing and retry after a rejected member is clean', async () => {
  const { fiber, pipeline } = await start({ maxPipelineBytes: 2 })
  try {
    const batch = await pipeline.pipeline.ingest([
      { kind: 'paste', bytes: new Uint8Array([1]), mediaType: BLOB_MEDIA_TYPE },
      { kind: 'paste', bytes: new Uint8Array([1, 2, 3]), mediaType: BLOB_MEDIA_TYPE },
    ], identity('batch'))
    assert.equal(batch.status, 'denied')
    const retry = await pipeline.pipeline.ingest({ kind: 'paste', bytes: new Uint8Array([1]), mediaType: BLOB_MEDIA_TYPE }, identity('retry'))
    assert.equal(retry.status, 'success')
  } finally {
    await stop(fiber)
  }
})

test('batch persistence failure rolls back earlier records and current references', async () => {
  const { fiber, pipeline } = await start()
  try {
    const persist = pipeline._persist.bind(pipeline)
    let writes = 0
    pipeline._persist = async (...args) => {
      writes += 1
      if (writes === 2) return { status: 'error', commitState: 'error', error: { code: 'ATTACHMENT_WRITE_FAILED', message: 'injected write failure' } }
      return persist(...args)
    }
    const result = await pipeline.pipeline.ingest([
      { kind: 'paste', bytes: new Uint8Array([1]), mediaType: BLOB_MEDIA_TYPE },
      { kind: 'paste', bytes: new Uint8Array([2]), mediaType: BLOB_MEDIA_TYPE },
    ], identity('batch-write'))
    assert.equal(result.status, 'error')
    assert.equal((await pipeline.journal.list('session', 'owner-a')).length, 0)
    assert.equal(pipeline.current.has('session\u0000owner-a'), false)
  } finally {
    await stop(fiber)
  }
})

test('journal rejects corrupted content-addressed object reuse without publishing a record', async () => {
  const { fiber, pipeline } = await start()
  try {
    const bytes = new Uint8Array([7, 8, 9])
    const first = await pipeline.pipeline.ingest({ kind: 'paste', bytes, mediaType: BLOB_MEDIA_TYPE }, identity('reuse-first'))
    assert.equal(first.status, 'success')
    const digest = first.value.attachmentId.slice('sha256:'.length)
    const objectPath = join(pipeline.journal.root, 'objects', digest.slice(0, 2), digest)
    await writeFile(objectPath, new Uint8Array([0]))

    const rejected = await pipeline.pipeline.ingest({ kind: 'paste', bytes, mediaType: BLOB_MEDIA_TYPE }, identity('reuse-second'))
    assert.equal(rejected.status, 'unavailable')
    assert.equal(rejected.error.code, 'ATTACHMENT_CORRUPT')
    assert.equal((await pipeline.journal.list('session', 'owner-a')).length, 1)
    assert.equal((await pipeline.projection.resolve({ ...identity('reuse-first'), attachmentId: first.value.attachmentId })).status, 'success')
  } finally {
    await stop(fiber)
  }
})

test('journal object reuse and reads require persistent media metadata', async () => {
  const { fiber, pipeline } = await start()
  try {
    const first = await pipeline.pipeline.ingest({ kind: 'paste', bytes: new Uint8Array([31, 32]), mediaType: BLOB_MEDIA_TYPE }, identity('metadata-first'))
    assert.equal(first.status, 'success')
    const digest = first.value.attachmentId.slice('sha256:'.length)
    const metadataPath = join(pipeline.journal.root, 'objects', digest.slice(0, 2), `${digest}.meta.json`)
    await unlink(metadataPath)

    const rejectedReuse = await pipeline.pipeline.ingest({ kind: 'paste', bytes: new Uint8Array([31, 32]), mediaType: BLOB_MEDIA_TYPE }, identity('metadata-reuse'))
    assert.equal(rejectedReuse.status, 'unavailable')
    assert.equal(rejectedReuse.error.code, 'ATTACHMENT_CORRUPT')
    const rejectedRead = await pipeline.projection.open({ ...identity('metadata-first'), attachmentId: first.value.attachmentId })
    assert.equal(rejectedRead.status, 'unavailable')
    assert.equal(rejectedRead.error.code, 'ATTACHMENT_CORRUPT')
    assert.equal((await pipeline.journal.list('session', 'owner-a')).length, 1)
  } finally {
    await stop(fiber)
  }
})

test('shared content objects stay protected across scopes and owners until the last reference is gone', async () => {
  const { fiber, pipeline } = await start()
  try {
    const shared = new Uint8Array([50])
    const first = await pipeline.pipeline.ingest({ kind: 'paste', bytes: shared, mediaType: BLOB_MEDIA_TYPE }, { ownerId: 'owner-a', generation: 'a-old', scope: 'session' })
    const newer = await pipeline.pipeline.ingest({ kind: 'paste', bytes: new Uint8Array([51]), mediaType: BLOB_MEDIA_TYPE }, { ownerId: 'owner-a', generation: 'a-new', scope: 'session' })
    const other = await pipeline.pipeline.ingest({ kind: 'paste', bytes: shared, mediaType: BLOB_MEDIA_TYPE }, { ownerId: 'owner-b', generation: 'b-old', scope: 'workspace' })
    assert.equal(first.status, 'success')
    assert.equal(newer.status, 'success')
    assert.equal(other.status, 'success')
    const removedFirst = await pipeline.pipeline.cleanup({ ownerId: 'owner-a', generation: 'a-old', scope: 'session', reason: 'old-owner-retention' })
    assert.equal(removedFirst.value.removed, 1)
    assert.equal((await pipeline.projection.open({ ownerId: 'owner-b', generation: 'b-old', scope: 'workspace', attachmentId: other.value.attachmentId })).status, 'success')

    const otherNewer = await pipeline.pipeline.ingest({ kind: 'paste', bytes: new Uint8Array([52]), mediaType: BLOB_MEDIA_TYPE }, { ownerId: 'owner-b', generation: 'b-new', scope: 'workspace' })
    assert.equal(otherNewer.status, 'success')
    const removedLast = await pipeline.pipeline.cleanup({ ownerId: 'owner-b', generation: 'b-old', scope: 'workspace', reason: 'last-reference-retention' })
    assert.equal(removedLast.value.removed, 1)
    const digest = other.value.attachmentId.slice('sha256:'.length)
    await assert.rejects(readFile(join(pipeline.journal.root, 'objects', digest.slice(0, 2), digest)), { code: 'ENOENT' })
  } finally {
    await stop(fiber)
  }
})

test('cleanup propagates cancellation and never removes a current or referenced generation', async () => {
  const { fiber, pipeline } = await start()
  try {
    const old = await pipeline.pipeline.ingest({ kind: 'paste', bytes: new Uint8Array([11]), mediaType: BLOB_MEDIA_TYPE }, identity('cleanup-old'))
    const current = await pipeline.pipeline.ingest({ kind: 'paste', bytes: new Uint8Array([12]), mediaType: BLOB_MEDIA_TYPE }, identity('cleanup-current'))
    assert.equal(old.status, 'success')
    assert.equal(current.status, 'success')

    const controller = new AbortController()
    controller.abort()
    const aborted = await pipeline.pipeline.cleanup({ ...identity('cleanup-old'), reason: 'cancelled-retention', signal: controller.signal })
    assert.equal(aborted.status, 'aborted')
    assert.equal((await pipeline.projection.resolve({ ...identity('cleanup-old'), attachmentId: old.value.attachmentId })).status, 'success')

    const retained = await pipeline.pipeline.cleanup({ ...identity('cleanup-current'), reason: 'current-retention' })
    assert.equal(retained.status, 'success')
    assert.equal(retained.value.removed, 0)
    assert.equal(retained.value.retained, 1)
    assert.equal((await pipeline.projection.resolve({ ...identity('cleanup-current'), attachmentId: current.value.attachmentId })).status, 'success')
  } finally {
    await stop(fiber)
  }
})

test('cleanup retains a non-current record while a batch member for its owner is in flight', async () => {
  const { ctx, fiber, pipeline } = await start()
  try {
    const old = await pipeline.pipeline.ingest({ kind: 'paste', bytes: new Uint8Array([20]), mediaType: BLOB_MEDIA_TYPE }, { ownerId: 'owner-b', generation: 'old', scope: 'session' })
    const newer = await pipeline.pipeline.ingest({ kind: 'paste', bytes: new Uint8Array([21]), mediaType: BLOB_MEDIA_TYPE }, { ownerId: 'owner-b', generation: 'newer', scope: 'session' })
    assert.equal(old.status, 'success')
    assert.equal(newer.status, 'success')
    let release
    const pending = new Promise((resolve) => { release = resolve })
    let started
    const fetchStarted = new Promise((resolve) => { started = resolve })
    ctx.reflect.provide('web', { fetch: async () => { started(); return pending } })
    const batch = pipeline.pipeline.ingest([{
      source: { kind: 'remote', url: 'https://example.invalid/in-flight', trust: true, mediaType: BLOB_MEDIA_TYPE },
      options: { ownerId: 'owner-b', generation: 'batch', scope: 'session' },
    }], identity('batch-base'))
    await fetchStarted
    const retained = await pipeline.pipeline.cleanup({ ownerId: 'owner-b', generation: 'old', scope: 'session', reason: 'in-flight-batch' })
    assert.equal(retained.status, 'success')
    assert.equal(retained.value.removed, 0)
    assert.equal(retained.value.retained, 1)
    release({ url: 'https://example.invalid/in-flight', statusCode: 200, body: { kind: 'text', content: '\u0016' }, truncated: false })
    assert.equal((await batch).status, 'success')
    const after = await pipeline.pipeline.cleanup({ ownerId: 'owner-b', generation: 'old', scope: 'session', reason: 'after-batch' })
    assert.equal(after.status, 'success')
    assert.equal(after.value.removed, 1)
  } finally {
    await stop(fiber)
  }
})

test('batch enforces official image count and capabilities expose complete image limits', async () => {
  const { fiber, pipeline } = await start({ maxImagesPerMessage: 1 })
  try {
    const capabilities = pipeline.pipeline.capabilities()
    assert.equal(capabilities.limits.maxImagesPerMessage, 1)
    assert.equal(capabilities.limits.maxMessageImageBytes, 100 * 1024 * 1024)
    assert.deepEqual(capabilities.imageLimits.mediaTypes, ['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
    const result = await pipeline.pipeline.ingest([
      { kind: 'paste', bytes: PNG, mediaType: 'image/png' },
      { kind: 'paste', bytes: PNG, mediaType: 'image/png' },
    ], identity('image-count'))
    assert.equal(result.status, 'denied')
    assert.equal(result.error.code, 'ATTACHMENT_BATCH_TOO_LARGE')
    assert.equal((await pipeline.journal.list('session', 'owner-a')).length, 0)
  } finally {
    await stop(fiber)
  }
})

test('duration policy is decoder-backed, finite, non-negative, and inclusive', async () => {
  const { fiber, pipeline } = await start({
    maxDurationMs: 100,
    decoders: { 'audio/mpeg': async (bytes) => ({ durationMs: bytes[0] }) },
  })
  try {
    const equal = await pipeline.pipeline.ingest({ kind: 'paste', bytes: new Uint8Array([100]), mediaType: 'audio/mpeg' }, identity('equal'))
    assert.equal(equal.status, 'success')
    assert.equal(equal.value.media.durationMs, 100)
    const over = await pipeline.pipeline.ingest({ kind: 'paste', bytes: new Uint8Array([101]), mediaType: 'audio/mpeg' }, identity('over'))
    assert.equal(over.status, 'denied')
    assert.equal(over.error.code, 'ATTACHMENT_DURATION_TOO_LONG')
    const unsupported = await pipeline.pipeline.ingest({ kind: 'paste', bytes: new Uint8Array([1]), mediaType: 'video/mp4' }, identity('missing-decoder'))
    assert.equal(unsupported.status, 'unavailable')
    assert.equal(unsupported.error.code, 'ATTACHMENT_MEDIA_UNSUPPORTED')
  } finally {
    await stop(fiber)
  }
})

test('invalid duration policy fails closed and never publishes a record', async () => {
  const { fiber, pipeline } = await start({
    maxDurationMs: '100',
    decoders: { 'audio/mpeg': async () => ({ durationMs: 1 }) },
  })
  try {
    const result = await pipeline.pipeline.ingest({ kind: 'paste', bytes: new Uint8Array([1]), mediaType: 'audio/mpeg' }, identity())
    assert.equal(result.status, 'unavailable')
    assert.equal(result.error.code, 'ATTACHMENT_POLICY_INVALID')
    const missing = await pipeline.projection.resolve({ ...identity(), attachmentId: 'sha256:' + '0'.repeat(64) })
    assert.equal(missing.status, 'unavailable')
    assert.equal(missing.error.code, 'ATTACHMENT_NOT_FOUND')
  } finally {
    await stop(fiber)
  }
})

test('decoder exceptions without a code fail closed as media unsupported', async () => {
  const { fiber, pipeline } = await start({
    maxDurationMs: 100,
    decoders: { 'audio/mpeg': async () => { throw new Error('decoder internals are not public') } },
  })
  try {
    const result = await pipeline.pipeline.ingest({ kind: 'paste', bytes: new Uint8Array([1]), mediaType: 'audio/mpeg' }, identity('decoder-error'))
    assert.equal(result.status, 'unavailable')
    assert.equal(result.error.code, 'ATTACHMENT_MEDIA_UNSUPPORTED')
    assert.equal((await pipeline.journal.list('session', 'owner-a')).length, 0)
  } finally {
    await stop(fiber)
  }
})

test('transform repeats decoder duration admission and publishes only a derived generation', async () => {
  const { fiber, pipeline } = await start({
    maxDurationMs: 100,
    decoders: { 'audio/mpeg': async (bytes) => ({ durationMs: bytes[0] }) },
  })
  try {
    const source = await pipeline.pipeline.ingest({ kind: 'paste', bytes: new Uint8Array([100]), mediaType: 'audio/mpeg' }, identity())
    const dispose = pipeline.pipeline.registerTransform({
      id: 'compress',
      ownerId: 'owner-a',
      generation: 'g1',
      mediaTypes: ['audio/mpeg'],
      policy: { deadlineMs: 1000, concurrency: 1 },
      run: async () => ({ data: new Uint8Array([101]), mediaType: 'audio/mpeg' }),
    })
    const denied = await pipeline.pipeline.transform(source.value, { operationId: 'compress' })
    assert.equal(denied.status, 'denied')
    assert.equal(denied.error.code, 'ATTACHMENT_DURATION_TOO_LONG')
    const stillThere = await pipeline.projection.resolve({ ...identity(), attachmentId: source.value.attachmentId })
    assert.equal(stillThere.status, 'success')
    assert.equal(dispose(), true)
    assert.equal(dispose(), false)
  } finally {
    await stop(fiber)
  }
})

test('transform deadline and concurrency denial do not publish, while caller cancellation is aborted', async () => {
  const { fiber, pipeline } = await start({
    maxPipelineConcurrency: 1,
    maxPipelineDeadlineMs: 1000,
  })
  try {
    const source = await pipeline.pipeline.ingest({ kind: 'paste', bytes: new Uint8Array([1]), mediaType: 'application/octet-stream' }, identity())
    let release
    const wait = new Promise((resolve) => { release = resolve })
    const dispose = pipeline.pipeline.registerTransform({
      id: 'slow',
      ownerId: 'owner-a',
      generation: 'g1',
      mediaTypes: [ 'application/octet-stream' ],
      policy: { deadlineMs: 1000, concurrency: 1 },
      run: async () => { await wait; return new Uint8Array([2]) },
    })
    const first = pipeline.pipeline.transform(source.value, { operationId: 'slow' })
    await new Promise((resolve) => setImmediate(resolve))
    const concurrent = await pipeline.pipeline.transform(source.value, { operationId: 'slow' })
    assert.equal(concurrent.status, 'denied')
    assert.equal(concurrent.error.code, 'ATTACHMENT_TRANSFORM_DENIED')
    release()
    const transformed = await first
    assert.equal(transformed.status, 'success')
    assert.equal(transformed.value.origin, 'derived')
    assert.equal(transformed.value.parent.recordId, source.value.recordId)
    assert.equal(dispose(), true)

    const secondSource = await pipeline.pipeline.ingest({ kind: 'paste', bytes: new Uint8Array([3]), mediaType: 'application/octet-stream' }, identity('g2'))
    const controller = new AbortController()
    pipeline.pipeline.registerTransform({ id: 'abort', ownerId: 'owner-a', generation: 'g2', mediaTypes: [BLOB_MEDIA_TYPE], policy: { deadlineMs: 1000 }, run: async (_input, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })
      void resolve
    }) })
    const abortedPromise = pipeline.pipeline.transform(secondSource.value, { operationId: 'abort' }, { signal: controller.signal })
    controller.abort()
    const aborted = await abortedPromise
    assert.equal(aborted.status, 'aborted')
    assert.equal(aborted.commitState, 'aborted')
  } finally {
    await stop(fiber)
  }
})

test('transform deadline abort is denied and cannot publish a derived record', async () => {
  const { fiber, pipeline } = await start({ maxPipelineDeadlineMs: 1000 })
  try {
    const source = await pipeline.pipeline.ingest({ kind: 'paste', bytes: new Uint8Array([1]), mediaType: BLOB_MEDIA_TYPE }, identity())
    const dispose = pipeline.pipeline.registerTransform({
      id: 'deadline',
      ownerId: 'owner-a',
      generation: 'g1',
      mediaTypes: [BLOB_MEDIA_TYPE],
      policy: { deadlineMs: 25, concurrency: 1 },
      run: async (_input, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('deadline'), { name: 'AbortError' })), { once: true })
        void resolve
      }),
    })
    const result = await pipeline.pipeline.transform(source.value, { operationId: 'deadline' })
    assert.equal(result.status, 'denied')
    assert.equal(result.error.code, 'ATTACHMENT_TRANSFORM_DENIED')
    assert.equal((await pipeline.journal.list('session', 'owner-a')).length, 1)
    assert.equal(dispose(), true)
  } finally {
    await stop(fiber)
  }
})

test('transform stale completion after async admission is superseded before persistence', async () => {
  let decoderCalls = 0
  let releaseAdmission
  const admissionPending = new Promise((resolve) => { releaseAdmission = resolve })
  const { fiber, pipeline } = await start({
    maxDurationMs: 100,
    decoders: { 'audio/mpeg': async () => {
      decoderCalls += 1
      if (decoderCalls === 2) await admissionPending
      return { durationMs: 1, reliable: true, complete: true }
    } },
  })
  try {
    const source = await pipeline.pipeline.ingest({ kind: 'paste', bytes: new Uint8Array([1]), mediaType: 'audio/mpeg' }, identity('stale-source'))
    assert.equal(source.status, 'success')
    pipeline.pipeline.registerTransform({
      id: 'stale-admission',
      ownerId: 'owner-a',
      generation: 'stale-source',
      mediaTypes: ['audio/mpeg'],
      policy: { deadlineMs: 1000 },
      run: async () => ({ data: new Uint8Array([2]), mediaType: 'audio/mpeg' }),
    })
    const pending = pipeline.pipeline.transform(source.value, { operationId: 'stale-admission' })
    while (decoderCalls < 2) await new Promise((resolve) => setImmediate(resolve))
    const replacement = await pipeline.pipeline.ingest({ kind: 'paste', bytes: new Uint8Array([3]), mediaType: 'audio/mpeg' }, identity('replacement-source'))
    assert.equal(replacement.status, 'success')
    releaseAdmission()
    const stale = await pending
    assert.equal(stale.status, 'superseded')
    assert.equal(stale.error.code, 'ATTACHMENT_GENERATION_SUPERSEDED')
    assert.equal((await pipeline.journal.list('session', 'owner-a')).length, 2)
  } finally {
    await stop(fiber)
  }
})

test('transform applies octet maxBytes and records only bounded effective policy provenance', async () => {
  const limited = await start({ maxPipelineBytes: 1 })
  try {
    const source = await limited.pipeline.pipeline.ingest({ kind: 'paste', bytes: new Uint8Array([60]), mediaType: BLOB_MEDIA_TYPE }, identity())
    limited.pipeline.pipeline.registerTransform({
      id: 'binary-limit', ownerId: 'owner-a', generation: 'g1', mediaTypes: [BLOB_MEDIA_TYPE],
      policy: { deadlineMs: 500, concurrency: 1 }, run: async () => ({ data: new Uint8Array([60, 61]), mediaType: BLOB_MEDIA_TYPE }),
    })
    const denied = await limited.pipeline.pipeline.transform(source.value, { operationId: 'binary-limit' })
    assert.equal(denied.status, 'denied')
    assert.equal(denied.error.code, 'ATTACHMENT_SIZE_TOO_LARGE')
    assert.equal((await limited.pipeline.journal.list('session', 'owner-a')).length, 1)
  } finally {
    await stop(limited.fiber)
  }

  const { fiber, pipeline } = await start({ maxPipelineBytes: 8, maxPipelineDeadlineMs: 2000, maxPipelineConcurrency: 2 })
  try {
    const source = await pipeline.pipeline.ingest({ kind: 'paste', bytes: new Uint8Array([62]), mediaType: BLOB_MEDIA_TYPE }, identity())
    pipeline.pipeline.registerTransform({
      id: 'binary-policy', ownerId: 'owner-a', generation: 'g1', mediaTypes: [BLOB_MEDIA_TYPE],
      policy: { maxBytes: 4, deadlineMs: 1000, concurrency: 1 }, run: async () => ({ data: new Uint8Array([62, 63]), mediaType: BLOB_MEDIA_TYPE }),
    })
    const transformed = await pipeline.pipeline.transform(source.value, { operationId: 'binary-policy' })
    assert.equal(transformed.status, 'success')
    const entry = transformed.value.sourceProvenance.find((item) => item.kind === 'transform')
    assert.deepEqual(entry.policy, { maxBytes: 4, deadlineMs: 1000, concurrency: 1 })
    assert.equal(JSON.stringify(entry).length <= 512, true)
  } finally {
    await stop(fiber)
  }
})

test('projection requires explicit route and exact admission evidence', async () => {
  const { fiber, pipeline } = await start()
  try {
    const source = await pipeline.pipeline.ingest({ kind: 'paste', bytes: new Uint8Array([1]), mediaType: BLOB_MEDIA_TYPE }, identity())
    const missing = await pipeline.projection.project({ ...identity(), attachmentId: source.value.attachmentId }, { targetRoute: { id: 'r', mediaTypes: [BLOB_MEDIA_TYPE] } })
    assert.equal(missing.status, 'unavailable')
    const denied = await pipeline.projection.project({ ...identity(), attachmentId: source.value.attachmentId }, { targetRoute: { id: 'r', mediaTypes: [BLOB_MEDIA_TYPE] }, admission: { accepted: false, source: 'policy', observedAt: new Date().toISOString() } })
    assert.equal(denied.status, 'denied')
    const projected = await pipeline.projection.project({ ...identity(), attachmentId: source.value.attachmentId }, { targetRoute: { id: 'r', provider: 'p', model: 'm', mediaTypes: [BLOB_MEDIA_TYPE] }, admission: { accepted: true, source: 'policy', observedAt: new Date().toISOString() } })
    assert.equal(projected.status, 'success')
    assert.equal('data' in projected.value, false)
    assert.equal(Object.isFrozen(projected.value), true)
    const urlAdmission = await pipeline.projection.project({ ...identity(), attachmentId: source.value.attachmentId }, {
      targetRoute: { id: 'r', mediaTypes: [BLOB_MEDIA_TYPE] },
      admission: { accepted: true, source: 'https://user:secret@example.invalid/model', observedAt: new Date().toISOString() },
    })
    assert.equal(urlAdmission.status, 'unavailable')
    const credentialRoute = await pipeline.projection.project({ ...identity(), attachmentId: source.value.attachmentId }, {
      targetRoute: { id: 'r', model: 'Bearer top-secret', mediaTypes: [BLOB_MEDIA_TYPE] },
      admission: { accepted: true, source: 'policy', observedAt: new Date().toISOString() },
    })
    assert.equal(credentialRoute.status, 'unavailable')
  } finally {
    await stop(fiber)
  }
})

test('journal survives replacement restart and cleanup is scope/owner/generation bound', async () => {
  const first = await start()
  let record
  try {
    const result = await first.pipeline.pipeline.ingest({ kind: 'paste', bytes: new Uint8Array([9]), mediaType: BLOB_MEDIA_TYPE }, identity('old'))
    assert.equal(result.status, 'success')
    record = result.value
  } finally {
    await stop(first.fiber)
  }
  const second = await start({}, first.home)
  try {
    const reopened = await second.pipeline.projection.open({ ...identity('old'), attachmentId: record.attachmentId })
    assert.equal(reopened.status, 'success')
    const projected = await second.pipeline.projection.project({ ...identity('old'), attachmentId: record.attachmentId }, {
      targetRoute: { id: 'restart-route', mediaTypes: [BLOB_MEDIA_TYPE] },
      admission: { accepted: true, source: 'restart-test', observedAt: new Date().toISOString() },
    })
    assert.equal(projected.status, 'success')
    const retained = await second.pipeline.pipeline.cleanup({ ...identity('old'), reason: 'restart-current-retention' })
    assert.equal(retained.value.removed, 0)
    assert.equal(retained.value.retained, 1)
    const other = await second.pipeline.pipeline.ingest({ kind: 'paste', bytes: new Uint8Array([10]), mediaType: BLOB_MEDIA_TYPE }, identity('current'))
    assert.equal(other.status, 'success')
    const staleProjection = await second.pipeline.projection.project({ ...identity('old'), attachmentId: record.attachmentId }, {
      targetRoute: { id: 'restart-route', mediaTypes: [BLOB_MEDIA_TYPE] },
      admission: { accepted: true, source: 'restart-test', observedAt: new Date().toISOString() },
    })
    assert.equal(staleProjection.status, 'superseded')
    assert.equal(staleProjection.error.code, 'ATTACHMENT_GENERATION_SUPERSEDED')
    const cleanup = await second.pipeline.pipeline.cleanup({ ...identity('old'), reason: 'retention-expired' })
    assert.equal(cleanup.status, 'success')
    assert.equal((await second.pipeline.projection.resolve({ ...identity('old'), attachmentId: record.attachmentId })).status, 'unavailable')
    assert.equal((await second.pipeline.projection.resolve({ ...identity('current'), attachmentId: other.value.attachmentId })).status, 'success')
  } finally {
    await stop(second.fiber)
  }
})
