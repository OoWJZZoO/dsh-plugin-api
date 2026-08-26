/**
 * Fail-safe loader-row replacement entry for `packages/tool-skill`.
 *
 * apply() NEVER throws (a throwing plugin apply kills the harness boot). It
 * runs the boot self-check matrix, then either:
 * - assembles the forked row (skill tool + pre-step injection + session
 *   catalog) with the activation extension and publishes `ctx.skillActivation`
 *   (contract symbol present) when the official row is disabled, the
 *   replacement row is active, and every identity check passes;
 * - runs the official `@deepseek-ai/dsh-tool-skill` apply (official behavior
 *   restored, extension contract off) on identity mismatch or self-check
 *   failure, so the harness keeps its skill behavior and nothing double-runs;
 * - stays inert otherwise (loud diagnostic).
 *
 * The official import surface is never covered: the official package
 * remains the module-resolution source and the fallback.
 */

import { createRequire } from 'node:module'
import z from '@deepseek-ai/schemastery'
import { apply as officialApply } from '@deepseek-ai/dsh-tool-skill'
import {
  fullVersionContractsMatch,
  runtimeIdentityMatches,
} from './version.js'
import { createSkillActivationEngine } from './skill-activation-engine.js'
import { createForkedToolSkill } from './forked-tool-skill.js'
import { createRegisterSkillSugar } from './register-skill-sugar.js'
import {
  normalizeActivationRequest,
  normalizeAuditQuery,
  normalizeDescriptorSpec,
  normalizePolicyInput,
  normalizeScope,
} from './skill-activation-normalize.js'

export const name = 'dsh-plugin-api-tool-skill'
export const inject = ['agents', 'tools', 'skills']

/** Replacement/fork row configuration (parity with the official row shape). */
export const Config = z.object({ catalogDescriptionMaxLength: z.number().default(500) })

const DEFAULT_CATALOG_DESCRIPTION_MAX_LENGTH = 500

const require = createRequire(import.meta.url)

const OFFICIAL_ROW_ID = 'tool-skill'
const OFFICIAL_ROW_NAME = '@deepseek-ai/dsh-tool-skill'
const REPLACEMENT_ROW_ID = 'plugin-api-tool-skill'
const OWN_PACKAGE_NAME = '@deepseek-ai/dsh-plugin-api-tool-skill'
const MAIN_PACKAGE_NAME = '@deepseek-ai/dsh-plugin-api-main'
const LOCKED_RUNTIME_VERSION = '0.1.0-rc.6'

/** Neuter contract marker shared with the main facade via the global symbol registry. */
export const CONTRACT_SYMBOL = Symbol.for('dsh-plugin-api.tool-skill.contract')

function readPackageVersion(packageName) {
  try {
    return require(`${packageName}/package.json`)?.version
  } catch {
    return undefined
  }
}

function readPackageApi(packageName) {
  try {
    return require(`${packageName}/package.json`)?.dsh?.api
  } catch {
    return undefined
  }
}

function log(ctx, message) {
  try {
    ctx?.logger?.warn?.(message)
  } catch {
    // A diagnostic failure never changes activation.
  }
}

function rowOptions(entry) {
  return entry?.options ?? entry ?? {}
}

function rowDisabled(entry) {
  return Boolean(rowOptions(entry).disabled ?? entry?.disabled)
}

/**
 * Inspect the loader composition for the official row and every replacement
 * row of this bundle.
 * @returns {{ official: unknown, replacements: unknown[], loaderFailed: boolean }}
 */
function inspectComposition(ctx) {
  const result = { official: undefined, replacements: [], loaderFailed: false }
  try {
    for (const entry of ctx?.loader?.entries?.() ?? []) {
      const options = rowOptions(entry)
      if (options.id === OFFICIAL_ROW_ID || options.name === OFFICIAL_ROW_NAME) {
        if (result.official === undefined || options.id === OFFICIAL_ROW_ID) result.official = entry
      }
      if (options.id === REPLACEMENT_ROW_ID || options.name === OWN_PACKAGE_NAME) {
        result.replacements.push(entry)
      }
    }
  } catch {
    result.loaderFailed = true
  }
  return result
}

function getService(ctx, name) {
  try {
    return ctx?.get?.(name)
  } catch {
    return undefined
  }
}

function setServiceValue(ctx, name, value) {
  if (typeof ctx?.set === 'function') return ctx.set(name, value)
  try {
    return ctx?.reflect?.set?.(name, value)
  } catch {
    return undefined
  }
}

