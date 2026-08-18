/**
 * Host mechanics for the session durable capability.
 *
 * This module intentionally has no ambient-session lookup. Every imperative
 * operation begins with an explicit live target validated against the injected
 * public Session constructor and sessions service.
 */
import { isDurableEventType } from './session-durable-catalog.js'

function warn(logger, message) {
  try {
    logger?.warn?.(message)
  } catch {
    // fail-safe cleanup must not depend on logging
  }
}

function invalidTargetSession() {
  const error = new TypeError('invalid target session')
  error.code = 'invalid-target-session'
  return error
}

function isNonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0
}

/**
 * Validates the sole explicit live-session identity accepted by durable APIs.
 *
 * @param {unknown} targetSession
 * @param {{ Session?: unknown, sessions?: unknown, requireAppend?: boolean }} [options]
 * @returns {object}
 */
export function assertLiveSessionTarget(targetSession, { Session, sessions, requireAppend = false } = {}) {
  try {
    if (typeof Session !== 'function' || !(targetSession instanceof Session)) throw invalidTargetSession()
    if (!isNonNegativeSafeInteger(targetSession.firstLiveSeq)) throw invalidTargetSession()
    if (requireAppend && typeof targetSession.append !== 'function') throw invalidTargetSession()
    if (!sessions || typeof sessions.get !== 'function' || sessions.get(targetSession.id) !== targetSession) {
      throw invalidTargetSession()
    }
    return targetSession
  } catch (error) {
    if (error?.code === 'invalid-target-session') throw error
    throw invalidTargetSession()
  }
}

/**
 * Owns durable observer registrations for one published capability epoch.
 *
 * @param {{ warn?: (message: string) => void }} [options]
 */
export function createDurableEpochRegistrationOwner({ logger } = {}) {
  let current = true
  const disposers = new Set()

  return {
    isCurrent() {
      return current
    },

    /** @param {unknown} underlyingDisposer */
    own(underlyingDisposer) {
      if (typeof underlyingDisposer !== 'function' || !current) return () => false
      let disposed = false
      const dispose = () => {
        if (disposed) return false
        disposed = true
        disposers.delete(dispose)
        try {
          underlyingDisposer()
        } catch {
          warn(logger, 'dsh-plugin-api session durable: observer disposal failed')
        }
        return true
      }
      disposers.add(dispose)
      return dispose
    },

    close() {
      if (!current) return false
      current = false
      const pending = [...disposers]
      disposers.clear()
      for (const dispose of pending) dispose()
      return true
    },
  }
}

/**
 * A service-lifetime native `session/event` subscription. Epochs own only
 * private observer entries, so a contract breach never mutates the events bus
 * while that bus is dispatching the native event.
 */
