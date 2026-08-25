import { Service } from '@deepseek-ai/cordis'
import { extname } from 'node:path'
import { createJournal } from './journal.js'
import {
  BLOB_MEDIA_TYPE,
  RASTER_MEDIA_TYPES,
  admissionEvidence,
  clonePublicRecord,
  createRecord,
  deepFreeze,
  effectiveMinimum,
  effectiveTransformPolicy,
  failure,
  isRasterMedia,
  isSafePublicText,
  isTimedMedia,
  normalizeMediaType,
  opaqueId,
  parseDataUri,
  sha256,
  sourceProvenance,
  success,
  transformPolicyEvidence,
  validateDurationPolicy,
  validateIdentity,
  validateTransformRegistration,
  copyBytes,
} from './pipeline-core.js'
import { ATTACHMENT_OWNER_SYMBOL, ownsAttachmentRoot } from './contract.js'

const DEFAULT_PIPELINE_CONCURRENCY = 4
const DEFAULT_PIPELINE_DEADLINE_MS = 30_000
const TRANSFORM_KEY_SEPARATOR = '\u0000'

function isAbort(error, signal) {
  return Boolean(signal?.aborted) || error?.name === 'AbortError' || error?.code === 'ABORT_ERR' || error?.code === 'FS_ABORTED'
}

function resultFromError(error, signal, fallbackCode = 'ATTACHMENT_OPERATION_FAILED') {
  if (isAbort(error, signal)) return failure('aborted', 'ATTACHMENT_ABORTED', 'caller cancellation aborted the attachment operation')
  const code = typeof error?.code === 'string' ? error.code : fallbackCode
  const denied = new Set(['IMAGE_TOO_LARGE', 'IMAGE_TOO_MANY_PIXELS', 'FS_TOO_LARGE', 'ATTACHMENT_SIZE_TOO_LARGE', 'ATTACHMENT_DURATION_TOO_LONG', 'ATTACHMENT_TRANSFORM_DENIED'])
  const unavailable = new Set(['INVALID_IMAGE', 'IMAGE_TYPE_MISMATCH', 'ATTACHMENT_CORRUPT', 'ATTACHMENT_NOT_FOUND', 'ATTACHMENT_READ_FAILED', 'INVALID_ATTACHMENT_REF'])
  const outcome = denied.has(code) ? 'denied' : unavailable.has(code) ? 'unavailable' : 'error'
  return failure(outcome, code, typeof error?.message === 'string' ? error.message : 'attachment operation failed')
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    const error = signal.reason instanceof Error ? signal.reason : Object.assign(new Error('aborted'), { name: 'AbortError', code: 'ABORT_ERR' })
    throw error
  }
}

function combineCallerSignals(...signals) {
  const present = signals.filter((signal) => signal && typeof signal.addEventListener === 'function')
  if (present.length <= 1) return { signal: present[0], cleanup: () => {} }
  const controller = new AbortController()
  const listeners = []
  const abort = (signal) => {
    if (!controller.signal.aborted) controller.abort(signal.reason)
  }
  for (const signal of present) {
    const listener = () => abort(signal)
    listeners.push([signal, listener])
    if (signal.aborted) abort(signal)
    else signal.addEventListener('abort', listener, { once: true })
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      for (const [signal, listener] of listeners) signal.removeEventListener?.('abort', listener)
    },
  }
}

function inferMediaType(path) {
  const suffix = extname(path ?? '').toLowerCase()
  return ({
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  })[suffix]
}

function normalizeConfig(config, store) {
  const source = config && typeof config === 'object' ? config : {}
  const nested = source.pipeline && typeof source.pipeline === 'object' ? source.pipeline : {}
  const maxImageBytes = store?.imageLimits?.maxImageBytes
  return Object.freeze({
    maxDurationMs: Object.prototype.hasOwnProperty.call(source, 'maxDurationMs') ? source.maxDurationMs : nested.maxDurationMs,
    maxBytes: Object.prototype.hasOwnProperty.call(source, 'maxPipelineBytes') ? source.maxPipelineBytes : (nested.maxBytes ?? maxImageBytes),
    maxConcurrency: Object.prototype.hasOwnProperty.call(source, 'maxPipelineConcurrency') ? source.maxPipelineConcurrency : (nested.maxConcurrency ?? DEFAULT_PIPELINE_CONCURRENCY),
    deadlineMs: Object.prototype.hasOwnProperty.call(source, 'maxPipelineDeadlineMs') ? source.maxPipelineDeadlineMs : (nested.deadlineMs ?? DEFAULT_PIPELINE_DEADLINE_MS),
    maxBatchBytes: nested.maxBatchBytes,
    decoders: source.decoders ?? nested.decoders,
  })
}

function effectiveLimit(...values) {
  const present = values.filter((value) => value !== undefined)
  if (!present.length) return { value: undefined, invalid: false }
  if (present.some((value) => typeof value !== 'number' || !Number.isFinite(value))) return { value: undefined, invalid: true }
  return { value: Math.min(...present), invalid: false }
}

function registrationKey(ownerId, id) {
  return `${ownerId}${TRANSFORM_KEY_SEPARATOR}${id}`
}

function markOperationToken(token, status, code, message) {
  if (!token) return
  token.active = false
  token.status = status
  token.code = code
  token.message = message
}

async function callDecoder(decoder, bytes, mediaType, signal) {
  if (!decoder) return undefined
  const value = typeof decoder === 'function'
    ? await decoder(bytes, { mediaType, signal })
    : await decoder.decode(bytes, { mediaType, signal })
  if (value === undefined || value === null) return undefined
  if (typeof value === 'number') return { durationMs: value }
  if (value.metadata && typeof value.metadata === 'object') return value.metadata
  return value
}

function publicRoute(route) {
  if (!isSafePublicText(route?.id)) return null
  if (route.provider !== undefined && !isSafePublicText(route.provider)) return null
  if (route.model !== undefined && !isSafePublicText(route.model)) return null
  return {
    id: route.id,
    ...(typeof route.provider === 'string' ? { provider: route.provider } : {}),
    ...(typeof route.model === 'string' ? { model: route.model } : {}),
  }
}

