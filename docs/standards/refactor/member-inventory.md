# 成员级公共 API 事实清单（M8 输入）

> 本表是对当前实现的事实盘点，不是当前契约认可。来源主要为 `lib/plugin-api-service.js`、`lib/client-runtime.js`、client official service descriptors，以及公共契约 registry。`target` 是按本目录迁移后的目标归属；未列出的内部 helper 不属于公共面。
>
> 记录格式：`current` 当前公开叶子；`target` 目标公共 path；`idiom` 主 idiom；`action` 处置；`shape` 当前到目标的关键变化。

## 1. Host 根与通用面

| current | target | idiom | action | shape |
|---|---|---|---|---|
| `isActive`, `apiVersion`, `assertCompatible` | 同名 | selfDescription | retain | 冻结状态/版本协商；`assertCompatible` 保持 typed throw |
| `capabilities.get/list/require` | 同名 | selfDescription | retain | capability presence 与 availability 分离 |
| `events.catalog` | `events.catalog()` | selfDescription | rename/shape | getter 改纯查询函数 |
| `events.on/once` | `events.observe` | projection | merge/rename | 标准订阅句柄 |
| `events.emit/serial/parallel/bail/waterfall` | 同名 | operation | shape | 返回派发结果；producer authority 限制 |
| `services.<key>.<member>` | 同名 | passthrough exception | retain/remove per whitelist | 官方契约直通；不适用八类 idiom，但必须逐成员列出保留/删除 |

## 2. Host 领域叶子

