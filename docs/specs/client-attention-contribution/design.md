# Stage 2 - Design

> feature_name: `client-attention-contribution`
> milestone: M9
> status: SPEC1 Stage 2 草案 v2（2026-09-05 批次；v2 按人类指示以 R-first/能力优先修订），待用户确认；Stage 3 Tasks 只可在本阶段获批后开始。

## Status

SPEC1 Stage 2 草案 v2。本文承接 v2 Requirements（同批待确认）。v2 相对 v1 的实质修订：从"host B hub + 主包集中 $mount + 零 R"改为**三层架构 + 两个 R slice**——host hub（B，单一条目 authority）→ 官方转发管线（`dsh-api-remotes` 新 owner 包）→ 浏览器 runtime（`dsh-client-runtime` 新 owner 包）→ 主包 client 面 `ctx.pluginApi.attention`；纯浏览器插件经 client `contribute` 发布（host hub 仍唯一 authority）。

## Overview

- **host attention hub（facade B）**：唯一条目 authority。条目生命周期（seq/epoch/dedupe/expiry/容量/withdraw）、action handler、dismiss/invoke 裁决、host 侧消费者投影都在 hub。条目非 durable、不写 session 历史。
- **api-remotes slice（R，新 owner 包）**：复刻官方 `api-remotes` 行契约（11 事件转发白名单 + Remote Agent/Session identity BFF + client manifest），并把 attention 更新作为 hub 产出的转发事件沿**官方 host→browser 管线**送达——取代 v1 的 facade 私有注册 remote 通道（单一管线语义）。
- **client-runtime slice（R，新 owner 包）**：复刻官方 `client-runtime` browser 模块契约（`slots`/`slots/changed`、`conversationEvents`、`conversationViews`、`connection/reset`、sessions/workspaces reflect 面），并承载浏览器 attention runtime：转发消息对账/去重、epoch 重建、host snapshot 重取、slots 呈现集成——rebind/HMR 生命周期由被替换官方模块原生承担，消费者不再需要 `$mount` 胶水。
- 主包 client 面（`ctx.pluginApi.attention`）保持为公共 API 出口：消费 client-runtime slice 暴露的内部 runtime，提供 `current/list/observe/contribute/dismiss/invoke/availability`。

## Current-State Findings

- 官方无 host attention/notification 服务；官方相关面全在浏览器：`dsh-client-runtime`（行 `client-runtime`，web，**无 owner**；browser 服务 `slots`、`conversationEvents`、`conversationViews`；事件 `slots/changed`、`connection/reset`；reflect 提供 `sessions`/`workspaces` outward face；client manifest inject `[dsh-client-connection, dsh-typert-registry, dsh-api-remotes]`）、`dsh-api-remotes`（行 `api-remotes`，web，**无 owner**；index 首部即 `API_REMOTE_FORWARDED_EVENTS` 白名单；`ctx.remote.$on` 合法键集 = 白名单）。
- **api-remotes 转发白名单（11 个，须完整复刻）**：`agent-preset/selected`、`commands/change`、`credentials/updated`、`cordis/request-run`、`cordis/request-run-resolved`、`cordis/dynamic-package`、`cordis/dynamic-retract`、`cordis/inspect-query`、`cordis/inspect-query-resolved`、`llm/adapters-updated`、`settings/document-updated`；另有 Remote Agent/Session identity BFF（`ApiRemoteSessionNotFound`、subagent ownership 围栏）。
- 两行都带 `dsh.client` manifest（capability-strategy §10 六问全中）⇒ 替换必须自建 client bundle、以官方模块 id 注册（R7；先例：session-channel 两包以官方模块 id `@deepseek-ai/dsh-client-connection`/`@deepseek-ai/dsh-api-gateway` 发布自有 bundle）。
- 主包 client manifest 现 inject `[dsh-client-connection, dsh-client-runtime, dsh-api-remotes, dsh-client-ui-settings]`：主包 client 面运行在这些模块的浏览器 ctx 中——client-runtime slice 被替换后，主包 client 面在其 ctx 中消费新 runtime；装配集成波核对 inject 语义不变性。
- headless profile 无 `connection`/`api-remotes`/`client-runtime` 行 ⇒ client 半面在 headless 必然 unavailable（如实报告）。
- 原生动态发现（任意 client 插件免装配发现 remote 面）横跨官方 loader/module-table 语义，AGENTS.md §2.4 列为 C 类：两个 slice 激活后装配面收窄为"注入被替换模块或主包"的受支持路径，C 登记保留。
- registry 现状：`attention` 零占位；`api-remotes`/`client-runtime` 行无 replacement owner（新建包可行）；attention 相关事件零占位。

