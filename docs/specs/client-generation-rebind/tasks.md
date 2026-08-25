# Stage 3 - Tasks

## Status and authorization boundary

Stage 3 Tasks 草案，待 Stage 3 独立只读对抗性审查与用户明确确认；本文件不授权 Stage 4，不执行任何实现、测试、bundle 生成、迁移验收或提交。只有用户批准本任务书、Stage 3 按仓库规则提交后，后续代理才可按本清单进入 Stage 4。

本任务书的验收边界是已提交的 Stage 2 基线：`docs/specs/client-generation-rebind/requirements.md`（CG-1 至 CG-9）与 `design.md`（Overview、C1–C5、Data Models、Concurrency/Cancellation/Ownership、Visibility and Redaction、Error Handling and Fail-Safe、Testing Strategy、Requirements Coverage、Boundary and Non-Duplication），对应当前已提交边界 `HEAD` `68002c4`（Stage 2 设计元数据承载于 `c1d49d6`）。本次只把已批准设计中 HMR/module evidence 的 domain epoch 语义写完整；不新增 Requirements 验收条目。

## Parallel contract references

本任务书只读引用主 checkout 的 `temp/second-batch-parallel-contract.md`，不复制、不修改该临时契约：

- §0：Stage 3 批准并提交前不得派生/执行，且本 feature 无其他 second-batch 硬依赖。
- §1：本 feature 是 `pluginApi.client.lifecycle` 的 B 类 client facade。
- §2：冻结词汇、`FaceState`、`contributionId/contributionEpoch`、connection/modules/remote/slot/settings 五个独立 epoch，以及公开信号与私有 generation/attempt 的边界。
- §3：client-only 作用域、client feature key `clientLifecycle`、共享/冻结文件和无 host `FEATURE_MOUNTERS` 入口。
- §4：client 官方服务缺失或初始化失败时使用 inert disabled surface，client boot 继续。
- §6：任务书必须列出范围、排除项、允许/禁止文件、依赖、focused tests、提交边界和预检证据。
- §7：focused/全套测试、`git diff --check`、工作区、官方包零修改和治理 token 审计的验证闸。

## Scope and file boundary

- **公开范围**：只实现 client bundle 内的 `pluginApi.client.lifecycle`；运行时 feature key 固定为 `clientLifecycle`。
- **明确排除的需求编号（契约 §6）**：无。CG-1、CG-2、CG-3、CG-4、CG-5、CG-6、CG-7、CG-8、CG-9 全部纳入本任务书；非目标仅按已批准 Requirements/Design 与下列文件边界执行，不以排除需求编号替代范围说明。
- **client-only 约束**：不得进入 host `FEATURE_MOUNTERS`，不得新增 host guard/mounter，不得修改 host `lib/index.js`、`lib/plugin-api-service.js` 或 `lib/guards.js`。
- **当前 Stage 3 允许修改**：仅本 feature 的 `docs/specs/client-generation-rebind/design.md`、`requirements.md`（仅用于恢复已批准边界）和本 `tasks.md`；当前不修改任何 `lib/`、`packages/`、`test/` 或 bundle。
- **未来 Stage 4 允许修改**：`lib/client-generation-rebind.js`（新建生命周期模块）、`lib/client-runtime.js`、按既有流程生成的 `lib/client.js`，以及本任务书各项列出的 client focused tests；只允许更新本 `tasks.md` 的实施状态。
- **未来 Stage 4 禁止修改**：`AGENTS.md`、本 feature 的 `goal.md`/`requirements.md`/`design.md`、`temp/second-batch-parallel-contract.md`、`docs/specs/plugin-api-features/feature-list.md`、其他 feature spec、`package.json`、`packages/**`、主包 patch、`lib/index.js`、`lib/plugin-api-service.js`、`lib/guards.js`、契约冻结文件和任何 `/usr/lib/node_modules/@deepseek-ai/dsh/**` 文件。`../dsh-read-image` 与 `../dsh-pro-ex-ability-anchor` 只可作外部只读观察对象。
- **依赖边界**：只消费 connection、remote、slot、settings、modules 的官方公开 client 面；不读取官方私有 generation/attempt，不复制 browser bundle，不承担 host replacement、EO/UB、transport resume/ack、remote discovery、settings wire schema、slot rendering、execution/usage/durable identity 或 profile mutation。

## Contract vocabulary and evidence boundary

