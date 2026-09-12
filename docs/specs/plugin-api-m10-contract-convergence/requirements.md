# Stage 1 Requirements: plugin-api-m10-contract-convergence

> feature_name: `plugin-api-m10-contract-convergence`
> milestone: M10
> status: Stage 0–2 已交付（2026-09-12）。goal 于 2026-09-11 获批（M10 批量确认门）；本文件与 design.md 同日交付。本文只定义可验收需求，不创建 tasks.md、不写实现代码。
> 上游输入：本目录 `goal.md`（十条 Scope direction 逐条对应见文末对照表）；M10 工作纲领 §1（完成定义）、§3.10（十条设计决定）、§4（分工表）、§7（统一验收矩阵）、§8（standards 对照）；M10 观察报告 §5 OBS-13/OBS-14、§6 纠正表、§7 闭合判据；M7 deletion report 批准记录与五项「后续 B 类接口义务」；M8 migration ledger；M9 已交付登记与维护现状注；canonical registry；九条 M10 线已交付制品（逐条引用见各 Req）。

## Status

Stage 1 Requirements（2026-09-12 交付）。本文是 M10 整树收敛 feature 的验收合同：它拥有跨线覆盖判定权（三张表义务、跨线用户故事、逐成员映射、idiom 归类、authority 地图），不拥有各领域运行时状态的所属权（各领域语义归九线与既有 owner）。全部条款在冻结版本基线（runtime `0.1.0-rc.6`、包 `0.1.0-rc.6-0.1.0`、`dsh.api: 0.1`）内交付，不提出任何版本字段变更。

通道标注约定：每条 EARS 条款末尾以【…】标注其性质——

- 【A】官方已 dispatch / 已提供服务，门面只需稳定化；【B】官方无 dispatch 点，经底层钩子/官方服务模拟；【C】不改官方做不到，只能 upstream proposal；【R】替换类，判定引 `docs/standards/capability-strategy.md`（R1–R8）。
- 【治理】纯文档/登记/验收判定义务，无运行时通道；【验收】测试与证据义务。
- 涉及九线已定形状的条款，其 A/B/R 判定随该线设计（引用处注明）；本文不重复裁定。

## Req 1 消费者行为表（三张表之一）

按纲领 §7.1 第 1 条：对观察报告 §3 的 17 个样本项目及其运行时子包逐行为对账。

- **Req 1.1** WHEN 观察报告 §3 所列任一样本项目（17 个顶层项目）或其运行时子包（§3.1 枚举的多包成员，含 `dsh-plugins/packages/`、`dsh-web-ui/packages/`、`dsh-tianshu-tui/vision-ask/`）中存在一项真实 DSH API 行为 THEN 收敛交付 SHALL 在消费者行为表中为该行为登记一行，字段含：项目/子包、源码证据锚点、原动作/时序/副作用、目标公共 API（publicPath + idiom）、authority、host/client、成功证据、故障证据；SHALL NOT 以「该行为无需登记」默认豁免任何已证实行为。【治理 + 验收】
- **Req 1.2** GIVEN 某行为的目标公共 API 已由九线之一定义 THEN 该行 SHALL 显式引用该线制品（文件 + 章节）并按其已定形状登记；SHALL NOT 另造第二形状或改写该线已获批边界。【治理】
- **Req 1.3** GIVEN 某行为的目标公共 API 不在任何一线已批范围内 THEN 收敛线 SHALL 按 Req 9（残余归属）判定等价路径或提出明确公共 seam；SHALL NOT 把消费者缺失登记为 contract-outside（纲领 §3.10：禁止先删 path 再把缺失写成范围外）。【治理】
- **Req 1.4** WHEN 一项行为的可达面只有 host 或只有 client 单面 THEN 该行 SHALL 如实标注单面，并把另一半缺口登记为待办或单面结论（按目标 API 的 client 半面判定，capability-strategy §10 六问）；SHALL NOT 以「host 有即等价」合并登记。【治理 + 验收】
- **Req 1.5** WHEN 表中一行宣称「等价」THEN 其运行证据 SHALL 来自真实公共入口执行（迁移切片/fixture 或既有回归，见 Req 3.6、Req 5）；SHALL NOT 以 import 字符串扫描、路径计数、测试总数或同进程 mock 直传充当等价证据（观察报告 §2.3、§7.4）。【验收】
- **Req 1.6** WHEN 某行为属于插件自有业务（UI 组件、业务算法、通知呈现、皮肤等）THEN 该行 SHALL 标为「非门面义务」并注明其 DSH 交互边界（若有）；该类行为 SHALL NOT 计入门面覆盖分母，也 SHALL NOT 被静默丢弃（观察报告 §1.3「只限 API」的准确解释）。【治理】

