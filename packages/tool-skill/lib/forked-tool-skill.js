/**
 * Faithful fork of the official `@deepseek-ai/dsh-tool-skill` row with
 * activation-gate insertion points and policy-switchable catalog notices.
 *
 * The three model-facing surfaces are reproduced verbatim from
 * `dsh-tool-skill@0.1.0-rc.6` (the `skill` tool, the `agent/pre-step`
 * user-invocation injection, and the `agent/pre-step` session catalog
 * machinery). With `extension === null` the fork behaves exactly like the
 * official row. With an extension, descriptor-covered skills are additionally
 * gated by their session activation state (fail-closed on unresolved scope),
 * and per-session minimal-update notices replace full resends while a minimal
 * update policy is registered.
 *
 * Every listener body swallows internal failures into diagnostics: a throw
 * inside a pre-step listener would fail the session's turns.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import {
  escapeText,
  isModelInvocable,
  isSkillName,
  isUserInvocable,
  renderSkillContent,
} from '@deepseek-ai/dsh-skill'
import {
  aggregateNotices,
  buildDelta,
  catalogDescription,
  digestCatalogEntries,
  readCatalogEntries,
} from './catalog-diff.js'

const DEFAULT_CATALOG_DESCRIPTION_MAX_LENGTH = 500

/** Typed load-denial marker for the skill tool gate. */
export const SKILL_LOAD_DENIED = 'SKILL_LOAD_DENIED'

/** Catalog notice source kinds (contract vocabulary). */
export const CATALOG_KIND_FULL = 'skill-catalog'
export const CATALOG_KIND_MINIMAL = 'skill-catalog-update'

/**
 * Build the forked row.
 * @param {{
 *   ctx: object,
 *   config?: { catalogDescriptionMaxLength?: number },
 *   extension?: null | {
 *     descriptorOf(skillId): object | null,
 *     stateOf(scopeKey, skillId): { status: string, sourceKind?: string },
 *     scopeKeyOf(agent): string | null,
 *     noticeMode(scopeKey): 'full' | 'minimal',
 *     recordCatalogChange(scopeKey, reason): void,
 *     diagnostic(ownerId, detail): void,
 *   },
 * }} options
 * @returns {{ disposer: Function, probes: { skillToolRegistered: boolean, preStepListeners: number } }}
 */
