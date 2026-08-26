import test from 'node:test'
import assert from 'node:assert/strict'
import { COMPACTION_EVENTS_CONTRACT_SYMBOL } from '../lib/compaction-events-catalog.js'
import { createContextSources } from '../lib/context-sources.js'

function createFakeCtx(options = {}) {
  const listeners = new Map()
  const ctx = {
    listeners,
    get(name) {
      return options.services?.[name]
    },
    on(name, listener) {
      const set = listeners.get(name) ?? new Set()
      set.add(listener)
      listeners.set(name, set)
      let removed = false
      return () => {
        if (removed) return
        removed = true
        set.delete(listener)
      }
    },
    emit(name, payload) {
      for (const listener of [...(listeners.get(name) ?? [])]) listener(payload)
    },
  }
  return ctx
}

function makeSources(options = {}) {
  const ctx = createFakeCtx(options)
  const received = { evidence: [], mappings: [], diagnostics: [] }
  const api = createContextSources({
    ctx,
    service: options.service ?? {},
    featureRegistry: options.featureRegistry ?? { isActive: () => false },
    renderContextSnapshot: options.renderContextSnapshot ?? null,
    joinContextSections: options.joinContextSections ?? null,
    evidenceEventName: options.evidenceEventName ?? 'agent-loop/assembled-context',
    evidenceActive: options.evidenceActive ?? (() => false),
    onEvidence: (payload) => received.evidence.push(payload),
    onMapping: (mapping) => received.mappings.push(mapping),
    reportDiagnostics: (owner, detail) => received.diagnostics.push(`${owner}: ${detail}`),
    now: options.now ?? (() => new Date('2026-08-26T10:00:00.000Z')),
    ...options,
  })
  api.install()
  return { api, ctx, received }
}

test('systemPrompt adapter reports available/degraded/unavailable by service shape and helpers', () => {
  const shape = {
    section() {}, context() {}, variable() {}, tools() {}, suppressRuntimeContext() {},
  }
  const withService = (services, render = () => 'x', join = () => 'y') =>
    makeSources({ services, renderContextSnapshot: render, joinContextSections: join })
  assert.equal(withService({ systemPrompt: shape }, () => 'x', () => 'y').api.sources.systemPrompt.status(), 'available')
  assert.equal(withService({ systemPrompt: shape }, null, () => 'y').api.sources.systemPrompt.status(), 'degraded')
  assert.equal(withService({}).api.sources.systemPrompt.status(), 'unavailable')
  const passthrough = withService({ systemPrompt: shape }, () => 'rendered', (sections) => sections.join('|'))
  assert.equal(passthrough.api.sources.systemPrompt.renderContextSnapshot({}), 'rendered')
  assert.equal(passthrough.api.sources.systemPrompt.joinContextSections(['a', 'b']), 'a|b')
  // helper failure degrades to undefined, never throws
  const broken = withService({ systemPrompt: shape }, () => { throw new Error('boom') })
  assert.equal(broken.api.sources.systemPrompt.renderContextSnapshot({}), undefined)
})

test('sessionSurface adapter verifies seq bounds against the live session without synthesizing', () => {
  const session = { events: [{ seq: 5 }, { seq: 6 }] }
  const { api } = makeSources({ services: { sessions: { get: () => session, list: () => [session] } } })
  assert.equal(api.sources.sessionSurface.status(), 'available')
  assert.deepEqual(api.sources.sessionSurface.verifySeqBounds('s1', [1, 5]), { ok: true })
  assert.deepEqual(api.sources.sessionSurface.verifySeqBounds('s1', [7]), { ok: false, outOfRange: [7] })
  const missing = makeSources({ services: { sessions: { get: () => undefined, list: () => [] } } })
  assert.deepEqual(missing.api.sources.sessionSurface.verifySeqBounds('s1', [3]), { ok: false, outOfRange: [] })
  assert.equal(missing.api.sources.sessionSurface.status(), 'available')
})

