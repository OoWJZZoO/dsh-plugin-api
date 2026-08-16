# Feature List: plugin-api-features

> 状态：草案（draft for review）。本文是 `dsh-plugin-api` 门面**预备实现的主要外部 API feature 清单**，不是定稿 API 契约；每个 feature 后续按 Kiro spec-coding 流程展开为独立的 `requirements.md` / `design.md` / `tasks.md`。
>
> feature_name: `plugin-api-features`
> 范围：全量（host 面 + client 面 + C 类上游提案）
> 组织方式：按 API 命名空间分组，每项标注 A/B/C 类型与建议里程碑；已交付项标注 `delivered`。

---

## 1. 阅读说明

### 1.1 文档目的

把 `dsh-plugin-api` 最终要暴露给第三方插件的外部 API 面**一次列全**，用于：

1. 与用户对齐门面的长期形状，避免每个 feature 各自为政；
2. 作为后续每个 feature 进入 Stage 1（requirements）之前的范围清单；
3. 记录每个 API 在官方 DSH 源码中的出处（A/B/C 判定依据）。

### 1.2 类型标注（来自 AGENTS.md 硬约束）

| 类型 | 含义 | 门面策略 |
|---|---|---|
| **A 类** | 官方已 dispatch / 已提供服务，只需稳定化 | 类型化、只读 payload、priority、错误隔离，不再发明语义 |
| **B 类** | 官方没有 dispatch 点，只能用底层钩子模拟 | 用官方服务边界 + 底层事件转译，必须幂等收敛 + fail-safe |
| **C 类** | 不改官方做不到 | 只写 upstream proposal，不写实现；保留公开 API 迁移路径 |
| 门面基础 | 不属于 A/B/C 的服务/打包/协商能力 | 遵循 AGENTS.md 第 1–2 节硬约束 |

### 1.3 里程碑建议

| 里程碑 | 内容 |
|---|---|
| **M0** | 门面基础：`ctx.pluginApi` 服务、版本协商、fail-safe guard、打包与 row 顺序 |
| **M1** | 事件总线稳定化 + A 类事件/服务 catalog 的类型化直通 |
| **M2** | B 类语义钩子转译：同步 `llm/request`、`exec.route`、session 上屏 helper 等 |
| **M3** | settings 可视化配置桥 + client bundle（remote / codec / slot） |
| **M4** | C 类上游提案、迁移验收（dsh-read-image / dsh-pro-ex-ability-anchor） |

### 1.4 关键源码依据（缩写）

本文引用以下官方包（位于 `/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`）：

| 官方包 | 关键文件 | 提供的能力 |
|---|---|---|
| `cordis` | `lib/index.js` | `Context.emit/serial/parallel/waterfall/bail/on/once`、`Service`、fiber 生命周期 |
| `dsh-llm` | `lib/index.js`、`lib/types/index.d.ts`、`lib/types/types.d.ts` | `llm` 服务、`llm/stream`、`llm/adapters-updated`、`GenerateOptions` |
| `dsh-agent` | `lib/types/runtime-types.d.ts`、`lib/types/dispatch.d.ts` | `agents` 服务、全部 `agent/*` 事件、`agentEvents()` 融合派发 |
| `dsh-session` | `lib/types/index.d.ts`、`lib/index.js` | `sessions` 服务、`session/created|disposed|event|flush`、`append` 上屏契约 |
| `dsh-session-projection` / `dsh-session-query` / `dsh-session-title` / `dsh-session-telemetry` / `dsh-session-reference` / `dsh-token-meter` | 各 `lib/index.js` | `sessionProjections`、`sessionQuery`、`sessionTitle`、`sessionTelemetry`、`sessionReferenceResolver`、`tokenMeter`；`session-telemetry/record` 事件 |
| `dsh-compaction` / `dsh-compaction-basic` | 各 `lib/index.js` | `compaction` 服务 seam（`summarize()` 子类钩子，无事件） |
| `dsh-tools` | `lib/types/index.d.ts`、`lib/index.js` | `tools` 服务、`defineTool`、`tools/pre-execute|execute|post-execute|result|change|code-dispatch-log` |
| `dsh-system-prompt` | `lib/types/index.d.ts`、`lib/index.js` | `systemPrompt` 服务、`system-prompt/assemble|change` |
| `dsh-settings` | `lib/types/index.d.ts`、`lib/index.js` | `settings` 服务、`settings/updated|settings/document-updated` |
| `dsh-scope` | `lib/invariant.js` | 官方 scope-filtered 事件权威清单（`agent/*`、`tools/*`、`system-prompt/assemble`、`approval/request`） |
| `dsh-typert-protocol` | `lib/types/index.d.ts`、`lib/types/types.d.ts` | `TypertRemoteService`、`Remote`、`remoteMethods`、`TypertClientRemote`/`TypertRemoteContribution` |
| `dsh-typert-registry` | `lib/index.js` | `typert` 服务：schema/invocation/lookup/context 注册（`register`、`list`、`toJSONSchema`） |
| `dsh-typert-loader` | `lib/index.js` | 自动装载插件 `exports["./typert"]` 工件到 `ctx.typert` |
| `dsh-api-gateway` | `lib/index.js`、`lib/client.js` | host 端 Typert Gateway；client 端 `remote` 服务（`$mount/$on/$dispatch`） |
| `dsh-api-remotes` | `lib/client.js` | 客户端 remote 贡献装配（当前硬编码 5 个 `TYPERT_REMOTE$*`）与 forwarded-event allowlist |
| `dsh-client-runtime` | `lib/types/client/slots.d.ts` | `slots` 服务（`register/inject/entries/subscribe`）与 `slots/changed` |
| `dsh-client-ui-slots` | `lib/types/index.d.ts` | `SlotCore`/`SlotMap`/`SlotEntryDef`（slot 声明合并与 entry 契约） |
| `dsh-client-connection` | `lib/client.js` | `connection` 服务：`rpc.call` / `api.settings.*` / fixture |
| `dsh-client-modules` | `lib/index.js` | `dsh.client` manifest 解析与 web 模块图装配 |
| `dsh-web` | `lib/index.js` | `web` 服务：`registerSearchProvider` / `registerFetchProvider` |
| `dsh-host-apiproxy` | `lib/types/api-proxy.js` | `WEB_SETTINGS_NAMESPACES` 硬编码位置 |
| `dsh-fs` / `dsh-code-runtime` / `dsh-workspace` / `dsh-subagent` / `dsh-workflow-worker-thread` / `dsh-user-approval` / `dsh-user-questions` / `dsh-attachment` / `dsh-storage` | 各 `lib/index.js` | capability seams：`fs`、`codeRuntime`、`workspaceRegistry`、`subagents`、`workflowEngine`、`approval`、`userQuestions`、`attachments`、`storage` |
| `dsh-tool-fs` / `dsh-tool-bash` / `dsh-tool-str-replace-editor` / `dsh-commands` / `dsh-skill` / `dsh-credentials` / `dsh-goal` / `dsh-schedule` | 各 `lib/index.js` | `fs/*`、`commands/change`、`skills/change`、`credentials/updated`、`goal/changed`、`schedule/change` |

