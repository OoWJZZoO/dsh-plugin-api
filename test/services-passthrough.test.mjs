import test from 'node:test'
import assert from 'node:assert/strict'
import { buildActiveFacade, SERVICE_DEFINITIONS } from '../lib/services.js'

function methodMembers(def) {
  return def.members.filter((m) => m.kind === 'method')
}

function getterMembers(def) {
  return def.members.filter((m) => m.kind === 'getter')
}

function forwardMembers(def) {
  return def.members.filter((m) => m.kind === 'forward')
}

function createMockServiceAndHelpers(def) {
  const service = {}
  const calls = new Map()
  const returns = new Map()
  const getterValues = new Map()
  const uriCalls = new Map()
  const uriReturns = new Map()
  const uriHelpers = {}

  for (const member of def.members) {
    if (member.kind === 'method') {
      const returnValue = { service: def.key, member: member.name }
      returns.set(member.name, returnValue)
      service[member.name] = function (...args) {
        assert.equal(this, service, `${def.key}.${member.name} must preserve this binding`)
        calls.set(member.name, args)
        return returnValue
      }
    } else if (member.kind === 'getter') {
      const value = { service: def.key, getter: member.name }
      getterValues.set(member.name, value)
      Object.defineProperty(service, member.name, {
        enumerable: true,
        get() {
          return value
        },
      })
    } else if (member.kind === 'forward') {
      const returnValue = { service: def.key, forward: member.name }
      uriReturns.set(member.name, returnValue)
      uriHelpers[member.name] = (...args) => {
        uriCalls.set(member.name, args)
        return returnValue
      }
    }
  }

  return { service, calls, returns, getterValues, uriHelpers, uriCalls, uriReturns }
}

test('active facade delegates every declared method 1:1 for all 21 services', () => {
  for (const def of SERVICE_DEFINITIONS) {
    const { service, calls, returns, getterValues, uriHelpers, uriCalls, uriReturns } = createMockServiceAndHelpers(def)
    const facade = buildActiveFacade(def, service, uriHelpers)

    assert.equal(facade.isActive, true, `${def.key}.isActive`)
    assert.ok(Object.isFrozen(facade), `${def.key} facade is frozen`)

    const provider = { id: `${def.key}-provider` }
    const callback = () => {}
    for (const member of methodMembers(def)) {
      const result = facade[member.name](provider, callback, 42)
      assert.equal(result, returns.get(member.name), `${def.key}.${member.name} return identity`)
      const args = calls.get(member.name)
      assert.equal(args.length, 3)
      assert.equal(args[0], provider, `${def.key}.${member.name} does not wrap provider object`)
      assert.equal(args[1], callback, `${def.key}.${member.name} does not wrap callback`)
      assert.equal(args[2], 42)
    }

    for (const member of getterMembers(def)) {
      assert.equal(facade[member.name], getterValues.get(member.name), `${def.key}.${member.name} getter passthrough`)
    }

    for (const member of forwardMembers(def)) {
      const marker = { marker: member.name }
      const result = facade[member.name](marker)
      assert.equal(result, uriReturns.get(member.name), `${def.key}.${member.name} forward return identity`)
      assert.deepEqual(uriCalls.get(member.name), [marker])
    }
  }
})

test('active facade propagates synchronous official method errors unchanged', () => {
  for (const def of SERVICE_DEFINITIONS) {
    const member = methodMembers(def)[0]
    const { service, uriHelpers } = createMockServiceAndHelpers(def)
    service[member.name] = () => { throw new Error('official boom') }
    const facade = buildActiveFacade(def, service, uriHelpers)
    assert.throws(
      () => facade[member.name](),
      (error) => {
        assert.equal(error.message, 'official boom')
        return true
      },
    )
  }
})

test('active facade propagates official method rejections unchanged', async () => {
  for (const def of SERVICE_DEFINITIONS) {
    const member = methodMembers(def)[0]
    const { service, uriHelpers } = createMockServiceAndHelpers(def)
    service[member.name] = () => Promise.reject(new Error('official rejection'))
    const facade = buildActiveFacade(def, service, uriHelpers)
    await assert.rejects(
      () => facade[member.name](),
      (error) => {
        assert.equal(error.message, 'official rejection')
        return true
      },
    )
  }
})

