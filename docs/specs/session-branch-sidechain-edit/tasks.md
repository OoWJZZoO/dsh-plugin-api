# Stage 3 - Tasks

> **公共契约现状注（2026-08-29 追加）**：本制品成文于目标领域树 cutover 之前，文中的公共 path 为旧命名。现行命名以 [`public-contract.registry.json`](../plugin-api-m7-public-contract-refactor/public-contract.registry.json) 的 `oldToTargetMapping` 为唯一权威，本制品涉及的映射如下：
>
> | 本制品使用的旧 path | 现行 path |
> |---|---|
> | `pluginApi.session.branches` | `pluginApi.sessions.branches` |
> | `pluginApi.session` | `pluginApi.sessions` |
> | `pluginApi.features`（feature 快照） | `pluginApi.capabilities`（`get` / `list` / `require`） |
>
> 现行契约基线：包版本 `0.1.0-rc.6-0.1.0`（runtime `0.1.0-rc.6` / `dsh.api` `0.1`）；本制品中出现的 `0.1.0-rc.6-0.x` 为历史交付边界记录，不代表现行版本。本注只更新命名与版本指针，不改动本制品已获批的 Goal / Requirements 验收边界。

## Status

SPEC1 Stage 0 Goal、Stage 1 Requirements、Stage 2 Design 已确认（2026-08-25 批量确认门 + SPEC2 纠偏并入，基底 commit `cb17052`）。本任务书按 AGENTS.md §3.2 SPEC3 规则执行：Tasks 产出后先经对抗性审查门（返回「无偏差」）再进入 Stage 4（Execute）；Stage 4 全部顶层任务完成并验证后做一次全局终审，通过后才交付结果报告、做 Stage 4 完成提交并清理 worktree。本 feature 为 M6 第四批次 Wave B（重 R 串行殿后），分支 `feat/sbe-session-branch`。

## 执行注（本 feature 批次纪律）

- **契约**：`temp/m6-batch4-contract.md`（§1 命名、§2 共享文件编辑边界、§3 冻结文件、§4 失败呈现、§5 合并顺序与预检、§6 SBE 前置核查）。权威上游为 requirements/design 获批制品（cb17052 修订后为准）；契约与本文件冲突时以制品为准并上报。
- **前置核查（契约 §6）源码级核实 + 实测闭环均已在本任务书编写阶段完成**（2026-08-25，实测脚本 `temp/m6-batch4-verify/custom-event-roundtrip.mjs`，用毕即删）：
  - 源码核实：`Session.append(type, data, opts)` **不校验** `KNOWN_SESSION_EVENT_TYPES`——只做 JSON 可序列化、`assertSupportedRequestHeader`（仅拒 `request/header-delta` 与 legacy fallback reason）、`surfaceManager.validateNext`（seq 连续 + surface 语义）；seed/恢复路径 `assertSessionEventEnvelope` 同样**不校验**已知类型集合，只校验信封字段（type/seq/time/data/surfaceOp/sourceEventSeqs/ignorable）；`decodeStorageRecord` 对非 chunk 行直接透传。
  - 实测结论：以裸 `Session` 写入自定义类型 `branch/created`、`edit/committed`（无 surfaceOp 元数据形态）→ `packChunkRuns` 打包 → `decodeStorageRecord` 解包 → `Session.fromRestore` 恢复——**全部接受**，round-trip 数据逐字段一致；`deriveMessages()` 忽略无 surfaceOp 的自定义元数据事件（不进入派生消息）；恢复计数比原始多 1 为官方自动追加 `session/end-seed` 所致（官方文档明示，符合预期）。
  - **结论：设计主案（自定义事件经官方存储路径 round-trip）成立，无需回退 sidecar**；任务 1.1 的复刻一致性套件 round-trip 断言照常落地（不再需要 sidecar 预案路径）。
