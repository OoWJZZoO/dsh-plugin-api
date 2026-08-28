# Deletion Report — plugin-api-m7-public-contract-refactor

> 状态：**待人类批准**（design §Deletion Report Gate；requirements §4）。
> 依据：已确认 `goal.md` / `requirements.md`（§4 Namespace Migration And Public API Deletion、§5 Capability/Availability、§9 Services Classification）/ `design.md`（Target Namespace Design、Deletion Report Gate、Public Surface Minimization）与 Task 1 inventory（`public-contract.registry.json`）。
> 本报告的批准不是「默认保留」的依据，也不是「捆绑批准」：每一项独立裁决；批准后仍按公共面减法原则执行。若任一删除会动摇已确认的 Goal/Requirements 验收边界，该项需要就边界变更本身另行独立决策（§4 AC6），本报告批准不替代该独立决策。
> 类别词表：`rename`（归并/改名，由 Task 4/5 cutover 处理）、`remove`（无替代实质删除，由 Task 6 减法处理）、`retain-unavailable`（保留路径 + typed disabled/unavailable）。

## 结论摘要

- **无边界动摇项**：以下全部删除项都在已确认 Goal/Requirements 的映射与减法范围内，不改变任何验收判据；如审查发现例外将单独升级。
- 消费者引用：`dsh-read-image` 不使用 `ctx.pluginApi`（无引用）；`dsh-pro-ex-ability-anchor` 使用 `session/events/remote/tools/services/client`（全部为 rename 类，Task 8 迁移）。

---

## A. rename（随 Task 4/5 cutover 一次性迁移；旧路径不再发布，不保留 alias）

| # | 旧 path | 目标 path | 类别 | 仓库引用（实现） | 消费者引用 | 影响的包/patch/client/文档面 | 预期 typed 后果 | 理由 |
|---|---|---|---|---|---|---|---|---|
| A1 | `agent` | `agents` | duplicate/historical root | lib/plugin-api-service.js（`agent` getter）；test/plugin-api-service-agent.test.mjs、index-agent.test.mjs | 无 | 主包 host 面、宿主测试、API reference | 旧 root 访问 → typed unavailable（`PluginApiFeatureDisabledError`/shape 缺失即不可用）；目标 path 提供 `get/list/roots/create/resume/register/providers/availability`（叶子命名：`providers` 复数，人类裁决 2026-08-28） | 资源集合复数名（public-api-shape §3.1、design Target Namespace） |
| A2 | `session` | `sessions` | duplicate/historical root | lib/plugin-api-service.js（`session` getter）；session-api/session-guard 测试 | pro-ex-anchor `pluginApi.session.appendMessage` | 主包 host 面、宿主测试、消费者迁移 | 旧 root → typed unavailable；`sessions` 提供 `get/list/create/fork/append/appendMessage/branches/channels` 等 | 复数资源集合 + 领域归属（design） |
| A3 | `sessionChannel` | `sessions.channels` | rename（语义归入 sessions） | lib/plugin-api-service.js（`sessionChannel` getter）+ lib/session-channel*.js | 无 | 主包 host 面、宿主测试 | `sessions.channels` 提供 open/subscribe/fetchEvents/heartbeat/ack/resume/revoke/observe/auth；旧 root → unavailable | sessions.channels 独立 owner/identity/generation/CAS（design、domain-composition） |
| A4 | `execution` | `executions` | duplicate/historical root | lib/plugin-api-service.js（`execution` getter）；execution-observation 测试 | 无 | 主包 host 面、宿主测试 | 目标 `executions` 提供 observe/get/history/onChange/visibility/availability | 复数资源集合（design） |
| A5 | `recovery` | `executions.recovery` | rename（域内归并） | lib/plugin-api-service.js（`recovery` getter）；recovery-policy 测试 | 无 | 主包 host 面、宿主测试 | `executions.recovery` 提供 classify/evaluate/consume 等；旧 root → unavailable | recovery 消费单一 authority 属 executions 域（design、domain-composition） |
| A6 | `routing` | `llm.routing` | duplicate/historical root | lib/plugin-api-service.js（`routing` getter、`_publishRoutingSurface`）；exec-route/session-route/route-policy 测试 | 无 | 主包 host 面、宿主测试 | `llm.routing` 提供 forExecution/current/on/once/wait/policies/candidates/health/circuit/decisions；旧 root → unavailable | routing/routePolicy 合并为 llm.routing（public-api-shape §2、design） |
| A7 | `routePolicy` | `llm.routing` | duplicate/historical root | lib/plugin-api-service.js（`routePolicy` getter、createConditionalRoutePolicySurface） | 无 | 主包 host 面、宿主测试 | 同上；旧 root → unavailable | 同上 |
| A8 | `systemPrompt` | `prompts` | duplicate/historical root | lib/plugin-api-service.js（`systemPrompt` getter）；system-prompt 系列测试、migration-system-prompt-assemble.test.mjs | pro-ex-anchor `pluginApi.events.on('system-prompt/assemble', ...)`（事件名不变） | 主包 host 面、宿主测试、消费者 migration contract | `prompts` 提供 section/context/variable/tools/assemble/render + provenance；旧 root → unavailable | systemPrompt 归入 prompts（design）；slash 事件名 `system-prompt/assemble` 保持 | 
| A9 | `context` | `prompts.provenance` | rename（域内归并） | lib/plugin-api-service.js（`context` getter）；context-engine/context-sources 测试 | 无 | 主包 host 面、宿主测试 | `prompts.provenance` 提供 contribute/compose/inspect/mapping/observe/policy | provenance projection/contribution 独立 owner（design、domain-composition） |
| A10 | `workspaceTransactions` | `workspaces.transactions` | rename（域内归并） | lib/plugin-api-service.js（`workspaceTransactions` getter）；workspace-transaction 系列测试 | 无 | 主包 host 面、宿主测试 | `workspaces.transactions` 提供既有事务面 | workspace 事务归属 workspaces 域（design） |
| A11 | `profile` | `profiles` | duplicate/historical root | lib/plugin-api-service.js（`profile` getter）；profile-* 测试 | 无 | 主包 host 面、宿主测试 | `profiles` 提供既有一层（snapshot/apply 等）；旧 root → unavailable | 复数资源集合（public-api-shape §3.1） |
| A12 | `remote` | `remotes` | duplicate/historical root | lib/plugin-api-service.js（`remote` getter）；host-remote/remote-publication 测试 | pro-ex-anchor `pluginApi.remote.publish('extraproAnchorConfig', ...)` | 主包 host 面、宿主测试、消费者迁移 | `remotes` 提供 publish/isActive；旧 root → unavailable | 复数资源集合 |
| A13 | `skills`（`.activation` 子面） | `skills.activation`（保持，根形态不变） | rename 不适用；保留 | lib/plugin-api-service.js（`skills` getter） | 无 | 无 | 不变 | skills.activation 语义保留（public-api-shape §2） |
| A14 | `ctx.pluginApi.client.*`（client 根） | `ctx.pluginApi` 直接根成员（isActive/apiVersion/assertCompatible/capabilities/connection/events/remotes/settings/slots/lifecycle/codec/services） | historical root（browser 面） | lib/client-runtime.js（`.client` getter）、lib/client.js（bundle） | pro-ex-anchor panel：`client.services.locale`、`client.mountRemote`、`client.slots.inject`、`client.connection` | 主包 client 面、检入 bundle、client 测试、消费者 panel | 公开 `.client` 移除（target path 直接根）；纯官方 leaves 挪 `services.*` | design Client Surface Assembly（直接根 + services 收敛） |