- `FaceState` 只使用 `available | pending | unavailable | degraded | disposed`，不把 execution outcome 词汇带入 lifecycle projection。
- generation 是 owner-local opaque token；revision、`contributionId` 和 `contributionEpoch` 只在其 owner/face 作用域内解释，跨 owner 不比较。
- epoch 必须是五个独立域：`connection`、`modules`、`remote`、`slot`、`settings`。connection 只由官方公开 readiness/`connection/reset`/host description 信号推导；modules 只由官方公开 module graph、load-cache、arrival/HMR invalidation 面推导；remote、slot、settings 分别复用其既有公开 wrapper。任何一个域变化不得重写其他四个域，也不得合成一个全局数字。
- bind/rebind 必须遵循 Design C3 的 per-face `latest-wins`、幂等且 identity-bound disposer、partial cleanup 和官方契约保真；stale 结果必须遵循 Design C4 与 `docs/standards/concurrency-and-cancellation.md` §4–§6。
- registry/projection 形状遵循 `docs/standards/api-shape.md` §1–§3；generation/disposer 语义遵循 `docs/standards/identity-and-lifecycle.md` §2；诊断脱敏遵循 `docs/standards/visibility-and-redaction.md` §1–§3。

## Fail-safe layering

- **Disabled/inert surface**：仅当核心官方 client 服务缺失或 malformed，或 lifecycle registry 初始化失败时，`clientLifecycle` 才降级为 disabled/inert surface；必须记录安全诊断、继续 client boot，且不影响其他 client leaves。
- **Local evidence degradation**：在核心服务已存在且 lifecycle 已初始化后，单个 adapter/evidence 缺失或失败只使受影响 face 标为 `unavailable`/`degraded`，不关闭 lifecycle facade。
- **Contained operational failures**：listener、evidence subscriber、bind/disposer cleanup 或 diagnostic emission 的 throw/reject 必须在对应 listener、contribution 或 diagnostic 边界内 contained；不得把整个 facade/client boot 转为 disabled/inert，也不得影响无关 face。disposer failure 仍不得破坏新 contribution 的 identity ownership。

## Ordered implementation and verification tasks

- [ ] 1.1 在 `lib/client-generation-rebind.js` 建立 client lifecycle registry 与冻结的 `pluginApi.client.lifecycle` 核心面：实现 `registerFace`、`availability`、`onChange`、`onRebind` 和只读 `scan`；校验稳定 `faceId`、`ownerId`、`kind`、`scope: 'client'`、required contract/capabilities、bind callback 与 disposer；为每次 owner-local bind/rebind 生成 opaque generation、独立 owner-local revision、`contributionId`/`contributionEpoch`，并保持 `FaceState` 与 execution outcome 隔离。（覆盖：CG-1 AC1–AC3、CG-2 AC1/AC4、CG-6 AC1–AC3；Design：C2、Data Models、Concurrency/Cancellation/Ownership；契约：§2、§3）
- [ ] 1.2 在 `test/client-generation-rebind.test.mjs` 建立纯本地 client fixtures 和 registry 基础断言：覆盖跨 owner 不比较 generation、owner-local revision 独立存在、重复 registration 复用或 typed reject、snapshot 深冻结、状态/epoch/reason 字段完整，以及 projection 不注册 contribution、不触发 rebind、不创建 execution/usage/durable identity 或跨 owner generation。（覆盖：CG-1 AC2–AC3、CG-2 AC4、CG-6 AC1–AC3、CG-9 AC1/AC3；Design：C2、Visibility and Redaction）

- [ ] 2.1 在核心官方 client 服务已存在且 lifecycle 已初始化的前提下，接入五个独立的公开 evidence adapter：connection 只使用官方公开 host description/readiness/`connection/reset` 信号；modules 只使用官方公开 module graph/load-cache/invalidation（含 HMR）面，不读取私有 generation/attempt；remote 复用既有 `client-remote-contribution.js` 官方 `$mount` 生命周期；slot 复用 `client-slots.js`/`client-slot-events.js` 的 declaration-lifetime `inject` 与 `slots/changed`；settings 复用 `client-settings-scope.js` 的 bind snapshot/subscribe。任一单独 adapter/evidence 缺失或失败只降级受影响 face，不合并五域 epoch；核心服务缺失/初始化失败按 Fail-safe layering 产生 disabled/inert surface。（覆盖：CG-2 AC2–AC3、CG-3 AC1–AC3、CG-7 AC1–AC3；Design：C1、C2、Source and hook classification、Boundary and Non-Duplication、Error Handling and Fail-Safe；契约：§2、§3、§4）
- [ ] 2.2 在 `test/client-generation-rebind.test.mjs` 增加五域 epoch 矩阵：分别推进 connection、modules/HMR graph、remote namespace、slot declaration、settings revision，验证每次只改变对应 epoch；在 refresh、reconnect、module arrival/HMR、remote mount、slot redeclare 与 settings revision 同一时间窗内保留五个独立 cause/epoch；验证 modules 证据只来自公开 graph/load-cache/invalidation 面，缺失或 malformed evidence 只影响局部 face，host/旧 cache/package name 不被用来猜测兼容性。（覆盖：CG-2 AC2–AC3、CG-3 AC1–AC3、CG-7 AC1–AC3；Design：C1、C2、C5、Testing Strategy；契约：§2、§7）