## Req 2 公共成员表（三张表之二）

按纲领 §7.1 第 2 条：收敛树的逐成员登记。

- **Req 2.1** WHEN 收敛后的目标语义树（design §1）包含任何公共叶子成员、handle 成员或事件成员 THEN 公共成员表 SHALL 为其登记：host/client、idiom（八类之一或 `services.*` passthrough exception）、scope、owner、authority、composition mode、handle 形状、并发策略、失败呈现、availability 形状、旧路径处理。【治理】
- **Req 2.2** GIVEN 成员来自九线已交付设计 THEN 该表 SHALL 采纳该线 design 的「registry 拟新增行」（idiom/effect/composition/conflictRule/scope/authority/runtime），只做跨线一致性核对；SHALL NOT 改写其已定形状。【治理】
- **Req 2.3** WHEN 两个成员共享名称或近似语义 THEN 该表 SHALL 证明五组判别互不混义：注册/装饰（`llm.adapters.register` vs `llm.adapters.decorations.register`）、观测/决策（`events.observe` vs 各 decisions registry）、追加/替换（`prompts.contribute` vs `prompts.assemblyPolicies`）、模式/权限（`sessions.planMode` vs `sessions.permissionPresets`）、操作/事实（`sessions.compaction.run` vs `compaction/*` 事件）；任一组无法判别 SHALL 提请对应线修订或由收敛线提出重划（走 design 修订）。【治理】
- **Req 2.4** WHEN 旧 path 曾存在且目标行已登记 THEN 该表 SHALL 登记旧路径处理（rename / merge / split / migrate / delete 或本线修正），与 registry `oldToTargetMapping` 一致；修正项按 Req 6。【治理】
- **Req 2.5** WHEN 成员带 idiom 例外 THEN 该表 SHALL 含完整六项例外记录：`memberPath`、`baseContract`、`exception`、`reason`、`replacementShape`、`verification`（api-idioms §1）；初版例外清单见 design §3。【治理】

## Req 3 实现/装配表（三张表之三）

按纲领 §7.1 第 3 条。

- **Req 3.1** WHEN 一项公共能力由门面交付 THEN 实现/装配表 SHALL 登记：owner 包（主包或辅助 replacement 包）、真实 source/决策点/carrier、版本条件（门控、替代行 active、契约 symbol）、full 与选择性装配等价性、缺位行为（typed disabled/unavailable/degraded）、验证入口（测试文件或切片标识）。【治理 + 验收】
- **Req 3.2** GIVEN 能力由 replacement 行承载（当前已知：compaction 线 operation 子面在 `@deepseek-ai/dsh-plugin-api-compaction-events` 替代行内扩展）THEN 该表 SHALL 核对其登记满足 R1–R8（capability-strategy §4）且与 feature-list §3.1 报备一致；SHALL NOT 出现未报备的跨组件协同或第二 owner。【R；判定引 capability-strategy §4/§4.1】
- **Req 3.3** GIVEN 能力为纯门面（无 replacement 依赖）THEN 该表 SHALL 如实登记「无替代行依赖」；full 与选择性装配等价由 Req 11.1 的装配验收证实。【治理 + 验收】
- **Req 3.4** WHEN 实现表的 source/决策点/carrier 与某线 design 的 Hook/Binding 分类表冲突 THEN 收敛线 SHALL 出具差异报告并以该线 design 为准（或经其 spec 修订后同步）；SHALL NOT 静默改写任一方。【治理】
- **Req 3.5** WHEN 缺位行为在「返回 typed 结果」与「抛 typed error」之间已由某线裁决（如 plan-mode 线「返回不抛」优先于 public-api-shape §5 通用规则）THEN 该表 SHALL 采纳该线选择并登记裁决出处。【治理】
- **Req 3.6** WHEN 迁移切片/fixture 用于运行证据 THEN 每个切片 SHALL 经真实公共入口与真实边界（wire 序列化、durable 落盘、双 owner），切片文件头 SHALL 写明「原行为 → 现行公共调用 → 运行结果」矩阵（维护基线先例：`test/consumer-migration-slices.test.mjs` 切片 A–E）。【验收】

