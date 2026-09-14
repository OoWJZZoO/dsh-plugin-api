# Stage 3 - Tasks

> feature_name: `plugin-api-m10-contract-convergence`
> milestone: M10
> status: Stage 4 已交付（2026-09-14）。Stage 0–2 已交付（2026-09-12）；Stage 3 审查门两轮闭合后直接进入 Stage 4。实现、测试、三张表、对账与登记已完成；全局终审七轮：第 1–6 轮的实质意见全部处置（含收口阶段以 slice I 闭合 story 5.4/5.8 的 restore 执行与续跑 leg、第六轮补齐 constitution 消费者行为行与 read-image 等价证据），第七轮仅剩 5 条低度——4 条措辞/登记级按 AGENTS §3.2 就地闭合、1 条断言补强经变异验证可证伪——终审通过。全量 `npm test` **3469/3469** 绿；`registry valid`；`node scripts/convergence-verify.mjs` **537 成员行 / 37 行为行 / 37 全连接**；client bundle `--check` 一致；治理 token 审计绿；`git diff --check` 干净；官方包零修改与版本冻结审计通过。任务复选框保留 Stage 3 规划记录形态（未逐项改写）；实际交付以文末「Stage 4 执行注」「收口记录」与各轮终审记录为准，跑测口径以提交与 `npm test` 为准。
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

**产出**：`test/cross-line-scenarios.test.mjs`（实现期改名：原拟名含治理代号，按 AGENTS §6 落地为中立名）（组合场景，跨线协作在**同一测试**内完成）。

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

- [ ] 5.1 自描述核对（Req 10.1/10.3）：以 `test/client-capability-availability.test.mjs` 的既有判定方式为基线，在 `test/cross-line-scenarios.test.mjs`（实现期改名：原拟名含治理代号，按 AGENTS §6 落地为中立名）（或本线新增的自描述测试）中，对 registry 中**每个带 `availabilityMember` 的 namespace** 断言其自描述反映**真实** reachability（不是对象存在性或 aggregate 标志）；部分成员失效不得以 aggregate active 掩盖。
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

## Stage 4 执行注（2026-09-14）

**交付物**：
- `docs/specs/plugin-api-m10-contract-convergence/convergence/`：`consumer-behavior-table.md`（17 项目 + 子包清单**固化** + **37 条**行为行 = 35 条样本行为 + 2 条 constitution 消费者（`dsh-read-image` / `dsh-pro-ex-ability-anchor`，第六轮补齐）；另含字段 ↔ 列映射、单面/非门面义务/缺口汇总与 §2.1 home/scope 映射）、`public-member-table.md`（registry `members` 537 行机械派生 + 52 条 namespace 附录）、`implementation-assembly-table.md`（逐能力的 owner/source/装配/R 承载核对）、`reconciliation.md`（映射对账 375→382、B4 五项 + B4-1/6/2、§2.2 核对、语义判别五组、OBS-14 三项、L1–L21、能力缺口）、`standards-pending.md`（S1–S5 实际状态 + 不修订声明）。
- `scripts/convergence-verify.mjs`：三表 ↔ registry 的机械校验（(a)–(f)）；`test/convergence-verify.test.mjs` 把它并入测试门。
- `lib/official-service-definitions.js` + `lib/services.js` + registry（`servicesWhitelist` 第 54 键 + `memberGrades` + `capabilityMatrix` 行）+ `lib/capability-matrix.js`：`services.appExit`（Task 3.1/3.1b）。
- registry `oldToTargetMapping` 新增 7 条 B4 义务路径记录（Task 2.2）；`sessions.selection.set` 补第二条 idiom 例外六元组（L21 处置）。
- `test/convergence-app-exit.test.mjs`、`test/cross-line-scenarios.test.mjs`（跨线组合验收 **slice A–I**）、`test/convergence-assembly.test.mjs`、`test/convergence-capability-sweep.test.mjs`。

