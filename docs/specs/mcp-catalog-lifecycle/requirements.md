# Stage 1 - Requirements

## Status

Stage 1 Requirements 草案，待用户确认。

## Introduction

`mcp-catalog-lifecycle` 为 MCP server 与 tool 提供稳定的 catalog、generation 和 lifecycle 契约。本 feature 已由用户明确批准按 **R 类 replacement** 推进，唯一官方组件 owner 是 `@deepseek-ai/dsh-mcp-client`；它不是把 MCP 工具注册再包一层普通 facade，也不跨组件替换 `dsh-tools`、Cordis 或 boot 行。

当前安装的官方基线是 `@deepseek-ai/dsh-mcp-client@0.1.0-rc.6`，package identity 为 `@deepseek-ai/dsh-mcp-client`，source repository directory 为 `packages/mcp/mcp-client`。当前 host 实现已经包含部分目标语义：分页 `tools/list`、工具同步与 generation replacement、public/raw name 双名映射、DeepSeek function-name 规范化与 hash、`callTool` 的 timeout/AbortSignal、reconnect/generation、disconnect/dispose/reconnect exhaustion 时移除工具 generation，以及 `serverName` 唯一性校验。Requirements 因此要求“完整复刻官方现有 host 契约，再增加公共 catalog/lifecycle 语义”，不把这些现有行为误写成全部新建能力。

R replacement 只替换官方 row 的 **ctx 服务/事件与插件行为面**，不替换 package import 面；第三方对 `@deepseek-ai/dsh-mcp-client` 的直接 import 仍解析官方包。具体 disabled row、replacement row、runtime identity matrix 和源码组件划分留到获批 Requirements 后的 Design。

## Definitions, Evidence, and Classification

- **Server identity**：用户配置的唯一 `serverName`，是本地 MCP namespace；同一 Cordis root 下不可重复。
- **Tool identity**：`(serverName, rawName)`，raw name 只用于 MCP wire `tools/call`；model-facing public name 不可反解析替代 raw identity。
- **Generation**：某个 server connection 与其完整 tool set 的 owner-specific opaque token。新 generation 取代旧 generation 后，旧结果失去提交资格。
- **Lifecycle state**：server/tool 的 `available`、`pending`、`unavailable`、`disposed` 等资源状态；execution outcome 仍使用 `success`、`error`、`aborted`、`denied`、`superseded`，不得混用。
- **主类型**：R 类 replacement，唯一官方组件 owner 为 `@deepseek-ai/dsh-mcp-client`。扩展 catalog/lifecycle 的公开面可作为 replacement 行提供的 MCP capability slice；不跨组件。
- **Host/client evidence**：当前包文件仅包含 `lib/index.js`、`lib/invariant.js`、types 和 package metadata；无 `dsh.client` manifest、`lib/client.js`、remote、slot 或 settings bridge。

### Current Official Host Contract Baseline

The replacement requirements SHALL preserve, at minimum, the following observed contract before adding the public catalog/lifecycle surface:

| Official behavior | Current evidence |
|---|---|
| stdio and streamable HTTP transport configuration, scrubbed child environment | `lib/index.js` transport helpers |
| `serverName` validation and per-root uniqueness reservation | `lib/index.js` active server name registry |
| reconnect policy, bounded attempts/backoff, close/dispose handling | `lib/index.js` connection supervisor |
| paged `tools/list` and atomic fetch-before-swap registration | `lib/index.js` `listToolsUncached` / `syncTools` |
| public name `mcp__<server>__<raw>` with normalization and deterministic hash | `lib/index.js` `publicToolName` |
| raw name on wire `tools/call`, timeout and AbortSignal propagation | `lib/index.js` `callToolUncached` / executor |
| output schema fallback, content rendering, tool error propagation | `lib/index.js` output helpers/executor |
| old generation removal on disconnect, dispose, or reconnect exhaustion | `lib/index.js` generation supervisor |

## Requirements

### MC-1 Complete Official Contract Replication (R2)

**User Story:** As a plugin or host maintainer, I want the replacement to preserve the official MCP client behavior, so that installing the extension does not break existing MCP configurations or unsupported direct consumers.

**Acceptance Criteria:**

