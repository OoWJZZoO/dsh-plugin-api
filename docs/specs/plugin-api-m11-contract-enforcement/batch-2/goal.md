# Stage 0 Goal: plugin-api-m11-contract-enforcement（batch-2 实效收口）

> feature_name: `plugin-api-m11-contract-enforcement`（批次：**batch-2「实效收口」**）
> milestone: M11
> status: Stage 0–2 已交付（2026-09-21）；本批三份制品（`goal.md` / `requirements.md` / `design.md`）由 SPEC1 一口气产出，与「M11 制品按批次分目录」的重排同一提交落盘。本批不产出 `tasks.md`、不写实现代码。
> 立项依据（人类指示）：人类于 2026-09-21 指示「以 SPEC1 工作流身份参考 `temp/m11-effectiveness-review-and-fix-guide.md`，在 M11 原有 feature 目录下追加新一批次的 spec 制品，做法是把第一批次制品移入子目录、再为第二批次建第二个子目录」。该指示构成本批的**范围授权**（M11 内新增一个修复批次）与**规格编写授权**（SPEC1，Stage 0–2）；同批落盘目录重排：第一批次制品位于 `../batch-1/`（内容除路径引用与文首批次注外未改写）。
> 输入溯源：`temp/m11-effectiveness-review-and-fix-guide.md`（**临时只读实效审查结论，仅存于 `temp/`、已 gitignore、永不提交**；审查基线 `cbbc29b`，即 batch-1 收尾提交）。本批把该指引 §2 结论、§5 缺口 F1–F7、§6 低优先观察项与 §7–§8 的纪律要求固化进本目录 `design.md` §2 的逐项处置表与 §9 的决策清单；实现与验收 **SHALL NOT** 依赖 `temp/` 文件的可获得性。
> 上游制品：`../batch-1/goal.md`、`../batch-1/requirements.md`、`../batch-1/design.md`、`../batch-1/tasks.md`（Stage 3）、`../batch-1/delivery-ledger.md`（Stage 4 交付台账，含全局终审十六轮记录与「无阻塞项」收口记录）。
> 执行口径（承 batch-1）：版本冻结基线内交付（runtime `0.1.0-rc.6`、主包及全部辅助/聚合包 `0.1.0-rc.6-0.1.0`、`dsh.api: 0.1`）；不步进任何版本字段；**不新增 R 点**；官方包文件零修改；`lib/client.js` 只经 `npm run build:client` 重建；所有入口 fail-safe。

## Goal

以**实效判据**——M11 自己的验收句，而不是台账自洽——收口 batch-1 按合规口径接受下来的残余差异：让「观察、登记、预检、可用性自描述」这几条公共套路在**每一个同类成员、以及在 host 与 client 两端**都只存在一种外层形状，并把仍在登记面之外的运行时成员处置干净。

判据（承 batch-1 `goal.md` 验收句，**不变**）：**开发者学会一种登记、贡献、观察或操作套路后，能在 host/client 的其他同类接口上直接复用，而不必重新学习身份、返回值和清理方式。**

本批的动作类型只有四种：**形状对齐、改名/合并/退役（减法）、登记补齐、可见性修复**。不新增公共能力，不新增顶层 namespace，不重画领域树。

## Why

batch-1 的**合规结论成立且不回退**：处置表逐项有结论、契约内核落地、分册修订落盘、registry 与运行时一致、测试全绿、全局终审十六轮通过（`cbbc29b`）。但同日的第二轮**实效审查**（判据＝最初要求本身，不看台账自洽）给出了不同答案，其结论为：

> **能力覆盖成立；「学会一种套路即可复用」不成立。** 收口在「点到点形状」上普遍是实的，但 `observe`、`register`、host/client 同 path、capability 预检四族仍是「逐成员学习」；另有 5 个运行时成员在登记面之外，其中一个（`attention.hubSnapshot`）绕过调用者可见性。

按对最初要求的伤害排序：**F1 观察面（高）> F2 登记面（高）> F5 越权 + 未登记（高）> F3 host/client 同 path（中高）> F4 能力预检（中）> F6 availability 语义（中）> F7 client 降级与命名（中低）**。

本批不把这归因于「遗漏」，而归因于**batch-1 的标准只写到了半步**——这些差异是被合规口径**接受**下来的，因此必须先把标准补成可判定的一条规则，再改实现。典型：

