/**
 * Build the connection replacement bundle's client half (`lib/client.js`).
 *
 * Client replacement bundles must self-maintain their bundle build and
 * must never hand-modify the official published bundle. This script:
 *   1. reads the official `@deepseek-ai/dsh-client-connection` browser bundle
 *      verbatim (module-loader registration of the official module id);
 *   2. appends the replacement module registration that wraps the official
 *      exports with the incremental browser slices
 *      (`lib/client-src/replacement.js`).
 *
 * Run: `node scripts/build-client.mjs` from the package directory.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const officialClientPath = require.resolve('@deepseek-ai/dsh-client-connection/client')
const officialSrc = readFileSync(officialClientPath, 'utf8')
  .replace(/\n\/\/# sourceMappingURL=.*$/u, '')

const replacementSrc = readFileSync(
  fileURLToPath(new URL('../lib/client-src/replacement.js', import.meta.url)),
  'utf8',
)

const outPath = fileURLToPath(new URL('../lib/client.js', import.meta.url))
writeFileSync(outPath, `${officialSrc}\n\n${replacementSrc}\n`)
console.log(`built ${outPath} (${officialSrc.length + replacementSrc.length} bytes)`)