---

## 2. Feature 清单（按命名空间）

> 表格列：`Feature` = 外部 API 形状；`类型` = A/B/C/门面基础；`来源` = 官方源码或既有 hack 依据；`里程碑` = 建议交付期；`状态` = `delivered` / `planned`。
> API 形状是示意性的 TypeScript 签名，不保证最终定稿。

### 2.1 `pluginApi` 门面基础（M0）

| Feature | 外部 API 形状（示意） | 类型 | 来源 | 里程碑 | 状态 |
|---|---|---|---|---|---|
| F0.1 门面服务 | `ctx.pluginApi`（Cordis Service，`inject: ['pluginApi']`）；**推荐、受支持**的门面入口；直连 `@deepseek-ai/dsh-*` 内部包为 unsupported escape hatch | 门面基础 | 本仓库 `lib/index.js` / `lib/plugin-api-service.js`；spec `plugin-api-foundation` | M0 | delivered |
| F0.2 fail-safe guard | `pluginApi.isActive: boolean`；核心 guard 失败时服务仍注册为 inert；非核心 feature 失败时只禁用该 feature 并显式报错 | 门面基础 | 本仓库 `lib/guards.js`；对齐 dsh-read-image G1；spec `plugin-api-foundation` | M0 | delivered |
| F0.3 版本协商 | `package.json` 增加 `dsh.api` 声明；双向协商——runtime 不匹配时门面 inert，插件要求不满足时插件收到 typed 错误 | 门面基础 | 本仓库 `lib/version.js` / `lib/guards.js` / `package.json`；spec `plugin-api-foundation` | M0 | delivered |
| F0.4 符号解析门面 | `pluginApi` 作为**推荐** import/inject 面；第三方插件默认经门面解析符号；直连 `dsh-tools`/`dsh-llm` 等内部包属于 unsupported escape hatch（门面不拦截、不保障） | 门面基础 | `docs/specs/plugin-api-facade-integrity/requirements.md` §1（权威定义）；`README.md` | M0–M3 | delivered（F0.4 策略；符号覆盖随命名空间逐步扩展） |
| F0.5 包装链安全 | dispose 用 identity-guard；目标被其他插件包装时降级透传，不拆别人的链 | 门面基础 | 本仓库 `lib/wrap-safety.js` / `lib/admission-bridge.js`；dsh-read-image A1 加固；spec `plugin-api-facade-integrity` | M0 | delivered |

### 2.2 `pluginApi.events` —— 稳定事件总线（M1）

