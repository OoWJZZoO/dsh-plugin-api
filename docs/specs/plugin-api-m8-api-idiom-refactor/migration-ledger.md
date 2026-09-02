# M8 Public Surface Subtraction — Migration And Conservation Ledger

> 公共契约现状注（2026-09-02）：下述删除时的 gap 记录保留 M8 当时的验收边界；后续 policy-enforcement-closure 已以自动 egress/recovery 证据闭合对应守恒结论，并交付 `events.define` 合作型入口。现行状态以 canonical registry 与后续 feature delivery report 为准。

本账本记录公共面减法（Wave 7）执行的每个迁移处置与能力守恒证据。核对基线：
`docs/standards/refactor/api-migration.md` §1 删除表与 §2.2 退为内部机制表；
`docs/standards/refactor/capability-matrix.md`。registry（
`docs/specs/plugin-api-m7-public-contract-refactor/public-contract.registry.json`）
是唯一事实源；本账本按 registry 成员行的 migrationAction 归类，逐条列出处置、
替代/gap 理由、受影响面与守恒证据维度。

## 1. 处置总览

| 动作 | host 行数 | client 行数 | 处置方式 |
|---|---|---|---|
| rename | 38 | 9 | 旧 path 删除，目标 path 以目标 idiom 形状暴露 |
| merge | 24 | 12 | 旧动词/入口删除，合并进单一注册/订阅入口 |
| split | 1 | 0 | decorate 拆入 register/register 入口 |
| migrate | 31 | 0 | 旧成员删除，能力由 services.* 审计直通承载 |
| delete | 8 | 1 | 整行删除，capability matrix 记 replacement 或 gapReason |
| internalize | 5 | 1 | 成员移出公共面，不作为公共入口保留 |

## 2. rename 处置（host 38 + client 9）

> 本表在执行中补充执行的行（Wave 7 收尾）：
> - `agents.currentInitiator` / `requireInitiator` / `withInitiator` / `withoutInitiator` / `isOwnedBy` / `options`（6 行 migrate → `services.agents`）：agents 根不再合并官方 initiator leaf；options 快照随 `services.agents.options` 一次性读取。
> - `sessions.create` / `prepare` / `enter` / `announce` / `flush` / `append` / `deriveEventMessage`（7 行 migrate → `services.sessions`）：session 根不再合并官方 store leaf。
> - `settings.writable` / `prepareDocument` / `get`（3 行 migrate → `services.settings`）：settings 根保留 register/scope/inspect/update/replace/mutate。
> - `llm.listProviders` 等 9 项（migrate → `services.llm`）、`tools.toolAbortedError`（migrate → `services.tools`）、`prompts.assemble`（migrate → `services.prompts`）、`executions.recovery.adapters.*`（3 项 migrate → `services.recovery`）：官方直通成员自门面根移除，经官方 leaf builder 白名单挂载到 `services.*`（`createServicesMigrateLeaves`），成员缺失按 `services.<key>` typed 降级。
> - `events.on` / `events.once`（host，merge → `events.observe`）：事件投影订阅合并入 observe 句柄；消息总线保留内部订阅机制供 feed 使用。决策事件（`system-prompt/assemble`、`compaction/request`、`session-title/candidate` 等）的语义仍登记在事件目录（decisionPrecedence / conflictConvergence / listenerFailureDefault）；侧向决策参与（priority 顺序 waterfall listener）不再有公共注册面，汇编改写语义由 `prompts.contribute` 贡献面承载——该解释在交付报告的 spec 偏差修订列表中记录。
> - `executions.onChange`（merge → `executions.observe`）、`executions.recovery.capability.declare`（rename → `register`）：owner 与 disabled 面同步减法。
> - `security.audit.query`（rename → `security.audit.list`）、`remotes.isActive`（rename → `remotes.availability`）。
> - `remotes.publish`（rename → `remotes.register`）、`sessions.channels` 全组 rename/merge（open→acquire、revoke→release、fetchEvents→list、subscribe/onChange→observe、auth 合并、redaction.registerProfile→register）。



每个条目：旧 path 已从 host/client 公共面快照消失；其 targetPath 以目标成语
形状暴露；registry 成员行（publicPath=targetPath、migrationAction null）已补
齐；7.7a 断言逐条校验。

