# Requirements: plugin-api-repo-normalization

> feature_name: `plugin-api-repo-normalization`
> 状态：Stage 1 已获当前授权（修订稿；前置门批准）
> 修订原因：根据 Stage 2 对抗审查补充收尾状态及固定审计报告证据字段；用户已授权自动推进前置门，本修订作为 Stage 2 的已确认上游。
> 上游：Stage 0 Goal（用户已确认方向："先把当前仓库规范化、标准化"）；审计基准 = `docs/standards/` 各分册（2026-08-21）与 AGENTS.md §2/§4/§6/§8 及 §3.0.1（纯本地开发窗口）。当前工作树已包含部分治理迁移；2026-08-21 仅作为历史审计快照，执行时必须重新核对当前状态。
> 类型：治理/工程规范化（无第三方可见 API 新增）
> 审计快照：2026-08-21（M6 治理迁移未合并主分支时的 main 状态）

## Introduction

2026-08-21 以 10 条 Stage 0 决议确立了全局标准并完成治理迁移。标准现行权威分册为 `capability-strategy`、`api-shape`、`identity-and-lifecycle`、`durable-state-and-scope`、`visibility-and-redaction`、`concurrency-and-cancellation` 六册；`verification-and-evidence` 不属于本 feature，也不新增。以历史快照及当前工作树复核仓库后，针对持久化 API 的 scope 归属、mutation 能力声明、R 类客户端半面证据、终态/生命周期词汇、namespace 三面边界、治理编号残留、并发/取消约束和旧路径指向分别登记并规范化。本 feature 仍只做审计、登记、声明与不改变行为的最小改写，不新增第三方可见 API 或能力。

---

## 1. 审计交付物（A0）

**User Story:** As a repository maintainer, I want one evidence-backed compliance record, so that current violations and already-closed migration items are not conflated.

**A0.1.** WHEN this feature 执行 THEN 系统 SHALL 产出合规审计报告，逐条记录：审计基准分册与条款、发现位置、证据、违反认定、修复建议；每册至少一条「零违反」或「有发现」的明示结论。
**A0.2.** WHEN 报告交付 THEN 报告 SHALL 标注本次审计时点、分支、commit SHA、Node/DSH runtime identity、依赖锁定摘要和审计 base，并将 2026-08-21 快照中的历史发现与本次当前仓库复核发现分栏记录：历史快照中已消失的项目标为「历史迁移项已关闭」，当前仍存在且属于本 feature 范围的项目必须进入当前发现项表和收尾判定；仅凭历史快照不得排除当前新增发现。
**A0.3.** WHEN 审计发现需登记（scope 归属、能力声明、半面判定、词汇映射、面图）THEN 登记 SHALL 落于 `docs/specs/plugin-api-repo-normalization/execution/audit-report.md`，每条登记 SHALL 可验证（引代码位置、扫描命令/规则版本、快照身份或官方包检查结果）。

## 2. 新标准落实（按分册）

### 2.1 identity-and-lifecycle（Q1/Q3/Q4）

**User Story:** As an API designer, I want existing identity and terminal vocabulary mapped to the global lifecycle policy, so that later features do not inherit ambiguous semantics.

**A1.1.** GIVEN 既有 API 不生成 execution identity WHEN 审计执行 THEN 报告 SHALL 确认：现有代码不以 event seq 冒充执行身份（`sourceEventSeqs` 等仅作溯源，非身份），`routing.ofExecution(exec)` 只透传官方对象身份；并登记结论「首个 execution 系 feature 立项时 SHALL 落实 executionId 由 plugin-api 生成」（evidence：lib/exec-route.js、lib/session-durable-feature.js、lib/llm-request-snapshot.js）。
**A1.2.** GIVEN 现有世代机制为 owner-local（session-durable 的 capability epoch `active/breached/closed`、agent facade transaction 的 transaction.epoch 等）WHEN 审计执行 THEN 报告 SHALL 确认无全局单调 generation 计数器、确认无跨 owner generation 比较，并登记结论「新 feature 的 generation SHALL 用 owner-specific opaque token + owner-local revision」（evidence：lib/session-durable-feature.js:51,107-113、lib/plugin-api-service.js:685-692）。
**A1.3.** GIVEN 既有生命周期/终态用词（transaction state `prepared/committed/rolled-back`；epoch state `active/breached/closed`；R 包事件 `started/completed/failed/skipped`）WHEN 审计执行 THEN 报告 SHALL 逐类登记其与统一终态词汇（success/error/aborted/denied/superseded）的映射或豁免理由（例如：transaction 终态 rolled-back 对应何种 outcome；R 包事件词汇为已交付契约，保留并登记对应关系），确认终态 final 且唯一（无事后改写路径），并登记结论「新 feature 的终态只能使用统一词汇」（evidence：lib/plugin-api-service.js:685-725、lib/session-durable-feature.js:186-200、packages/compaction-events/lib/event-contract.js）。
**A1.4.** WHERE 审计发现某处用词可能与统一词汇冲突（如 `settled`、`closed` 用作终态性表述）THEN 系统 SHALL 区分处理：属既有交付契约的登记差异与理由（保留语义，按 A1.3 登记）；属本次修复或后续 feature 引入的改写为统一词汇（前向约束见 A1.3 登记结论）。

