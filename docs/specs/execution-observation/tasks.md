# Tasks: execution-observation

> **公共契约现状注（2026-08-29 追加）**：本制品成文于目标领域树 cutover 之前，文中的公共 path 为旧命名。现行命名以 [`public-contract.registry.json`](../plugin-api-m7-public-contract-refactor/public-contract.registry.json) 的 `oldToTargetMapping` 为唯一权威，本制品涉及的映射如下：
>
> | 本制品使用的旧 path | 现行 path |
> |---|---|
> | `pluginApi.execution`（`observe/get/history/onChange/visibility/availability`） | `pluginApi.executions`（叶子名不变） |
>
> 现行契约基线：包版本 `0.1.0-rc.6-0.1.0`（runtime `0.1.0-rc.6` / `dsh.api` `0.1`）；本制品中出现的 `0.1.0-rc.6-0.x` 为历史交付边界记录，不代表现行版本。本注只更新命名与版本指针，不改动本制品已获批的 Goal / Requirements 验收边界。

> feature_name: `execution-observation`
> 状态：Stage 3 Tasks 已批准（Stage 3 边界已提交）。Stage 4 已全部完成：Task 1–10 完成并验证，SPEC3 全局终审通过，Stage 4 完成提交已创建。
> 上游：`requirements.md`（Stage 1 已批准）、`design.md`（Stage 2 已批准，本批由用户明确批准）。
> 工作流：SPEC3（Stage 3–4）。Stage 3 先做对抗性审查再交用户评审；Stage 4 获批后按本清单自主完成全部任务，**不再逐顶层大任务派审**，全部完成后做一次全局终审，通过后才交付结果报告、提交并清理 worktree。
> 并行契约：`temp/m6-parallel-contract.md`（Wave A `execution-observation`，worktree `.worktrees/m6-execution`，分支 `feat/m6-execution`）。

---

## Scope and execution contract

- **Feature key（guard 分支 / FEATURE_MOUNTERS 键 / feature registry 键）= `execution`**；公开命名空间 = `pluginApi.execution`（B 类门面投影，无 R、无新事件）。
- 实现范围：`pluginApi.execution` 的 `observe / get / history / onChange` 与只读 `visibility` 策略子面；source adapter（agent/*、tools/*、llm/stream、session/*）；identity/lifecycle reducer；session-scoped bounded history；observer epoch 与 stale guard；受众化脱敏。
- **明确排除**：自动 retry / route policy / checkpoint restore / task mutation / durable mutation / 新 client reconnect 协议 / 新 events catalog slice / 任何 R replacement（EO-8 Non-Goals）。
- **允许触碰文件**：
  - 新建 `lib/execution-observation*.js`（reducer / sources / history / visibility / facade 装配，具体模块拆分见各任务）与 `test/execution*.test.mjs`；
  - `lib/guards.js`（在 unknown fallback 前**追加**一个 `execution` `else if` 分支）；
  - `lib/index.js`（追加 mounter 函数 + 在 `FEATURE_MOUNTERS` **末尾 `remote` 之后**插入 `['execution', mountExecutionFeature]`，不重排既有 key）；
  - `lib/plugin-api-service.js`（追加 disabled `execution` 工厂 + constructor/`Object.defineProperty` 一行 + `mountFeature`/`unmountFeature` 分支 + `KNOWN_FEATURES` 条目）；
  - `docs/specs/execution-observation/`（本 feature 自有）；
  - `docs/specs/plugin-api-features/feature-list.md`（只改本 feature 对应的行/登记）。
- **冻结文件（本 worktree 不得修改）**：`lib/events-bus.js`、`lib/deep-freeze.js`、`lib/events-catalog.js`、`test/index.test.mjs`、`test/index-events.test.mjs`。不得新增 events catalog slice；诊断面只走各 feature 自有 logger / 已冻 events bus。若 `npm test` 只因冻结核对顺序断言（`test/index.test.mjs` 的 `features` 列表）失败，**不得改冻结文件**，记录为整合期（Wave C integration owner）议题并在交付报告显式上报。
- **主包 `package.json` / 全量 bundle patch / 版本 bump 由 integration owner 处理**；本 worktree 不改主包版本号。
- source adapter 一律绑定**原生官方事件**（`ctx.on('agent/*' / 'tools/*' / 'llm/stream' / 'session/*')`），不 import 官方包私有变量、不修改 `/usr/lib/node_modules/@deepseek-ai/dsh/**`、不增加目录条目。
- 终态词汇固定：`outcome` 只取 `success | error | aborted | denied | superseded`；`settled/closed/disposed/settledAt` 只作生命周期元数据，不得当 outcome。timeout 映射为 `outcome:'error'` + `outcomeReason`，不引入 `timeout` 终态。
- 所有公开快照深冻结只读；observer 的 disposer 幂等且 identity-bound；`AbortSignal` 单独不提交 `aborted`；terminated 后迟到回调不得再改 outcome/phase/terminal 时间戳，不得新起 attempt。
- 测试统一 `npm test`（`node --test "test/**/*.mjs"`）；不用裸 `node --test`；临时脚本放 `temp/` 用毕即删。
- 治理魔法字母 / 工作流代号（SPEC/ANY/A/B/C/R 编号、`EO-x` 等）只允许出现在 docs 制品与本文件，**不得进入 `lib/`、`test/`、bundle patch、package.json** 等实现产物。

