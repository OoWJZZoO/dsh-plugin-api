# Requirements: plugin-api-m7-public-contract-refactor

> feature_name: `plugin-api-m7-public-contract-refactor`
> 阶段：Stage 1 Requirements（已获用户明确批准）
> 类型：宏观仓库重构；不以新增业务能力为目标
> 上游：已确认的 Stage 0 Goal（串行 M7 公共契约重构；版本基线冻结；实质性公共 API 删除前须向人类报备并获批）
> 版本基线：`0.1.0-rc.6-0.1.0`；`dsh.api: 0.1`
>
> **规范路径迁移注**：本文所引 `docs/standards/refactor/*.md` 分册已并入 `docs/standards/`：同名收录的有 `public-api-shape.md`、`composition-and-authority.md`、`domain-composition.md`、`versioning-and-protocols.md`、`ordering.md`；`capability-and-services.md` 并入 `capability-strategy.md`；`plugin-state-and-lifecycle.md` 并入 `durable-state-and-scope.md`；`sdk-and-conformance.md` 已删除。现 `docs/standards/refactor/` 是后续 API 语义重构的未来目标规范，与本 feature 无关。下表与正文中的路径已按新位置更新。

## Introduction

本 feature 负责在正式发布前统一 `dsh-plugin-api` 的 host/client 受支持公共面。重构以第三方开发者理解的业务领域为组织原则，以 public contract registry 为单一公共形状事实源，完成旧路径到目标路径的映射、一次性 namespace 迁移、发布前公共面减法，以及最终保留 API 的 composition、authority、scope、generation、生命周期和 `services.*` 分级。

本 feature 是一个宏观 feature，阶段内按以下固定顺序串行完成：

```text
清点
→ 契约基础
→ Namespace 一次性迁移
→ 公共面减法
→ 语义组合加固
→ Services 分级与生态验收
```

本需求中的能力分类含义如下：

- **门面基础**：公共契约、registry、版本、装配和 fail-safe 基础，不代表新增业务能力。
- **A 类**：官方已有 dispatch 或 service，门面只做稳定化和受控直通。
- **B 类**：官方没有完整 dispatch，门面基于已公开底层能力进行受限转译。
- **C 类**：当前无法在不改官方的前提下实现，只保留 upstream proposal。
- **R 类**：仅允许沿用已经批准的官方组件 replacement 边界；本 feature 不新增未经批准的 replacement 能力。

## 1. Public Contract Inventory And Registry

**User Story:** As a third-party plugin author, I want one authoritative description of the supported API, so that names, capabilities, ownership, and failure behavior do not drift between code, types, tests, and documentation.

### Acceptance Criteria

- **WHEN M7 inventory starts THEN the refactor SHALL record every current host/client public path and member, its proposed target path, runtime side, effect, capability, implementation class, and migration disposition.**
- **WHEN a public member is added to the registry THEN the registry SHALL include `publicPath`, `capability`, `runtime`, `effect`, `composition`, `stateOwner`, `scope`, `resourceKey`, `identitySource`, `conflictRule`, `lifecycle`, and `bypasses` whenever the field applies.**
- **WHEN an existing member has no stable authority, scope, resource, or failure description THEN the registry SHALL mark the gap as unresolved and SHALL NOT classify the member as recommended until the gap is resolved or the member is removed.**
- **WHEN registry construction completes THEN the registry SHALL distinguish public capability path, internal feature/mounter key, and package/installation identity as independent identities.**
- **WHEN types, disabled surfaces, capability snapshots, services audit tables, API references, or composition fixtures are generated or checked THEN they SHALL derive their public shape from the same registry rather than maintaining an untracked duplicate.**
- **WHEN the registry is reviewed THEN it SHALL contain explicit records for removed, unavailable, disabled, advanced, and recommended members, rather than expressing state only through property presence.**

**Classification:** 门面基础。

## 2. Target Host Namespace

**User Story:** As a third-party host-plugin author, I want APIs grouped by business domain, so that I can find a capability without knowing its historical feature, mounter, package, or replacement origin.

### Acceptance Criteria

