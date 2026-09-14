#!/usr/bin/env node
/**
 * Whole-tree convergence verifier (public API convergence line, Task 1.2).
 *
 * Mechanically checks the connection between the delivered convergence tables
 * and the canonical registry, so the tables can never drift from the single
 * source of truth:
 *
 *   (a) every `publicPath` the tables reference exists in the registry;
 *   (b) the public member table's idiom/effect/composition/runtime match the
 *       registry row for that path, word for word (including the availability
 *       and current-shape columns, unescaped);
 *   (c) every consumer-behavior row names at least one public path that also
 *       appears in the member table and in the implementation/assembly table,
 *       row by row, and the frozen row inventory is intact;
 *   (d) every referenced test file exists, in the behavior table, the assembly
 *       table and the reconciliation document alike;
 *   (e) the member table's authority column is non-empty and matches the
 *       registry row's authority;
 *   (f) every `oldToTargetMapping` row either records a removal or resolves to
 *       a shipped path (registry member/namespace, `services.<key>` whitelist,
 *       a documented client leaf, or a documented descriptive target).
 *
 * Usage: node scripts/convergence-verify.mjs [registry.json]
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const registryPath = process.argv[2] ?? resolve(root, 'docs/specs/plugin-api-m7-public-contract-refactor/public-contract.registry.json')
const convergenceDir = resolve(root, 'docs/specs/plugin-api-m10-contract-convergence/convergence')

const errors = []
const registry = JSON.parse(readFileSync(registryPath, 'utf8'))
const memberByPath = new Map()
for (const member of registry.members ?? []) {
  // host and client rows share a publicPath; keep both keyed by runtime.
  memberByPath.set(`${member.runtime ?? 'host'}|${member.publicPath}`, member)
}
const knownPaths = new Set((registry.members ?? []).map((member) => member.publicPath))
for (const namespace of registry.namespaces ?? []) knownPaths.add(namespace.namespace)
for (const entry of registry.servicesWhitelist ?? []) knownPaths.add(`services.${entry.key}`)
const serviceKeys = new Set((registry.servicesWhitelist ?? []).map((entry) => entry.key))
const knownRoots = new Set([...knownPaths].map((path) => path.split('.')[0]))
knownRoots.add('services')

const read = (name) => readFileSync(resolve(convergenceDir, name), 'utf8')

// --- (b)/(e): the public member table mirrors the registry rows -------------
const memberTable = read('public-member-table.md')
// The namespace appendix starts at the `## 附：` heading; only the member rows
// before it describe registry members.
const memberSection = memberTable.split('\n## 附：')[0]
const memberRows = memberSection
  .split('\n')
  .filter((line) => line.startsWith('| ') && !line.startsWith('| publicPath') && !line.startsWith('|---'))
  .map((line) => line.slice(2, -2).split(' | '))

if (memberRows.length === 0) errors.push('public-member-table.md carries no member rows')

const registryRowCount = (registry.members ?? []).length
if (memberRows.length !== registryRowCount) {
  errors.push(`public-member-table.md has ${memberRows.length} rows but the registry has ${registryRowCount} members`)
}

for (const cells of memberRows) {
  const [publicPath, runtime, idiom, effect, composition, , authority] = cells
  const row = memberByPath.get(`${runtime}|${publicPath}`)
  if (row === undefined) {
    errors.push(`member table row ${publicPath} (${runtime}) is absent from the registry`)
    continue
  }
  const same = (tableValue, registryValue) => {
    const registryText = registryValue === null || registryValue === undefined ? '—' : String(registryValue)
    return String(tableValue) === registryText
  }
  const unescape = (value) => String(value ?? '').replace(/\\\|/g, '|')
  const [, , , , , , , , , availabilityShapeRaw, currentShapeRaw] = cells
  const availabilityShape = unescape(availabilityShapeRaw)
  const currentShape = unescape(currentShapeRaw)
  for (const [label, tableValue, registryValue] of [
    ['idiom', idiom, row.idiom],
    ['effect', effect, row.effect],
    ['composition', composition, row.composition],
    ['availabilityShape', availabilityShape, row.availabilityShape],
    ['currentShape', currentShape, row.currentShape],
  ]) {
    if (!same(tableValue, registryValue)) {
      errors.push(`member table row ${publicPath} (${runtime}) ${label} "${tableValue}" != registry "${registryValue}"`)
    }
  }
  if (authority === undefined || authority === '' || authority === '—') {
    errors.push(`member table row ${publicPath} (${runtime}) has no authority`)
  } else if (row.authority !== undefined && row.authority !== null && authority !== String(row.authority)) {
    errors.push(`member table row ${publicPath} (${runtime}) authority "${authority}" != registry "${row.authority}"`)
  }
}

// --- (a)/(c)/(d): behaviour rows and assembly rows reference real members ----
const behaviorTable = read('consumer-behavior-table.md')
const pathPattern = /`([a-zA-Z][\w.{}/\\-]*?(?:\.\*)?(?:\([^`]*\))?)`/g

const behaviorSection = behaviorTable.split('\n## 1. 行为行')[1]?.split('\n## 2.')[0] ?? ''
const behaviorRows = behaviorSection
  .split('\n')
  .filter((line) => line.startsWith('| ') && line.includes('`') && !line.startsWith('| 项目/子包') && !line.startsWith('|----'))

for (const line of behaviorRows) {
  const paths = [...line.matchAll(pathPattern)].map((match) => match[1].replace(/\.\*$/, '').replace(/\(.*$/, ''))
  const publicPaths = paths.filter((token) => token.includes('.') && isPathShaped(token))
  if (publicPaths.length === 0) {
    errors.push(`consumer behavior row references no public path: ${line.slice(0, 80)}…`)
    continue
  }
  for (const token of publicPaths) {
    for (const expanded of expandToken(token)) {
      if (!resolvesToKnownPath(expanded)) {
        errors.push(`consumer behavior row references unknown public path "${expanded}"`)
      }
    }
  }
}

/**
 * Resolve one table token to a registry path.
 *
 * Tokens in the tables are written the way a reader expects them: `pluginApi.`
 * prefixes, `client` markers, namespace globs (`attention.*`), shorthand sets
 * with a slash, and bare roots. The resolver normalises all of those to a
 * registry path (or prefix) and reports an unknown token only when nothing in
 * the registry matches it.
 */
