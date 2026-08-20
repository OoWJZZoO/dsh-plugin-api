/**
 * Session lifecycle event catalog for pluginApi.session (session lifecycle).
 *
 * These four names are the Cordis session lifecycle events dispatched by the
 * official dsh-session package. They are intentionally separate from the
 * session type catalogs `sessionEventTypes` catalog, which describes the appendable session LOG
 * event vocabulary (KNOWN_SESSION_EVENT_TYPES).
 *
 * This module is pure data: no harness dependencies.
 */
import { deepFreeze } from './deep-freeze.js'

export const SESSION_LIFECYCLE_EVENT_NAMES = Object.freeze([
  'session/created',
  'session/disposed',
  'session/event',
  'session/flush',
])


const entries = [
  {
    name: 'session/created',
    mode: 'emit',
    scopeFiltered: true,
    scopeKey: null,
    fault: 'contain',
    freeze: 'all',
    payload: 'Session',
    args: '(session)',
  },
  {
    name: 'session/disposed',
    mode: 'emit',
    scopeFiltered: true,
    scopeKey: null,
    fault: 'contain',
    freeze: 'all',
    payload: 'Session',
    args: '(session)',
  },
  {
    name: 'session/event',
    mode: 'emit',
    scopeFiltered: true,
    scopeKey: null,
    fault: 'contain',
    freeze: 'all',
    payload: 'Session, SessionEvent',
    args: '(session, event)',
  },
  {
    name: 'session/flush',
    mode: 'parallel',
    scopeFiltered: true,
    scopeKey: null,
    fault: 'contain',
    freeze: 'all',
    payload: 'Session',
    args: '(session)',
  },
]

export const sessionLifecycleEventsCatalog = deepFreeze(
  Object.fromEntries(entries.map((entry) => [entry.name, deepFreeze(entry)])),
)