- **WHEN the target host surface is published THEN the facade SHALL expose the approved domain tree rooted at `pluginApi`, including `events`, `llm`, `agents`, `executions`, `sessions`, `tools`, `skills`, `prompts`, `attachments`, `mcp`, `tasks`, `coordination`, `workspaces`, `security`, `diagnostics`, `settings`, `profiles`, `remotes`, `storage`, and `services` (see `docs/standards/public-api-shape.md` §2 for the authoritative tree).**
- **WHEN an existing capability is assigned to a target domain THEN the public path SHALL follow semantic domain ownership rather than the current official component, replacement bundle, delivery batch, or internal feature name.**
- **WHEN routing is exposed THEN the public semantic path SHALL be `llm.routing`; historical root-level routing authority and duplicate route query paths SHALL NOT remain as competing recommended authorities.**
- **WHEN execution observation or recovery is exposed THEN the public semantic path SHALL be `executions` and `executions.recovery`; a standalone historical `execution` root SHALL NOT remain as a competing recommended namespace.**
- **WHEN session channel or branch capabilities are exposed THEN they SHALL be placed under `sessions.channels` and `sessions.branches`, respectively, with their own identity and authority records.**
- **WHEN workspace transaction capabilities are exposed THEN they SHALL be placed under `workspaces.transactions`; a historical root-level transaction namespace SHALL NOT remain as a competing recommended authority.**
- **WHEN system prompt or context provenance capabilities are exposed THEN they SHALL be placed under `prompts` and `prompts.provenance`, while retaining separate owners for projection, contribution, and policy faces where required.**
- **WHEN a capability is only an official low-level passthrough THEN it SHALL be exposed under the static `services.*` namespace and SHALL NOT be promoted to a semantic domain solely because its service name resembles that domain.**
- **WHEN a public namespace is created or retained THEN it SHALL use noun-like domain names, plural resource collections where applicable, verb-like methods, and no more than two domain levels before a method unless a strong domain relationship requires a third level.**
- **WHEN the target host namespace is activated THEN replacement bundle names, official owner names, governance classifications, feature IDs, and delivery-batch identifiers SHALL NOT appear in public paths or runtime-visible capability IDs.**

**Classification:** 门面基础；成员按 A/B/C/R 单独登记。

## 3. Target Client Namespace

**User Story:** As a third-party browser-plugin author, I want the browser facade to follow the same semantic API model as the host facade, so that client code does not depend on a redundant client subnamespace or internal bundle layout.

### Acceptance Criteria

- **WHEN the client plugin is active THEN the facade SHALL expose an environment-specific `ctx.pluginApi` on the browser context whose public semantic members are rooted directly at `ctx.pluginApi`, and the surface SHALL NOT require a `ctx.pluginApi.client.*` sub-namespace.**
- **WHEN a client capability has a host semantic counterpart THEN host and client SHALL use the same domain vocabulary, owner model, generation model, stale-disposer behavior, and composition contract unless the registry explicitly records a client-only boundary.**
- **WHEN a client capability is a pure official browser passthrough THEN it SHALL be exposed under `ctx.pluginApi.services.*` using the official service key and SHALL not be reclassified as a facade-owned semantic capability.**
- **WHEN client APIs are typed THEN the package SHALL expose distinct `HostPluginApi` and `ClientPluginApi` types, and runtime optional-property probing SHALL NOT be the type-level environment distinction.**
- **WHEN `defineManifest` is used THEN it SHALL remain a build-time client helper and SHALL NOT become a runtime member of `ctx.pluginApi`.**
- **WHEN a client remote, slot, settings, lifecycle, or reconnect API is exposed THEN its owner, generation, stale cleanup, and failure behavior SHALL be represented in the registry and SHALL remain active only within its declared client scope.**
- **WHEN host data is published to the browser THEN host-side redaction SHALL complete before serialization, and client-side shape validation SHALL NOT be treated as a substitute for host redaction.**

**Classification:** A 类官方 client 稳定化；B 类 remote/slot/settings/lifecycle 转译；C 类原生动态 remote discovery 仅保留 proposal。

## 4. Namespace Migration And Public API Deletion

**User Story:** As a maintainer in the pre-release window, I want the public API migrated once and reduced deliberately, so that historical shapes do not become permanent compatibility debt.

### Acceptance Criteria

