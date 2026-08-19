/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-plugin-api-session-title`.
 * @module @deepseek-ai/dsh-plugin-api-session-title/invariant
 *
 * This R-class replacement bundle forks the official `ctx.sessionTitle` service
 * but introduces NO new durable event type: its only new surface is the
 * dispatch-only `session-title/candidate` eligibility waterfall, which never
 * commits to the session log. Consequently this companion is a no-op: it
 * reserves this package's ownership in the invariant registry while leaving
 * every durable invariant to the official `@deepseek-ai/dsh-session-title`
 * companion (whose import face is NOT replaced per requirements 3.6 / R3).
 *
 * The structural shape mirrors `dsh-session-title/lib/invariant.js`
 * (`apply`/`inject`/`name` plus a callable `install`).
 */

const PACKAGE_NAME = '@deepseek-ai/dsh-plugin-api-session-title'

/** Cordis companion plugin name (distinct from the official `session-title-invariant`). */
const name = 'session-title-r1-invariant'

/** Service required before the companion can reserve package ownership. */
const inject = ['invariants']

/**
 * No-op install: because this bundle appends no `session/title` variant that the
 * official companion does not already validate, no additional durable check is
 * required. Kept callable to mirror the official companion's shape.
 */
const install = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))

export { apply, inject, name }
