import { sourceRangeOf } from './parser.js'

function stringValue(node) {
  if (node?.type === 'StringLiteral' || node?.type === 'Literal') return node.value
  return null
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

function locationAt(parsed, byte, fallback) {
  if (fallback) return fallback
  const starts = parsed.lineStarts ?? [0]
  let lineIndex = 0
  for (let index = 1; index < starts.length; index += 1) {
    if (starts[index] > byte) break
    lineIndex = index
  }
  const lineStart = starts[lineIndex]
  const column = parsed.bytes.subarray(lineStart, byte).toString('utf8').length + 1
  return { line: lineIndex + 1, column, byte }
}

function functionEntries(ast) {
  const entries = []
  walk(ast, (node, parent, ancestors) => {
    if (node.type === 'FunctionDeclaration' && node.id?.name === 'apply'
      && (parent?.type === 'ExportNamedDeclaration' || parent?.type === 'ExportDefaultDeclaration')) entries.push(node)
    if (node.type === 'VariableDeclarator' && node.id?.name === 'apply' && ['FunctionExpression', 'ArrowFunctionExpression'].includes(node.init?.type)
      && [...ancestors].reverse().find((ancestor) => ['Program', 'FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'BlockStatement'].includes(ancestor.type))?.type === 'Program'
      && ancestors.some((ancestor) => ancestor.type === 'ExportNamedDeclaration' && ancestors[ancestors.indexOf(ancestor) + 1]?.type === 'VariableDeclaration')) entries.push(node.init)
  })
  return entries
}

function injectDeclarations(ast) {
  const declarations = []
  walk(ast, (node) => {
    if (node.type === 'VariableDeclarator' && node.id?.name === 'inject') declarations.push(node)
  })
  return declarations
}

function hasPluginApi(array) {
  return array?.elements?.some((element) => stringValue(element) === 'pluginApi') ?? false
}

function makeEdit(parsed, startByte, endByte, replacement, ruleId = 'facade.injection') {
  return {
    file: parsed.file,
    start: locationAt(parsed, startByte),
    end: locationAt(parsed, endByte),
    replacement,
    beforeHash: null,
    afterHash: null,
    ruleId,
  }
}

export function identifyEntry(parsed) {
  const entries = functionEntries(parsed.ast)
  if (entries.length !== 1) return { kind: entries.length === 0 ? 'none' : 'ambiguous', function: null, entries }
  const entry = entries[0]
  const firstParam = entry.params?.[0]
  const ctxProven = firstParam?.type === 'Identifier' && firstParam.name === 'ctx'
  return { kind: 'apply', function: entry, entries, ctxProven }
}

export function planFacadeInjection(parsed, { requiresPluginApi = true } = {}) {
  if (!requiresPluginApi) return { edits: [], status: 'not-required', entry: identifyEntry(parsed) }
  const entry = identifyEntry(parsed)
  if (entry.kind !== 'apply') return { edits: [], status: 'ambiguous', entry }
  const edits = []
  const declarations = injectDeclarations(parsed.ast)
  if (declarations.length > 1) return { edits: [], status: 'ambiguous-inject', entry }
  if (declarations.length === 1) {
    const declaration = declarations[0]
    if (declaration.init?.type !== 'ArrayExpression') return { edits: [], status: 'unsafe-inject', entry }
    if (!hasPluginApi(declaration.init)) {
      const close = sourceRangeOf(parsed, declaration.init).end
      const insert = declaration.init.elements.length ? ", 'pluginApi'" : "'pluginApi'"
      edits.push(makeEdit(parsed, close.byte - 1, close.byte - 1, insert))
    }
  } else {
    let declarationNode = entry.function
    walk(parsed.ast, (node, parent) => {
      if ((node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration') && node.declaration === entry.function) declarationNode = node
      if (node.type === 'VariableDeclarator' && node.init === entry.function && parent?.type === 'VariableDeclaration') declarationNode = parent
    })
    const start = sourceRangeOf(parsed, declarationNode).start
    edits.push(makeEdit(parsed, start.byte, start.byte, "export const inject = ['pluginApi']\n"))
  }

  const body = entry.function.body
  if (entry.ctxProven && body?.type === 'BlockStatement') {
    const bodySource = parsed.source.slice(body.start, body.end)
    if (!bodySource.includes('ctx?.pluginApi?.isActive')) {
      const directives = body.directives ?? []
      const firstStatement = body.body?.[0]
      const insertionByte = directives.length
        ? sourceRangeOf(parsed, directives[directives.length - 1]).end.byte
        : firstStatement ? sourceRangeOf(parsed, firstStatement).start.byte : sourceRangeOf(parsed, body).end.byte - 1
      const prefix = directives.length || firstStatement ? '' : '\n'
      edits.push(makeEdit(parsed, insertionByte, insertionByte, `${prefix}  if (!ctx?.pluginApi?.isActive) return\n`))
    }
  }
  return { edits, status: entry.ctxProven ? 'planned' : 'entry-ctx-unknown', entry }
}
