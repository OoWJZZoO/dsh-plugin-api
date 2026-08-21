import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/client-runtime.js'
import {
  DESCRIPTOR_BY_SURFACE,
  bootFixture,
  leafState,
  settleAll,
} from './official-passthrough-fixture.mjs'
import { CLIENT_EXCLUDED_MEMBERS } from '../lib/client-official-passthrough.js'

const apiOf = (ctx) => ctx.get('pluginApi')

test('input triggers: source registration, opaque controller identity, and exact disposers', async () => {
  const { ctx, namespaces } = bootFixture()
  apply(ctx)
  await settleAll()
  const face = apiOf(ctx).client.inputTriggers
  assert.equal(leafState(apiOf(ctx), 'client.inputTriggers'), true)
  const Instance = namespaces.get('@deepseek-ai/dsh-client-ui-input-trigger').InputTriggerService
  const provider = ctx.get('inputTriggers')
  const source = { kind: 'source' }
  const disposer = face.registerSource(source)
  assert.equal(typeof disposer, 'function')
  assert.equal(disposer, provider.sourcesDisposer, 'exact disposer identity is preserved')
  assert.deepEqual(provider.sources, [source], 'the original argument object is forwarded, not copied')
  disposer()
  assert.deepEqual(provider.sources, [])
  const controller = face.sessionOf('actx')
  assert.equal(controller, provider.lastController, 'the opaque controller identity is preserved')
  assert.equal(controller.menu, 'actx')
  assert.equal(face.sessions, undefined, 'non-contract concrete members are not surfaced')
  void Instance
})

test('command ui: register, decorate, and popupFor with excluded concrete members absent', async () => {
  const { ctx, namespaces } = bootFixture()
  apply(ctx)
  await settleAll()
  const face = apiOf(ctx).client.commandUi
  const provider = ctx.get('commandUi')
  const contribution = { id: 'c' }
  const decoration = { id: 'd' }
  assert.equal(face.register(contribution), provider.lastDisposer, 'registration disposer identity is preserved')
  assert.equal(face.decorate(decoration), provider.lastDisposer)
  const popup = face.popupFor('actx')
  assert.equal(popup, provider.lastPopup, 'the opaque popup controller identity is preserved')
  assert.deepEqual(popup, { actx: 'actx' })
  assert.equal(Object.keys(face).length, 3, 'only the inventory members are exposed')
  for (const excluded of CLIENT_EXCLUDED_MEMBERS['client.commandUi']) {
    assert.equal(face[excluded], undefined, `${excluded} must stay outside the facade`)
  }
  void namespaces
})

test('model directories: directoryFor returns the live per-session directory identity', async () => {
  const { ctx } = bootFixture()
  apply(ctx)
  await settleAll()
  const face = apiOf(ctx).client.modelDirectories
  const provider = ctx.get('modelDirectories')
  const first = face.directoryFor('session-1')
  assert.equal(first, provider.lastDirectory, 'the live directory is returned as-is, never a snapshot')
  assert.deepEqual(first, { sessionId: 'session-1' })
})

test('conversation: live input/blocks properties and the four scope-addressed Promise methods', async () => {
  const { ctx } = bootFixture()
  apply(ctx)
  await settleAll()
  const face = apiOf(ctx).client.conversation
  const provider = ctx.get('conversation')
  // Live reads: each access resolves through the provider, so provider-side
  // mutations are visible and the returned value is the provider's own.
  assert.equal(face.input, provider.input)
  assert.equal(face.blocks, provider.blocks)
  provider.input = { draft: 'updated' }
  assert.equal(face.input, provider.input)
  assert.equal(face.input.draft, 'updated')
  // Promise identity: the official promise is returned unchanged.
  const promise = face.send('hello')
  assert.equal(promise, provider.sendPromise, 'the official Promise object is preserved')
  assert.equal(await promise, 'sent:hello')
  const updated = face.updateQueue('q1', 'replace')
  assert.equal(updated, provider.queuePromise)
  assert.deepEqual(await updated, { id: 'q1', action: 'replace' })
  assert.equal(face.cancel(), provider.cancelPromise)
  assert.equal(face.loadOlder(), provider.loadOlderPromise)
  // Rejection identity: the official rejection reason is preserved.
  const rejected = face.send('boom')
  await assert.rejects(rejected, (error) => error === provider.rejectionReason)
})