/** Host-owned mutation and read-only projection services for the R row. */
export class AttachmentPipelineService extends Service {
  constructor(ctx, { store, config, ownerToken } = {}) {
    super(ctx, 'attachmentsPipeline')
    this.store = store
    this.ownerToken = ownerToken
    this.config = normalizeConfig(config, store)
    this.journal = createJournal(store?.root)
    this.transforms = new Map()
    this.current = new Map()
    this._currentLoads = new Map()
    this.activeRecords = new Map()
    this._activeIngestKeys = new Map()
    this._ingestInFlight = 0
    this.disposed = false
    this._lifetime = new AbortController()

    const pipeline = {
      ingest: (source, options) => this.ingest(source, options),
      transform: (input, operation, options) => this.transform(input, operation, options),
      registerTransform: (capability) => this.registerTransform(capability),
      cleanup: (options) => this.cleanup(options),
      capabilities: () => this.capabilities(),
    }
    const projection = {
      resolve: (reference) => this.resolve(reference),
      open: (reference, signal) => this.open(reference, signal),
      project: (reference, options) => this.project(reference, options),
      provenance: (reference) => this.provenance(reference),
      availability: () => this.availability(),
    }
    this.pipeline = deepFreeze(pipeline)
    this.projection = deepFreeze(projection)

    try {
      ctx.effect(() => () => this.dispose(), 'attachment pipeline lifecycle')
    } catch {
      // A direct unit-test context may not expose effects; service methods
      // remain usable and apply's contract probe will still see the shape.
    }
  }

  dispose() {
    if (this.disposed) return false
    this.disposed = true
    this._lifetime.abort(new Error('attachment pipeline disposed'))
    for (const registration of this.transforms.values()) registration.active = false
    this.transforms.clear()
    this.activeRecords.clear()
    this._activeIngestKeys.clear()
    const root = this.ctx?.root ?? this.ctx
    if (ownsAttachmentRoot(root, this.ownerToken)) {
      try { delete root[ATTACHMENT_OWNER_SYMBOL] } catch { /* marker removal is best effort */ }
    }
    return true
  }

  _unavailableIfDisposed() {
    return this.disposed ? failure('unavailable', 'ATTACHMENT_PIPELINE_UNAVAILABLE', 'attachment pipeline is unavailable') : null
  }

  availability() {
    if (this.disposed) return deepFreeze({ status: 'unavailable', supportedMedia: [], limits: {} })
    const imageLimits = {
      maxImageBytes: this.store?.imageLimits?.maxImageBytes,
      maxImagesPerMessage: this.store?.imageLimits?.maxImagesPerMessage,
      maxMessageImageBytes: this.store?.imageLimits?.maxMessageImageBytes,
      maxImagePixels: this.store?.imageLimits?.maxImagePixels,
      mediaTypes: Array.isArray(this.store?.imageLimits?.mediaTypes) ? [...this.store.imageLimits.mediaTypes] : [],
    }
    return deepFreeze({
      status: 'active',
      supportedMedia: [...RASTER_MEDIA_TYPES, BLOB_MEDIA_TYPE, 'audio/*', 'video/*'],
      imageLimits,
      limits: {
        ...imageLimits,
        maxDurationMs: this.config.maxDurationMs,
        maxBytes: this.config.maxBytes,
        maxConcurrency: this.config.maxConcurrency,
        deadlineMs: this.config.deadlineMs,
      },
    })
  }

  capabilities() {
    return this.availability()
  }

  _beginIngest(options = {}) {
    if (options.signal?.aborted) {
      return { failure: failure('aborted', 'ATTACHMENT_ABORTED', 'caller cancellation aborted the attachment operation') }
    }
    const concurrency = effectiveLimit(this.config.maxConcurrency, options.concurrency)
    if (concurrency.invalid || concurrency.value !== undefined && (!Number.isInteger(concurrency.value) || concurrency.value <= 0)) {
      return { failure: failure('unavailable', 'ATTACHMENT_POLICY_INVALID', 'concurrency policy is invalid') }
    }
    const capacity = concurrency.value ?? DEFAULT_PIPELINE_CONCURRENCY
    if (this._ingestInFlight >= capacity) {
      return { failure: failure('unavailable', 'ATTACHMENT_SOURCE_UNAVAILABLE', 'source concurrency limit is exhausted') }
    }
    const deadline = effectiveLimit(this.config.deadlineMs, options.deadlineMs)
    if (deadline.invalid || deadline.value !== undefined && (!Number.isFinite(deadline.value) || deadline.value <= 0)) {
      return { failure: failure('unavailable', 'ATTACHMENT_POLICY_INVALID', 'deadline policy is invalid') }
    }
    const controller = new AbortController()
    const token = { active: true, status: 'unavailable', code: 'ATTACHMENT_SOURCE_UNAVAILABLE', message: 'source operation exceeded its deadline' }
    let resolveTermination
    let settled = false
    let timer
    let callerAborted = false
    const termination = new Promise((resolve) => { resolveTermination = resolve })
    const onAbort = () => {
      if (settled) return
      callerAborted = true
      token.active = false
      token.status = 'aborted'
      token.code = 'ATTACHMENT_ABORTED'
      token.message = 'caller cancellation aborted the attachment operation'
      controller.abort(options.signal.reason)
      resolveTermination({ kind: 'aborted' })
    }
    options.signal?.addEventListener?.('abort', onAbort, { once: true })
    const duration = deadline.value ?? DEFAULT_PIPELINE_DEADLINE_MS
    timer = setTimeout(() => {
      if (settled || callerAborted) return
      token.active = false
      controller.abort(new Error('attachment source deadline exceeded'))
      resolveTermination({ kind: 'deadline' })
    }, duration)
    this._ingestInFlight += 1
    const ingestKey = `${options.scope}${TRANSFORM_KEY_SEPARATOR}${options.ownerId}`
    this._retainIngestKey(ingestKey)
    return {
      signal: controller.signal,
      token,
      termination,
      release: () => {
        if (settled) return false
        settled = true
        clearTimeout(timer)
        options.signal?.removeEventListener?.('abort', onAbort)
        this._ingestInFlight = Math.max(0, this._ingestInFlight - 1)
        this._releaseIngestKey(ingestKey)
        token.active = false
        return true
      },
    }
  }

  _retainIngestKey(key) {
    this._activeIngestKeys.set(key, (this._activeIngestKeys.get(key) ?? 0) + 1)
  }

