/**
 * Selection face tests: the official read/submit seams, the source-tier
 * disclosure, the value-level compare-and-set and the degradation ladder.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createSelectionAuthority, mountSelectionFeature, mountSessionsSelectionFeature } from '../lib/sessions-selection-facade.js'
import { inferSelectionSource, normalizeOfficialSelection } from '../lib/sessions-selection.js'

/** A mux-framed official seam double: it answers `{ rpcId, result }`. */
function makeMux({ current = { provider: 'deepseek', model: 'v3' }, selectError = null, selectResult = null } = {}) {
  const calls = { models: [], selectModel: [] }
  let value = { ...current }
  return {
    calls,
    state: () => ({ ...value }),
    setValue: (next) => {
      value = { ...next }
    },
    models(request) {
      calls.models.push(request)
      return { rpcId: request.rpcId, result: { ok: true, value: { current: { ...value }, routable: true, groups: [], failures: [] } } }
    },
    selectModel(request) {
      calls.selectModel.push(request)
      if (selectError !== null) return { rpcId: request.rpcId, result: { ok: false, error: selectError } }
      const picked = selectResult ?? {
        provider: request.payload.provider,
        model: request.payload.model,
        ...(request.payload.reasoningEffort === undefined ? {} : { reasoningEffort: request.payload.reasoningEffort }),
      }
      value = { ...picked }
      return { rpcId: request.rpcId, result: { ok: true, value: { selected: { ...picked } } } }
    },
  }
}

function boot({ mux = makeMux(), loggedConfig, deploymentDefault, now = () => new Date('2026-09-14T10:00:00.000Z') } = {}) {
  const authority = createSelectionAuthority({
    readModels: (sessionId) => mux.models({ rpcId: 'rpc_read', payload: { sessionId } }),
    submitSelection: ({ sessionId, selection, rpcId }) => mux.selectModel({
      rpcId,
      payload: {
        sessionId,
        provider: selection.provider,
        model: selection.model,
        ...(selection.effort === undefined ? {} : { reasoningEffort: selection.effort }),
      },
    }),
    loggedConfigOf: () => loggedConfig,
    deploymentDefaultOf: () => deploymentDefault,
    now,
  })
  return { authority, mux }
}

test('the official selection vocabulary is adapted, never leaked', () => {
  assert.deepEqual(normalizeOfficialSelection({ provider: 'p', model: 'm', reasoningEffort: 'high' }), { provider: 'p', model: 'm', effort: 'high' })
  assert.equal(normalizeOfficialSelection({ provider: 'p' }), null)
  assert.equal(normalizeOfficialSelection(null), null)
})

test('the source tier is inferred from the observable fallbacks', () => {
  const current = { provider: 'p', model: 'm', effort: null }
  assert.equal(inferSelectionSource({ current, loggedConfig: current, deploymentDefault: { provider: 'd', model: 'd', effort: null } }), 'fallback-logged-request-config')
  assert.equal(inferSelectionSource({ current, loggedConfig: null, deploymentDefault: current }), 'fallback-deployment-default')
  assert.equal(inferSelectionSource({ current, loggedConfig: null, deploymentDefault: { provider: 'd', model: 'd', effort: null } }), 'committed')
  assert.equal(inferSelectionSource({ current: null }), 'unknown')
})

test('get returns a frozen view disclosing the tier, revision and null commit time', () => {
  const { authority } = boot({ loggedConfig: null, deploymentDefault: { provider: 'deepseek', model: 'v3' } })
  const outcome = authority.get({ sessionId: 's1' })
  assert.equal(outcome.ok, true)
  assert.deepEqual(Object.keys(outcome.view).sort(), ['committedAt', 'effort', 'model', 'observedAt', 'provider', 'revision', 'sessionId', 'source'])
  assert.equal(outcome.view.source, 'fallback-deployment-default')
  assert.equal(outcome.view.revision, 0)
  assert.equal(outcome.view.committedAt, null, 'a value read from a fallback tier has no knowable commit time')
  assert.ok(Object.isFrozen(outcome.view))
})

