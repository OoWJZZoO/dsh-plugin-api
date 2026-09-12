# Stage 2 Design: workflow-execution-contract

> feature_name: `workflow-execution-contract`
> milestone: M10
> status: Stage 2 Design 交付（2026-09-12，与 Requirements 同批交付）
> 上游：[goal.md](./goal.md)、[requirements.md](./requirements.md)；M7 deletion report B4-8；`docs/standards/capability-strategy.md`（§2 通道分类、§10 六问）；官方 `dsh-workflow`（types + WorkflowEngine base）与 `dsh-workflow-worker-thread`（WorkerThreadWorkflowEngine）。

## 1. Overview

本 design 落实 goal 留下的全部待定项：`workflowEngine` seam 受控包装（方案一，无 R 点位）、顶层 namespace 放置（`workflows`）、run handle 形状（官方 WorkflowRunId + 门面 holder 语义）、parent/scope 检查机制、与 tasks/executions 既有面的关联契约（不在 `task.start` 藏第二执行器）。

一句话架构：**门面新增顶层 host namespace `workflows`，其唯一 operation 成员 `start(request)` 从调用方 fiber 派生 owner、把 parent 引用经官方 agent registry 校验为 live Agent、把请求原样转交官方 `workflowEngine.start`，并把返回的 holder-owned live run 包装为门面 run handle（官方 id、判别式唯一终态、幂等 dispose、run-scoped 观察订阅）；进度观测继续走既有 `workflow/*` 事实事件；缺位/失配一律 typed 降级。**

## 2. Architecture

```mermaid
flowchart TB
    subgraph 官方组件（既有，零改动）
        ENGINE["workflowEngine（dsh-workflow-worker-thread）\nstart(request): WorkflowRun\nmeta/body 校验 · provider/上限解析 · UUID run id"]
        EVENTS["workflow/start · phase · log ·\nagent-start · agent-end · end\n（引擎派发，经门面事件总线）"]
        WORKER["worker 线程 + 子 agent\n（parent 归因由引擎承担）"]
    end
    subgraph 主包门面（本 feature）
        NS["pluginApi.workflows\nstart(request) · availability()"]
        OWNER["owner 派生（caller fiber）"]
        PARCHK["parent 校验：\nagents surface 引用 → 官方 registry 解析 → live Agent 身份一致"]
        HANDLE["门面 run handle\n{id, ownerId, meta, status(), observe(), result, cancel(reason?), dispose()}"]
        MAP["终态映射：completed→success · cancelled→aborted · error→error\n（result never rejects 如实映射）"]
    end
    subgraph 既有关联面（只消费，零改动）
        TASKS["tasks 面：attach/start 的 workflow source 引用\n（证据确认，非执行器）"]
        EXEC["executions / subagent 投影\n（子 agent 观测既有承载）"]
    end
    PLUGIN["第三方插件（holder）"]

    PLUGIN --> NS
    NS --> OWNER --> PARCHK
    PARCHK -- "校验通过，plain data 原样转发" --> ENGINE
    PARCHK -- "parent 无法解析/伪造引用" --> NORUN["determinate no-run 结果（无 id）"]
    ENGINE --> WORKER
    ENGINE -- "WorkflowRun（holder-owned）" --> HANDLE
    HANDLE --> MAP --> PLUGIN
    ENGINE --> EVENTS
    EVENTS -- "run-scoped observe 过滤（handle 内）" --> HANDLE
    EVENTS --> EXEC
    HANDLE -- "handle.id 作为 workflowId 证据引用" --> TASKS
    ENGINE -- "absent/unusable" --> DEG["namespace 在 + availability 'unavailable'\n+ typed feature-disabled"]
```

数据流单向：插件 → operation → 引擎 → 事件/终态。门面不缓存 run、不建第二投影 owner、不代答终态。

## 3. Components and Interfaces

### 3.1 Namespace 放置：顶层 `workflows`（主包）