  _releaseIngestKey(key) {
    const count = this._activeIngestKeys.get(key) ?? 0
    if (count <= 1) this._activeIngestKeys.delete(key)
    else this._activeIngestKeys.set(key, count - 1)
  }

  _retainActiveRecord(recordId) {
    this.activeRecords.set(recordId, (this.activeRecords.get(recordId) ?? 0) + 1)
  }

  _releaseActiveRecord(recordId) {
    const count = this.activeRecords.get(recordId) ?? 0
    if (count <= 1) this.activeRecords.delete(recordId)
    else this.activeRecords.set(recordId, count - 1)
  }

  async _ensureCurrent(scope, ownerId) {
    const key = `${scope}${TRANSFORM_KEY_SEPARATOR}${ownerId}`
    if (this.current.has(key)) return this.current.get(key)
    const pending = this._currentLoads.get(key)
    if (pending) return pending
    const load = this.journal.latest(scope, ownerId).then((envelope) => {
      const value = envelope?.record
        ? { generation: envelope.record.generation, recordId: envelope.record.recordId }
        : null
      this.current.set(key, value)
      return value
    }).catch(() => {
      // A failed recovery is fail-closed.  Cache the empty result for this
      // service lifetime so a transient read cannot make every guard guess.
      this.current.set(key, null)
      return null
    }).finally(() => this._currentLoads.delete(key))
    this._currentLoads.set(key, load)
    return load
  }

  _operationFailure(token) {
    if (!token) return null
    if (typeof token.validate === 'function') {
      const validation = token.validate()
      if (validation) return validation
    }
    if (token.active) return null
    return failure(token.status, token.code, token.message)
  }

  async _readSource(source, options = {}) {
    throwIfAborted(options.signal)
    if (!source || typeof source !== 'object' || typeof source.kind !== 'string') return failure('error', 'ATTACHMENT_SOURCE_INVALID', 'source kind is required')
    let data
    let mediaType = normalizeMediaType(source.mediaType ?? options.mediaType)
    let name = source.name ?? options.name
    switch (source.kind) {
      case 'file': {
        if (typeof source.path !== 'string' || source.path.length === 0) return failure('error', 'ATTACHMENT_SOURCE_INVALID', 'file source path is required')
        try {
          const fsService = this.ctx?.get?.('fs')
          if (typeof fsService?.resolve !== 'function' || typeof fsService?.readBytes !== 'function') {
            return failure('unavailable', 'ATTACHMENT_SOURCE_UNAVAILABLE', 'approved fs read seam is unavailable')
          }
          const bytesLimit = effectiveLimit(this.config.maxBytes, options.maxBytes)
          if (bytesLimit.invalid || bytesLimit.value === undefined || bytesLimit.value <= 0) return failure('unavailable', 'ATTACHMENT_POLICY_INVALID', 'byte policy is invalid')
          const target = await fsService.resolve(source.path, { signal: options.signal })
          data = copyBytes(await fsService.readBytes(target, options.signal, bytesLimit.value))
        } catch (error) { return resultFromError(error, options.signal, 'ATTACHMENT_SOURCE_UNAVAILABLE') }
        mediaType ??= inferMediaType(source.path)
        name ??= source.path
        break
      }
      case 'paste':
        data = copyBytes(source.bytes)
        break
      case 'data-uri': {
        const parsed = parseDataUri(source.uri)
        if (parsed?.status) return parsed
        data = parsed.data
        mediaType ??= parsed.mediaType
        break
      }
      case 'remote': {
        if (options.trust !== true && options.trust !== 'trusted' && source.trust !== true && source.trust !== 'trusted') return failure('unavailable', 'ATTACHMENT_SOURCE_UNTRUSTED', 'remote source requires explicit trust evidence')
        if (typeof source.url !== 'string' || !source.url) return failure('error', 'ATTACHMENT_SOURCE_INVALID', 'remote source URL is required')
        let web
        try { web = this.ctx?.get?.('web') } catch { web = undefined }
        if (!web || typeof web.fetch !== 'function') return failure('unavailable', 'ATTACHMENT_REMOTE_UNAVAILABLE', 'approved web fetch seam is unavailable')
        try {
          const remoteLimit = effectiveLimit(this.config.maxBytes, options.maxBytes)
          if (remoteLimit.invalid || remoteLimit.value === undefined || remoteLimit.value <= 0) return failure('unavailable', 'ATTACHMENT_POLICY_INVALID', 'byte policy is invalid')
          // The official web seam is deliberately text-shaped.  Do not call
          // it like fetch(url, init), and do not consume Response/data/
          // arrayBuffer fields that are outside its public contract.
          const response = await web.fetch({ url: source.url }, options.signal)
          const body = response?.body
          if (!body || (body.kind !== 'html' && body.kind !== 'text') || typeof body.content !== 'string' || response?.truncated === true) {
            return failure('unavailable', 'ATTACHMENT_REMOTE_UNAVAILABLE', 'official web fetch returned an unsupported body shape')
          }
          data = new TextEncoder().encode(body.content)
          mediaType ??= body.kind === 'html' ? 'text/html' : 'text/plain'
          if (data.byteLength > remoteLimit.value) return failure('denied', 'ATTACHMENT_SIZE_TOO_LARGE', 'remote source exceeds the configured byte limit')
        } catch (error) { return resultFromError(error, options.signal, 'ATTACHMENT_REMOTE_UNAVAILABLE') }
        break
      }
      case 'mcp-resource': {
        if (options.trust !== true && options.trust !== 'trusted' && source.trust !== true && source.trust !== 'trusted') return failure('unavailable', 'ATTACHMENT_SOURCE_UNTRUSTED', 'MCP resource requires explicit trust evidence')
        const resource = source.resource
        if (resource?.data !== undefined) {
          data = copyBytes(resource.data)
          mediaType ??= normalizeMediaType(resource.mediaType)
        } else if (typeof resource?.resolver === 'function') {
          try {
            const resolved = await resource.resolver(options.signal)
            data = copyBytes(resolved?.data)
            mediaType ??= normalizeMediaType(resolved?.mediaType)
          } catch (error) { return resultFromError(error, options.signal, 'ATTACHMENT_MCP_UNAVAILABLE') }
        } else {
          return failure('unavailable', 'ATTACHMENT_MCP_UNAVAILABLE', 'MCP resource data or resolver is unavailable')
        }
        break
      }
      default:
        return failure('error', 'ATTACHMENT_SOURCE_INVALID', 'source kind is unsupported')
    }
    if (!data) return failure('unavailable', 'ATTACHMENT_SOURCE_UNAVAILABLE', 'source bytes are unavailable')
    if (!mediaType) return failure('unavailable', 'ATTACHMENT_MEDIA_UNSUPPORTED', 'declared media type is required')
    const bytesLimit = effectiveLimit(this.config.maxBytes, options.maxBytes)
    if (bytesLimit.invalid || (bytesLimit.value !== undefined && (!Number.isFinite(bytesLimit.value) || bytesLimit.value <= 0))) return failure('unavailable', 'ATTACHMENT_POLICY_INVALID', 'byte policy is invalid')
    if (bytesLimit.value !== undefined && data.byteLength > bytesLimit.value) return failure('denied', 'ATTACHMENT_SIZE_TOO_LARGE', 'source exceeds the configured byte limit')
    return { data, mediaType, name, provenance: sourceProvenance(source, options) }
  }