## Req 4 覆盖判定（三表连接）

- **Req 4.1** WHEN 且仅当某行为在 Req 1/Req 2/Req 3 三张表中均有对应行且相互引用一致 THEN 该行为 SHALL 判定为「已覆盖」；任一表缺行或引用断裂 THEN SHALL 判定为未覆盖。【验收】
- **Req 4.2** WHEN M10 宣称完成 THEN 三张表 SHALL 对观察报告 §3 全部 17 项目及运行时子包逐行为闭合，且无未归属 OBS 项（Req 9）、无已承诺未接线的公开成员（Req 6.5）。【验收】
- **Req 4.3** WHEN 任一方以测试总数、snapshot 数量、import 计数或「源码有 export」提出覆盖证据 THEN SHALL 不予采纳；三表连接完整是唯一覆盖判据（纲领 §7.1 末段）。【验收】

## Req 5 跨线用户故事验收（纲领 §7.2 八条）

以下每条故事 SHALL 作为收敛验收的组合场景执行；单线验收不替代组合验收。

- **Req 5.1 多 agent 协作**：WHEN 按纲领 §7.2 第 1 条场景执行（登记工具与作用域提示词、成员新建/恢复得到正确模型、pre-step activation 生效、两个 agent 不串、更换/卸载不误伤）THEN 全链 SHALL 经公共入口运行成功，且失败注入（dispose/reload/同 id 冲突/反向装配顺序）呈现 typed 结果。衔接：`scoped-agent-contributions/requirements.md` Req 4/6、`decision-participation-contract/design.md` 逐点位保真表。【验收；承载面 A/B 判定随两线设计】
- **Req 5.2 图片变体**：WHEN 按 §7.2 第 2 条场景执行 THEN 新 provider route 登记后 SHALL 在选择面出现、原模型 SHALL 仍可用、图片 SHALL 经原附件/投影链真实调用、decorator 与新 adapter SHALL 不混义、凭据修改 SHALL 影响后续调用。衔接：`llm-adapter-registration/design.md` 迁移证据义务、`credential-mutation-contract/design.md` C2。【验收】
- **Req 5.3 自动继续与远端交互**：WHEN 按 §7.2 第 3 条场景执行（创建/选模型/发消息 → 真实 accepted → progress → 唯一 terminal；审批/提问显示与回应；取消、离线、重连、旧回调、重复请求）THEN 全部路径 SHALL 正确且终态唯一。衔接：`interactive-session-access/design.md` Face 1–4 与等价判据。【验收】
- **Req 5.4 checkpoint/rewind**：WHEN 按 §7.2 第 4 条场景执行（执行前屏障 → snapshot → 工具执行 → 恢复 → 新分支/受管状态 → 再次 request）THEN 与活跃 attempt 的取消/终态关联 SHALL 准确，SHALL NOT 丢文件恢复能力，SHALL NOT 把 attempt checkpoint 冒充所有 step 快照。衔接：`checkpoint-restore-contract` 既有面、`decision-participation-contract/design.md` fs 意图屏障行。【验收】
- **Req 5.5 模式与权限**：WHEN 按 §7.2 第 5 条场景执行 THEN Plan Mode/preset 切换 SHALL 实际改变官方行为，状态、提示词、审批、投影 SHALL 一致，且 SHALL 无越权客户端替用户提升权限。衔接：`session-plan-mode-control/design.md` Authority Closure、`session-permission-preset-control/design.md` C5。【验收】
- **Req 5.6 主动压缩**：WHEN 按 §7.2 第 6 条场景执行（用户请求 → 压缩策略 → 引擎 → session/provenance 更新与终态）THEN 拒绝/无需压缩/失败 SHALL 各有可区分证据。衔接：`compaction-operation/design.md` §3.5 码表与 §3.6 决策衔接。【验收】
- **Req 5.7 workflow**：WHEN 按 §7.2 第 7 条场景执行 THEN 门面 SHALL 启动真实 engine、run/agent/job/tasks 关联 SHALL 准确、取消/终态 SHALL 唯一；SHALL NOT 只有 projection。衔接：`workflow-execution-contract/design.md` §3.5 关联契约。【验收】
- **Req 5.8 原有能力不回归**：WHEN 按 §7.2 第 8 条场景执行 THEN remote/settings/storage/slots/notification/context/cost/redaction/claim 等原行为 SHALL 仍能经现有或新收敛 API 实现；维护修复后的 request/activity/checkpoint/attention SHALL 在实际组装下回归，query、operation、restore、续跑与 client 观察 SHALL 串成一条链（goal Scope direction 6）。【验收】

