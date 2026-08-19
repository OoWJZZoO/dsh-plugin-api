import { deepFreeze } from '../deep-freeze.js'
import { A_CLASSES, CLASSIFICATIONS, RULE_REGISTRY_VERSION } from './constants.js'

const SERVICE_MAPPINGS = Object.freeze({
  agents: 'agent',
  sessions: 'session',
  llm: 'llm',
  tools: 'tools',
  systemPrompt: 'systemPrompt',
  settings: 'settings',
})

const SAFE_METHODS = Object.freeze({
  agent: Object.freeze(['get', 'list', 'roots']),
  session: Object.freeze([
    'get', 'list', 'fork', 'header', 'events', 'seq', 'surface',
    'requestHeader', 'requestContext', 'deriveMessages',
  ]),
  llm: Object.freeze([
    'modelInfo', 'prepareCall', 'stream', 'registerAdapter',
    'registerConfigurableProviders', 'registerModelDiscovery',
  ]),
  tools: Object.freeze([
    'register', 'restrict', 'guard', 'get', 'schemas', 'execute', 'presentAs',
  ]),
  systemPrompt: Object.freeze([
    'section', 'context', 'variable', 'tools', 'suppressRuntimeContext',
    'render', 'renderContextSections',
  ]),
  settings: Object.freeze(['register', 'scope', 'describe', 'installSettingsSection']),
})

const PACKAGE_SURFACES = Object.freeze({
  '@deepseek-ai/dsh-client-connection': 'client',
  '@deepseek-ai/dsh-client-runtime': 'client',
  '@deepseek-ai/dsh-api-remotes': 'client',
  '@deepseek-ai/dsh-client-ui-settings': 'client',
  '@deepseek-ai/dsh-client-modules': 'client',
})

