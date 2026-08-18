# Requirements: plugin-api-m3-contract

> feature_name: `plugin-api-m3-contract`
> 状态：Stage 1 requirements（无人值守授权下由协调者代行确认）
> 上游：`goal.md`；`docs/specs/plugin-api-features/feature-list.md` M3 rows；`plugin-api-m1-integration/parallel-workflow.md`
> 面：host + client bundle；本 feature 本身不新增运行时 API

## Introduction

本 feature 是 M3 的契约先行与并行编排 feature，覆盖 feature-list 中全部 11 个 M3 条目：ST4、ST5、ST6、C1、C2、C3、C4、C5、C6、C8、C9。它不实现任何 `lib/`、`test/` 或 package 代码，而是冻结每个实现 worktree 必须遵守的公共边界。

类型分类沿用仓库约定：A 类是官方已有 dispatch/service，只做稳定化；B 类是官方没有完整语义 dispatch、由底层公开 hook 或 remote 装配能力转译；C 类是本里程碑不交付的 upstream proposal。M3 11 项中 C1、C3、C4、C5、C6、C8、C9 为 A 类；ST4、ST5、ST6、C2 为 B 类。M4 的 ST7、C7 和其他 C 类提案明确不在本契约的交付范围。

## 1. Contract identity and public placement

**User Story:** As an M3 implementer, I want one identity table for every leaf, so that parallel worktrees cannot invent incompatible names or silently claim another feature's public surface.

1. WHEN the M3 contract is consumed, THEN it SHALL identify exactly these feature IDs and no others: `settingsRemote`, `clientSettingsRemote`, `clientCodec`, `clientManifest`, `clientRemoteContribution`, `clientSettingsScope`, `clientSlots`, `clientSlotEvents`, `clientRemoteEvents`, `typert`, and `clientConnection`, mapped respectively to ST4, ST5, ST6, C1, C2, C3, C4, C5, C6, C8, and C9.
2. WHEN a host-side feature is mounted, THEN its feature ID SHALL be identical to its `runFeatureGuard` branch and `FEATURE_MOUNTERS` key; the host-side public placement SHALL be `pluginApi.settings.remote` for `settingsRemote` and `pluginApi.services.typert` for `typert`.
3. WHEN a client-side feature is mounted in the browser bundle, THEN its feature ID SHALL be identical to its `runClientFeatureGuard` branch and `CLIENT_MOUNTERS` key; its public placement SHALL be `client.defineManifest`, `client.mountRemote`, `client.settingsScope`, `client.slots`, `client.remote`, `client.connection`, or `client.codec` according to the identity table in the Design.
4. WHEN C4 and C5 are composed, THEN `client.slots` SHALL remain one public namespace whose registration/read surface is owned by `clientSlots` and whose `slots/changed` event descriptor is owned only by `clientSlotEvents`; neither feature SHALL replace or erase the other's members.
5. WHEN a public name is not listed in the identity table, THEN M3 implementations SHALL NOT publish it as a new top-level `pluginApi` or `client` namespace; M4 proposal names SHALL remain unimplemented.

## 2. Parallel responsibility and repository boundaries

**User Story:** As the M3 coordinator, I want each worktree to have a mechanical file boundary, so that integration resolves additions instead of semantic rewrites.

1. WHEN worktrees are created, THEN the coordinator SHALL create them only from the committed `m3-contract` Stage 3 boundary and SHALL assign every feature to exactly one implementation owner and one integration owner.
2. WHEN an implementation worktree edits a shared file, THEN it SHALL follow the ownership table: `package.json`/`exports`/`dsh.client` has C1 owner; `lib/index.js` host mounter composition has integration owner; `lib/client.js` client mounter composition has client-foundation owner; `lib/guards.js` host guard branches has the corresponding host feature owner with append-only insertion; shared error/freeze/remote registries are frozen until integration.
3. WHEN a feature adds an event descriptor, THEN it SHALL add a feature-local descriptor/slice and SHALL NOT directly edit a composed catalog or alter shared dispatch/freeze semantics; C5's client `slots/changed` descriptor is not a host `pluginApi.events` catalog slice.
4. WHEN a worktree discovers a contract deviation, THEN it SHALL record the deviation and rationale in its own spec and delivery report before integration; an unreported deviation SHALL be rejected by pre-merge audit.
5. WHEN a task is outside the assigned feature-list row or explicitly excluded dependency, THEN the worktree SHALL leave it untouched and report the needed change as an integration issue.

## 3. C1 manifest and C8 Typert publication (A class)

