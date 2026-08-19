import fs from 'node:fs'
import path from 'node:path'
import { createFinding } from './findings.js'
import { baseEventsCatalog } from '../events-catalog.js'
import { agentEventsCatalog } from '../agent-events-catalog.js'
import { llmEventsCatalog } from '../llm-events-catalog.js'
import { sessionLifecycleEventsCatalog } from '../session-events-catalog.js'
import { settingsEventsCatalog } from '../settings-events-catalog.js'
import { systemPromptEventsCatalog } from '../system-prompt-events-catalog.js'
import { toolsEventsCatalog } from '../tools-events-catalog.js'
import { identifyEntry } from './injection.js'
import {
  SAFE_FACADE_METHODS,
  SERVICE_FACADE_MAPPINGS,
  packageSurface,
  selectRule,
} from './rules.js'

const EVENT_METHODS = Object.freeze(new Set(['on', 'once', 'emit', 'serial', 'parallel', 'bail', 'waterfall']))
const CLIENT_MARKERS = Object.freeze(new Set([
  'remote', 'codec', 'slot', 'settingsScope', 'settings-scope', 'forwardedEvent', 'connection',
]))
const KNOWN_EVENTS = Object.freeze(new Set([
  ...Object.keys(baseEventsCatalog),
  ...Object.keys(agentEventsCatalog),
  ...Object.keys(llmEventsCatalog),
  ...Object.keys(sessionLifecycleEventsCatalog),
  ...Object.keys(settingsEventsCatalog),
  ...Object.keys(systemPromptEventsCatalog),
  ...Object.keys(toolsEventsCatalog),
]))

function isStaticString(node) {
  if (!node) return null
  if (node.type === 'StringLiteral' || node.type === 'Literal') return typeof node.value === 'string' ? node.value : null
  if (node.type === 'TemplateLiteral' && node.expressions?.length === 0) return node.quasis[0]?.value?.cooked ?? ''
  return null
}

function propertyName(node) {
  if (!node || node.computed) return isStaticString(node.property)
  return node.property?.name ?? node.property?.value ?? null
}

function identifierName(node) {
  return node?.type === 'Identifier' ? node.name : null
}

function isCallTo(node, objectName, methodName) {
  return node?.type === 'CallExpression'
    && node.callee?.type === 'MemberExpression'
    && !node.callee.computed
    && identifierName(node.callee.object) === objectName
    && propertyName(node.callee) === methodName
}

function serviceLookup(node) {
  if (!node || node.type !== 'CallExpression') return null
  const method = propertyName(node.callee)
  if (node.callee?.type !== 'MemberExpression' || !['get', 'service'].includes(method)) return null
  if (identifierName(node.callee.object) !== 'ctx') return null
  return isStaticString(node.arguments?.[0])
}

function walk(node, callback, parent = null, key = null, ancestors = []) {
  if (!node || typeof node !== 'object') return
  if (node.type) callback(node, parent, key, ancestors)
  for (const [childKey, value] of Object.entries(node)) {
    if (childKey === 'loc' || childKey === 'extra' || childKey === 'tokens' || childKey === 'comments') continue
    if (Array.isArray(value)) {
      for (const child of value) walk(child, callback, node, childKey, [...ancestors, node])
    } else if (value && typeof value === 'object') {
      walk(value, callback, node, childKey, [...ancestors, node])
    }
  }
}