export function createDurableObservationHub({ eventsApi, logger } = {}) {
  let currentEpoch = null
  let closed = false
  const nativeDisposer = typeof eventsApi?.on === 'function'
    ? eventsApi.on('session/event', (session, event) => dispatch(session, event))
    : null

  function detach(epoch, diagnostic) {
    if (currentEpoch !== epoch || epoch.state !== 'active') return false
    currentEpoch = null
    epoch.state = 'breached'
    epoch.entries.clear()
    try { epoch.owner?.close?.() } catch { warn(logger, 'dsh-plugin-api session durable: epoch cleanup failed') }
    safelyReset(epoch.reset, diagnostic.reason, diagnostic.kind, diagnostic.seq)
    return true
  }

  function dispatch(session, event) {
    const epoch = currentEpoch
    if (!epoch || epoch.state !== 'active') return
    let kind
    let seq
    try {
      kind = event.type
      seq = event.seq
    } catch {
      detach(epoch, { kind: undefined, seq: undefined, reason: 'durable-record-contract-breach' })
      return
    }
    // Ordinary M1 session events are outside the finite durable vocabulary;
    // they are intentionally ignored even when this epoch has observers.
    if (!isDurableEventType(kind)) return
    const entries = [...epoch.entries.values()].filter((entry) => entry.targetSession === session && entry.kind === kind)
    try {
      assertLiveSessionTarget(session, { Session: epoch.Session, sessions: epoch.sessions })
    } catch {
      detach(epoch, { kind, seq, reason: 'durable-record-contract-breach' })
      return
    }
    if (!Number.isSafeInteger(seq) || seq < session.firstLiveSeq) {
      detach(epoch, { kind, seq, reason: 'seed-or-invalid-live-seq' })
      return
    }
    let valid = false
    try { valid = epoch.contracts.isAuditedDurableRecord(kind, event) } catch {}
    if (!valid) {
      detach(epoch, { kind, seq, reason: 'durable-record-contract-breach' })
      return
    }
    if (entries.length === 0) return
    for (const entry of entries) {
      if (currentEpoch !== epoch || epoch.state !== 'active' || !epoch.entries.has(entry.token)) break
      if (entry.once) epoch.entries.delete(entry.token)
      try {
        const result = entry.listener(event)
        if (result && typeof result.then === 'function') {
          Promise.resolve(result).catch(() => warn(logger, 'dsh-plugin-api session durable: observer listener failed'))
        }
      } catch {
        warn(logger, 'dsh-plugin-api session durable: observer listener failed')
      }
    }
  }

  return {
    attachEpoch({ Session, sessions, contracts, owner, reset } = {}) {
      if (closed || currentEpoch) return null
      const epoch = { Session, sessions, contracts, owner, reset, state: 'active', entries: new Map() }
      currentEpoch = epoch
      return epoch
    },
    subscribe(epoch, once, targetSession, kind, listener) {
      if (currentEpoch !== epoch || epoch?.state !== 'active') return () => false
      const token = {}
      const entry = { token, once, targetSession, kind, listener }
      epoch.entries.set(token, entry)
      let disposed = false
      return () => {
        if (disposed) return false
        disposed = true
        return epoch.entries.delete(token)
      }
    },
    closeEpoch(epoch) {
      if (currentEpoch !== epoch) return false
      currentEpoch = null
      epoch.state = 'closed'
      epoch.entries.clear()
      try { epoch.owner?.close?.() } catch { warn(logger, 'dsh-plugin-api session durable: epoch cleanup failed') }
      return true
    },
    get currentEpoch() { return currentEpoch },
    get nativeDisposer() { return nativeDisposer },
  }
}

function invalidArgument(code, message) {
  const error = new TypeError(message)
  error.code = code
  return error
}

/**
 * Creates the active O8/O13/O14 observer facade for one durable epoch.
 *
 * @param {object} options
 * @param {object} options.Session
 * @param {object} options.sessions
 * @param {{ on: (name: string, listener: Function) => Function }} options.eventsApi
 * @param {{ available: boolean, isAuditedDurableRecord: Function }} options.contracts
 * @param {{ isCurrent: () => boolean, own: (disposer: Function) => Function }} options.owner
 * @param {(diagnostic: { kind: string, seq: unknown, reason: string }) => void} options.reset
 */
export function createSessionDurableApi({ Session, sessions, eventsApi, contracts, owner, reset, hub } = {}) {
  const hubEpoch = hub?.attachEpoch?.({ Session, sessions, contracts, owner, reset })
  const subscribe = (once, targetSession, kind, listener) => {
    assertLiveSessionTarget(targetSession, { Session, sessions })
    if (!contracts?.available || typeof contracts.isAuditedDurableRecord !== 'function' || !contracts.isAuditedDurableRecord(kind, { type: kind, seq: 0, time: 0, data: minimalPayloadFor(kind) })) {
      throw invalidArgument('unsupported-durable-kind', 'unsupported durable kind')
    }
    if (typeof listener !== 'function') throw invalidArgument('invalid-listener', 'invalid durable listener')
    if (!owner?.isCurrent?.()) return () => false
    if (hubEpoch) return hub.subscribe(hubEpoch, once, targetSession, kind, listener)
    if (typeof eventsApi?.on !== 'function') return () => false

    let done = false
    let dispose = () => false
    const wrapper = (publishedSession, event) => {
      if (!owner.isCurrent() || done || publishedSession !== targetSession) return
      let eventType
      let eventSeq
      try {
        eventType = event.type
        eventSeq = event.seq
      } catch {
        safelyReset(reset, 'durable-record-contract-breach', kind, undefined)
        return
      }
      if (eventType !== kind) return
      if (!Number.isSafeInteger(eventSeq) || eventSeq < targetSession.firstLiveSeq) {
        safelyReset(reset, 'seed-or-invalid-live-seq', kind, eventSeq)
        return
      }
      let validRecord
      try {
        validRecord = contracts.isAuditedDurableRecord(kind, event)
      } catch {
        validRecord = false
      }
      if (!validRecord) {
        safelyReset(reset, 'durable-record-contract-breach', kind, eventSeq)
        return
      }
      if (once) {
        done = true
        dispose()
      }
      return listener(event)
    }
    dispose = owner.own(eventsApi.on('session/event', wrapper))
    return dispose
  }

  return {
    _hubEpoch: hubEpoch,
    onDurable(targetSession, kind, listener) {
      return subscribe(false, targetSession, kind, listener)
    },
    onceDurable(targetSession, kind, listener) {
      return subscribe(true, targetSession, kind, listener)
    },
  }
}

