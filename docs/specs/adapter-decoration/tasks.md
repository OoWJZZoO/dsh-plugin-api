# Stage 3 - Tasks

## Status

SPEC3 Stage 3：本任务书承接已确认的 `goal.md` / `requirements.md` / `design.md`（Stage 0–2 已获用户确认，2026-08-27 M6 最后批次批量确认门）。本文按 AGENTS.md §3.2 以对抗性审查为门；审查返回"无偏差"后直接进入 Stage 4，不设用户确认门。

**并行契约引用**：本批次并行开发受 `temp/m6-final-batch-contract-2026-08-27.md` 约束（该文件已随任务书分发）。任务书必须遵守契约 §2 命名规范、§3 共享文件编辑边界、§4 冻结文件与 §5 失败呈现；违反视为并行纪律偏离，须记录并上报 I。

## 任务书摘要（契约随附要求）

- 命名/身份（契约 §2.A，冻结，不得改动）：被替换官方行 `id: llm` / `name: '@deepseek-ai/dsh-llm'`；替代行 `id: plugin-api-llm` / `name: '@deepseek-ai/dsh-plugin-api-llm'`；源码目录 `packages/llm/`；版本锁 `0.1.0-rc.6-0.7` / `dsh.api 0.7`（与主包一致，I sync 时定，若主线批次期间递增则以 I sync 值同步修订 design 冻结说明——当前主包即 `0.1.0-rc.6-0.7`/`0.7`，实现按此冻结）；组件 owner 私有标记 `Symbol.for('dsh-plugin-api.llm.contract')`。
- 门面形状（design C2 冻结，实现须逐字一致）：`pluginApi.llm.adapters.decorate({ id, match, priority, capabilities, wrap })` → `DecorationHandle { dispose(), snapshot() }`；`AdapterBinding` / `AdapterMatchInput` / `DecorationOperation` / 能力词汇（`labels` / `requestTransform` / `chunkTransform` / `retry: 'none'|'evidence-only'`）按 design 逐字冻结。
- 主门面 feature key 统一为 `llmAdapters`：guard 单 else-if 分支、FEATURE_MOUNTERS 末尾、registry 键、namespace 门控四处一致。
- 诊断前缀 `llm:` + owner id 归因。
- 测试文件 `packages/llm/test/*.test.mjs`；不触碰主仓库既有测试文件。
- **治理编号禁令（AGENTS.md §6 + 契约 §2）**：`AD-Rx`、`U20`、`SPEC*`、`M6`、批次名、分类字母等不得出现在 lib/、packages/、test/、package.json、cordis.patch.yml 或任何运行时可见字符串；仅允许 `docs/**`。
- 共享文件编辑边界（契约 §3）：`packages/llm/cordis.patch.yml` 唯一写者=A；`packages/full/cordis.patch.yml` 不写（只提供块 8 行文本给 I）；`lib/**` 只追加自己的 `llmAdapters` else-if/末尾项/条件投影，不交叉修改既有内容；`package.json` 版本字段冻结不动；feature-list §3 只表尾追加 U20 行、§3.1 `llm` 行只提供行文本；capability-strategy 不直接改；`packages/full/` 不碰。

## 需求锚点

任务引用需求编号（`requirements.md`）：AD-R1（官方 patch 机制）、AD-R2（官方契约保真）、AD-R3（boot 自检）、AD-R4（版本/owner 锁定）、AD-R5（注册与身份）、AD-R6（确定性链与元数据分离）、AD-R7（reconcile/disposer/provider unload）、AD-R8（递归/route/副作用边界）、AD-R9（取消/stale/retry）、AD-R10（可见性/脱敏/审计）、AD-R11（client 半面）、AD-R12（上游提案与退役）。

## 术语与实现决策（Tasks 冻结，源自 design C1–C6，供 Stage 4 执行与审查核对）

