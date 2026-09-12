# Stage 2 Design: compaction-operation

> feature_name: `compaction-operation`
> milestone: M10
> status: Stage 2 Design 交付（2026-09-12，与 Requirements 同批交付）
> 上游：[goal.md](./goal.md)、[requirements.md](./requirements.md)；M7 deletion report B4-7；`docs/standards/capability-strategy.md`（R1–R8、§5 装配表、§10 六问）；`packages/compaction-events` 现行实现。

## 1. Overview

本 design 把 goal 留下的全部待定项落定：官方三方法的触发语义取舍（只承载「立即 / 区域」两种公共语义，自动「按需」不外露）、公共 operation 面在 compaction-events replacement owner 内的扩展点位与门控/降级、与 `compaction/request` 决策面的关系（策略 registry 是决策参与者不是触发器）、与既有 request/provenance 词汇的衔接、取消与并发策略、装配顺序。R 类扩展只作设计陈述，登记动作留给执行阶段。

一句话架构：**门面在 `sessions` 领域内新增 `sessions.compaction` 受控子面（marker/版本门控投影），经替代行 provider 上的新增 operation 子面触发既有 forked 引擎，引擎继续独自完成决策 waterfall、durable 事务与事实派发；门面把引擎结果一对一映射为统一 operation 终态，失败/缺位一律 typed 降级。**

## 2. Architecture

```mermaid
flowchart TB
    subgraph 主包门面
        OP["sessions.compaction.run(options)\n（operation idiom）"]
        AV["sessions.compaction.availability()"]
        GATE["门控解析器\n①辅助包版本匹配 ②替代行 active 且官方行 disabled/absent\n③provider 带 compaction 契约 symbol ④provider 带 operation 子面 marker"]
        ERR["typed disabled：\nPluginApiFeatureDisabledError + availability 'unavailable'"]
    end
    subgraph 替代行 plugin-api-compaction-events（组件唯一 owner）
        SUB["provider.operation 子面（R 类扩展，新增）\nrun(spec) → 判别式 outcome"]
        ENGINE["forked BasicCompactionEngine（既有）"]
        WF["compaction/request waterfall（既有决策面）"]
        FACTS["compaction/started · completed · failed · skipped\n（既有事实面，producer authority 不变）"]
        TX["session durable 事务\ncompaction/start → summary → user/message(replace) → compaction/end"]
    end
    POLICY["第三方策略\n（events.on('compaction/request')，既有）"]
    OBS["观察者插件\n（pluginApi.events，既有）"]
    SESSION["session durable 事件面\n（既有 sessions 直通，lineage 可查）"]

    OP --> GATE
    GATE -- "全部通过" --> SUB
    GATE -- "任一失败" --> ERR
    SUB -- "mode now → compactNow / mode range → compactRegion" --> ENGINE
    ENGINE --> WF
    WF <-- "proceed / reject(reason) / replace-range" --> POLICY
    ENGINE --> TX
    ENGINE --> FACTS
    FACTS --> OBS
    TX --> SESSION
    SUB -- "判别式 outcome" --> OP
```

数据流单向：调用方 → operation 入口 → 引擎事务（可能经策略改写）→ durable 事实 → 投影观察。门面不旁路、不缓存、不二次派发。

## 3. Components and Interfaces

### 3.1 公共面放置：`sessions.compaction`（主包）

- **放置依据**：压缩是对 session surface 的 durable 改写，最近既有领域是 `sessions`；与 `sessions.branches`、`sessions.channels` 同构的二级 namespace（`public-api-shape.md` §1「挂到最近既有领域」）。不新增顶层 namespace：本面只有一个 operation 成员加 availability，不构成独立一等领域。
- 成员（两个）：
  - `run(options): Promise<CompactionOperationResult>` — operation idiom 唯一入口，领域动词 `run`（`compaction` 已是 namespace 名，避免 `compact` 叠字；`request` 一词保留给既有决策事件，不用作触发入口名）。
  - `availability(): { status: 'active'|'degraded'|'unavailable', reason? }` — selfDescription，永不抛错。
