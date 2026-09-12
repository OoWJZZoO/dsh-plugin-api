/**
 * Focused tests for the turn-stopping decision participation slice
 * (agent-loop replacement capability slice).
 *
 * Contract anchors:
 * - `docs/specs/decision-participation-contract/design.md` "R slice 设计"
 * - the official turn-stopping dispatch point: serial dispatch exactly once,
 *   then the loop's own next-step re-check governs continuation; the slice
 *   adds a message contribution channel and nothing else.
 * - the continuation channel is the official durable Inbox: the tests drive
 *   the real @deepseek-ai/dsh-agent Inbox so a converged continue decision is
 *   observed as an official persisted next-step splice (durable
 *   agent/inbox/spliced bookkeeping + the inserted notification the official
 *   send path emits) whose claim() returns the contributed message for the
 *   next step. The loop-side wiring (probe at construction, slice between the
 *   official serial dispatch and its abort re-check) is pinned by source
 *   anchors and by the official-baseline equality tests in
 *   test/agent-loop-fork-integrity.test.mjs.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { Inbox } from '@deepseek-ai/dsh-agent'
import {
  TURN_STOPPING_PARTICIPATION_CONTRACT_VERSION,
  TURN_STOPPING_PARTICIPATION_SYMBOL,
  applyTurnStoppingParticipation,
  probeTurnStoppingParticipation,
} from '../lib/participation-slice.js'
import { EVIDENCE_ACTIVE_SYMBOL } from '../lib/evidence-slice.js'
import { INTERACTION_ACTIVE_SYMBOL } from '../lib/interaction-slice.js'
import { createAgentLoopApply } from '../lib/apply.js'

/**
 * Loop shim exposing exactly the surface the slice touches. `inject`
 * replicates the official send splice one-liner
 * (`this.inbox.splice(target, Infinity, 0, [message])`, wakeup=false).
 */
function makeLoop({ contract } = {}) {
  const notifications = []
  const session = {
    id: 's1',
    events: [],
    header: {},
    append(type, data) {
      const event = { type, data, seq: this.events.length }
      this.events.push(event)
      return event
    },
  }
  const inbox = new Inbox(session, {
    inserted: (message) => notifications.push(['inserted', message]),
    discarded: () => {},
    claimed: () => {},
  })
  const invokes = []
  const loop = {
    id: 'agent-t',
    session,
    inbox,
    turnStoppingParticipation: contract,
    inject(message) {
      inbox.splice('next-step', Infinity, 0, [message])
    },
  }
  return { loop, inbox, notifications, invokes }
}

function contractOf(behavior, invokes) {
  return {
    contractVersion: TURN_STOPPING_PARTICIPATION_CONTRACT_VERSION,
    async invoke(payload) {
      invokes.push(payload)
      return behavior(payload)
    },
  }
}

test('the participation contract probe accepts only the matching version and shape', () => {
  assert.equal(probeTurnStoppingParticipation(undefined), undefined)
  assert.equal(probeTurnStoppingParticipation({}), undefined)
  assert.equal(probeTurnStoppingParticipation({
    [TURN_STOPPING_PARTICIPATION_SYMBOL]: { contractVersion: 2, invoke: () => {} },
  }), undefined, 'version mismatch degrades the slice')
  assert.equal(probeTurnStoppingParticipation({
    [TURN_STOPPING_PARTICIPATION_SYMBOL]: { contractVersion: 1, invoke: 'nope' },
  }), undefined, 'non-function invoke degrades the slice')
  const bad = new Proxy({}, { get() { throw new Error('getter exploded') } })
  assert.equal(probeTurnStoppingParticipation(bad), undefined, 'a throwing probe never reaches the loop')
  const contract = { contractVersion: 1, invoke: () => null }
  const service = {}
  Object.defineProperty(service, TURN_STOPPING_PARTICIPATION_SYMBOL, { value: contract, enumerable: false })
  assert.equal(probeTurnStoppingParticipation(service), contract)
})

test('a converged continue decision is applied through the official durable next-step inbox channel', async () => {
  const message = { role: 'user', content: 'keep going' }
  const { loop, inbox, notifications, invokes } = makeLoop()
  loop.turnStoppingParticipation = contractOf(() => ({ kind: 'continue', message }), invokes)
  await applyTurnStoppingParticipation(loop, { turn: 3, signal: new AbortController().signal })
  assert.equal(invokes.length, 1)
  assert.equal(invokes[0].agent, loop)
  assert.equal(invokes[0].turn, 3)
  assert.deepEqual(inbox.nextStep, [message], 'the official Inbox holds the contributed message for the next step')
  assert.equal(inbox.hasPending, true, 'the loop next-step re-check observes pending work and continues the turn')
  assert.deepEqual(notifications, [['inserted', message]], 'the official inserted notification fires from the official path')
  assert.deepEqual(inbox.claim('next-step', 3), [message], 'the claimed message becomes the next step messages')
})