- **WHEN the target namespace map is approved THEN the migration process SHALL place each retained public member directly at its target path and SHALL NOT create a temporary compatibility alias.**
- **WHEN namespace migration executes THEN old public paths, duplicate delegates, feature-shaped public roots, and replacement-shaped public roots SHALL be removed from the recommended surface in the same migration boundary.**
- **WHEN a public member is a candidate for substantial removal THEN the refactor SHALL produce a deletion report before changing implementation or tests; the report SHALL list the exact path/member, current consumers, affected package/install surfaces, replacement path if any, rationale, and expected failure or availability change.**
- **WHEN a deletion report is ready THEN the refactor SHALL notify the human maintainer and SHALL NOT perform the reported public deletion until the human explicitly approves that report.**
- **WHEN a deletion report is approved THEN the refactor SHALL delete the approved public member directly and SHALL NOT preserve it through an alias, deprecated forwarding property, silent no-op, or hidden compatibility branch.**
- **WHEN a proposed deletion would change an approved Goal or Requirements acceptance boundary THEN the refactor SHALL stop and request a new human decision instead of treating the report approval as sufficient.**
- **WHEN a candidate member is retained only because its current runtime identity is unavailable but its public path has independent value THEN the refactor SHALL keep the path and expose typed `disabled` or `unavailable` behavior rather than silently removing it.**
- **WHEN a deletion affects a consumer migration target THEN the refactor SHALL update the consumer migration contract and replacement coverage in the same approved change boundary.**

**Classification:** 门面基础；删除动作不新增能力。

## 5. Capability Presence, Availability, And Failure Vocabulary

**User Story:** As a plugin author, I want capability availability and failures to be explicit, so that I can distinguish an inactive facade, an unavailable capability, a normal business conflict, and stale work.

### Acceptance Criteria

- **WHEN the facade is inactive THEN every declared public member SHALL retain its observable shape and SHALL fail through the standard inactive-core typed failure before touching an official service.**
- **WHEN the facade is active but a capability is unavailable THEN the public namespace SHALL remain present and the member SHALL return or raise a typed capability-unavailable result/error according to its contract.**
- **WHEN a normal business conflict, ownership conflict, stale generation, denial, or unavailable capability occurs THEN the facade SHALL use distinguishable typed result/error vocabulary and SHALL NOT collapse all cases into `undefined` or a generic crash.**
- **WHEN capability status is reported THEN it SHALL use only the declared availability vocabulary `active`, `degraded`, or `unavailable` for capability state, while health remains a diagnostics concern.**
- **WHEN an official `services.*` member is unavailable due to runtime identity or optional installation THEN its public path SHALL remain stable and its member-level status SHALL be observable without disabling unrelated services.**
- **WHEN any facade apply, mount, registration, guard, rollback, or disposal path fails THEN the failure SHALL be contained, the affected capability SHALL fail closed where its contract permits isolation, and the failure SHALL NOT escape through harness boot.**

**Classification:** 门面基础；适用于 A/B/C/R 的公共呈现边界。

## 6. Composition, Owner, Authority, And Lifecycle

**User Story:** As a plugin author, I want multiple plugins to compose predictably without taking each other’s resources, so that shared facade capabilities remain attributable and recoverable.

### Acceptance Criteria

- **WHEN each retained public member is classified THEN it SHALL declare exactly one primary composition mode from `pure`, `additive`, `ordered`, `coordinated`, or `exclusive`.**
- **WHEN a member is classified as `pure` THEN it SHALL not write shared state, register providers/listeners, alter global selection or configuration, or return a writable live object.**
- **WHEN a member is classified as `additive` THEN registrations and observers SHALL be owner-attributed, same-key conflicts SHALL be explicit, and the disposer or handle SHALL be bound to owner, resource key, and generation.**
- **WHEN a member is classified as `ordered` THEN its priority vocabulary, same-priority registration order, reducer or pipeline rule, callback failure behavior, and output freezing rule SHALL be declared before it is recommended.**
- **WHEN a member is classified as `coordinated` THEN its resource identity, scope, generation, and required CAS, fencing, or transaction condition SHALL be declared and enforced at the shared authority boundary.**
- **WHEN a member is classified as `exclusive` THEN the claim SHALL be checked before side effects, and a conflict SHALL deterministically reject the operation without silently selecting a later owner.**
- **WHEN an owner identity is needed THEN it SHALL be derived from the actual caller context or plugin assembly identity and SHALL NOT be accepted as an unchecked caller-supplied owner string.**
- **WHEN a stale disposer or callback runs THEN it SHALL become a typed no-op or stale result and SHALL NOT remove, disable, publish over, or mutate a newer generation or another owner’s resource.**
- **WHEN a high-level API claims an invariant over a resource THEN every supported write path for that resource SHALL pass through the same authority, declare an explicitly competing authority with preflight conflict detection, or be excluded from the recommended Composable Profile.**
- **WHEN a callback throws or rejects THEN only the current decision point and affected owner SHALL be contained according to its contract; registry integrity and unrelated owners SHALL remain intact.**
- **WHEN a public member has not completed its composition and authority audit THEN it SHALL NOT be labelled recommended or included in the default Composable Profile.**