const RULES = [
  {
    id: 'host.service.alias',
    registryVersion: RULE_REGISTRY_VERSION,
    surface: 'host',
    aClass: 'A',
    classification: 'SAFE',
    source: { services: Object.keys(SERVICE_MAPPINGS) },
    target: { namespace: 'service-alias' },
    methodsByService: SAFE_METHODS,
    minApiProtocol: '0.3',
    exactRuntimeIdentity: null,
    equivalence: 'Only immutable aliases to the public service receiver are projected; unknown methods do not match.',
    guidance: 'Replace immutable public service receivers with pluginApi namespaces.',
    specificity: 40,
  },
  {
    id: 'host.event.static',
    registryVersion: RULE_REGISTRY_VERSION,
    surface: 'host',
    aClass: 'A',
    classification: 'REVIEW',
    source: { nodeKinds: ['event-call'] },
    target: { namespace: 'events' },
    minApiProtocol: '0.3',
    exactRuntimeIdentity: null,
    equivalence: 'The facade preserves the official event mode only after callback, scope, freeze and fault semantics are reviewed.',
    guidance: 'Review callback mode, scope, freeze and fault semantics before moving to pluginApi.events.',
    specificity: 30,
  },
  {
    id: 'unknown.event.static',
    registryVersion: RULE_REGISTRY_VERSION,
    surface: 'host',
    aClass: 'unknown',
    classification: 'MANUAL',
    source: { nodeKinds: ['unknown-event'] },
    target: { namespace: null },
    minApiProtocol: '0.3',
    exactRuntimeIdentity: null,
    equivalence: 'An event name outside the frozen catalog has no statically proven facade contract.',
    guidance: 'Confirm the event catalog entry and its callback, scope, freeze, and fault semantics manually.',
    specificity: 31,
  },
  {
    id: 'host.semantic-hook',
    registryVersion: RULE_REGISTRY_VERSION,
    surface: 'host',
    aClass: 'B',
    classification: 'REVIEW',
    source: { nodeKinds: ['monkey-patch', 'semantic-hook'] },
    target: { namespace: null },
    minApiProtocol: '0.3',
    exactRuntimeIdentity: null,
    equivalence: 'Semantic hooks require human mapping to an explicit B-class facade contract.',
    guidance: 'Map the behavior to a specific llm/request, llm/admission, routing, or session-durable contract.',
    specificity: 20,
  },
  {
    id: 'host.facade-injection',
    registryVersion: RULE_REGISTRY_VERSION,
    surface: 'host',
    aClass: 'A',
    classification: 'REVIEW',
    source: { nodeKinds: ['facade-injection-required'] },
    target: { namespace: 'pluginApi' },
    minApiProtocol: '0.3',
    exactRuntimeIdentity: null,
    equivalence: 'Entry injection and activation guards are only equivalent when a unique static apply entry is proven.',
    guidance: 'Review the entry function, injection array, directive prologue, and activation guard manually.',
    specificity: 33,
  },
  {
    id: 'host.injection-array',
    registryVersion: RULE_REGISTRY_VERSION,
    surface: 'host',
    aClass: 'A',
    classification: 'SAFE',
    source: { nodeKinds: ['injection-array'] },
    target: { namespace: 'pluginApi' },
    minApiProtocol: '0.3',
    exactRuntimeIdentity: null,
    equivalence: 'A static injection array is preserved and can receive one additional pluginApi entry.',
    guidance: 'Preserve existing injections and add pluginApi exactly once.',
    specificity: 32,
  },
  {
    id: 'host.entry',
    registryVersion: RULE_REGISTRY_VERSION,
    surface: 'host',
    aClass: 'A',
    classification: 'SAFE',
    source: { nodeKinds: ['apply-entry'] },
    target: { namespace: 'pluginApi' },
    minApiProtocol: '0.3',
    exactRuntimeIdentity: null,
    equivalence: 'The selected apply entry is recorded without changing its exported symbol or lifecycle.',
    guidance: 'Verify the selected entry is the plugin host entry before applying edits.',
    specificity: 18,
  },
  {
    id: 'client.direct-package',
    registryVersion: RULE_REGISTRY_VERSION,
    surface: 'client',
    aClass: 'A',
    classification: 'REVIEW',
    source: { packages: Object.keys(PACKAGE_SURFACES) },
    target: { namespace: 'client' },
    minApiProtocol: '0.3',
    exactRuntimeIdentity: null,
    equivalence: 'Client wire and disposer behavior is not changed automatically.',
    guidance: 'Review client wire shape, ownership and lifecycle before facade migration.',
    specificity: 25,
  },
  {
    id: 'direct.unsupported-package',
    registryVersion: RULE_REGISTRY_VERSION,
    surface: 'host',
    aClass: 'C',
    classification: 'UNSUPPORTED',
    source: { nodeKinds: ['direct-package-unsupported'] },
    target: { namespace: null },
    minApiProtocol: '0.3',
    exactRuntimeIdentity: null,
    equivalence: 'No registered pluginApi facade mapping exists for this direct DSH package.',
    guidance: 'Keep the import unchanged and register or design an explicit upstream facade proposal.',
    specificity: 36,
  },
  {
    id: 'client.dynamic-namespace',
    registryVersion: RULE_REGISTRY_VERSION,
    surface: 'client',
    aClass: 'C',
    classification: 'UNSUPPORTED',
    source: { nodeKinds: ['client-dynamic-namespace'] },
    target: { namespace: null },
    minApiProtocol: '0.3',
    exactRuntimeIdentity: null,
    equivalence: 'The missing upstream dynamic namespace capability cannot be synthesized by the facade.',
    guidance: 'Requires upstream dynamic remote/settings namespace discovery.',
    specificity: 35,
  },
  {
    id: 'client.marker',
    registryVersion: RULE_REGISTRY_VERSION,
    surface: 'client',
    aClass: 'A',
    classification: 'REVIEW',
    source: { nodeKinds: ['client-marker'] },
    target: { namespace: 'client' },
    minApiProtocol: '0.3',
    exactRuntimeIdentity: null,
    equivalence: 'A client entry marker identifies a boundary but does not prove wire or disposer equivalence.',
    guidance: 'Review client entry ownership and wire contracts before changing this boundary.',
    specificity: 28,
  },
  {
    id: 'client.contract',
    registryVersion: RULE_REGISTRY_VERSION,
    surface: 'client',
    aClass: 'B',
    classification: 'REVIEW',
    source: { nodeKinds: ['client-contract'] },
    target: { namespace: 'client' },
    minApiProtocol: '0.3',
    exactRuntimeIdentity: null,
    equivalence: 'Client wire and lifecycle contracts require explicit ownership and endpoint review.',
    guidance: 'Review descriptor, endpoint, namespace, slot, settings, and disposer semantics.',
    specificity: 27,
  },
  {
    id: 'unknown.dynamic-access',
    registryVersion: RULE_REGISTRY_VERSION,
    surface: 'host',
    aClass: 'unknown',
    classification: 'MANUAL',
    source: { nodeKinds: ['dynamic-access', 'dynamic-import', 'dynamic-service-access', 'dynamic-event'] },
    target: { namespace: null },
    minApiProtocol: '0.3',
    exactRuntimeIdentity: null,
    equivalence: 'A dynamic or reflective access has no statically provable receiver or lifecycle.',
    guidance: 'Resolve the runtime symbol manually before attempting a facade migration.',
    specificity: 10,
  },
]

