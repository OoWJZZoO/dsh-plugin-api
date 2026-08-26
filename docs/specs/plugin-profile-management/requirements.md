# Stage 1 - Requirements

## Status

SPEC1 Stage 1：Requirements 已撰写，**待用户批准**。

## Introduction

本 feature 为第三方插件提供完整的 host profile management 契约：

- **读侧投影面**：以三种视图（runtime / disk / other）查询 profile 组合态、健康结论与变更 dry-run；
- **写入面**：经进程外 companion 执行器提供快捷写与手动快照管理两种变更模式，全部写入遵循"先验证后落盘、CAS 防并发、原子替换无半写态"三性质；
- **存储治理**：seed 缓存、配额护栏与孤儿 GC；
- **信任模型假设**（用户已批准）：已加载插件与宿主同等可信；本契约提供事故防护与审计归因，不充当对抗恶意插件的权限边界——无逐操作审批、无 settings 写开关。

上游提案（`--boot-check` 等）完全不在本 spec 范围内，归 M-final 工作线。

## Faces and Ownership（api-shape 一面原则声明）

依据 `api-shape.md` §3（llm 命名空间先例），本 feature 在单一命名空间 `pluginApi.profile`（暂定名，design 定稿）内拆分为**两个独立 owner 的面**，不共享私有状态、各自 feature guard：

| 面 | 类型 | 动词 | owner |
|---|---|---|---|
| 投影面 | projection | `inspect` / `health` / `planDiff` | inspection mounter |
| 写入面 | durable mutation | `apply`(快捷写)、`snapshot.create/modify/validate/delete`、`snapshot.apply` | mutation mounter（逻辑唯一实现在进程外执行器，门面仅遥控） |

两面间数据流单向：写入面的结果经事件可被消费方组合观察；投影面绝不持有写状态。本 feature 为 **host-only**：不声明 client manifest、不注册 remote namespace、不涉及 slot/settings bridge（capability-strategy §10 六项判定全部为否）。

## Requirements

> 编号前缀 PPM（plugin-profile-management）。每条 AC 标注受众（模型可见 / UI 可见 / diagnostic 可见 / redacted）之处依 `visibility-and-redaction.md` §3 执行。

### PPM-1 inspect 三视图投影（projection 面）

**User Story**：As a UI-plugin author, I want to query profile composition across three views through one API, so that I stop hand-parsing profile files and never guess what the next boot will load.

1.1 WHEN `inspect` is called with view `disk` THEN the facade SHALL fold layers in official composition order (`package.json` bundles → `cordis.patch.yml` → overlays) and return resolved rows, each row carrying its source bundle identity. 【UI 可见 / diagnostic 可见】

1.2 WHEN `inspect` is called with view `other` and a profile name THEN the facade SHALL return a result of identical shape produced by reading that profile directory strictly read-only.

1.3 WHEN `inspect` is called with view `runtime` THEN the facade SHALL return the loaded-state projection captured at this boot's init, without re-reading profile disk files.

1.4 IF any layer cannot be parsed or folded THEN `inspect` SHALL mark that layer explicitly unavailable (with reason code) and still return all successfully folded portions, rather than failing the whole call.

1.5 IF runtime-view fields are not observable at init time THEN those fields SHALL be reported as unavailable and SHALL NOT be fabricated from disk state.

1.6 WHERE results are returned to callers THEN all payloads SHALL be frozen read-only views.

1.7 The runtime view SHALL be a boot-time composition snapshot and SHALL NOT track post-init dynamic registrations (no live registry mirroring).

### PPM-2 health 体检（projection 面）

**User Story**: As a plugin author or profile owner, I want a structured health report over any view, so that inconsistencies are detected before they surprise anyone at next boot.

2.1 WHEN `health` is called on any view THEN the report SHALL include findings for: duplicate row ids, declared-but-missing packages, row/package identity mismatch, and main/helper version-consistency violations (vocabulary mirroring constitution §4).

2.2 WHEN `health` encounters an unknown structural layer THEN it SHALL report an unknown-layer finding instead of guessing.

2.3 `health` SHALL produce findings classified by severity and SHALL have zero side effects on any file or service state.

### PPM-3 planDiff 干跑计算（projection 面）

**User Story**: As a plugin author, I want to preview what a change would do before committing to anything, so that I can present reviewable diffs to users.