- **命名（契约 §1.1）**：公开面 `pluginApi.session.branches`（facade 只读投影 + 操作入口）；替代行 ctx 子接口 `sessions.branches`；运行时名 `@deepseek-ai/dsh-plugin-api-session-branch`，替代行 id `plugin-api-session-branch`。**治理代号（SBE-/R 类/r1/spec 编号）不得出现在** `packages/session-branch/**`、`lib/**` 新增行、`test/**`、patch 文件与运行时字符串；错误码用能力词（如 `BRANCH_VERSION_CONFLICT`、`BRANCH_KIND_INVALID`、`EDIT_PLAN_TERMINAL`）。generation/commitId 为 owner 域内 opaque token（建议 `${ownerId}:${随机串}`），不做跨 owner 比较、不做全局单调承诺。
- **共享文件（契约 §2 追加式，不改既有行）**：`lib/guards.js` 追加独立 `sessionBranch` probe 分支；`lib/index.js` 追加 `// session-branch facade` 分隔注释 import + `mountSessionBranchFacade` 注册块 + `FEATURE_MOUNTERS` 条目（`session` 之后）；`lib/plugin-api-service.js` 追加 `// session-branch facade` 分隔注释注册块。主包 `package.json` 本批不改版本/dsh.api（统一批次集成 sync）。**预先声明一处有理由偏离（契约 §3.5 偏离义务）**：`pluginApi.session` getter 为 `configurable:false` 且返回冻结组合产物，`session.branches` 必须在 `composeSessionApi` 组成路径内追加最小 add-on 行（带 `// session-branch facade` 分隔注释、仅追加不改写既有逻辑）——同 `tool-discovery` 对 `pluginApi.tools` 的先例处理，交付报告显式上报。
- **冻结文件（契约 §3）一律不碰**：既有 feature 实现/测试、全部已交付辅助包、`AGENTS.md`、`docs/standards/**`、他人 spec 制品。
- **失败呈现（契约 §4）**：typed rejection、fail-closed 默认（branch/plan 冲突 typed；策略/回调抛错只降级该条目经 plugin diagnostics 带 owner 归因上报）；apply 内全部故障 bounded 日志 + 正常 return（G1 模式）；审计/exposure 失败显式 gap/truncated 标记；禁止裸 console 替代 diagnostics 通道。
- **测试**：包级 `packages/session-branch/test/*.mjs` + 主仓 `test/*.mjs`（facade 集成）；统一 `npm test`（4G 护栏），不用裸 `node --test`；纯函数模块零 harness 依赖。完成检查含 `git diff --check`、治理代号泄漏扫描、无冻结文件改动、`npm test` 全绿。
- **执行期人类裁决（2026-08-26，路线 B，已并入本任务书与 requirements/design）**：对官方 `0.1.0-rc.6` 实证发现 ① 自定义事件类型不能携带 surfaceOp（`isSurfaceEligibleType` 硬编码三种 message 类型）、② surface replace 只能折叠/1:1 交换、不能展开恢复 N 节点形状。用户裁决：保留多节点折叠 commit，rollback 改**内容级恢复**；commit 审计块含**调用方自定义 `kind`**（user / 调用方 plugin id / goal 等场景，append 与 replace 形式一致适用）。机制落点见任务 5.3/5.4/5.5/1.1 修订；实测脚本 `temp/m6-batch4-verify/replace3.mjs` 留证（用毕即删）。
- 任务状态：每个顶层任务完成后，把标题前 `[ ]` 改为 `[x]` 并在其下追加一行 `- 状态：implemented`。
- **Stage 4 实现前置只读勘察（2026-08-25，基于合并 Wave A 后的 main `45c23a6`，供接续会话直接使用，无需重查）**：
  - `lib/plugin-api-service.js:666` `composeSessionApi(base, durable)` 是 `pluginApi.session` 唯一组成路径；`_publishSessionApi()`（`lib/plugin-api-service.js:1003-1004`）在构造（923）、`_assignFeature('session')`（1096）、`_assignFeature('sessionRoute')`（1121）、dispose（1264）四处被调用——`session.branches` add-on 必须经由 `_publishSessionApi` 路径注入（在 `_sessionSurface = composeSessionApi(...)` 后追加最小组合行，带 `// session-branch facade` 注释），保证四路径（含 sessionRoute 重挂）一致刷新。
  - `lib/index.js:299` `readReplacementAuxiliaryManifests()` 现含 `compactionEvents`/`sessionTitle` 两项；SBE 需在 `readPackageManifest` 同款函数追加 `sessionBranch: readPackageManifest('@deepseek-ai/dsh-plugin-api-session-branch')`（版本一致校验，主包不 import 辅助包，失配仅停用本 R 特性——同 compaction-events/session-title 先例）。
  - U 系列最新编号 **U16**（`mcp-catalog-lifecycle`）；本 feature 的 U-series 上游提案登记取 **U17**（覆盖 branch/edit 契约；退役条件：官方提供等价 branch/edit API 且消费者迁移后），feature-list §3 表 + §7 登记行随批次集成 sync 落地。
  - `packages/full/test/patch-composition.test.mjs` 断言文件含版本 pin（`0.1.0-rc.6-0.5` / `dsh.api 0.5`）与逐替代行装配序；sync 递增版本时该文件的版本 pin 必须同步更新（全量聚合包与全部辅助包版本一致规则）。
  - 主仓 feature 计数现状（合并 Wave A 后）：`FEATURE_MOUNTERS` 25 项、`pluginApi.features` 25 项（tail 序 `remote→execution→recovery→coordination→workspaceTransactions→diagnostics→usage→tasks→toolDiscovery`）；SBE 的 `sessionBranch` mount 插入 `session` 之后不扰动 tail pin（`test/security-policy-assembly.test.mjs`、`test/index-remote.test.mjs`、`test/index-diagnostics.test.mjs` 的 tail 断言以相对索引表达）。

