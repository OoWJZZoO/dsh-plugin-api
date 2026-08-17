# Tasks: plugin-api-semantic-hooks-m2

> feature_name: `plugin-api-semantic-hooks-m2`
> 状态：已完成（Stage 4，仅规格契约交付）
> 上游：`requirements.md` / `design.md`（均已批准）
> 执行模型：这是一个**仅规格契约** feature。根据 design.md Overview、C1、Testing Strategy 与 D1，本 feature 不创建运行时 engine、公共 namespace、catalog slice、host/client bundle 或测试模块。因此，下列唯一可执行收尾任务验证并登记该边界；它不授权实现任何具体 M2 能力。具体 B feature 的代码、TDD、迁移和运行时验收必须在各自获批的 spec 中完成。

---

## 1. Contract-only delivery and baseline verification

- [x] **1.1 在不引入运行时表面的前提下完成本 foundation 的交付登记与基线验证。**
  - 不创建或修改 `lib/`、`test/`、`package.json`、`scripts/`、host/client bundle 配置或官方 DSH 文件；不注册 `llm/request`、`exec.route`、durable-session helper 或任何具体 B hook。
  - 仅对本 feature 所有改动执行范围核验与 `git diff --check`；已有工作树中的无关改动不得被回退、混入或作为本 feature 的验收依据。
  - 运行全量 `node --test` 作为既有基线回归检查。该检查只能证明本 foundation 没有引入回归，不能替代任何未来 B translator 的行为、re-entry、catalog 或 durable-effect 测试。
  - 在基线通过后，按 `AGENTS.md` §8 追加本 feature 的 delivered 登记，并在 `docs/specs/plugin-api-features/feature-list.md` 添加或更新一条非公开 API 的 M2 共同契约状态记录；不得借此新增外部 API 形状或改变任何已交付 feature 的语义。
  - 引用：requirements §1.5、§2.7、§3.1–§3.6、§7.5–§7.7、§8.1–§8.2、§9.5；design Overview、A1、A4、C1、Testing Strategy、D1、D5、D6、D8。

---

## 2. Explicitly deferred implementation owners

本节不是本 feature 的 Stage 4 任务，不得由执行者提前实施。它把每项已批准契约的代码、测试与迁移验收归属固定给后续独立 spec，防止本 foundation 演变成未验证的通用转译引擎。

| Future owner | Required implementation package before coding | Migration / integration responsibility |
|---|---|---|
| `plugin-api-llm-request-m2` | 定义有界 `llm/stream` re-entry 的 operation identity、owner marker、收敛谓词、P2 路径和任何 synthetic B catalog slice；明确拒绝 loop-built frozen request 的全量改写。 | `dsh-read-image` A2 已由已交付的 `llm-image-admission` 迁移（自有 listener 已移除），故本 feature 不得重复认领或重新引入它。若 L4 识别到不同的现存 hack/consumer，须在其获批 Requirements 中命名迁移对象，并按 `AGENTS.md` §5 完成删除/退化、headless smoke 与 dev boot 验收；若有具体契约冲突，提交人类评审。测试同操作 re-entry、并发、decline/failure、exactly-once dispatch 与 M1 fault/freeze/scope。 |
| `plugin-api-exec-route-m2` | 定义 `tools/pre-execute` / `Session.requestContext()` 的 route snapshot 时序、缺失 route 结果、owner-local marker、P2 路径和 catalog 决策。 | 迁移并验证 `dsh-read-image` A6 的内部 agent 深挖在门面 API 下可删除或退化；不臆造不存在的 route。 |
| `plugin-api-session-durable-m2` | 定义官方 event vocabulary、JSON / surface validators、固定 surface recipe、history-backed durable identity、append timing 和可选 synthetic notification。 | 迁移并验证 `dsh-pro-ex-ability-anchor` 的手写 `surfaceOp` / `sourceEventSeqs` 可删除或退化；证明 retry/resume 不重复写入。 |
| First B-slice / B-facade coordinated M2 integration | 先通过独立批准的 integration design 解决 design A1.1 与 A4.4 的 publication transaction、cleanup rollback 和 catalog-slice rollback。 | 在真实 two-pass host 上测试成功注册与失败注册；未解决前不得发布任何 B facade entry 或 B catalog slice。 |
| M3 client/wire feature | 另行定义 codec、remote、settings discovery、wire error 与 client failure contract。 | 不得由上述 host feature 或本 foundation 让 client 独立转译 host 行为。 |