| current | target | idiom | action | shape |
|---|---|---|---|---|
| `llm.modelInfo/prepareCall/stream` | 同名 | projection / operation / operation | retain/shape | 查询冻结；调用统一 outcome；stream 保持官方调用语义 |
| `llm.registerAdapter/registerConfigurableProviders/registerModelDiscovery` | `llm.adapters.register` / `llm.providers.register` / `llm.models.register` | resourceRegistry | split/rename | 登记数据或实现，不使用决策回调 |
| `llm.requestTransforms.transform` | `llm.requestTransforms.register` | policy | rename | 注册 `decide(context)`，系统在 request 决策点自动调用 |
| `llm.admissionPolicies.register` | 同名 | policy | shape | 注册声明并自动生效 |
| `llm.adapters.decorate/snapshot` | `llm.adapters.register` / `llm.adapters.list` | resourceRegistry / projection | split/rename | register handle 与 list projection 分开 |
| `llm.routing.forExecution/current/on/once/wait` | `forExecution/current/observe/wait` | projection / operation | rename/shape | `on/once` 合并为标准 observe；wait 为 operation outcome |
| `llm.routing.policies.register` | 同名 | policy | shape | `register(spec)` + `decide` |
| `llm.routing.candidates.register/list` | 同名 | resourceRegistry / projection | shape | 登记与查询分开 |
| `llm.routing.health.observe/get/history` | `observe/get/history` | projection | rename/shape | 标准 projection 查询/订阅 |
| `llm.routing.health.registerCircuitPolicy/registerProbe` | `health.circuitPolicy.register` / `health.probe.register` | policy / resourceRegistry | split/rename | circuit policy 决策；probe 登记实现 |
| `llm.routing.health.probe/startProbe/completeProbe` | 删除；由 probe registry 与 observe 承接 | operation | delete/replace | 不保留手动三段驱动 |
| `llm.routing.circuit.status` | `circuit.inspect` | projection | rename | 不用 `status` 表示查询 |
| `llm.routing.decisions.get/history` | 同名 | projection | retain/shape | 冻结决策视图 |
| `agents.get/list/roots` | 同名 | projection | retain/shape | 冻结查询 |
| `agents.create/resume` | 同名 | operation | shape | outcome/handle 统一 |
| `agents.register` | 同名 | resourceRegistry | reclassify/shape | 登记实现 |
| `agents.providers.enter/announce/setFactory` | `agents.providers.register({ kind })` | resourceRegistry | merge/rename | 一个登记入口 |
| `executions.observe/get/history/onChange` | `observe/get/history` | projection | merge/rename | 标准 observe 句柄 |
| `executions.visibility.register` | 同名 | policy | shape | 自动决策并生效 |
| `executions.recovery.classify` | 内部机制 | none | internalize | 仅输入归一化 |
| `executions.recovery.evaluate` | `executions.recovery.evaluate` | operation | shape | outcome/attempt/terminal |
| `executions.recovery.consume` | 删除；自动执行路径承接 | operation | delete/gap | 不保留咨询式签收入口 |
| `executions.recovery.capability.declare` | `.capability.register` | resourceRegistry | rename |
| `executions.recovery.policy.register` | 同名 | policy | shape/gap | 必须在失败决策点自动调用 |
| `executions.recovery.adapters.*` | `services.*` | passthrough exception | migrate | 官方错误适配工具箱 |
| `executions.recovery.visibility.register/project` | `.visibility.register`；`project` 删除 | policy / projection | split/delete | 自动投影替代手动 project |
| `sessions.get/list/header/events/seq/surface/requestHeader/requestContext/deriveMessages` | 同名，查询 helper 统一冻结 | projection | retain/shape | 明确冻结视图与上下文 helper 边界 |
| `sessions.on/once` | `sessions.observe` | projection | merge/rename |
| `sessions.fork` | `sessions.fork` | mutation | shape | 返回 commitState 判别式 |
| `sessions.durableEventTypes/durableEventDescriptors/isDurableEventType/getDurableEventDescriptor` | projection queries | projection | group/shape | catalog/query 命名统一 |
| `sessions.onDurable/onceDurable` | `sessions.durable.observe` | projection | merge/rename |
| `sessions.appendMessage` | 同名 | mutation | shape | `{ ok, code, commitState, generation }` |
| `sessions.branches.graph/plan/preview` | 同名 | projection | reclassify/shape | 冻结视图 |
| `sessions.branches.create/commit/rollback/restore` | 同名 | mutation | shape | 不返回 disposer；CAS/fencing |
| `sessions.channels.open/heartbeat/revoke` | `acquire/heartbeat/release` | coordination | rename/shape | lease handle + release entry |
| `sessions.channels.subscribe/onChange/observe` | `channels.observe` | projection | merge/rename |
| `sessions.channels.fetchEvents` | `channels.list` | projection | rename |
| `sessions.channels.ack/resume` | `channels.ack/channels.resume` | operation | reclassify/shape | 状态转换 outcome，不归 projection |
| `sessions.channels.auth.registerVerifier/registerAuthorizer` | `auth.register({ kind })` | policy | merge/rename |
| `sessions.channels.auth.registerPairingProvider` | `auth.pairingProvider.register` | resourceRegistry | split/rename |
| `sessions.channels.auth.initiatePairing/approvePairing/rejectPairing` | 同名 | operation | shape |
| `sessions.channels.redaction.registerProfile` | `redaction.register` | resourceRegistry | rename |
| `sessions.channels.dispatchChannelMethod/channelGenerationOf` | 删除 | none | delete | 内部派发/字段读取不公开 |
| `tools.register` | 同名 | resourceRegistry | shape |
| `tools.restrict/guard` | `.restrict.register` / `.guard.register` | policy | split/rename |
| `tools.get/schemas` | `tools.get/list` | projection | rename |
| `tools.execute` | 同名 | operation | shape |
| `tools.presentAs/executionMode` | `.presentation.register` / `.executionMode.register` | resourceRegistry | split/rename |
| `tools.defineTool/toolAbortedError` | `tools.defineTool` / `services.*` | resourceRegistry / passthrough exception | split/migrate | 构造 helper 与官方错误工具分离 |
| `tools.discovery.catalog.register` | 同名 | resourceRegistry | shape |
| `tools.discovery.search` | `tools.discovery.list` | projection | rename |
| `tools.discovery.activate/deactivate` | 同名 | operation | shape |
| `tools.discovery.audit.query` | `audit.list` | projection | rename |
| `skills.activation.registerDescriptor/registerSkill` | `skills.activation.register({ kind })` | resourceRegistry | merge/rename |
| `skills.activation.activate/deactivate` | 同名 | operation | shape |
| `skills.activation.exposure/audit` | `exposure.list/audit.list` | projection | rename |
| `skills.activation.policy.registerMinimalCatalogUpdate` | `policy.register({ kind })` | policy | merge/rename |
| `prompts.section/context/variable/tools/suppressRuntimeContext` | `prompts.contribute({ kind })` | contribution | merge/rename |
| `prompts.render/renderContextSections/renderContextSnapshot/joinContextSections` | `prompts.render*` | projection | retain/shape | 官方 helper 仅保留语义必要的门面包装 |
| `prompts.provenance.contribute` | 同名 | contribution | shape |
| `prompts.provenance.compose/inspect/mapping/observe` | 同名 | projection | shape |
| `prompts.provenance.policy.register` | 同名 | policy | shape |
| `attachments.pipeline.ingest/transform/cleanup` | 同名 | operation | shape |
| `attachments.pipeline.registerTransform` | `pipeline.transforms.register` | resourceRegistry | rename |
| `attachments.pipeline.capabilities` | `pipeline.capabilities()` | selfDescription | rename |
| `attachments.projection.resolve/open/project` | `projection.get/open/project` | projection | rename/shape |
| `attachments.projection.availability` | `projection.availability()` | selfDescription | shape |
| `mcp.servers/tools/resolvePublicName` | `mcp.servers/tools/resolvePublicName` | projection | shape |
| `mcp.onChange` | `mcp.observe` | projection | rename |
| `mcp.availability` | 同名 | selfDescription | add |
| `tasks.register/start/settle/attach` | 同名 | operation | shape |
| `tasks.claim/reassign` | `tasks.acquire/takeover` | coordination | rename/shape |
| `tasks.get/observe/history` | `get/observe/history` | projection | shape |
| `coordination.availability/acquire/heartbeat/release/takeover/compareAndSet/watch` | `.../observe` | coordination | rename/shape |
| `workspaces.transactions.prepare/commit/rollback/recover` | 同名 | operation | shape |
| `workspaces.transactions.record` | 同名 | mutation | shape |
| `workspaces.transactions.preview/get/observe` | 同名 | projection | shape |
| `security.policy/redaction/egress.register` | 同名 | policy | shape/gap |
| `security.egress.check` | 删除 | none | delete/gap |
| `security.egress.lease.acquire` | 同名 | coordination | result/handle shape |
| `security.audit.query` | `security.audit.list` | projection | rename |
| `diagnostics.register/get/onChange` | `register/get/observe` | resourceRegistry / projection | rename/shape |
| `settings.register` | 同名 | resourceRegistry | shape |
| `settings.scope/describe` | `scope/inspect` | projection | rename/shape |
| `settings.installSettingsSection` | 删除；并入 register | none | delete/merge |
| `settings.update/replace/mutate` | 同名 | mutation | shape |
| `profiles.inspect/health/planDiff` | `inspect/health/planDiff` | projection | shape |
| `profiles.apply` | 同名 | mutation | shape |
| `profiles.snapshot.create/modify/delete/apply` | 同名 | mutation | shape |
| `profiles.snapshot.validate` | 同名 | operation | reclassify/shape |
| `remotes.publish/isActive` | `remotes.register` / `remotes.availability()` | resourceRegistry / selfDescription | split/rename |
| `storage.open` | `storage.open` | operation | shape; `purge` explicit mutation extension |