- **一等领域论证**（`public-api-shape.md` §1）：workflow run 拥有独立资源身份（官方 `WorkflowRunId`）、独立词汇（meta 身份块、phases、agentsStarted、stopReason）与独立使用场景（编排执行），与 `tasks`（业务任务关系）、`executions`（执行观测/recovery）、`sessions`（对话内容）互不重叠；事件族 `workflow/*` 已独立成 vocabulary。故新增顶层 host namespace `workflows`。
- 成员（两个）：
  - `start(request): WorkflowStartOutcome` — operation idiom 入口，**同步**判别式结果（与官方 seam 一致：`start` 同步返回 run、cannot-begin 同步拒绝；形状见 §3.3/§4）。
  - `availability(): { status: 'active'|'degraded'|'unavailable', reason? }` — selfDescription；探测 `ctx.get('workflowEngine')` 是否为可用引擎 provider（`typeof start === 'function'` 且非 thenable），按实际 seam 状态报告，不用对象存在性冒充（R9）。
- capability path：`workflows`。执行阶段同步义务：canonical registry（成员与 capability 登记）、`public-api-shape.md` §2 host 领域树（新增 `workflows`）、`domain-composition.md` §2 新增 `workflows` 领域行、feature-list §7 交付登记（本阶段不改任何登记文件）。

### 3.2 workflowEngine seam 受控包装（goal 待定项 ①）

- 主包**不新增** `services.*` passthrough、不 import 官方 workflow 包模块；经 `ctx.get('workflowEngine')` 消费服务（官方服务消费，符合 §2 第 3 条硬约束）。
- 包装内容（门面语义叠加，全部在方案一范围内）：
  1. **owner 派生**：调用方 Cordis fiber / 插件身份（既有 caller-owner 派生机制）→ `ownerId`；不接受调用方自报 owner。
  2. **parent 校验**（见 §3.5）。
  3. **请求透传**：`script` / `meta` / `args` / `subagentProvider` / `maxTotalAgents` / `signal` 为 plain data 原样转发；门面不解释 script 内容、不改写 meta、不组合/替换 signal（concurrency §3：不得用脱离调用者的本地 signal 替换上游 signal）。
  4. **handle 包装**（§3.4）。
  5. **不可用降级**：engine absent/unusable → `availability()` unavailable + `start` 抛标准 typed feature-disabled error（与 `sessions.branches` 同型）；无关能力不受连带。
- 门面**不做**的：不重试、不排队、不缓存 result、不代理 cancel 语义判断、不为 run 建全局注册表（holder-owned 语义下 handle 即所有权凭证；全局登记属于无消费者支撑的加固，违反克制设计）。

### 3.3 start 结果与 run handle 形状（goal 待定项：handle 形状）

`start` 返回**同步**判别式结果（operation idiom 外层合同；`terminal` 成员的偏差登记见本节末）：

```text
// ok:true —— 已创建 run
{ ok: true, code: 'started', handle: WorkflowRunHandle }
// ok:false —— 引擎拒绝无法开始的请求（官方同步 WorkflowError 分类，code 原样保留）
{ ok: false, code: 'META_INVALID' | 'SCRIPT_PARSE' | 'INVALID_ARGUMENT' | 'AGENT_START', reason }
// ok:false —— 门面侧拒绝（引擎调用前）
{ ok: false, code: 'parent-unresolved' | 'invalid-request', reason }
```

- 官方 `WorkflowError` 的 machine-routable code **原样保留（开映射）**：上块四值闭集是当前默认引擎（`dsh-workflow-worker-thread`）`start()` 的同步抛错集；seam 契约并不限定同步码集（官方 `WorkflowErrorCode` 共 11 值），任何引擎实现同步抛出的官方 `WorkflowError.code` 一律原样透传进 `code`，门面不改名转译；门面自有拒绝才用门面码，且集中于 `parent-unresolved` / `invalid-request` 两类。
- no-run 结果不铸造 run identity、不产生任何 `workflow/*` 事件（官方 `start` 在发布前同步抛错，事件本就未发）。

`WorkflowRunHandle`（holder-owned；idiom 固定成员 + 有理由的领域附加成员）：

