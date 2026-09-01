# Stage 3 — Tasks

## Status

SPEC3 Stage 3：本任务书承接已确认的 `goal.md` / `requirements.md` / `design.md`（Stage 0–2 已获用户确认：goal / requirements / design 均于 2026-09-01 批准）。本文按 AGENTS.md §3.2 以对抗性审查为门；审查返回「无偏差」后直接进入 Stage 4，不设用户确认门。

**串行纪律**：design §Architecture 与 §Error Handling And Lifecycle 要求内部契约先于组件 owner 绑定发布、组件 owner 各自独立 fail-safe，且 coverage 必须由证据闭合而非包命名闭合。因此本 feature 全程串行，不派发并行 worktree、不并行修改共享文件。

**审查纪律**：Stage 3 任务书通过后进入 Stage 4。Stage 4 按 AGENTS.md §3.2「不再逐顶层大任务派审」，但本任务书沿用本仓库 M8 已确立的逐 Wave 门：每个 Wave 完成时派发一次**阻塞式只读对抗性审查子代理**（`run_in_background: false`），审查通过后才进入下一 Wave；审查意见若偏差不大（机械补齐、无设计取舍、不动已批准边界）就地修复后可直接推进。全部 Wave 完成后再按 §3.2 做一次**全局终审**。

**硬红线**：任何任务不得修改 `/usr/lib/node_modules/@deepseek-ai/dsh/**` 或任何官方包文件；不得步进 runtime identity `A`、API 世代/增量 `B.C`、包本地维护号 `D`（AGENTS.md §3.0.1）。

**条件性人类门（非默认门）**：仅当执行中发现某项工作会改变已批准的 Goal 或 Requirements 验收边界（例如需要把一个常见且安全相关的官方路径降级为 gap、或需要新增 design 未登记的公共根命名空间）时才暂停并请求人类裁决；除此之外 Stage 4 不中断。

## 需求锚点

任务引用 `requirements.md` 各节（`§N` 为节号）：

- §1 Canonical Policy Inventory And Enforcement Matrix
- §2 Shared Policy Authority And Automatic Application
- §3 Public Cooperative Policy Interfaces
- §4 Egress Enforcement Closure
- §5 Recovery Automatic Consumption
- §6 Other Policy Domains
- §7 Policy Composition, Identity, Audit, And Observability
- §8 Capability Presence, Coverage, And Installation Modes
- §9 Custom Event Definition
- §10 Named Edge-Path Gaps And Threat Boundary
- §11 Replacement Component Integrity
- §12 Repository Artifact Cleanup
- §13 Storage Removal Accounting Correction
- §14 M8 Idiom And Public API Shape Conformance
- §15 Contract Registry, Documentation, And Delivery Report
- §16 Verification And Delivery Gates

## 冻结决策（源自 design，实现须逐项遵守）

