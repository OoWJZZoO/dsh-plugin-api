import { join } from 'node:path'
import { constants } from 'node:fs'
import { mkdir, open, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { sha256 } from './pipeline-core.js'

function segment(value) {
  return Buffer.from(String(value)).toString('base64url')
}

function recordPath(root, record) {
  return join(root, 'records', record.scope, segment(record.ownerId), `${segment(record.recordId)}.json`)
}

function objectPath(root, attachmentId) {
  const digest = String(attachmentId).slice('sha256:'.length)
  return join(root, 'objects', digest.slice(0, 2), digest)
}

function objectMetadataPath(root, attachmentId) {
  return `${objectPath(root, attachmentId)}.meta.json`
}

function integrityError(message) {
  const error = new Error(message)
  error.code = 'ATTACHMENT_CORRUPT'
  return error
}

function validateRecordMetadata(record) {
  const media = record?.media
  if (!media || typeof media.mediaType !== 'string' || !Number.isInteger(media.bytes) || media.bytes < 0) {
    throw integrityError('attachment record metadata is invalid')
  }
  for (const key of ['width', 'height']) {
    if (media[key] !== undefined && (!Number.isInteger(media[key]) || media[key] <= 0)) {
      throw integrityError('attachment record dimensions are invalid')
    }
  }
  if (media.durationMs !== undefined && (typeof media.durationMs !== 'number' || !Number.isFinite(media.durationMs) || media.durationMs < 0)) {
    throw integrityError('attachment record duration metadata is invalid')
  }
}

function persistentMetadata(record, data) {
  const media = record.media
  return {
    mediaType: media.mediaType,
    bytes: media.bytes,
    length: data.byteLength,
    ...(media.width === undefined ? {} : { width: media.width }),
    ...(media.height === undefined ? {} : { height: media.height }),
    ...(media.durationMs === undefined ? {} : { durationMs: media.durationMs }),
  }
}

function validatePersistentMetadata(record, metadata, dataLength) {
  validateRecordMetadata(record)
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw integrityError('pipeline object metadata is missing')
  const expected = persistentMetadata(record, { byteLength: dataLength })
  for (const key of ['mediaType', 'bytes', 'length', 'width', 'height', 'durationMs']) {
    if (metadata[key] !== expected[key]) throw integrityError('pipeline object metadata does not match its record')
  }
  if (!Number.isInteger(metadata.bytes) || metadata.bytes < 0 || !Number.isInteger(metadata.length) || metadata.length < 0) {
    throw integrityError('pipeline object metadata lengths are invalid')
  }
  return true
}

async function readPersistentMetadata(path, signal) {
  try {
    return JSON.parse(await readFile(path, { encoding: 'utf8', signal }))
  } catch (error) {
    if (error?.code === 'ENOENT') throw error
    throw integrityError('pipeline object metadata is unreadable')
  }
}

async function syncDirectory(path) {
  if (process.platform === 'win32') return
  const handle = await open(path, constants.O_RDONLY)
  try { await handle.sync() } finally { await handle.close() }
}

async function ensureDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 })
}

async function atomicWrite(path, content) {
  await ensureDirectory(join(path, '..'))
  const temporary = `${path}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`
  await writeFile(temporary, content, { mode: 0o600 })
  const handle = await open(temporary, constants.O_RDONLY)
  try { await handle.sync() } finally { await handle.close() }
  await rename(temporary, path)
  await syncDirectory(join(path, '..'))
}

// Every journal instance in this process shares the object lock.  This makes
// the global reference scan and the following unlink atomic with respect to
// all attachment pipeline owners in this process.
const objectLocks = new Map()

async function withObjectLock(key, operation) {
  const previous = objectLocks.get(key)
  let release
  const current = new Promise((resolve) => { release = resolve })
  objectLocks.set(key, current)
  if (previous) await previous
  try {
    return await operation()
  } finally {
    release()
    if (objectLocks.get(key) === current) objectLocks.delete(key)
  }
}