**与 Task 文字的偏离（逐条登记理由）**：
1. **跨线场景测试文件名**：原拟 `test/m10-cross-line-scenarios.test.mjs`，因治理代号不得进入 `test/` 实现产物（AGENTS §6，`test/governance-token-audit.test.mjs` 判定），落地为 `test/cross-line-scenarios.test.mjs`。
2. **Task 4 的组合验收以八个 slice 承载**（A 预设 ↔ 官方审批 ↔ 兜底应答；B 选择 ↔ 交付 ↔ 终态；C adapter ↔ 附件；D 两 agent 作用域隔离；E workflow 启动 ↔ 单一终态；F checkpoint 捕获 ↔ 效应顺序 ↔ 恢复计划；G compaction 门控拒绝 ↔ 引擎终态；H 组合 sessions 面上的 query → operation → cancel → 终态 → client 投影链）。每条 slice 说明其驱动的面（组合 `pluginApi` 或该线的成员实现面）与真实边界；单线 e2e 不替代组合验收。**该条取代本执行注早期版本中「三条场景」的表述。** 收口阶段增补 **slice I**（见文末收口记录）：story 5.4/5.8 的 restore 执行与续跑两段串入同一条链，本组现为 **九个 slice（A–I）**。
3. **Task 5.1 的自描述核对**：以既有 `test/client-capability-availability.test.mjs` 的判定方式为基线，另新增 `test/convergence-capability-sweep.test.mjs`（遍历 registry 的 host namespace：availability 成员为 selfDescription、运行时表可达、无服务在对象缺席时报 active）。
4. **Task 6 的装配验收**：新增 `test/convergence-assembly.test.mjs`（版本冻结基线、full 与选择性行集合等价、卸载恢复的 disable+insert 配对、缺失包局部降级），与既有装配测试集（`test/services-*.test.mjs`、`test/integration-surface.test.mjs`、`test/official-passthrough-*.test.mjs`、`test/registry.test.mjs`）共同承担 Task 6.1–6.4。

**能力缺口登记（Req 9.4）**：question 侧 pending/answer seam、per-session grant、`pairing-required` 无产出点——三项已写入 `reconciliation.md` §7 与 feature-list §7。

**不在本线范围**：有界审计环的内部重复实现统一（无授权，见「不在本线范围」节）；治理文本实质边界改写（S1/S2 其余/S3 credentials 行/S5 AGENTS 部分）。

### Stage 4 全局终审（第一轮）意见与处置（2026-09-14）

终审返回「有意见」9 条（2 高 / 6 中 / 1 低），逐条处置：

- **[高] 1 消费者行为表漏 2 个项目** → 补 `dsh-session-notification` 与 `dsh-task-relay` 行为行（含真实证据入口）；`scripts/convergence-verify.mjs` 增加**逐行三表连接**校验（行为行必须在成员表与实现/装配表各有对应行），现为 **35/35 行全连接**。
- **[高] 2 八故事组合验收缩水且未经公共入口** → 跨线场景扩为 **7 个 slice**（A 预设 ↔ 官方审批 ↔ 兜底应答；B 选择 ↔ 交付 ↔ 终态；C adapter ↔ 附件；D 两 agent 作用域隔离与释放；E workflow 启动 ↔ 单一终态 ↔ run 身份；F checkpoint 顺序；G compaction 门控拒绝 ↔ 引擎终态），全部经各线**公共门面**（`surfaceFor`/kit 的 `state.pluginApi`/`faceOf`）驱动；Task 4 头部矩阵同步为 7 行。
- **[中] 3 verifier (c) 非逐行** → 改为逐行断言（见上）；行数由脚本自检（35 行），不再依赖全局 shared 计数；`convergence valid` 输出改为「35 fully linked behavior rows」。
- **[中] 4 证据引用失真** → 四条不存在的测试引用改正为真实文件名（`checkpoint-*`、`index-session-branch.test.mjs`、`model-route-policy.test.mjs`/`route-policy-facade.test.mjs`、`client-remote-contribution.test.mjs`）；占位式证据替换为具体文件（`read-surface-projection.test.mjs`、`index-system-prompt.test.mjs`、`attention-redaction.test.mjs` 等）。
- **[中] 5 成员表末两列互换** → 表头与取值改为 `… | availabilityShape | currentShape |` 并**不截断**字段值；脚本 (b) 增加这两列（及 unescape）的逐字比对。
- **[中] 6 装配验收声明与证据不符** → 新增 `test/convergence-assembly.test.mjs`（版本冻结基线、full 与选择性行集合等价、卸载恢复的 disable+insert 配对、缺失包局部降级），Task 6.1–6.4 由该文件 + 既有装配测试共同承担。
- **[中] 7 自描述逐 namespace 核对未交付** → 新增 `test/convergence-capability-sweep.test.mjs`：遍历 registry 全部 host namespace，断言 availability 成员为 selfDescription 叶子、运行时 availability 表可达（直接或经其 namespace）、且**没有任何服务在对象缺席时被报 active**。
- **[中] 8 §5.2 probe 未执行** → 该行改述为**契约论证**（官方类型契约 + 1:1 直通），并显式登记「Task 3.2 的运行时 probe 未执行、不冒充 probe 结论」。
- **[低] 9 零星瑕疵** → appExit 缺席语义改述为「成员整个不出现（`optional` 语义）」；receiver 断言改为真实校验（官方成员在官方 service 上被调用）；`integration-surface` 注释同步；feature-list 措辞收紧（逐成员逐字比对项）。（**第五轮更正**：本条的 appExit 缺席表述按实现修正为「服务级 disabled + 成员级 optional」两种形态，见第五轮记录。）

