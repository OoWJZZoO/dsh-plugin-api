# Feature List: plugin-api-features

> 状态：delivery registry（历史条目保留其原始 spec 链接；已交付项的最终形状以对应 approved spec 与 M2 integration reconciliation 为准）。本文不是脱离 spec 的独立 API 契约。A/B/C/R 分类与能力上限策略的权威细则见 `docs/standards/capability-strategy.md`。
>
> feature_name: `plugin-api-features`
> 范围：全量（host 面 + client 面 + C 类上游提案）
> 组织方式：按 API 命名空间分组，每项标注 A/B/C 类型与建议里程碑；已交付项标注 `**delivered**`。
>
> **命名空间安置规则**（`plugin-api-m1-integration` 确立）：顶层命名空间保留给**核心域**（`llm`、`agent`、`session`、`tools`、`systemPrompt`、`settings`）与**基础设施**（`events`）；二线**纯直通 capability seam** 统一收敛在 `pluginApi.services.<name>` 之下。未来新增的纯直通 feature 一律进 `services.*`；带门面附加语义的 feature 自建顶层命名空间。

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
| **R 类（替换类）** | 官方没有 dispatch 点，且缺失语义天然属于某个官方组件插件包 | 经 `docs/standards/capability-strategy.md` 批准登记后，由该组件的唯一 replacement owner 用官方 patch 机制（`disabled: true` + 插入替代行）禁用一个或多个该组件行并提供“官方原接口 + 扩展接口”；R 实现不得跨组件，且绝不 patch 官方包文件 |
| 门面基础 | 不属于 A/B/C 的服务/打包/协商能力 | 遵循 AGENTS.md 第 1–2 节硬约束 |

### 1.3 里程碑建议

| 里程碑 | 内容 |
|---|---|
| **M0** | 门面基础：`ctx.pluginApi` 服务、版本协商、fail-safe guard、打包与 row 顺序 |
| **M1** | 事件总线稳定化 + A 类事件/服务 catalog 的类型化直通 |
| **M2** | B 类语义钩子转译：同步 `llm/request`、`exec.route`、session 上屏 helper 等 |
| **M3** | settings 可视化配置桥 + client bundle（remote / codec / slot） |
| **M4** | 当前已冻结的剩余 A 类官方透传接口（host service seam、核心 namespace API、client service/event API） |
| **M5** | M4 冻结后审计发现的新增 A 类官方透传接口 |
| **M6** | 启发式候选 feature 规划里程碑：不在本文逐项列出，候选表单见 [heuristic-feature-proposals-2026-08-20.md](./dsh-plugin-api-heuristic-feature-proposals-2026-08-20.md)（20 个候选、第一/二梯队与 R 类评估）；候选经 Stage 0 批准正式立项后再按现行规则回填本文对应命名空间条目 |
| **M-final** | C 类上游提案、迁移验收（dsh-read-image / dsh-pro-ex-ability-anchor）与治理收尾 |

### 1.3.1 M2 共同契约状态（非公开 API）

| Feature | 外部 API | 范围 | 状态 |
|---|---|---|---|
| `plugin-api-semantic-hooks-m2` | 无；不增加 namespace、catalog slice 或 concrete B hook | B 类语义转译的分类、lifecycle、P1–P4、owner-local re-entry/durable 边界，以及首个 B 集成门槛；具体 L4、A9/T10、S2 仍待独立 spec。 | **delivered** |
| `plugin-api-session-durable-m2` | `pluginApi.session` durable observation 与受限 `appendMessage(targetSession, kind, payload, {sourceEventSeqs?})` host overlay；不增加 client、remote 或 catalog surface | S2/O8/O13/O14 的 host-only durable observation/append 能力；`sessionDurable` P2 epoch rollback 与 stale-cleanup protection；运行时及七个 audited package identity 固定为 `0.1.0-rc.6`；原始 standalone consumer deferral 已由 M2 integration Task 3.1 独立迁移完成。 | **delivered** |
| `plugin-api-m2-integration` | `pluginApi.routing` execution/session capability plane + M2 final reconciliation | `ofExecution/current/on/once/wait/availability` 的冻结 composite；A9/T10 compatibility delegates；H1 narrowed execRoute、H2 DurableObservationHub、L2 sole resolver wrapper、S2 finite append contract；47/5/19 cardinality 与 C-class prepared-route boundary。Task1–5 final reconciliation, governance, consumer evidence and verification complete. | **delivered** |

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
| `dsh-tool-cordis` | `lib/index.js` 的生成 `SERVICE_API` / `EVENT_API` | 官方 host service key、公开成员与全部 host event 的运行时目录；本次 M4 以此盘点全部剩余 A 类透传 |
| `dsh-client-*` / `dsh-cordis-client-runner` | 各 `lib/client.js` 的 `ctx.provide` / `ctx.reflect.provide` | 实际注册的浏览器 Cordis service；本次 M4 不把仅有类型声明或 UI 内部对象误列为 service |
| `dsh-web` | `lib/index.js` | `web` 服务：`registerSearchProvider` / `registerFetchProvider` |
| `dsh-host-apiproxy` | `lib/types/api-proxy.js` | `WEB_SETTINGS_NAMESPACES` 硬编码位置 |
| `dsh-fs` / `dsh-code-runtime` / `dsh-workspace` / `dsh-subagent` / `dsh-workflow-worker-thread` / `dsh-user-approval` / `dsh-user-questions` / `dsh-attachment` / `dsh-storage` | 各 `lib/index.js` | capability seams：`fs`、`codeRuntime`、`workspaceRegistry`、`subagents`、`workflowEngine`、`approval`、`userQuestions`、`attachments`、`storage` |
| `dsh-jobs` / `dsh-jobs-local` | 各 `lib/index.js` | `jobs` 后台任务注册表 seam（抽象 `JobRegistry` Service Definition + live `LocalJobRegistry` provider） |
| `dsh-shell-env` | `lib/index.js` | `shellEnv` 受管 `DSH_*` 环境注册表 seam（`ShellEnvRegistry`） |
| `dsh-tool-fs` / `dsh-tool-bash` / `dsh-tool-str-replace-editor` / `dsh-commands` / `dsh-skill` / `dsh-credentials` / `dsh-goal` / `dsh-schedule` | 各 `lib/index.js` | `fs/*`、`commands/change`、`skills/change`、`credentials/updated`、`goal/changed`、`schedule/change` |

---

## 2. Feature 清单（按命名空间）

> 表格列：`Feature` = 外部 API 形状；`类型` = A/B/C/门面基础；`来源` = 官方源码或既有 hack 依据；`里程碑` = 建议交付期；`状态` = `delivered` / `planned`。
> API 形状是示意性的 TypeScript 签名，不保证最终定稿。

### 2.1 `pluginApi` 门面基础（M0）

| Feature | 外部 API 形状（示意） | 类型 | 来源 | 里程碑 | 状态 |
|---|---|---|---|---|---|
| F0.1 门面服务 | `ctx.pluginApi`（Cordis Service，`inject: ['pluginApi']`）；**推荐、受支持**的门面入口；直连 `@deepseek-ai/dsh-*` 内部包为 unsupported escape hatch | 门面基础 | 本仓库 `lib/index.js` / `lib/plugin-api-service.js`；spec `plugin-api-foundation` | M0 | **delivered** |
| F0.2 fail-safe guard | `pluginApi.isActive: boolean`；核心 guard 失败时服务仍注册为 inert；非核心 feature 失败时只禁用该 feature 并显式报错 | 门面基础 | 本仓库 `lib/guards.js`；对齐 dsh-read-image G1；spec `plugin-api-foundation` | M0 | **delivered** |
| F0.3 版本协商 | 门面全量唯一版本号 = `<runtime全量版本>-<API协议大版本.迭代小版本>`（当前 `0.1.0-rc.6-0.5`，`dsh.api: 0.5`，写入 `package.json.version`）；`dsh.api` 仅承载 API 协议版本。主包名 `@deepseek-ai/dsh-plugin-api-main`（row id `plugin-api-main`），辅助 replacement bundles 位于 `packages/`。**主包与全部辅助包统一适用**该版本规则；主包校验辅助包版本一致，不一致仅停用该辅助包对应 R 特性。双向协商——方向① runtime 部分与安装的官方 runtime 不匹配时该包安全停用；方向② 插件要求不满足时插件收到 typed 错误。安装只提供全量聚合 `@deepseek-ai/dsh-plugin-api-full` 或选择性安装主包 + 辅助包。当前纯本地开发阶段，这些检查用于发现错配与契约漂移，不构成社区兼容承诺或生产运维政策。 | 门面基础 | 本仓库 `lib/version.js` / `lib/guards.js` / `package.json` / `packages/*/package.json`；spec `plugin-api-foundation` 与 M2 integration reconciliation | M0 | **delivered** |
| F0.4 符号解析门面 | `pluginApi` 作为**推荐** import/inject 面；第三方插件默认经门面解析符号；直连 `dsh-tools`/`dsh-llm` 等内部包属于 unsupported escape hatch（门面不拦截、不保障） | 门面基础 | `docs/specs/plugin-api-facade-integrity/requirements.md` §1（权威定义）；`README.md` | M0–M3 | delivered（F0.4 策略；符号覆盖随命名空间逐步扩展） |
| F0.5 包装链安全 | dispose 用 identity-guard；目标被其他插件包装时降级透传，不拆别人的链 | 门面基础 | 本仓库 `lib/wrap-safety.js` / `lib/admission-bridge.js`；dsh-read-image A1 加固；spec `plugin-api-facade-integrity` | M0 | **delivered** |

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
| E12 事件目录 | `pluginApi.events.catalog`（事件名 → 模式 / scopeKey / payload 类型 / fault / freeze / 是否 scope-filtered / A-B-C 来源） | 门面基础 | 本文第 2.3–2.11 节；目录为各 delivered feature 贡献切片的并集（`plugin-api-events-m1` 基线 19 条，M1 整合后共 47 条） | M1 | **delivered** |

### 2.3 `pluginApi.llm` —— 模型调用面（M1/M2/M4/M-final）

| Feature | 外部 API 形状（示意） | 类型 | 来源 | 里程碑 | 状态 |
|---|---|---|---|---|---|
| L1 图片准入注册（历史 superseded） | 旧 `llm.admission.register(intent)` / `admission.isActive`（不再是现行 API） | B | 历史 `docs/specs/llm-image-admission/*`；正式替代见 `plugin-api-llm-request-m2/supersession.md` | M0 | **delivered / superseded** |
| L2 受限图片准入政策 | `llm.admission.register({ id, match, input: 'image', process, validate })`（统一 L2/L4 管线；scoped gateway 是唯一 `resolveModelInfo` wrapper owner；`featureRegistry.isActive` 唯一信号） | B | `docs/specs/plugin-api-llm-request-m2/`；官方缺 `llm/admission` 事件 | M2 | **delivered** |
| L2 准入泛化（image 之外） | `llm.admission.register` 扩展为可声明其他 inputModalities/策略，或新增 `llm/input-policy` 语义 | B/C | 官方 `LlmResolvedModelInfo.inputModalities`；首 feature 只做 image | M-final | planned（C/M-final，需独立双边界证明） |
| L3 模型请求瀑布 | `events.waterfall('llm/stream', options, next)` 的类型化稳定版 | A | `dsh-llm/lib/index.js:1389`；`dsh-llm/lib/types/index.d.ts` `Events['llm/stream']` | M1 | **delivered** |
| L4 同步请求改写 | `llm.request.transform({ id, mode: 'compat', priority?, apply, isConverged })`（同步、幂等收敛、at-most-once 兼容重入） | B | 官方无 `llm/request`；用 `llm/stream` 重入模拟（AGENTS.md 第 4.4 条） | M2 | **delivered**（`docs/specs/plugin-api-llm-request-m2/`；无合成 `llm/request` 事件目录） |
| L5 异步完整请求改写 | `llm/request` 的异步全量改写版 | C | 官方无 dispatch 点；AGENTS.md 第 2.5 条 C 类 | M-final | planned（proposal） |
| L6 adapter 拓扑通知 | `events.on('llm/adapters-updated', listener)` 类型化（注意官方无 payload） | A | `dsh-llm/lib/index.js:929` | M1 | **delivered** |
| L7 模型信息只读查询 | `llm.modelInfo(provider, model, signal?): Promise<LlmResolvedModelInfo>`（只读，不提供修改） | A | `dsh-llm` `resolveModelInfo`；本仓库 design 已声明“不公开 ModelInfo 变更” | M1 | **delivered** |
| L8 调用准备与流式入口 | `llm.prepareCall(config, signal?)` / `llm.stream(options)` 稳定直通 | A | `dsh-llm/lib/index.js:1271/1384` | M1 | **delivered** |
| L9 provider 注册直通 | `llm.registerAdapter(providers, adapter)`、`llm.registerConfigurableProviders(entries)`、`llm.registerModelDiscovery(settingsNs, discover)` | A | `dsh-llm/lib/index.js:960` 起 | M1 | **delivered**（面向 provider/adapter 插件） |
| L10 官方准入事件 | 官方 `llm/admission` 事件（payload 含 session/request 上下文） | C | 本仓库 `llm-image-admission` R6 提案 | M-final | planned（proposal） |
| L11 官方 provider 目录与调用配置查询 | `llm.listProviders()`、`listConfigurableProviders()`、`discoverModels(settingsNs, request)`、`providerRetryPolicy(provider)`、`listModels(provider)`、`resolveCallConfig(config, signal?)` | A | `dsh-llm/lib/types/index.d.ts`；`LlmRuntime` 公共方法 | M4 | **delivered**（M4 official passthrough 交付） |
| L12 LLM 公共构造与流处理工件 | `llm.contentHasImage(content)`、`llm.createUserMessage(input)`、`llm.BlockAssembler` 稳定直通（L12 scope correction：仅这三项，不隐含同 package 其他导出；官方身份，不克隆不改写） | A | `dsh-llm/lib/index.js:176,650,673,1407`；`dsh-llm/lib/types/content.d.ts`、`message.d.ts`、`assembler.d.ts` | M4 | **delivered**（M4 official passthrough 交付） |

