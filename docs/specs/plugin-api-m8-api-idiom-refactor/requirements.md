# Stage 1 — Requirements

## Introduction

`plugin-api-m8-api-idiom-refactor` 将 M7 冻结的 `dsh-plugin-api` host/client 公共 API 迁移到 `docs/standards/refactor/` 规定的八个 API idiom：`projection`、`policy`、`mutation`、`operation`、`contribution`、`resourceRegistry`、`coordination` 和 `selfDescription`。

本 feature 的交付对象是一个统一的公共契约迁移。成员级 registry、能力守恒矩阵、host/client surface、类型、事件语义、错误和生命周期行为必须共同收敛；内部实现可以按有依赖的批次执行，但不能把同一 idiom 的跨 namespace 契约拆成互不协调的公共 feature。

本文件中的分类含义如下：

- **A 类**：官方已有事件或服务边界，门面只负责稳定化、类型化和契约对齐。
- **B 类**：官方没有所需 dispatch 点，门面可以使用已存在的底层钩子或包装进行有限转译；必须满足幂等、收敛和 fail-safe 约束。
- **C 类**：当前实现通道无法兑现目标语义；只登记能力缺口或 upstream proposal，不宣称已实现。
- **R 类**：经批准由官方组件 replacement bundle 承载的能力；本 feature 不自行引入未经批准的 replacement 能力。
- **门面基础**：版本、能力查询、registry 验证、公共 surface 和 fail-safe 等横切能力。

需求中的“公共叶子”包括可调用函数、取值成员、公开事件操作，以及公开 handle 上可观察的成员。namespace 只作为导航节点，不承担叶子语义分类。

## Requirement 1: Member Contract Registry

**User Story:** As a plugin author, I want every supported public member to have a precise contract record, so that I can rely on one mechanically verifiable source of truth.

### Acceptance Criteria

1. WHEN the M8 public contract is evaluated THEN the registry SHALL contain one entry for every current host leaf, current client leaf, target leaf, and publicly exposed handle member listed by the M8 inventories.
2. WHEN a registry entry is created or updated THEN it SHALL record `publicPath`, `idiom`, `idiomExceptions`, `eventSemantics`, `semanticFace`, `effect`, `composition`, `runtime`, `implementationChannel`, `authority`, `scope`, `resourceKey`, `identitySource`, `conflictRule`, `lifecycle`, `failureSemantics`, `idempotency`, `retryLayer`, `availabilityShape`, `concurrency`, `reducer`, `currentShape`, `targetPath`, and `migrationAction` as applicable.
3. WHEN a public leaf or handle member is not present in the registry THEN the M8 contract SHALL be considered incomplete and the delivery SHALL fail validation.
4. WHERE a member is an official passthrough exception IF it is retained in the public surface THEN its registry path SHALL begin with `services.` and its record SHALL not claim one of the eight idioms.

**Classification:** 门面基础；适用于 A/B/C/R 所有公共成员。

## Requirement 2: Idiom Classification And Naming

**User Story:** As a plugin author, I want members with the same interaction semantics to use the same idiom and vocabulary, so that knowledge transfers across domains.

### Acceptance Criteria

1. WHEN a public member is classified THEN the registry SHALL assign exactly one primary idiom from the eight standard idioms, except for an explicitly recorded `services.*` passthrough exception.
2. WHEN two members require the same calling pattern THEN their observable entry verbs, result or handle fields, failure presentation, conflict presentation, lifecycle behavior, and freshness or generation semantics SHALL be equivalent except for domain data types and explicitly registered domain reducers or concurrency choices.
3. WHEN a member spans two interaction patterns THEN the public contract SHALL split it into separate members unless an `idiomExceptions` record contains the required exception fields and verification evidence.
4. WHEN a public member is renamed, merged, split, migrated, or deleted THEN its registry SHALL retain a traceable current-to-target record and the target idiom SHALL determine its public name.

**Classification:** 门面基础；目标规范约束，覆盖 A/B/C/R 的公共形状。

## Requirement 3: Projection Contract

