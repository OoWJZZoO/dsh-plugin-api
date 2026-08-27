/**
 * Channel lifecycle engine for the B facade.
 *
 * Manages channel/subscription records, generation fencing, cursor/replay,
 * and cancellation. The engine is the single authority owner of channel
 * generations (concurrency §1.4).
 */
import {
  TERMINAL_SUCCESS, TERMINAL_ERROR, TERMINAL_ABORTED, TERMINAL_DENIED, TERMINAL_SUPERSEDED,
  CODE_INVALID_INPUT, CODE_CHANNEL_EXPIRED, CODE_CHANNEL_REVOKED, CODE_CURSOR_GAP, CODE_RESYNC_REQUIRED,
  CODE_STALE_GENERATION, CODE_SUPERSEDED, CODE_ABORTED, CODE_TIMEOUT, CODE_INTERNAL,
  CODE_RESUME_REJECTED,
  DEFAULT_REPLAY_WINDOW_EVENTS, DEFAULT_REPLAY_WINDOW_MS,
  typedError, terminalOutcomeFor,
} from './session-channel-shared.js'

let _nextOpaque = 1
function nextOpaque() {
  return `g-${Date.now().toString(36)}-${(_nextOpaque++).toString(36)}`
}

/**
 * Create the channel engine.
 * @param {object} [options]
 * @param {number} [options.replayWindowEvents]
 * @param {number} [options.replayWindowMs]
 * @returns {object} engine
 */
