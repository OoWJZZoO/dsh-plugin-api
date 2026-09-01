# Stage 1 - Requirements

## Status

SPEC1 Stage 1：已获用户确认（2026-09-01）。批准包含本版对 M8 idiom 契约的显式约束；Stage 2 Design 只可在本阶段提交完成后开始。

## Introduction

`plugin-api-policy-enforcement-closure` 修正现有 policy 契约的执行边界：第三方注册 policy 后，锁定 runtime 中所有登记为受支持的官方路径必须在真实决策点自动应用 policy；合作型第三方插件同时获得公开、受支持的主动调用入口，使其自有路径可以遵守同一 policy authority。

本 feature 不把第三方主动调用当作官方自动执行的替代，也不试图约束主动绕过门面或官方服务的恶意插件。跨组件缺失决策点可以由 component-local replacement slices 协同补齐，但每个 replacement owner 仍只归属一个官方组件包，并完整保留该组件被替代行的官方契约。

本文中的“policy”包括 canonical registry 或运行时公共面中以 policy registry、decision policy、guard、restrict、admission、routing、visibility、redaction、egress、recovery 或等价语义存在的公共成员；最终全集由 Requirement 1 的 inventory 机械确定，而不是仅由名称推断。

“官方路径”指锁定 runtime 中由官方行、官方服务、官方 provider/transport 或本仓库已批准 replacement owner 承载的受支持执行路径。“第三方自有路径”指合作型第三方插件自己拥有副作用或终态提交、并主动调用公共 policy 接口的路径。

## Requirement 1: Canonical Policy Inventory And Enforcement Matrix

**User Story:** As a maintainer, I want every public policy and every official decision path inventoried, so that no registered policy silently remains advisory or unconsumed.

### Acceptance Criteria

1. WHEN this feature establishes its policy inventory THEN the system SHALL enumerate every public policy or policy-shaped member from the canonical registry and the actual host/client public surfaces, including egress, recovery, admission, routing, tool guards/restrictions, visibility, redaction, activation, authorization, and every additional member found by semantic inspection rather than name matching alone.
2. WHEN an inventory entry is recorded THEN the system SHALL identify its public registration member, policy owner, decision vocabulary, reducer or conflict rule, default decision, official automatic decision points, cooperative third-party invocation member, affected official components, observable evidence, and current enforcement status.
3. WHEN an official execution path can perform a policy-governed side effect, terminal transition, retry, fallback, publication, visibility change, or authorization decision THEN the enforcement matrix SHALL identify the last stable decision point before that action and the component that owns the action.
4. WHEN an inventory entry has a registration member but no automatic official decision point and no supported cooperative invocation member THEN validation SHALL classify the entry as incomplete and SHALL fail delivery unless a named edge-path gap is approved under Requirement 10.
5. WHEN the registry, runtime surface, generated fixtures, and enforcement matrix disagree about a policy member or protected path THEN delivery validation SHALL fail and SHALL NOT select one source silently.
6. WHEN the inventory is complete THEN every public policy SHALL have exactly one disposition: automatically enforced on its declared official paths with a cooperative invocation member, unavailable, or retained as a named edge-path gap with evidence and retirement conditions.

**Classification:** Facade foundation across A/B/R channels; a remaining C classification is allowed only per named path after the required reachability assessment.

## Requirement 2: Shared Policy Authority And Automatic Application

**User Story:** As a plugin author, I want registration to make my policy effective automatically on supported official paths, so that I do not depend on every official caller remembering a consultation step.

### Acceptance Criteria

1. WHEN a policy registration succeeds THEN the system SHALL make that policy eligible at every declared supported official decision point without requiring the registering plugin or the official business caller to invoke a second public consultation method.
2. WHEN a supported official path reaches its policy decision point THEN the system SHALL evaluate the current policy generation before the protected action and SHALL apply the converged domain decision before any protected side effect or terminal commitment occurs.
3. WHEN automatic enforcement and cooperative third-party invocation evaluate the same normalized input under the same active policy generations THEN the system SHALL use the same registry, reducer, default decision, callback containment, decision vocabulary, and audit authority, and SHALL NOT maintain parallel policy state or divergent semantics.
4. WHEN a policy is registered, replaced, disposed, or becomes stale THEN automatic and cooperative decision paths SHALL observe the same owner-bound generation and SHALL NOT let a stale registration or disposer alter a newer generation or another owner's policy.
5. WHEN no policy is registered at a decision point THEN the system SHALL apply that point's documented default behavior and SHALL NOT invent an allow outcome merely because no plugin participated.
6. WHEN a policy callback throws, rejects, times out where asynchronous callbacks are supported, or returns a malformed decision THEN the system SHALL contain the failure to that callback, apply the point's documented fail-safe default, preserve unrelated policies, and record bounded owner-attributed evidence.
7. WHEN automatic policy enforcement cannot initialize for one official component THEN the system SHALL fail safely within that component, report its concrete protected paths as degraded or unavailable, and SHALL NOT report those paths as automatically enforced.