**User Story:** As a plugin author, I want to query or observe frozen views with one consistent contract, so that reading state does not expose mutation or ownership mechanics.

### Acceptance Criteria

1. WHEN a projection member retrieves one item, a collection, a health view, history, or a current snapshot THEN the public operation SHALL use the applicable `get`, `list`, `inspect`, `history`, or `current` vocabulary and SHALL return a frozen read-only view or a typed unavailable result.
2. WHEN a projection member subscribes to changes THEN it SHALL be exposed through `observe` and SHALL return a handle with `current()`, `subscribe(listener)`, `dispose()`, and `epoch`.
3. WHEN a projection subscription is disposed more than once THEN disposal SHALL be idempotent, SHALL not notify the disposed listener again, and SHALL not affect other subscribers.
4. WHEN a projection is absent or degraded THEN the projection SHALL express that state through its documented unavailable or degraded view without throwing through the caller.
5. WHEN a projection listener throws or rejects THEN the system SHALL contain the failure to that listener and SHALL continue processing other listeners.

**Classification:** 适用于 A 类稳定化、B 类投影转译和已有 R 类能力的公共读取面；C 类缺口不得伪造为 projection。

## Requirement 4: Policy Contract

**User Story:** As a plugin author, I want to register a decision policy that the system actually applies, so that registration has predictable effect without a second consultation API.

### Acceptance Criteria

1. WHEN a policy is registered THEN the public entry SHALL use `register(spec)` and the decision callback SHALL be named `decide(context)` where a callback is required.
2. WHEN policy registration succeeds THEN the returned handle SHALL expose `id`, `ownerId`, `generation`, and idempotent `dispose()` with identity-bound stale-disposer behavior.
3. WHEN the same owner registers the same policy id again THEN the newer generation SHALL replace the older generation according to latest-wins semantics; WHEN a different owner registers the same conflict key THEN the system SHALL reject the registration with a typed owner-conflict result or error as defined by the policy contract.
4. WHEN a policy registration conflicts or violates the registration contract THEN the system SHALL use the policy registration failure shape and SHALL not silently return `ok:false` or a no-op disposer.
5. WHEN a registered policy reaches its declared decision point THEN the system SHALL automatically consult it exactly as specified by its reducer, priority, and invocation bound.
6. WHEN a policy point cannot be consulted by the current runtime THEN the public consultation-style member SHALL not be exposed and the registry SHALL record a capability gap and the required migration property.
7. WHEN a policy callback throws or rejects THEN the system SHALL contain the callback failure and SHALL apply the policy point's documented default decision without breaking the enclosing operation.

**Classification:** A/B/C；A 类用于已有 decision dispatch，B 类用于底层钩子转译，C 类用于缺失官方决策点的 gap；不得未经批准新增 R 类政策能力。

## Requirement 5: Mutation Contract

**User Story:** As a plugin author, I want writes to produce durable facts with explicit commit state, so that success, rejection, and compensation are distinguishable.

### Acceptance Criteria

1. WHEN a mutation writes a business fact THEN it SHALL return a frozen discriminated result containing `ok`, `code`, and `commitState`, with `generation` when the domain uses compare-and-set or fencing.
2. WHEN a mutation encounters a business rejection, conflict, or denied write THEN it SHALL return the documented discriminated result and SHALL not throw through the caller.
3. WHEN a mutation receives invalid arguments, violates the public contract, or encounters an unrecoverable programming error THEN it SHALL throw the typed error defined for that contract.
4. WHEN a fact is committed THEN the public mutation surface SHALL not expose a disposer that silently retracts it; reversal SHALL require an explicit compensating operation or mutation.
5. WHEN a multi-step write uses a transaction handle THEN the public sequence SHALL use `prepare`, `record`, and `commit` or `rollback`, and the registry SHALL distinguish mutation members from operation members.
6. WHEN a mutation is retried after reaching a terminal state THEN it SHALL return the existing terminal state with the documented terminal-idempotency marker and SHALL not create a second fact.

**Classification:** A/B/R as applicable to existing write paths; C only for an explicitly recorded unavailable authority boundary.