- **WHEN** the replacement row is loaded for a supported runtime **THEN** it SHALL preserve the official row's accepted transport/configuration shape, server name validation, uniqueness behavior, reconnect policy, startup failure option, disposal/HMR behavior, logger/error boundary, and all observed `ctx` side effects before exposing the added catalog surface.
- **WHEN** an official behavior is absent, malformed, or not provable from the locked runtime/package identity **THEN** the replacement SHALL fail its boot self-check and SHALL not silently approximate that behavior.
- **WHEN** the replacement synchronizes tools **THEN** it SHALL retain paginated `tools/list`, fetch-before-swap atomicity, public/raw name separation, schema fallback, tool result/error mapping, and `tools/call` timeout/AbortSignal behavior.
- **THEN** the replacement SHALL provide the complete ctx service/event face and lifecycle effects of every disabled official row before adding new MCP catalog/lifecycle members; no extension member may remove or change an official member's timing, payload, return, disposer, or error identity.

Classification: R. Host: required. Client: none in the current official contract.

### MC-2 Server and Tool Catalog Projection

**User Story:** As a plugin author, I want to query current MCP servers and tools, so that I can explain what is available without inspecting private client state.

**Acceptance Criteria:**

- **WHEN** a server is configured or its connection state changes **THEN** the catalog SHALL expose a read-only server record containing server identity, lifecycle state, connection generation, observed timestamps, transport kind without secrets, and availability reason/provenance.
- **WHEN** a complete tool generation is current **THEN** the catalog SHALL expose each tool's `(serverName, rawName)` identity, public name, description, input/output schema availability, generation, and provenance.
- **WHEN** a server is pending, disconnected, exhausted, disposed, or has a failed synchronization **THEN** the catalog SHALL represent the affected server/tool set as explicitly unavailable or superseded and SHALL not continue advertising an old generation as current.
- **GIVEN** a catalog view is returned **THEN** it SHALL be deeply read-only and SHALL not allow a caller to register, unregister, or mutate MCP tools through the projection.

Classification: R capability slice, with projection semantics. Host: required. Client: no current client surface.

### MC-3 Discovery, Pagination, and Change Synchronization

**User Story:** As a tool consumer, I want catalog changes to be complete and atomic, so that pagination and `list_changed` cannot expose a partial or mixed generation.

**Acceptance Criteria:**

- **WHEN** a server advertises more than one `tools/list` page **THEN** the replacement SHALL drain pagination using the protocol cursor and SHALL build the complete candidate generation before publishing it.
- **WHEN** a valid `list_changed` notification or explicit resync trigger arrives **THEN** the replacement SHALL serialize or otherwise guard synchronization per server, publish at most one current generation, and SHALL make the previous generation stale only after the candidate fetch passes validation.
- **WHEN** pagination, schema validation, or candidate registration fails **THEN** the replacement SHALL leave the last known valid generation untouched or mark the server unavailable according to the declared fail-safe path; it SHALL not publish a partial candidate set.
- **WHEN** two resyncs race **THEN** an older result SHALL fail its generation/owner guard and SHALL not dispose or unregister resources owned by the newer generation.

Classification: R capability slice. Host: required. Client: no current client surface.

### MC-4 Tool Identity, Name Resolution, and Schema Normalization

**User Story:** As a model-facing tool consumer, I want deterministic public names while preserving MCP wire identity, so that normalization cannot call the wrong server tool.

**Acceptance Criteria:**

- **WHEN** a tool is cataloged **THEN** its stable identity SHALL be `(serverName, rawName)` and its model-facing name SHALL follow the official `mcp__<serverName>__<rawName>` contract after the required character/length normalization.
- **WHEN** normalization changes or truncates a public name **THEN** the replacement SHALL append a deterministic identity-derived disambiguator and SHALL not collapse two distinct `(serverName, rawName)` identities into one public name.
- **WHEN** a tool is invoked **THEN** only the raw name associated with the current generation SHALL be sent to MCP `tools/call`; public names SHALL not be parsed heuristically to recover raw names.
- **WHEN** an advertised input or output schema is unsupported or malformed **THEN** the catalog SHALL retain the tool identity, mark schema availability/fallback explicitly, and SHALL use the official safe fallback rather than accepting an unsafe schema.

Classification: R capability slice, preserving official tool contract. Host: required. Client: no current client surface.

### MC-5 Invocation, Cancellation, and Stale Generation Guards

