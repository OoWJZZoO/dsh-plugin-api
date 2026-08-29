# Tasks: plugin-api-m1-integration

> **公共契约现状注（2026-08-29 追加）**：本制品成文于目标领域树 cutover 之前，文中的公共 path 为旧命名。现行命名以 [`public-contract.registry.json`](../plugin-api-m7-public-contract-refactor/public-contract.registry.json) 的 `oldToTargetMapping` 为唯一权威，本制品涉及的映射如下：
>
> | 本制品使用的旧 path | 现行 path |
> |---|---|
> | `pluginApi.session` | `pluginApi.sessions` |
>
> 现行契约基线：包版本 `0.1.0-rc.6-0.1.0`（runtime `0.1.0-rc.6` / `dsh.api` `0.1`）；本制品中出现的 `0.1.0-rc.6-0.x` 为历史交付边界记录，不代表现行版本。本注只更新命名与版本指针，不改动本制品已获批的 Goal / Requirements 验收边界。

> **Historical M1 execution record / M2 supersession:** These tasks describe the original `0.2` integration work and are retained as a historical record, not as an executable current plan. The old admission-bridge/resolver ownership and active/no-op wording are superseded; current authority is the M2 L2 gateway in `lib/llm-admission-gateway.js` under `0.1.0-rc.6-0.3` / `dsh.api` `0.3`. Do not rerun this list or reintroduce the old projection-guard path.
>
> **Rename/version pointer（`plugin-api-compaction-events-r1`）**：主包现名 `@deepseek-ai/dsh-plugin-api-main`（row id `plugin-api-main`），full version 升至 `0.1.0-rc.6-0.4` / `dsh.api: 0.4`；monorepo 见根 `pnpm-workspace.yaml`。
>
> **权威指针（`plugin-api-session-title-r1`）**：上行为 compaction-events-r1 交付 boundary；现行 authority 为 `0.1.0-rc.6-0.5` / `dsh.api: 0.5`（由 `plugin-api-session-title-r1` 承接），见 AGENTS.md §8 与 README。

> feature_name: `plugin-api-m1-integration`
> 状态：历史执行记录（M1 `0.2`，已被 M2 superseded）
> 上游：`requirements.md` / `design.md`（同目录，均已获批）
> 执行约定：在 `m1/integration` 分支上按序执行；每个任务以全量 `node --test` 绿收尾；任务引用 design.md 的 C/KD 编号与 requirements.md 的 § 编号。

---

## 1. Phase A：顺序合并七分支（只解冲突，不重构）

- [x] **1.1 创建 integration 分支并合并 m1/tools**
  - 从 `main` 创建 `m1/integration`；merge `m1/tools`。
  - 冲突解决规则：保留 tools 的总线 DI 修复（`entryOf` 本地闭包）、`mergeEventCatalogs`、`deepFreezeExceptSignal`、tools≺events 挂载顺序（后续任务会重构，此相原样保留双方语义）。
  - 引用：design Architecture Phase A。
- [x] **1.2 合并 m1/agent**
  - 冲突解决时把其他分支条目的 `subject:` 一律按新 schema 写成 `scopeKey:`；保留 agent 的 `fault`/`freeze` 字段、`freezeByPolicy`、fault 三态分派。
  - 引用：design C1、KD-1。
- [x] **1.3 合并 m1/session**
  - 保留 `catalog-compose.js`、`session-events-catalog.js`、`session-feature.js`；`mountEventsFeature` 的组合逻辑冲突按"保留组合、后续相统一"解决。
  - 引用：design C2。
- [x] **1.4 合并 m1/llm**
  - 保留 `createLlmApi`、llm/admission 互不覆盖的 mount 语义；条目字段按 C1 解决。
  - 引用：design C1、req §7.2。
- [x] **1.5 合并 m1/system-prompt**
  - 保留 `args[1].scope` 总线分支与 `dshSystemPrompt` guard deps；条目字段按 C1 解决。
  - 引用：design C3.4。
- [x] **1.6 合并 m1/settings**
  - 保留 settings slice 条目与订阅期 gating（2.4 任务移除）；错误类并入 `lib/errors.js`。
  - 引用：design C5、C7。
- [x] **1.7 合并 m1/capabilities，Phase A 收尾**
  - 保留 `lib/services.js` 全量；全量 `node --test` 必须绿（session S1 缺陷此时仍存在且不被现有测试暴露——2.13 修复并补测试）。
  - 引用：design Architecture Phase A 收尾条件。

## 2. Phase B：统一重构

