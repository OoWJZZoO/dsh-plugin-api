/**
 * Executor validation pipeline: basic structural check via `dsh --dump-config`
 * and boot-level isolated boot smoke with the mock-first strategy (the quick-write contract, the verdict semantics).
 *
 * Boot-level flow (approved design): the staged snapshot becomes a disposable profile
 * under `<tmp>/profiles/l2check-<id>/`; `settings.yaml` is seeded so the
 * default agent model points at the mock provider; a validation overlay
 * pins the webserver port and inserts the bundled mock row (staged into the
 * disposable home); then `DSH_HOME=<tmp> dsh --profile l2check-<id> <task>`
 * runs with the dsh binary resolved from PATH (env override seam for
 * hermetic tests: DSH_PLUGIN_API_PROFILE_DSH_BIN). The verdict judges boot
 * health and row apply — never inference success.
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync, cpSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { planConfigOverlay } from '@deepseek-ai/dsh-plugin-api-main/profile-fold'
import { storagePaths } from './storage.js'
import { rebuildSeed, materializeDependencies } from './seed-cache.js'
import { runClientHalfCheck } from './client-check.js'
import { MOCK_PROVIDER, MOCK_MODEL } from './mock-row.js'

export const BASIC_LEVEL = 'basic'
export const BOOT_LEVEL = 'boot'

export const VALIDATION_PORT = 39163
export const VALIDATION_PROFILE = 'l2check'
export const MOCK_ROW_PACKAGE = '@deepseek-ai/dsh-plugin-api-profile-manager-mock'

const PROVIDER_FAILURE_HINTS = [
  'credit',
  'auth',
  'rate limit',
  'rate-limit',
  'network',
  'insufficient balance',
]

/**
 * Resolve the dsh binary: env override first (test/ops seam), then PATH.
 */
export function resolveDshBin(env = {}) {
  const explicit = env.DSH_PLUGIN_API_PROFILE_DSH_BIN
  if (typeof explicit === 'string' && explicit.trim().length > 0) return explicit.trim()
  return 'dsh'
}

/**
 * Spawn a command and collect exit code + stdout + stderr with a bounded
 * timeout. Never rejects: a spawn failure is reported as a failed run.
 */
function runProcess(command, args, { env = {}, cwd, timeoutMs = 120000 } = {}) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(command, args, {
        env: { ...process.env, ...env },
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      return resolve({ ok: false, code: -1, stdout: '', stderr: String(error?.message ?? error) })
    }
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { child.kill('SIGKILL') } catch {}
      resolve({ ok: false, code: -1, stdout, stderr: `${stderr}\nboot-timeout` })
    }, timeoutMs)
    child.stdout?.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr?.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok: false, code: -1, stdout, stderr: String(error?.message ?? error) })
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok: true, code, stdout, stderr })
    })
  })
}

/**
 * Basic structural health: `dsh --dump-config` against the staged profile.
 * Structural health = the composed tree parses (exit 0) and no duplicate
 * row ids appear in the dump.
 *
 * @returns {Promise<{ ok: boolean, caveats: string[], rowsApplied: number,
 *   detail?: string }>}
 */
export async function runBasicCheck({ profileDir, dshBin, env = {} }) {
  const run = await runProcess(dshBin, ['--profile', VALIDATION_PROFILE, '--dump-config'], {
    env: { ...env, DSH_HOME: join(profileDir, '..', '..') },
    cwd: profileDir,
  })
  if (run.code !== 0) {
    return { ok: false, caveats: [], rowsApplied: 0, detail: `dump-config exited ${run.code}` }
  }
  const ids = new Map()
  for (const match of run.stdout.matchAll(/^[-–\s]*id:\s+([^\s]+)$/gm)) {
    const id = match[1]
    ids.set(id, (ids.get(id) ?? 0) + 1)
  }
  const duplicates = [...ids.entries()].filter(([, count]) => count > 1).map(([id]) => id)
  return {
    ok: duplicates.length === 0,
    caveats: duplicates.length > 0 ? [`duplicate-row-id:${duplicates[0]}`] : [],
    rowsApplied: ids.size,
    detail: duplicates.length > 0 ? `duplicate row ids: ${duplicates.join(', ')}` : undefined,
  }
}

/**
 * Stage the bunded mock row package into the disposable home so the overlay
 * insert row resolves during the isolated boot.
 */
