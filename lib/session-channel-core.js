/**
 * Channel lifecycle engine for the B facade.
 *
 * Manages channel/subscription records, generation fencing, cursor/replay,
 * and cancellation. The engine is the single authority owner of channel
 * generations (concurrency rule).
 *
 * Possession fencing: channel ids and generations are random opaque tokens;
 * every non-open operation must present the `channelGeneration` issued by its
 * `open` response (ack/fetchEvents additionally the `subscriptionGeneration`).
 * Channel expiry is enforced lazily on every access path; heartbeat extends
 * only live channels and never revives revoked/expired ones. Cursors are a
 * per-engine monotonic sequence so dedupe fallbacks never collide on clocks.
 */
import { randomUUID } from 'node:crypto'
import {
  TERMINAL_SUCCESS,
  CODE_INVALID_INPUT, CODE_CHANNEL_EXPIRED, CODE_CHANNEL_REVOKED,
  CODE_RESYNC_REQUIRED,
  CODE_STALE_GENERATION, CODE_SESSION_DENIED, CODE_RESUME_REJECTED,
  CODE_ABORTED,
  DEFAULT_REPLAY_WINDOW_EVENTS, DEFAULT_REPLAY_WINDOW_MS,
  typedError,
} from './session-channel-shared.js'

const opaque = () => randomUUID().replace(/-/g, '')

const MAX_CAPABILITIES = 32
const MAX_CAPABILITY_LENGTH = 128
export const MAX_FRAME_BATCH = 200

/** Validate declared capabilities: bounded array of bounded strings. */
function normalizeCapabilities(capabilities) {
  if (capabilities == null) return []
  if (!Array.isArray(capabilities) || capabilities.length > MAX_CAPABILITIES) return undefined
  for (const item of capabilities) {
    if (typeof item !== 'string' || item.length === 0 || item.length > MAX_CAPABILITY_LENGTH) {
      return undefined
    }
  }
  return [...capabilities]
}

/**
 * Create the channel engine.
 * @param {object} [options]
 * @param {number} [options.replayWindowEvents]
 * @param {number} [options.replayWindowMs]
 * @returns {object} engine
 */