test('null convergence and non-continue decisions perform no inbox action', async () => {
  for (const converge of [null, undefined, { kind: 'proceed' }, { kind: 'continue' }, { kind: 'continue', message: [1] }, { kind: 'continue', message: 'text' }]) {
    const { loop, inbox, invokes } = makeLoop()
    loop.turnStoppingParticipation = contractOf(() => converge, invokes)
    await applyTurnStoppingParticipation(loop, { turn: 1, signal: new AbortController().signal })
    assert.deepEqual(inbox.nextStep, [], JSON.stringify(converge))
    assert.equal(inbox.hasPending, false, JSON.stringify(converge))
  }
})

test('chain failures are contained and aborts propagate with the official semantics', async () => {
  const { loop: throwingLoop, inbox: throwingInbox, invokes: throwingInvokes } = makeLoop()
  throwingLoop.turnStoppingParticipation = contractOf(() => { throw new Error('chain exploded') }, throwingInvokes)
  await assert.doesNotReject(() => applyTurnStoppingParticipation(throwingLoop, { turn: 1, signal: new AbortController().signal }))
  assert.equal(throwingInbox.hasPending, false)

  const abortDuringChain = new AbortController()
  const { loop: abortingLoop, invokes: abortingInvokes } = makeLoop()
  abortingLoop.turnStoppingParticipation = contractOf(() => {
    abortDuringChain.abort('stop')
    throw new Error('aborted mid-chain')
  }, abortingInvokes)
  await assert.rejects(
    () => applyTurnStoppingParticipation(abortingLoop, { turn: 1, signal: abortDuringChain.signal }),
    (error) => error === 'stop',
    'an abort during the chain propagates to the loop abort path',
  )

  const { loop: injectLoop, inbox: injectInbox, invokes: injectInvokes } = makeLoop()
  injectLoop.turnStoppingParticipation = contractOf(() => ({ kind: 'continue', message: { role: 'user', content: 'x' } }), injectInvokes)
  injectLoop.inject = () => { throw new Error('splice failed') }
  await assert.doesNotReject(() => applyTurnStoppingParticipation(injectLoop, { turn: 1, signal: new AbortController().signal }))
  assert.equal(injectInbox.hasPending, false, 'a failed splice leaves the official stop semantics untouched')
})

test('an already-aborted signal never reaches the chain', async () => {
  const { loop, invokes } = makeLoop()
  const controller = new AbortController()
  controller.abort()
  loop.turnStoppingParticipation = contractOf(() => null, invokes)
  await applyTurnStoppingParticipation(loop, { turn: 1, signal: controller.signal })
  assert.equal(invokes.length, 0)
})

test('the slice invokes the contract exactly once per dispatch point (no double participation)', async () => {
  const { loop, invokes } = makeLoop()
  loop.turnStoppingParticipation = contractOf(() => null, invokes)
  const signal = new AbortController().signal
  await applyTurnStoppingParticipation(loop, { turn: 1, signal })
  assert.equal(invokes.length, 1)
})

test('the forked loop wires the constructor probe and the dispatch-point slice', () => {
  const source = readFileSync(new URL('../lib/forked-loop.js', import.meta.url), 'utf8')
  assert.match(source, /probeTurnStoppingParticipation\(loopCtx\.get\?\.\("pluginApi"\)\)/)
  const dispatchIndex = source.indexOf('await this.dispatch.serial("agent/turn-stopping"')
  const sliceIndex = source.indexOf('await applyTurnStoppingParticipation(this, { turn, signal })')
  const abortIndex = source.indexOf('signal.throwIfAborted()', dispatchIndex)
  assert.ok(dispatchIndex >= 0 && sliceIndex > dispatchIndex, 'the slice runs after the official serial dispatch')
  assert.ok(abortIndex > sliceIndex, 'the official abort re-check follows the slice')
  // The slice sits inside the single stop branch, so the official serial
  // dispatch and the participation consultation are steps of one dispatch,
  // never a second dispatch site.
  assert.equal(source.split('agent/turn-stopping').length - 1, 1, 'exactly one dispatch site')
})

test('the forked loop source keeps the official baseline sections while carrying the slice patch', () => {
  const source = readFileSync(new URL('../lib/forked-loop.js', import.meta.url), 'utf8')
  assert.match(source, /Vendored from @deepseek-ai\/dsh-agent-loop@0\.1\.0-rc\.6/)
  assert.match(source, /if \(turnEnds && this\.inbox\.nextStep\.length === 0\) break;/, 'the official stop re-check is untouched')
})

test('a chain failure leaves the other replacement slices untouched on the loop instance', async () => {
  const { loop, invokes } = makeLoop()
  loop.turnStoppingParticipation = contractOf(() => { throw new Error('chain exploded') }, invokes)
  loop.interaction = { attempts: [] }
  loop[INTERACTION_ACTIVE_SYMBOL] = loop.interaction
  loop[EVIDENCE_ACTIVE_SYMBOL] = true
  loop.routePolicy = { marker: 'untouched' }
  await applyTurnStoppingParticipation(loop, { turn: 1, signal: new AbortController().signal })
  assert.equal(loop[INTERACTION_ACTIVE_SYMBOL], loop.interaction)
  assert.equal(loop[EVIDENCE_ACTIVE_SYMBOL], true)
  assert.deepEqual(loop.routePolicy, { marker: 'untouched' })
})

