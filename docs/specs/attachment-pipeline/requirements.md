# Stage 1 - Requirements

## Status

Stage 1 Requirements 已由用户确认；按用户要求暂停，不进入 Design。

## Introduction

`attachment-pipeline` 为第三方插件提供统一的附件摄取、校验、转换、投影、读取和清理契约。它把资源身份、内容完整性和 provenance 与模型 route/admission 决策分开：附件管线负责“资源是什么、哪一代、能否读取以及怎样投影”，`model-route-policy` 或 `llm` admission 负责“该请求是否接受这种 modality”。

本 feature 已获用户批准按 **R 类 replacement** 推进。唯一官方组件 owner 是 `@deepseek-ai/dsh-attachment-local`，目标 row 是 `attachment-local`。替代行必须完整保留 `@deepseek-ai/dsh-attachment` 的 `ctx.attachments` 服务契约以及 `@deepseek-ai/dsh-attachment-local` 的本地 content-addressed storage 行为，再增加 pipeline capability slice。R replacement 只替换 ctx 服务/事件面，不替换 `@deepseek-ai/dsh-attachment` 或 `@deepseek-ai/dsh-attachment-local` 的 package import 面。

当前官方 host 基线是 `@deepseek-ai/dsh-attachment@0.1.0-rc.6` 与 `@deepseek-ai/dsh-attachment-local@0.1.0-rc.6`，已提供 `AttachmentStore.imageLimits`、`validateImage`、`saveImage`、`readImage`，以及 `attachmentId = sha256:<digest>`、媒体类型、尺寸、字节数、完整性校验、AbortSignal 和 `AttachmentError` 语义。Requirements 不把这些现有行为误写成全新能力，也不把 image admission、route 选择、approval 或自动发送塞进 storage owner。

## Definitions, Evidence, and Classification

- **Source**：文件、浏览器 paste、data URI、远程资源或 MCP resource 等输入来源；来源描述不得包含凭据或完整内容。
- **Attachment identity**：owner 域内稳定的 opaque identity；文件路径、URL 或 object URL 不得单独充当 identity。
- **Attachment generation**：同一 owner 对一个 attachment 的某次不可变内容/变换版本；新 generation 取代旧 generation 后，旧结果失去提交资格。
- **Provenance**：从 source 到 ingest、transform、projection 的只读链路，包含 parent identity、operation、owner、时间和受限原因。
- **Projection**：面向明确 target route 的内容表示；projection 不改变原始附件，也不自行决定 modality admission。
- **主类型**：R replacement；唯一 owner 为 `@deepseek-ai/dsh-attachment-local`，官方 row 为 `attachment-local`。
- **当前 client 证据**：目标官方 row 没有 `dsh.client` manifest、browser bundle、remote namespace、slot、settings bridge、host/client negotiation、browser reconnect state 或 client-facing service/event；因此当前 replacement 为 host-only。浏览器 paste 是 host API 的一种输入来源，不等于官方 row 拥有 client half。

### Current Official Row Contract Baseline

The replacement requirements SHALL preserve, at minimum, the following observed contract before adding the pipeline surface:

| Official behavior | Current evidence |
|---|---|
| `ctx.attachments` service and `AttachmentStore` abstract face | `@deepseek-ai/dsh-attachment/lib/types/index.d.ts` |
| `imageLimits` and configured size/count/pixel/media-type policy | `@deepseek-ai/dsh-attachment-local/lib/index.js` |
| full image decode before validation and declared media-type match | `validateImageFile` / `detectImage` |
| content-addressed `sha256:` identity and durable atomic publication | `saveImageFile` |
| digest, metadata and reference verification on read | `readImageFile` |
| caller cancellation and typed attachment errors | `readImage(ref, signal)` and `AttachmentError` |
| `attachment-local` row placement | `dsh-base/cordis.patch.yml` |

## Requirements

### AP-1 Complete Official Attachment Contract Replication

**User Story:** As a runtime or plugin maintainer, I want the replacement to preserve the official attachment store, so that adding a pipeline does not break existing image messages or direct package consumers.

**Acceptance Criteria:**

