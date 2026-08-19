# Tasks: plugin-api-m2-integration

> feature_name: plugin-api-m2-integration
> 状态：已交付（Stage 4）
> 上游：已批准 requirements.md（0705dd1）与 design.md（a511c5b；事实顺序修正 fd470fd）
>
> **Rename/version pointer（`plugin-api-compaction-events-r1`）**：M2 交付记录中的主包名 `@deepseek-ai/dsh-plugin-api` / 版本 `0.1.0-rc.6-0.3`（`dsh.api: 0.3`）为历史；现主包 `@deepseek-ai/dsh-plugin-api-main`（row id `plugin-api-main`），full version `0.1.0-rc.6-0.4` / `dsh.api: 0.4`。
>
> **权威指针（`plugin-api-session-title-r1`）**：上行为 compaction-events-r1 承接的 boundary；现行 authority 为 `0.1.0-rc.6-0.5` / `dsh.api: 0.5`（由 `plugin-api-session-title-r1` 承接），见 AGENTS.md §8 与 README。

## Final delivery baseline and execution record

本清单以当前 main 的已提交实现为事实基线。旧 preflight、五分支 merge wave、shared facade/host transaction、L2/L4、A11/A9、durable hub、guards/services、cardinality、version 与 combined lifecycle 已完成；不在此重列、不要求重做，也不保留 checked 历史。git history、已交付 feature Specs 与 Stage 状态是该历史权威。

Stage 4 的实现 reconciliation、两个真实 consumer migration、C proposal/交付治理与最终验收均已完成。已提交的 preflight、Design Architecture 1 与 git history 对历史 merge wave 使用同一事实顺序；它已经完成，不在本清单中重列或重做。以下五个大型任务构成已完成的 Stage 4 交付记录；每项均已完成验证并接受阻塞式对抗性审查。合并任务不减免质量门。

保留而非重写：L4 sole raw-stream owner/L2 gateway、A11 consumer-fiber direct forward、A9/T10 one-capture WeakMap owner、S2 finite mapping/five durable kinds、DurableObservationHub dispatch-safe teardown、47/5/19 cardinality、compaction P4、exact-runtime version 与 combined lifecycle suite。Task 1 只做新 Design 与这些已提交机制的 delta reconciliation。

依赖：1 M2 reconciliation → 2 read-image 与 3 ability-anchor（可各自完成）→ 4 governance/C proposal → 5 final delivery。

## 1. Complete the approved M2 reconciliation batch

- [x] 1.1 以一个原子批次实现并测试当前实现到批准 Design 的完整差异。
  - Routing/sessionRoute：加入稳定不可变的 pluginApi.routing composite，不替换既有 facade；ofExecution、agent.routeOf、tools.routeOf 共用一份 snapshot authority。实现独立 sessionRoute feature/guard/mounter（位于 sessionDurable/execRoute 后）、冻结 availability matrix、单一 committed-session observer owner，且无 catalog/synthetic event/LLM owner。
  - 实现 current/on/once/wait：P1→leaf P2→同一 public live-session validator；sessions.get(id)===target 或 public list identity proof；get/list/requestContext throw 的 contained diagnostic + invalid-target outcome；firstLiveSeq seed barrier、event/context corroboration、per-session frozen cache identity、future ordered delivery、once-before-call、stale-safe disposer、disposal/replacement、current-seed 与 AbortSignal wait linearization。
  - 对齐 prepared composition/host lifecycle：private prepare→effect→commit→activation、全部 rollback boundary、retained refs/reapply/stale callback P2 safety。保留 H1（execRoute 仅 tools/session、无 agents/events 依赖）和 H2（durable dispatch 内无 hook dispose/reconcile，strict teardown）。
  - 对齐而非重写 A11 六 leaf consumer-fiber agents lookup/resume/direct-forward；S2 appendMessage(targetSession, kind, payload, { sourceEventSeqs? }?) finite JSON/provenance/one-append/observer guard；L4/L2 snapshot/policy/scope/bypass/re-entry/wrapper/asymmetric activation；SV17 static services。只添加缺失边界测试。
  - 文件边界：新增专用 routing/sessionRoute 私有模块及其 focused tests；组合与挂载只触及 `lib/index.js`、`lib/plugin-api-service.js`、`lib/guards.js`，execution authority 复用 `lib/exec-route.js`。对应 shared coverage 限于 `test/index-exec-route.test.mjs`、`test/index-session.test.mjs`、`test/plugin-api-service-{composition,exec-route,session}.test.mjs`、guard/host-apply tests；只有 gap audit 证明批准契约尚缺时才修改既有 A11、S2、L2/L4、SV17 owner 及其 focused tests。不得修改官方 DSH、增加 route-conditioned contribution、从 header/options/defaults 推断 route、修改 47 event catalog 或重造已完成 owner。
  - 完成证据：routing、exec-route、agent/tools/session/durable/llm-request/compaction focused suites，受影响 M0/M1 host/facade/guard suites及 node --test 全绿；红→绿覆盖 guard isolation、native registration、publication rollback、listener rejection、stale observation、wait race、nested/concurrent 与 no duplicate construction。
  - _Requirements: 3.1–3.11, 4.1–4.10, 5.1–5.9, 6.1–6.9, 7.1–7.10, 8.1–8.9, 9.1–9.7, 11.2, 11.4–11.8, 15.1–15.8, 16.1–16.16_

