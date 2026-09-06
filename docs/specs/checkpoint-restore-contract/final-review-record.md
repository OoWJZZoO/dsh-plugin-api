# Final Review Record（全局终审修订记录）

> feature: checkpoint-restore-contract
> 日期: 2026-09-06（Stage 4 全局终审后修订）
> 性质: 本线 spec 制品；记录任务 10（批次 B 开门 authority 对齐检查）的逐面核对结论、10.2 裁决与 10.3 不可证明项清单，以及批次 A/B 提交时序与任务书映射的实况说明。

## 1. 任务 10.1 逐面对齐检查结论

| 面 | 可证状态 | registry/实现依据 |
|---|---|---|
| coordination（acquire/heartbeat/release/takeover/compareAndSet + fencingToken） | **可证**（M8 已交付） | `public-contract.registry.json` `coordination.acquire`/`coordination.acquire.handle`（含 fencingToken）/`heartbeat`/`release`/`takeover`/`compareAndSet`/`availability`；实现 `lib/coordination-lease.js` |
| workspaces.transactions（prepare/record/preview/commit/rollback/recover/get/observe） | **可证**（M8 已交付） | registry `workspaces.transactions.*`（prepare/record/preview/commit/rollback/recover/get/observe + prepare.handle）；实现 `lib/workspace-mutation-transaction.js` |
| sessions.branches（create/plan/preview/commit/rollback/restore + availability） | **可证**（既有 R 成果已交付） | registry `sessions.branches.*`（create/graph/plan/preview/commit/rollback/restore/availability）；实现 `packages/session-branch/lib/delegate.js`（`branches` 子面） |
| executions.recovery（单一自动消费） | **可证且本线不消费** | registry `executions.recovery.*`；本线 restore/plan/capture 路径零调用 evaluate（`test/checkpoint-restore.test.mjs`「recovery authority is never consumed」断言唯一入口） |
| 共享 loop boundary slice（agent/attempt/start\|end + cancel boundary） | **依赖 interaction 线交付**（并行期未合入） | 消费契约与缺位降级已实现：本线 `lib/checkpoint-facts.js` 只读消费 + `by:'system'` cancel 适配；切片缺位 ⇒ live-attempt evidence unknown、cancel unavailable、运行中 restore denied/blocked（fail-closed）——真实装配验证归集成波（tasks 15.4） |
| sessions.activity（降级证据） | **依赖 activity 线交付**（并行期未合入） | 降级证据适配器已实现（`checkpoint-facts.js` activity fallback）；缺位 ⇒ evidence `unknown` ⇒ fail-closed blocked |

## 2. 任务 10.2 裁决

- **authority 已闭合 ⇒ 实现完整 restore operation**。单 slice（branch/journal/snapshot）restore 的全部必要 authority（coordination fencing、transactions、branches、recovery 非消费）均以 registry 可证形状闭合，无未决 conflict；依赖共享切片的部分（stop-then-restore、auto-capture）以「能力缺位如实降级」方式交付，不等待、不阻塞无依赖部分。诚实的降级路径经 `availability()`（含 `restore.stopThenRestore`）、plan 的 `liveState`/`stopThenRestore`/`scopeResource` 与 restore preflight 逐层呈现。
- 若 authority 无法闭合，任务书要求「交付诚实降级不伪装」——本线未触发该分支；触发条件（切片契约形状与设计不符）与应对（restore 降级 typed unavailable）已预埋于 `test/checkpoint-restore.test.mjs`「running session without the shared cancel boundary is denied」与 `availability` 测试。

## 3. 任务 10.3 不可证明项登记

不可证明/未交付项及退役条件见 `upstream-registration.md` §1–3：workspace snapshot slice 与共享切片消费的 U-series 提案/退役条件（§1–2）、四类残余 C 类 gap（§3：in-flight 状态恢复、跨档原子单提交、官方内部 durability checkpoint 引用、外部副作用回滚）。feature-list §3.1 与 U-series 编号登记由集成波执行（tasks 15.2）。

## 4. 批次 A/B 提交时序与任务书映射说明

- 任务书（tasks.md 修订后）约定：批次 A 交付契约 §8 第 4 步范围（checkpoint projection/plan）及第 5 步 R slice 包的安装面前置（workspace 替代包的 parity/capture 面，restore-path 仅接口）；批次 B 对应第 5 步 restore operation 主体与 R slice restore 驱动。
- 实际时序（提交链）：`1b6b30f` 批次 A 模块+核心测试（record/capture/projection/plan/facts/availability/auto-capture/facade/restore 模块全量入列）→ `95b4d15` plan/availability/auto-capture/restore 测试 → `7c94827` workspace 包 + 终验。
- 说明：restore 模块（`lib/checkpoint-restore.js`）与批次 A 模块同批提交，是因为批次 B 的「authority 对齐检查」（本次记录 §1）在实现 restore 主体之前完成并以 registry 事实闭合——对齐检查结论先行、restore 实现随后；stop-then-restore 的共享切片消费在实现中以「缺位降级」交付，真实装配（tasks 15.4）与跨线全链路验证（tasks 15.5）留集成波。串行收尾语义（restore 为 M9 最后进入实现的部分、所有 slice 经单一 operation authority 提交终态）在实现序与装配两层均成立。
- 终审后修订（本次）：plan-time 锚点校验（锚点删除 ⇒ step `unavailable` + reason；restore preflight 因 fingerprint 变动拒绝 stale plan）与 scope 资源存在性标记（inspect/list/plan 出口 `scope.resourceStatus`，记录不改写）已补齐，见 `tasks.md` 实现注记⑥⑦。