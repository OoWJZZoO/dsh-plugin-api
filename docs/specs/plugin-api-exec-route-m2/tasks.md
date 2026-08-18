# Tasks: plugin-api-exec-route-m2

> feature_name: `plugin-api-exec-route-m2`
> 状态：已完成（Stage 4）
> 上游：`requirements.md`（Stage 1 已批准）、`design.md`（Stage 2 已批准）
> 执行规则：Stage 4 在本清单获批后按顺序逐项实施；每项完成后须进行阻塞式对抗审查并通过，才可开始下一项。

---

## Scope and execution contract

- 实现范围仅为 host-side A9 + T10，以及 `dsh-read-image` 的 A6 route-query migration。
- Feature key、guard branch、mounter key 与 feature registry key 均为 `execRoute`。
- canonical route API 为 `pluginApi.routing.ofExecution(exec)`；`pluginApi.agent.routeOf(exec)` 与 `pluginApi.tools.routeOf(exec)` 作为兼容委托保留。不得增加 setter、`exec.route`、client/wire surface 或 B route event。
- 现有 `tools/*` catalog、`lib/events-bus.js` 和 `lib/deep-freeze.js` 是冻结边界：本 feature 不编辑它们，也不增加 event slice。
- 不修改 `/usr/lib/node_modules/@deepseek-ai/dsh/**`，不 import 官方私有模块或私有状态。
- 每项测试均使用 `node --test`；完整 suite 在所有任务结束后运行。
- 共享文件遵循 `plugin-api-m1-integration/parallel-workflow.md`：`lib/guards.js` 只在 unknown fallback 前追加 `execRoute` 分支，`lib/index.js` 只追加 owner mounter并按指定位置插入 key，`lib/plugin-api-service.js` 只追加 exec-route delegate/transaction seams。

## 1. Build the private route owner and focused semantics tests

**Files**

- Create `lib/exec-route.js`.
- Create `test/exec-route.test.mjs`.

**Implementation**

1. Implement one owner-local route authority with private `WeakMap<object, RouteSnapshot | undefined>` plus an observed marker that distinguishes unobserved input from a captured missing outcome.
2. Define `RouteSnapshot` construction as a fresh `deepFreeze({ provider, model })` object only when both values are non-empty strings; expose no additional public data.
3. Implement active `routeOf(exec)` as a query-only lookup: malformed, primitive, or unobserved input returns `undefined` without reading object paths, logging, or throwing.
4. Implement `capture(exec)` so it marks an eligible execution before route work, reads only public `exec.agent.session.requestContext()`, captures exactly one route or normal missing `undefined`, and never reads `requestHeader()`, `agent.options`, defaults, or private layout.
5. Treat missing agent/session/context and incomplete/invalid provider/model as quiet normal absence. Contain unexpected access, validation, or internal failures; cache `undefined`; record one redacted execution/phase/category diagnostic; never change the official operation.
6. Register exactly one native `ctx.on('tools/pre-execute', hook, { prepend: true })` capture hook. It must contain capture failures, invoke supplied `next()` exactly once, return its exact result, and never call an event dispatch method itself.
7. Make disposal idempotent and epoch-bound: future capture from the disposed owner is inert, hook cleanup is best-effort, and stale cleanup cannot affect a newer owner.

**Focused verification**

1. Prove valid capture creates an immutable two-property snapshot and excludes `contextWindow` or any live official object.
2. Prove same execution receives the exact same snapshot identity through repeated owner queries; later request-context changes do not alter it.
3. Prove each normal missing route case captures and reuses `undefined` without logging or fallback reads.
4. Prove unexpected getter/method failure is contained, emits one redacted owner diagnostic, caches `undefined`, and does not retry on query/re-observation.
5. Prove two executions sharing one session retain independent outcomes.
6. Prove no property/symbol/mutation is applied to execution, agent, session, or request-context objects.
7. Prove native hook uses `prepend`, capture happens before a simulated facade listener query, repeated same-execution pre-execute observation does not re-read/re-log/re-enter, and continuation semantics are unchanged.
8. Prove idempotent disposal and stale-owner isolation.

**Requirements covered:** §1 AC 1–7; §2 AC 1–9; §3 AC 1–4 and 6; §4 AC 1–5 and 9; §5 AC 1–4; §6 AC 4–7.

## 2. Add the `execRoute` guard and its P2 tests

**Files**

- Modify `lib/guards.js` additively.
- Create `test/exec-route-guard.test.mjs`.

**Implementation**

