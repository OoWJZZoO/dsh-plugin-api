function freeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value
  seen.add(value)
  for (const child of Object.values(value)) freeze(child, seen)
  return Object.freeze(value)
}

const method = (name) => ({ kind: 'method', name })
const getter = (name) => ({ kind: 'getter', name })

export const CATALOG_ENTRY_FIELDS = freeze([
  'name',
  'mode',
  'scopeFiltered',
  'scopeKey',
  'payload',
  'args',
  'fault',
  'freeze',
])

export const HOST_NAMESPACE_CONTRACTS = freeze([
  {
    name: 'llm',
    members: [
      'listProviders',
      'listConfigurableProviders',
      'discoverModels',
      'providerRetryPolicy',
      'listModels',
      'resolveCallConfig',
      'contentHasImage',
      'createUserMessage',
      'BlockAssembler',
    ],
  },
  {
    name: 'agent',
    members: [
      'currentInitiator',
      'requireInitiator',
      'withInitiator',
      'withoutInitiator',
      'isOwnedBy',
      'options',
    ],
  },
  {
    name: 'session',
    members: [
      'create',
      'prepare',
      'enter',
      'announce',
      'flush',
      'append',
      'deriveEventMessage',
    ],
  },
  {
    name: 'tools',
    members: ['toolAbortedError', 'executionMode', 'defineTool'],
  },
  {
    name: 'systemPrompt',
    members: ['assemble'],
  },
  {
    name: 'settings',
    members: ['writable', 'prepareDocument', 'get', 'update', 'replace', 'mutate'],
  },
])

export const HOST_EVENT_SLICES = freeze([
  {
    name: 'agentLoop',
    events: ['agent-loop/config-start-failed'],
  },
  {
    name: 'agentPreset',
    events: ['agent-preset/selected'],
  },
  {
    name: 'dynamicCordis',
    events: [
      'cordis/dynamic-package',
      'cordis/dynamic-retract',
      'cordis/request-run',
      'cordis/request-run-resolved',
    ],
  },
  {
    name: 'inspectCordis',
    events: ['cordis/inspect-query', 'cordis/inspect-query-resolved'],
  },
  {
    name: 'storageDomain',
    events: ['domain/changed'],
  },
])

export const HOST_EVENT_CONTRACTS = freeze([
  {
    name: 'agent-loop/config-start-failed',
    mode: 'emit',
    scopeFiltered: false,
    scopeKey: undefined,
    payload: '{ sessionId, error }',
    args: '(payload)',
    fault: 'contain',
    freeze: 'all',
  },
  {
    name: 'agent-preset/selected',
    mode: 'emit',
    scopeFiltered: false,
    scopeKey: undefined,
    payload: 'sessionId; agentPreset',
    args: '(sessionId, agentPreset)',
    fault: 'contain',
    freeze: 'all',
  },
  {
    name: 'cordis/dynamic-package',
    mode: 'emit',
    scopeFiltered: false,
    scopeKey: undefined,
    payload: 'DynamicCordisPackage',
    args: '(pkg)',
    fault: 'contain',
    freeze: 'all',
  },
  {
    name: 'cordis/dynamic-retract',
    mode: 'emit',
    scopeFiltered: false,
    scopeKey: undefined,
    payload: 'DynamicCordisRetracted',
    args: '(retracted)',
    fault: 'contain',
    freeze: 'all',
  },
  {
    name: 'cordis/request-run',
    mode: 'emit',
    scopeFiltered: false,
    scopeKey: undefined,
    payload: 'DynamicCordisRunRequest',
    args: '(request)',
    fault: 'contain',
    freeze: 'all',
  },
  {
    name: 'cordis/request-run-resolved',
    mode: 'emit',
    scopeFiltered: false,
    scopeKey: undefined,
    payload: 'DynamicCordisRequestResolved',
    args: '(resolved)',
    fault: 'contain',
    freeze: 'all',
  },
  {
    name: 'cordis/inspect-query',
    mode: 'emit',
    scopeFiltered: false,
    scopeKey: undefined,
    payload: 'CordisInspectQueryRequest',
    args: '(request)',
    fault: 'contain',
    freeze: 'all',
  },
  {
    name: 'cordis/inspect-query-resolved',
    mode: 'emit',
    scopeFiltered: false,
    scopeKey: undefined,
    payload: 'CordisInspectQueryResolved',
    args: '(resolved)',
    fault: 'contain',
    freeze: 'all',
  },
  {
    name: 'domain/changed',
    mode: 'emit',
    scopeFiltered: false,
    scopeKey: undefined,
    payload: 'DomainChanged',
    args: '(change)',
    fault: 'contain',
    freeze: 'all',
  },
])

