import test from 'node:test'
import assert from 'node:assert/strict'
import { createDiagnosticsOwner } from '../lib/diagnostics.js'
import { createFeatureRegistry } from '../lib/feature-registry.js'

function createOwner(options = {}) {
  const registry = options.registry ?? createFeatureRegistry()
  const logs = []
  const logger = {
    error(message) { logs.push(['error', message]) },
    warn(message) { logs.push(['warn', message]) },
    info(message) { logs.push(['info', message]) },
  }
  const owner = createDiagnosticsOwner({
    ctx: {},
    logger,
    coreActive: options.coreActive ?? (() => true),
    registry,
    publication: options.publication,
    probeTimeoutMs: options.probeTimeoutMs ?? 60,
  })
  return { owner, api: owner.api, registry, logs }
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve))
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

/* ------------------------------- 注册与所有权 ------------------------------ */

test('register validates required identity and run function', () => {
  const { api } = createOwner()
  assert.throws(() => api.register({}), TypeError)
  assert.throws(() => api.register({ ownerId: 'a', checkId: 'b', scope: 'plugin' }), TypeError)
  assert.throws(() => api.register({ ownerId: 'a', checkId: 'b', scope: 'bogus', run() {} }), TypeError)
  assert.throws(() => api.register({ ownerId: 'a', checkId: 'b', run() {} }), TypeError)
})

test('register exposes only the projection surface (no durable mutation face)', () => {
  const { api } = createOwner()
  assert.deepEqual(Object.keys(api).sort(), ['get', 'onChange', 'register'])
})

test('a registration is immediately observable as pending, then settles', async () => {
  const { api } = createOwner()
  let release
  const gate = new Promise((resolve) => { release = resolve })
  api.register({
    ownerId: 'o', checkId: 'c', scope: 'plugin',
    run() { return gate.then(() => ({ health: 'healthy', availability: 'active' })) },
  })
  const before = api.get({ scope: 'plugin' })
  assert.equal(before.checks[0].health, 'pending')
  release()
  await settle()
  const after = api.get({ scope: 'plugin' })
  assert.equal(after.checks[0].health, 'healthy')
  assert.equal(after.checks[0].availability, 'active')
  assert.equal(after.state, 'healthy')
})

test('duplicate same-owner same-check is latest-wins and only touches this owner', async () => {
  const { api, logs } = createOwner()
  let value = 'first'
  const disposer = api.register({
    ownerId: 'o', checkId: 'c', scope: 'plugin',
    run() { return { health: 'healthy', availability: value === 'first' ? 'active' : 'inactive' } },
  })
  await settle()
  assert.equal(api.get({ scope: 'plugin', ownerId: 'o' }).checks[0].availability, 'active')

  value = 'second'
  const disposer2 = api.register({ ownerId: 'o', checkId: 'c', scope: 'plugin', run() { return { health: 'degraded', availability: 'inactive' } } })
  await settle()
  assert.equal(api.get({ scope: 'plugin', ownerId: 'o' }).checks.length, 1)
  assert.equal(api.get({ scope: 'plugin', ownerId: 'o' }).checks[0].health, 'degraded')
  // The old disposer is identity-bound and no longer removes the newer generation.
  assert.equal(disposer(), false)
  assert.equal(disposer2(), true)
  // Replacement is reported (bounded conflict log).
  assert.ok(logs.some(([level, message]) => level === 'info' && message.includes('latest-wins')))
})

test('cross-owner isolation: another owner is never disposed by a duplicate', async () => {
  const { api } = createOwner()
  api.register({ ownerId: 'o1', checkId: 'c', scope: 'plugin', run() { return { health: 'healthy', availability: 'active' } } })
  const o2 = api.register({ ownerId: 'o2', checkId: 'c', scope: 'plugin', run() { return { health: 'degraded', availability: 'inactive' } } })
  await settle()
  api.register({ ownerId: 'o1', checkId: 'c', scope: 'plugin', run() { return { health: 'failed', availability: 'unavailable' } } })
  await settle()
  assert.equal(api.get({ scope: 'plugin', ownerId: 'o1' }).checks.length, 1)
  assert.equal(api.get({ scope: 'plugin', ownerId: 'o2' }).checks.length, 1)
  assert.equal(o2(), true) // o2's check still live and disposable by its own disposer
})