1. Add `runFeatureGuard('execRoute', ctx)` immediately before the existing unknown-feature fallback.
2. Fail closed for mandatory public substrate: `ctx.on`, official `tools`, and official `sessions` resolution. H1 narrows execRoute to tools/session; there is no `agents` probe or events/agent mounter dependency. Every probe must contain thrown getters/services and report a readable P2 problem.
3. Do not inspect a particular execution, `requestContext`, private agent/session fields, or any synthetic route event during the guard.
4. Preserve all guards for existing features and all `DSH_PLUGIN_API_GUARD_DISABLE` behavior unchanged.

**Focused verification**

1. Prove healthy public substrate passes.
2. Prove every mandatory missing or throwing probe produces only `{ ok: false }` plus `featureProblems.execRoute`, without throwing.
3. Prove the guard does not create P3/P4 behavior or affect an existing feature branch.

**Requirements covered:** §4 AC 7–9; §5 AC 5; §6 AC 4.

## 3. Add a reversible service delegate and P2 diagnostic ledger

**Files**

- Modify `lib/plugin-api-service.js` additively.
- Create `test/plugin-api-service-exec-route.test.mjs`.

**Implementation**

1. Add disabled `execRoute` delegate behavior that throws `PluginApiInactiveError` before input inspection when core is inactive and `PluginApiFeatureDisabledError('execRoute')` when core is active but this feature is disabled.
2. Add `routeOf(exec)` to both `pluginApi.agent` and the scope-aware `pluginApi.tools` surface. Both must delegate to the same private service exec-route delegate; neither may resolve a session or independently derive a route.
3. Preserve all existing agent methods and tools official-service forwarding behavior. The new tools query must not require a fresh `ctx.get('tools')` lookup.
4. Add narrowly scoped `mountFeature('execRoute', api)` and token-bound `unmountFeature('execRoute', token)` support. Unmount must restore the disabled delegate only for the current owner token and cannot reset any other feature.
5. Add a service-lifetime `execRoute` P2 diagnostic ledger keyed by lifecycle phase/category. Its reporting method marks a key before best-effort `writeGuardLog` and `featureFailNotice` logging. It deduplicates repeated matching failures across repeated `apply()` against the same branded service while allowing different P2 keys one diagnostic each.
6. Do not change diagnostic behavior for unrelated existing features.

**Focused verification**

1. Prove P1 and P2 `routing.ofExecution` and compatibility `routeOf` calls throw before inspecting input or calling official services.
2. Prove mounted agent and tools entries call the same owner authority and return the exact owner outcome identity.
3. Prove unmount restores P2, is idempotent, and a stale token cannot unmount a later owner.
4. Prove same P2 lifecycle key logs/writes once; a different key remains independently observable; logger and log-writer failure remain inert.
5. Prove all existing agent/tools methods retain their prior surface and forwarding behavior.

**Requirements covered:** §1 AC 1–7; §4 AC 4–8; §5 AC 3–4; §6 AC 4.

## 4. Integrate prepared feature activation and mount execRoute

**Files**

- Modify `lib/index.js` additively.
- Create `test/index-exec-route.test.mjs`.

**Implementation**

1. Import the exec-route owner/mounter and insert `['execRoute', mountExecRouteFeature]` after `session` in `FEATURE_MOUNTERS`, without reordering existing M1 keys.
2. Extend the host feature lifecycle with an opt-in prepared return shape `{ disposer, publish, rollback }`. Existing disposer-only mounters must retain their current lifecycle exactly.
3. For prepared `execRoute`, register `ctx.effect(() => disposer)` before calling `publish()` or `featureRegistry.mount('execRoute')`.
4. Require `featureRegistry.isActive('tools')` and `isActive('session')` before prepared mount registers its native hook; do not require `events` or `agent` for H1.
5. On execRoute guard failure, missing `ctx.effect`, dependency failure, registration failure, cleanup-registration failure, publication failure, or registry activation failure: contain the failure; best-effort rollback partial owner/hook; invoke token-bound service unmount; disable only `execRoute`; report its deduplicated P2 diagnostic; return normally from `apply()`.
6. Repeated `apply()` when `featureRegistry.isActive('execRoute')` is true must leave the original delegate, owner state, and one native capture hook intact.
7. Do not modify catalog composition, `events-bus`, or existing M1 lifecycle behavior.

**Focused verification**

1. Prove healthy apply produces active `execRoute` after the declared dependencies and exactly one native `tools/pre-execute` capture hook.
2. Prove repeated apply produces no second mounter call/hook and retains prior captured outcomes.
3. Prove each unavailable/inactive declared dependency disables only execRoute and exposes P2 route entries.
4. Prove `ctx.on` registration failure, malformed owner mount result, `ctx.effect` throw, delegate publication throw, and registry activation throw leave no hook, no active registry signal, and a disabled route delegate.
5. Prove every matching P2 lifecycle failure logs/writes once across repeated apply, while distinct failure identity logs once separately.
6. Prove rollback/disposer remains idempotent and stale cleanup cannot detach a later owner.
7. Prove existing tools events retain their catalog membership/type/mode/scope/fault/freeze/signal/result behavior and no route catalog entry appears.