## Requirement 6: Operation Contract

**User Story:** As a plugin author, I want to start an operation and observe its terminal outcome without managing internal phases, so that cancellation and retries have predictable meanings.

### Acceptance Criteria

1. WHEN an operation is started THEN its public result SHALL be a discriminated outcome with `ok`, `code`, `operation`, and `terminal`, or it SHALL return a handle with `id`, `ownerId`, `status()`, `observe()`, and `dispose()`.
2. WHEN an operation handle is disposed THEN disposal SHALL request stopping without claiming that the operation has already stopped; publication of later results SHALL be guarded by operation identity, owner, generation, and terminal state as applicable.
3. WHEN an operation is cancelled, superseded, denied, unavailable, timed out, or fails THEN the outcome SHALL use the standard terminal vocabulary `aborted`, `superseded`, `denied`, `error`, or the documented unavailable result; timeout SHALL remain an error with timeout provenance.
4. WHEN an operation performs an internal retry THEN it SHALL preserve the operation identity and add an `attempt`; WHEN a caller starts a new operation externally THEN the system SHALL create a new operation identity.
5. WHEN two operation invocations contend for a domain resource THEN the registry SHALL record the domain `concurrency` strategy and the outward result shape SHALL remain the operation discriminated outcome.
6. WHEN the operation entry is unavailable THEN it SHALL return a typed unavailable result without throwing through the caller.

**Classification:** A/B/R according to the backing operation; C gaps remain proposals and are not represented as active operation support.

## Requirement 7: Contribution Contract

**User Story:** As a plugin author, I want to contribute reversible content to an assembly, so that my contribution can be removed or evicted without becoming a domain fact.

### Acceptance Criteria

1. WHEN content is submitted to an assembly surface THEN the public entry SHALL use `contribute(spec)` and SHALL return a discriminated result containing a handle with `id`, `ownerId`, `seq`, and idempotent `dispose()`.
2. WHEN the same owner submits the same contribution id while the original contribution is active THEN the system SHALL return the contribution conflict result and SHALL not apply latest-wins replacement.
3. WHEN a contribution is disposed or evicted THEN it SHALL no longer participate in future assembly results, and eviction SHALL produce an observable event or documented outcome rather than a silent removal.
4. WHEN a contribution is pending asynchronously THEN the caller SHALL receive a handle that can be safely disposed before completion, and completion SHALL not leak an official disposer or resurrect a stale contribution.
5. WHEN a contribution is consumed by an assembly THEN it SHALL not be represented as a durable domain fact unless a separate mutation explicitly records it.

**Classification:** A/B for existing host/client assembly and remote/slot bridges; R only where an approved replacement owns the assembly path.

## Requirement 8: Resource Registry Contract

**User Story:** As a plugin author, I want to register data or implementations that the system consumes by key, so that registration and lookup have predictable ownership and conflict behavior.

### Acceptance Criteria

1. WHEN a resource or implementation is registered THEN the public entry SHALL use `register(spec)` and SHALL return a handle with `id`, `ownerId`, `generation`, and idempotent `dispose()`.
2. WHEN the same owner registers the same id with identical content THEN the system SHALL return the existing registration handle idempotently.
3. WHEN the same owner registers the same id with different content THEN the system SHALL reject the registration with a typed `conflict` error; WHEN a different owner claims the same shared key THEN the system SHALL reject it with a distinct owner-conflict error.
4. WHEN a resource registration is disposed THEN a subsequent registration SHALL begin a new lifecycle and SHALL not be treated as a stale update of the previous generation.
5. WHEN a registry member is queried THEN it SHALL expose `get(id)` and `list(filter?)` as projection operations without changing registration conflict semantics.
6. WHEN registration fails because the backing service is unavailable THEN the public contract SHALL use the declared unavailable failure shape and SHALL not silently claim that the resource is registered.

**Classification:** A/B/R according to the registry owner; no new R class is introduced by this requirement.

## Requirement 9: Coordination Contract

**User Story:** As a plugin author, I want to acquire, renew, and release shared resources with fencing semantics, so that stale holders cannot act as current owners.