**Classification:** A where an official decision event/service exists; B where a proven lower-level hook provides the pre-action point; R where an approved component replacement owns the missing point.

## Requirement 3: Public Cooperative Policy Interfaces

**User Story:** As a cooperative third-party plugin author, I want an explicit supported policy interface for my own paths, so that I can follow the same rules even when my code does not use an official execution path.

### Acceptance Criteria

1. WHEN a public policy is available THEN the public contract SHALL retain or provide its policy registration interface and SHALL provide a documented cooperative decision, authorization, or execution interface appropriate to that domain.
2. WHEN a third-party plugin invokes a cooperative policy interface THEN the system SHALL normalize and validate the supplied context, evaluate the same active policies used by automatic enforcement, and return a frozen typed decision or authorization outcome with stable machine fields and bounded caller-facing reason text.
3. WHEN a cooperative invocation is denied, unavailable, malformed, or affected by a policy callback failure THEN the interface SHALL expose the domain's documented typed result or typed error and SHALL NOT claim that the caller's external side effect was prevented when the facade does not own that side effect.
4. WHERE a domain requires a time-bounded authorization IF a cooperative caller requests authority for its own side effect THEN the system SHALL bind the authorization to the normalized target, scope, owner, generation, and expiry, and SHALL NOT authorize another target or a later generation implicitly.
5. WHEN a cooperative caller receives a decision or authorization THEN the caller SHALL remain responsible for honoring it on its own path, and the public documentation SHALL distinguish this cooperative contract from automatic enforcement of official paths.
6. WHEN a cooperative invocation produces a decision or authorization THEN the system SHALL record it through the same bounded audit or decision projection used by the corresponding automatic path, with provenance identifying the cooperative invocation.
7. WHEN a policy's semantics cannot be represented safely as a raw decision for a caller-owned path THEN the system SHALL expose a capability-limited execution or authorization operation instead of a generic unrestricted evaluator.

**Classification:** Facade operation/policy boundary; B for facade-owned normalization and decision reuse. It is not evidence that an official path is automatically enforced.

## Requirement 4: Egress Enforcement Closure

**User Story:** As a plugin author, I want registered egress policy to be applied automatically before supported official outbound actions, so that official runtime traffic cannot bypass the policy by omission.

### Acceptance Criteria

1. WHEN the egress enforcement matrix is built THEN it SHALL enumerate every locked-runtime official outbound path, including LLM/provider calls and discovery, MCP stdio and HTTP transports, official web operations, subprocess/shell/terminal creation, attachment remote ingestion, remote/connection transports, and any additional HTTP, socket, WebSocket, transport, or process path found by inspection.
2. WHEN an enumerated official outbound path is marked supported THEN the owning component SHALL automatically evaluate egress policy against a normalized target before connection establishment, request transmission, transport creation, or child-process creation.
3. WHEN egress policy denies a supported official outbound target THEN the system SHALL prevent that outbound side effect, return the path's documented denied outcome, and append bounded decision evidence without leaking credentials, headers, command secrets, or private payloads.
4. WHEN egress policy allows a supported official outbound target THEN any internal authorization SHALL be scoped to that exact normalized target, owner, generation, and permitted lifetime, and SHALL NOT authorize a redirect, reconnect, retry, subprocess descendant, or different destination unless the contract explicitly re-evaluates that action.
5. WHEN an official outbound path redirects, reconnects, retries, switches transport, resolves a materially different destination, or creates a later child process THEN the system SHALL re-evaluate policy at the first point where the new outbound target is known unless an unexpired authorization explicitly covers that exact action.
6. WHEN the egress policy authority is unavailable or a policy evaluation fails on a path declared fail-closed THEN the owning component SHALL perform no outbound side effect and SHALL report a typed denied or unavailable outcome.
7. WHEN a cooperative third-party plugin owns an outbound path THEN `security.egress` SHALL expose a supported public decision or authorization interface that uses the same target vocabulary, reducer, default deny, lifecycle, and audit authority as official automatic enforcement.
8. WHEN a third-party plugin directly invokes lower-level network, socket, WebSocket, process, native, or external-process capabilities without using the cooperative interface or a supported official path THEN the system SHALL document that bypass as the retained third-party gap and SHALL NOT claim to intercept it.
9. WHEN full installation is active at a compatible locked runtime THEN every official outbound path marked supported in the matrix SHALL report automatic enforcement active; WHEN a required component owner is absent in selective installation THEN only its named paths SHALL report degraded or unavailable.
10. WHEN a newly observed official outbound path has not completed inventory and enforcement verification THEN the system SHALL report that named path as unverified or unavailable and SHALL NOT broaden an existing active status to cover it implicitly.