1. **链插入点**：仅 `LlmRuntime.adapterStream` 一处（`stream()` 与 prepared `streamWithRegistration()` 两条路径均汇聚于此）；`llm/stream` waterfall 保持官方外层；链的最终 `next()` = 真实 adapter 调用（`adapter.stream(this.forAdapter(request, adapter))` + 官方迭代/终态归一）。
2. **adapterStream 重构**：官方迭代消耗逻辑抽取为私有 `_consumeAdapterIterator(iterator, signal)`（async generator，行为与原循环逐字节等价：构造失败→终态 failure chunk、迭代抛错→终态 chunk、done→返回、finally return() 语义）；无链时走原路径，有链时链基座调用同一 helper——单一来源保真。
3. **链组合模型**：装饰按"最外层在前"的快照排列；`produce(i, op)` = `wrappers[i].wrap({ ...op, next: () => guardProduce(i+1, op) })`，最内层 `next()` = 官方 adapter 调用（构造一次 iterator）；执行器只迭代最外层 iterable、在**每个 yielded chunk 前**执行 stale/终态/形状守卫并做终态仲裁；wrapper 抛错→若操作仍有效则产出官方终态 `finish` chunk（code `DECORATION_FAILED`，error kind），否则静默关闭；绝不自动 retry、绝不 partial 执行后 fallback 裸调用。
4. **chunk 形状守卫**：链输出 chunk 必须为对象且 `type ∈ {block-start,text-delta,reasoning-delta,tool-call-delta,block-end,usage,finish}`，否则按该装饰的有界 decoration 失败处理（typed，不抛穿）。
5. **请求变换**：`next(transformedRequest?)` 接受可选 detached 请求（仅当装饰声明 `requestTransform: true`；必须为普通对象、`provider`/`model` 与源一致、执行器 deep-freeze 后传给基座；未声明时传请求参数→typed 校验失败）。prepared 路径保留官方 `callConfigEquals` 一次性派发契约；绝不 mutate 调用方对象；`provider`/`model` route identity 不可变。
6. **身份模型**：每个 `registerAdapter` 调用 = 一个 ownership 令牌（普通对象）；`adapterIdentity` = (ownership, provider) 绑定；binding `generation` = 该绑定生命周期代数（替换删除/重建时更换）；decoration `generation` = owner 内记录代数。
7. **epoch/提交序号**：epoch 在 C6 四类 mutation boundary（registerAdapter 初始提交 / replace / disposal / configurable-provider 与 model-discovery mutation）+ 每次本地 reconcile 原子递增；同 epoch 内每次成功 decoration 注册获得 registry 单调提交序号（跨 owner 同一序列）；**epoch 递增时全部 active 记录按旧序号稳定重排取新序号**（"binding 重建后 decoration 在新 epoch 重新取序"——序号只在所属 epoch 内有效，旧 epoch 序号不参与当前链序）。链序 = priority tier（highest>high>normal>low>lowest）→ 同 tier 按当前 epoch 序号升序。binding 重建后，原 decoration identity 仅保留作**诊断关联键**（供投影/审计归因），绝不作为跨 owner 排序规则。
8. **匹配时点与递归围栏**：match 在每次 chainFor（流创建时）对当前 binding 求值；抛错 → 该记录本次 degraded（从链排除 + 有界诊断），下次 reconcile/chainFor 重新求值；**递归围栏**：链执行期间用 `AsyncLocalStorage`（与 `llm/request` admission 同机制）记录当前异步上下文内 (binding → 在飞装饰 id 集合)；chainFor 求值时若当前 ALS store 命中同一 binding 且该装饰在飞 → 强制 false（不调用 match）。并发（不同异步上下文）同 binding 流各自独立取链，互不排除。
9. **owner 身份**：facade 从调用者影子 ctx 派生（`callerIdentityOf` 同型 loader-entry 走查：fiber→loader entry 行 name/id；解析失败或解析为 facade 自身行（`plugin-api-main`）→ typed unavailable，绝不归因 facade）。装饰注册在调用方 fiber 上注册 teardown（`callerCtx.effect`，identity-bound dispose 同一路径；effect 不可用 → typed unavailable，不静默降级）。
10. **投影/审计**：`snapshot()`（registry 级与 handle 级）只含 id / owner 摘要 / priority / 能力名称 / lifecycleState / 绑定摘要 / observedAt，deep-freeze 且 detached；审计为有界内存环形诊断（profile 进程作用域，非 durable），条目只含 owner 摘要、decoration id、provider/adapter 身份摘要、generation 摘要、lifecycle/outcome code、有界错误码、observedAt；无 prompt/凭据/header/secret/异常 cause/完整 chunk；脱敏失败 fail-closed。
11. **apply 装配与回退**：`createLlmApply(overrides)`（session-title 同型可注入 seam）；成功路径 = 注册 forked runtime + 附加 decoration registry + root/实例 owner 标记 + 门面 facet 发布；身份失配/探针失败且官方行 disabled → 回退注册官方 `LlmRuntime`（`@deepseek-ai/dsh-llm` import 面保持官方）+ 有界诊断；官方行 enabled → 什么都不注册（官方行即为权威）inert；冲突（已有非本 owner 的 `ctx.llm`）→ inert + 诊断；一切不抛穿 apply。
12. **门面条件投影**：`pluginApi.llm.adapters` 始终存在于 `llm` 命名空间组合内，但方法在 registry `llmAdapters` 未激活 / 替换 facet 未解析（marker+loader+版本契约逐调用校验）时抛 typed 错误（`PluginApiFeatureDisabledError('llmAdapters', reason)`）；`decorate` 校验通过后转发替换侧 facet（typed 结果包络：validation/conflict/unavailable/owner-conflict 归一为 facade typed 错误）。facade 侧永远不持有第二份 registry。

