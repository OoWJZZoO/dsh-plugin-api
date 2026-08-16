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
import { satisfiesContract } from './version.js'

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
export function runCoreGuard(ctx, { apiVersion, runtimeVersion } = {}) {
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
  probe('runtime version', 'DSH runtime version does not satisfy dsh.api', () => {
    return satisfiesContract(apiVersion, runtimeVersion)
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
  } else if (featureName === 'web') {
    probe('web.registerSearchProvider', 'web search provider registration is unavailable', () => {
      return typeof ctx?.get === 'function' && typeof ctx.get('web')?.registerSearchProvider === 'function'
    })
    probe('web.registerFetchProvider', 'web fetch provider registration is unavailable', () => {
      return typeof ctx?.get === 'function' && typeof ctx.get('web')?.registerFetchProvider === 'function'
    })





  } else if (featureName === 'tools') {
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
  } else if (featureName === 'agent') {
    probe('agents.get', 'agent registry read API is unavailable', () => {
      return typeof ctx?.get === 'function' && typeof ctx.get('agents')?.get === 'function'
    })
    probe('agents.list', 'agent registry list API is unavailable', () => {
      return typeof ctx?.get === 'function' && typeof ctx.get('agents')?.list === 'function'
    })
    probe('agents.roots', 'agent registry roots API is unavailable', () => {
      return typeof ctx?.get === 'function' && typeof ctx.get('agents')?.roots === 'function'
    })
  } else if (featureName === 'session') {
    probe('sessions.get', 'session read surface cannot look up sessions', () => {
      return typeof ctx?.get === 'function' && typeof ctx.get('sessions')?.get === 'function'
    })
    probe('sessions.list', 'session read surface cannot list sessions', () => {
      return typeof ctx?.get === 'function' && typeof ctx.get('sessions')?.list === 'function'
    })
    probe('sessions.fork', 'session read surface cannot fork sessions', () => {
      return typeof ctx?.get === 'function' && typeof ctx.get('sessions')?.fork === 'function'
    })
  } else if (featureName === 'llm') {
    probe('ctx.get', 'cannot resolve the official llm service', () => typeof ctx?.get === 'function')
    const llm = () => (typeof ctx?.get === 'function' ? ctx.get('llm') : undefined)
    probe('llm.resolveModelInfo', 'llm model-info query is unavailable', () => typeof llm()?.resolveModelInfo === 'function')
    probe('llm.prepareCall', 'llm call preparation is unavailable', () => typeof llm()?.prepareCall === 'function')
    probe('llm.stream', 'llm streaming entry is unavailable', () => typeof llm()?.stream === 'function')
    probe('llm.registerAdapter', 'llm adapter registration is unavailable', () => typeof llm()?.registerAdapter === 'function')
    probe('llm.registerConfigurableProviders', 'llm configurable-provider registration is unavailable', () => typeof llm()?.registerConfigurableProviders === 'function')
    probe('llm.registerModelDiscovery', 'llm model-discovery registration is unavailable', () => typeof llm()?.registerModelDiscovery === 'function')
  } else if (featureName === 'systemPrompt') {
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
  } else if (featureName === 'settings') {
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
  } else if (featureName === 'services') {
    probe('ctx.get', 'capability services cannot be resolved', () => typeof ctx?.get === 'function')
    probe('capability services', 'none of the 17 official capability services is available', () => {
      if (typeof ctx?.get !== 'function') return false
      return SERVICE_DEFINITIONS.some((def) => {
        try {
          return ctx.get(def.ctxService) !== undefined
        } catch {
          return false
        }
      })
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