## Req 6 逐成员映射义务（old → target → behavior）

- **Req 6.1** WHEN registry `oldToTargetMapping` 存在一条记录 THEN 收敛线 SHALL 逐条核对「目标行为等价」：记录的 target 在当前实现中 SHALL 提供旧行为等价语义；核对失败 SHALL 列为映射修正项（首个已证实修正：llm.adapters rename/split 记录，修正方案见 `llm-adapter-registration/design.md` §「registry 拆分与 rename/split 记录修正」，收敛线落盘义务见 design §2.2）。【治理 + 验收】
- **Req 6.2** WHEN 执行任何映射修正或成员减法 THEN 顺序 SHALL 为「先确定需要保留的行为 → 定目标树 → 逐成员减法」；SHALL NOT 先删 path、再把消费者缺失写成 contract-outside（goal 取舍方向段）。【治理】
- **Req 6.3** WHEN 一个历史入口曾承载多个不等价行为 THEN 映射 SHALL 拆分记录（如 rename 记录保留并变为真实 + split 目标修正），SHALL NOT 以合并记录掩盖行为差异。【治理】
- **Req 6.4** WHEN 九线新增 path THEN 映射 SHALL 登记其 old → target 关系（含 M7 B4 义务路径：`services.planMode.set` → `sessions.planMode.select`、`services.permissionPresets.set/selectFor` → `sessions.permissionPresets.select`、`services.credentials.set/unset` → `credentials.set/unset`、`services.compaction` 整键 → `sessions.compaction.run`、`services.workflows` 整键 → `workflows.start`），并在 feature-list §7 登记对应交付条目。【治理】
- **Req 6.5** WHEN 某公共成员存在「已承诺未接线」（公共形状存在但真实数据路径断裂）THEN SHALL 判定为未完成并修复或显式降级登记；SHALL NOT 以 surface snapshot 一致性充当接线证据（OBS-10/OBS-11 教训；维护基线先例见纲领 §5 第 1/2/5 条补记）。【验收】
- **Req 6.6** WHEN 收敛树定稿 THEN Req 2.3 的五组语义判别 SHALL 各自映射到唯一无歧义入口，且每个入口在成员表中登记互指说明（错误入口 typed 拒绝并指路，先例：`llm-adapter-registration/design.md` 四动作归属总览）。【治理】

## Req 7 idiom 归类义务

