import test from 'node:test'
import assert from 'node:assert/strict'
import { createExecRouteOwner } from '../lib/exec-route.js'

function createNativeCtx() {
  const listeners = []
  return {
    ctx: {
      on(name, listener, options) {
        listeners.push({ name, listener, options })
        return () => {
          const index = listeners.findIndex((entry) => entry.listener === listener)
          if (index >= 0) listeners.splice(index, 1)
        }
      },
    },
    listeners,
  }
}

function createExecution(requestContext) {
  const session = { requestContext }
  const agent = { session }
  return { exec: { agent }, agent, session }
}

function dispatchPreExecute(listeners, exec, final = () => 'continued') {
  const hooks = listeners
    .filter((entry) => entry.name === 'tools/pre-execute')
    .sort((left, right) => Number(right.options?.prepend) - Number(left.options?.prepend))

  function invoke(index) {
    if (index === hooks.length) return final()
    return hooks[index].listener(exec, () => invoke(index + 1))
  }

  return invoke(0)
}

test('captures a frozen two-property snapshot without retaining official context', () => {
  const { ctx, listeners } = createNativeCtx()
  const context = { provider: 'provider-a', model: 'model-a', contextWindow: 128_000 }
  const { exec } = createExecution(() => context)
  const owner = createExecRouteOwner({ ctx })

  dispatchPreExecute(listeners, exec)

  const snapshot = owner.routeOf(exec)
  assert.deepEqual(snapshot, { provider: 'provider-a', model: 'model-a' })
  assert.equal(Object.isFrozen(snapshot), true)
  assert.deepEqual(Object.keys(snapshot), ['provider', 'model'])
  assert.notEqual(snapshot, context)
  assert.equal(snapshot.contextWindow, undefined)
})

test('caches one route outcome per execution and never rereads later context', () => {
  const { ctx, listeners } = createNativeCtx()
  let reads = 0
  let current = { provider: 'provider-a', model: 'model-a' }
  const { exec } = createExecution(() => {
    reads += 1
    return current
  })
  const owner = createExecRouteOwner({ ctx })

  dispatchPreExecute(listeners, exec)
  const first = owner.routeOf(exec)
  current = { provider: 'provider-b', model: 'model-b' }
  dispatchPreExecute(listeners, exec)

  assert.equal(reads, 1)
  assert.equal(owner.routeOf(exec), first)
  assert.deepEqual(first, { provider: 'provider-a', model: 'model-a' })
})

test('quietly caches undefined for normal missing route states without fallback reads', () => {
  const cases = [
    () => ({}),
    () => ({ agent: {} }),
    () => ({ agent: { session: {} } }),
    () => ({ agent: { session: { requestContext: () => undefined } } }),
    () => ({ agent: { session: { requestContext: () => ({ provider: '', model: 'm' }) } } }),
    () => ({ agent: { session: { requestContext: () => ({ provider: 'p', model: 1 }) } } }),
  ]

  for (const makeExec of cases) {
    const { ctx, listeners } = createNativeCtx()
    const errors = []
    const owner = createExecRouteOwner({ ctx, logger: { error(message) { errors.push(message) } } })
    const exec = makeExec()

    dispatchPreExecute(listeners, exec)
    dispatchPreExecute(listeners, exec)

    assert.equal(owner.routeOf(exec), undefined)
    assert.equal(errors.length, 0)
  }
})

test('contains unexpected context access failure once and caches undefined', () => {
  const { ctx, listeners } = createNativeCtx()
  const errors = []
  let reads = 0
  const { exec } = createExecution(() => {
    reads += 1
    throw new Error('secret route detail')
  })
  const owner = createExecRouteOwner({ ctx, logger: { error(message) { errors.push(message) } } })

  dispatchPreExecute(listeners, exec)
  dispatchPreExecute(listeners, exec)

  assert.equal(owner.routeOf(exec), undefined)
  assert.equal(reads, 1)
  assert.deepEqual(errors, ['dsh-plugin-api plugin-api-exec-route-m2 tools/pre-execute resolution-failure'])
  assert.doesNotMatch(errors[0], /secret|provider|model/i)
})

