# Stage 0 - Goal

## Feature Name

`session-branch-sidechain-edit`

## Status

SPEC1 Stage 0：Goal 已确认（M6 第四批次批量确认门）。R 类通道已经用户于 2026-08-25 明确批准。

## Goal

在 session durable semantics 上提供高层 branch/edit 契约：named branch（`retry | sidechain | experiment | rescue`）、branch graph 查询（current / ancestors / children）、edit plan（plan → preview → commit → rollback，expectedVersion CAS）与 restore 前置验证。官方 sessions 服务只有低层 `fork(source, boundary?, childSessionId?)`（typed 拒绝码 `SESSION_NOT_FOUND / SESSION_NOT_LIVE / SESSION_ALREADY_EXISTS / INVALID_BOUNDARY / OPEN_TURN`），没有 branch identity、branch graph、编辑计划与回滚语义——`dsh-turn-rewind`（Change Ledger / stale plan / rescue point / restore verify）、`dsh-checkpoint-rewind`（三态 checkpoint / 配额保留）、`dsh-tianshu-tui`（session fork/rewind）各自重造同一套状态机，即本 feature 的证据来源。

## Batch Order and Dependencies

本 feature 是 M6 第四批次第三个 feature（Wave B，重 R 单独串行推进），同批无前置依赖。对已交付能力的消费：

- `recovery-policy` 的 checkpoint 面：branch restore 引用其 checkpoint 证据，不重复实现配额/保留策略；
- `workspace-mutation-transaction`（Stage 2 已确认）的 mutation record 与 external side-effect 标记词汇：edit commit/rollback 复用同一套"哪些副作用不可自动回滚"的表达；
- 本仓库既有 session facade 能力（durable observation、受限 append、fork 直通探针）保持不变；R slice 与 facade 组合遵循 capability-strategy §4.1。

## Scope Boundary

- 包含：
  - `branch.create(parent, boundary, { kind })` 与 branch graph 查询；
  - `edit.plan(session, target, expectedVersion)`、`preview(plan)`、`commit(plan)`、`rollback(commitId)`；
  - branch 事件携带 parent boundary、causal source seqs、visibility 与 retention 元数据；
  - sidechain 对 route / memory / attachments / tool state 继承性的显式声明；
  - restore 执行前的验证步骤（session 状态与已声明的外部副作用清单核对）。
- 高风险边界（提案报告原文约束）：不能把新 child session 伪装成原 session 的就地修改；restore/rollback 必须考虑非 session 状态与 tool side effect（external 标记要求显式 approval）；旧 client cursor 的处理必须显式定义而不是静默失效。
- 不包含：checkpoint 配额与保留策略（recovery-policy 已有）、workspace 文件回滚（workspace-mutation-transaction 负责）、fork 底层机制本身的重新发明（官方已有，作为 branch 构建原语复刻并保留）。

## Classification

**R 类（替换类），经用户 2026-08-25 明确批准进入 spec coding Stage 0–4。**

- 被替代 owner：官方组件包 `@deepseek-ai/dsh-session@0.1.0-rc.6`（event-sourced session store，核心域，lib/index.js 1886 行）；官方 loader 行 `id: session`（见官方 `dsh-base/cordis.patch.yml:27-28`）。
- replacement 运行时名：`@deepseek-ai/dsh-plugin-api-session-branch`（capability-strategy §9 预留命名），替代行 id `plugin-api-session-branch`。
- R 类硬约束的落实口径（requirements 阶段逐条转为可测试验收）：
  - 完整复刻被替代行的 ctx 服务面（`sessions`: create / prepare / enter / announce / flush / get / list / fork 等）与事件面（`session/created | disposed | event | flush`）之后才增加 branch 契约；
  - 只替换 ctx 服务/事件面，不覆盖 `@deepseek-ai/dsh-*` 包 import 面；
  - boot 自检（官方行 disabled、替代行 active、关键契约可用；失败 fail-safe 正常 return，绝不双跑）；
  - 版本锁定 runtime 全量版本与被替代包 identity，不匹配时安全停用；
  - 组件唯一 owner（当前无任何已交付 bundle 替代 `session` 行，无冲突；实现须含冲突检测）；
  - 至少登记一条覆盖其承载能力的 U-series 上游提案与退役条件（官方提供等价 branch/edit API 后迁移并退役）；
  - client 半面初判 host-only：`@deepseek-ai/dsh-session` 包 package.json 无 dsh.client manifest、无 client exports；requirements 阶段按 capability-strategy §10 六项逐条记录证据后定稿。
- 分支与 session durable semantics 天然属于 session loader 的一致性责任（event index、flush、query、投影一致性），这是选择 R 而不是继续门面拼接的理由；横切派发语义仍不走 R。

## Expected Result

rewind 类、side question 类、rescue 类第三方插件不再各自维护 fork/截断/恢复状态机，而是通过统一 branch contract 操作 session；branch 身份、父子关系与编辑历史可查询；回滚只覆盖声明过且可回滚的范围，外部副作用被显式标记而非假装撤销；官方 runtime 升级由版本锁定与 boot 自检兜底——契约失配时安全停用并明确提示，绝不静默双跑或伪造成功。