## Tasks

- [x] **1. 前置核查与复刻基准（契约 §6 实测闭环；对应 requirements SBE-2/SBE-7/SBE-8.6、design「复刻策略」「自定义事件持久化机制」「旧 client cursor 处理」）**
  - 状态：implemented（Stage 4 完成，见交付报告；任务 8.2 的登记动作随批次集成 sync 提交落地）
  - 1.1 实测自定义事件 round-trip（design Testing Strategy 1）：以官方公开导出（`SessionStore`/`Session`/`packChunkRuns`/`decodeStorageRecord`/`adoptSessionEvent`/`KNOWN_SESSION_EVENT_TYPES` 等，不触碰模块私有）验证——(a) 向会话 append 自定义类型事件（`branch/created`、`branch/failed`，无 surfaceOp 元数据形态），经 `packChunkRuns`→`decodeStorageRecord`→`Session.fromRestore` 恢复后折叠结果与原始一致；未知类型在 `Session.fromRestore` 不被信封校验拒绝；(b) surface-eligible `user/message` replace 事件**内嵌 `edit` 审计块额外字段**经同一存储路径 round-trip 逐字段一致（派生消息仍只取 `message`）。**2026-08-26 修订：已实证自定义类型带 surfaceOp 会被官方拒绝（`surfaceOpOf`），故 commit/revert 的 surface 变更本体一律走 (b) 形态，不再有"自定义事件带 replace"路径**；结论按契约 §6 记录（主案成立 / 需回退 sidecar）。
  - 1.2 锁定版本复刻基准审计（design Replacement Identity Matrix 对照 `0.1.0-rc.6` 实测）：`ctx.sessions` 服务面（`create/prepare/enter/announce/flush/get/list/fork`）签名/时序/typed 错误、四事件（`session/created|disposed|event|flush`）派发形状与顺序、typert lookup `session` 注册、`Session` 实例面必要成员——核实结果记录在 `lib/delegate.js` 首部注释（含版本来源）。
  - 1.3 旧 client cursor 消费面核实（SBE-8.6）：对照锁定版本，确认既有 client 在父 session 事件流上的位置失效时官方可用的显式失效/迁移通道形态（typed invalidation 或迁移提示）；核实结论记录于 `lib/branch-log.js` 或 `lib/apply.js` 注释；无法用既有事件/状态呈现时按 C 类如实披露（不静默丢弃）。
  - 产出：`packages/session-branch/lib/*` 首部核实注释 + `test/delegate-parity.test.mjs` 复刻一致性套件（round-trip、五种 fork typed 拒绝码、`session/created` 否决回滚、flush 参与计数语义）。

