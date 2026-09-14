/**
 * OBS-14 residual seam: the launcher-provided process-exit passthrough.
 *
 * The official launcher publishes `ctx.appExit`; a deployment without it must
 * see a typed absence — the facade never synthesises `process.exit` and never
 * brokers the call. The two absences are different and both are asserted here:
 * a missing *service* disables the whole `services.appExit` face (typed
 * `PluginApiFeatureDisabledError`), while a missing *member* on a present
 * service leaves the face active with the `optional` member simply absent.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildActiveFacade, SERVICE_DEFINITIONS, createServicesNamespace } from '../lib/services.js'
import { PluginApiFeatureDisabledError } from '../lib/errors.js'

const definition = SERVICE_DEFINITIONS.find((entry) => entry.key === 'appExit')

test('the appExit seam is declared as an optional passthrough member', () => {
  assert.ok(definition, 'the convergence line adds the appExit whitelist key')
  assert.equal(definition.ctxService, 'appExit')
  assert.deepEqual(definition.members, [{ kind: 'method', name: 'exit', optional: true }])
})

test('the seam forwards 1:1 to the official member with the official receiver', () => {
  const calls = []
  const official = {
    exit(code) {
      calls.push({ receiver: this, code })
      return `exiting:${code}`
    },
  }
  const facade = buildActiveFacade(definition, official, {}, true)
  assert.equal(facade.isActive, true)
  assert.equal(facade.exit(7), 'exiting:7', 'the official return value is forwarded verbatim')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].receiver, official, 'the official member is invoked on the service that owns it')
  assert.equal(calls[0].code, 7, 'the argument is forwarded unwrapped')
})

test('a deployment without the launcher service reports the absence through the assembled namespace', () => {
  // The deployed shape: the namespace is built from a ctx that carries no
  // `appExit` service, exactly as a headless deployment without a launcher.
  const namespace = createServicesNamespace({ get: () => undefined }, { coreActive: true })
  const face = namespace.appExit
  assert.equal(face.isActive, false, 'the face is disabled, not silently active')
  assert.throws(
    () => face.exit(0),
    (error) => error instanceof PluginApiFeatureDisabledError && error.code === 'PLUGIN_API_FEATURE_DISABLED',
    'the absence is typed; the facade never synthesises a process exit',
  )
  // The passthrough closes no other door: the neighbouring faces follow their
  // own service presence independently of this one.
  assert.equal(namespace.jobs.isActive, false)
})

test('a present service with the optional member missing keeps the face active and the member absent', () => {
  const facade = buildActiveFacade(definition, {}, {}, true)
  assert.equal(facade.isActive, true, 'an all-optional service stays active when the member is absent')
  assert.equal('exit' in facade, false, 'the member is simply not there')
  assert.equal(definition.members.every((member) => member.optional === true), true)
})
