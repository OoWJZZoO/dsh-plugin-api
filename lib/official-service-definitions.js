function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const key of Object.keys(value)) deepFreeze(value[key])
  return Object.freeze(value)
}

const definitions = [
  {
    key: 'agentLoop',
    ctxService: 'agentLoop',
    members: [
      { kind: 'getter', name: 'config' },
      { kind: 'method', name: 'create' },
      { kind: 'method', name: 'createAgent' },
      { kind: 'method', name: 'resume' },
    ],
  },
  {
    key: 'agentPresets',
    ctxService: 'agentPresets',
    members: [
      { kind: 'method', name: 'list' },
      { kind: 'method', name: 'resolve' },
      { kind: 'method', name: 'mount' },
      { kind: 'method', name: 'composeFrom' },
      { kind: 'method', name: 'composedPreset' },
      { kind: 'method', name: 'read' },
      { kind: 'method', name: 'copy' },
      { kind: 'method', name: 'remove' },
      { kind: 'method', name: 'serviceFor' },
      { kind: 'method', name: 'recompose' },
      { kind: 'method', name: 'standingKeyFor' },
    ],
  },
  {
    key: 'apiProxy',
    ctxService: 'apiProxy',
    members: [
      { kind: 'getter', name: 'downloads' },
      { kind: 'method', name: 'respond' },
    ],
  },
  {
    key: 'clientModules',
    ctxService: 'clientModules',
    members: [
      { kind: 'method', name: 'graph' },
      { kind: 'method', name: 'clientPath' },
      { kind: 'method', name: 'rebuilt' },
      { kind: 'method', name: 'onRebuilt' },
      { kind: 'method', name: 'onGraphChanged' },
    ],
  },
  {
    key: 'commands',
    ctxService: 'commands',
    members: [
      { kind: 'method', name: 'register' },
      { kind: 'method', name: 'list' },
      { kind: 'method', name: 'find' },
      { kind: 'method', name: 'execute' },
    ],
  },
  {
    key: 'credentials',
    ctxService: 'credentials',
    members: [
      { kind: 'method', name: 'resolve' },
      { kind: 'method', name: 'describe' },
    ],
  },
  {
    key: 'directoryPicker',
    ctxService: 'directoryPicker',
    members: [{ kind: 'method', name: 'capability' }],
  },
  {
    key: 'e2b',
    ctxService: 'e2b',
    members: [
      { kind: 'getter', name: 'cwd' },
      { kind: 'getter', name: 'runtimeRoot' },
      { kind: 'method', name: 'getSandbox' },
    ],
  },
  {
    key: 'goals',
    ctxService: 'goals',
    members: [
      { kind: 'method', name: 'get' },
      { kind: 'method', name: 'disarm' },
      { kind: 'method', name: 'create' },
      { kind: 'method', name: 'edit' },
      { kind: 'method', name: 'pause' },
      { kind: 'method', name: 'resume' },
      { kind: 'method', name: 'complete' },
      { kind: 'method', name: 'block' },
      { kind: 'method', name: 'clear' },
      { kind: 'method', name: 'remoteExportCreate' },
    ],
  },
  {
    key: 'invariants',
    ctxService: 'invariants',
    members: [{ kind: 'method', name: 'register' }],
  },
  {
    key: 'lsp',
    ctxService: 'lsp',
    members: [
      { kind: 'method', name: 'registerProvider' },
      { kind: 'method', name: 'query' },
    ],
  },
  {
    key: 'messageFeedback',
    ctxService: 'messageFeedback',
    members: [
      { kind: 'method', name: 'list' },
      { kind: 'method', name: 'put' },
      { kind: 'method', name: 'delete' },
    ],
  },
  {
    key: 'permissionPresets',
    ctxService: 'permissionPresets',
    members: [
      { kind: 'method', name: 'current' },
      { kind: 'method', name: 'resolve' },
      { kind: 'method', name: 'optionOf' },
    ],
  },
  {
    key: 'planMode',
    ctxService: 'planMode',
    members: [
      { kind: 'method', name: 'get' },
    ],
  },
  {
    key: 'sandbox',
    ctxService: 'sandbox',
    members: [{ kind: 'method', name: 'confine' }],
  },
  {
    key: 'sandboxPolicy',
    ctxService: 'sandboxPolicy',
    members: [
      { kind: 'getter', name: 'defaultMode' },
      { kind: 'getter', name: 'workspaceRoot' },
      { kind: 'method', name: 'resolve' },
      { kind: 'method', name: 'overrideOf' },
    ],
  },
  {
    key: 'sessionPersistence',
    ctxService: 'sessionPersistence',
    members: [
      { kind: 'method', name: 'locate' },
      { kind: 'getter', name: 'supportsRawArtifacts' },
      { kind: 'method', name: 'readRaw' },
      { kind: 'method', name: 'create' },
      { kind: 'method', name: 'append' },
      { kind: 'method', name: 'prepare' },
      { kind: 'method', name: 'load' },
      { kind: 'method', name: 'inspect' },
      { kind: 'method', name: 'readFrom' },
      { kind: 'method', name: 'list' },
      { kind: 'method', name: 'listSnapshots' },
    ],
  },
  {
    key: 'sessionProjectionCache',
    ctxService: 'sessionProjectionCache',
    members: [
      { kind: 'method', name: 'cachedSnapshot' },
      { kind: 'method', name: 'coldSnapshot' },
    ],
  },
  {
    key: 'shell',
    ctxService: 'shell',
    members: [
      { kind: 'method', name: 'resolve' },
      { kind: 'method', name: 'run' },
      { kind: 'method', name: 'start' },
    ],
  },
  {
    key: 'spillStore',
    ctxService: 'spillStore',
    members: [{ kind: 'method', name: 'saveText' }],
  },
  {
    key: 'storageDomain',
    ctxService: 'storageDomain',
    members: [
      { kind: 'method', name: 'open' },
      { kind: 'method', name: 'get' },
      { kind: 'method', name: 'closeAll' },
    ],
  },
  {
    key: 'subprocess',
    ctxService: 'subprocess',
    members: [
      { kind: 'method', name: 'resolveExecutable' },
      { kind: 'method', name: 'spawn' },
      { kind: 'method', name: 'spawnTerminal' },
    ],
  },
  {
    key: 'terminals',
    ctxService: 'terminals',
    members: [
      { kind: 'method', name: 'registerBackend' },
      { kind: 'method', name: 'listBackends' },
      { kind: 'method', name: 'spawn' },
      { kind: 'method', name: 'hasOwnerActivity' },
      { kind: 'method', name: 'startSend' },
      { kind: 'method', name: 'read' },
      { kind: 'method', name: 'signal' },
      { kind: 'method', name: 'kill' },
      { kind: 'method', name: 'list' },
    ],
  },
  {
    key: 'timer',
    ctxService: 'timer',
    members: [
      { kind: 'method', name: 'timeout' },
      { kind: 'method', name: 'interval' },
      { kind: 'method', name: 'throttle' },
      { kind: 'method', name: 'debounce' },
    ],
  },
  {
    key: 'toolResultPruner',
    ctxService: 'toolResultPruner',
    members: [
      { kind: 'getter', name: 'config' },
      { kind: 'method', name: 'measureContent' },
      { kind: 'method', name: 'pruneContent' },
      { kind: 'method', name: 'pruneSession' },
    ],
  },
  {
    key: 'typertGateway',
    ctxService: 'typertGateway',
    members: [{ kind: 'method', name: 'invoke' }],
  },
  {
    key: 'webServer',
    ctxService: 'webServer',
    members: [
      { kind: 'method', name: 'register' },
      { kind: 'method', name: 'registerUpgrade' },
      { kind: 'method', name: 'registerFallback' },
      { kind: 'method', name: 'tapIndex' },
      { kind: 'method', name: 'applyIndexTaps' },
    ],
  },
  {
    key: 'web',
    ctxService: 'web',
    members: [
      { kind: 'method', name: 'registerSearchProvider' },
      { kind: 'method', name: 'registerFetchProvider' },
      { kind: 'method', name: 'search' },
      { kind: 'method', name: 'fetch' },
    ],
  },
]

export const OFFICIAL_SERVICE_DEFINITIONS = deepFreeze(definitions)
