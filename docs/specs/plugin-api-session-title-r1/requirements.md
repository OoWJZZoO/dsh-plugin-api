# Requirements: plugin-api-session-title-r1

> feature_name: `plugin-api-session-title-r1`
> 状态：Stage 1 已批准（R-5.11 于 Stage 2 设计批准时同步修订，见文末修订记录）
> 上游：Stage 0 Goal（已批准）、`AGENTS.md` §2/§4/§6、`docs/capability-strategy.md`（R1–R9）
> 类型：R 类（replacement bundle）；host-only，无 client bundle。
>
> **维护修订（包政策推行）**：运行时命名已去除 `r1` 治理后缀——源码 `packages/session-title/`、row id `plugin-api-session-title`、feature `session-title`、契约符号 `Symbol.for('dsh-plugin-api.session-title.contract')`；本 spec 的历史治理名 `plugin-api-session-title-r1` 仅在 `docs/` 与 AGENTS.md 登记中保留。辅助包采用与主包一致的 `<runtime>-<api.protocol>` 版本协商（当前 `0.1.0-rc.6-0.5` / `dsh.api: 0.5`），主包校验辅助包版本一致；不一致时仅停用本 R 类特性（官方原接口仍由替代行/官方等价 fallback 提供），不停用主包。安装经全量聚合 bundle `@deepseek-ai/dsh-plugin-api-full` 或选择性安装主包 + 本辅助包。

---

## Stage 0 Goal 摘要

- `feature_name`：`plugin-api-session-title-r1`
- 类型：R 类（replacement bundle，host-only），fork 官方 `session-title` 行。
- 拟议包名：`@deepseek-ai/dsh-plugin-api-session-title`（按 compaction-events-r1 确立的 `@deepseek-ai/dsh-plugin-api-<domain>` 命名规范；最终在 Stage 1 锁定）。
- Goal：为社区提供一条稳定的会话标题候选消息资格策略：任何插件都可以声明“哪些已入库的用户消息不得（或应当替换为其他消息）参与会话标题生成”，使 fallback 与已注册的标题 provider 在同一规则下工作。
- 要解决的问题：任何会向 session log 注入合成/虚拟轮次的插件——轨迹锚定、回放、迁移工具、测试夹具——只要把合成消息 stamp 成 `source.kind: 'user'`，官方 session-title 的 fallback 与 first-prompt provider 就会把合成消息当作标题来源。社区作者目前只能在 session/event 上做事件后纠偏、直读 `sessionTitle.registration` 私有字段、手写 `session/title` append；每个插件各写一套，且脆弱。
- 预期结果：
  1. 替代行完整复刻官方 SessionTitleService 契约（`get`/`rename`/`refresh`/`register`、Config、provider 生命周期与 durable 语义）。
  2. 替代行新增稳定的候选资格策略入口（事件瀑布或声明式配置，形状 Stage 1 定稿）；零策略注册时与官方行为等价。
  3. 新增事件（如 `session-title/candidate`）以 `type: 'R'` 进入 `pluginApi.events.catalog`，复用 compaction-events-r1 的 R-slice 机制。
  4. 满足 R1–R9：官方 patch 机制装配、boot 自检、版本锁定、同行冲突检测、fail-safe、不覆盖 import 面。
  5. 登记上游提案 U9（官方 session-title 候选资格/合成消息排除）与明确退役条件。
- 技术约束：只 fork 官方 `session-title` 行；绝不 fork `session`、`system-prompt` 等框架级/核心域行；不得在无策略时改变官方标题行为；不得引入 client bundle。
- 验收证据（非目的）：pro-ex 删除其标题纠偏代码（`lib/index.js:574-691`）后，headless 冒烟与 dev boot 通过——这只是证明社区 API 形状足够普适的一组证据，不是本 feature 的存在理由。
- 非目标：不提供通用 session 写入 API（归 feature 4）；不替换标题 provider 本身；不修改官方包文件。

---

## Introduction