### Stage 4 全局终审（第二轮）意见与处置（2026-09-14）

第二轮返回「有意见」7 条（2 高 / 3 中 / 2 低），逐条处置：

1. **（高）slice F 是空证据（恒真断言）** → 重写为真实顺序场景：经 checkpoint kit 的真实 store + facade 的 `create/inspect/planRestore`，捕获后执行效应再断言「记录描述的仍是效应前状态」且恢复计划指向该 checkpoint；不再有测试自身 push、无条件恒真的断言。
2. **（高）5.8 无组合场景 / 「全部经公共门面」声明不实** → 新增 **slice H**（组合 `createPluginApiService` + `mountFeature('sessionInteraction')` 上的 query → operation → cancel → 终态 → client wire 投影链）；文件头矩阵与 Task 4 证据形态说明改为**逐 slice 标明驱动的面**（组合 `pluginApi` / 该线成员实现面），不再笼统声称全部经组合面。
3. **（中）矩阵未同步** → `test/cross-line-scenarios.test.mjs` 头部矩阵扩为 **A–H 八行**（含 surface driven 列）。
4. **（中）同批制品互相矛盾的陈旧文本** → tasks 执行注的 33 行/slice A-C 表述更新为 35 行/八 slice 并注明「取代早期版本」；feature-list 的「33 行、21 条共享连接键」改为「35 行、逐行三表连接校验」；appExit 缺席语义在 README/两张表/对账文档统一（**第五轮更正**：该统一当时写成「成员整个不出现（`optional` 语义）」，与实现不符；第五轮改为「服务缺席 → 面 disabled + typed 降级错误；服务在场成员缺失 → 成员不出现」并再次统一，见第五轮记录）。
5. **（中）证据列存在虚构测试文件名** → 改正 `session-branch-*`/`prompt-*`/`attention-redaction`/`mcp-*`/`compaction-operation-e2e`/`adapter-decoration-*` 等引用；`scripts/convergence-verify.mjs` 增加**被引用测试文件必须存在**的校验（支持 glob 与 `packages/*/test/` 路径），并对 `reconciliation.md` 一并校验。
6. **（低）行为行数未固定自检** → 脚本钉住 `EXPECTED_BEHAVIOR_ROWS = 35`（冻结清单，删行即报错）。（**第六轮更新**：随 2 条 constitution 消费者行加入，常量现为 **37**。）
7. **（低）两个新测试的弱断言** → 装配测试补「模拟缺席全部辅助包时服务命名空间仍可构建、主包成员仍可达」的真实构造；自描述 sweep 记录并限制「经祖先继承」的例外（≤3 条），避免缺失记录被祖先掩盖。

### Stage 4 全局终审（第三轮）意见与处置（2026-09-14）

第三轮返回「有意见」6 条（1 高 / 2 中 / 3 低），逐条处置：

1. **（高）slice F 的决定性断言仍恒真**（`recordEffect` 全仓不存在，可选调用静默 no-op）→ **重写为双向可证伪的顺序断言**：捕获 A（真实 `create`，锚点 = 当前 live branch）→ 真实效应（`branch.face.create` 产生新 branch）→ `inspect` 断言 A 的记录**仍钉住其捕获时的边界**（不是活指针）→ 再次捕获断言其边界**不同于** A（后捕获看到效应后的状态）且 checkpointId 不同 → `planRestore` 指向 A。两个方向任一为假即失败，不再依赖任何不存在的成员。
2. **（中）slice A 矩阵的 migrated call 不实** → 该格改为实际路径「official `approval/policy` fact + `sessions.interactions.list/respond`」（`surface driven` 列原本已准确）。
3. **（中）5.8 链未闭合** → 在文件头**显式登记未闭合 leg**：restore 的**计划**由 slice F 覆盖，restore 的**执行**与**续跑**不在本文件的组合链内，其证据由 checkpoint 线与 interactive 线的自身测试承担（`test/checkpoint-restore.test.mjs`、`test/interactive-session-consumption.test.mjs`）；并说明把两段串入同一条链需要真实 session/loop 组装，属未完成的组合验收项——不冒充已覆盖。
4. **（低）两处旧「三场景」文案** → tasks 交付物条目与 feature-list 的跨线验收从句同步为 **slice A–H**（并列出各 slice 覆盖的故事）。
5. **（低）机械替换产生重复引用** → 两张表中的 `index-session-branch.test.mjs`、`index-mcp.test.mjs` 重复项已去重。
6. **（低）装配测试的「缺失包局部降级」未断言到面** → 改为**面级断言**：在无任何辅助包的构造下，命名空间键数等于全部声明服务数，且每个声明面都解析并报告自身 `isActive`。