### 2.2 durable-state-and-scope（Q2/Q8）

**User Story:** As a maintainer, I want stateful and mutating APIs to declare scope and operation capabilities, so that retry and persistence behavior remain predictable.

**A2.1.** GIVEN 仓库存在可持久化/有状态 API WHEN 审计执行 THEN 系统 SHALL 产出 scope 归属清单：`pluginApi.session.appendMessage`（session 档，spec 已约束 targetSession）、官方直通 seam（tokenMeter/settings/jobs 等，A 类直通豁免）、运行时内存状态（R 包引擎、remote 注册表等，不属 durable record 豁免）；登记「跨档零记录」；对 appendMessage 与 `remote.publish` 等 mutation 面核对审计可追溯（who/what/when/generation）现状并登记缺口。
**A2.2.** GIVEN 既有 mutation 面缺少 operation 能力声明（appendMessage 无幂等/自动重试声明；`remote.publish`/`settings.remote.set` 无显式能力声明）WHEN 审计执行 THEN 系统 SHALL 在登记文件补齐声明或记录豁免理由：appendMessage 按官方 `Session.append` 语义声明（追加非幂等、默认不自动 retry）；`remote.publish` 已有的同键异引用 typed error（lib/remote-publication.js）SHALL 作为能力声明登记；暂时无法补齐的空缺项 SHALL 标记为「待声明」并给出建议位置，同时必须在本 feature 收尾前补齐或显式升级为用户裁决，不得以「待声明」关闭。
**A2.3.** GIVEN 当前自动 retry 行为为零（lib 无 retry 循环）WHEN 审计执行 THEN 报告 SHALL 明示「未知默认禁止满足，暂无违规」；任何后续 feature 引入 retry SHALL 遵守 durable-state-and-scope §3/§4（attempt 与 operation 分层、transient/permanent/aborted/denied/superseded 分类）。

### 2.3 api-shape（Q9）

**User Story:** As a plugin author, I want namespace responsibilities to remain coherent, so that projection, policy, and mutation surfaces are understandable.

**A3.1.** GIVEN 既有 namespace 多为直通/基础设施 WHEN 审计执行 THEN 系统 SHALL 产出 namespace → 三面映射图并逐项登记豁免理由：llm（投影 modelInfo + 策略 admission/request transform + 直通 stream/prepareCall，多面但独立 owner，符合三面先例）；session（投影 surface/durable observation + mutation appendMessage，独立状态空间）；routing（纯投影）；events（基础设施豁免）；services.*（纯直通豁免，api-shape §5）；settings（A 类直通豁免）；remote/settingsRemote（B 类转译，单面 mutation，豁免依据为官方公开原语 + 独立 owner）；client.*（官方 client 直通豁免）。
**A3.2.** GIVEN smell 判据（同一 feature/shared state-space owner 出现 register+query+mutate 等三条）WHEN 审计执行 THEN 系统 SHALL 以 feature inventory 和 state-space owner 为主单位运行判据，并提供 namespace 汇总视图；命中项 SHALL 进入修复清单，未命中项 SHALL 附判据与豁免论证。
**A3.3.** GIVEN 审计发现 API 形状负债（含三面 smell 命中项）WHEN 报告交付 THEN 系统 SHALL 逐项标注「重构窗口建议（AGENTS.md §3.0.1）」并与登记性修复分开呈现；未附重构建议的负债项 SHALL NOT 被标记为已关闭。