## 3. Client 叶子

| current | target | idiom | action | shape |
|---|---|---|---|---|
| root `isActive/apiVersion/assertCompatible/capabilities.*` | 同名 | selfDescription | retain/shape |
| `connection.rpc` | 同名 | operation | shape outcome |
| `connection.api.settings/llm` | `connection.get` / `connection.api.*` | projection | rename/shape |
| `connection.dispose` | 内部生命周期 | none | internalize |
| `events.<named>.on`, `events.on` | `events.observe` | projection | merge/rename |
| `remotes.$on/$dispatch` | `remotes.observe` / owner-scoped operation | projection / operation | rename/split |
| `remotes.mountRemote/mountRemoteContribution` | `remotes.contribute` | contribution | merge/rename |
| `settings.scope` | `settings.scope` | projection | shape |
| `settings.remote.mountRemoteContribution` | `settings.remote.contribute` | contribution | rename |
| `slots.register/inject` | `slots.contribute({ kind })` | contribution | merge/rename |
| `slots.entries/subscribe` | `slots.list/observe` | projection | rename/shape |
| `slots.on` | `slots.observe` | projection | merge/rename |
| `lifecycle.*` | `lifecycle.register/get/list/observe` | resourceRegistry / projection | enumerate during M8; owner-bound |
| `codec.*` | `codec.register/get/validate` | resourceRegistry / projection | enumerate during M8; wire contract |
| `services.<official>.<member>` | 同名 | passthrough exception | retain/remove per audited whitelist | 官方 client 契约直通；不晋升 idiom |

## 4. 登记完整性的门槛

M8 开工前，以上表格必须转化为机器可读 registry：每个函数、取值成员和公开 handle 成员各一行；namespace 只能作为导航节点。若实现新增公共叶子，必须同时新增 current/target/action 记录，否则视为未登记公共面。