**User Story:** As a client plugin author, I want package artifacts to be loaded by the official runtime with stable identity, so that browser helpers do not require hand-written loader glue.

1. WHEN a package declares a web client contribution, THEN `client.defineManifest({ platform: 'web', inject?, immediately? })` SHALL validate and return the official `dsh.client` manifest shape without changing the official loader's field names or default semantics.
2. WHEN the official module loader reads the package, THEN `exports["./client"]` SHALL resolve to the client bundle entry and SHALL be loadable through the documented `window.__ModuleLoader__.load` path; C1 SHALL NOT patch official loader files.
3. WHEN a package exports `./typert`, THEN the host loader SHALL register the artifact through the official `ctx.typert` registry using the official schema, invocation, lookup, and context identity; C8 SHALL preserve registration order, receiver, disposer, and official duplicate/error outcomes.
4. WHEN the Typert registry or loader is missing or malformed, THEN the `typert` guard SHALL fail closed for its own facade and SHALL leave unrelated M3 client features running; it SHALL NOT synthesize a replacement registry.
5. WHEN manifest or Typert loading fails during apply/boot, THEN the entry SHALL log a redacted diagnostic and return normally; it SHALL NOT throw through host or client boot.

## 4. C9 connection and API client (A class)

**User Story:** As a client plugin author, I want one connection facade, so that RPC and settings API calls preserve official transport semantics.

1. WHEN `client.connection` is active, THEN `rpc.call('/api', endpoint, { args }, signal)` SHALL forward the exact endpoint, argument object, `AbortSignal`, receiver, returned Promise, rejection, and cancellation behavior to the official connection service.
2. WHEN `client.connection` exposes `api.settings.*`, THEN each method SHALL preserve official endpoint names, argument wire shape, result identity/adoption, and error behavior; the facade SHALL not retry, serialize twice, swallow, or reinterpret failures.
3. WHEN the official connection service is unavailable, THEN the client facade SHALL expose a typed disabled surface and SHALL fail calls through the agreed P2/P3 client error path while allowing unrelated client features to mount.
4. WHEN a connection disposer runs, THEN it SHALL release only the owner registration and SHALL be idempotent and stale-safe; it SHALL not close a shared host connection owned by the official runtime.

## 5. ST4 host settings remote (B class)

**User Story:** As a host plugin author, I want a stable way to publish a settings service to the client, so that settings panels do not hand-roll Typert remote decorators.

1. WHEN `pluginApi.settings.remote(namespace, serviceKey?)` is called with a valid registered settings namespace, THEN it SHALL create the approved `TypertRemoteService`/`bindTypertRemote` publication using the official Typert remote method metadata and return one effect-scoped disposer.
2. WHEN `serviceKey` is omitted, THEN the adapter SHALL use the contract's deterministic default key; when it is supplied, the key SHALL be validated against the wire-safe key grammar and SHALL not collide with another active owner.
3. WHEN a remote method is invoked, THEN the adapter SHALL validate the namespace, service key, arguments, return value, and error boundary according to the approved Typert descriptor; invalid input or output SHALL fail before persistence or client publication.
4. WHEN the settings service, Typert remote service, or required binding primitive is absent or malformed, THEN `settingsRemote` SHALL fail closed as P2 and SHALL not monkey-patch `dsh-settings`, `dsh-typert-protocol`, or official gateway files.
5. WHEN the returned disposer runs, THEN it SHALL unbind only the exact contribution it created, SHALL be idempotent and stale-safe, and SHALL preserve other namespaces and a later replacement.
6. WHEN host apply encounters any ST4 guard, registration, or publication error, THEN it SHALL log and return normally; it SHALL never take down harness boot and SHALL leave the base settings facade available according to its existing M1 optional-service behavior.

## 6. C2/ST5 remote contribution and ST6 real codec (B class)

**User Story:** As a client plugin author, I want remote contributions to be mounted with real wire validation, so that a settings panel either receives a valid remote face or degrades predictably.