## 任务清单

- [x] **1. 替换包骨架与装配（requirements: AD-R1, AD-R3, AD-R4, AD-R11）**
  - **1.1 包元数据**：创建 `packages/llm/package.json`（name `@deepseek-ai/dsh-plugin-api-llm`、version `0.1.0-rc.6-0.7`、`dsh.api: "0.7"`、type module、main `lib/index.js`、exports `{".":"./lib/index.js","./package.json":"./package.json"}`；peerDependencies `@deepseek-ai/cordis`、`@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-timeout`；dependencies `@deepseek-ai/schemastery`——参照既有交付辅助包 `packages/mcp/package.json` 模板，host 共享实例一律 peer）。不得出现治理编号/分类字母。
  - **1.2 组件级 patch**：创建 `packages/llm/cordis.patch.yml`：`- id: llm; disabled: true` + `- insert: [{ id: plugin-api-llm, name: '@deepseek-ai/dsh-plugin-api-llm' }]`；注释头以**语义中立**方式声明替换边界（Replacement boundary：只替换 `ctx.llm` 服务/事件面，import 面保持官方；装配形状；不可增第二 `llm` 行）——注释与行内容不得出现 A/B/C/R 等分类字母或任何治理编号/代号（AGENTS.md §6 与契约 §2 禁令）。
  - **1.3 包入口**：创建 `packages/llm/lib/index.js`：`export { apply, createLlmApply, name, inject } from './apply.js'`（loader 读命名导出，session-title 同型注释）。
  - **1.4 apply boot 自检**：创建 `packages/llm/lib/apply.js`（`createLlmApply(overrides)`）：注入 seam 参数 `{ readPackageVersion, readPackageApi, forkedRuntime, officialRuntime, officialAvailable }`；执行 C1 全矩阵：loader 组合枚举（恰好一个官方 `llm` 行且 disabled、恰好一个 `plugin-api-llm` 替代行、无重复插入）；身份矩阵（`@deepseek-ai/dsh`、`@deepseek-ai/dsh-llm` = `0.1.0-rc.6`；自身包与主包 full-version 一致 + `dsh.api` 一致，复用 `fullVersionContractsMatch` 同型逻辑）；探针（`ctx.plugin`、`ctx.get`、`ctx.on`、`ctx.emit`、`ctx.waterfall`、`ctx.effect`、`loader.entries`、官方成员面 `ctx.get('llm')` 加载后逐成员）；冲突检测（已有 `ctx.llm` 且非本 fork marker → inert）；成功路径：`ctx.plugin(ForkedLlmRuntime, {})` → post-register 逐成员 verify（含 `LLM_COMPONENT_MARKER` 实例标记）→ 失败则 dispose 回退官方运行时；失配路径：官方行 disabled/absent → 注册官方 `LlmRuntime` 回退（配置为空）+ 有界诊断；官方行 enabled → 保持官方 inert；全程 try/catch，诊断前缀 `llm:` + owner id 归因，绝不抛穿。
  - **1.5 装配测试**：创建 `packages/llm/test/patch-composition.test.mjs`：解析 `packages/llm/cordis.patch.yml`（js-yaml 或与既有交付包 test 同型解析），断言恰好一个 disabled 官方 `llm` 行、恰好一个 insert `plugin-api-llm` 行；断言不引用任何 `/usr/lib/node_modules` 路径；卸载语义（patch 可逆性说明性断言）。创建 `packages/llm/test/apply.test.mjs`：矩阵用例（组合错位/版本失配/探针缺失/官方行 enabled/双 owner 冲突/替代行重复）全部正常 return + 有界诊断 + inert 或回退；成功路径注册 fork + verify；失配回退注册官方 + 诊断；覆盖 AD-R1/AD-R3/AD-R4 验收点。
  - **要求**：本顶层任务内所有实现文件与测试作为整体交付；测试先于/伴随实现（TDD）；1.4 的 apply 不得在生产路径引用任何测试 seam。

