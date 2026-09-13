# Stage 3 - Tasks

> feature_name: `plugin-api-m10-contract-convergence`
> milestone: M10
> status: Stage 3（Tasks）产出中（2026-09-14）；Stage 0–2 已交付（2026-09-12）。本阶段以对抗性审查为门（AGENTS.md §3.2），通过后直接进入 Stage 4。
> 输入溯源：`goal.md`（Stage 0，十条 Scope direction）、`requirements.md`（Req 1–13 与对应表）、`design.md`（§0 衔接索引、§1 语义树、§2 逐成员映射与修正清单、§3 idiom 归类与例外 E1–E9、§4 authority 地图、§5 OBS-14 归属判定、§6 九线遗留对账、§7 standards 修订清单 S1–S5、§8 装配与验收方案、§9 失败路径、§10 分册结论）；Stage 3 探针见下（P1–P9）。
> 执行口径：版本冻结基线内交付（runtime `0.1.0-rc.6`、包 `0.1.0-rc.6-0.1.0`、`dsh.api: 0.1`），不步进任何版本字段；**本线不新增 R 包/R 行**（唯一装配类变更是 `services.appExit` 白名单成员，属 A 类 advanced passthrough）。

## Stage 3 探针记录（仓库与 registry 现状，Stage 4 以对账与测试复核）

- **P1 registry 骨架**（`docs/specs/plugin-api-m7-public-contract-refactor/public-contract.registry.json`）：`members` 537、`namespaces` 52、`oldToTargetMapping` 375、`servicesWhitelist` 53、`capabilityMatrix` 99、`eventCatalog` 69。`oldToTargetMapping` 的记录 schema **不齐**：`oldPath`/`targetPath` 恒在，`action`/`relation` 可缺省（现存 22 条仅两字段、28 条含 `action`、325 条四字段；**无** `disposition` 字段）⇒ Task 2.1 必须按缺省形态处理，不得要求补齐既有记录的字段。
- **P2 九线拟新增行已落盘**：九线成员行（plan-mode / permissionPresets / credentials / compaction / workflows / interactions / selection / llm.adapters / decisions / scoped 等）均在 `members` 内；`llm.adapters.decorations.{register,register.handle,list}` 与 `llm.models.list` 均已存在 ⇒ design §2.2 的 registry 映射修正（L12）**已由 llm 线 Stage 4 落盘**，本线只做逐条核对与对账记录，不重复落盘。
- **P3 M7 B4 义务路径的 old → target 记录缺失**：全量扫描 `oldToTargetMapping`，**没有任何记录**的 `oldPath`/`targetPath` 触及 `planMode`/`permissionPresets`/`credentials`/`compaction`/`workflows` 五组路径。⇒ Req 6.4（五条 B4 映射登记）与本线 §2.3 的落盘义务**当前未兑现**，是本线明确承担的 registry 工作量（不是验证项）。
- **P4 feature-list 现状注过期**：`docs/specs/plugin-api-features/feature-list.md:31` 的「已删除写路径的现状注」仍写替代能力「**尚未兑现**，属后续范围」，与九线已交付事实冲突 ⇒ Req 12.3 的现状注更新是本线的落盘义务（只改现状注，不改历史行的已获批验收边界）。
- **P5 `services.appExit` 缺席**：`servicesWhitelist` 53 个 key 中无 `appExit`；官方证据（design §5.1）为 launcher 经 `dsh-cmdline` `ctx.provide('appExit', host.exit)`，`services.*` 白名单现无等价路径 ⇒ design §5.1 的判定（新增 A 类 advanced passthrough 成员）需要本线实现，且必须走 `lib/official-service-definitions.js` + `lib/services.js` 的既有声明机制（`optional` 成员，缺席不连带停用其他服务）。
- **P6 三张表尚不存在**：`docs/specs/plugin-api-m10-contract-convergence/` 下只有 goal/requirements/design 三份制品；design §8.1 把文件形态留给 Tasks ⇒ 本线确定落盘形态（见 Task 1）与连接键（registry `publicPath`）。
- **P7 有界审计环的重复实现（仅观察，本线不处置）**：仓内存在至少 8 份有界审计环，其中 **6 份是 feature 内部诊断**（非公共面），两种形状：(a) `lib/sessions-plan-mode.js` / `lib/sessions-permission-presets.js` / `lib/credentials-mutation.js` 为 `{ records, truncated, gapSince }`（缺口语义 = 缺口起点，`truncated` 仅在真实丢弃时置真）；(b) `lib/session-interaction-operation-authority.js` / `lib/sessions-interactions-facade.js` / `lib/sessions-selection-facade.js` 为 `{ records, gapCount, truncated }`（缺口语义 = 缺口计数，`truncated` 按「环已达容量」计算）。另有**公共面**审计环（`lib/security-audit.js` 经 `security.audit.list` 暴露，及 `tools.discovery.audit.*`、`skills.activation.audit.*`）与**替代包内部环**（`packages/llm/lib/decoration-registry.js` 的 `_audit` 测试缝）——两者**均不在**任何内部统一范围内。**本线不处置该重复**：requirements/design/goal 与本仓库任何已提交登记均未授权此项（AGENTS §6：代理自行新增的条目不构成授权），故仅作为观察登记，供人类决定是否另立维护任务；本线不动这 6 个模块的内部语义。
- **P8 standards 修订的实际状态（逐项核对，Stage 4 按此登记）**：S1（AGENTS §4 第 3 条事件表述与 M8 ledger 张力）**未同步、待人类确认**；S2（`public-api-shape.md` §2 树图刷新 / §7 settings 桥条目）**部分同步**——`workflows` 块已由 workflow 线加入（`public-api-shape.md` §2），树图其余旧叶子与 §7 条目**待确认**；S3（`domain-composition.md` §2 两条领域行）**部分同步**——`workflows` 行已在，**`credentials` 行缺失**（待确认或经人类确认后新增，不得直接当作已完成）；S4（`capability-strategy.md` §5 compaction 行补注）**已由 compaction 线同步**（R 类扩展登记注已存在）⇒ 本线只做对账；S5（turn-stopping R 切片登记：`capability-strategy` §5 / feature-list §3.1 / AGENTS §2/§4）**部分同步**——前两者已由 decision-participation 提交 fb9f51d 同步，AGENTS §2/§4 部分待确认。⇒ 本线一律**不改写分册正文**，只落「待确认清单 + 已同步项的核对结论」（Req 12.6/12.7）。
- **P9 跨线用户故事的承载面状态**：八条故事（Req 5.1–5.8）的承载线均已 Stage 4 交付并在 feature-list §7 登记。**部分组合验收已存在**：M9 簇的跨线集成测试 `test/integration-m9-loop-facts.test.mjs`、`test/integration-m9-stop-restore.test.mjs`、`test/integration-m9-attention.test.mjs` 与 `test/session-interaction-operation-attachments.test.mjs` 已在同一测试内跨面协作；**M10 新增八条线的组合场景（跨 M10 线与 M9 簇）当前不存在**。⇒ 本线新增组合验收时应**复用既有集成测试的边界与夹具**，避免与 M9 簇重复建设（Task 4）。