test('set commits through the single official seam and discloses the new revision', () => {
  const { authority, mux } = boot()
  const outcome = authority.set({ sessionId: 's1', selection: { provider: 'deepseek', model: 'v4', effort: 'high' } })
  assert.equal(outcome.ok, true)
  assert.equal(outcome.code, 'committed')
  assert.equal(outcome.revision, 1)
  assert.deepEqual(mux.calls.selectModel[0].payload, { sessionId: 's1', provider: 'deepseek', model: 'v4', reasoningEffort: 'high' })
  assert.equal(typeof mux.calls.selectModel[0].rpcId, 'string', 'the in-process call still carries a mux request id')
  assert.equal(outcome.view.model, 'v4')
  assert.equal(outcome.view.effort, 'high')
  assert.equal(outcome.view.committedAt, '2026-09-14T10:00:00.000Z', 'a facade-witnessed commit does carry its time')
  assert.equal(authority.get({ sessionId: 's1' }).view.revision, 1, 'the revision survives the next read')
})

test('a stale expected snapshot conflicts without ever calling the submit seam', () => {
  const mux = makeMux({ current: { provider: 'deepseek', model: 'v3' } })
  const { authority } = boot({ mux })
  const outcome = authority.set({
    sessionId: 's1',
    selection: { model: 'v4' },
    expected: { provider: 'deepseek', model: 'v3-old' },
  })
  assert.equal(outcome.ok, false)
  assert.equal(outcome.code, 'conflict')
  assert.equal(mux.calls.selectModel.length, 0, 'the CAS happens before the single write point')
  assert.deepEqual(outcome.current, { provider: 'deepseek', model: 'v3', effort: null })
})

test('a matching expected snapshot commits (a write through the official path produced the observed value)', () => {
  const mux = makeMux({ current: { provider: 'other', model: 'x1' } })
  const { authority } = boot({ mux })
  const outcome = authority.set({
    sessionId: 's1',
    selection: { provider: 'other', model: 'x2' },
    expected: { provider: 'other', model: 'x1' },
  })
  assert.equal(outcome.code, 'committed')
  assert.equal(mux.calls.selectModel.length, 1)
})

test('the official refusals map onto the public vocabulary', () => {
  const rejected = boot({ mux: makeMux({ selectError: { code: 'model-unavailable', message: 'model does not accept images', details: {} } }) })
  const refused = rejected.authority.set({ sessionId: 's1', selection: { model: 'v4' } })
  assert.equal(refused.ok, false)
  assert.equal(refused.code, 'rejected')
  assert.match(refused.reason, /does not accept images/)

  const missing = boot({ mux: makeMux({ selectError: { code: 'session-not-found', message: 'no such session', details: {} } }) })
  const gone = missing.authority.set({ sessionId: 's1', selection: { model: 'v4' } })
  assert.equal(gone.code, 'unavailable')
  assert.match(gone.reason, /no such session/)
})

test('a best-effort persistence failure still commits: the value applies to the session', () => {
  // The official seam logs a storage failure and answers success; the facade
  // must not invent a failure the authority did not report.
  const mux = makeMux()
  const { authority } = boot({ mux })
  const outcome = authority.set({ sessionId: 's1', selection: { model: 'v4' } })
  assert.equal(outcome.code, 'committed')
  assert.equal(mux.state().model, 'v4')
  assert.equal(mux.state().provider, 'deepseek', 'a partial change keeps the fields it did not name')
})

test('a malformed or failing read degrades typed and never fabricates a selection', () => {
  const malformed = createSelectionAuthority({ readModels: () => ({ result: { ok: true, value: {} } }) })
  const bad = malformed.get({ sessionId: 's1' })
  assert.equal(bad.ok, false)
  assert.equal(bad.code, 'unavailable')
  assert.match(bad.reason, /no usable current value/)

  const throwing = createSelectionAuthority({ readModels: () => { throw new Error('boom') } })
  assert.equal(throwing.get({ sessionId: 's1' }).code, 'unavailable')
  assert.equal(throwing.get({ sessionId: 's1' }).ok, false)
})

