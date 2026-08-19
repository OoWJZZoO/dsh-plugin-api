# Requirements: plugin-api-compaction-events-r1

> feature_name: `plugin-api-compaction-events-r1`
> 状态：Stage 1 草案（待对抗性审查与用户批准）
> 上游：Stage 0 Goal（已确认）、`AGENTS.md` §2/§4/§6、`docs/capability-strategy.md`（R1–R9）
> 类型：R 类（replacement bundle）；host-only，无 client bundle。

---

## Introduction

官方 `@deepseek-ai/dsh-compaction` seam 只定义抽象 `CompactionEngine`（`ctx.compaction`），没有任何 dispatch 点；官方 `@deepseek-ai/dsh-compaction-basic` 行在 `agent/pre-step`、`agent/request-error` 与手动 `compactNow` 路径执行压缩，但只写日志，第三方插件无法观察压缩发生、失败或结果，也无法在压缩前表达策略。

本 feature 以 R 类 replacement bundle 实现：fork 官方 `compaction-basic` 行，在完整保留官方 `ctx.compaction` 契约的前提下，新增 `compaction/*` Cordis 事件词汇（观察事件 + 压缩前策略瀑布），并把 `dsh-read-image` 的 B4（`[Image #N]` 索引失效）作为首个消费者迁移验收。

命名与包结构（Stage 0 已确认，实际改名由本 feature 的 Stage 4 任务执行）：

- 主包：`@deepseek-ai/dsh-plugin-api-main`（行 id 同步改为 `plugin-api-main`，服务 key `pluginApi` 保持不变）。
- 本 R 类辅助包：`@deepseek-ai/dsh-plugin-api-compaction-events`，源码位于本仓库 monorepo 的 `packages/compaction-events-r1/`。
- 未来辅助包命名规范：`@deepseek-ai/dsh-plugin-api-<domain>`（域名词尾，不带 `r1` 等迭代后缀，迭代由包版本表达）。

每个需求组标注分类：`R` = 替换类行为；`Governance` = 仓库治理；`Upstream` = 上游提案边界。

---

## 1. 命名、包结构与文档新鲜度

**User Story**：As a repository maintainer, I want a fixed package naming convention recorded in this feature, so that the main facade and every auxiliary replacement bundle are immediately recognizable and uniformly versioned.

**User Story**：As a plugin-api repository maintainer, I want every old spec that this refactor touches to be appended or revised in place, so that the repository keeps no stale governance artifact.

**Acceptance Criteria**

1.1. WHEN this feature is delivered THEN the main facade package SHALL be named `@deepseek-ai/dsh-plugin-api-main`。（Governance）

1.2. GIVEN the main package rename is executed WHEN the profile composes the bundle THEN the facade row id SHALL be `plugin-api-main` and the Cordis service key SHALL remain `pluginApi`。（Governance）

1.3. WHEN this feature is delivered THEN the replacement package SHALL be named `@deepseek-ai/dsh-plugin-api-compaction-events` and its sources SHALL live under `packages/compaction-events-r1/`。（Governance）

1.4. WHEN any future auxiliary replacement bundle is proposed THEN its package name SHALL follow `@deepseek-ai/dsh-plugin-api-<domain>` and SHALL NOT carry iteration suffixes such as `r1`。（Governance）

1.5. WHEN the monorepo workspace is introduced THEN the main package SHALL remain independently installable and the auxiliary package SHALL be independently installable without forcing the other。（Governance）

1.6. WHEN this feature's refactor changes a subject already covered by an older delivered spec (for example facade package naming, row id, package layout, catalog schema, or A/B/C/R classification) THEN the affected old spec SHALL be appended or revised in place so that it stays fresh and current, while preserving its delivery history。（Governance）

1.7. GIVEN an old spec is intentionally kept as a historical snapshot IF it is not revised THEN it SHALL carry a top-level note pointing to the newer authority (for example `docs/capability-strategy.md` or the current integration boundary), so that no stale spec remains without a pointer。（Governance）

---

## 2. 行替代装配与可逆性

**User Story**：As a plugin user, I want the replacement to be an ordinary `dsh plugin add` bundle, so that installation, removal, and per-profile isolation work exactly like any other official-layer composition.

**Acceptance Criteria**