### 2.4 `pluginApi.agent` —— Agent 生命周期与驱动面（M1/M2/M4/M-final）

| Feature | 外部 API 形状（示意） | 类型 | 来源 | 里程碑 | 状态 |
|---|---|---|---|---|---|
| A1 Agent 生命周期事件 | `agent/created`、`agent/disposed`、`agent/status`、`agent/session-start` 类型化订阅 | A | `dsh-agent/lib/types/runtime-types.d.ts:134-220` | M1 | **delivered** |
| A2 Inbox 事件 | `agent/inbox/inserted|claimed|discarded` 类型化订阅 | A | 同上 `:180-208` | M1 | **delivered** |
| A3 步骤前置瀑布 | `events.waterfall('agent/pre-step', payload, next)`（可 reject / 替换进入步骤的 messages） | A | 同上 `:235-241`；`dsh-agent-loop/lib/index.js:501` | M1 | **delivered** |
| A4 模型路由决策 | `events.waterfall('agent/request', payload, next)`（替换 provider/model 配置） | A | 同上 `:254-259`；`dsh-agent-loop/lib/index.js:685` | M1 | **delivered** |
| A5 请求失败恢复 | `events.waterfall('agent/request-error', payload, next)` | A | 同上 `:275-283`；`dsh-agent-loop/lib/index.js:630` | M1 | **delivered** |
| A6 回合停止决策 | `events.serial('agent/turn-stopping', payload)` | A | 同上 `:301-305`；`dsh-agent-loop/lib/index.js:565` | M1 | **delivered** |
| A7 Agent 错误通知 | `events.on('agent/error', listener)` | A | 同上 `:316-321`；`dsh-agent-loop/lib/index.js:470` | M1 | **delivered** |
| A8 Agent 注册表读面 | `agent.get(id)`、`agent.list()`、`agent.roots()` 稳定直通 | A | `dsh-agent/lib/types/index.d.ts:349-370` | M1 | **delivered** |
| A9 当前执行路由查询 | `pluginApi.routing.ofExecution(exec)`；兼容委托 `agent.routeOf(exec)`：在 execution 首次进入 `tools/pre-execute` 时从公开 `session.requestContext()` 捕获同一冻结 `{provider, model}` 快照；未观察、正常缺失或 P2-disabled 时为 `undefined` | B | 官方无 `exec.route`；dsh-read-image A6（旧 `routeOf` 深挖 agent 内部） | M2 | **delivered** |
| A10 官方路由 API | 官方 `exec.route` / `routeOf(exec)` 或等价字段 | C | AGENTS.md 第 2.5 条 C 类 | M-final | planned（proposal） |
| A11 Agent 创建/注册高级面 | Consumer：`agent.create(options)`、`agent.resume(options)`、`agent.register(agent)`；advanced provider-only：`agent.provider.enter(agent, owner)`、`agent.provider.announce(agent)`、`agent.provider.setFactory(factory)`；只读 `agent.availability`：`{ create, resume, register, provider: { enter, announce, setFactory } }`，以及仅当全部 provider leaves 可用时为真的 `agent.provider.isActive` | A | `dsh-agent/lib/index.js:519` 起；`dsh-agent-loop/lib/index.js:1000` | M2 | **delivered** |
| A12 Agent initiator 与所有权查询 | `agent.currentInitiator()`、`requireInitiator()`、`withInitiator(agent, operation)`、`withoutInitiator(operation)`、`isOwnedBy(id, owner)` | A | `dsh-agent/lib/types/index.d.ts`；`AgentRegistry` 公共方法 | M4 | **delivered**（M4 official passthrough 交付） |
| A13 Agent 声明配置快照 | `agent.options` 的冻结只读快照（A13 scope correction：完整集合固定为 `provider`、`model`、`maxTokens`，含 `undefined` 值；不暴露 Agent/Session/Context/Inbox 或私有 registry 状态） | A | `dsh-agent/lib/types/runtime-types.d.ts:20-28,60-66`；官方 `Agent.options` | M4 | **delivered**（M4 official passthrough 交付） |

> A1–A8 已由 `plugin-api-agent-m1` 交付（spec 目录 `docs/specs/plugin-api-agent-m1/`）。关键约束：12 个 `agent/*` 事件作为独立 slice 纳入 `pluginApi.events.catalog` 并集；catalog 统一 schema 含 `scopeKey/fault/freeze` 字段（`plugin-api-m1-integration`）；`agent/created` 保留官方 sync-veto / async-report 语义；A3–A6 为 `fault:'propagate'`；`agent`/`signal` 永不 deepFreeze。
>
> A11 的 `create`、`resume`、`register` 是推荐的 consumer host API；`agent.provider.*` 是受支持但 advanced 的有序 provider 生命周期原语，不是普通创建入口。可用成员经 immutable `agent.availability` 逐成员表达；core inactive 为 P1，M1 whole-agent guard 失败或 A11 member 不可用为对应 P2。已解析的 A11 调用保留消费者 Cordis context、精确参数、原始同步返回/官方 registry Promise、`AgentHandle`、disposer、官方错误、lifecycle publication 与 teardown；门面不包装它们。尚未安装 factory 或官方 factory slot 已被占用均是官方 call-time outcome，不改变 availability。

### 2.5 `pluginApi.session` —— 会话与上屏事件面（M1/M2/M4/M-final）

| Feature | 外部 API 形状（示意） | 类型 | 来源 | 里程碑 | 状态 |
|---|---|---|---|---|---|
| S1 会话生命周期事件 | `session/created`、`session/disposed`、`session/event`、`session/flush` 类型化订阅 | A | `dsh-session/lib/types/index.d.ts:44-75` | M1 | **delivered** |
| S2 上屏事件构造 helper | `session.appendMessage(targetSession, kind, payload, { sourceEventSeqs?: readonly number[] }?)`：facade 自动构造 `surfaceOp: 'append'` 并验证/派生 provenance；仅允许 `user/message`、`assistant/message`、`tool/result` | B | `dsh-session` `append` 上屏契约；dsh-pro-ex-ability-anchor 第 4 条不变量；spec `plugin-api-session-durable-m2` | M2 | **delivered** |
| S3 会话读面 | `session.get(id)`、`session.list()`、`session.fork(source, boundary?, childId?)` 稳定直通 | A | `dsh-session/lib/types/index.d.ts:315-413` | M1 | **delivered** |
| S4 会话状态访问器 | `session.header/events/seq/surface`、`requestHeader()`、`requestContext()`、`deriveMessages()` 的稳定只读访问 | A | `dsh-session/lib/types/index.d.ts:106-267` | M1 | **delivered** |
| S5 会话事件目录 | `sessionEventTypes` / `surfaceEventTypes` 常量与类型守卫 | A | `dsh-session` `known-event-types`（`session/end-seed`、`session/title` 等） | M1 | **delivered** |
| S6 官方上屏 helper | 官方提供 `session.appendSurface(...)` 级别的高级构造 API | C | 当前 surface 契约靠插件自维护（dsh-pro-ex-ability-anchor） | M-final | planned（proposal，可选） |
| S7 会话创建与生命周期控制 | `session.create(id?, options?)`、`prepare(id?, options?)`、`enter(session)`、`announce(session)`、`flush(session)` | A | `dsh-session/lib/types/index.d.ts:290-385`；`SessionStore` 公共方法 | M4 | **delivered**（M4 official passthrough 交付） |
| S8 原始 session 事件与派生 helper | `session.append(type, data, opts?)`、`session.deriveEventMessage(event)` 稳定直通，并保留官方 durable event / projection 语义 | A | `dsh-session/lib/types/index.d.ts:212,261-266`；`dsh-session/lib/index.js:1440` | M4 | **delivered**（M4 official passthrough 交付） |

### 2.6 `pluginApi.tools` —— 工具注册与执行管线面（M1/M2/M4）

| Feature | 外部 API 形状（示意） | 类型 | 来源 | 里程碑 | 状态 |
|---|---|---|---|---|---|
| T1 工具注册 | `tools.register(definition: ToolDefinition): () => void`（`defineTool` 的类型化稳定版） | A | `dsh-tools/lib/types/index.d.ts:106-208` | M1 | **delivered** |
| T2 工具变更通知 | `events.on('tools/change', listener)`（注意官方为 unfiltered） | A | `dsh-tools/lib/index.js:2572` | M1 | **delivered** |
| T3 执行前瀑布 | `events.waterfall('tools/pre-execute', exec, next)`；default `{kind:'allow'}`，gate `allow|deny|ask`（`ask` 走 `ctx.approval` seam） | A | `dsh-tools/lib/index.js:3098` | M1 | **delivered** |
| T4 执行环绕瀑布 | `events.waterfall('tools/execute', exec, next)`（around body；timeout/retry/metrics，可替换 `exec.signal`） | A | `dsh-tools/lib/index.js:3195` | M1 | **delivered** |
| T5 执行后瀑布 | `events.waterfall('tools/post-execute', exec, result, next)`；default `{kind:'accept'}`，decision `accept({content?|value?})` / `block({feedback})` | A | `dsh-tools/lib/index.js:3360` | M1 | **delivered** |
| T6 结果通知 | `events.on('tools/result', (exec, result) => void)`（contained；`exec`/`result` 均 frozen、observe-only） | A | `dsh-tools/lib/index.js:3266-3284` | M1 | **delivered** |
| T7 代码分发日志瀑布 | `events.waterfall('tools/code-dispatch-log', dispatch, next)`；返回替换后的 content | A | `dsh-tools/lib/index.js:2953` | M1 | **delivered** |
| T8 工具限制与守卫 | `tools.restrict(filter)`、`tools.guard(guard)` 稳定直通 | A | `dsh-tools` `ToolRuntime.restrict/guard` | M1 | **delivered** |
| T9 工具查询与执行 | `tools.get(name, scope?)`、`tools.schemas(scope?)`、`tools.execute(input)`、`tools.presentAs` 稳定直通 | A | `dsh-tools` `ToolRuntime` 公共方法 | M1 | **delivered** |
| T10 执行路由查询 | `tools.routeOf(exec)`：与 `agent.routeOf(exec)`、`routing.ofExecution(exec)` 返回同一按 execution 缓存的冻结 route 快照；捕获仅发生在 prepended `tools/pre-execute`，不创建 `exec.route` 或 route event/catalog slice | B | 官方无 `exec.route`；与 A9 同源 | M2 | **delivered** |
| T11 工具中止错误构造 | `tools.toolAbortedError()`：返回与官方 dsh-tool-bash/pwsh 一致的“工具调用已中止”错误（`HarnessError('tool call aborted', TOOL_ABORTED)` + `name='AbortError'`，typed identity）；官方常量缺失时降级裸 `Error`（`name='AbortError'`） | A | `dsh-tools/lib/index.js:2411`（`TOOL_ABORTED`）；`dsh-llm/lib/types/error.js`（`HarnessError`）；`dsh-tool-bash/lib/index.js:408-409` | M4 | **delivered**（旧 M4 交付，经 M4 official passthrough 回归复证） |
| T12 执行模式查询 | `tools.executionMode(exec)`：读取官方工具执行的 `parallel` / `exclusive` 模式 | A | `dsh-tools/lib/types/index.d.ts:690`；`ToolRuntime.executionMode` | M4 | **delivered**（M4 official passthrough 交付） |
| T13 工具定义构造器 | `tools.defineTool(options)`：schema 转换、参数校验、输出/调用呈现器、超时与并发元数据生成官方 `ToolDefinition` | A | `dsh-tools/lib/index.js:836`；`dsh-tools/lib/types/schema.d.ts:177-239` | M4 | **delivered**（M4 official passthrough 交付） |

