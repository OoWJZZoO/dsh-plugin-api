import test from 'node:test'
import assert from 'node:assert/strict'
import { createFeatureRegistry } from '../lib/feature-registry.js'
import { createPluginApiService } from '../lib/plugin-api-service.js'
import { createSessionRouteOwner } from '../lib/session-route.js'

/**
 * The public observation surface: every entry answers one frozen projection
 * handle — `{ current(), subscribe(listener), dispose(), epoch }` — whose only
 * extension members are registered domain members, and whose internal mutable
 * record never escapes to the caller.
 */
function serviceWithActiveCore() {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  return new ServiceClass({
    reflect: { provide() {} },
    get() {
      return { register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {} }
    },
  })
}

function routeHarness() {
  const listeners = new Map()
  const sessions = new Map()
  const eventsApi = {
    observe(name) {
      const set = listeners.get(name) ?? new Set()
      listeners.set(name, set)
      return {
        subscribe(listener) {
          set.add(listener)
          return () => set.delete(listener)
        },
        dispose() {
          listeners.delete(name)
          return true
        },
      }
    },
  }
  const emit = (name, ...args) => {
    for (const listener of [...(listeners.get(name) ?? [])]) listener(args)
  }
  return { sessions, eventsApi, emit }
}

function makeSession(id, route) {
  return {
    id,
    firstLiveSeq: 0,
    requestContext() { return route ? { ...route } : undefined },
  }
}

test('llm.routing.observe answers the standard projection handle through the facade', () => {
  const service = serviceWithActiveCore()
  const h = routeHarness()
  const session = makeSession('s1')
  h.sessions.set(session.id, session)
  const routeOwner = createSessionRouteOwner({
    sessions: { get: (id) => h.sessions.get(id), list: () => [...h.sessions.values()] },
    eventsApi: h.eventsApi,
    logger: { error() {} },
  })
  service.mountFeature('sessionRoute', routeOwner.api)

  const seen = []
  const handle = service.llm.routing.observe(session, (route) => seen.push(route))
  assert.deepEqual(Object.keys(handle).sort(), ['current', 'dispose', 'epoch', 'subscribe'])
  assert.ok(Object.isFrozen(handle), 'the public handle is frozen')
  assert.equal('listeners' in handle, false, 'the internal listener set never escapes')
  assert.equal('disposed' in handle, false, 'the internal liveness flag never escapes')
  assert.equal(typeof handle.epoch, 'string')

  let route = { provider: 'p1', model: 'm1' }
  session.requestContext = () => ({ ...route })
  h.emit('session/event', session, { type: 'request/context', seq: 0, data: route })
  assert.equal(seen.length, 1)
  assert.ok(Object.isFrozen(seen[0]))
  assert.deepEqual(handle.current(), { provider: 'p1', model: 'm1' })

  assert.equal(handle.dispose().code, 'revoked')
  assert.equal(handle.dispose().code, 'stale')
  assert.equal(typeof handle.subscribe(() => {}), 'function')
  route = { provider: 'p2', model: 'm2' }
  session.requestContext = () => ({ ...route })
  h.emit('session/event', session, { type: 'request/context', seq: 1, data: route })
  assert.equal(seen.length, 1, 'a released handle stops delivering')
})

test('a session disposal releases the observation handle instead of silencing it', () => {
  const service = serviceWithActiveCore()
  const h = routeHarness()
  const session = makeSession('s1')
  h.sessions.set(session.id, session)
  const routeOwner = createSessionRouteOwner({
    sessions: { get: (id) => h.sessions.get(id), list: () => [...h.sessions.values()] },
    eventsApi: h.eventsApi,
    logger: { error() {} },
  })
  service.mountFeature('sessionRoute', routeOwner.api)

  const handle = service.llm.routing.observe(session, () => {})
  h.emit('session/disposed', session)
  const view = handle.current()
  assert.equal(view.ok, false)
  assert.equal(view.code, 'unavailable')
  assert.equal(typeof handle.subscribe(() => {}), 'function')
  assert.equal(handle.dispose().code, 'stale')
})