**Requirements covered:** §3 AC 4–6; §4 AC 6–9; §5 AC 1–9; §6 AC 4–7.

## 5. Add cross-stage facade behavior and regression coverage

**Files**

- Modify or extend `test/index-exec-route.test.mjs` and `test/exec-route.test.mjs` only as needed.
- Do not modify frozen `test/index-events.test.mjs`. Update `test/index-tools.test.mjs` and `test/index-session.test.mjs` only where their hard-coded feature registry count or ordered-name expectation must include `execRoute`; preserve all existing M1 lifecycle assertions.

**Implementation and verification**

1. Build an apply-level mock dispatch path that reaches the existing A-class `tools/pre-execute`, `tools/execute`, `tools/post-execute`, and `tools/result` stages with the same execution identity.
2. Prove both public entry points are available to facade listeners in pre-execute after the native capture hook and return the same outcome through every later stage that is actually dispatched.
3. Prove a final-result path that bypasses post-execute does not manufacture a route in a later phase; query behavior remains cached outcome if captured and `undefined` if pre-execute never ran.
4. Prove repeated listener queries, repeated pre-execute substrate observation, and a changed later request context cannot re-read/replace the first outcome.
5. Prove route absence never changes pre-execute decision, execute signal semantics, post-execute result semantics, or final result emission.

**Requirements covered:** §2 AC 1–8; §3 AC 1–6; §4 AC 1–5; §6 AC 5–7.

## 6. Migrate dsh-read-image A6 and run migration acceptance

**Files**

- Modify only the supported A6 lookup path in `../dsh-read-image/lib/index.js`.
- Add or update focused tests in `../dsh-read-image/test/` following that repository’s conventions.
- Do not modify unrelated dsh-read-image routing/agent-creation code.

**Implementation**

1. Replace its provider/model deep lookup with the documented `ctx.pluginApi.tools.routeOf(exec)` entry in the supported tools execution path.
2. Remove route acquisition reads from `exec.agent.session.requestHeader()`, `exec.agent.options`, and equivalent nested private layout.
3. Use returned snapshot provider/model exactly for the image-capable route decision.
4. Preserve the current safe relay/fallback and debug behavior when the facade returns `undefined`; missing route must not fail tool execution.

**Focused verification**

1. Prove the migrated path obtains expected provider/model from the facade snapshot.
2. Prove no supported route path performs prohibited nested lookup.
3. Prove undefined route retains safe image-routing behavior and tool execution success/failure semantics.
4. Run the relevant dsh-read-image headless smoke test and development boot; report exact output if either fails.

**Requirements covered:** §6 AC 1–3 and 8.

## 7. Run full verification and synchronize feature records

**Files**

- Modify `AGENTS.md` §8 only by appending the delivered feature row after all code/tests are green.
- Modify only the matching `plugin-api-exec-route-m2` status/shape entry in `docs/specs/plugin-api-features/feature-list.md`.
- Do not alter unrelated feature rows or registry history.

**Verification**

1. Run `node --test` in `dsh-plugin-api` and confirm the complete suite passes.
2. Run the designated dsh-read-image focused tests, headless smoke, and development boot from Task 6.
3. Run `git diff --check` in both repositories and inspect status to ensure only task-scoped changes remain.
4. Update the delivered feature registry and feature list with A9 + T10, the `execRoute` feature key, no-route snapshot fidelity boundary, no B catalog slice, reversible prepared activation, and A6 facade migration.
5. Summarize any design/task revision required during execution. If a discovered issue changes approved Goal or Requirements acceptance criteria, stop and request a human decision rather than silently weakening the contract.
6. Commit all Stage 4 code, tests, specs, migration, and registry updates after verification, before final delivery or worktree cleanup.

**Requirements covered:** §6 AC 8–9; AGENTS.md §3.2 and §8.

---

## Execution order

1. Task 1 creates the owner and its pure/native behavior proof.
2. Task 2 establishes the fail-closed substrate admission decision.
3. Task 3 provides the public P1/P2 surface, single delegation point, reversible unmount, and P2 diagnostic lifetime.
4. Task 4 joins the owner to the host through the first-B prepared activation transaction.
5. Task 5 verifies the mounted system against all existing tools lifecycle stages without changing M1 behavior.
6. Task 6 performs the cross-repository A6 migration only after the facade route API is verified.
7. Task 7 runs full acceptance, synchronizes delivered records, and creates the mandatory Stage 4 commit.