- [ ] 3.1 在 `lib/client-generation-rebind.js` 实现 per-face `latest-wins` bind scheduler：同一 face 的评估串行、不同 face 可并行；仅在 required evidence 齐备时以当前 generation/epoch 调用一次 bind，记录 contribution-owned disposer 和 caller `AbortSignal`；invalidate/rebind 时使旧 contribution 失去提交资格，disposer 至多执行一次，partial setup 只回滚本 contribution；evidence 恢复后以新 generation/epoch 重绑，并按 Design C3 发布包含 affected face、old/new generation 或 epoch 与 bounded reason 的 owner-scoped 生命周期通知。plugin unload 时清理 pending bind、availability/evidence listener、timer 及由官方服务拥有的 registration；listener 或 disposer cleanup 失败必须 contained，不得关闭其他 contribution、lifecycle facade 或 client boot。（覆盖：CG-4 AC1–AC5、CG-6 AC2–AC4；Design：C3、Concurrency/Cancellation/Ownership、Error Handling and Fail-Safe；契约：§2、§4）
- [ ] 3.2 在 `test/client-generation-rebind.test.mjs` 覆盖 bind/rebind 与 ownership 时序：evidence 齐备后 exactly-once bind、失效后 disposer 至多一次、再次可用以新 generation/epoch 重绑、partial bind 只清理自身资源、旧 disposer 不影响同 public key 的新 contribution；plugin unload 后 pending bind/listener/timer 无发布资格且按官方契约清理；通知包含 affected face、old/new generation 或 epoch、cause、observedAt 和 bounded reason。（覆盖：CG-4 AC1–AC5、CG-6 AC1–AC4；Design：C3、Data Models、Concurrency/Cancellation/Ownership）

- [ ] 4.1 为每个 bind/rebind 异步操作建立 `(ownerId, generation, faceId, contributionEpoch, AbortSignal)` stale guard，并在 Promise resolve/reject、event callback、HMR completion、reconnect callback 和 disposer settlement 前检查 owner、current generation、face state、contribution identity 与 lifecycle currency；stale 结果只能进入 bounded diagnostic，不能发布当前 availability、调用新 disposer、重复注册或启动新 bind；底层操作不可取消时仍阻断其成为 current state。（覆盖：CG-5 AC1–AC4、CG-4 AC2、CG-6 AC2–AC3；Design：C4、Concurrency/Cancellation/Ownership；标准：`concurrency-and-cancellation.md` §4–§7）
- [ ] 4.2 在 `test/client-generation-rebind.test.mjs` 使用可控 Promise、reconnect/HMR callback 与 replacement/dispose fixtures，验证每种 stale 条件下旧结果不能写回当前 snapshot、触发 bind、注册重复 contribution 或调用新 disposer；同时验证 stale diagnostic 有界，listener/evidence subscriber 的 throw/reject 被 contained，当前 face、相关 facade 和 client boot 保持可用，不会被转换为 disabled/inert。（覆盖：CG-2 AC5、CG-4 AC2、CG-5 AC2–AC4；Design：C4、Error Handling and Fail-Safe、Testing Strategy；契约：§4、§7）

- [ ] 5.1 在 `lib/client-runtime.js` 将 lifecycle surface 接入现有 caller-bound client composition：client-only feature key 必须是 `clientLifecycle`，`pluginApi.client.lifecycle` 与现有 `mountRemote`、`settingsScope`、`slots`、`services.modules`、`connection`/events 共存；确认该面绝不进入 host `FEATURE_MOUNTERS`、不新增 host guard/mounter，并保持官方 member name、RPC payload、event ordering、cancellation、return value、raw error 与 disposer ownership 原样直通。（覆盖：CG-4 AC6、CG-8 AC1–AC2、CG-9 AC3；Design：Overview、C3、Boundary and Non-Duplication；契约：§3、§4）
- [ ] 5.2 在 `test/client-remote-contribution.test.mjs`、`test/client-settings-scope.test.mjs`、`test/client-slots.test.mjs`、`test/client-connection.test.mjs`、`test/client-official-services.test.mjs` 和 `test/client-official-events.test.mjs` 补充 integration assertions：对 official `$mount`、settings `bind`、slot registration/inject/subscribe、connection RPC/settings 与 modules `import`/`invalidate` 保留精确 receiver、payload、signal、return/disposer identity、event ordering 和 raw errors；lifecycle registry 失败时不得静默替换 official namespace 或私有实现。（覆盖：CG-4 AC6、CG-7 AC1–AC3、CG-8 AC1–AC2；Design：C1、C3、C5、Testing Strategy；契约：§2、§3、§7）