- **Req 7.1** WHEN 收敛树成员被归类 THEN SHALL 按行为归类（调用方心智动作 + 系统主导方，api-idioms §1），归入八类 idiom 之一；SHALL NOT 以旧名字、实现包、namespace、历史交付状态归类。【治理】
- **Req 7.2** GIVEN 同一 idiom 的多个成员 THEN 入口动词、handle 形状、失败/冲突呈现、availability、owner 派生、generation/seq/epoch 语义与终态词汇 SHALL 一致（api-idioms §2/§3）；领域差异只能出现在显式领域字段。【治理 + 验收】
- **Req 7.3** WHEN 成员行为确需超出 baseContract THEN SHALL 按六项例外机制逐成员登记理由（api-idioms §1）；SHALL NOT 删行为迎合名字，SHALL NOT 新增第九 idiom。已声明例外：workflow run handle 三个附加成员（`workflow-execution-contract/design.md` §3.3）、tools/execute around（`decision-participation-contract/design.md` §idiom 归类）、fs 意图异步屏障（同前）；完整清单见 design §3。【治理】
- **Req 7.4** WHEN `services.*` 成员被归类 THEN SHALL 标 passthrough exception 并附成员分级（capability-strategy §6.1 七行表）；SHALL NOT 把任何非 `services.` 路径标为 passthrough exception。【治理】
- **Req 7.5** WHEN registry 驱动的机械校验可执行（入口动词/handle 形状/generation 混用/事件语义登记/availability 存在性，api-idioms §5）THEN 收敛验收 SHALL 执行该校验并全绿。【验收】

## Req 8 全路径 authority 义务

- **Req 8.1** WHEN 一等语义面声明维护某资源不变量 THEN authority 地图（design §4）SHALL 收录其全部受支持写路径——高层门面入口、低层 `services.*` 入口、官方 native 路径——并满足 authority closure 两分支之一：统一同一 authority，或声明为显式互斥 authority 并在组合前检测冲突（composition-and-authority §6）。【治理】
- **Req 8.2** WHEN 官方返回 live handle（workflow run、agent、session、channel、adapter binding 等）被门面包装或消费 THEN 地图 SHALL 登记该 handle 的合法用法边界（holder-owned / 只读 / 受限）与不支持用法；SHALL NOT 泄漏无边界共享写 authority（composition-and-authority §5.7）。【治理】
- **Req 8.3** WHEN `services.*` 成员作为 advanced seam 保留 THEN 地图 SHALL 明确其保证级别（默认仅形状稳定层，组合保证按成员登记）；推荐工作流 SHALL NOT 要求第三方拼接多个 `services.*` 才能维持门面声称的关键不变量（capability-strategy §6.1 末段）。【治理】
- **Req 8.4** WHEN 同一资源存在多条受支持写路径 THEN SHALL 统一 authority 或显式互斥（先例：`session-permission-preset-control/design.md` Authority Closure 双分支落实）；SHALL NOT 只协调新 API 一条路径。【治理】
- **Req 8.5** WHEN 关键不变量存在 THEN SHALL 由门面自身闭合；SHALL NOT 一边声称全局约束、一边借推荐 `services`/raw 对象绕过（goal Scope direction 3）。【治理】

## Req 9 残余归属义务

- **Req 9.1** WHEN OBS-14 三项残余进入收敛（优雅 appExit、launchEnvironmentOf fallback、resolveDshHome/scope 行为）THEN 每项 SHALL 获得归属判定：现有等价路径（附证据）或明确公共 seam（附提案、登记与退役条件）；SHALL NOT 因「属宿主」而自动忽略（纲领 §6 OBS-14 行、观察报告 §5 OBS-14）。判定结论见 design §5。【治理】
- **Req 9.2** WHEN 九线交付中发现新的真实 DSH 交互 THEN SHALL 逐项归入该线 Stage 4 或收敛线明确 seam 范围；SHALL NOT 出现无人负责项（纲领 §4.1 分工表末行）。【治理】
- **Req 9.3** WHEN 新增公共 seam 属小型 runtime access THEN SHALL 优先受限声明式/白名单面（`services.*` 或受限只读面）；跨出一等领域时 SHALL 正式拆线；SHALL NOT 借维护通道偷加 API，也 SHALL NOT 因项目大而排除。【治理】
- **Req 9.4** WHEN 残余能力结构上不可达 THEN SHALL 登记阻塞项（证据 + 最小解除动作 + 是否需人类授权 + 登记日期）并保持未完成；SHALL NOT 降级为「无需保留」的业务差异（观察报告 §5 OBS-14 末段）。【治理】

