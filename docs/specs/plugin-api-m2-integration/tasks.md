# Tasks: plugin-api-m2-integration

> feature_name: `plugin-api-m2-integration`
> 状态：Stage 3 草案，待批准
> 上游：已批准 `requirements.md` 与 `design.md`
> 执行规则：严格按顺序一次执行一个 checkbox；每项完成后运行所列 focused tests，并按根 `AGENTS.md` 执行阻塞式对抗性审查。若发现动摇 Goal 或 Requirements 验收标准的冲突，停止并请求人类裁决。

共同验证门：

- Task 2.1–2.5 每一步的 required test set 固定为“当前输入分支的全部 focused tests + 因本步冲突解算而触及的冻结 shared host/apply、facade、guard、catalog、services/package/version tests”；该集合必须全部通过后才能开始下一 merge task。
- 任一 merge conflict 若不能在 conflict-only 边界内形成同时保留两侧 approved contracts 的兼容超集，立即暂停该步并按 Requirements 1.5/1.6 分类：仅实现细节冲突须记录其权威 resolution 并在本设计指定的 merge/unification owner 中解决；改变 Goal、分类、公开验收标准或迁移边界的冲突须请求人类裁决。不得携带红测进入下一步。
- Task 3.1–8.2 每一统一任务完成时，必须运行该任务新增/修改的 coordinator tests、所有受其共享契约影响的 feature-owner focused tests，以及本任务触及的冻结 shared tests；全部通过后才能开始下一 checkbox。Task 9.1 的全量回归不能替代这些逐任务门禁。

## 1. 冻结整合输入与预检证据

- [x] 1.1 创建只读 pre-merge audit 制品并冻结五个输入分支
  - 核对五个 `feature/plugin-api-*-m2` 分支的 Stage 4 提交、Tasks 完成状态、交付登记、clean worktree、公开形状、feature key、guard、mounter、共享文件所有权及官方包未修改证明。
  - 生成两两 conflict matrix，覆盖生产文件、共享测试、package metadata、registry、迁移仓库和 semantic owner；记录每个分支的准入决定与所有已知 supersession，不在该任务中合并或重写实现。
  - 运行并记录整合前 repository baseline 与各分支 focused-test 命令；若发现 Goal/Requirement 级偏差，停止而不准入该分支。
  - _Requirements: 1.1–1.7, 2.1, 11.1, 11.9, 15.1–15.9_

## 2. 执行 conflict-only principal merge wave

- [x] 2.1 合并 `feature/plugin-api-compaction-m2`
  - 只解决取得 SV17 feature-local 实现、测试与 `services.js` static definition 所需的冲突，不在本步统一共享 coordinator 或更新最终版本。
  - 运行 compaction focused tests 及本步触及的 services/package shared tests，红测清零后才继续。
  - _Requirements: 2.1–2.7, 9.3–9.7, 11.1, 15.1, 15.6_

- [x] 2.2 合并 `feature/plugin-api-llm-request-m2`
  - 保留 L4 owner、L2 gateway/policy、typed errors 与 feature-local tests；冲突处理不得提前建立最终 shared transaction，也不得保留第二个 raw `llm/stream` owner。
  - 运行 L2/L4 focused tests 及本步触及的 LLM/shared host tests，红测清零后才继续。
  - _Requirements: 2.1–2.7, 6.7, 7.1–7.7, 8.2–8.3, 11.1, 15.3_

- [x] 2.3 合并 `feature/plugin-api-agent-create-m2`
  - 保留 A11 context-bound adapter、availability matrix、provider lifecycle 与 feature-local tests；不得使 A11 依赖 execRoute 或 B 类基础设施。
  - 运行 A11 focused tests 及本步触及的 agent facade/shared host tests，红测清零后才继续。
  - _Requirements: 2.1–2.7, 3.1, 3.4, 4.5, 9.1–9.2, 9.6–9.7, 11.1_

- [x] 2.4 合并 `feature/plugin-api-session-durable-m2`
  - 保留 durable catalog/audit、有限 append contract、observation API 与 feature-local tests；仅做冲突解算，不在本步实现最终 stable observation hub。
  - 运行 session-durable focused tests 及本步触及的 session/events/shared host tests，红测清零后才继续。
  - _Requirements: 2.1–2.7, 3.5, 4.3, 7.9–7.10, 8.5–8.7, 11.1, 15.5_