## Task 1: 三张表与对账制品的落盘形态（对应 Req 1/2/3/4）

**产出**：`docs/specs/plugin-api-m10-contract-convergence/convergence/` 下的四份制品 + 一致性校验脚本 `scripts/convergence-verify.mjs`。

- [ ] 1.1 落盘形态（design §8.1 授权）：`convergence/consumer-behavior-table.md`（Req 1 字段：项目/子包、源码锚点、原动作/时序/副作用、目标公共 API（publicPath + idiom）、authority、host/client、成功证据、故障证据、非门面义务标注）、`convergence/public-member-table.md`（Req 2.1 字段）、`convergence/implementation-assembly-table.md`（Req 3.1 字段）、`convergence/reconciliation.md`（§2.2/§2.3/§2.4 映射核对结论 + §6 九线遗留 L1–L21 对账 + B4 五项）。
- [ ] 1.2 连接键与一致性脚本：三表以 registry `publicPath` 为连接键；`scripts/convergence-verify.mjs` 机械校验 (a) 三表引用的每个 `publicPath` 都存在于 registry；(b) 成员表的 idiom/effect/composition/runtime 与 registry 逐字一致（不一致即报错）；(c) 每条行为行都至少有一条成员行与一条实现行（Req 4.1 三表连接）；(d) 无「已承诺未接线」成员（Req 6.5）的登记缺口；(e) 成员表每行的 `authority` 非空且与 registry 同路径行的 `authority` 一致（承接 Task 5.4）。
- [ ] 1.3 行为全集来源固化（**先于任何减法**，Req 6.2）：来源为工作区 `temp/m10-api-coverage-observations.md`（§3 的 17 项目表与子包枚举；`temp/` 被 gitignore，故**必须先把 17 项目 + 子包枚举固化进已提交的 `convergence/consumer-behavior-table.md`**，再做任何减法）与九线 design「迁移证据义务」章节、constitution 的 read-image/anchor 两个消费者（design §8.2）；逐条填 Req 1.1 字段。每行 **SHALL 显式引用目标行的来源制品（文件 + 章节）**（Req 1.2）；无 target 的行按 Req 1.3/Req 9 走残余归属判定，**不得**登记为 contract-outside；非门面义务（UI/业务算法/通知呈现/皮肤）按 Req 1.6 标注并**不计入覆盖分母**。
- [ ] 1.4 单面与降级如实登记（Req 1.4/1.5/10.2）：只有 host 或只有 client 的行为逐行标注单面与另一半缺口；「等价」行的证据必须来自真实公共入口执行（引用切片/用例标识），**不得**用 import 扫描、路径计数、测试总数或同进程 mock 直传充当证据。
- [ ] 1.5 成员表生成（Req 2）与 idiom 归类核对（Req 7）：以 design §1 树 + §3 归类为骨架逐成员登记 Req 2.1 字段；九线已定行直接采纳（Req 2.2，不改写其形状）；五组语义判别（Req 2.3）逐组给唯一入口与互指说明；带例外的成员按 §3.2 E1–E9 引用六元组（Req 2.5）。**同时逐 idiom 核对一致性**（Req 7.1/7.2）：同 idiom 的入口动词、handle 形状、失败/冲突呈现、availability、owner 派生、generation/seq/epoch 语义与终态词汇一致，领域差异只在显式领域字段；`services.*` 成员标 passthrough exception 并附 capability-strategy §6.1 成员分级（Req 7.4）；api-idioms §5 的机械校验以 `scripts/registry-validate.mjs`（entry 级）+ `scripts/convergence-verify.mjs`（成员表 ↔ registry 逐字一致）承担并在 Task 8.1 执行（Req 7.5）。
- [ ] 1.6 实现/装配表生成（Req 3）：逐能力登记 owner 包、真实 source/决策点/carrier、版本条件、full 与选择性装配等价、缺位行为、验证入口；R 承载行（compaction operation 子面）附 R1–R8 核对与 feature-list §3.1 报备一致性（Req 3.2）；纯门面行如实登记「无替代行依赖」（Req 3.3）；与某线 Hook/Binding 表冲突时出差异报告并以该线 design 为准（Req 3.4）；缺口行为呈现（返回 vs 抛）采纳各线裁决并注明出处（Req 3.5）。
- [ ] 1.7 九线遗留的 idiom 对账项（design §6 L4/L21）：**L4**（credential 线 B 类冲突检测在 registry 中标注为门面模拟）核对 registry 行是否带「门面模拟、非官方仲裁」表述；**L21**（`sessions.selection.set` 的 committed 结果缺姊妹 mutation 的 `commitState`/`generation` 字段且该线未登记例外六元组）按 design §3.1 的对账注**三选一并落盘**：补登记例外六元组 / 补齐字段 / 经 spec 修订统一（结论写入 `convergence/reconciliation.md`，实质改动按该线 spec 修订流程执行，本线不代答）。

