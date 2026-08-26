/**
 * Commit-window signal guard (cancellation contract): inside the commit
 * window the executor ignores SIGTERM so the atomic swap always runs to its
 * terminal state (a late cancel gets typed `too-late` from the facade);
 * outside the window a SIGTERM terminates the process normally so the
 * facade's pre-commit cancel settles `aborted` at the commit point.
 *
 * The guard is process-global and idempotent: the first installation wins,
 * and enter/leave must be paired.
 */

let installed = false
let listeners = []

export function installSignalGuard() {
  if (installed) return
  installed = true
  process.on('SIGTERM', () => {
    if (listeners.length === 0) {
      process.exit(130)
    }
    for (const listener of listeners.splice(0)) {
      try {
        listener()
      } catch {
        // a listener failure must not stop other listeners
      }
    }
  })
}

export function captureSignalGuard(listener) {
  if (typeof listener === 'function') listeners.push(listener)
  return () => {
    const index = listeners.indexOf(listener)
    if (index >= 0) listeners.splice(index, 1)
  }
}

export function hasCommitGuardListeners() {
  return listeners.length > 0
}

export function clearSignalListeners() {
  listeners = []
}