### Stage 4 全局终审（第四轮）意见与处置（2026-09-14）

第四轮返回「有意见」1 条（高），处置：

- **（高）slice H 的测试体在第三轮重写 slice F 时被误删**（F 的替换区间覆盖到 slice G，H 恰好位于两者之间；矩阵行与四处制品仍宣称 A–H，`npm test` 用例数由 3463 降为 3462）→ **恢复 slice H 的测试体**（经组合面 `createPluginApiService` + `mountFeature('sessionInteraction')` 的 query → operation → cancel → 终态 → client wire 投影链），并把文件头的「未闭合 leg」段落更正为「五段由 slice H 在组合面覆盖；**restore 执行与续跑**两段仍未闭合（restore 计划由 slice F 覆盖，执行与续跑的证据在 checkpoint 线与 interactive 线的自身测试）」。恢复后 `npm test` = 3463、`test/cross-line-scenarios.test.mjs` 含 **8 个 slice 测试体**，与矩阵 A–H 一致。


### Stage 4 收口记录：story 5.4/5.8 的 restore 执行与续跑 leg（2026-09-14）

第三轮处置把「restore 执行」与「续跑」两段登记为未闭合，第四轮维持该登记。收口阶段**解除该登记**：新增 **slice I** 把两段串入同一条链，Task 4 / Req 5.4 / Req 5.8 的组合验收不再有未闭合 leg。

- **证据**：`test/cross-line-scenarios.test.mjs` slice I「one chain runs query → operation → restore stop → terminal → restore → resume → client observation」，一条测试内逐段执行：barrier capture（真实 store）→ 组合 sessions 面的 query/operation（真实 admit + client 可见投影）→ `executions.recovery.checkpoints` 的 `planRestore` + `restore` **真实执行**（preflight 的 system stop 经**同一共享 loop 边界**发出、terminal waiter 结算、authority 经 branch authority 提交）→ 该 stop 结算 pre-restore operation 的终态 → 续跑（第二次 request 在同一组合面与同一边界被 admit）→ client 经 typed status 路由观察到续跑 operation 的唯一终态。
- **可证伪性**：把边界终态事实去掉时 slice I 稳定失败（restore 不 ok，约 30s 超时后断言失败），mutating 验证后已还原；断言不依赖恒真条件。
- **面的说明**：slice I 的 checkpoint 一半驱动 checkpoint kit 的真实 store 与 guest facet（与 checkpoint 线 Stage 4 同源的探针形状），sessions 一半驱动组合 `pluginApi`；文件头矩阵的 `surface driven` 列已逐 slice 标明。
- **收敛**：slice H 仍覆盖「query → operation → cancel → terminal → client 投影」的组合面链；slice I 覆盖「... → restore 执行 → 续跑 → client 观察」并把两段真正串起。矩阵与四个制品（本文、`test/cross-line-scenarios.test.mjs` 文件头、feature-list §7、`convergence/consumer-behavior-table.md`）同步为 **slice A–I**。

### Stage 4 全局终审（第五轮）意见与处置（2026-09-14）

第五轮返回「有意见」8 条（1 高 / 4 中 / 3 低），全部实质修订：