function safelyReset(reset, reason, kind, seq) {
  try {
    reset?.({ kind, seq, reason })
  } catch {
    // observer contract breach must never escape the S1 contained callback
  }
}

function preflightError(code, message) {
  const error = new TypeError(message)
  error.code = code
  return error
}

/**
 * Validates the finite S2 append contract without writing to the session.
 *
 * @param {object} targetSession
 * @param {unknown} kind
 * @param {unknown} borrowedPayload
 * @param {unknown} options
 * @param {{ snapshotJsonValue?: Function, surfaceMessageContracts?: object }} contracts
 */
export function preflightSurfaceMessageAppend(targetSession, kind, borrowedPayload, options, contracts, logger) {
  const contract = contracts?.surfaceMessageContracts?.[kind]
  if (!contract) throw preflightError('unsupported-surface-message-kind', 'unsupported surface message kind')

  let payload
  try {
    payload = contracts.snapshotJsonValue(borrowedPayload)
  } catch {
    throw preflightError('non-json-payload', 'surface message payload is not lossless JSON')
  }
  try {
    if (payload === undefined || !isPlainRecord(payload) || !isSurfaceMessagePayload(kind, payload)) {
      throw preflightError('non-json-payload', 'surface message payload is invalid')
    }
  } catch (error) {
    if (error?.code === 'non-json-payload') throw error
    throw preflightError('non-json-payload', 'surface message payload is invalid')
  }

  let supplied
  try {
    if (!isOptions(options)) throw preflightError('invalid-options', 'surface message options are invalid')
    supplied = sourceEventSeqsOf(options)
  } catch (error) {
    if (error?.code) throw error
    throw preflightError('invalid-options', 'surface message options are invalid')
  }

  if (kind === 'user/message') {
    if (supplied !== undefined) throw preflightError('invalid-source-event-seqs', 'user messages cannot have provenance')
    return { payload, intent: { surfaceOp: 'append' } }
  }

  try {
    const events = targetSession.events
    if (!Array.isArray(events)) throw new Error('invalid events snapshot')
    const sourceEventSeqs = resolveSourceEventSeqs(kind, payload, supplied, events)
    return { payload, intent: { surfaceOp: 'append', sourceEventSeqs } }
  } catch (error) {
    if (error?.code) throw error
    warn(logger, 'dsh-plugin-api session durable: surface message provenance inspection failed')
    throw preflightError('indeterminate-source-event-seqs', 'surface message provenance is indeterminate')
  }
}

export function appendMessage(targetSession, kind, borrowedPayload, options, { Session, sessions, contracts, logger } = {}) {
  assertLiveSessionTarget(targetSession, { Session, sessions, requireAppend: true })
  const { payload, intent } = preflightSurfaceMessageAppend(targetSession, kind, borrowedPayload, options, contracts, logger)
  return targetSession.append(kind, payload, intent)
}

function isSurfaceMessagePayload(kind, payload) {
  if (kind === 'user/message') return isExactRecord(payload, ['id', 'role', 'content', 'source']) && isMessage(payload) && payload.role === 'user'
  if (kind === 'assistant/message') {
    if (!isExactRecord(payload, ['turn', 'step', 'message'], ['usage']) || !isNonNegativeSafeInteger(payload.turn) || !isNonNegativeSafeInteger(payload.step) || !isMessage(payload.message)) return false
    const source = payload.message.source
    return payload.message.role === 'assistant' && source.kind === 'model' && isNonEmptyString(source.provider) && isNonEmptyString(source.model)
  }
  if (kind !== 'tool/result' || !isExactRecord(payload, ['turn', 'step', 'message'], ['error', 'meta']) || !isNonNegativeSafeInteger(payload.turn) || !isNonNegativeSafeInteger(payload.step) || !isMessage(payload.message) || payload.message.role !== 'user') return false
  const source = payload.message.source
  if (source.kind !== 'tool' || !isNonEmptyString(source.callId) || !Array.isArray(payload.message.content) || payload.message.content.length !== 1) return false
  const block = payload.message.content[0]
  return isPlainRecord(block) && block.type === 'tool-result' && block.toolCallId === source.callId && Array.isArray(block.content)
    && (!Object.hasOwn(payload, 'error') || isExactRecord(payload.error, ['name', 'code']) && isNonEmptyString(payload.error.name) && isNonEmptyString(payload.error.code))
}

