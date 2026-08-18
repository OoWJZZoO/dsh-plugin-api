export const CLIENT_SETTINGS_REMOTE_FEATURE = 'clientSettingsRemote'

/**
 * Settings-specific adapter. C2 remains the only `$mount` owner; this module
 * validates the expected settings namespace and translates an unavailable host
 * face into an inert, renderable result for a settings panel.
 */
export function createClientSettingsRemote({ remoteContribution, remote, codec, logger } = {}) {
  if (!remoteContribution || typeof remoteContribution.mountRemote !== 'function' || !codec) {
    return Object.freeze({ isActive: false, async mountRemoteContribution() { return degraded('remote-unavailable') }, dispose() {} })
  }
  const owners = new Map()
  async function mountRemoteContribution(contribution, { namespace, render } = {}) {
    if (!contribution || !Array.isArray(contribution.descriptors) || typeof namespace !== 'string' || namespace.length === 0) {
      return degraded('invalid-contribution')
    }
    if (!contribution.descriptors.some((descriptor) => descriptor?.namespace === namespace && descriptor?.result?.mode === 'strict')) {
      return degraded('descriptor-mismatch')
    }
    let dispose
    try {
      dispose = await remoteContribution.mountRemote(contribution)
      const face = remote?.[namespace]
      if (!face || typeof face !== 'object') {
        await dispose?.()
        return degraded('remote-unavailable')
      }
      const record = { dispose, disposed: false }
      owners.set(contribution.package, record)
      const result = Object.freeze({ status: 'active', face, render: typeof render === 'function' ? render(face) : undefined, dispose: () => disposeRecord(contribution.package, record) })
      return result
    } catch (error) {
      report(logger, 'dsh-plugin-api client settings remote mount failed')
      try { await dispose?.() } catch {}
      return degraded('remote-unavailable')
    }
  }
  return Object.freeze({ isActive: true, mountRemoteContribution, dispose() { return Promise.all([...owners.entries()].map(([key, record]) => disposeRecord(key, record))) } })
}

function degraded(reason) { return Object.freeze({ status: 'degraded', reason, face: undefined, render: undefined, dispose: () => false }) }

async function disposeRecord(key, record) {
  if (record.disposed) return false
  record.disposed = true
  await record.dispose?.()
  return true
}

function report(logger, message) { try { logger?.error?.(message) } catch {} }