- [x] **2. 包边界与确定性装配（requirements SBE-1/SBE-4.4、design Components；capability-strategy R1/R5/R7 落点）**
  - 状态：implemented（Stage 4 完成，见交付报告；任务 8.2 的登记动作随批次集成 sync 提交落地）
  - 2.1 创建 `packages/session-branch/package.json`：统一全量唯一版本（`<runtime>-<api.major>.<api.minor>`，本批与主包当前值一致 `0.1.0-rc.6-0.5` / `dsh.api 0.5`，最终递增由批次集成 sync 统一处理）、`type: module`、`main: lib/apply.js`、`dsh.bundle.patch` 指向 `./cordis.patch.yml`、peerDependencies 锁定 `@deepseek-ai/dsh-session: 0.1.0-rc.6`（宿主共享实例，不新增无关运行时依赖）。
  - 2.2 创建 `packages/session-branch/cordis.patch.yml`：官方 patch 形状 `- id: session; disabled: true` + `- insert: - id: plugin-api-session-branch; name: '@deepseek-ai/dsh-plugin-api-session-branch'`（无 config 块，与官方行一致）；注释声明替换边界（只替换 `ctx.sessions` 服务/事件面，`@deepseek-ai/dsh-session` import 面保持官方）。
  - 2.3 批次集成预留（本期只搭文件，最终递增/登记由 sync 提交处理）：`packages/full/package.json` 依赖追加本包（workspace:*）、`packages/full/cordis.patch.yml` 末尾追加 `session` disable + `plugin-api-session-branch` insert 块（保持既有装配顺序与版本不动）、`pnpm-lock.yaml` 同步；`packages/full/test/patch-composition.test.mjs` 追加 session-branch 替代行断言（full 与选择性安装等价、无双跑）。
  - 2.4 包边界测试：`packages/session-branch/test/assembly.test.mjs`——patch 文件形状断言（只含官方 `disabled: true` + 唯一替代行）、package.json 版本/dsh.api 规则断言、full 聚合双装等价断言（compose 后同一组行、替代行唯一）。
  - 覆盖 SBE-1.1/1.2/1.3/1.4、SBE-4.4、SBE-5.2。

- [x] **3. 逐成员薄委托复刻层（requirements SBE-2/SBE-3、design「复刻策略」）**
  - 状态：implemented（Stage 4 完成，见交付报告；任务 8.2 的登记动作随批次集成 sync 提交落地）
  - 3.1 实现 `packages/session-branch/lib/delegate.js`：apply 时实例化官方 `SessionStore`（组合官方公开导出，不 import 模块私有），`ctx.sessions` 服务按官方成员逐一原样转发（`create/prepare/enter/announce/flush/get/list/fork` 保时序/形状/typed 错误语义），`session/*` 四事件由底层 store 自行 dispatch（零重派发，杜绝双跑与形状漂移）；typert lookup 注册保持同名 `session` key。
  - 3.2 `symbols.js`（或并入 delegate/apply）：`Symbol.for('dsh-plugin-api.session-branch.contract')` 组件 owner 契约符号（同 compaction-events/session-title 先例），用于唯一 owner 冲突检测与主包 marker 门控；不得携带治理代号。
  - 3.3 `version.js` 纯函数：`parseFullVersion` / `fullVersionContractsMatch` / `runtimeIdentityMatches`（锁定 `0.1.0-rc.6`）——主包与辅助包版本一致校验、runtime identity 校验（SBE-1）。
  - 3.4 复刻一致性套件（纯函数 + 官方实例）：`test/delegate-parity.test.mjs`——八个服务成员逐一与官方直连行为一致断言（含五种 fork typed 拒绝码、`session/created` 同步抛错否决回滚、flush 参与计数、get/list 返回同一性、create 的 fiber-effect 生命周期）、四事件形状（payload/派发顺序与官方一致）、自定义事件 round-trip（任务 1.1 断言落此文件）。
  - 覆盖 SBE-2.1/2.2/2.3/2.4、SBE-3.1/3.2/3.3。