/** Config validation mirroring the official row (positive integer guard). */
function validateConfig(config) {
  const value = config?.catalogDescriptionMaxLength ?? DEFAULT_CATALOG_DESCRIPTION_MAX_LENGTH
  if (!Number.isInteger(value) || value < 3) {
    throw new Error(`catalogDescriptionMaxLength must be an integer greater than or equal to 3`)
  }
  return { catalogDescriptionMaxLength: value }
}

function probeCatalogProvider(ctx) {
  try {
    const skills = ctx?.get?.('skills') ?? ctx?.skills
    return typeof skills?.snapshot === 'function'
      && typeof skills?.list === 'function'
      && typeof skills?.get === 'function'
      && typeof skills?.register === 'function'
  } catch {
    return false
  }
}

function contractCallable(service) {
  if (service === null || typeof service !== 'object') return false
  if (service[CONTRACT_SYMBOL] !== true) return false
  for (const member of ['registerDescriptor', 'registerSkill', 'activate', 'deactivate', 'exposure', 'audit', 'availability']) {
    if (typeof service[member] !== 'function') return false
  }
  return typeof service?.policy?.registerMinimalCatalogUpdate === 'function'
}

/** The fork's activation view over the engine (fail-safe, never throws). */
function buildExtension({ engine, diagnostics }) {
  return {
    descriptorOf: (skillId) => engine.descriptorOf(skillId),
    stateOf: (scopeKey, skillId) => {
      const state = engine.activationState(scopeKey, skillId)
      return { status: state.status, sourceKind: state.record?.sourceKind }
    },
    scopeKeysOf: (agent) => {
      const keys = []
      const sessionId = agent?.session?.header?.id
      const agentId = agent?.id
      if (sessionId !== undefined) keys.push(`session:${sessionId}`)
      if (agentId !== undefined && agentId !== sessionId) keys.push(`agent:${agentId}`)
      return keys
    },
    noticeMode: (scopeKey) => (engine.minimalPolicyFor(scopeKey) ? 'minimal' : 'full'),
    recordCatalogChange: (scopeKey, reason) => engine.recordCatalogChange({ scopeKey, reason }),
    diagnostic: diagnostics,
  }
}

function failResult(code, reason, extra = {}) {
  return Object.freeze({ ok: false, code, reason, ...extra })
}

/**
 * The published `ctx.skillActivation` surface: typed results only, never
 * throws across plugin callbacks. The engine stays the single state owner;
 * this layer adds the official registry verification (deadline-bounded),
 * source-kind condition binding and the policy/policy entries.
 */