### Acceptance Criteria

1. WHEN a coordination resource is used THEN the public verbs SHALL be `acquire`, `heartbeat`, `release`, `takeover`, `compareAndSet`, `observe`, and `availability` as applicable, regardless of domain name.
2. WHEN acquisition succeeds THEN the lease handle SHALL contain `id`, `resource`, `generation`, `fencingToken`, and `expiresAt`, and SHALL be treated as a credential rather than a generic disposer handle.
3. WHEN a coordination handle is released more than once THEN the release operation SHALL be idempotent; WHEN a stale handle heartbeats or attempts a state change THEN the system SHALL return a typed stale or conflict outcome without throwing through the caller.
4. WHEN a takeover is requested THEN the request SHALL include the required expected proof, and the result SHALL record the reason and provenance for cross-owner takeover.
5. WHEN coordination availability is queried THEN availability SHALL be obtained from `availability(scope)` and SHALL not be embedded in every business outcome; the availability result SHALL state whether the backing resource actually provides durability.
6. WHEN the runtime only provides an in-memory or bounded scope adapter THEN the public contract SHALL report that honest degradation through availability and SHALL not claim durable coordination.

**Classification:** A/B/R according to the backing authority; unsupported durable behavior remains unavailable rather than being simulated as durable.

## Requirement 10: Self-Description And Availability

**User Story:** As a plugin author, I want to distinguish what the facade provides from what is usable now, so that I can degrade deliberately.

### Acceptance Criteria

1. WHEN a caller queries facade capabilities THEN `capabilities.get`, `capabilities.list`, and `capabilities.require` SHALL describe public capability presence without exposing internal mounters, package names, replacement rows, or writable registry objects.
2. WHEN a caller queries a namespace's current availability THEN the namespace SHALL provide `availability()` returning a frozen object whose `status` is exactly one of `active`, `degraded`, or `unavailable`.
3. WHEN a namespace exposes a capability matrix THEN it SHALL use `capabilityMatrix()` for the matrix and SHALL not overload `availability` with capability presence.
4. WHEN a capability is present in the registry THEN `capabilities.get(path)` SHALL return a status in `active`, `degraded`, or `unavailable`, consistent with the corresponding namespace availability rules.
5. WHEN availability is queried repeatedly THEN the operation SHALL be side-effect free, idempotent, and non-throwing.
6. WHEN a public namespace has no currently usable backing service THEN its availability member SHALL remain shape-compatible and SHALL report `unavailable` rather than disappearing from the contract unless the member was explicitly removed by the capability matrix.

**Classification:** 门面基础；适用于 A/B/C/R 的公开 capability 和 availability 表达。

## Requirement 11: Event Semantics And Producer Authority

**User Story:** As a plugin author, I want event observation and event production to have distinct authority, so that observing system facts does not imply permission to emit them.

### Acceptance Criteria

1. WHEN a caller observes events THEN the public subscription member SHALL follow the projection `observe` contract, including frozen or officially immutable payload rules, listener containment, and idempotent disposal.
2. WHEN a caller dispatches an event through the facade THEN the dispatch member SHALL follow the operation outcome contract and SHALL record whether the event is a decision, fact, observation, or notification.
3. WHEN a canonical system event is dispatched THEN only the event's producer authority SHALL be able to invoke its dispatch operation; an observer SHALL not gain production rights by subscribing.
4. WHEN an event dispatch listener throws or rejects THEN the bus SHALL contain the listener failure according to the event's failure policy and SHALL return the documented dispatch outcome without throwing through unrelated callers.
5. WHEN a caller defines a custom event THEN the caller SHALL obtain an owner-scoped, capability-limited publisher and SHALL not be able to dispatch arbitrary canonical event names.
6. WHEN the current runtime cannot provide the owner-scoped custom event publisher THEN the public surface SHALL record that capability as unavailable or as an upstream proposal, and SHALL not describe the publisher as existing.

**Classification:** A 类事件稳定化、B 类事件语义包装、C 类自定义 publisher 能力缺口；事件横切语义不得通过未经批准的 R 类实现。