test('disposer is idempotent and removes only the owned check', async () => {
  const { api } = createOwner()
  const a = api.register({ ownerId: 'o', checkId: 'a', scope: 'plugin', run() { return { health: 'healthy', availability: 'active' } } })
  const b = api.register({ ownerId: 'o', checkId: 'b', scope: 'plugin', run() { return { health: 'degraded', availability: 'inactive' } } })
  await settle()
  assert.equal(a(), true)
  assert.equal(a(), false)
  const view = api.get({ scope: 'plugin' })
  assert.deepEqual(view.checks.map((c) => c.checkId).sort(), ['b'])
  assert.equal(b(), true)
})

test('a late callback after disposal loses publication and cannot remove a newer generation', async () => {
  const { api } = createOwner()
  let release
  const late = new Promise((resolve) => { release = resolve })
  const disposer = api.register({
    ownerId: 'o', checkId: 'slow', scope: 'plugin',
    run() { return late.then(() => ({ health: 'healthy', availability: 'active' })) },
  })
  await settle()
  disposer()
  release({ health: 'healthy', availability: 'active' })
  // The newer generation (re-registered after dispose) must not be removed.
  const newer = api.register({ ownerId: 'o', checkId: 'slow', scope: 'plugin', run() { return { health: 'degraded', availability: 'inactive' } } })
  await settle()
  assert.equal(api.get({ scope: 'plugin', ownerId: 'o' }).checks.length, 1)
  assert.equal(api.get({ scope: 'plugin', ownerId: 'o' }).checks[0].health, 'degraded')
  assert.equal(newer(), true)
})

/* --------------------------- 探针行为（失败隔离 / 取消 / 重试） ------------------------------ */

test('a throwing or rejecting probe fails only that check', async () => {
  const { api } = createOwner()
  api.register({ ownerId: 'o', checkId: 'bad', scope: 'plugin', run() { throw new Error('probe exploded') } })
  api.register({ ownerId: 'o', checkId: 'good', scope: 'plugin', run() { return { health: 'healthy', availability: 'active' } } })
  await settle()
  const view = api.get({ scope: 'plugin' })
  const bad = view.checks.find((c) => c.checkId === 'bad')
  const good = view.checks.find((c) => c.checkId === 'good')
  assert.equal(bad.health, 'failed')
  assert.equal(bad.availability, 'unavailable')
  assert.equal(bad.reason.code, 'probe-failed')
  assert.equal(good.health, 'healthy')
})

test('an undefined/no-result probe is explicit unknown/unavailable, never healthy', async () => {
  const { api } = createOwner()
  api.register({ ownerId: 'o', checkId: 'nul', scope: 'plugin', run() { return undefined } })
  await settle()
  const check = api.get({ scope: 'plugin' }).checks[0]
  assert.equal(check.health, 'unknown')
  assert.equal(check.availability, 'unavailable')
  assert.equal(check.reason.code, 'no-result')
})

test('an invalid result is a contained failed/unavailable check', async () => {
  const { api } = createOwner()
  api.register({ ownerId: 'o', checkId: 'inv', scope: 'plugin', run() { return { health: 'superhero' } } })
  await settle()
  const check = api.get({ scope: 'plugin' }).checks[0]
  assert.equal(check.health, 'failed')
  assert.equal(check.availability, 'unavailable')
  assert.equal(check.reason.code, 'invalid-result')
})

test('an unresolved slow probe times out to probe-timeout without affecting others', async () => {
  const { api } = createOwner({ probeTimeoutMs: 30 })
  api.register({ ownerId: 'o', checkId: 'slow', scope: 'plugin', run() { return new Promise(() => {}) } })
  api.register({ ownerId: 'o', checkId: 'fast', scope: 'plugin', run() { return { health: 'healthy', availability: 'active' } } })
  await sleep(60)
  await settle()
  const view = api.get({ scope: 'plugin' })
  assert.equal(view.checks.find((c) => c.checkId === 'slow').reason.code, 'probe-timeout')
  assert.equal(view.checks.find((c) => c.checkId === 'fast').health, 'healthy')
})

test('declared transient retry is bounded; undeclared is never retried', async () => {
  const { api } = createOwner()
  let declaredCalls = 0
  api.register({
    ownerId: 'o', checkId: 'declared', scope: 'plugin', retry: { declared: true, maxAttempts: 2 },
    run() {
      declaredCalls += 1
      if (declaredCalls === 1) return Promise.reject(new Error('transient'))
      return Promise.resolve({ health: 'healthy', availability: 'active' })
    },
  })
  let undeclaredCalls = 0
  api.register({
    ownerId: 'o', checkId: 'undeclared', scope: 'plugin',
    run() {
      undeclaredCalls += 1
      return Promise.reject(new Error('boom'))
    },
  })
  await settle()
  assert.equal(declaredCalls, 2)
  assert.equal(api.get({ scope: 'plugin', ownerId: 'o' }).checks.find((c) => c.checkId === 'declared').health, 'healthy')
  assert.equal(undeclaredCalls, 1)
  assert.equal(api.get({ scope: 'plugin' }).checks.find((c) => c.checkId === 'undeclared').reason.code, 'probe-failed')
})