export function createForkedToolSkill({ ctx, config = {}, extension = null }) {
  const catalogDescriptionMaxLength = config.catalogDescriptionMaxLength ?? DEFAULT_CATALOG_DESCRIPTION_MAX_LENGTH
  const probes = { skillToolRegistered: false, preStepListeners: 0 }
  const disposers = []

  /** One bounded diagnostic per agent for the catalog fail-closed path. */
  const scopeWarnedAgents = new WeakSet()

  function attach(disposer) {
    if (typeof disposer === 'function') disposers.push(disposer)
  }

  /**
   * Applicable scope keys of one agent (session and agent kinds share the
   * runtime identity; both composite keys are checked), or an empty array when
   * no scope can be resolved (fail-closed path).
   */
  function scopeKeysOfAgent(agent) {
    if (extension === null) return []
    try {
      const keys = extension.scopeKeysOf(agent)
      return Array.isArray(keys) ? keys : []
    } catch {
      return []
    }
  }

  /**
   * Resolve the gate state of a descriptor-covered skill across the agent's
   * applicable scope keys. An active/degraded match in any scope wins.
   */
  function resolveGateState(agent, skillId) {
    const keys = scopeKeysOfAgent(agent)
    if (keys.length === 0) return { status: 'absent', scopeKey: null }
    let latest = { status: 'absent', scopeKey: keys[0] }
    for (const scopeKey of keys) {
      let state
      try {
        state = extension.stateOf(scopeKey, skillId)
      } catch {
        state = { status: 'absent' }
      }
      if (state.status === 'active' || state.status === 'degraded') {
        return { ...state, scopeKey }
      }
      latest = { ...state, scopeKey }
    }
    return latest
  }

  /** Skill-tool load gate for a descriptor-covered skill (deny reasons flow into typed errors). */
  function loadGateFor(agent, name) {
    const descriptor = extension.descriptorOf(name)
    if (descriptor === null) return 'allow'
    const state = resolveGateState(agent, name)
    if (state.scopeKey === null) {
      extension.diagnostic(descriptor.owner, `skill tool load denied for "${name}": session scope unresolved`)
      return 'deny'
    }
    if (state.status !== 'active') {
      extension.diagnostic(descriptor.owner, `skill tool load denied for "${name}": activation state is ${state.status}`)
      return 'deny'
    }
    if (descriptor.sourceKind === 'explicit' && state.sourceKind !== 'explicit') {
      extension.diagnostic(descriptor.owner, `skill tool load denied for "${name}": explicit activation required`)
      return 'deny'
    }
    return 'allow'
  }

  /** Pre-step injection gate for a descriptor-covered skill. */
  function injectionGateFor(agent, name) {
    const descriptor = extension.descriptorOf(name)
    if (descriptor === null) return 'inject'
    if (descriptor.sourceKind === 'explicit') {
      extension.diagnostic(descriptor.owner, `pre-step injection skipped for "${name}": explicit-only skill`)
      return 'skip'
    }
    const state = resolveGateState(agent, name)
    if (state.scopeKey === null) {
      extension.diagnostic(descriptor.owner, `pre-step injection skipped for "${name}": session scope unresolved`)
      return 'skip'
    }
    if (state.status !== 'active') {
      extension.diagnostic(descriptor.owner, `pre-step injection skipped for "${name}": activation state is ${state.status}`)
      return 'skip'
    }
    return 'inject'
  }

  /** Catalog filter: official model-invocable filter plus activation gating. */
  function filterCatalogSkills(skills, agent) {
    const official = skills.filter(isModelInvocable)
    if (extension === null) return official
    const keys = scopeKeysOfAgent(agent)
    const gated = []
    for (const skill of official) {
      const descriptor = extension.descriptorOf(skill.name)
      if (descriptor === null) {
        gated.push(skill)
        continue
      }
      if (keys.length === 0) {
        if (!scopeWarnedAgents.has(agent)) {
          scopeWarnedAgents.add(agent)
          extension.diagnostic(descriptor.owner, `catalog gate failed closed for "${skill.name}": session scope unresolved`)
        }
        continue
      }
      const state = resolveGateState(agent, skill.name)
      if (state.status === 'active') gated.push(skill)
    }
    return gated
  }

  const skillTool = defineTool({
    name: 'skill',
    description: 'Load the full instructions for an available skill. Call this with the exact skill name from the session skill catalog before acting on a task that names or clearly matches that skill.',
    parameters: { name: {
      type: 'string',
      required: true,
      description: 'The exact skill name from the available skills list.',
    } },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: {
            type: 'string',
            required: true,
          },
          provider: {
            type: 'string',
            required: true,
          },
          resourceBase: { oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: {
                  type: 'string',
                  required: true,
                  const: 'directory',
                },
                path: {
                  type: 'string',
                  required: true,
                },
              },
            },
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: {
                  type: 'string',
                  required: true,
                  const: 'url',
                },
                url: {
                  type: 'string',
                  required: true,
                },
              },
            },
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: {
                  type: 'string',
                  required: true,
                  const: 'opaque',
                },
                description: {
                  type: 'string',
                  required: true,
                },
              },
            },
          ] },
          content: {
            type: 'string',
            required: true,
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: renderSkillContent(value),
      }],
    },
    async execute(args, exec) {
      if (!isSkillName(args.name)) throw new Error(`invalid skill name "${args.name}"`)
      const lookup = {
        cwd: exec.agent?.session.header.cwd,
        signal: exec.signal,
        scope: exec.agent,
      }
      const summary = (await ctx.skills.list(lookup)).find((skill) => skill.name === args.name)
      if (!summary) throw new Error(`skill "${args.name}" is unknown or no longer available`)
      if (!isModelInvocable(summary)) throw new Error(`skill "${args.name}" is not available for model invocation`)
      const skill = await ctx.skills.get(args.name, lookup)
      if (!skill) throw new Error(`skill "${args.name}" is unknown or no longer available`)
      if (!isModelInvocable(skill)) throw new Error(`skill "${args.name}" is not available for model invocation`)
      if (extension !== null && loadGateFor(exec.agent, args.name) === 'deny') {
        const error = new Error(`skill "${args.name}" is not active in this session`)
        error.code = SKILL_LOAD_DENIED
        throw error
      }
      return {
        name: skill.name,
        provider: skill.provider,
        ...skill.resourceBase !== void 0 ? { resourceBase: { ...skill.resourceBase } } : {},
        content: skill.content,
      }
    },
    presentCall(args) {
      return {
        card: 'generic',
        title: `Load skill ${args.name}`,
        kind: 'read',
        rawInput: args.name,
      }
    },
  })

  try {
    attach(ctx.tools.register(skillTool))
    probes.skillToolRegistered = true
  } catch (error) {
    probes.skillToolRegistered = false
  }

  // -- agent/pre-step 1: user-invocation injection (official machinery + gate)
  try {
    const disposer = ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
      const decision = await next()
      if (decision.kind === 'reject') return decision
      const names = invokedSkillNames(messages)
      if (names.length === 0) return decision
      signal.throwIfAborted()
      const lookup = {
        cwd: agent.session.header.cwd,
        signal,
        scope: agent,
      }
      const injections = []
      for (const name of names) {
        const skill = await ctx.skills.get(name, lookup)
        signal.throwIfAborted()
        if (skill === void 0 || !isUserInvocable(skill)) continue
        if (extension !== null && injectionGateFor(agent, name) === 'skip') continue
        const source = {
          kind: 'skill-invocation',
          name,
          form: 'instructions',
        }
        injections.push(createUserMessage({
          content: [{
            type: 'text',
            text: renderSkillContent(skill),
          }],
          source,
        }))
      }
      if (injections.length === 0) return decision
      return {
        kind: 'enter',
        messages: [...decision.messages, ...injections],
      }
    })
    attach(disposer)
    probes.preStepListeners += 1
  } catch {
    // registration failure recorded in the probe; apply self-check decides
  }

  // -- agent/pre-step 2: session catalog machinery (official + gating + notices)
  try {
    const disposer = ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
      const decision = await next()
      if (decision.kind === 'reject') return decision
      signal.throwIfAborted()
      const snapshot = ctx.tools.get(skillTool.name, agent) === skillTool
        ? await ctx.skills.snapshot({
          cwd: agent.session.header.cwd,
          signal,
          scope: agent,
        })
        : {
          skills: [],
          complete: true,
        }
      signal.throwIfAborted()
      if (!snapshot.complete) return decision
      const skills = filterCatalogSkills(snapshot.skills, agent)
      const entries = catalogSourceEntries(skills, catalogDescriptionMaxLength)
      const digest = digestCatalogEntries(entries)
      const history = catalogHistory(agent)
      const existing = catalogMessage(decision.messages)
      if (history.visibleDigest === digest) return existing === void 0 ? decision : {
        kind: 'enter',
        messages: decision.messages.filter((message) => message.id !== existing.message.id),
      }
      if (existing !== void 0 && digestCatalogEntries(existing.entries) === digest) return decision
      if (!history.published && skills.length === 0) return existing === void 0 ? decision : {
        kind: 'enter',
        messages: decision.messages.filter((message) => message.id !== existing.message.id),
      }
      let scopeKey = extension === null ? null : (scopeKeysOfAgent(agent)[0] ?? null)
      let catalog
      let changeReason
      if (extension !== null && history.published && scopeKey !== null) {
        let minimal = false
        try {
          minimal = extension.noticeMode(scopeKey) === 'minimal'
        } catch (error) {
          extension.diagnostic('<catalog>', `minimal update policy evaluation failed; falling back to full resend: ${error?.message ?? error}`)
          minimal = false
        }
        if (minimal) {
          try {
            const previousEntries = previousVisibleEntries(agent)
            const delta = buildDelta(previousEntries ?? existing?.entries ?? [], entries)
            const lines = aggregateNotices(delta, catalogDescriptionMaxLength)
            if (lines !== null) {
              catalog = renderMinimalUpdateMessage(entries, lines)
              changeReason = 'minimal-update'
            }
          } catch (error) {
            extension.diagnostic('<catalog>', `minimal update computation failed; falling back to full resend: ${error?.message ?? error}`)
          }
        }
      }
      if (catalog === undefined) {
        catalog = history.published ? renderCatalogUpdate(entries) : renderCatalogMessage(entries)
        if (history.published) changeReason = 'resend'
      }
      if (extension !== null && changeReason !== undefined && scopeKey !== null) {
        try {
          extension.recordCatalogChange(scopeKey, changeReason)
        } catch {
          // audit must never break the message flow
        }
      }
      return {
        kind: 'enter',
        messages: existing === void 0 ? [...decision.messages, catalog] : decision.messages.map((message) => message.id === existing.message.id ? catalog : message),
      }
    })
    attach(disposer)
    probes.preStepListeners += 1
  } catch {
    // registration failure recorded in the probe; apply self-check decides
  }

  return {
    disposer: () => {
      for (const disposer of disposers) {
        try {
          disposer()
        } catch {
          // disposal must never throw through the fail-safe apply
        }
      }
    },
    probes,
  }
}

