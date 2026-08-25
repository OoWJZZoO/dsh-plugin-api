import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { createAttachmentApply, ATTACHMENT_ACTIVE_SYMBOL } from '../lib/apply.js'
import { LocalAttachmentStore as ForkedLocalAttachmentStore } from '../lib/forked-store.js'
import { ATTACHMENT_OWNER_SYMBOL, createAttachmentOwnerToken, markAttachmentRoot, ownsAttachmentRoot } from '../lib/contract.js'

const VERSIONS = {
  '@deepseek-ai/dsh-llm': '0.1.0-rc.6',
  '@deepseek-ai/dsh-attachment': '0.1.0-rc.6',
  '@deepseek-ai/dsh-attachment-local': '0.1.0-rc.6',
  '@deepseek-ai/dsh-plugin-api-attachments': '0.1.0-rc.6-0.5',
  '@deepseek-ai/dsh-plugin-api-main': '0.1.0-rc.6-0.5',
}

function makeContext({ entries = [], pluginError = null, provider = null, pipeline = null } = {}) {
  const warns = []
  const serviceMap = new Map()
  if (provider) serviceMap.set('attachments', provider)
  if (pipeline) serviceMap.set('attachmentsPipeline', pipeline)
  const root = {}
  const ctx = {
    root,
    logger: { warn: (message) => warns.push(message) },
    loader: { entries: () => entries },
    get: (name) => serviceMap.get(name),
    plugin(Class, config) {
      if (pluginError) throw pluginError
      const instance = new Class(ctx, config)
      if (instance?.name) serviceMap.set(instance.name, instance)
      return () => {
        if (instance?.name) serviceMap.delete(instance.name)
        if (instance?.name === 'attachments') serviceMap.delete('attachmentsPipeline')
      }
    },
    serviceMap,
    warns,
  }
  return ctx
}

function goodEnv() {
  return {
    readPackageVersion: (name) => VERSIONS[name],
    readPackageApi: () => '0.5',
  }
}

function readImageProbe(reference) {
  const error = new Error('probe')
  error.code = reference.attachmentId === 'not-a-sha256-ref'
    ? 'INVALID_ATTACHMENT_REF'
    : reference.mediaType ? 'ATTACHMENT_CORRUPT' : 'ATTACHMENT_NOT_FOUND'
  return Promise.reject(error)
}

function forkedProvider() {
  return {
    [ATTACHMENT_ACTIVE_SYMBOL]: true,
    imageLimits: Object.freeze({ maxImageBytes: 1, maxImagesPerMessage: 1, maxMessageImageBytes: 1, maxImagePixels: 1, mediaTypes: Object.freeze(['image/png']) }),
    validateImage() {}, saveImage() {}, readImage: readImageProbe,
  }
}

function pipelineProvider(ctx) {
  const ownerToken = createAttachmentOwnerToken()
  markAttachmentRoot(ctx.root, ownerToken)
  let disposed = false
  const pipeline = Object.freeze({
    ingest() {},
    transform() {},
    registerTransform() { return { status: 'unavailable' } },
    cleanup() {},
    capabilities() { return { status: disposed ? 'unavailable' : 'active' } },
  })
  const projection = Object.freeze({
    resolve() { return { status: 'unavailable' } },
    open() {},
    project() {},
    provenance() {},
    availability() { return { status: disposed ? 'unavailable' : 'active' } },
  })
  return {
    get disposed() { return disposed },
    ownerToken,
    dispose() {
      if (disposed) return false
      disposed = true
      if (ownsAttachmentRoot(ctx.root, ownerToken)) delete ctx.root[ATTACHMENT_OWNER_SYMBOL]
      return true
    },
    pipeline,
    projection,
  }
}

test('enabled official row remains inert', async () => {
  const ctx = makeContext({ entries: [{ options: { id: 'attachment-local', disabled: false } }] })
  await createAttachmentApply({ ...goodEnv(), forkedStore: class {}, officialStore: class {} })(ctx)
  assert.equal(ctx.serviceMap.has('attachments'), false)
})