- llm：`registerAdapter`→`llm.adapters.register`；`registerConfigurableProviders`
  →`llm.providers.register`；`registerModelDiscovery`→`llm.models.register`；
  `requestTransforms.transform`→`llm.requestTransforms.register`；
  `adapters.snapshot`→`llm.adapters.list`；`routing.health.registerCircuitPolicy`
  →`llm.routing.health.circuitPolicy.register`；`routing.health.registerProbe`
  →`llm.routing.health.probe.register`；`routing.circuit.status`
  →`llm.routing.circuit.inspect`
- agents：`executions.recovery.capability.declare`
  →`executions.recovery.capability.register`
- sessions：`durable.durableEventTypes`/`durableEventDescriptors`
  →`sessions.durable.list`；`getDurableEventDescriptor`→`sessions.durable.get`；
  `channels.open`→`sessions.channels.acquire`；`channels.revoke`
  →`sessions.channels.release`；`channels.fetchEvents`→`sessions.channels.list`；
  `channels.auth.registerPairingProvider`
  →`sessions.channels.auth.pairingProvider.register`；`channels.redaction.registerProfile`
  →`sessions.channels.redaction.register`
- tools：`restrict`→`tools.restrict.register`；`guard`→`tools.guard.register`；
  `schemas`→`tools.list`；`presentAs`→`tools.presentation.register`；
  `executionMode`→`tools.executionMode.register`；`discovery.search`
  →`tools.discovery.list`；`discovery.audit.query`→`tools.discovery.audit.list`
- skills：`activation.exposure`→`skills.activation.exposure.list`；
  `activation.audit`→`skills.activation.audit.list`；`policy.registerMinimalCatalogUpdate`
  →`skills.activation.policy.register`
- attachments：`pipeline.registerTransform`→`attachments.pipeline.transforms.register`；
  `projection.resolve`→`attachments.projection.get`
- mcp/coordination/诊断/设置：`mcp.onChange`→`mcp.observe`；`coordination.watch`
  →`coordination.observe`；`diagnostics.onChange`→`diagnostics.observe`；
  `settings.describe`→`settings.inspect`
- remotes：`remotes.publish`→`remotes.register`
- tasks：`tasks.claim`→`tasks.acquire`；`tasks.reassign`→`tasks.takeover`
- client：`connection.api.settings`→`connection.get`；`remotes.$on`
  →`remotes.observe`；`remotes.$dispatch`→`remotes.dispatch`；`remotes.mountRemote`
  /`remotes.mountRemoteContribution`→`remotes.contribute`；
  `settings.remote.mountRemoteContribution`→`settings.remote.contribute`；
  `slots.register`/`slots.inject`→`slots.contribute`；`slots.entries`→`slots.list`；
  `slots.subscribe`/`slots.on`→`slots.observe`；`lifecycle.registerFace`
  →`lifecycle.register`；`lifecycle.onChange`/`onRebind`→`lifecycle.observe`；
  `lifecycle.scan`→`lifecycle.list`；`codec.validateInvocation`→`codec.validate`

## 3. merge 处置（host 24 + client 12）

- llm：`routing.on`/`once`→`llm.routing.observe`（on/once 两旧入口删除，observe
  为标准订阅入口）
- agents：`providers.enter`/`announce`/`setFactory`→`agents.providers.register`
  （按 spec 形状分发 enter/announce/setFactory，旧动词删除）
- sessions：`on`/`once`→`sessions.observe`；`durable.onDurable`/`onceDurable`
  →`sessions.durable.observe`；`channels.onChange`/`subscribe`→`sessions.channels.observe`；
  `durable.durableEventTypes`/`durableEventDescriptors`→`sessions.durable.list`；
  `channels.auth.registerVerifier`/`registerAuthorizer`→`sessions.channels.auth.register`
  （kind 判别）
- skills：`activation.registerDescriptor`/`registerSkill`→`skills.activation.register`
- prompts：`section`/`context`/`variable`/`tools`/`suppressRuntimeContext`
  →`prompts.contribute`（seq 句柄 + 冲突判别式）
- `sessions.channels.subscribe`/`onChange`→`sessions.channels.observe`
- client：`events.on` + 四个官方事件面→`events.observe`；`remotes.mountRemote*`
  →`remotes.contribute`；`slots.register`/`inject`→`slots.contribute`；
  `slots.subscribe`/`on`→`slots.observe`；`lifecycle.onChange`/`onRebind`
  →`lifecycle.observe`

