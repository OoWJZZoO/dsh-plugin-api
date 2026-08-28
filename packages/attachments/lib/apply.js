import { createRequire } from 'node:module'
import { join } from 'node:path'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { LocalAttachmentStore as OfficialLocalAttachmentStore } from '@deepseek-ai/dsh-attachment-local'
import { LocalAttachmentStore as ForkedLocalAttachmentStore } from './forked-store.js'
import { ATTACHMENT_CONTRACT_SYMBOL, ATTACHMENT_OWNER_SYMBOL, ATTACHMENT_PACKAGE_NAME, ATTACHMENT_ROW_ID, ownsAttachmentRoot } from './contract.js'

export const name = 'dsh-plugin-api-attachments'
export const inject = ['loader']
export const ATTACHMENT_ACTIVE_SYMBOL = ATTACHMENT_CONTRACT_SYMBOL

const require = createRequire(import.meta.url)
const OFFICIAL_ROW_ID = 'attachment-local'
const OFFICIAL_ROW_NAME = '@deepseek-ai/dsh-attachment-local'
const OWN_ROW_ID = ATTACHMENT_ROW_ID
const MAIN_PACKAGE_NAME = '@deepseek-ai/dsh-plugin-api-main'
const RUNTIME_VERSION = '0.1.0-rc.6'
const REQUIRED_ERROR_CODES = Object.freeze(['INVALID_ATTACHMENT_REF', 'ATTACHMENT_CORRUPT', 'ATTACHMENT_NOT_FOUND'])

function readPackageVersion(packageName) {
  try { return require(`${packageName}/package.json`)?.version } catch { return undefined }
}

function readPackageApi(packageName) {
  try { return require(`${packageName}/package.json`)?.dsh?.api } catch { return undefined }
}

export function parseFullVersion(version) {
  if (typeof version !== 'string') return null
  const match = /^(.+)-(\d+\.\d+)(?:\.(\d+))?$/.exec(version.trim())
    if (!match) return null
  const parsed = { runtime: match[1], api: match[2] }
  if (match[3] !== undefined) parsed.maintenance = match[3]
  return parsed
}

export function fullVersionContractsMatch({ ownVersion, ownApi, mainVersion, mainApi }) {
  const own = parseFullVersion(ownVersion)
  const main = parseFullVersion(mainVersion)
  return Boolean(own && main && own.runtime === main.runtime && own.api === main.api && ownApi === own.api && mainApi === main.api)
}

function log(ctx, message) {
  try { ctx?.logger?.warn?.(message) } catch { /* fail-safe diagnostics */ }
}

function rowOptions(entry) {
  return entry?.options ?? entry ?? {}
}

function rowDisabled(entry) {
  return Boolean(rowOptions(entry).disabled ?? entry?.disabled)
}

function inspectComposition(ctx) {
  const result = { official: undefined, replacements: [], loaderFailed: false }
  try {
    for (const entry of ctx.loader.entries()) {
      const options = rowOptions(entry)
      if (options.id === OFFICIAL_ROW_ID || options.name === OFFICIAL_ROW_NAME) {
        if (!result.official || options.id === OFFICIAL_ROW_ID) result.official = entry
      }
      if (options.id === OWN_ROW_ID || options.name === ATTACHMENT_PACKAGE_NAME) result.replacements.push(entry)
    }
  } catch {
    result.loaderFailed = true
  }
  return result
}

function getService(ctx, name) {
  try { return ctx?.get?.(name) } catch { return undefined }
}

async function disposeRegistration(value) {
  try {
    if (typeof value === 'function') return await value()
    if (typeof value?.dispose === 'function') return await value.dispose()
  } catch {
    // rollback is deliberately best effort
  }
  return undefined
}

function isForked(service) {
  return Boolean(service?.[ATTACHMENT_CONTRACT_SYMBOL])
}