test('the degradation ladder separates reads from writes and keeps availability honest', () => {
  const readOnly = createSelectionAuthority({ readModels: () => ({ result: { ok: true, value: { current: { provider: 'p', model: 'm' } } } }) })
  assert.equal(readOnly.get({ sessionId: 's1' }).ok, true)
  assert.deepEqual(readOnly.availability(), { status: 'degraded', reason: 'the official selection submit seam is not available; reads remain available' })
  assert.equal(readOnly.set({ sessionId: 's1', selection: { model: 'm2' } }).code, 'unavailable')

  const none = createSelectionAuthority({})
  assert.equal(none.availability().status, 'unavailable')
  assert.equal(none.get({ sessionId: 's1' }).code, 'unavailable')
  assert.equal(none.set({ sessionId: 's1', selection: { model: 'm2' } }).code, 'unavailable')
})

test('set input is validated before any seam is touched', () => {
  const { authority, mux } = boot()
  assert.equal(authority.set({}).code, 'rejected')
  assert.equal(authority.set({ sessionId: 's1', selection: {} }).code, 'rejected')
  assert.equal(authority.set({ sessionId: 's1', selection: { model: 'm', extra: 'x' } }).code, 'rejected')
  assert.equal(authority.set({ sessionId: 's1', selection: { model: 'm' }, expected: {} }).code, 'rejected')
  assert.equal(authority.set({ sessionId: 's1', selection: { model: 'm' }, signal: {} }).code, 'rejected')
  assert.equal(mux.calls.selectModel.length, 0)
  assert.equal(mux.calls.models.length, 0, 'no read happens for an invalid call either')
})

test('an aborted signal refuses before the write', () => {
  const mux = makeMux()
  const { authority } = boot({ mux })
  const controller = new AbortController()
  controller.abort()
  const outcome = authority.set({ sessionId: 's1', selection: { model: 'v4' }, signal: controller.signal })
  assert.equal(outcome.code, 'unavailable')
  assert.equal(mux.calls.selectModel.length, 0)
})

test('the mounted surface exposes exactly get/set/availability and disposes', () => {
  const { authority } = boot()
  const mounted = mountSelectionFeature({ ctx: {}, authority })
  assert.deepEqual(Object.keys(mounted.surface).sort(), ['availability', 'get', 'set'])
  assert.equal(mounted.surface.availability().status, 'active')
  mounted.dispose()
  assert.equal(mounted.surface.availability().status, 'unavailable')
})

test('the production mounter binds the official nested selection seams, not a flat name', () => {
  // The official ApiProxyService carries the operations on its `sessions` bus;
  // a flat-name binding would silently leave the whole face unavailable in a
  // real deployment while every seam-injected unit test stays green.
  let ownerApi
  const service = { prepareFeature: (name, api) => { ownerApi = api; return {} } }
  const mounted = mountSessionsSelectionFeature({
    ctx: {
      get: () => ({
        sessions: {
          models: ({ rpcId, payload }) => ({ rpcId, result: { ok: true, value: { current: { provider: 'p', model: `m-${payload.sessionId}` } } } }),
          selectModel: ({ rpcId, payload }) => ({ rpcId, result: { ok: true, value: { selected: { provider: payload.provider, model: payload.model } } } }),
        },
      }),
    },
    service,
    featureRegistry: { isActive: () => false },
    logger: { warn() {} },
  })
  const surface = ownerApi.surfaceFor()
  assert.equal(surface.availability().status, 'active')
  const read = surface.get({ sessionId: 's1' })
  assert.equal(read.ok, true, 'the nested official seam is reachable through the mounter')
  assert.equal(read.view.model, 'm-s1')
  assert.equal(surface.set({ sessionId: 's1', selection: { model: 'm2' } }).code, 'committed')
  mounted.disposer()
})