> 管线顺序（官方已定，门面只稳定化不重排）：`tools/pre-execute` → 单调 `guard()` 检查 → `tools/execute` → `tools/post-execute` → 工具 `finalizeContent` → `tools/result`。定义里的 `timeoutMs` 由 `dsh-tool-call-timeout-policy`（`tools/execute` wrapper）执行，不在门面内复制。

### 2.7 `pluginApi.systemPrompt` —— 系统提示组装面（M1/M4/M5）

| Feature | 外部 API 形状（示意） | 类型 | 来源 | 里程碑 | 状态 |
|---|---|---|---|---|---|
| P1 段落注册 | `systemPrompt.section(section: PromptSection): () => void` | A | `dsh-system-prompt/lib/types/index.d.ts:187` | M1 | **delivered** |
| P2 动态上下文注册 | `systemPrompt.context(context: PromptContext): () => void` | A | 同上 `:194` | M1 | **delivered** |
| P3 变量注册 | `systemPrompt.variable(name, provider): () => void` | A | 同上 `:218` | M1 | **delivered** |
| P4 工具 schema 提供者 | `systemPrompt.tools(provider): () => void` | A | 同上 `:209` | M1 | **delivered** |
| P5 运行时上下文抑制 | `systemPrompt.suppressRuntimeContext(): () => void` | A | 同上 `:201` | M1 | **delivered** |
| P6 组装瀑布 | `events.waterfall('system-prompt/assemble', assembly, context, next)` 类型化（经 `pluginApi.events` catalog） | A | `dsh-system-prompt/lib/index.js:283` | M1 | **delivered（受限只读近似；完整可写语义见 P10）** |
| P7 变更通知 | `events.on('system-prompt/change', listener)`（经 `pluginApi.events` catalog） | A | `dsh-system-prompt/lib/index.js:160` | M1 | **delivered** |
| P8 渲染 helper | `systemPrompt.render(assembly)` / `renderContextSections(assembly)` 稳定直通（官方公开导出直通） | A | `dsh-system-prompt` 导出的 `renderPrompt/renderContextSections` | M1 | **delivered** |
| P9 官方组装入口 | `systemPrompt.assemble(context?)` | A | `dsh-system-prompt/lib/types/index.d.ts:228`；`SystemPrompt.assemble` | M4 | **delivered**（M4 official passthrough 交付） |
| P10 可写组装瀑布语义 | `system-prompt/assemble` 在 `await next()` 前后允许监听器按官方语义改写 `assembly.sections/contexts/tools/variables`，不被门面冻结策略破坏 | A | `dsh-system-prompt/lib/index.js:267-289`；现有 catalog `freeze: 'all'` 与官方可写 waterfall 不等价 | M4 | **delivered**（M4 official passthrough 交付） |
| P11 上下文渲染辅助函数 | `systemPrompt.renderContextSnapshot(assembly)`、`joinContextSections(sections)` 稳定直通 | A | `dsh-system-prompt/lib/types/index.d.ts:149-162` | M5 | **delivered** |

### 2.8 `pluginApi.settings` —— 设置与可视化配置桥（M1/M3/M4/M-final）

| Feature | 外部 API 形状（示意） | 类型 | 来源 | 里程碑 | 状态 |
|---|---|---|---|---|---|
| ST1 命名空间注册 | `settings.register(ns, schema, {base, applies, validate})` 类型化 | A | `dsh-settings/lib/types/index.d.ts:225` | M1 | **delivered** |
| ST2 设置作用域 | `settings.scope<T>(ns): SettingsScope<T>`（`get/watch/update/replace/mutate`） | A | 同上 `:85-111` | M1 | **delivered** |
| ST3 设置事件 | `events.on('settings/updated'\|'settings/document-updated', listener)` | A | `dsh-settings/lib/index.js:523,561` | M1 | **delivered** |
| ST4 设置可视化桥（host 侧） | `settings.remote(namespace, serviceKey?)`：官方 `bindTypertRemote` 等价 service-object 注册可远程调用的设置服务 | B | dsh-read-image A3（手搓 `@Remote`）；`dsh-typert-protocol` | M3 | **delivered** |
| ST5 设置可视化桥（client 侧） | `client.mountRemoteContribution(contribution)`：封装 `ctx.remote.$mount` + face 校验 + 失败 UI 降级 | B | dsh-read-image A5（`ctx.remote.$mount` 自挂载）；`dsh-api-remotes/lib/client.js` | M3 | **delivered** |
| ST6 真 codec 生成 | client bundle 打包一份 zod，生成满足 `dsh-api-remotes` 校验的 descriptor（替代 looseSchema） | B | dsh-read-image A4（伪造 zod schema）；AGENTS.md 第 4.5 条 | M3 | **delivered** |
| ST7 插件设置命名空间动态化 | 官方 `WEB_SETTINGS_NAMESPACES` 支持第三方插件命名空间 | C | `dsh-host-apiproxy/lib/types/api-proxy.js:50-52` 当前硬编码 7 个命名空间 | M-final | planned（proposal） |
| ST8 设置描述与安装 helper | `settings.describe({redactSecrets})` 稳定直通；`installSettingsSection(ctx, ns, schema, entry, hooks)` 作为注册便利封装 | A | `dsh-settings/lib/index.js`（`describe` L352；`installSettingsSection` L618） | M1 | **delivered** |
| RB1 通用 Typert Remote host 发布 | `remote.publish(serviceKey, service)`：任意 JSON-safe 配置/状态服务经官方 `bindTypertRemote` + `Remote` marker + `ctx.reflect.provide` 发布为 web 可消费的 Typert remote，返回 owner 作用域 disposer；`service` 自有可调用成员即 endpoint，方法参数名即 wire 名 | B | `dsh-typert-protocol`（`bindTypertRemote`/`Remote`/`remoteMethods`/`isTypertRemoteSegment`）；`dsh-api-gateway` source-mode 自动发现（`dsh-api-gateway/lib/index.js:75-88,143-156`）；pro-ex `lib/config-remote.js`（95 行手搓桥，迁移目标） | M4 | **delivered**（旧 M4 交付，经 M4 official passthrough 回归复证） |
| ST9 设置文档与可写能力 | `settings.writable`、`prepareDocument()`、`get()`、`update(patch)`、`replace(section)`、`mutate(ops)` | A | `dsh-settings/lib/types/index.d.ts:187-203`、`SettingsScope` 公共方法 | M4 | **delivered**（M4 official passthrough 交付） |

### 2.9 `pluginApi.client` —— 客户端 bundle / slot / remote（M3/M4/M5/M-final）

