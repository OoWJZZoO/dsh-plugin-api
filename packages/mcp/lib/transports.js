/**
 * Transport helpers — faithful replication of the official
 * `@deepseek-ai/dsh-mcp-client` transport surface (official-contract parity).
 *
 * Stdio spawns a child process with a scrubbed environment; Streamable HTTP
 * connects to a URL. No behavior, shape or side effect is changed from the
 * locked official implementation.
 */
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

/**
 * The subprocess seam's scrubbed parent env (credential-shaped and stale
 * `DSH_*` names dropped), plus the spec's explicit env.
 */
export function buildChildEnv(extra) {
  return {
    ...scrubbedParentEnv(),
    ...extra,
  }
}

/**
 * Create an MCP transport from the resolved plugin config.
 * @param {object} config - Resolved plugin config discriminated on `transport`.
 * @returns {import('@modelcontextprotocol/sdk/types.js').Transport} stdio or Streamable HTTP
 */
export function createTransport(config) {
  switch (config.transport) {
    case 'stdio':
      return new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: buildChildEnv(config.env),
        cwd: config.cwd,
      })
    case 'streamable-http':
      return new StreamableHTTPClientTransport(new URL(config.url), {
        requestInit: { headers: config.headers },
      })
  }
}

/** Transport kind used for server catalog projection without secrets. */
export function transportKind(config) {
  return config.transport === 'streamable-http' ? 'streamable-http' : 'stdio'
}

/**
 * Normalized egress target descriptor for one transport attempt. HTTP uses the
 * resolved URL; stdio uses the executable/command descriptor. The destination
 * is the exact bound target the egress gate evaluates; redirects or reconnects
 * create a fresh transport and therefore re-evaluate.
 */
export function transportTarget(config) {
  if (config.transport === 'streamable-http') {
    return { kind: 'http', destination: typeof config.url === 'string' ? config.url : '' }
  }
  return { kind: 'subprocess', destination: typeof config.command === 'string' ? config.command : '' }
}
