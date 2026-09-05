# Stage 2 - Design

> feature_name: `checkpoint-restore-contract`
> milestone: M9
> status: SPEC1 Stage 2 草案 v2（2026-09-05 批次；v2 按人类指示以 R-first/能力优先修订），与 Requirements v2 同批提交待用户确认；同批文档均获明确批准后方进入 Stage 3（Tasks）。

## Status

SPEC1 Stage 2 草案 v2。本文承接 v2 Requirements（同批待确认）。v2 相对 v1 的实质修订：从"facade B 编排、运行中 session 一律 denied、workspace 仅事务窗口"改为**采纳两个 R 面**——(1) 共享 loop boundary slice（与 interaction/activity 联合）支撑 stop-then-restore 与自动捕获；(2) 新建 `dsh-workspace` owner 包 slice 交付事务窗口外 workspace 受管状态快照/恢复（Stage 3 probe 为能力门，probe 失败诚实降级）。

## Overview

本 feature 在 `pluginApi.executions.recovery.checkpoints` 提供三段式 checkpoint / restore contract：`create`（capture mutation）、`list`/`inspect`/`planRestore`（projection/plan）、`restore`（operation）。v2 的能力边界：

- **capture source v1 表**：`branch`（session，复用既有 `sessions.branches`）、`workspace-journal`（workspace，复用既有 `workspaces.transactions`）、`workspace-snapshot`（workspace，新 R slice，probe 门）；
- **restore 语义**：空闲目标按 plan 直接执行；**运行中目标走 stop-then-restore**（经共享 cancel boundary 停止 live attempt → bounded wait terminal → 回滚）；执行中（in-flight）状态不恢复（C 边界，明示）；
- **自动捕获**：基于共享 loop boundary slice 的 attempt 事实按 owner-scoped 策略打点；
- 单一 restore authority 提交 terminal；partial 是领域结果字段；无跨记录级联；无 purge；记录 append-only 单档 scope。

## Current-State Findings

- 官方无公开 checkpoint/restore 服务面。官方行 `session-checkpoint-policy`（无 owner）是纯政策钩子（监听 `llm/stream`/`tools/execute`/`agent/pre-step`，每次 model request 前做内部 durable checkpointing）；**无 ctx 服务面、无公开记录引用**（cap-strategy R2 契约不可复刻）⇒ 不 R，登记为 C 类上游提案。
- 已交付可复用 authority（registry 可证）：`sessions.branches`（create/plan/preview/commit/rollback/restore；`dsh-session` 行 owner 包承载官方 store 契约）；`workspaces.transactions`（prepare/record/preview/commit/rollback/recover/get/observe）；`coordination`（acquire/heartbeat/release/takeover/compareAndSet + fencingToken）；`executions.recovery`（单一自动消费 authority）。
- 同批 M9 依赖（未交付、随批确认）：`sessions.activity`（同批 projection，作降级证据源；未交付 ⇒ 相应证据路径 unavailable/blocked）；stop-then-restore 依赖 `session-interaction-operation` 线共享切片的 cancel 契约交付——该切片/成员缺位 ⇒ 运行中 restore 回退 denied（availability 明示原因），切片缺位的真实装配条件由 interaction 线交付决定。
- 环境事实：`workspace` 行（`dsh-workspace`，web profile，无 client manifest）服务 `workspaceRegistry`（bootstrap/create/mutate/status）；headless 无该行 ⇒ workspace 类 source 在 headless 一律 unavailable；官方 storage 行是 backend 抽象，不是领域恢复 owner。
- 共享 loop boundary slice（v2）：既有 `dsh-agent-loop` owner 包内共享切片（interaction/activity/checkpoint 联合登记）：admission/cancel boundary + `agent/attempt/start|end`（end 带 outcome 五值与 followUp none|queued）。checkpoint 消费：live-attempt observed 证据、cancel 唯一路径、自动捕获触发点。
- 历史 spec 已把跨 session checkpoint restore 登记为 C 类上游边界（recovery-policy / workspace-mutation-transaction 两 feature 的 design/requirements 记录；集成波统一补登 U-series 编号）。
- registry 现状：`executions.recovery.checkpoints.*` 零占位；`workspace` 行当前无 replacement owner（v2 新建包可行）；`agent/attempt/*` 零占位。

## Architecture