## Task 2: 逐成员映射与 registry 落盘（对应 Req 6、Req 12.1）

- [ ] 2.1 375 条既有 `oldToTargetMapping` 逐条核对（Req 6.1）：逐条给出**可复核的证据锚点**——target 成员的 `publicPath` + 证据入口（测试文件/切片 id），或「无行为需保留」的显式依据；缺省字段（`action`/`relation` 见 P1）按缺省形态处理，不要求补齐。结论在 `convergence/reconciliation.md` 分列「无偏差」与「修正项」，修正项落 registry；机械部分（target 是否存在、action/relation 词表合法）由 `scripts/convergence-verify.mjs` 承担。
- [ ] 2.2 五条 B4 义务路径登记（P3/Req 6.4/§2.3）：`services.planMode.set` → `sessions.planMode.select`、`services.permissionPresets.set|selectFor` → `sessions.permissionPresets.select`、`services.credentials.set|unset` → `credentials.set|unset`、`services.compaction`（整键）→ `sessions.compaction.run`、`services.workflows`（整键）→ `workflows.start`；每条的 `action`/`relation` 按删除事实填写（删除与替代的关系），并在 `convergence/reconciliation.md` 逐条注明兑现路径与 feature-list §7 交付条目。
- [ ] 2.7 B4-1/6/2 的核对（Req 12.3 后半）：对照 `docs/specs/plugin-api-m7-public-contract-refactor/deletion-report.md` 的批准记录核对——B4-1（`approval.setPolicy`）与 B4-6（`sessionProjectionCache.write`）为纯删除裁决 ⇒ 核对**无回流**（`lib/services.js` 定义无对应成员、registry 无对应行）；B4-2（`services.agentDefaultModel.saveSelection/currentSelection`）为「驳回删除、保留」裁决 ⇒ 核对保留现状**无回归**（成员仍在且可用）。三项均无映射记录，故不在 Task 2.1 的 375 条扫描范围内，需单独核对并把结论写入 `convergence/reconciliation.md`。
- [ ] 2.3 §2.2 修正清单核对（P2）：逐条核对 `llm.adapters.register`（真实登记）、`llm.adapters.decorations.register/list`、`llm.adapters.decorations.register.handle`、`llm.models.list` 的 registry 记录与实现一致；一致即记为「已由 llm 线落盘、本线核对通过」，不一致则出差异报告并按 Req 3.4 处理。
- [ ] 2.4 九线新增 path 的 old → target 登记（Req 6.4 后半）：为九线新增的公共面补齐映射行（无旧路径的加性成员不造记录——只在确有旧 path/旧行为承载时登记，禁止为凑数造映射）。
- [ ] 2.5 映射修正的落盘纪律（Req 6.2/6.3/12.1）：先行为后减法；一条历史入口承载多个不等价行为时必须拆分记录；registry 与 surface snapshot 一致由既有 `test/registry.test.mjs` + `scripts/registry-validate.mjs` 保证。
- [ ] 2.6 迁移切片的文件头矩阵（Req 3.6）：本线新增或引用的每个切片/fixture SHALL 经真实公共入口与真实边界（wire 序列化、durable 落盘、双 owner），并在文件头写明「原行为 → 现行公共调用 → 运行结果」矩阵（维护基线先例：`test/consumer-migration-slices.test.mjs` 切片 A–E、`test/interactive-session-migration-slices.test.mjs`）。