- [x] **2. 官方契约保真 fork（requirements: AD-R2, AD-R11）**
  - **2.1 忠实 fork**：以已审计的官方 `@deepseek-ai/dsh-llm@0.1.0-rc.6` `lib/index.js`（1407 行，installed 源）为基线创建 `packages/llm/lib/forked-runtime.js`：初始为逐字节拷贝；随后仅允许 tasks.md「术语与实现决策」列明的差异：头注释（来源/版本/差异登记）、attribution 版本来源（读取官方 `@deepseek-ai/dsh-llm/package.json` 的 version，保持 wire User-Agent 与官方一致；本包 version 含 API 协议后缀不可用于 attribution）、`LlmRuntime` 类内 decoration 钩子（构造附加 `_decoration` 字段初始 undefined；`commitRoutes` 提交后 `_decoration?.onAdapterRoutesCommitted(owned, registrations, ownership)`；注册 dispose 闭包 `_decoration?.onAdapterRoutesDisposed(providersSnapshot, ownership)`；configurable-provider commit/dispose `_decoration?.onDirectoryCommitted/onDirectoryDisposed`；model-discovery commit/dispose `_decoration?.onDiscoveryCommitted/onDiscoveryDisposed`；`adapterStream` 链插入：`_decoration?.chainFor(...)` 非空时经链执行器走 `_consumeAdapterIterator`，空时原路径）、`adapterStream` 迭代循环抽取 `_consumeAdapterIterator`（单源）。所有官方导出（39 项：38 个具名导出 + `LlmRuntime as default`，数量以安装源实测为准、由 2.2 机械校验兜底）原样保留；不得重命名/删减/改语义任何官方成员。
  - **2.2 审计基线**：创建 `packages/llm/OFFICIAL_AUDIT_BASELINE.md`：登记 fork 基线（官方包名/版本/文件来源/行数）、差异清单（每处差异的原因与保真论证）、attribution 偏差说明、重构等价性说明；登记 **client-half 六项检查逐项证据**（client manifest / remote namespace / slot/settings bridge / host-client 版本协商 / browser state-reconnect / client-facing event-service——目标官方 `dsh-llm` 行六项均须证据为否），并显式断言 `packages/llm` 无 `dsh.client` manifest、无 `lib/client.js`、无 browser bundle、无 client roster 行（host-only，design Decision 5 冻结）；登记官方 import 解析断言证据（`import('@deepseek-ai/dsh-llm')` 解析到官方模块、不被替代包遮蔽）。创建 `packages/llm/test/official-fork-integrity.test.mjs`：断言官方导出集与 fork 导出集一致（按名比较）、官方成员面（`LlmRuntime.prototype` 方法集合、事件名 `llm/adapters-updated`/`llm/stream`）一致、差异白名单内无未登记差异（以审计文件为锚，机械校验）；并断言 `import('@deepseek-ai/dsh-llm')` 解析到官方模块（非替代包实现）。
  - **2.3 无装饰契约矩阵**：创建 `packages/llm/test/contract-fidelity.test.mjs`：在无装饰（`_decoration` 未附加）状态下跑官方契约矩阵：`registerAdapter`（all-or-nothing 校验、DUPLICATE_ADAPTER、INVALID_ADAPTER、replace 原子性、REGISTRATION_DISPOSED、dispose 语义 + `llm/adapters-updated` 每提交点恰好一次）、`listProviders`、`registerConfigurableProviders`/`listConfigurableProviders`（INVALID_DIRECTORY/DUPLICATE_DIRECTORY/replace/dispose）、`registerModelDiscovery`/`discoverModels`、`providerRetryPolicy`/`listModels`（INVALID_CATALOG）/`resolveModelInfo`（INVALID_MODEL_*）、`resolveCallConfig`（UNSUPPORTED_REASONING_EFFORT）/`prepareCall`（one-shot、config-change INVALID_PREPARED_CALL）、`stream`/`streamWithRegistration`（waterfall 外层、adapter 抛错→终态 finish chunk、aborted 映射、iterator cleanup）、错误码与 payload 形状。用假 adapter（providerInfo/listModels/resolveModel/stream 可控）驱动；测试不得触碰真实网络。
  - **要求**：本顶层任务交付后，无装饰路径的 fork 行为与官方逐项等价（contract-level），作为 Stage 4 全部后续任务的回归基线。