## Req 10 能力自描述义务

- **Req 10.1** WHEN capability/availability 报告成员可用 THEN 报告 SHALL 反映成员级实际 reachability（真实 authority/carrier/source/replacement 状态）；SHALL NOT 以对象存在性或 aggregate 标志冒充（OBS-11；维护基线先例 `test/client-capability-availability.test.mjs`）。【验收】
- **Req 10.2** WHEN source/authority/carrier 缺失 THEN SHALL 呈现 typed unavailable/degraded，并与正常业务拒绝（conflict/denied/rejected/unchanged/no-candidate 等）区分呈现；SHALL NOT 复用同一码混报。【验收】
- **Req 10.3** WHEN 一个 capability 下部分成员失效 THEN 呈现 SHALL 不得以 aggregate active 掩盖部分失效（public-api-shape §5 粒度要求；goal Scope direction 7）。【验收】
- **Req 10.4** WHEN 诚实降级发生（未安装可选包、断线、版本错配、合法冲突、用户拒绝、外部故障）THEN SHALL 保留该降级并隔离（不影响无关面）；同时 SHALL NOT 借降级掩盖正确基线未实现（纲领 §7.3）。【验收】

## Req 11 安装与兼容义务

- **Req 11.1** WHEN 以 full 或选择性（main + 全部辅助包）安装同一冻结版本 THEN 两种装配 SHALL 产出同一组主包行与替代行、同一行为；SHALL NOT 双跑或改变替代行语义（versioning-and-protocols §6）。【验收】
- **Req 11.2** WHEN 卸载任一 replacement 包 THEN 官方行 SHALL 自动恢复、官方原始装配 SHALL 可逆（capability-strategy §3.2）。【验收】
- **Req 11.3** WHEN 辅助包缺失或版本错配 THEN SHALL 仅局部失效（该辅助包相关 R 特性 typed unavailable），主包与无关能力 SHALL NOT 连带停用；降级 SHALL NOT 出现「官方行已禁用而替代行失效」的空洞状态（versioning-and-protocols §3）。【验收】
- **Req 11.4** WHEN 官方直接使用者（unsupported escape hatch 消费者）在收敛交付后运行 THEN 其契约 SHALL 不被破坏：官方行语义保留，R 替代行完整复刻被替代行的 ctx 服务面与事件面契约。【验收；R 判定引 capability-strategy R2/R3】
- **Req 11.5** WHEN 装配验收执行 THEN SHALL 覆盖：full 装配测试、选择性装配测试、缺失辅助包降级矩阵、卸载恢复、官方包零修改审计、版本冻结断言（不步进 runtime identity、`dsh.api` 或任何包本地维护号）。【验收】

## Req 12 文档与登记义务

