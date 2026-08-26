/**
 * Catalog digest/delta primitives for the forked tool-skill catalog path.
 *
 * The official digest/history semantics are reproduced verbatim (see
 * `@deepseek-ai/dsh-tool-skill`): the digest covers the durable entry list
 * `[name, description]`, not the rendered prose; unreadable catalog sources
 * are ignored rather than thrown. On top of that, delta computation and the
 * bounded English minimal-update notice lines are provided (used only when a
 * per-session minimal update policy is registered).
 *
 * Zero harness dependencies.
 */

import { createHash } from 'node:crypto'
import { escapeText } from '@deepseek-ai/dsh-skill'

/** Summary bound used inside minimal-update notice lines. */
export const NOTICE_SUMMARY_MAX = 200

/**
 * Normalized, length-bounded description exactly as the catalog publishes it
 * (unescaped). Verbatim reproduction of the official helper.
 * @param {string} value
 * @param {number} maxLength
 * @returns {string}
 */
export function catalogDescription(value, maxLength) {
  const normalized = value.replaceAll(/\s+/g, ' ').trim()
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3)}...`
}

/**
 * Catalog identity over the durable entry list. Verbatim reproduction of the
 * official helper.
 * @param {Array<{name: string, description: string}>} entries
 * @returns {string}
 */
export function digestCatalogEntries(entries) {
  const canonical = entries.map((entry) => JSON.stringify([entry.name, entry.description])).join('\n')
  return createHash('sha256').update(canonical).digest('hex')
}

/**
 * Readable entries of one durable catalog message source, or undefined when
 * the record is not usable. Verbatim reproduction of the official helper
 * (the fork accepts both `skill-catalog` and `skill-catalog-update` sources;
 * the reader itself only needs the shared `entries` field).
 * @param {unknown} source
 * @returns {Array<{name: string, description: string}> | undefined}
 */
export function readCatalogEntries(source) {
  const entries = source?.entries
  if (!Array.isArray(entries)) return undefined
  const readable = []
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) return undefined
    const { name, description } = entry
    if (typeof name !== 'string' || name === '' || typeof description !== 'string') return undefined
    readable.push({ name, description })
  }
  return readable
}

/**
 * One model-facing catalog line. Verbatim reproduction of the official
 * rendering (pseudo-XML escaping belongs to this frame, never to the stored
 * entries).
 * @param {{name: string, description: string}} entry
 * @returns {string}
 */
export function renderCatalogLine(entry) {
  return `- \`${entry.name}\`: ${escapeText(entry.description)}`
}

/**
 * Entry-set difference by name. `changed` entries carry the current
 * description as their new shape summary.
 * @param {Array<{name: string, description: string}>} previous
 * @param {Array<{name: string, description: string}>} current
 * @returns {{ added: Array<{name: string, summary: string}>, removed: Array<{name: string}>, changed: Array<{name: string, summary: string}> }}
 */
export function buildDelta(previous, current) {
  const currentByName = new Map(current.map((entry) => [entry.name, entry]))
  const previousByName = new Map(previous.map((entry) => [entry.name, entry]))
  const added = []
  const removed = []
  const changed = []
  for (const [name, entry] of currentByName) {
    const prior = previousByName.get(name)
    if (prior === undefined) {
      added.push({ name, summary: entry.description })
    } else if (prior.description !== entry.description) {
      changed.push({ name, summary: entry.description })
    }
  }
  for (const [name] of previousByName) {
    if (!currentByName.has(name)) removed.push({ name })
  }
  return { added, removed, changed }
}

/**
 * Aggregate the English minimal-update notice lines for one digest revision
 * (aligned with the DSH prompt conventions; one line per skill). Returns null
 * when nothing effectively changed. Changed-form summaries use the catalog
 * description shape, additionally clamped to the notice summary bound.
 * @param {{ added: Array<{name: string, summary: string}>, removed: Array<{name: string}>, changed: Array<{name: string, summary: string}> }} delta
 * @param {number} maxDescriptionLength
 * @returns {Array<string> | null}
 */
export function aggregateNotices(delta, maxDescriptionLength) {
  const clamp = Math.min(maxDescriptionLength, NOTICE_SUMMARY_MAX)
  const lines = []
  for (const entry of delta.removed) lines.push(`Skill \`${entry.name}\` has been removed`)
  for (const entry of delta.added) {
    lines.push(`Skill \`${entry.name}\` has been added`)
  }
  for (const entry of delta.changed) {
    lines.push(`Skill \`${entry.name}\` has changed; its new shape is: \`${catalogDescription(entry.summary, clamp)}\``)
  }
  return lines.length === 0 ? null : lines
}