## Task 3: 残余归属的实现与 probe（对应 Req 9、design §5）

- [ ] 3.1 优雅 appExit 公共 seam（P5/design §5.1）：以既有声明机制新增 `services.appExit`——`lib/official-service-definitions.js` 增成员（`{ kind: 'method', name: 'exit' }`，`optional: true`，官方 service key 一比一、runtime-shaped、门面零附加状态）、`lib/services.js` 的 `SERVICES_REGISTRY_METADATA` 增**服务级直通**条目（`composition: 'pure'` 仅表示"1:1 转发、门面零附加状态"，与成员级组合分类分开）、registry `servicesWhitelist` 增 `appExit` 行（`channel: 'passthrough'`、`status: 'advanced'`）并在 `memberGrades` 中按 design §5.1/§4 登记**成员级**分级：组合分类 **exclusive**（同一 scope 唯一 authority 的进程级操作）、`composableProfile: false`（**不进 Composable Profile 组合保证**，composition-and-authority §6）、authority = 官方 launcher 进程生命周期、`bypasses` 说明 no-graceful-orchestration；`capabilityMatrix` 增行；**不包装、不排队、不拦截**，服务缺席 → 成员 typed unavailable，门面**不合成** `process.exit`。
- [ ] 3.1b 键数与 design 表述同步（审查意见）：`servicesWhitelist` 由 53 键增至 **54** 键，与 design §1.2/§1.5 的「白名单键数不变（apiProxy 已在白名单内）」表述冲突 ⇒ 按 spec 修订流程在 design 对应两处加现状注（本线新增 `appExit` 键），并在 `convergence/reconciliation.md` 登记该修订。
- [ ] 3.2 launch environment fallback 的 probe（design §5.2 OM-5）：以真实 project-env/user-env 层值验证经 `services.credentials.resolve` 可解析；证实缺口 ⇒ 升级为受限只读声明式 seam 提案（Req 9.3）或 C 类登记，**不静默丢弃**；无缺口 ⇒ 记为「等价路径成立」并附证据。
- [ ] 3.3 home/scope 行为的归属落盘（design §5.3）：在 `convergence/consumer-behavior-table.md` 登记原数据 scope/生命周期 → 新承载（`pluginApi.storage` profile 档 / 共享 authority）的映射；home 路径解析本身标为「非门面义务」（Req 1.6）。
- [ ] 3.4 残余与阻塞登记（Req 9.2/9.4）：九线 Stage 4 发现的新 DSH 交互逐项归位（本线 seam 或该线范围）；结构上不可达的能力登记阻塞项（原因 + 最小解除动作 + 是否需人类授权 + 日期）。