- capability path：`sessions.compaction`。执行阶段登记进 canonical registry（本阶段不改 registry）。

### 3.2 门控条件与降级（主包，复用既有投影模式）

门控解析器完全镜像 `sessions.branches` 挂载与 compaction 事件 catalog slice 的既有模式（marker + 行状态 + 全量版本契约），增加第 ④ 条：

1. 辅助包 manifest 版本与主包契约匹配（`parseFacadeVersion` + `dsh.api`）；
2. loader 中替代行 `plugin-api-compaction-events` active，且官方行 `compaction-basic` disabled/absent；
3. `ctx.get('compaction')` 携带共享契约 symbol（`Symbol.for('dsh-plugin-api.compaction-events.contract')`，主包不 import 辅助包）；
4. provider 携带 operation 子面 marker（新增的共享 `Symbol.for(...)` 字面量，见 §3.4）。

降级路径：

- 任一条件不满足 → namespace 仍在、`availability()` 报 `unavailable`（附 reason）、`run()` 调用抛标准 typed `PluginApiFeatureDisabledError('sessions.compaction', …)`；版本错配只 warn 一次（沿用既有 report-once 模式）。
- 无关面不受连带：`sessions` 其他成员、既有 compaction 事件 catalog gating、替代行自身的官方等价 fallback 契约均不变。
- 挂载本身 fail-safe：解析/挂载异常只停用本面并记一条 bounded diagnostic，绝不抛穿 apply。

### 3.3 触发语义取舍（goal 待定项 ①）

官方冻结 runtime 保留三方法：`compactIfNeeded(agent, trigger, signal)`（trigger 仅 `pressure`/`context-overflow`）、`compactNow(agent, signal, sourceCommandId?)`、`compactRegion(start, end, agent, signal?)`。取舍结论：

| 官方语义 | 公共承载 | 理由 |
|---|---|---|
| `compactNow`（manual，idle-session bracket） | **承载**，`mode: 'now'` | 「立即」语义即用户/插件明确要求压缩：独立 marker pair、selected-span 稳定性、durability checkpoint flush、无需 open turn；自带"无安全有用范围 → null"的 skipped 路径。真实消费者 TUI `/compact` 的目标语义就是它（样本经历史服务名调 `compactIfNeeded`，迁移时验证服务名并改接本面 `mode:'now'`） |
| `compactRegion`（direct，current-turn bracket） | **承载**，`mode: 'range'` | 「区域」语义：插件给出显式 surface seq 范围（经既有 `sessions.surface`/`sessions.seq` 获得）；它是策略性/展示性压缩的高级入口 |
| `compactIfNeeded`（pressure / context-overflow） | **不承载** | 其引擎路径与自动 trigger 词汇绑定：`compactIfNeeded` 的 switch 只接受 `pressure`/`context-overflow`，事件 provenance 将携带自动 trigger 词，插件主动发起会被记成"自动压力压缩"，直接违反 R6（provenance 可辨、不伪造）。自动按需语义保留在引擎内部（pre-step / request-error 钩子），不设公共触发口。若未来确需"检查式"公共语义，须先解决 provenance 词汇再另立设计 |

不照搬的 raw 语义：`compactIfNeeded` 的重试环（`compactionRetries`，属自动压力路径内部）、tool-result pruner 联动（引擎内部）、`ManualCompactionError` 的抛出形态（转译为判别式结果，见 §3.5）。

### 3.4 R 类扩展点位：provider 上的 operation 子面（替代行内，goal 待定项 ②）

**扩展点位**：`@deepseek-ai/dsh-plugin-api-compaction-events` 的替代行 provider（forked engine 实例）上**新增**一个 operation 子面；不新增 patch 行、不改 `cordis.patch.yml`、不新增第二个 replacement owner：

