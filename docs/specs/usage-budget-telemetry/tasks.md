# Tasks: usage-budget-telemetry

> feature_name: `usage-budget-telemetry`
> 状态：Stage 3 Tasks 已批准（Stage 3 边界 `d24f7f8`）；Stage 4 已全部完成（Task 1–12 完成并验证：全量 `npm test` 1182/1187，5 个失败全部为冻结文件顺序断言，见下「Stage 4 执行注记」）；SPEC3 全局终审由 Wave C 整体终审覆盖并通过（无偏差，见文末「Wave C 整合注记」），Stage 4 完成提交 `1c9d23d` 已创建。2026-08-26 复审登记：**待弃用**（pending deprecation，功能组件非门面；弃用动工另行指示，弃用前 API 保持不变）。2026-08-26 已按用户 ANY 指示执行移除（commit `856746f`）：`pluginApi.usage` 整面删除并登记 removed，本 spec 目录保留作历史存档。
> 上游：`requirements.md`（Stage 1 已批准）、`design.md`（Stage 2 已批准，用户已明确批准）。
> 工作流：SPEC3（Stage 3–4）。Stage 3 先做对抗性审查再交用户评审；Stage 4 获批后按本清单自主完成全部任务，**不再逐顶层大任务派审**，全部完成后做一次全局终审，通过后才交付结果报告、提交并清理 worktree。
> 并行契约：`temp/m6-parallel-contract.md`（Wave B `usage-budget-telemetry`，worktree `.worktrees/m6-usage`，分支 `feat/m6-usage`）。
> 派生边界：从已包含 EO Stage 4 提交的边界派生（commit `b7626af`，分支 `feat/m6-execution` 的 `deliver(m6): execution-observation Stage 4 — B facade projection (pluginApi.execution)`）；本 feature 只消费 EO 的 `executionId`/attempt/projection，**禁止自造 execution identity**（UB-2）。

---

## Stage 4 执行注记（完成记录 · 供 Wave C 预检与全局终审核对）

1. **实现偏离（设计细节，不改变验收边界）— `llm/stream` provider-confirmed intake 采用非侵入 pass-through listener**：facade 自身注册的 `ctx.on('llm/stream')` 监听器只做 availability 标记并**原样调用 `next()` 一次、原样返回其结果，绝不消费或替换返回流**（与 EO llm adapter 的 never-alter-continuation 契约一致；消费流会改变下游 continuation，违反 fail-safe/非侵入铁律）。官方 `TokenUsage` chunk 的规范化由纯 normalizer（`normalizeProviderChunk`，映射 `inputTokens/outputTokens/cacheReadTokens/cacheWriteTokens/reasoningTokens`）承担，provider-confirmed 样本经公开 `pluginApi.usage.record` 或 facade 内部 `ingestChunk` 入账。该路径满足 UB-1/UB-2 的规范化、certainty、idempotency 与 correlation 要求；design「直接绑定公开 llm/stream payload」在此落地为「绑定 seam + 入账入口」，已在交付报告显式上报。
2. **实现细节 — settle 后证据性 pricing attach**：settle 成功后 facade 以最新 pricing 计算 `{pricing, cost}` 并 `attachPricing`（settled record 上不可变），scope 累计成本与货币（如 CNY）随后馈入 threshold reconcile；无定价时 cost 保持 `null`/unknown，通知照常带 uncertainty。
3. **冻结文件失败（预期，Wave C integration owner 处理，本 worktree 不改）**：全量 `npm test` 1182/1187；5 个失败全部位于冻结文件（`test/index.test.mjs` ×3：`apply with healthy ctx…` / `feature guard failure…` / `repeated apply…`；`test/index-events.test.mjs` ×2：`events guard failure…` / `web service absence…`），均为 features 数量/顺序硬编码断言（16→18 个 feature），需 integration owner 统一维护。
4. **验证证据**：全量 `npm test` 通过数 1182/1187（上述 5 项冻结失败除外）；`git diff --check` 干净；官方 DSH 包零修改；governance-token-audit（含 `lib/`、`test/`、包清单）0 命中；worktree 除 task 范围内改动外无其他变更。

---

## Scope and execution contract