```text
{
  id,            // 官方 WorkflowRunId（原样；门面不造第二套身份）
  ownerId,       // caller-fiber 派生（审计归因词汇）
  meta,          // 引擎验证后的 meta 块（冻结；script body 运行前即可用——官方契约）
  status(),      // 纯派生视图：{ state: 'running' | 'settled', stopReason?, error?, agentsStarted? }（冻结）
  observe(listener),  // run-scoped 观察：按 info.id 过滤既有 workflow/* 事件 feed；返回 disposer；listener 失败按总线 containment；dispose 只结束本订阅
  result,        // Promise（getter）→ 判别式终态（见 §3.6）；never rejects（如实映射官方契约）；恰好 resolve 一次
  cancel(reason?),    // 原样委托官方 run.cancel；settle 后为官方 no-op
  dispose(),     // 幂等；委托官方 dispose（需要则 cancel + bounded 等待脚本与子 agent 静默）
}
```

- idiom 对齐说明：`operation` 长操作 handle 固定集为 `{id, ownerId, status(), observe(), dispose()}`；本 handle 附加 `meta` / `result` / `cancel(reason?)` 三个领域成员，理由：官方 holder-owned 契约的如实映射（identity 与 terminal 不可转译、cancel 是 seam 的第一类动作），registry 登记时按 idiom 例外六元组记录。
- start 结果本身的偏差（登记义务）：外层合同的 `terminal` 成员不在 start 判别式结果上——cannot-begin / no-run 拒绝没有可携带终态的 operation 实例（不铸造 run/operation 身份），真正的 operation 终态由 holder-owned run 经 `handle.result` 恰好一次交付；该偏离按 api-idioms §1 例外六元组单独登记（memberPath `workflows.start`），handle 三个附加成员（`meta` / `result` / `cancel`）各自按 handle 实际 dot path 单列六元组，不与本条合并登记。
- `observe()` 是对既有事件 feed 的过滤订阅（projection），不建第二状态机；`status()` 由 result settlement 派生。二者均无写权。

### 3.4 parent/scope 检查机制（goal 待定项 ④）

- **parent 的公共表达**：必须是由门面 agents 面发出的 live agent 引用（`agents.get` / `agents.create` / `agents.resume` 的产物——与其它 agent-scoped 公共面同一引用类型）。不接受裸 id 字符串、不接受调用方自造对象（防止伪造 parent；对抗性同进程伪造本就在保证范围外，此处挡的是善意插件拿错/拿旧引用）。
- **校验机制**（引擎调用前，副作用前检查）：`ctx.get('agents')` 的官方 registry 以引用的 agent id 解析 live Agent，并做**身份一致性比对**（registry 返回的 live Agent 与传入引用同一）；解析失败或不一致 → `start` 返回 `{ ok:false, code:'parent-unresolved' }`，无 engine 调用、无 id。
- **落地**：校验通过后传给引擎的是该 verified live Agent 本体；子 agent 归因（`agent()` 调用 → parent）全部由引擎完成，门面不参与、不改写（R1/R7）。
- scope 判定：parent 引用来自官方 registry 即视为合法目标（官方 run 语义即"以该 agent 名义执行"）；门面不引入额外所有权矩阵（组合标准 §9：门面只约束 owner 边界，不建安全权限系统）。

### 3.5 与 tasks / executions 既有面的关联契约（goal 待定项 ⑤）

- **tasks**：既有 `tasks.attach(taskId, { workflowId, … })` / `tasks.start(taskId, { workflowId, … })` 的 workflow source adapter 消费 `workflowEngine` 存在性与 `workflow/*` 事件证据；本 feature 的 run handle 暴露官方 `id`，插件把它作为 `workflowId` 传入即得真实证据确认（`createWorkflowSourceAdapter` 的 confirm/link/evidence 链）。**本 feature 不修改 tasks 面任何成员**；task identity 与 run identity 不互换（R8）；`task.start` 维持"关系/观测"语义，不成为第二执行器。
- **executions / subagent 投影**：run 的子 agent 经官方 subagent seam 启动，既有 `subagent/*` / `executions` 观测自动覆盖；本 feature 零改动、不建第二观测 owner。
- **事件**：`workflow/*` 六事件沿用既有 base catalog 条目（payload/freeze/containment 不变）；门面事件总线是官方派发的既有承载，本 feature 不新增事件。

