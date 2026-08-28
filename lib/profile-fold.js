/**
 * Shared tolerant profile-composition folding parser for plugin-profile
 * management.
 *
 * Pure-function module with zero harness dependencies (js-yaml only): the
 * facade inspection mounter and the out-of-process executor CLI import the
 * SAME implementation through the main package's `./profile-fold` subpath
 * export, so the profile-composition format is coupled at exactly one place.
 *
 * Tolerance contract (approved design components 1/3):
 * - layers are folded in official composition order (profile manifest
 *   bundles → profile patch layer → overlay layers);
 * - a layer that cannot be parsed or folded is marked `unavailable` with a
 *   reason code while every successfully folded portion is still returned;
 * - unknown fields in layer entries are preserved verbatim in the frozen
 *   view (never dropped, never guessed);
 * - `!!js` expressions are preserved as raw text (`{__jsExpr}` marker nodes,
 *   never evaluated) using the official js-yaml `JSON_SCHEMA` + `!!js`
 *   dialect mirrored from `dsh-app-boot`;
 * - every returned payload is deeply frozen; freeze failure fails closed for
 *   that payload.
 */
import * as yaml from 'js-yaml'
import { deepFreeze } from './deep-freeze.js'

/**
 * The official `!!js` scalar dialect: a scalar whose text is captured raw as
 * `{ __jsExpr }` and round-trips through load/dump without evaluation.
 */
const JsExpr = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: (data) => typeof data === 'string',
  construct: (data) => ({ __jsExpr: data }),
  predicate: (value) => isJsExpr(value),
  represent: (data) => data.__jsExpr,
})

const ENTRY_LIST_SCHEMA = yaml.JSON_SCHEMA.extend(JsExpr)

/** Known layer kinds the folder can fold. Unknown kinds are reported, not guessed. */
const KNOWN_LAYER_KINDS = new Set(['manifest', 'package-manifest', 'patch', 'overlay'])

/** Severity vocabulary for health findings. */
export const FINDING_SEVERITY = Object.freeze({
  error: 'error',
  warning: 'warning',
})

/** Stability reason codes for layers that cannot be folded. */
export const LAYER_UNAVAILABLE = Object.freeze({
  unparseable: 'unparseable',
  'invalid-shape': 'invalid-shape',
  'unknown-layer': 'unknown-layer',
  'missing-bundles': 'missing-bundles',
})

/**
 * @param {unknown} value
 * @returns {value is { __jsExpr: string }}
 */
export function isJsExpr(value) {
  return Boolean(
    value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof value.__jsExpr === 'string',
  )
}

/**
 * Parse an entry-list YAML document with the official dialect.
 *
 * @param {string} content - raw file content
 * @returns {{ ok: true, value: unknown } | { ok: false, reason: string }}
 */
export function parseEntryList(content) {
  try {
    return { ok: true, value: yaml.load(content, { schema: ENTRY_LIST_SCHEMA }) }
  } catch (error) {
    return { ok: false, reason: error?.message ?? String(error) }
  }
}

/**
 * Fold a profile's layered composition into a frozen ResolvedView.
 *
 * @param {Array<{ kind: string, name?: string, content: string }>} files -
 *   ordered layer files. Kinds:
 *   - `manifest` (profile package.json; yields `packages[]` from
 *     `dsh.profile.bundles` = core scope + `dependencies` = user scope);
 *   - `package-manifest` (one installed package's package.json, `name` =
 *     package name; enriches `packages[].version` / `dependencies`);
 *   - `patch` (the profile's own `cordis.patch.yml` user layer);
 *   - `overlay` (a `--patch` overlay entry list).
 * @param {{ view?: string, profile?: string, now?: (() => number) }} [options]
 * @returns {object} frozen ResolvedView: `{ view, profile?, rows, layers,
 *   packages, capturedAt }` where `rows[] = { id?, name?, bundle?, source?,
 *   raw, layer }` and `layers[] = { kind, name?, status: 'folded' |
 *   'unavailable', reason? }`.
 */