async function providerContract(service) {
  if (!service || !Object.isFrozen(service.imageLimits)) return false
  const limits = service.imageLimits
  if (!['maxImageBytes', 'maxImagesPerMessage', 'maxMessageImageBytes', 'maxImagePixels', 'mediaTypes'].every((key) => key in limits)) return false
  if (!Array.isArray(limits.mediaTypes) || !Object.isFrozen(limits.mediaTypes)) return false
  if (!['validateImage', 'saveImage', 'readImage'].every((key) => typeof service[key] === 'function')) return false
  const probe = async (reference, expectedCode) => {
    try {
      await service.readImage(reference)
      return false
    } catch (error) {
      return error?.code === expectedCode
    }
  }
  const missingReference = { attachmentId: `sha256:${'0'.repeat(64)}` }
  const corruptReference = { ...missingReference, mediaType: 'image/png', bytes: 1 }
  // Exercise the real public read contract with bounded refs. Invalid and
  // missing refs are always safe; the corrupt case uses an isolated temporary
  // root when the provider has the official public root field, so the probe
  // verifies an actual digest failure without touching durable user data.
  const invalid = await probe({ attachmentId: 'not-a-sha256-ref' }, REQUIRED_ERROR_CODES[0])
  const missing = await probe(missingReference, REQUIRED_ERROR_CODES[2])
  let corrupt = await probe(corruptReference, REQUIRED_ERROR_CODES[1])
  if (!corrupt && typeof service.root === 'string') {
    const originalRoot = service.root
    let temporaryRoot
    try {
      temporaryRoot = await mkdtemp(join(tmpdir(), 'dsh-attachment-contract-'))
      const digest = missingReference.attachmentId.slice('sha256:'.length)
      const objectDirectory = join(temporaryRoot, 'objects', digest.slice(0, 2))
      await mkdir(objectDirectory, { recursive: true })
      await writeFile(join(objectDirectory, digest), new Uint8Array([1]))
      service.root = temporaryRoot
      corrupt = await probe(corruptReference, REQUIRED_ERROR_CODES[1])
    } catch {
      corrupt = false
    } finally {
      try { service.root = originalRoot } catch { /* fail-safe restoration */ }
      if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true }).catch(() => {})
    }
  }
  return invalid && corrupt && missing
}

async function pipelineContract(service, { probeDisposal = false } = {}) {
  const pipeline = service?.pipeline
  const projection = service?.projection
  if (!service || typeof service.dispose !== 'function' || typeof service.disposed !== 'boolean') return false
  const shape = Boolean(
    pipeline && projection &&
    ['ingest', 'transform', 'registerTransform', 'cleanup', 'capabilities'].every((key) => typeof pipeline[key] === 'function') &&
    ['resolve', 'open', 'project', 'provenance', 'availability'].every((key) => typeof projection[key] === 'function'),
  )
  if (!shape) return false
  try {
    const capabilities = pipeline.capabilities()
    const availability = projection.availability()
    const invalidRegistration = pipeline.registerTransform({})
    const invalidReference = await projection.resolve({})
    const shapeValid = capabilities?.status === 'active' && availability?.status === 'active' &&
      invalidRegistration?.status === 'unavailable' && invalidReference?.status === 'unavailable' &&
      Object.isFrozen(pipeline) && Object.isFrozen(projection) && service.disposed === false
    if (!shapeValid) return { ok: false, disposalProbed: false }
    if (!probeDisposal || !service.ownerToken) return { ok: true, disposalProbed: false }
    const root = service.ctx?.root ?? service.ctx
    const firstDispose = service.dispose()
    const secondDispose = service.dispose()
    const disposalProbed = firstDispose === true && secondDispose === false && service.disposed === true &&
      pipeline.capabilities()?.status === 'unavailable' && projection.availability()?.status === 'unavailable' &&
      !ownsAttachmentRoot(root, service.ownerToken)
    return { ok: disposalProbed, disposalProbed }
  } catch {
    return { ok: false, disposalProbed: false }
  }
}