| Feature | 外部 API 形状（示意） | 类型 | 来源 | 里程碑 | 状态 |
|---|---|---|---|---|---|
| C1 `dsh.client` manifest helper | `client.defineManifest({platform, inject?, immediately?})` + `exports["./client"]` 约定（helper 遵循官方 generic platform shape；本包 metadata 固定 web） | A | `dsh-client-modules/lib/index.js:60-99`；manifest 类型 `lib/types/client/manifest.d.ts:46-64` | M3 | **delivered** |
| C2 remote 贡献装配 | `client.mountRemote(contribution)`（含 `ctx.remote.$mount`、命名空间 face 校验） | B | dsh-read-image A5；`dsh-api-remotes/lib/client.js:5912-5921`；`TypertRemoteContribution = {package, descriptors}` | M3 | **delivered** |
| C3 客户端设置 scope | `client.settingsScope.bind(spec)` 类型化（getSnapshot/subscribe/set/unset） | A | `dsh-client-ui-settings/lib/client.js:207` | M3 | **delivered** |
| C4 Slot 注册 | `slots.register(options, component)` / `slots.inject(key, callback)` / `slots.entries(key)` / `slots.subscribe(key, fn)` 类型化；`SlotEntryDef` 契约（`kind/scope/owner/keyProps/store/inject` 等） | A | `dsh-client-runtime/lib/types/client/slots.d.ts:74-172`；`dsh-client-ui-slots` `SlotCore.register` | M3 | **delivered** |
| C5 Slot 变更事件 | `client.slots.on('slots/changed', (key) => {})`；canonical slot id 目录（`settings.*`、`sidebar.*`、`shell.overlay`、`conversation`、`details` 等） | A | `dsh-client-runtime/lib/types/client/index.d.ts:99`；`dsh-client-ui-settings/lib/types/client/contract/slots.d.ts` | M3 | **delivered** |
| C6 客户端事件桥 | `client.remote.$on/$dispatch` 稳定直通（host→client 事件转发；官方 forwarded-event allowlist） | A | `dsh-api-gateway/lib/client.js:35-66`；`dsh-api-remotes/lib/index.js` `API_REMOTE_FORWARDED_EVENTS` | M3 | **delivered** |
| C7 `remote.<ns>` 原生动态发现 | 官方客户端运行时原生支持第三方 remote 命名空间发现（去掉硬编码 `TYPERT_REMOTE$*`） | C | `dsh-api-remotes/lib/client.js` 硬编码 5 个贡献（`commands/goals/dynamicCordisRunner/pluginInventory/messageFeedback`） | M-final | planned（proposal） |
| C8 Typert schema/invocation 注册 | `exports["./typert"]` 工件自动装载到 `ctx.typert`（schema/invocation/lookup/context）；门面提供类型化封装 | A | `dsh-typert-loader/lib/index.js:218/282`；`dsh-typert-registry` `register` | M3 | **delivered** |
| C9 连接与 API 客户端 | `client.connection` 稳定直通：`rpc.call("/api", endpoint, {args}, signal)`、`api.settings.*` | A | `dsh-client-connection/lib/client.js`（`connection` 服务） | M3 | **delivered** |
| C10 客户端模块服务 | `client.modules`：`version`、`loadCache`、`import(specifier)`、`registerStatic(id, module)`、`prefetch(id)`、`invalidate(id)` 直通 | A | `dsh-client-modules/lib/types/client/manifest.d.ts`；`ClientModuleLoader` | M4 | **delivered**（M4 official passthrough 交付） |
| C11 客户端 locale 服务 | `client.locale`：语言字典注册、绑定与当前 locale 访问 | A | `dsh-client-locale/lib/types/client/index.d.ts` | M4 | **delivered**（M4 official passthrough 交付） |
| C12 客户端 sessions 服务 | `client.sessions`：`list/currentProvideInfo/searchResultLimit` 只读状态，及 `open/openSubagent/search/fork/clear/provide` 等官方 outward face | A | `dsh-client-runtime/lib/client.js`（`ctx.reflect.provide('sessions', ...)`）；`lib/types/client/contract/sessions.d.ts` | M4 | **delivered**（M4 official passthrough 交付） |
| C13 客户端 workspaces 服务 | `client.workspaces`：工作区列表状态、创建/选择/排序/归档等官方 outward face | A | `dsh-client-runtime/lib/client.js`（`ctx.reflect.provide('workspaces', ...)`）；`lib/types/client/contract/workspaces.d.ts` | M4 | **delivered**（M4 official passthrough 交付） |
| C14 chat file mentions 服务 | `client.chatFileMentions.forClosing(owner)` 直通 | A | `dsh-client-ui-deliverables/lib/client.js`（`ctx.provide('chatFileMentions', ...)`） | M4 | **delivered**（M4 official passthrough 交付） |
| C15 layout 服务 | `client.layout.toggleSidebar/openDetails/closeDetails` 直通 | A | `dsh-client-ui-layout/lib/client.js`（`ctx.reflect.provide('layout', ...)`）；`lib/types/client/service.d.ts` | M4 | **delivered**（M4 official passthrough 交付） |
| C16 theme 服务 | `client.theme.getTheme/exportInspectTokens/setTheme/register/overrideTokens` 直通 | A | `dsh-client-ui-theme/lib/client.js`（`ctx.provide('theme', ...)`）；`lib/types/client/index.d.ts` | M4 | **delivered**（M4 official passthrough 交付） |
| C17 app shell 服务 | `client.appShell.renderApp()` 直通 | A | `dsh-client-web/lib/index.js`（`ctx.reflect.provide('appShell', ...)`） | M4 | **delivered**（M4 official passthrough 交付） |
| C18 session-log 下载服务 | `client.sessionLogDownload.store/download/dismiss/dispose` 直通 | A | `dsh-session-log-export/lib/client.js`（`ctx.provide('sessionLogDownload', ...)`）；`lib/types/client/controller.d.ts` | M4 | **delivered**（M4 official passthrough 交付） |
| C19 Cordis inspect 服务 | `client.cordisInspect.register/publish/query/close` 直通 | A | `dsh-cordis-client-runner/lib/client.js`（`ctx.provide('cordisInspect', ...)`）；`lib/types/client/inspect-registry.d.ts` | M4 | **delivered**（M4 official passthrough 交付） |
| C20 动态 Cordis runner 服务 | `client.dynamicCordisRunner` 的 run 审批、加载状态与订阅 face 直通 | A | `dsh-cordis-client-runner/lib/client.js`（`ctx.provide('dynamicCordisRunner', ...)`）；`lib/types/client/index.d.ts` | M4 | **delivered**（M4 official passthrough 交付） |
| C21 locale 变更事件 | `events.on('locale/change', snapshot)` 类型化 | A | `dsh-client-locale/lib/client.js`；`lib/types/client/index.d.ts` | M4 | **delivered**（M4 official passthrough 交付） |
| C22 theme 变更事件 | `events.on('theme/change', snapshot)` 类型化 | A | `dsh-client-ui-theme/lib/client.js`；`lib/types/client/index.d.ts` | M4 | **delivered**（M4 official passthrough 交付） |
| C23 连接重置事件 | `events.on('connection/reset', listener)` 类型化 | A | `dsh-client-runtime/lib/client.js`；`lib/types/client/index.d.ts` | M4 | **delivered**（M4 official passthrough 交付） |
| C24 命令执行确认事件 | `events.on('command/executed', (sessionId, commandName, result) => {})` 类型化 | A | `dsh-client-ui-commands/lib/types/client/service.d.ts` 事件契约；`lib/client.js` 派发点 | M4 | **delivered**（M4 official passthrough 交付） |
| C25 客户端 LLM catalog API | `client.connection.api.llm.providers/models/discoverModels` 稳定读面，并保留官方 RPC payload、signal 与返回语义 | A | `dsh-client-connection/lib/client.js:6349-6353`；官方 `connection.api.llm` | M4 | **delivered**（M4 official passthrough 交付） |
| C26 输入触发器服务 | `client.inputTriggers` 官方输入触发器注册与触发面直通 | A | `dsh-client-ui-input-trigger/lib/client.js:589` | M5 | **delivered** |
| C27 命令 UI 服务 | `client.commandUi` 官方命令 UI 注册与状态面直通 | A | `dsh-client-ui-commands/lib/client.js:508` | M5 | **delivered** |
| C28 模型目录服务 | `client.modelDirectories` 官方模型目录与选择面直通 | A | `dsh-client-ui-model-selection/lib/client.js:170` | M5 | **delivered** |
| C29 会话服务 | `client.conversation` 官方会话 UI 服务面直通 | A | `dsh-client-ui-conversation/lib/client.js:98` | M5 | **delivered** |
| C30 会话事件服务 | `client.conversationEvents` 官方会话事件服务面直通 | A | `dsh-client-runtime/lib/client.js:10161` | M5 | **delivered** |
| C31 会话视图服务 | `client.conversationViews` 官方会话视图服务面直通 | A | `dsh-client-runtime/lib/client.js:10211` | M5 | **delivered** |
| C32 客户端计时器服务 | `client.timer` 官方计时器服务面直通 | A | `dsh-cordis-client-runner/lib/client.js:3738` | M5 | **delivered** |

### 2.10 其他宿主事件稳定化（统一走 `pluginApi.events`，M1/M2/M4）

> M3 的 C6 只稳定化浏览器侧 `client.remote.$on/$dispatch` 转发，不产生 host `pluginApi.events` catalog 条目；因此即使个别事件已在其官方转发白名单中，下列 host dispatch 仍须作为 M4 A 类事件目录交付。

| Feature | 事件名 | 类型 | 来源 | 里程碑 | 状态 |
|---|---|---|---|---|---|
| O1 文件写意图 | `fs/write-intent`（waterfall；payload `{target, exec}`） | A | `dsh-tool-fs/lib/index.js:658`（经 `dsh-fs` seam；`target = {targetKey, displayPath}`） | M1 | **delivered** |
| O2 文件编辑意图 | `fs/edit-intent`（waterfall；payload `{target, exec}`） | A | `dsh-tool-fs/lib/index.js:809` | M1 | **delivered** |
| O3 文件观测通知 | `fs/observed`（emit；payload `{target, observation, actor}`；`observation.kind: present|absent`） | A | `dsh-tool-fs/lib/index.js:278` | M1 | **delivered** |
| O4 子代理生命周期 | `subagent/start`（payload `{runId, provider, id, local}`）、`subagent/end`（payload `{runId, provider, id, local, stopReason, lastAssistantMessage?}`） | A | `dsh-subagent/lib/index.js:199-250` | M1 | **delivered** |
| O5 子代理 provider | `subagent/provider-added`（payload `provider`）、`subagent/provider-removed`（payload `providerName`） | A | `dsh-subagent/lib/index.js:2474-2476` | M1 | **delivered** |
| O6 工作流事件 | `workflow/start|phase|log|agent-start|agent-end|end`（payload 见 `dsh-workflow-worker-thread` 各 emit 点） | A | `dsh-workflow-worker-thread/lib/index.js:895-909` | M1 | **delivered** |
| O7 审批请求瀑布 | `approval/request`（waterfall；payload `req {agent, toolName, callId?, reason?, signal}`；outcome `allowed-once|rejected|cancelled|unavailable`，fail-closed） | A | `dsh-user-approval/lib/index.js:189`；scope 权威表 `dsh-scope/lib/invariant.js` | M1 | **delivered** |
| O8 审批 durable 事件 | `approval/policy|asked|decided`（session-log 事件，非 ctx 事件） | A | `dsh-user-approval/lib/index.js:78,148,155`；spec `plugin-api-session-durable-m2` | M2 | **delivered** |
| O9 命令变更 | `commands/change`（emit） | A | `dsh-commands/lib/index.js:348` | M1 | **delivered** |
| O10 技能变更 | `skills/change`（emit） | A | `dsh-skill/lib/index.js:404` | M1 | **delivered** |
| O11 凭据更新 | `credentials/updated`（emit） | A | `dsh-credentials/lib/index.js:45` | M1 | **delivered** |
| O12 目标变更 | `goal/changed`（agent-scoped emit；payload `{agent, change}`） | A | `dsh-goal/index.js:793`；`dsh-scope` 权威表 | M1 | **delivered** |
| O13 调度 durable 事件 | `schedule/change`（session-log 事件；payload `{version:1, operation: create|delete|dispatch}`） | A | `dsh-schedule/lib/index.js:310-357`；spec `plugin-api-session-durable-m2` | M2 | **delivered** |
| O14 子代理 descriptor | `subagent/descriptor`（session-log 事件，非 ctx 事件） | A | `dsh-subagent/lib/index.js:640`；spec `plugin-api-session-durable-m2` | M2 | **delivered** |
| O15 Web 检索/抓取 provider | `services.web.registerSearchProvider(provider)`、`services.web.registerFetchProvider(provider)` 稳定直通（`plugin-api-m1-integration` 任务 2.9 起经 `pluginApi.services.web` 提供；原顶层 `pluginApi.web` 已移除） | A | `dsh-web/lib/index.js:67-77` | M1 | **delivered** |
| O16 会话遥测记录 | `session-telemetry/record`（waterfall；payload `{record}`） | A | `dsh-session-telemetry/lib/index.js:174` | M1 | **delivered** |
| O17 Agent 配置与预设通知 | `agent-loop/config-start-failed(payload {sessionId, error})`、`agent-preset/selected(sessionId, agentPreset)`（均 emit） | A | `dsh-tool-cordis/lib/index.js` 生成 `EVENT_API`；`dsh-agent-loop/lib/types/index.d.ts:36-39`；`dsh-agent-presets/lib/types/types.d.ts:12` | M4 | **delivered**（M4 official passthrough 交付） |
| O18 动态 Cordis activation 生命周期 | `cordis/dynamic-package(pkg)`、`cordis/dynamic-retract(retracted)`、`cordis/request-run(request)`、`cordis/request-run-resolved(resolved)`（均 emit） | A | `dsh-tool-cordis/lib/index.js` 生成 `EVENT_API`；`dsh-cordis-host-runner/lib/types/index.js:282,788,924,1106` | M4 | **delivered**（M4 official passthrough 交付） |
| O19 Cordis inspect 查询生命周期 | `cordis/inspect-query(request)`、`cordis/inspect-query-resolved(resolved)`（均 emit） | A | `dsh-tool-cordis/lib/index.js` 生成 `EVENT_API`；`dsh-cordis-host-runner/lib/types/inspect-registry.js:137-150` | M4 | **delivered**（M4 official passthrough 交付） |
| O20 Storage domain 变更通知 | `domain/changed(change: DomainChanged)`（emit；后端确认持久化后发出） | A | `dsh-tool-cordis/lib/index.js` 生成 `EVENT_API`；`dsh-storage-domain/lib/types/events.d.ts:41` | M4 | **delivered**（M4 official passthrough 交付） |

### 2.11 其他宿主服务稳定化（capability seams，M1/M4）

> 这些官方服务是工具/子代理/审批等能力的底层 seam。门面策略：**稳定直通 + 类型化 + fail-safe**，不发明新语义；个别服务（如 `approval`、`userQuestions`）保留官方 fail-closed 行为。
>
> M4 的 host 盘点以 `dsh-tool-cordis` 生成 `SERVICE_API` 的 55 个 service key 与 `EVENT_API` 的 56 个 event 为一条基线，但不把它当作官方公开面总表：LLM/工具/session/agent 的公开导出与构造器、客户端 provider service 与 connection API 仍需分别核对。现有 host event catalog 交付 47 条，余下 9 条列于 O17–O20；M3 C6 的浏览器远程转发不计作 host catalog。原 M4 已合并的 `T11`、`RB1`、`SV19`、`SV20` 原编号保留在新 M4，并显式标为已交付；其余 A 类 service key 与 `web` 尚未透传的方法在本节逐项列出。