- [x] 2.5 合并 `feature/plugin-api-exec-route-m2`
  - 保留唯一 route owner、native pre-execute capture 与 feature-local tests；在冲突记录中明确旧 `agents` guard probe 和 `events/agent` mounter 依赖待统一波 supersede。
  - 运行 exec-route focused tests 及本步触及的 tools/agent/session/shared host tests；确认五分支 merge wave 全绿后才进入统一波。
  - _Requirements: 2.1–2.7, 3.2–3.4, 4.4, 5.7, 7.8, 7.10, 8.4, 11.1, 15.4_

## 3. 统一 facade composition 与 prepared publication

- [x] 3.1 以测试先行方式重建唯一 `PluginApiService` composition authority
  - 先新增失败测试，覆盖 additive agent/tools/llm/session composition、稳定 disabled presentation、retained references、不可变形状、identity-bound token 以及旧 disposer 不得覆盖新 epoch。
  - 统一 `lib/plugin-api-service.js` 的 feature slots、agent composer、route delegate、durable overlay 和 services assignment；任何 mounter 都不得独立替换完整公共 namespace。
  - 运行 agent-create、exec-route、LLM、session-durable、compaction 的 facade-focused tests 及所有触及的 frozen facade tests；全部通过后才进入 3.2。
  - _Requirements: 3.1–3.9, 5.2, 6.3–6.6, 11.5–11.6_

- [x] 3.2 以测试先行方式实现 host prepared-mount transaction
  - 在 `lib/index.js` 建立 guard → private prepare → `ctx.effect()` cleanup registration → facade commit → registry activation 的唯一事务顺序，并覆盖 registration/commit/activation 每个边界的 rollback。
  - 确保 rollback、重复 disposer、stale disposer、logger failure 和 feature-local failure 均 fail-safe，只影响 owner capability，并继续后续 mounter。
  - 运行 L2/L4、exec-route、session-durable 的 lifecycle-focused tests 及所有触及的 frozen host/apply tests；全部通过后才进入 4.1。
  - _Requirements: 4.7–4.8, 5.1–5.5, 5.8–5.9, 6.1–6.9, 11.6, 11.8_

## 4. 统一 L2/L4 请求与准入链

- [x] 4.1 集成唯一 L4 owner、L2 gateway 及其原子降级关系
  - 先更新 combined tests，覆盖 L4-before-L2、registration snapshot、unchanged continuation、至多一次 marked public re-entry、foreign marker/AbortSignal identity、nested/concurrent isolation、convergence fail-closed 和 terminal error identity。
  - 删除或退役旧 admission/projection owner；将 `resolveModelInfo` exactly-one wrapper 的唯一权威迁至 L2 scoped gateway，并替换所有被 supersede 的旧断言。
  - 保留 L4 可独立 active、L2 依赖 L4 的批准降级关系，不新增事件 catalog 条目或公共异步 rewrite。
  - 运行 llm-request 与 image-admission 的全部 feature-owner focused tests，以及触及的 frozen LLM/facade/host tests；全部通过后才进入 5.1。
  - _Requirements: 3.6, 4.2, 5.1–5.3, 6.7, 7.1–7.7, 7.10, 8.2–8.3, 11.2, 11.4–11.6, 14.3, 15.3_

## 5. 统一 A11 与 A9/T10 route authority

- [x] 5.1 组合 agent/tools facade 并收窄 execRoute guard/mounter
  - 先更新 guard/apply/facade tests，证明 healthy tools/session substrate 足以激活 execRoute，`events` 或 `agent` facade inactive 不会使其 fail-closed，并替换 worktree 的旧依赖断言。
  - 将 `agent.routeOf` 与 `tools.routeOf` 接到同一个 service-owned authority；保证同一 frozen snapshot identity、正常 missing route 为 `undefined`、unexpected capture failure 被包含且不改变 tool operation。
  - 组合 A11 时保持 consumer-fiber service resolution、official receiver/argument/return/Promise/handle/disposer/error identity，并使单个不可用成员只退化自身。
  - 运行 agent-create、exec-route、M1 agent/tools/session 的全部受影响 focused tests，以及触及的 frozen guard/facade/host tests；全部通过后才进入 6.1。
  - _Requirements: 3.1–3.4, 4.4–4.5, 5.3, 5.7, 6.8, 7.5, 7.8, 7.10, 8.2, 8.4, 9.1–9.2, 9.6–9.7, 11.6, 14.3, 15.4_

## 6. 用 stable observation hub 统一 session durable 生命周期

