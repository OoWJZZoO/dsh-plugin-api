import { PluginApiFeatureDisabledError, PluginApiInactiveError } from './errors.js'

export const OFFICIAL_PASSTHROUGH_HOST_DESCRIPTORS = Object.freeze([
  Object.freeze({
    surfaceKey: 'systemPrompt.renderContextSnapshot',
    moduleId: '@deepseek-ai/dsh-system-prompt',
    exportName: 'renderContextSnapshot',
    argumentCount: 1,
  }),
  Object.freeze({
    surfaceKey: 'systemPrompt.joinContextSections',
    moduleId: '@deepseek-ai/dsh-system-prompt',
    exportName: 'joinContextSections',
    argumentCount: 1,
  }),
])

const MISSING_EXPORT = 'missing-export'
const INVALID_EXPORT = 'invalid-export'

/**
 * Build the two host-side helper slots from the public system-prompt module
 * namespace. Each slot owns its lifecycle independently; the public service
 * composition is handled by plugin-api-service.js.
 */
export function createOfficialPassthroughHost({ namespace, active = true, logger } = {}) {
  const isActive = typeof active === 'function' ? active : () => Boolean(active)
  const records = new Map()
  let disposed = false

  for (const descriptor of OFFICIAL_PASSTHROUGH_HOST_DESCRIPTORS) {
    records.set(descriptor.surfaceKey, createRecord(descriptor))
  }

  const api = {}
  for (const descriptor of OFFICIAL_PASSTHROUGH_HOST_DESCRIPTORS) {
    const record = records.get(descriptor.surfaceKey)
    api[descriptor.exportName] = (...args) => {
      assertCurrent(record, isActive)
      return Reflect.apply(record.exported, namespace, args)
    }
    if (record.state === 'disabled') report(logger, descriptor.surfaceKey, record.reason)
  }

  return {
    api: Object.freeze(api),
    diagnostics: Object.freeze(Object.fromEntries(
      [...records.values()]
        .filter((record) => record.state === 'disabled')
        .map((record) => [record.surfaceKey, Object.freeze({
          surfaceKey: record.surfaceKey,
          reason: record.reason,
        })]),
    )),
    dispose() {
      if (disposed) return false
      disposed = true
      for (const record of records.values()) {
        record.current = false
        record.state = 'retired'
      }
      return true
    },
  }

  function createRecord(descriptor) {
    let exported
    let reason
    try {
      exported = namespace?.[descriptor.exportName]
      reason = exported === undefined ? MISSING_EXPORT
        : typeof exported !== 'function' ? INVALID_EXPORT
          : undefined
    } catch {
      reason = INVALID_EXPORT
    }
    return {
      surfaceKey: descriptor.surfaceKey,
      exported,
      current: true,
      state: reason ? 'disabled' : 'active',
      reason,
    }
  }
}

function assertCurrent(record, isActive) {
  if (!isActive()) throw new PluginApiInactiveError()
  if (!record.current || record.state !== 'active') {
    throw new PluginApiFeatureDisabledError(record.surfaceKey, record.reason)
  }
}

function report(logger, surfaceKey, reason) {
  try {
    logger?.error?.(`dsh-plugin-api official passthrough unavailable (${surfaceKey}, ${reason})`)
  } catch {
    // Diagnostics must not escape the host fail-safe path.
  }
}