官方 `@deepseek-ai/dsh-session-title` 行提供 Cordis 服务 `sessionTitle`，其 fallback 与 first-prompt provider 会把已入库的 `source.kind: 'user'` 消息直接当作标题候选来源。官方没有任何“候选资格”dispatch 点：合成轮次一旦以 `source.kind: 'user'` 入库，官方标题生成就无法区分真实用户消息与合成消息。社区插件只能在 session/event 上做事后纠偏、直读 `sessionTitle.registration` 私有字段或手写 `session/title` append，每套实现都脆弱且互不兼容。

本 feature 以 R 类 replacement bundle 实现：fork 官方 `session-title` 行，在完整保留官方 `ctx.sessionTitle` 契约的前提下，新增 `session-title/candidate` 候选资格策略瀑布，使 fallback 与所有已注册标题 provider 在同一规则下消费经过策略过滤/替换的候选集；零策略注册时与官方行为等价。该策略入口以 `type: 'R'` 进入 `pluginApi.events.catalog`，复用 compaction-events-r1 已确立的 R-slice 机制，不发明新的 catalog 机制。

### Stage 1 形状定稿

依据 Stage 0 Goal“形状 Stage 1 定稿”，本节锁定以下形状：

1. **策略入口采用事件瀑布 `session-title/candidate`**，不采用声明式配置。理由：与 compaction-events-r1 已确立的“1 个策略瀑布 + N 个观察事件”模式同构；一次 dispatch 即可同时约束 fallback 与已注册 provider；零监听器时无需任何配置即可等价官方；且与 Goal“新增事件以 `type: 'R'` 进入 catalog”的约束一致。声明式配置需要 schema/registry/持久化面，超出 Goal 范围。
2. **发布包名**：`@deepseek-ai/dsh-plugin-api-session-title`（`<domain>` 词尾不带 `r1`，迭代由包版本表达）。
3. **源码目录**：`packages/session-title-r1/`。
4. **替代行 id**：`session-title-r1`（与官方行 `session-title` 相区分的稳定行 id）。
5. **决策词表**：`{ kind: 'exclude', reason? }`（排除该候选）与 `{ kind: 'replace', message, reason? }`（以另一条已入库消息替换该候选）。

每个需求组标注分类：`R` = 替换类行为；`Governance` = 仓库治理；`Upstream` = 上游提案边界。

---

## 1. 命名、包结构与文档新鲜度

**User Story**：As a repository maintainer, I want a fixed package naming convention recorded in this feature, so that every replacement bundle is immediately recognizable and uniformly versioned.

**User Story**：As a plugin-api repository maintainer, I want every old spec and governance artifact this feature touches to be revised in place, so that the repository keeps no stale governance document.

**Acceptance Criteria**

1.1. WHEN this feature is delivered THEN the replacement package SHALL be named `@deepseek-ai/dsh-plugin-api-session-title` and its sources SHALL live under `packages/session-title-r1/`。（Governance）

1.2. WHEN the profile composes the bundle THEN the replacement row id SHALL be `session-title-r1` and SHALL be distinct from the official row id `session-title`。（Governance）

1.3. WHEN the monorepo workspace is introduced THEN the main package and the replacement package SHALL each remain independently installable without forcing the other。（Governance）

1.4. WHEN this feature's delivery changes a subject already covered by an older delivered spec, or by `AGENTS.md` / `README.md` / `docs/capability-strategy.md` (for example package naming, row id, catalog schema, R 类登记, or upstream proposal table) THEN the affected document SHALL be appended or revised in place so that it stays fresh and current, while preserving its delivery history。（Governance）

1.5. GIVEN an old spec or governance document is intentionally kept as a historical snapshot IF it is not revised THEN it SHALL carry a top-level note pointing to the newer authority, so that no stale document remains without a pointer。（Governance）

---

## 2. 行替代装配与可逆性

**User Story**：As a plugin user, I want the replacement to be an ordinary `dsh plugin add` bundle, so that installation, removal, and per-profile isolation work exactly like any other official-layer composition.