2.1. WHEN the auxiliary bundle is installed into a profile THEN its `cordis.patch.yml` SHALL disable the official row `compaction-basic` by id and SHALL insert a distinct, stable replacement row id；IF the official row id is absent from the composition THEN the official patch engine SHALL skip the disable patch with a warning and the insert SHALL still apply。（R）

2.2. WHEN the bundle is removed via `dsh plugin remove` THEN the official `compaction-basic` row SHALL be enabled again and the composed profile SHALL return to official behavior。（R）

2.3. WHEN the profile boots THEN the replacement SHALL NOT modify any file under the official DSH installation, including `/usr/lib/node_modules/@deepseek-ai/dsh/**`。（R）

2.4. WHEN another bundle disables or re-enables the same official row in a later patch layer THEN the later layer SHALL win per official patch semantics, and the replacement SHALL detect the resulting composition through its boot self-check (see §4)。（R）

---

## 3. 官方契约复刻

**User Story**：As a third-party plugin or official consumer, I want `ctx.compaction` to behave exactly as the official `BasicCompactionEngine`, so that replacing the row never changes compaction results or boot behavior except for the new events.

**Acceptance Criteria**

3.1. WHEN the replacement row is active THEN it SHALL provide the `ctx.compaction` service with the public surface of the official `BasicCompactionEngine`, including `compactIfNeeded(agent, trigger, signal)`, `compactNow(agent, signal, sourceCommandId)`, `compactRegion(start, end, agent, signal)`, and the `summarize(input, agent, signal)` subclass hook。（R）

3.2. WHEN the official `Config` schema is applied to the replacement row THEN every official config key SHALL be accepted and validated with equivalent semantics, and unknown keys SHALL behave as officially.（R）

3.3. WHEN automatic compaction runs THEN pressure (`agent/pre-step`) and context-overflow (`agent/request-error`) triggers, retry counters, `agent/status` reset, and overflow recovery SHALL preserve official behavior including the `{ kind: "retry" }` recovery result。（R）

3.4. WHEN a compaction range is selected or committed THEN the official durable invariants SHALL be preserved: balanced tool-call/result boundaries, surface membership, surface stability, no open turn, and no concurrent compaction of the same session。（R）

3.5. WHEN `compactNow` fails with `ManualCompactionError` codes `busy` or `cancelled` THEN the replacement SHALL preserve the same error class, code, and message semantics as the official implementation。（R）

3.6. WHERE the official package exposes module-level imports (for example its `./invariant` companion) IF third-party code imports `@deepseek-ai/dsh-compaction-basic` directly THEN that import SHALL continue to resolve to the official package; the replacement row SHALL only replace the `ctx` service and event face, per R3 of `docs/capability-strategy.md`。（R）

3.7. WHEN the replacement is active THEN the delivered `pluginApi.services.compaction` seam (SV17) SHALL continue to resolve, and its `compactIfNeeded`/`compactNow`/`compactRegion` passthrough SHALL operate against the replacement service without change。（R）

---

## 4. Boot 自检、版本锁定与同行冲突

**User Story**：As an operator, I want the replacement to prove the intended composition at boot and to degrade safely when it cannot, so that a mis-composed profile never double-mounts `ctx.compaction` or kills the harness.

**Acceptance Criteria**

4.1. GIVEN the official `compaction-basic` row exists and is not disabled WHEN the replacement apply runs THEN the replacement SHALL NOT register a second `compaction` service, SHALL log one clear diagnostic, and SHALL return normally so boot continues with the official provider。（R）

4.2. GIVEN the official row exists and is disabled AND the identity check in §4.4 passes WHEN apply runs THEN the replacement SHALL register the forked `compaction` service with the new event vocabulary。（R）

4.3. GIVEN the official row is absent from the composition AND the identity check in §4.4 passes WHEN apply runs THEN the replacement SHALL register the forked `compaction` service as the sole provider。（R；官方行缺席是合法组成态：官方 `applyEntryPatches` 对缺失 id 的 disable patch 只告警跳过，insert 仍生效，见 §2.1）