1. **（高）Task 5.3（authority 地图逐资源对账）无落盘物** → `reconciliation.md` 新增 **§8**：design §4 的 19 行逐资源对账表（受支持门面路径 / advanced services / 官方 native 路径 / closure 与核对结论，逐行给出本仓库实现入口）、**live handle 合法用法边界表**（8 类官方 handle：workflow run / agent / session / channel / request operation / adapter binding / checkpoint 记录 / approval 请求，各列合法用法、不支持用法与其 typed 呈现证据）、保证级别声明与关键不变量门面闭合复核；据此 status 行的「对账已完成」成立。
2. **（中）Task 2.1「375 条逐条核对」缺证据、脚本归属写错、12 条 target 未解析** → `reconciliation.md` §1 重写：机械核对拆为 `scripts/registry-validate.mjs`（结构）与 `scripts/convergence-verify.mjs` 新增校验 **(f)**（target 解析），人工核对结论与 **382 条三类分类表**（340 命中 registry 现有路径 / 10 client 叶子豁免 / 2 描述性 target / 0 修正项）逐条落盘；client 叶子豁免逐条附实现与测试证据，校验 (f) 对未解析 target 报错而非告警，`test/convergence-verify.test.mjs` 增变异用例证明该检查可证伪。
3. **（中）`services.appExit` 缺席语义与实现/design 不符，测试驱动了装配器不会走的构造** → 六处文本统一为真实语义（服务缺席 ⇒ 面 disabled + typed `PluginApiFeatureDisabledError`；服务在场成员缺失 ⇒ 成员按 `optional` 不出现；两者都不合成 `process.exit`）：`README.md`、`consumer-behavior-table.md`、`implementation-assembly-table.md`、`feature-list.md`、`reconciliation.md` §5.1、`design.md` §5.1 现状注；`test/convergence-app-exit.test.mjs` 重写为**真实装配形态**（`createServicesNamespace` 缺服务）+ 成员级可选形态两个用例，`convergence-capability-sweep.test.mjs` 的装配断言同步改为组装面形态。
4. **（中）Task 7.2 / Req 12.4 已删除临时契约文档的引用未按提交事实注替换** → `feature-list.md` 的 M9 里程碑行与 §6 下一步建议两处加**提交事实注**（`temp/m9-parallel-development-contract.md` 已随 M9 交付用毕删除，现行契约以 `docs/specs/plugin-api-m1-integration/parallel-workflow.md` 为准）；各 M9 制品中的批准来源引用属历史记录，未改写。
5. **（中）消费者行为表缺 Req 1.1 字段对应的列、未逐行引用来源制品** → 行为表新增三列（**原动作/时序/副作用**、**源码证据锚点**、**来源制品（文件 + 章节）**）并在表头写明字段 ↔ 列映射与锚点粒度口径；35 行逐行补齐（来源制品引用九线 design 的**实际章节名**，源码锚点含样本 HEAD 与九线 design 给出的消费者/官方源码行）；同时修正第三轮遗留的一处重复引用。
6. **（低）slice I 的「restore stop 结算 pre-restore operation 终态」由测试手工构造事实** → 边界替身改为按 `admit` 登记的 operation id 发出 `agent/attempt/end` fact，测试**消费该真实 fact**（并断言其 `classification === 'system'`）结算 operation 终态，因果链由被测面自身串起。
7. **（低）装配等价断言单向** → `test/convergence-assembly.test.mjs` 补**反向断言**：full bundle 的 `disabled`/`inserted` 集合必须包含于选择性安装的并集（+ `plugin-api-main`），多余行即失败。
8. **（低）零星**：`scripts/convergence-verify.mjs` 头注释改为与实现一致的 (a)–(f) 并删除两处死代码；`reconciliation.md` §7 增**登记日期**列；registry `servicesWhitelist.appExit.memberGrades.exit` 补 `bypasses`（声明无门面侧优雅关机型保证）；Task 5.2（降级码 vs 业务拒绝码）落点补入 `test/convergence-capability-sweep.test.mjs` 的逐面 typed-disabled 扫描与词表分离断言；Task 3.3（home/scope 映射）落点补入行为表 **§2.1** 的映射表并在 §2 非门面义务清单点名 home 路径解析。

### Stage 4 全局终审（第六轮）意见与处置（2026-09-14）

第六轮返回「有意见」7 条（1 中 / 6 低），全部处置：

