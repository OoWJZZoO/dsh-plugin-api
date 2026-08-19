# Tasks: plugin-api-m3-contract

> feature_name: `plugin-api-m3-contract`
> 状态：Stage 4 execution complete（含 reconciliation batch 10；无人值守授权下由协调者代行确认）
> 上游：已提交 `goal.md`、`requirements.md`、`design.md`
> Execute 约束：以下任务是 M3 实现与整合的唯一任务入口；本 `m3-contract` feature 本身不创建 `lib/`、`test/` 或 package 实现。每个顶层批次完成后须进行一次阻塞式对抗性审查，修订只在该批次内完成。

## 1. W1 package-contract worktree: C1 → C8

- [x] 1.1 实现 C1 manifest helper 与 C8 Typert artifact facade，并建立各自的纯 leaf 测试。
  - 范围仅为 C1、C8；明确排除 ST4、ST5、ST6、C2、C3、C4、C5、C6、C7、C9、ST7 和所有其他 M4/C 类 proposal。可另行创建各自 `docs/specs/<feature>/` 的 Stage 0–3 制品；不得编辑其他 feature 的制品。
  - C1：新增 `client.defineManifest({platform, inject?, immediately?})` 的校验/规范化模块，保持官方 `dsh.client` 字段和默认语义；由本 owner 维护 `package.json` 的 `exports["./client"]` 与 `dsh.client` 清单约定。
  - C8：新增 Typert loader/registry 公开能力的 typed wrapper，覆盖 schema/invocation/lookup/context 注册，保留官方 receiver、registration order、disposer、duplicate/error identity；artifact 仍来自 `exports["./typert"]`。
  - 只允许触碰：`package.json`、C1/C8 leaf modules、C8 在 `lib/guards.js` 中的 append-only guard branch、对应 `test/client-manifest*.test.mjs`、`test/typert*.test.mjs`；不得触碰 `lib/client.js` 组合入口、`lib/index.js`、`lib/plugin-api-service.js`、`lib/events-bus.js`、官方 DSH 文件。
  - 完成后验证 malformed manifest/export、missing Typert loader/registry、official registration identity、apply/boot containment；记录任何偏离。
  - _Requirements: 1.1–1.5, 2.1–2.5, 3.1–3.5_

## 2. W2a settings-host worktree: ST4

- [x] 2.1 实现 host `settingsRemote` leaf 和可回滚的 Typert remote publication。
  - 范围仅为 ST4；明确排除 ST5、ST6、C1、C2、C3、C4、C5、C6、C7、C8、C9、ST7 和所有其他 M4/C 类 proposal。可创建 `docs/specs/plugin-api-settings-remote-m3/` 的 Stage 0–3 制品。
  - 新增 `pluginApi.settings.remote(namespace, serviceKey?)` 的 host owner；使用官方 `TypertRemoteService`/`bindTypertRemote`，验证 namespace、默认/显式 service key、descriptor、参数和返回值。
  - 只允许触碰：ST4 leaf module、ST4 focused guard/service tests，以及 `lib/guards.js` 中对应 append-only guard branch；不得修改 shared facade composition、`lib/client.js`、events bus/catalog、官方 DSH 文件。
  - 覆盖 missing/malformed settings/Typert primitive、duplicate key、partial publication rollback、idempotent/stale disposer、optional M1 settings behavior 和 fail-safe host apply。
  - _Requirements: 2.2–2.5, 5.1–5.6, 10.2–10.7_

## 3. W2b client-foundation worktree: C9 → ST6

- [x] 3.1 实现 C9 connection leaf，随后实现 ST6 real codec leaf。
  - 范围仅为 C9、ST6；明确排除 ST4、ST5、C1、C2、C3、C4、C5、C6、C7、C8、ST7 和所有其他 M4/C 类 proposal。可创建这两个 feature 各自的 `docs/specs/` Stage 0–3 制品。
  - C9：新增 `client.connection` typed forwarding face，精确转发 `rpc.call('/api', endpoint, {args}, signal)` 与 `api.settings.*`，保留 receiver/Promise/AbortSignal/error semantics。
  - ST6：在 client bundle 内只打包一份 zod，生成 `dsh-api-remotes` 接受的真实 descriptor codec；禁止 loose predicate、forged zod marker 和 host zod identity。
  - 只允许触碰：C9/ST6 leaf modules、`test/client-connection*.test.mjs`、`test/client-codec*.test.mjs`；client composition `lib/client.js` 由 W5 integration owner 统一接线。
  - 覆盖 exact wire argument names、unknown/invalid descriptor、return/error schema、AbortSignal/cancel, missing service, codec load failure, repeated construction and cleanup.
  - _Requirements: 2.1–2.5, 4.1–4.4, 6.3–6.4, 10.2–10.7_

## 4. W2c client-event worktree: C6