export function foldLayers(files, options = {}) {
  const now = typeof options.now === 'function' ? options.now() : Date.now()
  const rows = []
  const layers = []
  const packages = new Map()
  const bundleOrder = []

  const pushRow = (entry, { bundle, source, layer }) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return
    const hasInsert = Array.isArray(entry.insert)
    const isInsertContainer = hasInsert && typeof entry.id !== 'string'
    if (!isInsertContainer) {
      rows.push({
        id: typeof entry.id === 'string' ? entry.id : undefined,
        name: typeof entry.name === 'string' ? entry.name : undefined,
        bundle,
        source,
        layer,
        raw: entry,
      })
    }
    // Official collection semantics index inserted entries like rows, so the
    // fold materializes nested `insert` lists as resolved rows in place. A
    // pure insert container (no own id) contributes only its inserted rows.
    if (hasInsert) {
      for (const inserted of entry.insert) {
        pushRow(inserted, { bundle, source, layer })
      }
    }
  }

  for (const file of Array.isArray(files) ? files : []) {
    const kind = file?.kind
    const layerName = typeof file?.name === 'string' ? file.name : kind
    const layer = { kind: String(kind ?? ''), name: typeof file?.name === 'string' ? file.name : undefined }
    // A caller-pre-marked unavailable layer (e.g. an unreadable file on disk)
    // is preserved verbatim instead of being re-folded from missing content.
    if (file?.status === 'unavailable') {
      layer.status = 'unavailable'
      layer.reason = typeof file?.reason === 'string' ? file.reason : LAYER_UNAVAILABLE['invalid-shape']
      layers.push(layer)
      continue
    }
    if (typeof file?.content !== 'string') {
      layer.status = 'unavailable'
      layer.reason = LAYER_UNAVAILABLE['invalid-shape']
      layers.push(layer)
      continue
    }
    if (!KNOWN_LAYER_KINDS.has(kind)) {
      layer.status = 'unavailable'
      layer.reason = LAYER_UNAVAILABLE['unknown-layer']
      layers.push(layer)
      continue
    }

    if (kind === 'manifest' || kind === 'package-manifest') {
      let manifest
      try {
        manifest = JSON.parse(file.content)
      } catch {
        layer.status = 'unavailable'
        layer.reason = LAYER_UNAVAILABLE.unparseable
        layers.push(layer)
        continue
      }
      if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
        layer.status = 'unavailable'
        layer.reason = LAYER_UNAVAILABLE['invalid-shape']
        layers.push(layer)
        continue
      }
      if (kind === 'manifest') {
        const bundles = manifest?.dsh?.profile?.bundles
        if (!Array.isArray(bundles)) {
          layer.status = 'unavailable'
          layer.reason = LAYER_UNAVAILABLE['missing-bundles']
          layers.push(layer)
          // The manifest still contributes its declared user dependencies.
          for (const [name, spec] of Object.entries(manifest?.dependencies ?? {})) {
            if (typeof name !== 'string' || typeof spec !== 'string') continue
            const existing = packages.get(name)
            packages.set(name, {
              name,
              version: existing?.version,
              scope: 'user',
              dependencies: existing?.dependencies,
            })
          }
          continue
        }
        for (const bundle of bundles) {
          if (typeof bundle !== 'string' || bundle.length === 0) continue
          bundleOrder.push(bundle)
          const existing = packages.get(bundle)
          packages.set(bundle, {
            name: bundle,
            version: existing?.version,
            scope: 'core',
            dependencies: existing?.dependencies,
          })
        }
        for (const [name, spec] of Object.entries(manifest?.dependencies ?? {})) {
          if (typeof name !== 'string' || typeof spec !== 'string') continue
          const existing = packages.get(name)
          // A bundle already declared in `dsh.profile.bundles` keeps its core
          // scope; the dependency entry only back-fills what is not declared.
          if (existing?.scope === 'core') continue
          packages.set(name, {
            name,
            version: existing?.version,
            scope: 'user',
            dependencies: existing?.dependencies,
          })
        }
      } else {
        // package-manifest: enrich an already-declared package identity.
        const packageName = typeof file.name === 'string' ? file.name : String(manifest?.name ?? '')
        const declared = packages.get(packageName)
        const deps = manifest?.dependencies
        const dependencies = (typeof deps === 'object' && deps !== null && !Array.isArray(deps))
          ? Object.keys(deps)
          : undefined
        if (declared) {
          packages.set(packageName, {
            name: declared.name,
            version: typeof manifest?.version === 'string' ? manifest.version : declared.version,
            scope: declared.scope,
            dependencies: declared.dependencies ?? dependencies,
          })
        } else if (packageName) {
          packages.set(packageName, {
            name: packageName,
            version: typeof manifest?.version === 'string' ? manifest.version : undefined,
            scope: undefined,
            dependencies,
          })
        }
      }
      layer.status = 'folded'
      layers.push(layer)
      continue
    }

    // patch / overlay: entry-list YAML in the official dialect.
    const parsed = parseEntryList(file.content)
    if (!parsed.ok || parsed.value === undefined || parsed.value === null) {
      layer.status = 'unavailable'
      layer.reason = parsed.ok ? LAYER_UNAVAILABLE['invalid-shape'] : LAYER_UNAVAILABLE.unparseable
      layers.push(layer)
      continue
    }
    if (!Array.isArray(parsed.value)) {
      layer.status = 'unavailable'
      layer.reason = LAYER_UNAVAILABLE['invalid-shape']
      layers.push(layer)
      continue
    }
    const bundle = kind === 'patch' ? 'profile' : layerName
    for (const entry of parsed.value) {
      pushRow(entry, { bundle, source: kind, layer: layerName })
    }
    layer.status = 'folded'
    layers.push(layer)
  }

  const packagesList = []
  // Core bundles first, in declared order; user packages follow afterwards in
  // manifest order; any extra package-manifest-only packages come last.
  for (const name of bundleOrder) {
    packagesList.push(packages.get(name))
  }
  for (const [name, record] of packages) {
    if (record.scope === 'user') packagesList.push(record)
  }
  for (const [name, record] of packages) {
    if (record.scope === undefined && !bundleOrder.includes(name)
      && !packagesList.some((entry) => entry.name === name)) {
      packagesList.push(record)
    }
  }

  return deepFreeze({
    view: typeof options.view === 'string' ? options.view : undefined,
    profile: typeof options.profile === 'string' ? options.profile : undefined,
    rows,
    layers,
    packages: packagesList,
    capturedAt: new Date(now).toISOString(),
  })
}

