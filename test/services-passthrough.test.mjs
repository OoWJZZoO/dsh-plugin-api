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

test('active facade delegates every declared method 1:1 for all 17 services', () => {
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