test('direct apply respects the replacement row active gate', async () => {
  let forked = 0
  let fallback = 0
  class Forked {
    constructor() { forked += 1 }
  }
  class Official {
    constructor() { fallback += 1 }
  }
  const ctx = makeContext({ entries: [
    { options: { id: 'attachment-local', disabled: true } },
    { options: { id: 'plugin-api-attachments', disabled: true } },
  ] })
  await createAttachmentApply({ ...goodEnv(), forkedStore: Forked, officialStore: Official })(ctx)
  assert.equal(forked, 0)
  assert.equal(fallback, 0)
})

test('a stale disposer cannot remove a newer replacement owner token', () => {
  const root = {}
  const oldToken = createAttachmentOwnerToken()
  const newToken = createAttachmentOwnerToken()
  assert.equal(markAttachmentRoot(root, oldToken), true)
  assert.equal(ownsAttachmentRoot(root, oldToken), true)
  delete root[ATTACHMENT_OWNER_SYMBOL]
  assert.equal(markAttachmentRoot(root, newToken), true)
  const staleDisposer = () => {
    if (ownsAttachmentRoot(root, oldToken)) delete root[ATTACHMENT_OWNER_SYMBOL]
  }
  staleDisposer()
  assert.equal(ownsAttachmentRoot(root, newToken), true)
})

test('matching disabled row registers one fork and repeated apply is no-double-run', async () => {
  let registrations = 0
  class Forked {
    constructor(ctx) {
      registrations += 1
      this.name = 'attachments'
      this[ATTACHMENT_ACTIVE_SYMBOL] = true
      this.imageLimits = Object.freeze({ maxImageBytes: 1, maxImagesPerMessage: 1, maxMessageImageBytes: 1, maxImagePixels: 1, mediaTypes: Object.freeze(['image/png']) })
      this.validateImage = () => {}
      this.saveImage = () => {}
      this.readImage = readImageProbe
      this.dispose = () => {}
      this.disposed = false
      ctx.serviceMap.set('attachments', this)
      ctx.serviceMap.set('attachmentsPipeline', pipelineProvider(ctx))
    }
  }
  const ctx = makeContext({ entries: [{ options: { id: 'attachment-local', disabled: true } }, { options: { id: 'plugin-api-attachments', disabled: false } }] })
  const apply = createAttachmentApply({ ...goodEnv(), forkedStore: Forked, officialStore: class {} })
  await apply(ctx)
  await apply(ctx)
  // The real disposal probe intentionally consumes and rolls back the first
  // fork; the second registration is the one left active. Re-apply adds no
  // further registration.
  assert.equal(registrations, 2)
})

test('identity mismatch falls back to official store only when replacement path is disabled', async () => {
  let fallback = 0
  class Official {
    constructor(ctx) { fallback += 1; this.name = 'attachments'; ctx.serviceMap.set('attachments', this) }
  }
  const ctx = makeContext({ entries: [{ options: { id: 'attachment-local', disabled: true } }, { options: { id: 'plugin-api-attachments', disabled: false } }] })
  await createAttachmentApply({ ...goodEnv(), readPackageVersion: (name) => name === '@deepseek-ai/dsh-llm' ? '0.1.0-rc.7' : VERSIONS[name], forkedStore: class {}, officialStore: Official })(ctx)
  assert.equal(fallback, 1)
})

test('post-registration probe rolls back before official fallback and every branch stays non-throwing', async () => {
  let forked = 0
  let fallback = 0
  class BadForked {
    constructor(ctx) { forked += 1; this.name = 'attachments'; ctx.serviceMap.set('attachments', this) }
  }
  class Official {
    constructor(ctx) { fallback += 1; this.name = 'attachments'; ctx.serviceMap.set('attachments', this) }
  }
  const ctx = makeContext({ entries: [{ options: { id: 'attachment-local', disabled: true } }, { options: { id: 'plugin-api-attachments', disabled: false } }] })
  await assert.doesNotReject(createAttachmentApply({ ...goodEnv(), forkedStore: BadForked, officialStore: Official })(ctx))
  assert.equal(forked, 1)
  assert.equal(fallback, 1)
  assert.equal(ctx.serviceMap.has('attachmentsPipeline'), false)
})

