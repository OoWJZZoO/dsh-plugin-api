import crypto from 'node:crypto'
import { SAFE_FACADE_METHODS, SERVICE_FACADE_MAPPINGS } from './rules.js'
import { sourceRangeOf } from './parser.js'
import { identifyEntry } from './injection.js'

function hash(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

function staticString(node) {
  if (node?.type === 'StringLiteral' || node?.type === 'Literal') return typeof node.value === 'string' ? node.value : null
  return null
}

function propertyName(node) {
  if (!node || node.computed) return staticString(node.property)
  return node.property?.name ?? node.property?.value ?? null
}

function walk(node, callback, parent = null, ancestors = []) {
  if (!node || typeof node !== 'object') return
  if (node.type) callback(node, parent, ancestors)
  for (const [key, value] of Object.entries(node)) {
    if (['loc', 'extra', 'tokens', 'comments'].includes(key)) continue
    if (Array.isArray(value)) value.forEach((child) => walk(child, callback, node, [...ancestors, node]))
    else if (value && typeof value === 'object') walk(value, callback, node, [...ancestors, node])
  }
}

function serviceLookup(node) {
  if (node?.type !== 'CallExpression' || node.callee?.type !== 'MemberExpression') return null
  if (node.callee.object?.type !== 'Identifier' || node.callee.object.name !== 'ctx') return null
  if (!['get', 'service'].includes(propertyName(node.callee))) return null
  return staticString(node.arguments?.[0])
}

function collectAliases(ast) {
  const aliases = new Map()
  const bindings = new Map()
  const reassigned = []
  const injectionEntries = []
  const scopeOf = (ancestors) => [...ancestors].reverse().find((ancestor) => ['Program', 'FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'BlockStatement'].includes(ancestor.type)) ?? ast
  const addBinding = (scope, name) => {
    if (!name) return
    if (!bindings.has(scope)) bindings.set(scope, new Set())
    bindings.get(scope).add(name)
  }
  walk(ast, (node, parent, ancestors) => {
    const scope = scopeOf(ancestors)
    if (node.type === 'VariableDeclarator' && node.id?.name === 'inject' && node.init?.type === 'ArrayExpression') {
      injectionEntries.push(...node.init.elements.map((element) => staticString(element)).filter(Boolean))
    }
    if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier') {
      const source = serviceLookup(node.init)
      if (source && SERVICE_FACADE_MAPPINGS[source] && parent?.type === 'VariableDeclaration' && parent.kind === 'const') {
        aliases.set(node.id.name, [...(aliases.get(node.id.name) ?? []), { source, namespace: SERVICE_FACADE_MAPPINGS[source], scope, start: node.start ?? 0 }])
      }
      addBinding(scope, node.id.name)
    }
    if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
      for (const parameter of node.params ?? []) if (parameter.type === 'Identifier') addBinding(node, parameter.name)
    }
    if (node.type === 'AssignmentExpression' && node.left?.type === 'Identifier') reassigned.push({ name: node.left.name, scope })
    if (node.type === 'UpdateExpression' && node.argument?.type === 'Identifier') reassigned.push({ name: node.argument.name, scope })
  })
  const entry = identifyEntry({ ast })
  if (entry.kind === 'apply') for (const [index, parameter] of (entry.function.params ?? []).entries()) {
      const source = index === 0 ? null : injectionEntries[index - 1]
      if (parameter?.type === 'Identifier' && source && SERVICE_FACADE_MAPPINGS[source]) {
        aliases.set(parameter.name, [...(aliases.get(parameter.name) ?? []), { source, namespace: SERVICE_FACADE_MAPPINGS[source], injected: true, start: parameter.start, scope: entry.function }])
      }
  }
  for (const { name, scope } of reassigned) {
    const entries = aliases.get(name)
    if (entries) aliases.set(name, entries.filter((entry) => entry.scope !== scope))
  }
  return { aliases, bindings, scopeOf }
}

export function planSafeEdits(parsed, { ruleRegistryVersion = '0.1' } = {}) {
  const aliasState = collectAliases(parsed.ast)
  const { aliases, bindings, scopeOf } = aliasState
  const sameScope = (left, right) => left === right || Boolean(left && right && left.type === right.type && left.start === right.start && left.end === right.end)
  const bindingsFor = (scope) => {
    if (bindings.has(scope)) return bindings.get(scope)
    for (const [boundScope, names] of bindings.entries()) {
      if (sameScope(boundScope, scope)) return names
    }
    return null
  }
  const resolveAlias = (name, ancestors, start) => {
    const candidates = (aliases.get(name) ?? []).filter((entry) => entry.start < start)
    if (!candidates.length) return null
    const candidate = candidates.sort((a, b) => b.start - a.start)[0]
    const scopes = [scopeOf(ancestors), ...[...ancestors].reverse().filter((ancestor) => ['Program', 'FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'BlockStatement'].includes(ancestor.type))]
    for (const scope of scopes) {
      if (bindingsFor(scope)?.has(name) && !sameScope(scope, candidate.scope)) return null
      if (sameScope(scope, candidate.scope)) return candidate
    }
    return null
  }
  const edits = []
  walk(parsed.ast, (node, parent, ancestors) => {
    if (node.type !== 'CallExpression' || node.callee?.type !== 'MemberExpression') return
    if (node.callee.object?.type !== 'Identifier') return
    const alias = resolveAlias(node.callee.object.name, ancestors, node.start)
    if (!alias) return
    const method = propertyName(node.callee)
    if (!SAFE_FACADE_METHODS[alias.namespace]?.includes(method)) return
    const range = sourceRangeOf(parsed, node.callee)
    const before = parsed.bytes.subarray(range.start.byte, range.end.byte)
    const replacement = Buffer.from(`ctx.pluginApi.${alias.namespace}.${method}`, 'utf8')
    if (Buffer.compare(before, replacement) === 0) return
    edits.push({
      file: parsed.file,
      start: range.start,
      end: range.end,
      replacement: replacement.toString('utf8'),
      beforeHash: hash(before),
      afterHash: hash(replacement),
      ruleId: 'host.service.alias',
      ruleRegistryVersion,
      symbol: method,
    })
  })
  return edits.sort((a, b) => a.start.byte - b.start.byte || a.end.byte - b.end.byte)
}

export function validateEdits(bytes, edits) {
  const ordered = [...edits].sort((a, b) => a.start.byte - b.start.byte || a.end.byte - b.end.byte)
  let previousEnd = -1
  for (const edit of ordered) {
    const start = edit.start.byte
    const end = edit.end.byte
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > bytes.length) {
      throw new Error(`invalid edit range for ${edit.file ?? '<unknown>'}`)
    }
    if (start < previousEnd) throw new Error(`overlapping edits for ${edit.file ?? '<unknown>'}`)
    const before = bytes.subarray(start, end)
    if (edit.beforeHash && hash(before) !== edit.beforeHash) throw new Error(`edit precondition failed for ${edit.file ?? '<unknown>'}`)
    previousEnd = end
  }
  return ordered
}

export function applyEdits(bytes, edits) {
  const ordered = validateEdits(bytes, edits)
  let output = Buffer.from(bytes)
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const edit = ordered[index]
    const replacement = Buffer.from(edit.replacement ?? '', 'utf8')
    const before = output.subarray(0, edit.start.byte)
    const after = output.subarray(edit.end.byte)
    output = Buffer.concat([before, replacement, after])
  }
  return output
}

export function hashBytes(bytes) {
  return hash(bytes)
}
