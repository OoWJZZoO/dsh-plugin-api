# Stage 1 - Requirements

> feature_name: `credential-mutation-contract`
> milestone: M10
> status: Stage 0–2 已交付（2026-09-12）。Goal 于 2026-09-11 获批；Requirements 2026-09-11 初稿、2026-09-12 与 Design 同批收敛交付（修订记录见下）。
> 上游输入：`docs/specs/credential-mutation-contract/goal.md`（已批准）；M10 工作纲领 §3.6（OBS-06）；观察报告 §5 OBS-06；M7 deletion report B4-5 批准记录与「后续 B 类接口义务」；canonical registry `services.credentials` 现状与 `credentials/updated` 事件登记。

## Status

Stage 1 Requirements（2026-09-12 与 Design 同批收敛交付，Stage 0–2 已交付；Goal 于 2026-09-11 获批）。本文件依据已批准的 Stage 0 Goal 与本仓库 `docs/standards/` 各分册编写。每条需求标注 A/B/C 实现通道分类。

**修订记录（2026-09-12，与 Design 收敛时的就地修订）**：Requirement 1 AC1/AC2 的提交前校验边界由「ref 与其当前配置关联」改为「ref 与官方 backend 对该 ref 的当前状态（模式、可写性、环境影子）」——官方 provider 接受任意模式合法的 ref 建立存储值（写入先于配置引用是官方正常顺序，冻结 runtime 实测），caller 配置对 ref 的业务关联校验属插件自身业务契约（真实消费者先例 `dsh-vision-toolkit` 在自身 settings 描述符上校验后再调用）；门面不建立 ref 关联注册表。该修订不改变「校验先于副作用」的验收实质。

## Introduction

`credential-mutation-contract` 为受权操作方提供受约束、可追溯的受管凭据创建/更新/删除面：按 ref 设置/更新/删除凭据，与既有 resolve/describe 读面、模型/provider 请求的真实取值形成完整闭环。主公开面是 mutation（受控状态写入，官方 credentials provider 持有存储权）；resolve/describe 既有读面继续承载查询。

实现通道方向：**A 类受控包装为主（方案一门面转译）**。官方 `dsh-credentials` 组件在冻结 runtime 中保留写入 seam（类型含 `set(ref, value): Promise<void>` 与 `unset(ref): Promise<void>`），门面 `services.credentials` 白名单现仅 `resolve`/`describe`。并发冲突检测若官方 seam 缺少原生比较点，则按 **B 类底层模拟**补齐并以 fail-closed 为默认，设计须如实标注；更新可见状态复用官方 `credentials/updated` 事件 authority（registry 已登记，producer authority 为 credentials authority），不另造第二套凭据事件体系。

secret 的输入、存储、输出三个方向分开设计：录入方向（client → host，经插件自身 remote/受权路径到达同一 credential authority）开放；回显方向（host → client）一律禁止。私有 storage、直接写配置文件或泛化 settings 写入不替代本面。

公共面为 host 面；本 feature 不新增公共 client 半面，client 录入路径由 Design 确定是否需要公共 client 半面或仅经插件自身 remote。本 feature 在 AGENTS.md §3.0.1 冻结基线内交付：不步进 `A`/`B.C`/`D`（现行 `0.1.0-rc.6-0.1.0`，`dsh.api: 0.1`）；公共成员与语义在交付时同步 canonical registry 与 capability/availability 记录。

## Requirement 1: Controlled Credential Set / Update

**User Story:** As a plugin author, I want one supported entry to store or update a managed credential by ref, so that my settings page can save user API keys without writing config files or private storage.

### Acceptance Criteria

1. WHEN an authorized caller sets a value for a valid ref THEN the system SHALL validate the ref and the official backend state for it (ref pattern, writability, environment shadowing) before any side effect, invoke the official write seam, and return a frozen discriminated result `{ ok, code, reason?, ... }` per the mutation idiom; success SHALL mean real persistence by the official credentials provider.
2. WHEN the ref is malformed per the official ref pattern, the value is empty, or the official backend refuses the write (read-only or environment-shadowed) THEN the system SHALL return a typed rejected result before invoking the write seam, SHALL NOT create partial state, and SHALL NOT reject a well-formed ref solely because no current configuration references it (establishing a stored value ahead of configuration reference is the official provider's normal order; caller-side configuration-to-ref association remains the caller's declared business contract).
3. WHEN the write fails (backend error, read-only backend, unavailable provider) THEN the result SHALL report the typed error/unavailable, the previous value SHALL remain in effect, subsequent resolution SHALL return the previous value, and no half-committed state SHALL be visible.