## Task 4: 跨线组合验收（对应 Req 5、Req 13）

**产出**：`test/m10-cross-line-scenarios.test.mjs`（组合场景，跨线协作在**同一测试**内完成）。

**证据形态（全组统一，逐条按此判定）**：每条故事 SHALL 经**真实公共入口**执行，并至少在一条**真实边界**上取证（wire 序列化 / durable 落盘 / 双 owner 归因）；官方侧组件按各线既有 test-kit 的探针形状替身是**允许**的（与各线 Stage 4 已交付证据同源），但**禁止**以「同进程 mock 内部对象直传」充当公共路径证据，也禁止以 import 扫描/路径计数/测试总数充当等价证据（Req 1.5/4.3）。每条故事 SHALL 在测试文件头写明「原行为 → 现行公共调用 → 运行结果」矩阵（Req 3.6），并复用既有集成测试（`test/integration-m9-*.test.mjs`）的边界与夹具而非另建一套。

- [ ] 4.1 多 agent 协作（Req 5.1）：登记 scoped 工具与作用域提示词 → 成员新建/恢复 → pre-step activation → 两个 agent 不串 → 更换/卸载不误伤；失败注入（dispose/reload/同 id 冲突/反向装配顺序）呈现 typed 结果。
- [ ] 4.2 图片变体（Req 5.2）：新 provider route 登记后在选择面出现、原模型仍可用、图片经附件链真实调用、decorator 与新 adapter 不混义、凭据修改影响后续调用。
- [ ] 4.3 自动继续与远端交互（Req 5.3）：创建/选模型/发消息 → 真实 accepted → progress → 唯一 terminal；审批经受限视图与应答；取消/离线/重连/旧回调/重复请求各路径正确。
- [ ] 4.4 checkpoint/rewind（Req 5.4）：执行前屏障 → snapshot → 工具执行 → 恢复 → 新分支 → 再次 request；与活跃 attempt 的取消/终态关联准确。
- [ ] 4.5 模式与权限（Req 5.5）：Plan Mode 与 preset 切换**实际改变官方行为**（真实审批判定与投影一致），无越权客户端替用户提升权限。
- [ ] 4.6 主动压缩（Req 5.6）：用户请求 → 压缩策略 → 引擎 → session/provenance 更新与终态；拒绝/无需压缩/失败各有可区分证据。
- [ ] 4.7 workflow（Req 5.7）：门面启动真实 engine、run/agent/job/tasks 关联准确、取消/终态唯一；非 projection-only。
- [ ] 4.8 原有能力不回归（Req 5.8）：remote/settings/storage/slots/notification/context/cost/redaction/claim 经现行 API 仍可实现；request/activity/checkpoint/attention 在实际组装下回归，query → operation → restore → 续跑 → client 观察串成一条链。**并覆盖 constitution 的两个消费者**（design §8.2）：`dsh-read-image` 与 `dsh-pro-ex-ability-anchor` —— 各自至少一条行为行 + 一条回归引用（既有 `test/consumer-migration-slices.test.mjs` 的 anchor 切片之外，read-image 的图片准入/投影路径需在本线补一条等价证据）。

## Task 5: 能力自描述与 authority 审计（对应 Req 8、Req 10）