| Feature | 外部 API 形状（示意） | 类型 | 来源 | 里程碑 | 状态 |
|---|---|---|---|---|---|
| SV1 文件系统 seam | `pluginApi.services.fs`：`resolve/processPath/fileUrl/contains/stat/lstat/readText/streamText/readBytes/listDir/writeText/editText` + `sandboxMode` 直通 | A | `dsh-fs/lib/index.js`（服务 `fs`） | M1 | **delivered** |
| SV2 代码执行 seam | `pluginApi.services.codeRuntime`：`run` + `language/isolation` 直通 | A | `dsh-code-runtime/lib/index.js`（服务 `codeRuntime`） | M1 | **delivered** |
| SV3 工作区注册表 | `pluginApi.services.workspaces`：`create/get/list/delete/insertBefore/archiveSession/resolveByPath` + `archivedSessionIds` 直通 | A | `dsh-workspace/lib/index.js:309`（服务 `workspaceRegistry`） | M1 | **delivered** |
| SV4 子代理运行时 | `pluginApi.services.subagents`：`registerProvider/getProvider/list/start` 等 12 个公开方法直通 | A | `dsh-subagent/lib/index.js:2467`（服务 `subagents`） | M1 | **delivered** |
| SV5 工作流引擎 | `pluginApi.services.workflows.start(request)` 直通 | A | `dsh-workflow/lib/index.js:59`（服务 `workflowEngine`） | M1 | **delivered** |
| SV6 审批服务 | `pluginApi.services.approval.request()` / `setPolicy()` / `overrideOf()` 直通（fail-closed 不变） | A | `dsh-user-approval/lib/index.js:89`（服务 `approval`） | M1 | **delivered** |
| SV7 用户提问服务 | `pluginApi.services.userQuestions.registerProvider()` / `ask()` 直通 | A | `dsh-user-questions/lib/index.js:23`（服务 `userQuestions`） | M1 | **delivered** |
| SV8 附件存储 | `pluginApi.services.attachments`：`validateImage/saveImage/readImage` + `imageLimits` 直通 | A | `dsh-attachment/lib/index.js:44`（服务 `attachments`） | M1 | **delivered** |
| SV9 技能注册表 | `pluginApi.services.skills.registerProvider/register/list/snapshot/get` 直通 | A | `dsh-skill/lib/index.js:132`（服务 `skills`） | M1 | **delivered** |
| SV10 存储后端注册表 | `pluginApi.services.storage`：`backend/domain/mount/form` 直通 | A | `dsh-storage/lib/index.js:109`（服务 `storage`） | M1 | **delivered** |
| SV11 会话投影注册表 | `pluginApi.services.sessionProjections.register({key,stateVersion,init,apply,view,schema})` / `onChanged` / `snapshot(session)` 等直通 | A | `dsh-session-projection`（服务 `sessionProjections`） | M1 | **delivered** |
| SV12 会话查询 | `pluginApi.services.sessionQuery.listSessions/readSession/filterSessions` 等 14 个公开方法直通 | A | `dsh-session-query`（服务 `sessionQuery`） | M1 | **delivered** |
| SV13 会话标题 provider | `pluginApi.services.sessionTitle.register(provider)` 等直通（官方为单 provider） | A | `dsh-session-title/lib/index.js:294`（服务 `sessionTitle`） | M1 | **delivered** |
| SV14 会话遥测 seam | `pluginApi.services.sessionTelemetry`（backend seam 直通；`session-telemetry/record` 事件已由 O16 交付） | A | `dsh-session-telemetry/lib/index.js:174`（服务 `sessionTelemetry`） | M1 | **delivered** |
| SV15 会话引用解析 | `pluginApi.services.sessionReferences.listCandidates/prepare` + `encodeSessionReferenceUri/decodeSessionReferenceUri` 转发 | A | `dsh-session-reference`（服务 `sessionReferenceResolver`） | M1 | **delivered** |
| SV16 Token 计量 | `pluginApi.services.tokenMeter.measure(session, requestHeader)` / `estimateMessage` 直通 | A | `dsh-token-meter`（服务 `tokenMeter`） | M1 | **delivered** |
| SV17 压缩服务 seam | `pluginApi.services.compaction.compactIfNeeded/compactNow/compactRegion` 直通；不暴露 Basic 专有成员。SV17 直通本身不产生 events；`compaction/*` 事件词汇由 replacement 包 `@deepseek-ai/dsh-plugin-api-compaction-events` 提供（见 U8） | A | `dsh-compaction`（服务 `compaction`） | M2 | **delivered** |
| SV18 默认模型选择 | `pluginApi.services.agentDefaultModel.currentSelection()` / `saveSelection(next)` 直通 | A | `dsh-agent-default-model`（服务 `agentDefaultModel`） | M1 | **delivered** |
| SV19 后台任务注册表 seam | `pluginApi.services.jobs`：`start/list/get/read/kill/wait/onJobDone/onJobsChanged/attachController` 九个抽象 `JobRegistry` 操作直通；`onJobDone/onJobsChanged/attachController` 返回官方 disposer；不暴露 concrete-provider 私有成员，且无 `jobs/*` events API | A | `dsh-jobs` 抽象 Service Definition（服务 `jobs`；live provider `dsh-jobs-local`） | M4 | **delivered**（旧 M4 交付，经 M4 official passthrough 回归复证） |
| SV20 受管环境 seam | `pluginApi.services.shellEnv`：`register/collect/list` 三个 `ShellEnvRegistry` 操作直通；`register` 返回官方 disposer；不暴露 registry 私有成员，且无 `shellEnv/*` events API | A | `dsh-shell-env`（服务 `shellEnv`） | M4 | **delivered**（旧 M4 交付，经 M4 official passthrough 回归复证） |
| SV21 Agent loop seam | `pluginApi.services.agentLoop`：`config`、`create`、`createAgent`、`resume` 直通 | A | `dsh-tool-cordis/lib/index.js` 生成 `SERVICE_API`（服务 `agentLoop`） | M4 | **delivered**（M4 official passthrough 交付） |
| SV22 Agent preset seam | `pluginApi.services.agentPresets`：`list/resolve/mount/composeFrom/composedPreset/read/copy/remove/serviceFor/recompose/standingKeyFor` 直通 | A | 同上（服务 `agentPresets`） | M4 | **delivered**（M4 official passthrough 交付） |
| SV23 API proxy seam | `pluginApi.services.apiProxy.downloads/respond` 直通 | A | 同上（服务 `apiProxy`） | M4 | **delivered**（M4 official passthrough 交付） |
| SV24 Host client-module registry seam | `pluginApi.services.clientModules`：`graph/clientPath/rebuilt/onRebuilt/onGraphChanged` 直通；与浏览器 `client.modules`（C10）分属两面 | A | 同上（服务 `clientModules`） | M4 | **delivered**（M4 official passthrough 交付） |
| SV25 命令服务 seam | `pluginApi.services.commands.register/list/find/execute` 直通 | A | 同上（服务 `commands`） | M4 | **delivered**（M4 official passthrough 交付） |
| SV26 凭据服务 seam | `pluginApi.services.credentials.resolve/describe/set/unset` 直通 | A | 同上（服务 `credentials`） | M4 | **delivered**（M4 official passthrough 交付） |
| SV27 目录选择 capability | `pluginApi.services.directoryPicker.capability()` 直通 | A | 同上（服务 `directoryPicker`） | M4 | **delivered**（M4 official passthrough 交付） |
| SV28 E2B sandbox seam | `pluginApi.services.e2b.cwd/runtimeRoot/getSandbox` 直通 | A | 同上（服务 `e2b`） | M4 | **delivered**（M4 official passthrough 交付） |
| SV29 目标服务 seam | `pluginApi.services.goals.get/disarm/create/edit/pause/resume/complete/block/clear/remoteExportCreate` 直通 | A | 同上（服务 `goals`） | M4 | **delivered**（M4 official passthrough 交付） |
| SV30 Invariant 注册表 | `pluginApi.services.invariants.register(packageName, installer)` 直通 | A | 同上（服务 `invariants`） | M4 | **delivered**（M4 official passthrough 交付） |
| SV31 LSP 服务 seam | `pluginApi.services.lsp.registerProvider/query` 直通 | A | 同上（服务 `lsp`） | M4 | **delivered**（M4 official passthrough 交付） |
| SV32 消息反馈服务 seam | `pluginApi.services.messageFeedback.list/put/delete` 直通 | A | 同上（服务 `messageFeedback`） | M4 | **delivered**（M4 official passthrough 交付） |
| SV33 权限预设 seam | `pluginApi.services.permissionPresets.current/selectFor/resolve/optionOf/set` 直通 | A | 同上（服务 `permissionPresets`） | M4 | **delivered**（M4 official passthrough 交付） |
| SV34 Plan Mode seam | `pluginApi.services.planMode.get/set` 直通 | A | 同上（服务 `planMode`） | M4 | **delivered**（M4 official passthrough 交付） |
| SV35 Sandbox capability | `pluginApi.services.sandbox.confine(argv, policy)` 直通 | A | 同上（服务 `sandbox`） | M4 | **delivered**（M4 official passthrough 交付） |
| SV36 Sandbox policy seam | `pluginApi.services.sandboxPolicy.defaultMode/workspaceRoot/resolve/overrideOf` 直通 | A | 同上（服务 `sandboxPolicy`） | M4 | **delivered**（M4 official passthrough 交付） |
| SV37 会话持久化 seam | `pluginApi.services.sessionPersistence.locate/supportsRawArtifacts/readRaw/create/append/prepare/load/inspect/readFrom/list/listSnapshots` 直通 | A | 同上（服务 `sessionPersistence`） | M4 | **delivered**（M4 official passthrough 交付） |
| SV38 会话投影缓存 seam | `pluginApi.services.sessionProjectionCache.cachedSnapshot/write/coldSnapshot` 直通 | A | 同上（服务 `sessionProjectionCache`） | M4 | **delivered**（M4 official passthrough 交付） |
| SV39 Shell 执行 seam | `pluginApi.services.shell.resolve/run/start` 直通 | A | 同上（服务 `shell`） | M4 | **delivered**（M4 official passthrough 交付） |
| SV40 Spill store seam | `pluginApi.services.spillStore.saveText(input)` 直通 | A | 同上（服务 `spillStore`） | M4 | **delivered**（M4 official passthrough 交付） |
| SV41 Storage domain seam | `pluginApi.services.storageDomain.open/get/closeAll` 直通；与 SV10 的 `storage.backend/mount/form` 分离 | A | 同上（服务 `storageDomain`） | M4 | **delivered**（M4 official passthrough 交付） |
| SV42 子进程 seam | `pluginApi.services.subprocess.resolveExecutable/spawn/spawnTerminal` 直通 | A | 同上（服务 `subprocess`） | M4 | **delivered**（M4 official passthrough 交付） |
| SV43 终端服务 seam | `pluginApi.services.terminals.registerBackend/listBackends/spawn/hasOwnerActivity/startSend/read/signal/kill/list` 直通 | A | 同上（服务 `terminals`） | M4 | **delivered**（M4 official passthrough 交付） |
| SV44 Timer seam | `pluginApi.services.timer.timeout/interval/throttle/debounce` 直通（保留官方 overload / 返回语义） | A | 同上（服务 `timer`） | M4 | **delivered**（M4 official passthrough 交付） |
| SV45 工具结果裁剪 seam | `pluginApi.services.toolResultPruner.config/measureContent/pruneContent/pruneSession` 直通 | A | 同上（服务 `toolResultPruner`） | M4 | **delivered**（M4 official passthrough 交付） |
| SV46 Typert gateway seam | `pluginApi.services.typertGateway.invoke(request)` 直通 | A | 同上（服务 `typertGateway`） | M4 | **delivered**（M4 official passthrough 交付） |
| SV47 Web server seam | `pluginApi.services.webServer.register/registerUpgrade/registerFallback/tapIndex/applyIndexTaps` 直通 | A | 同上（服务 `webServer`） | M4 | **delivered**（M4 official passthrough 交付） |
| SV48 Web 执行 seam | 在既有 O15 provider 注册外，`pluginApi.services.web.search/fetch` 直通 | A | 同上（服务 `web`）；O15 仅已交付 provider 注册 | M4 | **delivered**（M4 official passthrough 交付） |

---

## 3. C 类上游提案汇总（M-final，不写实现）