test('attachment adapter reports reachability through the delivered projection availability', () => {
  const unavailable = makeSources({ service: { attachments: { availability: () => ({ status: 'unavailable', commitState: 'error' }) } } })
  assert.equal(unavailable.api.sources.attachment.status(), 'unavailable')
  const available = makeSources({ service: { attachments: { availability: () => ({ status: 'ok' }) } } })
  assert.equal(available.api.sources.attachment.status(), 'available')
  const noSurface = makeSources({ service: {} })
  assert.equal(noSurface.api.sources.attachment.status(), 'unavailable')
  const throwing = makeSources({ service: { attachments: { availability: () => { throw new Error('boom') } } } })
  assert.equal(throwing.api.sources.attachment.status(), 'unavailable')
})

test('toolExposure and skillExposure track their delivered feature registry state', () => {
  const { api } = makeSources({ featureRegistry: { isActive: (name) => name === 'toolDiscovery' } })
  assert.equal(api.sources.toolExposure.status(), 'available')
  assert.equal(api.sources.skillExposure.status(), 'unavailable')
  const both = makeSources({ featureRegistry: { isActive: () => true } })
  assert.equal(both.api.sources.skillExposure.status(), 'available')
})

test('skillExposure normalizes the frozen skill-exposure record vocabulary with positive and negative records', () => {
  const valid = {
    skillId: 'skill-1',
    owner: 'owner-a',
    sourceKind: 'explicit',
    scope: { kind: 'session', key: 's1' },
    generation: 'g-3',
    tools: [{ entryId: 'e1', generation: 'g-1' }],
    promptSections: ['available_skills'],
    resources: [{ resourceId: 'r1', metadata: { mime: 'text' } }],
    degraded: [],
    availability: { status: 'available', degradedParts: [], seamStatus: 'ok' },
  }
  const { api } = makeSources()
  assert.deepEqual(api.sources.skillExposure.normalize(valid), { ok: true, record: valid })
  const negatives = [
    { ...valid, skillId: '' },
    { ...valid, scope: { kind: 'session' } },
    { ...valid, tools: [{ entryId: '', generation: 'g' }] },
    { ...valid, promptSections: ['ok', 7] },
    { ...valid, degraded: [{ part: 'x' }] },
    { ...valid, availability: { status: 'available', degradedParts: 'none', seamStatus: 'ok' } },
    { ...valid, resources: [{ metadata: 'only' }] },
    null,
  ]
  for (const record of negatives) {
    const result = api.sources.skillExposure.normalize(record)
    assert.equal(result.ok, false, `expected rejection for ${JSON.stringify(record)?.slice(0, 40)}`)
  }
})

test('memory source is metadata-only and always reachable', () => {
  const { api } = makeSources()
  assert.equal(api.sources.memory.status(), 'available')
})

test('compaction intake derives mappings from the delivered compaction/completed vocabulary', () => {
  const marker = { [COMPACTION_EVENTS_CONTRACT_SYMBOL]: true }
  const { api, ctx, received } = makeSources({ services: { compaction: marker } })
  assert.equal(api.sources.compaction.status(), 'available')
  ctx.emit('compaction/completed', {
    session: { id: 'session-1' },
    agent: { session: { id: 'ignored' } },
    trigger: 'pressure',
    result: {
      compactionId: 'c-42',
      shadowedSeqs: [10, 11, 12],
      summarySeq: 13,
    },
  })
  assert.equal(received.mappings.length, 1)
  const mapping = received.mappings[0]
  assert.equal(mapping.sessionId, 'session-1')
  assert.deepEqual(mapping.seqs, [10, 11, 12])
  assert.equal(mapping.newNodeId, 'compaction:c-42')
  assert.equal(mapping.reason, 'compacted')
  assert.equal(mapping.generation, 'c-42')
  assert.equal(mapping.observedAt, '2026-08-26T10:00:00.000Z')
})

