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
import {
  bootstrapClientLeaf,
  CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS,
  createClientLeafFacade,
  createClientLeafRecord,
  CLIENT_REASONS,
} from './client-official-passthrough.js'

export const CLIENT_MOUNTERS = Object.freeze([
  'clientManifest',
  'clientConnection',
  'clientCodec',
  'clientRemoteContribution',
  'clientSettingsRemote',
  'clientSettingsScope',
  'clientSlots',
  'clientSlotEvents',
  'clientRemoteEvents',
])

export const CLIENT_OFFICIAL_LEAVES = Object.freeze(
  CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS.map((descriptor) => descriptor.featureName),
)

// Optional browser services are resolved inside each leaf's own guard, never as
// top-level Cordis injections. A missing service therefore disables only its
// owning leaf instead of leaving the whole client entry pending.
export const inject = []

const clientPluginApiBrand = Symbol.for('@deepseek-ai/dsh-plugin-api/client-pluginApi')
const CORDIS_TRACKER = Symbol.for('cordis.tracker')
const CORDIS_ORIGINAL = Symbol.for('cordis.original')
const clientBuilderKey = Symbol('clientBuilder')
const clientDisposeKey = Symbol('clientDispose')
const owners = new WeakMap()

/**
 * Root prototype for the client facade. The `client` getter runs with
 * `this.ctx` bound to the consuming context through the Cordis service
 * tracing contract, so every read produces a caller-bound composition.
 */
const clientPluginApiRootPrototype = Object.freeze({
  get client() {
    return this[clientBuilderKey](this.ctx)
  },
})

/**
 * Build the traceable root value. It registers under `pluginApi` through the
 * ordinary reflect provide and carries the Cordis tracker contract, so
 * `ctx.pluginApi.client` resolves `this.ctx` to the actual consuming context.
 */
export function createClientApiRoot(ctx, { clientBuilder, dispose }) {
  const root = Object.create(clientPluginApiRootPrototype)
  root.name = 'pluginApi'
  // `ctx` stays a writable own property: the Cordis tracing proxy must be able
  // to rebind `this.ctx` to the consuming context (proxy invariant holds only
  // for configurable/writable target properties), matching how Service
  // instances expose `ctx`.
  root.ctx = ctx
  root[clientBuilderKey] = clientBuilder
  root[clientPluginApiBrand] = true
  // The symbol-keyed disposer is returned on reapply so that identity is
  // preserved even through the traced service wrapper (string members get
  // wrapped by the tracing layer).
  root[clientDisposeKey] = dispose
  root.__dshPluginApiDispose = dispose
  Object.defineProperty(root, CORDIS_TRACKER, {
    value: { associate: 'pluginApi', property: 'ctx' },
  })
  return root
}

/**
 * Browser-side counterpart of the host facade. The root publishes synchronously
 * with the existing client face and seven official passthrough leaves; leaf
 * activation is driven by the optional browser module loader and never makes
 * the client fiber pending.
 */
export function apply(ctx) {
  const existing = safelyGet(ctx, 'pluginApi')
  if (existing?.[clientPluginApiBrand]) return existing[clientDisposeKey] ?? existing.__dshPluginApiDispose

  const active = { value: true }
  const isActive = () => active.value
  const logger = safeLogger(ctx)
  let api = null
  let unregister = null

  try {
    const connection = createClientConnection({ ctx, active: isActive })
    const codec = createClientCodec(zod)
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

    const m3Members = Object.freeze({
      defineManifest,
      connection,
      codec,
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
    })

    const m3Features = Object.freeze(CLIENT_MOUNTERS.map((name) => Object.freeze({
      name,
      isActive: name === 'clientManifest' || name === 'clientCodec'
        ? true
        : Boolean({
            clientConnection: connection,
            clientRemoteContribution: remoteContribution,
            clientSettingsRemote: settingsRemote,
            clientSettingsScope: settingsScope,
            clientSlots: slots,
            clientSlotEvents: slotEvents,
            clientRemoteEvents: remoteEvents,
          }[name]?.isActive),
    })))

    // Root state: one record per leaf, published as a pending shell before any
    // module import starts. The leaf records outlive the caller-bound client
    // compositions and are the only authority for leaf state.
    const modules = safelyGet(ctx, 'modules')
    const rootState = {
      active: isActive,
      current: true,
      ownerCtx: ctx,
      modules: modules ?? null,
      leaves: new Map(),
    }
    const reportLeaf = (surfaceKey, reason) => {
      logger.error(`dsh-plugin-api client unavailable (${surfaceKey}, ${reason})`)
    }
    for (const descriptor of CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS) {
      rootState.leaves.set(descriptor.surfaceKey, createClientLeafRecord(descriptor, reportLeaf))
    }
    if (!rootState.modules) {
      for (const record of rootState.leaves.values()) {
        record.settleDisabled(CLIENT_REASONS.missingService)
      }
    }

    const buildClient = (callerCtx) => {
      const composition = {}
      Object.assign(composition, m3Members)
      for (const descriptor of CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS) {
        composition[descriptor.surfaceKey.slice('client.'.length)] = createClientLeafFacade(
          rootState.leaves.get(descriptor.surfaceKey),
          rootState,
          callerCtx,
        )
      }
      composition.features = Object.freeze([
        ...m3Features,
        ...CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS.map((descriptor) => Object.freeze({
          name: descriptor.featureName,
          isActive: rootState.leaves.get(descriptor.surfaceKey).state === 'active',
        })),
      ])
      return Object.freeze(composition)
    }

    const dispose = async () => {
      if (!active.value) return false
      active.value = false
      for (const record of rootState.leaves.values()) record.invalidate()
      rootState.current = false
      for (const surface of [remoteEvents, slotEvents, slots, settingsScope, settingsRemote, remoteContribution, connection]) {
        try { await surface.dispose?.() } catch { logger.error('dsh-plugin-api client cleanup failed') }
      }
      if (owners.get(ctx) === record) owners.delete(ctx)
      if (unwrapService(safelyGet(ctx, 'pluginApi')) === api) {
        try { await unregister?.() } catch { logger.error('dsh-plugin-api client unregister failed') }
      }
      return true
    }
    api = createClientApiRoot(ctx, { clientBuilder: buildClient, dispose })
    unregister = ctx.reflect.provide('pluginApi', api)
    if (unregister !== undefined && typeof unregister !== 'function') {
      throw new TypeError('ctx.reflect.provide returned a malformed disposer')
    }

    if (rootState.modules) {
      for (const descriptor of CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS) {
        const task = bootstrapClientLeaf(rootState, rootState.leaves.get(descriptor.surfaceKey))
        task.catch(() => {}) // explicit rejection boundary; bootstrap never rejects
      }
    }

    const record = { api, dispose }
    owners.set(ctx, record)
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

function unwrapService(value) {
  if (!value) return value
  return value[CORDIS_ORIGINAL] ?? value
}

function safeLogger(ctx) {
  return Object.freeze({
    error(message) {
      try { ctx?.logger?.error?.(message) } catch {}
    },
  })
}