/** Durable entry list mirroring the rendered catalog lines (official copy). */
function catalogSourceEntries(skills, descriptionMaxLength) {
  return skills.map((skill) => ({
    name: skill.name,
    description: catalogDescription(skill.description, descriptionMaxLength),
  }))
}

/** Full catalog message (official vocabulary). */
function renderCatalogMessage(entries) {
  return createUserMessage({
    content: [{
      type: 'text',
      text: [
        '<system-reminder>',
        'A skill is a reusable set of task-specific instructions. The following skills are available in this session:',
        '',
        '<available_skills>',
        ...renderCatalogEntries(entries),
        '</available_skills>',
        '',
        'If the user names a skill, or the task clearly matches a skill\'s description, call the `skill` tool with the exact skill name before taking task actions. Load all applicable skills, then follow their full instructions. This catalog contains summaries only; do not infer or follow a skill\'s instructions until it has been loaded.',
        'A user may also invoke a skill directly; its <skill_content> block then appears in this conversation. Follow it, and do not call the `skill` tool again for that skill.',
        '</system-reminder>',
      ].join('\n'),
    }],
    source: {
      kind: CATALOG_KIND_FULL,
      form: 'catalog',
      entries,
    },
  })
}

/** Replacement catalog message (official vocabulary). */
function renderCatalogUpdate(entries) {
  const availability = entries.length === 0
    ? ['No skills are currently available through the `skill` tool. Do not use names from earlier skill catalogs.', 'A user may still invoke a skill directly; its <skill_content> block then appears in this conversation. Follow it, and do not call the `skill` tool for it.']
    : ['Use only names in this replacement catalog. If the user names a listed skill, or the task clearly matches its description, call the `skill` tool with the exact name before acting.', 'A user may also invoke a skill directly; its <skill_content> block then appears in this conversation. Follow it, and do not call the `skill` tool again for that skill.']
  return createUserMessage({
    content: [{
      type: 'text',
      text: [
        '<system-reminder>',
        'The available skill catalog changed. This complete catalog replaces every earlier available-skills list in this session:',
        '',
        '<available_skills>',
        ...renderCatalogEntries(entries),
        '</available_skills>',
        '',
        ...availability,
        '</system-reminder>',
      ].join('\n'),
    }],
    source: {
      kind: CATALOG_KIND_FULL,
      form: 'catalog',
      update: true,
      entries,
    },
  })
}