- [ ] 5.1 自描述核对（Req 10.1/10.3）：以 `test/client-capability-availability.test.mjs` 的既有判定方式为基线，在 `test/m10-cross-line-scenarios.test.mjs`（或本线新增的自描述测试）中，对 registry 中**每个带 `availabilityMember` 的 namespace** 断言其自描述反映**真实** reachability（不是对象存在性或 aggregate 标志）；部分成员失效不得以 aggregate active 掩盖。
- [ ] 5.2 降级与业务拒绝区分（Req 10.2）：逐面断言 source/authority/carrier 缺失 → typed unavailable/degraded，且与 conflict/denied/rejected/unchanged/no-candidate 等业务码不复用同一码混报。
- [ ] 5.3 authority 地图复核（Req 8.1–8.5）：以 design §4 地图为清单逐资源人工对账（结论落 `convergence/reconciliation.md`），核对「受支持门面路径 / advanced services / 官方 native 路径 / closure 方式」与实现一致；**每行并须登记 live handle 的合法用法边界**（holder-owned / 只读 / 受限）与不支持用法（Req 8.2）；`services.*` advanced seam 标明保证级别（Req 8.3）；同一资源多写路径必须统一 authority 或显式互斥（Req 8.4）；关键不变量由门面自身闭合（不得借 `services`/raw 绕过，Req 8.5）。
- [ ] 5.4 三表与 authority 地图的一致性：authority 地图为散文表格、无机器可读载体 ⇒ 一致性由**人工对账**落 `convergence/reconciliation.md`，并由 Task 1.2 的脚本承担其中可机械化的部分（成员表每行 `authority` 字段非空、且与 registry 行的 `authority` 字段一致）。

## Task 6: 装配与兼容验收（对应 Req 11）

- [ ] 6.1 full vs 选择性装配等价（Req 11.1/11.5）：同一冻结版本下两种装配产出同一组主包行与替代行、同一行为；不双跑、不改替代行语义。
- [ ] 6.2 卸载恢复与缺失降级矩阵（Req 11.2/11.3）：卸载任一 replacement 包 ⇒ 官方行自动恢复；辅助包缺失/版本错配 ⇒ 仅局部 typed unavailable，主包与无关能力不连带；不出现「官方行已禁用而替代行失效」的空洞状态。
- [ ] 6.3 官方直接使用者契约（Req 11.4）：官方行语义保留、R 替代行完整复刻被替代行的 ctx 服务面与事件面契约。
- [ ] 6.4 零修改审计与版本冻结断言（Req 11.5）：官方包目录零修改、不步进 runtime identity / `dsh.api` / 任何包本地维护号。

## Task 7: 文档与登记收敛（对应 Req 12）

- [ ] 7.1 现状注更新（P4/Req 12.2/12.3）：feature-list §1 的「已删除写路径的现状注」按交付事实改写（替代能力已兑现 + 逐条指向 `sessions.planMode.select` / `sessions.permissionPresets.select` / `credentials.set|unset` / `sessions.compaction.run` / `workflows.start`）；历史行的已获批验收边界**不改写**。
- [ ] 7.2 M9 状态行与临时链接（Req 12.4）：按提交事实更新各线状态行；对已删除临时契约文档的引用以提交事实注替换；历史批准记录不改写。
- [ ] 7.3 工作流代号的清理归口（Req 12.5）：历史制品状态行中的编排代号统一在登记表/现状注说明，**不逐文件改写**；新制品不引入此类代号（Task 1–8 产出物自查）。
- [ ] 7.4 standards 待确认清单（P8/Req 12.6/12.7）：落盘 `convergence/standards-pending.md`，**按 P8 的逐项实际状态**登记——**S1** 未同步（AGENTS §4 第 3 条事件表述与 M8 ledger 第 30 行张力；标注「需人类裁决」并写明现状以 registry/M8 ledger 为准）；**S2** 部分同步（`public-api-shape.md` 的 `workflows` 块已在，§2 树图其余旧叶子与 §7 settings 桥条目待确认）；**S3** 部分同步（`domain-composition.md` §2 的 `workflows` 行已在，**`credentials` 行缺失** ⇒ 列入待确认清单，经人类确认后新增，**不得记为核对通过**）；**S4** 已由 compaction 线同步（`capability-strategy.md` §5 的 R 类扩展登记注已在）⇒ 只做对账并记「已同步」；**S5** 部分同步（`capability-strategy.md` §5 与 feature-list §3.1 已由 decision-participation 提交 fb9f51d 同步，AGENTS §2/§4 部分待确认）。**不改写任何分册正文**。
- [ ] 7.5 本 feature 登记与 feature-list §7 条目（含三表位置、残余归属结论、待确认清单、能力缺口）。