## B. remove（随 Task 6 减法执行；需逐项批准）

| # | 删除项 | 类别 | 当前引用（实现/测试） | 消费者引用 | 影响面 | 替代 path | 预期 typed 后果 | 理由 |
|---|---|---|---|---|---|---|---|---|
| B1 | `pluginApi.features`（registry snapshot getter） | no-value surface（被 capabilities 查询面替代） | lib/plugin-api-service.js（`features` getter）；plugin-api-service.test.mjs、index.test.mjs 等断言 | 无 | 主包 host 面、宿主测试、API reference | `pluginApi.capabilities.get/list/require`（Task 4.2） | 旧 `features` 访问 → unavailable；`capabilities` 提供 registry-backed 描述与 availability | design §Capability Query Surface：旧 features 快照为删除候选，公共契约用 capability descriptors |
| B2 | `agent.routeOf` / `tools.routeOf` 重复 delegate | duplicate delegate（与 `routing.forExecution` 重复） | lib/plugin-api-service.js（agent/tools 组合处 routeOf）；exec-route 测试、plugin-api-service-exec-route.test.mjs | 无 | 主包 host 面、宿主测试 | `pluginApi.llm.routing.forExecution`（既有语义面） | 删除后访问 → unavailable；推荐 route 查询路径唯一化 | design：routeOf 作为重复 delegate reviewed；registry 无独立用例则删除 |
| B3 | `pluginApi.reportExecRouteDiagnosticsOnce`（一次性诊断 helper） | historical/unsupported-authority surface | lib/plugin-api-service.js（方法本身 + execRoute 内部调用）；相关测试 | 无 | 主包 host 面 | 无（内部诊断保留在 execRoute 内部，不再作为公共方法） | 删除后访问 → unavailable；execRoute 失败仍按既有日志路径报告 | 公共面不暴露内部一次性 helper（克制设计、capability-and-services 减法） |
| B4 | `pluginApi.services.*` 中「无独立长期价值/重复入口」成员（Task 6.2 逐成员审计后标注的成员） | no-value surface（组） | lib/services.js（SERVICE_DEFINITIONS 静态表）；services-* 测试 | 无独立消费者（pro-ex-anchor 仅用 shellEnv/jobs/sessionTitle 等既有成员） | 主包 services 面、services 测试、registry servicesWhitelist | 已有一等领域 API 覆盖的成员 → 领域 path；其余无替代 | 删除成员访问 → unavailable（占位保持 namespace 形状）；其余成员不变 | capability-and-services §2 减法候选清单；Task 6.2 在目标树稳定后逐成员定稿，**删除前单独列第二份批准清单** |

