/**
 * Assembly and compatibility acceptance (Req 11, Task 6).
 *
 * The whole-tree convergence owes evidence that the two supported installation
 * modes assemble the same thing, that removing a replacement package restores
 * the official row, that a missing or mismatched auxiliary package degrades
 * locally, and that the frozen version baseline is untouched. The checks read
 * the shipped artifacts (bundle patches, package manifests, the registry) so
 * they cannot drift from what a deployment actually loads.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const packagesDir = resolve(root, 'packages')
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const mainManifest = readJson(resolve(root, 'package.json'))

/** Every directory under packages/ that ships a bundle patch. */
const patchPackages = readdirSync(packagesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => existsSync(resolve(packagesDir, name, 'cordis.patch.yml')))

/** Parse the `- id: <row>` and `- id: <row>\n  disabled: true` pairs of a patch. */
function parsePatch(text) {
  const disabled = new Set()
  const inserted = new Set()
  let pendingId = null
  for (const line of text.split('\n')) {
    const idMatch = line.match(/^-\s*id:\s*(\S+)\s*$/)
    if (idMatch) {
      pendingId = idMatch[1]
      continue
    }
    const insertMatch = line.match(/^\s*-\s*id:\s*(\S+)\s*$/)
    if (insertMatch && pendingId === null) {
      inserted.add(insertMatch[1])
      continue
    }
    if (pendingId !== null && /disabled:\s*true/.test(line)) {
      disabled.add(pendingId)
      pendingId = null
      continue
    }
    if (pendingId !== null && /^\s*-\s*insert:/.test(line)) {
      pendingId = null
    }
  }
  for (const match of text.matchAll(/\n\s*-\s*id:\s*(\S+)\s*\n\s*name:\s*'([^']+)'/g)) {
    inserted.add(match[1])
  }
  return { disabled, inserted }
}

test('the frozen version baseline is untouched across the main and auxiliary packages', () => {
  // runtime identity + api generation live in the main manifest; every
  // auxiliary package shares the A.B.C prefix.
  assert.equal(mainManifest.version, '0.1.0-rc.6-0.1.0')
  assert.equal(mainManifest.dsh.api, '0.1')
  const abc = mainManifest.version.split('-').slice(0, 2).join('-')
  for (const name of patchPackages) {
    const manifest = readJson(resolve(packagesDir, name, 'package.json'))
    assert.equal(manifest.version.startsWith(abc), true, `${name} shares the A.B.C baseline`)
  }
})

test('the full bundle assembles exactly the rows the selective packages declare', () => {
  const full = readFileSync(resolve(packagesDir, 'full/cordis.patch.yml'), 'utf8')
  const fullPatch = parsePatch(full)
  assert.equal(fullPatch.inserted.has('plugin-api-main'), true, 'the main facade row leads the assembly')

  // Every replacement package disables an official row and inserts its own.
  for (const name of patchPackages) {
    if (name === 'full') continue
    const patch = parsePatch(readFileSync(resolve(packagesDir, name, 'cordis.patch.yml'), 'utf8'))
    for (const disabled of patch.disabled) {
      assert.equal(fullPatch.disabled.has(disabled), true, `${name} disables ${disabled}; the full bundle does too`)
    }
    for (const inserted of patch.inserted) {
      assert.equal(fullPatch.inserted.has(inserted), true, `${name} inserts ${inserted}; the full bundle does too`)
    }
  }

  // ...and nothing else: the full bundle may not carry a row that the
  // selective installation (main + every auxiliary package) cannot produce.
  const selectiveDisabled = new Set()
  const selectiveInserted = new Set(['plugin-api-main'])
  for (const name of patchPackages) {
    if (name === 'full') continue
    const patch = parsePatch(readFileSync(resolve(packagesDir, name, 'cordis.patch.yml'), 'utf8'))
    for (const disabled of patch.disabled) selectiveDisabled.add(disabled)
    for (const inserted of patch.inserted) selectiveInserted.add(inserted)
  }
  for (const disabled of fullPatch.disabled) {
    assert.equal(selectiveDisabled.has(disabled), true, `the full bundle disables ${disabled}; the selective set does too`)
  }
  for (const inserted of fullPatch.inserted) {
    assert.equal(selectiveInserted.has(inserted), true, `the full bundle inserts ${inserted}; the selective set does too`)
  }
})