test('retained facade delegates exact argument lists and preserves value identities', () => {
  const def = SERVICE_DEFINITIONS.find((entry) => entry.key === 'sessionProjectionCache')
  const calls = []
  const results = {
    cachedSnapshot: { kind: 'cached' },
    coldSnapshot: { kind: 'cold' },
  }
  const service = {
    cachedSnapshot(...args) {
      assert.equal(this, service)
      calls.push({ name: 'cachedSnapshot', args })
      return results.cachedSnapshot
    },
    coldSnapshot(...args) {
      assert.equal(this, service)
      calls.push({ name: 'coldSnapshot', args })
      return results.coldSnapshot
    },
  }
  const facade = buildActiveFacade(def, service)
  const sessionId = { id: 'session' }
  const floor = { event: 10 }

  assert.equal(facade.cachedSnapshot(sessionId), results.cachedSnapshot)
  assert.equal(facade.coldSnapshot(sessionId, floor), results.coldSnapshot)

  assert.deepEqual(calls.map((call) => call.name), ['cachedSnapshot', 'coldSnapshot'])
  assert.equal(calls[0].args.length, 1)
  assert.equal(calls[0].args[0], sessionId)
  assert.equal(calls[1].args.length, 2)
  assert.equal(calls[1].args[0], sessionId)
  assert.equal(calls[1].args[1], floor)
})

test('retained facade propagates official throws and rejections unchanged', async () => {
  const def = SERVICE_DEFINITIONS.find((entry) => entry.key === 'sessionProjectionCache')
  const thrown = new Error('cache throw')
  const rejected = new Error('cache rejection')
  const rejectedPromise = Promise.reject(rejected)
  const service = {
    cachedSnapshot() {
      throw thrown
    },
    coldSnapshot() {
      return rejectedPromise
    },
  }
  const facade = buildActiveFacade(def, service)

  assert.throws(() => facade.cachedSnapshot(), (error) => error === thrown)
  assert.equal(facade.coldSnapshot(), rejectedPromise)
  await assert.rejects(rejectedPromise, (error) => error === rejected)
})

test('optional method is omitted when absent and present when the official service has it', () => {
  const def = SERVICE_DEFINITIONS.find((d) => d.key === 'sessionTelemetry')
  const withFlush = {
    emit() {},
    shutdown() {},
    sharing: false,
    flush() {},
  }
  const withoutFlush = {
    emit() {},
    shutdown() {},
    sharing: false,
  }

  const facadeWith = buildActiveFacade(def, withFlush, {})
  assert.equal(typeof facadeWith.flush, 'function')

  const facadeWithout = buildActiveFacade(def, withoutFlush, {})
  assert.ok(!('flush' in facadeWithout))
})