| Feature | 外部 API 形状（示意） | 类型 | 来源 | 里程碑 | 状态 |
|---|---|---|---|---|---|
| E1 类型化订阅 | `events.on<K>(name, listener, opts?): () => boolean` | A | Cordis `Context.on`；官方 `dsh-scope` scope-filtered 派发 | M1 | **delivered** |
| E2 一次性订阅 | `events.once<K>(name, listener, opts?): () => boolean` | A | Cordis `Context.once` | M1 | **delivered** |
| E3 同步 emit | `events.emit<K>(name, ...args): void` | A | Cordis `Context.emit` | M1 | **delivered** |
| E4 串行 bail | `events.serial<K>(name, ...args): Promise<BailValue>` | A | Cordis `Context.serial`（官方 `agent/turn-stopping` 用此模式） | M1 | **delivered** |
| E5 并发 barrier | `events.parallel<K>(name, ...args): Promise<void>` | A | Cordis `Context.parallel`（官方 `session/flush` 用此模式） | M1 | **delivered** |
| E6 同步 bail | `events.bail<K>(name, ...args): BailValue` | A | Cordis `Context.bail` | M1 | **delivered** |
| E7 瀑布组合 | `events.waterfall<K>(name, ...args, next): Return` | A | Cordis `Context.waterfall`（官方 `llm/stream`、`agent/pre-step|request`、`tools/*`、`system-prompt/assemble` 均用此模式） | M1 | **delivered** |
| E8 priority 排序 | `opts.priority: 'lowest'\|'low'\|'normal'\|'high'\|'highest'\|'monitor'` | B | Cordis 原生只有 `prepend`；门面在其上模拟有序分层 | M1 | **delivered** |
| E9 只读 payload | 对事件 payload 做 deepFreeze（或官方已冻结的透传），禁止监听器改写共享事件对象 | B | `dsh-llm` 对 loop-built 请求已 deepFreeze；门面统一契约 | M1 | **delivered** |
| E10 scope 感知订阅 | `opts.scope` / agent-scoped `events.on`（scope-filtered dispatch 的稳定包装） | A | `dsh-scope` `lib/invariant.js` 权威事件表；`dsh-agent` `agentEvents()` | M1 | **delivered** |
| E11 监听器故障隔离 | 监听器抛错/异步 rejection 的 contained 报告与日志，不中断事件派发 | A/B | 官方各 emit 点多已 per-listener contained；门面统一 | M1 | **delivered** |
| E12 事件目录 | `pluginApi.events.catalog`（事件名 → 模式 / payload 类型 / 是否 scope-filtered / A-B-C 来源） | 门面基础 | 本文第 2.3–2.11 节；首版目录覆盖本次 25 个 feature | M1 | **delivered** |

### 2.3 `pluginApi.llm` —— 模型调用面（M1/M2/M4）

| Feature | 外部 API 形状（示意） | 类型 | 来源 | 里程碑 | 状态 |
|---|---|---|---|---|---|
| L1 图片准入注册 | `llm.admission.register(intent: ImageAdmissionIntent): () => boolean`；`llm.admission.isActive` | B | 本仓库 `docs/specs/llm-image-admission/*`；官方缺 `llm/admission` 事件 | M0 | **delivered** |
| L2 准入泛化（image 之外） | `llm.admission.register` 扩展为可声明其他 inputModalities/策略，或新增 `llm/input-policy` 语义 | B/C | 官方 `LlmResolvedModelInfo.inputModalities`；首 feature 只做 image | M2/M4 | planned |
| L3 模型请求瀑布 | `events.waterfall('llm/stream', options, next)` 的类型化稳定版 | A | `dsh-llm/lib/index.js:1389`；`dsh-llm/lib/types/index.d.ts` `Events['llm/stream']` | M1 | planned |
| L4 同步请求改写 | `llm.request.transform(fn)` 或 `events.waterfall('llm/request', options, next)`（同步、幂等收敛） | B | 官方无 `llm/request`；用 `llm/stream` 重入模拟（AGENTS.md 第 4.4 条） | M2 | planned |
| L5 异步完整请求改写 | `llm/request` 的异步全量改写版 | C | 官方无 dispatch 点；AGENTS.md 第 2.5 条 C 类 | M4 | planned（proposal） |
| L6 adapter 拓扑通知 | `events.on('llm/adapters-updated', listener)` 类型化（注意官方无 payload） | A | `dsh-llm/lib/index.js:929` | M1 | planned |
| L7 模型信息只读查询 | `llm.modelInfo(provider, model, signal?): Promise<LlmResolvedModelInfo>`（只读，不提供修改） | A | `dsh-llm` `resolveModelInfo`；本仓库 design 已声明“不公开 ModelInfo 变更” | M1 | planned |
| L8 调用准备与流式入口 | `llm.prepareCall(config, signal?)` / `llm.stream(options)` 稳定直通 | A | `dsh-llm/lib/index.js:1271/1384` | M1 | planned |
| L9 provider 注册直通 | `llm.registerAdapter(providers, adapter)`、`llm.registerConfigurableProviders(entries)`、`llm.registerModelDiscovery(settingsNs, discover)` | A | `dsh-llm/lib/index.js:960` 起 | M1 | planned（面向 provider/adapter 插件） |
| L10 官方准入事件 | 官方 `llm/admission` 事件（payload 含 session/request 上下文） | C | 本仓库 `llm-image-admission` R6 提案 | M4 | planned（proposal） |

### 2.4 `pluginApi.agent` —— Agent 生命周期与驱动面（M1/M2）