### 3.6 终态映射（goal 待定项：唯一终态）

官方 `WorkflowResult`（never rejects）→ 门面判别式终态（冻结，resolve 恰好一次）：

| 官方 stopReason | 门面 terminal | ok | 携带 |
|---|---|---|---|
| `completed` | `success` | true | `value`（脚本返回值的宿主 JSON 数据；脚本无返回值时如实携带官方 no-value 表示）+ `agentsStarted` |
| `cancelled` | `aborted` | false | `error`（官方结算消息，如实保留）+ `agentsStarted` |
| `error` | `error` | false | `error`（官方失败消息）+ `agentsStarted` |

- `denied` / `superseded` 在本域不产生：没有策略否决点、没有 generation 取代语义；不预造。
- 终态唯一且 final：官方 result promise 本就 resolve 一次；门面包装不再引入第二裁决点；settle 后 `cancel` 为 no-op，`status()` 反映已结算状态（R4/R5）。
- `workflow/end` 事件（不含 value）与 handle `result`（含 value）分工保持官方设计：事件观察者拿不到调用方返回值的可变别名；需要 value 的持有者 await `handle.result`。

### 3.7 R 点位判定（goal 待定项；Goal 阶段不预批）

**判定：不需要 R 点位。** 依据（capability-strategy §2 归属/通道两问）：

- 归属：官方 `workflowEngine` seam 已提供启动、身份、校验、事件、never-rejects 终态、cancel、bounded dispose 的全部组件能力；缺失的只是"受支持的门面公共入口 + owner/终态/检查门面语义"，这正是方案一门面转译的定义域。
- 通道：B4-8 义务原文要求"可追溯、可记录封装的 B 类接口并拓展能力"——封装（owner 归因、判别式终态、availability、隔离守卫）与拓展（生命周期/审计/取消/关联）全部落在门面层即可兑现，无需禁用/替代任何官方行；R2 的"完整契约复刻"成本与风险在此为纯负担（组件唯一 owner、boot 自检、版本锁均为零增益）。
- 退役触发（admission rationale）：官方未来若提供等价受支持公开 seam，门面包装面退役为官方直通；该义务在执行阶段随 registry 登记记录。
- 若后续「拓展能力」需求超出生命周期/审计/取消/关联（例如新编排原语），那属于新的能力立项，须重新走规格流程并届时重评 R 点位；本 design 不预批。

### 3.8 取消与并发

- **取消传播**：`request.signal` 原样入引擎；`handle.cancel(reason)` 原样入官方 run.cancel；settle 后 cancel 为引擎 no-op；终态由引擎 stopReason 裁决（取消是信号不是终态，R5）。dispose 幂等，委托官方 bounded settlement（脚本与子 agent 静默），门面不另设宽限期。
- **并发策略声明（concurrency §6）**：`parallel`——不同 run 互不影响（引擎 per-run 隔离：独立 worker、独立子 agent registry、独立 id）；run 内子 agent 并发上限是引擎配置语义，门面不复制。同一插件可持有多个 run；两个 owner 的 run 隔离由引擎身份保证并经门面验收（R6）。无共享可变状态 → 无 CAS/fencing 需求；stale guard = handle 操作绑定创建时的 run identity（§3.4 handle 语义），旧引用无法触及新 run 或他人 run。
- **提交资格**：终态由官方 promise 单点 resolve；门面包装不产生迟到回调写入面（observe 订阅只读 feed，dispose 后不再回调）。

### 3.9 装配与运行条件

- 本 feature 为纯主包 facade translation：**不依赖任何 replacement 行**，full 与选择性安装（仅 main）行为一致；`workflowEngine` 由官方组件行（`dsh-workflow-worker-thread`）提供，默认 runtime 装配即含。
- 引擎行缺失/损坏 → typed 降级（R9），不影响无关面；不出现"半装配"。
- 无新 wire/durable 协议：`workflow/*` payload 与官方一致；浏览器侧展示继续走既有 client 事件转发（host-only 判定，R10）。

### 3.10 绑定引出机制汇总