**Classification:** 门面基础；具体成员按 A/B/C/R 单独登记。

## 7. Events, Ordering, And Domain Reducers

**User Story:** As a plugin author, I want event observation and semantic decisions to have deterministic boundaries, so that event listeners cannot accidentally become shared authorities.

### Acceptance Criteria

- **WHEN a plugin subscribes to a canonical event THEN subscription SHALL provide observe-only consumer authority unless the event contract separately grants producer authority.**
- **WHEN a plugin defines a custom event THEN it SHALL obtain an owner-scoped publisher handle, and a generic public entry SHALL NOT permit dispatching arbitrary canonical system event names.**
- **WHEN ordinary event listeners share a priority THEN they SHALL execute in successful registration order using the fixed vocabulary `lowest`, `low`, `normal`, `high`, `highest`, or `monitor`.**
- **WHEN a semantic policy is a merge, filter, or arbitration rather than a serial transform THEN it SHALL use its domain reducer or fixed stages instead of treating event priority or a generic waterfall as the policy itself.**
- **WHEN a domain reducer or ordered pipeline is used THEN the public contract SHALL declare its input, output, conflict rule, precedence, same-priority order, callback failure behavior, and idempotence or order-dependence.**
- **WHEN a feature would require a cross-domain global dependency graph to prove correctness THEN the feature SHALL be decomposed into domain-local rules or recorded as an upstream proposal; the refactor SHALL NOT introduce a global ordering graph.**
- **WHEN a listener payload is declared read-only THEN the payload SHALL be frozen or provided as an immutable projection, and listener mutation SHALL NOT alter the shared event state.**

**Classification:** A 类事件稳定化；B 类 priority/deepFreeze/fault containment 稳定化；横切派发语义不得转为 R 类。

## 8. Semantic Domain Minimums

**User Story:** As a maintainer of a shared API facade, I want each business domain to have an explicit minimum contract, so that namespace migration does not merely move unresolved ownership problems.

### Acceptance Criteria

- **WHEN `events` is retained THEN it SHALL distinguish observe-only consumers from producer authority and SHALL use owner-scoped custom event publication.**
- **WHEN `llm.requestTransforms` or `llm.admissionPolicies` is retained THEN it SHALL use owner-scoped registration, declared scope and rewrite boundary, deterministic order or decision algebra, and at-most-once/convergence rules where re-entry exists.**
- **WHEN `llm.adapters` or `llm.routing` is retained THEN provider, adapter, policy, candidate, health, decision, owner, generation, and attempt boundaries SHALL be explicit and topology changes SHALL not remove another owner’s registration.**
- **WHEN `agents.providers`, `tools`, `tools.discovery`, or `skills.activation` is retained THEN key conflicts, provider ownership, activation ownership, execution scope, and registry-versus-session authority SHALL be explicit.**
- **WHEN `executions` or `executions.recovery` is retained THEN execution identity SHALL be independent of event sequence, projections SHALL be read-only, and recovery consumption SHALL have one authority.**
- **WHEN `sessions.branches` or `sessions.channels` is retained THEN identity, scope, generation possession, CAS or fencing, authentication ownership, and direct-session-mutation bypasses SHALL be explicit.**
- **WHEN `prompts` or `prompts.provenance` is retained THEN additive provider order, assembly write boundaries, contribution ownership, projection ownership, and policy bypasses SHALL be explicit.**
- **WHEN `attachments`, `mcp`, `tasks`, `coordination`, `workspaces.transactions`, `security`, `diagnostics`, `settings`, `profiles`, `remotes`, or `storage` is retained THEN its domain-specific owner, resource, scope, conflict, visibility, cancellation, and cleanup minimums SHALL be recorded before recommendation.**
- **WHEN a member is only a pure official passthrough THEN the domain minimum SHALL be satisfied through its `services.*` member-level classification and SHALL NOT require artificial semantic mediation.**

**Classification:** A 类官方直通；B 类门面语义；R 类仅在现有批准 replacement slice 的组件边界内适用；C 类只形成 proposal。

## 9. Services Member-Level Classification

**User Story:** As an advanced facade consumer, I want official low-level services to remain discoverable without implying unsupported composition guarantees, so that passthrough use is honest and predictable.