- [ ] 6.1 以测试先行方式实现 service-lifetime durable observation hub
  - 用一个 native `session/event` entry 和 epoch-local ordered observer maps 替代 worktree 的 per-epoch subscription；`onDurable`/`onceDurable` disposer 只操作 identity-bound private entries。
  - 每次进入用户 listener 前重检 hub/current epoch/state/entry；覆盖 once-before-call、registration order、同步 throw/异步 rejection containment，以及 observer 触发 nested breach 后停止外层 snapshot 后续交付。
  - breach 仅 CAS-detach 当前 epoch、P2-disable、清空私有 observers，不在同步、异步、parallel 或 nested dispatch 中 dispose/reconcile events-bus hooks。
  - 运行 session-durable 与 M1 session/events 的全部受影响 focused tests，以及触及的 frozen events/facade tests；全部通过后才进入 6.2。
  - _Requirements: 3.5, 5.1–5.3, 5.8–5.9, 6.3–6.6, 6.9, 7.5, 8.5–8.6, 11.6, 11.8_

- [ ] 6.2 实现 hub/epoch prepared transaction、恢复与 composite teardown
  - 覆盖首次 hub transaction 失败、facade commit/registry activation 失败、breach 后 idle-hub re-apply、旧 callback/disposer/retained facade、后续 remount 失败和跨 epoch 单 native entry。
  - 实现唯一 composite disposer：先不可失败地关闭 hub、detach/dispose epoch、恢复 durable P2 overlay、disable matching registry epoch，再 best-effort 释放 native hook；所有步骤均尝试且重复 teardown 幂等。
  - 保留 M1 session base、五类 durable metadata、有限 `appendMessage` 一次官方 append 与 fail-before-persistence 语义。
  - 运行 session-durable lifecycle/append/observation tests、M1 session/events 回归及触及的 frozen host/apply/facade tests；全部通过后才进入 7.1。
  - _Requirements: 3.5, 4.3, 4.8, 5.9, 6.1–6.6, 6.9, 7.9–7.10, 8.5–8.9, 11.5–11.8, 15.5_

## 7. 统一 guards、mounter registry 与静态 services

- [ ] 7.1 重建最终 guard branches、feature order 和 active gating
  - 先写 combined host tests，断言最终顺序 `tools -> events -> agent -> llm -> llm/request -> llm/admission -> session -> sessionDurable -> execRoute -> settings -> systemPrompt -> services` 及 pass-1/pass-2 行为。
  - 合并所有 mandatory probes、runtime audits 与 P2 failure；以 `featureRegistry.isActive` 为唯一活动信号，验证每个 dependency failure 不影响无关 later mounter。
  - 保持 SV17 为 `services` 静态成员而非独立 feature/mounter/guard。
  - 运行五个 M2 feature 的 guard/apply-focused tests、全部受影响 M1 host-order tests 及触及的 frozen guard/host tests；全部通过后才进入 7.2。
  - _Requirements: 4.1–4.9, 5.1–5.5, 5.9, 9.7, 11.6, 11.8_

- [ ] 7.2 统一 19-key services namespace 与 definition-level compaction P4
  - 将 `compaction` 作为 `SERVICE_DEFINITIONS` 第 19 个且最后一个静态 key；精确转发三个批准操作并保持 receiver、argument count/identity、return/timing/error identity。
  - 测试 incomplete/hostile compaction 只产生完整 definition-level P4 disabled facade，其他 18 个服务和 parent services 状态不受影响，且不泄露 backend-specific members。
  - 运行 compaction 与 M1 capabilities/services 的全部受影响 focused tests，以及触及的 frozen services/facade tests；全部通过后才进入 8.1。
  - _Requirements: 3.7–3.9, 4.6, 5.4–5.6, 9.3–9.7, 11.6–11.7, 15.6_

## 8. 冻结 catalog、版本与 package contract

- [ ] 8.1 保持 M1 catalog 并加入三项独立 cardinality regression
  - 删除任何 M2 越界 slice/synthetic name，保持 M1 exact 47-name membership、schema、scope、freeze、fault 与 duplicate failure behavior。
  - 分别断言 47-name Cordis catalog、five-kind durable catalog 和 19-key services namespace，不用一个计数推导另两个集合。
  - 运行 M1 events/session/tools/agent/LLM/system-prompt/settings catalog tests、session-durable catalog tests、services shape tests 及触及的 frozen catalog tests；全部通过后才进入 8.2。
  - _Requirements: 8.1–8.9, 11.4–11.7, 14.4, 15.1_