1. **（中）Task 4.8 的 constitution 消费者条款未交付**（`dsh-read-image` / `dsh-pro-ex-ability-anchor` 无行为行、无回归引用，read-image 的图片准入/投影路径未补等价证据）→ **补齐**：
   - 消费者行为表新增 **2 条行为行**（行数 **35 → 37**，`scripts/convergence-verify.mjs` 的 `EXPECTED_BEHAVIOR_ROWS` 同步为 37）：`dsh-read-image`（`llm.admissionPolicies.register` + `llm.modelInfo` + `events.observe`）与 `dsh-pro-ex-ability-anchor`（`remotes.register` + `sessions.durable.appendMessage`），两条均经逐行三表连接校验。
   - 新增 **`test/convergence-consumer-equivalence.test.mjs`**（本线新增的 read-image 等价证据）：slice A 在**真实挂载面**上经公开 `pluginApi.llm.admissionPolicies.register` 登记图片准入策略，驱动官方 `apiProxy.sessions.selectModel` 准入边界——基线拒绝 → 策略生效接受 → `pluginApi.llm.modelInfo` 仍读官方产物 → dispose 后官方拒绝复原；slice B 断言**无匹配策略时官方判定原样保留**（双向可证伪；原拟名 A2 含治理标签，按 AGENTS §6 改为中立名）。
   - anchor 的回归引用为既有 `test/consumer-migration-slices.test.mjs` slice C（plain-method remote 经官方边界调用），另引 `test/index-session-durable.test.mjs` 承载上屏写入路径。
   - 实现/装配表补 `llm.admissionPolicies.register` / `llm.modelInfo` 行（主包、B 类网关 carrier、边界缺失 → typed disabled、无匹配策略 → 官方判定原样）。
2. **（低）「18 行」与 design §4 实际的 19 行不符** → `reconciliation.md` §8 引言、`tasks.md` 第五轮记录、feature-list §7 条目三处改为 **19 行**。
3. **（低）行为表「来源制品」列 5 处引用不存在的章节** → 改为实际章节（`plugin-api-settings-remote-m3` §Shape）或整份文档引用（`plugin-api-client-remote-contribution-m3`、`plugin-api-client-slots-m3`、`plugin-api-client-settings-scope-m3` 三份确实无分节），并逐份复核标题存在性。
4. **（低）`implementation-assembly-table.md` 被空行截断**（第二段 9 行失去表头）→ 删除该空行，表恢复为单表。
5. **（低）`reconciliation.md` §1 对 `registry-validate.mjs` 的核对范围描述过宽** → 收紧为「`members.publicPath` 与 `oldToTargetMapping.targetPath` 的 `services.<key>` 形态值必须命中白名单键」，并说明 `oldPath` 不校验白名单的原因（B4 记录的 oldPath 恰为已删除键）。
6. **（低）registry `capabilityMatrix` 的 `services.appExit` 路径口径与全库不一致** → `currentPaths`/`targetPaths` 由 `["appExit"]` 改为 **`["services.appExit"]`**；registry validator 仍 `registry valid`。
7. **（低）tasks 状态行陈旧**（写「第 1–4 轮」而文末已有第五轮记录）→ 改为「第 1–5 轮」；本轮（第六轮）处置后再更新为「第 1–6 轮」。

### Stage 4 全局终审（第七轮）意见与处置（2026-09-14）

第七轮返回「有意见」5 条（**全为低度**，无高/中），按终审的收口判据处置：4 条为纯措辞/登记级（就地闭合、不再回派复审），1 条为单点断言补强（改动后经变异验证并重跑全量）：

1. **（低）行为表被空行截断**（与第六轮装配表同类缺陷在行为表复发）→ 删除 `consumer-behavior-table.md` 第 73 行空行，35 条样本行与 2 条 constitution 消费者行恢复为同一张表。
2. **（低）read-image 行证据引用「slice A/A2」而测试内已无 A2** → 改为 `slice A/B`（A2 已按 AGENTS §6 改为中立名 slice B）。
3. **（低）tasks 状态行轮次陈旧**（写「第 1–5 轮」而文末已有第六轮记录）→ 状态行更新为「第 1–6 轮」，并在本轮后定稿为「Stage 4 已交付」。
4. **（低）执行注交付物条目的校验项编号陈旧**（写 (a)–(e)）→ 改为 **(a)–(f)**（第五轮已把头注释扩为 (f)，执行注未同步）。
5. **（低）新增测试的 modelInfo 腿不可证伪**（同一 (provider, model) 的前一次调用已写入 resolver 记录，断言无法区分公开成员是否真的读了官方 resolver）→ 断言改为**调用次数增量**（`callsBefore + 1`）＋尾项参数比对；**变异验证**：把 `lib/llm-api.js` 的 `modelInfo` 改为不调用官方 resolver 直接返回合成对象后，slice A 稳定失败（slice B 仍绿，符合预期），还原后 2/2 绿。

**收口判定**：第七轮无实质修订遗留——第 1–4 条为措辞/登记级就地闭合，第 5 条为单点断言补强且已用变异证明可证伪；按 AGENTS §3.2「纯措辞/登记级小修改就地闭合并登记，不再回派复审」，本线 Stage 4 全局终审至此通过。