### Acceptance Criteria

- **WHEN a `services.*` member is added or retained THEN it SHALL have a static whitelist entry, a concrete third-party use case, a member-level composition classification, and an authority map.**
- **WHEN a `services.*` member is a read-only query, pure computation, or frozen projection THEN it MAY be classified as `pure` without adding semantic mediation.**
- **WHEN a `services.*` member performs additive registration THEN it SHALL preserve official semantics while adding caller-owner and stale-disposer protection where the facade contract requires it.**
- **WHEN a `services.*` member is a transform, policy, singleton setter, provider slot, shared mutation, or writable live object THEN it SHALL be wrapped into a semantic domain, claim-gated, coordinated, converted to a restricted handle, or excluded from the recommended Composable Profile.**
- **WHEN a `services.*` member has no provable composition semantics THEN documentation and registry SHALL classify it as advanced supported passthrough without claiming default composition guarantees.**
- **WHEN a semantic domain API exists for an invariant THEN the recommended workflow SHALL NOT require consumers to manually combine several low-level `services.*` members to preserve that invariant.**
- **WHEN a `services.*` member is removed for lack of independent long-term value THEN the deletion report and human approval requirement in Section 4 SHALL apply.**

**Classification:** A 类 official passthrough；必要的 B 类包装；不得通过 `services.*` 绕过高层 authority。

## 10. Version, Negotiation, Wire, And Durable Protocols

**User Story:** As a plugin author, I want the new public contract to have one explicit baseline, so that the pre-release refactor cannot accidentally create mixed API generations.

### Acceptance Criteria

- **WHEN the M7 version baseline is applied THEN the main package, every M7 auxiliary/replacement package, and the full aggregation package SHALL use `0.1.0-rc.6-0.1.0`, and each package SHALL declare `dsh.api: 0.1` where that metadata applies.**
- **WHEN the version baseline is applied THEN runtime identity `0.1.0-rc.6` (A), API generation `0` (B), compatible increment `1` (C), and package maintenance component `0` (D) SHALL remain represented according to `<A>-<B>.<C>.<D>` semantics.**
- **WHEN any M7 implementation, test, documentation, or package task executes after the baseline is applied THEN no package version or `dsh.api` version SHALL be bumped, advanced, or independently rewritten during this feature.**
- **WHEN a third-party plugin negotiates with the facade THEN the facade SHALL expose the API generation and compatible increment as `B.C` so that the plugin can compare them without requiring knowledge of package maintenance component `D`; capability presence SHALL remain separate from protocol compatibility.**
- **WHEN a package is checked against the installed runtime THEN runtime identity SHALL match the full audited runtime identity, and mismatch SHALL produce safe disablement or explicit unavailability rather than silent acceptance.**
- **WHEN a wire protocol crosses host/client or process boundaries THEN it SHALL use the revision of its actual protocol family and SHALL NOT use the package version as a wire schema version.**
- **WHEN a durable record crosses an upgrade boundary THEN it SHALL use a record-specific schema ID and integer version; local decoders/upcasters SHALL be used only where a real old-read requirement exists.**
- **WHEN an unknown future wire revision or durable schema version is encountered THEN the reader SHALL return an explicit unsupported result and SHALL NOT guess, silently coerce, or discard fields.**
- **WHEN no upgrade-read requirement exists for a record or protocol THEN the refactor SHALL NOT prebuild a general migration framework, schema registry service, or cross-version conversion graph.**

**Classification:** 门面基础。

## 11. Plugin Private State, Scope, Visibility, And Concurrency

**User Story:** As a plugin maintainer, I want private state and asynchronous resources to remain bounded by owner and scope, so that facade guarantees do not leak into unrelated plugin internals or permit stale work to corrupt shared state.

### Acceptance Criteria