test('post-registration probe exercises typed read errors and active pipeline behavior', async () => {
  let fallback = 0
  class BadProbe {
    constructor(ctx) {
      this.name = 'attachments'
      this[ATTACHMENT_ACTIVE_SYMBOL] = true
      this.imageLimits = Object.freeze({ maxImageBytes: 1, maxImagesPerMessage: 1, maxMessageImageBytes: 1, maxImagePixels: 1, mediaTypes: Object.freeze(['image/png']) })
      this.validateImage = () => {}
      this.saveImage = () => {}
      this.readImage = async () => undefined
      this.dispose = () => {}
      this.disposed = false
      ctx.serviceMap.set('attachments', this)
      ctx.serviceMap.set('attachmentsPipeline', pipelineProvider(ctx))
    }
  }
  class Official {
    constructor(ctx) { fallback += 1; this.name = 'attachments'; ctx.serviceMap.set('attachments', this) }
  }
  const ctx = makeContext({ entries: [{ options: { id: 'attachment-local', disabled: true } }, { options: { id: 'plugin-api-attachments', disabled: false } }] })
  await assert.doesNotReject(createAttachmentApply({ ...goodEnv(), forkedStore: BadProbe, officialStore: Official })(ctx))
  assert.equal(fallback, 1)
  assert.equal(ctx.serviceMap.has('attachmentsPipeline'), false)
})

test('duplicate replacement rows converge to one official fallback', async () => {
  let fallback = 0
  class Official {
    constructor(ctx) { fallback += 1; this.name = 'attachments'; ctx.serviceMap.set('attachments', this) }
  }
  const ctx = makeContext({ entries: [
    { options: { id: 'attachment-local', disabled: true } },
    { options: { id: 'plugin-api-attachments', disabled: false } },
    { options: { id: 'plugin-api-attachments', disabled: false } },
  ] })
  const apply = createAttachmentApply({ ...goodEnv(), officialStore: Official })
  await apply(ctx)
  await apply(ctx)
  assert.equal(fallback, 1)
})

test('absent official row uses one inert official fallback after a failed probe', async () => {
  let fallback = 0
  class BadForked {
    constructor(ctx) {
      this.name = 'attachments'
      ctx.serviceMap.set('attachments', this)
    }
  }
  class Official {
    constructor(ctx) {
      fallback += 1
      this.name = 'attachments'
      ctx.serviceMap.set('attachments', this)
    }
  }
  const ctx = makeContext({ entries: [{ options: { id: 'plugin-api-attachments', disabled: false } }] })
  const apply = createAttachmentApply({ ...goodEnv(), forkedStore: BadForked, officialStore: Official })
  await assert.doesNotReject(apply(ctx))
  await assert.doesNotReject(apply(ctx))
  assert.equal(fallback, 1)
})

test('real fork passes post-registration typed contract and disposal probes', async () => {
  const ctx = new Context()
  const home = await mkdtemp(`${tmpdir()}/dsh-attachment-apply-`)
  const rows = [
    { options: { id: 'attachment-local', disabled: true } },
    { options: { id: 'plugin-api-attachments', disabled: false, config: { dshHome: home } } },
  ]
  ctx.loader = { entries: () => rows }
  const originalPlugin = ctx.plugin.bind(ctx)
  let registration
  ctx.plugin = (...args) => {
    registration = originalPlugin(...args)
    return registration
  }
  await createAttachmentApply({ ...goodEnv(), forkedStore: ForkedLocalAttachmentStore })(ctx)
  const provider = ctx.get('attachments')
  const pipeline = ctx.get('attachmentsPipeline')
  assert.equal(provider?.[ATTACHMENT_ACTIVE_SYMBOL], true)
  assert.equal(pipeline?.disposed, false)
  assert.equal(pipeline?.pipeline.capabilities().status, 'active')
  assert.equal(pipeline?.projection.availability().status, 'active')
  await registration.dispose()
  assert.equal(ctx.get('attachments'), undefined)
  assert.equal(ctx.get('attachmentsPipeline'), undefined)
})