**Acceptance Criteria**

2.1. WHEN the replacement bundle is installed into a profile THEN its `cordis.patch.yml` SHALL disable the official row `session-title` by id and SHALL insert the distinct, stable replacement row id `session-title-r1`；IF the official row id is absent from the composition THEN the official patch engine SHALL skip the disable patch with a warning and the insert SHALL still apply。（R）

2.2. WHEN the bundle is removed via `dsh plugin remove` THEN the official `session-title` row SHALL be enabled again and the composed profile SHALL return to official behavior。（R）

2.3. WHEN the profile boots THEN the replacement SHALL NOT modify any file under the official DSH installation, including `/usr/lib/node_modules/@deepseek-ai/dsh/**`。（R）

2.4. WHEN another bundle disables or re-enables the same official row in a later patch layer THEN the later layer SHALL win per official patch semantics, and the replacement SHALL detect the resulting composition through its boot self-check (see §4)。（R）

---

## 3. 官方契约复刻

**User Story**：As a third-party plugin or official consumer, I want `ctx.sessionTitle` to behave exactly as the official `SessionTitleService`, so that replacing the row never changes title behavior except for the new candidate eligibility policy.

**Acceptance Criteria**

3.1. WHEN the replacement row is active THEN it SHALL provide the `ctx.sessionTitle` service under the same Cordis service key as the official row, with the complete public surface of the official `SessionTitleService`, including at minimum `get`, `rename`, `refresh`, and `register`；the exact signature set SHALL be pinned in Stage 2 against `@deepseek-ai/dsh-session-title` and any deviation from the goal-listed surface SHALL be recorded as a spec revision。（R）

3.2. WHEN the official `Config` schema is applied to the replacement row THEN every official config key SHALL be accepted and validated with equivalent semantics, and unknown keys SHALL behave as officially。（R）

3.3. WHEN title providers are registered or disposed THEN the replacement SHALL preserve the official provider lifecycle: registration identity, duplicate behavior, disposal, lookup, and invocation semantics of the official `sessionTitle.register` contract。（R）

3.4. WHEN a title is computed, renamed, refreshed, or persisted THEN the replacement SHALL preserve the official durable semantics: same title derivation, same persistence points, and same restart-recovery behavior as the official implementation。（R）

3.5. WHERE the official row dispatches Cordis events as part of its service or event face IF the replacement row is active THEN the replacement SHALL dispatch the same events with the same timing and payload shape as the official row。（R）

3.6. WHERE the official package exposes module-level imports (including any companion subpath) IF third-party code imports `@deepseek-ai/dsh-session-title` directly THEN that import SHALL continue to resolve to the official package; the replacement row SHALL only replace the `ctx` service and event face, per R3 of `docs/capability-strategy.md`。（R）

3.7. WHEN the replacement is active THEN the delivered `pluginApi.services.sessionTitle` seam (SV13) SHALL continue to resolve, and its passthrough methods SHALL operate against the replacement service without change。（R）

---

## 4. Boot 自检、版本锁定与同行冲突

**User Story**：As an operator, I want the replacement to prove the intended composition at boot and to degrade safely when it cannot, so that a mis-composed profile never double-mounts `ctx.sessionTitle` or kills the harness.

**Acceptance Criteria**

4.1. GIVEN the official `session-title` row exists and is not disabled WHEN the replacement apply runs THEN the replacement SHALL NOT register a second `sessionTitle` service, SHALL log one clear diagnostic, and SHALL return normally so boot continues with the official provider。（R）

4.2. GIVEN the official row exists and is disabled AND the identity check in §4.4 passes WHEN apply runs THEN the replacement SHALL register the forked `sessionTitle` service with the new `session-title/candidate` event vocabulary。（R）

4.3. GIVEN the official row is absent from the composition AND the identity check in §4.4 passes WHEN apply runs THEN the replacement SHALL register the forked `sessionTitle` service as the sole provider。（R；官方行缺席是合法组成态：官方 patch 机制对缺失 id 的 disable patch 只告警跳过，insert 仍生效，见 §2.1）