  _decoder(mediaType, options = {}) {
    if (options.decoder) return options.decoder
    const decoders = this.config.decoders
    if (typeof decoders === 'function') return decoders(mediaType)
    if (decoders instanceof Map) return decoders.get(mediaType) ?? decoders.get(mediaType.split('/')[0] + '/*')
    return decoders?.[mediaType] ?? decoders?.[mediaType.split('/')[0] + '/*']
  }

  async _admit(data, mediaType, options = {}) {
    const normalized = normalizeMediaType(mediaType)
    if (!normalized) return failure('unavailable', 'ATTACHMENT_MEDIA_UNSUPPORTED', 'media type is unavailable')
    if (isRasterMedia(normalized)) {
      if (!this.store?.imageLimits?.mediaTypes?.includes(normalized)) return failure('unavailable', 'ATTACHMENT_MEDIA_UNSUPPORTED', 'raster media type is not supported by the official store')
      const imageLimit = effectiveLimit(this.store.imageLimits.maxImageBytes, this.config.maxBytes, options.maxBytes)
      if (imageLimit.invalid || imageLimit.value === undefined || imageLimit.value <= 0) return failure('unavailable', 'ATTACHMENT_POLICY_INVALID', 'image byte policy is invalid')
      if (data.byteLength > imageLimit.value) return failure('denied', 'IMAGE_TOO_LARGE', 'image exceeds the configured byte limit')
      try {
        await this.store.validateImage({ data, mediaType: normalized, ...(options.name ? { name: options.name } : {}) })
      } catch (error) { return resultFromError(error, options.signal, 'INVALID_IMAGE') }
      return { kind: 'image', media: { mediaType: normalized, bytes: data.byteLength } }
    }
    if (normalized === BLOB_MEDIA_TYPE) {
      const blobLimit = effectiveLimit(this.config.maxBytes, options.maxBytes)
      if (blobLimit.invalid || blobLimit.value !== undefined && (!Number.isFinite(blobLimit.value) || blobLimit.value <= 0)) {
        return failure('unavailable', 'ATTACHMENT_POLICY_INVALID', 'byte policy is invalid')
      }
      if (blobLimit.value !== undefined && data.byteLength > blobLimit.value) {
        return failure('denied', 'ATTACHMENT_SIZE_TOO_LARGE', 'binary attachment exceeds the configured byte limit')
      }
      return { kind: 'blob', media: { mediaType: normalized, bytes: data.byteLength } }
    }
    if (!isTimedMedia(normalized)) return failure('unavailable', 'ATTACHMENT_MEDIA_UNSUPPORTED', 'media type is not supported')
    let decoder
    try { decoder = this._decoder(normalized, options) } catch { return failure('unavailable', 'ATTACHMENT_MEDIA_UNSUPPORTED', 'approved duration decoder is unavailable') }
    if (!decoder) return failure('unavailable', 'ATTACHMENT_MEDIA_UNSUPPORTED', 'approved duration decoder is unavailable')
    let metadata
    try {
      metadata = await callDecoder(decoder, data, normalized, options.signal)
    } catch (error) {
      if (isAbort(error, options.signal)) return failure('aborted', 'ATTACHMENT_ABORTED', 'caller cancellation aborted decoder admission')
      return failure('unavailable', 'ATTACHMENT_MEDIA_UNSUPPORTED', 'approved decoder failed to provide reliable metadata')
    }
    if (!metadata || metadata.reliable === false || metadata.complete === false) return failure('unavailable', 'ATTACHMENT_MEDIA_UNSUPPORTED', 'decoder did not provide reliable complete metadata')
    const maxDuration = effectiveLimit(this.config.maxDurationMs, options.maxDurationMs)
    const durationFailure = validateDurationPolicy({ maxDurationMs: maxDuration.value, observedDurationMs: metadata.durationMs })
    if (maxDuration.invalid) return failure('unavailable', 'ATTACHMENT_POLICY_INVALID', 'maxDurationMs must be a finite non-negative millisecond value')
    if (durationFailure) return durationFailure
    const bytesLimit = effectiveLimit(this.config.maxBytes, options.maxBytes)
    if (bytesLimit.invalid || (bytesLimit.value !== undefined && data.byteLength > bytesLimit.value)) return failure('denied', 'ATTACHMENT_SIZE_TOO_LARGE', 'timed media exceeds the configured byte limit')
    return { kind: 'timed', media: { mediaType: normalized, bytes: data.byteLength, durationMs: metadata.durationMs }, decoderMetadata: metadata }
  }

  async _prepare(source, options = {}) {
    const identityFailure = validateIdentity(options)
    if (identityFailure) return identityFailure
    const loaded = await this._readSource(source, options)
    if (loaded?.status) return loaded
    const admitted = await this._admit(loaded.data, loaded.mediaType, { ...options, name: loaded.name })
    if (admitted?.status) return admitted
    return { ...loaded, ...admitted }
  }