- [x] **4. branch 记录与 graph 折叠（requirements SBE-8/SBE-9、design「Branch 记录 = parent log 上的事件」）**
  - 状态：implemented（Stage 4 完成，见交付报告；任务 8.2 的登记动作随批次集成 sync 提交落地）
  - 4.1 实现 `packages/session-branch/lib/branch-log.js`（纯函数，零 harness）：`branch/created` 与 `branch/failed` 事件编解码（data：branchId、kind、boundarySeq、childSessionId、causalSourceSeqs、visibility、retention、inheritance 声明、state `active|failed`）；`foldBranchGraph(events)` → 冻结只读 branch graph（current/ancestors/children 一致、不凭空造链）。
  - 4.2 kind 校验：`retry | sidechain | experiment | rescue` 四固定 kind，未知 kind → typed validation 结果（`BRANCH_KIND_INVALID` 风格能力错误码）。
  - 4.3 失败清理（SBE-8.5）：branch 创建在 child 已 prepare 后失败 → parent log 补偿记录（`branch/failed` 终态或同一提交窗口 superseded 标记），不留 untracked 半成品；child 半成品显式清理或标记。
  - 4.4 冻结投影（SBE-9.1/9.3）：查询返回深冻结只读视图，kind/boundary/provenance/visibility/retention 元数据齐全；视图含敏感引用时按默认受众策略（diagnostic/UI 可见、不进模型上下文）呈现。
  - 4.5 单元测试（`test/branch-log.test.mjs`）：编解码 round-trip、graph 折叠（单枝/多枝/失败枝/跨重启重建）、kind 拒绝对、冻结视图、审计式未知字段容忍。
  - 覆盖 SBE-8.1/8.2/8.3/8.4/8.5、SBE-9.1/9.2/9.3。

- [x] **5. edit plan 状态机（requirements SBE-10/SBE-11/SBE-12/SBE-14、design「Edit plan / commit / rollback = append-only 补偿」「Data Models」）**
  - 状态：implemented（Stage 4 完成，见交付报告；任务 8.2 的登记动作随批次集成 sync 提交落地）
  - 5.1 实现 `packages/session-branch/lib/edit-plan.js`（纯函数核心，零 harness）：plan 记录形态（planId、targetSessionId、expectedVersion、range、**kind（调用方自定义，非空字符串、长度有界；调用方为插件时默认取调用方 plugin id，适配 `user`/plugin id/`goal` 等场景）**、externals[]、state `draft|success|error|aborted|denied|superseded`）——终态 final 且唯一，词汇与 SBE-10.5 逐字一致（identity-and-lifecycle §3）；非终态仅 `draft`。
  - 5.2 CAS 双检（SBE-10.1/10.4）：`plan()` 创建即校验 `expectedVersion === 当前 seq`（不匹配 typed conflict）；`commit()` 时再次 CAS 校验（漂移 → typed conflict，当前状态不动）。
  - 5.3 commit = 单 append surface-eligible `user/message` 事件（**2026-08-26 修订：自定义类型不能携带 surfaceOp，commit 本体必须落到 surface-eligible 类型上**）：`data.message` = plan 的 replacement 内容，`data.edit` = 内嵌审计块（`{kind(调用方自定义), planId, commitId, range, generation, actor, at, externals[]}`），`surfaceOp:{op:'replace', start, end}` 折叠删除被 shadow 节点（compaction 同款机制；目标范围可为多节点 N→1），`sourceEventSeqs` = 全部被 shadow surface 节点——一次 append 即原子提交点，观察者视角无半提交（SBE-10.3）；commit 成功后 plan 终态 `success`。
  - 5.4 rollback（SBE-11，**2026-08-26 修订：内容级恢复（路线 B）**）：`rollback(commitId)` 校验可逆（scan 确认 commit 事件存在且未被 revert 标记）→ 单次 append 逆向 `user/message` replace 事件：`data.message` = **内容级恢复节点**（content blocks 内嵌被 shadow 各原始消息的可读文本，角色与边界如实标注，不伪造逐条消息形状），`data.edit` = `{kind(调用方自定义), commitId, revertId, actor, at, externals[]}` 标记还原；幂等——已被 revert 标记的 commitId 再调用返回 typed no-op（不 revert 更新的合法 commit）；revert 不改变所属 plan 终态（仍 `success`）。不可自动回滚的 external 效果在 commit 记录预先标记，rollback 结果如实列 external-pending + 显式 acknowledgment 路径（SBE-11.2/11.3）。
  - 5.5 external 标记词汇（契约 §6.1）：`sideEffectClass` 沿用 `workspace-mutation-transaction` 已交付词汇 `none|read-only|rollbackable|external|unknown`；`external`/`unknown` 不入自动回滚（SBE-11.2）。**调用方自定义 `kind` 校验（2026-08-26 人类裁决）**：非空字符串、长度有界（上限 64）；调用方为插件时默认取调用方 plugin id；缺省/非法 → typed validation 结果（能力错误码，如 `EDIT_KIND_INVALID`），绝不静默改写。
  - 5.6 restore（SBE-12）：对指定历史 commitId 序列重放前离线折叠验证连续性（可引用 `recovery-policy` checkpoint 证据为恢复点来源，不重复实现配额/保留策略）；范围外副作用走显式 acknowledgment 并在结果枚举；验证失败 → typed error + 现状标记待恢复 + 默认不 auto-retry（operation 能力声明 governs）。
  - 5.7 restore/preview 输出的敏感内容遵循既有 redaction 底线（visibility-and-redaction），audit 字段含 who/when/generation。
  - 5.8 单元测试（`test/edit-plan.test.mjs`）：CAS 创建即拒与 commit 双检、终态唯一性（含 late 信号不改写）、补偿配对（commit↔revert：N→1 折叠后内容级恢复、1:1 精确恢复）、rollback 幂等（重复调用 typed no-op）、external-pending 出账、restore 验证失败 typed error、timeout 归 `error`（不新增终态）、`aborted > superseded > error` 同窗口裁决优先级、调用方自定义 kind 校验（非空/长度有界/插件缺省取 plugin id/非法拒绝）、`user/message` 内嵌 edit 审计块 round-trip（额外字段逐字段保持、派生消息只取 message）。
  - 覆盖 SBE-10.1–10.5、SBE-11.1–11.4、SBE-12.1–12.3、SBE-14.1/14.2/14.3/14.4。