**Classification:** A/B/R per component decision point; direct third-party bypass is an explicit unsupported boundary, not a capability to be solved by this feature.

## Requirement 5: Recovery Automatic Consumption

**User Story:** As a plugin author, I want registered recovery policy to be consumed automatically by supported official failure authorities, so that recovery decisions are not merely advisory results left to each caller.

### Acceptance Criteria

1. WHEN the recovery enforcement matrix is built THEN it SHALL enumerate every locked-runtime official failure path that can retry, fallback, abort, surface, replace, or otherwise settle model, tool, agent-loop, task, MCP, or other governed operations.
2. WHEN a supported official operation reaches a recovery decision point THEN its single recovery authority SHALL normalize the failure, evaluate active recovery policy, and apply the converged decision before committing the next attempt, fallback, or terminal outcome.
3. WHEN recovery policy selects retry THEN the system SHALL preserve the logical execution identity, create a distinct attempt, obey declared retry bounds and cancellation, and SHALL NOT retry after an aborted, denied, superseded, or already committed terminal outcome.
4. WHEN recovery policy selects fallback, abort, surface, or another documented action THEN the owning operation SHALL apply that action once and SHALL publish the resulting decision and terminal evidence without requiring a consumer to invoke a separate consume method.
5. WHEN the same failure is observed more than once or a stale completion arrives THEN the recovery authority SHALL consume it at most once for the current operation generation and SHALL NOT start a duplicate attempt or overwrite a committed outcome.
6. WHEN the recovery authority or policy evaluation is unavailable or fails THEN the operation SHALL use its documented fail-safe recovery default and SHALL NOT silently behave as if a policy-approved retry or fallback occurred.
7. WHEN a cooperative third-party plugin owns an operation or failure path THEN `executions.recovery` SHALL expose a supported public decision or capability-limited execution interface that uses the same classifier, policy registry, reducer, retry vocabulary, and decision projection as official automatic recovery.
8. WHEN a third-party plugin bypasses the supported recovery interface and settles its own operation directly THEN the system SHALL document that path as outside automatic recovery authority and SHALL NOT attempt to infer or rewrite the plugin's private terminal state.

**Classification:** A/B where official failure/operation hooks exist; component-local R where the official operation owner lacks the required pre-terminal seam.

## Requirement 6: Other Policy Domains

**User Story:** As a maintainer, I want every other public policy domain checked against the same rule, so that egress and recovery are not repaired while equivalent advisory policies remain hidden.

### Acceptance Criteria

1. WHEN Requirement 1 identifies a policy other than egress or recovery THEN the system SHALL determine whether every declared supported official decision point automatically applies it.
2. WHEN an existing policy is already automatically applied at all declared official points THEN the system SHALL retain its behavior, add it to the enforcement matrix, and provide or verify its cooperative third-party interface without changing its domain reducer unnecessarily.
3. WHEN an existing policy is registered but not automatically applied at a declared official point THEN this feature SHALL establish a pre-action enforcement path through an official seam, a bounded facade translation, or an approved component-local replacement.
4. WHEN an existing public member is only a manual consultation method for a policy that should be automatic THEN the system SHALL NOT treat removal of that method as closure until automatic enforcement and the separate cooperative interface both have verification evidence.
5. WHEN a policy protects visibility, redaction, authorization, admission, routing, activation, tool restriction, or another domain action THEN automatic enforcement SHALL preserve that domain's own decision vocabulary, reducer, default outcome, audience, scope, and failure semantics rather than forcing all policies into an egress-shaped result.
6. WHEN a policy domain has no meaningful caller-owned path THEN the system MAY expose a capability-limited operation rather than a raw evaluator, but SHALL still provide a supported way for cooperative third-party code to follow the domain rule where such a path exists.
7. WHEN the audit finds a policy-shaped public member that is actually a projection, contribution, resource registry, or operation rather than a decision policy THEN the registry SHALL correct its semantic classification and SHALL NOT add artificial automatic enforcement.

