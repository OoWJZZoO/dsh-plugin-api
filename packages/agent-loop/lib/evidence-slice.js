/**
 * Assembled-context evidence slice — evidence-only emission at the agent-loop
 * render/dispatch boundary.
 *
 * The slice observes the forked loop's assembly at the equivalent of the
 * official `renderPrompt` call site and emits one frozen identifiers-only
 * payload per dispatch: which prompt sections/contexts actually rendered into
 * the request, which messages (seq ranges) were derived from the session
 * surface, and which sections were dropped because they rendered empty.
 *
 * Evidence-only iron rule: this module NEVER alters assembly, ordering, or
 * loop decisions; any emission failure is swallowed and attributed, so the
 * model request itself is never affected.
 */
import { deepFreeze } from '@deepseek-ai/dsh-llm'

/** Neutral event name of the R-row self-emitted evidence (raw ctx emission). */
export const ASSEMBLED_CONTEXT_EVENT = 'agent-loop/assembled-context'

/** Capability marker published on the forked agent-loop service instance. */
export const EVIDENCE_ACTIVE_SYMBOL = Symbol.for('dsh-plugin-api.agent-loop.assembled-evidence')

/**
 * Interpolate one prompt section/context the way the official renderer does:
 * strict `{{name}}` references, a lone `{{` without a closing group stays
 * literal, substituted values are not scanned again. Returns the rendered
 * text. Undefined variable values render as empty and are attributed as
 * dropped (at the emission point the official render already succeeded, so
 * this is defensive only).
 */
export function interpolateSection(input, variables) {
  const names = variables ?? {}
  let result = ''
  let last = 0
  let open = input.indexOf('{{')
  while (open >= 0) {
    const close = input.indexOf('}}', open + 2)
    if (close < 0) {
      result += input.slice(last)
      return result
    }
    const name = input.slice(open + 2, close).trim()
    if (name.length === 0 || !/^[a-z][a-z0-9_]*$/.test(name)) {
      result += input.slice(last, close + 2)
    } else if (!Object.hasOwn(names, name) || names[name] === undefined) {
      return ''
    } else {
      result += input.slice(last, open) + names[name]
    }
    last = close + 2
    open = input.indexOf('{{', last)
  }
  result += input.slice(last)
  return result
}

function isoNow(now) {
  try {
    const value = now()
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
  } catch {
    return new Date().toISOString()
  }
}

/**
 * Derive the message seq ranges that the session surface actually projected
 * into the dispatch boundary (the same per-node rule `deriveMessages` folds).
 *
 * @param {object} session - official Session instance (public `surface.nodes`,
 *   `events`, and `deriveEventMessage(event)`).
 * @returns {Array<{fromSeq: number, toSeq: number, count: number}>}
 */
export function deriveMessageRanges(session) {
  const nodes = Array.isArray(session?.surface?.nodes) ? session.surface.nodes : []
  const events = Array.isArray(session?.events) ? session.events : []
  const bySeq = new Map()
  for (const event of events) {
    if (typeof event?.seq === 'number') bySeq.set(event.seq, event)
  }
  const messageSeqs = []
  for (const seq of nodes) {
    if (typeof seq !== 'number') continue
    const event = bySeq.get(seq)
    let message = null
    try {
      message = typeof session.deriveEventMessage === 'function' ? session.deriveEventMessage(event) : null
    } catch {
      message = null
    }
    if (message !== null) messageSeqs.push(seq)
  }
  messageSeqs.sort((a, b) => a - b)
  const ranges = []
  for (const seq of messageSeqs) {
    const last = ranges[ranges.length - 1]
    if (last && last.toSeq + 1 === seq) {
      last.toSeq = seq
      last.count += 1
    } else {
      ranges.push({ fromSeq: seq, toSeq: seq, count: 1 })
    }
  }
  return ranges
}

/**
 * Build one frozen assembled-context evidence payload. Identifiers/seq
 * ranges/reasons only — never content, never secret values.
 *
 * @param {object} input
 * @param {object} input.assembly - the rendered prompt assembly
 *   (`sections: [{name,text}], contexts: [{name,text}], variables`).
 * @param {object} input.session - official Session instance.
 * @param {number} input.generation - owner-specific per-session assembly
 *   sequence (opaque to consumers, ascending within one session).
 * @param {() => Date} [input.now]
 * @returns {object} frozen payload
 */
export function buildAssembledEvidence({ assembly, session, generation, now = () => new Date() } = {}) {
  const sessionId = typeof session?.id === 'string' ? session.id : undefined
  if (sessionId === undefined) return null
  const sections = Array.isArray(assembly?.sections) ? assembly.sections : []
  const contexts = Array.isArray(assembly?.contexts) ? assembly.contexts : []
  const variables = assembly?.variables ?? {}
  const systemSections = []
  const dropped = []
  const visit = (entries, sourceTag) => {
    for (const entry of entries) {
      const key = typeof entry?.name === 'string' ? entry.name : undefined
      if (key === undefined) continue
      const text = String(entry.text ?? '')
      let rendered
      if (text.indexOf('{{') < 0) {
        rendered = text
      } else {
        try {
          rendered = interpolateSection(text, variables)
        } catch {
          rendered = ''
        }
      }
      if (rendered.length > 0) {
        systemSections.push({ sectionKey: key, sourceTags: sourceTag.length > 0 ? sourceTag : [] })
      } else {
        dropped.push({ ref: key, reason: 'rendered-empty' })
      }
    }
  }
  visit(sections, [])
  visit(contexts, [])
  const payload = {
    sessionId,
    generation,
    systemSections,
    messageRanges: deriveMessageRanges(session),
    dropped,
    observedAt: isoNow(now),
  }
  return deepFreeze(payload)
}

/**
 * Emit one evidence payload on the loop context. Everything is contained:
 * a payload/emission failure is swallowed and attributed and can never affect
 * the model request (evidence-only iron rule).
 *
 * @param {object} input
 * @param {object} input.loopCtx - agent-loop runtime context (root-level).
 * @param {object} input.session - official Session instance.
 * @param {object} input.assembly - the rendered prompt assembly.
 * @param {number} input.generation
 * @param {() => Date} [input.now]
 * @param {(message: string) => void} [input.log]
 * @returns {object | null} the emitted frozen payload, or null when emission
 *   was not possible.
 */
export function emitAssembledEvidence({ loopCtx, session, assembly, generation, now = () => new Date(), log = () => {} }) {
  let payload
  try {
    payload = buildAssembledEvidence({ assembly, session, generation, now })
  } catch (error) {
    try {
      log(`plugin-api-agent-loop: assembled-context evidence build failed; skipped: ${error?.name ?? 'Error'}`)
    } catch {
      // diagnostics never change loop behavior
    }
    return null
  }
  if (payload === null) return null
  try {
    if (typeof loopCtx?.emit === 'function') loopCtx.emit(ASSEMBLED_CONTEXT_EVENT, payload)
  } catch (error) {
    try {
      log(`plugin-api-agent-loop: assembled-context evidence emission failed; skipped: ${error?.name ?? 'Error'}`)
    } catch {
      // diagnostics never change loop behavior
    }
    return null
  }
  return payload
}