test('the replacement apply self-check reports participation contract mismatches without failing activation', async () => {
  const VERSION = '0.1.0-rc.6-0.1.0'
  const API = '0.1'
  const readers = () => ({
    readPackageVersion: (name) => {
      const versions = {
        '@deepseek-ai/dsh-llm': '0.1.0-rc.6',
        '@deepseek-ai/dsh-agent-loop': '0.1.0-rc.6',
        '@deepseek-ai/dsh-plugin-api-agent-loop': VERSION,
        '@deepseek-ai/dsh-plugin-api-main': VERSION,
      }
      return versions[name]
    },
    readPackageApi: (name) => (name.includes('plugin-api') ? API : undefined),
  })
  class FakeRoutePolicyService {
    constructor() {
      this.name = 'routePolicy'
      this[Symbol.for('dsh-plugin-api.agent-loop.route-policy.contract')] = true
      this.policy = { register() { return () => {} } }
      this.candidates = { register() { return () => {} }, list() { return Promise.resolve([]) } }
      this.health = { observe() {}, registerCircuitPolicy() { return () => {} }, registerProbe() { return () => {} } }
      this.circuit = { status() { return { state: 'closed' } } }
      this.decisions = { get() {}, history() { return { items: [], truncated: false } } }
      this.availability = () => ({ status: 'active' })
      this.decide = async ({ windowKey, seed }) => ({
        decisionId: 'd',
        windowKey,
        provider: seed.provider,
        model: seed.model,
        config: seed,
        candidates: [],
        reason: { code: 'OFFICIAL_SEED' },
        commitState: 'success',
        observedAt: new Date().toISOString(),
      })
    }
  }
  const forkedFactory = () => class FakeForkedAgentLoop {
    constructor(ctx, config) {
      this.name = 'agentLoop'
      this.config = config
      this[Symbol.for('dsh-plugin-api.agent-loop.contract')] = { package: '@deepseek-ai/dsh-plugin-api-agent-loop', rowId: 'plugin-api-agent-loop' }
      this.create = () => {}
      this.createAgent = () => Promise.resolve()
      this.resume = () => Promise.resolve()
      ctx.serviceMap.set('agentLoop', this)
    }
  }
  class FakeOfficialAgentLoop {
    constructor(ctx, config) {
      this.name = 'agentLoop'
      this.config = config
      this.create = () => {}
      this.createAgent = () => Promise.resolve()
      this.resume = () => Promise.resolve()
      ctx.serviceMap.set('agentLoop', this)
    }
  }
  const makeContext = (pluginApiService) => {
    const serviceMap = new Map()
    const warns = []
    if (pluginApiService) serviceMap.set('pluginApi', pluginApiService)
    const ctx = {
      root: {},
      serviceMap,
      warns,
      fiber: { entry: { options: { config: { maxParallelToolCalls: 4, agents: [] } } } },
      logger: { warn(message) { warns.push(message) }, error(message) { warns.push(message) } },
      loader: { entries() { return [
        { options: { id: 'agent-loop', disabled: true } },
        { options: { id: 'plugin-api-agent-loop', disabled: false } },
      ] } },
      get(name) { return serviceMap.get(name) },
      effect(fn, label) { return () => {} },
      plugin(Class, config) {
        const instance = new Class(ctx, config)
        if (instance.name === 'routePolicy') serviceMap.set('routePolicy', instance)
        if (instance.name === 'agentLoop') serviceMap.set('agentLoop', instance)
        return () => {
          if (instance.name) serviceMap.delete(instance.name)
        }
      },
    }
    return ctx
  }
  const apply = createAgentLoopApply({
    ...readers(),
    forkedAgentLoop: forkedFactory(),
    officialAgentLoop: FakeOfficialAgentLoop,
    createRoutePolicyService: () => FakeRoutePolicyService,
  })

  const plain = makeContext({ availability: () => ({ status: 'active' }) })
  await apply(plain)
  assert.ok(plain.warns.some((message) => message.includes('replacement active')))
  assert.equal(plain.warns.some((message) => message.includes('participation contract version mismatch')), false)

  const mismatched = makeContext({ availability: () => ({ status: 'active' }) })
  Object.defineProperty(mismatched.serviceMap.get('pluginApi'), TURN_STOPPING_PARTICIPATION_SYMBOL, {
    value: { contractVersion: 99, invoke: () => null },
    enumerable: false,
  })
  await apply(mismatched)
  assert.ok(mismatched.warns.some((message) => message.includes('turn-stopping participation contract version mismatch')))
  assert.ok(mismatched.warns.some((message) => message.includes('replacement active')), 'a mismatch degrades only the participation capability')

  const absent = makeContext({ availability: () => ({ status: 'active' }) })
  absent.serviceMap.delete('pluginApi')
  await apply(absent)
  assert.ok(absent.warns.some((message) => message.includes('replacement active')), 'an absent facade marker is a normal ordering fact, not a failure')
})