```text
provider.operation = {
  [OPERATION_SUBFACE_SYMBOL]: true,   // Symbol.for 共享字面量，主包以此探测（同既有契约 symbol 模式）
  run(spec): Promise<CompactionOperationOutcome>
}
```

- `spec`：`{ agent, mode: 'now' | 'range', range?: { start, end }, signal?, sourceCommandId? }`。
- `CompactionOperationOutcome`（判别式联合，替代行内部可精确分类官方错误，主包只做 1:1 映射）：
  - `{ kind: 'compacted', result: CompactionResult }`（引擎成功事务结果，含 lineage）
  - `{ kind: 'skipped', reason: 'no-candidate' }`（选择器返回 null：无安全有用范围）
  - `{ kind: 'rejected', reason?: string }`（`compaction/request` 否决；引擎已发 `compaction/skipped`，reason 取决策 reason，缺省 'rejected'）
  - `{ kind: 'aborted' }`（ManualCompactionError 'cancelled' / caller-signal AbortError）
  - `{ kind: 'failed', code, stage? }`（其余官方错误分类，见 §3.5 映射表）
- 子面内部路由：`mode 'now'` → `compactNow(agent, signal, sourceCommandId)`；`mode 'range'` → `compactRegion(start, end, agent, signal)`。子面**只翻译结果，不改写触发行为**：range 选择、重试、锁、flush 全部留在引擎。
- 子面随 provider 一起参与既有 apply 自检（R4：post-register verification 增加 marker 检查）；版本错配时子面不发布（R5）；`ctx.compaction` 被其他 provider 占有时整体 inert（R6）。
- **登记义务（不在本阶段执行）**：落实时同步 `AGENTS.md` §2/§4、feature-list、capability-strategy §5 装配表（本行 client 半面仍为「无」），并登记覆盖该能力的 upstream proposal 与退役条件（官方提供等价公开触发 seam 时，本 operation 面退役为官方直通）。

### 3.5 结果映射与码表（goal 待定项：结果码集合）

公共结果 `CompactionOperationResult`（冻结）：

```text
{
  ok: boolean,                 // compacted / skipped → true；denied / error / aborted → false
  code: string,                // 稳定机器码，见下表
  terminal: 'success' | 'error' | 'aborted' | 'denied',   // 统一终态词汇；本域不产生 superseded
  outcome?: 'compacted' | 'skipped',                      // terminal==='success' 时区分两种非负终态
  reason?: string,             // denied 携带策略 reason；skipped 携带机器 reason 的人类可读补充
  stage?: 'summary' | 'commit',                           // error 时（沿用既有事实事件的 stage 词汇）
  lineage?: {                  // 仅 outcome==='compacted'；冻结，逐字段来自引擎 CompactionResult
    compactionId, shadowedRange: {start,end}, shadowedSeqs, shadowedTokenCount,
    startSeq, summarySeq, endSeq, sourceCommandId?
  },
}
```

| 子面 outcome / 官方错误 | code | terminal / outcome |
|---|---|---|
| compacted | `compacted` | success / compacted（含 lineage） |
| skipped | `no-candidate` | success / skipped |
| rejected(reason?) | `rejected`（+ reason） | denied |
| aborted | `aborted` | aborted |
| ManualCompactionError 'busy' / durable 锁占用 | `busy` | error |
| range 模式无 open turn | `open-turn-required` | error |
| range 非法（缺失/逆序/不平衡边界） | `invalid-range` | error |
| SurfaceChangedError（选中 span 期间被改写） | `surface-changed` | error |
| summary 阶段失败（含 summarizer 无可用 provider/model） | `summary-failed`（stage 'summary'） | error |
| commit 阶段失败 | `commit-failed`（stage 'commit'） | error |
| durability checkpoint（flush）失败 | `persistence-failed`（stage 'commit'） | error |
| 目标 agent 引用不能解析到 live agent | `invalid-target`（引擎调用前拒绝） | error |
| 参数形状非法（mode/range/sourceCommandId 类型） | `invalid-arguments`（引擎调用前拒绝） | error |