function resolveService(node, aliases, ancestors = [], start = Number.MAX_SAFE_INTEGER) {
  const name = identifierName(node)
  if (name && aliases.has(name)) {
    const sameScope = (left, right) => left === right || Boolean(left && right && left.type === right.type && left.start === right.start && left.end === right.end)
    const scopeOf = (parents) => [...parents].reverse().find((ancestor) => ['Program', 'FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'BlockStatement'].includes(ancestor.type))
    const bindings = aliases.bindings
    const bindingsFor = (scope) => {
      if (bindings.has(scope)) return bindings.get(scope)
      for (const [boundScope, names] of bindings.entries()) if (sameScope(boundScope, scope)) return names
      return null
    }
    const currentScope = scopeOf(ancestors) ?? aliases.ast
    const scopes = [currentScope, ...[...ancestors].reverse().filter((ancestor) => ['Program', 'FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'BlockStatement'].includes(ancestor.type))]
    const candidates = aliases.get(name).filter((entry) => entry.start < start).sort((a, b) => b.start - a.start)
    for (const candidate of candidates) {
      let valid = false
      for (const scope of scopes) {
        if (sameScope(scope, candidate.scope)) {
          valid = true
          break
        }
        if (bindingsFor(scope)?.has(name)) break
      }
      if (valid) return candidate
    }
    return null
  }
  if (node?.type === 'MemberExpression'
    && node.object?.type === 'MemberExpression'
    && identifierName(node.object.object) === 'ctx'
    && propertyName(node.object) === 'pluginApi') {
    const namespace = propertyName(node)
    if (namespace && Object.values(SERVICE_FACADE_MAPPINGS).includes(namespace)) {
      return { source: namespace, namespace, alias: null, facade: true }
    }
  }
  const lookup = serviceLookup(node)
  return lookup && SERVICE_FACADE_MAPPINGS[lookup] ? { source: lookup, namespace: SERVICE_FACADE_MAPPINGS[lookup], alias: null } : null
}

function importedSymbols(node) {
  return (node.specifiers ?? []).map((specifier) => {
    if (specifier.type === 'ImportSpecifier') return specifier.imported?.name ?? specifier.imported?.value ?? null
    if (specifier.type === 'ImportDefaultSpecifier') return 'default'
    if (specifier.type === 'ImportNamespaceSpecifier') return '*'
    return null
  }).filter(Boolean)
}

function requireSymbols(parent) {
  const id = parent?.type === 'VariableDeclarator' ? parent.id : null
  if (id?.type === 'ObjectPattern') {
    return (id.properties ?? []).map((property) => property.key?.name ?? property.key?.value).filter(Boolean)
  }
  if (id?.type === 'Identifier') return ['*']
  return []
}

function bindingNames(parent) {
  const id = parent?.type === 'VariableDeclarator' ? parent.id : null
  if (id?.type === 'Identifier') return [id.name]
  if (id?.type === 'ObjectPattern') return (id.properties ?? []).map((property) => property.value?.name ?? property.key?.name).filter(Boolean)
  return []
}

function isDshPackage(name) {
  return typeof name === 'string' && name.startsWith('@deepseek-ai/dsh-')
}

function makeFinding({ parsed, root, descriptor, node, kind, message, suggestion, symbol = null, details = {}, severity }) {
  const selection = selectRule(descriptor)
  const rule = selection.selected
  const fallback = rule ?? (descriptor.kind === 'direct-package-unsupported' ? {
    id: 'direct.unsupported-package', classification: 'UNSUPPORTED', aClass: 'C', guidance: 'Register an explicit facade mapping before migrating this package.', registryVersion: '0.1',
  } : null)
  return createFinding({
    parsed,
    root,
    startNode: node,
    endNode: node,
    rule: fallback,
    ruleCandidates: selection.candidates,
    classification: fallback?.classification ?? descriptor.classification ?? 'MANUAL',
    severity,
    kind,
    symbol,
    message,
    suggestion: suggestion ?? fallback?.guidance ?? null,
    details: { surface: descriptor.surface, aClass: fallback?.aClass ?? descriptor.aClass ?? 'unknown', ...details },
  })
}

export function analyzeParsedFile(parsed, { root = null } = {}) {
  const findings = []
  const aliases = new Map()
  aliases.bindings = new Map()
  aliases.ast = parsed.ast
  const aliasNodes = new Map()
  const reassigned = []
  const clientBindings = new Set()
  const dshBindings = new Set()
  const injectionEntries = []

  const scopeOf = (ancestors) => [...ancestors].reverse().find((ancestor) => ['Program', 'FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'BlockStatement'].includes(ancestor.type)) ?? parsed.ast
  const addBinding = (scope, name) => {
    if (!name) return
    if (!aliases.bindings.has(scope)) aliases.bindings.set(scope, new Set())
    aliases.bindings.get(scope).add(name)
  }
  const addAlias = (name, entry, node) => {
    aliases.set(name, [...(aliases.get(name) ?? []), entry])
    const nodes = aliasNodes.get(name) ?? []
    if (!nodes.includes(node)) nodes.push(node)
    aliasNodes.set(name, nodes)
  }
  walk(parsed.ast, (node, parent, key, ancestors) => {
    const scope = scopeOf(ancestors)
    if (node.type === 'ImportDeclaration') {
      const packageName = isStaticString(node.source)
      if (isDshPackage(packageName)) {
        for (const specifier of node.specifiers ?? []) {
          if (specifier.local?.name) dshBindings.add(specifier.local.name)
          if (packageSurface(packageName) === 'client' && specifier.local?.name) clientBindings.add(specifier.local.name)
        }
      }
    }
    if (node.type === 'CallExpression' && node.callee?.type === 'Identifier' && node.callee.name === 'require') {
      const packageName = isStaticString(node.arguments?.[0])
      if (isDshPackage(packageName)) {
        for (const name of bindingNames(parent)) {
          dshBindings.add(name)
          if (packageSurface(packageName) === 'client') clientBindings.add(name)
        }
      }
    }
    if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier') {
      addBinding(scope, node.id.name)
      if (node.id.name === 'inject' && node.init?.type === 'ArrayExpression') {
        injectionEntries.push(...node.init.elements.map((element) => isStaticString(element)).filter(Boolean))
      }
      const source = serviceLookup(node.init)
      if (source && SERVICE_FACADE_MAPPINGS[source]) {
        aliasNodes.set(node.id.name, [...(aliasNodes.get(node.id.name) ?? []), node])
        const declaration = parent?.type === 'VariableDeclaration' ? parent : node
        if (parent?.kind === 'const' || declaration.kind === 'const') {
          addAlias(node.id.name, { source, namespace: SERVICE_FACADE_MAPPINGS[source], alias: node.id.name, scope, start: node.start ?? 0 }, node)
        }
      }
    }
    if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
      for (const parameter of node.params ?? []) if (parameter.type === 'Identifier') addBinding(node, parameter.name)
    }
    if (node.type === 'AssignmentExpression' && node.left?.type === 'Identifier') reassigned.push({ name: node.left.name, scope })
    if (node.type === 'UpdateExpression' && node.argument?.type === 'Identifier') reassigned.push({ name: node.argument.name, scope })
  })
  for (const { name, scope } of reassigned) {
    const entries = aliases.get(name)
    if (entries) aliases.set(name, entries.filter((entry) => entry.scope !== scope))
  }

  const applyEntry = identifyEntry(parsed)
  if (applyEntry.kind === 'apply') {
    for (const [index, parameter] of (applyEntry.function.params ?? []).entries()) {
      const source = index === 0 ? null : injectionEntries[index - 1]
      if (parameter?.type === 'Identifier' && source && SERVICE_FACADE_MAPPINGS[source]) {
        addAlias(parameter.name, { source, namespace: SERVICE_FACADE_MAPPINGS[source], alias: parameter.name, injected: true, scope: applyEntry.function, start: parameter.start ?? 0 }, parameter)
      }
    }
  }

  walk(parsed.ast, (node, parent, key, ancestors) => {
    if (node.type === 'ImportDeclaration') {
      const packageName = isStaticString(node.source)
      if (!isDshPackage(packageName)) return
      const surface = packageSurface(packageName)
      const supported = surface === 'client'
      findings.push(makeFinding({
        parsed, root, node, kind: supported ? 'direct-package' : 'direct-package-unsupported',
        descriptor: supported
          ? { surface: 'client', kind: 'direct-package', packageName }
          : { surface: 'host', kind: 'direct-package-unsupported' },
        symbol: packageName,
        message: `Direct DSH package import: ${packageName}`,
        details: { packageName, importedSymbols: importedSymbols(node), importKind: 'static' },
      }))
      return
    }

    if (node.type === 'VariableDeclarator' && node.id?.name === 'inject') {
      if (node.init?.type === 'ArrayExpression') {
        findings.push(makeFinding({
          parsed, root, node, kind: 'injection-array', descriptor: { surface: 'host', kind: 'injection-array' },
          message: 'Static Cordis injection array detected.',
          details: { entries: node.init.elements?.map((element) => isStaticString(element)).filter(Boolean) ?? [] },
        }))
      } else {
        findings.push(makeFinding({
          parsed, root, node, kind: 'facade-injection-required', descriptor: { surface: 'host', kind: 'facade-injection-required' },
          message: 'Injection declaration is not a static array.',
          suggestion: 'Review injection ownership before adding pluginApi.',
        }))
      }
    }

    if (node.type === 'CallExpression') {
      const callee = node.callee
      if (callee?.type === 'MemberExpression'
        && ['Object', 'Reflect'].includes(identifierName(callee.object))
        && ['getPrototypeOf', 'get', 'getOwnPropertyDescriptor', 'set'].includes(propertyName(callee))) {
          const reflected = resolveService(node.arguments?.[0], aliases, ancestors, node.start)
        if (reflected) {
          findings.push(makeFinding({
            parsed, root, node, kind: 'dynamic-access', descriptor: { surface: 'host', kind: 'dynamic-access' },
            message: `Reflection on DSH service ${reflected.source} cannot be migrated safely.`,
            details: { service: reflected.source, reflection: `${identifierName(callee.object)}.${propertyName(callee)}` },
          }))
        }
      }
      if (callee?.type === 'Import') {
        const packageName = isStaticString(node.arguments?.[0])
        if (isDshPackage(packageName)) {
          findings.push(makeFinding({
            parsed, root, node, kind: 'direct-package', descriptor: { surface: packageSurface(packageName), kind: 'direct-package', packageName },
            symbol: packageName, message: `Dynamic import of DSH package: ${packageName}`,
            details: { packageName, importKind: 'dynamic-static-specifier' },
          }))
        } else if (node.arguments?.[0] && packageName == null) {
          findings.push(makeFinding({
            parsed, root, node, kind: 'dynamic-import', descriptor: { surface: 'host', kind: 'dynamic-import' },
            message: 'Computed dynamic import cannot be statically migrated.',
          }))
        }
      }
      if (isCallTo(node, 'require', 'call')) return
      if (callee?.type === 'Identifier' && callee.name === 'require') {
        const packageName = isStaticString(node.arguments?.[0])
        if (isDshPackage(packageName)) {
          const surface = packageSurface(packageName)
          findings.push(makeFinding({
            parsed, root, node, kind: surface === 'client' ? 'direct-package' : 'direct-package-unsupported',
            descriptor: surface === 'client' ? { surface, kind: 'direct-package', packageName } : { surface: 'host', kind: 'direct-package-unsupported' },
            symbol: packageName, message: `Direct DSH package require: ${packageName}`,
            details: { packageName, importKind: 'require', importedSymbols: requireSymbols(parent) },
          }))
        } else if (node.arguments?.[0] && packageName == null) {
          findings.push(makeFinding({
            parsed, root, node, kind: 'dynamic-import', descriptor: { surface: 'host', kind: 'dynamic-import' },
            message: 'Computed or non-literal require cannot be statically migrated.',
          }))
        }
      }

      const lookup = serviceLookup(node)
      const ctxAccessor = callee?.type === 'MemberExpression'
        && identifierName(callee.object) === 'ctx'
        && ['get', 'service'].includes(propertyName(callee))
      if (ctxAccessor && lookup == null) {
        findings.push(makeFinding({
          parsed, root, node, kind: 'dynamic-service-access', descriptor: { surface: 'host', kind: 'dynamic-service-access' },
          message: 'Computed or missing DSH service name cannot be statically mapped.',
        }))
      } else if (lookup) {
        if (SERVICE_FACADE_MAPPINGS[lookup]) {
          findings.push(makeFinding({
            parsed, root, node, kind: 'service-access', descriptor: { surface: 'host', service: lookup, kind: 'service-access' },
            symbol: lookup, message: `DSH service access: ctx.${propertyName(node.callee)}('${lookup}')`,
            details: { service: lookup, facadeNamespace: SERVICE_FACADE_MAPPINGS[lookup], accessor: propertyName(node.callee) },
          }))
        } else {
          findings.push(makeFinding({
            parsed, root, node, kind: 'dynamic-service-access', descriptor: { surface: 'host', kind: 'dynamic-service-access' },
            message: 'Unknown DSH service name has no registered facade namespace.',
          }))
        }
      } else if (callee?.type === 'MemberExpression') {
        const method = propertyName(callee)
        const service = resolveService(callee.object, aliases, ancestors, node.start)
        if (service && method) {
          const isFacade = service.facade === true
          const methods = SAFE_FACADE_METHODS[service.namespace]
          if (isFacade && methods?.includes(method)) {
            findings.push(makeFinding({
              parsed, root, node, kind: 'idempotence', descriptor: { surface: 'host', service: service.namespace, method },
              classification: 'SAFE', severity: 'INFO', symbol: method,
              message: `Facade call already present: ctx.pluginApi.${service.namespace}.${method}()`,
              details: { service: service.namespace, method },
            }))
          } else if (methods?.includes(method)) {
            findings.push(makeFinding({
              parsed, root, node, kind: 'service-method', descriptor: { surface: 'host', service: service.namespace, method },
              symbol: method, message: `Public DSH service method: ${service.source}.${method}()`,
              details: { service: service.source, facadeNamespace: service.namespace, method, alias: service.alias },
            }))
          } else if (!callee.computed) {
            findings.push(makeFinding({
              parsed, root, node, kind: 'dynamic-access', descriptor: { surface: 'host', kind: 'dynamic-access' },
              message: `Unknown method '${method}' on a DSH service receiver.`,
              details: { service: service.source, method },
            }))
          }
          } else if (callee.computed && service) {
          findings.push(makeFinding({
            parsed, root, node, kind: 'dynamic-access', descriptor: { surface: 'host', kind: 'dynamic-access' },
            message: 'Computed DSH service method cannot be statically migrated.',
            details: { service: service.source },
          }))
        } else if (identifierName(callee.object) && aliasNodes.has(identifierName(callee.object))) {
          findings.push(makeFinding({
            parsed, root, node, kind: 'dynamic-access', descriptor: { surface: 'host', kind: 'dynamic-access' },
            message: `Service alias '${identifierName(callee.object)}' was reassigned and cannot be proven immutable.`,
            details: { alias: identifierName(callee.object), method },
          }))
        }

        const eventReceiver = identifierName(callee.object) === 'ctx' || clientBindings.has(identifierName(callee.object))
        if (EVENT_METHODS.has(method) && eventReceiver) {
          const eventName = isStaticString(node.arguments?.[0])
          const known = eventName != null && KNOWN_EVENTS.has(eventName)
          const eventKind = eventName == null ? 'dynamic-event' : (known ? 'event-call' : 'unknown-event')
          findings.push(makeFinding({
            parsed, root, node, kind: eventKind,
            descriptor: { surface: 'host', kind: eventKind },
            symbol: eventName, message: eventName == null ? 'Computed DSH event name cannot be migrated.' : `${known ? 'Known' : 'Unknown'} DSH event ${method}('${eventName}')`,
            details: { eventName, eventMethod: method, catalogStatus: eventName == null ? 'unknown' : (known ? 'known' : 'absent') },
          }))
        } else if (callee.computed && identifierName(callee.object) === 'ctx' && method == null) {
          findings.push(makeFinding({
            parsed, root, node, kind: 'dynamic-event', descriptor: { surface: 'host', kind: 'dynamic-event' },
            message: 'Computed context event method cannot be statically migrated.',
          }))
        }
      }
    }

    if (node.type === 'ImportExpression') {
      const packageName = isStaticString(node.source)
      if (isDshPackage(packageName)) {
        findings.push(makeFinding({
          parsed, root, node, kind: 'direct-package', descriptor: { surface: packageSurface(packageName), kind: 'direct-package', packageName },
          symbol: packageName, message: `Dynamic import of DSH package: ${packageName}`,
          details: { packageName, importKind: 'dynamic-static-specifier' },
        }))
      } else if (node.source && packageName == null) {
        findings.push(makeFinding({
          parsed, root, node, kind: 'dynamic-import', descriptor: { surface: 'host', kind: 'dynamic-import' },
          message: 'Computed dynamic import cannot be statically migrated.',
        }))
      }
    }

    if (node.type === 'AssignmentExpression' || node.type === 'UpdateExpression') {
      const target = node.type === 'AssignmentExpression' ? node.left : node.argument
      if (target?.type === 'MemberExpression') {
        const service = resolveService(target.object, aliases, ancestors, node.start)
        const targetObject = identifierName(target.object)
        const privateLooking = service
          || dshBindings.has(targetObject)
          || (target.object?.type === 'MemberExpression'
            && dshBindings.has(identifierName(target.object.object))
            && propertyName(target.object) === 'prototype')
        if (service || privateLooking) {
          findings.push(makeFinding({
            parsed, root, node, kind: 'monkey-patch', descriptor: { surface: 'host', kind: 'monkey-patch' },
            message: 'Assignment or update replaces a DSH method/property; automatic rewriting is disabled.',
            details: { service: service?.source ?? null, property: propertyName(target) },
          }))
        }
      }
    }

    if (node.type === 'MemberExpression') {
      const isCallCallee = parent?.type === 'CallExpression' && parent.callee === node
      const isAssignmentTarget = parent?.type === 'AssignmentExpression' && parent.left === node
      const service = resolveService(node.object, aliases, ancestors, node.start)
      if (!isCallCallee && !isAssignmentTarget && service) {
        const property = propertyName(node)
        const safe = !node.computed && SAFE_FACADE_METHODS[service.namespace]?.includes(property)
        if (!safe) {
          findings.push(makeFinding({
            parsed, root, node, kind: 'dynamic-access', descriptor: { surface: 'host', kind: 'dynamic-access' },
            message: `Non-call access to DSH service ${service.source} is not automatically migratable.`,
            details: { service: service.source, property },
          }))
        }
      }
      if (identifierName(node.object) === 'exports' && isStaticString(node.property) === './client') {
        findings.push(makeFinding({
          parsed, root, node, kind: 'client-marker', descriptor: { surface: 'client', kind: 'client-marker' },
          message: 'Client entry export detected.', details: { marker: 'exports["./client"]' },
        }))
      }
      const property = propertyName(node)
      if (identifierName(node.object) === 'dsh' && property === 'client') {
        findings.push(makeFinding({
          parsed, root, node, kind: 'client-marker', descriptor: { surface: 'client', kind: 'client-marker' },
          message: 'dsh.client manifest marker detected.', details: { marker: 'dsh.client' },
        }))
      }
      const clientRoot = node.object?.type === 'MemberExpression' ? identifierName(node.object.object) : identifierName(node.object)
      const clientChain = clientBindings.has(clientRoot)
        || (node.object?.type === 'MemberExpression'
          && identifierName(node.object.object) === 'dsh'
          && propertyName(node.object) === 'client')
      const dynamicNamespace = node.computed && property == null && clientChain
      if (dynamicNamespace) {
        findings.push(makeFinding({
          parsed, root, node, kind: 'client-dynamic-namespace', descriptor: { surface: 'client', kind: 'client-dynamic-namespace' },
          message: 'Dynamic client remote/settings namespace cannot be synthesized by the facade.',
          suggestion: 'Requires an upstream dynamic namespace discovery contract.',
          details: { proposalId: 'client-dynamic-namespace' },
        }))
      }
      if (CLIENT_MARKERS.has(property) && clientChain) {
        findings.push(makeFinding({
          parsed, root, node, kind: 'client-contract', descriptor: { surface: 'client', kind: 'direct-package', packageName: '@deepseek-ai/dsh-client-connection' },
          message: `Client wire or lifecycle marker detected: ${property}.`, details: { marker: property, contract: property },
        }))
      }
    }
  })

  const entry = identifyEntry(parsed)
  if (entry.kind === 'apply') {
    findings.push(makeFinding({
      parsed, root, node: entry.function, kind: 'apply-entry', descriptor: { surface: 'host', kind: 'apply-entry' },
      message: 'Static apply plugin entry detected.', details: { entryKind: 'apply', ctxProven: Boolean(entry.ctxProven) },
      severity: 'INFO',
    }))
    if (!entry.ctxProven) {
      findings.push(makeFinding({
        parsed, root, node: entry.function, kind: 'facade-injection-required', descriptor: { surface: 'host', kind: 'facade-injection-required' },
        message: 'apply entry does not have a statically provable ctx parameter.',
        suggestion: 'Review pluginApi injection and activation guard manually.',
      }))
    }
  } else if (entry.kind === 'ambiguous') {
    findings.push(makeFinding({
      parsed, root, node: entry.entries[0] ?? null, kind: 'facade-injection-required', descriptor: { surface: 'host', kind: 'facade-injection-required' },
      message: 'Multiple apply entry candidates were found.',
      suggestion: 'Select the host entry manually before migrating pluginApi injection.',
    }))
  }

  for (const [alias, nodes] of aliasNodes) {
    const services = aliases.get(alias) ?? []
    for (const [index, node] of nodes.entries()) {
      const service = services[index]
      if (!service) continue
    findings.push(makeFinding({
      parsed, root, node, kind: 'service-alias', descriptor: { surface: 'host', service: service.source, kind: 'service-alias' },
      symbol: alias, message: `${service.injected ? 'Injected' : 'Immutable'} DSH service alias '${alias}' -> ${service.source}.`,
      details: { service: service.source, facadeNamespace: service.namespace, alias, injected: Boolean(service.injected) },
    }))
    }
  }

  return findings
}

export function analyzePackageManifest(root) {
  const file = path.join(root, 'package.json')
  if (!fs.existsSync(file)) return { findings: [], present: false, manifest: null }
  let manifest
  try {
    manifest = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    return { findings: [], present: true, error, manifest: null }
  }
  const markers = []
  if (manifest?.dsh?.client != null || manifest?.['dsh.client'] != null) markers.push({ marker: 'dsh.client', entryKind: 'dsh.client' })
  if (manifest?.exports?.['./client'] != null) markers.push({ marker: 'exports["./client"]', entryKind: 'exports.client' })
  const findings = markers.map((marker) => createFinding({
    file: 'package.json',
    rule: selectRule({ surface: 'client', kind: 'client-marker' }).selected,
    ruleId: 'client.marker',
    classification: 'REVIEW',
    severity: 'WARN',
    kind: 'client-manifest',
    message: `Client manifest marker detected: ${marker.marker}.`,
    suggestion: 'Review client wire, ownership, and disposer contracts before migration.',
    details: { surface: 'client', aClass: 'A', marker: marker.marker, entryKind: marker.entryKind, manifest: true },
  }))
  if (typeof manifest?.main === 'string') findings.push(createFinding({
    file: 'package.json',
    rule: selectRule({ surface: 'host', kind: 'apply-entry' }).selected,
    ruleId: 'host.entry',
    classification: 'SAFE',
    severity: 'INFO',
    kind: 'entry-kind',
    message: `Package main entry detected: ${manifest.main}.`,
    details: { entryKind: 'package.main', main: manifest.main, manifest: true },
  }))
  return { findings, present: true, error: null, manifest }
}