## Architecture

```text
 host producers            host consumers (TUI/desktop/operator)
   │ contribute                   │ current/list/observe
   ▼                              ▼
 ┌──────────────────────────────────────────────┐
 │ pluginApi.attention (host hub; B; 唯一 authority) │
 │ items · seq · epoch · dedupe · expiry · capacity │
 │ actions · dismiss/invoke · redaction(先行)      │
 └───────┬──────────────────────────────────────┘
         │ attention/update（hub 产出；frozen+redacted；catalog fact/observation）
         ▼
 ┌──────────────────────────────────────────────┐
 │ dsh-api-remotes slice (R; 新 owner 包)        │
 │ 复刻 11 事件转发白名单 + BFF + client manifest │
 │ 官方 host→browser 管线：转发 attention 更新    │
 └───────┬──────────────────────────────────────┘
         ▼  (browser)
 ┌──────────────────────────────────────────────┐
 │ dsh-client-runtime slice (R; 新 owner 包)     │
 │ 复刻 slots/conversationEvents/Views/reflect   │
 │ 浏览器 attention runtime: 对账/去重/epoch/     │
 │ connection/reset·HMR 重建 · slots 集成        │
 └───────┬──────────────────────────────────────┘
         │ internal runtime contract
         ▼
   ctx.pluginApi.attention (主包 client 面)
   current/list/observe · contribute · dismiss · invoke
         │
   Web UI consumers（slots/UI 呈现由 consumer 决定）
         ▲ client→host 请求（contribute/dismiss/invoke; typed; host 侧裁决）
         └──────────── host hub（stale-guard 后执行）
```

事实来源纪律：attention 不自行判断 turn settle（activity 投影是事实来源）；UI 载体（Notification 权限/声音/framework）是 consumer 侧选择。host hub 是单一条目 authority——任何 slice 都只是传输/运行时，不产生第二个条目权威。

## Components And Interfaces

### 1. 公共面与 idiom（registry/capability 登记在集成波完成）

host：`attention.contribute`（contribution|register）、`attention.dismiss`、`attention.invoke`（operation 语义域动作）、`attention.current/list`（projection|read）、`attention.observe(.handle)`（projection|subscribe）、`attention.availability`（selfDescription）、capability `attention`。

client：`ctx.pluginApi.attention.{current,list,observe,observe.handle,contribute,dismiss,invoke,availability}` 同形登记（runtime=client；client 领域树新增 `attention` 根与 namespace 行；API 出口属主包 client 面，运行时属 client-runtime slice）。

### 2. Host hub（B；单一条目 authority）

同 v1 设计 + 接收 client 侧转发请求：client `contribute`/`dismiss`/`invoke` 到达 hub 时按 owner 派生（client 调用方上下文）、条目 live/可见性、epoch/generation 做 stale-guard 后执行。条目内容与 action handler 只在 host hub 注册。

### 3. Api-remotes slice（R；新建 `dsh-api-remotes` owner 包）

- 行：官方 `api-remotes`（web）disabled + insert 替代行（R1）；包/行名集成波定稿（中性命名）。
- 复刻清单（R2，parity fixture 逐项）：`ctx.remote.$on` 合法键集 = 11 个白名单事件及其逐字转发语义；Remote Agent/Session identity BFF（含 not-found 与 subagent ownership 围栏）；错误/disposer 形状；client manifest 全半面（R7：自建 bundle、官方模块 id `@deepseek-ai/dsh-api-remotes`、`window.__DSH_BOOT__`/HMR 验证）。
- 扩展：把 hub 产出的 `attention/update`（frozen、redacted、带 item id/seq/epoch 的消息族）纳入转发集——只对本行新增的注意力消息生效，不改动官方白名单语义。
- 自检（R4/R5/R6）：官方行 disabled、替代行唯一 active、runtime/包 `A.B.C` 一致、无组件 owner 冲突、parity probe；失败 ⇒ log + 官方转发行为照常（fork/官方行为 fallback）+ attention 路由不宣称（client delivery 走 typed unavailable；host hub 不受影响）；绝不留下官方行禁用而无工作替代的空洞。
- 退役/上游：官方提供非白名单 typed publication seam 后退役（feature-list §3.1 U-series）。