/** Durable pipeline journal. Public records never expose internal paths. */
export function createJournal(root) {
  const journalRoot = join(root, 'pipeline')

  async function readRecordDirectory(directory, scope, ownerId) {
    let entries
    try { entries = await readdir(directory, { withFileTypes: true }) } catch (error) {
      if (error?.code === 'ENOENT') return []
      throw error
    }
    const result = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json') || entry.name.endsWith('.meta.json')) continue
      const path = join(directory, entry.name)
      try {
        const value = JSON.parse(await readFile(path, 'utf8'))
        if (value?.record?.ownerId === ownerId && value.record.scope === scope) result.push(value)
      } catch (error) {
        result.push({ corrupt: true, path, error })
      }
    }
    return result
  }

  async function put(record, { data, officialRef } = {}) {
    validateRecordMetadata(record)
    const path = recordPath(journalRoot, record)
    if (officialRef) {
      if (
        officialRef.attachmentId !== record.attachmentId
        || officialRef.mediaType !== record.media.mediaType
        || officialRef.bytes !== record.media.bytes
        || officialRef.width !== record.media.width
        || officialRef.height !== record.media.height
        || officialRef.durationMs !== record.media.durationMs
        || data && sha256(data) !== record.attachmentId
        || data && data.byteLength !== record.media.bytes
      ) throw integrityError('official attachment reference failed journal verification')
      const envelope = { record, storage: { kind: 'official', ref: officialRef } }
      await atomicWrite(path, JSON.stringify(envelope))
      return envelope
    }

    const digest = record.attachmentId
    if (!data) throw new Error('pipeline journal requires bytes for non-official storage')
    if (sha256(data) !== digest || data.byteLength !== record.media.bytes) throw integrityError('pipeline object failed journal verification')
    return withObjectLock(digest, async () => {
      const object = objectPath(journalRoot, digest)
      const metadataPath = objectMetadataPath(journalRoot, digest)
      await ensureDirectory(join(object, '..'))
      let objectExists = false
      try {
        const existing = new Uint8Array(await readFile(object))
        objectExists = true
        const metadata = await readPersistentMetadata(metadataPath)
        if (existing.byteLength !== record.media.bytes || sha256(existing) !== digest) throw integrityError('existing pipeline object failed integrity verification')
        validatePersistentMetadata(record, metadata, existing.byteLength)
      } catch (error) {
        // A missing object is the only case in which a new object may be
        // created.  A present object without its persistent metadata is
        // unverifiable and must fail closed rather than being silently
        // adopted by a new record.
        if (error?.code !== 'ENOENT') throw error
        if (objectExists) throw integrityError('pipeline object metadata is missing')
        await atomicWrite(object, data)
        await atomicWrite(metadataPath, JSON.stringify(persistentMetadata(record, data)))
      }
      const envelope = { record, storage: { kind: 'pipeline', attachmentId: digest } }
      // Publish the record while the object lock is held so cleanup cannot
      // observe an unreferenced object between object creation and record put.
      await atomicWrite(path, JSON.stringify(envelope))
      return envelope
    })
  }

  async function list(scope, ownerId) {
    return readRecordDirectory(join(journalRoot, 'records', scope, segment(ownerId)), scope, ownerId)
  }

  async function listAll() {
    const root = join(journalRoot, 'records')
    let scopes
    try { scopes = await readdir(root, { withFileTypes: true }) } catch (error) {
      if (error?.code === 'ENOENT') return []
      throw error
    }
    const result = []
    for (const scopeEntry of scopes) {
      if (!scopeEntry.isDirectory()) continue
      const scope = scopeEntry.name
      const scopePath = join(root, scope)
      let owners
      try { owners = await readdir(scopePath, { withFileTypes: true }) } catch { continue }
      for (const ownerEntry of owners) {
        if (!ownerEntry.isDirectory()) continue
        let ownerId
        try { ownerId = Buffer.from(ownerEntry.name, 'base64url').toString() } catch { continue }
        result.push(...await readRecordDirectory(join(scopePath, ownerEntry.name), scope, ownerId))
      }
    }
    return result
  }

  async function latest(scope, ownerId) {
    const records = await list(scope, ownerId)
    const valid = records.filter((envelope) => {
      if (envelope?.corrupt || !envelope?.record) return false
      try {
        validateRecordMetadata(envelope.record)
        return envelope.record.ownerId === ownerId && envelope.record.scope === scope && typeof envelope.record.createdAt === 'string'
      } catch { return false }
    })
    valid.sort((left, right) => {
      const time = String(right.record.createdAt).localeCompare(String(left.record.createdAt))
      return time || String(right.record.recordId).localeCompare(String(left.record.recordId))
    })
    return valid[0]
  }

  async function find({ scope, ownerId, generation, attachmentId, recordId } = {}) {
    const records = await list(scope, ownerId)
    for (const envelope of records) {
      if (envelope.corrupt) return envelope
      const record = envelope.record
      if (recordId && record.recordId !== recordId) continue
      if (generation !== undefined && record.generation !== generation) continue
      if (attachmentId !== undefined && record.attachmentId !== attachmentId) continue
      return envelope
    }
    return undefined
  }

  async function readBytes(envelope, signal) {
    if (envelope?.storage?.kind !== 'pipeline') throw new Error('journal envelope has no pipeline object')
    signal?.throwIfAborted?.()
    let data
    let metadata
    try {
      data = new Uint8Array(await readFile(objectPath(journalRoot, envelope.storage.attachmentId), { signal }))
    } catch (error) {
      signal?.throwIfAborted?.()
      if (error?.code === 'ENOENT') {
        const missing = new Error('pipeline object is missing')
        missing.code = 'ATTACHMENT_NOT_FOUND'
        throw missing
      }
      throw error
    }
    try {
      metadata = await readPersistentMetadata(objectMetadataPath(journalRoot, envelope.storage.attachmentId), signal)
    } catch (error) {
      signal?.throwIfAborted?.()
      if (error?.code === 'ENOENT') throw integrityError('pipeline object metadata is missing')
      throw error
    }
    signal?.throwIfAborted?.()
    if (sha256(data) !== envelope.record.attachmentId) throw integrityError('pipeline object failed integrity verification')
    validatePersistentMetadata(envelope.record, metadata, data.byteLength)
    return data
  }

  async function remove(envelope, { signal, canRemove } = {}) {
    if (!envelope?.record) return false
    const digest = envelope.storage?.kind === 'pipeline' ? envelope.storage.attachmentId : undefined
    const operation = async () => {
      const path = recordPath(journalRoot, envelope.record)
      let recordRemoved = false
      let objectRemoved = false
      let metadataRemoved = false
      let objectData
      let metadataData
      const restoreRecord = async () => {
        if (!recordRemoved) return
        await atomicWrite(path, JSON.stringify(envelope))
        recordRemoved = false
      }
      const restoreObject = async () => {
        if (objectRemoved && objectData) await atomicWrite(objectPath(journalRoot, digest), objectData)
        if (metadataRemoved && metadataData) await atomicWrite(objectMetadataPath(journalRoot, digest), metadataData)
        objectRemoved = false
        metadataRemoved = false
      }
      const canDelete = (kind) => {
        signal?.throwIfAborted?.()
        return typeof canRemove !== 'function' || canRemove(envelope, kind)
      }
      try {
        if (!canDelete('record')) return false
        try {
          await unlink(path)
          recordRemoved = true
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error
        }
        if (!canDelete('record')) {
          await restoreRecord()
          return false
        }
        if (recordRemoved) await syncDirectory(join(path, '..'))
        if (!canDelete('record')) {
          await restoreRecord()
          return false
        }
        if (envelope.storage?.kind !== 'pipeline') return true
        const references = await listAll()
        const stillReferenced = references.some((candidate) => candidate?.record && candidate.storage?.kind === 'pipeline' && candidate.storage.attachmentId === digest)
        if (!canDelete('object')) {
          await restoreRecord()
          return false
        }
        if (stillReferenced) return true
        try {
          objectData = await readFile(objectPath(journalRoot, digest))
          metadataData = await readFile(objectMetadataPath(journalRoot, digest))
        } catch (error) {
          if (error?.code === 'ENOENT') return true
          throw error
        }
        if (!canDelete('object')) {
          await restoreRecord()
          return false
        }
        // Recheck directly before unlink: generation/caller guards and the
        // global reference proof all still hold at the destructive boundary.
        if ((await listAll()).some((candidate) => candidate?.record && candidate.storage?.kind === 'pipeline' && candidate.storage.attachmentId === digest)) return true
        if (!canDelete('object')) {
          await restoreRecord()
          return false
        }
        await unlink(objectPath(journalRoot, digest))
        objectRemoved = true
        try {
          await unlink(objectMetadataPath(journalRoot, digest))
          metadataRemoved = true
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error
        }
        if (!canDelete('object')) {
          await restoreObject()
          await restoreRecord()
          return false
        }
        await syncDirectory(join(objectPath(journalRoot, digest), '..'))
        if (!canDelete('object')) {
          await restoreObject()
          await restoreRecord()
          return false
        }
        return true
      } catch (error) {
        await restoreObject().catch(() => {})
        await restoreRecord().catch(() => {})
        throw error
      }
    }
    return digest ? withObjectLock(digest, operation) : operation()
  }

  return Object.freeze({
    root: journalRoot,
    put,
    list,
    listAll,
    latest,
    find,
    readBytes,
    remove,
  })
}