/** True when a token addresses a real registry path (or a real namespace prefix). */
function resolvesToKnownPath(rawToken) {
  let token = rawToken.replace(/\.$/, '')
  if (token.startsWith('pluginApi.')) token = token.slice('pluginApi.'.length)
  if (token.startsWith('ctx.pluginApi.')) token = token.slice('ctx.pluginApi.'.length)
  if (token === 'pluginApi' || token === 'ctx.pluginApi') return true
  if (token.startsWith('services.')) {
    // The services passthrough members live in the runtime service definitions;
    // the registry records them through the audited whitelist keys.
    const key = token.split('.')[1]
    return serviceKeys.has(key)
  }
  if (knownPaths.has(token)) return true
  if ([...knownPaths].some((path) => path.startsWith(`${token}.`))) return true
  return false
}

/** Only path-shaped tokens under a known root are subject to the check. */
function isPathShaped(token) {
  if (token.startsWith('pluginApi.') || token.startsWith('ctx.pluginApi.')) return true
  const root = token.split('.')[0].split('(')[0]
  return knownRoots.has(root)
}

/** Expand `a.b.c/d` and `a.b.{c,d}` shorthand into individual paths. */
function expandToken(rawToken) {
  const token = rawToken.replace(/[{}]/g, '')
  if (!token.includes('/')) return [token]
  const dot = token.lastIndexOf('.')
  const slash = token.indexOf('/')
  if (dot === -1 || slash === -1 || dot > slash) return [token]
  const head = token.slice(0, dot + 1)
  return token.slice(dot + 1).split('/').map((leaf) => head + leaf.replace(/^\{/, '').replace(/\}$/, ''))
}