test('compaction intake ignores malformed or empty payloads without fabricating mappings', () => {
  const marker = { [COMPACTION_EVENTS_CONTRACT_SYMBOL]: true }
  const { api, ctx, received } = makeSources({ services: { compaction: marker } })
  assert.equal(api.sources.compaction.status(), 'available')
  ctx.emit('compaction/completed', { session: {}, result: null })
  ctx.emit('compaction/completed', { session: { id: 's' }, result: { compactionId: 'c' } })
  ctx.emit('compaction/completed', { session: { id: 's' }, result: { compactionId: 'c', shadowedSeqs: [] } })
  ctx.emit('compaction/completed', { session: { id: 's' }, result: { compactionId: 'c', shadowedSeqs: ['a'] } })
  assert.equal(received.mappings.length, 0)
})

test('compaction status follows the delivered contract marker', () => {
  const plain = makeSources({ services: { compaction: {} } })
  assert.equal(plain.api.sources.compaction.status(), 'unavailable')
  const flagged = makeSources({ services: { compaction: { [COMPACTION_EVENTS_CONTRACT_SYMBOL]: false } } })
  assert.equal(flagged.api.sources.compaction.status(), 'unavailable')
})

test('evidence adapter subscribes to the R-row event and forwards payloads contained', () => {
  const payload = {
    sessionId: 'session-1',
    generation: 2,
    systemSections: [{ sectionKey: 'a', sourceTags: [] }],
    messageRanges: [],
    dropped: [],
    observedAt: '2026-08-26T10:00:00.000Z',
  }
  const { api, ctx, received } = makeSources({ evidenceActive: () => true })
  assert.equal(api.evidence.status(), 'available')
  ctx.emit('agent-loop/assembled-context', payload)
  assert.deepEqual(received.evidence, [payload])
  // a throwing intake is swallowed and attributed
  const exploding = makeSources({
    evidenceActive: () => true,
    onEvidence: () => { throw new Error('intake exploded') },
  })
  exploding.ctx.emit('agent-loop/assembled-context', payload)
  assert.equal(exploding.received.evidence.length, 0)
  assert.ok(exploding.received.diagnostics.some((d) => d.includes('evidence intake failed')))
})

test('evidence status follows the injected marker/version gate', () => {
  const inactive = makeSources()
  assert.equal(inactive.api.evidence.status(), 'unavailable')
  const active = makeSources({ evidenceActive: () => true })
  assert.equal(active.api.evidence.status(), 'available')
})

test('availability reports every source and the sent reachability flag', () => {
  const { api } = makeSources({
    services: { compaction: { [COMPACTION_EVENTS_CONTRACT_SYMBOL]: true } },
    featureRegistry: { isActive: (name) => name === 'toolDiscovery' },
    evidenceActive: () => true,
  })
  const availability = api.availability()
  assert.equal(availability.sources.systemPrompt, 'unavailable')
  assert.equal(availability.sources.sessionSurface, 'unavailable')
  assert.equal(availability.sources.compaction, 'available')
  assert.equal(availability.sources.toolExposure, 'available')
  assert.equal(availability.sources.skillExposure, 'unavailable')
  assert.equal(availability.sources.memory, 'available')
  assert.equal(availability.sources.assembledEvidence, 'available')
  assert.equal(availability.sentReachable, true)
})

test('dispose detaches both subscriptions and is idempotent', () => {
  const { api, ctx, received } = makeSources({
    services: { compaction: { [COMPACTION_EVENTS_CONTRACT_SYMBOL]: true } },
    evidenceActive: () => true,
  })
  api.dispose()
  api.dispose()
  ctx.emit('compaction/completed', {
    session: { id: 's' },
    result: { compactionId: 'c', shadowedSeqs: [1] },
  })
  ctx.emit('agent-loop/assembled-context', { sessionId: 's', generation: 1, systemSections: [], messageRanges: [], dropped: [], observedAt: '2026-08-26T10:00:00.000Z' })
  assert.equal(received.mappings.length, 0)
  assert.equal(received.evidence.length, 0)
})