| 绑定 | 引出机制 | 分类 | 失败路径 / guard |
|---|---|---|---|
| `workflows.start` | 官方 `workflowEngine` 服务受控包装（方案一） | B 类 | engine absent → typed feature-disabled；cannot-begin → 判别式 no-run（官方码保留）；parent 校验失败 → no-run；包装层异常 contain 为判别式失败，不抛穿挂载 |
| run 终态 | 官方 result promise 如实映射（never rejects） | B 类 | 恰好 resolve 一次；不 synthesize；映射异常（理论不可达）fail-closed 为 error 终态并附 bounded diagnostic |
| `workflow/*` 事件 | 官方引擎派发，经门面事件总线既有承载（官方 dispatch 直绑，已交付） | A 类 | 既有 freeze/containment；本 feature 零改动 |
| handle.observe | 对既有 feed 的 run-scoped 过滤订阅（projection） | B 类（薄投影） | listener 失败按总线 containment；disposer 只结束本订阅；不建第二投影 owner |
| tasks 关联 | 消费既有 tasks 面与 workflow source adapter | A 类 | 证据确认失败是既有 typed 结果；本 feature 不改 tasks |
| `availability()` | 纯 seam 探测 | B 类 | 永不抛错；异常按 unavailable 收敛 |

## 4. Data Models

- **入参** `WorkflowStartRequest`（门面形状）：`{ script: string, meta: object(官方 WorkflowMeta 形状), parent: <门面 agents 面 agent 引用>, args?: unknown, subagentProvider?: string, maxTotalAgents?: number, signal?: AbortSignal }`；`meta`/`args` 为 plain JSON data（官方 seam 契约），由引擎验证。
- **出参**：start 判别式结果（§3.3）+ `WorkflowRunHandle`（§3.3）+ 终态对象（§3.6，冻结）。
- **身份**：run identity = 官方 `WorkflowRunId`（branded 字符串，引擎铸造 UUID）；ownerId = 门面派生 owner；两者不同层、不混用（identity-and-lifecycle：id 是资源身份，ownerId 是 owner 身份）。
- 不新增 durable record / wire 协议；meta 的持久键语义由官方承载。

## 5. Error Handling

1. **降级**（§3.2/§3.9）：engine 缺失 → namespace 在 + availability unavailable + typed error；探测按实际可用性，不用对象存在性冒充。
2. **cannot-begin**：官方同步 WorkflowError 分类 → 判别式 no-run，官方码原样保留；无 id、无事件。
3. **parent 校验失败**：`parent-unresolved` no-run，引擎调用前拒绝（副作用前检查）。
4. **containment**：包装层不抛穿挂载；observe listener 失败按总线规则只降级该监听者；门面异常不改变引擎 run 状态。
5. **stale/隔离**：handle 操作绑定 run identity；stale 引用 no-op 化（cancel 对已 settle run 是官方 no-op；dispose 幂等）；不触碰他人 run。

## 6. Testing Strategy

- **真实执行链**：经门面 `start` 启动真实官方引擎的测试 workflow（真实 worker + 可用 subagent provider fixture），断言脚本实际执行、子 agent 实际被调用、child 归因到 verified parent。
- **身份**：handle.id 与官方事件 `workflow/start` info.id 一致；重复 start（同请求）→ 两个不同 id、两 run 独立终态；无门面自造 id。
- **观测**：`workflow/*` 六事件经既有 events 面可达且 payload 不变；handle.status()/observe() 与事件流一致；observe disposer 后不再回调且不影响其他订阅。
- **终态**：completed/cancelled/error 三路映射；result never rejects；终态唯一、settle 后 cancel no-op；无返回值脚本的 no-value 如实呈现。
- **取消**：signal 原样传播（传入引擎的 signal 与调用方 signal 同源验证）；运行中 cancel → aborted 终态（引擎裁决）；dispose 幂等 + bounded 等待。
- **隔离/stale**：两 run 两 owner 互不干扰（cancel/dispose 交叉）；门面 feature 降级/重载后旧 handle 不影响他人 run。
- **parent 校验**：合法引用通过；缺失/伪造/陈旧引用 → `parent-unresolved`，无引擎调用、无 id。
- **tasks 关联**：handle.id 作为 workflowId 经既有 attach/start 获得 workflow source 证据确认；task.start 不产生执行。
- **降级/自描述**：engine 缺失 → unavailable + typed error；恢复 → active；无关能力不受影响。
- 载体：`node --test` 经 `npm test`（4G 护栏）；seam 级用 stub engine（实现官方 seam 契约），集成级用官方 WorkerThreadWorkflowEngine + spawn provider fixture。

