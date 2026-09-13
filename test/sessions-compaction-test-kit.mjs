/**
 * Shared harness for the compaction operation acceptance tests.
 *
 * It boots a real cordis tree carrying the facade and mounts the replacement's
 * forked engine as the `compaction` provider (with its contract and operation
 * markers attached), so a passing gate runs the real engine transaction while
 * the failing-gate scenarios exercise the declared typed degradation.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'

import { createPluginApiService } from '../lib/plugin-api-service.js'
import { createFeatureRegistry } from '../lib/feature-registry.js'
import { BasicCompactionEngine } from '../packages/compaction-events/lib/forked-engine.js'
import { attachOperationSubface, hasOperationSubface, OPERATION_SUBFACE_SYMBOL } from '../packages/compaction-events/lib/operation-subface.js'
import { COMPACTION_EVENTS_CONTRACT_MARKER } from '../lib/sessions-compaction.js'

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
const REPLACEMENT_VERSION = '0.1.0-rc.6-0.1.0'

function makeSession({ nodes = [1, 2, 3, 4, 5], openTurn = true } = {}) {
  const events = new Array(1)
  const surface = { nodes: [...nodes], replaceGeneration: 0 }
  events[0] = openTurn
    ? { seq: 0, type: 'turn/start', data: { turn: 'turn-1' } }
    : { seq: 0, type: 'internal/placeholder', data: {} }
  let nextSeq = events.length
  function append(type, data) {
    const seq = nextSeq
    const event = { seq, type, data }
    events[seq] = event
    nextSeq += 1
    return event
  }
  for (const seq of nodes) {
    const event = append('assistant/message', { message: { role: 'assistant', content: [{ type: 'text', text: `m${seq}` }] } })
    event._message = { role: 'assistant', content: [{ type: 'text', text: `m${seq}` }] }
  }
  return {
    id: 'session-1',
    events,
    surface,
    append,
    requestHeader() {
      return { system: 'sys', tools: [], config: { provider: 'p', model: 'm' } }
    },
    deriveEventMessage(event) {
      return event?._message ?? null
    },
  }
}

function makeMeter() {
  return {
    measure(session) {
      const nodes = session.surface.nodes.map((seq) => ({ seq, tokens: 100 }))
      return { nodes, totalTokens: nodes.reduce((sum, node) => sum + node.tokens, 0) }
    },
    estimateMessage() {
      return 1
    },
  }
}

class TestEngine extends BasicCompactionEngine {
  async summarize() {
    return {
      summary: [{ type: 'text', text: 'compacted checkpoint' }],
      rawOutput: { blocks: [{ type: 'text', text: 'compacted checkpoint' }] },
      llmStreamCall: true,
      provider: 'p',
      model: 'm',
      maxTokens: 100,
    }
  }
}

export async function createHarness(options = {}) {
  const root = new Context()
  const emitted = []
  const state = { agent: null }
  root.provide('tokenMeter', makeMeter())
  // Constructing the engine registers it as the `compaction` service (its
  // Cordis service name), so it is the provider the gate resolves.
  const engine = options.noProvider === true ? null : new TestEngine(root, { auto: false })
  const services = {
    loader: {
      // Loader entries carry their identity under `options` (the shape the
      // replacement bundle's own composition probe reads).
      entries: () => options.loaderEntries ?? [
        { options: { id: 'plugin-api-compaction-events' } },
        { options: { id: 'compaction-basic' }, disabled: true },
      ],
    },
    llm: { resolveModelInfo: async () => ({ context: { contextWindow: 1000 } }), prepareCall() {}, stream() {}, registerAdapter() {}, registerConfigurableProviders() {}, registerModelDiscovery() {} },
    tools: { register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {}, executionMode() { return 'mode' } },
    agents: {
      get: (id) => {
        if (id !== 'agent-1') return undefined
        state.agent ??= {
          id,
          session: options.session ?? makeSession(),
          options: { provider: 'p', model: 'm' },
          // The official agent loop's maintenance bracket: run the job under a
          // fresh signal (the idle-session precondition of mode 'now').
          runMaintenance(job) {
            return job(new AbortController().signal)
          },
        }
        return state.agent
      },
      list() {},
      roots() {},
    },
    sessions: { get() {}, list() {}, fork() {}, async flush() {} },
    settings: { register() {}, describe() { return [] }, get() {}, mutate() {} },
    systemPrompt: { section() {}, context() {}, variable() {}, tools() {}, suppressRuntimeContext() {}, renderPrompt() {}, renderContextSections() {}, renderContextSnapshot() {}, joinContextSections() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    web: { registerSearchProvider() {}, registerFetchProvider() {} },
  }
  for (const [name, value] of Object.entries(services)) root.provide(name, value)
  if (engine !== null) {
    // The forked engine already carries the contract marker on every instance;
    // the operation sub-face (and its marker) is attached unless the scenario
    // asks for a provider without it.
    assert.equal(engine[COMPACTION_EVENTS_CONTRACT_MARKER], true, 'the forked engine carries the contract marker')
    if (options.withSubface !== false) attachOperationSubface(engine)
  }

  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: () => true })
  root.plugin(ServiceClass)
  await settle()
  const service = root.pluginApi
  const { mountSessionCompactionFeature } = await import('../lib/sessions-compaction-facade.js')
  const facts = []
  for (const name of ['compaction/started', 'compaction/completed', 'compaction/failed', 'compaction/skipped']) {
    root.on(name, () => { facts.push(name) })
  }
  const mounted = options.noMount === true ? null : mountSessionCompactionFeature({
    ctx: root,
    service,
    featureRegistry: registry,
    logger: { warn: (message) => emitted.push({ name: 'warn', message }) },
    auxiliaryManifests: { compactionEvents: options.auxiliaryManifest ?? { version: REPLACEMENT_VERSION, api: '0.1' } },
    facadeContract: { runtime: '0.1.0-rc.6', api: '0.1' },
  })
  mounted?.prepared?.commit?.()
  if (mounted) registry.mount('sessionCompaction')
  return { root, service, registry, engine, emitted, facts, mounted, prepared: mounted?.prepared ?? null }
}

export { makeSession, makeMeter, hasOperationSubface, OPERATION_SUBFACE_SYMBOL }
export const agentOf = (kit) => kit.root.get('agents').get('agent-1')
export const faceOf = (kit) => kit.root.pluginApi.sessions.compaction
