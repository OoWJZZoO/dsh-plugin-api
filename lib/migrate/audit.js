import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_AUDIT_FILE } from './constants.js'

function timestamp(clock) {
  const value = typeof clock === 'function' ? clock() : new Date()
  return new Date(value).toISOString()
}
function normalizeLocation(location) {
  if (!location || typeof location !== 'object') return null
  const line = Number.isInteger(location.line) ? location.line : null
  const column = Number.isInteger(location.column) ? location.column : null
  const byte = Number.isInteger(location.byte) ? location.byte : null
  return { file: location.file ?? null, line, column, byte }
}

export function createAuditRecorder({ file = DEFAULT_AUDIT_FILE, clock = () => new Date() } = {}) {
  return Object.freeze({
    record(observation = {}) {
      const entry = {
        schemaVersion: 1,
        plugin: observation.plugin ?? null,
        module: observation.module ?? null,
        operation: observation.operation ?? null,
        location: normalizeLocation(observation.location),
        ruleId: observation.ruleId ?? null,
        timestamp: timestamp(clock),
      }
      const target = path.resolve(file)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.appendFileSync(target, `${JSON.stringify(entry)}\n`)
      return Object.freeze(entry)
    },
    file: path.resolve(file),
  })
}

export function readAuditFile(file) {
  const target = path.resolve(file)
  if (!fs.existsSync(target)) return { observations: [], diagnostics: [] }
  const observations = []
  const diagnostics = []
  const lines = fs.readFileSync(target, 'utf8').split(/\r?\n/)
  lines.forEach((line, index) => {
    if (!line.trim()) return
    try {
      const value = JSON.parse(line)
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('record must be a JSON object')
      observations.push(value)
    } catch (error) {
      diagnostics.push({ code: 'AUDIT_MALFORMED_LINE', line: index + 1, message: error.message })
    }
  })
  return { observations, diagnostics }
}
