import fs from 'node:fs'
import { parse } from '@babel/parser'
import { MigrationToolError } from './errors.js'

const BABEL_PLUGINS = Object.freeze([
  'jsx',
  'typescript',
  'decorators-legacy',
  'classProperties',
  'importAttributes',
  'topLevelAwait',
])

function unitToByteOffsets(source, baseByte = 0) {
  const offsets = new Uint32Array(source.length + 1)
  let unit = 0
  let byte = baseByte
  for (const character of source) {
    offsets[unit] = byte
    unit += character.length
    byte += Buffer.byteLength(character, 'utf8')
    offsets[unit] = byte
  }
  return offsets
}

function lineStarts(source, baseByte = 0) {
  const starts = [baseByte]
  let byte = baseByte
  for (const character of source) {
    byte += Buffer.byteLength(character, 'utf8')
    if (character === '\n') starts.push(byte)
  }
  return starts
}

function byteForUnit(offsets, unit) {
  if (unit <= 0) return offsets[0]
  if (unit >= offsets.length) return offsets[offsets.length - 1]
  return offsets[unit]
}

function decode(bytes, file) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    throw new MigrationToolError('ENCODING_ERROR', `invalid UTF-8 in ${file}: ${error.message}`)
  }
}

export function readSource(file) {
  const bytes = fs.readFileSync(file.absolute)
  const bomBytes = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0
  return {
    ...file,
    bytes,
    bomBytes,
    source: decode(bytes, file.file),
  }
}

export function parseSource(record, { mode = 'babel' } = {}) {
  if (!['babel', 'ecma'].includes(mode)) {
    throw new MigrationToolError('PARSER_MODE', `unsupported parser mode: ${mode}`)
  }
  const loaded = record.source === undefined ? readSource(record) : record
  const parserOptions = {
    sourceType: 'unambiguous',
    errorRecovery: false,
    ranges: false,
    tokens: false,
    allowReturnOutsideFunction: true,
    plugins: mode === 'babel' ? BABEL_PLUGINS : [],
  }
  let ast
  try {
    ast = parse(loaded.source, parserOptions)
  } catch (error) {
    const offsets = unitToByteOffsets(loaded.source, loaded.bomBytes ?? 0)
    const errorUnit = error.pos ?? error.loc?.index
    throw new MigrationToolError('PARSE_ERROR', `${loaded.file}: ${error.message}`, {
      file: loaded.file,
      line: error.loc?.line ?? null,
      column: error.loc?.column == null ? null : error.loc.column + 1,
      byte: errorUnit == null ? null : byteForUnit(offsets, errorUnit),
    })
  }
  return Object.freeze({
    ...loaded,
    ast,
    mode,
    unitToByte: unitToByteOffsets(loaded.source, loaded.bomBytes ?? 0),
    lineStarts: lineStarts(loaded.source, loaded.bomBytes ?? 0),
  })
}

export function locationOf(parsed, nodeOrPosition, end = false) {
  const unit = typeof nodeOrPosition === 'number'
    ? nodeOrPosition
    : (end ? nodeOrPosition.end : nodeOrPosition.start)
  const loc = typeof nodeOrPosition === 'object' && nodeOrPosition?.loc
    ? (end ? nodeOrPosition.loc.end : nodeOrPosition.loc.start)
    : null
  const line = loc?.line ?? 1
  const column = (loc?.column ?? 0) + 1
  return Object.freeze({
    line,
    column,
    byte: byteForUnit(parsed.unitToByte, unit ?? 0),
  })
}

export function sourceRangeOf(parsed, node) {
  return Object.freeze({
    start: locationOf(parsed, node),
    end: locationOf(parsed, node, true),
  })
}
