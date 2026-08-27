import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { composeEntries } from '@deepseek-ai/dsh-app-boot'

const here = dirname(fileURLToPath(import.meta.url))
const patchFile = readFileSync(join(here, '..', 'cordis.patch.yml'), 'utf8')
const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'))

const MAIN_ROW = { id: 'plugin-api-main', name: '@deepseek-ai/dsh-plugin-api-main', config: {} }
const COMPACTION_OFFICIAL = { id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic', config: {} }
const COMPACTION_REPLACEMENT = { id: 'plugin-api-compaction-events', name: '@deepseek-ai/dsh-plugin-api-compaction-events', config: {} }
const TITLE_OFFICIAL = {
  id: 'session-title',
  name: '@deepseek-ai/dsh-session-title',
  config: { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 },
}
const TITLE_REPLACEMENT = {
  id: 'plugin-api-session-title',
  name: '@deepseek-ai/dsh-plugin-api-session-title',
  config: { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 },
}
const MCP_OFFICIAL = { id: 'mcp-client', name: '@deepseek-ai/dsh-mcp-client', config: {} }
const MCP_REPLACEMENT = { id: 'plugin-api-mcp', name: '@deepseek-ai/dsh-plugin-api-mcp', config: {} }
const ATTACHMENT_OFFICIAL = { id: 'attachment-local', name: '@deepseek-ai/dsh-attachment-local', config: {} }
const ATTACHMENT_REPLACEMENT = { id: 'plugin-api-attachments', name: '@deepseek-ai/dsh-plugin-api-attachments', config: {} }
const AGENT_LOOP_OFFICIAL = { id: 'agent-loop', name: '@deepseek-ai/dsh-agent-loop', config: {} }
const AGENT_LOOP_REPLACEMENT = {
  id: 'plugin-api-agent-loop',
  name: '@deepseek-ai/dsh-plugin-api-agent-loop',
  config: { maxParallelToolCalls: 10, agents: [] },
}
const SESSION_OFFICIAL = { id: 'session', name: '@deepseek-ai/dsh-session', config: {} }
const SESSION_REPLACEMENT = { id: 'plugin-api-session-branch', name: '@deepseek-ai/dsh-plugin-api-session-branch' }
const TOOL_SKILL_OFFICIAL = { id: 'tool-skill', name: '@deepseek-ai/dsh-tool-skill', config: {} }
const TOOL_SKILL_REPLACEMENT = { id: 'plugin-api-tool-skill', name: '@deepseek-ai/dsh-plugin-api-tool-skill' }
const LLM_OFFICIAL = { id: 'llm', name: '@deepseek-ai/dsh-llm', config: {} }
const LLM_REPLACEMENT = { id: 'plugin-api-llm', name: '@deepseek-ai/dsh-plugin-api-llm' }
const CONNECTION_OFFICIAL = { id: 'connection', name: '@deepseek-ai/dsh-client-connection', config: {} }
const CONNECTION_REPLACEMENT = {
  id: 'plugin-api-session-channel-connection',
  name: '@deepseek-ai/dsh-plugin-api-session-channel-connection',
  inject: ['webRuntime'],
  config: { trustedHosts: { __jsExpr: 'ctx.webRuntime.trustedHosts' } },
}
const GATEWAY_OFFICIAL = { id: 'typert-gateway', name: '@deepseek-ai/dsh-api-gateway', config: {} }
const GATEWAY_REPLACEMENT = { id: 'plugin-api-session-channel-gateway', name: '@deepseek-ai/dsh-plugin-api-session-channel-gateway' }

const officialBaseLayer = [
  { insert: [COMPACTION_OFFICIAL, TITLE_OFFICIAL, MCP_OFFICIAL, ATTACHMENT_OFFICIAL, AGENT_LOOP_OFFICIAL, SESSION_OFFICIAL, TOOL_SKILL_OFFICIAL, LLM_OFFICIAL, CONNECTION_OFFICIAL, GATEWAY_OFFICIAL] },
]

const fullLayer = [
  { insert: [MAIN_ROW] },
  { id: 'compaction-basic', disabled: true },
  { insert: [COMPACTION_REPLACEMENT] },
  { id: 'session-title', disabled: true },
  { insert: [TITLE_REPLACEMENT] },
  { id: 'mcp-client', disabled: true },
  { insert: [MCP_REPLACEMENT] },
  { id: 'attachment-local', disabled: true },
  { insert: [ATTACHMENT_REPLACEMENT] },
  { id: 'agent-loop', disabled: true },
  { insert: [AGENT_LOOP_REPLACEMENT] },
  { id: 'session', disabled: true },
  { insert: [SESSION_REPLACEMENT] },
  { id: 'tool-skill', disabled: true },
  { insert: [TOOL_SKILL_REPLACEMENT] },
  { id: 'llm', disabled: true },
  { insert: [LLM_REPLACEMENT] },
  { id: 'connection', disabled: true },
  { insert: [CONNECTION_REPLACEMENT] },
  { id: 'typert-gateway', disabled: true },
  { insert: [GATEWAY_REPLACEMENT] },
]

test('the full package follows the unified full-version and dsh.api policy', () => {
  assert.equal(pkg.name, '@deepseek-ai/dsh-plugin-api-full')
  assert.equal(pkg.version, '0.1.0-rc.6-0.7')
  assert.equal(pkg.dsh.api, '0.7')
  assert.match(pkg.version, /^(.+)-(\d+\.\d+)$/)
  assert.equal(pkg.version.match(/^(.+)-(\d+\.\d+)$/)[2], pkg.dsh.api)
})

test('the full package depends on the main facade, the companion executor, and every auxiliary package at workspace-consistent versions', () => {
  assert.deepEqual(pkg.dependencies, {
    '@deepseek-ai/dsh-plugin-api-main': 'workspace:*',
    '@deepseek-ai/dsh-plugin-api-compaction-events': 'workspace:*',
    '@deepseek-ai/dsh-plugin-api-session-title': 'workspace:*',
    '@deepseek-ai/dsh-plugin-api-mcp': 'workspace:*',
    '@deepseek-ai/dsh-plugin-api-attachments': 'workspace:*',
    '@deepseek-ai/dsh-plugin-api-agent-loop': 'workspace:*',
    '@deepseek-ai/dsh-plugin-api-session-branch': 'workspace:*',
    '@deepseek-ai/dsh-plugin-api-profile-manager': 'workspace:*',
    '@deepseek-ai/dsh-plugin-api-tool-skill': 'workspace:*',
    '@deepseek-ai/dsh-plugin-api-llm': 'workspace:*',
    '@deepseek-ai/dsh-plugin-api-session-channel-connection': 'workspace:*',
    '@deepseek-ai/dsh-plugin-api-session-channel-gateway': 'workspace:*',
  })
})

test('the full patch assembles main and all replacement rows in deterministic order', () => {
  const entries = composeEntries([fullLayer])
  assert.deepEqual(entries, [
    MAIN_ROW,
    COMPACTION_REPLACEMENT,
    TITLE_REPLACEMENT,
    MCP_REPLACEMENT,
    ATTACHMENT_REPLACEMENT,
    AGENT_LOOP_REPLACEMENT,
    SESSION_REPLACEMENT,
    TOOL_SKILL_REPLACEMENT,
    LLM_REPLACEMENT,
    CONNECTION_REPLACEMENT,
    GATEWAY_REPLACEMENT,
  ])
})

test('composing over an official base disables all official rows and appends the deterministic assembly', () => {
  const entries = composeEntries([officialBaseLayer, fullLayer])
  assert.deepEqual(entries, [
    { ...COMPACTION_OFFICIAL, disabled: true },
    { ...TITLE_OFFICIAL, disabled: true },
    { ...MCP_OFFICIAL, disabled: true },
    { ...ATTACHMENT_OFFICIAL, disabled: true },
    { ...AGENT_LOOP_OFFICIAL, disabled: true },
    { ...SESSION_OFFICIAL, disabled: true },
    { ...TOOL_SKILL_OFFICIAL, disabled: true },
    { ...LLM_OFFICIAL, disabled: true },
    { ...CONNECTION_OFFICIAL, disabled: true },
    { ...GATEWAY_OFFICIAL, disabled: true },
    MAIN_ROW,
    COMPACTION_REPLACEMENT,
    TITLE_REPLACEMENT,
    MCP_REPLACEMENT,
    ATTACHMENT_REPLACEMENT,
    AGENT_LOOP_REPLACEMENT,
    SESSION_REPLACEMENT,
    TOOL_SKILL_REPLACEMENT,
    LLM_REPLACEMENT,
    CONNECTION_REPLACEMENT,
    GATEWAY_REPLACEMENT,
  ])
})

test('the full patch text keeps the deterministic order and adds no extra row', () => {
  const mainIndex = patchFile.indexOf("name: '@deepseek-ai/dsh-plugin-api-main'")
  const compactionIndex = patchFile.indexOf('id: plugin-api-compaction-events')
  const titleIndex = patchFile.indexOf('id: plugin-api-session-title')
  const mcpIndex = patchFile.indexOf('id: plugin-api-mcp')
  const attachmentIndex = patchFile.indexOf('id: plugin-api-attachments')
  const agentLoopIndex = patchFile.indexOf('id: plugin-api-agent-loop')
  const sessionBranchIndex = patchFile.indexOf('id: plugin-api-session-branch')
  const toolSkillIndex = patchFile.indexOf('id: plugin-api-tool-skill')
  const llmIndex = patchFile.indexOf('id: plugin-api-llm')
  const connectionIndex = patchFile.indexOf('id: plugin-api-session-channel-connection')
  const gatewayIndex = patchFile.indexOf('id: plugin-api-session-channel-gateway')
  assert.ok(
    mainIndex >= 0 && compactionIndex > mainIndex && titleIndex > compactionIndex && mcpIndex > titleIndex && attachmentIndex > mcpIndex && agentLoopIndex > attachmentIndex && sessionBranchIndex > agentLoopIndex && toolSkillIndex > sessionBranchIndex && llmIndex > toolSkillIndex && connectionIndex > llmIndex && gatewayIndex > connectionIndex,
    'rows must appear main → compaction → session-title → mcp → attachment → agent-loop → session-branch → tool-skill → llm → connection → typert-gateway',
  )
  assert.equal((patchFile.match(/- insert:/g) ?? []).length, 11, 'exactly main + ten replacement inserts')
  assert.equal((patchFile.match(/disabled: true/g) ?? []).length, 10, 'exactly ten official rows disabled')
})