说明：`aborted-after-commit` 边沿如实保留官方语义——事务可能已提交（事实已发 completed），operation 终态为 aborted；门面不改写、不再造"成功"。取消不是本域的 retry 输入（durable-state §4：aborted 禁止自动 retry）；本 feature 不做任何自动 retry（fail-closed，未声明即不 retry）。

### 3.6 与 `compaction/request` 决策面的关系（goal 待定项 ③）

- **决策面零改动**：策略仍经 `events.on('compaction/request', …)`（既有 catalog waterfall 条目，priority + 成功注册顺序 + listener containment + malformed→proceed 语义不变）。本 feature 不新增决策注册入口，也不把该 registry 当触发器（R3、goal Boundary）。
- **相遇点唯一**：引擎在 durable marker 之前派发 waterfall；operation 触发的压缩与自动压缩走同一决策点，因此策略对两类来源一视同仁（R3 第一条）。
- **结果回流**：reject → 子面 `rejected(reason)` → 公共 denied；replace-range → 引擎既有 revalidation（失败回落原 range）→ 公共结果反映实际压缩范围。门面不解释、不缓存决策。

### 3.7 与既有 request/provenance 词汇的衔接（goal 待定项 ⑤）

- 触发词汇沿用四值 canon（`pressure` / `context-overflow` / `manual` / `direct`）：operation 两模式分别落到 `manual` / `direct`；自动路径保持 `pressure` / `context-overflow`。词汇本身不增不减。
- `sourceCommandId` 从 operation options 原样透传进请求 payload、started/completed 事件与 lineage（展示关联），门面不生成、不改写。
- payload freeze 策略沿用既有 `freezeCompactionPayload`（range/result 深冻结，agent/session 保持 live 引用）。

### 3.8 取消与并发（goal 待定项 ⑥）

- **取消传播**：调用方 `AbortSignal` 原样传入子面 → 引擎（summarizer signal 与 bracket 检查点）。门面不组合本地 signal、不替换上游 signal（concurrency §3）。invoke 前已 aborted → 直接 `aborted`，不发引擎调用。
- **并发策略声明（concurrency §6）**：`exclusive`——同一 session 的压缩互斥由引擎的 durable compaction lock（unmatched start marker）承载，这是唯一并发 authority；门面不建第二把锁/队列/去重。冲突呈现：后来者得确定 `busy`（manual 锁/idle bracket）或 `open-turn-required`（range 无 open turn）；不排队、不抢占、不静默合并。两个并发 `run` 各自获得自己的判别式终态（一个执行、一个 busy），事实只由执行者路径生产一次。
- **与活跃 attempt（agent turn）的关系**：`mode 'now'` 要求 idle agent（官方 runMaintenance bracket；非 idle → `busy`，不强制取消活跃 turn）；`mode 'range'` 要求 open turn（current-turn bracket + whole-surface 稳定性）；二者互斥覆盖，不存在"半 turn"状态。
- **提交资格**：全部由引擎事务承担（marker pair 原子性、single end attempt）；门面无迟到回调写入面（门面在引擎 resolve 后才产出结果，无第二异步写点）。

### 3.9 装配顺序

- **行级**：本扩展不新增 patch 行——`cordis.patch.yml` 保持"禁用官方 `compaction-basic` 行 + 插入 `plugin-api-compaction-events` 替代行"现状；full 聚合 bundle 按其确定性顺序装配主包行与该替代行，选择性安装为 main + compaction-events，两者装配出同一 provider 与同一 operation 子面（装配等价性由既有 full patch 保证，本扩展零改动）。
- **主包↔替代行解析顺序无关**：operation 面采用懒解析（每次调用经门控解析器重新探测 provider 与 marker，同 `sessions.branches` 模式），不依赖主包行先于或后于替代行加载；任一行缺失时 typed 降级。
- **冲突与双跑**：`ctx.compaction` 已被其他 provider 占有时替代行整体 inert（既有冲突检测），operation 面随之 unavailable；官方行未禁用（替代行让位官方 provider）时 operation 子面 marker 不存在，门面同样降级——不出现"官方行未禁用而替代行双跑"或"门面绕过 marker 直调官方 provider"的路径。
- **boot 自检**：替代行 apply 既有自检矩阵扩展 marker 断言（R4）；自检失败 = 子面不发布 + fail-safe，主包门控自然报 unavailable。