export function createChannelEngine({ replayWindowEvents = DEFAULT_REPLAY_WINDOW_EVENTS, replayWindowMs = DEFAULT_REPLAY_WINDOW_MS } = {}) {
  const channels = new Map()
  const subscriptions = new Map()
  const eventLogs = new Map() // sessionId → [{ eventId, dedupeKey, cursor, kind, payload, emittedAt }]
  const listeners = new Set() // onChange listeners
  const state = { disposed: false }

  const notify = () => {
    if (state.disposed) return
    for (const listener of listeners) {
      try { listener(snapshot()) } catch { /* listener isolation */ }
    }
  }

  const snapshot = () => {
    const ch = {}
    for (const [id, c] of channels) {
      ch[id] = { channelId: id, lifecycleState: c.lifecycleState, generation: c.generation, sessionId: c.sessionId, deviceId: c.deviceId }
    }
    const subs = {}
    for (const [id, s] of subscriptions) {
      subs[id] = { subscriptionId: id, channelId: s.channelId, lifecycleState: s.lifecycleState, cursor: s.nextCursor }
    }
    return { channels: ch, subscriptions: subs, connectionState: 'active' }
  }

  const deepFreeze = (value) => {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value
    if (Object.isFrozen(value)) return value
    for (const key of Object.keys(value)) value[key] = deepFreeze(value[key])
    return Object.freeze(value)
  }

  const channelGenerationOf = (channelId) => {
    const ch = channels.get(channelId)
    return ch ? ch.generation : undefined
  }

  const findChannel = (channelId, ops) => {
    const ch = channels.get(channelId)
    if (!ch) return { ok: false, error: { code: CODE_INVALID_INPUT, message: 'channel not found', details: {} } }
    if (ch.lifecycleState === 'revoked' || ch.lifecycleState === 'expired') {
      return { ok: false, error: { code: ch.lifecycleState === 'revoked' ? CODE_CHANNEL_REVOKED : CODE_CHANNEL_EXPIRED, message: `channel is ${ch.lifecycleState}`, details: {} } }
    }
    if (ch.generation !== ops.generation) return { ok: false, error: { code: CODE_STALE_GENERATION, message: 'channel generation mismatch', details: {} } }
    return { ok: true, channel: ch }
  }

  return Object.freeze({
    /** Subscribe to projection changes. */
    onChange(listener) {
      if (typeof listener !== 'function') return () => false
      listeners.add(listener)
      return () => { listeners.delete(listener); return true }
    },

    /** Get the current frozen projection snapshot. */
    observe() { return deepFreeze(snapshot()) },

    /** Raw mutable snapshot for the read-only projection module. */
    _snapshotRaw() { return snapshot() },

    /** Query channel generation (for connection R package fencing). */
    channelGenerationOf,

    /**
     * Observe a session event into the session-scoped bounded log.
     * Internal wiring for the session observation hook (not part of the
     * public facade).
     * @param {object} record - `{ sessionId, eventId, dedupeKey, cursor, kind, payload, emittedAt }`
     */
    _observeEvent(record) {
      if (state.disposed) return
      const sessionId = record?.sessionId
      if (!sessionId) return
      let log = eventLogs.get(sessionId)
      if (!log) {
        log = []
        eventLogs.set(sessionId, log)
      }
      log.push({
        eventId: record.eventId,
        dedupeKey: record.dedupeKey,
        cursor: record.cursor,
        kind: record.kind,
        payload: record.payload,
        emittedAt: record.emittedAt,
      })
      // Bounded retention window (by event count).
      if (log.length > replayWindowEvents) log.splice(0, log.length - replayWindowEvents)
      // Bounded retention window (by age).
      const cutoff = Date.now() - replayWindowMs
      while (log.length > 0 && log[0].emittedAt < cutoff) log.shift()
      notify()
    },

    /** Dispatch a channel method call (for gateway R package RPC routing). */
    async dispatchChannelMethod(endpoint, payload, signal) {
      const method = endpoint?.split('/').pop() // 'sessionChannel/open' → 'open'
      const { args } = payload || {}
      // Dispatch to the appropriate method based on the last segment
      if (method === 'open') return this.open(args, signal)
      if (method === 'subscribe') return this.subscribe(args, signal)
      if (method === 'ack') return this.ack(args, signal)
      if (method === 'resume') return this.resume(args, signal)
      if (method === 'revoke') return this.revoke(args, signal)
      return typedError(CODE_INVALID_INPUT, `unknown channel method: ${method}`)
    },

    /** Open a new channel. */
    async open(args, signal) {
      if (signal?.aborted) return typedError(CODE_ABORTED, 'cancelled before open')
      const { device, capabilities, session, resumeToken, clientNonce } = args || {}
      if (!device || !session) return typedError(CODE_INVALID_INPUT, 'device and session are required')
      const channelId = `ch-${nextOpaque()}`
      const generation = nextOpaque()
      channels.set(channelId, {
        channelId, sessionId: session, deviceId: device,
        capabilities: capabilities || [],
        generation,
        lifecycleState: 'opening',
        createdAt: Date.now(),
        expiresAt: Date.now() + 3600000,
      })
      // Advance to active
      channels.get(channelId).lifecycleState = 'active'
      notify()
      return { ok: true, terminal: TERMINAL_SUCCESS, channelId, channelGeneration: generation }
    },

    /** Subscribe to a channel's event stream. */
    async subscribe(args, signal) {
      if (signal?.aborted) return typedError(CODE_ABORTED, 'cancelled before subscribe')
      const { channelId, session, cursor, eventTypes, redactionProfile } = args || {}
      if (!channelId) return typedError(CODE_INVALID_INPUT, 'channelId is required')
      const ch = channels.get(channelId)
      if (!ch) return typedError(CODE_INVALID_INPUT, 'channel not found')
      if (ch.lifecycleState !== 'active') return typedError(CODE_CHANNEL_REVOKED, 'channel is not active')
      const subId = `sub-${nextOpaque()}`
      const subscriptionGeneration = nextOpaque()
      // Check cursor against the session-scoped event log.
      const log = session ? eventLogs.get(session) : undefined
      if (cursor) {
        if (!log) return { ok: false, ...typedError(CODE_RESYNC_REQUIRED, 'no events retained; cursor is outside the window') }
        const idx = log.findIndex((e) => e.cursor === cursor)
        if (idx < 0) {
          return { ok: false, ...typedError(CODE_RESYNC_REQUIRED, 'cursor is outside the retained window') }
        }
      }
      subscriptions.set(subId, {
        subscriptionId: subId, channelId, sessionId: session, subscriptionGeneration,
        nextCursor: cursor, ackedCursor: cursor, eventTypes: eventTypes || [],
        lifecycleState: 'active', redactionProfile,
      })
      notify()
      return { ok: true, terminal: TERMINAL_SUCCESS, subscriptionId: subId, subscriptionGeneration }
    },

    /** Acknowledge a cursor position. */
    async ack(args, signal) {
      if (signal?.aborted) return typedError(CODE_ABORTED, 'cancelled before ack')
      const { channelId, subscriptionId, cursor, dedupeKeys } = args || {}
      if (!subscriptionId) return typedError(CODE_INVALID_INPUT, 'subscriptionId is required')
      const sub = subscriptions.get(subscriptionId)
      if (!sub) return typedError(CODE_INVALID_INPUT, 'subscription not found')
      if (!cursor) return typedError(CODE_INVALID_INPUT, 'cursor is required')
      // Monotonic ack: compare numerically (cursors are numeric strings).
      const ackNum = Number(cursor)
      if (Number.isNaN(ackNum)) return typedError(CODE_INVALID_INPUT, 'cursor must be numeric')
      if (sub.ackedCursor) {
        const ackedNum = Number(sub.ackedCursor)
        if (!Number.isNaN(ackedNum) && ackNum <= ackedNum) {
          return { ok: true, terminal: TERMINAL_SUCCESS, ackedCursor: sub.ackedCursor }
        }
      }
      sub.ackedCursor = cursor
      sub.nextCursor = cursor
      notify()
      return { ok: true, terminal: TERMINAL_SUCCESS, ackedCursor: cursor }
    },

    /** Resume a channel after transport loss. */
    async resume(args, signal) {
      if (signal?.aborted) return typedError(CODE_ABORTED, 'cancelled before resume')
      const { channelId, resumeToken, session, cursor } = args || {}
      if (!channelId || !resumeToken) return typedError(CODE_INVALID_INPUT, 'channelId and resumeToken are required')
      const ch = channels.get(channelId)
      if (!ch) return typedError(CODE_INVALID_INPUT, 'channel not found')
      if (ch.lifecycleState === 'revoked') return typedError(CODE_CHANNEL_REVOKED, 'channel is revoked')
      const log = session ? eventLogs.get(session) : undefined
      if (cursor && log) {
        const idx = log.findIndex((e) => e.cursor === cursor)
        if (idx < 0) return { ok: false, ...typedError(CODE_RESYNC_REQUIRED, 'cursor outside retained window; resync required') }
      }
      return { ok: true, terminal: TERMINAL_SUCCESS, channelId, channelGeneration: ch.generation }
    },

    /** Revoke a channel or device. */
    async revoke(args, signal) {
      if (signal?.aborted) return typedError(CODE_ABORTED, 'cancelled before revoke')
      const { device, channelId, reason } = args || {}
      if (!channelId) return typedError(CODE_INVALID_INPUT, 'channelId is required')
      const ch = channels.get(channelId)
      if (!ch) return typedError(CODE_INVALID_INPUT, 'channel not found')
      ch.lifecycleState = 'revoked'
      ch.generation = nextOpaque() // bump generation
      // Revoke all subscriptions for this channel
      for (const [subId, sub] of subscriptions) {
        if (sub.channelId === channelId) {
          sub.lifecycleState = 'revoked'
        }
      }
      notify()
      return { ok: true, terminal: TERMINAL_SUCCESS, result: 'revoked' }
    },

    /** Dispose the engine. */
    dispose() {
      state.disposed = true
      channels.clear()
      subscriptions.clear()
      eventLogs.clear()
      listeners.clear()
    },
  })
}