/**
 * Layered environment self-check guard for dsh-plugin-api (host side).
 *
 * Two levels:
 * - `runCoreGuard` verifies the contracts the facade CORE needs (service
 *   registration primitives + version negotiation). Core failure => the
 *   service must be inert (or absent when registration itself is broken).
 * - `runFeatureGuard` verifies contracts of one non-core feature
 *   (`llm/admission` in this spec). Feature failure => only that feature is
 *   disabled and explicitly reported.
 *
 * Both functions NEVER throw. Every probe is isolated so a hostile ctx
 * (throwing getters) degrades to a reported problem.
 */
import { AsyncLocalStorage as NodeAsyncLocalStorage } from 'node:async_hooks'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { SERVICE_DEFINITIONS } from './services.js'
import { SESSION_DURABLE_AUDIT, buildSessionDurableContracts } from './session-durable-catalog.js'
import { parseFacadeVersion } from './version.js'

/**
 * @param ctx - the plugin's cordis context (may be partial in tests)
 * @param versions - { apiVersion, runtimeVersion } both from package metadata
 * @returns {{
 *   ok: boolean,
 *   skipped: boolean,
 *   problems: Array<{name: string, detail: string}>,
 *   coreProblems: Array<{name: string, detail: string}>,
 *   featureProblems: Record<string, Array<{name: string, detail: string}>>,
 * }}
 */
export function runCoreGuard(ctx, { apiVersion, facadeVersion, runtimeVersion } = {}) {
  const coreProblems = []
  const probe = (name, detail, check) => {
    let pass = false
    try {
      pass = Boolean(check())
    } catch {
      pass = false
    }
    if (!pass) coreProblems.push({ name, detail })
  }

  if (process.env.DSH_PLUGIN_API_GUARD_DISABLE === '1') {
    return {
      ok: true,
      skipped: true,
      problems: [],
      coreProblems: [],
      featureProblems: {},
    }
  }

  probe('ctx.plugin', 'fiber context cannot register the pluginApi service', () => typeof ctx?.plugin === 'function')
  probe('ctx.reflect.provide', 'Service constructor cannot provide the pluginApi service', () => typeof ctx?.reflect?.provide === 'function')
  probe('dsh.api', 'package.json dsh.api is missing or not a major.minor contract', () => {
    return typeof apiVersion === 'string' && /^\d+\.\d+$/.test(apiVersion.trim())
  })
  probe('facade version', 'package.json version is not "<runtime-full-version>-<api-major>.<api-minor>" or disagrees with dsh.api', () => {
    const parsed = parseFacadeVersion(facadeVersion)
    if (!parsed) return false
    return parsed.api === (typeof apiVersion === 'string' ? apiVersion.trim() : apiVersion)
  })
  probe('runtime version', 'installed DSH runtime does not match the runtime the facade was built for', () => {
    const parsed = parseFacadeVersion(facadeVersion)
    if (!parsed) return false
    // Runtime compatibility is an audit boundary: patch and prerelease are
    // part of the reviewed identity, unlike the independent API protocol.
    return parsed.runtime === runtimeVersion
  })

  if (process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL === '1') {
    coreProblems.push({
      name: 'forced',
      detail: 'DSH_PLUGIN_API_FORCE_GUARD_FAIL=1 forced a core guard failure (test only)',
    })
  }

  return {
    ok: coreProblems.length === 0,
    skipped: false,
    problems: coreProblems,
    coreProblems,
    featureProblems: {},
  }
}

/**
 * Run the feature-level guard for one facade feature.
 *
 * @param featureName - e.g. 'llm/admission'
 * @param ctx - the plugin's cordis context (may be partial in tests)
 * @param deps - { dshLlm, dshSystemPrompt, AsyncLocalStorage? }
 * @returns {{
 *   ok: boolean,
 *   skipped: boolean,
 *   problems: Array<{name: string, detail: string}>,
 *   coreProblems: Array<{name: string, detail: string}>,
 *   featureProblems: Record<string, Array<{name: string, detail: string}>>,
 * }}
 */