- [x] **3. decoration registry 与链执行（requirements: AD-R5, AD-R6, AD-R7, AD-R8, AD-R9, AD-R10）**
  - **3.1 注册表**：创建 `packages/llm/lib/decoration-registry.js`：`attachDecorationRegistry(runtime, { logger })` → `{ facet, dispose }`；`facet = { decorate(definition, owner), snapshot() }`。实现：definition 校验（`id` 非空 string、`match` 函数、`priority` ∈ 五档（缺省 normal）、`capabilities` 按 C5 v1 词汇校验未知键/未知能力词 typed 拒绝、`execution.phases` 必须含且仅含 `stream`、`retry ∈ {none, evidence-only}`、`wrap` 函数、缺失字段按克制默认归一）；owner 内 `id` 等价注册幂等（同一 handle）、冲突注册 typed 拒绝不合并；`DecorationRecord`（ownerIdentity/id/definition/registrationSequence/lifecycleState/generation/matches/createdAt/lastReconciledAt）、`BindingRecord`（adapterIdentity/provider/adapterGeneration/decorationGeneration/lifecycleState/overlay）；epoch/binding/序号管理按决策 6–7；四类 mutation hook（决策 7）；reconcile（match 求值、degraded 排除、不发射第二事件、绝不 mutate 官方 registry）；chainFor（决策 8：match 求值 + ALS 递归围栏 + 确定性排序 + 快照）；投影（registry 级 snapshot + handle 级 snapshot，deep-freeze detached，无 adapter 对象/凭据/secret）；disposer（identity-bound：owner+id+generation 精确匹配；stale handle typed no-op；不删新 generation/他人资源）；owner teardown（决策 9）；有界审计环（决策 10）。
  - **3.2 链执行器**：创建 `packages/llm/lib/decoration-chain.js`：`runDecorationStream(chain, operationContext, baseInvoke)`；实现决策 2/3/4/5/10 全部语义：组合、守卫（每 chunk/每 next/每 wrapper 调用前：owner token、decoration generation、binding generation、operation 终态、取消）、仲裁（aborted > superseded > error > timeout-error；终态一次性提交后不可改写；superseded 时消费者可见流无 stale 输出关闭、typed outcome 经诊断投影；caller 取消→官方 aborted finish、timeout→error+reason timeout）、wrapper 失败 DECORATION_FAILED 终态归一、请求/块变换能力门控、证据-only retry 语义（可返回有界证据给既有 route/recovery owner，绝不二次 next()）、拟合信号（caller signal + 本地撤销合并，从不替换/遮蔽 caller 取消）。
  - **3.3 注册表面测试**：创建 `packages/llm/test/decoration-registry.test.mjs`：校验拒绝（空 id/非函数 match/wrap、未知能力词、非法 priority、非法 phases）；幂等/冲突；跨 owner 同 id 隔离；序号/优先级确定性链序（跨 owner 同 priority 按 epoch 序号、reconcile 重建后重排）；epoch 递增（四类 boundary）；replace/dispose 后旧 binding revoked/superseded、新 route 需重新 reconcile；无匹配/已 disposed adapter typed unavailable/degraded 且不产生 synthetic adapter；投影 frozen/detached 且不含 secret/adapter 对象；审计环有界且无 prompt/凭据/完整 chunk；脱敏失败 fail-closed。
  - **3.4 流测试**：创建 `packages/llm/test/stream-decoration.test.mjs`：wrapper 包裹顺序与单次下游调用（`next()` 恰好一次基座调用）；chunkTransform 变换与未声明时拒绝；requestTransform detached 请求（同 route、provider/model 不可变、不 mutate 调用方对象、未声明传参 typed 失败）；wrapper 抛错 containment（该调用 DECORATION_FAILED、他装饰不受影响、不 auto-retry、partial 执行后不 fallback 裸调用）；caller abort/owner dispose/provider 替换/deadline 仲裁与 stale chunk/promise 拒绝晚到；superseded 后不补写；递归围栏（wrapper 内经公开 `llm.stream` 重入同 binding 不再套娃）；证据-only retry 不触发第二次 next()。