### 3.10 绑定引出机制汇总

| 绑定 | 引出机制 | 分类 | 失败路径 / guard |
|---|---|---|---|
| `sessions.compaction.run` | 受控包装替代行 provider 的 operation 子面（底层服务 seam，非官方 dispatch 点） | B 类（+R 类子面） | 门控失败 typed disabled；子面异常按 §3.5 分类，未分类错误归一为 `failed`（code 'internal'）并 contain，绝不抛穿门面挂载 |
| `compaction/*` 事实事件 | 替代引擎直接派发，经既有动态 catalog slice 订阅（已交付） | A 类 | 既有 containment（observer 失败不影响事务）；本 feature 零改动 |
| `compaction/request` 决策 | 替代引擎 waterfall 派发（已交付） | A 类 | 既有 listener containment + malformed→proceed；本 feature 零改动 |
| lineage 可查 | 既有 `sessions` durable 事件面（compaction/start·summary·end + replacement user message） | A 类 | 引擎事务自身原子性（single end attempt）；门面不新增读路径 |
| `availability()` | 门控解析器的纯探测（只读 loader/manifest/symbol） | B 类 | 永不抛错，异常按 unavailable 收敛 |

## 4. Data Models

- **入参** `CompactionRunOptions`：`{ agent, mode: 'now'|'range', range?: {start,end}, signal?: AbortSignal, sourceCommandId?: string }`；`agent` 必须是门面 agents 面发出的 live agent 引用（与其它 agent-scoped 公共面同一引用类型）；`range.start/end` 为包含式 surface seq（`mode 'range'` 必填）。
- **出参** `CompactionOperationResult`：见 §3.5，整体冻结；lineage 字段与引擎 `CompactionResult` 一一对应，不改名、不删字段。
- **子面 outcome**：见 §3.4（替代行内部契约；主包仅经 symbol 探测，不 import）。
- 不新增 durable record、不新增 wire 协议；lineage 的持久形态就是既有 session 事件。

## 5. Error Handling

1. **门控降级**（§3.2）：typed disabled，`availability()` 诚实报告；版本错配 warn 一次。
2. **业务拒绝 vs 公共契约破坏**：业务失败全部走判别式结果（§3.5 码表），不抛穿；只有门面自身契约破坏（如 options 非对象）抛 typed error。
3. **containment**：子面/引擎异常不改变其他 owner 的注册状态，不影响无关 `sessions` 成员；挂载 fail-safe。
4. **脱敏**：error 结果只携带 code/stage/reason，不携带 summary 内容、消息文本或堆栈（与既有 `compaction/failed` redacted failure 同一边界）；lineage 只含位置/计数元数据。

## 6. Testing Strategy

- **门控矩阵**：替代行 active+匹配 → active；行缺失/未禁用官方行/版本错配/缺 operation marker → typed disabled 且 availability unavailable；错配只 warn 一次；无关成员不受影响。
- **真实链**：`mode 'now'`/`mode 'range'` 经 marker provider 触达 forked 引擎，session durable 记录真实落盘（start/summary/user message/end），lineage 与 compactionId 可经既有 session 事件面回查；门面零 `compaction/*` emit（事实只来自引擎）。
- **决策衔接**：策略 reject → denied + 引擎 skipped 事实恰好一条 + 无事务；replace-range → 实际压缩替换后范围；malformed 决策 → proceed（既有语义）。
- **取消/并发**：invoke 前 abort → aborted；summarization 中 abort → aborted + 事务闭合 + failed 事实恰好一条；活跃压缩时第二调用 → busy；非 idle agent `now` → busy；无 open turn `range` → open-turn-required；双 owner 并发互不串。
- **provenance**：operation 触发的事实携带 manual/direct；引擎内部自动路径仍携带 pressure/context-overflow；sourceCommandId 透传。
- **R1–R8 回归**：子面 additive（既有服务/事件面逐成员不变）、import 面不受影响、冲突 inert、boot 自检含 marker。
- 载体：`node --test` 经 `npm test`（4G 护栏）；引擎层用 seam/fake summarizer fixture，不依赖真实模型调用。