**User Story:** As a tool caller, I want a call to fail clearly when its server generation disappears, so that an old connection cannot publish a result as current.

**Acceptance Criteria:**

- **WHEN** a current catalog tool is called **THEN** the replacement SHALL preserve the official timeout and caller AbortSignal semantics and SHALL associate the call with the tool's server generation.
- **WHEN** the server disconnects, is disposed, or is superseded during a pending call **THEN** the call SHALL settle as an explicit unavailable/error/aborted result according to the observed cause and SHALL not publish a successful result as belonging to the new generation.
- **GIVEN** a call result, rejection, or cleanup callback arrives after its generation, owner, or replacement row is no longer current **THEN** it SHALL fail the stale-result guard and SHALL not register tools, update catalog state, invoke a newer disposer, or start an unbounded retry.
- **WHEN** a server is configured for bounded reconnect **THEN** each reconnect attempt SHALL remain within the official retry policy; an execution or tool call's external identity SHALL not be silently merged with a separate caller operation.

Classification: R capability slice. Host: required. Client: no current client surface.

### MC-6 Official Patch Assembly and Boot Self-Check (R1, R4, R9)

**User Story:** As a profile maintainer, I want installation to be reversible and auditable, so that the replacement cannot accidentally double-run with the official MCP row.

**Acceptance Criteria:**

- **WHEN** the replacement is installed **THEN** assembly SHALL use only the official patch mechanism: disable the targeted official row by id and insert one replacement row; it SHALL not modify any file under `/usr/lib/node_modules/@deepseek-ai/dsh/**`.
- **WHEN** the replacement row applies **THEN** its boot self-check SHALL verify that the targeted official row is disabled, the replacement row is active, the required official contract is available, and no competing MCP replacement owner or duplicate insertion is active.
- **WHEN** any self-check fails **THEN** the replacement SHALL log a structured fail-safe diagnostic, return normally from apply, and SHALL not run a partial replacement or allow silent official/replacement double-running.
- **THEN** replacement logic SHALL not replace `dsh-app-boot`, launcher, Cordis dispatch semantics, or other framework-level behavior outside the `dsh-mcp-client` component boundary.

Classification: R. Host: required. Client: no current client assembly.

### MC-7 Runtime Identity, Package Identity, and Unique Owner (R5, R6)

**User Story:** As a profile maintainer, I want runtime upgrades and owner conflicts to fail closed, so that catalog semantics are not guessed across incompatible MCP implementations.

**Acceptance Criteria:**

- **WHEN** the replacement is evaluated **THEN** it SHALL compare the installed runtime full identity, the locked official package identity/version, and the replacement package identity/version against its supported matrix, including prerelease components.
- **WHEN** any required identity or version does not match **THEN** only this MCP replacement capability SHALL be safely disabled or explicitly reported unavailable; unrelated main facade capabilities SHALL remain active.
- **WHEN** another replacement claims the `@deepseek-ai/dsh-mcp-client` component **THEN** the replacement SHALL detect the owner conflict and SHALL fail safe without running both replacements.
- **WHEN** the official target row remains active, a target id is missing, or a replacement id is duplicated **THEN** the replacement SHALL fail its self-check and SHALL not publish the extension catalog.

Classification: R. Host: required. Client: no current client negotiation.

### MC-8 Client-Surface Determination and Boundary (R8)

**User Story:** As a client bundle maintainer, I want the replacement's client scope decided from evidence, so that host-only behavior is not inflated into an unneeded browser bundle.

**Acceptance Criteria:**

- **WHEN** the current official package is audited **THEN** the requirements evidence SHALL record all six client checks as negative: no `dsh.client` manifest, no remote namespace, no slot or settings bridge, no host/client version negotiation, no browser-side state/reconnect surface, and no client-facing event/service.
- **WHEN** all six checks remain negative for the locked official identity **THEN** the replacement SHALL be classified host-only, SHALL not create a client bundle, and SHALL state that host reconnect is not browser-side client reconnect.
- **WHEN** a future supported official identity introduces any one of the six client capabilities **THEN** a later Design/Requirements revision SHALL re-run the six-step audit and SHALL apply R8 client build and `window.__DSH_BOOT__`/HMR verification before enabling client replacement behavior.
- **THEN** host-only classification SHALL not prevent a separate, non-R client consumer from reading a future redacted catalog snapshot through an independently approved facade feature.

