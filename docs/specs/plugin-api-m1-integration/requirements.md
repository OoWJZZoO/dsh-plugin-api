# Requirements: plugin-api-m1-integration

> feature_name: `plugin-api-m1-integration`
> 状态：草案（Stage 1，待用户评审）
> 类型标注：本 feature 全部为**门面基础**（不引出任何新钩子；A/B/C 分类不适用，行为目标是保持既有 A/B 类 feature 的语义不变）
> 面：仅 host 面（无 client 面变更）

---

## Introduction

M1 由 7 个 worktree 并行实现（`m1/agent`、`m1/capabilities`、`m1/llm`、`m1/session`、`m1/settings`、`m1/system-prompt`、`m1/tools`），合并前预检确认：

- **功能覆盖完整、无夹带**（M1 全量 feature 均有实现与测试，无 M2+ 越界）；
- **1 个功能阻断**：`m1/session` 的 S1 事件因基线总线用模块级 `catalogEntryOf`（绑死基线 19 条 catalog）解析元数据，组合 catalog 成为死数据，4 个 `session/*` 事件静默落回裸 `ctx.on`，E9/E10/E11 承诺全部未兑现；
- **4 处平行发明**：catalog 条目 schema（`subject`→`scopeKey` 改名 + `fault`/`freeze` 字段 vs `feature` 字段 vs `freeze:'except-signal'` 词汇）、冻结策略实现（`freezeByPolicy` vs `deepFreezeExceptSignal`）、scope 解析分支（`args[1].scope` 仅存于一个分支）、catalog 组合机制（原地追加 vs `composeCatalogs` vs `mergeEventCatalogs`）；
- **工程契约分叉**：FEATURE_MOUNTERS 顺序依赖未固化、幂等信号三种形态、失败呈现三种形态、`pluginApi.tools` getter 无 fail-safe；
- **API 形状负债**：`web` 顶层直通与 `services.*` 安置规则不一致等。

依据 AGENTS.md §3.0.1（纯本地开发阶段，零发布负债窗口），本 feature 的目标是**一次整合、一次统一**：把 7 个分支整合进 main，同时把事件总线契约、门面工程契约、API 形状规则统一为唯一版本，并产出并行开发工作流协议文档。

**范围外（明确不做）**：不实现任何 M2/M3/M4 feature；不修改官方 DSH 包文件；不引入新的官方事件；不改变 E1–E12 与 L1 admission 的既有行为语义（catalog 字段改名与 `web` 重定位除外，二者为本 feature 的明示变更）。

---

## 1. 统一事件目录 schema（门面基础）

**User Story**: As a downstream feature developer, I want `pluginApi.events.catalog` to have one authoritative entry schema, so that extending the catalog never requires guessing or inventing fields.

**Acceptance Criteria**:

