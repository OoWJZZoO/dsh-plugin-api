# AGENTS.md — dsh-plugin-api

本文件是 `dsh-plugin-api` 仓库的 AI 编码代理与人类维护者指南。**先读完再动手。**
仓库采用 **spec coding 工作流**：新 feature 必须按 Stage 0–4 推进（Stage 0–2 经人类确认门，Stage 3 以对抗性审查为门）；已交付 feature 允许按获批 Tasks 维护实现、测试与文档。后续新增或重构仍须遵守本工作流。

---

## 1. 这个仓库是什么

`dsh-plugin-api` 是 DeepSeek Harness 的**社区兼容层 / 插件 API 门面**：在不修改官方 DSH 包文件的前提下，把官方已有的 Cordis 扩展点稳定化，并用现有底层钩子把缺失的语义钩子尽量“转译”出来，给第三方插件一个统一的 import/inject 面。经批准登记的 **R 类 replacement bundle**（见 §2 第 7 条与 `docs/standards/capability-strategy.md`）可另经官方 patch 机制替代官方组件插件包中的行；任何情况下都不 patch 官方包文件。

计划形态（与 `agent/dsh-read-image` 同构的**双面 Cordis 插件**）：

```text
agent/dsh-plugin-api/
├── pnpm-workspace.yaml  # monorepo：工作区包含 `.` 与 `packages/*`
├── lib/index.js        # host 插件：注册 ctx.pluginApi，包装官方服务、挂转译钩子
├── lib/client.js       # client 插件：浏览器端 helper（remote contribution / codec / slot）
├── package.json        # 主包 @deepseek-ai/dsh-plugin-api-main（声明 dsh.client 清单；peerDependencies 共享宿主实例）
├── packages/           # 辅助 replacement bundles（compaction-events/、session-title/、mcp/、attachments/、agent-loop/）与全量聚合 bundle @deepseek-ai/dsh-plugin-api-full
├── docs/specs/         # spec coding 制品（见第 3 节）
└── test/               # npm test（= node --test "test/**/*.mjs" "packages/*/test/*.mjs"，temp/ 不参与扫描；见 §6）
```

一句话定位：**官方之上的“转译稳定器”**。官方内部包变化时，只改这一个仓库，而不是让 N 个社区插件各自 hack。

## 2. 与官方插件的关系（硬约束）

1. **不是 fork，不 patch 官方包文件。** 绝不修改 `/usr/lib/node_modules/@deepseek-ai/dsh/**`；只通过 profile/bundle 把本插件作为一行 entry 加载。
2. **同一棵 Cordis 树里的普通插件**，必须在第三方插件之前加载（row 顺序）。
3. 只通过 `inject` 消费官方服务（`llm`、`tools`、`agents`、`systemPrompt`、`settings` 等），**不 import 官方包的模块私有变量**。
4. 官方插件对本仓库无感知；本仓库默认不替代任何官方包。唯一例外是 §2 第 7 条的 **R 类 replacement bundle**：经批准登记后，用官方 patch 机制（`disabled: true` + 插入替代行）替代官方行，且仍然绝不修改官方包文件。
5. 能被外部“引出”的钩子分四类，设计时必须写清：
   - **A 类：官方已 dispatch，只需稳定化**（如 `agent/*`、`tools/*`、`session/*`、`llm/stream`）。
   - **B 类：官方没有 dispatch 点，只能用底层钩子模拟**（如同步 `llm/request` 用 `llm/stream` 重入模拟）。
   - **C 类：不改官方做不到**，只能写 proposal / 等上游（如异步完整请求改写、boot 故障隔离、`WEB_SETTINGS_NAMESPACES` 动态化、客户端 `remote.<ns>` 原生动态发现）。
   - **R 类（替换类）：官方没有 dispatch 点，且缺失语义天然属于某个官方组件插件包**。经 `docs/standards/capability-strategy.md` 批准登记后，由该组件的唯一 replacement owner 用官方 patch 机制（`disabled: true` + 插入替代行）禁用一个或多个该组件行，并以替代行提供“官方原接口 + 扩展接口”。R 类不 patch 官方包文件，也不再是普通门面转译；R 实现不得跨多个官方组件包。
6. 任何插件 apply 抛错当前会杀死整个 harness boot，因此本仓库所有入口必须遵循 **fail-safe**：失败只记录日志并安静停用，绝不抛穿 apply（dsh-read-image 的 G1 模式）。
7. **R 类 replacement bundle 硬约束（权威细则见 `docs/standards/capability-strategy.md`）**：
   - 替代单位是整行，管理单位是官方组件插件包：必须完整复刻每个被替代行的 ctx 服务面与事件面契约，之后才可增加接口；一个 replacement 包可承载同一组件内多个相关 feature，但不得跨组件；只替换 ctx 服务/事件面，**不覆盖** `@deepseek-ai/dsh-*` 包 import 面。
   - 只走官方 patch 机制：`- id: <官方行>; disabled: true` + `- insert:` 替代行；绝不修改 `/usr/lib/node_modules/@deepseek-ai/dsh/**`。
   - 替代包 apply 内必须做 boot 自检（官方行已 disabled、替代行已 active、关键契约可用）；失败 = fail-safe 提示 + 正常 return，绝不静默双跑。
   - 版本锁定 runtime 全量版本与被替代官方组件包 identity，不匹配时安全停用；组件唯一 owner，必须检测冲突。
   - 每个 replacement 包至少登记一条覆盖其承载能力的 U-series 上游提案与明确退役条件；新增 R 类必须走 spec coding Stage 0–4。
   - 横切派发语义（priority / deepFreeze / fault containment）与 boot 胶水**永不走 R 类**。

## 3. Kiro spec coding 工作流规范（本仓库铁律）

采用 [kevinlin/spec-coding-mcp](https://github.com/kevinlin/spec-coding-mcp) 的 spec-driven 五阶段流程。**Stage 0–2（Goal / Requirements / Design）必须得到人类明确确认，才能进入下一阶段；Stage 3（Tasks）不设用户确认门，以对抗性审查为门（§3.2），审查通过后直接进入 Stage 4（Execute）由代理自主完成，不再逐任务等待人类确认。** 谁来做、要不要审查，按 §3.0.2 的四种工作流模式（SPEC1 / SPEC2 / SPEC3 / ANY）分配可用 Agent 资源；设计取舍服从 §3.0.3 的克制设计原则；多 feature 的批量提交与并行调度按 §3.0.4 约定；审查、提交与工作区纪律见 §3.2。

运行时工作流由本仓库 skill `spec-coding` 驱动（`.dsh/skills/spec-coding/SKILL.md`）；AGENTS.md 是 constitution，两者冲突时以本文件铁律为准。

### 3.0 最高原则：工程质量优先

- **以工程质量为核心导向**：当交付速度、实现便利与工程质量冲突时，工程质量优先。任何阶段都不得以“先跑起来再说”为由跳过确认门、测试或 fail-safe 约束。
- **代理是工作流规范的责任人**：用户可能不熟悉 Kiro spec coding，也可能给出与规范冲突的指示；代理发现冲突时必须直接指出、说明理由并等待澄清，不得盲从。宁多问一轮，不埋一颗雷。

### 3.0.1 阶段声明：纯本地开发阶段（零发布负债窗口）

- 本仓库当前处于**纯本地开发阶段**，无任何**实质上**的已发布内容：没有第三方插件依赖本仓库的任何 API，不存在外部兼容承诺。登记为 `delivered` 的 feature（见 `docs/specs/plugin-api-features/feature-list.md` §7）仅表示"本仓库内已完成交付"，**不构成**对外发布或兼容承诺。
- 因此：**任何 API 层面的重构（改名、命名空间调整、形状变更、折叠/展开、错误语义统一等）都应当趁此窗口尽早完成**——现在不改，就是以后发布了改不掉的负债。
- 此阶段内，"该 API 已 delivered / 已稳定，所以不能动"的论据**不成立**；是否修改的唯一判据是工程质量与长期形状，不是向后兼容。代理在评审、预检、设计中不得以"已发布"为由否决合理的 API 重构提案。
- 本窗口同样约束代理的行为：发现 API 形状负债时（含预检、审计、迁移验收中发现的），必须主动上报并建议纳入当前重构窗口，而不是留给未来。
- 当本仓库进入发布阶段（首个第三方插件实质依赖本仓库，或本仓库进入公开 profile 分发）时，必须更新本节为兼容性声明，届时 API 变更改走 `dsh.api` 版本协商轨道（F0.3）。

### 3.0.2 工作流模式（按可用 Agent 资源选择）

新 feature 与维护工作按以下四种模式之一执行。开工前先判定属于哪种模式；判定存疑时，默认按 SPEC1→SPEC3 主线处理，并在动手前向用户确认。本节的模式分配只约束“谁来做、要不要审查”，不改变 §3.2 的人类确认门（Stage 0–2）、Stage 3 对抗性审查门与提交义务。

- **SPEC1（上层文档，Stage 0–2）**：由高质模型直接产出 Goal、Requirements、Design 三个制品，逐阶段交用户确认。**该模式 Stage 0–2 不派发对抗性审查**，确认门只有“用户明确批准”。SPEC1 不产出 Tasks，也不写任何实现代码。多 feature 批量产出时，推荐把该批 goal/requirement/design 文档一并提交待批准（批量确认门），见 §3.0.4。
- **SPEC2（审查纠偏，Stage 0–2）**：专门用于审查与纠偏 SPEC1 已产出的 Goal/Requirements/Design 制品。SPEC2 不是 SPEC1 之后的强制步骤，而是**按需启用**（用户指出文档问题或要求复审优化时）。它是**纯自动工作流**：只负责对当前阶段制品自动优化，**不设用户确认门**——优化完成即直接交付，不再逐次交用户评审；**仅当遇到阻塞级别问题**（动摇已确认的 Goal/Requirements 验收边界、需人类判断的取舍，或无法就地自动排除的矛盾）时才停下并请求人类裁决。它只核对当前阶段制品与已确认上游文档的一致性、不向上溯源，并就地修订当前阶段文档；不得借纠偏推进到下一阶段或写实现代码。多 feature 复审/优化时，主 agent 可并行派发各 feature 的审查子 agent、派发侧不阻塞（结束工具调用待回醒后统一调整），见 §3.0.4。
- **SPEC3（执行，Stage 3–4）**：承接已获批 Design 之后的全部工作：产出 Tasks（Stage 3），按 §3.2 通过对抗性审查后**直接进入**执行与交付（Stage 4），不再提交用户评审。Stage 4 **不再逐顶层大任务审查，改为全部顶层任务完成并验证后做一次全局终审**（见 §3.2）。
- **ANY（疑难杂症）**：任务范围不限、模型质量不限，用于修正代码逻辑、修复缺陷、更新文档等维护性工作；**通常不用于新增 feature**。ANY 不得改变任何 feature 已获批的 Goal/Requirements 验收边界，也不得夹带 spec 外功能；一旦实际工作触及新增能力或已获批验收边界，必须停下并转回 SPEC1→SPEC3 工作流。
- SPEC1/SPEC2/SPEC3/ANY 是治理编排代号，只允许出现在本文件等治理文档中，不得写入实现代码、包名、行 id 或运行时可见字符串（与 §6 治理魔法字母规则一致）。

### 3.0.3 克制设计（反过度设计）

- **核心功能优先**：设计只为已确认需求直接覆盖的行为服务；不做针对“假想敌”或臆想风险的预防性设计。“以防万一”“将来可能”“可能被滥用”都不构成增加设计复杂度的充分理由。
- **禁止无意义加固**：不要为未经证实的风险做费力而无意义的工作——例如记录仓库文件的 SHA1 以防文件被改动：本仓库由人类维护者作为唯一写者控制，这类“防止文件被悄悄改动”的风险不属于需要设计应对的对象。设计应对的是真实、可复现、有据可查的问题。
- **边缘情况从简**：边缘情况采用最小可用策略。**凡需要对边缘情况做大量设计的，必须先把方案报人类请示并获得批准**，不得自行铺开。这条对 SPEC1 尤其重要：最上层的 Goal/Requirements/Design 由它产出，过度设计最容易从那里被放大并向下传导。
- 是否属于过度设计存疑时，默认从简，并把取舍作为决策点提交人类裁决。

### 3.0.4 多 feature 批量与并行策略（SPEC1 / SPEC2）

当一次工作覆盖**多个 feature** 时，SPEC1 与 SPEC2 在各自单 feature 规则（§3.0.2、§3.2）之上叠加以下批量与并行约定；单 feature（单线）行为保持原样。两条约定都只改变“怎么提交、怎么调度”：SPEC1 的批量提交不改变确认门实质（推进下一阶段仍须人类明确批准）；SPEC2 是纯自动优化，不设用户确认门，仅遇阻塞级别问题才停下请求人类裁决。两条约定都不得夹带实现代码或越过已获批边界。

- **SPEC1（批量产出，推荐一并提交）**：批量产出多个 feature 的 spec 制品时，**推荐**把该批 feature 的 goal/requirement/design 文档**一并提交**待人类批准（批量确认门），而不是逐 feature、逐阶段零散提审。批量提交以阶段为边界组织：同批文档须逐份评审，用户明确批准后才推进下一阶段；未获批准的具体文档只能就地修订，不得带动同批其他 feature 越过确认门。批量产出的确认门仍只有“用户明确批准”，其 Stage 0–2 不派发对抗性审查。
- **SPEC2（多 feature 评审优化，主 agent 调度并行）**：SPEC2 为**纯自动优化**——被要求对**多个 feature 的制品**做复审/优化时，主 agent 自动完成审查、修订与交付，**不逐 feature 交用户确认**；仅遇**阻塞级别问题**（动摇已确认的 Goal/Requirements 验收边界、需人类判断的取舍、无法就地自动排除的矛盾）时停下并请求人类裁决。多 feature 场景下主 agent 主要负责**调度**，不再串行逐个 feature 阻塞派审：
  - **按 feature 并行派审，派发侧不阻塞**：为每个 feature 派发一个审查子 agent，各子 agent 只核对对应 feature 当前阶段制品与已确认上游文档的一致性、不向上溯源；全部派发完成后主 agent **直接结束工具调用**、**不阻塞等待**，由运行时的回醒机制在子 agent 返回结论时唤醒主 agent（DSH 即后台派发 + 结果回醒；与 SPEC3 强制 `run_in_background: false` 的阻塞派审相反）。这些子 agent 是 SPEC2 审查本身的按 feature 委托执行，不是对 SPEC2 再叠一层对抗性审查。
  - **回醒后按 feature 线串行调整**：各子 agent 返回意见后，主 agent 再据意见做**实际调整**；**每条 feature 线内部保持串行**（该 feature 的审查 → 针对意见集中修订 → 实质修订后按需再派审，逐 feature 推进），与单线阻塞逻辑本质一致。并行只发生在“不同 feature 之间”，绝不发生在“同一 feature 的审查与调整之间”。
  - **纪律对齐（§3.2 通用审查纪律的 SPEC2 多 feature 专用例外）**：派发后允许结束调用待回醒；不同 feature 可并行审查；在收到对应 feature 的最终结论前不得改写该 feature 的制品；收到意见后按 feature 线集中修订。

### 3.1 五阶段

| 阶段 | 制品 | 说明 |
|---|---|---|
| 0. Goal | 本阶段产出一个 `feature_name` 与目标摘要 | 用自然语言确认“做什么、为什么”（SPEC1） |
| 1. Requirements | `docs/specs/<feature_name>/requirements.md` | **EARS 语法**，可测试（SPEC1） |
| 2. Design | `docs/specs/<feature_name>/design.md` | 技术架构、host/client 分工、钩子引出机制（SPEC1） |
| 3. Tasks | `docs/specs/<feature_name>/tasks.md` | 依赖有序的任务清单（SPEC3） |
| 4. Execute | 实现代码 + 测试 | 严格按 tasks 执行，不夹带 spec 外功能；全部完成后全局终审（SPEC3，见 §3.2） |

### 3.2 确认门（gate）

- **Stage 0–2（Goal / Requirements / Design）**：每个阶段完成后，把文档交给用户评审；**用户明确批准后才进入下一阶段**。未批准时，只能修订当前阶段文档，禁止提前写下一阶段文档，更禁止写实现代码。SPEC1 批量产出多 feature 时，可把该批同阶段文档一并提交评审（批量确认门，见 §3.0.4），批量提交不改变本确认门实质。
- **Stage 3（Tasks）**：**不设用户确认门**。Tasks 产出后以下述 SPEC3 对抗性审查为门（返回“无偏差”）即通过；通过后**直接进入 Stage 4**，不再提交用户评审。审查未通过时只能就地修订 tasks 文档并再次派审，不得提前写实现代码。
- **阶段提交（强制）**：每个大于 `0` 的 Stage 完工后（Stage 0–2 以用户确认门获批为完工；Stage 3 以对抗性审查通过为完工），代理**必须**在承载该阶段成果的主/集成分支或工作分支创建提交，随后才能进入下一 Stage、派生或更新任何 worktree，或交付该阶段成果。提交只可包含已获批的本阶段制品及必要附带改动，且必须先通过 `git diff --check`；若提交失败或存在无法归属的变更，该阶段不得推进，必须先处理并向用户说明。
- **工作区清洁（阶段边界）**：阶段开工时若工作区已有脏改动，**不得默认“保留现状、绕着走”**。这些脏改动通常是上一阶段/上一工作流遗忘的提交；先 `git status`/`git diff` 查明归属——属于上一阶段已获批成果的，与当前阶段成果一并提交；属于当前工作的，纳入本阶段交付一并提交；确实无法归属或与当前工作无关的，立即停下向用户说明，不得擅自丢弃或静默携带。每个阶段完工（含阶段提交）后，工作区必须回到干净状态；不得把未提交成果留在 worktree 里等待下一阶段。
- **Stage 4 完成提交（强制）**：Stage 4 的代码工作（或仅文档交付任务）、所需验证与全局终审完成后，代理**必须**在最终交付、清理 worktree 或启动后续工作前，提交本 Stage 的实现、测试、规格与必要登记。不得把已完成成果只留在未提交的 worktree；任何新 worktree 必须从已提交的阶段边界派生。
- **对抗性审查（按工作流模式执行，模式定义见 §3.0.2）**：
  - **SPEC1（Stage 0–2）**：不派发对抗性审查。高质模型产出后直接交用户评审，用户明确批准即过门。
  - **SPEC2（Stage 0–2 审查纠偏）**：SPEC2 本身就是审查纠偏工作流；审查只核对当前阶段制品与已确认上游文档的一致性、不向上溯源，并就地修订当前文档。**SPEC2 是纯自动工作流，不设用户确认门**：优化完成即直接交付，不逐次交用户评审；仅当遇到**阻塞级别问题**（动摇已确认的 Goal/Requirements 验收边界、需人类判断的取舍、无法就地自动排除的矛盾）时，停下并请求人类裁决。无需对 SPEC2 再叠一层对抗性审查。涉及多个 feature 时，审查可由主 agent 按 feature 并行派发给审查子 agent，派发侧不阻塞（结束工具调用待回醒后统一调整），但每条 feature 线内部保持串行，见 §3.0.4。
  - **SPEC3（Stage 3）**：Tasks 产出后、进入 Stage 4 前，必须先调用一个子 agent 做对抗性审查，并**阻塞性等待其完成**（在 DSH 工具中必须使用 `run_in_background: false`；禁止以后台/异步方式派审后继续主线）。**仅小修改（如一两处文字或单点修正）无需再对抗性审查**。审查只核对 tasks 与已确认 Goal/Requirements/Design 的一致性、并按 `docs/standards/` 适用分册比对 tasks/design 的规范符合性，不向上溯源。返回“无偏差”即通过审查门，**直接进入 Stage 4，不再提交用户评审**；有意见则集中修订，实质修订后再次派审，同样阻塞且串行，直至通过。
  - **SPEC3（Stage 4）**：Tasks 通过对抗性审查门后由代理**自主完成全部任务**，不再逐任务等待人类确认，也**不再逐顶层大任务派审**。代理按 `tasks.md` 顺序完成全部顶层任务、验证与必要登记后，在交付结果报告前，必须对**整个 Stage 4 交付**（全部实现、测试、spec 修订与登记）调用**一次全局终审**：阻塞等待其完成（DSH 工具中必须使用 `run_in_background: false`），只核对交付物与 Tasks/Design/Requirements 的一致性、并按 `docs/standards/` 适用分册比对交付物的规范符合性，不向上溯源。全局终审返回“无偏差”后，代理才可交付结果报告、执行 Stage 4 完成提交并清理 worktree；有意见则在整个交付范围内集中修订，实质修订后再次派发全局终审（仍只审整体、不退回逐任务审查），直至通过。
  - **ANY**：不设固定审查门，但代码修改仍须满足 §6 的测试、fail-safe 与不夹带 spec 外功能等约束，且不得越出获批边界（§3.0.2）。
  - **通用审查纪律（凡存在审查门的模式）**：一旦对某制品/交付调用审查，代理必须暂停对同一对象的自行审查、编辑和重复派审；在收到该轮最终结论前不得推进主线。返回“无偏差”才能继续；实质修订后必须再次派审。SPEC2 多 feature 的调度例外（并行派审、派发侧不阻塞、结束调用待回醒后按 feature 线调整，见 §3.0.4）只调整调度方式，不改变“收到对应 feature 结论前不得改写其制品”的实质。
- **Stage 4（Execute）通用规则**：
  - 按 `tasks.md` 的顶层大任务/批次顺序执行，一个大批次内的所有子项、实现文件和测试作为整体交付；不得借任务合并掩盖未完成的验收标准。
  - 若执行中发现 spec 错误：实现细节/设计矛盾由代理先修订对应 spec 文档（requirements/design/tasks）保持一致，并在最终报告中列出修订；若错误动摇已确认的 Goal 或 Requirements 验收标准，则暂停并请求人类裁决。
  - 代理仍需遵守 fail-safe、测试、不夹带 spec 外功能等全部约束；全部任务完成并验证后，先完成全局终审，通过后向用户交付完整结果报告。
- **历史/在途制品衔接**：本次修订前写入在途 spec 制品（tasks 等）的“逐顶层大任务审查”与“Tasks 待用户确认后进入 Stage 4”旧约定一律失效，与本节冲突时以本节为准；代理在推进在途制品前，应先把其执行注同步为本节规则。

#### 3.2.1 Codex 协作运行时隔离（仅适用于 OpenAI Codex，硬性规则）

以下条款只约束 OpenAI Codex desktop/API 的协作运行时；其他 agent harness、普通人工流程和 DSH 运行时不因本节改变权限模型或工作流。

已获批任务书/设计文档中出现的「Luna(max) 审查」字样（如 `plugin-api-repo-normalization` 的整体审查约定）是 Codex 协作运行时的审查规格，不代表仓库对非 Codex harness 的模型要求。非 Codex harness（如 DSH）执行同一审查门时，按 §3.2 相应模式的规则派发**阻塞式只读对抗性审查**（`run_in_background: false`），使用该 harness 可用的最强审查能力；不得因为没有 Luna 模型而阻塞或中断该门，不得编造/代答 Luna 审查结论，不得尝试设置 Codex 专属参数。SPEC1 的 Stage 0–2 不设审查门，Codex 在该模式不派发任何审查子代理；SPEC3 的 Stage 4 全局终审属于本节所称审查门，同样必须按上述 Luna(max) 只读子代理规则阻塞执行。

- Codex 调用任何子 agent 时，必须显式传入 `model: gpt-5.6-luna` 与 `reasoning_effort: max`；不得省略 `model`、依赖主 agent 继承值，或选择 `gpt-5.6-sol` / 其他模型。为使模型覆盖生效，`fork_turns` 必须显式使用 `none` 或有界的正整数，不能使用会继承主 agent 模型且不接受覆盖的全量 fork。若 Luna 不可用，必须停止派发并报告阻塞，不得自动回退到其他模型。
- 创建子 agent 的首条提示必须以明确的角色栏开始，并把以下内容标记为不可因上下文压缩、省略或改写的约束：`[COMPRESSION-CRITICAL] ROLE=READ-ONLY-SUBAGENT`、本 agent 不是主 agent、不得修改任何文件或 worktree、不得提交、不得调用写工具、不得派生/唤起子 agent、只能返回审查结论。该角色栏还必须写明审查范围、对应的顶层任务和预期输出；不得只写“请审查”之类的短提示。
- Codex 派出的对抗审查 agent 是**只读审查员**：不得调用写文件工具、不得提交、不得修改 worktree、不得派生或唤起任何子 agent。审查提示词中的“只读”必须视为硬性验收条件，而不是建议。
- 子 agent 派出后，主 agent 必须使用协作运行时提供的阻塞等待原语等待其最终结论；等待期间不得循环轮询其状态。
- Codex 审查 agent 不得同时承担修复任务。修复只能由主 agent 在收到最终审查结论后执行；实质修复后必须重新派出独立只读审查。
- Codex 协作树不得层层外包审查。主 agent 必须直接指定审查模型和审查范围；任何子 agent 的再次委派都视为审查越权并使该轮审查失败。
- 上述模型、角色和等待规则属于 Codex 的执行前检查清单，不是可由 agent 自行权衡的建议。任一项无法满足时，主 agent 必须不派发、不继续该轮审查，并向用户报告具体缺口。
- 本节不把模型名称、协作 API 或 Codex 工具 token 写入项目实现代码；这些约束只属于 Codex 的开发编排行为。

### 3.3 EARS 需求写法

需求必须写成 EARS（Easy Approach to Requirements Syntax）形式：

```text
WHEN <触发条件> THEN <系统> SHALL <行为>
GIVEN <前置状态> WHEN <触发条件> THEN <系统> SHALL <行为>
WHERE <适用范围> IF <条件> THEN <系统> SHALL <行为>
```

例如：

```text
WHEN a third-party plugin registers a synchronous llm/request transform
THEN the adapter SHALL receive the transformed request and the transform SHALL be idempotent.
```

### 3.4 质量门（每个 spec 必查）

- **requirements**：每条需求是否 EARS、可测试、无实现细节；是否覆盖 host/client 两面；是否把“外部可实现 vs 必须上游”标注清楚。
- **design**：是否说明每个钩子的引出机制（官方事件直接绑定 / 底层钩子模拟 / 标记为 upstream proposal）；是否有失败路径与 guard 策略。
- **tasks**：是否与 requirements 一一对应；是否包含测试任务；是否有迁移验收任务（见第 5 节）。
- **standards（强制，docs/standards 对照，职责分工）**：requirements/design 必须按领域对照 `docs/standards/` 六册全局规范（`README.md` 为索引：capability-strategy / api-shape / identity-and-lifecycle / durable-state-and-scope / visibility-and-redaction / concurrency-and-cancellation）并显式声明各分册的适用性与对齐结论（含“不适用”）。**负责写文档/实现的代理在开工（Stage 0–3 文档编写或 Stage 4 实现）前阅读适用分册一次即可，不需要再做交付自查**；按 standards 分册比对交付物的审查职责由**对抗性审查代理**承担（§3.2：SPEC3 的 Stage 3 与 Stage 4 审查均已将 `docs/standards/` 适用分册纳入核对范围）。分工边界：实现代理负责“实现前读懂一次”，审查代理负责“按 standard 比对交付”；该分工不豁免实现方的基本质量义务（§3.0 工程质量优先）。教训来源：`coordination-lease` 交付后审计发现 generation 全局单调序号、bridge 重启重铸 generation、审计时间缺失、面放置与 scope 词汇等偏差，均因实现与审查两侧都未对照 standards 所致。

### 3.5 并行开发工作流

多 worktree 并行开发（M2+ 里程碑）必须遵循三阶段协议：**并行前契约先行**（命名规范、共享文件编辑边界、schema 词汇、失败呈现路径随任务书下发）→ **并行中强指导非铁律**（允许有理由的偏离，但必须记录并显式上报）→ **并行后预检 + 集中整合 + 全绿**。完整协议见 `docs/specs/plugin-api-m1-integration/parallel-workflow.md`。

- **轻量契约路径（小批次小规模并行）**：同一批 feature 数量少、组件边界清晰、且无跨仓库消费者迁移验收时，契约包**无需**落成正式 spec 制品（不必建 `m*-contract` 目录）；在 `temp/` 放一份临时契约文档即可，但内容仍必须覆盖命名规范、共享文件编辑边界、冻结文件、失败呈现与合并顺序，并由任务书分发时引用。临时契约文档**非制品**：不登记、不进入 `docs/specs/`、不单独提交、用毕即删。是否适用该路径由用户按批裁量；该简化只作用于契约载体，**不豁免**任何 Stage 确认门、R 类硬约束（`docs/standards/capability-strategy.md`）或三阶段协议本身。

## 4. 核心设计决策（已讨论，作为 constitution 输入）

1. 插件作者的**推荐、受支持**入口是主门面包 `@deepseek-ai/dsh-plugin-api-main`（仓库/项目名仍为 `dsh-plugin-api`；运行时通过 `ctx.pluginApi` 服务解析符号），由门面提供稳定性、版本协商与 fail-safe 保障。第三方插件**可以**绕过门面直接与 `dsh-tools`/`dsh-llm` 等内部包交互，但该路径被明确标记为 **unsupported escape hatch**：无兼容承诺、官方内部变化时可能破坏、自担风险。门面不强制、不拦截这种直连，也不为其提供任何保障。
2. 版本协商（**主包与全部辅助包统一适用**）：全量唯一版本号定义为 **`<runtime全量版本（含 rc 等后缀）>-<API协议大版本.迭代小版本>`**（如 `0.1.0-rc.6-0.5`，写入各自 `package.json.version`）：runtime 部分记录该包为哪个官方 runtime 构建，API 协议部分是门面的世代号（`package.json.dsh.api` 仅承载后者）。方向 ①（runtime↔包）要求 runtime 部分与实际安装的官方 runtime 完整 identity 精确相等，含 patch 与 prerelease；方向 ②（插件↔门面，`assertCompatible`）独立比较 API 协议 `major.minor`。任一方向不匹配时安全停用/显式报错。API 协议 minor 按**数字递增**：`0.9` 之后是 `0.10`，永不进位为 `1.0`；**协议 `1.0` 保留给正式发布**，标志着公开发布（此前均为纯本地开发期契约，见 §3.0.1）。**主包要求辅助包版本一致**：每个辅助包的 runtime 全量部分与 API 协议版本必须与主包完全一致（同一官方 runtime identity、同一 `dsh.api` `major.minor`），主包/装配层必须校验该一致性；任何辅助包与主包版本不一致时，**只停用该辅助包对应的 R 类特性**（其替代行与相关 catalog slice/feature 按 fail-safe 降级并显式报错），不得连带停用主包门面或其他无关特性，也绝不静默混跑。
3. 事件 API 保留 Cordis 的 `ctx.on` + `emit/serial/parallel/waterfall`，只增加稳定类型、只读 payload 与 `priority`（lowest/low/normal/high/highest/monitor）。
4. 需要优先“转译”的语义钩子：
   - 同步 `llm/request`（基于 `llm/stream` 重入，必须幂等收敛）
   - 语义化 `llm/admission`（第三方只声明“本会话/请求需要图片准入且承诺投影”，不公开 ModelInfo 变更；`resolveModelInfo` 包装仅作 B 类隐藏实现，并附 C 类上游提案）
   - `exec.route` / `routeOf(exec)`（基于 `agent.session.requestContext()` 或 `tools/pre-execute` 注入）
   - settings 可视化配置桥（`TypertRemoteService` + 客户端 `ctx.remote.$mount`）
   - session 上屏事件构造 helper（封装 `surfaceOp` / `sourceEventSeqs`）
5. client bundle 允许打包一份 zod，用于生成满足 `dsh-api-remotes` 校验的真 codec；其余依赖尽量保持 peerDependencies 以共享宿主实例。
6. **能力上限策略（权威细则 `docs/standards/capability-strategy.md`）**：采用方案一（门面转译）+ 方案三（replacement bundle）双通道。B 类是否转 R 按组件边界、契约可保留性、风险和维护成本判断，不采用统一量化门槛；高风险或无法证明官方契约保留时维持门面转译；横切派发语义（priority / deepFreeze / fault containment）永不 R。方案二（修改运行时源码）不作为插件分发通道，仅 boot 胶水级 C 类（如 U4）可作部署/运维例外，且必须人工批准、可逆、升级重放、不受 `dsh.api` 版本承诺。任何新增 R 类都须走 spec coding Stage 0–4。
7. **包策略与安装模式（constitution 级）**：
   - 辅助包拥有与主包一致的版本协商规则（官方 runtime 全量版本 + `dsh.api` API 协议版本），且主包要求辅助包版本一致（见第 2 条）；辅助包与主包版本不一致时，仅停用该辅助包相关的 R 类特性，不波及主包门面与其他能力。
   - 只提供两种明确的安装模式：
     ```bash
     # 默认全量
     dsh plugin --profile <profile> add @deepseek-ai/dsh-plugin-api-full

     # 选择性安装
     dsh plugin --profile <profile> add @deepseek-ai/dsh-plugin-api-main
     dsh plugin --profile <profile> add @deepseek-ai/dsh-plugin-api-compaction-events
     ```
   - `@deepseek-ai/dsh-plugin-api-full` 是**全量聚合 bundle**：依赖主包与全部辅助包，并拥有一份按确定顺序装配主包及所有替代行的 patch。它不新增任何 API；第三方 API 仍完全由主包的 `ctx.pluginApi` 提供。全量安装必须与选择性安装（main + 全部辅助包）装配出同一组主包行与替代行、同一行为，不得双跑或改变替代行语义。
   - 选择性安装的最小组合是仅 `@deepseek-ai/dsh-plugin-api-main`；需要哪个官方组件的 R 类能力就显式添加该组件对应的 replacement 包。辅助包只作为替代行参与装配，不提供第三方直接 import 的 API 面；其替代行约束仍遵守 §2 第 7 条。
   - 全量聚合 bundle 与全部辅助包同样遵循全量唯一版本号规则，且其 `version`/`dsh.api` 与主包完全一致；版本不一致时同样只停用相关 R 类特性。

## 5. 验收对象（spec 需求的现实来源）

- `../dsh-read-image/docs/known-hacks.md`：A1（monkey-patch resolveModelInfo）、A2（llm/stream 重入投影）、A3/A4/A5（Remote/设置桥）、A6（routeOf 深挖 agent）、G1（环境自检总保险丝）。
- `../dsh-read-image/AGENTS.md`：peerDependency 实例同一性、deepFreeze 与 AbortSignal、fiber ctx 上 `ctx.service()` 不可用等硬核教训。
- `../dsh-pro-ex-ability-anchor/AGENTS.md`：`system-prompt/assemble` 替换、session 上屏事件形状、Remote 参数名 wire 约束、面板 client bundle 约束。
- 迁移验收标准：上述两个插件改用 `dsh-plugin-api` 后，对应 hack 代码可删除或退化为官方 API 调用，且 headless 冒烟与 dev boot 均通过。

## 6. 仓库规则

- **对于尚未走完 Stage 0–3 门的新 feature**（Stage 0–2 经用户确认门、Stage 3 经对抗性审查门），只允许写该 feature 的 `AGENTS.md` 变更与 `docs/specs/**` 制品；不得提前写实现代码。该 feature 的 Tasks 通过对抗性审查门（进入 Stage 4）后，才允许创建或修改 `lib/`、`package.json`、`test/`、`scripts/` 等实现产物；已交付 feature 的维护必须有对应获批 Tasks、治理变更或 ANY 工作流的明确人类指示作为依据，且不得借维护新增 feature（§3.0.2）。
- 制品目录：`docs/specs/<feature_name>/requirements.md`、`design.md`、`tasks.md`。
- 测试（进入 execute 阶段后）：统一 `npm test`（即 `node --test "test/**/*.mjs" "packages/*/test/*.mjs"`，覆盖主仓库 `test/` 与全部包级 `packages/*/test/`）。**不要用裸 `node --test`**：它会递归扫描全仓库，把 `temp/`（gitignored 研究/临时目录）里的外来测试也收进来并导致失败/挂起；显式 glob 只覆盖两处测试目录。纯函数模块保持零 harness 依赖。
- **测试内存护栏（默认开启）**：`npm test` 通过 `systemd-run --user --scope -p MemoryMax=4G` 在 4G cgroup 内运行，超限由内核 OOM-killer 只击杀测试进程（`run-u*.scope: Failed with result 'oom-kill'`），保护宿主（尤其 8G 内存的 WSL）不被测试拖入全局 OOM。**不要绕过护栏直接跑 `node --test`**；确需原始命令时用 `npm run test:raw`（与旧 `test` 脚本等价）。护栏依赖 systemd 用户实例，脚本已内联默认 `DBUS_SESSION_BUS_ADDRESS`。背景：本套件曾在失败断言大量累积 diff（数万条）时单进程吃到 15G+，触发整机 OOM。因此遇到 `oom-kill` 应先修测试本身（如失控的失败断言、挂起用例），而不是调大阈值或绕过护栏。
- 不引入与门面无关的运行时依赖；需要宿主共享实例的包一律 `peerDependencies`。
- **治理魔法字母不进入实现代码**：`lib/`、`packages/`、`test/` 等实现与测试代码，以及 `package.json`、bundle patch 等实现产物中，不得出现从治理文档（AGENTS.md、`docs/standards/capability-strategy.md`、`docs/specs/**`）泄漏出的分类字母、需求/feature 编号或带治理代号的魔法标识。治理编号只允许存在于 `docs/` 治理/规格制品与本文件的登记溯源文字中。例如以下 token（含等价字符串字面量、行 id、feature 名、Symbol 键、错误文案、包描述、目录/文件名）禁止出现在实现代码里（清单不穷尽，凡属治理编号/后缀/代号同型者一律禁止）：
  ```text
  type: 'A' | 'R'
  source: 'O1'、'A1'、'T2'、'S1'、'L3'、'ST3'、'P6'
  compaction-events-r1
  plugin-api-session-title-r1
  A-class
  A11
  dsh-plugin-api.compaction-events-r1.active
  SPEC1 / SPEC2 / SPEC3 / ANY（工作流编排代号）
  ```
  运行时可见的名字必须使用中立、面向能力/语义的命名（例如包名 `@deepseek-ai/dsh-plugin-api-compaction-events`，行/feature 名只表达能力、不带 `r1` 之类治理后缀）；既有实现若违反本规则，必须在后续获批维护任务中清理，不得继续新增此类泄漏。
- 临时验证脚本放 `temp/`，用完即删。
- 治理文档 `docs/standards/capability-strategy.md` 是 A/B/C/R 分类与能力上限策略的权威来源；修订能力边界时，必须同步 AGENTS.md §2/§4 与 `docs/specs/plugin-api-features/feature-list.md`。全局 feature 设计规范统一收于 `docs/standards/`（见 §8），新增全局规范落盘该目录并在此登记。

## 7. 关键链接

### spec coding

- [kevinlin/spec-coding-mcp — Spec-driven Development Workflow](https://github.com/kevinlin/spec-coding-mcp)
- [GitHub Spec Kit — Spec-Driven Development](https://github.github.com/spec-kit/)
- [Spec Kit Quick Start](https://github.com/github/spec-kit/blob/5372dcbdeab4ccde9617865206e4df75841e1f0e/docs/quickstart.md)
- [Red Hat: How spec-driven development improves AI coding quality](https://developers.redhat.com/articles/2025/10/22/how-spec-driven-development-improves-ai-coding-quality)

### DeepSeek Harness 官方文档与源码

- [DSH Architecture](https://github.com/deepseek-ai/deepseek-harness/blob/HEAD/docs/architecture.md)
- [DSH Extension Cookbook](https://github.com/deepseek-ai/deepseek-harness/blob/HEAD/docs/cookbook/extension-cookbook.md)
- [DSH Event Producer/Consumer Matrix](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/event-producer-consumer.md)
- [DSH Services and dependencies](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/framework/service.md)
- [DSH Build a tool](https://github.com/deepseek-ai/deepseek-harness/blob/HEAD/docs/user/develop/basic/tool.md)
- 本机 DSH 安装源码：`/usr/lib/node_modules/@deepseek-ai/dsh/`（实际包在 `node_modules/@deepseek-ai/` 下）

### 设计参考

- [PaperMC: Event Listeners](https://docs.papermc.io/paper/dev/event-listeners/)
- [Cordis: The Plugin Kernel Behind DeepSeek Harness](https://floatboat.ai/blog/cordis-plugin-framework)

## 8. 交付登记与规范目录（防过期）

> 已交付 feature 的逐项登记表（范围、状态、Spec 目录、关键约束/设计）自 2026-08-21 起迁至 `docs/specs/plugin-api-features/feature-list.md` §7，本文不再保留登记表，避免双源漂移。规则不变：每个 feature 在 Stage 4 交付后，必须在该节追加条目并同步对应状态；公开 API 形状或里程碑状态变化时同步更新，防止文档过期过时（§3.0.1 中"登记为 delivered"即指该登记表）。
> 本文件自身**不记录任何 feature 的进度/里程碑状态**（进度以各 feature spec 目录的状态行与 feature-list §7 登记为准）；修改本文件时不得引入"当前完成了xxx"式的进度表述。
> 全局 feature 设计规范统一收于 `docs/standards/`（`README.md` 为索引；分册：`capability-strategy.md` 能力策略、`api-shape.md` API 形状、`identity-and-lifecycle.md` 身份与生命周期、`durable-state-and-scope.md` 持久状态与作用域、`visibility-and-redaction.md` 可见性、`concurrency-and-cancellation.md` 并发与取消；`stage0-common-questions.md` 已弃用作溯源）；新增全局规范落盘该目录并在 §6 登记。