test('a stale result after re-registration never overwrites the newer generation', async () => {
  const { api } = createOwner()
  let release
  const pending = new Promise((resolve) => { release = resolve })
  const early = api.register({
    ownerId: 'o', checkId: 'c', scope: 'plugin',
    run() { return pending.then(() => ({ health: 'healthy', availability: 'active' })) },
  })
  await settle()
  api.register({ ownerId: 'o', checkId: 'c', scope: 'plugin', run() { return { health: 'failed', availability: 'unavailable' } } })
  await settle()
  release({ health: 'healthy', availability: 'active' })
  await settle()
  assert.equal(api.get({ scope: 'plugin' }).checks.length, 1)
  assert.equal(api.get({ scope: 'plugin' }).checks[0].health, 'failed')
  assert.equal(early(), false) // old disposer identity-bound
})

/* ------------------------ 快照模型 / 范围查询 / 证据 ----------------------- */

test('snapshots expose the full structured model and are read-only', async () => {
  const { api } = createOwner()
  api.register({
    ownerId: 'o', checkId: 'c', scope: 'plugin',
    dependencies: [{ id: 'llm', status: 'absent', evidence: { package: 'dsh-llm', version: '1.2.3' } }],
    run() {
      return {
        health: 'degraded',
        availability: 'degraded-active',
        severity: 'warning',
        blocking: 'non-blocking',
        evidence: { package: 'dsh-llm', version: '1.2.3', runtime: '0.1.0', capability: 'stream' },
        reason: { code: 'mismatch', category: 'version', boundedDetail: 'installed 1.2.3 needed 2.0.0' },
        remediation: { actionId: 'upgrade', prerequisite: 'network', mode: 'manual' },
        uncertainty: 'observed',
      }
    },
  })
  await settle()
  const check = api.get({ scope: 'plugin' }).checks[0]
  assert.equal(check.ownerId, 'o')
  assert.equal(check.checkId, 'c')
  assert.equal(check.scope, 'plugin')
  assert.equal(check.health, 'degraded')
  assert.equal(check.availability, 'degraded-active')
  assert.equal(check.severity, 'warning')
  assert.equal(check.blocking, 'non-blocking')
  assert.equal(check.uncertainty, 'observed')
  assert.match(check.generation, /^g-/)
  assert.ok(check.firstObservedAt)
  assert.ok(check.lastUpdatedAt)
  assert.deepEqual(check.dependencies, [{ id: 'llm', status: 'absent', evidence: { package: 'dsh-llm', version: '1.2.3' } }])
  assert.deepEqual(check.evidence, { package: 'dsh-llm', version: '1.2.3', runtime: '0.1.0', capability: 'stream' })
  assert.deepEqual(check.reason, { code: 'mismatch', category: 'version', boundedDetail: 'installed 1.2.3 needed 2.0.0' })
  assert.deepEqual(check.remediation, { actionId: 'upgrade', prerequisite: 'network', mode: 'manual' })
  assert.equal(Object.isFrozen(check), true)
  assert.equal(Object.isFrozen(check.dependencies), true)
  assert.equal(Object.isFrozen(check.reason), true)
})

test('health and availability are separate and never alias', async () => {
  const { api } = createOwner()
  api.register({ ownerId: 'o', checkId: 'c', scope: 'plugin', run() { return { health: 'healthy', availability: 'unavailable' } } })
  await settle()
  const check = api.get({ scope: 'plugin' }).checks[0]
  // loaded but unusable must not look like an available capability
  assert.equal(check.health, 'healthy')
  assert.equal(check.availability, 'unavailable')
  assert.notEqual(check.health, check.availability)
})

test('scope filtering and explicit empty/unknown results', async () => {
  const { api } = createOwner()
  api.register({ ownerId: 'o', checkId: 'boot', scope: 'boot', run() { return { health: 'healthy', availability: 'active' } } })
  api.register({ ownerId: 'o', checkId: 'plug', scope: 'plugin', run() { return { health: 'degraded', availability: 'inactive' } } })
  await settle()
  const boot = api.get({ scope: 'boot' })
  assert.equal(boot.scope, 'boot')
  assert.equal(boot.checks.length, 1)
  assert.equal(boot.checks[0].checkId, 'boot')
  assert.equal(boot.checks.some((c) => c.checkId === 'plug'), false)
  const empty = api.get({ scope: 'client' })
  assert.deepEqual(empty.checks, [])
  assert.equal(empty.state, 'unknown')
})