- [ ] 6.1 在 `lib/client-generation-rebind.js` 实现 bounded diagnostics/redaction：required API/contract version 与 capabilities 按已批准 Design C5 对 host description/官方 face evidence 做比较；只向既有 logger 与可用的 `plugin-diagnostics` 公开 projection 发射 `{faceId, ownerId, required, provided, reason}` 等非敏感信息；单个 mismatch 只使对应 face `unavailable`/`degraded`，projection 不拥有/改变 diagnostic check 状态，不提供 repair/UI；redaction fail-closed，projection 永不包含 remote payload、settings value、credential 或 request content，诊断发射失败不得改变 lifecycle result。（覆盖：CG-2 AC3–AC5、CG-7 AC1–AC4、CG-9 AC1–AC2；Design：C2、C5、Visibility and Redaction、Error Handling and Fail-Safe；标准：`visibility-and-redaction.md` §1–§3）
- [ ] 6.2 在 `test/client-generation-rebind.test.mjs` 和 `test/client-bundle.test.mjs` 验证 missing/mismatched contract version/capabilities 的局部降级、bounded diagnostic、无关 face 保持 active、visibility policy 字段保留和 redaction fail-closed；分别验证两层 fail-safe：核心 official service 缺失/malformed 或 lifecycle 初始化失败时只产生 disabled/inert `clientLifecycle` surface、记录安全诊断并继续 client boot；listener、evidence subscriber、disposer cleanup 或 diagnostic emission failure 必须被 contained，保持已初始化的 facade、无关 face 与 client boot 可用，绝不能将 surface 改为 disabled/inert；验证 reapply/dispose 仍 identity-bound 且幂等。（覆盖：CG-2 AC3/AC5、CG-6 AC2/AC4、CG-7 AC2–AC4、CG-9 AC1–AC2；Design：Error Handling and Fail-Safe；契约：§3、§4、§7）

- [ ] 7.1 在 `lib/client-runtime.js` 完成后按仓库既有 client bundle 流程重建提交版 `lib/client.js`；在 `test/client-bundle.test.mjs` 验证 bundle 中公开 `client.lifecycle`、`clientLifecycle` active/disabled surface、optional-service fail-safe、reapply cleanup 与 existing client leaves 兼容；同时审计 bundle 无跨插件 runtime import、治理 token、host `FEATURE_MOUNTERS` entry、官方替代行或未批准 R/client wire surface。（覆盖：CG-2 AC5、CG-8 AC1–AC2、CG-9 AC3；Design：Architecture、R-Class Assessment、Boundary and Non-Duplication；契约：§3、§7）
- [ ] 7.2 新增 `test/client-generation-rebind-migration.test.mjs` 的 migration-shaped client integration coverage，使用已批准的 official client fixtures 验证 remote/settings/slot consumers 经稳定 facade 绑定、旧 contribution/hack 路径不能写回 stale state 或绕过公开 API；对 `../dsh-read-image` 与 `../dsh-pro-ex-ability-anchor` 只做外部 headless/dev boot 只读观察并记录结果，不修改外部仓库，不把生产/社区兼容性或 transport reconnect guarantee 写成验收承诺。（覆盖：CG-4 AC1–AC6、CG-5 AC2–AC4、CG-6 AC1–AC4、CG-8 AC3–AC5；Design：Testing Strategy、Boundary and Non-Duplication；契约：§6、§7；AGENTS.md §5）

- [ ] 8.1 运行 focused lifecycle/bundle/integration/migration tests 后运行仓库规定的 `npm test`（使用脚本内置 4G 护栏，不裸跑 `node --test`），并用 `git diff --check`、目标文件范围/owner/夹带检查、`git status --short --untracked-files=all`、官方 DSH 包零修改检查和治理 token 审计收集证据；分别记录 focused green、全套 green、外部只读 boot 观察及未验证的生产/社区兼容性，确认 client-only、无 host guard/mounter、五 epoch 独立、bind/rebind、stale guard、官方契约保真，以及“核心服务/初始化失败才 disabled/inert、listener/disposer/diagnostic failure 全部 contained”的分层 fail-safe 均有对应证据。Stage 4 交付完成后才可在清洁工作区提交实现、测试、bundle 和任务状态；本阶段不执行该任务。（覆盖：CG-1 至 CG-9；Design：Testing Strategy、Requirements Coverage、Error Handling and Fail-Safe；契约：§0、§3、§6、§7）
