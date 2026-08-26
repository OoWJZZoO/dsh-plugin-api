/**
 * Profile inspection mounter — the read-only projection face of the
 * `pluginApi.profile` namespace (plugin-profile-management).
 *
 * Three views (approved requirements):
 * - `runtime`: the boot-time composition snapshot captured once at apply
 *   time from `ctx.loader.entries()` (observed fields only; never re-reads
 *   disk at call time, never tracks post-init registrations);
 * - `disk`: folds the current profile's own files (profile manifest →
 *   `cordis.patch.yml` → overlays) in official composition order through the
 *   shared folding parser;
 * - `other`: reads an explicit profile directory strictly read-only with an
 *   identical result shape.
 *
 * Fail-safe discipline (design): the whole mounter is a G1 container — any
 * failure degrades the affected view/layer with a stable typed reason and
 * never throws through plugin apply. All returned payloads are deeply frozen
 * and audience-classified (paths/env-derived values visible to UI and
 * diagnostics; secrets redacted in all audiences; model-visible exposure
 * requires an explicit visibility policy decision).
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deepFreeze } from './deep-freeze.js'
import { foldLayers, healthFindings, planConfigOverlay, planDependencySet } from './profile-fold.js'

/** Stable result code for a view that cannot be produced. */
export const INSPECTION_CODES = Object.freeze({
  'invalid-input': 'invalid-input',
  unavailable: 'unavailable',
  'layer-unavailable': 'layer-unavailable',
  internal: 'internal',
})

const SECRET_KEY = /(?:credential|password|secret|token|authorization|api[-_]?key|private[-_]?cause)/i

/**
 * Redact secret-shaped values in place over a plain-object graph. Values
 * that look like credentials/tokens are replaced with a redaction marker in
 * every audience; path and environment-derived strings stay visible (audience
 * policy is applied by consumers). A redaction failure fails closed for the
 * containing payload.
 *
 * @param {unknown} value
 * @param {WeakSet<object>} [seen]
 * @returns {unknown} a plain-object clone with secrets redacted.
 */
export function redactProfileSecrets(value, seen = new WeakSet()) {
  try {
    if (value === null || typeof value !== 'object') {
      if (typeof value === 'string' && value.length > 0 && value.length <= 512 && SECRET_KEY.test(value)) {
        return '[redacted]'
      }
      return value
    }
    if (seen.has(value)) return value
    seen.add(value)
    if (Array.isArray(value)) {
      return value.map((entry) => redactProfileSecrets(entry, seen))
    }
    const out = {}
    for (const [key, entry] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) {
        out[key] = '[redacted]'
      } else {
        out[key] = redactProfileSecrets(entry, seen)
      }
    }
    return out
  } catch {
    return '[redaction-failed]'
  }
}

/**
 * Resolve a profile directory from a loader base URL or an explicit profile
 * name. The loader base URL is the booted profile directory itself (official
 * `dsh-app-boot` sets `ctx.baseUrl` to the profile dir); it is trusted
 * harness state, so it resolves to its absolute path directly. An explicit
 * profile name resolves strictly under `<DSH_HOME>/profiles/<name>` with a
 * containment guard. A path that cannot be resolved safely returns undefined
 * (typed unavailable).
 *
 * @param {string | URL | undefined} baseUrl - loader base URL (profile dir).
 * @param {string | undefined} profile - explicit profile name (view 'other').
 * @returns {string | undefined} resolved absolute profile directory.
 */
export function resolveProfileDir(baseUrl, profile) {
  try {
    // Loader base URL: the booted profile directory (official boot anchors
    // ctx.baseUrl there). Trusted harness state; normalize a trailing slash.
    if (typeof baseUrl === 'string' || baseUrl instanceof URL) {
      const url = typeof baseUrl === 'string' ? new URL(baseUrl) : baseUrl
      const asPath = fileURLToPath(url).replace(/[\\/]+$/, '')
      if (isAbsolute(asPath) && asPath.length > 1) return asPath
    }

    // Explicit profile name: <DSH_HOME>/profiles/<name> with a strict name
    // charset and a containment guard.
    if (typeof profile === 'string' && /^[A-Za-z0-9._-]+$/.test(profile) && profile !== '.' && profile !== '..') {
      return resolveDshHomeProfileDir(profile)
    }
    return undefined
  } catch {
    return undefined
  }
}

function resolveDshHomeProfileDir(profile) {
  const home = process.env.DSH_HOME?.trim() || join(process.env.HOME ?? process.env.USERPROFILE ?? '', '.dsh')
  const profilesRoot = join(home, 'profiles')
  const resolved = join(profilesRoot, profile)
  // containment guard: the resolved path must stay under <home>/profiles.
  if (dirname(resolved) !== profilesRoot) return undefined
  return resolved
}

