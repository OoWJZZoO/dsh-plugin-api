#!/usr/bin/env node
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { migrationToolVersion } from '../lib/migrate/index.js'

function help() {
  return `dsh-plugin-api-migrate ${migrationToolVersion()}

Usage:
  dsh-plugin-api-migrate scan <root> [options]
  dsh-plugin-api-migrate check <root> [options]
  dsh-plugin-api-migrate migrate <root> [--write] [options]
  dsh-plugin-api-migrate migrate --rollback <migration-id-or-dir>
  dsh-plugin-api-migrate audit --read <jsonl>

Options:
  --json                 emit machine-readable JSON
  --parser babel|ecma    select source parser (default: babel)
  --include <path>       include a relative path (repeatable)
  --exclude <path>       exclude a relative path (repeatable)
  --allow-outside-root   allow explicit files resolved outside root
  --report <file>        write a report to a file
  --help                 show this help
`
}

export function parseCliArgs(argv) {
  const args = [...argv]
  const command = args.length && !args[0].startsWith('-') ? args.shift() : 'help'
  const options = { command, include: [], exclude: [], positionals: [] }
  while (args.length) {
    const value = args.shift()
    if (value === '--help' || value === '-h') options.help = true
    else if (value === '--json') options.json = true
    else if (value === '--write') options.write = true
    else if (value === '--allow-outside-root') options.allowOutsideRoot = true
    else if (value === '--parser') options.parser = args.shift()
    else if (value === '--include') options.include.push(args.shift())
    else if (value === '--exclude') options.exclude.push(args.shift())
    else if (value === '--report') options.report = args.shift()
    else if (value === '--rollback') options.rollback = args.shift()
    else options.positionals.push(value)
  }
  return options
}

export async function main(argv = process.argv.slice(2), io = console) {
  const options = parseCliArgs(argv)
  if (options.help || options.command === 'help') {
    io.log(help())
    return 0
  }
  io.error(`command not implemented in this batch: ${options.command}`)
  return 2
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((code) => { process.exitCode = code }).catch((error) => {
    console.error(error?.stack ?? error)
    process.exitCode = 1
  })
}
