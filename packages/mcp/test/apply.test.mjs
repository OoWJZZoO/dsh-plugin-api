import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createMcpApply,
  name,
  inject,
  Config,
  inspectComposition,
} from '../lib/apply.js'
import { McpCatalogService } from '../lib/catalog.js'

const CONSISTENT = { version: '0.1.0-rc.6-0.7', api: '0.7' }
const GOOD = {
  '@deepseek-ai/dsh-llm': '0.1.0-rc.6',
  '@deepseek-ai/dsh-mcp-client': '0.1.0-rc.6',
}

function makeEnv({ versions = {}, api = {} } = {}) {
  const readVersion = (pkg) => (versions[pkg] !== undefined ? versions[pkg] : CONSISTENT.version)
  const readApi = (pkg) => (api[pkg] !== undefined ? api[pkg] : CONSISTENT.api)
  return { readVersion, readApi }
}

function makeRoot({ pluginError = null } = {}) {
  const serviceMap = new Map()
  const root = {
    reflect: { provide() {} },
    on() {
      return () => {}
    },
    emit() {},
    plugin(ServiceClass, shared) {
      if (pluginError) throw pluginError
      const service = new ServiceClass(root, shared)
      serviceMap.set('mcpCatalog', service)
      return () => serviceMap.delete('mcpCatalog')
    },
    get(svcName) {
      return serviceMap.get(svcName)
    },
    serviceMap,
  }
  return root
}

function makeCtx({ loaderEntries = [], root } = {}) {
  const warns = []
  const effects = []
  const ctx = {
    root: root ?? makeRoot(),
    logger: { warn: (m) => warns.push(m), error: (m) => warns.push(m), info() {} },
    get(svc) {
      return ctx.root.get(svc)
    },
    loader: {
      entries() {
        return loaderEntries
      },
    },
    effect(cleanup, label) {
      effects.push({ cleanup, label })
      return () => {}
    },
    warns,
    effects,
  }
  return ctx
}

const perServerConfig = {
  serverName: 'github',
  transport: 'stdio',
  command: 'npx',
  args: [],
  env: {},
  cwd: '',
  toolCallTimeoutMs: 1000,
  failOnStartupError: false,
}

function startRecording() {
  const started = []
  const connections = []
  const startConnectionOverride = (ctx, config, policy, hooks) => {
    started.push({ config, policy, hooks })
    const connection = {
      ready: Promise.resolve({}),
      dispose: async () => {
        connections.push('disposed')
      },
    }
    connections.push(connection)
    return connection
  }
  return { started, connections, startConnectionOverride }
}

test('exports a Cordis-compatible surface', () => {
  assert.equal(name, 'plugin-api-mcp')
  assert.ok(inject.includes('loader'))
  assert.ok(inject.includes('tools'))
  assert.ok(Config !== undefined && Config !== null, 'per-server Config shape is preserved')
})

test('apply: official row enabled -> stays inert, never double-runs', async () => {
  const { readVersion, readApi } = makeEnv({ versions: GOOD })
  const ctx = makeCtx({
    loaderEntries: [{ options: { id: 'mcp-client', name: '@deepseek-ai/dsh-mcp-client', disabled: false } }],
  })
  const { startConnectionOverride } = startRecording()
  const apply = createMcpApply({ readPackageVersion: readVersion, readPackageApi: readApi, startConnectionOverride })
  await apply(ctx, perServerConfig)
  assert.equal(ctx.root.serviceMap.has('mcpCatalog'), false, 'must not register service while official runs')
  assert.equal(ctx.root.get('mcpCatalog'), undefined)
})

test('apply: duplicate replacement insertion -> stays inert', async () => {
  const { readVersion, readApi } = makeEnv({ versions: GOOD })
  const ctx = makeCtx({
    loaderEntries: [
      { options: { id: 'plugin-api-mcp', name: '@deepseek-ai/dsh-plugin-api-mcp' } },
      { options: { id: 'plugin-api-mcp', name: '@deepseek-ai/dsh-plugin-api-mcp' } },
    ],
  })
  const { startConnectionOverride } = startRecording()
  const apply = createMcpApply({ readPackageVersion: readVersion, readPackageApi: readApi, startConnectionOverride })
  await apply(ctx, perServerConfig)
  assert.ok(ctx.warns.some((w) => w.includes('duplicate replacement row')))
})

test('apply: runtime identity mismatch disables only this capability', async () => {
  const { readVersion, readApi } = makeEnv({ versions: { ...GOOD, '@deepseek-ai/dsh-llm': '0.1.0-rc.7' } })
  const ctx = makeCtx({})
  const { startConnectionOverride } = startRecording()
  const apply = createMcpApply({ readPackageVersion: readVersion, readPackageApi: readApi, startConnectionOverride })
  await apply(ctx, perServerConfig)
  assert.equal(ctx.root.serviceMap.has('mcpCatalog'), false)
  assert.ok(ctx.warns.some((w) => w.includes('runtime identity mismatch')))
})

test('apply: official package identity mismatch disables only this capability', async () => {
  const { readVersion, readApi } = makeEnv({ versions: { ...GOOD, '@deepseek-ai/dsh-mcp-client': '0.1.0-rc.7' } })
  const ctx = makeCtx({})
  const { startConnectionOverride } = startRecording()
  const apply = createMcpApply({ readPackageVersion: readVersion, readPackageApi: readApi, startConnectionOverride })
  await apply(ctx, perServerConfig)
  assert.equal(ctx.root.serviceMap.has('mcpCatalog'), false)
  assert.ok(ctx.warns.some((w) => w.includes('official package identity mismatch')))
})