## Requirement 12: Public Surface Migration And Deletion

**User Story:** As a plugin author, I want the public surface to contain one clear target path per capability, so that historical aliases and internal implementation paths do not create ambiguity.

### Acceptance Criteria

1. WHEN an existing member has a target path in the migration inventory THEN the public surface SHALL expose the target path with the target idiom shape and SHALL not expose the old path as a compatibility alias.
2. WHEN multiple current entries represent one capability THEN the target surface SHALL merge them according to the capability matrix while preserving the capability once, rather than preserving every historical entry.
3. WHEN one current entry spans multiple idioms THEN the target surface SHALL split it into idiom-specific members or record a valid exception with verification evidence.
4. WHEN a member is deleted THEN the registry and capability matrix SHALL record either its replacement capability or an explicit gap reason, and the delivery report SHALL list the deletion.
5. WHEN a member is an internal mechanism, duplicate official forwarding path, or consultation-style entry whose policy is not automatically applied THEN it SHALL not remain as a hidden public alias, silent no-op, or dormant fallback.
6. WHEN a candidate deletion would change an approved Goal or Requirements acceptance boundary THEN the work SHALL pause for a separate human boundary decision before implementation.

**Classification:** 门面基础；涉及 A/B/C/R 的公共路径处置。C gap 入口只能按已批准边界登记，不得用咨询入口假装补齐。

## Requirement 13: Host And Client Parity

**User Story:** As a plugin author working across host and browser code, I want the same idiom vocabulary and outer contract on both sides, so that I do not learn two incompatible APIs.

### Acceptance Criteria

1. WHEN a host and client member represent the same interaction pattern THEN their idiom, entry vocabulary, result fields, handle fields, failure presentation, conflict presentation, and lifecycle names SHALL be aligned except for explicitly documented transport or domain data differences.
2. WHEN the client public API is assembled THEN it SHALL publish supported root members directly and SHALL not expose a public `.client` wrapper namespace.
3. WHEN client remotes, slots, settings, lifecycle, and codec surfaces are exposed THEN they SHALL be classified and shaped as contribution, projection, resourceRegistry, operation, or selfDescription members according to their semantics, not according to their transport implementation.
4. WHEN an official browser service is retained without facade semantics THEN it SHALL be exposed only through the audited `services.*` passthrough surface.
5. WHEN a client callback, subscription, remote contribution, or stale lifecycle binding fails THEN the failure SHALL be contained to the owner-bound client resource and SHALL not corrupt unrelated client surfaces.
6. WHEN host data is published to the client THEN redaction and freezing SHALL occur before serialization, and the client SHALL validate the declared wire shape before exposing it.

**Classification:** A/B for existing client bridges; C for native dynamic remote discovery or other missing official browser seams; R only for independently approved replacement ownership.

## Requirement 14: Owner, Scope, Lifecycle, And Concurrency

**User Story:** As a plugin author, I want registrations and asynchronous work to remain bound to the correct owner and scope, so that reloads and conflicts cannot remove or publish another plugin's state.

### Acceptance Criteria

1. WHEN a registration, policy, contribution, subscription, or client binding is created THEN the owner identity SHALL be derived from the actual caller or plugin context and SHALL not be accepted solely from caller-supplied metadata.
2. WHEN a disposer or completion callback runs after a newer generation exists THEN it SHALL be treated as stale and SHALL not remove, overwrite, or publish the newer generation or another owner's resource.
3. WHEN `generation`, `seq`, and `epoch` are recorded THEN `generation` SHALL mean a concurrency or fencing token, `seq` SHALL mean registration order, and `epoch` SHALL mean freshness; no one field SHALL carry another field's meaning.
4. WHEN an asynchronous operation is cancelled THEN the implementation SHALL preserve the caller's `AbortSignal`, add only the local cancellation source required by the operation, and SHALL perform owner, generation, resource, and terminal-state checks before publishing or committing.
5. WHEN an operation reaches a terminal state THEN the system SHALL not start a new retry from that terminal state, and stale or cancellation diagnostics SHALL remain bounded and non-authoritative.
6. WHEN an API has a declared scope THEN reads, writes, callbacks, and cleanup SHALL stay within that scope unless an explicit authority or bypass is recorded in the registry.