---

## 3. Test and migration disposition

- 本 foundation 交付的唯一产物是约束性规格文档，故不新增本地单元测试或 migration script；新增“无实现”的测试只会制造一个没有可观察行为的伪验证面，违反 design.md 的 Testing Strategy。
- 需求 §9.2–§9.4 的测试矩阵是后续 concrete B feature 的**准入条件**：每个 feature 的 `tasks.md` 必须逐项安排成功、同 operation re-entry、并发独立 operation、重复 substrate observation、contained failure、disposer idempotency、P1/P2 presentation，以及适用的 catalog / durable proof。
- 需求 §8.9 所需的 M1 parallel-workflow pre-merge audit、集中整合和全量测试，属于第一次或一组具体 M2 worktree 的协调交付，不能被本 feature 的文档基线检查替代。
- `dsh-read-image` A6 与 `dsh-pro-ex-ability-anchor` surface hack 的迁移验收分别归属 `plugin-api-exec-route-m2` 与 `plugin-api-session-durable-m2`；本 feature 未产生可供它们接入的运行时 API，因而没有可执行的本地迁移任务。

---

## Requirements coverage

| Approved requirement section | This feature's executable coverage | Downstream enforcement owner |
|---|---|---|
| §1 Classification Boundary | 1.1 preserves the no-concrete-hook boundary. | Every downstream requirements/design document classifies A/B/C and names substrate/fidelity/C boundary. |
| §2 Guard, Active Signal, and Lifecycle | 1.1 prevents a foundation lifecycle implementation from diverging from M1. | Each concrete B mounter plus first-B integration transaction design. |
| §3 Failure Presentation and Fail-Safe Policy | 1.1 verifies no new error route or partial facade is introduced. | Each concrete B feature implements P1/P2, contained diagnostics, and approved fail-open or feature-specific fail-closed semantics. |
| §4 Re-entry Marker and Idempotent Convergence | No shared marker module is introduced by 1.1. | Each translation owner defines and tests its operation identity, owner-scoped marker, cleanup, convergence, and exactly-once proof. |
| §5 Synthetic Hook Catalog Contract | 1.1 adds no premature catalog slice. | Any feature exposing a B hook owns its slice and the first-B integration resolves catalog rollback. |
| §6 Synthetic-versus-Durable Boundary | 1.1 adds neither synthetic dispatch nor durable record. | Durable helper and any dual-output feature define separate causal, deduplication, and notification contracts. |
| §7 Diagnostics and Conditional Client Boundary | 1.1 keeps this feature host-contract-only and client-free. | Concrete owners implement redacted deduplicated diagnostics; M3 owns any client/wire contract. |
| §8 Minimal Shared Foundation and Parallel Ownership | 1.1 preserves the absence of unproven shared runtime code. | M2 coordinator issues the required worktree contract package and performs the pre-merge audit. |
| §9 Downstream Specification and Verification | 1.1 records the handoff without claiming downstream behavior. | `plugin-api-llm-request-m2`, `plugin-api-exec-route-m2`, and `plugin-api-session-durable-m2` cite this specification, conform to Requirements §1–§8 unless they record a concrete conflict for human review, and implement its required test matrix. |

---

## Stage 4 exit condition

After task 1.1 completes, this feature is complete as a documentation-only M2 foundation. No unstarted runtime task remains in this feature. Starting any row in Section 2 requires that feature's own approved Goal, Requirements, Design, and Tasks; it is not implied by approval or delivery of this contract.