  async _persist(prepared, options, extra = {}) {
    const operationFailure = this._operationFailure(options.operationToken)
    if (operationFailure) return operationFailure
    if (this.disposed) return failure('unavailable', 'ATTACHMENT_PIPELINE_UNAVAILABLE', 'attachment pipeline is unavailable')
    try { throwIfAborted(options.signal) } catch (error) { return resultFromError(error, options.signal, 'ATTACHMENT_WRITE_FAILED') }
    let ref
    try {
      const beforeSaveFailure = this._operationFailure(options.operationToken)
      if (beforeSaveFailure) return beforeSaveFailure
      if (prepared.kind === 'image' && options.storage !== 'pipeline') {
        ref = await this.store.saveImage({ data: prepared.data, mediaType: prepared.mediaType, ...(prepared.name ? { name: prepared.name } : {}) })
      }
      const afterSaveFailure = this._operationFailure(options.operationToken)
      if (afterSaveFailure) return afterSaveFailure
      try { throwIfAborted(options.signal) } catch (error) { return resultFromError(error, options.signal, 'ATTACHMENT_WRITE_FAILED') }
      const attachmentId = ref?.attachmentId ?? sha256(prepared.data)
      const media = ref
        ? { mediaType: ref.mediaType, bytes: ref.bytes, width: ref.width, height: ref.height }
        : prepared.media
      const recordResult = createRecord({
        recordId: opaqueId('record'),
        ownerId: options.ownerId,
        generation: options.generation,
        scope: options.scope,
        attachmentId,
        media,
        name: prepared.name,
        origin: extra.origin ?? 'original',
        parent: extra.parent,
        operation: extra.operation,
        sourceProvenance: extra.provenance ?? prepared.provenance,
      })
      if (recordResult?.status) return recordResult
      const beforeJournalFailure = this._operationFailure(options.operationToken)
      if (beforeJournalFailure) return beforeJournalFailure
      try { throwIfAborted(options.signal) } catch (error) { return resultFromError(error, options.signal, 'ATTACHMENT_WRITE_FAILED') }
      const envelope = await this.journal.put(recordResult, ref ? { officialRef: ref, data: prepared.data } : { data: prepared.data })
      const afterWriteFailure = this._operationFailure(options.operationToken)
      if (afterWriteFailure) {
        await this.journal.remove(envelope).catch(() => {})
        return afterWriteFailure
      }
      this.current.set(`${options.scope}${TRANSFORM_KEY_SEPARATOR}${options.ownerId}`, { generation: options.generation, recordId: recordResult.recordId })
      return success(recordResult)
    } catch (error) {
      return resultFromError(error, options.signal, 'ATTACHMENT_WRITE_FAILED')
    }
  }

  async ingest(source, options = {}) {
    const inactive = this._unavailableIfDisposed()
    if (inactive) return inactive
    const gate = this._beginIngest(options)
    if (gate.failure) return gate.failure
    const operationOptions = { ...options, signal: gate.signal, operationToken: gate.token }
    const operation = Array.isArray(source) || Array.isArray(options.batch)
      ? this._ingestBatch(Array.isArray(source) ? source : options.batch, operationOptions)
      : this._prepare(source, operationOptions).then((prepared) => prepared?.status ? prepared : this._persist(prepared, operationOptions))
    operation.catch(() => {})
    try {
      const result = await Promise.race([operation, gate.termination])
      if (result?.kind === 'aborted') return failure('aborted', 'ATTACHMENT_ABORTED', 'caller cancellation aborted the attachment operation')
      if (result?.kind === 'deadline') return failure('unavailable', 'ATTACHMENT_SOURCE_UNAVAILABLE', 'source operation exceeded its deadline')
      return result
    } catch (error) {
      return this._operationFailure(gate.token) ?? resultFromError(error, options.signal, 'ATTACHMENT_SOURCE_UNAVAILABLE')
    } finally {
      gate.release()
    }
  }

  async _ingestBatch(members, options) {
    const identityFailure = validateIdentity(options)
    if (identityFailure) return identityFailure
    if (!Array.isArray(members) || members.length === 0) return failure('error', 'ATTACHMENT_BATCH_INVALID', 'batch must contain at least one member')
    const memberOptionsList = members.map((member, index) => ({
      ...options,
      ...(member?.options ?? {}),
      generation: member?.generation ?? member?.options?.generation ?? `${options.generation}:${index}`,
    }))
    const memberKeys = new Set()
    for (const memberOptions of memberOptionsList) {
      if (typeof memberOptions.scope !== 'string' || typeof memberOptions.ownerId !== 'string') continue
      const key = `${memberOptions.scope}${TRANSFORM_KEY_SEPARATOR}${memberOptions.ownerId}`
      if (!memberKeys.has(key)) {
        memberKeys.add(key)
        this._retainIngestKey(key)
      }
    }
    try {
      const prepared = []
      let aggregateBytes = 0
      for (let index = 0; index < members.length; index += 1) {
        const member = members[index]
        const source = member?.source ?? member
        const result = await this._prepare(source, memberOptionsList[index])
        if (result?.status) return result
        prepared.push({ result, options: memberOptionsList[index] })
        aggregateBytes += result.data.byteLength
      }
      const imageMembers = prepared.filter(({ result }) => result.kind === 'image')
      const maxImages = this.store?.imageLimits?.maxImagesPerMessage
      if (imageMembers.length > 0 && (!Number.isInteger(maxImages) || maxImages <= 0)) return failure('unavailable', 'ATTACHMENT_POLICY_INVALID', 'official image-count policy is invalid')
      if (imageMembers.length > maxImages) return failure('denied', 'ATTACHMENT_BATCH_TOO_LARGE', 'batch exceeds the configured image-count limit')
      const imageBytes = imageMembers.reduce((total, member) => total + member.result.data.byteLength, 0)
      const imageAggregateLimit = effectiveLimit(this.store?.imageLimits?.maxMessageImageBytes)
      if (imageAggregateLimit.invalid || imageAggregateLimit.value !== undefined && imageBytes > imageAggregateLimit.value) return failure('denied', 'ATTACHMENT_BATCH_TOO_LARGE', 'batch exceeds the official aggregate image byte limit')
      const aggregateLimit = effectiveLimit(this.config.maxBatchBytes, options.maxBatchBytes)
      if (aggregateLimit.invalid || aggregateLimit.value !== undefined && aggregateBytes > aggregateLimit.value) return failure('denied', 'ATTACHMENT_BATCH_TOO_LARGE', 'batch exceeds the aggregate byte limit')
      const records = []
      const previousCurrent = new Map()
      const restoreBatch = async () => {
        for (const record of records) {
          try {
            const envelope = await this.journal.find({ scope: record.scope, ownerId: record.ownerId, recordId: record.recordId })
            if (envelope && !envelope.corrupt) await this.journal.remove(envelope)
          } catch {
            // The original operation failure remains the caller-visible result;
            // rollback is best effort and never escapes the pipeline boundary.
          }
        }
        for (const [key, previous] of previousCurrent) {
          if (previous) this.current.set(key, previous)
          else this.current.delete(key)
        }
      }
      for (const member of prepared) {
        const key = `${member.options.scope}${TRANSFORM_KEY_SEPARATOR}${member.options.ownerId}`
        if (!previousCurrent.has(key)) {
          await this._ensureCurrent(member.options.scope, member.options.ownerId)
          previousCurrent.set(key, this.current.get(key))
        }
        const result = await this._persist(member.result, member.options)
        if (result?.status !== 'success') {
          await restoreBatch()
          return result
        }
        records.push(result.value)
      }
      return success(records)
    } finally {
      for (const key of memberKeys) this._releaseIngestKey(key)
    }
  }