- [x] **2.1 catalog schema 统一 + slice 化**
  - 新建 `lib/agent-events-catalog.js`（12）、`lib/llm-events-catalog.js`（2）、`lib/system-prompt-events-catalog.js`（2）、`lib/settings-events-catalog.js`（2，删 `feature` 字段），把 `lib/events-catalog.js` 中对应条目迁出；基线导出改名 `baseEventsCatalog`。`catalogEntryOf`（暂指向 base）与 `mergeEventCatalogs` **暂保留导出**，由 2.2 连同总线 import 一起删除（保证本任务绿收尾）。
  - 全部条目字段统一到 C1：`subject`→`scopeKey`（含 tools/session slice）；策略字段可显式可缺省（KD-12），总线以缺省值为准。
  - 测试：每个 slice 模块的名集精确断言 + schema 字段断言；`events-catalog.test.mjs` 改写为 base 19 条断言。
  - 引用：req §1.1–§1.6、§2.8；design C1、C2、KD-4、KD-12。
- [x] **2.2 总线统一**
  - `lib/deep-freeze.js`：`freezeByPolicy(value, policy)` 统一词汇 `'all' | { deep: [...] } | 'except-signal'`；`deepFreezeExceptSignal` 语义折入为内部分支，不再公开导出；policy 缺省 = `'all'`；全函数永不抛。
  - `lib/events-bus.js`：确认元数据解析走注入 catalog（`entryOf`），删除对 `catalogEntryOf` 的 import，并同步删除 `events-catalog.js` 的 `catalogEntryOf`/`mergeEventCatalogs` 导出（2.1 的遗留收口）；fault 三态分派（`propagate`/`created`/`contain`，缺省 contain）；scope 解析三分支（`args[0].agent` / `args[1].scope` / `null` carrier）；冻结分派改调 `freezeByPolicy(arg, meta.freeze)`。
  - 测试:三种 freeze 策略 + 缺省策略的冻结断言；fault 三态断言；`args[1].scope` 过滤断言。
  - 引用：req §2.1–§2.7；design C3、KD-2、KD-3。
- [x] **2.3 两遍式 apply + 挂载期 slice 组合 + guard 归并**
  - `apply` 重写：pass 1 对 FEATURE_MOUNTERS 全量 `runFeatureGuard` 得 `guardResults`；pass 2 挂载，mount 签名扩展 `guardResults`。
  - `mountEventsFeature`：`composeCatalogs(base, ...guardResults 通过的 slices)`，删除模块级惰性单例。
  - FEATURE_MOUNTERS 定为 `['tools', 'events', 'agent', 'llm', 'llm/admission', 'session', 'settings', 'systemPrompt', 'services']`（`'web'` 暂留，2.9 移除）。
  - guard 归并：确认每个 feature 名都有分支；按 C7 标注必需（fail-closed）/可选（fail-open）；`else` 未知分支保留（`web` 分支 2.9 删）。
  - 测试：顺序依赖断言（tools≺events、events≺session 被违反时的行为）；逐 guard 名分支存在性断言；条件 slice 取舍（全通过 47 条、tools guard 失败 41 条、session guard 失败 43 条）。
  - 引用：req §2.9、§2.10、§3.1；design C2、C4、KD-6、KD-11。
- [x] **2.4 gating 收敛（挂载期排除唯一化）**
  - 删除 `events-bus.js` 的 `featureRegistry` 参数与订阅期 `PluginApiFeatureDisabledError` gating；`createEventsBus` 签名回到 `{ ctx, catalog, logger }`；`mountEventsFeature` 不再传 registry 给总线。
  - `events-bus-settings-gating.test.mjs` 改写为：settings guard 失败 ⇒ `settings/updated`/`settings/document-updated` 不在组合 catalog ⇒ 订阅走非目录 passthrough（无门面待遇）。
  - 引用：req §2.11；design C5、KD-5。
- [x] **2.5 幂等信号统一**
  - 全部 mounter 的 re-apply 短路改为 `featureRegistry.isActive(featureName)`（含 `mountAdmissionFeature`、`mountEventsFeature`、`mountAgentFeature`、`mountLlmFeature`、`mountSessionFeature`、`mountSettingsFeature`、`mountSystemPromptFeature`、`mountToolsFeature`、`mountServicesFeature`）；删除 `service?.<ns>?.isActive === true`、catalog 同一性比较、常量 true getter 短路等旧信号；`mountEventsFeature` 保留 catalog 签名防御核对（`tools/change` 存在性 vs tools 状态）。
  - 测试：re-apply 全 mounter 短路断言（二次 apply 不重复挂载、不重复注册原生 hook）。
  - 引用：req §3.2；design C6、KD-7。
- [x] **2.6 失败呈现统一**
  - 按 C7 四路径矩阵落地：capabilities `buildActiveFacade` 的静默省略路径改为"声明成员缺失 ⇒ 该 service facade 整体降级 disabled（`isActive:false` + 调用抛 `PluginApiFeatureDisabledError(<service-key>)`）"。
  - guard fail-open/fail-closed 规则代码化：可选服务（settings、capability seams）`ctx.get` 抛错/缺失视同不存在；必需服务（agents/llm/sessions/tools/systemPrompt）抛错/缺失即 guard 失败。
  - 测试：settings guard fail-open 断言（throwing `ctx.get` ⇒ feature active + 调用抛 `PluginApiServiceUnavailableError`）；capability 成员缺失 ⇒ facade disabled 断言；必需服务 throwing `ctx.get` ⇒ feature disabled 断言。
  - 引用：req §3.4、§3.6；design C7。
