#!/usr/bin/env node
/**
 * Executor CLI entry: spawns the profile-manager command surface from a
 * plain node invocation. Argument parsing lives in lib/cli.js (unit-testable
 * without a subprocess); this file only forwards argv and maps the exit
 * code per the command's terminal class.
 */
import { runCli } from '../lib/cli.js'

const code = await runCli(process.argv.slice(2), {
  env: process.env,
  cwd: process.cwd(),
  stdout: process.stdout,
  stderr: process.stderr,
  stdin: process.stdin,
})
process.exit(code)