  async _find(reference) {
    const identityFailure = validateIdentity(reference)
    if (identityFailure) return identityFailure
    if (typeof reference.attachmentId !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(reference.attachmentId)) return failure('unavailable', 'INVALID_ATTACHMENT_REF', 'attachment reference is invalid')
    try {
      const envelope = await this.journal.find(reference)
      if (!envelope) return failure('unavailable', 'ATTACHMENT_NOT_FOUND', 'attachment record is unavailable')
      if (envelope.corrupt) return failure('unavailable', 'ATTACHMENT_CORRUPT', 'attachment journal record is corrupt')
      return envelope
    } catch (error) { return resultFromError(error, undefined, 'ATTACHMENT_READ_FAILED') }
  }

  async resolve(reference) {
    const inactive = this._unavailableIfDisposed()
    if (inactive) return inactive
    const found = await this._find(reference)
    if (found?.status) return found
    return success(clonePublicRecord(found.record))
  }

  async open(reference, signal) {
    const inactive = this._unavailableIfDisposed()
    if (inactive) return inactive
    try {
      throwIfAborted(signal)
      const found = await this._find(reference)
      if (found?.status) return found
      let data
      if (found.storage?.kind === 'official') {
        const opened = await this.store.readImage(found.storage.ref, signal)
        data = copyBytes(opened.data)
      } else {
        data = await this.journal.readBytes(found, signal)
      }
      throwIfAborted(signal)
      return success({ ref: clonePublicRecord(found.record), data })
    } catch (error) { return resultFromError(error, signal, 'ATTACHMENT_READ_FAILED') }
  }

  registerTransform(capability) {
    const inactive = this._unavailableIfDisposed()
    if (inactive) return inactive
    const invalid = validateTransformRegistration(capability)
    if (invalid) return invalid
    const policy = effectiveTransformPolicy({ maxBytes: this.config.maxBytes, deadlineMs: this.config.deadlineMs, concurrency: this.config.maxConcurrency, maxDurationMs: this.config.maxDurationMs }, capability.policy ?? {})
    if (!policy) return failure('unavailable', 'ATTACHMENT_POLICY_INVALID', 'transform policy is invalid')
    const key = registrationKey(capability.ownerId, capability.id)
    const previous = this.transforms.get(key)
    if (previous) previous.active = false
    const registration = {
      ...capability,
      policy,
      mediaTypes: [...capability.mediaTypes].map(normalizeMediaType),
      active: true,
      inFlight: 0,
    }
    this.transforms.set(key, registration)
    const dispose = () => {
      if (this.transforms.get(key) !== registration) return false
      registration.active = false
      this.transforms.delete(key)
      try { registration.dispose?.() } catch { /* disposer containment */ }
      return true
    }
    return dispose
  }

  _deadline(options, registration) {
    const limit = effectiveLimit(this.config.deadlineMs, registration.policy.deadlineMs, options.deadlineMs)
    if (limit.invalid || (limit.value !== undefined && limit.value <= 0)) return { invalid: true }
    const policyDeadlineAt = Date.now() + (limit.value ?? DEFAULT_PIPELINE_DEADLINE_MS)
    let deadlineAt = policyDeadlineAt
    if (options.deadlineAt !== undefined) {
      if (typeof options.deadlineAt !== 'number' || !Number.isFinite(options.deadlineAt)) return { invalid: true }
      deadlineAt = Math.min(options.deadlineAt, policyDeadlineAt)
    }
    return { at: deadlineAt }
  }

  _transformGuard({ record, ownerId, generation, operationId, registration, token, deadline, signal }) {
    if (signal?.aborted) {
      markOperationToken(token, 'aborted', 'ATTACHMENT_ABORTED', 'caller cancellation aborted the transform')
      return failure('aborted', 'ATTACHMENT_ABORTED', 'caller cancellation aborted the transform')
    }
    if (!token?.active || !registration.active || this.transforms.get(registrationKey(ownerId, operationId)) !== registration) {
      markOperationToken(token, 'superseded', 'ATTACHMENT_GENERATION_SUPERSEDED', 'transform ownership is no longer current')
      return failure('superseded', 'ATTACHMENT_GENERATION_SUPERSEDED', 'transform ownership is no longer current')
    }
    if (Date.now() >= deadline.at) {
      markOperationToken(token, 'denied', 'ATTACHMENT_TRANSFORM_DENIED', 'transform deadline expired before commit')
      return failure('denied', 'ATTACHMENT_TRANSFORM_DENIED', 'transform deadline expired before commit')
    }
    const current = this.current.get(`${record.scope}${TRANSFORM_KEY_SEPARATOR}${ownerId}`)
    if (!current || current.recordId !== record.recordId || current.generation !== record.generation) {
      markOperationToken(token, 'superseded', 'ATTACHMENT_GENERATION_SUPERSEDED', 'source generation is no longer current')
      return failure('superseded', 'ATTACHMENT_GENERATION_SUPERSEDED', 'source generation is no longer current')
    }
    return null
  }