export function createChannelEngine({ replayWindowEvents = DEFAULT_REPLAY_WINDOW_EVENTS, replayWindowMs = DEFAULT_REPLAY_WINDOW_MS, channelTtlMs = 60 * 60 * 1000 } = {}) {
  const channels = new Map()
  const subscriptions = new Map()
  const eventLogs = new Map() // sessionId → [{ eventId, dedupeKey, cursor, kind, payload, emittedAt }]
  const listeners = new Set() // onChange listeners
  const state = { disposed: false }
  let seq = 0

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

  const isExpired = (ch) => ch.expiresAt != null && Date.now() > ch.expiresAt

  const channelGenerationOf = (channelId) => {
    const ch = channels.get(channelId)
    return ch ? ch.generation : undefined
  }

  /**
   * Lazy expiry + possession-gated channel lookup shared by every method.
   * Expired channels transition (and lose their old generation) before any
   * rejection, so no path can revive them.
   */
  const findChannel = (channelId, generation) => {
    if (!channelId || typeof channelId !== 'string') {
      return { error: typedError(CODE_INVALID_INPUT, 'channelId is required') }
    }
    if (generation == null || typeof generation !== 'string') {
      return { error: typedError(CODE_INVALID_INPUT, 'channelGeneration is required') }
    }
    const ch = channels.get(channelId)
    if (!ch) return { error: typedError(CODE_INVALID_INPUT, 'channel not found') }
    if (isExpired(ch)) {
      ch.lifecycleState = 'expired'
      ch.generation = opaque()
      notify()
    }
    if (ch.lifecycleState === 'revoked' || ch.lifecycleState === 'expired') {
      const code = ch.lifecycleState === 'revoked' ? CODE_CHANNEL_REVOKED : CODE_CHANNEL_EXPIRED
      return { error: typedError(code, `channel is ${ch.lifecycleState}`) }
    }
    if (String(generation) !== ch.generation) {
      return { error: typedError(CODE_STALE_GENERATION, 'channel generation mismatch') }
    }
    return { channel: ch }
  }

  /** Look up a subscription owned by an already-fenced channel. */
  const findSubscription = (ch, subscriptionId, subscriptionGeneration) => {
    if (!subscriptionId || typeof subscriptionId !== 'string') {
      return { error: typedError(CODE_INVALID_INPUT, 'subscriptionId is required') }
    }
    if (subscriptionGeneration == null || typeof subscriptionGeneration !== 'string') {
      return { error: typedError(CODE_INVALID_INPUT, 'subscriptionGeneration is required') }
    }
    const sub = subscriptions.get(subscriptionId)
    if (!sub || sub.channelId !== ch.channelId) return { error: typedError(CODE_INVALID_INPUT, 'subscription not found') }
    if (String(subscriptionGeneration) !== sub.subscriptionGeneration) {
      return { error: typedError(CODE_STALE_GENERATION, 'subscription generation mismatch') }
    }
    if (sub.lifecycleState !== 'active') {
      return { error: typedError(CODE_STALE_GENERATION, `subscription is ${sub.lifecycleState}`) }
    }
    return { sub }
  }

  /**
   * Collect frames strictly after `afterCursor`, capped and event-type
   * filtered. Returns either `{ frames }` or `{ resync: typedResult }`.
   */
  const collectFrames = (log, afterCursor, cap, eventTypes) => {
    let start = 0
    if (afterCursor != null && afterCursor !== '') {
      const idx = log.findIndex((e) => e.cursor === afterCursor)
      if (idx < 0) return { resync: typedError(CODE_RESYNC_REQUIRED, 'cursor outside retained window; resync required') }
      start = idx + 1
    }
    const allow = Array.isArray(eventTypes) && eventTypes.length > 0 ? new Set(eventTypes) : undefined
    const frames = []
    for (let i = start; i < log.length && frames.length < cap; i++) {
      const entry = log[i]
      if (allow && !allow.has(entry.kind)) continue
      frames.push({ ...entry })
    }
    return { frames }
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
     * public facade). Cursor and id/dedupe fallbacks come from the engine's
     * monotonic sequence, never from wall-clock values.
     * @param {object} record - `{ sessionId, eventId?, dedupeKey?, cursor?, kind?, payload, emittedAt? }`
     */
    _observeEvent(record) {
      if (state.disposed) return
      const sessionId = record?.sessionId
      if (!sessionId) return
      seq += 1
      let log = eventLogs.get(sessionId)
      if (!log) {
        log = []
        eventLogs.set(sessionId, log)
      }
      log.push({
        eventId: record?.eventId ?? `evt-${seq}`,
        dedupeKey: record?.dedupeKey ?? record?.eventId ?? `evt-${seq}`,
        cursor: String(record?.cursor ?? seq),
        kind: record?.kind ?? 'session/event',
        payload: record?.payload,
        emittedAt: record?.emittedAt ?? Date.now(),
        order: seq,
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
      const args = payload?.args
      const handler = this[method]
      if (typeof handler !== 'function') {
        return typedError(CODE_INVALID_INPUT, `unknown channel method: ${method}`)
      }
      return handler.call(this, args, signal)
    },

    /** Open a new channel. */
    async open(args, signal, meta) {
      if (signal?.aborted) return typedError(CODE_ABORTED, 'cancelled before open')
      const { device, capabilities, session } = args || {}
      if (!device || !session) return typedError(CODE_INVALID_INPUT, 'device and session are required')
      const caps = normalizeCapabilities(capabilities)
      if (caps === undefined) return typedError(CODE_INVALID_INPUT, 'capabilities must be a bounded array of bounded strings')
      const channelId = `ch-${opaque()}`
      const generation = opaque()
      channels.set(channelId, {
        channelId, sessionId: session, deviceLabel: device,
        // Canonical identity resolved by the verifier chain, not caller-declared.
        deviceId: meta?.deviceId ?? null,
        scope: meta?.scope ?? null,
        capabilities: caps,
        generation,
        lifecycleState: 'active',
        createdAt: Date.now(),
        lastHeartbeatAt: Date.now(),
        expiresAt: Date.now() + channelTtlMs,
      })
      notify()
      return {
        ok: true, terminal: TERMINAL_SUCCESS,
        channelId, channelGeneration: generation,
        deliveryMode: 'at-least-once-pull',
        expiresAt: channels.get(channelId).expiresAt,
      }
    },

    /** Subscribe to a channel's event stream (possession-gated). */
    async subscribe(args, signal) {
      if (signal?.aborted) return typedError(CODE_ABORTED, 'cancelled before subscribe')
      const { channelId, channelGeneration, session, cursor, eventTypes } = args || {}
      const found = findChannel(channelId, channelGeneration)
      if (found.error) return found.error
      const ch = found.channel
      if (session !== ch.sessionId) {
        return typedError(CODE_SESSION_DENIED, 'session does not match channel scope')
      }
      if (eventTypes != null && !Array.isArray(eventTypes)) {
        return typedError(CODE_INVALID_INPUT, 'eventTypes must be an array when provided')
      }
      const log = eventLogs.get(ch.sessionId) ?? []
      const collected = collectFrames(log, cursor ?? undefined, MAX_FRAME_BATCH, eventTypes)
      if (collected.resync) return { ok: false, ...collected.resync }
      const subId = `sub-${opaque()}`
      const subscriptionGeneration = opaque()
      subscriptions.set(subId, {
        subscriptionId: subId, channelId: ch.channelId, sessionId: ch.sessionId,
        subscriptionGeneration,
        nextCursor: cursor ?? undefined, ackedCursor: cursor ?? undefined,
        eventTypes: eventTypes ?? [],
        redactionProfile: args?.redactionProfile ?? undefined,
        lifecycleState: 'active',
      })
      notify()
      return {
        ok: true, terminal: TERMINAL_SUCCESS,
        subscriptionId: subId, subscriptionGeneration,
        channelId: ch.channelId, sessionId: ch.sessionId,
        deliveryMode: 'at-least-once-pull',
        frames: collected.frames,
      }
    },

    /** Fetch the next bounded batch of frames for a subscription (pull). */
    async fetchEvents(args, signal) {
      if (signal?.aborted) return typedError(CODE_ABORTED, 'cancelled before fetch')
      const { channelId, channelGeneration, subscriptionId, subscriptionGeneration, cursor, maxEvents } = args || {}
      const found = findChannel(channelId, channelGeneration)
      if (found.error) return found.error
      const ch = found.channel
      const subFound = findSubscription(ch, subscriptionId, subscriptionGeneration)
      if (subFound.error) return subFound.error
      const sub = subFound.sub
      const cap = Math.min(Number.isFinite(maxEvents) && maxEvents > 0 ? Math.floor(maxEvents) : MAX_FRAME_BATCH, MAX_FRAME_BATCH)
      const baseCursor = cursor ?? sub.nextCursor ?? undefined
      const log = eventLogs.get(ch.sessionId) ?? []
      const collected = collectFrames(log, baseCursor, cap, sub.eventTypes)
      if (collected.resync) return { ok: false, ...collected.resync }
      const frames = collected.frames
      return {
        ok: true, terminal: TERMINAL_SUCCESS,
        subscriptionId: sub.subscriptionId,
        deliveryMode: 'at-least-once-pull',
        redactionProfile: sub.redactionProfile,
        hasMore: frames.length === cap,
        // Read-only watermark: fetch never advances nextCursor; ack does.
        cursor: frames.length > 0 ? frames[frames.length - 1].cursor : (baseCursor ?? null),
        frames,
      }
    },

    /** Acknowledge a cursor position (possession-gated, monotonic). */
    async ack(args, signal) {
      if (signal?.aborted) return typedError(CODE_ABORTED, 'cancelled before ack')
      const { channelId, channelGeneration, subscriptionId, subscriptionGeneration, cursor } = args || {}
      const found = findChannel(channelId, channelGeneration)
      if (found.error) return found.error
      const ch = found.channel
      const subFound = findSubscription(ch, subscriptionId, subscriptionGeneration)
      if (subFound.error) return subFound.error
      const sub = subFound.sub
      if (!cursor) return typedError(CODE_INVALID_INPUT, 'cursor is required')
      // Monotonic ack: compare numerically (cursors are numeric strings).
      const ackNum = Number(cursor)
      if (Number.isNaN(ackNum)) return typedError(CODE_INVALID_INPUT, 'cursor must be numeric')
      if (sub.ackedCursor != null) {
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

    /** Resume a channel after transport loss (credential + possession gated). */
    async resume(args, signal, meta) {
      if (signal?.aborted) return typedError(CODE_ABORTED, 'cancelled before resume')
      const { channelId, resumeToken, session, cursor } = args || {}
      if (!resumeToken) return typedError(CODE_INVALID_INPUT, 'resumeToken is required')
      const found = findChannel(channelId, args?.channelGeneration)
      if (found.error) return found.error
      const ch = found.channel
      if (!meta?.deviceId || meta.deviceId !== ch.deviceId) {
        return typedError(CODE_RESUME_REJECTED, 'resume verification failed')
      }
      if (session != null && session !== ch.sessionId) {
        return typedError(CODE_RESUME_REJECTED, 'resume verification failed')
      }
      const log = eventLogs.get(ch.sessionId) ?? []
      const collected = collectFrames(log, cursor ?? undefined, MAX_FRAME_BATCH, undefined)
      if (collected.resync) return { ok: false, ...collected.resync }
      return {
        ok: true, terminal: TERMINAL_SUCCESS,
        channelId: ch.channelId, channelGeneration: ch.generation,
        deliveryMode: 'at-least-once-pull',
        frames: collected.frames,
      }
    },

    /** Heartbeat: extend only a live channel's activity window. */
    async heartbeat(args, signal) {
      if (signal?.aborted) return typedError(CODE_ABORTED, 'cancelled before heartbeat')
      const { channelId, channelGeneration } = args || {}
      const found = findChannel(channelId, channelGeneration)
      if (found.error) return found.error
      const ch = found.channel
      // findChannel already rejects revoked/expired states — no revival.
      ch.lastHeartbeatAt = Date.now()
      ch.expiresAt = ch.lastHeartbeatAt + channelTtlMs
      notify()
      return {
        ok: true, terminal: TERMINAL_SUCCESS,
        channelId: ch.channelId,
        lastHeartbeatAt: ch.lastHeartbeatAt, expiresAt: ch.expiresAt,
      }
    },

    /** Revoke a channel (channel-scope fencing) and cascade its subscriptions. */
    async revoke(args, signal) {
      if (signal?.aborted) return typedError(CODE_ABORTED, 'cancelled before revoke')
      const { channelId, channelGeneration } = args || {}
      const found = findChannel(channelId, channelGeneration)
      if (found.error) return found.error
      const ch = found.channel
      ch.lifecycleState = 'revoked'
      ch.revokedAt = Date.now()
      ch.generation = opaque() // latest-wins: late holders of the old token lose qualification
      for (const [, sub] of subscriptions) {
        if (sub.channelId === channelId && sub.lifecycleState === 'active') {
          sub.lifecycleState = 'revoked'
        }
      }
      notify()
      return { ok: true, terminal: TERMINAL_SUCCESS, result: 'revoked', channelId }
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