export const CLIENT_SERVICE_CONTRACTS = freeze([
  {
    name: 'modules',
    members: ['version', 'loadCache', 'import', 'registerStatic', 'prefetch', 'invalidate'],
  },
  {
    name: 'locale',
    members: ['getLocale', 'getSnapshot', 'subscribe', 'setLocale', 'register', 'bind'],
  },
  {
    name: 'sessions',
    members: [
      'list',
      'currentProvideInfo',
      'searchResultLimit',
      'open',
      'openSubagent',
      'subagentAddress',
      'setSubagentCatalogOpen',
      'refreshSubagents',
      'noteAgentPreset',
      'clear',
      'search',
      'fork',
      'provide',
      'scope',
      'scopeOf',
      'sessionOf',
      'binding',
    ],
  },
  {
    name: 'workspaces',
    members: [
      'list',
      'connectWorkspace',
      'startSession',
      'create',
      'pickDirectory',
      'listDirectory',
      'createDirectory',
      'openPath',
      'rename',
      'delete',
      'insertBefore',
      'insertSessionBefore',
      'archiveSession',
    ],
  },
  { name: 'chatFileMentions', members: ['forClosing'] },
  { name: 'layout', members: ['toggleSidebar', 'openDetails', 'closeDetails'] },
  {
    name: 'theme',
    members: ['getTheme', 'exportInspectTokens', 'setTheme', 'register', 'overrideTokens'],
  },
  { name: 'appShell', members: ['renderApp'] },
  { name: 'sessionLogDownload', members: ['store', 'download', 'dismiss', 'dispose'] },
  { name: 'cordisInspect', members: ['register', 'publish', 'query', 'close'] },
  {
    name: 'dynamicCordisRunner',
    members: [
      'activeRuns',
      'lastRunError',
      'renderFailures',
      'reconcileApprovals',
      'approve',
      'decline',
      'startUserRun',
      'subscribe',
      'getSnapshot',
      'isLoaded',
    ],
  },
])

export const CLIENT_EVENT_CONTRACTS = freeze([
  { name: 'locale/change', args: '(snapshot)' },
  { name: 'theme/change', args: '(snapshot)' },
  { name: 'connection/reset', args: '(official payload)' },
  { name: 'command/executed', args: '(sessionId, commandName, result)' },
])

export const CLIENT_CONNECTION_CONTRACT = freeze({
  name: 'llm',
  members: ['providers', 'models', 'discoverModels'],
})