/** Minimal-update notice: bounded English delta lines in one message. */
function renderMinimalUpdateMessage(entries, lines) {
  return createUserMessage({
    content: [{
      type: 'text',
      text: [
        '<system-reminder>',
        'The available skill catalog changed:',
        '',
        ...lines,
        '',
        '</system-reminder>',
      ].join('\n'),
    }],
    source: {
      kind: CATALOG_KIND_MINIMAL,
      form: 'catalog-update',
      update: true,
      entries,
    },
  })
}

/**
 * Model-facing catalog lines, projected from the same entries the source
 * records (official copy; escaping belongs to this frame, never to the
 * stored entries).
 */
function renderCatalogEntries(entries) {
  return entries.map((entry) => `- \`${entry.name}\`: ${escapeText(entry.description)}`)
}

/**
 * Session digest history over durable catalog messages. The official scan is
 * extended to also recognize minimal-update sources (which carry the full
 * effective entries as metadata), so the digest continuity and the
 * dispose-then-resend fallback work across both message kinds. Without any
 * update message present the behavior is identical to the official scan.
 */
function catalogHistory(agent) {
  const visible = new Set(agent.session.surface.nodes)
  const events = agent.session.events
  let published = false
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event.type !== 'user/message' || !isCatalogSource(event.data.source)) continue
    const entries = readCatalogEntries(event.data.source)
    if (entries === void 0) continue
    const digest = digestCatalogEntries(entries)
    published = true
    if (visible.has(event.seq)) return {
      visibleDigest: digest,
      published,
    }
  }
  return { published }
}