1. **版本冻结**：runtime identity `A = 0.1.0-rc.6` 不变；主包、全部辅助包与 full 聚合包完整版本保持 `0.1.0-rc.6-0.1.0`（`B.C = 0.1`，`D = 0`），`dsh.api` 保持 `0.1`。任何实现、生成物或文档同步都不得步进任一版本字段（design §Frozen version baseline）。
2. **registry 原地扩展**：唯一事实源仍为 `docs/specs/plugin-api-m7-public-contract-refactor/public-contract.registry.json`。不新建平行 policy registry、不新建公共 root、不新建第二个 `security.policy` 聚合。
3. **内部契约是私有 typed 面**：门面在根 ctx 上发布 symbol-keyed 私有内部契约，方法为 `egress.admit` / `egress.release` / `recovery.decide` / `recovery.commit` / `policy.status`；它不是公共 namespace、不是运行时 registry 服务、不是权限系统、不暴露包/行/mounter/替代身份。组件 owner 缺失契约 = typed unavailable/degraded，绝不等于隐式 allow。
4. **领域 reducer 不合并**：egress 保留 default-deny 与精确目标绑定；recovery 保留 action 校验与 retry bounds；route / tool / auth / visibility / provenance 各自保留其 reducer、优先词表与默认决定。自动执行与合作型调用同一 registry、同一 reducer、同一默认决定、同一审计 authority。
5. **公共 idiom 分配（design §Registry extension and idiom assignment）**：
   - `security.egress.register` — policy（保留）
   - `security.egress.lease.acquire` — coordination（异步 `Outcome<Lease>` 重塑）
   - `security.egress.lease.release` — coordination（新增，`release(handle)` 归还动词，幂等）
   - `security.egress.coverage` — selfDescription（新增）
   - `executions.recovery.capability.register` / `executions.recovery.policy.register` — policy（保留）
   - `executions.recovery.evaluate` — operation（保留为合作型操作，不是 `consume` 确认）
   - `executions.recovery.coverage` — selfDescription（新增）
   - `events.define` — contribution/resourceRegistry 之一（按实际注册语义判定）+ 登记的 prescribed-verb exception
   - `events.define.handle`（publisher handle）— resourceRegistry handle
   - `storage.open.handle.dispose` — operation handle（新增叶子）；`storage.open.handle.close` 保持 deleted
6. **不恢复咨询式成员**：`security.egress.check`、`executions.recovery.consume`、`executions.recovery.visibility.project` 不恢复为公共成员；其能力守恒由「自动执行证据」闭合。
7. **coverage 三分区**：`coverage()` 返回 `{ status, registration, cooperative, automatic: {<公共语义路径>: active|degraded|unavailable}, observedAt }`；`security.egress.coverage()` 与 `executions.recovery.coverage()` 同形，仅 `automatic` 路径键不同。`coverage()` 不取代 availability 词表：namespace 级存在性仍在 `security.availability()` / `executions.recovery.availability()`，能力协商仍在 `capabilities.get/list/require`，守恒记账仍在根 `capabilityMatrix()`。
8. **gap 记录八字段**：`gapPath` / `component` / `trigger` / `protectedAction` / `missingPreActionPoint` / `failedChannels` / `observableConsequence` / `affectedInstallationModes` / `evidence` / `retirementCondition`，缺字段即校验失败；常见、安全/正确性相关、或已由已批准 replacement 拥有的路径不得记为 edge gap（§10 第 4 条）。
9. **inventory 行字段集**：`policyPath` / `registrationShape` / `primaryIdiom` / `policyOwner` / `componentOwner` / `decisionVocabulary` / `reducer/conflictRule` / `defaultDecision` / `automaticDecisionPoint` / `protectedAction` / `cooperativeInterface` / `observableEvidence` / `failureAndCancellation` / `coverageStatus` / `verification` / `retirementCondition`（仅 gap 需要）。不适用字段记显式 `null`，不得省略。
10. **不得引入的能力**：全局 `fetch`/`http`/`socket`/`child_process` monkey patch；部署级沙箱、网络命名空间、seccomp、CSP；通用权限系统或跨进程 owner 防伪；跨组件拥有全部官方行的全局 replacement；`dispose()` 出现在 lease handle 上或 legacy `revoke()` 复活。

## 已核实的实现现状（Stage 3 事实基线，实现前不再重复勘查）