### 4. Client-runtime slice（R；新建 `dsh-client-runtime` owner 包）

- 行：官方 `client-runtime`（web）disabled + insert 替代行（R1）；包/行名集成波定稿。
- 复刻清单（R2）：`slots`（含 `slots/changed`）、`conversationEvents`、`conversationViews`、`connection/reset`、sessions/workspaces reflect outward face；client manifest 全半面（R7；官方模块 id `@deepseek-ai/dsh-client-runtime`）。
- 扩展——浏览器 attention runtime（内部契约，非公共 API）：订阅经管线送达的 `attention/update`；按 item id/seq 去重与对账；epoch 随 `connection/reset`/HMR 重建并重取 host snapshot；把 frozen/redacted 视图暴露给主包 client 面；提供 slots 呈现集成（consumer 选择使用）；client→host 请求（contribute/dismiss/invoke）经既有 client→host 请求通道转发（typed、不排队）。
- 自检/版本/owner：同 §3；失败 ⇒ runtime 不宣称 + slots/conversation/reflect 官方行为照常 + client face unavailable（typed）。
- 退役/上游：官方提供原生 attention/reconnect seam 后退役。

### 5. 装配与 presence

- 主包 client manifest 的 inject 列表不变（`dsh-client-connection`、`dsh-client-runtime`、`dsh-api-remotes`、`dsh-client-ui-settings`）——两行被替换后主包 client 面在替换模块的 ctx 中运行并消费其 runtime；集成波以装配等价性验证（full 与选择性安装同一组行、同一行为）。
- client 插件获得 `ctx.pluginApi.attention` 的受支持路径与既有 client 面一致（主包注入）；HMR 重载后由 client-runtime slice 原生重建，消费者不需要 `$mount` 胶水（Requirement 6 AC4 的 fixture）。

### 6. R 决策表（v2）

| 候选官方组件 | 候选语义 | v2 决策 | 证据 |
|---|---|---|---|
| `dsh-api-remotes`（无 owner，web） | host→browser typed 管线 | **采纳（新 owner 包）** | 11 事件白名单 + BFF 契约可复刻（parity fixture 门）；attention 走官方管线，弃平行通道 |
| `dsh-client-runtime`（无 owner，web） | 浏览器 attention runtime/native rebind | **采纳（新 owner 包）** | slots/conversation/reflect 契约可复刻；Goal 明示以 replacement 取代 $mount 胶水 |
| `dsh-client-connection`/`dsh-api-gateway`（已有 session-channel owner 包） | transport/gateway | 不采纳 | 本 feature 是其消费者；不重复替换 |
| `dsh-session`/activity（事实来源） | session-scope correlation | 不采纳 | 只读消费 activity 投影（A/B） |
| notification carrier（浏览器 Notification/声音/桌面） | 呈现载体 | 不采纳（非能力面） | consumer/UI 层职责；不是 host authority |

framework 横切语义与 boot 胶水不进任何 slice。两 slice 的契约复刻可证明性由 Stage 3 parity probe 门控；probe 失败按 §3/§4 的 fallback 语义处理（绝不虚报能力、绝不制造空洞）。

## Data Models

### 1. Attention item（public 形状；frozen）与 hub 内部记录

同 v1（item 形状含 id/ownerId/seq/scope 关联/level/title/body/dedupeKey/expiresAt/audience/actions/correlation/meta/observedAt；hub 记录含 state/removal/handlers/epoch）。

### 2. 转发消息族（host hub 产出 → 管线 → browser runtime）