/** Whether a source is one of this row's catalog messages. */
function isCatalogSource(source) {
  return source?.kind === CATALOG_KIND_FULL || source?.kind === CATALOG_KIND_MINIMAL
}

/**
 * Entries of the last visible catalog message in the session event log
 * (either kind), for delta computation against the current entries.
 */
function previousVisibleEntries(agent) {
  const visible = new Set(agent.session.surface.nodes)
  const events = agent.session.events
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event.type !== 'user/message' || !isCatalogSource(event.data.source)) continue
    const entries = readCatalogEntries(event.data.source)
    if (entries === void 0) continue
    if (visible.has(event.seq)) return entries
  }
  return undefined
}

/**
 * Catalog message of the current decision batch (either kind), or undefined.
 * The official search is extended to cover minimal-update notices so a later
 * full resend replaces the previous notice in-batch.
 */
function catalogMessage(messages) {
  for (const message of messages) {
    if (!isCatalogSource(message.source)) continue
    const entries = readCatalogEntries(message.source)
    if (entries !== void 0) return {
      message,
      entries,
    }
  }
}

/**
 * A whitespace-bounded `/name` token (the public skill-name grammar) anywhere
 * in the text — the same word-boundary shape the transcript chip decoration
 * uses (official copy).
 */
const SKILL_GESTURE = /(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g

/**
 * `/name` gesture tokens from the claimed user messages, deduplicated in
 * first-seen order (official copy).
 */
function invokedSkillNames(messages) {
  const names = []
  for (const message of messages) {
    if (message.source.kind !== 'user') continue
    for (const block of message.content) {
      if (block.type !== 'text') continue
      for (const match of block.text.matchAll(SKILL_GESTURE)) {
        const name = match[2]
        if (name !== void 0 && !names.includes(name)) names.push(name)
      }
    }
  }
  return names
}