```text
 plugin (rewind UI / rescue / automation)
   │ create(spec)     │ list/inspect/planRestore      │ restore(id, plan)
   ▼                  ▼                               ▼
 ┌──────────────────────────────────────────────────────────────┐
 │ pluginApi.executions.recovery.checkpoints                    │
 │ · capture authority (mutation, 记录写入, append-only)        │
 │ · projection/plan (只读)                                     │
 │ · restore authority (唯一 terminal；stop-then-restore 时序)   │
 │ · auto-capture policy (owner-scoped, attempt 边界触发)        │
 └──────┬─────────────┬───────────────────┬─────────────────────┘
        │ 记录         │                   │
   session 档记录   workspace 档记录    coordination (lease/fencing)
        │             │                   │
        ▼             ▼                   ▼
 ┌──────────────┐ ┌─────────────────────────────────────────┐
 │ sessions.     │ │ workspace 档（二选一/并存）              │
 │ branches      │ │  A) workspaces.transactions (journal)   │
 │ (既有 R 成果) │ │  B) workspace snapshot slice (新 R)     │
 └──────────────┘ │     = dsh-workspace owner 包 fork        │
                  └─────────────────────────────────────────┘
        ▲ shared loop boundary slice (dsh-agent-loop owner 包)
        │ agent/attempt/start|end + cancel boundary
        │ → live-attempt 证据 · stop 协调 · 自动捕获触发
        ▲ sessions.activity 投影（只读；切片缺位时降级证据）
```

记录持久化：v1 记录写入 facade 单档 scope durable 记录设施（与已交付 durable mutation 记录同一类底座；Stage 3 probe 固定绑定）；backend 缺失 ⇒ create typed unavailable；schema/decoder 归 facade（零新 replacement 的退役暴露面）。

## Components And Interfaces

### 1. 公共面与 idiom（registry/capability 登记在集成波完成）

| 公共成员 | idiom | 面 | effect | composition | scope | 说明 |
|---|---|---|---|---|---|---|
| `checkpoints.create(spec)` | mutation | durableMutation | mutate | exclusive | session \| workspace | `commitState` + 冻结结果摘要 |
| `checkpoints.list/inspect` | projection | projection | read | pure | session \| workspace | 冻结视图 |
| `checkpoints.planRestore(checkpointId)` | projection（预定 verb 例外） | projection | read | pure | session \| workspace | 冻结 plan + fingerprint；无副作用 |
| `checkpoints.restore(checkpointId, {plan, signal?})` | operation | — | execute | exclusive | session \| workspace | handle；唯一 terminal |
| `checkpoints.restore.handle` | operation | — | read | pure | session \| workspace | `{id, ownerId, status(), observe(), dispose()}` |
| `checkpoints.availability()` | selfDescription | — | read | pure | facade | 覆盖 projection/各 source/auto-capture/restore（含 stop-then-restore 可用性） |
| capabilities：`executions.recovery.checkpoints` + `.capture.branch`/`.capture.workspace-journal`/`.capture.workspace-snapshot`/`.restore`/`.restore.stop-then-restore` | — | — | — | — | — | 集成波登记 |

### 2. Capture authority 与 v1 source 表

| source | scope | capture 动作 | anchor | restore 语义（v1） |
|---|---|---|---|---|
| `branch` | session | 经 `sessions.branches` authority 建 branch 锚点 | branch id | 空闲目标：经 branches restore 语义恢复；运行中目标：stop-then-restore 后恢复 |
| `workspace-journal` | workspace | 经 `workspaces.transactions` 记录受管 journal 窗口 | transaction/journal id | 窗口内受管状态经 transactions recover/rollback 恢复；窗口外不声明 |
| `workspace-snapshot` | workspace | 经 workspace snapshot slice（R；probe 门） | snapshot id | 该 slice authority 绑定的 workspace 受管状态整体恢复（file 级 rescue 通道）；slice 不可用时 source unavailable |

自动捕获：owner-scoped capture policy（默认关）订阅共享切片的 `agent/attempt/end` 边界，按策略（如每个 terminal attempt / 每 N 步）调 capture authority 建 branch 锚点 checkpoint；策略形状与配额在集成波 registry 登记；无切片时自动捕获 unavailable（availability 明示）。

### 3. Restore authority（唯一 terminal 提交者）

阶段时序：