/**
 * Fold a profile composition strictly read-only from structured file text.
 * This is the pure layer the inspection mounter uses; the mounter supplies
 * the raw file contents it read (never mutated).
 *
 * @param {Array<{kind: string, name?: string, content: string}>} files
 * @param {{view?: string, profile?: string, now?: () => number}} [options]
 * @returns {object} frozen ResolvedView (see foldLayers).
 */
export function foldProfile(files, options = {}) {
  return foldLayers(files, options)
}

/**
 * Compute structured health findings over a folded view.
 *
 * @param {object} view - a ResolvedView produced by foldLayers.
 * @returns {object[]} frozen `Finding[]`: `{ code, severity, subject, detail }`.
 *   Codes: duplicate-row-id / missing-package / row-package-mismatch /
 *   version-inconsistent / unknown-layer.
 */
export function healthFindings(view) {
  const findings = []
  const rows = Array.isArray(view?.rows) ? view.rows : []
  const packages = Array.isArray(view?.packages) ? view.packages : []
  const packageNames = new Set(packages.map((p) => p.name).filter((name) => typeof name === 'string'))
  const layers = Array.isArray(view?.layers) ? view.layers : []

  // duplicate-row-id: the same row id appears on more than one resolved row.
  const ids = new Map()
  for (const row of rows) {
    if (typeof row?.id !== 'string' || row.id.length === 0) continue
    const seen = ids.get(row.id) ?? []
    seen.push(row)
    ids.set(row.id, seen)
  }
  for (const [id, seen] of ids) {
    if (seen.length <= 1) continue
    findings.push({
      code: 'duplicate-row-id',
      severity: FINDING_SEVERITY.error,
      subject: id,
      detail: `row id "${id}" resolves from ${seen.length} layers`,
    })
  }

  // version-inconsistent: multiple `@deepseek-ai/dsh-plugin-api-*` packages
  // with parseable full unique versions disagree on the runtime part or the
  // api part (read-only mirror of the unified-version vocabulary).
  const versioned = []
  for (const record of packages) {
    if (typeof record?.version !== 'string') continue
    const match = /^(.+)-(\d+\.\d+)(?:\.(\d+))?$/.exec(record.version)
    if (!match) continue
    versioned.push({ name: record.name, runtime: match[1], api: match[2] })
  }
  const apiFamily = versioned.filter((v) => v.name?.startsWith('@deepseek-ai/dsh-plugin-api'))
  for (let i = 0; i < apiFamily.length; i += 1) {
    for (let j = i + 1; j < apiFamily.length; j += 1) {
      const a = apiFamily[i]
      const b = apiFamily[j]
      if (a.runtime !== b.runtime || a.api !== b.api) {
        findings.push({
          code: 'version-inconsistent',
          severity: FINDING_SEVERITY.error,
          subject: `${a.name} / ${b.name}`,
          detail: `full versions disagree on runtime or api part (${a.name} ${a.runtime}-${a.api}, ${b.name} ${b.runtime}-${b.api})`,
        })
      }
    }
  }

  // row-package-mismatch: a row names a package that is not declared in the
  // folded package set.
  for (const row of rows) {
    if (typeof row?.name !== 'string' || row.name.length === 0) continue
    if (!packageNames.has(row.name)) {
      findings.push({
        code: 'row-package-mismatch',
        severity: FINDING_SEVERITY.error,
        subject: row.name,
        detail: `row "${row.name}" is not declared among the profile's packages`,
      })
    }
  }

  // missing-package: a bundle declared in the profile manifest has no
  // resolvable version identity in the folded package set.
  for (const record of packages) {
    if (record.scope === 'core' && typeof record.version !== 'string') {
      findings.push({
        code: 'missing-package',
        severity: FINDING_SEVERITY.warning,
        subject: record.name,
        detail: `core bundle "${record.name}" has no resolvable version`,
      })
    }
  }

  // unknown-layer: a structural layer the folder does not recognize.
  for (const layer of layers) {
    if (layer?.status === 'unavailable' && layer?.reason === LAYER_UNAVAILABLE['unknown-layer']) {
      findings.push({
        code: 'unknown-layer',
        severity: FINDING_SEVERITY.warning,
        subject: String(layer?.name ?? layer?.kind ?? ''),
        detail: `layer "${String(layer?.name ?? layer?.kind ?? '')}" is not a known composition layer`,
      })
    }
  }

  return deepFreeze(findings)
}

