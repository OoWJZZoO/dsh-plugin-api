import test from 'node:test'
import assert from 'node:assert/strict'
import { buildActiveFacade, SERVICE_DEFINITIONS } from '../lib/services.js'

const APPROVAL_OUTCOMES = ['allowed-once', 'rejected', 'cancelled', 'unavailable']

test('services.approval passes every official outcome through unchanged and never substitutes its own', () => {
  const def = SERVICE_DEFINITIONS.find((d) => d.key === 'approval')
  for (const outcome of APPROVAL_OUTCOMES) {
    let received = null
    const service = {
      setPolicy() {},
      overrideOf() {},
      request(req) {
        received = req
        return outcome
      },
    }
    const facade = buildActiveFacade(def, service, {})

    const req = { agent: {}, toolName: 'tool' }
    const result = facade.request(req)

    assert.equal(result, outcome)
    assert.equal(received, req, 'request object is not wrapped or replaced')
  }
})

test('services.approval propagates official request errors unchanged (fail-closed is official, not facade-substituted)', () => {
  const def = SERVICE_DEFINITIONS.find((d) => d.key === 'approval')
  const service = {
    setPolicy() {},
    overrideOf() {},
    request() {
      throw new Error('official approval failure')
    },
  }
  const facade = buildActiveFacade(def, service, {})
  assert.throws(() => facade.request({}), /official approval failure/)
})

test('services.userQuestions passes the official answer through unchanged', () => {
  const def = SERVICE_DEFINITIONS.find((d) => d.key === 'userQuestions')
  const answer = { items: [{ id: 'q1', answer: 'yes' }] }
  const disposer = () => {}
  const service = {
    registerProvider(provider) {
      return disposer
    },
    ask(request) {
      return answer
    },
  }
  const facade = buildActiveFacade(def, service, {})

  const request = { questions: [] }
  assert.equal(facade.ask(request), answer)
  assert.equal(facade.registerProvider({ ask() {} }), disposer)
})

test('services.userQuestions propagates official ask errors unchanged', () => {
  const def = SERVICE_DEFINITIONS.find((d) => d.key === 'userQuestions')
  const service = {
    registerProvider() {},
    ask() {
      return Promise.reject(new Error('official ask failure'))
    },
  }
  const facade = buildActiveFacade(def, service, {})
  return assert.rejects(() => facade.ask({}), /official ask failure/)
})