- [x] **6. replacement apply 与 boot 自检（requirements SBE-1/SBE-4/SBE-5/SBE-6/SBE-13/SBE-15、design「Components and Interfaces」「Error Handling 与 guard」）**
  - 状态：implemented（Stage 4 完成，见交付报告；任务 8.2 的登记动作随批次集成 sync 提交落地）
  - 6.1 实现 `packages/session-branch/lib/apply.js`（fail-safe，绝不抛穿 apply）：identity 校验（runtime 全量版本、`@deepseek-ai/dsh-session` 包 identity、主包/本包版本一致，SBE-1）→ 官方行 disabled 断言 + 替代行 active 断言（SBE-4.1）→ 组件 owner 冲突检测（`Symbol.for('dsh-plugin-api.session-branch.contract')`：他人已注册 → 冲突诊断 + 正常 return，SBE-5.1/5.3；重复 insert / 目标行缺失 → fail-safe return，SBE-5.2）→ 契约探针（代表性 `sessions` 服务调用 + 事件接收）→ 委托装配。**身份校验通过时在 boot diagnostics 记录 verified identity，并在 metadata 标注覆盖本能力的 U-series 提案编号（SBE-1.4/SBE-6.2）。**
  - 6.2 自检失败/失配失败路径（SBE-4.2/4.3 + 契约 §4）：bounded 诊断 + 正常 return，不注册任何 branch 接口、绝不静默双跑；identity 失配只停用本 R 特性（官方行恢复续用），不波及主包门面（SBE-1.3）。
  - 6.3 branches 子接口注册（design 公开面 `sessions.branches`）：`create(parent, boundary, {kind, visibility?, retention?, inheritance?})`（校验边界复用官方 fork 严格性含 `OPEN_TURN/INVALID_BOUNDARY`，先 append `branch/created` 再官方 `fork`，失败补偿 §4.3）；`graph(sessionId)` 冻结投影（§4.4）；`plan/preview/commit/rollback/restore` 转发 edit-plan 状态机（任务 5）。typed 冲突/validation 结果；任何分支操作对既有 client cursor 按 1.3 核实结论显式处理（SBE-8.6）。branch 创建后 parent 既有事件 seq 集合不变、child 以独立 session 呈现（SBE-8.2），该断言落在 7.5 的 branch 集成测试。
  - 6.4 sidechain 继承声明（SBE-13）：`create` 选项接受 route/memory/attachments/toolState 显式继承选择；未声明 → documented 最小默认 + 记录 effective inheritance 于 branch 记录；继承资源在 child 上下文不可用 → child degraded 启动 + gap 记录，不伪造继承状态（SBE-13.1/13.2/13.3）。
  - 6.5 诊断上报（SBE-15.2）：check 失败/策略回调反复抛错 → 经 plugin diagnostics 带 owner 归因上报（bounded）；不可用 → 降级 logger + availability 如实；禁止裸 console。
  - 6.6 boot 自检矩阵测试（`test/apply-matrix.test.mjs`）：官方行 absent/disabled/enabled × 版本匹配/失配 × owner 已注册/未注册 × 重复 insert/目标行缺失 → 各自 fail-safe 结果（inert/激活/官方回退），绝不双跑；卸载可逆（SBE-15.3）：替代行移除后官方行恢复、无残留 branch 状态要求；另含**激活成功态断言**：身份通过且装配成功后 boot diagnostics 记录了 verified identity 与提案编号（SBE-1.4/SBE-6.2）。
  - 覆盖 SBE-1、SBE-4.1–4.4、SBE-5.1–5.3、SBE-6.1/6.2、SBE-13.1–13.3、SBE-15.2/15.3。