- **WHEN a plugin-private durable store is retained THEN it SHALL be owner-scoped, explicitly bound to exactly one of `profile`, `workspace`, or `session`, and SHALL NOT act as shared domain state or authority.**
- **WHEN a private durable record is written THEN the record envelope SHALL contain a schema ID, integer version, owner, scope, identity, and data envelope, and unknown future versions SHALL fail with `unsupported-schema`.**
- **WHEN a plugin is disabled, reloaded, or uninstalled THEN its storage handles SHALL close without deleting data; permanent deletion SHALL require an explicit purge operation.**
- **WHEN an API exposes execution identity THEN the refactor SHALL keep execution identity independent from event sequence and shall not change it across internal retry attempts.**
- **WHEN generation is used THEN it SHALL be an owner-specific opaque token; any ordering requirement SHALL use owner-local revision and SHALL NOT compare generations across owners.**
- **WHEN an operation exposes cancellation, timeout, disposer, reconnect, HMR, remote mount, replacement lifecycle, or asynchronous re-entry THEN its design SHALL declare cancellation propagation, concurrency strategy, commit eligibility, stale-result behavior, disposer ownership, and retry-versus-attempt semantics.**
- **WHEN an asynchronous result arrives after owner loss, generation replacement, disposal, or terminal outcome THEN it SHALL not publish, commit, trigger a new attempt, or dispose another owner’s resource.**
- **WHEN terminal outcomes are exposed THEN they SHALL use `success`, `error`, `aborted`, `denied`, or `superseded` with object-appropriate fields, and terminal state SHALL be final and unique.**
- **WHEN a timeout occurs THEN it SHALL remain an `error` with timeout reason or classification and SHALL NOT become a new terminal vocabulary item.**
- **WHEN host or client output crosses an audience boundary THEN visibility SHALL default to minimum exposure, secret values SHALL remain blocked unless user/profile policy explicitly permits them, and non-secret diagnostic exposure SHALL declare source, time, uncertainty, and redaction coverage.**
- **WHEN host data is sent to the browser THEN nested values, binary data, exception causes, and sensitive remote payloads SHALL be covered by host-side redaction before serialization; client-side validation SHALL not widen visibility.**

**Classification:** 适用成员按 A/B/C/R 登记；纯同步官方直通的并发章节可明确标注不适用并保留官方语义。

## 12. Capability Strategy And Replacement Boundary

**User Story:** As a replacement-package maintainer, I want the refactor to preserve clear implementation-channel boundaries, so that missing official seams do not become uncontrolled forks.

### Acceptance Criteria

- **WHEN a capability is already provided by an official event or service THEN the refactor SHALL use facade stabilization and SHALL NOT introduce a replacement solely to rename or repackage it.**
- **WHEN a B-class capability is translated through a lower-level hook THEN its public contract SHALL specify the translation boundary, at-most-once or convergence behavior where relevant, and fail-safe failure path.**
- **WHEN a capability cannot be implemented without changing the official runtime THEN the refactor SHALL record an upstream proposal and SHALL NOT publish a runtime member that pretends the capability is delivered.**
- **WHEN an R-class capability is retained THEN its replacement SHALL correspond to one approved official component owner, use only the official disable-and-insert patch mechanism, and preserve the replaced row’s service and event contract before adding its extension.**
- **WHEN an R-class package is applied THEN it SHALL verify target-row disablement, replacement-row activation, runtime/package identity, component-owner uniqueness, and critical contract availability before publishing its extension.**
- **WHEN an R-class package fails any boot check THEN it SHALL log a fail-safe notice and return normally without double-running the official and replacement rows.**
- **WHEN an R-class package exposes client behavior THEN it SHALL independently maintain and verify its client bundle, manifest, connection, remote, slot, settings, lifecycle, and HMR behavior as applicable.**
- **WHEN a capability concerns framework-wide priority, payload freezing, or callback fault containment THEN it SHALL remain facade or upstream work and SHALL NOT be converted into an R-class replacement.**
- **WHEN a replacement no longer provides independent stable value because an official equivalent seam exists THEN the capability SHALL enter retirement assessment and SHALL not be retained as an empty public shell.**

**Classification:** A/B/C/R according to the approved capability strategy; no new unapproved R capability is admitted by this feature.

## 13. Package Assembly And Installation Equivalence

**User Story:** As a profile maintainer, I want full and selective installation to produce the same facade behavior, so that package selection does not alter public semantics or create double execution.

### Acceptance Criteria

- **WHEN the full aggregation package is installed THEN it SHALL depend on the main package and all declared auxiliary packages, add no separate public API, and assemble rows in a deterministic order.**
- **WHEN the main package and all required auxiliary packages are installed selectively THEN the resulting active main rows, replacement rows, public paths, capability states, and behavior SHALL be equivalent to the full aggregation package.**
- **WHEN only the main package is installed THEN the facade SHALL provide the minimum main capability surface and every absent optional/replacement capability SHALL remain explicitly unavailable without affecting unrelated capabilities.**
- **WHEN an auxiliary package has a runtime/API baseline mismatch THEN only that auxiliary capability SHALL be disabled or degraded, the official row SHALL not be left disabled without a functioning replacement, and the main facade and unrelated packages SHALL remain active.**
- **WHEN a profile is loaded in reverse plugin order for a supported composition case THEN the resulting behavior SHALL obey the declared priority and registration-order contract rather than relying on accidental module evaluation order.**
- **WHEN the same package or row is encountered twice THEN the facade SHALL prevent double-running, duplicate publication, duplicate replacement ownership, and cross-generation cleanup.**
- **WHEN an installation is removed THEN the official row and original behavior SHALL be restorable through the supported profile/patch mechanism without modifying official package files.**

