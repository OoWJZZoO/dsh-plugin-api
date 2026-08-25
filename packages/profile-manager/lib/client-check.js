/**
 * Client-half mechanical validation (the client-half mechanical check): deterministic packaging checks
 * over staged snapshot content that contains client code. Stops at the
 * package layer — no browser runtime behavior validation.
 *
 * Blocking (verdict fail): syntax errors, forbidden import-boundary
 * violations (e.g. node built-ins in client entries), and `dsh.client`
 * manifest conformance failures.
 * Non-blocking (warnings only, never veto the boot): dangerous-sink
 * heuristics (eval, unsafe innerHTML patterns, wildcard postMessage) using
 * the warning vocabulary shared with the client-half threat-model checklist.
 */

import { spawn } from 'node:child_process'

export const CLIENT_WARNING_CODES = Object.freeze([
  'eval',
  'unsafe-inner-html',
  'wildcard-postmessage',
])

export const CLIENT_BLOCKING_CODES = Object.freeze([
  'syntax-error',
  'forbidden-import',
  'manifest-nonconformant',
])

const FORBIDDEN_IMPORT = /(?:from\s+['"]|import\s*\(\s*['"]|require\s*\(\s*['"])(node:)([a-z0-9_./-]+)/i

const DANGEROUS_SINKS = [
  { code: 'eval', pattern: /\beval\s*\(/ },
  { code: 'unsafe-inner-html', pattern: /(?:innerHTML|outerHTML|insertAdjacentHTML)\s*=/ },
  { code: 'wildcard-postmessage', pattern: /postMessage\s*\([^)]*['"*]['"]\s*\)/ },
]

/**
 * Check a source file's syntax as an ES module via `node --check`
 * (`--input-type=module` through stdin). Returns null when the file parses,
 * or a detail line when it does not.
 *
 * @param {string} source
 * @param {object} [options] - `{ checkSyntax?: (source: string) => Promise<string|null> }`
 * @returns {Promise<string|null>}
 */
export async function checkModuleSyntax(source, options = {}) {
  if (typeof options.checkSyntax === 'function') return options.checkSyntax(source)
  return new Promise((resolve) => {
    let child
    try {
      child = spawn('node', ['--check', '--input-type=module'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 15000,
      })
    } catch (error) {
      resolve(error?.message ?? String(error))
      return
    }
    let stderr = ''
    let settled = false
    child.stderr?.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      resolve(error?.message ?? String(error))
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      if (code === 0) return resolve(null)
      const detail = stderr.trim().split('\n').pop() ?? `syntax-check-exit-${code}`
      resolve(detail)
    })
    try {
      child.stdin?.end(source)
    } catch {
      // stdin failure surfaces through the close handler
    }
  })
}

/**
 * Analyse one client source file.
 *
 * @param {string} source - file content.
 * @param {string} filename - diagnostic label.
 * @param {object} [options] - syntax checker override.
 * @returns {Promise<{ blocking: object[], warnings: object[] }>}
 */
export async function checkClientFile(source, filename, options = {}) {
  const blocking = []
  const warnings = []
  const syntaxDetail = await checkModuleSyntax(source, options)
  if (syntaxDetail !== null) {
    blocking.push({
      code: 'syntax-error',
      subject: filename,
      detail: syntaxDetail,
    })
    return { blocking, warnings }
  }
  const importMatch = source.match(FORBIDDEN_IMPORT)
  if (importMatch) {
    blocking.push({
      code: 'forbidden-import',
      subject: filename,
      detail: `forbidden import boundary: node:${importMatch[2] ?? ''}`,
    })
  }
  for (const sink of DANGEROUS_SINKS) {
    if (sink.pattern.test(source)) {
      warnings.push({ code: sink.code, subject: filename, detail: `dangerous-sink heuristic: ${sink.code}` })
    }
  }
  return { blocking, warnings }
}

/**
 * Run the mechanical validation over a set of client files.
 *
 * @param {Array<{ name: string, content: string }>} files
 * @param {object} [options] - syntax checker override.
 * @returns {Promise<{ blocking: object[], warnings: object[] }>}
 */
export async function checkClientFiles(files, options = {}) {
  const blocking = []
  const warnings = []
  for (const file of Array.isArray(files) ? files : []) {
    if (!file || typeof file.content !== 'string') continue
    const result = await checkClientFile(file.content, file.name ?? 'client-entry', options)
    blocking.push(...result.blocking)
    warnings.push(...result.warnings)
  }
  return { blocking, warnings }
}

/**
 * `dsh.client` manifest conformance (the blocking classification): the staged manifest must
 * declare the client shape the packaging expects (platform + inject list).
 * Conformance is checked as blocking; unknown/minor shape drifts are
 * reported, never guessed.
 *
 * @param {object | undefined} manifest - staged package.json.
 * @returns {object[]} blocking findings.
 */
export function checkClientManifest(manifest) {
  const blocking = []
  const dsh = manifest?.dsh
  if (dsh === undefined || dsh === null) return blocking
  if (typeof dsh.client?.platform !== 'string') {
    blocking.push({
      code: 'manifest-nonconformant',
      subject: 'dsh.client',
      detail: 'dsh.client.platform is missing or not a string',
    })
  }
  if (dsh.client?.inject !== undefined && !Array.isArray(dsh.client.inject)) {
    blocking.push({
      code: 'manifest-nonconformant',
      subject: 'dsh.client',
      detail: 'dsh.client.inject is not an array',
    })
  }
  return blocking
}

/**
 * Run the full client-half mechanical validation over staged content.
 *
 * @param {object} staged - `{ clientFiles?: Array<{name, content}>,
 *   manifest?: object }`.
 * @param {object} [options] - syntax checker override.
 * @returns {Promise<object>} frozen `{ blocking, warnings, clientWarnings }`
 *   where clientWarnings mirrors warnings (shared with the verdict shape).
 */
export async function runClientHalfCheck(staged, options = {}) {
  const files = Array.isArray(staged?.clientFiles) ? staged.clientFiles : []
  const fileResult = await checkClientFiles(files, options)
  const manifestBlocking = checkClientManifest(staged?.manifest)
  const blocking = [...fileResult.blocking, ...manifestBlocking]
  return { blocking, warnings: fileResult.warnings, clientWarnings: fileResult.warnings }
}