| Feature | 外部 API 形状（示意） | 类型 | 来源 | 里程碑 | 状态 |
|---|---|---|---|---|---|
| A1 Agent 生命周期事件 | `agent/created`、`agent/disposed`、`agent/status`、`agent/session-start` 类型化订阅 | A | `dsh-agent/lib/types/runtime-types.d.ts:134-220` | M1 | planned |
| A2 Inbox 事件 | `agent/inbox/inserted|claimed|discarded` 类型化订阅 | A | 同上 `:180-208` | M1 | planned |
| A3 步骤前置瀑布 | `events.waterfall('agent/pre-step', payload, next)`（可 reject / 替换进入步骤的 messages） | A | 同上 `:235-241`；`dsh-agent-loop/lib/index.js:501` | M1 | planned |
| A4 模型路由决策 | `events.waterfall('agent/request', payload, next)`（替换 provider/model 配置） | A | 同上 `:254-259`；`dsh-agent-loop/lib/index.js:685` | M1 | planned |
| A5 请求失败恢复 | `events.waterfall('agent/request-error', payload, next)` | A | 同上 `:275-283`；`dsh-agent-loop/lib/index.js:630` | M1 | planned |
| A6 回合停止决策 | `events.serial('agent/turn-stopping', payload)` | A | 同上 `:301-305`；`dsh-agent-loop/lib/index.js:565` | M1 | planned |
| A7 Agent 错误通知 | `events.on('agent/error', listener)` | A | 同上 `:316-321`；`dsh-agent-loop/lib/index.js:470` | M1 | planned |
| A8 Agent 注册表读面 | `agent.get(id)`、`agent.list()`、`agent.roots()` 稳定直通 | A | `dsh-agent/lib/types/index.d.ts:349-370` | M1 | planned |
| A9 当前路由查询 | `agent.routeOf(exec)` / `pluginApi.agent.execRoute(exec)`：从 `session.requestContext()` 或 `tools/pre-execute` 注入推断 `{provider, model}` | B | 官方无 `exec.route`；dsh-read-image A6（`routeOf` 深挖 agent 内部） | M2 | planned |
| A10 官方路由 API | 官方 `exec.route` / `routeOf(exec)` 或等价字段 | C | AGENTS.md 第 2.5 条 C 类 | M4 | planned（proposal） |
| A11 Agent 创建/注册高级面 | `agent.create/resume/register/enter/announce`、`agent.setFactory` 稳定直通（按能力分级暴露） | A | `dsh-agent/lib/index.js:519` 起；`dsh-agent-loop/lib/index.js:1000` | M2 | planned |

### 2.5 `pluginApi.session` —— 会话与上屏事件面（M1/M2）

| Feature | 外部 API 形状（示意） | 类型 | 来源 | 里程碑 | 状态 |
|---|---|---|---|---|---|
| S1 会话生命周期事件 | `session/created`、`session/disposed`、`session/event`、`session/flush` 类型化订阅 | A | `dsh-session/lib/types/index.d.ts:44-75` | M1 | planned |
| S2 上屏事件构造 helper | `session.appendMessage(kind, payload)`：自动补齐 `surfaceOp: 'append'` 与 `sourceEventSeqs`，拒绝非法 surface 事件形状 | B | `dsh-session` `append` 上屏契约；dsh-pro-ex-ability-anchor 第 4 条不变量 | M2 | planned |
| S3 会话读面 | `session.get(id)`、`session.list()`、`session.fork(source, boundary?, childId?)` 稳定直通 | A | `dsh-session/lib/types/index.d.ts:315-413` | M1 | planned |
| S4 会话状态访问器 | `session.header/events/seq/surface`、`requestHeader()`、`requestContext()`、`deriveMessages()` 的稳定只读访问 | A | `dsh-session/lib/types/index.d.ts:106-267` | M1 | planned |
| S5 会话事件目录 | `sessionEventTypes` / `surfaceEventTypes` 常量与类型守卫 | A | `dsh-session` `known-event-types`（`session/end-seed`、`session/title` 等） | M1 | planned |
| S6 官方上屏 helper | 官方提供 `session.appendSurface(...)` 级别的高级构造 API | C | 当前 surface 契约靠插件自维护（dsh-pro-ex-ability-anchor） | M4 | planned（proposal，可选） |

### 2.6 `pluginApi.tools` —— 工具注册与执行管线面（M1/M2）