1. WHEN `client.mountRemote(contribution)` is called, THEN C2 SHALL validate the contribution's package identity and descriptor collection, invoke the official `ctx.remote.$mount` exactly once, and return the official disposer or a contract disposer with equivalent lifetime semantics.
2. WHEN a contribution declares a remote namespace or face, THEN C2 SHALL check the namespace/face against the host-published descriptor and SHALL reject a missing, duplicate, malformed, or mismatched face before UI publication.
3. WHEN ST6 generates a descriptor codec, THEN it SHALL use the client bundle's bundled zod copy to produce a real schema object accepted by `dsh-api-remotes` validation; it SHALL not use a loose predicate, forged `_zod` marker, or host-only zod instance.
4. WHEN a descriptor payload crosses the client/host wire, THEN its method name, parameter names, optionality, defaulting, return shape, error shape, and JSON-safe value domain SHALL be validated symmetrically by the generated codec; unknown or invalid fields SHALL fail closed.
5. WHEN ST5 mounts the settings-specific contribution, THEN it SHALL reuse C2's generic mount owner and ST6's codec, apply the settings face contract, and provide a visible inert/degraded UI outcome when the host remote is unavailable; it SHALL not implement native `remote.<ns>` dynamic discovery.
6. WHEN C2, ST5, or ST6 encounters a malformed descriptor, unavailable remote, duplicate mount, or client boot error, THEN it SHALL contain the failure, release its own partial registration, and keep unrelated client bundles running.
7. WHEN a remote contribution disposer runs, THEN it SHALL be idempotent, stale-safe, and limited to its own contribution; a stale disposer SHALL not unmount a later contribution with the same package/namespace identity.

## 7. C3 client settings scope (A class)

**User Story:** As a settings UI author, I want a typed client scope, so that reads, subscriptions, loads, and mutations share one connection and error contract.

1. WHEN `client.settingsScope.bind(spec)` is called, THEN it SHALL validate the namespace, codec, and required operations and return a scope with `getSnapshot`, `subscribe`, `load`, `set`, and `unset` methods.
2. WHEN `getSnapshot` or `subscribe` is used, THEN the scope SHALL return immutable snapshots and preserve official subscription ordering, cancellation, and update identity; it SHALL not mutate caller-owned values.
3. WHEN `load`, `set`, or `unset` is called, THEN the scope SHALL use `client.connection` and preserve exact wire parameter names, `AbortSignal` behavior, Promise adoption, result shape, and rejection semantics.
4. WHEN a scope loses its remote or connection, THEN active subscriptions SHALL terminate once with the contract error, pending calls SHALL reject through the typed failure path, and a later scope SHALL not inherit stale state.
5. WHEN a scope disposer runs, THEN it SHALL unsubscribe only its own listeners, be idempotent, and not cancel unrelated settings scopes.

## 8. C4 slots and C5 slot events (A class)

**User Story:** As a client UI extension author, I want typed slot registration and change observation, so that panels can compose without depending on private slot internals.

1. WHEN `client.slots.register(options, component)` is called, THEN it SHALL validate the `SlotEntryDef` fields `kind`, `scope`, `owner`, `keyProps`, `store`, and `inject` according to the agreed domain and return an effect-scoped disposer.
2. WHEN `client.slots.inject(key, callback)` is called, THEN it SHALL invoke the callback only for entries matching the canonical slot key and preserve official ordering, owner attribution, and callback disposal semantics.
3. WHEN `client.slots.entries(key)` is called, THEN it SHALL return an immutable snapshot or official read view with stable ordering and SHALL not expose a mutable internal registry.
4. WHEN `client.slots.subscribe(key, fn)` observes a change, THEN C5 SHALL dispatch `slots/changed` with the canonical slot ID, deterministic ordering, payload freeze policy, and contained listener failures defined by the client event contract.
5. WHEN a slot key is accepted, THEN it SHALL be one of the canonical IDs (`settings.*`, `sidebar.*`, `shell.overlay`, `conversation`, `details`, or a contract-approved extension); arbitrary unregistered IDs SHALL be rejected before registration.
6. WHEN a slot registration or event observer fails, THEN the owning feature SHALL roll back only its own entry/observer and SHALL preserve other slot entries, observers, and client features.

## 9. C6 client event bridge (A class)

**User Story:** As a client plugin author, I want the supported remote event bridge, so that host events can be observed and dispatched without importing gateway internals.

1. WHEN `client.remote.$on(name, listener)` is called, THEN it SHALL subscribe through the official remote event service and return an idempotent disposer preserving listener order and cancellation semantics.
2. WHEN `client.remote.$dispatch(name, payload)` is called, THEN it SHALL forward only names in the official forwarded-event allowlist and SHALL preserve payload wire shape, signal/cancellation, result/rejection, and containment semantics.
3. WHEN an event name is outside the allowlist or its payload is invalid, THEN C6 SHALL reject it before transport and SHALL not silently dispatch a private or future event.
4. WHEN the remote bridge is unavailable or a listener fails, THEN the bridge SHALL expose the agreed typed/inert client failure, contain the failure at the bridge boundary, and leave unrelated client features active.
5. WHEN the bridge disposer runs, THEN it SHALL remove only the exact subscription created by that call, be stale-safe, and not dispose the shared remote service.