function resolveConfig(ctx, official, own) {
  const officialConfig = rowOptions(official).config
  const ownConfig = rowOptions(own).config ?? ctx?.fiber?.entry?.options?.config
  const valid = (value) => {
    if (value === undefined) return false
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    if (value.dshHome !== undefined && typeof value.dshHome !== 'string') return false
    for (const key of ['maxImageBytes', 'maxImagesPerMessage', 'maxMessageImageBytes', 'maxImagePixels']) {
      if (value[key] !== undefined && (!Number.isInteger(value[key]) || value[key] <= 0)) return false
    }
    return true
  }
  const candidate = valid(officialConfig) ? officialConfig : (valid(ownConfig) ? ownConfig : {})
  const config = candidate && typeof candidate === 'object' ? { ...candidate } : {}
  if (typeof config.dshHome !== 'string') config.dshHome = resolveDshHome()
  return config
}

function identityOk(readVersion, readApi) {
  const ownVersion = readVersion(ATTACHMENT_PACKAGE_NAME)
  const mainVersion = readVersion(MAIN_PACKAGE_NAME)
  return readVersion('@deepseek-ai/dsh-llm') === RUNTIME_VERSION &&
    readVersion('@deepseek-ai/dsh-attachment') === RUNTIME_VERSION &&
    readVersion('@deepseek-ai/dsh-attachment-local') === RUNTIME_VERSION &&
    fullVersionContractsMatch({
      ownVersion,
      ownApi: readApi(ATTACHMENT_PACKAGE_NAME),
      mainVersion,
      mainApi: readApi(MAIN_PACKAGE_NAME),
    })
}

function rootOf(ctx) {
  return ctx?.root ?? ctx
}

async function registerOfficialFallback(ctx, Official, config, reason, officialAvailable) {
  const composition = inspectComposition(ctx)
  const officialPresent = composition.official !== undefined
  if (officialPresent && !rowDisabled(composition.official)) {
    log(ctx, `plugin-api-attachments: ${reason}; official attachment-local row is enabled, remaining inert`)
    return false
  }
  const existing = getService(ctx, 'attachments')
  if (existing) {
    log(ctx, `plugin-api-attachments: ${reason}; an attachment provider already exists, no-double-run`)
    return false
  }
  if (!officialAvailable) {
    log(ctx, `plugin-api-attachments: ${reason}; official fallback package is unavailable, remaining inert`)
    return false
  }
  try {
    const registration = ctx.plugin(Official, config)
    await registration
    log(ctx, `plugin-api-attachments: ${reason}; registered official LocalAttachmentStore fallback and closed pipeline`)
    return true
  } catch (error) {
    log(ctx, `plugin-api-attachments: ${reason}; official fallback registration failed: ${error?.name ?? 'Error'}`)
    return false
  }
}

/**
 * Build the fail-safe R replacement apply function.  Test seams are explicit
 * so every matrix branch can be exercised without changing loader state.
 */