## 2. Complete dsh-read-image real facade migration

- [x] 2.1 在 consumer 真实执行路径迁移到批准的 0.3 composed facade。
  - 仅使用 input:image L2 policy 和必要 L4 transform；concrete execution 用 routing.ofExecution/A9/T10，later committed decisions 才用 current/on/once/wait；reapply 后重读 facade，不把 retained P2 ref 当成复活。
  - 删除 A1 resolver monkey patch、A2 raw stream/recursive re-entry/legacy project、A6 private traversal、dormant fallback/direct-package escape hatch；保持 message order、nested tool-result、image-free terminal、safe missing-route relay 和 disabled behavior。
  - 不实现 session-created/prompt-time native route，也不宣称 final route 前可保留 built-in read_image identity；记录 runtime timing limit。
  - 完成证据：consumer focused/full tests、documented headless smoke/dev boot、dependency/migration note、main regression。
  - _Requirements: 10.6, 11.3–11.8, 12.1–12.9, 14.5–14.6, 15.1–15.4, 16.17–16.19_

## 3. Complete dsh-pro-ex-ability-anchor finite S2 migration

- [x] 3.1 在 consumer 实际 supported message paths 使用 finite appendMessage。
  - 映射 approved user/assistant/tool-result，向 facade 提供 explicit 或 uniquely derivable `sourceEventSeqs`，由 facade 计算 approved `surfaceOp`/metadata 并 append；保留 raw official `tool/call` 与非有限语义。
  - 删除 migrated kinds 的 hand-authored metadata fallback；证明 ambiguous/unsupported provenance fail-before-persistence，durable recovery 后重读 facade。
  - 完成证据：consumer-path tests、full relevant suite、documented headless smoke/dev boot、dependency 与 hack inventory 更新。
  - _Requirements: 8.5–8.7, 10.6, 11.3–11.8, 13.1–13.7, 14.5–14.6, 15.1, 15.5, 15.9_

## 4. Synchronize governance and C boundary

- [x] 4.1 同步 final authority、proposal-only boundary 和交付登记，不扩大 runtime scope。
  - 更新 supersession/spec/test wording，使 H1 narrowed execRoute、H2 hub、L2 sole resolveModelInfo wrapper、routing shape 和 S2 signature 有唯一 authority。
  - 更新 AGENTS registration、feature list、package/API guidance、consumer hack inventories；保留已交付 dsh.api 0.3、0.1.0-rc.6-0.3 exact-runtime/peer contract，不重新 version。
  - 仅发布 Design 的 C-class agent/prepared-route proposal（timing、causal identity、scheduler/order/cancel/teardown questions 和 M2 不交付 contribution API）；不得实现 proposal。
  - 完成证据：docs/spec consistency scan、version/package assertions green、47/5/19 distinction docs。
  - _Requirements: 1.4–1.7, 8.7–8.9, 10.1–10.7, 14.1–14.7, 15.1–15.9, 16.17–16.19_

## 5. Final verification and Stage 4 delivery

- [x] 5.1 运行跨仓 gates、审计边界并完成 Stage 4 交付准备。
  - 重跑 affected focused suites、root node --test、两个 consumer test/smoke/dev boot、package/version checks、git diff --check、clean-status 与官方 DSH 未修改检查。
  - 核对 Requirements 1–16：历史 admission/two waves、composition/order/guards、B lifecycle、L4/L2/A11/S2/SV17、cardinality、version、fail-safe、真实 migrations、governance/scope/routing C boundary。
  - 在最终提交前勾选本清单所有已完成的大任务，将 `tasks.md` 与 integration Stage 状态更新为已完成，并确认 AGENTS、feature list、consumer migration 状态和任何 supersession/preflight 注记均与最终代码及提交历史一致。
  - 已验证 implementation/tests/consumer evidence/governance 均已纳入交付边界；不得携带 red test、uncommitted material artifact、未覆盖 criterion 或失败 audit。最终提交由主代理在审查通过后完成。
  - _Requirements: 1.1–16.19_

## Requirements coverage matrix

| Requirement group | Completed task/evidence |
|---|---|
| 1–2 | 1.1 reconciles final integration; 4.1/5.1 records and verifies history |
| 3–9 | 1.1 and 5.1 |
| 10 | 4.1 preserves/synchronizes, 5.1 verifies |
| 11 | 1.1 test matrix, 2.1/3.1 consumer gates, 5.1 |
| 12 | 2.1 |
| 13 | 3.1 |
| 14–15 | 4.1 and 5.1 |
| 16 | 1.1 routing, 2.1 limitation, 4.1 C proposal, 5.1 |