---

## 1. Build the pure identity/lifecycle reducer core — **implemented**

**Files**

- Create `lib/execution-observation-reducer.js`.
- Create `test/execution-observation-reducer.test.mjs`.

**Implementation**

1.1. Define the canonical `ExecutionProjection` shape exactly per design Data Models (frozen read-only object): `executionId, sessionId?, agentId?, parentExecutionId?, cause?, start {observedAt, sourceKind}, phase?, attempt[], outcome?, outcomeReason?, settled?, closed?, disposed?, sourceAvailability, provenance, observerEpoch`. Defaults never lie: missing parent/cause/session remains absent (`unavailable` semantics) and is never invented from event order.
1.2. Implement `executionId` generation with `crypto.randomUUID()` (globally unique, no ordering promise); event seq / timestamp / array position are never identity.
1.3. Implement `applyFragment(fragment)` reducer: keep `executionByKey` and `attemptByKey`; deduplicate repeated same source identity/generation; merge only fields with a valid identity/generation match and keep per-fact `sourceKind` provenance; when identity cannot be proven, keep two projections instead of merging by guess.
1.4. Implement attempt semantics: internal retry reuses the same `executionId` and appends a distinct attempt record (attempt number, owner, generation, `state: active|settled|stale`, optional `attemptId`/`startedAt`/`endedAt`); a user/model/external-triggered repeat creates a new `executionId` with parent/cause preserved only when provable.
1.5. Implement exact-once terminal commit: `outcome` limited to `success|error|aborted|denied|superseded`; `settled/closed/disposed` stay separate metadata; timeout maps to `error` + `outcomeReason`; once a terminal outcome is atomically committed, later fragments only enter bounded provenance and cannot rewrite outcome/phase/terminal timestamp; no new attempt after terminal/superseded.
1.6. Implement child/parent terminal default: a child operation's failure or cancellation ends the child execution by default; the parent execution is affected only when the source explicitly identifies the child as required for the parent (EO-5 AC2). The reducer must not propagate a child terminal to the parent from an AbortSignal or a plain child error alone.
1.7. Keep the reducer a pure function of its inputs (zero harness dependency), returning fresh deep-frozen snapshots via the frozen `deepFreeze` helper (import only, never modify).

**Focused verification**

1. Verify identity independence from event seq, internal-vs-external retry, attempt numbering, and unavailable parent/cause semantics (EO-1).
2. Verify start/phase/terminal mapping, exactly-once terminal, timeout-as-error, and lifecycle-vs-outcome separation (EO-2).
3. Verify deduplicate vs parallel: identical fragments are idempotent; unrelated executions remain separate (EO-3).
4. Verify deep immutability: caller mutation of a returned snapshot does not alter host state (EO-4).
5. Verify child operation failure/cancellation ends the child by default and affects the parent only when the source marks the child as required (EO-5 AC2).