守恒证据（7.7a）：以上每个目标入口以目标形状暴露；旧入口在两侧快照消失；
registry 目标行已登记。

## 4. migrate 处置（host 31）

官方直通成员迁入经审计的 `services.*`：`llm.listProviders` 等 8 项
→`services.llm`；`agents.currentInitiator` 等 6 项→`services.agents`；
`sessions.create` 等 7 项→`services.sessions`；`executions.recovery.adapters.*`
（3 项）→`services.recovery`；`tools.toolAbortedError`→`services.tools`；
`prompts.assemble`→`services.prompts`；`settings.writable`/`prepareDocument`/`get`
→`services.settings`；`storage.open.handle.domain`→`services.storage`。
旧门面成员删除；官方成员以官方名称在 `services.*` 下经成员级白名单暴露
（7.5a）。

## 5. delete 处置（host 8 + client 1）

> 执行中补充：`executions.recovery.classify` 按 registry 记 internalize（capabilityMatrix qualifiers=internalized）——classification 引擎保留为门面内部机制（`recovery-classifier.js`），`executions.recovery.consume` 与 `visibility.project` 自 owner api 删除（consume 的 gap 与 project 的自动投影替代已登记）；`security.egress.check` 删除且 deny 审计随 acquire 否决路径（gap 记录不变）；`settings.installSettingsSection`、`settings.dispose` 删除/内部化；`tools.presentAs`/`executionMode`/`schemas` 旧动词移除（容器保留 target 形状）。



| path | replacement / gapReason | 守恒证据 |
|---|---|---|
| `llm.routing.health.probe` / `startProbe` / `completeProbe` | replacement：`llm.routing.health.probe.register` + 自动探针执行经 `llm.routing.health.observe` | 触发/输入/输出/失败/可观察性五维由 routePolicy replacement 契约覆盖；手动执行键已删 |
| `executions.recovery.consume` | gap：咨询式确认；自动消费证据缺失前保持 gap | 见 capabilityMatrix `executions.recovery removals` |
| `executions.recovery.visibility.project` | replacement：恢复 owner 自动投影 | 同上 |
| `security.egress.check` | gap：咨询式检查；自动应用证据前保持 gap | 见 capabilityMatrix `security.egress removals` |
| `settings.installSettingsSection` | replacement：`settings.register` | registry 记 replacement |
| `storage.open.handle.close` | replacement：operation handle `dispose()` 覆盖销毁 | 非法销毁动词删除 |
| `codec.zod`（client） | replacement：codec 门面自有校验与注册叶子（json/strict/invocation/validate） | schema 库实例不再作为公共 API 暴露 |

## 6. internalize 处置（host 5 + client 1）

`settings.dispose`、`remotes` 相关内部化成员、`client.connection.dispose`、
`executions.recovery` / `sessions.channels` 内部化簇：成员移出公共面，不作为
公共入口保留；7.7b 断言其在公共面与任何别名下均不重现。

> 执行中补充（sanctioned 内部契约成员，登记语义）：`sessions.channels.
> dispatchChannelMethod` / `channelGenerationOf` 与 `events.dispose` 以
> **非枚举**成员保留（walkSurface/公共面快照不可见；无兼容别名）。前者是
> session-channel gateway/connection 替换包经 CONTRACT_SYMBOL 消费的跨包内部
> 契约管件；后者是 events feature 的 fail-safe teardown。二者按 7.7a(c)/
> 7.7b 的快照口径不构成公共面残留（不枚举、非别名、非静默 no-op），并在此
> 显式登记为内部机制（internalize 的 sanctioned 实现形态）。
> client `lifecycle.onRebind`（merge 旧入口）已随本波从 caller-bound 面移除。

## 7. 受影响类型/快照/测试/包

- 类型与快照：`scripts/registry-snapshot.mjs` 产物随 registry 重建；
  `lib/client.js`（检入 bundle）随 client-runtime 重建（esbuild 模块加载器包装
  保持）；bundle 边界与模块加载器身份验证见 7.4 检查。
- 测试：全部宿主/客户端域套件迁移到目标形状（本次减法波逐域迁移并全绿）；
  事件族测试迁移到投影契约（`events.observe` 句柄 + 判别式派发结果），
  `events-bus.test.mjs` 重写为 target-contract 套件；
  `subtraction-conservation.test.mjs` 增补 registry 驱动断言（全部 host remove 行，
  含 no-backing 降级面）。
