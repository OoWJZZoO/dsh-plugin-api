/**
 * Build the client-runtime replacement bundle's client half (`lib/client.js`).
 *
 * Client replacement bundles must self-maintain their bundle build and must
 * never hand-modify the official published bundle. This script:
 *   1. reads the official `@deepseek-ai/dsh-client-runtime` browser bundle
 *      verbatim (module-loader registration of the official module id);
 *   2. inlines the attention runtime state machine (`lib/browser-runtime.js`,
 *      `export` stripped so it executes in the bundle's script scope);
 *   3. appends the replacement wrapper (`lib/client-src/replacement.js`).
 *
 * Run: `node scripts/build-client.mjs` from the package directory.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('..', import.meta.url))

const officialClientPath = require.resolve('@deepseek-ai/dsh-client-runtime/client')
const officialSrc = readFileSync(officialClientPath, 'utf8')
  .replace(/\n\/\/# sourceMappingURL=.*$/u, '')
  // Normalize trailing whitespace so the committed artifact stays clean for
  // `git diff --check`; the verbatim guarantee (official code inlined
  // unmodified) is otherwise preserved.
  .replace(/[ \t]+$/gm, '')

const runtimeSrc = readFileSync(
  fileURLToPath(new URL('../lib/browser-runtime.js', import.meta.url)),
  'utf8',
)
// The state machine is a pure ESM module; inline it without `export` so it
// executes in the bundle's script scope and the wrapper can construct it.
const inlinedRuntime = runtimeSrc.replace(/^export /gm, '')

const replacementSrc = readFileSync(
  fileURLToPath(new URL('../lib/client-src/replacement.js', import.meta.url)),
  'utf8',
)

const outPath = resolve(root, 'lib/client.js')
const parsedOut = process.argv.indexOf('--out')
const target = parsedOut >= 0 ? resolve(root, process.argv[parsedOut + 1]) : outPath
writeFileSync(target, `${officialSrc}\n\n${inlinedRuntime}\n\n${replacementSrc}\n`)
console.log(`built ${target} (${officialSrc.length + inlinedRuntime.length + replacementSrc.length} bytes)`)