- `lib/security-egress.js` + `lib/security-owner.js:405-435`：egress 当前是**同步** `acquire(target, ttl)` 返回 `{ generation, expiresAt, revoke }`，与 registry 已声明的 coordination 契约（`Outcome<Lease>`、`release(handle)`、`release-idempotent`）不一致；`security.egress.check` 已不在公共面（`plugin-api-service.js:2202-2204` 只暴露 `register` 与 `lease.acquire`）。
- `lib/storage-binding.js:197-200`：storage handle 仍暴露 `close`，而 registry 已声明 `storage.open.handle.close` 为 delete、`storage.open.handle.dispose` 未登记 —— 这是 §13 必须闭环的运行时事实。
- `lib/recovery-policy.js:806-812`：recovery 公共面为 `capability.register` / `policy.register` / `evaluate` / `visibility.register` / `availability`；没有自动消费 authority，`windows`/`decisions` 仅有「同窗口复用」而非「单一消费 + commit 守卫」。
- `lib/events-bus.js`：只有 canonical catalog + 五个派发动词 + `observe`/`catalog`/`availability`；无 custom event 定义注册表，`events.define` 当前既不在 registry members 也不在运行时。
- registry 中当前 `gapReason` 非空的四个簇：`executions.recovery removals`、`security.egress removals`、`storage removals`、`events.define`（`status: "gap"`）；另有 `llm.routing.health removals` 的 `replacement` 声称「automatic probe execution」但无实际调度调用者（design §Current-State Findings 第 4 条）。
- 已存在的 replacement 包：`compaction-events`、`session-title`、`mcp`、`attachments`、`agent-loop`、`session-branch`、`profile-manager`、`tool-skill`、`llm`、`session-channel-connection`、`session-channel-gateway`、`full`。未替换的 egress 相关官方组件：`dsh-web` / `dsh-web-search-deepseek`、`dsh-subprocess` / `dsh-subprocess-local`、`dsh-terminal*`、`dsh-shell`、`dsh-llm-deepseek` / `dsh-llm-pi-ai`、`dsh-session-telemetry-otel`。
- `lib/plugin-api-service.js` 用 `_decoratedNamespaces` + slot 机制挂载各 namespace；`lib/index.js:2179-2228` `FEATURE_MOUNTERS` 决定挂载顺序（`security` 在 `llm/admission` 之后；`recovery` 在 `execution` 之后；`events` 在 `tools` 之后）。

---

### [x] 1. Wave 1 — Policy inventory、enforcement matrix 与机械校验（§1、§6、§10）

- [x] **1.1 inventory 制品**：新增 `docs/specs/plugin-api-policy-enforcement-closure/policy-inventory.json`，为构建期/测试期数据（不被运行时 import 为可变状态）。枚举 canonical registry 与实际 host/client 公共面中的全部 policy 或 policy-shaped 成员 —— 至少覆盖：llm request transforms / admission、route policy 与 health circuit、execution visibility、recovery policy 与 recovery visibility、channel auth、tool restrict/guard、skill activation、prompt provenance、security policy/redaction/egress，以及按语义检查（而非仅名称匹配）发现的其他成员。每行携带冻结决策 9 的全字段。
- [x] **1.2 enforcement matrix**：为 inventory 中每条 policy 登记其声明的官方决策点：最后一个稳定的副作用前/终态前决策点、受保护动作、实际执行副作用的官方组件 owner、重定向/重连/重试/新子进程的重入点。egress 至少覆盖 LLM provider 与 model discovery、MCP stdio/HTTP、官方 web 与 web provider、subprocess/shell/terminal、attachment remote ingestion、remote/connection transport、可选 telemetry exporter；recovery 至少覆盖 model、tool、agent-loop、task、transaction 及其他官方失败/重试/降级路径。
- [x] **1.3 gap 记录**：对每条未闭合路径写 gap 记录，携带冻结决策 8 的全字段；`failedChannels` 必须逐通道说明「官方直绑 / 门面转译 / 扩展现有 replacement / 新增组件 replacement」为何失败。
- [x] **1.4 机械校验**：新增 `scripts/policy-inventory-validate.mjs`（由测试调用）：对未登记 policy 成员、未声明官方受保护路径、无自动/合作型 disposition 的注册、overbroad coverage 声明、缺字段 gap 记录、以及「常见或已由已批准 replacement 拥有的路径被记为 edge gap」一律失败；registry、生成物、matrix 与 inventory 相互矛盾时失败且不得静默择一（§1 第 5 条）。
- [x] **1.5 §6 语义重判**：
  - 修正 `llm.routing.health removals` 的 `replacement` 文案：若没有真实调度调用者，删除「automatic probe execution」声明，改为如实登记实际存在的成员与行为；
  - 对发现的 policy-shaped 成员逐个判定：确为 projection / contribution / resourceRegistry / operation 的，在 registry 与 inventory 中改语义分类，不得为其臆造自动执行（§6 第 7 条）；
  - 已自动执行的 policy（transform/admission、route/circuit、visibility、channel auth、tool guard/restrict、skill activation、prompt provenance）保留行为、补 coverage 证据行，并核实其合作型接口存在。
