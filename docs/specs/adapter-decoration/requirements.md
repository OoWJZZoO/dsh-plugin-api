# Stage 1 - Requirements

## Status

SPEC1 Stage 1：Requirements 草案，基于已批准 Goal，等待用户确认。

## Introduction

`adapter-decoration` 为 LLM adapter 提供稳定的 decorator lifecycle。它允许插件包装真实 provider 调用，同时保留官方 adapter identity、model metadata、stream ownership、取消和卸载语义。它采用 R 类 replacement 方向，具体 `dsh-llm` row identity 与 runtime/package versions 在 Stage 2 源码审计后冻结。

## Definitions and Boundaries

- **Decoration**：绑定到一个真实 adapter identity 的 wrapper，不是第二个 provider 或 model registry。
- **Metadata overlay**：只读、可解释的能力/标签补充，与执行 transform 分离。
- **Execution transform**：围绕一次官方 operation 的受控包装；不得在本 feature 内决定 route、retry、approval 或 billing。
- **Chain**：同一 adapter 上多个 decoration 按确定性顺序组成的 wrapper 链。
- **R boundary**：只替换官方 `dsh-llm` loader 行，完整复刻原 llm ctx service/event/import 契约后增加 decoration 面。

## Requirements

### AD-R1 Official Patch Mechanism

**User Story:** As a maintainer, I want adapter decoration delivered through official patching, so that official LLM packages are never edited.

**Acceptance Criteria:**

1. WHEN the bundle is assembled THEN it SHALL disable exactly the approved `dsh-llm` row and insert exactly one replacement row.
2. WHEN the bundle is uninstalled THEN the official `dsh-llm` row SHALL be restored by the patch mechanism.
3. WHEN any implementation runs THEN it SHALL NOT modify `/usr/lib/node_modules/@deepseek-ai/dsh/**` or the official package import surface.

### AD-R2 Official LLM Contract Fidelity

**User Story:** As an existing LLM plugin, I want the replacement to preserve the official LLM contract, so that provider registration and streaming remain compatible.

**Acceptance Criteria:**

1. WHEN the replacement is active THEN it SHALL preserve the approved official `llm` service members, provider/adapter registration, model discovery, `llm/stream` and related event/teardown semantics.
2. WHEN decoration is absent or inactive THEN calls SHALL have official adapter identity, metadata, return, error and cancellation behavior.
3. WHEN a third-party module imports `@deepseek-ai/dsh-llm` THEN it SHALL resolve the official package, not the replacement implementation.

### AD-R3 Boot Self-Check and Fail-Safe

**User Story:** As an operator, I want broken or duplicate LLM replacement assembly detected at boot, so that adapter wrapping cannot silently double-run.

**Acceptance Criteria:**

1. WHEN the replacement applies THEN it SHALL verify the official row is disabled, the replacement row is active, core llm probes pass and no competing replacement owner exists.
2. WHEN a probe fails THEN the replacement SHALL record a diagnostic, return normally from apply and leave official-compatible boot behavior available where possible.
3. WHEN duplicate insertion or an undeactivated official row is detected THEN no decoration capability SHALL be published.

### AD-R4 Version and Owner Locking

**User Story:** As a maintainer, I want adapter replacement identities locked, so that wrappers never run against an untested runtime.

**Acceptance Criteria:**

1. WHEN runtime or `dsh-llm` package identity differs from the approved Design lock THEN the replacement SHALL disable itself with an explicit typed diagnostic.
2. WHEN another replacement claims the same official component THEN this replacement SHALL fail-safe and SHALL NOT guess an owner order.

### AD-R5 Decoration Registration and Identity

**User Story:** As a plugin author, I want to register a wrapper against a real adapter, so that I can add behavior without cloning provider state.

**Acceptance Criteria:**

1. WHEN `decorate({ id, match, priority, capabilities, wrap })` is registered THEN the system SHALL validate the id, match predicate, declared capabilities and wrapper contract before publication.
2. WHEN an adapter matches THEN the decoration SHALL bind to that adapter's stable owner/provider identity and an owner-specific generation.
3. WHEN no adapter matches OR the adapter is disposed THEN the system SHALL return a typed unavailable/degraded result and SHALL NOT create a synthetic adapter.
4. WHEN the same owner registers an equivalent decoration again THEN the operation SHALL be idempotent; a conflicting id/definition SHALL be rejected without merging state.

### AD-R6 Deterministic Chain and Metadata Separation

**User Story:** As a plugin author, I want multiple decorations to compose predictably, so that one wrapper cannot silently override another.

**Acceptance Criteria:**

1. WHEN multiple decorations match one adapter THEN the chain SHALL be ordered deterministically by declared priority and a documented tie-break rule.
2. WHEN a decoration contributes metadata THEN the metadata SHALL be exposed as an overlay tied to the decoration identity and SHALL NOT replace the official model registry record.
3. WHEN a decoration wraps execution THEN the wrapper SHALL receive stable adapter identity, source route, `AbortSignal` and operation context and SHALL preserve the official stream/return contract unless its declared transform explicitly changes it.
4. WHEN a wrapper throws or rejects THEN the failure SHALL be contained to that decoration/call according to its declared capability and SHALL not corrupt unrelated decorations.