**Classification:** Determined per inventoried member; no capability is classified solely from its name.

## Requirement 7: Policy Composition, Identity, Audit, And Observability

**User Story:** As a plugin author, I want automatic and cooperative policy decisions to remain deterministic and attributable, so that multiple plugins compose without hidden overrides.

### Acceptance Criteria

1. WHEN multiple owners register policies for one decision point THEN the system SHALL use that domain's documented composition mode, reducer, priority vocabulary where applicable, and deterministic same-priority order.
2. WHEN policy registration succeeds THEN its handle SHALL carry owner-bound identity and generation with idempotent disposal, and a stale disposer SHALL NOT remove another owner or a newer generation.
3. WHEN a decision is produced THEN the system SHALL expose bounded provenance identifying the decision point, outcome, relevant policy identities, owner attribution, observation time, and automatic or cooperative invocation channel without exposing secrets or private payloads.
4. WHEN decision audit storage is intentionally non-durable THEN availability and documentation SHALL state that fact and SHALL NOT imply cross-restart completeness.
5. WHEN an audit append fails THEN the underlying policy decision SHALL retain its declared effect, the audit projection SHALL expose a bounded gap marker, and the system SHALL NOT fabricate a record.
6. WHEN a policy callback or enforcement adapter fails THEN diagnostics SHALL attribute the failing owner or component where known and SHALL contain the failure without throwing through harness boot.
7. WHEN the caller supplies an AbortSignal to a policy-governed asynchronous operation THEN the owning path SHALL preserve and compose that signal, and a late decision or completion SHALL pass owner, generation, operation, resource, and terminal-state eligibility checks before producing a protected side effect.

**Classification:** Facade foundation; replacement slices consume these semantics but do not redefine the cross-domain reducer, priority, freeze, or callback-containment infrastructure.

## Requirement 8: Capability Presence, Coverage, And Installation Modes

**User Story:** As a plugin author, I want to know exactly which paths are automatically protected in my installation, so that partial replacement installation is not mistaken for complete enforcement.

### Acceptance Criteria

1. WHEN policy capability status is queried THEN the system SHALL distinguish policy registration availability, cooperative invocation availability, and per-path automatic enforcement coverage.
2. WHEN full installation is assembled at the locked compatible baseline THEN its coverage projection SHALL include every official path promised by the approved enforcement matrices and SHALL NOT contain duplicate or double-running owners.
3. WHEN selective installation omits an enforcement owner THEN the affected named paths SHALL report degraded or unavailable while unrelated policy registration, cooperative invocation, and protected paths remain available.
4. WHEN a main/auxiliary package `A.B.C` mismatch or runtime identity mismatch occurs THEN only the affected component enforcement slice SHALL stop claiming automatic coverage, and the installation SHALL NOT leave an official row disabled without a functioning official-contract replacement.
5. WHEN a replacement is removed THEN the official row SHALL be restored, and the corresponding automatic enforcement paths SHALL change status truthfully rather than retaining stale active coverage.
6. WHEN a third-party plugin requires a policy capability THEN capability negotiation SHALL allow it to require the registration, cooperative invocation, or named automatic coverage it actually depends on without depending on package or replacement identities.
7. WHEN coverage information is exposed THEN it SHALL use public semantic path identities and SHALL NOT expose writable internal registries, mounter keys, package names, or replacement row identities.

**Classification:** Facade self-description plus R installation/boot behavior.

## Requirement 9: Custom Event Definition

**User Story:** As a cooperative third-party plugin author, I want to define and publish my own events through a supported API, so that I do not need an unrestricted canonical event emitter.

### Acceptance Criteria