- [x] **4. 主门面 llmAdapters 条件投影与集成（requirements: AD-R5, AD-R8, AD-R10, AD-R11, AD-R12 门面侧）**
  - **4.1 marker/版本门控**：`lib/index.js` 内（仅追加自己的分支与函数）：`LLM_COMPONENT_MARKER = Symbol.for('dsh-plugin-api.llm.contract')`（契约冻结键）；`resolveMarkedLlmDecoration(ctx)`（`resolveMarkedEvidenceSlice` 同型：root marker 校验 package/rowId/runtime/api、loader 组合（官方 disabled + 恰一替代行 active）、主包/替代包 manifest 版本契约，解析失败 → null，绝不抛）；`readReplacementAuxiliaryManifests()` 追加 `llm` 键（只增不改既有键）；`mountLlmAdaptersFeature({ ctx, service, featureRegistry, logger, facadeContract, auxiliaryManifests })`：组合/版本契约门（loader 组合 + auxiliary manifest vs facadeContract 全量版本与 `dsh.api` 一致）通过 → registry `llmAdapters` mount；不通过 → disable + 有界诊断 + 正常 return（disposer no-op）；FEATURE_MOUNTERS 末尾追加 `['llmAdapters', mountLlmAdaptersFeature]`（带 comment 标记行）。
  - **4.2 guard 分支**：`lib/guards.js` 尾部 else-if（在未知 feature 的 else 之前追加唯一一个 `llmAdapters` 分支）：探针 = `ctx.get` 可用、`loader.entries` 可用、组合探针（恰好一个 `plugin-api-llm` 替代行 + 官方 `llm` 行 disabled）；不重复定义其他探针（版本契约门在 mount/逐调用层）。
  - **4.3 命名空间门控与条件投影**：`lib/plugin-api-service.js` 内只改 `llm` getter（agent-style caller capture：`get() { const callerCtx = this?.ctx ?? this; ... }`）与构造器初始化 `llm.adapters` 条件面：`createConditionalLlmAdaptersSurface(active, provider, registryGate)`（mcp 同型冻结面）：`decorate(definition)`（门序：facade active → registry `llmAdapters` active → 逐调用 resolver 非空 → caller owner 派生（决策 9，facade 自身/无法解析 → typed unavailable）→ 转发 facet.decorate(def, owner) 并把替换侧 typed 结果归一为 facade typed 错误：validation/conflict/unavailable/owner-conflict；成功返回 `DecorationHandle { dispose, snapshot }` 包装：dispose 幂等转发 + snapshot deep-freeze detached）；`snapshot()`（registry 级投影转发，frozen）。`lib/errors.js` 追加 facade typed 错误类（语义命名，无治理编号；消息只含有界摘要）。
  - **4.4 门面集成测试**：创建 `packages/llm/test/facade-integration.test.mjs`（不触碰主仓库既有测试文件）：guard 通过/失败（组合缺失、替代行重复、官方行 enabled）；mount 版本门（manifest 失配 → disable+诊断）；`pluginApi.llm.adapters` absent facet / registry disabled / facade inactive 四态 typed 错误；marker 激活后 decorate 全流程（owner 派生、idempotent handle、冲突拒绝、dispose 后 snapshot no-op、facade 自身 owner typed unavailable）；`pluginApi.llm` 既有成员（modelInfo/prepareCall/stream/registerAdapter/…）在 llmAdapters 背后不受影响（回归）。
  - **4.5 登记与交付 I 的行文本**：`docs/specs/plugin-api-features/feature-list.md` §3 表尾**追加** U20 行（feature 名/状态/spec 目录/关键约束/退役条件自足溯源，与 U16–U19 同型；只追加不改既有行）；文档内另外新增「**§3.1 `llm` 行替换文本（供 I 整合时替换）**」标记段（第 3.1 表 L4 行现状"维持方案一（R 类候选）"→ 替换为交付登记文本，含 `llm`/`dsh-llm`/唯一 owner/运行时名/退役条件/U20 引用；非正式落盘，仅行文本）；同文档新增「**块 8 行文本（供 I 落盘 packages/full/cordis.patch.yml）**」标记段（disable llm + insert plugin-api-llm，注释遵守 full 聚合"确定性装配顺序"风格）。capability-strategy.md 与 packages/full/ 不直接改（I 负责）。
  - **要求**：4.3 门序错误信息有界（无 secret）；4.5 只追加/标记，不内联修改既有行与其它节；全部文档行文本可被 I 原样落盘。