4.4. GIVEN the installed runtime full version or the official `@deepseek-ai/dsh-session-title` package identity does not match the replacement's pinned identity WHEN apply runs THEN the replacement SHALL treat the forked contract as unverified and SHALL apply the following composition-state matrix without throwing through `apply()`：
- official row present and enabled → SHALL NOT register any provider, SHALL log one clear diagnostic, and the official provider SHALL continue；
- official row present and disabled → SHALL NOT register the forked provider；IF the official package remains resolvable THEN it SHALL register an official-equivalent fallback provider that exposes the official contract without the new event vocabulary, and SHALL log one clear diagnostic；otherwise it SHALL stay inert and log a loud diagnostic；
- official row absent → SHALL follow the same fallback-or-inert rule as the disabled case, with a loud diagnostic in both outcomes。（R）

4.5. WHEN any self-check probe or boot audit itself throws THEN the replacement SHALL contain the error, log it, and never throw through `apply()`。（R）

4.6. GIVEN multiple replacement rows target the same official `session-title` row WHEN apply runs THEN the replacement row that appears earliest in the composed entry order SHALL own the provider decision (forked provider or §4.4 fallback provider) and every later claimant SHALL log a conflict diagnostic and stay inert。（R）

4.7. GIVEN the replacement decides to register the forked service WHEN registration completes THEN it SHALL verify that `ctx.sessionTitle` resolves, that its key public entry points (`get`, `rename`, `refresh`, `register`) are callable, and that the event dispatch surface is callable；IF any verification fails THEN it SHALL roll back its registration, log one diagnostic, and stay inert without throwing through `apply()`。（R）

---

## 5. 候选资格策略：`session-title/candidate`

**User Story**：As a plugin author who injects synthetic or virtual rounds stamped `source.kind: 'user'`, I want to declare that an ingested user message must not become a title candidate, so that synthetic content never leaks into session titles.

**User Story**：As a plugin author, I want to replace one title candidate with another ingested message, so that titles reflect the intended message instead of the first synthetic one.

**User Story**：As an end user, I want the fallback and every registered title provider to obey the same eligibility rules, so that title results are consistent no matter which title path runs.

**Acceptance Criteria**

5.1. WHEN the replacement provides the title service THEN it SHALL expose exactly one stable policy entry: the native Cordis waterfall event `session-title/candidate` on the host context。（R）

5.2. GIVEN no third-party listener is registered for `session-title/candidate` WHEN title generation runs THEN the observable title behavior SHALL be equivalent to the official implementation: same candidate messages, same provider invocations, and same durable title outcome。（R）

5.3. WHEN title generation evaluates an ingested session-log user message as a title candidate (whether for the fallback or for a registered provider) THEN exactly one `session-title/candidate` waterfall SHALL be dispatched for that candidate before it is used, with a payload containing at least `{ agent, session, message }` where `message` is an immutable snapshot of the candidate message including its identity and `source.kind`；the dispatch SHALL occur at most once per candidate message per title-generation attempt, and its decision SHALL be shared by the fallback and all registered providers in that attempt。（R）

5.4. WHEN a `session-title/candidate` listener calls `next()` or makes no decision THEN the candidate SHALL participate in title generation unchanged, and generation behavior SHALL be identical to the official implementation apart from the dispatch itself。（R）

5.5. WHEN a `session-title/candidate` listener returns `{ kind: 'exclude', reason? }` THEN that candidate SHALL be excluded from the candidate set for the current title generation for the fallback and for every registered provider；the exclusion SHALL NOT mutate the session log or the durable title storage。（R）

5.6. WHEN a `session-title/candidate` listener returns `{ kind: 'replace', message, reason? }` THEN the current title generation SHALL use the referenced replacement message in place of the original candidate as a single-pass substitution without re-evaluating the replacement through the policy；IF the replacement does not resolve to an ingested message of the same session THEN the original candidate SHALL remain in effect and one redacted diagnostic SHALL be logged。（R）