3.1 WHEN `planDiff` is called with a configuration-type change intent THEN it SHALL compute the resulting candidate patch content in memory without writing any file.

3.2 WHEN `planDiff` is called with a dependency-type change intent THEN it SHALL compute the target dependency set and expected resolution delta without installing anything.

3.3 `planDiff` SHALL be a pure computation over the shared folding parser and SHALL never mutate snapshots, cache, or real profiles.

### PPM-4 门面 fail-safe 与执行器可用性（横切两面的底线）

**User Story**: As a harness user, I want this feature to never destabilize boot, so that any failure stays contained and visible.

4.1 IF any internal component of this feature fails at any stage THEN the failure SHALL be contained as typed degradation or quiet deactivation and SHALL NEVER throw through plugin apply (G1 discipline).

4.2 GIVEN the companion CLI passed version handshake WHEN a write verb is invoked THEN it SHALL execute normally.

4.3 IF the companion CLI is absent, fails handshake, or reports version mismatch THEN all write verbs SHALL return a typed unavailable/conflict result while read verbs remain fully functional.

### PPM-5 快捷写（写入面）

**User Story**: As a plugin author, I want to submit a change intent in one call and have it safely validated and landed, so that safe writing does not require orchestrating the pipeline myself.

5.1 WHEN quick-write `apply(intent)` is invoked AND the executor is available THEN the pipeline SHALL automatically run prepare → validate(L1 + L2 全跑) → commit and return an operation handle.

5.2 WHEN L2 runs THEN it SHALL operate in a fully isolated environment (`DSH_HOME` redirected), with ports pinned via overlay so production instances cannot collide.

5.3 WHEN L2 uses the mock-provider strategy THEN the mock row SHALL exist only inside the disposable validation environment and SHALL NOT be written to any real profile or shipped as a replacement row.

5.4 IF L2 falls back to a real-model call and a provider-layer failure (credit/auth/rate-limit/network) occurs after boot completion THEN the verdict SHALL be pass-with-caveat recorded in the report, and SHALL NOT block validation.

5.5 IF a boot-phase crash occurs at any point of L2 THEN validation SHALL fail (blocking), regardless of fallback mode.

5.6 WHEN commit begins THEN the executor SHALL verify the baseline hash of the real profile; IF the hash differs from prepare-time baseline THEN it SHALL abort with a typed CAS-conflict result leaving the real profile byte-identical, and the report SHALL indicate rebase is required.

5.7 WHEN config swap happens THEN it SHALL be atomic (official dsh-atomic-write paradigm); a partial-write state SHALL never be externally visible.

5.8 WHEN commit succeeds THEN backups SHALL be rotated (bounded retention N) and the result SHALL carry an explicit restart-required notice. 【UI 可见】

5.9 IF any pipeline stage fails THEN the real profile SHALL remain byte-identical to its pre-operation state.

### PPM-6 手动快照管理（写入面）

**User Story**: As a plugin author, I want to create, edit, validate, apply, and clean up my own staging snapshots, so that complex multi-step changes can be managed incrementally with an explicit safety gate.

6.1 WHEN `snapshot.create` is called with source `runtime` or `disk` THEN a snapshot SHALL be created as a near-instant atomic step using lazy materialization (config copied; dependencies materialized only at first validate).

6.2 WHEN `snapshot.modify` is called on an existing snapshot THEN edits SHALL be applied without requiring validation, and the snapshot lifecycle state SHALL become `dirty`.

6.3 WHEN `snapshot.validate` is called THEN it SHALL run the requested level (L1 and/or L2); IF it passes THEN the snapshot state SHALL become `validated`, bound to the content generation that was validated.

6.4 IF a validated snapshot is modified afterwards THEN its state SHALL revert to `dirty` and the previously validated generation SHALL no longer satisfy the apply gate.

6.5 WHEN `snapshot.apply` is called THEN the executor SHALL reject it with a typed gate-conflict result UNLESS the snapshot's current content generation is in `validated` state.

6.6 WHEN `snapshot.apply` proceeds THEN it SHALL perform fast dependency reconciliation against the warmed store, then atomic config swap, then backup rotation; IF any step fails THEN the whole apply SHALL abort with the real profile unchanged.