- batch-1 的 K5 / S-条款只规定「订阅入口统一 `observe`、返回四成员 handle、释放后 no-op」，**没有**规定 `observe` 的**入参合同**（主题形态）与 `current()` 的调用形态，于是实测同一动词 4 种返回形状、6 种输入形态，3 个成员违反自家 handle 合同（`dispose()` 返回 `undefined`/布尔、释放后 `subscribe` 抛裸 `TypeError`、观察入口是 `{ok, disposer}` 信封）。
- batch-1 的 K1/K2/S12 只规定「注册成功返回所属 idiom 的 handle」，**没有**为「官方权威拥有、门面无法释放的绑定」与「名字像注册、实为查询」两类成员给出判定规则，于是注册族 5 种成功结果，其中 `settings.register` 返回的对象**根本无法释放**（能力缺口，不只是形状差异），`tools.executionMode.register` 是查询却占用注册名。
- batch-1 的 S8/C8 把 host/client 同 path 的差异登记为「环境差异」处置，**没有**定「同 path 必须同到什么程度」，于是 `events.observe` 与 `settings.scope` 双端同 path 不同形；跨端插件必须写两套代码，且无法从返回对象判断自己在哪一端。
- batch-1 只给 client 做了成员级 capability 寻址（`caps.get('slots.contribute')` 只在 client 可用），host 仍只有 49 条精选路径，同一段「先探活再调用」的代码两端不同。
- batch-1 统一了 availability 的三值词汇与领域 detail 保留，**没有**定「什么算 degraded」的聚合口径，于是 `status` 不是可跨 namespace 比较的量（`tasks` 有 `unavailable` 来源却报 `active`）。
- 5 个运行时成员在登记面之外；其中 `attention.hubSnapshot` 是公开可达的**整 hub 读面**，只按 kind 过滤、**没有 caller 参数**，绕过 `lib/attention-hub.js` 的调用者范围过滤——既是登记缺口，也是该命名空间内 authority/可见性规则的例外。

## Scope direction

1. **观察面单一合同（F1）**：一条 `observe` 外层合同——入参 subject 的规范形态统一（options 对象；裸主题为可选便捷形态；**一律不接受订阅回调作为参数**）、handle 唯一四成员 + 已登记扩展、`dispose()` 判别式、释放后 `subscribe` 为 no-op、`current()` 的调用形态显式声明（允许 async，写清 `await` 统一写法）、降级路径同形（含 client attention 未安装态）、非法输入 typed。逐成员对齐全部观察入口，含 batch-1 未覆盖的 `sessions.durable.observe` 与 host `attention.observe`。
2. **登记面单一合同与冲突口径（F2）**：门面自有（非 `services.*`）注册成功只有**一种**外层形状（所属 idiom 的标准 handle）；「官方动词原样透传」类成员有可判定规则与登记，且不得与门面自有 handle 同名混列；名字像注册、实为查询的成员让位给查询动词；被官方权威拥有、门面无法完全释放的注册，**不得以「没有释放能力的结果」收场**——门面铸造标准 handle 并在结果与登记中如实披露释放边界。冲突规则收敛为封闭词表，每个注册成员逐行声明并与实现一致。
3. **host/client 同 path 规则（F3）**：给出一条可判定的「同 path 同形到什么程度」规则，然后按其收敛两处实测分歧：`events.observe` 两端统一为「判别式信封 + handle」（host 的非 catalog 名以 `untyped` 如实表达既有透传通道），`settings.scope` 两端可复用同一段调用代码（对象形态、读/订阅成员同名），写面差异显式登记。
4. **capability 预检可迁移（F4）**：两端接受已登记成员的公共 path 并解析到最近能力簇的实时状态；未知 path 在 `get` 上返回 typed 结果（不抛），`require` 保持 capability-unavailable typed throw；两端规则同源，差异只允许在「各端能力路径清单」这一登记事实上。
5. **登记完整性与可见性（F5）**：四个 `*.availability` 成员补齐登记；`attention.hubSnapshot` 移出公共面、改经内部接缝传递（跨组件内部缝不占用公共成员名），并把「公共读面必须按调用者范围过滤」写入分册。
6. **availability 可跨 namespace 比较（F6）**：把聚合规则写死为「**该 namespace 声明的当前可用性口径的最小值**」；`operations` / `durability` / `backend` 定位为**后端能力声明**而非当前可用性；非标准 token 的归一不得静默回落（含 `available → active`）；禁用形态与非禁用形态保留同一 detail 字段集；四处实测张力（`tasks` / `coordination` / `security` / `workspaces.transactions`）逐条对齐。
7. **client 降级路径与命名（F7）**：client attention 降级 handle 与安装态同形；`slots` 槽位读面命名收敛（`list` / `declaration` → `inspect`）；client `remotes.*` 与 host `events.*` 的命名分工写入分册。
8. **可复跑证据优先**：F1–F7 与 5 个未登记成员的最终去向逐项附**可复跑**的探针或测试（含失败面），不得以台账自洽、测试总数或 import 扫描充当证据。
9. **分册与治理同步**：修订清单先落盘再改实现；例外净额只减不增；registry（含 `removed` 行、`oldToTargetMapping`、`statusByPath`、`currentShape`、`callShape`）与树图、feature-list、README 同步。
10. **边界不动**：版本冻结、不新增 R 点、官方包零修改、fail-safe、保留并登记真实差异（见 Boundaries）。

## Boundaries