**Requirements covered:** EO-1 AC all; EO-2 AC 1–5; EO-3 AC 3; EO-4 AC 3; EO-5 AC 2.

## 2. Build the four source adapters over native official events — **implemented**

**Files**

- Create `lib/execution-observation-sources.js`.
- Create `test/execution-observation-sources.test.mjs`.

**Implementation**

2.1. Agent adapter: register `ctx.on` listeners for the eligible public `agent/*` seams (`agent/created`, `agent/status`, `agent/request`, `agent/request-error`, `agent/error`, `agent/turn-stopping` as available); emit internal `ObservationFragment` with `sourceKind:'agent'`, provable source identity, `observedAt`, and provenance certainty; never read private agent internals and never freeze/mutate the official payload objects (only extract safe public fields).
2.2. Tools adapter: register `tools/pre-execute`, `tools/execute`, `tools/post-execute`, `tools/result`; publish start/phase/terminal candidate fragments. `AbortSignal` alone must NOT be treated as terminal `aborted` — only an owner-committed terminal observation may do so (forward the fragment; the reducer decides).
2.3. Session adapter: register `session/created`, `session/disposed`, `session/event`, `session/flush`; extract `sessionId` for session-scoped history association and session/cause context when public.
2.4. LLM adapter: register `ctx.on('llm/stream', listener)` in a **non-intrusive, fail-open** waterfall listener — record the options `start` fragment, invoke the supplied `next()` exactly once, and return its exact result. Terminal observation is optional and only via a detached observation attaching to the returned thenable/iterable in a way that never alters the continuation, never replaces the returned value, and never produces an unhandled rejection; if unsafe, the LLM source simply stays `start`-only (degraded terminal).
2.5. Isolation & disposal: each adapter is its own contained unit — registration failure, malformed payload, or listener throw degrades only that source's `sourceAvailability` (missing/degraded) and never throws through mount/dispatch; disposal is idempotent and epoch-bound; no events-bus or catalog slice is added; official objects are never mutated.

**Focused verification**

1. Prove each adapter maps its source seams to correct fragments and keeps source provenance (EO-3).
2. Prove missing/degraded/partial source degrades only that source while others remain (EO-3).
3. Prove AbortSignal alone is not committed as `aborted`; only a committed owner terminal is (EO-5).
4. Prove llm/stream continuation semantics are unchanged (same value, same rejection, once) and listener throw cannot break dispatch (EO-8).
5. Prove disposal idempotent and no official object mutation (EO-5, AGENTS fail-safe).

**Requirements covered:** EO-3 AC 1–2, 4; EO-5 AC 1; EO-8 AC 1–2.

## 3. Build session-scoped history, observer epoch and stale guard — **implemented**

**Files**

- Create `lib/execution-observation-history.js`.
- Create `test/execution-observation-history.test.mjs`.

**Implementation**

3.1. Implement bounded `history(sessionId, { limit, cursor? })` returning `{ items, truncated, nextCursor?, unavailable }`; history is **session-scoped only** (never claims session+workspace+profile ownership simultaneously); never presents incomplete history as complete; ordering has explicit metadata and is not identity.
3.2. Implement observer epoch: each `observe`/rebuild uses a fresh `observerEpoch`; reconciliation reuses already-known `executionId` (no duplication); async results are publication-qualified by `ownerId + epoch + generation + non-terminal` before any state publication.
3.3. Implement stale-result rejection: results arriving after owner/epoch/generation/execution is stale are rejected for state publication, never start a retry, never invoke a newer owner's disposer; stale results may remain only as bounded diagnostic provenance.
3.4. Ensure returned history/snapshot data is deeply immutable and independent per observer (caller mutation cannot alter host state or another observer).

**Focused verification**

1. Verify bounded/truncated/nextCursor/unavailable and no synthesized events (EO-4 AC 1, 4).
2. Verify reconnect/rebuild uses new epoch and reconciles without duplicate identities (EO-4 AC 2).
3. Verify deep immutability and observer isolation (EO-4 AC 3).
4. Verify late/stale callbacks are rejected for publication, no retry, no newer disposer invocation, no attempt after terminal (EO-5 AC 3–4).

**Requirements covered:** EO-4 AC 1–4; EO-5 AC 3–4.