```js
AttentionUpdate { kind: 'attention.snapshot'|'attention.delta', epoch, seq,
                  changes?: [{op:'add'|'remove'|'update', item?, id?, reason?}] }  // frozen+redacted
AttentionRequest  { kind: 'attention.request', op: 'contribute'|'dismiss'|'invoke',
                    spec?/itemId?/actionId?/by? }                                  // client→host
AttentionOutcome  { kind: 'attention.outcome', ok, code, handle?, reason? }        // host→client
```

catalog 登记：`attention/update`（eventSemantics=observation；producer authority = attention hub（host）；经 api-remotes slice 转发）。

### 3. Browser runtime 状态

```js
{ epoch, itemsBySeq, dirty?: bool,
  lastHostEpoch, pendingRequests: [] /* 不排队：仅 in-flight 请求 */ }
```

### 4. 脱敏边界

title/body/meta 在 host hub 产出转发消息前按受众裁剪（fail-closed：host 脱敏失败 ⇒ 不产出负载）；client 只做形状校验；日志只留摘要；展示包络（XSS）属 consumer 责任面，共享 `plugin-profile-management` 威胁清单词汇。

## Hook Exposure And Component Ownership

| 钩子/源 | 类别 | 引出方式 | 失败路径与 guard |
|---|---|---|---|
| host hub（条目/seq/epoch/容量） | B | 主门面 apply 内初始化；fail-safe | 失败 ⇒ availability degraded/unavailable + log |
| activity 派生信号（producer 可选适配） | A/B | `sessions.activity` 只读投影 | 缺位 ⇒ 适配不启用；correlation 不可验证 ⇒ unknown |
| `connection/reset`、HMR、`slots/changed` | A→R | client-runtime slice 原生订阅（复刻官方事件语义） | runtime 不激活 ⇒ client face unavailable；epoch 重建纪律 |
| 官方 host→browser 管线（attention 转发） | R | api-remotes slice 转发 `attention/update` | slice 不激活 ⇒ delivery unavailable；host hub 不受影响 |
| client→host 请求（contribute/dismiss/invoke） | R+B | 既有 client→host 请求通道 + hub 裁决 | 不可达 ⇒ typed unavailable（不排队）；stale-guard |
| 官方 `api-remotes` 白名单/BFF | R（复刻） | slice 全量复刻 + parity fixture | parity 失败 ⇒ slice 不宣称扩展 + 官方行为照常 |

## Error Handling And Lifecycle

- 失败呈现（契约 §6）：P1/P2 统一；P3 per-face/slice degraded/unavailable（headless 无 client 行、slice 不激活/错配、管线中断）；业务冲突（same-owner/cross-owner、dedupe、capacity、not-found/stale）为 typed result。
- 生命周期：hub 随主门面 ctx；runtime 随 client-runtime slice（被替换官方模块）生命周期；teardown = client 面关闭（新 epoch 不再回调）→ 管线消费注销 → hub 清理（owner 条目 `withdrawn`）；disposer 幂等且 identity-bound。
- 容量与清理：驱逐只在注册点且可观测；expiry 扫描有界；owner teardown 不误删他人条目。
- Redaction：fail-closed 硬规则（host 脱敏失败 ⇒ 不产出负载，宁可 unavailable）。

## Testing Strategy

1. Contribution/conflict/dedupe（R1/R2/R13）：host/client 两 synthetic 插件反序验证同 owner/cross-owner 冲突、dedupeKey、dispose 幂等、容量驱逐可观测。
2. 生命周期（R3/R4）：expiry/dismiss/withdraw/eviction 的 removal reason；owner teardown 隔离；无 durable 写入断言。
3. Client/rebind/HMR（R5/R6）：snapshot+delta 对账、seq/id 去重、`connection/reset` 后 epoch 重建、HMR 后 client face 免 $mount 恢复、旧代次请求被 stale 拒绝、离线 unavailable（不排队）、client contribute 端到端（纯浏览器插件发布）。
4. Action（R7）：live/可见性/action 校验、handler containment、owner 变更后 handler 失效。
5. Slices（R11/R12）：api-remotes 的 11 事件白名单逐字转发 + BFF parity；client-runtime 的 slots/conversation/reflect parity；版本错配、boot 自检、owner 冲突、无双跑、模块 id 注册、HMR、移除恢复、headless 缺席；probe 失败 ⇒ 官方行为照常 + 扩展不宣称。
6. Redaction/隐私（R2/R9/R10）：host 投影/转发负载/日志机械断言无 secret/owner-private；非 durable 断言。
7. Registry/shape（R14）：host/client `attention` 命名空间、成员、capability、catalog（`attention/update`）、两个新包/行登记机械一致。
8. 终验：受护 `npm test`、`git diff --check`、registry/surface 一致性、官方包零修改审计、全局对抗性终审。

