# Stage 0 Goal: plugin-api-m11-contract-enforcement

> feature_name: `plugin-api-m11-contract-enforcement`
> milestone: M11
> status: Stage 0–2 已交付（2026-09-14）；本文件与 `requirements.md`、`design.md` 同日由 SPEC1 一口气产出并提交。立项依据：人类于 2026-09-14 裁决「M11 收敛为单一 feature」并给出 `temp/m11-api-contract-convergence-handoff.md` 的范围输入；同日追加授权「standards 分册本身可以修订，只需保证分册标准在仓库中对齐统一落实」。
> 输入溯源：`temp/m11-api-contract-convergence-handoff.md`（临时指引，仅存于 `temp/`、永不提交；§2 主审结论、§3 主线 A、§4 主线 B、§5 局部必修 C1–C14、§6 排除项、§8 验收目标、附录 A–D 四份只读子审原文）；该指引基线为 `9b6c243`（M10 交付后 checkout），本线开工时工作区干净且 HEAD 即该提交；本目录 `design.md` §2 的逐项处置表（22 项 + 子审追加线索）与 §4 的分册修订清单是本线的正式落盘载体。

## Goal

以**整棵公共 API**（host 与 client）为对象，把已经冻结的 idiom、身份、生命周期、失败呈现与能力自描述契约真正落到运行时的公共边界上，并完成一次**双向对齐**：实现方向分册看齐的部分逐成员落实；分册自身与已交付事实、或分册之间相互矛盾的部分修订分册本身。

M11 不是新一轮风格设计。目标词汇（八类 idiom、handle 固定成员、owner 派生、三值 availability、统一终态）与逐成员目标契约在 `docs/standards/` 与 canonical registry 中**已经存在**；本线解决的是契约与运行时之间的落差，而不是重新发明契约。同时显式收口 M10 遗留的「两代表面并存」问题：M9 之后交付的 `sessions.*`/`attention`/`lifecycle` 已按 idiom 收敛，而 M3 时代的 `slots/remotes/settings/connection/events/codec` 从未做过同等收敛，二者必须在同一套外层合同下统一。

## Why

M10 交付后，人类要求检验 host/client 的 `pluginApi` API 树是否满足大部分 DSH 插件所需、是否可用易理解、是否符合 API idiom 与心智模型划分。检验结论（指引 §2）是：**能力覆盖与领域划分已基本够用，实际调用形状仍未收敛**；同一公共交互套路（注册 / 贡献 / 观察 / 长操作 / owner 规则）在多个领域反复分叉，问题横跨 host 与 client，不是一两个遗漏点。

本线同时发现一条被忽略的根因：**部分分叉并非实现偷懒，而是分册本身自相矛盾、或分册落后于已交付事实**，实现被迫在「对齐分册」与「对齐现实」之间二选一，于是留下两套惯例。典型证据：

- `api-idioms.md` §2 规定 `generation` 只表示可比较的并发控制令牌、注册顺序用 `seq`，而 §3.2/§3.6 强制所有 policy/resourceRegistry handle 必须含 `generation`；纯 additive 注册无代次可比，实现只能造字段或发例外。
- `api-idioms.md` §3.2 规定注册错误「不返回 `ok:false`」，而 `public-api-shape.md` §5 允许「返回或抛出」capability-unavailable；实现因此分裂（registry 口径 42 个注册入口登记 typed-throw，而 `prompts.provenance.policy.register` 实际返回 `{ok:false, code, detail}`，与自己的登记行相反）。
- `composition-and-authority.md` §5.1 的「不接受调用方伪造 owner」被机械套用到所有名为 owner 的参数上，使「调用者身份」与「资源所属者/目标 scope」两个概念被合并，登记与实现彼此矛盾。
- `public-api-shape.md` §2 的 host 树仍列 `events.on/once`、`executions.onChange`、`llm.routing.on/once/wait`、`sessions.onDurable/onceDurable`，而 registry 中这 20 个成员**全部为 `removed`**（实现已按 §3.1 迁到 `observe`）；§4 的 client 树只有 8 个领域，运行时与 registry 已是 14 个（缺 `sessions`、`attention`）。

因此本线把「分册修订」列为与「实现收口」并列的交付目标，而不是附带的文档整理。

## Scope direction