### AD-R7 Reconcile, Disposer and Provider Unload

**User Story:** As a plugin author, I want decorations to follow adapter replacement and unload safely, so that stale wrappers cannot remain attached.

**Acceptance Criteria:**

1. WHEN `llm/adapters-updated` or an equivalent official update occurs THEN the system SHALL reconcile decorations against current adapter identities and generations.
2. WHEN a provider unloads or an adapter is replaced THEN decorations bound to the old identity SHALL become `superseded`/revoked and SHALL NOT attach to the new identity automatically without reconciliation.
3. WHEN a disposer runs THEN it SHALL be idempotent, identity-bound and limited to resources created by that decoration.
4. WHEN an old disposer or callback arrives after a new decoration generation is active THEN it SHALL not remove or mutate the new generation.

### AD-R8 Recursion, Route and Side-Effect Boundary

**User Story:** As a host maintainer, I want wrappers prevented from becoming hidden policy owners, so that decoration stays composable and auditable.

**Acceptance Criteria:**

1. WHEN a decoration's `match` is evaluated THEN the system SHALL prevent the decoration from matching its own synthetic/wrapped identity recursively.
2. WHEN a wrapper executes THEN it SHALL NOT select provider/model route, initiate retry/fallback, bypass approval, mutate billing records or create a second execution identity.
3. WHEN a wrapper needs retry or route behavior THEN it SHALL return explicit evidence to the existing route/recovery owner rather than performing that action itself.

### AD-R9 Cancellation, Stale Results and Retry Semantics

**User Story:** As a plugin author, I want cancellation and late provider results handled safely, so that a disposed wrapper cannot publish stale output.

**Acceptance Criteria:**

1. WHEN an operation receives an `AbortSignal` THEN the wrapper SHALL propagate the caller's cancellation semantics and SHALL not substitute a detached signal.
2. WHEN a decoration generation is superseded, disposed or its adapter identity is gone THEN late stream chunks, Promise resolutions and rejections SHALL lose submission qualification.
3. WHEN cancellation wins before terminal commit THEN the operation SHALL resolve as `aborted`; a deadline SHALL resolve as `error` with reason `timeout`; a superseded generation SHALL resolve as `superseded`.
4. WHEN retry capability is not explicitly declared THEN the decoration SHALL not automatically retry a provider operation.

### AD-R10 Visibility, Redaction and Audit

**User Story:** As a plugin maintainer, I want decoration metadata and failures exposed safely, so that diagnostics do not leak credentials or prompts.

**Acceptance Criteria:**

1. WHEN a decoration projection is produced THEN it SHALL expose only declared non-secret metadata, capability and lifecycle fields.
2. WHEN logs or audit records are emitted THEN they SHALL contain bounded summaries with owner, adapter identity, generation and timestamp, but no credentials, raw prompts or provider secrets.
3. WHEN redaction fails OR a secret field lacks explicit user/profile policy THEN the system SHALL fail closed and omit the field.

### AD-R11 Client-Half Decision

**User Story:** As a maintainer, I want the LLM replacement's client surface proven, so that browser behavior is not accidentally omitted or duplicated.

**Acceptance Criteria:**

1. WHEN the target `dsh-llm` row is audited THEN Requirements/Design SHALL record evidence for client manifest, remote namespace, slot/settings bridge, host-client version negotiation, browser state/reconnect, and client-facing event/service.
2. WHEN any check is positive THEN the replacement SHALL define and test a complete client half under R8; WHEN all six are negative THEN the feature SHALL be host-only with no client build surface.

### AD-R12 Upstream Proposal and Retirement

**User Story:** As a maintainer, I want an exit path from the replacement, so that an official decorator seam can supersede it.

**Acceptance Criteria:**

1. WHEN this feature is delivered THEN it SHALL register an upstream proposal for an official adapter decoration lifecycle.
2. WHEN the official runtime exposes equivalent identity, chain, reconcile and disposer semantics THEN consumers SHALL migrate to that seam and the replacement SHALL be marked for retirement.

## Standards Alignment

- `capability-strategy.md`: R1–R9 apply; replacement is confined to the single `dsh-llm` component; no framework/boot replacement.
- `api-shape.md`: primary face is decoration policy/lifecycle; metadata projection is read-only; wrappers do not become route/retry mutation owners.
- `identity-and-lifecycle.md`: adapter and decoration generations are owner-specific opaque tokens; terminal outcomes use the shared vocabulary.
- `durable-state-and-scope.md`: no new durable model registry; any persisted audit/reconcile record must declare one scope and retry capability.
- `visibility-and-redaction.md`: metadata and diagnostics are audience-limited; secrets and raw prompts are fail-closed.
- `concurrency-and-cancellation.md`: generation guards, cancellation propagation, stale callback rejection and identity-bound disposers are mandatory.