## Task 8: 全量验证、全局终审与提交

- [ ] 8.1 `npm test`（4G 护栏）全绿；registry validator `registry valid`；`node scripts/convergence-verify.mjs` 全绿；client bundle `--check` 一致；治理 token 审计无新增泄漏；`git diff --check` 干净；官方包零修改审计。
- [ ] 8.2 全局终审（阻塞式、只读）：只审整体交付与 Tasks/Design/Requirements 一致性 + `docs/standards/` 适用分册；返回「无偏差」后才可进入 8.3；有意见则集中修订并再次派审（**纯措辞/登记级小修改就地闭合并登记，不再回派复审**）。
- [ ] 8.3 终审通过后按阶段提交规则提交 Stage 4 交付并完成最终登记（feature-list §7 条目 + 三表落盘）。

## 不在本线范围（明确排除）

- **有界审计环的内部重复实现统一**（P7）：无任何已提交登记或人类授权（AGENTS §6），本线只作观察记录，不动那 6 个 feature 内部模块的语义，也不动公共面审计环（`security.audit.*`、`tools.discovery.audit.*`、`skills.activation.audit.*`）或替代包内部环（`packages/llm` decoration 的 `_audit`）。
- **产品插件、TS 化、SDK、对外发布、安装到系统路径与任何版本决策**（goal Boundaries）。
- **治理文本的实质边界改写**（S1/S2/S3/S5 未同步部分、M8 张力）：只落「待人类确认清单」。

## 执行边界

- 版本冻结：不步进任何版本字段（AGENTS §3.0.1）；无 wire revision。
- **不新增 R 包/R 行**；唯一装配变更是 `services.appExit`（A 类 advanced passthrough、`optional`）。
- **不新增 convergence namespace / 万能 runtime root / 跨域大状态机**（goal Boundaries）。
- **治理文本纪律**：S1–S5 与 M8 张力不擅自改写分册正文（Req 12.6/12.7），只落「待人类确认清单」。
- **证据纪律**：等价证据必须来自真实公共入口执行；不得以 import 扫描、路径计数、测试总数或同进程 mock 直传充当（Req 1.5/4.3）。
- **不把降级当完成**（Req 13.1/13.3）：正确基线的必需行为缺失即保持未完成并报证据。

## Stage 3 对抗性审查记录（第一轮，2026-09-14）

结论「有意见」：3 高 / 6 中 / 4 低（含探针事实更正），逐条处置如下：