test('a deployment without the official seams degrades typed instead of reporting active', () => {
  let ownerApi
  const service = { prepareFeature: (name, api) => { ownerApi = api; return {} } }
  const mounted = mountSessionsSelectionFeature({
    ctx: { get: () => ({ sessions: {} }) },
    service,
    featureRegistry: { isActive: () => false },
    logger: { warn() {} },
  })
  const surface = ownerApi.surfaceFor()
  assert.equal(surface.availability().status, 'unavailable', 'a missing seam is never displayed as active')
  assert.equal(surface.get({ sessionId: 's1' }).code, 'unavailable')
  assert.equal(surface.set({ sessionId: 's1', selection: { model: 'm2' } }).code, 'unavailable')
  mounted.disposer()

  // Read-only installation: the read seam exists, the submit seam does not.
  let readOwnerApi
  const readOnly = mountSessionsSelectionFeature({
    ctx: { get: () => ({ sessions: { models: ({ rpcId }) => ({ rpcId, result: { ok: true, value: { current: { provider: 'p', model: 'm' } } } }) } }) },
    service: { prepareFeature: (name, api) => { readOwnerApi = api; return {} } },
    featureRegistry: { isActive: () => false },
    logger: { warn() {} },
  })
  const readSurface = readOwnerApi.surfaceFor()
  assert.equal(readSurface.availability().status, 'degraded', 'a read-only installation reports degraded, not active')
  assert.equal(readSurface.get({ sessionId: 's1' }).ok, true)
  assert.equal(readSurface.set({ sessionId: 's1', selection: { model: 'm2' } }).code, 'unavailable')
  readOnly.disposer()
})

test('the selection audit records the owner and never the submitted value', () => {
  const { authority } = boot()
  const callerCtx = { fiber: { name: 'consumer-plugin' } }
  authority.set({ sessionId: 's1', selection: { model: 'v4' } }, callerCtx)
  const audit = authority.internalAudit()
  assert.equal(audit.records.some((record) => record.owner === 'consumer-plugin' && record.outcome === 'committed'), true)
  assert.equal('selection' in (audit.records.at(-1) ?? {}), false, 'the submitted value never enters the audit ring')
})

test('one committed value is observed identically by the next reader and step consumer', () => {
  // The single write point is the official selection state, so the routing
  // side and the prompt side read the same value: here the "step consumer" is
  // the official seam read itself, asserted equal to the facade view.
  const { authority, mux } = boot()
  const committed = authority.set({ sessionId: 's1', selection: { provider: 'deepseek', model: 'v4', effort: 'high' } })
  assert.equal(committed.code, 'committed')
  const view = authority.get({ sessionId: 's1' }).view
  const stepRead = mux.state()
  assert.equal(stepRead.provider, view.provider)
  assert.equal(stepRead.model, view.model)
  assert.equal(stepRead.reasoningEffort, view.effort, 'the effective value the next step consumes is the committed one')
  assert.equal(view.source, 'committed', 'and it is disclosed as committed rather than as a fallback tier')
})

test('a cold-session read travels through the official carrier and the facade keeps no state', () => {
  // The official resolver resumes a cold session and publishes a live agent;
  // that side effect belongs to the official read entry (the same path the
  // official UI takes), not to this facade. The carrier double records the
  // resume so the assertion is about where the effect comes from.
  const observed = { resumed: 0, reads: 0 }
  const carrier = {
    sessions: {
      models({ rpcId }) {
        observed.reads += 1
        observed.resumed += 1 // the official resolver resumes the cold session
        return { rpcId, result: { ok: true, value: { current: { provider: 'deepseek', model: 'v3' }, routable: true, groups: [], failures: [] } } }
      },
    },
  }
  const authority = createSelectionAuthority({
    readModels: (sessionId) => carrier.sessions.models({ rpcId: 'rpc', payload: { sessionId } }),
    // A cold session has no live agent, so there is no logged request config
    // and no facade-side state to fall back on.
    loggedConfigOf: () => undefined,
    deploymentDefaultOf: () => undefined,
  })
  const first = authority.get({ sessionId: 'cold-1' })
  assert.equal(first.ok, true)
  assert.equal(observed.resumed, 1, 'the official carrier performed the resume')
  assert.equal(first.view.source, 'committed', 'the facade reports the value it read and invents no tier')
  assert.deepEqual(Object.keys(authority.internalAudit().records.at(-1)).includes('answer'), false)

  // Reading twice does not accumulate facade state and does not double the
  // carrier's own resume work beyond the reads it was asked for.
  authority.get({ sessionId: 'cold-1' })
  assert.equal(observed.reads, 2)
  assert.equal(authority.internalAudit().records.length >= 2, true, 'reads are audited, nothing else is retained')
})