**Classification:** A（官方写入 seam 存在，受控稳定化 + 包装）；mutation idiom per `api-idioms.md` §3.3; ref/config semantics follow the official service as verified in the design.

## Requirement 2: Controlled Credential Unset

**User Story:** As a plugin author, I want one supported entry to remove a managed credential, so that clearing a key follows the same authority as setting it.

### Acceptance Criteria

1. WHEN an authorized caller unsets an existing ref THEN the system SHALL invoke the official unset seam and return a typed result; afterwards resolution SHALL follow the official fallback hierarchy (official resolve semantics).
2. WHEN the ref does not exist THEN the system SHALL return the design-declared typed result (idempotent success vs not-found SHALL be declared) and SHALL NOT claim deletion beyond the official seam's authority.
3. WHEN the unset fails THEN the result SHALL report the typed failure, the previous value SHALL remain in effect, and no half-committed state SHALL be visible.

**Classification:** A wrap of the official unset seam.

## Requirement 3: Concurrent Write Conflicts

**User Story:** As a plugin author, I want concurrent writes to the same ref to resolve explicitly, so that my settings page can detect "changed elsewhere" instead of silently overwriting.

### Acceptance Criteria

1. WHEN a caller submits a write for a ref whose value or revision changed concurrently after the caller's last observed state THEN the system SHALL reject with a typed conflict per the design-declared compare rule, and SHALL NOT silently last-wins overwrite.
2. WHEN the official seam provides no native compare-and-set point THEN the facade SHALL implement the conflict check as a declared B-class simulation with fail-closed default (unverifiable state SHALL yield typed rejection or the design-declared fallback), and SHALL NOT present the simulation as official arbitration.
3. WHEN two authorized writers submit different values concurrently THEN at most one SHALL claim success per the declared rule; the other SHALL receive a typed conflict/superseded outcome, and the final stored value SHALL be one of the declared legal resolutions.
4. WHEN a caller observes the conflict outcome THEN it SHALL carry enough bounded context (ref, expected-vs-actual revision/marker) to re-read and retry deliberately, without exposing the current secret value.

**Classification:** B simulation where the design verifies the official seam lacks CAS (A where native support exists); concurrency declaration per `concurrency-and-cancellation.md` §6.

## Requirement 4: Visible State And Event Consistency After Success

**User Story:** As a plugin author, I want a committed credential change to be observable and to take effect for later provider requests, so that "saved" never lies.

### Acceptance Criteria

1. WHEN a write commits THEN subsequent official resolution — including later provider requests — SHALL return the new value (or the official fallback hierarchy after unset), and the change SHALL be observable through the official `credentials/updated` event authority or a projection built solely on it; this feature SHALL NOT define a second credential event system or publisher.
2. WHEN the update cannot be observed (no event point reachable, projection degraded) THEN the read faces SHALL still reflect the official state and the observation SHALL degrade typed rather than fabricate events.
3. WHEN the same ref is written repeatedly with the same value THEN the system SHALL follow the design-declared idempotent mapping and SHALL NOT emit duplicate change facts that misrepresent multiple updates.

**Classification:** A event reuse（producer authority 保留在官方 credentials authority）；fact/event semantics per `api-idioms.md` §4.

## Requirement 5: Secret Visibility And Redaction — Three Directions

**User Story:** As a maintainer, I want credential input allowed, storage authoritative, and echo forbidden, so that the settings flow works while no secret ever leaks through any outlet.

### Acceptance Criteria

1. WHEN the host serves credential metadata or errors — describe results, availability, audit, logs, RPC outcomes, snapshots, exception causes, client payloads — THEN secret values SHALL NOT appear, and redaction SHALL be completed host-side before serialization to any client; the client validates shape only and never performs redaction.
2. WHEN an authorized user submits a new credential value from a client through a plugin's own remote or the design-declared authorized path THEN the value SHALL flow to the same credential authority, and the value SHALL NOT be echoed back in any response, projection, log or snapshot.
3. WHEN audit records are written THEN they SHALL contain only bounded metadata (ref, owner, time, outcome) and SHALL NOT contain credential values.
4. WHEN redaction cannot be proven for an outlet THEN that outlet SHALL fail closed (omit the content) rather than risk exposure.