export function runFeatureGuard(featureName, ctx, deps = {}) {
  const featureProblems = []
  const probe = (name, detail, check) => {
    let pass = false
    try {
      pass = Boolean(check())
    } catch {
      pass = false
    }
    if (!pass) featureProblems.push({ name, detail })
  }

  if (process.env.DSH_PLUGIN_API_GUARD_DISABLE === '1') {
    return {
      ok: true,
      skipped: true,
      problems: [],
      coreProblems: [],
      featureProblems: {},
    }
  }

  if (featureName === 'llm/admission') {
    probe('llm.resolveModelInfo', 'llm/admission wrapping target is missing', () => {
      return typeof ctx?.get === 'function' && typeof ctx.get('llm')?.resolveModelInfo === 'function'
    })
    probe('agents.get', 'cannot resolve an agent by session id for admission matching', () => {
      return typeof ctx?.get === 'function' && typeof ctx.get('agents')?.get === 'function'
    })
    probe('dshLlm.contentHasImage', 'projection guard cannot detect image blocks', () => {
      return typeof deps?.dshLlm?.contentHasImage === 'function'
    })
    const als = deps?.AsyncLocalStorage === undefined ? NodeAsyncLocalStorage : deps.AsyncLocalStorage
    probe('AsyncLocalStorage', 'admission scope cannot be created', () => typeof als === 'function')
    probe('apiProxy.sessions', 'admission bridge boundary is unavailable; llm/admission will be disabled', () => {
      if (typeof ctx?.get !== 'function') return false
      const apiProxy = ctx.get('apiProxy')
      return typeof apiProxy?.sessions?.prompt === 'function' && typeof apiProxy?.sessions?.selectModel === 'function'
    })
  } else if (featureName === 'events') {
    probe('ctx.on', 'events bus cannot subscribe listeners', () => typeof ctx?.on === 'function')
    probe('ctx.once', 'events bus cannot subscribe one-shot listeners', () => typeof ctx?.once === 'function')
    probe('ctx.emit', 'events bus cannot emit', () => typeof ctx?.emit === 'function')
    probe('ctx.serial', 'events bus cannot dispatch serial', () => typeof ctx?.serial === 'function')
    probe('ctx.parallel', 'events bus cannot dispatch parallel', () => typeof ctx?.parallel === 'function')
    probe('ctx.bail', 'events bus cannot dispatch bail', () => typeof ctx?.bail === 'function')
    probe('ctx.waterfall', 'events bus cannot dispatch waterfall', () => typeof ctx?.waterfall === 'function')
  } else if (featureName === 'tools') { // mandatory service: fail-closed
    probe('tools service', 'official tools service is unavailable', () => {
      return typeof ctx?.get === 'function' && typeof ctx.get('tools') === 'object'
    })
    probe('tools.register', 'tools.register is unavailable', () => {
      return typeof ctx?.get === 'function' && typeof ctx.get('tools')?.register === 'function'
    })
    probe('tools.restrict', 'tools.restrict is unavailable', () => {
      return typeof ctx?.get === 'function' && typeof ctx.get('tools')?.restrict === 'function'
    })
    probe('tools.guard', 'tools.guard is unavailable', () => {
      return typeof ctx?.get === 'function' && typeof ctx.get('tools')?.guard === 'function'
    })
    probe('tools.get', 'tools.get is unavailable', () => {
      return typeof ctx?.get === 'function' && typeof ctx.get('tools')?.get === 'function'
    })
    probe('tools.schemas', 'tools.schemas is unavailable', () => {
      return typeof ctx?.get === 'function' && typeof ctx.get('tools')?.schemas === 'function'
    })
    probe('tools.execute', 'tools.execute is unavailable', () => {
      return typeof ctx?.get === 'function' && typeof ctx.get('tools')?.execute === 'function'
    })
    probe('tools.presentAs', 'tools.presentAs is unavailable', () => {
      return typeof ctx?.get === 'function' && typeof ctx.get('tools')?.presentAs === 'function'
    })
  } else if (featureName === 'agent') { // mandatory service: fail-closed
    probe('agents.get', 'agent registry read API is unavailable', () => {
      return typeof ctx?.get === 'function' && typeof ctx.get('agents')?.get === 'function'
    })
    probe('agents.list', 'agent registry list API is unavailable', () => {
      return typeof ctx?.get === 'function' && typeof ctx.get('agents')?.list === 'function'
    })
    probe('agents.roots', 'agent registry roots API is unavailable', () => {
      return typeof ctx?.get === 'function' && typeof ctx.get('agents')?.roots === 'function'
    })
  } else if (featureName === 'session') { // mandatory service: fail-closed
    probe('sessions.get', 'session read surface cannot look up sessions', () => {
      return typeof ctx?.get === 'function' && typeof ctx.get('sessions')?.get === 'function'
    })
    probe('sessions.list', 'session read surface cannot list sessions', () => {
      return typeof ctx?.get === 'function' && typeof ctx.get('sessions')?.list === 'function'
    })
    probe('sessions.fork', 'session read surface cannot fork sessions', () => {
      return typeof ctx?.get === 'function' && typeof ctx.get('sessions')?.fork === 'function'
    })
  } else if (featureName === 'llm') { // mandatory service: fail-closed
    probe('ctx.get', 'cannot resolve the official llm service', () => typeof ctx?.get === 'function')
    const llm = () => (typeof ctx?.get === 'function' ? ctx.get('llm') : undefined)
    probe('llm.resolveModelInfo', 'llm model-info query is unavailable', () => typeof llm()?.resolveModelInfo === 'function')
    probe('llm.prepareCall', 'llm call preparation is unavailable', () => typeof llm()?.prepareCall === 'function')
    probe('llm.stream', 'llm streaming entry is unavailable', () => typeof llm()?.stream === 'function')
    probe('llm.registerAdapter', 'llm adapter registration is unavailable', () => typeof llm()?.registerAdapter === 'function')
    probe('llm.registerConfigurableProviders', 'llm configurable-provider registration is unavailable', () => typeof llm()?.registerConfigurableProviders === 'function')
    probe('llm.registerModelDiscovery', 'llm model-discovery registration is unavailable', () => typeof llm()?.registerModelDiscovery === 'function')
  } else if (featureName === 'systemPrompt') { // mandatory service: fail-closed
    probe('systemPrompt.service', 'systemPrompt service is unavailable', () => {
      return typeof ctx?.get === 'function' && typeof ctx.get('systemPrompt')?.section === 'function'
        && typeof ctx.get('systemPrompt')?.context === 'function'
        && typeof ctx.get('systemPrompt')?.variable === 'function'
        && typeof ctx.get('systemPrompt')?.tools === 'function'
        && typeof ctx.get('systemPrompt')?.suppressRuntimeContext === 'function'
    })
    probe('dshSystemPrompt.renderPrompt', 'systemPrompt render helper is unavailable', () => {
      return typeof deps?.dshSystemPrompt?.renderPrompt === 'function'
    })
    probe('dshSystemPrompt.renderContextSections', 'systemPrompt context-section render helper is unavailable', () => {
      return typeof deps?.dshSystemPrompt?.renderContextSections === 'function'
    })
  } else if (featureName === 'officialPassthrough') { // independent public helper slots
    const available = []
    for (const exportName of ['renderContextSnapshot', 'joinContextSections']) {
      const surfaceKey = `systemPrompt.${exportName}`
      let value
      let reason = 'missing-export'
      try {
        value = deps?.dshSystemPrompt?.[exportName]
      } catch {
        reason = 'invalid-export'
      }
      if (typeof value === 'function') {
        available.push(exportName)
      } else {
        if (value !== undefined && reason === 'missing-export') reason = 'invalid-export'
        featureProblems.push({
          name: surfaceKey,
          detail: `${surfaceKey}: ${reason}`,
        })
      }
    }
    return {
      ok: available.length > 0,
      skipped: false,
      problems: featureProblems,
      coreProblems: [],
      featureProblems: { [featureName]: featureProblems },
    }
  } else if (featureName === 'settings') { // optional service: fail-open to call-time ServiceUnavailable
    probe('ctx.get', 'settings feature cannot resolve official services', () => typeof ctx?.get === 'function')
    let settings
    try {
      settings = typeof ctx?.get === 'function' ? ctx.get('settings') : undefined
    } catch {
      settings = undefined
    }
    if (settings != null) {
      probe('settings.register', 'settings service is missing register()', () => typeof settings?.register === 'function')
      probe('settings.describe', 'settings service is missing describe()', () => typeof settings?.describe === 'function')
      probe('settings.get', 'settings service is missing get()', () => typeof settings?.get === 'function')
      probe('settings.mutate', 'settings service is missing mutate()', () => typeof settings?.mutate === 'function')
    }
  } else if (featureName === 'settingsRemote') { // mandatory translated host publication
    probe('ctx.get', 'settingsRemote cannot resolve official host services', () => typeof ctx?.get === 'function')
    probe('settings service', 'settingsRemote requires the official settings read/write service', () => {
      if (typeof ctx?.get !== 'function') return false
      const settings = ctx.get('settings')
      return settings != null
        && typeof settings.describe === 'function'
        && typeof settings.get === 'function'
        && typeof settings.mutate === 'function'
    })
    probe('ctx.reflect.provide', 'settingsRemote cannot register a host Typert service', () => typeof ctx?.reflect?.provide === 'function')
    probe('typert.isTypertRemoteSegment', 'settingsRemote cannot validate Typert endpoint segments', () => typeof deps?.typertProtocol?.isTypertRemoteSegment === 'function')
    probe('typert.TypertRemoteService', 'settingsRemote cannot validate the official Typert remote service base', () => typeof deps?.typertProtocol?.TypertRemoteService === 'function')
    probe('typert.bindTypertRemote', 'settingsRemote cannot create an official Typert remote binding', () => typeof deps?.typertProtocol?.bindTypertRemote === 'function')
    probe('typert.remoteMethods', 'settingsRemote cannot inspect official Remote metadata', () => typeof deps?.typertProtocol?.remoteMethods === 'function')
    probe('typert.Remote', 'settingsRemote cannot mark public remote methods', () => typeof deps?.typertProtocol?.Remote === 'function')
  } else if (featureName === 'remote') { // mandatory translated generic host publication
    probe('ctx.get', 'remote cannot resolve official host services', () => typeof ctx?.get === 'function')
    probe('ctx.reflect.provide', 'remote cannot register a host Typert service', () => typeof ctx?.reflect?.provide === 'function')
    probe('typert.isTypertRemoteSegment', 'remote cannot validate Typert endpoint segments', () => typeof deps?.typertProtocol?.isTypertRemoteSegment === 'function')
    probe('typert.bindTypertRemote', 'remote cannot create an official Typert remote binding', () => typeof deps?.typertProtocol?.bindTypertRemote === 'function')
    probe('typert.remoteMethods', 'remote cannot inspect official Remote metadata', () => typeof deps?.typertProtocol?.remoteMethods === 'function')
    probe('typert.Remote', 'remote cannot mark public remote methods', () => typeof deps?.typertProtocol?.Remote === 'function')
  } else if (featureName === 'services') { // optional seams: passes when >=1 capability service resolves
    probe('ctx.get', 'capability services cannot be resolved', () => typeof ctx?.get === 'function')
    probe('capability services', 'none of the 21 official capability services is available', () => {
      if (typeof ctx?.get !== 'function') return false
      return SERVICE_DEFINITIONS.some((def) => {
        try {
          return ctx.get(def.ctxService) !== undefined
        } catch {
          return false
        }
      })
    })
  } else if (featureName === 'llm/request') { // translated compat translation: fail-closed
    probe('ctx.on', 'llm/request cannot install its raw llm/stream listener', () => {
      return typeof ctx?.on === 'function'
    })
    probe('ctx.get', 'cannot resolve the official llm service', () => typeof ctx?.get === 'function')
    probe('llm.stream', 'llm streaming entry is unavailable', () => {
      return typeof ctx?.get === 'function' && typeof ctx.get('llm')?.stream === 'function'
    })
    probe('llm.resolveModelInfo', 'authoritative capability resolution is unavailable', () => {
      return typeof ctx?.get === 'function' && typeof ctx.get('llm')?.resolveModelInfo === 'function'
    })
    probe('dshLlm.contentHasImage', 'the public terminal image classifier is unavailable', () => {
      return typeof deps?.dshLlm?.contentHasImage === 'function'
    })
    // Callback snapshot/freezing support is pure internal machinery (frozen
    // plain-object graphs, never environment-dependent), and the raw-listener
    // cleanup primitive (ctx.on disposer) is verified at mount time: a mounter
    // that cannot install its listener returns null and the host disables the
    // feature. Both checks are therefore covered by the mount-time contract
    // (design §6) rather than environment probes.
  } else if (featureName === 'execRoute') { // mandatory public route-capture substrate
    probe('ctx.on', 'execRoute cannot register the native tools/pre-execute capture hook', () => typeof ctx?.on === 'function')
    probe('tools service', 'execRoute cannot resolve the official tools service', () => {
      return typeof ctx?.get === 'function' && ctx.get('tools') != null
    })
    probe('sessions service', 'execRoute cannot resolve the official sessions service', () => {
      return typeof ctx?.get === 'function' && ctx.get('sessions') != null
    })
  } else if (featureName === 'sessionDurable') { // mandatory host-only feature: fail-closed
    probe('sessions.get', 'session durable cannot look up explicit live sessions', () => {
      return typeof ctx?.get === 'function' && typeof ctx.get('sessions')?.get === 'function'
    })
    probe('sessions.list', 'session durable cannot enumerate live sessions', () => {
      return typeof ctx?.get === 'function' && typeof ctx.get('sessions')?.list === 'function'
    })
    probe('ctx.on', 'session durable cannot subscribe to the session event surface', () => {
      return typeof ctx?.on === 'function'
    })
    probe('dshSession.exports', 'public dsh-session durable exports are unavailable or inconsistent', () => {
      return buildSessionDurableContracts({
        Session: deps?.dshSession?.Session,
        isJsonValue: deps?.dshSession?.isJsonValue,
        snapshotJsonValue: deps?.dshSession?.snapshotJsonValue,
        knownSessionEventTypes: deps?.dshSession?.KNOWN_SESSION_EVENT_TYPES,
        isSurfaceEligibleType: deps?.dshSession?.isSurfaceEligibleType,
      }).available
    })
    probe('sessionDurable.audit', 'audited public package identities do not exactly match the durable runtime contract', () => {
      if (
        deps?.runtimeVersion !== SESSION_DURABLE_AUDIT.runtimeVersion
        || deps?.facadeRuntimeVersion !== SESSION_DURABLE_AUDIT.runtimeVersion
      ) return false
      const manifests = deps?.sessionDurableManifests
      if (manifests === null || typeof manifests !== 'object') return false
      return Object.entries(SESSION_DURABLE_AUDIT.packages).every(([name, version]) => {
        return manifests[name]?.version === version
      })
    })
  } else if (featureName === 'sessionRoute') { // committed route observation owner
    probe('ctx.on', 'sessionRoute cannot register session lifecycle observation', () => typeof ctx?.on === 'function')
    probe('sessions.get', 'sessionRoute cannot look up live sessions', () => {
      return typeof ctx?.get === 'function' && typeof ctx.get('sessions')?.get === 'function'
    })
    probe('sessions.list', 'sessionRoute cannot prove live session identity', () => {
      return typeof ctx?.get === 'function' && typeof ctx.get('sessions')?.list === 'function'
    })
  } else if (featureName === 'typert') { // mandatory typert facade official registry seam
    probe('ctx.get', 'typert facade cannot resolve the official registry', () => typeof ctx?.get === 'function')
    probe('typert registry', 'official Typert registry is unavailable or malformed', () => {
      if (typeof ctx?.get !== 'function') return false
      let registry
      try {
        registry = ctx.get('typert')
      } catch {
        return false
      }
      if (registry == null || typeof registry !== 'object') return false
      const topLevel = ['register', 'get', 'resolve', 'list', 'getPackage', 'listPackages', 'toJSONSchema']
      if (topLevel.some((name) => typeof registry[name] !== 'function')) return false
      const nested = {
        local: ['get', 'hasSeen', 'list', 'subscribe'],
        remotes: ['register', 'get', 'list', 'subscribe'],
        lookups: ['register', 'configure', 'get', 'definitions', 'keys', 'subscribe'],
        contexts: ['registerHost', 'configureHost', 'registerClient', 'getHost', 'getClient', 'subscribe'],
      }
      return Object.entries(nested).every(([key, methods]) => {
        const value = registry[key]
        return value != null && typeof value === 'object' && methods.every((name) => typeof value[name] === 'function')
      })
    })
  } else if (featureName === 'diagnostics') { // facade projection: reads official service availability as evidence
    probe('ctx.get', 'diagnostics cannot resolve official services for host evidence', () => {
      return typeof ctx?.get === 'function'
    })
  } else {
    featureProblems.push({ name: 'feature', detail: `unknown feature "${featureName}"` })
  }

  return {
    ok: featureProblems.length === 0,
    skipped: false,
    problems: featureProblems,
    coreProblems: [],
    featureProblems: { [featureName]: featureProblems },
  }
}