**Classification:** 门面基础；R 类装配遵守已批准 replacement 边界。

## 14. Consumer Migration And Ecosystem Acceptance

**User Story:** As a maintainer of existing consumers, I want the two reference plugins to use the new contract, so that the refactor is proven against real integrations rather than only facade fixtures.

### Acceptance Criteria

- **WHEN `dsh-read-image` is migrated THEN the migrated code SHALL use only the approved target-domain facade paths for image admission, request transformation, settings/remote, and execution route access, and SHALL remove its corresponding private monkey-patch, raw re-entry owner, and private route traversal.**
- **WHEN `dsh-pro-ex-ability-anchor` is migrated THEN it SHALL use the target session/prompt/client facade paths for the approved surface append, prompt event, settings remote, and client slot/bundle contracts, and SHALL remove the migrated hand-authored protocol glue.**
- **WHEN either consumer requires behavior outside the approved finite facade contract THEN the migration SHALL preserve an existing supported official path or record a separate proposal and SHALL NOT widen the M7 public contract implicitly.**
- **WHEN consumer migration is accepted THEN the actual consumer repository code path SHALL use the facade; an in-facade fixture or synthetic substitute alone SHALL NOT satisfy migration acceptance.**
- **WHEN consumer migration tests run THEN they SHALL preserve relevant message ordering, route absence semantics, prompt composition behavior, surface provenance behavior, client remote/slot behavior, and typed unavailable/failure behavior.**
- **WHEN migration completes THEN deleted hack code SHALL not remain as dormant fallback logic or as an unsupported direct-package escape hatch for the migrated behavior.**
- **WHEN the two consumers are tested THEN their relevant headless smoke and documented dev boot SHALL pass against the frozen M7 baseline without activation errors.**

**Classification:** A/B facade migration；C 类 timing or missing official seams remain proposals；R 类 consumer use follows the approved package boundary.

## 15. Verification, Test Matrix, And Delivery Gates

**User Story:** As a maintainer, I want evidence for ordering, conflict, failure, lifecycle, and migration boundaries, so that the refactor is complete and reproducible.

### Acceptance Criteria

- **WHEN the inventory and registry are complete THEN tests SHALL verify target path mapping, public member cardinality, removed paths, disabled/unavailable surface shape, and registry-to-type/snapshot consistency.**
- **WHEN composition tests run THEN they SHALL use at least two synthetic plugins to cover reverse loading order, same-key conflict, owner isolation, callback failure, repeated registration, missed disposal, stale disposer/generation, scope/resource isolation, ordered reducer repeatability, coordinated stale fencing or CAS, exclusive preflight rejection, authority closure, and pure-view write-authority leakage.**
- **WHEN client composition tests run THEN they SHALL cover remote, slot, settings, lifecycle, reconnect/HMR, owner-local generation, stale cleanup, host redaction, and client shape validation at the same semantic boundary where applicable.**
- **WHEN services tests run THEN they SHALL cover static whitelist membership, member-level availability, official receiver/argument/return/error preservation for passthroughs, and exclusion of undocumented runtime-discovered members.**
- **WHEN package tests run THEN they SHALL cover exact version baseline, frozen version metadata, runtime identity mismatch, plugin API negotiation, wire revision handling, durable schema handling, and full/selective installation equivalence.**
- **WHEN deletion approval is required THEN the test and delivery record SHALL link the approved deletion report to the changed public paths and consumer migrations.**
- **WHEN all implementation tasks are complete THEN the repository SHALL pass the prescribed `npm test`, `git diff --check`, official-package modification audit, headless smoke, dev boot, and consumer migration checks.**
- **WHEN final delivery is prepared THEN all Stage 4 code, tests, specifications, registry data, deletion reports, migration records, and feature registrations SHALL agree on the frozen public contract and SHALL be committed only after the required global review.**
- **WHEN any verification command fails, times out, cannot resolve its inputs, or cannot establish evidence THEN the result SHALL be treated as a blocking failure rather than as an absent finding or an implicit pass.**