**Classification:** Visibility contract per `visibility-and-redaction.md` §1–§4; host-side redaction, client-half audience, fail-closed.

## Requirement 6: Trust And Authorization Boundary

**User Story:** As a maintainer, I want only authorized contexts to write credentials, so that a low-trust remote cannot plant or replace keys.

### Acceptance Criteria

1. WHEN a write or unset request arrives from a context without authorization THEN the system SHALL return typed denied before any side effect; the trust boundary reuses user/profile policy and official trust checks, and a low-trust remote SHALL NOT gain write capability through this face.
2. WHEN authorization cannot be determined THEN the system SHALL fail closed (typed denied/unavailable), never open.
3. WHEN a caller attempts to claim an owner that is not its own THEN the system SHALL derive owner identity from the actual caller context and SHALL NOT accept caller-reported ownership.

**Classification:** A consumption of official trust seams; owner derivation per `composition-and-authority.md` §5.

## Requirement 7: Audit And Traceability

**User Story:** As a maintainer, I want every credential mutation attributable with bounded metadata, so that key changes are diagnosable without the audit itself becoming a leak.

### Acceptance Criteria

1. WHEN a write/unset attempt reaches the official seam, or is rejected before submission THEN the system SHALL record a bounded audit entry containing who (derived owner), what (ref and operation kind), when, and the outcome code; v1 audit records SHALL be authority-internal bounded in-memory diagnostics (not durable, no new storage scope) unless the design explicitly declares a durable tier per `durable-state-and-scope.md` §1–2.
2. WHEN audit record writes fail THEN the mutation SHALL retain its declared effect, bounded diagnostics SHALL expose a gap marker, and the system SHALL NOT fabricate a record.
3. WHEN audit content or reasons are exposed THEN they SHALL be bounded, redacted and free of credential values.

**Classification:** Facade authority foundation; same v1 audit precedent as the sibling M10 mutation features; `composition-and-authority.md` §5.

## Requirement 8: Authority Closure — Storage Stays Official

**User Story:** As a maintainer, I want the managed credential authority to stay the only supported write path, so that plugins cannot drift into private storage or config-file writes.

### Acceptance Criteria

1. WHEN the services whitelist is audited THEN `services.credentials` SHALL NOT re-gain raw `set`/`unset` members, and the controlled face of this feature SHALL be the only supported credential write path through the facade.
2. WHEN a plugin needs persisted secrets THEN plugin-private storage, direct `.env`/configuration-file writes and generic settings writes SHALL NOT be presented or documented as substitutes for the managed credential authority, and the facade SHALL NOT add such a shim.
3. WHEN third-party code injects or imports the official credentials component directly THEN that unsupported escape hatch SHALL remain outside the facade's guarantees, and the facade SHALL NOT claim to intercept it.

**Classification:** Authority closure per `composition-and-authority.md` §6; public-surface subtraction state per `capability-strategy.md` §7.

## Requirement 9: Availability, Capability And Degradation

**User Story:** As a plugin author, I want to know whether credential writes can actually be served in my installation, so that my settings page degrades honestly.

### Acceptance Criteria

1. WHEN a caller queries availability THEN the feature namespace SHALL expose `availability()` returning a frozen `{ status: active | degraded | unavailable, reason? }` reflecting the official credentials write-seam reachability (including read-only backend states), and availability SHALL never throw.
2. WHEN the write seam is absent, version-mismatched, read-only or disabled THEN the write faces SHALL return typed unavailable results, SHALL NOT fabricate success, SHALL NOT disable the whole main facade or unrelated capabilities, and the existing `services.credentials` read passthrough SHALL remain governed by its own whitelist entry.
3. WHEN capability presence is negotiated THEN `capabilities` SHALL carry the capability without exposing package, row or replacement identities.

**Classification:** selfDescription per `api-idioms.md` §3.8; degradation per `capability-strategy.md` §6.2.

## Requirement 10: Read-Side Regression Guard

**User Story:** As a plugin author, I want the existing resolve/describe read behavior untouched, so that adding the write face cannot break current consumers.

### Acceptance Criteria

1. WHEN this feature lands THEN the existing `services.credentials` `resolve`/`describe` members SHALL remain within their registered whitelist contract (no semantic change), and the new write face SHALL NOT bypass, wrap or rewrite the read authority.
2. WHEN a write commits THEN read faces SHALL reflect the change only through the official authority — the facade SHALL NOT cache or shadow credential state outside it.

