# Stage 1 - Requirements

## Status

Stage 1 Requirements 已获用户批准（e8d4e3c）；Stage 2 Design 获批（8693a54），Stage 3 Tasks 获批（9f0f9d8）；Stage 4 已交付（5498aed）并合入 M6 Wave C（merge 7a1d1e9 / 12c6ce0）。

## Introduction

`plugin-diagnostics` 为插件、宿主运维者和 Web/TUI/CLI 消费者提供统一的健康与可用性投影。插件在加载时贡献结构化检查结果，消费者读取按范围组织的冻结快照并订阅变更；版本不匹配、依赖缺失、重复注册、schema 不兼容和 client/host 不可用等情况不再只能从非结构化日志推断。

本 feature 的主公开面是 `projection`。检查项贡献是 apply 生命周期内的受控 source registration：它只声明检查身份、依赖和结果更新入口，不成为一个可任意写入其他 feature 状态的 policy 或 durable mutation 面。诊断不会改变 fail-safe、卸载、重试或 profile 配置。

## Definitions and Classification

- **Diagnostic check**：有稳定 owner id 的检查贡献，描述一个能力或依赖是否可用。
- **Health**：能力当前是否按预期工作，例如 `healthy`、`degraded`、`failed`、`pending`、`unknown`。
- **Availability**：调用者现在是否可以使用该能力，例如 `active`、`degraded-active`、`inactive`、`unavailable`、`unknown`；health 与 availability 不可互相替代。
- **Scope**：`boot`、`host`、`client` 或 `plugin` 四种诊断快照范围；scope 不等同于 durable storage scope。
- **Generation**：owner-specific opaque token，用于丢弃旧检查回调和旧快照重建结果。
- **主类型**：B 类门面 projection，组合已有 feature guard、版本协商和官方公开服务；无新的官方 loader replacement。
- **Host / client**：Host 负责检查执行、权威快照和 redaction；client 只消费 host snapshot，并可报告自身 client-side availability。

## Requirements

### PD-1 Check Contribution and Ownership

**User Story:** As a plugin author, I want to contribute a named diagnostic check, so that consumers can identify exactly which capability is unhealthy.

**Acceptance Criteria:**

- **WHEN** a plugin contributes a diagnostic check **THEN** the diagnostics surface SHALL require a stable owner id, check id, scope, dependency summary, and a disposer owned by that contribution.
- **WHEN** the same owner registers the same check id again **THEN** the feature SHALL reject or replace only that owner's generation according to a deterministic rule, SHALL report the conflict, and SHALL not delete another owner's check.
- **GIVEN** a check contribution is disposed **WHEN** a late callback from that contribution arrives **THEN** the callback SHALL lose publication and mutation authority and SHALL not remove a newer generation.
- **THEN** check contribution SHALL not directly mutate profile/session/workspace durable state or register an execution/usage policy through the diagnostics surface.

Classification: B facade projection with controlled source registration. Host: required. Client: no direct check ownership.

### PD-2 Structured Diagnostic Snapshot

**User Story:** As an operator, I want a structured snapshot, so that I can answer what is unavailable, why it happened, and whether a degraded path remains usable.

**Acceptance Criteria:**

- **WHEN** a consumer requests diagnostics for a supported scope **THEN** the host SHALL return a frozen snapshot containing check identity, owner, scope, health, availability, severity, first-observed time, last-updated time, generation, dependency status, and a bounded reason/detail object.
- **WHEN** a check is pending, degraded, inactive, or unavailable **THEN** the snapshot SHALL distinguish that state from healthy/active and SHALL identify whether the condition is blocking, non-blocking, or unknown.
- **WHEN** a check has a remediation hint **THEN** the snapshot MAY include structured remediation metadata such as action id, prerequisite, and whether the action is manual or informational; it SHALL not execute the action.
- **GIVEN** a snapshot is returned **THEN** callers SHALL be unable to mutate host state by changing the returned object or nested values.

Classification: B facade projection. Host: authoritative. Client: read-only consumer.

### PD-3 Scope and Snapshot Selection

**User Story:** As a host or client operator, I want diagnostics grouped by lifecycle scope, so that a boot failure is not confused with one plugin's runtime degradation.

**Acceptance Criteria:**

- **WHEN** a caller requests `boot`, `host`, `client`, or `plugin` diagnostics **THEN** the feature SHALL return only checks applicable to that scope and SHALL identify the snapshot scope explicitly.
- **WHEN** a plugin check depends on another scope **THEN** the snapshot SHALL represent the dependency as metadata and SHALL not silently copy the dependency into a different owner or durable scope.
- **WHEN** no check exists for a requested scope or plugin **THEN** the feature SHALL return an explicit empty/unknown result rather than a successful health claim.
- **THEN** a diagnostic scope SHALL not be used as a substitute for session/workspace/profile durable storage ownership.

Classification: B facade projection. Host: required. Client: client scope is optional and explicit.

### PD-4 Health, Availability, and Version Evidence

**User Story:** As a plugin maintainer, I want version and dependency evidence attached to a diagnosis, so that a local mismatch is actionable and not mistaken for a generic failure.

**Acceptance Criteria:**