- **Feature key（guard 分支 / FEATURE_MOUNTERS 键 / feature registry 键）= `usage`**；公开命名空间 = `pluginApi.usage`（B 类门面 + durable mutation + projection，无 R、无新事件）。
- 实现范围：`pluginApi.usage` 的 `record / settle / pricing.register / query / budget.observe`，由三个明确 owner 承载——`durable mutation`（ledger record/settle + pricing 注册）、`projection`（只读 query）、`threshold projection`（`budget.observe` 只读通知）；外加纯 sample normalizer 与 usage 专属 visibility/redaction owner。消费 EO 的 execution/attempt correlation（经已挂载的 `service.execution` 面读取，查找失败只降级为 `correlation unknown`）。
- **明确排除**：deny / route / retry / approval / 自动降级等 policy 动作（UB-6 AC4 / UB-9 AC3）；支付、发票、provider 对账；重建第二份隐藏 token ledger；重定义 execution lifecycle；新 events catalog slice；任何 R replacement；client 写 ledger / 校验 / settle / 注册 pricing；客户端成本 UI 组件（Non-Goals）。
- **允许触碰文件**：
  - 新建 `lib/usage-sample-normalizer.js`、`lib/usage-ledger.js`、`lib/usage-pricing.js`、`lib/usage-query.js`、`lib/usage-threshold.js`、`lib/usage-visibility.js`、`lib/usage.js`（facade 装配）与对应 `test/usage*.test.mjs`（模块粒度见各任务）；
  - `lib/guards.js`（在 unknown fallback 前**追加**一个 `usage` `else if` 分支）；
  - `lib/index.js`（追加 mounter 函数 + 在 `FEATURE_MOUNTERS` **末尾 `execution` 之后**插入 `['usage', mountUsageFeature]`，不重排既有 key；**挂载顺序要求 `usage` 必须在 `execution` 之后**——契约 §3）；
  - `lib/plugin-api-service.js`（追加 disabled `usage` 工厂 + constructor `Object.defineProperty` 一行 + `mountFeature`/`unmountFeature`/`_readSlot`/`_disabledSurfaceFor` 分支 + `KNOWN_FEATURES` 条目）；
  - `docs/specs/usage-budget-telemetry/`（本 feature 自有）；
  - `docs/specs/plugin-api-features/feature-list.md`（只改本 feature 对应的行/登记）。
- **冻结文件（本 worktree 不得修改）**：`lib/events-bus.js`、`lib/deep-freeze.js`、`lib/events-catalog.js`、`test/index.test.mjs`、`test/index-events.test.mjs`。不得新增 events catalog slice；阈值通知经 `budget.observe` 自有订阅面投递，不走 events bus。若 `npm test` 只因冻结核对顺序断言（`test/index.test.mjs` 的 `features` 列表）失败，**不得改冻结文件**，记录为整合期（Wave C integration owner）议题并在交付报告显式上报。
- **主包 `package.json` / 全量 bundle patch / 版本 bump 由 integration owner 处理**；本 worktree 不改主包版本号。
- **EO 依赖边界**：correlation 只读消费已挂载 `service.execution`（`observe/get/history` 面）；EO 面缺失、未挂载或成员抛错 → 该样本 `correlation unknown`（`provenance` 标注），绝不回填/伪造 executionId，绝不影响 ledger 主体写入。不得在 UB 内 import/require EO 模块私有状态。
- 终态词汇固定：mutation `commitState` 只取 `success | error | aborted | denied | superseded`；`settledAt` 是生命周期元数据，不得当 outcome。timeout 映射为 `commitState:'error'` + 分类字段（不引入 `timeout` 终态）。`provisional / late / replay` 只作样本/记录标记，不是终态。
- 所有公开快照/通知深冻结只读；observer/disposer 幂等且 identity-bound；`AbortSignal` 只停止采集，不自行提交 ledger outcome；一旦 `aborted|denied|superseded` 已提交，迟到 usage 不得再开新 attempt（UB-7 AC5）。
- 测试统一 `npm test`（`node --test "test/**/*.mjs"`）；不用裸 `node --test`；临时脚本放 `temp/` 用毕即删。
- 治理魔法字母 / 工作流代号（SPEC/ANY/A/B/C/R 编号、`UB-x` 等）只允许出现在 docs 制品与本文件，**不得进入 `lib/`、`test/`、bundle patch、package.json** 等实现产物。

---

## 1. Build the pure sample normalizer core — **implemented**

**Files**

- Create `lib/usage-sample-normalizer.js`.
- Create `test/usage-sample-normalizer.test.mjs`.

**Implementation**