5.7. WHEN multiple `session-title/candidate` listeners each return a decision for the same candidate THEN the first decision in listener order SHALL settle that candidate, and subsequent listeners SHALL NOT be invoked for it。（R）

5.8. WHEN a `session-title/candidate` listener throws or rejects asynchronously THEN the replacement SHALL contain the failure, log one redacted diagnostic, and treat that listener as having made no decision; the failure SHALL NOT cancel or alter the title generation。（R）

5.9. WHEN the fallback or any registered title provider consumes title candidates within one title-generation attempt THEN all of them SHALL observe the same post-policy candidate set；no fallback or provider SHALL bypass the eligibility policy。（R）

5.10. WHEN policy decisions leave zero eligible candidates for a title-generation attempt THEN the service SHALL behave exactly as the official service behaves when no eligible candidate exists, and SHALL NOT introduce any policy-specific error type or failure mode。（R）

5.11. WHEN a `session-title/candidate` payload is produced THEN the replacement SHALL deliver an immutable candidate snapshot：`message` 与其 `source` 深冻结，`agent`/`session` 保持 live 引用；no listener SHALL be able to mutate the candidate through the payload。（R）

5.12. WHERE an explicit rename assigns a caller-provided title rather than generating a title from candidates IF eligibility policies are registered THEN those policies SHALL NOT apply, and the official rename semantics SHALL be preserved。（R）

5.13. WHEN no candidate evaluation occurs (for example a title is already durable and no generation is triggered) THEN NO `session-title/candidate` event SHALL be dispatched。（R）

---

## 6. 门面 catalog 集成

**User Story**：As a plugin author using `pluginApi.events`, I want `session-title/candidate` listed in the typed catalog, so that I can subscribe with priority, read-only payload, and documented fault semantics through the supported facade.

**Acceptance Criteria**

6.1. WHEN the replacement feature is active THEN `pluginApi.events.catalog` SHALL contain exactly one entry for `session-title/candidate` with `type: 'R'`, the owning feature name `plugin-api-session-title-r1`, dispatch mode `waterfall`, the payload shape defined in §5.3, and documented `fault`/`freeze` policy；the entry SHALL use the established catalog schema (`name/mode/scopeFiltered/scopeKey/payload/args/source/type` plus `fault`/`freeze`) without introducing new fields；its `scopeKey` value SHALL be pinned in Stage 2 based on the official service's dispatch context。（R）

6.2. WHEN this feature's catalog slice is added THEN it SHALL reuse the R-slice mechanism delivered by compaction-events-r1 (static slice plus “replacement row active” dynamic visibility) and SHALL NOT weaken duplicate detection or fail-loud catalog composition。（R）

6.3. WHEN the facade core is inactive THEN the replacement SHALL still dispatch the native `session-title/candidate` event, and third parties using raw `ctx.on` SHALL be able to observe it with no facade guarantees。（R）

6.4. WHEN the replacement row is not active THEN the facade SHALL NOT list the `session-title/candidate` entry as available。（R）

---

## 7. pro-ex 迁移验收（证据，非目的）

**User Story**：As a maintainer, I want at least one real consumer migration to prove that the candidate eligibility API shape is general enough, so that the community API is validated against a real synthetic-message problem.

**Acceptance Criteria**

7.1. GIVEN `dsh-pro-ex-ability-anchor` removes its title correction code (`lib/index.js:574-691`) and expresses the same title behavior through the `session-title/candidate` policy WHEN its headless smoke test and the dev profile boot run THEN both SHALL pass with the replacement active。（R）

7.2. WHEN the consumer migration is executed THEN the consumer SHALL be able to express exclude-or-replace decisions for its synthetic/anchored messages without reading `sessionTitle.registration` private fields and without hand-writing `session/title` append。（R）

7.3. GIVEN these acceptance criteria are satisfied THEN they SHALL be recorded only as evidence that the API shape is sufficiently general；they SHALL NOT justify expanding the API surface beyond the Stage 0 Goal。（Governance）

