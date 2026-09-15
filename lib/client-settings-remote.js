import { createPendingContributionHandle } from './contract-kernel.js'

export const CLIENT_SETTINGS_REMOTE_FEATURE = 'clientSettingsRemote'

/** Client contributions carry no caller context here; the root token is the honest owner. */
const CLIENT_CONTRIBUTION_OWNER = 'root'
let contributionSequence = 0

/**
 * Settings-specific adapter. remote mount owner remains the only `$mount` owner; this module
 * validates the expected settings namespace and translates an unavailable host
 * face into an observable contribution state for a settings panel.
 *
 * `contribute` answers the contribution idiom synchronously: a frozen
 * discriminated result plus a pending handle. The official mount is
 * asynchronous, so `face` and `render` are lazily resolved domain members —
 * they stay undefined until the settlement lands, and a withdrawal before the
 * settlement rolls the committed mount back instead of resurrecting it.
 */
export function createClientSettingsRemote({ remoteContribution, remote, codec, logger } = {}) {
  if (!remoteContribution || typeof remoteContribution.mountRemote !== 'function' || !codec || typeof codec.validate !== 'function') {
    return createDisabledClientSettingsRemote()
  }
  const owners = new Map()

  function contribute(contribution, { namespace, render } = {}) {
    if (typeof contribution?.package !== 'string' || contribution.package.length === 0
      || !Array.isArray(contribution.descriptors) || typeof namespace !== 'string' || namespace.length === 0) {
      return failure('invalid-input', 'a settings remote contribution needs a package, descriptors and a namespace')
    }
    const descriptors = contribution.descriptors.filter((descriptor) => descriptor?.namespace === namespace)
    if (descriptors.length === 0) {
      return failure('invalid-input', `the contribution declares no descriptor for namespace "${namespace}"`)
    }
    try {
      for (const descriptor of descriptors) codec.validate(descriptor)
    } catch (error) {
      return failure('invalid-input', `descriptor validation failed: ${String(error?.message ?? error)}`)
    }
    const existing = owners.get(contribution.package)
    if (existing) {
      if (sameMount(existing, contribution, namespace)) {
        return Object.freeze({ ok: true, code: 'contributed', handle: existing.handle })
      }
      return failure('conflict', `package "${contribution.package}" already contributes a different settings face`)
    }

    const record = {
      owners,
      contribution,
      namespace,
      disposer: undefined,
      face: undefined,
      render: undefined,
      handle: undefined,
    }
    let settleResolve
    let settleReject
    const settle = new Promise((resolve, reject) => {
      settleResolve = resolve
      settleReject = reject
    })
    const { handle, live } = createPendingContributionHandle({
      id: contribution.package,
      ownerId: CLIENT_CONTRIBUTION_OWNER,
      seq: ++contributionSequence,
      // Lazy domain members: the face and its rendered projection only exist
      // once the official mount settles, and they disappear on revocation.
      extensions: {
        get face() { return live() ? record.face : undefined },
        get render() { return live() ? record.render : undefined },
      },
      settle,
      revoke: () => {
        const dispose = record.disposer
        if (typeof dispose !== 'function') {
          if (record.owners.get(contribution.package) === record) record.owners.delete(contribution.package)
          return false
        }
        record.disposer = undefined
        record.face = undefined
        record.render = undefined
        if (record.owners.get(contribution.package) === record) record.owners.delete(contribution.package)
        // The official disposer may be asynchronous; the release starts here so
        // the teardown is observably under way when `dispose()` answers.
        try {
          const settlement = dispose()
          if (settlement && typeof settlement.then === 'function') {
            settlement.catch(() => report(logger, 'dsh-plugin-api client settings remote rollback failed'))
          }
        } catch {
          report(logger, 'dsh-plugin-api client settings remote rollback failed')
        }
        return true
      },
      reportError: () => report(logger, 'dsh-plugin-api client settings remote settlement failed'),
    })
    record.handle = handle
    owners.set(contribution.package, record)

    void (async () => {
      let dispose
      try {
        dispose = await remoteContribution.mountRemote(contribution)
        if (typeof dispose !== 'function') throw new TypeError('remote contribution did not return a disposer')
        record.disposer = dispose
        if (handle.status().state !== 'pending') {
          // Withdrawn while the official mount was pending: hand the committed
          // mount to the kernel's rollback rather than publishing a stale face.
          settleResolve(undefined)
          return
        }
        const face = remote?.[namespace]
        if (!isFaceForDescriptors(face, descriptors)) {
          await releaseRecord(contribution.package, record)
          settleReject(new Error(`mounted remote contribution published no usable "${namespace}" face`))
          return
        }
        record.face = face
        record.render = typeof render === 'function' ? render(face) : undefined
        settleResolve(undefined)
      } catch (error) {
        report(logger, 'dsh-plugin-api client settings remote mount failed')
        try { await releaseRecord(contribution.package, record) } catch { /* the failure is already reported */ }
        settleReject(error)
      }
    })()

    return Object.freeze({ ok: true, code: 'contributed', handle })
  }

  return Object.freeze({
    isActive: true,
    contribute,
    dispose() {
      return Promise.all([...owners.keys()].map((key) => releaseRecord(key, owners.get(key))))
    },
  })
}

function createDisabledClientSettingsRemote() {
  return Object.freeze({
    isActive: false,
    contribute() {
      return failure('unavailable', 'the official remote mount owner is unavailable')
    },
    dispose() {},
  })
}

function failure(code, reason) {
  return Object.freeze({ ok: false, code, reason })
}

/** Unmount one record and forget it; the official disposer runs at most once. */
async function releaseRecord(key, record) {
  if (!record) return false
  const dispose = record.disposer
  record.disposer = undefined
  record.face = undefined
  record.render = undefined
  if (record.owners.get(key) === record) record.owners.delete(key)
  if (typeof dispose !== 'function') return false
  await dispose()
  return true
}

function isFaceForDescriptors(face, descriptors) {
  return face != null && typeof face === 'object' && descriptors.every((descriptor) => typeof face[descriptor.method] === 'function')
}

function sameMount(record, contribution, namespace) {
  return record.contribution === contribution && record.namespace === namespace
}

function report(logger, message) { try { logger?.error?.(message) } catch {} }