> B4 说明：B4 是「候选组」，具体成员在 Task 6.2 审计完成后以**追加清单**形式更新本报告并再次请求批准，不在本次批准范围内预授权。

## C. retain-unavailable（保留 path，不删除；随 Task 6.2/7.8 落实）

> 人类澄清（Task 3 批准，2026-08-28）：API 尚未发布；`services.*` 中经审计确认无独立长期价值的成员，**当下直接删除 PATH**，不需要用「保留 path + unavailable」作为删除的替代形态。「保留 PATH + typed disabled/unavailable」是**发布并进入运维阶段后**、因 runtime 版本不一致导致的成员级不可用策略，不是当前的默认姿态。删除前仍须按 §4/deletion report 逐项批准。

| # | 对象 | 行为 | 理由 |
|---|---|---|---|
| C1 | 发布后运维阶段：因 runtime identity 差异无法稳定兑现的 `services.*` 成员 | 保留公共 path，member-level `disabled/unavailable` typed result，availability 词表 `active/degraded/unavailable` | §5/§9、capability-and-services §6：runtime 差异导致的不可用不删除公共路径（运维阶段策略；本地开发阶段删除维度按 B4 二批清单直接删 PATH） |
| C2 | 未通过 composition/authority 审计的成员 | 保留 path 与可用性，但 `status` 不得为 `recommended`、不进默认 Composable Profile | §6 末条、design §Composable Profile |

## 批准记录

人类批准（2026-08-28，Task 3.2 批准门）：

- **A 批（A1–A14，14 项 rename/cutover）**：整体批准。旧 path 随 Task 4/5 cutover 不再发布、不保留 alias。
- **B1（`pluginApi.features`）**：批准删除，由 `capabilities` 查询面替代。
- **B2（`agent.routeOf` / `tools.routeOf` 重复 delegate）**：批准删除，route 查询统一 `llm.routing.forExecution`。
- **B3（`pluginApi.reportExecRouteDiagnosticsOnce`）**：批准删除（诊断保留在 execRoute 内部）。
- **B4（`services.*` 无价值成员候选组）**：不预授权。Task 6.2 审计后以**追加清单**更新本报告并再次请求批准；批准后**直接删除 PATH**（人类澄清：本地开发阶段不做「保留 path + unavailable」式删除替代）。
- **C2**：确认执行（未审计成员不标 recommended）。
- **消费者澄清**：两个本地消费者（`dsh-read-image`、`dsh-pro-ex-ability-anchor`）仅作测试用途，非真实依赖；删除项只需保证迁移后消费者能使用替代 path，不承担兼容保留义务（本地开发阶段，§3.0.1）。

无边界动摇项：以上全部删除在已确认 Goal/Requirements 映射与减法范围内，无 §4 AC6 独立决策触发。

## 测试与迁移更新要求（随相应 Task 交付）

- rename 项：宿主测试与文档在 cutover 同一边界更新（Task 4.5/5.4）；旧 path 负向断言加入（Task 4.5、15②）。
- B1–B3：删除后快照/类型/文档/测试同步更新 + 负向断言（Task 6.1）；registry `status: 'removed'` + 本报告链接（Task 6.1/9.2）。
- B4：Task 6.2 追加清单 + 二批批准 + 同批测试更新。
- C1：services member-level 测试（Task 7.8）；C2：Composable Profile fixture 测试（Task 7.1）。
- 消费者：pro-ex-anchor 的 `session→sessions`、`remote→remotes`、client 直接根迁移在 Task 8.2 完成并在 Task 8.5 验收。
---

## B4 追加清单（Task 6.2 审计产出，2026-08-28）——已批准（批准记录见下）