function createSkillActivationService({ ctx, engine, readSeamStatus, log }) {
  async function registryNames() {
    const summaries = await ctx.skills.list({})
    return Array.isArray(summaries) ? new Set(summaries.map((skill) => skill.name)) : new Set()
  }

  /** Deadline-bounded async task; resolves `onTimeoutResult()` on expiry. */
  function withDeadline(task, deadline, onTimeoutResult) {
    if (deadline === undefined) return task()
    return new Promise((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        resolve(onTimeoutResult())
      }, deadline)
      Promise.resolve().then(task).then(
        (value) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve(value)
        },
        (error) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          reject(error)
        },
      )
    })
  }

  async function registerDescriptor(spec) {
    const norm = normalizeDescriptorSpec(spec)
    if (!norm.ok) return norm
    try {
      const names = await registryNames()
      if (!names.has(norm.value.skillId)) {
        return failResult('SKILL_ENTRY_UNKNOWN', `skill "${norm.value.skillId}" is not present in the official skills registry`)
      }
    } catch (error) {
      return failResult('SKILL_ENTRY_FAILED', `registry verification failed: ${error?.message ?? error}`)
    }
    return engine.registerDescriptor(norm.value)
  }

  async function activate(skillId, request) {
    const norm = normalizeActivationRequest(request)
    if (!norm.ok) return norm
    const descriptor = engine.descriptorOf(skillId)
    if (descriptor === null) return failResult('SKILL_ENTRY_UNKNOWN', `skill "${skillId}" has no registered descriptor`)
    const sourceKind = norm.value.sourceKind ?? descriptor.sourceKind
    if ((sourceKind === 'auto-match' || sourceKind === 'provider-sourced')
      && (descriptor.activationSource?.kind !== sourceKind || norm.value.condition !== descriptor.activationSource.condition)) {
      return failResult('ACTIVATION_INVALID', `activation for "${skillId}" must be driven by its declared ${sourceKind} condition`)
    }
    return withDeadline(
      async () => {
        let names
        try {
          names = await registryNames()
        } catch (error) {
          engine.markDescriptorFailed(skillId)
          return failResult('SKILL_ENTRY_FAILED', `registry verification failed: ${error?.message ?? error}`)
        }
        if (!names.has(skillId)) {
          return failResult('ACTIVATION_DEGRADED', `skill "${skillId}" is not present in the official skills registry`, { part: 'registry' })
        }
        const degraded = []
        for (const dependency of descriptor.dependencies ?? []) {
          if (!names.has(dependency)) degraded.push({ part: 'dependencies', reason: `missing dependency "${dependency}"` })
        }
        return engine.activate({
          skillId,
          scope: norm.value.scope,
          sourceKind,
          reason: norm.value.reason,
          ttl: norm.value.ttl,
          degraded,
        })
      },
      norm.value.deadline,
      () => failResult('ACTIVATION_TIMEOUT', 'activation verification exceeded its deadline'),
    )
  }

  function deactivate(skillId, generation, scope) {
    let scopeKey
    if (scope !== undefined) {
      const norm = normalizeScope(scope)
      if (!norm.ok) return norm
      scopeKey = `${norm.value.kind}:${norm.value.key}`
    }
    return engine.deactivate(skillId, generation, scopeKey)
  }

  function exposure(skillId, generation) {
    return engine.exposure(skillId, generation)
  }

  function audit(query) {
    const norm = normalizeAuditQuery(query)
    if (!norm.ok) return norm
    return engine.audit(norm.value)
  }

  function availability() {
    return Object.freeze({
      active: true,
      versionMatch: true,
      officialRowDisabled: true,
      replacementActive: true,
      seams: readSeamStatus(),
    })
  }

  function registerMinimalCatalogUpdate(input) {
    const norm = normalizePolicyInput(input)
    if (!norm.ok) return norm
    const result = engine.policyRegister(norm.value)
    if (!result.ok) return result
    return Object.freeze({
      ok: true,
      dispose: () => engine.policyDispose(norm.value, result.token),
    })
  }

  const surface = {
    [CONTRACT_SYMBOL]: true,
    registerDescriptor,
    activate,
    deactivate,
    exposure,
    audit,
    availability,
    policy: Object.freeze({ registerMinimalCatalogUpdate }),
  }
  const sugar = createRegisterSkillSugar({ ctx, engine, service: surface })
  surface.registerSkill = sugar.registerSkill
  void log
  return Object.freeze(surface)
}

export { createSkillActivationService }

function disposeFork(fork) {
  try {
    fork?.disposer?.()
  } catch {
    // disposal must never throw through the fail-safe apply
  }
}

/**
 * Build the plugin `apply` with optional test seams.
 * @param {{
 *   readPackageVersion?: Function,
 *   readPackageApi?: Function,
 *   officialApplyFn?: Function,
 *   createFork?: Function,
 *   createService?: Function,
 *   createEngine?: Function,
 *   logFn?: Function,
 * }} [overrides]
 */