1.1. Define the canonical `UsageSample` shape exactly per design Data Models (deep-frozen read-only): `sampleId, operationId, executionId?, attempt?, provider?, model?, metrics {input?, output?, cache?, reasoning?, total?}, source ('provider-confirmed'|'estimated'|'mixed'), estimator?, observedAt, late?, replay?`. Missing provider/model remains **explicit unknown**（可查询但绝不猜补）.
1.2. Implement `normalizeProviderChunk(chunk, { operationId, executionId?, attempt?, provider?, model? })`: extract available input/output/cache/reasoning/total from the official `llm/stream` `usage` chunk payload without changing raw value semantics; mark `source:'provider-confirmed'`; keep raw missing fields absent (not zero, not synthesized).
1.3. Implement `normalizeEstimate(estimate, { estimator, operationId, executionId?, attempt?, provider?, model? })`: values without provider confirmation are marked `source:'estimated'` with `estimator` provenance; **never reported as provider-confirmed** (UB-1 AC2).
1.4. Implement the precedence/aggregation rule for coexisting confirmed+estimated samples on the same execution/attempt (UB-1 AC3): confirmed values are authoritative and counted first; estimated values are counted **only** for metrics the confirmed sample does not provide, each retaining its own `source`/certainty; the two are never summed into a silent double-count; record the chosen aggregation basis on the resulting normalized sample set.
1.5. Implement idempotency key derivation: deterministic from `(ownerId, generation, operationId, sampleId)` supplied by the source/caller — **never** from event sequence, timestamp, or array position (UB-2 AC3).
1.6. Correlation discipline: the normalizer only **carries** a caller-provided `executionId`/`attempt` (from the EO projection); it never generates, infers, or rewrites them; `executionId===undefined` stays `undefined` (correlation unknown) and is never filled from ordering.
1.7. Keep the module a pure function of its inputs (zero DSH harness dependency), returning deep-frozen snapshots via the frozen `deepFreeze` helper (import only, never modify).

**Focused verification**

1. Verify normalized confirmed sample preserves every raw metric and leaves missing fields absent, not zero-ed (UB-1 AC1).
2. Verify estimated sample keeps `source:'estimated'` + `estimator` and is never reported as confirmed (UB-1 AC2).
3. Verify the confirmed-first precedence/aggregation rule on mixed values: no silent double-count, each source/certainty retained, basis recorded (UB-1 AC3).
4. Verify missing provider/model stays explicit unknown and is never guessed (UB-1 AC4).
5. Verify `executionId`/`attempt` are carried verbatim or absent; undefined correlation is never synthesized from seq/time/position (UB-2 AC3).
6. Verify idempotency key equality is deterministic on the tuple and independent of sequence/time (UB-3).
7. Verify deep immutability: caller mutation of a returned sample does not alter host state (EO-4 pattern / AGENTS §6).

**Requirements covered:** UB-1 AC1–4; UB-2 AC3; UB-3 (idempotency key basis).

## 2. Build the durable ledger mutation owner — **implemented**

**Files**

- Create `lib/usage-ledger.js`.
- Create `test/usage-ledger.test.mjs`.

**Implementation**

2.1. Implement `record(sample, { ownerId, generation, operationId, scope })`: `scope` shall be exactly one of `session|workspace|profile` (required, single); every committed record carries `recordId, scope, ownerId, generation, commitState`; store the normalized `UsageSample` set from Task 1.
2.2. Idempotent replay with CAS: deduplicate by `(ownerId, generation, operationId, sampleId)`; equivalent-content replay is a no-op (no second charge); conflicting-content replay rejects or records a fail-closed conflict diagnostic and never picks one value silently (UB-3 AC3–AC4).
2.3. Implement `settle(executionId, { attempts, scope, ownerId, generation, operationId })`: atomically mark the settle state and totals for that execution/attempt set; a later settle is a no-op or an explicit conflict, never a second charge (UB-3 AC5). Totals aggregation for the settle uses the Task 1 precedence/aggregation basis per attempt/source.
2.4. Terminal vocabulary: expose `commitState` using only `success | error | aborted | denied | superseded`; `settledAt` remains lifecycle metadata and is not an outcome. Timeout maps to `commitState:'error'` + a classification field; no `timeout` terminal (UB-3 AC2).
2.5. Atomicity / rollback: a multi-step update that cannot commit completely must leave no partially committed total visible as a successful settle and expose a rollback/fail-closed commit state (UB-3 AC6). Partial streams retain observed samples and mark aborted/provisional provenance without synthesizing missing provider usage (UB-7 AC1).
2.6. Unknown / undeclared operations are rejected by default and never auto-retried (UB-3 AC7, UB-9 AC2); capability is declared per operation.
2.7. Stale guards: async ingest that arrives after its `ownerId`/`generation`/execution/ledger commit is no longer current is rejected for state update and never invokes a newer owner's disposer; stale results remain only as bounded diagnostic provenance (UB-7 AC4). Once `aborted|denied|superseded` is committed, late usage cannot start an attempt (UB-7 AC5). Reconnect replay is accepted only as idempotent replay with `replay` provenance (UB-7 AC3).
2.8. One-scope rule: each durable record belongs to exactly one `session|workspace|profile`; cross-scope totals are separate records/identities/commit-states (UB-4 AC1). Mutation disposer is idempotent and may remove only records owned by the current owner+generation (identity-bound).

