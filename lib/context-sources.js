/**
 * Context provenance source adapters — the facade's view of the seams that
 * produce contribution provenance.
 *
 * Each adapter answers two questions:
 * - `status()`: is the seam currently reachable ('available' | 'degraded' |
 *   'unavailable')? Soft sources degrade per-source at mount/query time and
 *   never disable the facade feature (design failure paths).
 * - optional seam capabilities: `verifySeqBounds` (session surface seq
 *   honesty), evidence subscription (assembled-context evidence from the
 *   agent-loop replacement slice), compaction mapping intake (delivered
 *   compaction events vocabulary).
 *
 * Transport discipline: every listener is contained (a listener failure is
 * swallowed and attributed) so a broken source can never interrupt dispatch
 * or escape apply. The facade never synthesizes sequence numbers or
 * provenance the seam did not provide.
 */
import { COMPACTION_EVENTS_CONTRACT_SYMBOL } from './compaction-events-catalog.js'
import { normalizeSkillExposureRecord } from './context-normalize.js'

const COMPACTION_COMPLETED = 'compaction/completed'

function isPlainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function safeStatus(adapter) {
  try {
    if (adapter && typeof adapter.status === 'function') {
      const value = adapter.status()
      return value === 'available' || value === 'degraded' ? value : 'unavailable'
    }
  } catch {
    return 'unavailable'
  }
  return 'unavailable'
}

function hasSystemPromptShape(service) {
  return Boolean(
    service
    && typeof service.section === 'function'
    && typeof service.context === 'function'
    && typeof service.variable === 'function'
    && typeof service.tools === 'function'
    && typeof service.suppressRuntimeContext === 'function',
  )
}

/**
 * Build the seven source adapters plus the assembled-evidence adapter.
 *
 * @param {object} options
 * @param {object} options.ctx - the host plugin's cordis context (raw event
 *   subscriptions for R-row self-emitted events follow the events-bus
 *   precedent: `ctx.on` receives root emissions).
 * @param {object} options.service - the pluginApi facade service (slot reads
 *   for delivered projections).
 * @param {object} options.featureRegistry - feature state registry
 *   (`isActive(name)`).
 * @param {Function} options.renderContextSnapshot - official helper or null.
 * @param {Function} options.joinContextSections - official helper or null.
 * @param {string} [options.evidenceEventName] - R-row self-emitted event name.
 * @param {() => boolean} options.evidenceActive - marker/version gate for the
 *   evidence slice (injected by the mount).
 * @param {(payload: unknown) => void} options.onEvidence - forwards raw
 *   evidence payloads to the engine intake (engine normalizes).
 * @param {(mapping: object) => void} options.onMapping - forwards derived
 *   compaction replacement mappings to the engine.
 * @param {(message: string) => void} [options.reportDiagnostics]
 * @param {() => Date} [options.now]
 */