---

## 8. 上游提案与退役

**User Story**：As a maintainer, I want every R class to be a temporary bridge to an upstream proposal, so that the fork is retired the moment the official seam lands.

**Acceptance Criteria**

8.1. WHEN this feature is delivered THEN U9（官方 session-title 候选资格 / 合成消息排除）SHALL be registered in the upstream proposal table of `docs/specs/plugin-api-features/feature-list.md`, with this replacement bundle recorded as its current workaround。（Upstream）

8.2. WHEN an official seam with equivalent candidate eligibility semantics (for example an official `session-title/candidate` event or official synthetic-message exclusion) becomes available THEN the replacement package SHALL be deprecated, its retirement condition SHALL be recorded, and consumers SHALL be offered a migration path to the official seam。（Upstream）

8.3. WHEN this feature is delivered THEN `docs/specs/plugin-api-features/feature-list.md` 的 U9 状态与 R 类类型标注、`AGENTS.md` §8 登记与 §2/§4 同步、`docs/capability-strategy.md` §5 矩阵 SHALL be updated in the same change set, per `docs/capability-strategy.md`。（Governance）

---

## 9. 非目标

- 不修改任何官方 DSH 包文件；不替换 `session-title` 以外的任何官方行，尤其不 fork `session`、`system-prompt` 等框架级/核心域行。
- 不提供 client bundle、remote namespace、settings 可视化配置桥或任何浏览器端产物（R8 不适用：本 feature host-only）。
- 不替换标题 provider 本身：provider 的注册、身份与调用语义保持官方契约。
- 不提供标题文本后处理/改写 API：策略只作用于候选资格，不作用于标题内容。
- 不提供通用 session 写入 API（归 feature 4），也不改变 session log 的写入路径。
- 不通过 R 类覆盖 boot 胶水与框架级派发语义（priority / deepFreeze / fault containment 等横切语义，R9）。
- 不实现 boot 故障隔离（U4）等方案二运维例外能力。

---

## 10. 需求覆盖检查

- **Host 面**：§2–§7 全覆盖。
- **Client 面**：本 feature 无 client bundle（明确非目标，§9）。
- **R1–R9 逐条对照**：

| 规则 | 位置 |
|---|---|
| R1 只走官方 patch 机制、绝不修改官方包文件 | §2.1–2.3 |
| R2 替代单位是整行/整包，先完整复刻 ctx 服务/事件面再增加接口 | §3.1–3.5 |
| R3 包 import 面明确不覆盖 | §3.6 |
| R4 boot 自检强制，失败 fail-safe，绝不静默双跑 | §4.1–4.3、4.5、4.7 |
| R5 版本锁定 runtime 全量版本与被替代官方包 identity | §4.4 |
| R6 同行唯一 owner，检测冲突 | §4.6 |
| R7 上游提案与明确退役条件 | §8.1–8.2 |
| R8 client 面自建构建 | §9（host-only，无 client 面，不适用） |
| R9 不覆盖 boot 胶水与框架级语义 | §9 |

- **外部可实现 vs 必须上游**：候选资格策略与事件词汇由 R 类 replacement 实现；官方原生 seam 为 U9 上游提案；boot 级故障隔离为 U4，不在本 feature 范围。
- **零策略等价**：§5.2 明确零监听器时与官方行为等价，§5.4 明确 no-decision 时行为等价。
- **文档新鲜度**：§1.4–1.5 要求本次交付触及的旧 spec、`AGENTS.md`、`README.md`、`docs/capability-strategy.md` 必须追加/修订或加注权威指针。

---

## 修订记录

- **R-5.11**（Stage 2 设计批准时修订）：payload 不可变承诺由「session 与 candidate 均不可通过 payload 变更」收窄为「`message` 与其 `source` 深冻结，`agent`/`session` 为 live 引用；no listener SHALL be able to mutate the candidate through the payload」。理由与备选形状见 `design.md`「Requirements 修订注记」第 1 条。