- [x] **5. 验证与收尾（requirements: 全部回读；AGENTS.md §3.2/§3.4/§6）**
  - **5.1 全量验证**：`npm test`（4G 护栏；勿裸跑 `node --test`）：本线全部新增测试绿；主仓库既有测试中因 `llmAdapters` 注册表键引入的 integration-owned 断言增量（已知：`features.length===28` 断言族：`test/index-agent.test.mjs:973/1028`、`test/index-events.test.mjs:162/227`、`test/index-session.test.mjs:185`、`test/index-system-prompt.test.mjs:107`、`test/index-tools.test.mjs:142/186`、`test/index.test.mjs:200`、`test/index-profile.test.mjs:71-72` 末位 `profile` 断言及其它运行时发现的同型断言）**逐项记录清单与期望增量（28→29、末位变化）交 I 统一维护，一律不修改主仓库测试文件**；运行中发现的任何新失败先判定归属（我方引入→修我方；integration-owned→记录）。
  - **5.2 阶段收尾**：`docs/specs/adapter-decoration/tasks.md` 逐任务标记 implemented（含每任务验证摘要）；`git diff --check`；按 AGENTS.md §3.2 提交纪律：Stage 3 审查通过后先提交 tasks.md，Stage 4 各顶层任务完成并验证后做全局终审（阻塞式，`run_in_background: false`，只读对抗性审查），通过后完成 Stage 4 提交（实现+测试+规制备品+登记行），清理 worktree 前确认提交已落；向 I 交付：本报告全部 integration-owned 断言增量清单、feature-list 追加内容、块 8 行文本、临时文件（`temp/` 不提交）。

## 需求 → 任务覆盖

| 需求 | 任务 |
|---|---|
| AD-R1 | 1.2, 1.5 |
| AD-R2 | 2.1–2.3 |
| AD-R3 | 1.4, 1.5 |
| AD-R4 | 1.4, 1.5, 4.1 |
| AD-R5 | 3.1, 3.3, 4.3, 4.4 |
| AD-R6 | 3.1, 3.2, 3.3, 3.4 |
| AD-R7 | 3.1, 3.3, 3.4 |
| AD-R8 | 3.1, 3.2, 3.4, 4.3 |
| AD-R9 | 3.2, 3.4 |
| AD-R10 | 3.1, 3.3, 4.3, 4.4 |
| AD-R11 | 1.1, 2.2, 4.4（2.2 登记六项全否 client-half 检查证据 + 无 client 构建面断言；1.1 包元数据无 `dsh.client`；4.4 host-only 回归） |
| AD-R12 | 4.5（U20 行 + 退役条件） |