- [x] **1.6 测试**：inventory 完备性（每条 policy 恰一个 disposition）、行字段完备性、gap 字段完备性与 AC4 拒绝规则、§6 重判结论与生成物一致、校验器对上述六种缺陷均能失败。

### [ ] 2. Wave 2 — 内部 policy authority、公共 egress/recovery 重塑与 coverage（§2、§3、§7、§8）

- [ ] **2.1 内部契约**：主门面在 policy owner 初始化后、组件 owner 绑定前，于根 ctx 发布 symbol-keyed 私有内部契约 `egress.admit(target, context)` / `egress.release(handle)` / `recovery.decide(input)` / `recovery.commit(decision, operation)` / `policy.status(domainOrPath)`。契约类型化、能力受限、组件中立；承载的是领域方法而不是通用 `evaluate(domain, input)`。
- [ ] **2.2 发布与拆除顺序**：按 design §1 五步（构造 owner → 校验契约形状 → 发布 → 各组件自报 coverage → 拆除前先失效契约）落地；任一组件在 guard/availability 检查前不得调用内部方法；契约缺失为 typed unavailable/degraded。
- [ ] **2.3 egress 公共面重塑**：`security.egress.lease.acquire(request)` 改为异步 coordination 入口，返回 typed `Outcome<Lease>`；lease 凭证冻结携带 `id` / `resource` / `generation` / `fencingToken` / `expiresAt`，不含 `dispose()`、不含 `revoke()`；新增 `security.egress.lease.release(handle)` 为幂等归还动词，stale handle 返回 typed `code: 'conflict'` 并在 `reason` 说明陈旧条件。该重塑在 registry `oldToTargetMapping` 登记一行，不静默改形状。
- [ ] **2.4 coverage 投影**：新增 `security.egress.coverage()` 与 `executions.recovery.coverage()`（selfDescription），同形返回 `{ status, registration, cooperative, automatic: {...}, observedAt }`；`automatic` 的键只能是 inventory 已登记的公共语义路径；未登记的新路径报 `unavailable`，不得继承邻近路径状态；投影不含包/行/mounter/可写 registry 身份。
- [ ] **2.5 决定证据与审计**：自动与合作型共用领域 bounded 审计；证据记录 `channel: 'automatic' | 'cooperative'`、`point`、`outcome`、`policyIds`、`ownerIds`、`executionId`/`operationId`/`attemptId`、`observedAt`、`reason`、`redactedContext`；不含凭据、授权头、命令密钥、私有 payload；审计追加失败时决定仍然生效并暴露 bounded audit-gap marker，绝不伪造记录（§7 第 3–6 条）。
- [ ] **2.6 身份与组合**：policy 注册 handle 携带 owner-bound `id`/`ownerId`/`generation` 与身份绑定幂等 `dispose()`；同一决策点多 owner 时使用领域声明的组合模式、reducer、优先词表与确定性同优先顺序；callback 抛错/reject/超时/畸形决定被 contain，套用该点文档化 fail-safe 默认并记录 bounded owner 归因证据；调用方对受管异步操作提供 `AbortSignal` 时保持并组合该 signal，迟到决定/完成在产生受保护副作用前通过 owner、generation、operation、resource 与终态 eligibility 校验（§7 第 7 条），egress 与 recovery 两侧实现均适用。
- [ ] **2.7 测试**：内部契约形状与发布/拆除顺序、组件 owner 缺失时 typed degraded、egress lease 异步/字段/`release` 幂等/stale conflict、coverage 三分区与未登记路径不继承、审计 channel 归因与 gap marker、多 owner 组合确定性、callback 失败 contain、自动与合作型同输入同 generation 同决定。

