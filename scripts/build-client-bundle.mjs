#!/usr/bin/env node
// Rebuild the checked-in browser bundle `lib/client.js` from its sources.
//
// `lib/client.js` is a generated artifact: it must never be hand-edited. After
// changing any client source under `lib/`, run `npm run build:client` and
// confirm the resulting diff only contains the intended changes.
//
// Usage:
//   node scripts/build-client-bundle.mjs                rebuild lib/client.js
//   node scripts/build-client-bundle.mjs --out <path>   rebuild to <path>
//   node scripts/build-client-bundle.mjs --check        fail if the checked-in
//                                                       bundle is out of date
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readFileSync, renameSync, unlinkSync } from 'node:fs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ENTRY = resolve(root, 'lib/client-runtime.js')
const OUTFILE = resolve(root, 'lib/client.js')

// The official browser module loader receives the bundle as a CommonJS factory.
const BANNER = [
  'window.__ModuleLoader__.load({',
  "  id: '@deepseek-ai/dsh-plugin-api-main',",
  '  factory: (require) => {',
  '    var module = { exports: {} };',
  '    var exports = module.exports;',
  "    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });",
].join('\n')

const FOOTER = [
  '    return DSHPluginApiClientBundle;',
  '  },',
  '});',
].join('\n')

function parseArgs(argv) {
  const options = { out: OUTFILE, check: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--check') options.check = true
    else if (arg === '--out') {
      index += 1
      options.out = resolve(root, argv[index])
    } else throw new Error(`unknown argument: ${arg}`)
  }
  return options
}

async function buildBundle(outfile) {
  await build({
    entryPoints: [ENTRY],
    outfile,
    bundle: true,
    format: 'iife',
    globalName: 'DSHPluginApiClientBundle',
    platform: 'browser',
    // The checked-in bundle escapes non-ASCII as \uXXXX; keep that encoding so
    // rebuilds stay byte-identical apart from intended source changes.
    charset: 'ascii',
    legalComments: 'none',
    banner: { js: BANNER },
    footer: { js: FOOTER },
    logLevel: 'warning',
  })
}

const options = parseArgs(process.argv.slice(2))

if (!options.check) {
  await buildBundle(options.out)
  console.log(`client bundle rebuilt: ${options.out}`)
} else {
  const scratch = `${OUTFILE}.check`
  try {
    await buildBundle(scratch)
    const current = readFileSync(OUTFILE, 'utf8')
    const rebuilt = readFileSync(scratch, 'utf8')
    if (current === rebuilt) {
      console.log('client bundle is up to date with its sources')
    } else {
      const lines = (value) => value.split('\n')
      const [a, b] = [lines(current), lines(rebuilt)]
      let first = 0
      while (first < Math.min(a.length, b.length) && a[first] === b[first]) first += 1
      console.error(`client bundle is out of date (first difference at line ${first + 1})`)
      console.error(`  checked-in: ${a[first] ?? '<eof>'}`)
      console.error(`  rebuilt:    ${b[first] ?? '<eof>'}`)
      process.exitCode = 1
    }
  } finally {
    unlinkSync(scratch)
  }
}