- [x] **2.7 tools accessor fail-safe + mountFeature 契约**
  - accessor 内 `ctx.get('tools')` 包 safeGet 语义：抛错/undefined ⇒ `PluginApiFeatureDisabledError('tools')`，绝不裸抛。
  - `mountFeature('tools', { scoped: true })` 存储 api 描述符；删除"忽略 api 参数"路径。
  - 测试：throwing-getter ⇒ typed error；`mountFeature('tools')` 存储断言。
  - 引用：req §3.3、§3.5；design C8、KD-8。
- [x] **2.8 session.on passthrough 语义固化**
  - 确认 `pluginApi.session.on/once` 对非生命周期名保持裸 `ctx.on/ctx.once` 透传；在 `docs/specs/plugin-api-session-m1/design.md` 补 escape-hatch 注记。
  - 测试：非生命周期名透传断言（委托裸 ctx、无门面待遇）。
  - 引用：req §4.3；design C10。
- [x] **2.9 web 迁入 services.web**
  - `SERVICE_DEFINITIONS` 追加第 18 项 `web`（`registerSearchProvider`/`registerFetchProvider`）；删除 `mountWebFeature`、`createDisabledWebApi`、FEATURE_MOUNTERS 的 `'web'` 条目、guards 的 `web` 分支（并入 `services` 分支的 `SERVICE_DEFINITIONS.some(...)`）；2.3 的 guard 名存在性断言同步更新。
  - 测试：`pluginApi.services.web.*` 直通断言；`pluginApi` 顶层 key 恰为 8 个（`events, llm, agent, session, tools, systemPrompt, settings, services`）且无 `web`。
  - 引用：req §4.1、§4.2、§4.4；design C9、KD-9。
- [x] **2.10 版本 bump + peerDep 合并确认**
  - `package.json`：`version` → `0.2.0`、`dsh.api` → `"0.2"`；确认四条 peerDep（`dsh-session-reference`、`dsh-session`、`dsh-settings`、`dsh-system-prompt`）已合并且无新增非 peer 运行时依赖。
  - 测试：`package.test.mjs` 断言版本、api、peerDep 全集。
  - 引用：req §5.1、§5.2、§5.5；design C11、KD-10。
- [x] **2.11 文档同步**
  - feature-list.md：状态统一 `**delivered**`；O15 行改 `pluginApi.services.web.*`；§1 阅读说明写入安置规则（顶层 = 核心域 + 基础设施；`services.*` = 二线纯直通）；计数表述改并集。
  - AGENTS.md §8：7 个 feature 各一行；events-m1 行删除 llm 加的"扩展至 21"括注；capabilities/session/settings/agent/llm/system-prompt/tools 行的计数类措辞去绝对化。
  - `docs/specs/plugin-api-events-m1/requirements.md` AC 7.3/7.4 泛化为并集表述；llm 白名单改写与 agent 修订注记合一去矛盾。
  - 引用：req §5.3、§5.4、§4.1；design C11。
- [x] **2.12 并行开发工作流协议文档 + AGENTS.md 链接**
  - 新建 `docs/specs/plugin-api-m1-integration/parallel-workflow.md`：三段（并行前契约包、并行中强指导非铁律 + 偏离须记录、并行后预检 + 集中整合 + 全绿），内容按 design C12。
  - AGENTS.md §3 增加 "### 3.5 并行开发工作流" 小节指向该文档。
  - 引用：req §6.1–§6.5；design C12。
- [x] **2.13 每切片端到端守门测试**
  - 4 个 `session/*` 事件：priority 排序、payload 深冻结、containment、scope gating 全门面待遇断言（S1 缺陷回归闸）。
  - `agent/*`：fault 三态 + freeze 豁免在合并总线下保持；`system-prompt/assemble`：`args[1].scope` 过滤保持；llm slice：`llm/stream` waterfall 冻结与 passthrough 保持。
  - 引用：req §2.10、§7.1、§7.5；design Testing Strategy 守门测试。
- [x] **2.14 回归收尾**
  - 基线 19 事件 E1–E12 行为断言（仅字段改名与缺省回填两处可观察差异）；`llm.admission` 不变 + `resolveModelInfo` 唯一包装断言；apply 永不抛不变量（全 guard 失败组合扫描）；catalog 名集恰 47 精确断言（反夹带门）。
  - 全量 `node --test` 绿。
  - 引用：req §7.1–§7.5；design Testing Strategy。

## 3. Phase C：验收合入

- [x] **3.1 合入 main**
  - `m1/integration` 全量测试绿后合入 `main`；按 AGENTS.md §8 规则确认登记完整；清理临时产物（如有 `temp/`）。
  - 引用：design Architecture Phase C。