- [x] **7. 主包 facade 装配（requirements SBE-15.1、契约 §2；design「host 门面侧」）**
  - 状态：implemented（Stage 4 完成，见交付报告；任务 8.2 的登记动作随批次集成 sync 提交落地）
  - 7.1 `lib/guards.js`：追加独立 `sessionBranch` feature guard 分支（probe：`ctx.get('sessions')` 可解析 + 替代行 contract marker 可检测；不修改他人 probe）。
  - 7.2 `lib/plugin-api-service.js`（追加式，契约 §2）：`// session-branch facade` 分隔注释注册块——`pluginApi.session.branches` 只读投影 + 操作入口转发至替代行 `sessions.branches`（惰性解析替代行 ctx 服务；替代行未激活/版本失配 → typed disabled 面，availability 如实）。`composeSessionApi` 组成路径内最小 add-on（偏离如实上报，见执行注）。
  - 7.3 `lib/index.js`（追加式）：`// session-branch facade` 分隔注释 import + `mountSessionBranchFacade`（featureRegistry 幂等短路；owner 构造失败 → 返回 null 由既有 fail-safe 路径禁用）+ `FEATURE_MOUNTERS` 条目（`session` 之后插入 `['sessionBranch', mountSessionBranchFacade]`）；主包不 import 辅助包（manifest 版本一致校验同 compaction-events/session-title 先例，失配仅停用本 R 特性）。
  - 7.4 既有 facade session 能力兼容（SBE-15.1）：替代行激活时 durable observation、受限 append、fork passthrough probes 在替代面上无语义变化（回归断言）。
  - 7.5 测试：`test/index-session-branch.test.mjs`（替代行 marker 激活/失配/未安装三态下的 facade 面、typed disabled、availability、与既有 session 面隔离）+ `test/compat-integration-lifecycle.test.mjs` 既有 feature-order 断言追加 `sessionBranch` 条目（本批正值 Wave A 合并窗口，按契约 §5 合并序 rebase 后统一更新基数）；含 branch create 后 parent 事件 seq 集合不变、child 独立 session 断言（SBE-8.2）。
  - 覆盖 SBE-15.1/15.4（facade 组合仅消费替代行公开面，R slice 不跨组件、横切派发语义不走 R）。

- [x] **8. 完成检查与交付**
  - 状态：implemented（Stage 4 完成，见交付报告；任务 8.2 的登记动作随批次集成 sync 提交落地）
  - 8.1 全量回归：`npm test`（4G 护栏）全绿；`git diff --check` 干净；无冻结文件改动（契约 §3 清单逐一核对）；治理代号泄漏扫描（`packages/session-branch/**`、`lib/**` 新增行、`test/**`、`package.json`、patch 文件——SBE-/R 类/r1/需求编号/SPECx 等 token 不得出现）。
  - 8.2 治理登记（R7/SBE-6，登记动作随批次集成 sync 提交落地，本任务先在 spec 目录落实内容）：feature-list §7 追加本 feature 登记行（运行时名、owner、row id、design 要点、版本、U 提案编号）；U-series 新增一条覆盖 branch/edit 契约的提案（编号取 feature-list 现有最大编号 +1，登记时确认；退役条件：官方提供等价 branch/edit API 且消费者迁移）；requirements/design 状态行同步。
  - 8.3 修订注记：Stage 4 执行期间对 spec 文档的任何修订（任务 1 前置核查结论、1.3 cursor 核实结论、偏离记录）在 tasks.md 尾记录并列入交付报告。

## 验收对照（requirements → 本任务书）

