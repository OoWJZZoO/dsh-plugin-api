/**
 * Package entry forwarding the plugin `apply` to the boot self-check module.
 * The DSH loader resolves the entry via package.json `main: lib/index.js` and
 * reads the named `apply`/`name`/`inject` exports.
 */
export { apply, createLlmApply, inject, name } from './apply.js'