- **WHEN** the replacement row loads for a supported runtime **THEN** it SHALL preserve the official row's configuration shape, defaults, `ctx.attachments` service availability, `imageLimits`, `validateImage`, `saveImage`, `readImage`, typed errors, cancellation, durability and disposal behavior before publishing the pipeline surface.
- **WHEN** an official image is validated, saved or read **THEN** the replacement SHALL preserve full decode admission, declared media-type matching, content-addressed `sha256:` identity, atomic publication, digest verification, metadata verification and exact AbortSignal behavior.
- **WHEN** an official behavior is absent, malformed or not provable for the locked runtime/package identity **THEN** the replacement SHALL fail its boot self-check and SHALL not silently approximate a partial attachment store.

Classification: R, covering the preserved official contract. Host: authoritative. Client: none under current evidence.

### AP-2 Source Ingestion and Stable Identity

**User Story:** As a plugin author, I want heterogeneous sources to enter one pipeline, so that session events and model requests can refer to one stable attachment rather than paths or duplicated bytes.

**Acceptance Criteria:**

- **WHEN** a supported file, paste, data URI, remote resource or MCP resource is ingested **THEN** the pipeline SHALL validate the declared source kind, record bounded source provenance, compute a content identity from verified bytes, and return an immutable attachment record with owner and generation.
- **WHEN** a source path, URL, object URL or display name changes while the verified bytes remain the same **THEN** the pipeline SHALL retain content identity and SHALL record the source change as provenance rather than minting a content identity from the path or URL.
- **WHEN** a source is untrusted, inaccessible, over the configured size/deadline/concurrency bound or has unsupported media **THEN** the pipeline SHALL return an explicit unavailable/error result and SHALL not publish an attachment record.

Classification: R capability slice. Host: required. Client: input adapter only; no client-owned durable state.

### AP-3 Validation, Trust, and Policy Bounds

**User Story:** As an operator, I want every attachment admitted under explicit limits, so that malformed or hostile content cannot enter storage or provider requests.

**Acceptance Criteria:**

- **WHEN** an attachment is admitted or transformed **THEN** the pipeline SHALL apply the configured byte, pixel/duration, media-type, source-trust, deadline and concurrency limits before publishing the resulting generation.
- **WHEN** a batch contains multiple attachments **THEN** the pipeline SHALL validate every member and the aggregate limits before committing any new batch-level publication declared by the operation.
- **WHEN** validation or trust policy rejects an attachment **THEN** the pipeline SHALL preserve a bounded rejection reason and SHALL not bypass the rejection through a transformed copy, alternate source or implicit route.

Classification: R capability slice. Host: authoritative. Client: redacted status only when explicitly projected.

### AP-4 Transform Generations and Provenance

**User Story:** As a multimodal plugin author, I want transformations to remain distinguishable from originals, so that compression or transcoding cannot silently change the meaning of an event or ledger entry.

**Acceptance Criteria:**

- **WHEN** a permitted transform completes **THEN** the pipeline SHALL create a new generation with a new verified content identity, parent identity, operation metadata and transform policy provenance.
- **WHEN** a transform fails, times out, is aborted or produces bytes that fail validation **THEN** the pipeline SHALL leave the source generation unchanged and SHALL return an explicit error/aborted result without publishing a partial generation.
- **WHEN** a caller resolves provenance **THEN** the pipeline SHALL distinguish original, derived and projected representations and SHALL not label transformed bytes as the original attachment.

Classification: R capability slice. Host: required. Client: no authoritative transform state.

### AP-5 Route Projection Without Admission or Route Ownership

**User Story:** As a request-building plugin, I want an attachment projected for a selected route, so that provider-specific content formatting is reproducible without moving model policy into storage.

**Acceptance Criteria:**

- **WHEN** a caller requests a projection for an explicit target route and current attachment generation **THEN** the pipeline SHALL return a read-only representation containing attachment identity, generation, target route identity, media metadata and projection provenance.
- **WHEN** the target route does not accept the attachment modality, or admission evidence is absent or denied **THEN** the pipeline SHALL return an explicit unavailable/denied result and SHALL not select another model/provider or bypass admission.
- **WHEN** a projection is requested without an explicit target route **THEN** the pipeline SHALL reject the request rather than infer a route, retry or send provider traffic.