**Focused verification**

1. Verify owner/generation/operation/scope are all required and one-scope per record is enforced (UB-3 AC1, UB-4 AC1).
2. Verify equivalent replay is no-op and conflicting replay is fail-closed (UB-3 AC3–AC4).
3. Verify atomic settle for an attempt set is committed exactly once; second settle is no-op/conflict; rollback makes partial commit invisible as success (UB-3 AC5–AC6).
4. Verify `commitState` vocabulary and `settledAt`-as-metadata separation; timeout as `error`+classification (UB-3 AC2).
5. Verify partial/abort keeps observed samples, and reconnect replay dedupes with `replay` provenance (UB-7 AC1, AC3).
6. Verify stale owner/generation results are rejected from totals and never dispose a newer owner; no new attempt after committed aborted/denied/superseded (UB-7 AC4–AC5).
7. Verify unknown/undeclared operations are rejected and never auto-retried (UB-9 AC2).

**Requirements covered:** UB-1 AC3; UB-3 AC1–7; UB-4 AC1; UB-7 AC1, AC3–AC5; UB-9 AC2.

## 3. Build the pricing registry and cost determination — **implemented**

**Files**

- Create `lib/usage-pricing.js`.
- Create `test/usage-pricing.test.mjs`.

**Implementation**

3.1. Implement `pricing.register({ provider, model, revision, currency, units })`: evidence-only registration — SHALL NOT alter execution routing, provider selection, or approval decisions (UB-5 AC4). Registration is idempotent per (provider, model, revision); owner/generation-bound.
3.2. Implement cost conversion `costFor(record, pricing)`: when converting a record/sample to cost, record the pricing identity/revision, currency/unit, calculation `basis`, and `pricing.certainty` (`confirmed|estimated|unknown`), and update the record's `pricing` metadata (UB-5 AC1). Aggregation basis follows Task 1/2 (confirmed-first, no silent double-count).
3.3. Missing price: no matching price → keep usage intact and mark cost `unknown` (`totals` value `null` / cost-unavailable); **never** invent a zero or current-price value; `null` cost is never presented as a final total nor read as a zero charge (UB-5 AC2).
3.4. Revision immutability: a pricing revision is immutable on a settled record; a revaluation, if later approved, is an explicit new operation and not an in-place rewrite of the settled record (UB-5 AC3). Stale pricing revision results are rejected like Task 2 stale guards.
3.5. Keep the module self-contained and deterministic (zero DSH harness dependency for the pure cost math); prices/records stay deep-frozen.

**Focused verification**

1. Verify registered pricing gives cost with identity/revision/currency/basis/certainty recorded on the record (UB-5 AC1).
2. Verify no-matching-price keeps usage intact with cost `unknown`/null and never zero/current-price (UB-5 AC2).
3. Verify revision change does not rewrite an already-settled record; revaluation is a distinct operation (UB-5 AC3).
4. Verify pricing registration has zero effect on routing/provider/approval surfaces (UB-5 AC4).
5. Verify scope/owner/generation guards and deep immutability of returned pricing metadata.

**Requirements covered:** UB-5 AC1–4; UB-3 AC7; UB-7 AC4 (stale pricing result).

## 4. Build the query projection owner — **implemented**

**Files**

- Create `lib/usage-query.js`.
- Create `test/usage-query.test.mjs`.

**Implementation**

4.1. Implement `query({ executionId?, sessionId?, workspaceId?, profileId?, day?, provider?, model? })`: returns **only** records authorized for the requested scope and identifies which scope each result belongs to (UB-4 AC2). Date/provider/model are index dimensions inside a scope, not additional scopes.
4.2. Cross-scope report: MAY combine separately owned records (session/workspace/profile aggregates as separate records with own identities/commit states) but no single record or mutation claims multiple scopes (UB-4 AC3).
4.3. Completeness honesty: missing/truncated/still-provisional records are identified (`provisional`, `truncated`, `unavailable` flags) and an incomplete total is never presented as final (UB-4 AC4; cost `null` per Task 3).
4.4. The query face is a read-only projection: never writes, never registers pricing, never mutates ledger; results are deep-frozen (api-shape.md §1 projection face).
4.5. Degradation: query failures are contained and exposed as an explicit `unavailable`/degated projection, never thrown through callers or the host apply path.