1. WHEN a plugin calls `events.define(spec)` with a valid custom event definition THEN the system SHALL return a capability-limited publisher handle for the declared custom event identity.
2. WHEN the publisher emits a declared custom event THEN the system SHALL validate and freeze the declared payload as specified, dispatch it through the custom event contract, and return the documented typed dispatch outcome.
3. WHEN a publisher attempts through the supported API to emit an undeclared event or a canonical official event THEN the system SHALL reject the operation before dispatch.
4. WHEN two normal plugins define conflicting custom event identities THEN the system SHALL apply a documented deterministic owner/key conflict rule and SHALL NOT silently replace one owner with another.
5. WHEN a publisher handle is disposed more than once THEN disposal SHALL be idempotent; WHEN a stale publisher emits after disposal, reload, or generation replacement THEN it SHALL not dispatch or remove a newer publisher.
6. WHEN caller-bound owner identity is available THEN the system SHALL derive it from the actual plugin context for attribution and lifecycle; WHERE the cooperative plugin model applies IF malicious code forges identity or bypasses the facade THEN the system SHALL treat that behavior as out of scope rather than keeping `events.define` unavailable.
7. WHEN a custom event observer fails THEN the system SHALL contain the failure according to the custom event's declared dispatch contract and SHALL NOT corrupt unrelated custom or canonical event registrations.
8. WHEN `events.define` availability is queried THEN the system SHALL report it active when the cooperative custom-event contract is usable and SHALL NOT require adversarial same-process owner isolation as an activation condition.

**Classification:** Facade-owned custom event capability; not an R replacement for Cordis dispatch and not authority to produce canonical official events.

## Requirement 10: Named Edge-Path Gaps And Threat Boundary

**User Story:** As a maintainer, I want remaining gaps to be narrow and evidenced, so that broad official capabilities are not discarded merely because one seam is difficult.

### Acceptance Criteria

1. WHEN an official path lacks an existing public decision seam THEN the system SHALL evaluate official binding, lower-level facade translation, extension of the component's existing replacement owner, and a new component-local replacement before classifying that path as a gap.
2. WHEN an official edge path remains a gap THEN its record SHALL name the exact component, trigger, protected action, missing pre-action point, failed implementation channels, observable consequence, affected installation modes, and retirement condition.
3. WHEN one path remains a gap THEN the system SHALL NOT generalize that gap to other official paths whose enforcement closure is proven.
4. WHEN a path is common, materially security- or correctness-relevant, or already owned by an approved replacement component THEN the system SHALL NOT classify it as an “edge path” solely to avoid implementation work.
5. WHEN a third-party plugin actively bypasses the facade, imports unsupported internals, forges identity, or invokes raw network/process/event primitives THEN the system SHALL treat that behavior as outside the supported guarantee and SHALL NOT introduce deployment isolation or global runtime monkey patches.
6. WHEN documentation states the final gap boundary THEN it SHALL identify cooperative third-party compliance as supported, direct third-party bypass as unsupported, and each remaining official edge-path gap individually.

**Classification:** C only after per-path evidence; direct third-party bypass is an explicit non-goal rather than an upstream proposal.

## Requirement 11: Replacement Component Integrity

**User Story:** As a maintainer, I want component-local enforcement replacements to preserve official behavior completely, so that policy enforcement does not break the runtime it protects.

### Acceptance Criteria

1. WHEN an enforcement point is added through a replacement THEN the replacement SHALL disable and replace only whole official rows through the official patch mechanism and SHALL NOT modify official package files.
2. WHEN a replacement owns an official component THEN it SHALL reproduce every ctx service, event, timing, payload, receiver, error, disposer, and client-facing contract of each replaced row before adding policy enforcement.
3. WHEN one policy feature spans several official components THEN each replacement package SHALL remain the sole owner of one official component, and the feature registry SHALL record their cross-component collaboration without creating a global replacement owner.
4. WHEN a replacement applies THEN it SHALL verify the official row is disabled, exactly one replacement row is active, runtime and package identities match, the main-facade internal enforcement contract is compatible, and no component-owner conflict exists.
5. WHEN a replacement self-check fails THEN it SHALL log a bounded diagnostic, preserve or restore a functional official-contract path as specified by the package contract, and SHALL return normally without double-running or killing boot.
6. WHEN a replaced official component has a client manifest, remote namespace, slot/settings bridge, host-client negotiation, browser state, reconnect semantics, or client-facing event/service THEN the replacement SHALL reproduce and verify the complete applicable client half.
7. WHEN an official component later provides an equivalent public pre-action policy seam THEN the replacement SHALL have a registered upstream proposal and retirement condition that allows migration back to official binding.
8. WHEN third-party code directly imports the official component package THEN the replacement SHALL NOT claim to intercept or replace that import surface.

**Classification:** R; all capability-strategy replacement constraints apply.

## Requirement 12: Repository Artifact Cleanup

**User Story:** As a maintainer, I want accidental external test ledgers removed from the repository, so that M8 leaves no unrelated generated state in source control.

### Acceptance Criteria