| Feature | 外部 API 形状（示意） | 类型 | 来源 | 里程碑 | 状态 |
|---|---|---|---|---|---|
| T1 工具注册 | `tools.register(definition: ToolDefinition): () => void`（`defineTool` 的类型化稳定版） | A | `dsh-tools/lib/types/index.d.ts:106-208` | M1 | delivered |
| T2 工具变更通知 | `events.on('tools/change', listener)`（注意官方为 unfiltered） | A | `dsh-tools/lib/index.js:2572` | M1 | delivered |
| T3 执行前瀑布 | `events.waterfall('tools/pre-execute', exec, next)`；default `{kind:'allow'}`，gate `allow|deny|ask`（`ask` 走 `ctx.approval` seam） | A | `dsh-tools/lib/index.js:3098` | M1 | delivered |
| T4 执行环绕瀑布 | `events.waterfall('tools/execute', exec, next)`（around body；timeout/retry/metrics，可替换 `exec.signal`） | A | `dsh-tools/lib/index.js:3195` | M1 | delivered |
| T5 执行后瀑布 | `events.waterfall('tools/post-execute', exec, result, next)`；default `{kind:'accept'}`，decision `accept({content?|value?})` / `block({feedback})` | A | `dsh-tools/lib/index.js:3360` | M1 | delivered |
| T6 结果通知 | `events.on('tools/result', (exec, result) => void)`（contained；`exec`/`result` 均 frozen、observe-only） | A | `dsh-tools/lib/index.js:3266-3284` | M1 | delivered |
| T7 代码分发日志瀑布 | `events.waterfall('tools/code-dispatch-log', dispatch, next)`；返回替换后的 content | A | `dsh-tools/lib/index.js:2953` | M1 | delivered |
| T8 工具限制与守卫 | `tools.restrict(filter)`、`tools.guard(guard)` 稳定直通 | A | `dsh-tools` `ToolRuntime.restrict/guard` | M1 | delivered |
| T9 工具查询与执行 | `tools.get(name, scope?)`、`tools.schemas(scope?)`、`tools.execute(input)`、`tools.presentAs` 稳定直通 | A | `dsh-tools` `ToolRuntime` 公共方法 | M1 | delivered |
| T10 执行路由注入 | 在 `tools/pre-execute` 稳定 payload 中暴露 `exec.agent.session.requestContext()` 的 route 快照 | B | 官方无 `exec.route`；`exec.agent` 在 `tools/pre-execute` 保证存在；与 A9 同源 | M2 | planned |

> 管线顺序（官方已定，门面只稳定化不重排）：`tools/pre-execute` → 单调 `guard()` 检查 → `tools/execute` → `tools/post-execute` → 工具 `finalizeContent` → `tools/result`。定义里的 `timeoutMs` 由 `dsh-tool-call-timeout-policy`（`tools/execute` wrapper）执行，不在门面内复制。

### 2.7 `pluginApi.systemPrompt` —— 系统提示组装面（M1）

| Feature | 外部 API 形状（示意） | 类型 | 来源 | 里程碑 | 状态 |
|---|---|---|---|---|---|
| P1 段落注册 | `systemPrompt.section(section: PromptSection): () => void` | A | `dsh-system-prompt/lib/types/index.d.ts:187` | M1 | planned |
| P2 动态上下文注册 | `systemPrompt.context(context: PromptContext): () => void` | A | 同上 `:194` | M1 | planned |
| P3 变量注册 | `systemPrompt.variable(name, provider): () => void` | A | 同上 `:218` | M1 | planned |
| P4 工具 schema 提供者 | `systemPrompt.tools(provider): () => void` | A | 同上 `:209` | M1 | planned |
| P5 运行时上下文抑制 | `systemPrompt.suppressRuntimeContext(): () => void` | A | 同上 `:201` | M1 | planned |
| P6 组装瀑布 | `events.waterfall('system-prompt/assemble', assembly, context, next)` 类型化 | A | `dsh-system-prompt/lib/index.js:283` | M1 | planned |
| P7 变更通知 | `events.on('system-prompt/change', listener)` | A | `dsh-system-prompt/lib/index.js:160` | M1 | planned |
| P8 渲染 helper | `systemPrompt.render(assembly)` / `renderContextSections(assembly)` 稳定直通 | A | `dsh-system-prompt` 导出的 `renderPrompt/renderContextSections` | M1 | planned |

### 2.8 `pluginApi.settings` —— 设置与可视化配置桥（M1/M3/M4）

| Feature | 外部 API 形状（示意） | 类型 | 来源 | 里程碑 | 状态 |
|---|---|---|---|---|---|
| ST1 命名空间注册 | `settings.register(ns, schema, {base, applies, validate})` 类型化 | A | `dsh-settings/lib/types/index.d.ts:216` | M1 | planned |
| ST2 设置作用域 | `settings.scope<T>(ns): SettingsScope<T>`（`get/watch/update/replace/mutate`） | A | 同上 `:85-111` | M1 | planned |
| ST3 设置事件 | `events.on('settings/updated'\|'settings/document-updated', listener)` | A | `dsh-settings/lib/index.js:525-568` | M1 | planned |
| ST4 设置可视化桥（host 侧） | `settings.remote(namespace, serviceKey?)`：用 `TypertRemoteService` + `bindTypertRemote` 注册可远程调用的设置服务 | B | dsh-read-image A3（手搓 `@Remote`）；`dsh-typert-protocol` 导出 `TypertRemoteService/remoteMethods` | M3 | planned |
| ST5 设置可视化桥（client 侧） | `client.mountRemoteContribution(contribution)`：封装 `ctx.remote.$mount` + face 校验 + 失败 UI 降级 | B | dsh-read-image A5（`ctx.remote.$mount` 自挂载）；`dsh-api-remotes/lib/client.js` | M3 | planned |
| ST6 真 codec 生成 | client bundle 打包一份 zod，生成满足 `dsh-api-remotes` 校验的 descriptor（替代 looseSchema） | B | dsh-read-image A4（伪造 zod schema）；AGENTS.md 第 4.5 条 | M3 | planned |
| ST7 插件设置命名空间动态化 | 官方 `WEB_SETTINGS_NAMESPACES` 支持第三方插件命名空间 | C | `dsh-host-apiproxy/lib/types/api-proxy.js:50-52` 当前硬编码 7 个命名空间 | M4 | planned（proposal） |
| ST8 设置描述与安装 helper | `settings.describe({redactSecrets})` 稳定直通；`installSettingsSection(ctx, ns, schema, entry, hooks)` 作为注册便利封装 | A | `dsh-settings/lib/index.js`（`describe` L352；`installSettingsSection` L618） | M1 | planned |