- [x] 4.1 实现 C6 remote event bridge leaf。
  - 范围仅为 C6；明确排除 ST4、ST5、ST6、C1、C2、C3、C4、C5、C7、C8、C9、ST7 和所有其他 M4/C 类 proposal。可创建 `docs/specs/plugin-api-client-remote-events-m3/` 的 Stage 0–3 制品。
  - 新增 consumer-facing `client.remote.$on` adapter，只允许 official forwarded-event allowlist，保留 listener order、snapshot iteration、disposer and containment semantics；`$dispatch(event, readonly args[])` 仅是 official carrier entry、返回 void，不得作为消费方 transport/emission API。
  - 只允许触碰：C6 leaf module、`test/client-remote-events*.test.mjs`；不得修改 C2 generic `$mount` owner、`lib/client.js` composition、shared error registry或官方 gateway。
  - 覆盖 allowlist rejection before subscription、carrier decoded args、remote unavailable、baseline synchronous listener failure、exact disposer and unrelated-feature survival；rejected thenables are deferred to reconciliation batch 10。
  - _Requirements: 2.2–2.5, 9.1–9.6, 10.2–10.7_

## 5. W3a remote-core worktree: C2

- [x] 5.1 实现 generic `clientRemoteContribution` mount owner。
  - 范围仅为 C2；明确排除 ST4、ST5、ST6、C1、C3、C4、C5、C6、C7、C8、C9、ST7 和所有其他 M4/C 类 proposal。可创建 `docs/specs/plugin-api-client-remote-contribution-m3/` 的 Stage 0–3 制品。
  - 新增 `client.mountRemote(contribution)`，校验 package identity、descriptor collection、remote namespace/face，调用 official `ctx.remote.$mount` exactly once，并保存精确 owner/disposer。
  - 只允许触碰：C2 leaf module、`test/client-remote-contribution*.test.mjs`；不得实现 ST5 settings-specific face、ST6 codec、C7 native dynamic discovery或修改 `lib/client.js` composition。
  - 覆盖 baseline missing/mismatch/duplicate face、malformed contribution、partial rollback、idempotent disposer、remote failure containment and unrelated client boot；pending mount stale replacement is deferred to reconciliation batch 10。
  - _Requirements: 2.1–2.5, 6.1–6.2, 6.5–6.8, 10.2–10.7, 12.1–12.3_

## 6. W3b settings-scope worktree: C3

- [x] 6.1 实现 `clientSettingsScope` typed scope。
  - 范围仅为 C3；明确排除 ST4、ST5、ST6、C1、C2、C4、C5、C6、C7、C8、C9、ST7 和所有其他 M4/C 类 proposal。可创建 `docs/specs/plugin-api-client-settings-scope-m3/` 的 Stage 0–3 制品。
  - 新增 `client.settingsScope.bind(spec)` 直通，返回 official `SettingsScope` 的 `getSnapshot/subscribe/set/unset` public contract；官方 binder 唯一持有 `describe({})` 与 `mutate({ns, ops, expectedRevision?})` wire、ordering/recovery 和 client fiber cleanup。
  - 只允许触碰：C3 leaf module、`test/client-settings-scope*.test.mjs`；不得修改 C9 connection owner、ST5 remote contribution owner、settings host modules、client composition。
  - 覆盖 immutable snapshots、subscription order、unavailable/memory snapshot、official rejection/recovery、repeated bind、caller-fiber disposal isolation and stale scope state。
  - _Requirements: 2.2–2.5, 4.1–4.4, 7.1–7.5, 10.2–10.7_

## 7. W3c slots worktree: C4 → C5

- [x] 7.1 实现 C4 slots facade，随后接入 C5 `slots/changed` descriptor。
  - 范围仅为 C4、C5；明确排除 ST4、ST5、ST6、C1、C2、C3、C6、C7、C8、C9、ST7 和所有其他 M4/C 类 proposal。可创建这两个 feature 各自的 `docs/specs/` Stage 0–3 制品。
  - C4：新增 typed `client.slots.register/inject/entries/subscribe`，校验 `SlotEntryDef` 和 canonical slot IDs，保留 official injection/redeclaration/order/disposer semantics。
  - C5：新增 client event descriptor for exact `slots/changed(key: string)` after mutation; it is not a host `pluginApi.events` catalog slice and cannot change shared event bus/freeze semantics.
  - 只允许触碰：C4/C5 leaf modules、`test/client-slots*.test.mjs`、`test/client-slot-events*.test.mjs`；不得修改 `lib/events-catalog.js`、`lib/events-bus.js`、host mounter composition or C6 bridge.
  - 覆盖 invalid definitions/keys, injection wait/redeclaration, immutable entries, mutation-before-event ordering, baseline synchronous listener containment, rollback and unrelated slots；rejected thenables are deferred to reconciliation batch 10.
  - _Requirements: 2.2–2.5, 8.1–8.7, 10.2–10.7_

