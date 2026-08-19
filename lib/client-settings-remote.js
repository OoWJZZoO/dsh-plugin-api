export const CLIENT_SETTINGS_REMOTE_FEATURE = 'clientSettingsRemote'

/**
 * Settings-specific adapter. C2 remains the only `$mount` owner; this module
 * validates the expected settings namespace and translates an unavailable host
 * face into an inert, renderable result for a settings panel.
 */
export function createClientSettingsRemote({ remoteContribution, remote, codec, logger } = {}) {
  if (!remoteContribution || typeof remoteContribution.mountRemote !== 'function' || !codec || typeof codec.validateInvocation !== 'function') {
    return Object.freeze({ isActive: false, async mountRemoteContribution() { return degraded('remote-unavailable') }, dispose() {} })
  }
  const owners = new Map()
  async function mountRemoteContribution(contribution, { namespace, render } = {}) {
    if (!contribution || typeof contribution.package !== 'string' || contribution.package.length === 0 || !Array.isArray(contribution.descriptors) || typeof namespace !== 'string' || namespace.length === 0) {
      return degraded('invalid-contribution')
    }
    const descriptors = contribution.descriptors.filter((descriptor) => descriptor?.namespace === namespace)
    if (descriptors.length === 0) {
      return degraded('descriptor-mismatch')
    }
    try {
      for (const descriptor of descriptors) codec.validateInvocation(descriptor)
    } catch {
      return degraded('descriptor-mismatch')
    }
    const existing = owners.get(contribution.package)
    if (existing) return sameMount(existing, contribution, namespace) ? existing.promise : degraded('duplicate-mount')
    const record = { owners, contribution, namespace, disposed: false, disposer: undefined, promise: undefined }
    record.promise = (async () => {
      try {
        const dispose = await remoteContribution.mountRemote(contribution)
        if (typeof dispose !== 'function') throw new TypeError('remote contribution did not return a disposer')
        if (record.disposed) {
          // Disposed while the C2 mount was pending: clean up the committed
          // contribution and return an inert result instead of a stale owner.
          try { await dispose() } catch { report(logger, 'dsh-plugin-api client settings remote rollback failed') }
          return degraded('remote-unavailable')
        }
        record.disposer = dispose
        const face = remote?.[namespace]
        if (!isFaceForDescriptors(face, descriptors)) {
          await disposeRecord(contribution.package, record)
          return degraded('remote-unavailable')
        }
        const rendered = typeof render === 'function' ? render(face) : undefined
        const result = Object.freeze({ status: 'active', face, render: rendered, dispose: () => disposeRecord(contribution.package, record) })
        return result
      } catch (error) {
        report(logger, 'dsh-plugin-api client settings remote mount failed')
        try { await disposeRecord(contribution.package, record) } catch {}
        return degraded('remote-unavailable')
      }
    })()
    owners.set(contribution.package, record)
    return record.promise
  }
  return Object.freeze({ isActive: true, mountRemoteContribution, dispose() { return Promise.all([...owners.entries()].map(([key, record]) => disposeRecord(key, record))) } })
}

function degraded(reason) { return Object.freeze({ status: 'degraded', reason, face: undefined, render: undefined, dispose: () => false }) }

async function disposeRecord(key, record) {
  if (record.disposed) return false
  record.disposed = true
  try {
    await record.disposer?.()
  } finally {
    if (record.owners.get(key) === record) record.owners.delete(key)
  }
  return true
}

function isFaceForDescriptors(face, descriptors) {
  return face != null && typeof face === 'object' && descriptors.every((descriptor) => typeof face[descriptor.method] === 'function')
}

function sameMount(record, contribution, namespace) {
  return record.contribution === contribution && record.namespace === namespace
}

function report(logger, message) { try { logger?.error?.(message) } catch {} }