export function createContextSources({
  ctx,
  service,
  featureRegistry,
  renderContextSnapshot = null,
  joinContextSections = null,
  evidenceEventName = 'agent-loop/assembled-context',
  evidenceActive = () => false,
  onEvidence = () => {},
  onMapping = () => {},
  reportDiagnostics = () => {},
  now = () => new Date(),
} = {}) {
  const report = (owner, detail) => {
    try {
      reportDiagnostics(owner, detail)
    } catch {
      // diagnostics must never change adapter outcomes
    }
  }

  // --- systemPrompt: semantic passthrough over the official service + helpers
  const systemPromptStatus = () => {
    let service
    try {
      service = typeof ctx?.get === 'function' ? ctx.get('systemPrompt') : undefined
    } catch {
      service = undefined
    }
    if (!hasSystemPromptShape(service)) return 'unavailable'
    if (typeof renderContextSnapshot !== 'function' || typeof joinContextSections !== 'function') return 'degraded'
    return 'available'
  }
  const systemPrompt = Object.freeze({
    status: systemPromptStatus,
    renderContextSnapshot: (assembly) => {
      if (typeof renderContextSnapshot !== 'function') return undefined
      let rendered
      try {
        rendered = renderContextSnapshot(assembly)
      } catch {
        rendered = undefined
      }
      return rendered
    },
    joinContextSections: (sections) => {
      if (typeof joinContextSections !== 'function') return undefined
      let joined
      try {
        joined = joinContextSections(sections)
      } catch {
        joined = undefined
      }
      return joined
    },
  })

  // --- sessionSurface: bounded seq verification against the live session
  const sessionsStatus = () => {
    let sessions
    try {
      sessions = typeof ctx?.get === 'function' ? ctx.get('sessions') : undefined
    } catch {
      sessions = undefined
    }
    return Boolean(sessions && typeof sessions.get === 'function' && typeof sessions.list === 'function')
  }
  const sessionSurface = Object.freeze({
    status: () => (sessionsStatus() ? 'available' : 'unavailable'),
    verifySeqBounds: (sessionId, seqs) => {
      if (!Array.isArray(seqs)) return { ok: false, outOfRange: [] }
      let session
      try {
        const sessions = typeof ctx?.get === 'function' ? ctx.get('sessions') : undefined
        session = typeof sessions?.get === 'function' ? sessions.get(sessionId) : undefined
      } catch {
        session = undefined
      }
      if (!session || !Array.isArray(session.events)) return { ok: false, outOfRange: [] }
      let maxSeq = -1
      for (const event of session.events) {
        if (typeof event?.seq === 'number' && event.seq > maxSeq) maxSeq = event.seq
      }
      const outOfRange = seqs.filter((seq) => seq > maxSeq)
      return outOfRange.length === 0 ? { ok: true } : { ok: false, outOfRange }
    },
  })

  // --- attachment: consumption of the delivered attachment-pipeline projection
  const attachment = Object.freeze({
    status: () => {
      try {
        const availability = service?.attachments?.availability
        if (typeof availability !== 'function') return 'unavailable'
        const value = availability()
        if (value === null || value === undefined) return 'unavailable'
        if (isPlainRecord(value) && (value.status === 'unavailable' || value.commitState === 'error')) return 'unavailable'
        return 'available'
      } catch {
        return 'unavailable'
      }
    },
  })

  // --- toolExposure: consumption of the delivered tool-discovery projection
  const toolExposure = Object.freeze({
    status: () => {
      try {
        return featureRegistry?.isActive?.('toolDiscovery') === true ? 'available' : 'unavailable'
      } catch {
        return 'unavailable'
      }
    },
  })

  // --- skillExposure: consumption of the frozen skill-exposure record vocabulary.
  // The exposure records keep their frozen vocabulary; this adapter reports
  // seam reachability and validates/normalizes records against the frozen
  // shape (never re-implements activation lifecycle).
  const skillExposure = Object.freeze({
    status: () => {
      try {
        return featureRegistry?.isActive?.('skillsActivation') === true ? 'available' : 'unavailable'
      } catch {
        return 'unavailable'
      }
    },
    normalize: (record) => {
      try {
        return normalizeSkillExposureRecord(record)
      } catch {
        return { ok: false, problems: [{ field: 'record', reason: 'unreadable exposure record' }] }
      }
    },
  })

  // --- compaction: mapping intake over the delivered compaction events
  let compactionDisposer = null
  const compactionStatus = () => {
    let service
    try {
      service = typeof ctx?.get === 'function' ? ctx.get('compaction') : undefined
    } catch {
      service = undefined
    }
    return service?.[COMPACTION_EVENTS_CONTRACT_SYMBOL] === true ? 'available' : 'unavailable'
  }
  const compaction = Object.freeze({
    status: compactionStatus,
  })

  function deriveCompactionMapping(payload) {
    const session = payload?.session
    const result = payload?.result
    const sessionId = typeof session?.id === 'string' && session.id.length > 0
      ? session.id
      : typeof payload?.agent?.session?.id === 'string' ? payload.agent.session.id : undefined
    if (sessionId === undefined || !isPlainRecord(result) || typeof result.compactionId !== 'string') return null
    const shadowedSeqs = Array.isArray(result.shadowedSeqs) ? result.shadowedSeqs.filter((seq) => typeof seq === 'number') : []
    if (shadowedSeqs.length === 0) return null
    let observedAt
    try {
      observedAt = now() instanceof Date ? now().toISOString() : new Date().toISOString()
    } catch {
      observedAt = new Date().toISOString()
    }
    // Node ids are owner-scoped; the engine resolves the shadowed seq ranges
    // to registered session-surface node ids (never fabricated). `newNodeId`
    // references the official compaction artifact only.
    return {
      sessionId,
      seqs: shadowedSeqs,
      newNodeId: `compaction:${result.compactionId}`,
      reason: 'compacted',
      generation: result.compactionId,
      observedAt,
    }
  }

  function installCompactionIntake() {
    if (compactionDisposer) return
    let disposer
    try {
      disposer = ctx.on(COMPACTION_COMPLETED, (payload) => {
        let mapping
        try {
          mapping = deriveCompactionMapping(payload)
        } catch (error) {
          report('<compaction>', `compaction mapping derivation failed: ${error?.message ?? error}`)
          return
        }
        if (mapping === null) return
        try {
          onMapping(mapping)
        } catch (error) {
          report('<compaction>', `compaction mapping intake failed: ${error?.message ?? error}`)
        }
      })
    } catch (error) {
      report('<compaction>', `compaction intake subscription failed: ${error?.message ?? error}`)
      disposer = null
    }
    compactionDisposer = disposer
  }

  // --- assembledEvidence: R-row evidence transport for the sent slice
  let evidenceDisposer = null
  const evidenceActiveValue = () => {
    try {
      return evidenceActive() === true
    } catch {
      return false
    }
  }
  const evidence = Object.freeze({
    status: () => (evidenceActiveValue() ? 'available' : 'unavailable'),
  })

  function installEvidenceIntake() {
    if (evidenceDisposer) return
    let disposer
    try {
      disposer = ctx.on(evidenceEventName, (payload) => {
        try {
          onEvidence(payload)
        } catch (error) {
          report('<assembled-evidence>', `evidence intake failed: ${error?.message ?? error}`)
        }
      })
    } catch (error) {
      report('<assembled-evidence>', `evidence subscription failed: ${error?.message ?? error}`)
      disposer = null
    }
    evidenceDisposer = disposer
  }

  const sources = Object.freeze({
    systemPrompt,
    sessionSurface,
    attachment,
    toolExposure,
    skillExposure,
    compaction,
    memory: Object.freeze({ status: () => 'available' }),
  })

  const api = Object.freeze({
    sources,
    evidence,
    availability() {
      const result = { sources: {} }
      for (const key of Object.keys(sources)) result.sources[key] = safeStatus(sources[key])
      result.sources.assembledEvidence = evidence.status()
      result.sentReachable = evidence.status() === 'available'
      return Object.freeze(result)
    },
    install() {
      installCompactionIntake()
      installEvidenceIntake()
    },
    dispose() {
      const release = (disposer) => {
        try {
          if (typeof disposer === 'function') disposer()
        } catch {
          // best-effort detach
        }
      }
      release(compactionDisposer)
      release(evidenceDisposer)
      compactionDisposer = null
      evidenceDisposer = null
    },
  })

  return api
}