## 4. Build visibility policy registry and audience-specific redaction — **implemented**

**Files**

- Create `lib/execution-visibility.js`.
- Create `test/execution-visibility.test.mjs`.

**Implementation**

4.1. Implement default audience redaction in `redactProjection(projection, { audience })`: model/tool audience omits internal execution diagnostics; UI omits secret fields; logs emit only bounded summaries; prompt text, full tool arguments, provider credentials, authorization material and raw error bodies are never in the base projection.
4.2. Implement a single `register(policy)` face in the `visibility` owner following `api-shape.md` §1 policy-registry: policy is a pure function (explicit inputs, no private state reads, no side effects), carries `ownerId + generation`, registration returns an identity-bound disposer; a policy throw degrades only that decision point to the default denial and never throws through apply.
4.3. Fail-closed redaction: if classification/redaction fails the field is omitted and projection becomes `redacted/unavailable`; secret/credential-bearing fields are denied unless an explicit secret policy exists, and the denial never reveals the secret value.
4.4. Keep the visibility face and the projection surface as independent owners sharing no private state.

**Focused verification**

1. Verify default audience output for model/tool, UI, and log audiences including secret-bearing payloads (EO-7 AC 1).
2. Verify explicit non-secret policy registration/disposer and default denial outside the policy (EO-7 AC 2).
3. Verify secret denial and redaction-failure fail-closed without leaking values (EO-7 AC 3).
4. Verify policy throw degrades only that decision point (EO-8).

**Requirements covered:** EO-7 AC 1–3; EO-8 AC 1.

## 5. Assemble the `pluginApi.execution` projection face — **implemented**

**Files**

- Create `lib/execution-observation.js` (facade assembly of reducer + sources + history + visibility).
- Create `test/execution-observation.test.mjs`.

**Implementation**

5.1. Implement the public surface per design: `observe({ sessionId?, since?, signal? })` returning an observer with committed snapshots + subscription + idempotent epoch-bound disposer; `get(executionId)`; `history(sessionId, { limit, cursor? })`; `onChange(listener)` returning a disposer; `visibility.register(policy)`; `availability { sources, epoch }` reflecting `sourceAvailability` and observer epoch. All returned projections/history are deep-frozen.
5.2. `AbortSignal` in `observe` only stops this observer's listening/epoch; it does not commit `aborted` for any execution (EO-5).
5.3. Mutation rejection: the surface does NOT expose retry/route/checkpoint/task mutation; any request for those is simply outside the surface (no member) or rejected without side effect if a defensive member exists.
5.4. Fail-safe assembly: adapter / reducer / listener / history failures are contained at their boundaries; affected source/projection marked degraded/unavailable; the feature never throws through apply and never stops unrelated event dispatch.

**Focused verification**

1. Verify the full API returns frozen committed snapshots with correct identity/lifecycle/history/epoch semantics (EO-1..EO-6).
2. Verify observe disposer is idempotent and epoch-bound, abort stops only this observer without committing `aborted` (EO-5).
3. Verify no mutation/retry/route/checkpoint surface is exposed (EO-8 AC 2).
4. Verify listener/reducer/apply failure isolation (EO-8 AC 1).

**Requirements covered:** EO-1..EO-6; EO-8 AC 1–2.

## 6. Add the `execution` feature guard — **implemented**

**Files**

- Modify `lib/guards.js` additively.
- Create `test/execution-guard.test.mjs`.

**Implementation**

6.1. Add `runFeatureGuard('execution', ctx)` immediately before the unknown-feature fallback. Fail closed only for the mandatory observation substrate `ctx.on` (source adapters cannot register otherwise). All other substrate (agents/tools/llm/sessions feature activity or individual source availability) is **degraded at mount time, not a guard failure** — the feature stays active with `sourceAvailability` marking missing sources.
6.2. Every probe must contain throwing getters/services and report a readable problem; the guard must not inspect payloads, executions, events catalog, or any official service internals.
6.3. Preserve all existing guard branches and `DSH_PLUGIN_API_GUARD_DISABLE` behavior unchanged.

**Focused verification**