| 编号 | 提案 | 解决的问题 | 对应 B 类现状 |
|---|---|---|---|
| U1 | 官方 `llm/admission` 事件 | 让第三方声明会话/请求级输入策略，替代 `apiProxy.sessions.*` + `resolveModelInfo` 包装 | L1/L2（`llm-image-admission` delivered） |
| U2 | 官方 `llm/request`（异步完整请求改写） | 在模型请求最后边界做真正的请求改写，替代 `llm/stream` 重入 | L4/L5 |
| U3 | 官方 prepared-route / `exec.route` seam | 在 prompt/tool assembly 前提供最终 route 与稳定 causal identity，供未来 route-conditioned contribution；当前 `exec.route` 与 pre-assembly route 均不存在 | A9/T10 / M2 C proposal |
| U4 | 插件 boot 故障隔离 | 单个插件 apply 抛错不再杀死整个 harness boot | 本仓库所有入口 fail-safe（G1 模式） |
| U5 | `WEB_SETTINGS_NAMESPACES` 动态化 | 第三方插件设置命名空间无需修改官方即可出现在设置 UI | ST7 |
| U6 | 客户端 `remote.<ns>` 原生动态发现 | 第三方 client 插件无需 `ctx.remote.$mount` 自挂载 | C2/C7 |
| U7 | 官方 session 上屏事件构造 helper（可选） | 把 `surfaceOp` / `sourceEventSeqs` 的上屏契约封装为高级 API | S2/S6 |
| U8 | 官方 `compaction/*` 事件词汇（可选） | 当前压缩只有 `CompactionEngine.summarize()` 子类钩子，无 dispatch 点；R 类辅助包 `@deepseek-ai/dsh-plugin-api-compaction-events`（运行时名 `plugin-api-compaction-events`，历史治理名 `compaction-events-r1`）为 current workaround | SV17 + R1 replacement |
| U9 | 官方 session-title 候选资格 / 合成消息排除 | 官方 `session-title` 的 fallback 与 first-prompt provider 会把已入库的 `source.kind: 'user'` 合成消息直接当作标题候选，无候选资格 dispatch 点；R 类辅助包 `@deepseek-ai/dsh-plugin-api-session-title`（运行时名 `plugin-api-session-title`，历史治理名 `session-title-r1`）为 current workaround。**退役条件**：官方提供等价候选资格 seam（如官方 `session-title/candidate` 事件或内置合成消息排除）后，辅助包 deprecate/退役，消费者迁移至官方 seam | session-title 服务（R 类） |

---

## 3.1 R 类（replacement bundle）与 B→R 迁移策略（M-final 治理登记）

> 权威细则见 `docs/standards/capability-strategy.md`（含 R1–R9 硬性规则与方案二例外条件）。本节只做登记，不引入实现。

判定规则：按官方组件边界、官方契约是否可完整保留、运行时风险与长期维护成本判断；不采用统一量化评分。高风险、跨组件或无法证明契约保留的能力维持门面转译；横切派发语义永不 R。普通 feature 只需提供与决策相关的最小证据，R、durable mutation、异步重入和 client replacement 才要求完整契约与失败路径证明。

| B/C 项 | 现转译/现状 | 拟 fork 行 | 工作量 | 价值 | 决策 |
|---|---|---|---|---|---|
| L4 同步 `llm/request` | `llm/stream` 重入 + marker + 收敛 | `llm` | 高 | 高 | 维持方案一（R 类候选，暂不排期） |
| L2 图片准入 | 包装 `apiProxy.sessions` + `llm.resolveModelInfo` | 不适用：跨多个官方组件包的 R 实现被禁止 | 很高 | 高 | 维持方案一 |
| A9/T10 `exec.route` | `tools/pre-execute` prepend + `session.requestContext()` | `tools`（完整 route 还需 `agent-loop` 协同） | 高 | 高 | 维持方案一 |
| S2 session 上屏 helper | 门面校验后调官方 `Session.append` | `session` | 高 | 高 | 维持方案一 |
| ST4 host 设置 remote 桥 | 自建 `bindTypertRemote` 等价实现 | `typert-gateway` 或 typert 相关行 | 中 | 中 | R 类观察项，不单独立项 |
| ST5/ST6/C2（+C7） | `$mount` 自挂载 + 手搓 codec | `api-remotes`（client bundle） | 高 | 高 | 维持方案一；C7 维持 proposal |
| E8/E9/E11 priority / deepFreeze / fault containment | facade 注册侧/派发侧统一实现 | 无单一官方行（框架级横切） | — | — | **永不 R** |
| U8 `compaction/*` 事件词汇 | 仅 `summarize()` 子类钩子 | `compaction-basic` | 低–中 | 高 | **已交付**（运行时名 `plugin-api-compaction-events`；U8 保留为上游提案，stale-index B4 已迁移） |
| U9 `session-title/candidate` 候选资格 / 合成消息排除 | 官方 fallback + first-prompt provider 直接消费 `source.kind:'user'`，无候选资格 dispatch 点 | `session-title`（`dsh-session-title`） | 低–中 | 高 | **已交付**（运行时名 `plugin-api-session-title`；U9 保留为上游提案，replacement 为 current workaround，退役条件见 §3 U9 行） |

---

## 4. 迁移验收对象（后续 spec 的现实来源）

| 插件 | 现有 hack | 门面 API 替代 | 状态 |
|---|---|---|---|
| `dsh-read-image` | A1 monkey-patch `resolveModelInfo` | L2 `pluginApi.llm.admission.register({id, match, input:'image', process, validate})`；wrapper 由 facade scoped gateway 唯一持有 | delivered（已迁移，旧 shape superseded） |
| `dsh-read-image` | A2 `llm/stream` 重入投影 | L4 sole request owner + L2 policy pipeline；无独立 raw listener/projector | delivered（已迁移，旧 shape superseded） |
| `dsh-read-image` | A3 手搓 `@Remote` / A4 伪造 zod schema / A5 `ctx.remote.$mount` | ST4/ST5/ST6 settings 可视化配置桥 | delivered（M3；已迁移） |
| `dsh-read-image` | A6 `routeOf` 深挖 agent 内部 | `pluginApi.routing.ofExecution(exec)`（或 A9/T10 兼容委托）；session-created/prompt-time final route 仍不可用 | delivered（M2 migration） |
| `dsh-pro-ex-ability-anchor` | 手写 `surfaceOp`/`sourceEventSeqs` 上屏事件 | `pluginApi.session.appendMessage(targetSession, kind, payload, {sourceEventSeqs?})` | delivered（M2 migration） |
| `dsh-pro-ex-ability-anchor` | `system-prompt/assemble` 直接监听 | P6 类型化瀑布（行为等价） | planned（M1） |
| `dsh-pro-ex-ability-anchor` | panel 手写 client bundle/manifest + slot glue | C1 client manifest helper + C4 slot | delivered（M3；已迁移） |
| `dsh-pro-ex-ability-anchor` | 标题纠偏 hack（`lib/index.js:574-691`：`titleFixed`/`realTitleText`/`titleCitesVirtual`/`fixSessionTitle` + 两处 `session/event` 事后监听） | `pluginApi.events.on('session-title/candidate', ...)` exclude 策略（`source.form === ANCHOR_USER_SOURCE_FORM`） | blocked（迁移在 pro-ex 仓库执行，须其独立获批任务；本仓库 fixture 与配方见 `packages/session-title/MIGRATION_RECIPE.md`） |
| `dsh-pro-ex-ability-anchor` | `lib/config-remote.js`（95 行手搓 `TypertRemoteService` 桥） | RB1 `pluginApi.remote.publish('extraproAnchorConfig', service)`（wire 参数名 `settings` 保留） | delivered（M4 predicate + 仓库侧 contract-lock；消费者删文件迁移按 AC 7.3 记录 waive，理由见 delivery report） |
| `dsh-pro-ex-ability-anchor` | Git Bash 工具 `ctx.get('jobs')` / `ctx.get('shellEnv')` 直连 | `pluginApi.services.jobs` / `pluginApi.services.shellEnv`（`isActive` 门控 + typed-error 降级） | delivered（M4 migration；pro-ex 工作树内测试全绿，commit 与 `plugin-api-tools-abort-helper-m4` 共享文件协调） |
| `dsh-pro-ex-ability-anchor` | 手工组合 `loadAbortedErrorFactory`（`lib/index.js`，`HarnessError(TOOL_ABORTED)` + 裸 `AbortError` 兜底） | `pluginApi.tools.toolAbortedError()`（含裸 `AbortError` 兜底） | delivered（M4；迁移 headless 验收 123/123 通过，dev-boot 待 M4 integration） |

---

## 5. 明确不做 / 边界

- 本文不是 API 契约定稿，不承诺签名稳定；每个 feature 的 EARS 需求、设计、任务在其独立 spec 目录中另行确认。
- 本文不包含实现代码；在对应 feature 的 Stage 4 之前不创建新的 `lib/` 模块。
- 不修改官方 DSH 包文件。C 类默认只写 proposal；经 `docs/standards/capability-strategy.md` 批准登记的 R 类可经官方 patch 机制替代官方行（仍不 patch 官方包文件）。
- 不公开 `resolveModelInfo` 的变更能力（只读查询 L7 可以；L2 scoped gateway 的唯一 wrapper 仅为 facade 内部实现）。
- 门面不替插件决定投影/改写内容，只负责调用并校验结果（fail-closed）。

---

## 6. 下一步建议

1. 用户确认本文清单的范围与分组。
2. 先按 M4 的冻结 A 类直通范围建立独立 spec：核心 namespace 补面、host service catalog 和 client service/event catalog；`T11`、`RB1`、`SV19`、`SV20` 只做已交付状态核验，不重命名或重做。
3. M4 完成后按 M5 清单补齐冻结后发现的 A 类接口；M6 候选表单经 Stage 0 逐个立项并回填本文后再进入 M-final：仅处理 C 类上游提案、迁移验收与治理收尾，不把 C 类事项混入 A 类直通实现。

---

## 7. 已交付 feature 登记（防过期）

> 本表 2026-08-21 自 AGENTS.md §8 迁入；AGENTS.md 不再承载逐项登记，只保留登记规则指针（其 §8）。每个 feature 在 Stage 4 交付后，必须在本节追加条目，并同步本文各命名空间条目状态；公开 API 形状或里程碑状态变化时同步更新，防止文档过期过时。