4.4. GIVEN the installed runtime full version or the official `@deepseek-ai/dsh-compaction-basic` package identity does not match the replacement's pinned identity WHEN apply runs THEN the replacement SHALL treat the forked contract as unverified and SHALL apply the following composition-state matrix without throwing through `apply()`：
- official row present and enabled → SHALL NOT register any provider, SHALL log one clear diagnostic, and the official provider SHALL continue；
- official row present and disabled → SHALL NOT register the forked provider；IF the official package remains resolvable THEN it SHALL register an official-equivalent fallback provider that exposes the official contract without the new events, and SHALL log one clear diagnostic；otherwise it SHALL stay inert and log a loud diagnostic；
- official row absent → SHALL follow the same fallback-or-inert rule as the disabled case, with a loud diagnostic in both outcomes。（R）

4.5. WHEN any self-check probe or boot audit itself throws THEN the replacement SHALL contain the error, log it, and never throw through `apply()`。（R）

4.6. GIVEN multiple replacement rows target the same official `compaction-basic` row WHEN apply runs THEN the replacement row that appears earliest in the composed entry order SHALL own the provider decision (forked provider or §4.4 fallback provider) and every later claimant SHALL log a conflict diagnostic and stay inert。（R）

4.7. GIVEN the replacement decides to register the forked service WHEN registration completes THEN it SHALL verify that `ctx.compaction` resolves and that its key public entry points (`compactIfNeeded`, `compactNow`, `compactRegion`) and the event dispatch surface are callable；IF any verification fails THEN it SHALL roll back its registration, log one diagnostic, and stay inert without throwing through `apply()`。（R）

---

## 5. compaction/* 事件词汇

**User Story**：As a third-party host plugin author, I want a stable, read-only event vocabulary around compaction, so that I can observe compaction and express a veto or range adjustment without reimplementing the compaction engine.

**Acceptance Criteria**

5.1. WHEN the replacement provides `ctx.compaction` THEN it SHALL dispatch the following Cordis events on the host context: `compaction/request` (waterfall), `compaction/started` (emit), `compaction/completed` (emit), `compaction/failed` (emit), and `compaction/skipped` (emit)。（R）

5.2. WHEN any public compaction entry (`compactIfNeeded`, `compactNow`, or `compactRegion`) selects a compactable range THEN exactly one `compaction/request` waterfall SHALL be dispatched before summarization or durable commit, with a payload containing at least `{ agent, session, trigger, range: { start, end } }`；the `trigger` value SHALL map to entry points as follows: `compactIfNeeded` → `pressure` or `context-overflow`, `compactNow` → `manual`, and a direct `compactRegion` call → `direct`。（R）

5.3. WHEN a `compaction/request` listener calls `next()` or makes no decision THEN the transaction SHALL proceed with the currently selected range, and behavior SHALL be identical to the official implementation apart from the dispatch itself。（R）

5.4. WHEN a `compaction/request` listener returns `{ kind: 'reject', reason? }` THEN the transaction SHALL be cancelled before summarization, `compaction/skipped` SHALL be emitted with the reject reason, and the calling official path SHALL observe its normal "no compaction" outcome。（R）

5.5. WHEN a `compaction/request` listener returns `{ kind: 'replace-range', start, end }` THEN the replacement SHALL revalidate the proposed range against the official range-selection invariants from §3.4 that apply to a candidate range (balanced boundaries, surface membership, surface stability, `start <= end`, no open turn) before using it。（R）

5.6. GIVEN a `replace-range` result fails revalidation WHEN it is returned THEN the replacement SHALL ignore the proposed range, log one redacted diagnostic, and proceed with the originally selected range。（R）

5.7. WHEN a `compaction/request` listener throws or rejects asynchronously THEN the replacement SHALL contain the failure, log one diagnostic, and treat that listener as having made no decision; the failure SHALL NOT cancel or alter the compaction。（R）

5.8. WHEN a compaction transaction is approved and summarization is about to begin THEN `compaction/started` SHALL be emitted once, before the first summarizer call。（R）

5.9. WHEN a compaction transaction commits its durable summary THEN `compaction/completed` SHALL be emitted once after the commit, with a payload containing at least `{ agent, session, trigger, result }` where `result` exposes the committed shadowed range and shadowed sequence numbers.（R）

5.10. WHEN a compaction transaction fails after it has started THEN `compaction/failed` SHALL be emitted once before the official error path settles, including for manual compactions that throw。（R）

5.11. WHEN no compactable range exists or the measured pressure is below threshold THEN NO `compaction/request`, `started`, `completed`, or `skipped` event SHALL be emitted。（R）