1. GIVEN the tracked paths `undefined\dsh-cost-meter-test-home/storages/cost-meter/ledger.json`, `undefined\dsh-cost-meter-test-legacy-home/storages/cost-meter/ledger.json`, and `undefined\dsh-cost-meter-test-mig-home/storages/cost-meter/ledger.json` WHEN cleanup executes THEN the repository SHALL delete exactly those files and their now-empty parent directories from Git and the working tree.
2. WHEN cleanup is implemented THEN the system SHALL NOT use a broad `*undefined*`, `*dsh-cost-meter-test*`, or equivalent ignore/deletion rule that could hide a recurrence or delete unrelated content.
3. WHEN the guarded full test suite completes THEN verification SHALL rescan the repository and SHALL fail if any of the three exact paths or another root-level `undefined\dsh-cost-meter-test-*` artifact has been regenerated.
4. WHEN a repository test is proven to regenerate an artifact THEN the implementation SHALL correct that test's temporary-home construction and cleanup at the actual source before declaring cleanup complete.
5. WHEN no in-repository generator is found and the guarded full suite does not regenerate the artifacts THEN the delivery SHALL record them as historical external test products introduced by M8 and SHALL NOT invent an unrelated runtime fix.

**Classification:** Repository maintenance within this feature's delivery scope; no runtime capability classification.

## Requirement 13: Storage Removal Accounting Correction

**User Story:** As a maintainer, I want `storage.open.handle.close` recorded as a replaced legacy verb rather than a capability gap, so that the conservation matrix reflects the delivered operation-handle contract.

### Acceptance Criteria

1. WHEN the canonical capability record for `storage.open.handle.close` is corrected THEN it SHALL retain the old public path as deleted and SHALL record the operation handle `dispose()` capability in `replacement`.
2. WHEN the correction is applied THEN `gapReason` for `storage.open.handle.close` SHALL be `null` and SHALL NOT imply that storage handle destruction is unavailable.
3. WHEN registry-derived capability fixtures, migration ledgers, and delivery reports are regenerated or synchronized THEN each SHALL carry the same replacement conclusion and SHALL NOT retain stale gap wording.
4. WHEN surface verification runs THEN it SHALL prove that the old `close()` path remains absent, the supported operation handle exposes the registered `dispose()` destruction contract, and no compatibility alias is introduced.

**Classification:** M8 contract-accounting maintenance; no new runtime capability.

## Requirement 14: M8 Idiom And Public API Shape Conformance

**User Story:** As a plugin author, I want this feature to follow the M8 interaction idioms already established across the facade, so that automatic enforcement does not introduce another incompatible API style.

### Acceptance Criteria

1. WHEN this feature adds or changes a public leaf or public handle leaf THEN the canonical registry SHALL assign exactly one M8 primary idiom from `projection`, `policy`, `mutation`, `operation`, `contribution`, `resourceRegistry`, `coordination`, or `selfDescription`, except for an audited `services.*` passthrough exception.
2. WHEN policy registration is exposed THEN it SHALL follow the M8 policy idiom, including `register(spec)`, a pure `decide(context)` callback where applicable, owner-bound `id` / `ownerId` / `generation`, identity-bound idempotent `dispose()`, typed registration conflicts, and automatic invocation at the declared official decision point.
3. WHEN a cooperative third-party interface is exposed THEN its actual semantics SHALL determine its idiom: pure decision registration SHALL remain policy; a one-shot effectful evaluation or protected execution SHALL use operation; a lease or shared-possession protocol SHALL use coordination; read-only decisions, history, coverage, and audit views SHALL use projection or selfDescription; the system SHALL NOT create a mixed “policy plus operation” member for convenience.
4. WHEN egress authorization uses a lease THEN its public shape SHALL follow the M8 coordination contract, including asynchronous entry operations, the registered lease fields, `release(handle)` as the give-back verb, typed discriminated conflict/unavailable outcomes, and no `dispose()` or legacy `revoke()` member on the lease handle.
5. WHEN recovery automatic consumption starts retry, fallback, or another effectful action THEN its caller-visible active operation shape SHALL follow the M8 operation idiom, while recovery policy registration and read-only decision history SHALL remain separate policy and projection members.
6. WHEN `events.define` creates a reversible custom-event producer registration THEN the definition entry and publisher lifecycle SHALL be classified according to their actual resource/contribution/operation semantics, and dispatch SHALL use the M8 operation-dispatch outcome rather than an untyped or `undefined` result.
7. WHEN a public result or handle is introduced THEN it SHALL use the M8 uniform vocabulary (`ok`, `code`, `reason`, `id`, `ownerId`, `generation`, `seq`, `observedAt`, `epoch`, `dispose()` and the registered coordination `release(handle)` exception), SHALL use the registered failure/conflict outer shape for its idiom, and SHALL NOT revive a removed legacy verb or alias.
8. WHEN capability presence or current usability is exposed THEN it SHALL use `capabilities.get/list/require`, namespace `availability()` with `active | degraded | unavailable`, and a separate `capabilityMatrix()` where applicable; a discriminated business outcome SHALL NOT embed availability or use `undefined` to mean unavailable.
9. WHEN host and client members represent the same idiom THEN their entry vocabulary, result/handle fields, failure presentation, conflict presentation, lifecycle names, and availability vocabulary SHALL align except for explicitly registered transport or domain-data differences.
10. WHEN the enforcement inventory proposes a public shape THEN registry validation SHALL reject an unregistered leaf, an invalid or omitted idiom, a mixed semantic face without a complete M8 idiom exception, a nonuniform field name, a legacy alias, or a member whose runtime shape differs from its registry contract.
11. WHEN Design selects internal adapters or replacement contracts THEN those implementation boundaries SHALL preserve the M8 public idiom shape and SHALL NOT expose component, package, replacement, mounter, or enforcement-channel identities through public paths.
12. WHEN this feature is delivered THEN the M8 member inventory, old-to-target mapping, capability matrix, generated host/client snapshots, handle inventory, types, and migration ledger SHALL be updated from the canonical registry and SHALL prove that no public API shape regression or parallel idiom was introduced.

