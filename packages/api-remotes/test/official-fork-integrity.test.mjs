/**
 * Official-contract parity fixture gate for `@deepseek-ai/dsh-plugin-api-api-remotes`
 * (R-class parity gate). Asserts the vendored fork reproduces the official
 * `@deepseek-ai/dsh-api-remotes` host contract one-to-one:
 * - all official export names,
 * - the eleven-event forwarded allowlist verbatim,
 * - the Remote Agent/Session identity BFF error/ownership shapes,
 * - the client manifest inject list.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const OFFICIAL_11 = [
  'agent-preset/selected',
  'commands/change',
  'credentials/updated',
  'cordis/request-run',
  'cordis/request-run-resolved',
  'cordis/dynamic-package',
  'cordis/dynamic-retract',
  'cordis/inspect-query',
  'cordis/inspect-query-resolved',
  'llm/adapters-updated',
  'settings/document-updated',
]

test('forked host: preserves every official export name', async () => {
  const official = await import('@deepseek-ai/dsh-api-remotes')
  const forked = await import('../lib/forked-host.js')
  const officialKeys = Object.keys(official).sort()
  const forkedKeys = Object.keys(forked).sort()
  assert.deepEqual(forkedKeys, officialKeys)
})

test('forked host: the eleven-event allowlist is reproduced verbatim', async () => {
  const forked = await import('../lib/forked-host.js')
  assert.equal(forked.API_REMOTE_FORWARDED_EVENTS.length, 11)
  assert.deepEqual([...forked.API_REMOTE_FORWARDED_EVENTS], OFFICIAL_11)
})

test('forked host: the consumer $on key set = the reproduced allowlist (attention stays out)', async () => {
  const forked = await import('../lib/forked-host.js')
  const { keepAttentionOutOfAllowlist, ATTENTION_UPDATE_EVENT } = await import('../lib/shared-vocab.js')
  const legalKeys = [...forked.API_REMOTE_FORWARDED_EVENTS]
  assert.equal(legalKeys.includes(ATTENTION_UPDATE_EVENT), false)
  assert.equal(
    keepAttentionOutOfAllowlist({ forwardedEvents: legalKeys, attentionEvent: ATTENTION_UPDATE_EVENT }),
    true,
  )
})

test('forked host: BFF identity error/ownership shapes reproduce official', async () => {
  const official = await import('@deepseek-ai/dsh-api-remotes')
  const forked = await import('../lib/forked-host.js')
  assert.equal(typeof forked.ApiRemoteSessionNotFound, 'function')
  assert.equal(typeof forked.ApiRemoteSubagentSessionOwnership, 'function')
  assert.equal(typeof forked.apiRemoteSubagentOwnershipError, 'function')
  assert.equal(typeof forked.createApiRemoteAgentResolver, 'function')
  assert.equal(typeof forked.hasApiRemoteSubagentOwner, 'function')
  assert.equal(typeof forked.inspectApiRemoteSession, 'function')
  // subagent ownership fence message shape
  const fence = new forked.ApiRemoteSubagentSessionOwnership('sess-1')
  assert.equal(fence.sessionId, 'sess-1')
  assert.match(fence.message, /subagent session/)
  // ownership error RPC shape
  const error = forked.apiRemoteSubagentOwnershipError('sess-2')
  assert.equal(error.code, 'agent-busy')
  assert.equal(error.details.reason, 'use subagent delivery for this child session')
})

test('forked host: BFF behavior agrees with official on the same inputs', async () => {
  const official = await import('@deepseek-ai/dsh-api-remotes')
  const forked = await import('../lib/forked-host.js')
  // subagent origin session → both must refuse generic routing
  const ctx = {
    agents: {
      get: () => undefined,
      isOwnedBy: () => false,
    },
  }
  const session = { header: { origin: 'subagent', parentSession: undefined } }
  assert.equal(official.hasApiRemoteSubagentOwner(ctx, session, undefined), true)
  assert.equal(forked.hasApiRemoteSubagentOwner(ctx, session, undefined), true)
})

test('replacement package: client manifest reproduces official inject list', () => {
  const official = JSON.parse(readFileSync(
    fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-api-remotes/package.json')),
    'utf8',
  ))
  const own = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))
  assert.deepEqual(own.dsh.client.inject, official.dsh.client.inject)
  assert.equal(own.dsh.client.platform, 'web')
  assert.equal(own.dsh.client.immediately, true)
})

test('forked host: the vendored source is verbatim official (no semantic drift)', () => {
  const officialPkgPath = fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-api-remotes'))
  const officialSource = readFileSync(officialPkgPath, 'utf8')
  const forkedSource = readFileSync(fileURLToPath(new URL('../lib/forked-host.js', import.meta.url)), 'utf8')
  // fork = header comment (before the "import" line) + official source, verbatim
  const headerEnd = forkedSource.indexOf('import { TypertLookupFailure }')
  assert.ok(headerEnd >= 0, 'fork must carry the official import line')
  const vendored = forkedSource.slice(headerEnd)
  assert.equal(vendored, officialSource)
})