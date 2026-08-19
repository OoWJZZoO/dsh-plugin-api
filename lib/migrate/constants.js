export const TOOL_VERSION = '0.1.0'
export const REPORT_SCHEMA_VERSION = 1
export const RULE_REGISTRY_VERSION = '0.1'

export const CLASSIFICATIONS = Object.freeze(['SAFE', 'REVIEW', 'MANUAL', 'UNSUPPORTED'])
export const SEVERITIES = Object.freeze(['INFO', 'WARN', 'ERROR'])
export const A_CLASSES = Object.freeze(['A', 'B', 'C', 'infrastructure', 'unknown'])
export const SURFACES = Object.freeze(['host', 'client'])

export const SOURCE_EXTENSIONS = Object.freeze(new Set([
  '.js', '.mjs', '.cjs', '.ts', '.mts', '.cts',
]))

export const DEFAULT_EXCLUDED_SEGMENTS = Object.freeze(new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage',
]))
export const DEFAULT_EXCLUDED_PATHS = Object.freeze(['.dsh/migrations'])

export const DEFAULT_MIGRATION_DIR = '.dsh/migrations'
export const DEFAULT_AUDIT_FILE = `${DEFAULT_MIGRATION_DIR}/audit.jsonl`

export const CLASSIFICATION_RANK = Object.freeze({
  SAFE: 0,
  REVIEW: 1,
  MANUAL: 2,
  UNSUPPORTED: 3,
})

export const SEVERITY_RANK = Object.freeze({
  INFO: 0,
  WARN: 1,
  ERROR: 2,
})