function isMessage(value) {
  return isPlainRecord(value)
    && isNonEmptyString(value.id)
    && Array.isArray(value.content)
    && isPlainRecord(value.source)
    && isNonEmptyString(value.source.kind)
}

function isOptions(value) {
  if (value === undefined) return true
  return isExactRecord(value, [], ['sourceEventSeqs'])
}

function sourceEventSeqsOf(options) {
  return options === undefined || !Object.hasOwn(options, 'sourceEventSeqs')
    ? undefined
    : options.sourceEventSeqs
}

function resolveSourceEventSeqs(kind, payload, supplied, events) {
  const boundary = events.length
  if (supplied !== undefined && !isStrictSequenceList(supplied)) throw preflightError('invalid-source-event-seqs', 'source event sequences are invalid')
  if (supplied?.some((seq) => seq >= boundary)) throw preflightError('invalid-source-event-seqs', 'source event sequences are not earlier')
  if (kind === 'assistant/message') {
    const candidates = matchingAssistantChunks(events, payload.turn, payload.step)
    if (supplied === undefined || supplied.length === 0) {
      if (candidates.length !== 0) throw preflightError('indeterminate-source-event-seqs', 'assistant chunk provenance is ambiguous')
      return []
    }
    if (!supplied.every((seq) => candidates.some((event) => event.seq === seq))) throw preflightError('indeterminate-source-event-seqs', 'assistant chunk provenance is indeterminate')
    return supplied
  }
  if (supplied !== undefined && supplied.length !== 1) throw preflightError('invalid-source-event-seqs', 'tool result requires one source event')
  const candidates = matchingToolCalls(events, payload.turn, payload.step, payload.message.source.callId)
  if (supplied !== undefined) {
    if (!candidates.some((event) => event.seq === supplied[0])) throw preflightError('indeterminate-source-event-seqs', 'tool call provenance is indeterminate')
    return supplied
  }
  if (candidates.length !== 1) throw preflightError('indeterminate-source-event-seqs', 'tool call provenance is indeterminate')
  return [candidates[0].seq]
}

function isExactRecord(value, requiredKeys, optionalKeys = []) {
  if (!isPlainRecord(value)) return false
  const keys = Reflect.ownKeys(value)
  const allowed = new Set([...requiredKeys, ...optionalKeys])
  return requiredKeys.every((key) => Object.hasOwn(value, key))
    && keys.length === requiredKeys.length + optionalKeys.filter((key) => Object.hasOwn(value, key)).length
    && keys.every((key) => typeof key === 'string' && allowed.has(key) && Object.prototype.propertyIsEnumerable.call(value, key))
}

function matchingAssistantChunks(events, turn, step) {
  return events.filter((event) => isPlainRecord(event)
    && event.type === 'assistant/chunk'
    && event.data?.turn === turn
    && event.data?.step === step
    && isSnapshotEventSeq(event.seq, events.length))
}

function matchingToolCalls(events, turn, step, callId) {
  return events.filter((event) => isPlainRecord(event)
    && event.type === 'tool/call'
    && event.data?.turn === turn
    && event.data?.step === step
    && event.data?.callId === callId
    && isSnapshotEventSeq(event.seq, events.length))
}

function isSnapshotEventSeq(value, boundary) {
  return isNonNegativeSafeInteger(value) && value < boundary
}

function isStrictSequenceList(value) {
  if (!Array.isArray(value)) return false
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index) || !isNonNegativeSafeInteger(value[index])) return false
    if (index > 0 && value[index - 1] >= value[index]) return false
  }
  return true
}

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0
}


function minimalPayloadFor(kind) {
  switch (kind) {
    case 'approval/asked': return { id: '', toolName: '' }
    case 'approval/decided': return { id: '', outcome: 'allowed-once' }
    case 'approval/policy': return { policy: 'ask' }
    case 'schedule/change': return { version: 1, operation: 'delete', id: 'schedule' }
    case 'subagent/descriptor': return { version: 2, mode: 'one-shot', provider: '' }
    default: return undefined
  }
}
