import test from 'node:test'
import assert from 'node:assert/strict'
import { syncTools } from '../lib/sync.js'

function makeClient(pages, { failFetches = [] } = {}) {
  const requests = []
  let pageIndex = 0
  return {
    requests,
    async request(params) {
      requests.push(params)
      const idx = pageIndex
      if (failFetches.includes(idx)) {
        const error = new Error('list failed')
        error.code = 'mock-fetch-error'
        throw error
      }
      pageIndex += 1
      const page = pages.length <= 0 ? { tools: [] } : pages[Math.min(idx, pages.length - 1)]
      if (pageIndex < pages.length) {
        return { ...page, nextCursor: `cursor-${idx + 1}` }
      }
      return page
    },
  }
}

function makeHarness({ registerError } = {}) {
  const registered = new Map()
  const disposed = []
  const logs = []
  const ctx = {
    get tools() {
      return {
        register(def) {
          if (registerError && registerError(def)) throw registerError(def)
          const disposer = () => {
            disposed.push(def.name)
            registered.delete(def.name)
          }
          registered.set(def.name, disposer)
          return disposer
        },
      }
    },
    logger: {
      error(message) {
        logs.push(message)
      },
    },
  }
  return { registered, disposed, logs, ctx }
}

const opts = { serverName: 'github', toolCallTimeoutMs: 1000, registrationFailure: 'contain' }

test('syncTools drains pagination and registers a full generation', async () => {
  const client = makeClient([
    { tools: [{ name: 'a' }] },
    { tools: [{ name: 'b' }, { name: 'c' }] },
  ])
  const { registered, ctx } = makeHarness()
  const disposers = await syncTools(client, ctx, opts, new Map())
  assert.equal(registered.size, 3)
  const names = [...registered.keys()].sort()
  assert.deepEqual(names, ['mcp__github__a', 'mcp__github__b', 'mcp__github__c'])
  assert.ok(disposers.size === 3)
})

test('syncTools publishes catalog meta only after a successful swap', async () => {
  const client = makeClient([{ tools: [{ name: 'a', description: 'desc', inputSchema: { type: 'object' } }] }])
  const { ctx } = makeHarness()
  const collected = []
  await syncTools(client, ctx, opts, new Map(), (metas) => collected.push(metas))
  assert.equal(collected.length, 1)
  assert.deepEqual(collected[0][0], {
    serverName: 'github',
    rawName: 'a',
    publicName: 'mcp__github__a',
    description: 'desc',
    inputSchema: 'available',
    outputSchema: 'unavailable',
  })
})

test('syncTools rejects duplicate raw names and leaves the previous generation untouched', async () => {
  const client = makeClient([{ tools: [{ name: 'dup' }, { name: 'dup' }] }])
  const { registered, disposed, ctx } = makeHarness()
  const previous = new Map([['mcp__github__old', () => disposed.push('old')]])
  await assert.rejects(() => syncTools(client, ctx, opts, previous), /more than once/)
  // previous disposer never ran because the fetch phase failed before swap
  assert.deepEqual(disposed, [])
  assert.equal(registered.size, 0)
})

test('syncTools fetch failure leaves the last valid generation and old tools in place', async () => {
  const client = makeClient([{ tools: [{ name: 'x' }] }], { failFetches: [0] })
  const { registered, disposed, ctx } = makeHarness()
  const previous = new Map([['mcp__github__old', () => disposed.push('old')]])
  await assert.rejects(() => syncTools(client, ctx, opts, previous), /list failed/)
  assert.deepEqual(disposed, [])
  assert.equal(registered.size, 0)
})

test('syncTools registration conflict rolls back the partial generation (contain mode)', async () => {
  const client = makeClient([{ tools: [{ name: 'a' }, { name: 'b' }] }])
  let first = true
  const failSecond = () => {
    if (first) {
      first = false
      return undefined
    }
    return new Error('registry conflict')
  }
  const { registered, disposed, logs, ctx } = makeHarness({ registerError: failSecond })
  const previous = new Map([['mcp__github__old', () => disposed.push('old')]])
  const disposers = await syncTools(client, ctx, opts, previous)
  assert.equal(disposers.size, 0)
  assert.equal(registered.size, 0)
  // the first (already registered) partial was rolled back; 'old' from the
  // previous generation was disposed during the swap phase
  assert.ok(disposed.includes('mcp__github__a'))
  assert.ok(disposed.includes('old'))
  assert.ok(logs.some((message) => message.includes('no tools registered')))
})

test('syncTools registration failure in throw mode rejects and never calls the collector', async () => {
  const client = makeClient([{ tools: [{ name: 'a' }] }])
  const { ctx } = makeHarness({ registerError: () => new Error('registry conflict') })
  const collected = []
  await assert.rejects(() =>
    syncTools(client, ctx, { ...opts, registrationFailure: 'throw' }, new Map(), (metas) => collected.push(metas)),
  )
  assert.equal(collected.length, 0)
})