function readLayerContent(dir, filename) {
  try {
    const path = join(dir, filename)
    if (!existsSync(path)) return undefined
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

/**
 * Fold the files of one profile directory through the shared parser.
 * Strictly read-only; any layer read/parse failure degrades that layer
 * instead of failing the view.
 *
 * @param {string} dir - absolute profile directory.
 * @param {{ view: string, profile?: string, overlayFiles?: string[], now?: () => number }} [options]
 * @returns {object} frozen ResolvedView (see profile-fold.js).
 */
function foldDiskView(dir, options = {}) {
  const layers = []
  const manifest = readLayerContent(dir, 'package.json')
  if (manifest !== undefined) layers.push({ kind: 'manifest', content: manifest })
  else layers.push({ kind: 'manifest', status: 'unavailable', reason: 'unreadable' })
  const patch = readLayerContent(dir, 'cordis.patch.yml')
  if (patch !== undefined) layers.push({ kind: 'patch', content: patch })
  // Supplied overlay contents are folded last, in caller order.
  for (const overlay of Array.isArray(options.overlayFiles) ? options.overlayFiles : []) {
    layers.push({ kind: 'overlay', content: overlay })
  }
  return foldLayers(layers, {
    view: options.view,
    profile: options.profile ?? basename(dir),
    now: options.now,
  })
}

/**
 * Capture the runtime-view snapshot from the loader at apply time.
 * Observed fields only: row id/name package, enabled flag, fiber phase.
 * Fields not observable through the loader (package versions, dependency
 * graph) are reported unavailable and never fabricated from disk.
 *
 * @param {() => unknown} loadEntries - returns loader entries at capture time.
 * @returns {object} frozen runtime snapshot rows.
 */
function captureRuntimeView(loadEntries) {
  const rows = []
  try {
    const entries = loadEntries()
    const iterable = entries && typeof entries[Symbol.iterator] === 'function' ? entries : []
    for (const entry of iterable) {
      const options = entry?.options ?? entry ?? {}
      const id = typeof options.id === 'string' ? options.id : undefined
      const name = typeof options.name === 'string' ? options.name : undefined
      if (typeof id !== 'string' && typeof name !== 'string') continue
      const fiber = entry?.fiber
      rows.push({
        id,
        name,
        bundle: name ?? id,
        source: 'runtime',
        enabled: !Boolean(options.disabled ?? entry?.disabled),
        fiberPhase: fiber && typeof fiber.state === 'number'
          ? String(fiber.state)
          : (fiber !== undefined && fiber !== null ? 'active' : undefined),
      })
    }
  } catch {
    // a throwing loader degrades the runtime view, never the mounter
  }
  return deepFreeze(rows)
}

/**
 * Build the frozen `ResolvedView` for the requested view.
 *
 * @param {string} view - 'runtime' | 'disk' | 'other'.
 * @param {object} options
 * @param {string|undefined} options.profile - profile name (view 'other'; optional for disk).
 * @param {() => unknown} options.loadEntries - loader entries supplier.
 * @param {string|URL|undefined} options.baseUrl - loader base URL.
 * @param {Array<string>|undefined} options.overlayFiles - overlay contents (disk/other).
 * @param {() => number} [options.now]
 * @returns {object} frozen result: `{ code: 'ok', view } | { code, reason }`.
 */
function inspectView(view, options = {}) {
  try {
    if (view !== 'runtime' && view !== 'disk' && view !== 'other') {
      return deepFreeze({ code: INSPECTION_CODES['invalid-input'], reason: `unknown view "${String(view)}"` })
    }
    if (view === 'runtime') {
      const rows = Array.isArray(options.runtimeSnapshot) ? options.runtimeSnapshot : []
      return deepFreeze({
        code: 'ok',
        view: 'runtime',
        rows,
        layers: deepFreeze([
          { kind: 'loader', status: rows.length > 0 ? 'folded' : 'unavailable', reason: rows.length > 0 ? undefined : 'loader-entries-empty' },
          // package versions / dependency graph are not observable through
          // the loader at init: reported explicitly, never fabricated.
          { kind: 'packages', status: 'unavailable', reason: 'not-observable-via-loader' },
        ]),
        packages: deepFreeze([]),
        unavailable: deepFreeze(['package-versions', 'package-dependencies']),
        capturedAt: new Date((typeof options.now === 'function' ? options.now() : Date.now())).toISOString(),
      })
    }
    const dir = view === 'disk'
      ? resolveProfileDir(options.baseUrl, options.profile)
      : resolveProfileDir(undefined, options.profile)
    if (!dir) {
      return deepFreeze({ code: INSPECTION_CODES.unavailable, reason: 'profile-directory-unresolved' })
    }
    const folded = foldDiskView(dir, {
      view,
      profile: options.profile,
      overlayFiles: options.overlayFiles,
      now: options.now,
    })
    // secrets discovered in profile files are redacted in every audience
    // before the frozen result leaves the mounter (fail-closed).
    return deepFreeze({ code: 'ok', ...redactProfileSecrets(folded) })
  } catch {
    return deepFreeze({ code: INSPECTION_CODES.internal, reason: 'inspection-failed' })
  }
}

/**
 * Build the frozen health report over a view target.
 *
 * @param {string|object} target - view name or the ResolvedView itself.
 * @param {object} options - same options as inspectView.
 * @returns {object} frozen `{ code: 'ok', findings } | { code, reason }`.
 */
function inspectHealth(target, options = {}) {
  try {
    let view
    if (typeof target === 'string') {
      const result = inspectView(target, options)
      if (result.code !== 'ok') return deepFreeze(result)
      view = result
    } else if (target && typeof target === 'object' && Array.isArray(target.rows)) {
      view = target
    } else {
      return deepFreeze({ code: INSPECTION_CODES['invalid-input'], reason: 'invalid-health-target' })
    }
    return deepFreeze({ code: 'ok', findings: redactProfileSecrets(healthFindings(view)) })
  } catch {
    return deepFreeze({ code: INSPECTION_CODES.internal, reason: 'health-failed' })
  }
}

/**
 * Build the frozen dry-run diff for a change intent (pure computation over
 * the shared parser; never writes anything).
 *
 * @param {object} intent - `{ type: 'config', rows }` or `{ type: 'deps',
 *   add?, remove? }`.
 * @param {string[]} [currentPackages] - current declared package names.
 * @returns {object} frozen `{ code: 'ok', diff } | { code, reason }`.
 */
function inspectPlanDiff(intent, currentPackages = []) {
  try {
    if (!intent || typeof intent !== 'object') {
      return deepFreeze({ code: INSPECTION_CODES['invalid-input'], reason: 'invalid-intent' })
    }
    const type = intent.type
    if (type === 'config') {
      return deepFreeze({ code: 'ok', diff: planConfigOverlay(intent) })
    }
    if (type === 'deps') {
      return deepFreeze({ code: 'ok', diff: planDependencySet(intent, currentPackages) })
    }
    return deepFreeze({ code: INSPECTION_CODES['invalid-input'], reason: `unknown intent type "${String(type)}"` })
  } catch {
    return deepFreeze({ code: INSPECTION_CODES.internal, reason: 'plan-failed' })
  }
}

/**
 * Create the inspection mounter.
 *
 * @param {object} options
 * @param {object} options.ctx - cordis context (may be partial in tests).
 * @param {object} [options.logger]
 * @param {() => unknown} [options.loadEntries] - loader entries supplier
 *   (defaults to `ctx.loader.entries()`).
 * @param {string|URL|undefined} [options.baseUrl] - loader base URL (defaults
 *   to `ctx.baseUrl`).
 * @param {() => number} [options.now]
 * @returns {{ api: object, dispose: () => void }} frozen read-only api:
 *   `inspect({view, profile?, overlayFiles?})`, `health(target, options?)`,
 *   `planDiff(intent)`.
 */
export function createProfileInspection({ ctx, logger, loadEntries, baseUrl, now } = {}) {
  const safeLogger = logger ?? { error() {}, warn() {} }
  // The runtime view is a boot-time composition snapshot: captured ONCE at
  // mounter construction (apply time) and frozen, so post-init dynamic
  // registrations are never tracked (boot snapshot semantics).
  const runtimeSnapshot = captureRuntimeView(typeof loadEntries === 'function'
    ? loadEntries
    : () => {
        try {
          return ctx?.loader?.entries?.() ?? []
        } catch {
          return []
        }
      })
  const url = baseUrl !== undefined ? baseUrl : ctx?.baseUrl

  const api = Object.freeze({
    inspect(input) {
      const view = typeof input === 'string' ? input : input?.view
      const profile = typeof input === 'string' ? undefined : input?.profile
      const overlayFiles = typeof input === 'string' ? undefined : input?.overlayFiles
      return inspectView(view, {
        profile,
        overlayFiles,
        runtimeSnapshot,
        baseUrl: url,
        now,
      })
    },
    health(target, options) {
      return inspectHealth(target, {
        profile: options?.profile,
        overlayFiles: options?.overlayFiles,
        runtimeSnapshot,
        baseUrl: url,
        now,
      })
    },
    planDiff(intent, options) {
      return inspectPlanDiff(intent, options?.currentPackages)
    },
  })

  return {
    api,
    dispose() {
      try {
        safeLogger.warn?.('dsh-plugin-api profile inspection mounter disposed')
      } catch {
        // disposal must never throw
      }
    },
  }
}