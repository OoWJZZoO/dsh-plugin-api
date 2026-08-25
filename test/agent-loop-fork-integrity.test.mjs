import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

import * as official from '@deepseek-ai/dsh-agent-loop'
import * as replacement from '../packages/agent-loop/lib/forked-loop.js'

const require = createRequire(import.meta.url)
const officialEntry = require.resolve('@deepseek-ai/dsh-agent-loop')
const officialManifestPath = require.resolve('@deepseek-ai/dsh-agent-loop/package.json')
const officialManifest = JSON.parse(readFileSync(officialManifestPath, 'utf8'))
const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

test('the locked official source remains unchanged and direct imports stay official', () => {
  assert.equal(officialManifest.version, '0.1.0-rc.6')
  assert.equal(digest(officialEntry), 'bf8ca1e9b05e9b78320a5e2f0b4e25395eba91dd72db6d3cb5626e3dfb529204')
  assert.equal(digest(officialManifestPath), '78233ab9573064c5e1201c969b0329da68b9e55e6cf5590733b685422f60c807')
  assert.notEqual(official.AgentLoop, replacement.AgentLoop)
  assert.equal(officialEntry.includes('/dsh-plugin-api/'), false)
})

test('the replacement preserves the official exports, service shape, config, and settings contract', () => {
  assert.deepEqual(Object.keys(replacement).sort(), Object.keys(official).sort())
  assert.deepEqual(replacement.AgentLoop.inject, official.AgentLoop.inject)
  assert.deepEqual(Object.getOwnPropertyNames(replacement.AgentLoop.prototype), Object.getOwnPropertyNames(official.AgentLoop.prototype))
  assert.deepEqual(Object.keys(replacement.AgentLoop.Config.dict), Object.keys(official.AgentLoop.Config.dict))
  assert.equal(replacement.DEFAULT_MAX_PARALLEL_TOOL_CALLS, official.DEFAULT_MAX_PARALLEL_TOOL_CALLS)
  assert.equal(replacement.CONFIGURED_AGENT_IDENTITIES_KEY, official.CONFIGURED_AGENT_IDENTITIES_KEY)
  assert.equal(replacement.AGENT_LOOP_SETTINGS_NAMESPACE, official.AGENT_LOOP_SETTINGS_NAMESPACE)
  assert.equal(String(replacement.AGENT_LOOP_SETTINGS_SCHEMA), String(official.AGENT_LOOP_SETTINGS_SCHEMA))
})

test('the fork marks only the additive route boundary while retaining official source sections', () => {
  const source = readFileSync(new URL('../packages/agent-loop/lib/forked-loop.js', import.meta.url), 'utf8')
  assert.match(source, /Vendored from @deepseek-ai\/dsh-agent-loop@0\.1\.0-rc\.6/)
  assert.match(source, /agent\/request-error/)
  assert.match(source, /agent\/request/)
  assert.match(source, /ROUTE_POLICY_ACTIVE_SYMBOL/)
  assert.match(source, /installSettingsSection/)
  assert.match(source, /systemPrompt\.variable\("provider"/)
  assert.doesNotMatch(source, /@deepseek-ai\/dsh-plugin-api-main/)
})
