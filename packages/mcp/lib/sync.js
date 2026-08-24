/**
 * Tool synchronization — faithful replication of the official
 * `@deepseek-ai/dsh-mcp-client` `syncTools` official-contract parity, with an optional
 * catalog-facing collector that runs only after a complete generation has been
 * registered. The collector never changes official timing, payload, return,
 * disposal or error identity.
 */
import { listToolsUncached, publicToolName, supportedOutputSchema, createOutput, createExecutor } from './tools.js'

/**
 * Sync the MCP server's tool list into the harness ToolRuntime.
 *
 * Two phases keep the swap safe:
 * 1. Fetch: drain uncached `tools/list` pagination and build the full next
 *    generation of tool definitions under public names. Any failure here
 *    rejects and leaves the previous generation registered untouched.
 * 2. Swap: dispose the previous generation, register the new one. A registry
 *    conflict rolls the partial generation back (zero tools from this server)
 *    and is logged.
 *
 * @param {object} client - Connected MCP Client used to list and call tools.
 * @param {object} ctx - Cordis context providing the `tools` service.
 * @param {{ serverName: string, toolCallTimeoutMs: number, registrationFailure: string }} opts
 * @param {Map} previous - Disposer map from the prior sync generation.
 * @param {(tools: Array) => void} [collector] - Catalog metadata callback after a
 *   full generation is successfully registered. Called with the meta array for
 *   the newly current generation; only on success.
 * @returns {Promise<Map>} registered public tool name → unregister disposers.
 */
export async function syncTools(client, ctx, opts, previous, collector) {
  const definitions = new Map()
  const metas = []
  let cursor
  do {
    const response = await listToolsUncached(client, cursor)
    for (const tool of response.tools) {
      const publicName = publicToolName(opts.serverName, tool.name)
      if (definitions.has(publicName)) {
        throw new Error(`mcp-client(${opts.serverName}): server listed tool "${tool.name}" more than once — invalid tool list`)
      }
      const outputSchema = supportedOutputSchema(tool.outputSchema)
      definitions.set(publicName, {
        name: publicName,
        description: tool.description ?? '',
        parameters: tool.inputSchema,
        output: createOutput(tool.name, outputSchema),
        execute: createExecutor(client, tool.name, tool.execution?.taskSupport === 'required', opts),
      })
      metas.push({
        serverName: opts.serverName,
        rawName: tool.name,
        publicName,
        description: tool.description != null && tool.description !== '' ? tool.description : undefined,
        inputSchema:
          tool.inputSchema !== undefined && tool.inputSchema !== null ? 'available' : 'fallback',
        outputSchema:
          outputSchema !== undefined
            ? 'available'
            : tool.outputSchema !== undefined
              ? 'fallback'
              : 'unavailable',
      })
    }
    cursor = response.nextCursor
  } while (cursor)

  for (const dispose of previous.values()) {
    try {
      dispose()
    } catch {
      // disposal of an old generation must never block the swap
    }
  }

  const disposers = new Map()
  try {
    for (const [publicName, definition] of definitions) {
      disposers.set(publicName, ctx.tools.register(definition))
    }
  } catch (error) {
    for (const dispose of disposers.values()) {
      try {
        dispose()
      } catch {
        // rollback must never throw
      }
    }
    ctx.logger.error(`mcp-client(${opts.serverName}): tool registration failed, no tools registered: ${String(error)}`)
    if (opts.registrationFailure === 'throw') throw error
    return new Map()
  }

  collector?.(metas)
  return disposers
}