1. Prove healthy `ctx.on` passes (with any/all sources missing still passing).
2. Prove missing/throwing `ctx.on` produces `{ ok:false }` + `featureProblems.execution`, without throwing (EO-8).
3. Prove existing feature branches unaffected and no P3/P4 behavior introduced (EO-8, AGENTS §3.0.3).

**Requirements covered:** EO-3 AC 2; EO-8 AC 1, 3.

## 7. Add the disabled service surface and reversible mount/unmount — **implemented**

**Files**

- Modify `lib/plugin-api-service.js` additively.
- Create `test/plugin-api-service-execution.test.mjs`.

**Implementation**

7.1. Add a disabled `execution` factory: every member throws `PluginApiInactiveError` when core is inactive, else `PluginApiFeatureDisabledError('execution')`; `availability` reports unknown/missing source state without touching any official service.
7.2. Wire `Object.defineProperty(this, 'execution', ...)` in the constructor to return the current surface; add `mountFeature('execution', api)` branch and token-bound `unmountFeature('execution', token)` that restores the disabled surface only while the token is current; add `execution` to `KNOWN_FEATURES`.
7.3. `_readSlot`/`_restoreDisabledSurface`/`prepareFeature` must work for `execution` if the mounter uses the prepared transaction path (mirror the `sessionRoute`-style pattern), otherwise keep the immediate-mount path — pick one and keep it consistent with Task 8; do not alter other features.

**Focused verification**

1. Prove P1 (inactive) and P2 (`execution` disabled) calls throw before touching official services (EO-8).
2. Prove mount exposes the owner API and unmount restores disabled surface idempotently; a stale token cannot unmount a later owner (EO-5, AGENTS §3.2).
3. Prove all existing service surfaces remain unchanged (EO-6 client/host separation unaffected).

**Requirements covered:** EO-6 AC 3; EO-8 AC 1–2.

## 8. Integrate the host apply path — **implemented**

**Files**

- Modify `lib/index.js` additively.
- Create `test/index-execution.test.mjs`.

**Implementation**

8.1. Import the `execution` mounter and append `['execution', mountExecutionFeature]` as the **last** entry of `FEATURE_MOUNTERS` (after `remote`), without reordering existing keys; feature key `execution`.
8.2. mounter behavior: returns a disposer (or prepared shape consistent with Task 7); registers `ctx.effect` cleanup; mounts via `featureRegistry.mount('execution')`; if `ctx.on` is absent or any registration/cleanup/publication fails, contain the failure, best-effort rollback/detach partial adapters, disable **only** `execution`, and return normally from `apply()`.
8.3. Repeated `apply()` when `featureRegistry.isActive('execution')` is true must not install a second set of source listeners and must retain existing projections.
8.4. The feature does not require `pluginApi.events` visibility of its own — it consumes native `ctx.on` directly — and must not add any events catalog entry or touch frozen bus/freeze/catalog files.

**Focused verification**

1. Prove healthy apply activates `execution` after the mandatory substrate with exactly one set of source listeners.
2. Prove repeated apply installs no duplicate listeners and retains projections.
3. Prove `ctx.on` failure or registration/effect/publication failures disable only `execution` and never throw through apply (EO-8).
4. Prove no new events catalog slice and no official package modification (AGENTS fail-safe / hard constraints).

**Requirements covered:** EO-6 AC 2–3; EO-8 AC 1–3.

## 9. Update cross-feature registry assertions and run the full suite — **implemented**（完整 `npm test` 1084/1089 通过，5 个失败全部为冻结顺序断言，见 9.2 记录）

**Files**

- Modify non-frozen tests **only** where they hard-code the feature registry name list / count / order: at minimum `test/index-tools.test.mjs`, `test/index-session.test.mjs`, `test/index-session-durable.test.mjs` (append `execution` in the same expected position as `FEATURE_MOUNTERS`), and any other non-frozen file found by grep for the frozen list.
- Do **not** modify frozen `test/index.test.mjs` / `test/index-events.test.mjs`.

**Implementation and verification**