1. 校验：plan fingerprint / 记录 / 锚点 / authority 状态（stale ⇒ conflict）；
2. 排他：`coordination.acquire`（资源 key 模板：`sessions.<sessionId>.restore`、`workspaces.<workspaceId>.restore`），记录 fencingToken；
3. 前置条件复查：读共享切片/activity 证据判定 live-attempt 状态——
   - 空闲/无 live attempt ⇒ 直接执行步骤；
   - 有 live attempt 且 plan 声明 stop-then-restore 路径 ⇒ **stop 协调**：经 request authority 的 cancel boundary 以 `by: 'system'` 身份请求停止（唯一 cancel 路径，携带 restore 因）→ bounded wait 该 attempt 的 committed terminal（保留调用方 AbortSignal 语义）→ attempt terminal 到达后开始回滚步骤；bounded wait 超时 ⇒ fail-closed（`error`/`denied`，绝不在 live attempt 下回滚）；
   - 切片缺位 ⇒ 使用 activity 投影降级证据；无法确证空闲 ⇒ step blocked（fail-closed 方向）；
4. 逐步执行：session 档只经 `sessions.branches`；workspace 档经 `workspaces.transactions` 或 workspace snapshot slice（按 plan 绑定）；每步携带 fencing/claim proof；记录每步 typed 结果；
5. 终止：不可恢复失败 ⇒ `error` + partial 领域结果；取消/lease 丢失/deadline ⇒ 共享裁决优先级唯一 terminal；迟到/过期结果被提交资格拒绝；
6. 审计：owner/op id/资源/步骤结果/terminal（无内容、无 secret）。

restore 后血缘：restore operation 的记录与结果 branch 携带 lineage-supersession 归因（superseded-by-restore，引用被 stop 的 execution/attempt 身份），经 branch authority 写入（Requirement 10 AC4）；被 stop attempt 的 loop 侧 terminal 仍由 interaction operation authority 按其裁决规则提交（cancel 信号通常裁定 `aborted`），本线不改写该终态；stop/血缘 authority 不可证明（attempt 未达 terminal、branch authority 不可用）时归因降级 typed unavailable，不虚构。续跑由消费者经 `sessions.request`（interaction）发起，父因记录 checkpoint——执行中状态（attempt/tool/provider context）不恢复（C 边界）。无跨记录级联；无 purge；默认不自动 retry（内部 retry 为同 operation 下新 attempt，外部重触发为新 operation）。

### 4. Workspace snapshot slice（R，新建 `dsh-workspace` owner 包）

- 行：官方 `workspace`（web profile）disabled + insert 替代行（cap-strategy R1；零官方包修改）；包名/行名在集成波定稿（运行时命名中性，不带治理编号）。
- 契约保真（cap-strategy R2）：完整复刻 `workspaceRegistry`（bootstrap/create/mutate/status）ctx 服务面与事件/时序/payload 契约，之后增加：capture-point（记录该行权威拥有的 workspace 受管状态，带逐组件状态）、restore-path（在 restore operation 的 fencing 内应用快照）；只处理该行拥有的领域，不越界到 session/external。
- **Stage 3 probe（能力门）**：证明 (a) 官方行整面可复刻（服务/事件/时序），(b) workspace 受管 mutation 流经被替代服务、可在 capture point 取得权威状态，(c) 快照应用路径可逆或可 fail-closed。任一不可证明 ⇒ slice 不宣称 snapshot 能力（`workspace-snapshot` source unavailable），官方契约行为照常（官方原行为，不启用快照扩展）；绝不留"官方行禁用 + 无工作替代"空洞。
- 自检/版本/owner（cap-strategy R4/R5/R6）：官方行 disabled、替代行唯一 active、runtime/包 `A.B.C` 一致、无组件 owner 冲突；失败 ⇒ log + 安全停用扩展面。
- client 半面（capability-strategy §10 六问）：被替代官方行无 client manifest、无 remote/slot/settings、无 host↔client 协商/browser state/client 事件（名字级盘点）⇒ 六问全否 ⇒ host-only；web-only 行，headless 无该行 ⇒ 该行/slice 在 headless 缺席属正常装配差异（availability 如实报告），不是故障。
- 退役条件/上游提案：官方提供等价 snapshot/restore seam 后退役（feature-list §3.1 U-series 登记）。

### 5. 共享 loop boundary slice 消费（R；与 interaction/activity 联合）