6.7 WHEN `snapshot.delete` is called on a snapshot owned by a different owner THEN it SHALL be rejected with a typed ownership-conflict result.

6.8 Snapshot ownership SHALL be bound to the calling plugin's package identity via a binding mechanism that resists caller spoofing (binding level decided at design).

6.9 Snapshots SHALL carry durable identities that survive host restarts, distinct from their content generations.

### PPM-7 长时操作句柄语义（写入面）

**User Story**: As a plugin author, I want long operations to be observable and cancellable, so that tens-of-seconds pipelines remain controllable.

7.1 ONLY quick-write and manual `validate` SHALL return operation handles; `create`/`modify`/`delete`/`apply`(snapshot) SHALL return direct typed results as near-instant atomic steps.

7.2 WHEN a handle-bearing operation progresses THEN it SHALL emit progress events carrying stable operation id and current stage. 【diagnostic 可见】

7.3 WHEN cancel is requested BEFORE commit begins THEN the operation SHALL settle `aborted` at the unified commit point and leave real profile and snapshot states consistent.

7.4 IF cancel arrives after commit has begun THEN it SHALL receive a typed too-late rejection and the operation SHALL run to its terminal outcome.

7.5 Terminal outcomes for handle-bearing operations SHALL use the unified vocabulary `success` / `error` / `aborted` / `denied` / `superseded` (timeout recorded as `error` with timeout reason classification).

7.6 IF the host shuts down while operations are in flight THEN the disposition (detach-with-resumable-state or kill-and-cleanup) SHALL follow the behavior fixed at design, and orphaned staging artifacts SHALL be reclaimed by GC rules in PPM-8.

### PPM-8 存储治理：seed 缓存、配额、GC（写入面基础设施）

**User Story**: As a harness user, I want validation storage to be fast, bounded, and self-cleaning, so that snapshots never become a storage disaster.

8.1 WHEN the first-ever quick-write occurs THEN a system-owned global seed cache SHALL be created by hardlink-cloning the target profile's node_modules.

8.2 WHEN subsequent snapshots materialize dependencies THEN they SHALL clone from the seed cache via hardlinks; dependency deltas SHALL be reconciled inside the snapshot only.

8.3 WHEN the source profile's dependency fingerprint changes THEN the seed cache SHALL be rebuilt atomically.

8.4 Storage quotas SHALL default to 256 MB per owner and 1 GB total (settings-tunable), accounted in apparent bytes of snapshot directories; the seed cache is system-owned and excluded from owner quotas.

8.5 IF a create/modify would exceed quota THEN it SHALL be rejected with a typed quota-exceeded result; existing non-orphan data SHALL NEVER be auto-deleted to free space.

8.6 WHEN the boot-init scan runs THEN snapshots whose owner is absent from both the runtime view and the target profile's declared dependencies, or whose target profile no longer exists, SHALL be classified orphaned and deleted immediately.

8.7 The reinstall-cycle loss of snapshots is an accepted tradeoff and SHALL be documented in user-facing docs.

### PPM-9 审计日志（写入面基础设施）

**User Story**: As a profile owner, I want every write operation attributed and traceable, so that questions like "who changed what" always have answers.

9.1 WHEN any write operation reaches a terminal state THEN an audit record SHALL be appended containing: owner, timestamp, operation type, target profile/snapshot, outcome, and reason codes. 【日志摘要级；完整明细 diagnostic 可见】

9.2 Audit records SHALL be durably appended in the profile storage scope and SHALL NOT be writable through the public API (append-only infrastructure).

9.3 Audit logging failures SHALL degrade the operation's auditability flag in its result, not crash the operation after commit.

### PPM-10 客户端半身机械校验（执行器 validate 阶段）

**User Story**: As a plugin author shipping browser-half code, I want deterministic packaging checks during validation, so that white-screen-class breakage is caught before landing.

10.1 WHEN validating a snapshot or quick-write containing client-half code THEN syntax errors, forbidden import-boundary violations (e.g., node built-ins in client entries), and `dsh.client` manifest conformance failures SHALL be classified as blocking errors.

10.2 Dangerous-sink heuristics (e.g., eval, unsafe innerHTML patterns, wildcard postMessage) SHALL be reported as non-blocking warnings using a vocabulary shared with the threat-model checklist deliverable.

### PPM-11 L2 判定语义（执行器 validate 阶段）