test('host scope includes a bounded facade aggregate with disabled-capability evidence', async () => {
  const registry = createFeatureRegistry()
  registry.mount('tools')
  registry.disable('llm', 'missing substrate')
  const { api } = createOwner({ registry })
  const view = api.get({ scope: 'host' })
  const facade = view.checks.find((c) => c.ownerId === 'facade')
  assert.ok(facade)
  assert.equal(facade.checkId, 'plugin-api-facade')
  assert.equal(facade.health, 'healthy')
  assert.equal(facade.availability, 'active')
  assert.equal(facade.reason.code, 'capability-unavailable')
  assert.match(facade.reason.boundedDetail, /llm:missing substrate/)
  assert.deepEqual(facade.evidence, { capability: 'plugin-api-facade' })
})

test('audience projection keeps or drops internal detail without ever leaking secrets', () => {
  const { api } = createOwner()
  api.register({
    ownerId: 'o', checkId: 'c', scope: 'plugin',
    run() {
      return {
        health: 'failed',
        availability: 'unavailable',
        evidence: { package: 'p', token: 'secret-here' },
        reason: { code: 'x', category: 'cat', boundedDetail: 'internal detail' },
        remediation: { actionId: 'fix', mode: 'manual' },
      }
    },
  })
  const operator = api.get({ scope: 'plugin', audience: 'operator' }).checks[0]
  assert.deepEqual(operator.evidence, { package: 'p' })
  assert.deepEqual(operator.reason, { code: 'x', category: 'cat', boundedDetail: 'internal detail' })
  assert.ok(operator.remediation)
  const consumer = api.get({ scope: 'plugin', audience: 'consumer' }).checks[0]
  assert.equal(consumer.evidence, undefined)
  assert.equal(consumer.remediation, undefined)
  assert.deepEqual(consumer.reason, { code: 'x' })
  assert.equal(JSON.stringify(consumer).includes('secret-here'), false)
  assert.equal(JSON.stringify(operator).includes('secret-here'), false)
})

/* -------------------------------- 变更通知 -------------------------------- */

test('onChange delivers one notification with immutable snapshot and a per-subscriber epoch', async () => {
  const { api } = createOwner()
  const events = []
  const offA = api.onChange({ scope: 'plugin' }, (payload) => events.push(['a', payload]))
  const offB = api.onChange({ scope: 'plugin', ownerId: 'o' }, (payload) => events.push(['b', payload]))
  api.register({ ownerId: 'o', checkId: 'c', scope: 'plugin', run() { return { health: 'healthy', availability: 'active' } } })
  await settle()
  // ephemeral pending + terminal final coalesce into ONE notification in one window
  assert.equal(events.length, 2) // one per subscriber
  assert.deepEqual(events[0][1].snapshot, events[1][1].snapshot)
  assert.equal(events[0][1].snapshot, events[1][1].snapshot) // same committed reference
  assert.equal(events[0][1].observerEpoch !== events[1][1].observerEpoch, true)
  assert.equal('observerEpoch' in events[0][1].snapshot, false) // epoch is delivery metadata only
  assert.equal(Object.isFrozen(events[0][1].snapshot), true)
  offA()
  offB()
})

test('equivalent updates are coalesced and do not loop', async () => {
  const harness = createPublicationHarness()
  const { api } = createOwner({ publication: harness })
  const notifications = []
  api.onChange({ scope: 'client' }, (payload) => notifications.push(payload.observerEpoch))
  harness.clientReport('degraded-active')
  await settle()
  assert.equal(notifications.length, 1)
  // an equivalent re-signal in the same generation is a no-op (coalesced)
  harness.clientReport('degraded-active')
  await settle()
  assert.equal(notifications.length, 1)
  // a changed value produces exactly one more contained notification
  harness.clientReport('active')
  await settle()
  assert.equal(notifications.length, 2)
})

test('a throwing listener is contained and other listeners still receive', async () => {
  const { api } = createOwner()
  const seen = []
  api.onChange({ scope: 'plugin' }, () => { throw new Error('listener exploded') })
  api.onChange({ scope: 'plugin' }, (payload) => seen.push(payload))
  api.register({ ownerId: 'o', checkId: 'c', scope: 'plugin', run() { return { health: 'healthy', availability: 'active' } } })
  await settle()
  assert.equal(seen.length, 1)
})