**Classification:** A regression guard over the existing whitelist members.

## Requirement 11: Verification And Delivery Gates

**User Story:** As a maintainer, I want end-to-end evidence that writes persist, conflict, redact and degrade honestly, so that delivery cannot regress credential safety.

### Acceptance Criteria

1. WHEN write semantics are tested THEN evidence SHALL cover set/update/unset, ref validation before side effects, failure-keeps-previous-value, unset fallback resolution, and real persistence (a later provider/resolve read observes the new value).
2. WHEN conflict handling is tested THEN evidence SHALL cover concurrent writers with deterministic outcomes, the declared compare rule (including its B-class simulation status if applicable), and retry-after-conflict guidance without value exposure.
3. WHEN redaction is tested THEN evidence SHALL sweep every declared outlet — describe, availability, audit, logs, RPC outcomes, snapshots, exception causes, client payloads — for secret absence, including malformed and failing writes.
4. WHEN trust and degradation are tested THEN evidence SHALL cover unauthorized denial without state change, read-only backend, unavailable write seam, isolation of unrelated capabilities, and two synthetic plugins in reverse registration order with owner derivation.
5. WHEN registry and shape checks run THEN every new host member SHALL be registered with one primary idiom, semantic face, effect, composition, scope, authority and availability shape; surface snapshots SHALL match; the guarded full test suite, `git diff --check`, registry/surface consistency and the global adversarial review SHALL pass before the Stage 4 completion commit.

**Classification:** Delivery gates for the A/B-class wrapped face.

## Standards Applicability And Alignment

- `docs/standards/capability-strategy.md`: applicable。A 类受控包装（官方 seam 存在）+ 局部 B 类冲突检测（如设计核实官方无 CAS）；`services.credentials` 白名单写路径不回流；冻结基线内交付。
- `docs/standards/api-shape.md`: applicable。主面 mutation；describe/availability 为只读成员；无策略注册、无汇总投影；一面原则满足。
- `docs/standards/api-idioms.md`: applicable。mutation 判别式结果、幂等/冲突语义按 §3.3；事件面按 §4（fact 归官方 authority，本面不自造事件体系）。
- `docs/standards/public-api-shape.md`: applicable。挂靠最近既有领域，最终 path 由 Design 依总树一致性确定；不引入 package/row 身份。
- `docs/standards/composition-and-authority.md`: applicable。owner 派生不可伪造；authority closure（Req8）；并发 CAS/冲突规则在 Design 声明；共享凭据 authority 不被私有 storage 旁路。
- `docs/standards/domain-composition.md`: applicable。credentials/settings/storage 各归其主；本面不吸收 settings 或 storage 职责。
- `docs/standards/ordering.md`: not applicable。无多 owner 顺序决策、无事件排序语义。
- `docs/standards/identity-and-lifecycle.md`: applicable。判别式结果承载终态语义；conflict/superseded 败方不补写；无新 identity 类型（ref 沿用官方凭据身份）。
- `docs/standards/durable-state-and-scope.md`: applicable。凭据持久性归官方 provider（声明真实持久化语义）；v1 审计 bounded in-memory；不新增第四档 scope。
- `docs/standards/visibility-and-redaction.md`: applicable（核心分册）。三方向分离（录入开放/回显禁止）；逐出口脱敏（logs、RPC outcome、snapshot、异常 cause、client payload）；host 侧脱敏 fail-closed；审计只记元数据。
- `docs/standards/concurrency-and-cancellation.md`: applicable。并发策略声明（compare-and-swap 或声明的模拟规则、提交条件、失败保持）；无取消面（写操作短事务），如 Design 引入信号则按 §3 组合上游语义。
- `docs/standards/versioning-and-protocols.md`: applicable。冻结基线内交付；无新 wire/durable 协议（如 Design 引入需单独论证 revision）。

## 备注（Stage 边界）

本文件只确认 Requirements 方向。Design 将确定：namespace 放置与公共 path、官方服务绑定与真实签名核对、并发冲突检测的官方比较点核实（A/B 定案）与模拟规则、client 录入路径（是否需要公共 client 半面）、`credentials/updated` 事件复用方式、审计载体、registry/catalog 拟新增行与失败/guard 策略。Tasks 以对抗性审查为门（AGENTS.md §3.2），通过后进入 Stage 4。