  async _runWithDeadline(registration, input, options, deadline) {
    const controller = new AbortController()
    let callerAborted = false
    const onAbort = () => {
      callerAborted = true
      controller.abort(options.signal.reason)
    }
    if (options.signal) {
      if (options.signal.aborted) onAbort()
      else options.signal.addEventListener('abort', onAbort, { once: true })
    }
    let timedOut = false
    const remaining = deadline.at - Date.now()
    if (remaining <= 0) return { timeout: true, callerAborted }
    const runPromise = Promise.resolve().then(() => registration.run(input, {
      signal: controller.signal,
      ownerId: registration.ownerId,
      generation: registration.generation,
      mediaType: input.media.mediaType,
    }))
    runPromise.catch(() => {})
    let raceTimer
    try {
      const value = await Promise.race([
        runPromise.then((result) => ({ result }), (error) => ({ error })),
        new Promise((resolve) => {
          const wait = Math.max(0, deadline.at - Date.now())
          raceTimer = setTimeout(() => {
            timedOut = true
            controller.abort(new Error('transform deadline exceeded'))
            resolve({ timeout: true })
          }, wait)
        }),
      ])
      if (value.timeout) return { timeout: true }
      if (value.error) return { error: value.error, callerAborted }
      return { result: value.result, callerAborted }
    } finally {
      if (raceTimer) clearTimeout(raceTimer)
      options.signal?.removeEventListener?.('abort', onAbort)
    }
  }

  async transform(input, operation = {}, options = {}) {
    const inactive = this._unavailableIfDisposed()
    if (inactive) return inactive
    const callOptions = { ...operation, ...options }
    const record = input?.recordId ? input : input?.value?.ref ?? input?.ref
    if (!record || typeof record !== 'object') return failure('unavailable', 'ATTACHMENT_TRANSFORM_INPUT_INVALID', 'transform input record is required')
    const ownerId = callOptions.ownerId ?? record.ownerId
    const generation = callOptions.generation ?? record.generation
    const operationId = callOptions.operationId ?? operation.operationId ?? operation.id
    if (typeof ownerId !== 'string' || typeof generation !== 'string' || typeof operationId !== 'string') return failure('unavailable', 'ATTACHMENT_TRANSFORM_INVALID', 'transform requires ownerId, generation, and operationId')
    const registration = this.transforms.get(registrationKey(ownerId, operationId))
    if (!registration || !registration.active) return failure('unavailable', 'ATTACHMENT_TRANSFORM_UNAVAILABLE', 'transform operation is unavailable')
    if (registration.generation !== generation || record.ownerId !== ownerId || record.generation !== generation) return failure('superseded', 'ATTACHMENT_GENERATION_SUPERSEDED', 'transform generation is no longer current')
    if (!registration.mediaTypes.includes(record.media.mediaType)) return failure('denied', 'ATTACHMENT_TRANSFORM_DENIED', 'transform does not accept this media type')
    const effective = effectiveTransformPolicy({ maxBytes: this.config.maxBytes, deadlineMs: this.config.deadlineMs, concurrency: this.config.maxConcurrency, maxDurationMs: this.config.maxDurationMs }, registration.policy, operation.policy ?? callOptions)
    if (!effective) return failure('unavailable', 'ATTACHMENT_POLICY_INVALID', 'effective transform policy is invalid')
    const capacity = effective.concurrency ?? DEFAULT_PIPELINE_CONCURRENCY
    if (registration.inFlight >= capacity) return failure('denied', 'ATTACHMENT_TRANSFORM_DENIED', 'transform concurrency limit is exhausted')
    const deadline = this._deadline(callOptions, { policy: effective })
    if (deadline.invalid) return failure('denied', 'ATTACHMENT_TRANSFORM_DENIED', 'transform deadline policy is invalid')
    await this._ensureCurrent(record.scope, ownerId)
    const callerSignals = combineCallerSignals(operation?.signal, options?.signal)
    if (callerSignals.signal) callOptions.signal = callerSignals.signal
    registration.inFlight += 1
    const token = {
      registration,
      ownerId,
      generation,
      operationId,
      active: true,
      status: 'superseded',
      code: 'ATTACHMENT_GENERATION_SUPERSEDED',
      message: 'transform ownership is no longer current',
    }
    token.validate = () => this._transformGuard({ record, ownerId, generation, operationId, registration, token, deadline, signal: callOptions.signal })
    const onCallerAbort = () => markOperationToken(token, 'aborted', 'ATTACHMENT_ABORTED', 'caller cancellation aborted the transform')
    callOptions.signal?.addEventListener?.('abort', onCallerAbort, { once: true })
    this._retainActiveRecord(record.recordId)
    try {
      const initialGuard = this._transformGuard({ record, ownerId, generation, operationId, registration, token, deadline, signal: callOptions.signal })
      if (initialGuard) return initialGuard
      const opened = await this.open({ ownerId, generation, scope: record.scope, attachmentId: record.attachmentId }, callOptions.signal)
      if (opened?.status !== 'success') return opened
      const openedGuard = this._transformGuard({ record, ownerId, generation, operationId, registration, token, deadline, signal: callOptions.signal })
      if (openedGuard) return openedGuard
      const runInput = { ...opened.value.ref, data: opened.value.data }
      const run = await this._runWithDeadline(registration, runInput, { ...callOptions, signal: callOptions.signal }, deadline)
      if (run.timeout) return callOptions.signal?.aborted ? failure('aborted', 'ATTACHMENT_ABORTED', 'caller cancellation aborted the transform') : failure('denied', 'ATTACHMENT_TRANSFORM_DENIED', 'transform deadline exceeded')
      if (run.callerAborted || callOptions.signal?.aborted) return failure('aborted', 'ATTACHMENT_ABORTED', 'caller cancellation aborted the transform')
      if (run.error) return resultFromError(run.error, callOptions.signal, 'ATTACHMENT_TRANSFORM_FAILED')
      const runGuard = this._transformGuard({ record, ownerId, generation, operationId, registration, token, deadline, signal: callOptions.signal })
      if (runGuard) return runGuard
      const output = run.result?.data !== undefined ? run.result : { data: run.result }
      const data = copyBytes(output.data)
      if (!data) return failure('error', 'ATTACHMENT_TRANSFORM_FAILED', 'transform did not return bytes')
      const mediaType = normalizeMediaType(output.mediaType ?? record.media.mediaType)
      const prepared = await this._admit(data, mediaType, {
        ...callOptions,
        signal: callOptions.signal,
        name: output.name,
        maxBytes: effective.maxBytes,
        maxDurationMs: effective.maxDurationMs,
        decoder: output.decoder ?? registration.decoder,
      })
      if (prepared?.status) return prepared
      Object.assign(prepared, { data, mediaType, name: output.name, provenance: sourceProvenance({ kind: 'transform' }, { hostAudit: false }) })
      const admissionGuard = this._transformGuard({ record, ownerId, generation, operationId, registration, token, deadline, signal: callOptions.signal })
      if (admissionGuard) return admissionGuard
      // _admit is asynchronous.  Re-check every publication predicate after
      // it resolves and immediately before _persist is entered; _persist
      // receives this same token and repeats the guard around its writes.
      const prePersistGuard = this._transformGuard({ record, ownerId, generation, operationId, registration, token, deadline, signal: callOptions.signal })
      if (prePersistGuard) return prePersistGuard
      const result = await this._persist(prepared, { ...callOptions, ownerId, generation: `${generation}:${opaqueId('generation')}`, scope: record.scope, operationToken: token, storage: 'pipeline' }, {
        origin: 'derived',
        parent: { recordId: record.recordId, generation: record.generation },
        operation: { id: operationId, ownerId },
        provenance: [...(record.sourceProvenance ?? []), {
          kind: 'transform',
          observedAt: new Date().toISOString(),
          ...(isSafePublicText(String(operationId)) ? { operationId: String(operationId).slice(0, 160) } : {}),
          policy: transformPolicyEvidence(effective),
        }],
      })
      return result
    } catch (error) {
      return resultFromError(error, callOptions.signal, 'ATTACHMENT_TRANSFORM_FAILED')
    } finally {
      token.active = false
      registration.inFlight = Math.max(0, registration.inFlight - 1)
      this._releaseActiveRecord(record.recordId)
      callOptions.signal?.removeEventListener?.('abort', onCallerAbort)
      callerSignals.cleanup()
    }
  }