test('subscriber disposer removes only its own listener', async () => {
  const { api } = createOwner()
  const notifications = []
  const first = api.onChange({ scope: 'plugin' }, () => notifications.push('first'))
  api.onChange({ scope: 'plugin' }, () => notifications.push('second'))
  api.register({ ownerId: 'o', checkId: 'c', scope: 'plugin', run() { return { health: 'healthy', availability: 'active' } } })
  await settle()
  assert.deepEqual(notifications, ['first', 'second']) // insertion order
  assert.equal(first(), true)
  assert.equal(first(), false)
  notifications.length = 0
  api.register({ ownerId: 'o', checkId: 'd', scope: 'plugin', run() { return { health: 'degraded', availability: 'inactive' } } })
  await settle()
  assert.deepEqual(notifications, ['second'])
})

/* ----------------------------- client publication（可选出版） -------------------------- */

function createPublicationHarness(overrides = {}) {
  const published = []
  let reportHandler = null
  const harness = {
    published,
    clientReport(availability) {
      if (!reportHandler) throw new Error('no client report handler')
      reportHandler({ availability })
    },
    onClientReport(handler) {
      reportHandler = handler
      return () => { reportHandler = null }
    },
    available() { return true },
    publish(payload) { published.push(payload) },
    ...overrides,
  }
  return harness
}

test('no publication channel yields explicit unavailable client while host stays active', async () => {
  const { api } = createOwner()
  api.register({ ownerId: 'o', checkId: 'c', scope: 'plugin', run() { return { health: 'healthy', availability: 'active' } } })
  await settle()
  assert.equal(api.get({ scope: 'plugin' }).state, 'healthy')
  assert.equal(api.get({ scope: 'client' }).state, 'unknown')
})

test('optional client publication sends a versioned redacted host snapshot on init and change', async () => {
  const harness = createPublicationHarness()
  const { api } = createOwner({ publication: harness })
  assert.equal(harness.published.length >= 1, true)
  const initial = harness.published[0]
  assert.equal(initial.version, 1)
  assert.equal(initial.scope, 'client')
  assert.equal(initial.clientAvailability, 'unknown')
  assert.equal(initial.snapshot.scope, 'host')
  assert.equal(initial.snapshot.state, 'healthy')

  // A committed host-scope change triggers a re-publication, fully redacted.
  const before = harness.published.length
  api.register({
    ownerId: 'o', checkId: 'host', scope: 'host',
    run() { return { health: 'healthy', availability: 'active', evidence: { package: 'p', token: 'secret' } } },
  })
  await settle()
  const afterChange = harness.published.at(-1)
  assert.equal(harness.published.length > before, true)
  assert.equal(afterChange.snapshot.state, 'healthy')
  assert.equal(JSON.stringify(afterChange).includes('secret'), false)
})

test('client-side availability report publishes only availability and rejects mutation', async () => {
  const harness = createPublicationHarness()
  const { api } = createOwner({ publication: harness })
  harness.clientReport('degraded-active')
  await settle()
  const latest = harness.published.at(-1)
  assert.equal(latest.clientAvailability, 'degraded-active')
  const clientView = api.get({ scope: 'client' })
  assert.equal(clientView.state, 'degraded')
  const check = clientView.checks[0]
  assert.equal(check.ownerId, 'client')
  assert.equal(check.checkId, 'availability')
  assert.equal(check.availability, 'degraded-active')
  assert.equal(check.health, 'unknown') // client reports availability only, never health
})

test('incompatible publication degrades to explicit client unavailable while host stays active', async () => {
  const harness = createPublicationHarness({
    available() { return false },
  })
  const { api } = createOwner({ publication: harness })
  assert.equal(harness.published.length, 0)
  api.register({ ownerId: 'o', checkId: 'c', scope: 'plugin', run() { return { health: 'healthy', availability: 'active' } } })
  await settle()
  assert.equal(api.get({ scope: 'plugin' }).state, 'healthy')
})

test('a breaking publication never throws and host diagnostics remain readable', async () => {
  const harness = createPublicationHarness({
    publish() { throw new Error('transport down') },
  })
  const { api } = createOwner({ publication: harness })
  api.register({ ownerId: 'o', checkId: 'c', scope: 'plugin', run() { return { health: 'healthy', availability: 'active' } } })
  await settle()
  assert.equal(api.get({ scope: 'plugin' }).state, 'healthy')
  // further publishes are suppressed, no loop
  api.register({ ownerId: 'o', checkId: 'd', scope: 'plugin', run() { return { health: 'degraded', availability: 'inactive' } } })
  await settle()
  assert.equal(api.get({ scope: 'plugin' }).state, 'degraded')
})