- **[高] Task 8（有界审计环统一）无 requirements/design/goal 依据、属 spec 外夹带** → **删除该 Task**；P7 改写为「仅观察、本线不处置」并给更正后的事实（形状为 `{records, truncated, gapSince}` vs `{records, gapCount, truncated}`；仓内另有**公共面**审计环 `security.audit.*` 与 `packages/llm` decoration 审计环，明确不在任何内部统一范围）；新增「不在本线范围」节写明无人类授权、不得自行立项（AGENTS §6）；Task 9/8 重新编号。
- **[高] Task 3.1 的组合分类与 design §5.1 冲突** → 改为：`SERVICES_REGISTRY_METADATA.composition` 只是**服务级直通**标记（1:1 转发、门面零附加状态），**成员级**组合分类按 design §5.1/§4 走 `memberGrades`：`exclusive` + `composableProfile: false` + authority = 官方 launcher 进程生命周期 + `bypasses`；新增 3.1b 处理白名单 53 → 54 键与 design §1.2/§1.5「键数不变」表述的冲突（加现状注并登记）。
- **[高] P8/Task 7.4 对 S1–S5 状态的错误登记** → P8 与 7.4 按实际状态逐项改写：S1 未同步（待确认）；S2 **部分**同步（`workflows` 块已在、树图其余与 §7 条目待确认）；S3 **部分**同步（`workflows` 行在、**`credentials` 行缺失**，不得当作已完成）；S4 **已由 compaction 线同步**（本线只对账）；S5 **部分**同步（capability-strategy §5 / feature-list §3.1 已同步，AGENTS §2/§4 待确认）。
- **[中] Req 覆盖缺口** → 逐条补落点：Req 1.2 每行显式引用来源制品（1.3 内）；Req 1.3 无 target 行走 Req 9 判定、禁止 contract-outside（1.3 内）；Req 3.6 切片头矩阵（新增 Task 2.6）；Req 7.1–7.5 整组（1.5 内补逐 idiom 一致性、`services.*` passthrough 分级、validator 承担 §5 机械校验）；Req 8.2 live handle 边界（5.3 内）；Req 12.3 后半 B4-1/6 无回流 + B4-2 保留无回归（新增 Task 2.2b）。
- **[中] design §8.2 的 constitution 消费者义务无落点** → Task 4.8 补 `dsh-read-image` 与 `dsh-pro-ex-ability-anchor` 的行为行与回归引用。
- **[中] P1 schema 描述不准** → 改为「schema 不齐：`action`/`relation` 可缺省（22/28/325 分布）」，Task 2.1/2.4 按缺省处理。
- **[中] P9 措辞不准** → 改为「M9 簇已有跨线集成测试（`integration-m9-*` 等）部分覆盖；M10 八线的组合场景不存在」，Task 4 要求复用既有边界与夹具。
- **[中] Task 4 证据形态未逐条可判定** → 在 Task 4 头部统一声明证据形态（真实公共入口 + 至少一条真实边界；官方侧 test-kit 探针替身允许；禁止 mock 内部对象直传/计数类证据），并要求文件头矩阵。
- **[中] Task 2.1 的 375 条核对可判定性不足** → 要求每条给出「target publicPath + 证据入口」或豁免理由，机械部分交 `convergence-verify.mjs`。
- **[低] Task 1.3 来源不可从仓库状态复现** → 写明来源路径 `temp/m10-api-coverage-observations.md` 并要求**先把 17 项目 + 子包枚举固化进已提交的三表**再做减法。
- **[低] Task 5.1/5.4 脚本载体不清** → 5.1 指明以既有 `test/client-capability-availability.test.mjs` 判定方式为基线并在本线测试中执行；5.4 明确 authority 一致性为**人工对账**落 `reconciliation.md`，脚本只承担可机械化部分。
- **[低] L4/L21 只有一句话对账** → 新增 Task 1.6b：L4 核对 registry 是否带「门面模拟、非官方仲裁」表述；L21 按 design §3.1 对账注**三选一并落盘**（本线不代答实质改动）。
- **[低] Task 8 若保留需覆盖 truncated 语义与受影响断言** → 随 Task 8 删除一并消解；P7 观察项已记录该差异，供未来维护任务参考。

### Stage 3 对抗性审查记录（第二轮，2026-09-14）

第二轮复核返回「有意见」6 条（1 高 / 1 中 / 4 低），逐条处置：

1. **（高）Task 7.4 未按 P8 改写**（仍写「S3 记为已由九线同步并核对通过」，与 P8 及仓库事实矛盾）→ 7.4 按 P8 的逐项实际状态整条重写：S1 未同步（待裁决）、S2 部分同步、**S3 部分同步（`credentials` 行缺失，不得记为核对通过）**、S4 已由 compaction 线同步（只对账）、S5 部分同步（fb9f51d 已同步前两项，AGENTS 部分待确认）。
2. **（中）悬挂引用「Task 9.1」** → Task 1.5 内的引用改为 **Task 8.1**（Task 9 已于上一轮重编号为 Task 8）。
3. **（低）「公共面」审计环表述不准** → 改为「公共面审计环（`security.audit.*`、`tools.discovery.audit.*`、`skills.activation.audit.*`）与替代包内部环（`packages/llm` decoration 的 `_audit` 测试缝）均不在统一范围」（P7 与「不在本线范围」节同步）。
4. **（低）Task 5.4 的检查未写进 Task 1.2** → Task 1.2 增校验项 (e)：成员表每行 `authority` 非空且与 registry 同路径行一致。
5. **（低）P1 对 Task 2.4 的引用不适用** → 改为只指 Task 2.1，并明确「不得要求补齐既有记录的字段」。
6. **（低）S5 提交归属与编号顺序** → S5 归属改为 decision-participation 提交 fb9f51d；1.6b/2.2b 顺排为 1.7/2.7，2.7 移到 2.2 之后。