| Feature | 范围 | 状态 | Spec 目录 | 关键约束 / 设计 |
|---|---|---|---|---|
| `plugin-api-foundation` | M0 F0.1–F0.3（`ctx.pluginApi` 服务、fail-safe guard、双向版本协商） | delivered | `docs/specs/plugin-api-foundation/` | host 插件 `inject=[]`；核心/feature 两级 guard；全量唯一版本号 `<runtime全量版本>-<API协议大版本.迭代小版本>`（方向①比 runtime 部分，方向②比 `dsh.api` 协议版本；修订见 §4.2 与 integration 任务 2.10） |
| `plugin-api-facade-integrity` | M0 F0.4–F0.5（符号解析门面、包装链安全） | delivered | `docs/specs/plugin-api-facade-integrity/` | `lib/wrap-safety.js` identity-guard；F0.4 权威定义 |
| `llm-image-admission` | 历史 L1（图片准入 B 类） | delivered（R2/R4/R7 已被 `plugin-api-llm-request-m2` supersede，见 supersession.md） | `docs/specs/llm-image-admission/` | 仅保留历史 audit；现行 authority 是 `plugin-api-llm-request-m2` 的 L2/L4，旧 admission-bridge/ProjectionGuard 不再是运行时 owner |
| `plugin-api-events-m1` | M1 基底：E1–E12 + O1–O7, O9–O12, O15, O16（`pluginApi.events` 稳定事件总线 + 基线 19 条事件目录 + web 直通） | delivered | `docs/specs/plugin-api-events-m1/` | events-bus 原生 hook 按序重注册；deepFreeze 只读 payload；scope 过滤（`args[0].agent` + `carrierKeyOf`）；`@deepseek-ai/dsh-scope` peerDependency；catalog 总数为各 delivered feature slice 并集（M1 整合后 47 条）；O15 自 integration 任务 2.9 起经 `pluginApi.services.web` 提供 |
| `plugin-api-tools-m1` | M1 tools：T1–T9（`pluginApi.tools` 服务直通 + 6 个 `tools/*` 事件目录） | delivered | `docs/specs/plugin-api-tools-m1/` | `pluginApi.tools` scope-aware accessor（`this.ctx.get('tools')`）；6 个 tools 事件 catalog；`tools/execute` 的 `except-signal` 冻结策略；挂载顺序 `tools` 先于 `events` |
| `plugin-api-agent-m1` | M1：A1–A8（12 个 `agent/*` 事件目录 + `pluginApi.agent.get/list/roots` 直通） | delivered | `docs/specs/plugin-api-agent-m1/` | catalog `scopeKey/fault/freeze` 三字段；`agent/created` sync-veto 保留；A3–A6 propagate；live `agent`/`signal` 不 deepFreeze；A8 直通 `ctx.agents` |
| `plugin-api-session-m1` | M1 会话面：S1 + S3 + S4 + S5（`pluginApi.session` 生命周期事件订阅 + 会话读面 + 只读状态访问器 + 会话事件目录） | delivered | `docs/specs/plugin-api-session-m1/` | S1 复用组合 events catalog；S4 `surface` 返回冻结快照；S5 从 `KNOWN_SESSION_EVENT_TYPES` + `isSurfaceEligibleType` 派生；`@deepseek-ai/dsh-session` peerDependency |
| `plugin-api-llm-m1` | L3, L6, L7, L8, L9（`llm/stream` 类型化 waterfall、`llm/adapters-updated` 类型化 emit、`llm.modelInfo` 只读查询、`prepareCall`/`stream` 直通、provider 注册直通） | delivered | `docs/specs/plugin-api-llm-m1/` | `llm` feature guard 六方法探测；`modelInfo` deepFreeze 只读；L9 注册 handle 原样直通；贡献 `llm/stream` + `llm/adapters-updated` 两个 catalog slice |
| `plugin-api-system-prompt-m1` | M1 P1–P8（`pluginApi.systemPrompt`：P1–P5 服务直通 + P6/P7 事件目录扩展 + P8 渲染直通） | delivered | `docs/specs/plugin-api-system-prompt-m1/` | P1–P5 同参转发官方 disposer；P6/P7 经 `pluginApi.events` catalog（`system-prompt/assemble` scope key `args[1].scope`）；P8 官方公开导出 `renderPrompt`/`renderContextSections` 直通；`@deepseek-ai/dsh-system-prompt` peerDependency |
| `plugin-api-settings-m1` | M1 settings：ST1/ST2/ST3/ST8（`pluginApi.settings` 命名空间注册、scope、设置事件、describe/install helper） | delivered | `docs/specs/plugin-api-settings-m1/` | `lib/settings.js` A 类直通官方 `ctx.settings`；可选 settings 服务模式（服务缺失时 feature 仍 active，register/scope/describe 抛 service-unavailable，installSettingsSection 保持官方 no-op fallback）；`settings/updated`/`settings/document-updated` 进 events catalog 并带 feature gating；`@deepseek-ai/dsh-settings` peerDependency |
| `plugin-api-capabilities-m1` | M1 SV1–SV16, SV18（17 个官方 capability seam 服务经 `pluginApi.services.<name>` 稳定直通） | delivered | `docs/specs/plugin-api-capabilities-m1/` | `lib/services.js` 静态定义表 + frozen namespace/facade；method/getter/forward 三类 1:1 直通；per-service degradation；SV15 URI helpers 走 `@deepseek-ai/dsh-session-reference` 公开导出转发（peerDependency） |
| `plugin-api-m1-integration` | M1 整合：7 分支合并 + 总线/工程契约统一 + API 形状规范化（E1–E12 基线 + L3/L6–L9 + A1–A8 + S1/S3–S5 + T1–T9 + P1–P8 + ST1–ST3/ST8 + SV1–SV16/SV18 全量落地） | delivered（历史 M1 boundary） | `docs/specs/plugin-api-m1-integration/` | catalog slice 制 + `composeCatalogs` fail-loud + guard 驱动取舍（47 条）；统一 schema `scopeKey/fault/freeze`（`'all'\|{deep}\|'except-signal'`）；gating 唯一机制 = 挂载期 slice 排除；幂等信号统一 `featureRegistry.isActive`；失败呈现四路径；FEATURE_MOUNTERS 终序 tools≺events≺…≺services；`web` 迁入 `pluginApi.services.web`；M1 历史 boundary version `0.1.0-rc.6-0.2`，现行 full version 以 M2 integration 为准；并行开发工作流协议（§3.5） |
| `plugin-api-semantic-hooks-m2` | M2 B 类语义转译共同契约（非运行时 foundation） | delivered | `docs/specs/plugin-api-semantic-hooks-m2/` | 不新增 hook、namespace、catalog slice 或 runtime engine；具体 owner 自有 re-entry/convergence/disposer/durable identity；首个 B catalog/facade 仍须先完成独立的 transaction/rollback integration design。 |
| `plugin-api-compaction-m2` | M2 SV17（`pluginApi.services.compaction` A 类压缩 service seam） | delivered | `docs/specs/plugin-api-compaction-m2/` | `pluginApi.services` 扩为 19 项；仅直通 `compactIfNeeded`/`compactNow`/`compactRegion`，排除 Basic 专有成员；通用逐定义 facade 构建失败局部降为 P4，且无 `compaction/*` events API 或迁移目标（两个验收插件均无 SV17 workaround）。 |
| `plugin-api-llm-request-m2` | M2 L4 compat transform + L2 图片准入政策（统一管线） | delivered | `docs/specs/plugin-api-llm-request-m2/` | `llm/request` 唯一 owner（raw listener + marker + at-most-once compat re-entry）；`llm/admission` 只暴露 `register(policy)`（`{id, match, input:'image', process, validate}`）；L2 scoped gateway 是唯一 `resolveModelInfo` wrapper owner，`pluginApi.llm.modelInfo()` 走 authoritative bypass；`featureRegistry.isActive` 唯一信号；正式 supersede `plugin-api-llm-m1` L1/L8 窄化与 `llm-image-admission` R2/R4/R7（见 `supersession.md`）；dsh-read-image 已迁移（`[Image #N]` 投影经统一管线）。 |
| `plugin-api-exec-route-m2` | M2 A9 + T10（`pluginApi.routing.ofExecution(exec)` 及兼容委托 `pluginApi.agent/tools.routeOf(exec)`） | delivered | `docs/specs/plugin-api-exec-route-m2/` | H1 narrowed：`tools/pre-execute` prepend 只依赖 tools/session，仅读取公开 `session.requestContext()`，按 execution 一次捕获冻结 `{provider, model}` 或 `undefined`；三个入口共享同一 identity；私有 WeakMap、prepared reversible activation、无 B route catalog slice；A6 已迁移，缺失 route 保留视觉 relay fallback。 |
| `plugin-api-agent-create-m2` | M2 A11（`pluginApi.agent` consumer 创建/恢复/注册 + advanced provider ordered lifecycle） | delivered | `docs/specs/plugin-api-agent-create-m2/` | 六个 A11 leaves 经冻结 `agent.availability` 逐成员表达；调用从消费者 context 解析 `agents`，原样保留参数、receiver、Promise/handle/disposer/error/lifecycle identity；factory 缺失与 slot 占用仍为官方 call-time outcome；A11 extension 与 exec-route 共享 coordinated agent facade transaction，失败只回滚自身并保持 M1/其他 extension。 |
| `plugin-api-session-durable-m2` | M2 S2/O8/O13/O14：`pluginApi.session` durable observation 与受限 `appendMessage(targetSession, kind, payload, {sourceEventSeqs?})` host 能力 | delivered | `docs/specs/plugin-api-session-durable-m2/` | H2 `DurableObservationHub` 负责 service-lifetime native registration 与 epoch-local observers；dispatch 内不 dispose hook、不 reconcile；无 client bundle、remote namespace、synthetic Cordis event 或 catalog slice；P2 epoch rollback/stale-cleanup protection；运行时与七个 audited package identity 固定为 `0.1.0-rc.6`；两个 consumer migration 已由独立获批任务完成。 |
| `plugin-api-m2-integration` | M2 final reconciliation：L2/L4、A9/T10、A11、S2/O8/O13/O14、SV17 与 `pluginApi.routing` execution/session capability plane | delivered | `docs/specs/plugin-api-m2-integration/` | Task1–5 final reconciliation, governance, consumer evidence and verification complete. `pluginApi.routing` 是 service-lifetime stable frozen composite（`ofExecution/current/on/once/wait/availability`）；A9/T10 为 compatibility delegates；47 events / 5 durable kinds / 19 services 互相独立；pre-assembly prepared-route 与 route-conditioned contribution 仅为 C proposal；M2 界内唯一 full version 为 `0.1.0-rc.6-0.3`，`dsh.api` `0.3`（现行 authority：主包与全部辅助包统一 `0.1.0-rc.6-0.5` / `0.5`；辅助包版本不一致仅停用相关 R 特性）。 |
| `plugin-api-settings-remote-m3` | M3 ST4 host settings remote bridge | delivered | `docs/specs/plugin-api-settings-remote-m3/` | `pluginApi.settings.remote(namespace, serviceKey?)`；官方 `bindTypertRemote` 等价 service-object 实现；redacted snapshots、validated mutations、stale-disposer protection、fail-safe publication。 |
| `plugin-api-client-settings-remote-m3` | M3 ST5 settings remote client adapter | delivered | `docs/specs/plugin-api-client-settings-remote-m3/` | 复用 C2 mount owner 与 ST6 codec；settings face 校验；host unavailable 时 degraded/inert UI；严格 disposer/duplicate ownership。 |
| `plugin-api-client-codec-m3` | M3 ST6 bundled real codec | delivered | `docs/specs/plugin-api-client-codec-m3/` | client bundle 内唯一 zod copy；真实 `dsh-api-remotes` descriptor codec；拒绝 loose/forged/cross-bundle schemas。 |
| `plugin-api-client-manifest-m3` | M3 C1 client manifest helper | delivered | `docs/specs/plugin-api-client-manifest-m3/` | `defineManifest`/`isManifest` 遵循官方 generic platform shape；本包 metadata 仍固定 `web`；`./client` loader boundary 保持官方格式。 |
| `plugin-api-client-remote-contribution-m3` | M3 C2 generic remote contribution mount | delivered | `docs/specs/plugin-api-client-remote-contribution-m3/` | package/descriptor/face validation precedes one official `$mount`; exact owner disposer and local rollback; no C7 dynamic discovery。 |
| `plugin-api-client-settings-scope-m3` | M3 C3 client settings scope forwarding | delivered | `docs/specs/plugin-api-client-settings-scope-m3/` | typed forwarder to official `settingsScope.bind`; preserves official scope identity and four-member surface。 |
| `plugin-api-client-slots-m3` | M3 C4 typed client slot facade | delivered | `docs/specs/plugin-api-client-slots-m3/` | official register/inject/entries/subscribe semantics; canonical slot IDs; stable ownership and failure containment。 |
| `plugin-api-client-slot-events-m3` | M3 C5 `slots/changed` client event | delivered | `docs/specs/plugin-api-client-slot-events-m3/` | exact `(key: string)` event after committed mutation；shared `client.slots` parent without host catalog expansion。 |
| `plugin-api-client-remote-events-m3` | M3 C6 forwarded client remote events | delivered | `docs/specs/plugin-api-client-remote-events-m3/` | official forwarded-event allowlist；exact `$on/$dispatch` carrier semantics；listener failure containment。 |
| `plugin-api-typert-m3` | M3 C8 Typert artifact facade | delivered | `docs/specs/plugin-api-typert-m3/` | official registry schema/invocation/lookup/context delegation；preserves receiver, order, disposer and duplicate/error identity；`exports["./typert"]` boundary。 |
| `plugin-api-client-connection-m3` | M3 C9 client connection/API facade | delivered | `docs/specs/plugin-api-client-connection-m3/` | exact `/api` RPC wire and `api.settings.*` forwarding；Promise, error and cancellation identity preserved。 |
| `plugin-api-m3-integration` | M3 final integration and migration boundary | delivered | `docs/specs/plugin-api-m3-integration/` | W5 composition, client bundle loader verification, consumer migrations, full test/diff-check and official-package audit complete；2026-08-19 post-delivery review findings closed by reconciliation batch 10（C2 动态 namespace 解析、pending mount 生命周期、client 局部 fail-safe、C5/C6 异步 containment），final acceptance complete；C7/ST7 remain proposals。 |
| `plugin-api-compaction-events-r1` | R 类 replacement bundle（R1）：fork `compaction-basic` 行提供 `compaction/*` 事件词汇；主包改名 monorepo（`@deepseek-ai/dsh-plugin-api-main`, full version `0.1.0-rc.6-0.4` / `dsh.api: 0.4`） | delivered | `docs/specs/plugin-api-compaction-events-r1/` | 历史治理名 `plugin-api-compaction-events-r1`；现行运行时名为 `@deepseek-ai/dsh-plugin-api-compaction-events`（源码 `packages/compaction-events/`，row id `plugin-api-compaction-events`，feature `compaction-events`）。disable `compaction-basic` + insert 替代行；ForkedEngine trigger 穿线 + `compaction/request` 策略瀑布（reject/replace-range）+ started/completed/failed/skipped；apply boot 自检矩阵与 `Symbol.for('dsh-plugin-api.compaction-events.contract')` 契约符号；主包 `pluginApi.events.catalog` 动态 replacement slice（guard 过滤 + 版本一致校验，主包不 import 辅助包）；辅助包与主包版本不一致时仅停用本 R 特性；dsh-read-image B4 stale-index 消费已迁移；U8 保留为上游提案（replacement 为 current workaround）。 |
| `plugin-api-session-title-r1` | R 类 replacement bundle（R2）：fork `session-title` 行提供 `session-title/candidate` 候选资格策略瀑布；主包 full version `0.1.0-rc.6-0.5` / `dsh.api: 0.5` | delivered | `docs/specs/plugin-api-session-title-r1/` | 历史治理名 `plugin-api-session-title-r1`；现行运行时名为 `@deepseek-ai/dsh-plugin-api-session-title`（源码 `packages/session-title/`，row id `plugin-api-session-title`，feature `session-title`）。disable `session-title` + insert 替代行；ForkedSessionTitleService 五处采集点统一为策略感知 `collectEligible`（fallback 与 first-prompt provider 消费同一策略后候选集）；`session-title/candidate` 逐候选 waterfall（exclude/replace，先返回者胜，throw/thenable 收敛，payload message/source 深冻结）；apply boot 自检矩阵 + config 连续性 + `Symbol.for('dsh-plugin-api.session-title.contract')` 契约符号；主包 catalog 动态 replacement slice（guard 过滤 + 版本一致校验，主包不 import 辅助包）；辅助包与主包版本不一致时仅停用本 R 特性；pro-ex 标题纠偏迁移阻塞于其独立获批任务（fixture/配方 见 `packages/session-title/MIGRATION_RECIPE.md`）；U9 保留为上游提案（replacement 为 current workaround）。 |
| `plugin-api-host-remote-m4` | M4 RB1 通用 host 侧 Typert Remote 发布（`pluginApi.remote.publish(serviceKey, service)`） | delivered | `docs/specs/plugin-api-host-remote-m4/` | B 类门面转译，只消费官方公开原语（`bindTypertRemote`/`Remote`/`remoteMethods`/`isTypertRemoteSegment` + `ctx.reflect.provide`）；共享核心 `lib/remote-publication.js` owner 参数化（`remote` 与 `settingsRemote` 各自 owner 语义，AC 5.6）；`re-home` 专用原型防 marker 泄漏 + `dedicatedProtos` 识别（D2/D2b）；冲突用官方注册表只读探测、同键异引用 typed error；签名/`signal` 注册前校验（wire 参数名即方法参数名）；KNOWN_FEATURES 增加 `remote`、guard 无 `TypertRemoteService` 探针；D5 recorded deviation：ST4 `settings-remote.js` 委托共享核心（settings 专用 get/set 保留，既有测试全绿）；client 侧零改动（复用 ST5/C2）；R 类 `typert-gateway` 观察项未动；pro-ex `config-remote.js` 迁移动机成立（仓库侧 contract-lock 已锁，消费者删文件迁移按 AC 7.3 waive）。 |
| `plugin-api-services-jobs-shellenv-m4` | M4 SV19+SV20（`pluginApi.services.jobs` / `pluginApi.services.shellEnv` A 类静态直通 seam） | delivered | `docs/specs/plugin-api-services-jobs-shellenv-m4/` | `services` 静态定义表 + 全量通用 facade 机制扩至 21 项；jobs 九个抽象 `JobRegistry` 操作（`start/list/get/read/kill/wait/onJobDone/onJobsChanged/attachController`）、shellEnv 三个 `ShellEnvRegistry` 操作（`register/collect/list`）全部 method 非 optional 1:1 直通；disposer 与返回同一性、`this` 绑定、尾参省略保留；effect-scope 由服务自身 ctx 决定（scope 中立，host 门面委托与直连行为一致）；per-service P4 降级不影响其余 21 项；`pkg` 记录抽象 Service Definition 包（`dsh-jobs`/`dsh-shell-env`，live provider `dsh-jobs-local`）；无 `jobs/*`/`shellEnv/*` 事件目录条目、无 R 化、无新顶层 namespace；pro-ex Git Bash 工具迁移经这两个 facade（工作树内测试全绿，commit 与 `plugin-api-tools-abort-helper-m4` 共享文件协调）。 |
| `plugin-api-tools-abort-helper-m4` | M4 A 类 helper：`pluginApi.tools.toolAbortedError()` —— 官方公开常量/类的稳定化构造，typed identity 与官方 dsh-tool-bash 等价（`HarnessError` + `TOOL_ABORTED` + `name:'AbortError'`）；官方常量缺失时降级裸 `Error`；tools feature 禁用按门面抛 typed 错误 | delivered | `docs/specs/plugin-api-tools-abort-helper-m4/` | `lib/tool-abort.js` 纯工厂（零 import）+ `lib/index.js` `buildToolAbortedErrorFactory` 惰性解析（dsh-tools 可缺失，绝不抛穿 apply）；`createToolsApi`/`createDisabledToolsApi` 双态挂载；不新增 peerDependency（保持 `test/package.test.mjs` 精确并集不变式）；无新错误分类/事件/namespace；版本不单独 bump（M4 integration 定界）；pro-ex 迁移验收：已删 `loadAbortedErrorFactory` → `pluginApi.tools.toolAbortedError()`（含裸 `AbortError` 兜底，单 try/catch fail-safe），headless 冒烟 123/123 通过；交互 dev-boot 沙箱内不可复现，按 req 6.3 豁免、待 M4 integration 组成 profile 后验证。 |
| `plugin-api-official-passthrough-m4` | M4 全量官方透传对账：L11/L12；A12/A13；S7/S8；T11–T13；P9/P10；RB1；ST9；C10–C25；O17–O20；SV19–SV48（63 ID，核心 namespace 叶子 + 9 条宿主事件 catalog + 48-key 中央服务表 + client 叶子/事件/connection 面 + 共享 P10 可写 waterfall 语义） | delivered | `docs/specs/plugin-api-official-passthrough-m4/` | W0 中性契约 fixture（`test/official-passthrough-contracts.mjs`）+ W1 四叶并行 + W2.1–2.5 串行 join（每次 join 独立 blocking review）；L12/A13 approved scope correction 保留（L12 固定三工件、A13 固定 `{provider,model,maxTokens}`）；P10 = `system-prompt/assemble` `fault:'propagate'` + `freeze:'waterfall'`（`await next()` 前后四字段可写，monitor containment 不变）；48-key 服务表（220 members，D6 实测）/ 9 host 事件 / 11 client 服务 70 成员 / 4 client 事件 / 3 connection 成员 中性 cardinality；delivered 回归 `test/delivered-regression.test.mjs`（T11/RB1/SV19/SV20 复证）；neutral integration `test/integration-surface.test.mjs`（挂载门面 + VM 打包 client bundle）；全量测试 926/926、diff-check、官方包零修改、治理 token 审计干净；版本不 bump（维持 `0.1.0-rc.6-0.5` / `dsh.api 0.5`）；browser/dev-boot/deployed-runtime 未执行（R13 分离声明，不推论）。 |
| `plugin-api-official-passthrough-m5` | M5 P11 + C26–C32（`pluginApi.systemPrompt.renderContextSnapshot`/`joinContextSections` 稳定直通 + `pluginApi.client` 七个官方浏览器服务面：inputTriggers/commandUi/modelDirectories/conversation/conversationEvents/conversationViews/timer） | delivered | `docs/specs/plugin-api-official-passthrough-m5/` | A 类纯稳定化：host 侧两个独立 slot 记录（surface key `systemPrompt.renderContextSnapshot`/`systemPrompt.joinContextSections`，missing/invalid-export 原子停用，fail-safe 诊断）；client 侧独立 root 与 module lease 机制（`modules.import(moduleId, parentURL, {})` 三参裸契约 + `loadCache` identity 线性化，`client.inject` 保持 `[]`、模块加载器为可选 substrate，无 `client.modules` 门面）；seven leaves 逐面冻结契约矩阵（constructor 导出名/服务注册名/members-kind），missing/invalid-provider/member 原子停用只影响本 surface；CLIENT_REASONS 六类固定诊断词表（含 surfaceKey，无输入数据）；`lib/client.js` 以仓库既有 esbuild iife 工作流重新生成（zod 段与 M3 artifact 逐字节一致，`window.__ModuleLoader__` handoff 不变）；独立性：无 M4 实现依赖、边界期 host/client 回归对照观测全等、实现文件无治理 token 与 `require(`；版本不单独 bump（`0.1.0-rc.6-0.5` / `dsh.api 0.5` 边界原子，九面协议影响归 M4/M5 整合边界决策）。 |
| `plugin-api-repo-normalization` | M-final 治理/工程规范化审计（非 API feature）：按 `docs/standards/` 六册权威分册与 AGENTS.md 治理约定对仓库做合规审计，补登记/补声明/补证据 + §3.0.1 纯本地窗口最小改写；无第三方可见 API 新增、不改变交付能力边界、不修改官方包文件 | delivered | `docs/specs/plugin-api-repo-normalization/` | 审计事实源 `execution/audit-report.md`（`reportSchemaVersion: 1`）；治理残留中性改写（注释/测试名/私有标识符行为保持重命名，如 `reportExecRouteDiagnosticsOnce`、`runSynchronousTransformPhase`），增强 governance-token-audit 覆盖路径/注释/标识符/测试描述/字符串（含扫描器自身 flatMap-iterator 缺陷修复，终扫 0 命中/214 文件）；S2 旧路径/旧登记 historical-closed；A1 身份/世代断言与统一终态词汇映射登记；A2 scope/mutation/retry 声明（appendMessage 非幂等不自动 retry；`remote.publish` 同键异引用 typed error；审计追踪字段缺口显式升级为外部跟踪项）；A3 namespace 三面图与 smell 判据 0 命中；A4 组件级 replacement owner 边界 + 两 R 包 §10 六步 host-only 复证（当前安装路径 metadata/hash）并回填各自 requirements §10.1；A5 可见性逐输出面登记（redactSecrets/deepFreeze/logger-DI 核验）；A6 并发/取消逐 surface 登记（同步直通 N/A、compaction 官方 attempt 循环映射、终态优先级前向约束）；六册分册与 AGENTS.md 同步承载审计结论（含新增 `concurrency-and-cancellation.md` 第六册）；`npm test` 1047/1047、`git diff --check`、公开 API/事件目录/错误分类/namespace/peerDependency/版本 diff 全零变更；整体 Luna(max) 只读审查 PASS 后一次性 Stage 4 提交；版本不 bump（维持 `0.1.0-rc.6-0.5` / `dsh.api 0.5`）。 |
| `execution-observation` | M6 B 类门面投影：`pluginApi.execution`（`observe/get/history/onChange` + 只读 `visibility.register` + `availability`）——把 agent/tool/llm/session 现有公开 seam 归并为统一只读 execution projection | delivered（本批 Stage 4 交付） | `docs/specs/execution-observation/` | feature key = `execution`（guard / FEATURE_MOUNTERS 末尾 / registry 键 / namespace 统一）；executionId 由 plugin-api 生成，event seq 永不作 identity；内部 retry 复用 executionId 增 attempt、外部再次触发新建 execution；终态固定 `success|error|aborted|denied|superseded`（timeout 归 `error`+reason，`settled/closed/disposed` 仅生命周期元数据）；exactly-once 终态提交 + 迟到事件只进 bounded provenance；四个 source adapter 绑原生 `ctx.on`（agent/tools/llm/session），缺失 source 只降级对应 availability；session-scoped bounded history（`truncated/nextCursor/unavailable`）+ observer epoch/reconnect 去重 + stale guard；child 默认终结、仅 source 标记 required 时影响 parent（EO-5 AC2）；受众化脱敏 + 单 register 纯函数 policy（fail-closed redaction、secret 需显式 secret policy）；无新 events catalog slice、无 R、无 client reconnect 协议、无 durable mutation；disable surface 抛 typed P1/P2；版本不单独 bump（integration owner 统一对齐）。 |