> 审计依据：`docs/standards/refactor/capability-and-services.md` §2（发布前减法候选）与 §5（成员分级）。逐成员核对 48 个 `services.*` 白名单成员；仓库内引用面仅为白名单/契约枚举（`official-service-definitions`、`services-definitions.test.mjs`、`compat-integration-cardinality.test.mjs`、M4 交付报告），无独立消费者代码；消费者约束：`dsh-pro-ex-ability-anchor` 使用 `shellEnv`/`jobs`/`sessionTitle`（不列入）。批准后按冻结决策 11①**直接删除 PATH**（不做 unavailable 占位）；删除后成员访问 → 成员不存在（`undefined`），整键删除后该 key 不在 `services` namespace。

### A 类——裸 singleton setter / 共享 mutation 无 owner 协调（§2 首条、§5）

| # | 删除成员 | 保留成员 | 理由 | 影响面 |
|---|---|---|---|---|
| B4-1 | `services.approval.setPolicy` | request、overrideOf | 裸 singleton 审批策略 setter，无 owner/claim 机制；`services.*` 不承载组合保证 | lib/services.js、services 测试、contracts |
| B4-2 | `services.agentDefaultModel.saveSelection` | currentSelection | 裸 singleton 默认模型 setter | 同上 |
| B4-3 | `services.planMode.set` | get | 裸 singleton 模式 setter | 同上 |
| B4-4 | `services.permissionPresets.set`、`selectFor` | current、resolve、optionOf | 裸 singleton 权限预设 setter/选择 | 同上 |
| B4-5 | `services.credentials.set`、`unset` | resolve、describe | 共享凭据 mutation 无 owner 协调且涉密 | 同上 |
| B4-6 | `services.sessionProjectionCache.write` | cachedSnapshot、coldSnapshot | 直接 cache 写，绕过 sessionProjections authority | 同上 |

### B 类——官方等价 seam 已承载 / 无独立消费者（§2 末条、§2 第四条）

| # | 删除成员 | 保留成员 | 理由 | 影响面 |
|---|---|---|---|---|
| B4-7 | `services.compaction`（整键：compactIfNeeded、compactNow、compactRegion） | —（整键删除） | compaction 决策/事件语义已由 replacement 包（`@deepseek-ai/dsh-plugin-api-compaction-events`，替换官方 `compaction-basic` 行并注册 fork 引擎）承载；raw 控制面无独立消费者 | lib/services.js、services 测试、contracts、registry servicesWhitelist |
| B4-8 | `services.workflows`（整键：start） | —（整键删除） | 单方法、无真实消费者、只减少样板 | 同上 |

> 请求批准：以上 8 项逐项批准/驳回/修改；未获批项目保持现状（availability 与 `pending-audit` 呈现不变），不进入减法实施（Task 6.1/6.3）。

## 批准记录（B4 第二次批准门，2026-08-28）

人类逐项裁决（8 项）：

| # | 删除项 | 裁决 |
|---|---|---|
| B4-1 | `services.approval.setPolicy` | **批准删除**（request/overrideOf 保留） |
| B4-2 | `services.agentDefaultModel.saveSelection` | **驳回删除，保留**（currentSelection 一并保留） |
| B4-3 | `services.planMode.set` | **批准删除**；功能不删减——后续须提供可追溯、可记录封装的 B 类接口（待实现，见下） |
| B4-4 | `services.permissionPresets.set`/`selectFor` | **批准删除**；后续须提供可追溯、可记录封装的 B 类接口（待实现） |
| B4-5 | `services.credentials.set`/`unset` | **批准删除**；后续须提供可追溯、可记录封装的 B 类接口（待实现） |
| B4-6 | `services.sessionProjectionCache.write` | **批准删除**（cachedSnapshot/coldSnapshot 保留） |
| B4-7 | `services.compaction`（整键） | **批准删除**；`packages/compaction-events` 后续必须新增「可主动发起 compact 事件」的 API（待实现） |
| B4-8 | `services.workflows`（整键） | **批准删除**；功能不删减——后续须提供可追溯、可记录封装的 B 类接口且拓展能力（待实现） |

## 后续 B 类接口义务（人类裁决登记，待实现，不在本 feature 交付范围）

- **planMode 写入面**：删除 `services.planMode.set` 后，后续提供可追溯、可记录封装的 B 类接口（owner/audit 语义）。
- **permissionPresets 写入面**：删除 `set`/`selectFor` 后，后续提供可追溯、可记录封装接口（预设选择 + 记录）。
- **credentials 写入面**：删除 `set`/`unset` 后，后续提供可追溯、可记录封装接口（含安全/脱敏）。
- **compaction 主动触发面**：`packages/compaction-events` 后续新增「可主动发起 compact 事件」的 API（替代删除的 raw 触发语义）。
- **workflows 能力面**：删除 `services.workflows` 后，后续提供可追溯、可记录封装的 B 类接口并拓展能力（workflow 编排语义）。
