/**
 * Environment self-check guard for dsh-plugin-api (host side).
 *
 * The facade rides on harness internals that can change shape on upgrade. A
 * plugin whose apply() throws, pends, or fails to import takes the whole
 * harness boot down, so the only safe failure mode is: apply() returns
 * normally while installing nothing (or only an inert service). This module
 * verifies every contract the llm-image-admission feature touches.
 *
 * checkHostEnvironment() NEVER throws. Each probe is isolated so a hostile
 * ctx (throwing getters) degrades to a reported problem.
 */
import { AsyncLocalStorage as NodeAsyncLocalStorage } from 'node:async_hooks'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

/**
 * @param ctx - the plugin's cordis context (may be partial in tests)
 * @param deps - { dshLlm, AsyncLocalStorage? } namespace import of
 *   @deepseek-ai/dsh-llm plus an optional AsyncLocalStorage override for tests
 * @returns {{
 *   ok: boolean,
 *   skipped: boolean,
 *   problems: Array<{name: string, detail: string}>,
 *   coreProblems: Array<{name: string, detail: string}>,
 *   optionalProblems: Array<{name: string, detail: string}>
 * }}
 */
export function checkHostEnvironment(ctx, deps = {}) {
  const coreProblems = []
  const optionalProblems = []
  const probe = (name, detail, check, optional = false) => {
    let pass = false
    try {
      pass = Boolean(check())
    } catch {
      pass = false
    }
    if (!pass) (optional ? optionalProblems : coreProblems).push({ name, detail })
  }

  if (process.env.DSH_PLUGIN_API_GUARD_DISABLE === '1') {
    return {
      ok: true,
      skipped: true,
      problems: [],
      coreProblems: [],
      optionalProblems: [],
    }
  }

  probe('ctx.plugin', 'fiber context cannot register the pluginApi service', () => typeof ctx?.plugin === 'function')
  probe('llm.resolveModelInfo', 'M1/admission wrapping target is missing', () => typeof ctx?.llm?.resolveModelInfo === 'function')
  probe('agents.get', 'cannot resolve an agent by session id for admission matching', () => typeof ctx?.agents?.get === 'function')
  probe('dshLlm.contentHasImage', 'projection guard cannot detect image blocks', () => typeof deps?.dshLlm?.contentHasImage === 'function')

  const als = deps?.AsyncLocalStorage === undefined ? NodeAsyncLocalStorage : deps.AsyncLocalStorage
  probe('AsyncLocalStorage', 'admission scope cannot be created', () => typeof als === 'function')

  probe(
    'apiProxy.sessions',
    'admission bridge boundary is unavailable; the admission effect will be disabled (expected in headless profiles)',
    () => {
      if (typeof ctx?.get !== 'function') return false
      const apiProxy = ctx.get('apiProxy')
      return typeof apiProxy?.sessions?.prompt === 'function' && typeof apiProxy?.sessions?.selectModel === 'function'
    },
    true
  )

  if (process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL === '1') {
    coreProblems.push({
      name: 'forced',
      detail: 'DSH_PLUGIN_API_FORCE_GUARD_FAIL=1 forced a guard failure (test only)',
    })
  }

  return {
    ok: coreProblems.length === 0,
    skipped: false,
    problems: [...coreProblems, ...optionalProblems],
    coreProblems,
    optionalProblems,
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
 * The ONE log line the user sees on the front desk when the guard fails —
 * detailed diagnostics go into the log file instead, keeping the front desk
 * quiet. Bilingual by design, and always includes the log path.
 */
export function guardFailNotice(logPath) {
  const where = logPath || '<日志写入失败 / log write failed>'
  const zh =
    'dsh-plugin-api 插件加载自检未通过，llm-image-admission 功能已停用（门面仍以未激活状态提供 pluginApi 服务）。' +
    '完整诊断日志已写入 ' + where + '。建议让 AI Agent 阅读该日志协助排查。' +
    '若你清楚自己在做什么，可设置环境变量 DSH_PLUGIN_API_GUARD_DISABLE=1 跳过自检并强行启用。'
  const en =
    'dsh-plugin-api environment self-check FAILED and llm-image-admission is disabled ' +
    '(the facade remains available as an inactive pluginApi service). Full diagnostics: ' + where + '. ' +
    'Consider asking an AI Agent to read the log for troubleshooting. ' +
    'If you know what you are doing, set DSH_PLUGIN_API_GUARD_DISABLE=1 to skip the self-check and force-enable.'
  return zh + '\n' + en
}