- [ ] 8.2 将 facade/package/version contract 统一到 API `0.3`
  - 更新 `package.json.version` 为 `0.1.0-rc.6-0.3`、`dsh.api` 为 `0.3`，合并全部 audit-only peer dependencies 且不增加无关 runtime dependency。
  - 更新 runtime↔facade 与 plugin↔API 两方向兼容测试、数字 minor progression、runtime mismatch fail-safe 及所有仓库内 version assertions。
  - 运行 foundation/version/package tests、全部因 peer metadata 变化受影响的 M2 guard tests 及触及的 frozen compatibility tests；全部通过后才进入 9.1。
  - _Requirements: 10.1–10.7, 11.5, 14.5_

## 9. 完成 combined lifecycle 与全仓回归

- [ ] 9.1 补齐共享 facade/host fail-safe 测试矩阵
  - 覆盖 P1–P4 precedence、每个 guard/mount/publication boundary、malformed/throwing substrate、registration/diagnostic/disposer failure、repeated apply/dispose、stale epochs、nested/concurrent B operations、retained references 和 unrelated-feature survival。
  - 覆盖 additive public shapes、single authorities、无重复 hooks/wrappers/facade construction，以及所有范围排除项未进入公开 API。
  - 运行所有 M2 focused tests、未受影响 M0/M1 回归和 repository-root `node --test`，修复整合引入的红测但不夹带新功能。
  - _Requirements: 5.5–5.9, 6.1–6.9, 7.1–7.10, 11.2–11.8, 15.1–15.8_

## 10. 迁移 `dsh-read-image`

- [ ] 10.1 用 L2/L4/A9-T10 facade 替换 A1/A2/A6 hacks
  - 在 consumer 仓库删除 `resolveModelInfo` monkey-patch、raw `llm/stream` projection owner、recursive re-entry、legacy `project` field、旧 admission active signal 和 private route traversal，不保留 dormant fallback/escape hatch。
  - 更新 consumer tests，保持 message-only ordering、nested tool-result projection、image-free terminal validation、route behavior 及 disabled/failure semantics。
  - 运行完整相关测试、documented headless smoke 和 dev boot，记录其 facade `0.3` 依赖与迁移结果。
  - _Requirements: 10.6, 12.1–12.7, 14.6, 15.1–15.4_

## 11. 迁移 `dsh-pro-ex-ability-anchor`

- [ ] 11.1 用 session durable helper/observation 与 supported services 替换私有逻辑
  - 在 consumer 实际路径使用 `pluginApi.session.appendMessage` 处理批准的 user/assistant/tool-result kinds，并从 operation/registration boundary 重新读取 composed session facade；删除对应 hand-authored metadata dormant fallback。
  - 保留 raw official `tool/call` boundary 和范围外语义；provenance 不明确时验证 fail-before-persistence，不扩大 S2。
  - 更新 consumer-path tests，运行完整相关测试、documented headless smoke 和 dev boot，记录 facade `0.3` 依赖与迁移结果。
  - _Requirements: 10.6, 13.1–13.7, 14.6, 15.1, 15.5, 15.9_

## 12. 同步 supersession、交付登记并执行最终门禁

- [ ] 12.1 同步被整合设计 supersede 的 specs、断言与公开登记
  - 更新 exec-route guard/mounter 依赖、session-durable prepared/stable-hub 生命周期、L2 `resolveModelInfo` sole ownership 等受影响上游 spec/test/migration wording，移除 contradictory active statements。
  - 更新根 `AGENTS.md` §8、feature list、两 consumer hack inventories/compatibility guidance、package/API docs 与 Tasks 状态；明确 47/five-kind/19 三个不同集合及所有 C/M3/M4 边界。
  - _Requirements: 1.4–1.6, 10.6, 11.4, 14.1–14.7, 15.1–15.9_

- [ ] 12.2 运行最终全量验收并提交 Stage 4
  - 按设计顺序重跑 coordinator focused tests、全部 M2 feature tests、全部 M0/M1 tests、root `node --test`、两个 consumer test/smoke/dev-boot gates。
  - 运行 `git diff --check`、官方 DSH 包未修改验证、worktree/status audit；核对版本、feature registry、Tasks、feature list、AGENTS 与迁移状态一致。
  - 将整合实现、测试、规格 supersession、迁移和登记作为已验证 Stage 4 成果提交；任何门禁失败均不得交付或清理 worktree。
  - _Requirements: 1.7, 2.6–2.7, 10.1–10.7, 11.1–11.9, 12.5–12.6, 13.4–13.5, 14.1–14.7, 15.1–15.9_