/** Stable path of the full self-check diagnostics log. */
export function guardLogPath() {
  return join(homedir(), '.dsh', 'logs', 'dsh-plugin-api-guard.log')
}

/**
 * Create a directory one segment at a time (existsSync-checked, non-recursive
 * mkdir). NEVER use recursive mkdirSync here: on pseudo-filesystems such as
 * /proc it can HANG, and this function runs on the boot path — the guard
 * itself must never block the harness. Returns false quickly on any failure.
 */
function ensureDir(dir) {
  try {
    if (existsSync(dir)) return true
    const parent = dirname(dir)
    if (parent === dir || parent === '' || parent === '.') return false
    if (!ensureDir(parent)) return false
    mkdirSync(dir)
    return true
  } catch {
    return false
  }
}

/**
 * Write the full self-check diagnostics to `path` (defaults to
 * ~/.dsh/logs/dsh-plugin-api-guard.log, overwritten per failure so the notice
 * can point at one stable location). Never throws and never blocks: a logging
 * failure must not take down the graceful-exit path. Returns the path written,
 * or null when the directory cannot be created or the write fails.
 */
export function writeGuardLog(problems, path = guardLogPath()) {
  if (!ensureDir(dirname(path))) return null
  try {
    const stamp = new Date().toISOString()
    const body = (problems ?? []).map((p) => `- ${p.name}: ${p.detail}`).join('\n')
    writeFileSync(path, `[${stamp}] dsh-plugin-api environment self-check FAILED\n${body}\n`, 'utf8')
    return path
  } catch {
    return null
  }
}