test('jobs delegates exact optional argument lists and preserves value identities', () => {
  const def = SERVICE_DEFINITIONS.find((entry) => entry.key === 'jobs')
  const calls = []
  const disposers = {
    onJobDone: () => 'dispose-jobdone',
    onJobsChanged: () => 'dispose-jobschanged',
    attachController: () => 'dispose-controller',
  }
  const service = {}
  for (const name of def.members.map((m) => m.name)) {
    service[name] = function (...args) {
      assert.equal(this, service, `jobs.${name} must preserve this binding`)
      calls.push({ name, args })
      if (name in disposers) return disposers[name]
      return { name, len: args.length }
    }
  }
  const facade = buildActiveFacade(def, service)
  const id = 'bash-1'
  const caller = { id: 'agent-1' }
  const reason = 'user requested stop'
  const timeoutMs = 5000
  const signal = new AbortController().signal
  const listener = () => {}

  // Omitted trailing optionals stay omitted.
  assert.deepEqual(facade.list(), { name: 'list', len: 0 })
  assert.deepEqual(facade.get(id), { name: 'get', len: 1 })
  assert.deepEqual(facade.read(id), { name: 'read', len: 1 })
  assert.deepEqual(facade.kill(id), { name: 'kill', len: 1 })
  assert.deepEqual(facade.wait(id, timeoutMs), { name: 'wait', len: 2 })

  // Fully-specified forms preserve supplied identities.
  assert.deepEqual(facade.get(id, caller), { name: 'get', len: 2 })
  assert.deepEqual(facade.kill(id, caller, reason), { name: 'kill', len: 3 })
  assert.deepEqual(facade.wait(id, timeoutMs, caller, signal), { name: 'wait', len: 4 })

  // Disposer-returning members return the exact disposer the official service returns.
  assert.equal(facade.onJobDone(listener), disposers.onJobDone)
  assert.equal(facade.onJobsChanged(listener), disposers.onJobsChanged)
  assert.equal(facade.attachController('host-controls'), disposers.attachController)

  const byName = Object.fromEntries(calls.map((call) => [call.name, call.args]))
  assert.equal(byName.list.length, 0)
  assert.equal(byName.get[0], id)
  assert.equal(byName.read[0], id)
  assert.equal(byName.kill[0], id)
  assert.equal(byName.wait[0], id)
  assert.equal(byName.wait[1], timeoutMs)
  assert.equal(byName.get[1], caller)
  assert.equal(byName.kill[1], caller)
  assert.equal(byName.kill[2], reason)
  assert.equal(byName.wait[2], caller)
  assert.equal(byName.wait[3], signal)
  assert.equal(byName.onJobDone[0], listener)
  assert.equal(byName.onJobsChanged[0], listener)
  assert.equal(byName.attachController[0], 'host-controls')
})

test('shellEnv delegates arguments, returns disposers and values by identity', () => {
  const def = SERVICE_DEFINITIONS.find((entry) => entry.key === 'shellEnv')
  const calls = []
  const disposer = () => 'dispose-env'
  const collected = { DSH_SESSION_JSONL: '/tmp/s.jsonl' }
  const declared = [{ key: 'DSH_FOO', contributor: 'pro-ex' }]
  const service = {
    register(...args) {
      assert.equal(this, service)
      calls.push({ name: 'register', args })
      return disposer
    },
    collect(...args) {
      assert.equal(this, service)
      calls.push({ name: 'collect', args })
      return collected
    },
    list(...args) {
      assert.equal(this, service)
      calls.push({ name: 'list', args })
      return declared
    },
  }
  const facade = buildActiveFacade(def, service)
  const contributor = { name: 'pro-ex', variables: { DSH_FOO: { description: 'x' } }, resolve() {} }
  const execution = { id: 'exec-1' }

  assert.equal(facade.register(contributor), disposer)
  assert.equal(facade.collect(execution), collected)
  assert.equal(facade.list(), declared)

  const byName = Object.fromEntries(calls.map((call) => [call.name, call.args]))
  assert.equal(byName.register[0], contributor)
  assert.equal(byName.collect[0], execution)
})

test('jobs and shellEnv propagate official throws and rejections unchanged', async () => {
  for (const key of ['jobs', 'shellEnv']) {
    const def = SERVICE_DEFINITIONS.find((entry) => entry.key === key)
    const thrown = new Error(`${key} throw`)
    const rejected = new Error(`${key} rejection`)
    const rejectedPromise = Promise.reject(rejected)
    const service = {}
    for (const [index, name] of def.members.map((m) => m.name).entries()) {
      if (index === 0) {
        service[name] = () => { throw thrown }
      } else if (index === 1) {
        service[name] = () => rejectedPromise
      } else {
        service[name] = () => ({ ok: name })
      }
    }
    const facade = buildActiveFacade(def, service)

    assert.throws(() => facade[def.members[0].name](), (error) => error === thrown)
    assert.equal(facade[def.members[1].name](), rejectedPromise)
    await assert.rejects(rejectedPromise, (error) => error === rejected)
  }
})