Classification: R, host-only under current evidence. Host: authoritative. Client: none.

### MC-9 Upstream Proposal and Retirement Condition (R7)

**User Story:** As a runtime maintainer, I want a clear exit path from the replacement, so that the workaround can be retired when official MCP lifecycle semantics become sufficient.

**Acceptance Criteria:**

- **WHEN** the replacement enters Design/Tasks registration **THEN** the governance registry SHALL include a U-series upstream proposal covering the missing official MCP catalog/lifecycle seam and SHALL link the proposal to this replacement's supported capability slice.
- **WHEN** the official `dsh-mcp-client` component provides an equivalent public catalog/lifecycle service/event contract covering generation, list changes, availability, identity, and stale cleanup **THEN** the replacement SHALL be marked for deprecation/retirement rather than silently expanding its private contract.
- **WHEN** retirement is approved **THEN** consumers SHALL have a migration path to the official seam and the replacement SHALL stop publishing duplicate lifecycle semantics after the declared deprecation boundary.

Classification: R/upstream governance. Host: component owner. Client: not applicable under current host-only evidence.

### MC-10 Visibility, Failure Containment, and Scope Boundary

**User Story:** As an operator, I want MCP state to be diagnosable without leaking transport secrets, so that one broken server cannot kill harness boot or expose credentials.

**Acceptance Criteria:**

- **WHERE** no visibility policy exists **THEN** model-facing catalog data SHALL include only public tool identity/schema availability and bounded lifecycle reasons; UI/debug output SHALL omit transport headers, credentials, raw environment secrets, and private command arguments; logs SHALL use bounded summaries.
- **WHEN** a server, transport, schema, list response, or tool call fails **THEN** the replacement SHALL isolate the failure to that server/generation, publish an explicit unavailable/degraded state where possible, and SHALL not throw through harness boot unless the preserved official `failOnStartupError` contract explicitly requires that configured outcome.
- **WHEN** an MCP consumer requests route policy, budget decision, generic tools exposure policy, or Web UI mutation through this capability slice **THEN** the replacement SHALL reject the request as outside its component boundary and SHALL not mutate another feature's state.
- **THEN** an MCP durable record, if introduced in a later Design, SHALL declare exactly one `session`, `workspace`, or `profile` scope and SHALL use identity, owner-specific generation, commit state, and stale-result guards.

Classification: R capability slice plus shared standards boundary. Host: required. Client: no current client publication.

## R1-R9 Compliance Matrix

| `docs/standards/capability-strategy.md` rule | Requirement |
|---|---|
| R1 official patch only | MC-6 |
| R2 complete official row contract before extension | MC-1 |
| R3 import face remains official | Introduction, MC-1 |
| R4 boot self-check and fail-safe | MC-6 |
| R5 runtime/package identity lock | MC-7 |
| R6 component-level unique owner | MC-6, MC-7 |
| R7 upstream proposal and retirement | MC-9 |
| R8 client self-build if client face exists | MC-8; current result is host-only |
| R9 no boot/framework replacement | MC-6 |

## Non-Goals

- Modifying any official package file or replacing an official package import surface.
- A replacement spanning `dsh-mcp-client` and `dsh-tools`, `dsh-app-boot`, Cordis, or another official component.
- Progressive tool discovery, generic tools exposure policy, budget decisions, route/retry policy, or Web UI.
- Treating a disconnected or superseded generation as currently available.
- Assuming the current host reconnect supervisor is a browser-side client lifecycle.

## Requirements Coverage Summary

| Area | Covered by | Host | Client | Classification |
|---|---|---:|---:|---|
| Official behavior replication | MC-1 | Yes | N/A | R |
| Server/tool catalog | MC-2 | Yes | N/A | R |
| Pagination/list changes | MC-3 | Yes | N/A | R |
| Identity/name/schema | MC-4 | Yes | N/A | R |
| Calls/cancellation/stale guard | MC-5 | Yes | N/A | R |
| Patch/self-check | MC-6 | Yes | N/A | R |
| Version/owner | MC-7 | Yes | N/A | R |
| Six-step client audit | MC-8 | Host-only | No current face | R |
| Upstream retirement | MC-9 | Yes | N/A | R/C |
| Redaction/fail-safe/boundary | MC-10 | Yes | N/A | R |