test('tracks independent outcomes for executions sharing a session', () => {
  const { ctx, listeners } = createNativeCtx()
  let current = { provider: 'provider-a', model: 'model-a' }
  const session = { requestContext: () => current }
  const first = { agent: { session } }
  const second = { agent: { session } }
  const owner = createExecRouteOwner({ ctx })

  dispatchPreExecute(listeners, first)
  current = { provider: 'provider-b', model: 'model-b' }
  dispatchPreExecute(listeners, second)

  assert.deepEqual(owner.routeOf(first), { provider: 'provider-a', model: 'model-a' })
  assert.deepEqual(owner.routeOf(second), { provider: 'provider-b', model: 'model-b' })
})

test('does not attach route state to official execution objects', () => {
  const { ctx, listeners } = createNativeCtx()
  const context = { provider: 'provider-a', model: 'model-a' }
  const { exec, agent, session } = createExecution(() => context)
  const before = [Reflect.ownKeys(exec), Reflect.ownKeys(agent), Reflect.ownKeys(session), Reflect.ownKeys(context)]
  const owner = createExecRouteOwner({ ctx })

  dispatchPreExecute(listeners, exec)

  assert.deepEqual([Reflect.ownKeys(exec), Reflect.ownKeys(agent), Reflect.ownKeys(session), Reflect.ownKeys(context)], before)
  assert.equal(Object.isFrozen(exec), false)
  assert.equal(Object.isFrozen(agent), false)
  assert.equal(Object.isFrozen(session), false)
  assert.equal(Object.isFrozen(context), false)
})

test('native pre-execute hook prepends capture and preserves exact continuation semantics', () => {
  const { ctx, listeners } = createNativeCtx()
  const { exec } = createExecution(() => ({ provider: 'provider-a', model: 'model-a' }))
  const owner = createExecRouteOwner({ ctx })
  let facadeOutcome
  let nextCalls = 0
  const continuation = () => {
    nextCalls += 1
    return { kind: 'allow' }
  }
  ctx.on('tools/pre-execute', (receivedExec, next) => {
    facadeOutcome = owner.routeOf(receivedExec)
    return next()
  })

  const result = dispatchPreExecute(listeners, exec, continuation)

  assert.equal(listeners[0].options.prepend, true)
  assert.deepEqual(facadeOutcome, { provider: 'provider-a', model: 'model-a' })
  assert.deepEqual(result, { kind: 'allow' })
  assert.equal(nextCalls, 1)
})

test('querying malformed or unobserved values is quiet', () => {
  const { ctx } = createNativeCtx()
  const errors = []
  const owner = createExecRouteOwner({ ctx, logger: { error(message) { errors.push(message) } } })

  assert.equal(owner.routeOf(null), undefined)
  assert.equal(owner.routeOf('not-an-execution'), undefined)
  assert.equal(owner.routeOf({}), undefined)
  assert.deepEqual(errors, [])
})

test('dispose is idempotent and prevents future capture by its stale owner', () => {
  const { ctx, listeners } = createNativeCtx()
  let reads = 0
  const { exec } = createExecution(() => {
    reads += 1
    return { provider: 'provider-a', model: 'model-a' }
  })
  const owner = createExecRouteOwner({ ctx })

  owner.dispose()
  owner.dispose()
  dispatchPreExecute(listeners, exec)

  assert.equal(reads, 0)
  assert.equal(owner.routeOf(exec), undefined)
  assert.equal(listeners.length, 0)
})

test('a stale owner disposal cannot notify a newer epoch', () => {
  const { ctx } = createNativeCtx()
  const current = {}
  let staleDisposals = 0
  let currentDisposals = 0
  const stale = createExecRouteOwner({
    ctx,
    epoch: {},
    isCurrentEpoch: (epoch) => epoch === current,
    onCurrentDispose: () => { staleDisposals += 1 },
  })
  const active = createExecRouteOwner({
    ctx,
    epoch: current,
    isCurrentEpoch: (epoch) => epoch === current,
    onCurrentDispose: () => { currentDisposals += 1 },
  })

  stale.dispose()
  active.dispose()

  assert.equal(staleDisposals, 0)
  assert.equal(currentDisposals, 1)
})