**Classification:** 门面基础；验证覆盖 A/B/C/R 的各自边界。

## 16. Standards Applicability And Alignment

本节将 M7 Requirements 与现行标准的适用性显式固定，具体实现细节仍在 Stage 2 Design 中展开。

| 标准 | 适用性 | 本 Requirements 的对齐结论 |
|---|---|---|
| `docs/standards/public-api-shape.md` | 适用 | 目标 host/client namespace、领域优先命名、旧 alias 删除、capability registry、`services.*` 分层已在第 1–4、9 节覆盖。 |
| `docs/standards/composition-and-authority.md` | 适用 | composition mode、Composable Profile、owner/key/generation、authority closure、claim/preflight、失败隔离已在第 5–7 节覆盖。 |
| `docs/standards/domain-composition.md` | 适用 | 各目标领域的 owner、冲突、顺序、scope、resource 和 authority 最低要求已在第 8 节覆盖。 |
| `docs/standards/capability-strategy.md` | 适用 | feature admission/retirement、公共面减法、`services.*` 静态白名单、成员级 availability 和 passthrough 分级已在第 4、5、9、12 节覆盖（原 `refactor/capability-and-services.md`）。 |
| `docs/standards/versioning-and-protocols.md` | 适用 | 冻结的 `<A>-<B>.<C>.<D>` 基线、插件协商、wire revision、durable schema、装配等价性已在第 10、13 节覆盖。 |
| `docs/standards/durable-state-and-scope.md` | 适用 | owner-scoped private storage、三档 durable scope、schema envelope、disable/reload/uninstall/purge 生命周期已在第 11 节覆盖（原 `refactor/plugin-state-and-lifecycle.md`）。 |
| `docs/standards/ordering.md` | 适用 | 固定 priority、注册顺序、领域 reducer、producer/consumer 分离和禁止全局依赖图已在第 7、8、13 节覆盖。 |
| （原 `refactor/sdk-and-conformance.md`，已删除） | 当前不适用 | 本 feature 不实现独立 SDK、type-only 包、conformance 命令或运行时 registry 服务；仅交付可被未来评估复用的 registry、类型和测试事实。 |
| `docs/standards/capability-strategy.md` | 适用 | A/B/C/R 通道、R1–R9 边界、replacement 自检、版本锁定、退役和横切语义不得 R 已在第 2、7、12、13 节覆盖。 |
| `docs/standards/api-shape.md` | 适用 | projection/policy/mutation 三面边界、一面原则、单向数据流和 smell 判据已在第 5、6、8、11 节覆盖。 |
| `docs/standards/identity-and-lifecycle.md` | 适用 | execution identity、owner-specific generation、owner-local revision、统一终态与 finality 已在第 6、11 节覆盖。 |
| `docs/standards/durable-state-and-scope.md` | 适用 | scope 分层、mutation envelope、retry/attempt、失败分类和 unknown schema 处理已在第 10、11 节覆盖。 |
| `docs/standards/visibility-and-redaction.md` | 适用 | host/client audience、secret 默认阻断、非 secret diagnostics、redaction 覆盖边界已在第 3、11、14 节覆盖。 |
| `docs/standards/concurrency-and-cancellation.md` | 适用 | AbortSignal、终态裁决、stale result、disposer ownership、并发策略、retry/attempt 和 client/replacement 生命周期已在第 6、11、12、15 节覆盖；纯同步 A 类成员可按成员证据标注不适用。 |

## Out Of Scope

- 不新增未由本 Goal 覆盖的业务能力、公共 namespace、事件、remote、slot、settings bridge 或服务操作。
- 不把 C 类 upstream proposal 实现为运行时能力。
- 不新增未经批准的 R 类 replacement，不修改官方 DSH 包文件，不覆盖官方包 import 面。
- 不创建独立 SDK、conformance kit、通用权限系统、全局 owner graph、全局排序依赖图、跨 feature 分布式事务或通用 schema migration 平台。
- 不在 M7 期间 bump 任何包版本或 `dsh.api` 版本。

## Success Condition

Stage 1 Requirements 只有在用户明确批准后才进入 Stage 2 Design。Stage 4 只有在全部验收条件、删除报备门、版本冻结、消费者迁移、测试与全局终审均满足后才可声明完成。