export const SERVICE_DEFINITION_CONTRACTS = freeze([
  {
    key: 'agentLoop',
    ctxService: 'agentLoop',
    members: [getter('config'), method('create'), method('createAgent'), method('resume')],
  },
  {
    key: 'agentPresets',
    ctxService: 'agentPresets',
    members: [
      method('list'),
      method('resolve'),
      method('mount'),
      method('composeFrom'),
      method('composedPreset'),
      method('read'),
      method('copy'),
      method('remove'),
      method('serviceFor'),
      method('recompose'),
      method('standingKeyFor'),
    ],
  },
  {
    key: 'apiProxy',
    ctxService: 'apiProxy',
    members: [getter('downloads'), method('respond')],
  },
  {
    key: 'clientModules',
    ctxService: 'clientModules',
    members: [method('graph'), method('clientPath'), method('rebuilt'), method('onRebuilt'), method('onGraphChanged')],
  },
  {
    key: 'commands',
    ctxService: 'commands',
    members: [method('register'), method('list'), method('find'), method('execute')],
  },
  {
    key: 'credentials',
    ctxService: 'credentials',
    members: [method('resolve'), method('describe')],
  },
  { key: 'directoryPicker', ctxService: 'directoryPicker', members: [method('capability')] },
  {
    key: 'e2b',
    ctxService: 'e2b',
    members: [getter('cwd'), getter('runtimeRoot'), method('getSandbox')],
  },
  {
    key: 'goals',
    ctxService: 'goals',
    members: [
      method('get'),
      method('disarm'),
      method('create'),
      method('edit'),
      method('pause'),
      method('resume'),
      method('complete'),
      method('block'),
      method('clear'),
      method('remoteExportCreate'),
    ],
  },
  { key: 'invariants', ctxService: 'invariants', members: [method('register')] },
  { key: 'lsp', ctxService: 'lsp', members: [method('registerProvider'), method('query')] },
  {
    key: 'messageFeedback',
    ctxService: 'messageFeedback',
    members: [method('list'), method('put'), method('delete')],
  },
  {
    key: 'permissionPresets',
    ctxService: 'permissionPresets',
    members: [method('current'), method('resolve'), method('optionOf')],
  },
  { key: 'planMode', ctxService: 'planMode', members: [method('get')] },
  { key: 'sandbox', ctxService: 'sandbox', members: [method('confine')] },
  {
    key: 'sandboxPolicy',
    ctxService: 'sandboxPolicy',
    members: [getter('defaultMode'), getter('workspaceRoot'), method('resolve'), method('overrideOf')],
  },
  {
    key: 'sessionPersistence',
    ctxService: 'sessionPersistence',
    members: [
      method('locate'),
      getter('supportsRawArtifacts'),
      method('readRaw'),
      method('create'),
      method('append'),
      method('prepare'),
      method('load'),
      method('inspect'),
      method('readFrom'),
      method('list'),
      method('listSnapshots'),
    ],
  },
  {
    key: 'sessionProjectionCache',
    ctxService: 'sessionProjectionCache',
    members: [method('cachedSnapshot'), method('coldSnapshot')],
  },
  { key: 'shell', ctxService: 'shell', members: [method('resolve'), method('run'), method('start')] },
  { key: 'spillStore', ctxService: 'spillStore', members: [method('saveText')] },
  {
    key: 'storageDomain',
    ctxService: 'storageDomain',
    members: [method('open'), method('get'), method('closeAll')],
  },
  {
    key: 'subprocess',
    ctxService: 'subprocess',
    members: [method('resolveExecutable'), method('spawn'), method('spawnTerminal')],
  },
  {
    key: 'terminals',
    ctxService: 'terminals',
    members: [
      method('registerBackend'),
      method('listBackends'),
      method('spawn'),
      method('hasOwnerActivity'),
      method('startSend'),
      method('read'),
      method('signal'),
      method('kill'),
      method('list'),
    ],
  },
  {
    key: 'timer',
    ctxService: 'timer',
    members: [method('timeout'), method('interval'), method('throttle'), method('debounce')],
  },
  {
    key: 'toolResultPruner',
    ctxService: 'toolResultPruner',
    members: [getter('config'), method('measureContent'), method('pruneContent'), method('pruneSession')],
  },
  { key: 'typertGateway', ctxService: 'typertGateway', members: [method('invoke')] },
  {
    key: 'webServer',
    ctxService: 'webServer',
    members: [
      method('register'),
      method('registerUpgrade'),
      method('registerFallback'),
      method('tapIndex'),
      method('applyIndexTaps'),
    ],
  },
  {
    key: 'web',
    ctxService: 'web',
    members: [method('registerSearchProvider'), method('registerFetchProvider'), method('search'), method('fetch')],
  },
])

export const CONTRACT_CARDINALITIES = freeze({
  catalogFields: 8,
  hostNamespaces: 6,
  hostNamespaceMembers: 32,
  hostEventSlices: 5,
  hostEvents: 9,
  clientServices: 11,
  clientServiceMembers: 70,
  clientEvents: 4,
  clientConnectionMembers: 3,
  serviceDefinitionInputs: 28,
  additionalServiceKeys: 27,
  finalServiceKeys: 46,
})