1. **契约内核先行**：先冻结外层合同（注册 handle、`dispose()` 返回、owner 派生、availability 映射、观察 handle、operation 结果与 handle、contribution 结果与 pending handle、canonical producer 判定），再逐领域映射；内核决策在 design §1 逐条给出目标形状、理由与反方案。
2. **注册面统一**：门面自有 register 一律返回标准 handle，官方必要附加能力（如 `.replace`）作为 handle 成员保留；裸 disposer 与旧式结果在门面层收口；`tools.register` 的 scope 双形态合并为同一外层合同，scope 失败绝不退化为全局安装。
3. **身份双角色**：`ownerId` 只表示调用者身份并从调用上下文派生；「资源所属者 / 目标 scope」如确有语义则以领域参数保留并另名登记；不可追踪时用根 token 并如实登记 `identitySource`，不以无来源的统一 owner 掩盖冲突。
4. **自描述诚实**：availability 外层三值 + 领域 detail 保留，`unknown`/`unsupported` 绝不映射为 `active`；client 面补齐有效探针与成员级 capability 粒度，不以对象存在性报 active。
5. **观察面分层**：查询快照、观察 handle、handle 内 subscribe 三层分清；观察 handle 只暴露公共成员，内部可变记录不外泄；订阅在 dispose 后一律 no-op 而非抛错（以 planMode/permissionPresets 已收敛形状为准）。
6. **长操作一致**：发起结果统一 `{ok, code, operation, terminal?}`，handle 统一 `{id, ownerId, status(), observe(), dispose()}`；`tasks` 的动词串字段腾位、`checkpoints.restore` 的句柄/快照关系纠正；不为语义上不需要操作句柄的动作硬造长操作。
7. **贡献面统一**：`contribute(spec)` 返回判别式结果与 `{id, ownerId, seq, dispose()}`；异步生效的贡献在完成前提供可安全 dispose 的 pending handle；host/client 同形。
8. **生产权与订阅权分离**：canonical 系统事件的派发只授予其 producer authority，第三方自定义事件仍走 `events.define` 的 owner-scoped publisher；事件名到 producer 的映射由 canonical 数据承载，不重设事件总线。
9. **分册双向对齐**：先落盘分册修订清单（哪册哪条、为什么、改成什么、影响哪些成员与登记），再按修订后的分册改实现；修订必须使「每个成员只有一条规则来源」，且新增例外数量只减不增。
10. **收口可验证**：22 项已知问题与子审追加线索逐项有处置结论（修复 / 合理例外 / 已修复 / 误报，各附证据），并给出机械校验与组合验收证据；不以「补文档/SDK 后就好懂」替代公共边界修正。

## Boundaries

- 不新增能力、不新增 R 点（`packages/*` 已有替代包可在其自身扩展面内修订，但必须维持替代行对被替代官方行的契约复刻与 boot 自检）。唯一例外是 C3 的 slots 只读声明投影（承载官方已存在的声明事实，不新增根、不新增注册平台，详见 design §2.3/§9）。
- 不重画领域树、不新增顶层 namespace、不新增「统一平台」型 runtime root；只做外层合同与成员形状的收口。
- 版本冻结：不步进 runtime identity `0.1.0-rc.6`、`dsh.api: 0.1` 或任何包版本字段；本线属本地开发窗口内的公共形状重构，`delivered` 不构成外部兼容承诺，**不留兼容 alias**。
- 不修改官方包文件；不改动横切派发语义（priority / deepFreeze / fault containment）与 fail-safe 约束。
- 排除项按指引 §6 执行：SDK、TS 化、API reference 生成、发布包装、开发者培训、测试完备性工程、同步/异步差异本身、接受结果无终态、operation 内部阶段差异、`services.*` 保留官方习惯、coordination `release(handle)`、假想恶意插件的安全加固，均不作为本线工作内容。
- `capability-strategy.md` 的实质修订按该册 §9 属人类确认项；本线只产出修订文本与影响分析，确认前不落盘该册实质条款。

## Expected result

**验收句**：开发者学会一种登记、贡献、观察或操作套路后，能在 host/client 的其他同类接口上直接复用，而不必重新学习身份、返回值和清理方式。

以指引 §8 的有限场景证明完成（逐条映射证据见 design §8）：同一工具由全局改为 agent scope 后外层 handle 与清理方式不变；两个插件登记同名资源时 owner 冲突行为明确且旧 handle 不能撤销新资源；同一策略在 llm/prompts/security 以可迁移方式登记；host/client 建立事件或状态观察时公共对象与释放层次可预测；client remote/slot/settings 贡献遵守同一外层合同且 pending 阶段可撤销；session request、workflow start、checkpoint restore 取得控制对象的方式一致；真实工具视图槽位（`tool.call.toolview`）可经门面使用；channels 的快照、订阅与事件帧读取不因名称造成错误调用；能力缺席/不支持/未知时不报 active 且协调的 durability/operations 可达披露；公共观察 handle 不暴露内部 listeners 与可变状态；canonical 系统事实与第三方自定义事件的生产角色明确；C1–C14 每项都有处置结论。

## Stage boundary

本文件只确认 Goal 方向与立项依据，不批准逐成员目标形状、handle 成员终表、idiom 例外变更或任何分册修订文本。Requirements 把上述十条 Scope direction 写成可验收的 EARS 条款；Design 产出契约内核决策、逐成员处置映射、idiom 例外变更、分册修订清单、失败路径与装配影响、验收证据映射与分册适用性结论。Tasks 与实现不在本阶段（SPEC1 边界）。