export function createToolSkillApply(overrides = {}) {
  const readVersion = overrides.readPackageVersion ?? readPackageVersion
  const readApi = overrides.readPackageApi ?? readPackageApi
  const officialApplyFn = overrides.officialApplyFn ?? officialApply
  const createFork = overrides.createFork ?? createForkedToolSkill
  const createService = overrides.createService ?? createSkillActivationService
  const createEngine = overrides.createEngine ?? createSkillActivationEngine
  const logFn = overrides.logFn ?? log

  /**
   * @param {import('@deepseek-ai/cordis').Context} ctx
   * @param {object} [config]
   * @returns {unknown} cleanup value (or undefined); never throws
   */
  return function apply(ctx, config = {}) {
    try {
      let configValue
      try {
        configValue = validateConfig(config)
      } catch (error) {
        logFn(ctx, `tool-skill: invalid config; staying inert: ${error?.message ?? error}`)
        return
      }

      const composition = inspectComposition(ctx)
      if (composition.loaderFailed) {
        logFn(ctx, 'tool-skill: loader composition probe failed; staying inert')
        return
      }

      // Boot self-check gate 1: the official row must be disabled.
      const officialEnabled = composition.official !== undefined && !rowDisabled(composition.official)
      if (officialEnabled) {
        logFn(ctx, 'tool-skill: official tool-skill row is enabled; leaving it in place')
        return
      }

      // Boot self-check gate 2: exactly one active replacement row.
      const activeReplacements = composition.replacements.filter((entry) => !rowDisabled(entry))
      if (activeReplacements.length > 1) {
        logFn(ctx, `tool-skill: duplicate replacement rows detected (${activeReplacements.length}); staying inert`)
        return
      }
      if (activeReplacements.length === 0) {
        logFn(ctx, 'tool-skill: replacement row is absent or disabled; staying inert')
        return
      }

      // Idempotent re-apply / competitor ownership of the extension service.
      const existing = getService(ctx, 'skillActivation')
      if (existing?.[CONTRACT_SYMBOL] === true) return
      if (existing !== undefined && existing !== null) {
        logFn(ctx, 'tool-skill: another provider already owns ctx.skillActivation; staying inert (conflict)')
        return
      }

      // Identity matrix: runtime full identity + replaced owner package
      // identity (direction ①) and the main facade protocol (direction ②).
      const runtimeOk = runtimeIdentityMatches(readVersion('@deepseek-ai/dsh') ?? readVersion('@deepseek-ai/dsh-llm'))
        && runtimeIdentityMatches(readVersion(OFFICIAL_ROW_NAME))
      const mainOk = fullVersionContractsMatch({
        ownVersion: readVersion(OWN_PACKAGE_NAME),
        ownApi: readApi(OWN_PACKAGE_NAME),
        mainVersion: readVersion(MAIN_PACKAGE_NAME),
        mainApi: readApi(MAIN_PACKAGE_NAME),
      })
      if (!runtimeOk || !mainOk) {
        const reasons = []
        if (!runtimeOk) reasons.push('runtime or locked owner package identity mismatch')
        if (!mainOk) reasons.push('main facade version mismatch')
        fallbackToOfficial(ctx, config, officialApplyFn, reasons.join(' and '))
        return
      }

      // Identity ok: full assembly with the boot self-check probes.
      const seams = { skillTool: false, preStepInjection: false, catalogProvider: false }
      const readSeamStatus = () => Object.freeze({ ...seams })
      let engine
      try {
        engine = createEngine({ readSeamStatus })
      } catch (error) {
        logFn(ctx, `tool-skill: activation engine could not be created; staying inert: ${error?.name ?? 'Error'}`)
        return
      }
      const diagnostics = (ownerId, detail) => logFn(ctx, `tool-skill: [${ownerId}] ${detail}`)
      let fork
      try {
        fork = createFork({ ctx, config: configValue, extension: buildExtension({ engine, diagnostics }) })
      } catch (error) {
        logFn(ctx, `tool-skill: forked row setup failed; staying inert: ${error?.name ?? 'Error'}`)
        return
      }
      seams.skillTool = fork.probes.skillToolRegistered === true
      seams.preStepInjection = fork.probes.preStepListeners === 2
      seams.catalogProvider = probeCatalogProvider(ctx)

      let service
      try {
        service = createService({ ctx, engine, readSeamStatus, log: diagnostics })
      } catch (error) {
        disposeFork(fork)
        logFn(ctx, `tool-skill: activation service construction failed; staying inert: ${error?.name ?? 'Error'}`)
        return
      }

      let published = false
      try {
        setServiceValue(ctx, 'skillActivation', service)
        published = true
      } catch {
        published = false
      }
      const probe = getService(ctx, 'skillActivation')
      if (!published || !contractCallable(probe) || !probeOk(probe, seams)) {
        // Self-check failure: fail-safe diagnostic, return normally, and
        // never double-run — dispose the fork and restore official behavior.
        if (published) {
          try {
            setServiceValue(ctx, 'skillActivation', undefined)
          } catch {
            // clearing is best effort
          }
        }
        disposeFork(fork)
        fallbackToOfficial(ctx, config, officialApplyFn, 'boot self-check failed')
        return
      }

      logFn(ctx, `tool-skill: replacement active — sole owner of the tool-skill component (runtime identity ${LOCKED_RUNTIME_VERSION}; official row disabled; replacement row active; skill tool, pre-step injection and catalog provider probes passed; main facade dsh.api ${String(readApi(MAIN_PACKAGE_NAME))})`)
    } catch (error) {
      logFn(ctx, `tool-skill: apply self-check failed; staying inert: ${error?.name ?? 'Error'}`)
    }
  }
}

/** The boot self-check probe set: contract surface + seams. */
function probeOk(service, seams) {
  if (seams.skillTool !== true) return false
  if (seams.preStepInjection !== true) return false
  if (seams.catalogProvider !== true) return false
  return contractCallable(service)
}

function fallbackToOfficial(ctx, config, officialApplyFn, reason) {
  try {
    officialApplyFn(ctx, config)
    log(ctx, `tool-skill: ${reason}; replacement contract disabled, official tool-skill behavior restored`)
  } catch (error) {
    log(ctx, `tool-skill: ${reason} and the official apply failed; staying inert: ${error?.name ?? 'Error'}`)
  }
}

/** Default fail-safe apply used by the DSH loader. */
export const apply = createToolSkillApply()