**User Story**: As a profile owner whose provider account is temporarily out of credit, I want validation to judge boot health, not inference success, so that wallet problems never block healthy profile changes.

11.1 L2's verdict object SHALL be "harness boots and all rows apply"; inference success SHALL NOT be part of the verdict.

11.2 WHEN the mock-provider strategy is active THEN validation SHALL require zero network access and zero real credentials seeded into the disposable home.

11.3 IF fallback to a real-model call occurs THEN provider-layer failures occurring after boot completion SHALL be recorded as caveats and the verdict SHALL pass.

11.4 Boot-phase crashes SHALL always fail validation in either strategy.

### PPM-12 可见性与脱敏（横切两面）

12.1 WHERE inspect/health outputs contain filesystem paths or environment-derived values THEN they SHALL follow the audience rules: UI 可见 / diagnostic 可见 by default; model-visible exposure SHALL require an explicit visibility policy decision (non-secret) consistent with `visibility-and-redaction.md` §2.

12.2 Credentials, tokens, or equivalent secret values discovered in profile files SHALL be redacted in all audiences by default; elevation SHALL remain governed by the default-denied user/profile secret policy.

12.3 Operation handles' progress events SHALL expose stage names and reasons only, not raw file contents. 【redacted beyond stage metadata】

## Non-Functional Constraints

- **信任模型声明**（已获用户批准）：本契约假设已加载插件与宿主同等可信；不实现逐操作审批、不实现 settings 写开关（negative requirements）；防护手段 = 校验管线 + 审计日志 + restart-required 可见性。若官方未来引入插件宿主沙箱，须在新的 spec 流程中重审授权模型。
- **并发策略声明预告**（细节 design 定稿）：快照目录内操作按 owner 划界并行、同快照互斥；真实 profile 提交为 compare-and-swap；seed 缓存重建为 exclusive。
- **Retry 能力声明预告**：L1/L2 校验失败属 permanent（需人工修改意图后重新发起，外部再触发创建新 operation）；pnpm/install transient 失败允许有界内部 retry（同 operation 新增 attempt）；CAS 冲突属 superseded 类竞争信号，要求 rebase 而非自动重试。
- 本 feature 无迁移验收对象（新能力，非既有 hack 替换）；首个真实消费者为本仓库自身 bundle 家族。

## Standards Alignment（六册对照）

| 分册 | 适用性 | 对齐结论 |
|---|---|---|
| capability-strategy | 适用 | 读侧为 B 家族边缘形态，维持方案一（无 dispatch 点可替代，R 关闭已审计归档）；执行器为生态基础设施工具，不属于插件分发通道，R1–R9 全体不适用；§3 安全不变量适用（可逆=备份/回滚，副作用有证明=只写 `$DSH_HOME` 用户区）；§10 客户端半面六项判定全否 → host-only；§11 纯本地开发阶段声明适用 |
| api-shape | 适用 | 双面拆分满足一面原则（llm 先例）：投影面零副作用、写入面为 durable mutation 且不做策略决策；无 policy 面（授权模型裁决）；跨面共享原语（折叠解析器）放内部共享模块，不入公开命名空间 |
| identity-and-lifecycle | 适用 | 操作句柄 id = plugin-api 自生成 execution identity；attempt 层级承载内部 retry；generation 采用 owner-specific opaque token（validated-at-generation、备份代次）；终态词汇统一五词、timeout 归 error+reason；快照跨重启用持久 snapshotId，与 generation 分离 |
| durable-state-and-scope | 适用 | 快照/备份/审计/缓存全部归属 **profile 存储档**；mutation 面满足 identity+generation+commitState 契约；不允许半提交可见（原子替换）；fail-closed 默认拒绝未声明操作；审计 who/what/when/generation |
| visibility-and-redaction | 适用 | 受众已逐条标注（PPM-1/2/7/9/12）；secret 默认全受众 redacted；提升唯一通道为 policy；client 受众威胁模型章节将在 design 后增补至本册 |
| concurrency-and-cancellation | 适用 | 取消是信号终态是裁决（提交点统一裁定 aborted）；commit 开始后取消 too-late；stale-result 提交资格=CAS 校验；disposer 按 identity 清理（delete 仅限自有快照）；并发策略与 retry 能力声明见上节预告，design 定稿 |