test('conversation events: ordered live entries, subscriptions, fallback, and disposer identity', async () => {
  const { ctx } = bootFixture()
  apply(ctx)
  await settleAll()
  const face = apiOf(ctx).client.conversationEvents
  const provider = ctx.get('conversationEvents')
  const seen = []
  const subscribeDisposer = face.subscribe(() => seen.push([...provider.definitions]))
  const first = { id: 'first' }
  const unregisterFirst = face.register(first)
  assert.equal(unregisterFirst, provider.lastDisposer, 'registration disposer identity is preserved')
  assert.deepEqual(face.entries(), [first], 'entries are forwarded in order')
  assert.deepEqual(seen.at(-1), [first], 'subscribers observe the committed mutation')
  const second = { id: 'second' }
  const unregisterSecond = face.register(second)
  assert.deepEqual(face.entries(), [first, second])
  assert.deepEqual(seen.at(-1), [first, second], 'ordered live entries reach subscribers')
  const unregisterFallback = face.registerFallback({ id: 'fallback' })
  assert.equal(unregisterFallback, provider.lastDisposer)
  assert.equal(face.fallbackEntry().id, 'fallback')
  assert.equal(face.entries().length, 2, 'fallback entries are not part of the ordered list')
  // Disposers remove exactly their own registration.
  unregisterFirst()
  assert.deepEqual(face.entries(), [second])
  unregisterSecond()
  assert.deepEqual(face.entries(), [])
  unregisterFallback()
  assert.equal(face.fallbackEntry(), undefined)
})

test('conversation views: ordered live entries and exact subscription disposers', async () => {
  const { ctx } = bootFixture()
  apply(ctx)
  await settleAll()
  const face = apiOf(ctx).client.conversationViews
  const provider = ctx.get('conversationViews')
  const seen = []
  face.subscribe(() => seen.push([...provider.definitions]))
  assert.equal(face.register({ id: 'v1' }), provider.lastDisposer)
  assert.equal(face.register({ id: 'v2' }), provider.lastDisposer)
  assert.deepEqual(face.entries().map((entry) => entry.id), ['v1', 'v2'])
  assert.deepEqual(seen.at(-1).map((entry) => entry.id), ['v1', 'v2'])
  provider.disposeLast()
  assert.deepEqual(face.entries().map((entry) => entry.id), ['v1'])
})

test('timer: the complete overload contract with disposer, Promise, and iterator identities', async () => {
  const { ctx } = bootFixture()
  apply(ctx)
  await settleAll()
  const face = apiOf(ctx).client.timer
  const provider = ctx.get('timer')
  const callback = () => {}
  // Callback overloads return the official disposer.
  assert.equal(face.setTimeout(callback, 10), provider.lastDisposer)
  assert.equal(face.setInterval(callback, 20), provider.lastDisposer)
  assert.equal(face.timeout(callback, 30), provider.lastDisposer)
  assert.equal(face.interval(callback, 40), provider.lastDisposer)
  // Promise timeout preserves the official Promise and its rejection.
  const pending = face.timeout(50)
  assert.equal(pending, provider.timeoutPromise)
  assert.equal(await pending, 50)
  const failed = face.timeout(51)
  await assert.rejects(failed, (error) => error === provider.timeoutRejection)
  // Async-iterator interval is returned unchanged.
  const iterator = face.interval(60)
  assert.equal(iterator, provider.intervalIterator, 'the official async iterator identity is preserved')
  assert.deepEqual(await iterator.next(), { value: 60, done: false })
  // Throttle and debounce wrappers forward calls and expose .dispose().
  const throttleTarget = (x) => x * 2
  const throttled = face.throttle(throttleTarget, 5)
  assert.equal(throttled(21), 42)
  assert.equal(typeof throttled.dispose, 'function')
  assert.equal(throttled.dispose, provider.throttleDisposer, 'the wrapped disposer identity is preserved')
  const debounced = face.debounce(throttleTarget, 5)
  assert.equal(debounced(3), 6)
  assert.equal(debounced.dispose, provider.debounceDisposer)
  // The service itself has no public dispose member.
  assert.equal(face.dispose, undefined)
})