**Focused verification**

1. Verify per-scope query returns only that scope's records with the scope identified on each result (UB-4 AC2).
2. Verify cross-scope report combines separate records without a multi-scope claim on any single record (UB-4 AC3).
3. Verify missing/truncated/provisional states are flagged and incomplete totals are not final (UB-4 AC4).
4. Verify query by execution/date/provider/model index works inside the requested scope.
5. Verify read-only: query produces no ledger/pricing mutation and deep-frozen results (caller mutation has no host effect).

**Requirements covered:** UB-4 AC2–4; UB-5 AC2 (unknown cost presentation).

## 5. Build the budget threshold projection owner — **implemented**

**Files**

- Create `lib/usage-threshold.js`.
- Create `test/usage-threshold.test.mjs`.

**Implementation**

5.1. Implement `budget.observe({ scope, thresholdId, limit, unit, generation }, listener)`: consumes committed usage projection for a single budget scope; emits a deterministic crossing notification containing `{ scope, thresholdId, observedTotal, currency/unit, sourceCertainty, generation, observedAt }` (UB-6 AC1). Returns a disposer.
5.2. Crossing dedup: the same threshold remaining crossed across duplicate samples/repeated queries does NOT emit an unbounded duplicate notification; a new `generation` (or explicit reset) MAY emit a new crossing (UB-6 AC2). Notifications are deterministic per threshold generation.
5.3. Uncertainty honesty: when the total is provisional (estimated/late/incomplete samples), the notification SHALL state that uncertainty and never claim a provider-confirmed bill (UB-6 AC3).
5.4. Observational only: notifications never deny/reroute/retry/auto-degrade an execution under this feature; the owner has no policy/call surface (UB-6 AC4).
5.5. The owner is a read-only projection: observer subscription + disposer (identity-bound, idempotent); listener throw is contained (only that listener/notification degrades); notifications are deep-frozen.

**Focused verification**

1. Verify one deterministic crossing notification per threshold generation with all required fields (UB-6 AC1).
2. Verify no unbounded duplicate on repeated/duplicate crossing; new generation emits a fresh crossing (UB-6 AC2).
3. Verify provisional/estimated totals are marked uncertain and never claimed as provider-confirmed (UB-6 AC3).
4. Verify the threshold owner cannot trigger deny/route/retry/degradation — no such surface exists (UB-6 AC4).
5. Verify disposer idempotent/identity-bound, listener failure containment, and frozen notification payloads.

**Requirements covered:** UB-6 AC1–4; UB-8 AC3 (redacted notification payloads — feed from Task 6).

## 6. Build the usage visibility/redaction owner — **implemented**

**Files**

- Create `lib/usage-visibility.js`.
- Create `test/usage-visibility.test.mjs`.

**Implementation**

6.1. Implement default audience redaction `redact(recordOrTotal, { audience })` per `docs/standards/visibility-and-redaction.md` §1: model/tool audience omits internal usage diagnostics; UI audience omits secret fields; log audience emits only bounded usage/cost summaries (totals, certainty, pricing revision) — never prompts, raw tool arguments, credentials, or provider authorization data (UB-8 AC1).
6.2. Non-secret exposure: when a non-secret usage field is exposed to a permitted audience it retains source, timestamp, certainty, pricing revision, and scope metadata (UB-8 AC2).
6.3. Secret-bearing provider metadata or raw content is redacted **before** ledger projection, threshold notification, log, and client publication; redaction/classification failure fails closed (field omitted / `unavailable`) and never reveals the secret value (UB-8 AC3). Cover nested provider metadata and raw content, not just keyword removal (visibility standard §3).
6.4. Implement a single `register(policy)` face following `api-shape.md` §1 policy-registry: policy is a pure function (explicit inputs, no private state reads, no side effects), carries `ownerId + generation`, registration returns an identity-bound disposer; policy throw degrades only that decision point to the default denial and never throws through apply (UB-8 AC2).

**Focused verification**

1. Verify default model/tool/UI/log output omits internal diagnostics/secrets and logs only bounded summaries (UB-8 AC1).
2. Verify non-secret exposure retains source/timestamp/certainty/pricing/scope metadata (UB-8 AC2).
3. Verify secret-bearing nested provider metadata/raw content is redacted before projection/notification/log/publication; redaction failure fails closed without leaking values (UB-8 AC3, visibility §3).
4. Verify single-register pure-function policy + identity-bound disposer; policy throw degrades only that decision point (api-shape.md §1).

