import test from 'node:test'
import assert from 'node:assert/strict'
import { runFeatureGuard } from '../lib/guards.js'
import * as protocol from '@deepseek-ai/dsh-typert-protocol'

function remoteHost() {
  return {
    get() {},
    reflect: {
      provide() {},
    },
  }
}

const healthyDeps = { typertProtocol: protocol }

test('remote feature guard passes when all required primitives are present', () => {
  const result = runFeatureGuard('remote', remoteHost(), healthyDeps)
  assert.equal(result.ok, true)
  assert.deepEqual(result.problems, [])
  assert.deepEqual(result.featureProblems, { remote: [] })
})

test('remote feature guard fails when ctx.get is missing', () => {
  const result = runFeatureGuard('remote', {}, healthyDeps)
  assert.equal(result.ok, false)
  assert.ok(result.featureProblems.remote.some((p) => p.name === 'ctx.get'))
})

test('remote feature guard fails when ctx.reflect.provide is missing', () => {
  const result = runFeatureGuard('remote', { get() {} }, healthyDeps)
  assert.equal(result.ok, false)
  assert.ok(result.featureProblems.remote.some((p) => p.name === 'ctx.reflect.provide'))
})

test('remote feature guard fails when the typert protocol is malformed/missing', () => {
  const result = runFeatureGuard('remote', remoteHost(), { typertProtocol: {} })
  assert.equal(result.ok, false)
  const names = result.featureProblems.remote.map((p) => p.name)
  assert.ok(names.includes('typert.isTypertRemoteSegment'))
  assert.ok(names.includes('typert.bindTypertRemote'))
  assert.ok(names.includes('typert.remoteMethods'))
  assert.ok(names.includes('typert.Remote'))
})

test('remote guard does NOT require the typert.TypertRemoteService probe (generic path does not consume it)', () => {
  const result = runFeatureGuard('remote', remoteHost(), healthyDeps)
  const names = result.featureProblems.remote.map((p) => p.name)
  assert.ok(!names.some((name) => name.includes('TypertRemoteService')))
})

test('remote guard does not depend on a settings service (generic publish has no settings dependency)', () => {
  // No `settings` service anywhere — must still pass (unlike settingsRemote).
  const result = runFeatureGuard('remote', remoteHost(), healthyDeps)
  assert.equal(result.ok, true)
  assert.deepEqual(result.problems, [])
})

test('hostile ctx with throwing getter is contained (presence-not-call semantics, never throws out of guard)', () => {
  // The guard probes presence via typeof and never invokes ctx.get; a getter
  // that throws is only exercised at publish time by the leaf (never the guard).
  const hostile = { get() { throw new Error('hostile') }, reflect: { provide() {} } }
  const result = runFeatureGuard('remote', hostile, healthyDeps)
  assert.equal(result.ok, true, 'getter throw treated as absent owner, not a crash')
})

test('remote guard checks presence (typeof), not call behavior — a throwing provide is a publish-time/leaf concern', () => {
  // Guard probes test presence via typeof, mirroring settingsRemote; a provide
  // that throws at call time is contained by the leaf (P2 disabled face), not
  // by the guard. Assert presence-only semantics.
  const ctx = { get() {}, reflect: { provide: () => { throw new Error('x') } } }
  const result = runFeatureGuard('remote', ctx, healthyDeps)
  assert.equal(result.ok, true, 'guard sees a present provide function')
})