## 8. W4 settings-client worktree: ST5

- [x] 8.1 实现 baseline settings-specific remote contribution on top of C2 and ST6.
  - 范围仅为 ST5；明确排除 ST4、ST6、C1、C2、C3、C4、C5、C6、C7、C8、C9、ST7 和所有其他 M4/C 类 proposal。可创建 `docs/specs/plugin-api-client-settings-remote-m3/` 的 Stage 0–3 制品。
  - 新增 settings face adapter behind `client.mountRemoteContribution(contribution)`，复用 generic C2 mount owner and C9/ST6 wire codec；host unavailable 时返回 visible inert/degraded UI outcome。
  - 只允许触碰：ST5 leaf module、`test/client-settings-remote*.test.mjs`；不得 duplicate `$mount`, alter C2/ST6 owner, implement C7 dynamic discovery, or modify host Typert/settings files.
  - 覆盖 host descriptor mismatch, codec rejection, remote unavailable, degraded rendering, baseline disposer, duplicate publication and boot containment；stale replacement is deferred to reconciliation batch 10.
  - _Requirements: 2.2–2.5, 6.2–6.7, 10.2–10.7, 11.1–11.2, 12.1–12.3_

## 9. W5 integration worktree: compose, unify, migrate, verify

- [x] 9.1 完成 pre-merge read-only audit，并按固定顺序合并 W1–W4 committed boundaries。
  - 审计 feature coverage、identity table、shared-file ownership、reported deviations、out-of-scope changes、official-package diff、`git merge-tree` conflict matrix and implementation/spec consistency。
  - Merge order：W1 C1→C8；W2a ST4；W2b C9→ST6；W2c C6；W3a C2；W3b C3；W3c C4→C5；W4 ST5。每个 top-level batch 后运行其 focused tests 和受影响 host/client boot tests；merge wave 不做 coordinator-wide refactor。
  - _Requirements: 2.1–2.5, 11.1–11.3_

- [x] 9.2 执行 shared unification wave，接线 host/client composition and failure paths。
  - 在 `lib/index.js` 中按既有 M0–M2 顺序追加 host `typert`、`settingsRemote`；在 `lib/plugin-api-service.js` 中保留 `services.typert` 的唯一 composition slot；在 `lib/guards.js` 中收口 host guard；在 `lib/client.js` 中按 `CLIENT_MOUNTERS` 顺序装配所有 client leaves。
  - 只由 integration owner 修改 shared composition files：`lib/index.js`、`lib/plugin-api-service.js`、`lib/client.js`、shared composition modules 和 shared integration tests；W1 的 `package.json` 与 W1/W2a 的 `lib/guards.js` 只接受机械冲突收口和一致性审计，不得由 integration 重新发明语义或命名；不得改 official DSH files。
  - Enforce the baseline `featureRegistry.isActive`-style idempotency, P1–P4 presentation, prepare/commit/rollback, no duplicate `$mount`, one zod bundle, C4/C5 single slots parent, and no host catalog expansion; pending mount stale cleanup and asynchronous listener containment are reconciliation-batch obligations.
  - _Requirements: 1.1–1.5, 2.2–2.5, 10.1–10.7, 11.3–11.6_

- [x] 9.3 完成 baseline consumer migration and verification（不构成 final M3 acceptance）。
  - 将 `dsh-read-image` A3/A4/A5 settings UI path 迁移至 ST4/ST5/ST6；将 `dsh-pro-ex-ability-anchor` panel bundle/slot path 迁移至 C1/C4；删除 migrated hack fallback，不扩大 C7/ST7。
  - 运行 baseline host `node --test` 全量、client boot/headless tests、manifest/export checks、real-zod positive/negative wire tests、remote/slot/event/scope lifecycle tests、两个 consumer focused/full tests、documented headless smoke and dev boot；review-required gateway/lifecycle/partial-boot evidence remains in batch 10。
  - 同步 `AGENTS.md` §8、`feature-list.md` 11 行状态和最终形状；核对 C7/ST7 仍 planned/proposal；运行 `git diff --check`、clean-status and official-package modification audit。
  - _Requirements: 11.4–11.8, 12.1–12.3_

## 10. Post-delivery review reconciliation batch