- 包与 patch：无包级 patch 文件变更（减法只在门面 lib 内）。
- 服务面：`services.*` 挂载新增 8 个 migrate 目标 key
  （llm / agents / sessions / settings / prompts / tools / recovery / storage），
  全部经成员级白名单；全量命名空间 key 数由 46 增至 53（含既有 storage）。

## 7b. 消费者迁移记录（tasks 8.1 / 8.2 / 8.3 / 8.6）

- **dsh-read-image**（`../dsh-read-image`，已提交 2bf6730 + 855b602）：改用门面作为主契约——
  inject `pluginApi`；设置命名空间经 `pluginApi.settings.register` + `services.settings.get` +
  scope handle `watch`；配置桥从手搓 `TypertRemoteService` 子类 + markRemote 删除，
  改 `remotes.register` 发布纯 get/set 服务（签名校验）；A1（resolveModelInfo 包装）与
  A2（llm/stream 重入投影）删除，改注册 `llm.admissionPolicies.register` 图片准入策略
  （process 承担严格图片归约投影）；真值表经 `services.llm.listProviders/listModels` +
  `llm.modelInfo`；`llm/adapters-updated` / `session/created` 订阅迁
  `events.observe`；A6 私有 route 遍历删除，改 `llm.routing.forExecution`；
  client 面板弃用 `.client` 包装（M7 已删），改直接 root 成员
  `pluginApi.services.locale` / `pluginApi.remotes.contribute` / `pluginApi.slots.contribute`；
  守卫套件随门面契约迁移（23/23 绿）。
  每 agent read_image 工具注册与提示词段保留官方 agent 作用域表面（契约外精度，见下）。
- **dsh-pro-ex-ability-anchor**（`../dsh-pro-ex-ability-anchor`，已提交 1edb9fe + eaee387）：
  `remotes.register`（availability 守卫）；虚拟轮上屏写入迁 `sessions.durable.appendMessage`；
  panel 客户端弃用 `.client` 包装（M7 已删），改直接 root 成员
  `pluginApi.services.locale` / `pluginApi.remotes.contribute` / `pluginApi.slots.contribute`；
  tool aborted 错误构建改 `pluginApi.services.tools.toolAbortedError`（migrate 目标）；
  API requirement/peer 对齐 0.1；全部 123 个单测迁移后全绿。
- **8.3 契约外行为处置**（登记，不隐式拓宽公共契约）：
  (a) anchor 的 assemble 时 system-prompt 替换（整体 sections 替换 + tools 过滤）超出
  投影 observe 只读与 contribution 追加语义，保留官方 Cordis `system-prompt/assemble`
  钩子 + 提议（M8 交付报告列出）；
  (b) read-image 的每 agent 工具注册/提示词段保留官方 agent 作用域表面；
  (c) 两仓库的 `session.append` 原始写入（surface-op 之外的事件类型）与
  `agent.session` 私有读取保持 raw（dsh-read-image/dsh-pro-ex 各自注释说明）。
- **8.6 冒烟证据**：在本仓库解析上下文内做了集成 headless 冒烟（facade + 两消费者
  apply，`temp/m8-consumer-smoke.mjs`，用后即删）——无消费者 activation 错误；
  观测到 `llm/adapters-updated` / `session/created` / `session/event` /
  `system-prompt/assemble` 订阅注册与 admission 策略注册。真实 dev boot 仍受环境阻塞：
  消费者仓库的 `@deepseek-ai` 解析指向官方共享安装树（root 属主、不可写），本地无法
  把门面接入解析路径；按 requirements §18 验收第 6 条的冒烟义务以阻塞记录处理（与 M7 交付一致）。

- 旧 path 访问：在公共面不存在（7.7a 断言，registry 驱动）；不存在兼容别名、
  dormant fallback 或隐藏兼容分支（7.7b）。
- 目标成员在 backing 缺失时：形状兼容、typed unavailable/disabled 结果
  （4.2/4.6 断言）；`services.*` migrate 成员以 `services.<key>` feature code
  typed 降级，`prompts.contribute` 在 backing 禁用时报 `unavailable` 判别式结果
  （贡献契约不抛穿）。
- 手动探针执行等删除能力：以注册 + 自动执行/观察替代，无静默 no-op。
- 事件投影订阅合并：`events.observe` 句柄为唯一公共订阅入口（on/once 合并），
  决策事件目录语义保留，侧向决策参与与汇编改写由贡献/策略面承载。