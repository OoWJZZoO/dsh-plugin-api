import { PluginApiFeatureDisabledError, PluginApiInactiveError } from './errors.js'
import { deepFreeze } from './deep-freeze.js'

/**
 * Thin owner-scoped private storage binding (`pluginApi.storage`), design
 * §Domain Composition Rules / requirements §11.
 *
 * The binding is deliberately thin: the plugin brings its own domain spec
 * (including its zod table schemas from its own zod import); the facade
 * validates the owner/scope/schema envelope, namespaces the official unit
 * name per owner and scope, delegates open/close to the official storage
 * domain facility, and maps official failures to the typed vocabulary.
 *
 * - scope: exactly one of `profile`, `workspace`, or `session`;
 * - owner: caller-supplied owner-local label, namespaced into the unit name
 *   so cross-owner same-name conflicts cannot occur by construction;
 * - unknown future record/domain version: official `version-mismatch`
 *   surfaces as typed `unsupported-schema`;
 * - handle `close()` never deletes data; `purge()` is the explicit deletion
 *   operation (deletes every record across the domain's tables).
 */

export const STORAGE_FEATURE = 'storage'
export const STORAGE_SCOPES = Object.freeze(['profile', 'workspace', 'session'])
export const STORAGE_UNIT_NAME_RE = /^[a-z][a-z0-9_]*$/

const FACILITY_PROBES = [
  (ctx) => ctx?.storage?.domain,
  (ctx) => typeof ctx?.get === 'function' ? safeGet(ctx, 'storage')?.domain : undefined,
  (ctx) => typeof ctx?.get === 'function' ? safeGet(ctx, 'storage.domain') : undefined,
]

function safeGet(ctx, name) {
  try {
    return ctx.get(name)
  } catch {
    return undefined
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function resolveFacility(ctx) {
  for (const probe of FACILITY_PROBES) {
    const facility = probe(ctx)
    if (facility && typeof facility.open === 'function') return facility
  }
  return undefined
}

function assertActive(active, fn) {
  if (!active()) throw new PluginApiInactiveError()
}

/**
 * Validate the open envelope; the official spec is derived from it with the
 * unit name namespaced per owner and scope. Envelope fields stay on the
 * returned handle so the plugin can audit its own records.
 */
function validateOpen(input) {
  const bad = (reason) => ({ ok: false, reason })
  if (!isObject(input)) return bad('open input must be an object')
  const { scope, owner, schema, version, name, tables, global } = input
  if (!STORAGE_SCOPES.includes(scope)) {
    return bad(`scope must be exactly one of ${STORAGE_SCOPES.join(', ')}`)
  }
  if (typeof owner !== 'string' || owner.trim() === '' || !STORAGE_UNIT_NAME_RE.test(owner)) {
    return bad('owner must be a non-empty lowercase identifier matching [a-z][a-z0-9_]*')
  }
  if (typeof schema !== 'string' || schema.trim() === '') {
    return bad('schema must be a non-empty schema id')
  }
  if (!Number.isInteger(version) || version < 0) {
    return bad('version must be a non-negative integer')
  }
  if (typeof name !== 'string' || !STORAGE_UNIT_NAME_RE.test(name)) {
    return bad('name must match [a-z][a-z0-9_]*')
  }
  if (tables !== undefined && !isObject(tables)) {
    return bad('tables must be an object of table declarations when provided')
  }
  const unitName = `${scope}__${owner}__${name}`
  return {
    ok: true,
    envelope: deepFreeze({ scope, owner, schema, version, name }),
    spec: Object.freeze({
      name: unitName,
      version,
      tables: tables ?? Object.freeze({}),
      ...(global !== undefined ? { global } : {}),
    }),
  }
}

/**
 * Map official facility open failures to the typed vocabulary while
 * preserving the official error identity in `official`.
 */
function mapOpenError(error, envelope) {
  const code = error?.code && typeof error.code === 'string' ? error.code : undefined
  const message = error instanceof Error ? error.message : String(error)
  let typed = code
  if (code === 'version-mismatch') typed = 'unsupported-schema'
  else if (code === 'already-open') typed = 'conflict'
  else if (code === 'backend-not-found') typed = 'backend-unavailable'
  else if (code === 'facet-unsupported' || code === 'malformed-medium' || code === 'invalid-record') typed = code
  else typed = 'unavailable'
  return Object.freeze({
    ok: false,
    code: typed,
    reason: `storage open failed (${message})`,
    ...(code ? { official: code } : {}),
    ...(envelope ? { envelope } : {}),
  })
}

function setEpoch() {
  return Object.freeze({})
}

/**
 * Build the disabled storage face: shape-preserving, every member typed.
 */
export function createDisabledStorageApi(active = () => false, reason = 'official storage domain facility is unavailable') {
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError(STORAGE_FEATURE, reason)
  }
  return Object.freeze({
    get isActive() { return false },
    open: fail,
  })
}

/**
 * Build the active storage binding. Resolves the official storage domain
 * facility at construction; a missing facility yields the disabled face so
 * the rest of the facade keeps publishing.
 */
export function createStorageBinding({ ctx, active = true, logger } = {}) {
  const isActive = typeof active === 'function' ? active : () => Boolean(active)
  const facility = resolveFacility(ctx)
  if (!facility) return createDisabledStorageApi(isActive)

  const open = async (input = {}) => {
    assertActive(isActive)
    const validated = validateOpen(input)
    if (!validated.ok) {
      return Object.freeze({ ok: false, code: 'invalid-input', reason: validated.reason })
    }
    let domain
    try {
      domain = await facility.open(validated.spec)
    } catch (error) {
      return mapOpenError(error, validated.envelope)
    }
    if (!domain || typeof domain.close !== 'function') {
      return Object.freeze({
        ok: false,
        code: 'unavailable',
        reason: 'official storage domain facility returned a malformed domain handle',
        envelope: validated.envelope,
      })
    }
    const close = async () => {
      assertActive(isActive)
      try {
        await domain.close()
      } catch (error) {
        return Object.freeze({ ok: false, code: 'unavailable', reason: `storage close failed: ${error instanceof Error ? error.message : String(error)}` })
      }
      return Object.freeze({ ok: true, code: 'closed', envelope: validated.envelope })
    }
    const purge = async () => {
      assertActive(isActive)
      try {
        for (const tableName of Object.keys(validated.spec.tables)) {
          const table = domain.table?.(tableName)
          if (!table) continue
          for (const key of [...table.keys()]) {
            await table.delete(key)
          }
        }
      } catch (error) {
        return Object.freeze({
          ok: false,
          code: 'unavailable',
          reason: `storage purge failed: ${error instanceof Error ? error.message : String(error)}`,
        })
      }
      return Object.freeze({ ok: true, code: 'purged', envelope: validated.envelope })
    }
    return Object.freeze({
      ok: true,
      code: 'opened',
      envelope: validated.envelope,
      handle: Object.freeze({ close, purge, domain }),
    })
  }

  return Object.freeze({
    get isActive() { return isActive() },
    open,
    availability: () => Object.freeze({
      status: 'active',
      scope: 'process',
      durability: 'official-backend',
      epoch: setEpoch(),
    }),
  })
}