/**
 * Pure dry-run computation of a configuration-type change: produce the
 * candidate overlay entry-list YAML **in memory** (never written anywhere).
 *
 * @param {object} intent - `{ rows: Array<{ id: string, name?: string,
 *   config?: object, disabled?: boolean }> }`.
 * @returns {object} frozen `PlanDiff`:
 *   `{ intentType: 'config', overlayYaml, warnings[] }`.
 */
export function planConfigOverlay(intent) {
  const warnings = []
  const changes = Array.isArray(intent?.rows) ? intent.rows : []
  if (changes.length === 0) warnings.push('empty-config-change')
  const overlay = []
  for (const change of changes) {
    if (change === null || typeof change !== 'object' || typeof change.id !== 'string') {
      warnings.push('skipped-invalid-row')
      continue
    }
    const entry = { id: change.id }
    if (typeof change.name === 'string') entry.name = change.name
    if (change.config !== undefined) entry.config = change.config
    if (typeof change.disabled === 'boolean') entry.disabled = change.disabled
    overlay.push(entry)
  }
  let overlayYaml
  try {
    overlayYaml = yaml.dump(overlay, { schema: ENTRY_LIST_SCHEMA, noRefs: true })
  } catch (error) {
    warnings.push(`serialization-failed:${error?.message ?? String(error)}`)
    overlayYaml = ''
  }
  return deepFreeze({ intentType: 'config', overlayYaml, warnings })
}

/**
 * Pure dry-run computation of a dependency-type change: compute the target
 * dependency set and the expected resolution delta **without installing
 * anything**.
 *
 * @param {object} intent - `{ add?: string[], remove?: string[] }`.
 * @param {Iterable<string>} [current] - current declared package names
 *   (e.g. from a folded view's packages list).
 * @returns {object} frozen `PlanDiff`:
 *   `{ intentType: 'deps', depSetDelta: { targetSet, add, remove },
 *   warnings[] }`.
 */
export function planDependencySet(intent, current = []) {
  const warnings = []
  const base = new Set(Array.from(current).filter((name) => typeof name === 'string'))
  const add = Array.isArray(intent?.add) ? intent.add.filter((name) => typeof name === 'string') : []
  const remove = Array.isArray(intent?.remove) ? intent.remove.filter((name) => typeof name === 'string') : []
  for (const name of add) {
    if (base.has(name)) warnings.push(`already-present:${name}`)
  }
  for (const name of remove) {
    if (!base.has(name)) warnings.push(`not-present:${name}`)
  }
  const targetSet = [...base]
  for (const name of remove) {
    const index = targetSet.indexOf(name)
    if (index >= 0) targetSet.splice(index, 1)
  }
  for (const name of add) {
    if (!targetSet.includes(name)) targetSet.push(name)
  }
  targetSet.sort()
  const deltaAdd = add.filter((name) => !base.has(name)).sort()
  const deltaRemove = remove.filter((name) => base.has(name)).sort()
  return deepFreeze({
    intentType: 'deps',
    depSetDelta: { targetSet, add: deltaAdd, remove: deltaRemove },
    warnings,
  })
}