## 10. Lifecycle, availability, and fail-safe behavior

**User Story:** As a plugin maintainer, I want every M3 feature to fail locally, so that one missing optional service cannot kill host or browser boot.

1. WHEN the core plugin or client runtime is inactive, THEN every M3 public surface SHALL report the standard P1 inactive-core behavior without executing feature code.
2. WHEN a mandatory feature dependency is missing, malformed, or throws during guard, THEN that feature SHALL fail closed as P2 and SHALL not publish a partially active surface; unrelated features SHALL continue.
3. WHERE a dependency is explicitly optional, IF resolution fails or returns absent, THEN the feature SHALL remain mounted with the standard P3 service-unavailable or P4 member-disabled presentation declared in the Design; it SHALL not silently omit a declared member.
4. WHEN any apply, client mount, guard, codec construction, registration, or disposer callback fails, THEN the failure SHALL be contained and redacted in diagnostics; no failure SHALL escape the host apply or client boot boundary.
5. WHEN an M3 feature is applied twice, THEN it SHALL reuse one active owner and SHALL not duplicate hooks, remote descriptors, event listeners, slots, or public facade members.
6. WHEN an older cleanup callback runs after a newer owner has replaced the same composition slot, THEN the older callback SHALL not remove or disable the newer owner.
7. WHEN a feature partially publishes and a later publication step fails, THEN it SHALL roll back its own prior publication and registrations in reverse order while preserving unrelated feature state.

## 11. Dependency order and integration acceptance

**User Story:** As an integration maintainer, I want one dependency-aware schedule and evidence gate, so that parallel M3 work can be merged without hidden ordering assumptions.

1. WHEN implementation worktrees are scheduled, THEN the dependency graph SHALL be executable in this order: `C1 → C8`; `C9 → ST6`; `C2 → ST5`; `ST4 + ST6 + C2 + C9 → ST5`; `C4 → C5`; `C3` after C9; and C6 independently after the contract boundary.
2. WHEN worktrees are derived, THEN W1 SHALL contain C1→C8; W2 SHALL run ST4, C9→ST6, and C6 in parallel; W3 SHALL run C2, C4→C5, and C3 in parallel; W4 SHALL run ST5 after W2/W3 prerequisites; W5 SHALL be the sole integration worktree.
3. WHEN the merge wave starts, THEN W5 SHALL merge in the predetermined order `C1/C8`, `ST4`, `C9/ST6`, `C6`, `C2`, `C4/C5`, `C3`, `ST5`, followed by one shared unification wave; it SHALL not merge a worktree before its prerequisite boundary is committed and audited.
4. WHEN integration completes, THEN it SHALL prove all 11 feature-list rows are covered, no M4 row or implementation is smuggled in, and no official DSH package file was modified.
5. WHEN integration validates host behavior, THEN it SHALL run focused guard/apply/service tests, repeated apply/disposal tests, typed failure tests, and the full `node --test` suite.
6. WHEN integration validates client behavior, THEN it SHALL run manifest/loader boot tests, real-zod acceptance and negative codec tests, exact wire/AbortSignal tests, remote/slot/event lifecycle tests, and an inert degraded-UI path.
7. WHEN migration acceptance runs, THEN `dsh-read-image` SHALL replace its A3/A4/A5 settings-panel hacks with ST4/ST5/ST6 and `dsh-pro-ex-ability-anchor` SHALL replace its panel bundle glue with C1/C4; each consumer SHALL pass its relevant tests, documented headless smoke, and dev boot.
8. WHEN the final M3 boundary is delivered, THEN `AGENTS.md` §8 and `feature-list.md` SHALL record the 11 delivered features and their final host/client/C classification, while C7/ST7 remain proposal/planned and no protocol version bump SHALL be made by the contract feature alone.

## 12. Explicit non-goals and upstream boundary

**User Story:** As a maintainer, I want the M3 contract closed, so that convenience pressure cannot turn an adapter into an unsupported official patch.

1. WHEN M3 is implemented, THEN it SHALL not implement C7 native `remote.<ns>` discovery, ST7 dynamic `WEB_SETTINGS_NAMESPACES`, or any other M4 proposal.
2. WHEN a requirement would require modifying an official DSH package, THEN the implementation SHALL stop at the adapter boundary and SHALL record the need as an upstream proposal; it SHALL not patch `/usr/lib/node_modules/@deepseek-ai/dsh/**`.
3. WHEN a client API is unsupported by the official allowlist, loader, or remote contract, THEN M3 SHALL expose an inert/typed failure or proposal note rather than claiming compatibility.