| 消费点 | 事实/能力 | 切片缺位时的降级 |
|---|---|---|
| live-attempt 前置条件 | `agent/attempt/start|end` → observed running/idle/queued | activity 投影降级证据；无法确证 ⇒ step blocked |
| stop-then-restore | cancel boundary（唯一路径，与 request authority 共用） | 运行中恢复回到 denied + reason |
| 自动捕获触发 | attempt/end 边界 + followUp | auto-capture unavailable |

### 6. R 决策表（v2）

| 候选官方组件 | 候选语义 | v2 决策 | 证据 |
|---|---|---|---|
| `dsh-agent-loop`（既有 owner 包） | park/cancel/attempt 事实 | **采纳（共享切片消费，不新增包）** | 见 §5；"suspension（挂起）"不可证明 ⇒ 用 stop-then-restore |
| `dsh-workspace`（无 owner，web） | 事务窗口外 workspace 快照/恢复 | **采纳（新建 owner 包，probe 门）** | 见 §4；file 级 rescue 的唯一可达通道 |
| `dsh-session`（既有 owner 包） | session 档 capture/restore | 不采纳 | branch 锚点/恢复已由既有 owner 包交付（A/B 复用），无缺失契约要补 |
| `dsh-storage`（无 owner，web） | 持久化平台 | 不采纳 | 记录走 facade 单档 scope durable 设施；替换 storage 行=新开持久化平台，违反 Goal 边界 |
| `session-checkpoint-policy`（无 owner，纯政策行） | 官方内部 durability checkpoint 引用 | 不采纳（C） | 无 ctx 服务/事件面，cap-strategy R2 契约不可证明；官方公开引用 seam 后新增 capture source |

framework 横切语义与 boot 胶水不进任何 slice（`capability-strategy.md` §2/§8）。

## Data Models

### 1. Checkpoint record（durable envelope；append-only）

```js
{
  schema: 'executions.recovery.checkpoints.session' | 'executions.recovery.checkpoints.workspace',
  version: 1, owner, scope: { sessionId } | { workspaceId } | { profileId },   // 契约 §2.5 三档词汇；v1 无 profile 捕获源 ⇒ profile 档 capture typed unavailable、不产生记录（Requirement 1 AC2）
  id: checkpointId,
  data: {
    source: { kind: 'branch' | 'workspace-journal' | 'workspace-snapshot', anchor: {...} },
    capture: { overall: 'captured'|'partial'|'missing'|'unknown'|'unavailable',
               components: [{name, status, detail?}], capturedAt },
    provenance: { correlation: {executionId?, activityId?, attemptId?},
                  reason?, createdAt, autoTrigger?: 'attempt-end'|null },
    restoreability: { summary, perSlice: [...] },
    externalEffects: [{ name, kind: 'rollbackable'|'external'|'unknown', detail? }],
    lineage: { previousCheckpointId?, captureKey? },
  },
}
```

### 2. Restore plan（冻结；planRestore 输出）

```js
{
  checkpointId, generatedAt, epoch, fingerprint,
  slices: [{
    slice: 'session'|'workspace', resourceId,
    steps: [{ stepId, authority: 'sessions.branches.restore'
                     |'workspaces.transactions.*'|'workspaces.snapshot.restore',   // 内部 bound-authority 键，非 pluginApi 公共路径；公共命名集成波定稿
              effect, precondition: { liveAttempt?: {state, attemptId},
                                      claim?: {resource, mode} },
              restoreability: 'restoreable'|'partial'|'unavailable'|'not-applicable',
              compensatable: boolean }],
    overall, reasons: [string],
  }],
  liveState: { evidence: 'observed'|'reconstructed'|'unknown'|'unavailable',
               attemptId?, state?: 'running'|'idle'|'queued' },   // 切片/投影证据
  stopThenRestore: { available: boolean, reason? },
  claims: [{ resource, mode: 'exclusive' }],
  externalEffects: [...],
  overallRestoreability,
}
```

fingerprint 覆盖稳定内容（slices/steps/claims/externalEffects/restoreability），排除 `generatedAt`/`epoch`/`liveState`/`stopThenRestore.available` 等易变或证据派生字段，可确定性重算——支撑 Requirement 5 AC7（同态同 fingerprint）与 Requirement 6 AC2（stale 重验）。

### 3. Restore outcome（判别式 + terminal + partial 领域结果）

```js
{ ok, code, operation, terminal: 五值|null,
  result: { partial, stepsDone, failedStep, perSlice: [...] } | null,
  stoppedAttempt: { attemptId?, terminal? } | null,   // stop-then-restore 记录
  reason?, observedAt }
```

