import test from 'node:test'
import assert from 'node:assert/strict'
import { createToolAbortedErrorFactory } from '../lib/tool-abort.js'
// `HarnessError` is a hard peerDependency already imported by the facade, so
// a top-level static import is safe here.
import { HarnessError } from '@deepseek-ai/dsh-llm'

// `@deepseek-ai/dsh-tools` is a peer-only package consumed lazily; the test
// resolves it dynamically and skips the real-identity assertions when it is
// unavailable, so a missing package can never crash this file at load time
//.
let dshTools = null
try {
  dshTools = await import('@deepseek-ai/dsh-tools')
} catch {
  dshTools = null
}
const canResolve = Boolean(dshTools && typeof dshTools.TOOL_ABORTED === 'string')

test(
  'official identity: instanceof real HarnessError, code === real TOOL_ABORTED, deep-equal to the real official composition',
  { skip: !canResolve },
  () => {
    const { TOOL_ABORTED } = dshTools
    const make = createToolAbortedErrorFactory({ HarnessError, TOOL_ABORTED })
    const error = make()

    assert.ok(error instanceof Error)
    assert.equal(error instanceof HarnessError, true)
    assert.equal(error.code, TOOL_ABORTED)
    assert.equal(error.code, 'ABORTED')
    assert.equal(error.name, 'AbortError')
    assert.equal(error.message, 'tool call aborted')

    // Canonical official composition with the real classes.
    const canonical = new HarnessError('tool call aborted', TOOL_ABORTED)
    canonical.name = 'AbortError'
    assert.deepEqual(
      { name: error.name, code: error.code, message: error.message },
      { name: canonical.name, code: canonical.code, message: canonical.message },
    )
  },
)