5.12. WHEN an observer listener (`started`/`completed`/`failed`/`skipped`) throws or rejects THEN the failure SHALL be contained and SHALL NOT affect the compaction transaction or the official caller result。（R）

5.13. WHEN an event payload is produced THEN the replacement SHALL deliver an immutable snapshot regardless of whether the facade is active；no listener SHALL be able to mutate the selected range or committed result through the payload.（R）

5.14. WHEN no third-party listener is registered THEN the observable compaction behavior SHALL be equivalent to the official implementation。（R）

---

## 6. 门面 catalog 集成

**User Story**：As a plugin author using `pluginApi.events`, I want the new events listed in the typed catalog, so that I can subscribe with priority, read-only payload, and documented fault semantics through the supported facade.

**Acceptance Criteria**

6.1. WHEN the replacement feature is active THEN `pluginApi.events.catalog` SHALL contain one entry for each event named in §5, with `type: 'R'`, the owning feature name, the dispatch mode, the payload shape, and documented `fault`/`freeze` policy；each entry SHALL declare `scopeKey: null` (host-global, no scope-filtered dispatch), because compaction is a session-owning host service rather than an agent-scoped event。（R）

6.2. WHEN the facade catalog schema is extended THEN the literal value `'R'` SHALL be an accepted catalog entry type in the same position as `'A'` and `'B'`, without weakening duplicate detection or fail-loud composition。（R）

6.3. WHEN the facade core is inactive THEN the replacement SHALL still dispatch the native `compaction/*` events, and third parties using raw `ctx.on` SHALL be able to observe them with no facade guarantees。（R）

6.4. WHEN the replacement row is not active THEN the facade SHALL NOT list the `compaction/*` entries as available。（R）

---

## 7. dsh-read-image 迁移验收（B4）

**User Story**：As the `dsh-read-image` maintainer, I want compaction completion to be observable, so that the known B4 problem — compaction invalidating `[Image #N]` indexes — can surface a clear notice instead of a stale read.

**Acceptance Criteria**

7.1. GIVEN a session with projected images is compacted WHEN `compaction/completed` is emitted THEN `dsh-read-image` SHALL be able to derive the shadowed sequence range and mark or warn that existing `[Image #N]` indexes are stale。（R）

7.2. WHEN no compaction shadows any projected image THEN `dsh-read-image` SHALL NOT emit a stale-index warning。（R）

7.3. WHEN the consumer migration is executed THEN the headless smoke test and the dev profile boot SHALL both pass with the replacement active。（R）

---

## 8. 上游提案与退役

**User Story**：As a maintainer, I want every R class to be a temporary bridge to an upstream proposal, so that the fork is retired the moment the official seam lands.

**Acceptance Criteria**

8.1. WHEN this feature is delivered THEN U8 (`compaction/*` 事件词汇) SHALL remain registered in the upstream proposal table with the replacement as its current workaround。（Upstream）

8.2. WHEN an official `compaction/*` event vocabulary with equivalent observe and policy semantics becomes available THEN the auxiliary package SHALL be deprecated, its retirement condition SHALL be recorded, and consumers SHALL be offered a migration path to the official seam。（Upstream）

8.3. WHEN this feature is delivered THEN `docs/specs/plugin-api-features/feature-list.md` 的 U8 状态与 `AGENTS.md` §8 登记 SHALL be updated in the same change set, per `docs/capability-strategy.md` §8。（Governance）

---

## 9. 非目标

- 不修改任何官方 DSH 包文件；不替换 `compaction-basic` 以外的官方行。
- 不提供 client bundle、remote namespace 或设置界面。
- 不改变官方压缩算法、阈值策略或 durable surface 形状。
- 不承诺对 `@deepseek-ai/dsh-compaction-basic` 包 import 面的替换（见 §3.6）。
- 不实现 boot 故障隔离（U4）等方案二例外能力。

---

## 10. 需求覆盖检查

- Host 面：§2–§7 全覆盖。
- Client 面：本 feature 无 client bundle（明确非目标）。
- 外部可实现 vs 必须上游：事件词汇与策略钩子由 R 类 replacement 实现；官方原生 seam 为 U8 上游提案；boot 级故障隔离为 U4，不在本 feature 范围。
- 文档新鲜度：§1.6–1.7 要求本次重构触及的旧 spec 必须追加/修订或加注权威指针。