9.1. Update the non-frozen expected feature lists to include `execution` as the appended last feature.
9.2. Run `npm test` (do not run bare `node --test`) and confirm green; if the only failure is the frozen `test/index.test.mjs` ordered `features` assertion, do not edit it — record it as a Wave C integration-owner pending item and report it explicitly in the delivery report.
9.3. Run `git diff --check`, confirm the worktree is clean apart from task-scoped changes, and confirm zero modifications under `/usr/lib/node_modules/@deepseek-ai/dsh/**`.
9.4. Confirm no governance tokens (workflow codenames / classification letters / requirement ids / `r1`-style suffixes) leaked into `lib/` or `test/` implementation code (docs/specs only).

**Requirements covered:** verification gate §7 of `temp/m6-parallel-contract.md`; AGENTS §6; EO coverage already in Tasks 1–8.

## 10. Final verification, registration and Stage 4 completion commit — **implemented**

**Files**

- Update `docs/specs/execution-observation/tasks.md` marking all tasks implemented after they complete.
- Update the matching `execution-observation` row in `docs/specs/plugin-api-features/feature-list.md` (own feature only: namespace `pluginApi.execution`, B facade projection, key surfaces, session-only history, no catalog slice, no R).
- Do not modify `AGENTS.md` (integration owner per contract).

**Verification / governance**

10.1. After all Tasks 1–8 implementation and verification are green (with only the frozen-order exception recorded in 9.2), run the **SPEC3 single global final review**: blocking read-only adversarial review of the entire Stage 4 delivery against Tasks/Design/Requirements (not per-task, whole-delivery), return “无偏差” before continuing.
10.2. Revise across the whole delivery if the review finds issues; re-run the single global final review after substantive revision, until it passes.
10.3. Then run the full suite + `git diff --check`; confirm official DSH packages untouched and the worktree clean; commit **all** Stage 4 code, tests, spec revisions, and the feature-list registration on `feat/m6-execution` (mandatory Stage 4 completion commit) before final delivery/cleanup.
10.4. Report any design/task revision performed during execution; if any discovered issue changes approved Goal/Requirements acceptance boundaries, stop and request a human decision rather than silently weakening the contract (AGENTS §3.2).

**Requirements covered:** AGENTS §3.2 (Stage 4 completion commit, global final review, clean worktree); `temp/m6-parallel-contract.md` §6–7 (commit boundary, evidence, clean-worktree declaration).

---

## Execution order

1. Task 1 creates the pure reducer core and its proof.
2. Task 2 adds the four native event adapters on top of the reducer.
3. Task 3 adds session history/epoch/stale semantics.
4. Task 4 adds visibility/redaction (independent owner).
5. Task 5 assembles the full `pluginApi.execution` face from Tasks 1–4.
6. Task 6 establishes the fail-closed guard for the mandatory substrate.
7. Task 7 provides the P1/P2 disabled surface and reversible mount/unmount.
8. Task 8 joins the feature to the host apply path.
9. Task 9 reconciles non-frozen registry assertions and runs the full suite.
10. Task 10 runs the single global final review, registers the feature, and creates the mandatory Stage 4 commit.

## Wave C 整合注记（integration owner，2026-08-25）

- 契约 `temp/m6-parallel-contract.md` §5 Wave C：按 `EO → PD → MCP → UB` 顺序合入 `feat/m6-integration`，每次 join 全量 `npm test` 绿（join 1：1089/1089；join 2：1137/1137；join 3：1137/1137 + MCP 包内 99/99；join 4：1235/1235；最终全量 1241/1241 含 `pluginApi.mcp` 条件投影）。
- integration-owned 断言维护（本 leaf 任务书 9.2/10.1 声明）：冻结文件 `test/index.test.mjs` / `test/index-events.test.mjs` 与共享 `index-*.test.mjs` 的 features 数量/顺序断言按最终挂载序 `remote → execution → diagnostics → usage` 统一维护（16→19）；`llm/stream`/`tools/pre-execute` 监听计数按 execution/usage 各自 adapter 实际注册数更新（2→3）；`official-passthrough-independence` host-boundary `BRANCH_ADDED_FEATURES` 扩至 `['execution','diagnostics','usage']`，并修复 featureNames/featureActivity 独立排序导致的按名索引错配（改为按名对齐的 pairs 派生）。
- 无偏离上报；本 feature 无修订。