function stageMockRowPackage(profileDir) {
  const pkgDir = join(profileDir, 'node_modules', '@deepseek-ai', 'dsh-plugin-api-profile-manager-mock')
  mkdirSync(pkgDir, { recursive: true })
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
    name: MOCK_ROW_PACKAGE,
    version: '0.0.0',
    type: 'module',
    main: 'index.js',
  }, null, 2), 'utf8')
  const mockSource = readFileSync(new URL('./mock-row.js', import.meta.url), 'utf8')
  writeFileSync(join(pkgDir, 'index.js'), mockSource, 'utf8')
}

/**
 * Stage the boot-level disposable profile: copy the snapshot config into
 * `<tmp>/profiles/l2check-<id>/`, seed settings.yaml, stage the mock row
 * package, and write the validation overlay (port pin + mock insert).
 *
 * @returns {{ ok: true, profileDir, settingsPath, overlayPath } | { ok: false, reason }}
 */
export function stageValidationEnvironment({ tmpHome, snapshotDir, l2Id, managerRoot, profileName }) {
  try {
    // Materialize the disposable profile's dependency tree from the seed
    // (hardlink clone) so the isolated boot resolves real dependencies.
    if (managerRoot && profileName) {
      const seedDir = storagePaths(managerRoot).seed
      const profileDir = join(snapshotDir, '..', '..', '..', '..', '..', 'profiles', profileName)
      const seed = rebuildSeed({ seedDir, profileName, profileDir })
      if (seed.ok) {
        materializeDependencies({
          seedDir,
          profileName,
          profileDir,
          snapshotNodeModules: join(join(tmpHome, 'profiles'), 'l2check', 'node_modules'),
        })
      }
    }
    const profilesRoot = join(tmpHome, 'profiles')
    const profileDir = join(profilesRoot, VALIDATION_PROFILE)
    mkdirSync(profileDir, { recursive: true })
    for (const name of ['package.json', 'cordis.patch.yml']) {
      const source = join(snapshotDir, name)
      if (existsSync(source)) cpSync(source, join(profileDir, name), { force: true })
    }
    // seed settings.yaml: default model -> mock provider (zero credentials).
    const settingsPath = join(tmpHome, 'settings.yaml')
    writeFileSync(settingsPath, [
      'agent-default-model:',
      `  provider: ${MOCK_PROVIDER}`,
      `  model: ${MOCK_MODEL}`,
      '',
    ].join('\n'), 'utf8')
    stageMockRowPackage(profileDir)
    // validation overlay: pin the webserver port and insert the mock row.
    const overlay = planConfigOverlay({
      rows: [
        { id: 'webserver', config: { port: VALIDATION_PORT } },
      ],
    })
    const overlayPath = join(profileDir, 'validation-overlay.yml')
    writeFileSync(overlayPath, [
      ...(overlay.overlayYaml.trim() ? [overlay.overlayYaml.trim()] : []),
      '- insert:',
      '    - id: validation-mock',
      `      name: '${MOCK_ROW_PACKAGE}'`,
      '',
    ].join('\n'), 'utf8')
    return { ok: true, profileDir, settingsPath, overlayPath }
  } catch (error) {
    return { ok: false, reason: error?.message ?? String(error) }
  }
}

/**
 * Classify the isolated boot outcome (the verdict semantics): boot-phase crashes always fail;
 * provider-layer failures surfacing after a completed boot become caveats
 * and the verdict passes.
 */
export function classifyBoot(run) {
  if (run.code === 0) {
    return { bootHealthy: true, caveats: [] }
  }
  const stderr = String(run.stderr ?? '').toLowerCase()
  const hint = PROVIDER_FAILURE_HINTS.find((word) => stderr.includes(word))
  if (hint) {
    return { bootHealthy: true, caveats: [`provider-layer:${hint}`] }
  }
  return {
    bootHealthy: false,
    caveats: [`boot-crash:exit-${run.code}`],
  }
}

/**
 * Discover client-half content inside a staged snapshot: the staged
 * `package.json` manifest plus every file under a `client/` directory
 * (bounded traversal; guards against symlink/path escapes). Returns
 * undefined when no client content is present, so the mechanical check only
 * runs for snapshots that actually ship client code.
 */