### [ ] 3. Wave 3 — Egress 官方路径自动执行闭包（§4、§11）

- [ ] **3.1 egress 适配器与目标归一化**：实现 `egress.admit` 的组件侧适配器：`kind + destination + operation class + component owner + generation + expiry` 归一化；授权只覆盖该精确目标；重定向、重连、重试、transport 切换、provider endpoint 变化、新建子进程都必须重新求值，除非现有凭证显式覆盖该精确动作。
- [ ] **3.2 LLM provider 与 discovery**：扩展 `packages/llm` replacement，在 adapter 注册/装饰边界包裹 provider stream 与 model-discovery 回调，于 transport 建立前求值；最终 endpoint 必须由 adapter 拥有的 request/connection 状态推导。若某 provider 的 endpoint 完全私有，则为该 provider 行加组件内 replacement slice，不得以「通用 llm wrapper 已覆盖」搪塞。
- [ ] **3.3 MCP**：扩展 `packages/mcp` replacement，在首次连接、每次重连、以及每个可能建立新出站目标的 transport 请求前求值；HTTP 用解析后 URL、stdio 用 executable/command 描述符；保留官方 SDK transport 契约、取消与重连行为。
- [ ] **3.4 官方 web**：在 web provider 边界（provider 执行 fetch/search 之前的最后一点）设 gate；provider 闭包不暴露稳定最终 endpoint 时，为 `dsh-web` / provider 组件建立组件内 replacement。attachment remote ingestion 与 model-facing web tool 只有在 matrix 证明其走已 gate 的 web 服务且无直连旁路时才继承 coverage。
- [ ] **3.5 subprocess / shell / terminal**：在官方 subprocess 服务的最低公共点（`spawn` / `spawnTerminal` 之前）设 gate；terminal 与 shell owner 的每一次子进程创建都必须经过该服务；必要时只允许为 `dsh-subprocess` 官方组件新建 replacement，且必须完整保留其服务/事件契约（不是部署沙箱）。
- [ ] **3.6 browser connection**：扩展 `packages/session-channel-connection`，在官方 browser transport 的真实 `fetch`/WebSocket 尝试前求值；客户端半边通过既有 connection 契约接收 host 产出的、已脱敏的 coverage/授权快照，并在调用浏览器原语前拒绝不受支持的官方 transport 尝试；host 仍是 policy 状态来源。
- [ ] **3.7 可选 exporter**：盘点每个启用的官方 exporter/provider 行（`dsh-session-telemetry-otel` 等）；能触达则消费内部 egress 契约，不能触达则按具名可选 edge path 记 `degraded` 并单独入账，不得并入「全部官方路径已覆盖」的宽泛声明。
- [ ] **3.8 fail-closed 与旁路边界**：fail-closed 路径在契约缺失或求值失败时无任何出站副作用、返回 typed denied/unavailable；第三方直接使用底层网络/socket/WebSocket/进程/原生/外部进程能力不入账为被拦截。
- [ ] **3.9 测试**：每个官方 owner 用契约忠实的副作用 spy 证明「注册后自动求值（调用方无第二次咨询）」「deny 发生在 fetch/WebSocket/transport 创建/spawn/exporter send 之前」「allow 绑定精确目标/owner/generation/expiry」「目标或动作变化重新求值」「callback 失败与 authority 不可用 fail-closed」「各 owner coverage 独立」「第三方裸调用不被伪称为已拦截」。

### [ ] 4. Wave 4 — Recovery 自动单一消费（§5、§7）