## Standards Applicability And Alignment

- `capability-strategy.md`: applicable。两个 R slice（新 owner 包；六问全中 ⇒ 完整 client 半面 R7）；framework 语义不进本 feature；残余 C（原生动态发现、UI 载体）附证据。
- `api-shape.md`: applicable。contribution 不写领域事实 + projection 只读双面；无 mutation/策略混入。
- `api-idioms.md`: applicable。verb/handle/判别式结果/availability 全对齐。
- `public-api-shape.md`: applicable。host/client `attention` 领域根；两新行/包运行时命名中性；不暴露 remote key/包/行身份。
- `composition-and-authority.md`: applicable。host hub 单一条目 authority；owner 派生（含 client）；冲突规则；stale disposer；驱逐可观测。
- `domain-composition.md`: applicable。不拥有 activity/session 事实；不旁路 durable authority；client 侧受众更保守。
- `ordering.md`: applicable。hub seq 投递；无跨领域排序图。
- `identity-and-lifecycle.md`: partially applicable。item id/seq 领域身份；无 generation/terminal 混用。
- `durable-state-and-scope.md`: applicable（非 durable 边界）。
- `visibility-and-redaction.md`: applicable。host 脱敏先行、client 形状校验、fail-closed、展示包络词汇共享。
- `concurrency-and-cancellation.md`: applicable。rebind/HMR/旧代次提交资格、disposer 所有权、handler containment。
- `versioning-and-protocols.md`: applicable。冻结基线；新增两 owner 包遵循 `A.B.C` 装配契约（错配只停用对应 slice）；attention 转发消息族 revision 集成波登记。

## Key Decisions And Tradeoffs

1. **两个 R slice 采纳（v2）**：attention 传输与浏览器运行时成为官方模块级能力（单一管线、native rebind/HMR、slots 集成），与 Goal"优先 replacement 而非 $mount 胶水"对齐。成本：两行完整 client 半面复刻（parity fixture + R7 构建），Stage 3 以 probe 门控；probe 失败按 fallback 语义降级，绝无空洞。
2. **host hub 单一条目 authority 不变**：client 生产/消费都回到 hub；无第二 hub、无双 authority；离线 typed unavailable 而非本地半权威。
3. **纯浏览器插件可发布**（v2 能力回收）：client `contribute` 经既有请求通道转发；host 裁决 owner/可见性/去重。
4. **hub 非 durable**：条目不落任何 durable 记录；审计由 consumer 自持。
5. **client 不排队**：offline typed unavailable，避免"看似成功"假象。

## M9 Contract Conformance And Deviation Notes

契约 §2/§5/§6 采纳；§2.5 attention 条款落实。偏离记录：

1. contribution verb `contribute`（保留）。
2. v1"零 R + 集中 $mount"废弃 → 两个 R slice（R 决策表见 §6）。
3. client-only 生产者支持（Requirement 5/10 AC5）。
4. 契约 §7.1 共享文件边界：本线在并行期只写 `docs/specs/client-attention-contribution/**` 与两个新建 owner 包目录（api-remotes、client-runtime；该两官方组件 owner 属本线）；registry/feature-list/README/full 聚合装配由集成波统一更新。

## Design Completion Condition

本设计覆盖 v2 requirements（R1–R14）：三层职责与单 authority 不变式；两个 R slice 的复刻清单、parity fixture 与 fallback 语义；转发消息族与 runtime 状态机；装配/presence 路径；registry/包/行拟新增清单；失败/guard 策略逐钩子声明。用户确认前的修订就地更新本文与 requirements 对应条目。