**Requirements covered:** UB-8 AC1–3; `docs/standards/visibility-and-redaction.md` §1–§3.

## 7. Assemble the `pluginApi.usage` face (source intake + facade + boundary + fail-safe) — **implemented**

**Files**

- Create `lib/usage.js` (facade assembly of normalizer + ledger + pricing + query + threshold + visibility).
- Create `test/usage-facade.test.mjs`.

**Implementation**

7.1. Implement the public surface per design: `record(sample, { scope, ownerId, generation, operationId })`, `settle(executionId, { attempts, scope, ownerId, generation, operationId })`, `pricing.register({ provider, model, revision, currency, units })`, `query({ executionId?, sessionId?, workspaceId?, profileId?, day?, provider?, model? })`, `budget.observe(...)`, plus `availability` (sources: llm-stream/tokenMeter/execution-correlation; ledger/query/threshold owner state). All returned snapshots/notifications are deep-frozen.
7.2. **Provider-confirmed sample intake**: register a non-intrusive, fail-open `ctx.on('llm/stream', listener)` waterfall — extract the `usage` chunk payload, normalize via Task 1 with `source:'provider-confirmed'`, invoke the supplied `next()` exactly once, and return its exact result/continuation; a listener throw or malformed payload degrades only this source's `availability.llmStream` and never throws through dispatch (mirror the EO `llm/stream` adapter pattern).
7.3. **Estimated sample intake**: resolve the official `tokenMeter` service via `ctx` when available (fail-open); produce `source:'estimated'` samples with `estimator` provenance through Task 1; **never** claim tokenMeter output as provider-confirmed and **never** create a second hidden token ledger (UB-9 AC3). Missing tokenMeter degrades `availability.tokenMeter` only.
7.4. **Execution correlation intake**: look up `service.execution` (already-mounted EO face) to correlate samples to the existing `executionId`/attempt; an internal retry reuses the same `executionId`/attempt, an external caller re-running the same operation gets its new EO execution identity; when correlation is unavailable/unknown the sample is recorded with `correlation unknown` and identity is never inferred from seq/time/position (UB-2 AC1–AC3). Late samples after an EO terminal are accepted only under the declared late rule as `late`/`provisional` and never rewrite the execution outcome or start a new attempt (UB-2 AC4). Lookup failures degrade `availability.correlation`, never the ledger body.
7.5. **Boundary rejection**: deny/route/retry/approval/auto-degradation requests through the usage surface are rejected as outside this feature's contract; cross-scope writes, policy actions, payment/invoice reconciliation, and client writes to the ledger are rejected as boundary violations; AbortSignal only stops further collection and does not itself commit a ledger outcome; deadline expiry classifies the operation as `error` with a timeout reason (UB-7 AC2, UB-9 AC3).
7.6. Fail-safe assembly: normalization, execution lookup, pricing, transaction, query, threshold, and publication failures are contained at their boundaries — a failed telemetry op reports a bounded diagnostic and leaves provider/tool execution unchanged; `apply` never throws through boot; a broken usage owner never alters the operation being measured (UB-9 AC1).

**Focused verification**

1. Verify full API returns frozen committed records/totals with correct scope/identity/lifecycle semantics (UB-1…UB-5).
2. Verify `llm/stream` continuation semantics are unchanged (same value, same rejection, once) and listener throw cannot break dispatch (UB-9 AC1).
3. Verify tokenMeter estimate is marked estimated/estimator and never confirmed; no second hidden ledger (UB-9 AC3).
4. Verify correlation intake reads EO execution/attempt verbatim, degrades to unknown, never infers identity (UB-2 AC1–AC3).
5. Verify boundary: deny/route/retry/approval/degradation and client-write requests are rejected (UB-9 AC3; Non-Goals).
6. Verify abort stops collection without committing an outcome; deadline → `error`+timeout; late-after-terminal is only `late`/`provisional`, no new attempt (UB-2 AC4, UB-7 AC2).
7. Verify failure isolation: applying a failing telemetry op never interrupts the measured operation (UB-9 AC1).

**Requirements covered:** UB-1 AC1–2; UB-2 AC1–2, AC4; UB-7 AC2; UB-9 AC1, AC3.

## 8. Add the `usage` feature guard — **implemented**

**Files**

- Modify `lib/guards.js` additively.
- Create `test/usage-guard.test.mjs`.

**Implementation**