**Classification:** 门面基础横切约束；适用于 A/B/R 实现，C 语义缺口必须单独登记。

## Requirement 15: Composition And Authority

**User Story:** As a plugin author, I want multi-plugin composition to be deterministic and authority boundaries to be explicit, so that load order and hidden bypasses do not change behavior unexpectedly.

### Acceptance Criteria

1. WHEN a registry member is composed from multiple owners THEN its registry SHALL declare one of `pure`, `additive`, `ordered`, `coordinated`, or `exclusive` and SHALL state the reducer or conflict rule that determines the result.
2. WHEN an ordered member is composed THEN priority SHALL use only `lowest`, `low`, `normal`, `high`, `highest`, or `monitor`, with deterministic same-priority ordering and no undocumented global dependency graph.
3. WHEN an exclusive or coordinated member is invoked THEN preflight conflict or authority rejection SHALL occur before the protected side effect, and the outcome SHALL identify the conflict or denial without partial success.
4. WHEN a member can bypass a higher-level authority through an official low-level path THEN the bypass SHALL be explicitly registered with its owner, scope, and verification evidence; unregistered bypasses SHALL fail contract validation.
5. WHEN two supported plugins are loaded in reverse order THEN the documented composition result SHALL remain deterministic except where the registry explicitly declares order as business semantics.
6. WHEN a member is marked `recommended` for a composable profile THEN its composition, authority, lifecycle, and failure audits SHALL be complete and its inclusion SHALL be represented by a generated profile fixture.

**Classification:** 门面基础横切约束；涉及所有 A/B/R 公共组合面，不将横切排序或 containment 转为 R 类。

## Requirement 16: Capability Conservation And Services Audit

**User Story:** As a maintainer, I want every current capability to be accounted for after migration, so that surface cleanup does not silently remove useful behavior.

### Acceptance Criteria

1. WHEN an M8 migration is evaluated THEN every current capability cluster SHALL have exactly one final status such as retained, renamed, merged, migrated, deleted, or gap in the capability matrix.
2. WHEN a capability is marked deleted THEN the matrix SHALL contain a replacement or a specific gap reason, and the delivery report SHALL identify the affected consumers and verification evidence.
3. WHEN a capability is migrated to `services.*` THEN its official receiver, argument, return, error, availability, cancellation, and visibility behavior SHALL be audited member by member, with no facade semantic claim added.
4. WHEN an official service member is not in the audited whitelist THEN it SHALL not be exposed through the facade, even if it is discoverable on the runtime service object.
5. WHEN the public surface is compared with the registry and snapshots THEN there SHALL be no unregistered current path, target path, removed path, or unexplained capability loss.
6. WHEN an implementation cannot prove that an automatic replacement covers the original trigger, input, output, failure, and observability behavior THEN the capability SHALL remain marked as a gap rather than as retained or replaced.

**Classification:** 门面基础；适用于所有 A/B/C/R 能力簇。

## Requirement 17: Implementation Channel And Capability Boundaries

**User Story:** As a maintainer, I want each capability's implementation channel to be explicit, so that facade translation, upstream work, and component replacement are not confused.

### Acceptance Criteria

1. WHEN a public member is registered THEN its implementation channel SHALL be one of `facade`, `passthrough`, `proposal`, or `replacement`, and the channel SHALL match the capability strategy applicable to that member.
2. WHEN an A-class member is exposed THEN the facade SHALL preserve the official event or service contract and SHALL not invent an alternative authority or domain outcome.
3. WHEN a B-class member is implemented through a lower-level hook THEN the adapter SHALL be idempotent, convergence-bounded, fail-safe, and explicit about the original hook and the simulated semantic boundary.
4. WHEN a C-class capability is not available THEN the registry and proposal record SHALL state the missing decision point or official seam and SHALL not expose an active implementation that only appears to satisfy the target shape.
5. WHEN an R-class replacement is proposed or changed THEN it SHALL have an approved component owner, runtime and package identity checks, boot self-checks, retirement conditions, and the required upstream proposal; an unapproved replacement SHALL not be added by M8.
6. WHEN any implementation channel fails during plugin apply or boot THEN the system SHALL log the failure, safely disable or fall back only within the recorded contract, and SHALL not throw through the harness boot.