/**
 * The ONE log line the user sees when the CORE guard fails — the facade stays
 * registered as an inert service when registration primitives are healthy, or
 * is absent when they are broken. Bilingual by design and always includes the
 * log path.
 */
export function guardFailNotice(logPath) {
  const where = logPath || '<日志写入失败 / log write failed>'
  const zh =
    'dsh-plugin-api 核心自检未通过，门面已停用（如可注册则以未激活状态提供 pluginApi 服务）。' +
    '完整诊断日志已写入 ' + where + '。建议让 AI Agent 阅读该日志协助排查。' +
    '若你清楚自己在做什么，可设置环境变量 DSH_PLUGIN_API_GUARD_DISABLE=1 跳过自检并强行启用。'
  const en =
    'dsh-plugin-api core self-check FAILED and the facade is disabled ' +
    '(the pluginApi service remains available in inactive state when it can be registered). Full diagnostics: ' + where + '. ' +
    'Consider asking an AI Agent to read the log for troubleshooting. ' +
    'If you know what you are doing, set DSH_PLUGIN_API_GUARD_DISABLE=1 to skip the self-check and force-enable.'
  return zh + '\n' + en
}

/**
 * The ONE log line the user sees when a non-core FEATURE guard fails — the
 * facade stays active but the feature is disabled. Bilingual and always
 * includes the feature name and log path.
 */
export function featureFailNotice(featureName, logPath) {
  const where = logPath || '<日志写入失败 / log write failed>'
  const zh =
    `dsh-plugin-api feature "${featureName}" 自检未通过，该 feature 已停用（门面其他部分保持激活）。` +
    '完整诊断日志已写入 ' + where + '。'
  const en =
    `dsh-plugin-api feature "${featureName}" self-check FAILED and the feature is disabled ` +
    '(the rest of the facade stays active). Full diagnostics: ' + where + '.'
  return zh + '\n' + en
}