8.1. Add `runFeatureGuard('usage', ctx)` immediately before the unknown-feature fallback. Fail closed only for the mandatory observation substrate `ctx.on` (the provider-confirmed `llm/stream` sample intake cannot register otherwise). All other substrate (`service.execution` correlation, `llm/stream` presence, `tokenMeter` presence, individual source availability) is **degraded at mount time, not a guard failure** — the feature stays active with `availability` marking missing sources.
8.2. Every probe must contain throwing getters/services and report a readable problem; the guard must not inspect payloads, ledger records, executions, events catalog, or any official service internals.
8.3. Preserve all existing guard branches and `DSH_PLUGIN_API_GUARD_DISABLE` behavior unchanged.

**Focused verification**

1. Prove healthy `ctx.on` passes with any/all optional sources missing still passing.
2. Prove missing/throwing `ctx.on` produces `{ ok:false }` + `featureProblems.usage`, without throwing (UB-9 AC1).
3. Prove existing feature branches unaffected and no P3/P4 behavior introduced (AGENTS §3.0.3).

**Requirements covered:** UB-2 (degraded correlation); UB-9 AC1, AC3.

## 9. Add the disabled service surface and reversible mount/unmount — **implemented**

**Files**

- Modify `lib/plugin-api-service.js` additively.
- Create `test/plugin-api-service-usage.test.mjs`.

**Implementation**

9.1. Add a disabled `usage` factory: every member throws `PluginApiInactiveError` when core is inactive, else `PluginApiFeatureDisabledError('usage')`; `availability` reports unknown/missing source state without touching any official service.
9.2. Wire `Object.defineProperty(this, 'usage', ...)` in the constructor to return the current surface; add `mountFeature('usage', api)` branch (with shape validation: `record`/`settle`/`pricing.register`/`query`/`budget.observe` present) and token-bound `unmountFeature('usage', token)` that restores the disabled surface only while the token is current; add `usage` to `KNOWN_FEATURES`; add the `_readSlot('usage')` / `_disabledSurfaceFor('usage')` / `_restoreDisabledSurface` handling consistent with the `execution` pattern.
9.3. Do not alter other features.

**Focused verification**

1. Prove P1 (inactive) and P2 (`usage` disabled) calls throw before touching official services (UB-9 AC1).
2. Prove mount exposes the owner API and unmount restores disabled surface idempotently; a stale token cannot unmount a later owner (AGENTS §3.2 / concurrency §5).
3. Prove all existing service surfaces remain unchanged.

**Requirements covered:** UB-9 AC1–AC2.

## 10. Integrate the host apply path — **implemented**

**Files**

- Modify `lib/index.js` additively.
- Create `test/index-usage.test.mjs`.

**Implementation**

10.1. Import the `usage` mounter and append `['usage', mountUsageFeature]` as the **last** entry of `FEATURE_MOUNTERS` (after `execution`), without reordering existing keys; feature key `usage`; mount order `execution → usage` preserved (contract §3).
10.2. mounter behavior: reads `ctx`/`service`/`featureRegistry`/`logger`; creates the owner assembly (`createUsage`), wires optional `service.execution` correlation handle (fail-open/degrade), registers the `llm/stream` intake listener and optional tokenMeter hook, registers `ctx.effect` cleanup, mounts via `featureRegistry.mount('usage')` / `service.prepareFeature('usage', owner.api)`; on any failure contain it, best-effort rollback/detach intake, disable **only** `usage`, and return normally from `apply()`.
10.3. Repeated `apply()` when `featureRegistry.isActive('usage')` is true must not install a second set of `llm/stream` intake listeners and must retain existing ledger/projections.
10.4. The feature consumes `pluginApi.execution` only through the already-mounted EO face (not a private import) and must not add any events catalog entry or touch frozen bus/freeze/catalog files.

**Focused verification**

1. Prove healthy apply activates `usage` after `execution` with exactly one set of intake listeners.
2. Prove repeated apply installs no duplicate listeners and retains projections.
3. Prove `ctx.on` failure or intake/effect/publication failures disable only `usage` and never throw through apply (UB-9 AC1).
4. Prove EO face consumption degrades when EO unavailable and never blocks the ledger (UB-2 AC3).
5. Prove no new events catalog slice and no official package modification (AGENTS fail-safe / hard constraints).

**Requirements covered:** UB-1 AC1–2; UB-2 AC1–AC4; UB-9 AC1, AC3.

## 11. Update cross-feature registry assertions and run the full suite — **implemented**

**Files**

- Modify non-frozen tests **only** where they hard-code the feature registry name list / count / order: append `usage` in the same expected position as `FEATURE_MOUNTERS` (after `execution`) — e.g. any non-frozen file found by grep for the feature list (**do not** modify frozen `test/index.test.mjs` / `test/index-events.test.mjs`).
- Do **not** modify frozen files.