### 2.4 capability-strategy（Q6/Q7）

**User Story:** As a replacement-package maintainer, I want component ownership boundaries recorded, so that replacement implementations remain isolated and manageable.

**A4.1.** GIVEN 已交付 R 辅助包为 `compaction-events` 与 `session-title` WHEN 审计执行 THEN 报告 SHALL 按官方组件插件包核对 owner 边界：每个官方组件插件包至多一个 replacement package；一个 replacement package MAY 覆盖该组件内多个官方行及多个相关 feature；R 实现 SHALL NOT 跨多个官方组件包；一个 feature SHALL NOT 依赖多个 replacement package。facade MAY 组合多个官方组件，且一个 feature MAY 同时包含 facade translation 与一个 R slice，但该 feature SHALL NOT 依赖跨组件 replacement。报告 SHALL 分别确认现有两个 R 包各自只对应一个官方组件，并登记该组件级规则。
**A4.2.** GIVEN 两个 R 包声明 host-only WHEN 审计执行 THEN 系统 SHALL 从当前实际安装的官方包解析路径重新执行 capability-strategy §10 六步判定，并记录 package metadata、解析路径、runtime identity、文件/hash 证据和每一步结论；历史 2026-08-21 检查只能作为对照，不能替代当前 host-only 结论。判定结果 SHALL 回填两个 R 包 requirements 的逐项证据指针，并在本 feature 登记文件保留完整证据。
**A4.3.** GIVEN 四包版本已一致（main 与三个辅助包均 `0.1.0-rc.6-0.5` / `dsh.api 0.5`）WHEN 修复涉及 package.json THEN 系统 SHALL 保持该一致性，且修复不得改动版本号。

### 2.5 visibility-and-redaction（Q5）

**User Story:** As an agent-facing harness maintainer, I want secret-safe but diagnostically open visibility policies, so that agents can diagnose failures without bypassing user security controls.

**A5.1.** GIVEN 可见性政策区分 secret 与非 secret WHEN 审计执行 THEN 报告 SHALL 登记：secret（凭据、token、私钥、认证材料及等价值）默认禁止，插件只能申请提升且用户/profile policy 可全局禁止，默认配置为禁止；非 secret 的错误、路径、route、execution、usage、能力状态和 harness 故障诊断信息由插件自行决定暴露，项目设计 SHALL 尽可能完整、可解释地开放给 agent。报告 SHALL 同时核对 settings remote 快照经 `redactSecrets` 脱敏（lib/settings-remote.js:154）、事件 payload 深冻结（lib/deep-freeze.js）、lib 无默认 `console.*` 输出（依赖注入 logger），并区分 secret 默认阻断与非 secret 开放性。
**A5.2.** GIVEN 既有输出面的可见性声明缺位 WHEN 审计执行 THEN 系统 SHALL 登记缺口（例如：错误对象进入模型的可见范围、debug 级诊断的触发条件）并给出声明位置建议；本 feature 范围内的缺口必须在收尾前补齐或显式升级为用户裁决，不得以未声明状态关闭；新 feature 的 requirements 必须逐条标明受众（模型/UI/diagnostic/redacted）。

**A5.3.** WHEN visibility audit records an output surface THEN the record SHALL identify audience, policy source, secret/non-secret classification, provenance fields (source/time/uncertainty), and redaction coverage for nested values, binary data, exception causes, and MCP resources; non-secret diagnostic openness SHALL be judged by explicit declaration and evidence of the exposed surface, not by a universal exposure quota.

### 2.6 concurrency-and-cancellation（Q10）

**User Story:** As a feature implementer, I want asynchronous ownership and cancellation semantics audited proportionally to risk, so that stale work cannot corrupt current state without burdening simple passthroughs.