  async provenance(reference) {
    const found = await this._find(reference)
    if (found?.status) return found
    const chain = []
    let current = found
    let guard = 0
    while (current?.record && guard++ < 64) {
      chain.unshift(clonePublicRecord(current.record))
      if (!current.record.parent) break
      current = await this.journal.find({ scope: current.record.scope, ownerId: current.record.ownerId, recordId: current.record.parent.recordId })
    }
    return success(chain)
  }

  async project(reference, options = {}) {
    const found = await this._find(reference)
    if (found?.status) return found
    const current = await this._ensureCurrent(found.record.scope, found.record.ownerId)
    if (!current || current.recordId !== found.record.recordId || current.generation !== found.record.generation) {
      return failure('superseded', 'ATTACHMENT_GENERATION_SUPERSEDED', 'attachment record is not the current owner generation')
    }
    const route = options.targetRoute
    if (!route || typeof route.id !== 'string' || !Array.isArray(route.mediaTypes) || route.mediaTypes.some((mediaType) => !isSafePublicText(mediaType))) return failure('unavailable', 'ATTACHMENT_PROJECTION_UNAVAILABLE', 'explicit target route and media acceptance are required')
    const admission = admissionEvidence(options.admission)
    if (!admission) return failure('unavailable', 'ATTACHMENT_PROJECTION_UNAVAILABLE', 'explicit admission evidence is required')
    if (!admission.accepted) return failure('denied', 'ATTACHMENT_ADMISSION_DENIED', 'attachment admission was denied')
    if (!route.mediaTypes.includes(found.record.media.mediaType)) return failure('denied', 'ATTACHMENT_MEDIA_DENIED', 'target route does not accept this media type')
    const safeRoute = publicRoute(route)
    if (!safeRoute) return failure('unavailable', 'ATTACHMENT_PROJECTION_UNAVAILABLE', 'target route contains sensitive public metadata')
    return success({
      attachmentId: found.record.attachmentId,
      generation: found.record.generation,
      targetRoute: safeRoute,
      media: found.record.media,
      admission,
      provenance: [
        ...(found.record.sourceProvenance ?? []).map((entry) => ({ source: entry.kind, observedAt: entry.observedAt, certainty: 'observed' })),
        { source: 'projection', observedAt: new Date().toISOString(), certainty: 'observed' },
      ],
    })
  }

  async cleanup(options = {}) {
    const inactive = this._unavailableIfDisposed()
    if (inactive) return inactive
    const identityFailure = validateIdentity(options)
    if (identityFailure) return identityFailure
    if (typeof options.reason !== 'string' || !options.reason.trim()) return failure('unavailable', 'ATTACHMENT_RETENTION_REASON_REQUIRED', 'cleanup requires an explicit retention reason')
    try {
      throwIfAborted(options.signal)
      const current = await this._ensureCurrent(options.scope, options.ownerId)
      const entries = await this.journal.list(options.scope, options.ownerId)
      let removed = 0
      let retained = 0
      for (const entry of entries) {
        throwIfAborted(options.signal)
        if (entry.corrupt || entry.record.generation !== options.generation) continue
        const key = `${options.scope}${TRANSFORM_KEY_SEPARATOR}${options.ownerId}`
        if (this.activeRecords.has(entry.record.recordId) || current?.recordId === entry.record.recordId || this._activeIngestKeys.has(key)) {
          retained += 1
          continue
        }
        const removedEntry = await this.journal.remove(entry, {
          signal: options.signal,
          canRemove: (candidate) => {
            if (options.signal?.aborted) return false
            const latest = this.current.get(`${candidate.record.scope}${TRANSFORM_KEY_SEPARATOR}${candidate.record.ownerId}`)
            return !this.activeRecords.has(candidate.record.recordId) && latest?.recordId !== candidate.record.recordId && !this._activeIngestKeys.has(`${candidate.record.scope}${TRANSFORM_KEY_SEPARATOR}${candidate.record.ownerId}`)
          },
        })
        if (removedEntry) removed += 1
        else retained += 1
      }
      return success({ scope: options.scope, ownerId: options.ownerId, generation: options.generation, reason: options.reason.slice(0, 160), removed, retained })
    } catch (error) { return resultFromError(error, options.signal, 'ATTACHMENT_CLEANUP_FAILED') }
  }
}