**Classification:** Current public-contract foundation established by M8; applies to every A/B/R implementation channel and every public member added or changed by this feature.

## Requirement 15: Contract Registry, Documentation, And Delivery Report

**User Story:** As a plugin author, I want the public contract and documentation to state the same enforcement boundary as the runtime, so that I can distinguish automatic protection, cooperative compliance, and unsupported bypasses.

### Acceptance Criteria

1. WHEN this feature changes a public policy member, cooperative interface, custom event member, capability status, or replacement collaboration THEN the canonical public contract registry SHALL be updated before the change is declared delivered.
2. WHEN an enforcement matrix or policy inventory is delivered THEN the feature delivery report SHALL list every policy disposition, every automatic official path, every cooperative interface, every named edge-path gap, and the verification evidence for each.
3. WHEN egress documentation is updated THEN it SHALL state that registered policy automatically governs the listed supported official paths, cooperative third-party paths are supported when they call the public interface, and direct third-party bypass remains outside the guarantee.
4. WHEN recovery documentation is updated THEN it SHALL distinguish automatic official consumption from cooperative third-party recovery decisions and SHALL NOT describe a manual evaluator as proof of automatic consumption.
5. WHEN `events.define` documentation is updated THEN it SHALL state the cooperative ownership and canonical/custom separation guarantees and SHALL NOT claim adversarial same-process isolation.
6. WHEN a policy path is unavailable because an optional enforcement component is absent THEN public capability and availability documentation SHALL name the affected semantic path without requiring users to understand package or row identities.
7. WHEN this feature reaches Stage 4 completion THEN feature-list, applicable standards, M8 migration/delivery records, the new feature delivery report, registry-derived artifacts, and public API documentation SHALL be synchronized in the same delivery boundary.

**Classification:** Facade contract governance across all implementation channels.

## Requirement 16: Verification And Delivery Gates

**User Story:** As a maintainer, I want end-to-end evidence for automatic enforcement and cooperative invocation, so that passing registry tests cannot hide a bypassing official component.

### Acceptance Criteria