Classification: R capability slice interoperating with `model-route-policy` and `llm` admission. Host: required. Client: redacted projection only if separately authorized.

### AP-6 Resolve, Open, and Stale-Generation Guards

**User Story:** As an execution owner, I want reads to remain tied to the generation I requested, so that a late read cannot publish stale or replaced content.

**Acceptance Criteria:**

- **WHEN** a caller resolves or opens an attachment **THEN** the operation SHALL require the attachment owner/generation identity, preserve the caller AbortSignal, and SHALL verify digest and metadata before returning bytes.
- **GIVEN** an open, transform or projection completes after its owner, generation, operation or target route is no longer current **WHEN** the late result attempts to publish or commit **THEN** the pipeline SHALL classify the result as `superseded` or `aborted` according to the cause and SHALL not publish current state, append a new reference or invoke a newer disposer.
- **WHEN** a caller asks for a missing, corrupt, path-changed or expired object **THEN** the pipeline SHALL return an explicit unavailable/error result and SHALL not silently read a different object with a matching display name.

Classification: R lifecycle requirement. Host: required. Client: no package-owned state.

### AP-7 Retention Cleanup and Ownership

**User Story:** As a storage maintainer, I want cleanup to be bounded and ownership-aware, so that expired derived data is removed without deleting content still referenced by a newer generation.

**Acceptance Criteria:**

- **WHEN** a caller requests retention cleanup **THEN** the pipeline SHALL require an owner-scoped cleanup operation with an explicit retention reason and SHALL remove only resources it can prove belong to that operation or expired generation.
- **WHEN** cleanup races with an open, transform, projection or new owner generation **THEN** the cleanup SHALL yield to a current ownership/reference guard and SHALL not delete resources needed by the current generation.
- **WHEN** cleanup is repeated or its disposer runs after replacement **THEN** cleanup SHALL be idempotent and SHALL not remove state owned by a newer owner or generation.
- **WHEN** the pipeline persists provenance, retention or lifecycle metadata **THEN** each record SHALL belong to exactly one `session`, `workspace` or `profile` scope and SHALL not combine multiple scope authorities in one durable record.
- **WHEN** content or transform caches deduplicate identical bytes **THEN** cache access SHALL still enforce the requesting session/workspace/profile authority and SHALL not expose another scope's source metadata or private provenance.

Classification: R durable/lifecycle capability. Host: authoritative. Client: none.

### AP-8 Official Patch Assembly, Self-Check, and Fail-Safe

**User Story:** As a profile maintainer, I want attachment replacement activation to be auditable, so that official and replacement stores never run silently together.

**Acceptance Criteria:**

- **WHEN** the replacement is installed **THEN** assembly SHALL use only the official patch mechanism to disable `attachment-local` and insert exactly one replacement row, and SHALL not modify any official package file.
- **WHEN** the replacement applies **THEN** its boot self-check SHALL verify that the official row is disabled, the replacement row is active, the `ctx.attachments` contract is complete, the locked package identities are present, and no competing replacement owner or duplicate insertion exists.
- **WHEN** activation, identity or contract validation fails **THEN** the replacement SHALL emit a bounded fail-safe diagnostic, return normally from `apply`, and SHALL not publish a partial attachment store or pipeline surface.
- **WHEN** the replacement is active **THEN** it SHALL not replace `dsh-app-boot`, launcher, Cordis dispatch, `dsh-attachment` package exports, `dsh-llm`, `dsh-agent-loop`, settings infrastructure or another official component.

Classification: R, covering R1, R4, R6 and R9. Host: required. Client: none.

### AP-9 Runtime Identity, Import Boundary, and Version Isolation

**User Story:** As a runtime maintainer, I want incompatible attachment replacements to fail closed, so that storage semantics are never guessed across upgrades.

**Acceptance Criteria:**