**Implementation and verification**

11.1. Update the non-frozen expected feature lists to include `usage` in the appended position.
11.2. Run `npm test` (do not run bare `node --test`) and confirm green; if the only failure is the frozen `test/index.test.mjs` ordered `features` assertion, do not edit it — record it as a Wave C integration-owner pending item and report it explicitly in the delivery report.
11.3. Run `git diff --check`, confirm the worktree is clean apart from task-scoped changes, and confirm zero modifications under `/usr/lib/node_modules/@deepseek-ai/dsh/**`.
11.4. Confirm no governance tokens (workflow codenames / classification letters / requirement ids / `r1`-style suffixes) leaked into `lib/` or `test/` implementation code (docs/specs only).

**Requirements covered:** verification gate §7 of `temp/m6-parallel-contract.md`; AGENTS §6; UB coverage already in Tasks 1–10.

## 12. Final verification, registration and Stage 4 completion commit — **implemented**

**Files**

- Update `docs/specs/usage-budget-telemetry/tasks.md` marking all tasks implemented after they complete.
- Update the matching `usage-budget-telemetry` row in `docs/specs/plugin-api-features/feature-list.md` (own feature only: namespace `pluginApi.usage`, B facade + durable mutation + projection, key surfaces, three owners, EO correlation dependency, no catalog slice, no R, no version bump).
- Do not modify `AGENTS.md` (integration owner per contract).

**Verification / governance**

12.1. After all Tasks 1–11 implementation and verification are green (with only the frozen-order exception recorded in 11.2), run the **SPEC3 single global final review**: blocking read-only adversarial review of the entire Stage 4 delivery against Tasks/Design/Requirements (not per-task, whole-delivery), return “无偏差” before continuing.
12.2. Revise across the whole delivery if the review finds issues; re-run the single global final review after substantive revision, until it passes.
12.3. Then run the full suite + `git diff --check`; confirm official DSH packages untouched and the worktree clean; commit **all** Stage 4 code, tests, spec revisions, and the feature-list registration on `feat/m6-usage` (mandatory Stage 4 completion commit) before final delivery/cleanup.
12.4. Report any design/task revision performed during execution; if any discovered issue changes approved Goal/Requirements acceptance boundaries, stop and request a human decision rather than silently weakening the contract (AGENTS §3.2).

**Requirements covered:** AGENTS §3.2 (Stage 4 completion commit, global final review, clean worktree); `temp/m6-parallel-contract.md` §6–7 (commit boundary, evidence, clean-worktree declaration).

---

## Execution order

1. Task 1 creates the pure normalizer and its proof.
2. Task 2 builds the durable ledger mutation owner on top of the normalized samples.
3. Task 3 adds the pricing registry / cost determination (independent owner).
4. Task 4 adds the read-only query projection owner.
5. Task 5 adds the budget threshold projection owner.
6. Task 6 adds the usage visibility/redaction owner.
7. Task 7 assembles the full `pluginApi.usage` face from Tasks 1–6 plus source intake and boundary.
8. Task 8 establishes the fail-closed guard for the mandatory substrate.
9. Task 9 provides the P1/P2 disabled surface and reversible mount/unmount.
10. Task 10 joins the feature to the host apply path (after `execution`).
11. Task 11 reconciles non-frozen registry assertions and runs the full suite.
12. Task 12 runs the single global final review, registers the feature, and creates the mandatory Stage 4 commit.

## Wave C 整合注记（integration owner，2026-08-25）

- 契约 §5 Wave C 合入顺序 `EO → PD → MCP → UB`，join 4 全量 `npm test` 1235/1235 绿；最终全量 1241/1241。
- **流程缺口登记**：本 leaf tasks.md 状态行仍记录 "SPEC3 全局终审待执行"，但 Stage 4 完成提交已创建（`1c9d23d`）——全局终审的执行/结果未在任务书留痕。Wave C 全局终审将对包含本 feature 的整体交付执行只读对抗性审查并覆盖此缺口（AGENTS §3.2 要求终审通过后才可交付结果报告与完成提交；若 Wave C 终审发现问题将按整批修订流程处理）。
- integration-owned 断言维护：最终挂载序 `remote → execution → diagnostics → usage`（`usage` 在 `execution` 之后，契约 §3）；features 数量 16→19；`llm/stream` 监听计数含 usage pass-through intake（2→3）。
- 本 feature 实现偏离（llm/stream pass-through intake）已在交付报告登记；Wave C 复核与 Tasks/Design 一致，无需修订。
