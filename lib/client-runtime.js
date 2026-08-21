import * as zod from 'zod'
import { defineManifest } from './client-manifest.js'
import { createClientConnection } from './client-connection.js'
import { createClientCodec } from './client-codec.js'
import { createClientRemoteContribution } from './client-remote-contribution.js'
import { createClientSettingsRemote } from './client-settings-remote.js'
import { createClientSettingsScope } from './client-settings-scope.js'
import { createClientSlots } from './client-slots.js'
import { createClientSlotEvents } from './client-slot-events.js'
import { createClientRemoteEvents } from './client-remote-events.js'
import { createClientOfficialServices } from './client-official-services.js'
import { createClientOfficialEvents, CLIENT_EVENT_NAMES } from './client-official-events.js'
import { createClientOfficialConnection } from './client-official-connection.js'

export const CLIENT_MOUNTERS = Object.freeze([
  'clientManifest',
  'clientConnection',
  'clientCodec',
  'clientOfficialServices',
  'clientRemoteContribution',
  'clientSettingsRemote',
  'clientSettingsScope',
  'clientSlots',
  'clientSlotEvents',
  'clientRemoteEvents',
])

// Optional browser services are resolved inside each leaf's own guard, never as
// top-level Cordis injections. A missing service therefore disables only its
// owning leaf instead of leaving the whole client entry pending.
export const inject = []

const clientPluginApiBrand = Symbol.for('@deepseek-ai/dsh-plugin-api/client-pluginApi')
const owners = new WeakMap()

const officialEventFaceName = Object.freeze({
  'locale/change': 'localeChange',
  'theme/change': 'themeChange',
  'connection/reset': 'connectionReset',
  'command/executed': 'commandExecuted',
})

/**
 * Browser-side counterpart of the host facade. It is deliberately a normal
 * Cordis service value: consumers inject `pluginApi` then use `.client`.
 * Each leaf is locally fail-closed, so one absent browser service never
 * prevents unrelated helpers from being published.
 */
export function apply(ctx) {
  const existing = safelyGet(ctx, 'pluginApi')
  if (existing?.[clientPluginApiBrand]) return existing.__dshPluginApiDispose

  const active = { value: true }
  const isActive = () => active.value
  const logger = safeLogger(ctx)
  let api
  let unregister

  try {
    const connection = createClientConnection({ ctx, active: isActive })
    const codec = createClientCodec(zod)
    // Official browser leaves mount through the declared join order. Their
    // aggregate results already carry the exported faces and disposers, so
    // the central join composes them directly (D7).
    const officialServices = createClientOfficialServices({ ctx, active: isActive, logger })
    const officialEvents = createClientOfficialEvents({ ctx, active: isActive, logger })
    const officialConnection = createClientOfficialConnection({ ctx, active: isActive, logger })
    const remoteContribution = createClientRemoteContribution({ ctx, active: isActive, logger })
    const settingsRemote = createClientSettingsRemote({
      remoteContribution,
      remote: safelyGet(ctx, 'remote'),
      codec,
      logger,
    })
    const settingsScope = createClientSettingsScope({ ctx, active: isActive })
    const slotEvents = createClientSlotEvents({ ctx, active: isActive, logger })
    const slots = createClientSlots({ ctx, active: isActive })
    const remoteEvents = createClientRemoteEvents({ ctx, active: isActive, logger })

    // The official event leaves keep their disposers internal; the public
    // face exposes only the approved subscription surface.
    const officialEventFaces = {}
    for (const eventName of CLIENT_EVENT_NAMES) {
      const leaf = officialEvents.leaves[eventName]
      const faceName = officialEventFaceName[eventName]
      officialEventFaces[faceName] = Object.freeze({
        get isActive() { return leaf.api.isActive },
        on(listener) { return leaf.api.on(listener) },
      })
    }

    // The llm face rides the existing connection face; an unavailable
    // official api.llm keeps the face in its failing leaf shape.
    const connectionApi = { settings: connection.api.settings }
    if (officialConnection.api.api.llm) connectionApi.llm = officialConnection.api.api.llm

    const client = Object.freeze({
      defineManifest,
      connection: Object.freeze({
        isActive: connection.isActive,
        rpc: connection.rpc,
        api: Object.freeze(connectionApi),
        dispose: connection.dispose,
      }),
      codec,
      services: officialServices.api,
      events: Object.freeze({
        get isActive() { return officialEvents.api.isActive },
        ...officialEventFaces,
        on(name, listener) { return officialEvents.api.on(name, listener) },
      }),
      mountRemote: remoteContribution.mountRemote,
      mountRemoteContribution: settingsRemote.mountRemoteContribution,
      settingsScope,
      slots: Object.freeze({
        register: slots.register,
        inject: slots.inject,
        entries: slots.entries,
        subscribe: slots.subscribe,
        on: slotEvents.on,
      }),
      remote: Object.freeze({
        $on: remoteEvents.$on,
        $dispatch: remoteEvents.$dispatch,
      }),
      features: Object.freeze(CLIENT_MOUNTERS.map((name) => Object.freeze({
        name,
        isActive: name === 'clientManifest' || name === 'clientCodec'
          ? true
          : Boolean({
              clientConnection: connection,
              clientOfficialServices: officialServices,
              clientRemoteContribution: remoteContribution,
              clientSettingsRemote: settingsRemote,
              clientSettingsScope: settingsScope,
              clientSlots: slots,
              clientSlotEvents: slotEvents,
              clientRemoteEvents: remoteEvents,
            }[name]?.isActive),
      }))),
    })

    const dispose = async () => {
      if (!active.value) return false
      active.value = false
      for (const surface of [remoteEvents, slotEvents, slots, settingsScope, settingsRemote, remoteContribution, officialConnection, officialEvents, officialServices, connection]) {
        try { await surface.dispose?.() } catch { logger.error('dsh-plugin-api client cleanup failed') }
      }
      if (owners.get(ctx) === record) owners.delete(ctx)
      if (safelyGet(ctx, 'pluginApi') === api) {
        try { await unregister?.() } catch { logger.error('dsh-plugin-api client unregister failed') }
      }
      return true
    }
    const record = { api: null, dispose }
    api = Object.freeze({
      client,
      [clientPluginApiBrand]: true,
      __dshPluginApiDispose: dispose,
    })
    record.api = api
    owners.set(ctx, record)
    if (typeof ctx?.reflect?.provide !== 'function') throw new TypeError('ctx.reflect.provide is unavailable')
    unregister = ctx.reflect.provide('pluginApi', api)
    if (unregister !== undefined && typeof unregister !== 'function') {
      throw new TypeError('ctx.reflect.provide returned a malformed disposer')
    }
    return dispose
  } catch (error) {
    active.value = false
    try { unregister?.() } catch {}
    if (owners.get(ctx)?.api === api) owners.delete(ctx)
    logger.error('dsh-plugin-api client apply disabled')
    return () => false
  }
}

function safelyGet(ctx, name) {
  try { return typeof ctx?.get === 'function' ? ctx.get(name) : ctx?.[name] } catch { return undefined }
}

function safeLogger(ctx) {
  return Object.freeze({
    error(message) {
      try { ctx?.logger?.error?.(message) } catch {}
    },
  })
}