- **WHEN** the replacement is evaluated **THEN** it SHALL compare runtime full identity, `@deepseek-ai/dsh-attachment` identity, `@deepseek-ai/dsh-attachment-local` identity, main facade version and replacement version against an exact supported matrix including prerelease components.
- **WHEN** any required identity or version mismatches **THEN** only this replacement and its pipeline capability SHALL be unavailable; the main facade and unrelated features SHALL remain active.
- **WHEN** a consumer imports `@deepseek-ai/dsh-attachment` or `@deepseek-ai/dsh-attachment-local` **THEN** module resolution SHALL continue to return the official package exports; the replacement SHALL cover only the loader row's plugin behavior and ctx service/event face.
- **WHEN** another package claims the `@deepseek-ai/dsh-attachment-local` component owner **THEN** the replacement SHALL detect the conflict and SHALL fail safe without running both replacements.

Classification: R, covering R3, R5 and R6. Host: required. Client: no current version-negotiation face.

### AP-10 Client Audit, Visibility, Upstream Exit, and Scope Boundary

**User Story:** As a maintainer, I want the replacement's client and governance boundaries explicit, so that a host storage workaround does not grow into an accidental browser or policy fork.

**Acceptance Criteria:**

- **WHEN** the locked official identity is audited **THEN** the evidence SHALL record all six client checks as negative: no `dsh.client` manifest, no remote namespace, no slot/settings bridge, no host/client version negotiation, no browser reconnect state, and no client-facing event/service.
- **WHEN** the replacement enters Design/Tasks registration **THEN** governance SHALL register a U-series proposal for an official attachment pipeline seam with an explicit retirement condition.
- **WHEN** the official attachment component provides an equivalent public pipeline contract covering identity, transforms, projection provenance, cancellation and cleanup **THEN** the replacement SHALL enter deprecation/retirement rather than maintain duplicate semantics indefinitely.
- **WHERE** no visibility policy exists **THEN** model-visible data SHALL contain only approved non-secret attachment identity/media/provenance summaries, UI/debug output SHALL omit paths, URLs, credentials and raw bytes, and logs SHALL use bounded reasons.
- **WHEN** a caller requests modality admission, model selection, provider billing, retry, approval bypass, arbitrary path access or cross-component replacement through this capability slice **THEN** the pipeline SHALL reject it as outside the attachment boundary.

Classification: R/upstream governance plus shared visibility rules. Host: authoritative. Client: no current client publication.

## R1-R9 Compliance Matrix

| `docs/standards/capability-strategy.md` rule | Requirement |
|---|---|
| R1 official patch only | AP-8 |
| R2 complete official row contract before extension | AP-1 |
| R3 import face remains official | Introduction, AP-9 |
| R4 boot self-check and fail-safe | AP-8 |
| R5 runtime/package identity lock | AP-9 |
| R6 component-level unique owner | AP-8, AP-9 |
| R7 upstream proposal and retirement | AP-10 |
| R8 client capability preservation | AP-10; current audit is host-only |
| R9 no boot/framework replacement | AP-8 |

## Non-Goals

- Modifying official package files or replacing official package import surfaces.
- A replacement spanning `dsh-attachment-local`, `dsh-attachment`, `dsh-llm`, `dsh-agent-loop`, `dsh-api-gateway`, boot or Cordis.
- Model/provider route selection, modality admission, approval, retry, billing or automatic sending.
- Arbitrary filesystem or network access, path-based identity, or treating transformed bytes as original bytes.
- Durable workspace transactions, leases, checkpoint restore or UI components.
- A browser bundle or client reconnect protocol for the current official attachment row.

## Requirements Coverage Summary

| Area | Covered by | Host | Client | Classification |
|---|---|---:|---:|---|
| Official attachment store | AP-1 | Yes | N/A | R |
| Ingest and identity | AP-2 | Yes | Adapter only | R |
| Validation and trust | AP-3 | Yes | Redacted status | R |
| Transform/provenance | AP-4 | Yes | No | R |
| Route projection boundary | AP-5 | Yes | Optional projection | R |
| Open/cancellation/stale guard | AP-6 | Yes | No | R |
| Cleanup ownership | AP-7 | Yes | No | R |
| Patch/self-check/version | AP-8, AP-9 | Yes | No | R |
| Client audit/governance/redaction | AP-10 | Yes | No current face | R/C |