- [x] 10.1 修复并验证 C2/ST5 的真实 gateway remote namespace 与 pending mount 生命周期契约。
  - C2 现通过官方 dynamic-service accessor（`remote[namespace]`）解析发布命名空间，不再使用 `in`/own-property 枚举；覆盖 Cordis 动态属性（Proxy 场景 `in` 为 false 而读取成功的真实 gateway 语义）。owner record 采用 `pending → active → stale/disposed` 生命周期：pending 期 dispose 立即移除可寻址 owner、把官方 disposer 清理推迟到 `$mount` settle 后恰好一次；late rejection 清理先做 record identity 检查，不删除/不覆盖新 owner。ST5 同步增加 pending 期 dispose 的 rollback 分支并复用 C2 语义。
  - 测试：`test/client-remote-contribution.test.mjs` 新增 dynamic-accessor（Proxy 场景 `in` 为 false 而读取成功的真实 gateway 动态语义）、pending dispose + reapply、late rejection 保护三例；`test/client-bundle.test.mjs` 新增 bundle 级 `client.mountRemote` 用例——bundle fixture 的 `$mount` 以运行时属性发布命名空间（可动态读取），验证真实 bundle 路径挂载与 disposer 语义。
  - _Requirements: 6.1–6.2, 6.6–6.8, 10.4–10.5_

- [x] 10.2 修复 client composition 的局部 fail-safe 边界。
  - `lib/client-runtime.js` 的顶层 `inject` 已清空；`connection`、`remote`、`settingsScope`、`slots` 均由各 leaf 自行经 `ctx.get` 解析并独立 guard，缺失/形状错误/`ctx.get()` 抛错只停用对应 leaf（P2/P3/P4 呈现），`pluginApi.client` 与无关 leaf 照常发布。
  - 测试：`test/client-bundle.test.mjs` 新增 missing/malformed/throwing optional service 三组 partial-boot 用例。
  - _Requirements: 10.2–10.4, 10.8_

- [x] 10.3 修复 C5/C6 的异步 listener rejection containment。
  - `client-slot-events.js` 与 `client-remote-events.js` 的 listener wrapper 对返回值附加 `Promise.resolve(result).catch(...)` rejection containment 与 redacted diagnostics；`$dispatch`/`slots/changed` 保持原有同步返回与快照顺序，后续 listener 照常派发。
  - 测试：两个 leaf test 文件各新增 rejected-thenable 用例，注册 `unhandledRejection` 探针断言进程无未处理拒绝。
  - _Requirements: 8.4–8.5, 9.4–9.5_

- [x] 10.4 完成 reconciliation verification and delivery update。
  - 证据：受影响 leaf tests、bundle partial-boot/gateway tests、全量 `node --test` **706/706**、`dsh-read-image` **24/24**、`dsh-pro-ex-ability-anchor` **123/123**、dev boot HTTP 200 通过；`git diff --check` 通过、`node --check lib/*.js` 通过、official DSH package 无修改。headless CLI smoke 被环境级 MCP provider `tool_count_limit` 故障阻塞（pristine commit 同样复现、与 dsh-plugin-api 无关），记录于 delivery.md。`lib/client.js` 已按同参数 esbuild（iife + ModuleLoader wrapper、单份 bundled zod）重新生成并与源码一致。
  - 交付状态已更新：`AGENTS.md` §8 与 `feature-list.md` 维持 11 行 delivered，`delivery.md` 恢复最终验收完成表述并记录 reconciliation evidence。
  - _Requirements: 11.4–11.8_

## Dependency and coverage matrix

| Top-level batch | Worktree | Features | Depends on | Requirement coverage |
|---|---|---|---|---|
| 1 | `m3-package-contract` | C1 → C8 | W0 | 1–3, 10 |
| 2 | `m3-settings-host` | ST4 | W1 boundary | 2, 5, 10 |
| 3 | `m3-client-foundation` | C9 → ST6 | W1 boundary | 2, 4, 6, 10 |
| 4 | `m3-client-event-bridge` | C6 | W1 boundary | 2, 9, 10 |
| 5 | `m3-remote-core` | C2 | W2b boundary | 2, 6, 10, 12 |
| 6 | `m3-settings-scope` | C3 | W2b boundary | 2, 4, 7, 10 |
| 7 | `m3-slots` | C4 → C5 | W1 boundary | 2, 8, 10 |
| 8 | `m3-settings-client` | ST5 | ST4 + C2 + C9/ST6 | 2, 6, 10–12 |
| 9 | `m3-integration` | all M3 | batches 1–8 | all requirements |
| 10 | `m3-review-reconciliation` | C2, ST5, client composition, C5, C6 | batch 9 review findings | 6, 8–11 |

## Review and completion gates

- Stage 3 gate: `git diff --check` passed and this task list was committed before M3 implementation worktrees were derived; the owner-approved unattended run then executed Stage 4.
- Stage 4 batch gate: each top-level batch receives one blocking adversarial audit against this task list and its upstream Requirements/Design; substantive correction stays in the same batch and is re-audited before the next batch starts.
- Final gate: integration batch plus reconciliation batch 10 proved all 11 M3 rows, both consumer migrations, real gateway client behavior, partial client boot, host/client boot, full tests, no official package modification, and no M4 implementation. Evidence is recorded in `docs/specs/plugin-api-m3-integration/delivery.md`.
