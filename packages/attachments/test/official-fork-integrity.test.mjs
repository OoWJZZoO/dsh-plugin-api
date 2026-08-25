import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { LocalAttachmentStore as OfficialLocalAttachmentStore } from '/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-attachment-local/lib/index.js'
import { LocalAttachmentStore as ForkedLocalAttachmentStore } from '../lib/forked-store.js'

const officialPath = '/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-attachment-local/lib/index.js'
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010804000000b51c0c020000000b4944415478da6364f80f00010501012718e3660000000049454e44ae426082', 'hex')

async function start(Store, config = {}) {
  const ctx = new Context()
  const home = await mkdtemp(`${tmpdir()}/dsh-attachment-integrity-`)
  const fiber = ctx.plugin(Store, { dshHome: home, ...config })
  await new Promise((resolve) => setImmediate(resolve))
  return { ctx, fiber, store: ctx.get('attachments') }
}

async function expectCode(operation, code) {
  await assert.rejects(operation, (error) => {
    assert.equal(error?.code, code)
    return true
  })
}

async function expectAbort(operation) {
  await assert.rejects(operation, (error) => {
    assert.equal(error?.name, 'AbortError')
    assert.ok(error?.code === 'ABORT_ERR' || error?.code === 20)
    return true
  })
}

async function exerciseOfficialStore(Store) {
  const { fiber, store } = await start(Store)
  try {
    await store.validateImage({ data: PNG, mediaType: 'image/png' })
    await expectCode(store.validateImage({ data: new Uint8Array([1]), mediaType: 'image/png' }), 'INVALID_IMAGE')
    await expectCode(store.validateImage({ data: PNG, mediaType: 'image/jpeg' }), 'IMAGE_TYPE_MISMATCH')

    const input = { data: PNG, mediaType: 'image/png', name: 'fixture.png' }
    const reference = await store.saveImage(input)
    assert.deepEqual(
      { mediaType: reference.mediaType, bytes: reference.bytes, width: reference.width, height: reference.height },
      { mediaType: 'image/png', bytes: PNG.byteLength, width: 1, height: 1 },
    )
    const [first, second] = await Promise.all([store.saveImage(input), store.saveImage(input)])
    assert.equal(first.attachmentId, reference.attachmentId)
    assert.equal(second.attachmentId, reference.attachmentId)

    const opened = await store.readImage(reference)
    assert.deepEqual([...opened.data], [...PNG])
    await expectCode(store.readImage({ attachmentId: 'not-a-sha256-ref' }), 'INVALID_ATTACHMENT_REF')
    await expectCode(store.readImage({ attachmentId: `sha256:${'0'.repeat(64)}` }), 'ATTACHMENT_NOT_FOUND')

    const controller = new AbortController()
    controller.abort()
    await expectAbort(store.readImage(reference, controller.signal))

    const digest = reference.attachmentId.slice('sha256:'.length)
    const objectPath = join(store.root, 'objects', digest.slice(0, 2), digest)
    await writeFile(objectPath, new Uint8Array([0]))
    await expectCode(store.readImage(reference), 'ATTACHMENT_CORRUPT')
    await expectCode(store.readImage({ ...reference, bytes: reference.bytes + 1 }), 'ATTACHMENT_CORRUPT')
  } finally {
    await fiber.dispose()
  }
}

test('vendored fork records sharp import and replacement facts against the audited official source', () => {
  const official = readFileSync(officialPath, 'utf8')
  const forked = readFileSync(new URL('../lib/forked-store.js', import.meta.url), 'utf8')
  assert.match(official, /import sharp from "sharp"/)
  assert.match(forked, /const require = createRequire\(import\.meta\.url\)/)
  assert.match(forked, /require\("sharp"\)/)
  assert.match(forked, /createRequire\(officialPackage\)\("sharp"\)/)
  assert.match(forked, /AttachmentPipelineService/)
  assert.match(forked, /ATTACHMENT_CONTRACT_SYMBOL/)
  assert.match(forked, /Object\.defineProperty\(this, ATTACHMENT_CONTRACT_SYMBOL/)
  assert.doesNotMatch(forked, /export .*dsh-attachment-local/)
})

test('fork and official local stores preserve the official per-function behavior and typed failures', async () => {
  await exerciseOfficialStore(OfficialLocalAttachmentStore)
  await exerciseOfficialStore(ForkedLocalAttachmentStore)
})

test('fork preserves official image byte limits while adding no client or event face', async () => {
  for (const Store of [OfficialLocalAttachmentStore, ForkedLocalAttachmentStore]) {
    const { fiber, store, ctx } = await start(Store, { maxImageBytes: 1 })
    try {
      await expectCode(store.validateImage({ data: PNG, mediaType: 'image/png' }), 'IMAGE_TOO_LARGE')
      assert.deepEqual(Object.keys(store.imageLimits).sort(), ['maxImageBytes', 'maxImagePixels', 'maxImagesPerMessage', 'maxMessageImageBytes', 'mediaTypes'].sort())
      assert.equal(ctx.get('attachmentsPipeline') !== undefined, Store === ForkedLocalAttachmentStore)
    } finally {
      await fiber.dispose()
    }
  }
})