### 2.9 `pluginApi.client` —— 客户端 bundle / slot / remote（M3/M4）

| Feature | 外部 API 形状（示意） | 类型 | 来源 | 里程碑 | 状态 |
|---|---|---|---|---|---|
| C1 `dsh.client` manifest helper | `client.defineManifest({platform:'web', inject?, immediately?})` + `exports["./client"]` 约定（bundle 入口、`window.__ModuleLoader__.load`） | A | `dsh-client-modules/lib/index.js:60-99`；manifest 类型 `lib/types/client/manifest.d.ts:46-64` | M3 | planned |
| C2 remote 贡献装配 | `client.mountRemote(contribution)`（含 `ctx.remote.$mount`、命名空间 face 校验） | B | dsh-read-image A5；`dsh-api-remotes/lib/client.js:5912-5921`；`TypertRemoteContribution = {package, descriptors}` | M3 | planned |
| C3 客户端设置 scope | `client.settingsScope.bind(spec)` 类型化（getSnapshot/subscribe/load/set/unset） | A | `dsh-client-ui-settings/lib/client.js:207` | M3 | planned |
| C4 Slot 注册 | `slots.register(options, component)` / `slots.inject(key, callback)` / `slots.entries(key)` / `slots.subscribe(key, fn)` 类型化；`SlotEntryDef` 契约（`kind/scope/owner/keyProps/store/inject` 等） | A | `dsh-client-runtime/lib/types/client/slots.d.ts:74-172`；`dsh-client-ui-slots` `SlotCore.register` | M3 | planned |
| C5 Slot 变更事件 | `events.on('slots/changed', (key) => {})`；canonical slot id 目录（`settings.*`、`sidebar.*`、`shell.overlay`、`conversation`、`details` 等） | A | `dsh-client-runtime/lib/types/client/index.d.ts:99`；`dsh-client-ui-settings/lib/types/client/contract/slots.d.ts` | M3 | planned |
| C6 客户端事件桥 | `client.remote.$on/$dispatch` 稳定直通（host→client 事件转发；官方 forwarded-event allowlist 约 11 个事件） | A | `dsh-api-gateway/lib/client.js:35-66`；`dsh-api-remotes/lib/index.js` `API_REMOTE_FORWARDED_EVENTS` | M3 | planned |
| C7 `remote.<ns>` 原生动态发现 | 官方客户端运行时原生支持第三方 remote 命名空间发现（去掉硬编码 `TYPERT_REMOTE$*`） | C | `dsh-api-remotes/lib/client.js` 硬编码 5 个贡献（`commands/goals/dynamicCordisRunner/pluginInventory/messageFeedback`） | M4 | planned（proposal） |
| C8 Typert schema/invocation 注册 | `exports["./typert"]` 工件自动装载到 `ctx.typert`（schema/invocation/lookup/context）；门面提供类型化封装 | A | `dsh-typert-loader/lib/index.js:218/282`；`dsh-typert-registry` `register` | M3 | planned |
| C9 连接与 API 客户端 | `client.connection` 稳定直通：`rpc.call("/api", endpoint, {args}, signal)`、`api.settings.*` | A | `dsh-client-connection/lib/client.js`（`connection` 服务） | M3 | planned |

### 2.10 其他宿主事件稳定化（统一走 `pluginApi.events`，M1/M2）

