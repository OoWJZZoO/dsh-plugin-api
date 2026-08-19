import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_EXCLUDED_PATHS, DEFAULT_EXCLUDED_SEGMENTS, SOURCE_EXTENSIONS } from './constants.js'
import { MigrationToolError } from './errors.js'

function slash(value) {
  return value.split(path.sep).join('/')
}

function resolved(value) {
  return fs.realpathSync.native(path.resolve(value))
}

function within(root, target) {
  const relative = path.relative(root, target)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function relativePath(root, target) {
  return slash(path.relative(root, target)) || '.'
}

function compareLexical(a, b) {
  return a === b ? 0 : (a < b ? -1 : 1)
}

function normalizeFilter(value, { allowOutsideRoot = false } = {}) {
  const raw = String(value)
  if (path.isAbsolute(raw)) throw new MigrationToolError('OUTSIDE_ROOT', `filter must be relative to root: ${raw}`)
  const normalized = slash(path.posix.normalize(raw.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '')))
  if (!allowOutsideRoot && (normalized === '..' || normalized.startsWith('../'))) {
    throw new MigrationToolError('OUTSIDE_ROOT', `filter escapes requested root: ${raw}`)
  }
  return normalized
}

function filterMatches(file, filters, allowOutsideRoot = false) {
  if (!filters?.length) return true
  return filters.some((raw) => {
    const filter = normalizeFilter(raw, { allowOutsideRoot })
    if (filter.includes('*')) {
      const pattern = new RegExp(`^${filter.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`)
      return pattern.test(file)
    }
    return file === filter || file.startsWith(`${filter}/`)
  })
}

function validateFilters(include = [], exclude = [], allowOutsideRoot = false) {
  for (const filter of [...include, ...exclude]) normalizeFilter(filter, { allowOutsideRoot })
}

function validateCandidate(root, candidate, allowOutsideRoot) {
  const real = resolved(candidate)
  if (!allowOutsideRoot && !within(root, real)) {
    throw new MigrationToolError('OUTSIDE_ROOT', `path escapes requested root: ${candidate}`)
  }
  return real
}

function addFile(root, candidate, options, records) {
  let stat
  try {
    stat = fs.statSync(candidate)
  } catch (error) {
    throw new MigrationToolError('READ_PATH', `cannot stat ${candidate}: ${error.message}`)
  }
  if (!stat.isFile()) return
  const real = validateCandidate(root, candidate, options.allowOutsideRoot === true)
  const file = relativePath(root, real)
  if (file === '.' || !SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase())) return
  if (!filterMatches(file, options.include, options.allowOutsideRoot) || (options.exclude?.length > 0 && filterMatches(file, options.exclude, options.allowOutsideRoot))) return
  records.set(real, Object.freeze({
    absolute: real,
    realpath: real,
    file,
    size: stat.size,
  }))
}

function walk(root, directory, options, records) {
  const entries = fs.readdirSync(directory, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory() && DEFAULT_EXCLUDED_SEGMENTS.has(entry.name)) continue
    const candidate = path.join(directory, entry.name)
    const relative = relativePath(root, candidate)
    if (DEFAULT_EXCLUDED_PATHS.some((excluded) => relative === excluded || relative.startsWith(`${excluded}/`))) continue
    if (entry.isDirectory()) {
      walk(root, candidate, options, records)
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      addFile(root, candidate, options, records)
    }
  }
}

export function discoverFiles({ root, include = [], exclude = [], allowOutsideRoot = false } = {}) {
  if (!root) throw new MigrationToolError('ROOT_REQUIRED', 'a plugin root is required')
  const rootReal = resolved(root)
  const stat = fs.statSync(rootReal)
  if (!stat.isDirectory()) throw new MigrationToolError('ROOT_NOT_DIRECTORY', `root is not a directory: ${root}`)

  const options = { include, exclude, allowOutsideRoot }
  validateFilters(include, exclude, allowOutsideRoot)
  const records = new Map()
  walk(rootReal, rootReal, options, records)
  return Object.freeze({
    root: rootReal,
    allowOutsideRoot: Boolean(allowOutsideRoot),
    files: Object.freeze([...records.values()].sort((a, b) => compareLexical(a.file, b.file))),
  })
}

export function discoverExplicitFiles({ root, files = [], include = [], exclude = [], allowOutsideRoot = false } = {}) {
  if (!root) throw new MigrationToolError('ROOT_REQUIRED', 'a plugin root is required')
  const rootReal = resolved(root)
  validateFilters(include, exclude, allowOutsideRoot)
  const records = new Map()
  for (const file of files) {
    const candidate = path.isAbsolute(file) ? file : path.join(rootReal, file)
    addFile(rootReal, candidate, { include, exclude, allowOutsideRoot }, records)
  }
  return Object.freeze({
    root: rootReal,
    allowOutsideRoot: Boolean(allowOutsideRoot),
    files: Object.freeze([...records.values()].sort((a, b) => compareLexical(a.file, b.file))),
  })
}

export function isWithinRoot(root, target) {
  return within(resolved(root), resolved(target))
}