export function discoverClientStaged(snapshotDir, { maxFiles = 64, maxBytesPerFile = 256 * 1024 } = {}) {
  try {
    let manifest
    const manifestPath = join(snapshotDir, 'package.json')
    if (existsSync(manifestPath)) {
      try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      } catch {
        manifest = undefined
      }
    }
    const clientRoot = join(snapshotDir, 'client')
    const clientFiles = []
    if (existsSync(clientRoot)) {
      const stack = [clientRoot]
      while (stack.length > 0 && clientFiles.length < maxFiles) {
        const current = stack.pop()
        let entries
        try {
          entries = readdirSync(current)
        } catch {
          continue
        }
        for (const entry of entries) {
          const full = join(current, entry)
          let stats
          try {
            stats = statSync(full)
          } catch {
            continue
          }
          if (stats.isDirectory()) {
            stack.push(full)
          } else if (stats.isFile() && clientFiles.length < maxFiles) {
            try {
              const content = readFileSync(full, 'utf8')
              if (content.length <= maxBytesPerFile) {
                clientFiles.push({ name: `client/${entry}`, content })
              }
            } catch {
              // unreadable client file: skipped (the manifest still checks)
            }
          }
        }
      }
    }
    const hasClient = Boolean(manifest?.dsh?.client) || clientFiles.length > 0
    return hasClient ? { manifest, clientFiles } : undefined
  } catch {
    return undefined
  }
}

/**
 * Run the requested validation level over one staged snapshot.
 *
 * @param {object} options - { snapshotDir, runId, level, dshBin, env,
 *   clientStaged, checkSyntax, tmpRoot }.
 * @returns {Promise<object>} frozen verdict:
 *   `{ code, level, verdict: { bootHealthy, rowsApplied, caveats[],
 *   clientWarnings[] }, blocking[] }`.
 */
export async function runValidation(options) {
  const { snapshotDir, level, dshBin, env = {}, clientStaged, checkSyntax, tmpRoot } = options
  const rawLevels = Array.isArray(level) ? level.flatMap((entry) => String(entry).split('+')) : String(level ?? '').split('+')
  const levels = new Set(rawLevels.filter(Boolean))
  for (const want of levels) {
    if (want !== BASIC_LEVEL && want !== BOOT_LEVEL) {
      return { code: 'invalid-input', reason: `unknown validation level "${want}"` }
    }
  }
  if (levels.size === 0) {
    return { code: 'invalid-input', reason: 'missing-validation-level' }
  }
  const wantsBasic = levels.has(BASIC_LEVEL)
  const wantsBoot = levels.has(BOOT_LEVEL)

  const verdict = {
    bootHealthy: !wantsBoot,
    rowsApplied: 0,
    caveats: [],
    clientWarnings: [],
  }
  const blocking = []

  // Client-half mechanical validation always runs for staged client content:
  // explicit via options.clientStaged, or discovered automatically from the
  // staged snapshot (manifest + client/ files).
  const effectiveClientStaged = clientStaged ?? discoverClientStaged(snapshotDir)
  if (effectiveClientStaged) {
    const client = await runClientHalfCheck(effectiveClientStaged, { checkSyntax })
    verdict.clientWarnings = client.clientWarnings
    blocking.push(...client.blocking.map((entry) => ({ ...entry, code: 'client-blocking' })))
  }

  if (wantsBasic || wantsBoot) {
    const runId = typeof options.l2Id === 'string' && options.l2Id.length > 0
      ? options.l2Id
      : `l2check-${Date.now()}`
    const tmpHome = tmpRoot ? join(tmpRoot, runId) : join(snapshotDir, '..', '..', '..', 'tmp', runId)
    const staged = stageValidationEnvironment({ tmpHome, snapshotDir, l2Id: runId, managerRoot: options.managerRoot, profileName: options.profileName })
    if (!staged.ok) {
      blocking.push({ code: 'internal', detail: `stage-failed:${staged.reason}` })
      verdict.bootHealthy = false
    } else {
      const basic = await runBasicCheck({ profileDir: staged.profileDir, dshBin, env })
      verdict.rowsApplied = basic.rowsApplied
      if (!basic.ok && wantsBasic) {
        blocking.push({ code: 'internal', detail: basic.detail ?? 'basic-unhealthy' })
      }
      if (wantsBoot) {
        const boot = await runProcess(dshBin, ['--profile', VALIDATION_PROFILE, '--patch', staged.overlayPath, 'run-validation'], {
          env: { ...env, DSH_HOME: tmpHome },
          cwd: staged.profileDir,
        })
        const classified = classifyBoot(boot)
        verdict.bootHealthy = classified.bootHealthy
        verdict.caveats.push(...classified.caveats)
        if (!classified.bootHealthy) {
          blocking.push({ code: 'internal', detail: 'boot-phase-crash' })
        }
      }
    }
  }

  const pass = blocking.length === 0 && verdict.bootHealthy
  return {
    code: pass ? 'ok' : 'fail',
    level: [...levels].join('+'),
    verdict,
    blocking,
  }
}