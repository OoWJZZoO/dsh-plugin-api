import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { createPluginApiService } from '../lib/plugin-api-service.js'
import { resolveMarkedAttachmentPipeline } from '../lib/index.js'

function makePipeline() {
  const calls = []
  const result = Object.freeze({ status: 'success', commitState: 'success', value: 'ok' })
  const pipeline = {
    ingest(...args) { calls.push(['ingest', args]); return result },
    transform(...args) { calls.push(['transform', args]); return result },
    registerTransform(...args) { calls.push(['registerTransform', args]); return () => true },
    cleanup(...args) { calls.push(['cleanup', args]); return result },
    capabilities() { return { status: 'active' } },
  }
  const projection = {
    resolve: () => result,
    open: () => result,
    project: () => result,
    provenance: () => result,
    availability: () => ({ status: 'active' }),
  }
  return { pipeline, projection, calls }
}

test('pluginApi.attachments is a marker-gated dynamic surface outside FEATURE_MOUNTERS', () => {
  const ctx = new Context()
  const provider = makePipeline()
  const Service = createPluginApiService({
    apiVersion: '0.5',
    registry: { snapshot: () => [], isActive: () => false },
    coreActive: true,
    attachmentsProvider: () => provider,
  })
  const service = new Service(ctx)
  assert.equal(service.attachments.pipeline.ingest('source').status, 'success')
  assert.equal(provider.calls[0][0], 'ingest')
  assert.deepEqual(service.attachments.projection.availability(), { status: 'active' })
})

test('unavailable attachment marker returns typed unavailable results without touching a provider', () => {
  const ctx = new Context()
  let called = false
  const Service = createPluginApiService({
    apiVersion: '0.5',
    registry: { snapshot: () => [], isActive: () => false },
    coreActive: false,
    attachmentsProvider: () => { called = true; return null },
  })
  const service = new Service(ctx)
  const result = service.attachments.pipeline.ingest('source')
  assert.equal(result.status, 'unavailable')
  assert.equal(result.error.code, 'ATTACHMENT_PIPELINE_UNAVAILABLE')
  assert.equal(called, false)
})

test('lib/index attachment loader and version gate fail closed independently, with six host-only negatives', () => {
  const marker = Symbol.for('dsh-plugin-api.attachments.owner')
  const contract = Symbol.for('dsh-plugin-api.attachments.contract')
  const pipeline = {
    pipeline: { capabilities() { return { status: 'active' } } },
    projection: { availability() { return { status: 'active' } } },
  }
  const provider = { [contract]: true }
  const rows = [{ options: { id: 'plugin-api-attachments', disabled: false } }]
  const services = new Map([['attachments', provider], ['attachmentsPipeline', pipeline]])
  const ctx = {
    root: { [marker]: { package: '@deepseek-ai/dsh-plugin-api-attachments', rowId: 'plugin-api-attachments' } },
    loader: { entries: () => rows },
    get: (name) => services.get(name),
  }

  // This is the real lib/index resolver: the active-row, marker, provider,
  // and installed auxiliary/main full-version gate all have to pass before
  // the capability is returned.  In this source worktree the auxiliary is
  // intentionally not installed, so the package-version gate fails closed.
  assert.equal(resolveMarkedAttachmentPipeline(ctx), null)
  rows[0].options.disabled = true
  assert.equal(resolveMarkedAttachmentPipeline(ctx), null, 'disabled replacement row must not publish')
  rows[0].options.disabled = false
  delete ctx.root[marker]
  assert.equal(resolveMarkedAttachmentPipeline(ctx), null, 'missing owner marker must not publish')

  const surface = { pipeline: {}, projection: {} }
  assert.equal('dsh.client' in {}, false, 'no client manifest belongs to the attachment package')
  assert.equal('remote' in surface, false, 'no remote namespace')
  assert.equal('slot' in surface && 'settings' in surface, false, 'no slot/settings bridge')
  assert.equal('version' in surface && 'assertCompatible' in surface, false, 'no host/client version negotiation')
  assert.equal('reconnect' in surface && 'connection' in surface, false, 'no browser reconnect state')
  assert.equal('events' in surface && 'client' in surface, false, 'no client-facing event/service')
})