## Standards 适用声明（tasks 与 design 一致；审查按 §3.4 由对抗性审查代理对照）

- `capability-strategy.md`：R1–R9 逐条对应（R8 不适用——六项 client 检查全否，host-only）；唯一官方组件 `dsh-llm`；不覆盖 boot 胶水/框架横切。
- `api-shape.md`：公开面 = policy registry（decorate）+ projection（snapshot）；无 durable mutation 面；数据流单向；一面原则。
- `identity-and-lifecycle.md`：owner-specific opaque generation；终态词汇 success/error/aborted/superseded（无 denied——decoration 无 approval 语义）；aborted > superseded > error > timeout 裁决；终态一次性。
- `durable-state-and-scope.md`：无 durable 记录；审计环显式非 durable、profile 进程作用域；retry 默认禁止、evidence-only 委托既有 owner。
- `visibility-and-redaction.md`：投影仅声明非 secret 字段；日志/审计为有界摘要；脱敏失败 fail-closed。
- `concurrency-and-cancellation.md`：并发策略 = latest-wins（generation）+ 快照；取消传播（caller signal 保留 + 本地撤销组合）；提交资格/stale 结果/disposer 所有权逐条落实；ALS 递归围栏在 §6 声明适用策略。
## 执行注（Stage 4 交付验证摘要，2026-08-27）

- **任务 1（骨架与装配）**：`packages/llm/{package.json,cordis.patch.yml,lib/index.js,lib/apply.js,lib/version.js}` 全部落盘；`createLlmApply` 注入 seam 走全矩阵（组合/版本/探针/冲突/回退）；测试 `patch-composition.test.mjs`（6）+ `apply.test.mjs`（13）全绿。apply 诊断前缀 `llm:`，绝不抛穿；版本失配仅停用本 R 能力。
- **任务 2（官方契约保真 fork）**：`lib/forked-runtime.js` 以官方 `@deepseek-ai/dsh-llm@0.1.0-rc.6` 1407 行为基线，差异登记于 `OFFICIAL_AUDIT_BASELINE.md`（attribution 读官方包 version、`_decoration` 钩子、`_consumeAdapterIterator` 单源抽取、`_decorationChainFor` 白名单）；39 项导出逐名一致；`official-fork-integrity.test.mjs`（7）+ `contract-fidelity.test.mjs`（17）全绿。
- **任务 3（decoration registry 与链执行）**：`lib/decoration-registry.js` + `lib/decoration-chain.js` + `lib/decoration-shared.js`；priority tier + epoch 提交序号确定性链序、四类 mutation boundary、ALS 递归围栏、DECORATION_FAILED 终态、aborted>superseded>error>timeout 仲裁、identity-bound disposer、有界审计环；测试 `decoration-registry.test.mjs`（14）+ `stream-decoration.test.mjs`（14）全绿。
- **任务 4（主门面 llmAdapters 条件投影与集成）**：`lib/index.js`（marker/`resolveMarkedLlmDecoration`/`mountLlmAdaptersFeature`/FEATURE_MOUNTERS 末尾/`readReplacementAuxiliaryManifests` 增 `llm` 键）、`lib/guards.js`（llmAdapters else-if）、`lib/plugin-api-service.js`（llm getter agent-style caller capture + `createConditionalLlmAdaptersSurface`）、`lib/errors.js`（4 个 facade typed 错误类）；测试 `facade-integration.test.mjs`（17）全绿；feature-list §3 U20 行已追加、§3.1 `llm` 行替换文本与块 8 行文本以标记段提供。
- **任务 5（验证与收尾）**：本线全部新增测试 88 项全绿；主仓库既有测试 2239 项通过，剩余 20 项失败全部为 integration-owned 断言增量（`features.length` 28→29 族、FEATURE_MOUNTERS 尾序 pin、host-regression boundary snapshot）或 worktree 路径伪影（`/dsh-plugin-api/` 路径包含断言），均记录待 I 统一维护，本线未修改任何主仓库测试文件。