1. WHEN an official enforcement path is tested THEN the test SHALL observe the real component boundary or a contract-faithful component fixture and SHALL prove that denial occurs before the protected side effect.
2. WHEN an egress path is tested THEN evidence SHALL distinguish target normalization, policy decision, side-effect absence on deny, exact-target behavior on allow, redirect/reconnect/retry behavior where applicable, callback failure, audit, and availability.
3. WHEN a recovery path is tested THEN evidence SHALL distinguish classification, policy decision, single consumption, attempt identity, retry bounds, fallback/terminal application, cancellation, stale completion, audit, and availability.
4. WHEN a cooperative interface is tested THEN evidence SHALL prove it uses the same active policy generations and reducer as automatic enforcement while leaving caller-owned side-effect responsibility explicit.
5. WHEN `events.define` is tested THEN two synthetic plugins SHALL cover reverse registration order, identity conflict, declared publish, canonical-event rejection, observer failure containment, repeated dispose, stale publisher, reload isolation, and unrelated event preservation.
6. WHEN replacement slices are tested THEN full and selective installation SHALL cover official-contract parity, version mismatch, boot self-check, component-owner conflict, no double-run, optional absence isolation, client-half parity where applicable, removal, and official-row restoration.
7. WHEN policy inventory validation runs THEN it SHALL fail on an unregistered policy member, an undeclared official protected path, a registration with no automatic/cooperative disposition, an overbroad coverage claim, or a gap without the Requirement 10 evidence fields.
8. WHEN Stage 4 verification runs THEN it SHALL use the repository's guarded `npm test`, registry/surface consistency checks, generated-artifact checks, consumer or component integration tests, `git diff --check`, official-package modification audit, and the required global adversarial review.
9. WHEN any required test, coverage proof, consumer verification, official-contract parity check, or artifact rescan fails or cannot establish evidence THEN the feature SHALL remain incomplete and SHALL NOT convert the affected path to active or close its gap.
10. WHEN all verification succeeds THEN the Stage 4 completion commit SHALL contain the implementation, tests, registry and generated artifacts, repository cleanup, storage accounting correction, specifications, delivery report, and required registrations, and SHALL leave the working tree clean.

**Classification:** Delivery foundation covering A/B/R paths and named C edge gaps.

## Standards Applicability And Alignment

- `docs/standards/capability-strategy.md`: applicable. Requirements 1, 2, 4-6, 8, 10, and 11 require facade-first evaluation, component-local replacement ownership, official patching, contract parity, boot self-checks, runtime identity locks, upstream proposals, retirement conditions, and no official package modification. Direct third-party import/bypass remains unsupported.
- `docs/standards/api-shape.md`: applicable. Policy registration remains a pure policy registry; automatic official enforcement is the system decision point; cooperative caller use is a distinct typed operation/authorization boundary and does not create a second registry. Projection and mutation responsibilities remain separate.
- `docs/standards/public-api-shape.md`: applicable. Existing domain namespaces remain authoritative; cooperative interfaces and `events.define` attach to their semantic domains, capability identities stay public and package-neutral, and no compatibility aliases are introduced.
- `docs/standards/composition-and-authority.md`: applicable. Requirements 1-8 establish authority closure for all supported official paths, owner/generation/disposer rules, deterministic multi-owner policy composition, explicit bypasses, and the cooperative-but-buggy plugin threat model. Malicious identity forgery and active facade bypass remain excluded.
- `docs/standards/domain-composition.md`: applicable. `security` must form supported egress authority closure; `executions.recovery` must have one consumption authority; routing, admission, tool guards, visibility, redaction, and other discovered domains retain their specific reducers and owners; custom and canonical event production stay separate.
- `docs/standards/ordering.md`: applicable. Domain reducers remain primary; fixed priority and successful registration order apply only where the domain declares ordered behavior. No cross-domain dependency graph is added.
- `docs/standards/identity-and-lifecycle.md`: applicable. Policy registrations and publishers use owner-specific generation; recovery preserves execution identity across attempts; terminal outcomes remain final and unique.
- `docs/standards/durable-state-and-scope.md`: partially applicable. Recovery retry/attempt semantics and any persisted audit must declare scope and operation capability. The feature does not introduce a generic durable store or migration framework; non-durable audit must be labeled honestly.
- `docs/standards/visibility-and-redaction.md`: applicable. Policy contexts, decisions, egress targets, recovery errors, custom event payloads, diagnostics, audit, and client projections use minimum exposure; host redaction precedes client serialization; secret material never appears in audit evidence.
- `docs/standards/concurrency-and-cancellation.md`: applicable. Async official paths, retries, transports, publishers, replacement lifecycle, cancellation, stale callbacks, disposer ownership, and commit eligibility require explicit guards and domain concurrency choices.
- `docs/standards/versioning-and-protocols.md`: applicable. New/extended replacement packages and the main facade share the required `A.B.C` assembly contract; full/selective installation remains equivalent for the same selected capability set; public capability negotiation is independent of package identity. Wire or durable revisions are introduced only for real boundaries.
- `docs/standards/refactor/`: not used as a future target in this feature. M8 has already delivered the current public idiom contract into the canonical registry; this feature follows the current registry and current `docs/standards/` facts, while correcting proven M8 accounting and enforcement gaps.