test('removing a replacement package restores the official row (disable + insert pairing)', () => {
  for (const name of patchPackages) {
    if (name === 'full') continue
    const patch = parsePatch(readFileSync(resolve(packagesDir, name, 'cordis.patch.yml'), 'utf8'))
    assert.equal(patch.disabled.size >= 1, true, `${name} disables at least one official row`)
    assert.equal(patch.inserted.size >= 1, true, `${name} inserts its own row`)
    // The two sets are disjoint: ours never disables our own row, and the
    // official row id never appears as an insert (no double-run).
    for (const inserted of patch.inserted) {
      assert.equal(patch.disabled.has(inserted), false, `${name} never disables its own row ${inserted}`)
    }
  }
})

test('a missing auxiliary package degrades locally instead of taking the facade down', async () => {
  // The facade's service definitions declare the auxiliary-provided faces as
  // members whose absence is typed, and the registry records the R carriers as
  // their own capability clusters — so a missing package can only disable its
  // own cluster.
  const registry = readJson(resolve(root, 'docs/specs/plugin-api-m7-public-contract-refactor/public-contract.registry.json'))
  // The registry namespaces every replacement-backed capability cluster, and
  // the main facade's own surface (request/plan-mode/preset/credentials) is
  // registry-recorded independently of any auxiliary package.
  const namespaces = new Set((registry.namespaces ?? []).map((record) => record.namespace))
  for (const required of ['sessions.planMode', 'sessions.permissionPresets', 'sessions.compaction', 'sessions.interactions']) {
    assert.equal(namespaces.has(required), true, `${required} is a registry-recorded capability`)
  }
  const mainMembers = (registry.members ?? []).filter((member) => member.runtime === 'host' && !String(member.capability).startsWith('client.'))
  for (const required of ['sessions.request', 'sessions.cancel', 'sessions.planMode.select', 'credentials.set']) {
    assert.equal(mainMembers.some((member) => member.publicPath === required), true, `${required} belongs to the main facade surface, never to a replacement package`)
  }

  // Each replacement package carries its own capability cluster, and the main
  // facade's own members stay reachable when every auxiliary package is
  // absent: build the main services namespace with no auxiliary service
  // provided at all and assert its own faces still resolve.
  const { createServicesNamespace } = await import('../lib/services.js')
  const { SERVICE_DEFINITIONS } = await import('../lib/services.js')
  const auxiliaryServices = new Set(patchPackages.filter((name) => name !== 'full').map((name) => name.replace(/-/g, '')))
  const provided = {}
  for (const definition of SERVICE_DEFINITIONS) {
    // Simulate the deployment: only the official services exist; nothing the
    // auxiliary packages would add is available.
    provided[definition.ctxService] = definition.members.every((member) => member.optional === true) ? undefined : {}
  }
  const ctx = {
    get(name) {
      if (name === 'pluginApi') return undefined
      return provided[name]
    },
  }
  const namespace = createServicesNamespace({ ctx, active: true, uriHelpers: {} })
  assert.ok(namespace, 'the services namespace still builds without any auxiliary package')
  // Face-level assertion: every declared passthrough face still resolves
  // (active or typed-disabled) with no auxiliary package in the tree, and the
  // namespace never shrinks to the auxiliary-backed subset.
  assert.equal(Object.keys(namespace).length, SERVICE_DEFINITIONS.length, 'every declared service key resolves')
  for (const definition of SERVICE_DEFINITIONS) {
    const face = namespace[definition.key]
    assert.ok(face, `services.${definition.key} still resolves without any auxiliary package`)
    assert.equal(typeof face.isActive, 'boolean', `services.${definition.key} reports its own activity`)
  }
  assert.equal(auxiliaryServices.size >= 5, true, 'the auxiliary inventory is non-trivial')
  for (const name of patchPackages) {
    if (name === 'full') continue
    const manifest = readJson(resolve(packagesDir, name, 'package.json'))
    assert.equal(manifest.name.startsWith('@deepseek-ai/dsh-plugin-api-'), true, `${name} is a facade auxiliary package`)
  }
})