export const RULE_REGISTRY = deepFreeze(RULES.map((rule) => ({ ...rule })))
export const SERVICE_FACADE_MAPPINGS = deepFreeze({ ...SERVICE_MAPPINGS })
export const SAFE_FACADE_METHODS = deepFreeze(Object.fromEntries(
  Object.entries(SAFE_METHODS).map(([key, value]) => [key, [...value]]),
))

export function packageSurface(packageName) {
  return PACKAGE_SURFACES[packageName] ?? 'host'
}

export function ruleById(id) {
  return RULE_REGISTRY.find((rule) => rule.id === id)
}

function matches(rule, descriptor) {
  if (rule.surface !== descriptor.surface) return false
  if (rule.source.services) {
    const direct = rule.source.services.includes(descriptor.service)
    const reverse = Object.entries(SERVICE_MAPPINGS).some(([source, target]) => target === descriptor.service && rule.source.services.includes(source))
    if (!direct && !reverse) return false
  }
  if (rule.source.packages && !rule.source.packages.includes(descriptor.packageName)) return false
  if (rule.source.nodeKinds && !rule.source.nodeKinds.includes(descriptor.kind)) return false
  if (rule.methodsByService && descriptor.method != null) {
    const methods = rule.methodsByService[descriptor.service]
      ?? rule.methodsByService[SERVICE_MAPPINGS[descriptor.service]]
      ?? rule.methodsByService[Object.entries(SERVICE_MAPPINGS).find(([, target]) => target === descriptor.service)?.[0]]
    if (!methods?.includes(descriptor.method)) return false
  }
  return true
}

function protocolTuple(value) {
  const match = /^(\d+)\.(\d+)$/.exec(String(value ?? ''))
  return match ? [Number(match[1]), Number(match[2])] : null
}

function protocolAtLeast(actual, required) {
  const a = protocolTuple(actual)
  const r = protocolTuple(required)
  if (!a || !r) return false
  return a[0] > r[0] || (a[0] === r[0] && a[1] >= r[1])
}

export function matchingRules(descriptor) {
  return RULE_REGISTRY
    .filter((rule) => matches(rule, descriptor))
    .sort((a, b) => b.specificity - a.specificity || (a.id === b.id ? 0 : (a.id < b.id ? -1 : 1)))
}

export function selectRule(descriptor, { apiProtocol = '0.3', runtimeIdentity = undefined } = {}) {
  const candidates = matchingRules(descriptor)
  const selected = candidates[0]
  if (!selected) return { selected: undefined, candidates: [] }
  let rule = selected
  const protocolMismatch = !protocolAtLeast(apiProtocol, selected.minApiProtocol)
  const runtimeMismatch = selected.exactRuntimeIdentity != null
    && selected.exactRuntimeIdentity !== runtimeIdentity
  if ((protocolMismatch || runtimeMismatch) && selected.classification === 'SAFE') {
    rule = {
      ...selected,
      classification: 'REVIEW',
      guidance: `${selected.guidance} Protocol or runtime identity does not match; automatic editing is disabled.`,
    }
  }
  if (!CLASSIFICATIONS.includes(rule.classification) || !A_CLASSES.includes(rule.aClass)) {
    throw new Error(`invalid migration rule: ${rule.id}`)
  }
  return { selected: rule, candidates }
}