test('apply: main facade version mismatch disables only this capability', async () => {
  const { readVersion, readApi } = makeEnv({ api: { '@deepseek-ai/dsh-plugin-api-main': '0.4' } })
  const ctx = makeCtx({})
  const { startConnectionOverride } = startRecording()
  const apply = createMcpApply({ readPackageVersion: readVersion, readPackageApi: readApi, startConnectionOverride })
  await apply(ctx, perServerConfig)
  assert.equal(ctx.root.serviceMap.has('mcpCatalog'), false)
  assert.ok(ctx.warns.some((w) => w.includes('main facade version mismatch')))
})

test('apply: catalog service registration failure rolls back and stays inert', async () => {
  const { readVersion, readApi } = makeEnv({ versions: GOOD })
  const root = makeRoot({ pluginError: new Error('reflect broken') })
  const ctx = makeCtx({ root })
  const { started, startConnectionOverride } = startRecording()
  const apply = createMcpApply({ readPackageVersion: readVersion, readPackageApi: readApi, startConnectionOverride })
  await apply(ctx, perServerConfig)
  assert.ok(ctx.warns.some((w) => w.includes('failed to register the catalog service')))
  assert.equal(started.length, 0, 'must not start a connection before the service is live')
})

test('apply: success path registers catalog service, starts faithful connection and arms cleanup', async () => {
  const { readVersion, readApi } = makeEnv({ versions: GOOD })
  const ctx = makeCtx({})
  const { started, connections, startConnectionOverride } = startRecording()
  const apply = createMcpApply({ readPackageVersion: readVersion, readPackageApi: readApi, startConnectionOverride })
  await apply(ctx, perServerConfig)
  assert.ok(ctx.root.serviceMap.has('mcpCatalog'), 'catalog service registered')
  assert.equal(ctx.root.get('mcpCatalog') instanceof McpCatalogService, true)
  assert.equal(started.length, 1)
  assert.equal(started[0].config.serverName, 'github')
  assert.equal(ctx.effects.length, 1)
  assert.equal(ctx.effects[0].label, 'plugin-api-mcp.connection')
  // run the cleanup -> connection.dispose
  ctx.effects[0].cleanup()
  await Promise.resolve()
  await Promise.resolve()
})

test('apply: fail-safe never throws on hostile inputs', async () => {
  const { readVersion, readApi } = makeEnv({ versions: GOOD })
  const ctx = {
    logger: { warn() {} },
    get() {
      throw new Error('no service access')
    },
    loader: {
      entries() {
        throw new Error('loader exploded')
      },
    },
    effect() {},
  }
  const apply = createMcpApply({ readPackageVersion: readVersion, readPackageApi: readApi })
  await assert.doesNotReject(() => apply(ctx, null))
  await assert.doesNotReject(() => apply(ctx, undefined))
})

test('inspectComposition classifies official and replacement entries', () => {
  const ctx = makeCtx({
    loaderEntries: [
      { options: { id: 'mcp-client', name: '@deepseek-ai/dsh-mcp-client', disabled: true } },
      { options: { id: 'plugin-api-mcp', name: '@deepseek-ai/dsh-plugin-api-mcp' } },
    ],
  })
  const composition = inspectComposition(ctx)
  assert.equal(composition.officialPresent, true)
  assert.equal(composition.anyOfficialEnabled, false)
  assert.equal(composition.replacementCount, 1)
})

test('apply: competing replacement owner on the same root fails safe (no double run)', async () => {
  const { readVersion, readApi } = makeEnv({ versions: GOOD })
  const root = makeRoot()
  root[Symbol.for('dsh-plugin-api.mcp.contract')] = { package: 'another-owner-package' }
  const ctx = makeCtx({ root })
  const { started, startConnectionOverride } = startRecording()
  const apply = createMcpApply({ readPackageVersion: readVersion, readPackageApi: readApi, startConnectionOverride })
  await apply(ctx, perServerConfig)
  assert.equal(root.serviceMap.has('mcpCatalog'), false, 'must not register when another owner holds the component')
  assert.equal(started.length, 0)
  assert.ok(ctx.warns.some((w) => w.includes('another replacement') && w.includes('owns')))
})

test('apply: multiple instances of the same replacement package share the root catalog', async () => {
  const { readVersion, readApi } = makeEnv({ versions: GOOD })
  const root = makeRoot()
  const ctx1 = makeCtx({ root })
  const { startConnectionOverride } = startRecording()
  const apply = createMcpApply({ readPackageVersion: readVersion, readPackageApi: readApi, startConnectionOverride })
  await apply(ctx1, perServerConfig)
  assert.ok(root.serviceMap.has('mcpCatalog'))
  // a second instance of the SAME package (another MCP server) is allowed
  const ctx2 = makeCtx({ root })
  const apply2 = createMcpApply({ readPackageVersion: readVersion, readPackageApi: readApi, startConnectionOverride })
  await apply2(ctx2, { ...perServerConfig, serverName: 'db' })
  assert.ok(root.serviceMap.has('mcpCatalog'))
  assert.equal(root[Symbol.for('dsh-plugin-api.mcp.contract')].package, '@deepseek-ai/dsh-plugin-api-mcp')
})