| Requirement | 任务 |
|---|---|
| SBE-1 (R5) | 2.1/2.4、3.3、6.1/6.2 |
| SBE-2 (R2) | 1.2、3.1/3.4 |
| SBE-3 (R3) | 3.1（组合而非再导出）、2.2 注释 |
| SBE-4 (R4) | 2.2/2.4、6.1/6.2/6.6 |
| SBE-5 (R6) | 6.1/6.6 |
| SBE-6 (R7) | 8.2、6.1/6.5 |
| SBE-7 (host-only) | 1.2（design Matrix 已留证，无 client 面） |
| SBE-8 | 4.1–4.3、6.3（+1.3 cursor）、7.5（SBE-8.2 显式断言） |
| SBE-9 | 4.1/4.4 |
| SBE-10 | 5.1/5.2/5.3/5.8 |
| SBE-11 | 5.4/5.5/5.8 |
| SBE-12 | 5.6/5.7/5.8 |
| SBE-13 | 6.4 |
| SBE-14 | 5.8、6.3（disposer 幂等 identity-bound） |
| SBE-15 | 7.1–7.5、6.5 |
## 8.3 修订注记（Stage 4 执行期，随交付报告）

1. **机制修订（2026-08-26 人类裁决，路线 B，已并入 requirements/design/tasks）**：自定义事件类型不能携带 surfaceOp（官方 `isSurfaceEligibleType` 硬编码三种 message 类型，实测 `temp/m6-batch4-verify/edit-replace-roundtrip.mjs`）；surface replace 只能折叠/1:1 交换、不能展开恢复多节点形状（实测 `temp/m6-batch4-verify/replace3.mjs`）。commit 改为 single surface-eligible `user/message` replace（内嵌 `data.edit` 审计块，单 append 原子提交点不变）；rollback 改内容级恢复节点；`kind` 由调用方自定义（user / 调用方 plugin id / goal 等）。
2. **编辑事件词汇**：不再使用自定义 `edit/committed` / `edit/reverted` 事件类型（运行时不可携带 surfaceOp）；编辑事件统一以 `user/message` + `data.edit.op = commit|revert|restore` 表达；`branch/created|failed` 保持自定义元数据事件（round-trip 实测成立）。
3. **官方存储 round-trip 实测**：`decodeStorageRecord` 返回窗口嵌套数组，恢复路径需 `.flat()`（delegate-parity / edit-plan / branches.integration 三处测试均以此修复）；恢复事件计数比原始多 1 为官方自动追加的 `session/end-seed`（官方文档明示）。
4. **cursor 显式处理结论（SBE-8.6 / 任务 1.3）**：client 面经官方 `surfaceOp` rewrite 重折叠，branch 创建为纯 append、commit/rollback 为官方 replace，均不会静默悬置 client cursor；被更新 commit shadow 的旧 commit 可逆性检查以 typed no-op 呈现（`rollback never reverts newer legitimate commits`），结论记录于 `lib/branch-log.js` 首部。
5. **主门面装配偏离（契约 §2 记录义务）**：`pluginApi.session` getter 为 `configurable:false` 冻结组合产物，`session.branches` 经 `composeSessionApi(base, durable, branches)` 可选第三参最小 add-on 注入（`lib/plugin-api-service.js` 三处 `// session-branch facade` 段落）；FEATURE_MOUNTERS 插入 `session` 之后；`mountSessionBranchFeature` 导出供测试注入。
6. **版本/dsh.api**：主包与全部辅助包维持 `0.1.0-rc.6-0.5 / 0.5`，递增由批次集成 sync 统一处理（契约 §2/§5）。
7. **全局终审非阻塞意见落实**：激活日志补记 sole-owner 确认（SBE-5.3）与探针失败措辞修正（SBE-4）；`branches.create` 边界预检抛能力错误码并以注释说明官方码仍在 fork 成员面保留（SBE-8）；SBE-14.4 的 disposer 条款 v1 条件式空满足——v1 无公开 plan/branch disposer 面（plans 为内存句柄、随 owner 卸载清理），后续开放 disposer API 时落实；SBE-10.3 的"append 形式 kind"在 v1 为空满足（v1 仅 replace-form commit），注记留待后续；卸载可逆以矩阵"official enabled"用例 + patch 结构保证作代理。