**A6.1.** WHERE a feature owns durable mutation, lease, checkpoint, background work, asynchronous re-entry, generation replacement, Promise cache, replacement apply/dispose, remote mount/reconnect/HMR/browser state, or exposes AbortSignal/timeout/cancel/disposer IF the operation can overlap or outlive its caller THEN the audit SHALL record applicability and verify signal propagation, parent/child cancellation, stale-result submission eligibility, identity-safe disposal, and the declared concurrency strategy; ordinary synchronous A-class passthrough MAY be marked not applicable with evidence.
**A6.2.** GIVEN a retryable operation WHEN the audit records lifecycle semantics THEN internally driven provider/tool retries SHALL remain one execution with additional attempts, while a model/user/external re-invocation SHALL create a new execution; timeout SHALL be represented as an error reason/classification rather than a new terminal category.
**A6.3.** GIVEN competing terminal outcomes WHEN the audit records arbitration THEN uncommitted terminal precedence SHALL be `aborted > superseded > error > timeout-error`; a terminal outcome SHALL be final and identity-safe, and stale work SHALL NOT overwrite a newer owner-local generation.

## 3. 背景项：既有规则复核（非主审计）

**User Story:** As a repository maintainer, I want legacy governance residue classified and removed or recorded, so that implementation names remain semantic rather than policy-coded.

**B1.1.** GIVEN 实现代码存在治理编号残留 WHEN 审计执行 THEN 系统 SHALL 登记全部位置并纳入修复清单：注释与测试名命中改写为中立语义表述（零行为变化，全量测试为门）；运行时私有标识符命中（如 `runL4Phase`、`_execRouteP2Diagnostics` 等）经人工判定后二选一处置——行为保持的重命名（零行为变化由全量测试验证）或登记为「确认技术债」并附重构窗口建议；C0/C1 等非治理术语豁免并登记；增强扫描在 B1.1 清单之外的新发现命中按同一处置路径分级处理，不得默认豁免。位置清单：lib/settings-remote.js:2,6,8,51,116,146（ST4/D5）、lib/remote-publication.js:6,324（ST4）、lib/llm-input-policy.js:46（L1）、lib/services.js:14（SV15）、lib/client-codec.js:6（W5）、packages/compaction-events/lib/event-contract.js:85（C6）、packages/compaction-events/lib/forked-engine.js:641（C4.7）、packages/session-title/lib/event-contract.js:5（C4/D1）、test/services-definitions.test.mjs:84（SV17 测试名）、test/index-tools-abort.test.mjs:67（T2 注释）；C0/C1 为 ASCII 控制字符术语（packages/session-title/lib/event-contract.js:136 等同型处）豁免。
**B1.2.** GIVEN 治理迁移尚未合并主分支 WHEN 审计执行 THEN 系统 SHALL 登记 main 上的旧路径/旧指向（`docs/capability-strategy.md` 旧路径 ×9 文件、AGENTS.md §8 登记表旧形态、feature-list.md §7 缺失）为「随迁移合并消失」项，并登记合并边界后复检无残留。

## 4. 验证（F）

**User Story:** As a maintainer, I want focused repository gates, so that normalization is complete without creating a new heavyweight end-to-end verification standard.

**F1.** WHEN 全部修复完成 THEN 重跑审计检查（本 feature 登记清单 + 增强后的 governance-token-audit 覆盖）SHALL 对当前范围内存量项零未决；不得残留 `unverified`、`not-audited`、「待声明」、「待裁决」或任何未知/未定义状态；扫描失败、输入缺失、解析失败或证据无法核实时必须判为阻塞，不能归入“无发现”或“可追踪外部义务”；`git diff --check` 通过；`npm test`（即 `node --test "test/**/*.mjs"`）全绿，不得使用裸 `node --test` 扫描 `temp/`。这里的“零未决”只针对 in-scope findings；历史迁移项和经批准的重构跟踪项必须单列，不标记为合规关闭，也不能用来掩盖当前违反；B1.2 的治理迁移合并属外部依赖，另行跟踪。
**F2.** GIVEN 修复涉及已交付 feature 的登记/注释/文档 WHEN 提交 THEN 每个修复 SHALL 以本 feature 获批任务为依据，且不改变任何公开 API 形状、事件目录、错误分类或包版本。

## 非目标

- 不实现任何 M6 候选 feature（execution/usage/recovery 等）。
- 不修订 `docs/standards/` 分册本身；分册演进走 AGENTS.md 治理。
- 不修改官方 DSH 包文件；不新增目录事件、错误分类、命名空间或 peerDependency。
- 不重命名已交付的运行时包/行 id（中性命名已合规）。
- 不把登记当作免责：每条登记必须可验证、可追溯。