- **WHEN** a check evaluates a runtime/package/API mismatch, missing peer service, invalid schema, or duplicate owner **THEN** the report SHALL identify the failed prerequisite, observed identity/version evidence, and the affected capability.
- **WHEN** health is degraded but a fallback remains callable **THEN** availability SHALL remain `active` or `degraded-active`, and the report SHALL state the fallback boundary.
- **WHEN** a capability is unavailable for use **THEN** the report SHALL not mark it healthy merely because its plugin row loaded.
- **THEN** version evidence SHALL be bounded metadata and SHALL not include secrets, full environment dumps, or arbitrary file contents.

Classification: B facade projection using existing version guards. Host and client: both where each side has independent evidence.

### PD-5 Change Notifications and Rebuild Epochs

**User Story:** As a UI or automation consumer, I want changes delivered without polling, so that a status panel can remain current after boot, reconnect, or a local dependency change.

**Acceptance Criteria:**

- **WHEN** a committed diagnostic snapshot changes health, availability, severity, reason, or generation **THEN** the feature SHALL emit one contained change notification for the affected check/scope with the new immutable snapshot or a stable reference to it.
- **WHEN** a snapshot observer is mounted, rebuilt, or reconnected **THEN** the feature SHALL associate it with an observer epoch and SHALL discard stale rebuild results that no longer match the current owner, generation, or observer epoch.
- **WHEN** multiple equivalent source signals arrive in one update window **THEN** the feature SHALL coalesce them deterministically and SHALL not emit an unbounded notification loop.
- **WHEN** a notification listener throws or rejects **THEN** the feature SHALL contain the listener failure and SHALL continue updating other consumers.

Classification: B facade projection. Host: required. Client: consumes notifications if a supported publication path exists.

### PD-6 Visibility and Redaction

**User Story:** As an operator, I want useful explanations without exposing credentials or private payloads, so that the same diagnosis can safely serve UI, logs, debug, and model-facing tools.

**Acceptance Criteria:**

- **WHERE** no explicit visibility policy exists **THEN** model/tool output SHALL omit internal diagnostic details, UI output SHALL omit secrets, and logs SHALL contain bounded summaries only.
- **WHEN** a non-secret field is allowed for a target audience **THEN** the projection SHALL include its source, timestamp, owner, and uncertainty where applicable, while preserving denial for fields outside the policy.
- **WHEN** a check result contains a secret, token, credential, raw authorization header, or sensitive prompt/tool data **THEN** the host SHALL redact it before any snapshot, notification, log, or client publication.
- **WHEN** redaction fails or a payload cannot be classified safely **THEN** the feature SHALL publish a redacted/unavailable diagnostic and SHALL not expose the raw value.

Classification: B facade projection. Host and client: both, with audience-specific redaction.

### PD-7 Fail-Safe and Availability of the Diagnostic Plane

**User Story:** As a host operator, I want diagnostics to fail independently, so that a broken check does not kill boot or hide unrelated capabilities.

**Acceptance Criteria:**

- **WHEN** a check throws, rejects, times out, or produces an invalid result **THEN** the feature SHALL contain the failure, mark only that check as `failed`/`unavailable` or `unknown`, and SHALL keep unrelated checks readable.
- **WHEN** the diagnostics service itself cannot initialize **THEN** plugin apply SHALL return normally, the feature SHALL be inert, and the failure SHALL be observable through the existing fail-safe error path.
- **WHEN** a diagnostic consumer requests repair, retry, profile mutation, unload, or recovery **THEN** the projection SHALL reject the side effect and SHALL leave the underlying capability unchanged.
- **THEN** diagnostic failures SHALL not change execution outcomes, usage ledger entries, MCP catalog generations, or other feature-owned state.

Classification: B facade projection. Host: required. Client: inert/degraded on failure.

### PD-8 Concurrency and Cancellation

**User Story:** As a plugin maintainer, I want asynchronous health checks to settle predictably, so that cancelled probes and reconnect races cannot publish obsolete status.

**Acceptance Criteria:**

- **WHEN** a check probe receives an AbortSignal or is disposed **THEN** the owner SHALL stop initiating further work where possible and SHALL commit `aborted`/`superseded` provenance without treating cancellation as a healthy result.
- **GIVEN** a probe result arrives after its owner id, generation, or observer epoch is no longer current **THEN** the feature SHALL retain it only as stale diagnostic evidence, SHALL not publish it as current status, and SHALL not invoke a new owner's disposer.
- **WHEN** a probe fails transiently **THEN** automatic retry SHALL occur only if the check explicitly declares that operation retryable; an undeclared or permanent failure SHALL not be retried automatically.
- **WHEN** a check reaches a final diagnostic state for its generation **THEN** later signals SHALL not rewrite that generation's committed snapshot; a new generation may publish a new snapshot.

Classification: B facade projection. Host: required. Client: consumes committed status only.

## Non-Goals

- Automatic repair, unload/reload, retry/recovery orchestration, profile mutation, or policy decisions.
- A diagnostic UI component, command palette, or model prompt feature.
- Replacing an official plugin loader or adding an R class bundle.
- A universal environment dump, raw log mirror, or secret escrow.

## Requirements Coverage Summary

| Area | Covered by | Host | Client | Classification |
|---|---|---:|---:|---|
| Check ownership and registration | PD-1 | Yes | No | B |
| Structured health/availability projection | PD-2, PD-4 | Yes | Consumer | B |
| Scope selection | PD-3 | Yes | Optional | B |
| Change notifications | PD-5 | Yes | Consumer | B |
| Redaction | PD-6 | Yes | Yes | B |
| Fail-safe behavior | PD-7 | Yes | Inert on failure | B |
| Async cancellation/retry | PD-8 | Yes | Committed state only | B |