- [ ] **4.1 内部 decide/commit**：`recovery.decide(input)` 归一化失败并对当前 operation 窗口求值一次；`recovery.commit(decision, operation)` 原子消费一次，校验 owner、generation、execution 身份、attempt 身份、终态、取消与资源占有。accepted retry 在同一 execution 下新建 attempt；aborted/denied/superseded/已提交终态不得再起 attempt。
- [ ] **4.2 agent/model 请求失败**：`packages/agent-loop` replacement 在 `agent/request-error` 边界归一化失败、求值并应用 retry/fallback/abort/surface，在下一次 attempt 或终态提交之前生效；官方 retry provider 仍是「无自定义 policy / 默认路径」，其结果被归一化进同一决定窗口，保证不会二次重试。
- [ ] **4.3 tool 调度失败**：agent-loop 调度器把 dispatch/preparation 失败路由到同一 recovery authority，在提交终态 step 结果之前应用决定；已启动 call 保留其 operation 身份，skipped/aborted 保留官方顺序与结果语义。
- [ ] **4.4 门面自有 task / transaction**：task settlement 与 workspace transaction recovery 在终态提交、retry 或 rollback 之前调用同一私有 authority；`prepare/record/commit/rollback` 的 operation/mutation 外形保持不变，recovery 不变成隐藏 mutation 或通用 rollback disposer。
- [ ] **4.5 合作型接口保持**：`executions.recovery.evaluate` 保留为 operation，返回冻结 M8 operation outcome（operation 身份、terminal/decision 状态、归一化 action、bounded reason/provenance、execution 身份与建议 attempt/bounds）；它不声称改变了调用方私有 operation；不使用同一 policy generation 与 reducer 之外的第二套逻辑。
- [ ] **4.6 失败与陈旧**：重复/陈旧失败在同一 operation generation 至多消费一次；recovery authority 或求值不可用/失败时套用文档化 fail-safe 默认，绝不静默表现得像发生了 policy 批准的重试或 fallback；第三方自行 settle 自己 operation 的路径记为 authority 之外，不推断也不改写其私有终态。
- [ ] **4.7 测试**：自动求值并消费一次、无自定义 policy 时官方 fallback 行为不变、自定义 retry 保留 execution 身份并递增 attempt、fallback/abort/stop 在终态提交前应用、tool 调度与 task/transaction 同窗口、重复与陈旧失败不起第二 attempt、取消/截止/denied/superseded 不触发重试、合作型 `evaluate` 同 generation 同 reducer 且副作用责任显式。

### [ ] 5. Wave 5 — `events.define` 自定义事件生产入口（§9、§14）

- [ ] **5.1 定义注册与 publisher**：在 `lib/events-bus.js` 增加独立的 custom 定义注册表与派发路径（canonical 事件目录、priority 词表、freeze 与 fault containment 语义不动、不搬进 replacement）。`events.define(spec)` 接受 `{ name, validate(payload), freeze, scope }`，返回冻结 publisher handle `{ id, ownerId, generation, name, emit(payload), dispose() }`。
- [ ] **5.2 分域与冲突**：`name` 必须是非空自定义事件身份，不得与 canonical 事件或同一冲突键下的另一活动自定义定义碰撞；冲突按文档化确定性 owner/key 规则处理，绝不静默替换 owner；publisher 只能派发自己声明的事件身份，通过受支持 API 派发未声明事件或 canonical 官方事件在派发前被拒绝。
- [ ] **5.3 派发外形与生命周期**：`emit` 返回冻结判别式 M8 operation-dispatch outcome（单次派发无独立 operation 身份、不重试，operation 身份/重试字段显式不适用）；payload 按声明校验与冻结；observer 失败按声明契约 contain，不破坏无关 custom 或 canonical 注册；`dispose()` 幂等，stale publisher 在 dispose/reload/generation 替换后既不能派发也不能移除较新的正常定义。
- [ ] **5.4 owner 归因边界**：caller-bound owner 身份可用时从真实插件上下文派生，用于归因与生命周期；恶意伪造身份或绕过门面按合作型插件模型记为 out of scope，不作为 `events.define` 的可用性条件；`events.define` 的可用性在合作型自定义事件契约可用时即报 active。
- [ ] **5.5 registry 与能力闭环**：在 canonical registry 登记 `events.define`（contribution/resourceRegistry 之一 + 完整 prescribed-verb exception 六字段）、`events.define.handle`、以及 `events.observe` 对自定义事件的适用性说明；`capabilityMatrix` 的 `events.define` 簇从 `status: "gap"` 闭合为已交付（`gapReason: null`），并登记 U-series 上游提案与退役条件（官方提供 owner-scoped custom publisher seam 后退役为官方直绑）。
- [ ] **5.6 测试**：两个合成正常插件覆盖逆序注册、自定义身份冲突、声明 payload 校验/冻结、发布 outcome、自定义观察、canonical 事件拒绝、重复 dispose、stale publisher、reload 隔离、observer 失败 contain、无关 canonical/custom 事件保持；显式不测试对抗性 owner 伪造或裸 Cordis 绕过。