## 7. Standards 逐分册适用性结论

| 分册 | 结论 |
|---|---|
| capability-strategy | **适用**。B 类受控包装判定（§3.7：无 R 点位）；§10 六问 host-only；不新增 `services.*` passthrough；§7 retirement：官方等价公开 seam 出现时包装面退役 |
| api-shape | **适用**。一面原则：主面 operation；进度观测走既有事件 projection，不在 operation 内夹带第二投影 owner；引擎是唯一 mutation owner（执行 authority），门面零 mutation |
| api-idioms | **适用**（含两处登记例外）。operation 外层合同 `{ok, code, terminal}`：start 结果省略 `terminal` 成员（cannot-begin 拒绝不铸造 operation 实例，终态由 `handle.result` 一次交付）与 handle 三个领域附加成员，均按 §1 例外六元组登记；统一终态词汇；id/ownerId 不混用 |
| public-api-shape | **适用**。顶层 `workflows` 一等领域论证（§3.1）；无治理代号进入公开 path；capability path `workflows`；registry 同步在执行阶段 |
| composition-and-authority | **适用**。holder-owned handle、owner 从 fiber 派生、stale guard、副作用前 parent 检查；authority closure：workflow 执行写路径只有引擎一条，门面包装不构成第二 authority；composition mode `additive`（§2 词表：多 owner 各自创建相互隔离的 run，owner 归因 + 身份隔离；无共享逻辑资源，故非 coordinated。并发策略 `parallel` 按 concurrency-and-cancellation §6 单独声明于 §3.8） |
| domain-composition | **适用**。领域分工守恒：engine 执行 / tasks 关系 / executions 观测；本 feature 不吞并任何领域、不改 tasks/executions 成员；不建跨域状态机 |
| ordering | **不适用**。本 feature 无多插件顺序语义：无策略/transform/决策点；事件监听排序沿用既有总线规则（priority + 注册顺序），不新增排序基础设施 |
| identity-and-lifecycle | **适用**。官方 WorkflowRunId 是资源身份（不造第二套）；外部重发 = 新 run、身份不合并；无内部 retry/attempt 层；终态唯一且 final（统一词汇：success/aborted/error；本域无 denied/superseded） |
| durable-state-and-scope | **部分适用**。本 feature 不写任何 durable record、不新增 scope 档；meta 持久键语义由官方承载；operation 能力声明：不自动 retry、fail-closed |
| visibility-and-redaction | **适用**。`workflow/log` 与失败消息是引擎产出的业务数据，门面不新增日志受众、不转写；script/args 为插件业务数据不进入门面日志；host-only 无 client 半身受众问题 |
| concurrency-and-cancellation | **适用**。取消是信号、终态由引擎裁决；signal 原样传播（不本地替换）；并发策略 `parallel` + 引擎内并发上限；dispose 幂等 bounded；stale result 隔离（handle 绑定 identity） |
| versioning-and-protocols | **适用**。版本冻结（不步进 A/B.C/D）；无新 wire/durable 合同（`workflow/*` payload 沿官方）；纯主包实现 → full 与选择性装配天然等价 |

## 8. 两线一致性声明

本 feature 与 `compaction-operation` 无共享 owner（本线为门面主包 owner；compaction 线的 R 扩展 owner 为 compaction-events 替代行）、无共享 namespace（`workflows` vs `sessions.compaction`）、无共享状态或词汇。两线仅在 operation idiom 的**标准外层合同**上遵循同一份 `api-idioms.md`；本线不使用 compaction 线的 outcome 词汇（compacted/skipped/rejected），compaction 线不使用本线的 run 词汇（started/settled）。