| Feature | 事件名 | 类型 | 来源 | 里程碑 | 状态 |
|---|---|---|---|---|---|
| O1 文件写意图 | `fs/write-intent`（waterfall；payload `{target, exec}`） | A | `dsh-tool-fs/lib/index.js:658`（经 `dsh-fs` seam；`target = {targetKey, displayPath}`） | M1 | **delivered** |
| O2 文件编辑意图 | `fs/edit-intent`（waterfall；payload `{target, exec}`） | A | `dsh-tool-fs/lib/index.js:809` | M1 | **delivered** |
| O3 文件观测通知 | `fs/observed`（emit；payload `{target, observation, actor}`；`observation.kind: present|absent`） | A | `dsh-tool-fs/lib/index.js:278` | M1 | **delivered** |
| O4 子代理生命周期 | `subagent/start`（payload `{runId, provider, id, local}`）、`subagent/end`（payload `{runId, provider, id, local, stopReason, lastAssistantMessage?}`） | A | `dsh-subagent/lib/index.js:199-250` | M1 | **delivered** |
| O5 子代理 provider | `subagent/provider-added`（payload `provider`）、`subagent/provider-removed`（payload `providerName`） | A | `dsh-subagent/lib/index.js:2474-2476` | M1 | **delivered** |
| O6 工作流事件 | `workflow/start|phase|log|agent-start|agent-end|end`（payload 见 `dsh-workflow-worker-thread` 各 emit 点） | A | `dsh-workflow-worker-thread/lib/index.js:895-909` | M1 | **delivered** |
| O7 审批请求瀑布 | `approval/request`（waterfall；payload `req {agent, toolName, callId?, reason?, signal}`；outcome `allowed-once|rejected|cancelled|unavailable`，fail-closed） | A | `dsh-user-approval/lib/index.js:189`；scope 权威表 `dsh-scope/lib/invariant.js` | M1 | **delivered** |
| O8 审批 durable 事件 | `approval/policy|asked|decided`（session-log 事件，非 ctx 事件） | A | `dsh-user-approval/lib/index.js:78,148,155` | M2 | planned |
| O9 命令变更 | `commands/change`（emit） | A | `dsh-commands/lib/index.js:348` | M1 | **delivered** |
| O10 技能变更 | `skills/change`（emit） | A | `dsh-skill/lib/index.js:404` | M1 | **delivered** |
| O11 凭据更新 | `credentials/updated`（emit） | A | `dsh-credentials/lib/index.js:45` | M1 | **delivered** |
| O12 目标变更 | `goal/changed`（agent-scoped emit；payload `{agent, change}`） | A | `dsh-goal/index.js:793`；`dsh-scope` 权威表 | M1 | **delivered** |
| O13 调度 durable 事件 | `schedule/change`（session-log 事件；payload `{version:1, operation: create|delete|dispatch}`） | A | `dsh-schedule/lib/index.js:310-357` | M2 | planned |
| O14 子代理 descriptor | `subagent/descriptor`（session-log 事件，非 ctx 事件） | A | `dsh-subagent/lib/index.js:640` | M2 | planned |
| O15 Web 检索/抓取 provider | `web.registerSearchProvider(provider)`、`web.registerFetchProvider(provider)` 稳定直通 | A | `dsh-web/lib/index.js:67-77` | M1 | **delivered** |
| O16 会话遥测记录 | `session-telemetry/record`（waterfall；payload `{record}`） | A | `dsh-session-telemetry/lib/index.js:174` | M1 | **delivered** |

### 2.11 其他宿主服务稳定化（capability seams，M1）

> 这些官方服务是工具/子代理/审批等能力的底层 seam。门面策略：**稳定直通 + 类型化 + fail-safe**，不发明新语义；个别服务（如 `approval`、`userQuestions`）保留官方 fail-closed 行为。

| Feature | 外部 API 形状（示意） | 类型 | 来源 | 里程碑 | 状态 |
|---|---|---|---|---|---|
| SV1 文件系统 seam | `pluginApi.fs`：`read/write/edit/observe` 等官方 `FileSystem` 方法直通 | A | `dsh-fs/lib/index.js`（服务 `fs`） | M1 | planned |
| SV2 代码执行 seam | `pluginApi.codeRuntime`：程序执行 seam 直通 | A | `dsh-code-runtime/lib/index.js`（服务 `codeRuntime`） | M1 | planned |
| SV3 工作区注册表 | `pluginApi.workspaces`：`create/resolveByPath/attachSession` 等直通 | A | `dsh-workspace/lib/index.js:309`（服务 `workspaceRegistry`） | M1 | planned |
| SV4 子代理运行时 | `pluginApi.subagents.registerProvider(provider)` 稳定直通 | A | `dsh-subagent/lib/index.js:2467`（服务 `subagents`） | M1 | planned |
| SV5 工作流引擎 | `pluginApi.workflows.start(request)` 稳定直通 | A | `dsh-workflow/lib/index.js:59`（服务 `workflowEngine`） | M1 | planned |
| SV6 审批服务 | `pluginApi.approval.request()` / `setPolicy()` 直通（fail-closed 不变） | A | `dsh-user-approval/lib/index.js:89`（服务 `approval`） | M1 | planned |
| SV7 用户提问服务 | `pluginApi.userQuestions.registerProvider()` / `ask()` 直通 | A | `dsh-user-questions/lib/index.js:23`（服务 `userQuestions`） | M1 | planned |
| SV8 附件存储 | `pluginApi.attachments` 不可变二进制存储直通 | A | `dsh-attachment/lib/index.js:44`（服务 `attachments`） | M1 | planned |
| SV9 技能注册表 | `pluginApi.skills.list/snapshot/get/collect` 直通 | A | `dsh-skill/lib/index.js:132`（服务 `skills`） | M1 | planned |
| SV10 存储后端注册表 | `pluginApi.storage` 命名后端注册表直通 | A | `dsh-storage/lib/index.js:109`（服务 `storage`） | M1 | planned |
| SV11 会话投影注册表 | `pluginApi.sessionProjections.register({key,stateVersion,init,apply,view,schema})` / `onChanged` / `snapshot(session)` 直通 | A | `dsh-session-projection`（服务 `sessionProjections`） | M1 | planned |
| SV12 会话查询 | `pluginApi.sessionQuery.listSessions/readSession/filterSessions` 等直通 | A | `dsh-session-query`（服务 `sessionQuery`） | M1 | planned |
| SV13 会话标题 provider | `pluginApi.sessionTitle.register(provider)` 直通（官方为单 provider） | A | `dsh-session-title/lib/index.js:294`（服务 `sessionTitle`） | M1 | planned |
| SV14 会话遥测 seam | `pluginApi.sessionTelemetry`（backend seam）与 `session-telemetry/record` 事件稳定化 | A | `dsh-session-telemetry/lib/index.js:174`（服务 `sessionTelemetry`） | M1 | planned |
| SV15 会话引用解析 | `pluginApi.sessionReferences.listCandidates` / URI encode-decode 直通 | A | `dsh-session-reference`（服务 `sessionReferenceResolver`） | M1 | planned |
| SV16 Token 计量 | `pluginApi.tokenMeter.measure(session, requestHeader)` 直通 | A | `dsh-token-meter`（服务 `tokenMeter`） | M1 | planned |
| SV17 压缩服务 seam | `pluginApi.compaction`（`summarize()` 子类钩子；官方无 `compaction/*` 事件） | A | `dsh-compaction`（服务 `compaction`） | M2 | planned |
| SV18 默认模型选择 | `pluginApi.agentDefaultModel.currentSelection()` / `saveSelection(next)` 直通 | A | `dsh-agent-default-model`（服务 `agentDefaultModel`） | M1 | planned |