### [ ] 6. Wave 6 — 仓库清扫与 storage 记账修正（§12、§13）

- [ ] **6.1 精确删除**：从 Git 与工作树删除且仅删除 `undefined\dsh-cost-meter-test-home/storages/cost-meter/ledger.json`、`undefined\dsh-cost-meter-test-legacy-home/storages/cost-meter/ledger.json`、`undefined\dsh-cost-meter-test-mig-home/storages/cost-meter/ledger.json`，并移除其空父目录。
- [ ] **6.2 不使用宽泛规则**：不新增 `*undefined*` / `*dsh-cost-meter-test*` 或等价 ignore/删除规则；若发现仓库内确有测试会重新生成该产物，先修正该测试临时 home 的构造与清理，再宣告清扫完成；若确无仓库内生成器，则记为 M8 引入的历史外部测试产物，不臆造运行时修补。
- [ ] **6.3 storage 记账修正**：
  - canonical registry 的 `storage removals` 簇：`replacement` 改为 operation handle `dispose()` 销毁契约，`gapReason` 置 `null`；
  - 登记 `storage.open.handle.dispose` 成员（operation handle 叶子，含完整 M8 字段集与 handle 行）；
  - 运行时按 registry 落地：`lib/storage-binding.js` 的 handle 以 `dispose()` 取代 `close()`，不提供兼容别名；
  - 同步生成物、迁移账本与交付文档，全部使用同一 replacement 结论。
- [ ] **6.4 测试**：删除后受护栏全量测试完成再扫描上述三条精确路径与根级 `undefined\dsh-cost-meter-test-*` 模式，复发即失败；surface 验证证明旧 `close()` 路径已不存在、受支持 operation handle 暴露已登记的 `dispose()` 销毁契约、且没有兼容别名。

### [ ] 7. Wave 7 — Registry、生成物、能力与文档同步（§14、§15）