1. WHEN any catalog entry is read, THEN it SHALL contain the unified field set: `name`, `mode`, `scopeFiltered`, `scopeKey`, `payload`, `args`, `source`, `type`, plus the optional policy fields `fault` and `freeze`. No other policy fields SHALL exist (the `feature` gating field is superseded by §2.11's chosen mechanism).
2. WHEN the integration completes, THEN the field rename `subject` → `scopeKey` SHALL be applied to every entry and every consumer (bus, tests, docs); the name `subject` SHALL NOT remain in the catalog contract.
3. WHEN the `scopeKey` field is read, THEN its value domain SHALL be `'args[0].agent' | 'args[1].scope' | null | undefined` with the semantics: `'args[0].agent'` = agent from first arg; `'args[1].scope'` = scope from second arg (official `system-prompt/assemble` invariant); `null` = presence-only via dispatch carrier (`carrierKeyOf`); `undefined` = not scope-filtered.
4. WHEN an entry omits `fault`, THEN the bus SHALL treat it as `'contain'`.
5. WHEN an entry omits `freeze`, THEN the bus SHALL treat it as `'all'` (preserving E9 deep-freeze semantics for all existing entries).
6. WHEN the catalog object or any entry is mutated, THEN the mutation SHALL NOT be observable (the composed catalog SHALL be deeply frozen; inherited from E12).

## 2. 统一事件总线契约（门面基础）

**User Story**: As a third-party plugin author, I want every cataloged event to receive identical facade treatment regardless of which feature contributed it, so that my listeners' priority/freeze/fault/scope behavior is predictable.

**Acceptance Criteria**:

1. WHEN the bus resolves event metadata (at subscribe time and at dispatch time), THEN it SHALL resolve against the catalog injected into the bus, and SHALL NOT resolve against a module-level catalog singleton.
2. WHEN a cataloged event dispatches listener arguments, THEN the bus SHALL apply the entry's freeze policy, where the vocabulary is exactly: `'all'` (deep-freeze every argument), `{ deep: string[] }` (shallow-freeze the top level; deep-freeze only the listed top-level fields), `'except-signal'` (deep-freeze everything except the top-level `signal` property).
3. WHEN any freeze policy is applied, THEN the freeze operation SHALL never throw (unfreezable values pass through unchanged).
4. WHEN an entry's `fault` is `'propagate'`, THEN listener throws/rejections SHALL reach the official dispatcher unchanged (no containment, no thenable wrap).
5. WHEN an entry's `fault` is `'created'`, THEN synchronous throws SHALL propagate (preserving the official sync-veto of `agent/created`) and asynchronous rejections SHALL be contained and reported.
6. WHEN an entry's `fault` is `'contain'` or absent, THEN listener failure SHALL be contained and reported without interrupting dispatch (baseline E11 behavior).
7. WHEN a scoped subscription receives a scope-filtered event, THEN the bus SHALL resolve the scope key per the entry's `scopeKey`, supporting all three resolution modes of §1.3.
8. WHEN multiple catalog slices are combined, THEN the integration SHALL provide exactly one composition mechanism, and it SHALL fail loud (throw) on duplicate event names.
9. WHEN the composed catalog is built at mount time, THEN composition SHALL support including or excluding a slice based on the contributing feature's state at mount time (the tools slice is included only when the tools feature is active).
10. WHEN any cataloged event — including the four `session/*` lifecycle events — is subscribed through `pluginApi.events`, THEN it SHALL receive full facade treatment (priority ordering, freeze policy, fault policy, scope gating), and the suite SHALL include at least one end-to-end test per contributed slice asserting that treatment (not merely catalog presence or hook registration).
11. GIVEN a feature that contributes catalog entries is disabled, WHEN the composed catalog is built at mount time, THEN that feature's slice SHALL be excluded from the composed catalog (mount-time catalog exclusion is the one and only gating mechanism), and subscriptions to the excluded event names SHALL receive the standard non-cataloged pass-through treatment (untyped, unsupported, no facade treatment); the bus SHALL NOT consult any feature registry state at subscribe time, and the subscribe-time `PluginApiFeatureDisabledError` gating mechanism SHALL be removed.

## 3. 门面工程契约统一（门面基础）

**User Story**: As a facade maintainer, I want every feature mounted through one mount/idempotency/failure-presentation contract, so that future features follow a single pattern.

**Acceptance Criteria**:

1. WHEN apply runs, THEN the mount order SHALL satisfy the documented dependencies: `tools` before `events` (events composition reads tools state), `events` before `session` (session mount requires an active events feature); the order and both dependencies SHALL be covered by tests.
2. WHEN apply re-runs against a reused service (idempotent re-apply), THEN every mounter SHALL short-circuit on one unified kind of state signal, and constant-`isActive` short-circuits SHALL be eliminated.
3. WHEN `pluginApi.tools` is accessed, THEN the accessor SHALL preserve scope-aware resolution (via the caller's context), and any resolution failure or throw SHALL surface as a typed facade error, never as a raw error escaping into third-party code.
4. WHEN a feature's official service is absent or malformed, THEN the failure presentation SHALL be exactly one of the documented typed paths per feature category: feature disabled (`PluginApiFeatureDisabledError`), inactive core (`PluginApiInactiveError`), optional service unavailable at call time (`PluginApiServiceUnavailableError`), or per-member disabled facade (`isActive === false` plus typed error on call); declared members SHALL NOT be silently omitted without an observable signal.
5. WHEN `mountFeature(name, api)` is called, THEN it SHALL store the provided api per one unified contract, and flag-only mounts that ignore the api argument SHALL NOT remain.
6. WHERE a feature declares its official service optional (e.g. settings), IF `ctx.get` throws during the feature guard, THEN the guard SHALL treat the service as absent and the feature SHALL stay active with call-time typed errors (optional-service mode); WHERE a feature declares its official service mandatory, IF `ctx.get` throws during the feature guard, THEN the guard SHALL fail and the feature SHALL be disabled.

   > **已确认决策**（用户批准）：可选服务 fail-open（抛错视同缺失）、必需服务 fail-closed。

## 4. API 形状规则与执行（门面基础）

**User Story**: As a future feature developer, I want one written namespace placement rule, so that no feature ever unilaterally invents an API shape again.

**Acceptance Criteria**:

1. WHEN the integration delivers, THEN the placement rule SHALL be documented in the facade's governing docs: top-level namespaces are reserved for core domains (`llm`, `agent`, `session`, `tools`, `systemPrompt`, `settings`) and infrastructure (`events`); second-class pure-passthrough seams SHALL live under `pluginApi.services.<name>`; future pure-passthrough features SHALL go under `services.*`; features with facade-added semantics SHALL get their own namespace.
2. WHEN the integration completes, THEN `pluginApi.web` SHALL be relocated to `pluginApi.services.web` (guard, mount, disabled facade, tests, the feature-list O15 row, and the events-m1 spec wording all updated accordingly), leaving zero exceptions to the placement rule.
3. WHERE `pluginApi.session.on`/`once` receives an event name outside the four lifecycle names, THEN it SHALL keep parity with `pluginApi.events` pass-through behavior for non-cataloged names (untyped, unsupported subscription), and that pass-through SHALL be documented as an escape hatch.

   > **已确认决策**（用户批准）：裸透传——与 events 总线 passthrough 保持一致，标注为 escape hatch。
4. WHEN the integration completes, THEN every namespace on `pluginApi` SHALL match the placement rule, and no top-level key other than `events`, `llm`, `agent`, `session`, `tools`, `systemPrompt`, `settings`, `services` SHALL exist.

## 5. 版本协商与文档同步（门面基础）

**User Story**: As a third-party plugin author, I want the facade version to honestly reflect the M1 surface, so that my `dsh.api` requirement can distinguish pre- and post-integration facades.

**Acceptance Criteria**:

1. WHEN the integration completes, THEN `package.json` `dsh.api` SHALL be `"0.2"`.
2. WHEN future facade versions advance the minor, THEN the minor SHALL advance numerically (`0.9` is followed by `0.10`, never by `1.0`); `1.0` SHALL be reserved for the official public release (recorded in AGENTS.md §4.2 and this spec).
3. WHEN the integration completes, THEN AGENTS.md §8 and `feature-list.md` SHALL be synchronized: one entry per delivered feature, uniform `**delivered**` formatting, and catalog-count statements reworded as the union of each delivered feature's contributions (no stale absolute counts).
4. WHEN the integration completes, THEN the conflicting revisions of `plugin-api-events-m1` AC 7.3/7.4 made by `m1/llm` and `m1/agent` SHALL be reconciled into one generalized union statement covering all contributed event names.
5. WHEN the integration completes, THEN the four added peerDependencies (`dsh-session-reference`, `dsh-session`, `dsh-settings`, `dsh-system-prompt`) SHALL be merged into one `package.json` without introducing any non-peer runtime dependency.

## 6. 并行开发工作流协议（门面基础 / 流程制品）

**User Story**: As the coordinator of future milestone parallel development, I want one written three-phase protocol, so that naming drift and parallel re-invention are prevented before they happen and reconciled predictably when they happen.

**Acceptance Criteria**:

1. WHEN the integration delivers, THEN the spec directory of this feature SHALL contain a parallel-workflow protocol document covering exactly three phases: pre-parallel preparation, in-parallel worktree conduct, post-parallel merge.
2. WHERE the document describes pre-parallel preparation, THEN it SHALL require producing, before worktrees are spawned, naming-convention and parallel-responsibility contracts (shared-file edit boundaries, catalog field vocabulary, mount/guard/test naming, catalog-extension mechanism, failure-presentation paths), proactively offered to every worktree, with the stated goal of minimizing merge-time reconciliation.
3. WHERE the document describes in-parallel worktree conduct, THEN it SHALL state that contracts are strong guidance rather than absolute rules: a worktree MAY deviate when implementation reveals a contract impractical or negative-value, and WHEN it deviates, THEN it SHALL record the deviation and rationale in its own spec documents and surface them in its delivery report.
4. WHERE the document describes post-parallel merge, THEN it SHALL require a read-only pre-merge check (naming/isomorphism audit, scope coverage vs feature-list, smuggling check, pairwise conflict map) before any merge, an integration performed as one coordinated pass, and a full green test suite after merge.
5. WHEN this spec cycle completes, THEN AGENTS.md SHALL link to the protocol document.

## 7. 回归约束（门面基础）

**User Story**: As a maintainer of already-delivered features, I want the integration to provably preserve delivered behavior, so that unification does not silently regress E1–E12 or L1.

**Acceptance Criteria**:

1. WHEN the integration completes, THEN the 19 baseline events SHALL preserve E1–E12 behavior exactly (catalog field rename and documented policy backfill `fault:'contain'` + `freeze:'all'` are the only observable differences, and both are behavior-preserving).
2. WHEN the integration completes, THEN `pluginApi.llm.admission` (L1) behavior SHALL be unchanged, and there SHALL remain exactly one `resolveModelInfo` wrap (owned by `admission-bridge.js`).
3. WHEN the integration completes, THEN `apply()` SHALL never throw under any combination of guard/feature failures (fail-safe invariant), covered by tests.
4. WHEN the integration completes, THEN the full `node --test` suite SHALL pass on main.
5. WHEN the integration completes, THEN main SHALL contain the full feature set of all seven branches (A1–A8, L3/L6/L7/L8/L9, S1/S3/S4/S5, T1–T9, P1–P8, ST1/ST2/ST3/ST8, SV1–SV16/SV18) and SHALL contain no M2+ feature.