### 4. 词汇纪律

词汇纪律：`checkpointId`/`executionId`/`activityId`/`operationId` 不互换；`terminal`（restore op）/`commitState`（create mutation）/partial（领域结果）/superseded-by-restore（checkpoint 记录级血缘归因——与被 stop attempt 的 loop 侧 terminal 裁定（通常 `aborted`）分层不合并）不互相代替；seq/cursor 只用于分页重放；fencing 只用于并发控制。

## Hook Exposure And Component Ownership

| 钩子/authority | 类别 | 引出方式 | 失败路径与 guard |
|---|---|---|---|
| session 档 capture/restore | A/B | `sessions.branches` 公共面 | branch authority 不可用 ⇒ typed unavailable/stale；只经该 authority |
| workspace journal 档 | A/B | `workspaces.transactions` | 缺能力（headless）⇒ unavailable；只经该 authority |
| workspace snapshot 档 | R（新 owner 包） | slice 内部契约（probe 门） | probe 失败 ⇒ source unavailable + 官方契约行为照常 |
| stop 协调（共享 cancel） | R（共享切片） | request authority 内部 cancel 传播（`by: 'system'`、携带 restore 因；无第二取消路径） | 切片缺位 ⇒ 运行中恢复 denied；bounded wait 超时 fail-closed |
| live-attempt/自动捕获触发 | R（共享切片事实） | `agent/attempt/start|end` 只读订阅 | 切片缺位 ⇒ 降级证据/auto-capture unavailable |
| 排他/fencing | A/B | `coordination.acquire/heartbeat/release` | lease 丢失 ⇒ 停步 fail-closed + terminal 裁决 |
| 前置条件证据（降级） | A/B | `sessions.activity` 投影 | 缺位 ⇒ step blocked（fail-closed 方向） |
| 记录持久化 | B | 单档 scope durable 记录设施（Stage 3 绑定 probe） | backend 缺失 ⇒ create unavailable |
| recovery 消费 | 不消费 | 明确不调用 `executions.recovery.evaluate` | n/a |
| 官方 `session-checkpoint-policy` | 不消费（C） | 无公开面；上游提案 | n/a |

## Error Handling And Lifecycle

- 失败呈现（契约 §6）：P1/P2 统一；P3 逐 source/逐 slice degraded/unavailable（headless、probe 失败、切片缺位）；业务冲突（claim、stale plan、锚点失效、live attempt 无法停止）为 typed result；partial 为领域字段。
- 生命周期：capture/restore authority 随主门面 ctx；restore 的 lease 在终态后显式 release；stop 协调中的 bounded wait 随 operation dispose/AbortSignal 取消；disposer/callback identity-bound；apply 全程 fail-safe。
- 审计：创建/恢复/stop 各步记录 owner/时间/结果码/锚点（无内容、无 secret）；audit 失败 ⇒ gap marker。
- Redaction：记录/投影/plan/restore outcome 各出口 host 侧脱敏；external effects 与 gap 可见有界。

## Testing Strategy

1. Capture（Requirement 1/2/3）：单档 scope、逐组件状态、captureKey 去重/血缘、未登记 source rejected、authority/slice 缺失 unavailable、partial 记录诚实落盘；branch/transaction fixture + workspace snapshot slice fixture。
2. Plan（Requirement 5）：纯性、fingerprint 稳定、precondition 标记（切片 active 的 observed live-attempt vs inactive 的 denial）、stale 检测、restoreability 分类。
3. Restore（Requirement 6/7）：单 authority terminal；**stop-then-restore 时序**（cancel 请求 → attempt terminal wait → 回滚；bounded-wait 超时 fail-closed；无 live attempt 下回滚断言不可能）；fencing 获取/丢失；步骤级 partial；cancel 裁决；迟到/stale 拒绝；无级联；retry/attempt。
4. Slices（Requirement 8/9）：workspace snapshot slice 的官方契约 parity、probe 失败降级、版本错配、boot 自检、owner 冲突、无双跑、移除恢复、headless 缺席；共享切片缺位时 auto-capture unavailable 与 restore 降级断言。
5. 边界（Requirement 10/12）：无 branch/transaction/workspace/coordination 旁路、无 recovery 双消费、无 attempt 挂起、无 durable 重写、append-only、词汇不混用、恢复后血缘标记。
6. 安装与降级（Requirement 11）：逐 source/slice 的 unavailable/availability 断言；两 synthetic 插件反序一致。
7. Registry/shape（Requirement 13）：全部新成员 + `planRestore` verb 例外 + capability 子簇 + 新包/行登记一致。
8. 终验：受护 `npm test`、`git diff --check`、registry/surface 一致性、官方包零修改审计、全局对抗性终审。