export function createAttachmentApply(overrides = {}) {
  const readVersion = overrides.readPackageVersion ?? readPackageVersion
  const readApi = overrides.readPackageApi ?? readPackageApi
  const Forked = overrides.forkedStore ?? ForkedLocalAttachmentStore
  const Official = overrides.officialStore ?? OfficialLocalAttachmentStore
  const officialAvailable = overrides.officialAvailable ?? true

  return async function apply(ctx) {
    try {
      const composition = inspectComposition(ctx)
      if (composition.loaderFailed) {
        log(ctx, 'plugin-api-attachments: loader composition probe failed; remaining inert')
        return
      }
      const officialPresent = composition.official !== undefined
      const officialEnabled = officialPresent && !rowDisabled(composition.official)
      const replacementPresent = composition.replacements.length > 0
      const replacementActive = composition.replacements.some((entry) => !rowDisabled(entry))
      const duplicate = composition.replacements.length > 1
      const root = rootOf(ctx)
      const foreignOwner = root?.[ATTACHMENT_OWNER_SYMBOL] && !ownsAttachmentRoot(root)
      const existing = getService(ctx, 'attachments')

      // A direct apply call is not permission to activate a disabled or
      // absent replacement row.  This keeps the patch composition itself the
      // activation gate and prevents a disabled row from registering a fork.
      if (!replacementPresent || !replacementActive) {
        log(ctx, 'plugin-api-attachments: replacement row is absent or disabled; staying inert')
        return
      }

      if (existing) {
        if (isForked(existing)) return
        if (foreignOwner || duplicate) {
          log(ctx, 'plugin-api-attachments: competing attachment owner or duplicate replacement detected; staying inert')
          return
        }
        log(ctx, 'plugin-api-attachments: another provider already owns ctx.attachments; staying inert')
        return
      }
      if (officialEnabled) {
        log(ctx, 'plugin-api-attachments: official attachment-local row is enabled; staying inert')
        return
      }
      if (foreignOwner) {
        await registerOfficialFallback(ctx, Official, resolveConfig(ctx, composition.official, composition.replacements[0]), 'attachment owner conflict', officialAvailable)
        return
      }
      if (duplicate) {
        await registerOfficialFallback(ctx, Official, resolveConfig(ctx, composition.official, composition.replacements[0]), 'duplicate replacement rows', officialAvailable)
        return
      }

      const config = resolveConfig(ctx, composition.official, composition.replacements[0])
      const versionsOk = identityOk(readVersion, readApi)
      if (!versionsOk) {
        await registerOfficialFallback(ctx, Official, config, 'runtime/package identity mismatch', officialAvailable)
        return
      }

      const registerForked = async () => {
        const registration = ctx.plugin(Forked, config)
        const resolvedDisposer = await registration
        return typeof resolvedDisposer === 'function' ? resolvedDisposer : registration
      }
      let disposer
      try {
        disposer = await registerForked()
      } catch (error) {
        await registerOfficialFallback(ctx, Official, config, `forked registration failed (${error?.name ?? 'Error'})`, officialAvailable)
        return
      }

      const provider = getService(ctx, 'attachments')
      const pipeline = getService(ctx, 'attachmentsPipeline')
      const pipelineProbe = await pipelineContract(pipeline, { probeDisposal: true })
      const valid = isForked(provider) && await providerContract(provider) && pipelineProbe.ok
      if (!valid || (!pipelineProbe.disposalProbed && pipeline.disposed === true)) {
        await disposeRegistration(disposer)
        await registerOfficialFallback(ctx, Official, config, 'post-registration contract probe failed after rollback', officialAvailable)
        return
      }
      if (pipelineProbe.disposalProbed) {
        // The real probe intentionally consumed the first instance so that
        // disposal state, idempotence, and owner-marker cleanup were tested.
        // Roll it back through Cordis, then publish one fresh instance.
        await disposeRegistration(disposer)
        try {
          disposer = await registerForked()
        } catch (error) {
          await registerOfficialFallback(ctx, Official, config, `forked re-registration failed (${error?.name ?? 'Error'})`, officialAvailable)
          return
        }
      }
      const finalProvider = getService(ctx, 'attachments')
      const finalPipeline = getService(ctx, 'attachmentsPipeline')
      const finalProbe = await pipelineContract(finalPipeline)
      if (!ownsAttachmentRoot(root, finalPipeline?.ownerToken) || !finalPipeline || !finalProbe.ok || !isForked(finalProvider)) {
        await disposeRegistration(disposer)
        await registerOfficialFallback(ctx, Official, config, 'attachment owner marker probe failed after rollback', officialAvailable)
        return
      }
    } catch (error) {
      log(ctx, `plugin-api-attachments: apply self-check failed; staying inert: ${error?.name ?? 'Error'}`)
    }
  }
}

export const apply = createAttachmentApply()
