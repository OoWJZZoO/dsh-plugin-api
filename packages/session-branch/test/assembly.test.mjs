import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname

async function packageJson() {
  return JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
}

test('package.json carries the unified full version and dsh.api protocol', async () => {
  const pkg = await packageJson()
  assert.equal(pkg.name, '@deepseek-ai/dsh-plugin-api-session-branch')
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.main, 'lib/apply.js')
  assert.equal(pkg.version, '0.1.0-rc.6-0.7')
  assert.equal(pkg.dsh.api, '0.7')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.peerDependencies['@deepseek-ai/dsh-session'], '0.1.0-rc.6')
  // version suffix must match the declared dsh.api
  assert.match(pkg.version, /-0\.7$/)
})

test('patch file uses only the official disabled + insert form with the single replacement row', async () => {
  const patch = await readFile(join(ROOT, 'cordis.patch.yml'), 'utf8')
  assert.match(patch, /- id: session\s*\n\s*disabled: true/)
  assert.match(patch, /- id: plugin-api-session-branch/)
  assert.match(patch, /name: '@deepseek-ai\/dsh-plugin-api-session-branch'/)
  assert.doesNotMatch(patch, /- id: compaction-basic/)
  assert.doesNotMatch(patch, /- id: mcp-client/)
})

test('no governance tokens leak into runtime-visible strings', async () => {
  // NOTE: only patterns whose own literal text is not itself banned may appear
  // here (the repository-wide governance audit scans test sources too).
  const forbidden = [
    /\bSBE-\d/, / SPEC\d/, /\bSPEC[1-4]\b/, /\br1\b/, /\bU\d{1,2}\b/,
  ]
  const libFiles = await readdir(join(ROOT, 'lib'))
  for (const file of libFiles) {
    const source = await readFile(join(ROOT, 'lib', file), 'utf8')
    for (const pattern of forbidden) {
      assert.doesNotMatch(source, pattern, `lib/${file} must not contain governance token ${pattern}`)
    }
  }
})

test('all runtime-visible identifiers use capability wording (spot-check error codes)', async () => {
  const errors = await readFile(join(ROOT, 'lib/errors.js'), 'utf8')
  assert.match(errors, /BRANCH_KIND_INVALID/)
  assert.match(errors, /EDIT_VERSION_CONFLICT/)
  assert.match(errors, /BRANCH_SOURCE_UNKNOWN/)
  assert.match(errors, /EDIT_EXTERNAL_PENDING/)
})

test('bundle does not re-export or alias the owner package import face', async () => {
  const delegate = await readFile(join(ROOT, 'lib/delegate.js'), 'utf8')
  // Composition is allowed; wholesale re-export is not.
  assert.doesNotMatch(delegate, /export \* from '@deepseek-ai\/dsh-session'/)
  assert.doesNotMatch(delegate, /export \{[\s\S]*\} from '@deepseek-ai\/dsh-session'/)
  assert.match(delegate, /import \{ SessionStore \} from '@deepseek-ai\/dsh-session'/)
})