## Standards Applicability And Alignment

- `capability-strategy.md`: applicable（两处 R 采纳；probe 门；残余 C 附证据；framework 语义不进本 feature）。
- `api-shape.md`: applicable（projection/mutation/operation 三面独立 owner；plan 纯读；无 policy）。
- `api-idioms.md`: applicable（commitState/handle/terminal/verb 例外/availability 全对齐）。
- `public-api-shape.md`: applicable（挂既有 `executions.recovery`；新 owner 包/行运行时命名中性，集成波定稿）。
- `composition-and-authority.md`: applicable（单一 restore authority；claim/lease/fencing；唯一 cancel 路径；旁路为零）。
- `domain-composition.md`: applicable（branches/transactions/coordination/recovery/workspace 领域最低要求复用不绕过）。
- `ordering.md`: applicable（步骤顺序 = plan 内固定阶段）。
- `identity-and-lifecycle.md`: applicable（身份分工、terminal 唯一、恢复后血缘、裁决优先级）。
- `durable-state-and-scope.md`: applicable（单档 scope、append-only、能力声明、partial 领域字段）。
- `visibility-and-redaction.md`: applicable（逐出口脱敏、gap 可见、secret 不出）。
- `concurrency-and-cancellation.md`: applicable（stop-then-restore 时序、fencing、取消传播、提交资格、attempt 边界）。
- `versioning-and-protocols.md`: applicable（冻结基线；新增 workspace owner 包遵循 `A.B.C` 装配契约，错配只停用该 slice；记录 schema/version）。

## Key Decisions And Tradeoffs

1. **stop-then-restore 取代"一律 denied"（v2）**：运行中 session 可安全回滚；不做 attempt 挂起（suspension）——其正确性边界（恢复悬挂执行的视图一致性）不可证明，宁可 bounded-wait + fail-closed。这是 park 语义的可证明子集。
2. **workspace snapshot slice 采纳但以 probe 为门**：file 级 rescue 是真实能力缺口且唯一可达通道是替换 `dsh-workspace` 行；但该行契约可复刻性尚未证明 ⇒ 文档采纳 R + Stage 3 probe 作为能力门，probe 失败诚实降级，绝不虚报。
3. **共享 loop slice 消费而非第三套 loop 机制**：stop 协调走 request authority 唯一 cancel 路径；attempt 事实只读消费；不新增 checkpoint 专属的 loop 侵入。
4. **auto-capture 默认关、owner-scoped**：能力存在但默认不打扰；配额/策略可观测。
5. **记录 append-only、无 purge、无跨记录级联**：审计优先；跨档原子性以 C 呈现。

## M9 Contract Conformance And Deviation Notes

契约 §1/§2/§3.4/§3.5/§5/§6 采纳。偏离记录（契约 §8）：

1. v1"零 R"废弃，v2 按 R-first 修订（R 决策表见 §6）；`planRestore` verb 例外、host-only、无 purge 保留。
2. park 语义定稿为 stop-then-restore（requirements 偏离注 2）。
3. 共享 loop boundary slice 与 interaction/activity 联合登记（requirements 偏离注 3）；workspace snapshot slice 为新建 owner 包（行/包名集成波定稿）。
4. 契约 §7.1 共享文件边界：本线在并行期只写 `docs/specs/checkpoint-restore-contract/**`；`packages/agent-loop` 共享切片只读消费（编辑权归 `session-interaction-operation` 线（agent-loop owner 包））；新建 workspace owner 包目录归本线（该官方组件 owner 属 checkpoint 线），集成波统一注册与装配。

## Design Completion Condition

本设计覆盖 v2 requirements（Requirement 1–13）：三面数据模型与词汇纪律；source 表含 workspace-snapshot（probe 门）；stop-then-restore 时序与 bounded-wait；auto-capture 策略；R 决策表与残余 C 证据；registry/包/行拟新增清单；失败/guard 策略逐钩子声明。用户确认前的修订就地更新本文与 requirements 对应条目。