## 7. Standards 逐分册适用性结论

| 分册 | 结论 |
|---|---|
| capability-strategy | **适用**。B 类主面 + R 类扩展判定；R1–R8 逐条对照（requirements §5）；组件唯一 owner 不变；§10 六问 host-only；§7 retirement：官方提供等价公开触发 seam 时本面退役 |
| api-shape | **适用**。一面原则：主面 operation；决策（policy registry）与触发（operation）分离；引擎是唯一 mutation owner，门面不新增 mutation 面；投影只读（lineage 查询走既有面） |
| api-idioms | **适用**。operation 外层合同 `{ok, code, terminal, …}`；统一终态词汇（本域无 superseded，`outcome` 承载 compacted/skipped 区分）；`availability()` 必备；id（compactionId）是引擎铸造的资源身份，门面不造第二套 |
| public-api-shape | **适用**。挂最近领域 `sessions`（二级 namespace `sessions.compaction`），不新增顶层 namespace；无治理代号进入公开 path；capability path `sessions.compaction`；registry 同步在执行阶段 |
| composition-and-authority | **适用**。composition mode `coordinated`（互斥压缩由引擎 durable lock 仲裁）；owner 从调用方 fiber 派生；authority closure：session 压缩写路径只有引擎一条，门面子面不新增写 authority |
| domain-composition | **适用**。`sessions` 领域约束：不静默破坏 branch/事务保证——压缩是引擎的原子 durable 事务；不新增跨域状态机；不新增与压缩无关的 session 操作 |
| ordering | **部分适用**。operation 本身无多插件排序语义；`compaction/request` waterfall 的 priority/注册顺序沿用既有决策契约（ordering §2 领域策略），本 feature 不新增排序规则 |
| identity-and-lifecycle | **适用**。compactionId 为资源身份（引擎铸造）；operation 终态唯一且 final；无 attempt 层级（单事务，无内部 retry） |
| durable-state-and-scope | **适用**。压缩记录属 session 档 durable 事实（引擎写入，本 feature 不新建 scope 档、不新建 durable record）；operation 能力声明：不自动 retry、fail-closed；外部重发=新 operation |
| visibility-and-redaction | **适用**。失败事实沿既有 redacted failure 边界（stage/name/code），结果不携带 summary 正文/堆栈；host-only 无 client 半身受众问题 |
| concurrency-and-cancellation | **适用**。取消是信号、终态由引擎裁决（含 aborted-after-commit 边沿如实保留）；signal 原样传播；并发策略 `exclusive`（引擎锁）+ busy 确定结果；无自动 retry |
| versioning-and-protocols | **适用**。版本冻结（不步进 A/B.C/D）；门控沿用 `<A>-<B>.<C>` 契约匹配；无新 wire/durable 合同（full 与选择性装配等价性由既有装配表保证，本扩展不改 patch） |

## 8. 两线一致性声明

本 feature 与 `workflow-execution-contract` 无共享 owner（本线 R 扩展 owner 为 compaction-events 替代行；workflow 线为门面主包 owner）、无共享 namespace（`sessions.compaction` vs `workflows`）、无共享状态。两线仅在 operation idiom 的**标准外层合同**（`{ok, code, terminal}`、统一终态词汇、availability）上遵循同一份 `api-idioms.md`，不共享领域词汇（compacted/skipped/rejected ≠ started/settled）。