- [ ] **7.1 registry 扩展**：按冻结决策 5 增改成员行与 handle 行；登记 `events.define` 的 prescribed-verb exception（六字段齐全）；登记 `security.egress.lease.acquire` 形状重塑的 `oldToTargetMapping` 行；修正 `security.egress removals`、`executions.recovery removals`、`storage removals`、`events.define` 四个簇的 `replacement` / `gapReason` / `status`；每条新成员携带完整 M8 字段集，不适用字段显式 `null`。
- [ ] **7.2 生成物与能力记录**：从 canonical registry 重新生成/同步 M8 制品（member inventory、old-to-target mapping、capability matrix、host/client 快照、handle inventory、types、migration ledger）；同步 `lib/capability-descriptors.js`、`lib/capability-matrix.js`、namespace `availability()` 结果与 `capabilityMatrix()` 条目，全部以公共语义路径表述，不含包/行/mounter/替代身份；`capabilities.get` 对每个 capability path 映射到三值之一。
- [ ] **7.3 契约与规范符合性**：`scripts/registry-validate.mjs` 与 registry/surface 一致性检查全绿；新增/改变的叶子与 handle 全部通过 M8 idiom 校验（无未登记叶子、无省略或非法 idiom、无缺字段混合语义面、无非统一字段名、无 legacy alias、运行时形状与 registry 契约一致）；host/client 同 idiom 成员的外层契约对齐。
- [ ] **7.4 文档与登记**：`docs/specs/plugin-api-features/feature-list.md` 登记本 feature（spec 链接、状态、关键约束、跨组件 replacement 协作记录）；新增本 feature 交付报告，逐条列出每个 policy disposition、每个自动官方路径、每个合作型接口、每个具名 edge gap 及其验证引用；egress 文档声明「已登记受支持官方路径自动受管 + 合作型第三方路径在调用公共接口时受支持 + 直接绕过不在保证内」；recovery 文档区分自动消费与合作型求值；`events.define` 文档声明合作型归属与 canonical/custom 分域，不声称对抗性同进程隔离；`README.md` 公共契约现状注同步。
- [ ] **7.5 replacement 登记**：每个新增或扩展的 replacement package 登记：被替代官方行、归属官方组件、唯一 owner、boot 自检项、版本锁定、fail-safe 行为、冲突检测、U-series 上游提案、退役条件；跨组件协作在 feature-list 报备，不产生跨组件全局 replacement。
- [ ] **7.6 测试**：registry 与生成物/快照/类型一致且同为单一事实源；能力守恒（每簇恰一个最终 status、deleted 有 replacement 或已闭合证据、无 gapReason 残留矛盾）；文档与运行时保证边界一致；新 replacement 的 full/选择性安装、官方行恢复、无双跑、`A.B.C` 错配路径局部降级、客户端半边 parity（如适用）、官方包零修改。

### [ ] 8. 终验、全局终审与交付（§16；AGENTS.md §3.2）

- [ ] **8.1 全量验证**：`npm test` 全绿（走护栏脚本，不用裸 `node --test`，含既有全部测试与本 feature 新增测试）；`git diff --check` 通过；官方包修改审计（`/usr/lib/node_modules/@deepseek-ai/dsh/**` 未被修改）通过；registry/surface 一致性检查通过；生成物检查通过。任一验证失败、超时或无法建立证据按阻塞处理，不得把受影响路径改为 active 或提前闭合 gap。
- [ ] **8.2 安装模式覆盖**：full 聚合与「主包 + 选择性 enforcement 包」在同一冻结基线装配出等价的已选能力集与行为，无双跑、无替代行语义改变；缺少可选 owner 只让受影响的具名路径报 degraded/unavailable，不让官方行处于「disabled 且无功能替代」的空洞；移除 replacement 后恢复官方行且 coverage 如实变化。
- [ ] **8.3 规格制品回写**：核对 requirements / design / tasks 与交付一致；执行中发现的 spec 细节偏差就地修订对应文档并在最终报告列出；动摇 Goal/Requirements 验收边界的偏差必须暂停请示。
- [ ] **8.4 全局终审（阻塞）**：全部顶层任务完成后，调用一次只读阻塞式全局终审，核对整个 Stage 4 交付与 Tasks/Design/Requirements 的一致性，并按 `docs/standards/` 适用分册比对规范符合性；返回「无偏差」后才可交付；有意见则在整体范围内集中修订后再次全局终审，直至通过。
- [ ] **8.5 Stage 4 完成提交**：终审通过后提交本 Stage 全部实现、测试、registry 与生成物、仓库清扫、storage 记账修正、规格制品修订与登记（先 `git diff --check`）；提交后工作区保持干净；交付最终结果报告（任务完成情况、spec 偏差修订列表、policy disposition 清单、自动官方路径与 coverage 证据、合作型接口清单、具名 edge gap 与退役条件、安装模式验证、阻塞记录）。

- **要求**：交付物全绿 + 全局终审无偏差 + 完成提交 + 工作区干净，才可宣告 Stage 4 完成。