**Classification:** A/B/C/R/门面基础；本需求定义边界，不批准新的 R 类能力。

## Requirement 18: Verification, Consumer Migration, And Delivery Gates

**User Story:** As a maintainer, I want the refactor to be proven against real consumers and installation modes, so that a passing unit suite does not hide a broken public contract.

### Acceptance Criteria

1. WHEN registry or public surface data changes THEN the validator, snapshot generator, type or surface checks, and affected unit and integration tests SHALL run against the same registry fact source.
2. WHEN M8 verification runs THEN tests SHALL cover host and client naming, handle shapes, failure and conflict semantics, event authority, owner and scope isolation, stale cleanup, cancellation, composition order, and capability conservation.
3. WHEN the full aggregate bundle and the selective main-plus-auxiliary installation are assembled at the same baseline THEN they SHALL expose the same intended main and replacement rows and SHALL not double-run or change replacement semantics.
4. WHEN only the main package is installed or an optional auxiliary package is unavailable THEN the affected capability SHALL report typed unavailable or disabled state without disabling unrelated facade capabilities.
5. WHEN `dsh-read-image` and `dsh-pro-ex-ability-anchor` are migrated THEN they SHALL use target public paths, remove the corresponding private hacks and compatibility fallbacks, and preserve the documented behavior covered by the capability matrix.
6. WHEN headless smoke and documented development boot are run for the migrated consumers THEN they SHALL complete without activation errors and SHALL provide evidence for route, prompt, provenance, remote, slot, settings, and typed-unavailable behavior applicable to each consumer.
7. WHEN all implementation tasks are complete THEN the delivery SHALL pass `npm test`, `git diff --check`, official-package modification audit, registry/surface consistency checks, consumer verification, and the required global adversarial review before the Stage 4 completion commit.

**Classification:** 门面基础；验收覆盖 A/B/C/R 的交付结果，但不把未实现的 C 类能力当作通过条件。

## Standards Applicability And Alignment

- `docs/standards/refactor/README.md`：适用。M8 的目标形状、成员级完整性、能力守恒和 idiom 同构直接由该目录定义。
- `docs/standards/refactor/api-idiom.md`：适用。需求 2–11、14–17 对应其分类、统一形状、失败/冲突、passthrough 和能力缺口规则。
- `docs/standards/refactor/idiom-catalogue.md`：适用。需求 3–10 对应八个 idiom 的入口、handle、生命周期和 availability 形状。
- `docs/standards/refactor/api-migration.md`：适用。需求 12 和 16 覆盖迁移、删除、形状对齐和能力缺口记录。
- `docs/standards/refactor/member-contract-registry.md`：适用。需求 1、2、10、14、16、18 覆盖叶子 registry、机械校验、handle 登记和 surface 一致性。
- `docs/standards/refactor/member-inventory.md`：适用。需求 1、12、16、18 要求 current/target/handle 叶子完整覆盖。
- `docs/standards/refactor/capability-matrix.md`：适用。需求 12、16、18 要求能力状态、删除替代和 gap reason 守恒。
- `docs/standards/refactor/anti-intuitive-inventory.md`：适用。需求 2–15、18 要求每项绑定具体目标形状和验证证据。
- `docs/standards/refactor/events-semantics.md`：适用。需求 11 覆盖事件 idiom 归属、事件语义分类、生产权和自定义 publisher 边界。
- `docs/standards/README.md` 及其现行分册：适用。Stage 2 Design 必须进一步对照 capability strategy、API shape、public API shape、composition/authority、domain composition、ordering、identity/lifecycle、durable state/scope、visibility/redaction、concurrency/cancellation、versioning/protocols；M8 不得把未来目标规范描述为当前已具备能力。