- **Req 12.1** WHEN 收敛交付落盘 THEN canonical registry SHALL 是唯一事实源：九线拟新增行与本线修正行在集成波一次落盘，surface snapshot 与 registry 一致；SHALL NOT 在多个构造器、测试与文档中各自维护一份公共结构（public-api-shape §9）。【治理 + 验收】
- **Req 12.2** WHEN 历史制品（M7/M8/M9 spec、feature-list 历史行、本文件之外的旧 path 表述）与现状冲突 THEN SHALL 以文首现状注方式追加映射/修正；SHALL NOT 改写历史制品已获批的验收边界。【治理】
- **Req 12.3** WHEN M7 deletion report 的五项 B4 后续义务对账 THEN SHALL 逐项登记兑现路径（B4-3 → `sessions.planMode.select`；B4-4 → `sessions.permissionPresets.select`；B4-5 → `credentials.set`/`unset`；B4-7 → `sessions.compaction.run`；B4-8 → `workflows.start`），并核对 B4-1/6 删除项无回流、B4-2 保留现状无回归（`services.agentDefaultModel.saveSelection`/`currentSelection` 的批准裁决为「驳回删除、保留」，非删除项，不适用无回流核对）；feature-list 文首「已删除写路径的现状注」中「替代能力尚未兑现」表述 SHALL 随交付按提交事实更新。【治理】
- **Req 12.4** WHEN M9 制品状态行与临时链接漂移 THEN SHALL 按提交事实更新：状态行与现状注一致、对已删除临时契约文档（`temp/m9-parallel-development-contract.md` 等）的引用以提交事实注替换；历史批准记录 SHALL NOT 改写。【治理】
- **Req 12.5** WHEN 历史制品状态行中出现工作流编排代号 THEN 其清理 SHALL 归入登记义务（现状注/登记表统一说明）；SHALL NOT 逐文件改写历史制品；新制品 SHALL NOT 引入此类代号。【治理】
- **Req 12.6** WHEN registry、standards 分册、feature-list、README 相互引用 THEN SHALL 保持一致（registry 为现状事实、分册为设计判据）；standards 实质修订按 design §7 清单经人类确认后同步，SHALL NOT 在实现或维护中擅自改写治理文本。【治理】
- **Req 12.7** WHEN 事件决策表述张力（AGENTS.md §4 第 3 条与 M8 migration ledger 第 30 行的侧向参与删除）处理 THEN SHALL 经人类确认同步治理文档；同步前现行事实以 registry 与 M8 ledger 为准。【治理】

## Req 13 无损边界与完成判定（纲领 §7.3）

- **Req 13.1** WHEN 正确基线的必需行为缺失 THEN M10 SHALL 判定为未完成；SHALL NOT 因「已诚实降级呈现」而视为完成。【验收】
- **Req 13.2** WHEN 降级是诚实结果（未安装可选包、断线、版本错配、合法冲突、用户拒绝、外部 provider 故障）THEN SHALL 不视为缺陷，不要求伪造成功。【治理】
- **Req 13.3** WHEN 真实硬阻塞出现 THEN SHALL 报证据并保持未完成，等待人类取舍；SHALL NOT 自行降低纲领 §1.3 的完成定义。【治理】
- **Req 13.4** WHEN 宣称 M10 完成 THEN SHALL 同时满足：三表闭合（Req 4）、八条用户故事跑通（Req 5）、无未归属残余（Req 9）、文档与登记一致（Req 12）、装配等价（Req 11）。【验收】

## Requirements ↔ goal Scope direction 对应表

| goal Scope direction | 承载需求 |
|---|---|
| 1 语义树与逐成员映射 | Req 2、Req 6（树初版在 design §1/§2） |
| 2 八类 idiom | Req 7（归类初版与例外在 design §3） |
| 3 全路径 authority | Req 8（地图初版在 design §4） |
| 4 事实生产与参与分离 | Req 2.3（操作/事实、观测/决策判别）、Req 6.6 |
| 5 残余功能归属 | Req 9（OBS-14 判定在 design §5） |
| 6 M9 接线与状态回归 | Req 5.8、Req 6.5、Req 12.4 |
| 7 能力自描述 | Req 10 |
| 8 真实消费者守恒 | Req 1、Req 3、Req 4（三张表） |
| 9 安装与兼容 | Req 11 |
| 10 文档与登记 | Req 12 |

## Standards 对照（requirements 层）

逐分册适用性详见 design §10；本文按验收判据引用如下：`api-idioms`（Req 2.5/7）、`public-api-shape`（Req 2/4/10/12.1）、`composition-and-authority`（Req 8/11.4）、`capability-strategy`（Req 3.2/7.4/9/11）、`versioning-and-protocols`（Req 11）、`domain-composition`（Req 2.3 五组判别的领域归属）、`identity-and-lifecycle`/`concurrency-and-cancellation`/`durable-state-and-scope`/`visibility-and-redaction`（Req 2.1 成员表逐字段核对、Req 5 故事验收）、`ordering`（Req 7.2 顺序语义一致性）、`api-shape`（Req 2.3 一面原则与 smell 核对）。分册只写当前仓库事实；本文是未来事实的设计，与分册现状不冲突；需改分册实质边界的条目列为 design §7 待人类确认的设计决定，不在本文直接改分册。
