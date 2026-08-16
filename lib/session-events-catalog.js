/**
 * Session lifecycle event catalog for pluginApi.session (S1).
 *
 * These four names are the Cordis session lifecycle events dispatched by the
 * official dsh-session package. They are intentionally separate from the
 * S5 `sessionEventTypes` catalog, which describes the appendable session LOG
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

const A = 'A'

const entries = [
  {
    name: 'session/created',
    mode: 'emit',
    scopeFiltered: true,
    subject: null,
    payload: 'Session',
    args: '(session)',
    source: 'S1',
    type: A,
  },
  {
    name: 'session/disposed',
    mode: 'emit',
    scopeFiltered: true,
    subject: null,
    payload: 'Session',
    args: '(session)',
    source: 'S1',
    type: A,
  },
  {
    name: 'session/event',
    mode: 'emit',
    scopeFiltered: true,
    subject: null,
    payload: 'Session, SessionEvent',
    args: '(session, event)',
    source: 'S1',
    type: A,
  },
  {
    name: 'session/flush',
    mode: 'parallel',
    scopeFiltered: true,
    subject: null,
    payload: 'Session',
    args: '(session)',
    source: 'S1',
    type: A,
  },
]

export const sessionLifecycleEventsCatalog = deepFreeze(
  Object.fromEntries(entries.map((entry) => [entry.name, deepFreeze(entry)])),
)