---

## 3. C 类上游提案汇总（M4，不写实现）

| 编号 | 提案 | 解决的问题 | 对应 B 类现状 |
|---|---|---|---|
| U1 | 官方 `llm/admission` 事件 | 让第三方声明会话/请求级输入策略，替代 `apiProxy.sessions.*` + `resolveModelInfo` 包装 | L1/L2（`llm-image-admission` delivered） |
| U2 | 官方 `llm/request`（异步完整请求改写） | 在模型请求最后边界做真正的请求改写，替代 `llm/stream` 重入 | L4/L5 |
| U3 | 官方 `exec.route` / `routeOf(exec)` | 工具执行上下文直接携带 `{provider, model}` 路由快照 | A9/T10 |
| U4 | 插件 boot 故障隔离 | 单个插件 apply 抛错不再杀死整个 harness boot | 本仓库所有入口 fail-safe（G1 模式） |
| U5 | `WEB_SETTINGS_NAMESPACES` 动态化 | 第三方插件设置命名空间无需修改官方即可出现在设置 UI | ST7 |
| U6 | 客户端 `remote.<ns>` 原生动态发现 | 第三方 client 插件无需 `ctx.remote.$mount` 自挂载 | C2/C7 |
| U7 | 官方 session 上屏事件构造 helper（可选） | 把 `surfaceOp` / `sourceEventSeqs` 的上屏契约封装为高级 API | S2/S6 |
| U8 | 官方 `compaction/*` 事件词汇（可选） | 当前压缩只有 `CompactionEngine.summarize()` 子类钩子，无 dispatch 点 | SV17 |

---

## 4. 迁移验收对象（后续 spec 的现实来源）

| 插件 | 现有 hack | 门面 API 替代 | 状态 |
|---|---|---|---|
| `dsh-read-image` | A1 monkey-patch `resolveModelInfo` | `pluginApi.llm.admission.register({match, project})` | delivered（首 feature 已迁移） |
| `dsh-read-image` | A2 `llm/stream` 重入投影 | `llm.admission` 的投影守卫（`ProjectionGuard`） | delivered（首 feature 已迁移） |
| `dsh-read-image` | A3 手搓 `@Remote` / A4 伪造 zod schema / A5 `ctx.remote.$mount` | ST4/ST5/ST6 settings 可视化配置桥 | planned（M3） |
| `dsh-read-image` | A6 `routeOf` 深挖 agent 内部 | A9/T10 `agent.routeOf` / `exec.route` | planned（M2） |
| `dsh-pro-ex-ability-anchor` | 手写 `surfaceOp`/`sourceEventSeqs` 上屏事件 | S2 session 上屏事件构造 helper | planned（M2） |
| `dsh-pro-ex-ability-anchor` | `system-prompt/assemble` 直接监听 | P6 类型化瀑布（行为等价） | planned（M1） |
| `dsh-pro-ex-ability-anchor` | panel 手写 `__ModuleLoader__` bundle + `dsh.client` manifest | C1 client manifest helper + C4 slot | planned（M3） |

---

## 5. 明确不做 / 边界

- 本文不是 API 契约定稿，不承诺签名稳定；每个 feature 的 EARS 需求、设计、任务在其独立 spec 目录中另行确认。
- 本文不包含实现代码；在对应 feature 的 Stage 4 之前不创建新的 `lib/` 模块。
- 不修改官方 DSH 包文件；C 类只写 proposal。
- 不公开 `resolveModelInfo` 的变更能力（只读查询 L7 可以，准入作用域 L1 是隐藏实现）。
- 门面不替插件决定投影/改写内容，只负责调用并校验结果（fail-closed）。

---

## 6. 下一步建议

1. 用户确认本文清单的范围与分组。
2. 按里程碑顺序，为每个 feature 建立独立 spec 目录（如 `docs/specs/llm-request-sync/`、`docs/specs/exec-route/`、`docs/specs/settings-bridge/`），进入 Kiro Stage 1 requirements。
3. 优先启动 M1（`pluginApi.events` + A 类事件 catalog），因为它几乎被所有后续 feature 依赖。