- **不新增公共能力**。本批全部动作为：形状对齐、改名（`tools.executionMode.register` → 查询名）、合并（`settings.register` 与其 scope 取回面收敛为同一 authority 的 handle 语义）、退役（`attention.hubSnapshot` 内部化；client `slots.list` / `slots.declaration` 收敛为单一成员）、登记补齐。改名/退役按公共面减法落 `removed` 行 + `oldToTargetMapping` + `statusByPath`，并保持能力守恒；**不留兼容 alias**。
- **不重画领域树、不新增顶层 namespace、不新增「统一平台」型 runtime root**；不新增 R 点；不修改官方包文件（`/usr/lib/node_modules/@deepseek-ai/dsh/**` 零改动）；不改横切派发语义（priority / deepFreeze / fault containment）。
- **保留并登记的真实差异（不得机械抹平）**（承 batch-1 与指引 §7.3）：`services.*` 的官方存在性口径（`isActive`）、coordination 的 `release(handle)`、workflow run authority 与 checkpoint 恢复阶段、各域 detail 字段、official seam 的原样透传（`tools.defineTool` / `mcp.resolvePublicName` / `prompts.render` 等已登记 helper）、`agents.register` 的官方动词透传、同步/异步差异本身（`tasks` 全域 async 等）、`tasks`/`executions` 的领域 payload 差异。
- **排除项（承 batch-1）**：SDK、TS 化、API reference 生成、发布包装、开发者培训、测试完备性工程、假想恶意插件的安全加固、不新增 MCP 注册平台/异步完整请求改写/凭据系统/动态 remote 发现。指引 §6 的低优先观察项按「纳入 / 不纳入（附理由）」逐项落 `design.md` §2.8，不得静默漏项。
- **本批不重开** batch-1 已判定的「已修复 / 合理例外 / 误报」项，除非指引 F1–F7 或 §6 列明；不夹带 spec 外功能。
- `temp/` 文件永不提交、不得 `git add -f`；本批制品不得让实现或验收依赖 `temp/`。

## Expected result

**验收句（承 M11 原文，不变）**：开发者学会一种登记、贡献、观察或操作套路后，能在 host/client 的其他同类接口上直接复用，而不必重新学习身份、返回值和清理方式。

本批以**可复跑证据**收口（逐项映射见 `design.md` §7）：

1. **观察**：一段 `const h = await ns.observe(subject); await h.current(); const off = h.subscribe(fn); h.dispose()` 在全部观察入口上成立，host 与 client 一致；handle 成员集逐字相同；`dispose()` 一律冻结判别式；释放后 `subscribe` 为 no-op 且 `current()` 给降级视图；任何观察入口都不抛裸 `TypeError`。
2. **登记**：门面自有 register 只有一种成功形状（标准 handle + 扩展成员）；非 handle 的绑定/查询不再占用 `register` 名；官方动词透传类成员有分册级判定规则与登记；冲突行为逐行等于声明的 `conflictRule` 词表值，并由两个 synthetic owner 的矩阵测试取证。
3. **同 path**：`events.observe` 两端同形（信封 + handle，未知名的 typed 结果/`untyped` 事实均已登记）；`settings.scope` 两端可复用同一段调用代码（读/订阅成员同名），写面差异已登记。
4. **预检**：`caps.get('slots.contribute')`（client）与 `caps.get('workspaces.transactions.observe')`、`caps.get('llm.routing')`（host）在各自端可用并答**真实簇状态**；未知 path 在 `get` 上返回 `unavailable` + `reason: 'unknown capability'`，`require` 仍 typed throw。
5. **登记完整性**：在挂载的门面上做「运行时成员 ↔ registry 行」机械对账，非 `services.*` 缺口为零；四个 `*.availability` 在册；`attention.hubSnapshot` 不在公共面且消费方改经内部接缝。
6. **availability**：`tasks`（有 unavailable 来源）报 `degraded` 且 `sources` 保留；`coordination` 跨 scope 报 `unavailable` 且 backend capability detail 保留；`security` 部分 face 缺失报 `degraded`；`workspaces.transactions` 的域 token 归一且 detail 不丢；非标准 token 不再静默回落。
7. **client**：attention 未安装态的 handle 与安装态同形（`dispose()` 判别式、`subscribe` no-op、`current` 降级视图）；`slots` 槽位读面只剩一个成员且用标准查询动词。
8. **治理**：分册修订清单落盘且与实现一致；例外净额（行 / 记录 / path 三口径）不高于 batch-1 收口实测；`npm test`、`registry-validate`、`convergence-verify`、`capability-matrix-sync --check`、`build:client:check`、`git diff --check` 全通过；版本冻结与官方包零修改审计通过。

## Stage boundary

本文件只确认第二批次的立项、范围方向与验收目标，**不批准**逐成员目标形状、handle 成员终表、改名/退役清单、分册修订正文或任何具体实现。Requirements 把上述十条 Scope direction 写成可验收的 EARS 条款；Design 产出契约增量决策（B 系列）、F1–F7 与 5 个未登记成员的逐项处置表、分册修订清单（S 系列）、例外净额核算、失败路径与 guard、装配落点、验收证据映射、需人类复核的决策清单与分册适用性结论。Tasks 与实现不在本阶段（SPEC1 边界）：按 `AGENTS.md` §3.2，本批 Stage 0–2 完工即提交，随后由 SPEC3 承接 Stage 3–4。
