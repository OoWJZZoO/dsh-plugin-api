/**
 * Tool bridge — faithful replication of the official
 * `@deepseek-ai/dsh-mcp-client` tool surface (official-contract parity), plus a small
 * catalog-facing metadata projector that does not change any official timing,
 * payload, return, disposer or error identity.
 *
 * Naming contract: every MCP tool has the stable identity `(serverName,
 * rawName)`; the model-facing public name is `mcp__<serverName>__<rawName>`
 * normalized to the DeepSeek function-name contract. The raw name is only ever
 * sent on the wire (`tools/call`); the public name is never parsed back.
 */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { assertSupportedJsonSchema } from '@deepseek-ai/dsh-tools'
import { ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js'

/** DeepSeek function-name contract: at most 64 characters. */
export const MAX_PUBLIC_NAME_LENGTH = 64
/** DeepSeek function-name contract: only `[A-Za-z0-9_-]` is allowed. */
export const INVALID_NAME_CHARS = /[^A-Za-z0-9_-]/g
/** Hex chars of the SHA-256 identity hash appended on lossy normalization. */
export const HASH_LENGTH = 12
/** Raw result record: the bridge owns JSON-value validation after transport. */
const RawCallToolResultSchema = z.record(z.string(), z.unknown())

/** List without mutating the SDK's per-page output-validator cache. */
export function listToolsUncached(client, cursor) {
  return client.request(
    {
      method: 'tools/list',
      ...(cursor === undefined ? {} : { params: { cursor } }),
    },
    ListToolsResultSchema,
  )
}

/** Call without the SDK pre-validating an output schema the bridge may not support. */
export function callToolUncached(client, rawName, args, exec, opts) {
  return client.request(
    {
      method: 'tools/call',
      params: { name: rawName, arguments: args },
    },
    RawCallToolResultSchema,
    { signal: exec.signal, timeout: opts.toolCallTimeoutMs },
  )
}

/**
 * Derive the model-facing public name for one MCP tool. Deterministic pure
 * function of `(serverName, rawName)`; lossy normalization or truncation
 * appends a 12-hex SHA-256 disambiguator so distinct identities never
 * collapse into one public name.
 */
export function publicToolName(serverName, rawName) {
  const joined = `mcp__${serverName}__${rawName}`
  const normalized = joined.replace(INVALID_NAME_CHARS, '_')
  if (normalized === joined && normalized.length <= MAX_PUBLIC_NAME_LENGTH) return normalized
  const hash = createHash('sha256')
    .update(`${serverName}\0${rawName}`)
    .digest('hex')
    .slice(0, HASH_LENGTH)
  return `${normalized.slice(0, MAX_PUBLIC_NAME_LENGTH - HASH_LENGTH - 1)}_${hash}`
}

/** Keep a supported advertised schema; unsupported MCP vocabulary falls back to JsonValue. */
export function supportedOutputSchema(candidate) {
  if (candidate === undefined) return undefined
  try {
    assertSupportedJsonSchema(candidate)
    return candidate
  } catch {
    return undefined
  }
}

/** Build the canonical result schema and existing Native text projection. */
export function createOutput(rawName, structuredSchema) {
  return {
    schema: {
      type: 'object',
      properties: {
        content: { type: 'array', items: {} },
        structuredContent: structuredSchema ?? {},
      },
      required: structuredSchema === undefined ? ['content'] : ['content', 'structuredContent'],
      additionalProperties: false,
    },
    render(_args, value) {
      return [{ type: 'text', text: extractText(value.content, rawName) }]
    },
  }
}

/**
 * Create an execute function for one MCP tool. The executor closes over the
 * raw MCP tool name and sends an uncached `tools/call` with it (never the
 * public name), with abort signal and timeout.
 *
 * Optional `opts.isCurrent` guards stale generations: when set, a successful
 * response arriving after the captured generation is no longer current is
 * rejected as unavailable so it can never publish into a newer generation.
 * With no `isCurrent` this behaves exactly like the official executor.
 */
export function createExecutor(client, rawName, taskRequired, opts) {
  const isCurrent = opts?.isCurrent ?? (() => true)
  return async (args, exec) => {
    if (taskRequired) {
      throw new Error(`Tool "${rawName}" requires task-based execution, which this bridge does not support`)
    }
    const result = await callToolUncached(
      client,
      rawName,
      typeof args === 'object' && args !== null ? args : {},
      exec,
      opts,
    )
    if (!isCurrent()) {
      throw new Error(`Tool "${rawName}": server generation is no longer current (disconnected or superseded)`)
    }
    if (!Array.isArray(result.content)) {
      const rendered = 'toolResult' in result ? JSON.stringify(result.toolResult) : '(no output)'
      const text = typeof rendered === 'string' ? rendered : '(no output)'
      if (result.isError === true) throw new Error(text)
      return {
        content: [{ type: 'text', text }],
        ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}),
      }
    }
    const content = result.content
    const text = extractText(content, rawName)
    if (result.isError === true) throw new Error(text)
    return {
      content,
      ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}),
    }
  }
}

/**
 * Extract text from an MCP content array into a single string. Defensive
 * fallbacks for required-nullable fields (network trust boundary).
 */
export function extractText(mcpContent, toolName) {
  const parts = []
  for (const value of mcpContent) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      parts.push('[unsupported content type: unknown]')
      continue
    }
    const block = value
    switch (block.type) {
      case 'text':
        if (block.text !== undefined) parts.push(block.text)
        break
      case 'image':
        parts.push(`[image: ${block.mimeType ?? 'unknown'}, content discarded]`)
        break
      case 'audio':
        parts.push(`[audio: ${block.mimeType ?? 'unknown'}, content discarded]`)
        break
      case 'resource':
      case 'resource_link':
        parts.push('[resource: content discarded]')
        break
      default:
        parts.push(`[unsupported content type: ${block.type}]`)
    }
  }
  return parts.join('\n') || `(${toolName} returned no text content)`
}

/**
 * Catalog-facing projection of one MCP tool's metadata. This is computed while
 * syncing but never changes how tools are registered or invoked.
 */
export function projectToolMeta(serverName, rawName, definition) {
  return {
    serverName,
    rawName,
    publicName: definition.name,
    description: definition.description || undefined,
  }
}

/** Classify an advertised schema as available/fallback/unavailable per the catalog contract. */
export function classifySchema(kind, candidate) {
  if (kind === 'input') {
    // An advertised input schema is used as-is; a missing one relies on the
    // official implicit default (tool still registers) -> fallback.
    return candidate !== undefined && candidate !== null ? 'available' : 'fallback'
  }
  if (candidate === undefined || candidate === null) return 'unavailable'
  return supportedOutputSchema(candidate) !== undefined ? 'available' : 'fallback'
}