// Every referenced test file must exist: a fabricated evidence path is worse
// than a missing one, because it reads as proof.
const testReference = /((?:test|packages\/[\w-]+\/test)\/[\w./*\-]+\.test\.mjs)/g
const testFileExists = (reference) => {
  const segments = reference.split('/')
  const leaf = segments.pop()
  const dir = resolve(root, ...segments)
  if (!existsSync(dir)) return false
  if (!leaf.includes('*')) return existsSync(resolve(dir, leaf))
  // A glob reference must match at least one shipped test file.
  const prefix = leaf.slice(0, leaf.indexOf('*'))
  const suffix = leaf.slice(leaf.indexOf('*') + 1)
  return readdirSync(dir).some((entry) => entry.startsWith(prefix) && entry.endsWith(suffix))
}
for (const table of [behaviorTable, read('implementation-assembly-table.md'), read('reconciliation.md')]) {
  for (const match of table.matchAll(testReference)) {
    if (!testFileExists(match[1])) {
      errors.push(`referenced test file does not exist: ${match[1]}`)
    }
  }
}

// --- (f): every old -> target mapping row names a path that really ships -----
// The client half declares its leaves at namespace granularity in the registry
// (`clientDomainTree` / `clientRoot`), so a renamed client leaf resolves against
// the shipped client surface instead of a per-member registry row. Each entry
// names the test that proves the target member exists; nothing else is waived.
const CLIENT_LEAF_TARGETS = new Map([
  ['connection.get', 'test/client-bundle.test.mjs'],
  ['remotes.observe', 'test/client-remote-events.test.mjs'],
  ['remotes.dispatch', 'test/client-remote-events.test.mjs'],
  ['slots.list', 'test/official-passthrough-client-root.test.mjs'],
  ['slots.observe', 'test/official-passthrough-client-root.test.mjs'],
  ['lifecycle.observe', 'test/client-generation-rebind.test.mjs'],
  ['lifecycle.list', 'test/client-generation-rebind.test.mjs'],
  ['codec.validate', 'test/client-codec.test.mjs'],
])
// Targets that name a shape rather than a ctx path.
const DESCRIPTIVE_TARGETS = new Set(['ctx.pluginApi(root)', 'static module export (client-manifest)'])

for (const row of registry.oldToTargetMapping ?? []) {
  const target = row.targetPath
  // Removal rows carry no target: their disposition lives in `action`/`relation`.
  if (target === null || target === undefined) continue
  if (DESCRIPTIVE_TARGETS.has(target)) continue
  if (resolvesToKnownPath(target)) continue
  const evidence = CLIENT_LEAF_TARGETS.get(target)
  if (evidence !== undefined) {
    if (!testFileExists(evidence)) {
      errors.push(`client leaf target ${target} names missing evidence ${evidence}`)
    }
    continue
  }
  errors.push(`old -> target mapping ${row.oldPath} -> ${target} resolves to no registry path, client leaf, or descriptive target`)
}

const assemblyTable = read('implementation-assembly-table.md')
for (const match of assemblyTable.matchAll(pathPattern)) {
  const token = match[1].replace(/\.\*$/, '').replace(/\(.*$/, '')
  if (!token.includes('.') || !isPathShaped(token)) continue
  for (const expanded of expandToken(token)) {
    if (!resolvesToKnownPath(expanded)) {
      errors.push(`implementation/assembly table references unknown public path "${expanded}"`)
    }
  }
}

// --- (c): every behaviour row links to a member row AND an assembly row -----
const memberPaths = new Set(memberRows.map((cells) => `${cells[1]}|${cells[0]}`))
const memberPathsHost = new Set(memberRows.filter((cells) => cells[1] === 'host').map((cells) => cells[0]))
const assemblyPaths = new Set(
  [...assemblyTable.matchAll(pathPattern)]
    .map((match) => match[1].replace(/\.\*$/, '').replace(/\(.*$/, ''))
    .flatMap((token) => expandToken(token))
    .filter((token) => isPathShaped(token)),
)

/** A behaviour row's path is "covered" when the member table or the assembly table names it (or a namespace prefix of it). */
const coveredBy = (set, token) =>
  set.has(token) || [...set].some((path) => path.startsWith(`${token}.`) || token.startsWith(`${path}.`))

let linkedRows = 0
for (const line of behaviorRows) {
  const tokens = [...line.matchAll(pathPattern)]
    .map((match) => match[1].replace(/\.\*$/, '').replace(/\(.*$/, ''))
    .flatMap((token) => expandToken(token))
    .filter((token) => token.includes('.') && isPathShaped(token))
  if (tokens.length === 0) {
    errors.push(`consumer behavior row carries no public path: ${line.slice(0, 70)}…`)
    continue
  }
  const inMembers = tokens.some((token) => coveredBy(memberPathsHost, token))
  const inAssembly = tokens.some((token) => coveredBy(assemblyPaths, token))
  if (!inMembers) errors.push(`consumer behavior row has no member-table counterpart: ${line.slice(0, 70)}…`)
  if (!inAssembly) errors.push(`consumer behavior row has no implementation/assembly counterpart: ${line.slice(0, 70)}…`)
  if (inMembers && inAssembly) linkedRows += 1
}
if (linkedRows !== behaviorRows.length) {
  errors.push(`only ${linkedRows}/${behaviorRows.length} behavior rows are linked across the three tables`)
}
// The behaviour inventory is pinned: a row may be rewritten, never silently
// dropped (the sample list is fixed in §0 of the table).
const EXPECTED_BEHAVIOR_ROWS = 37
if (behaviorRows.length !== EXPECTED_BEHAVIOR_ROWS) {
  errors.push(`the behavior table carries ${behaviorRows.length} rows; the frozen inventory is ${EXPECTED_BEHAVIOR_ROWS}`)
}

if (errors.length > 0) {
  console.error('convergence verification failed:')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}
console.log(`convergence valid: ${memberRows.length} member rows, ${behaviorRows.length} behavior rows, ${linkedRows} fully linked behavior rows`)
