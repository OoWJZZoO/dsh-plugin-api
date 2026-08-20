# Design: plugin-api-official-passthrough-m4

> feature_name: `plugin-api-official-passthrough-m4`
> stage: 2 (Design)
> status: draft; pending adversarial review and user confirmation
> baseline: `2c2da4b`

## Overview

本 feature 将 M4 feature-list 中的全部 63 个范围 ID 接入现有 `pluginApi` host/client 双面门面，或为已经 delivered 的条目补足精确回归证据。M4 的实现形态是官方公开 service、公开构造工件和官方 dispatch 的稳定透传，不引入新的 B 类模拟、新 R 类替代包、C 类 proposal 或官方包修改。

最终集成的成功边界只有一个：M4 feature-list 中列出的全部 feature 均有明确 owner、实现或 delivered 回归证据，并且没有遗漏。已批准 Requirements 中的 L12、A13 scope correction 是本设计的正式输入：L12 只暴露 `contentHasImage`、`createUserMessage`、`BlockAssembler`；A13 只暴露 `provider`、`model`、`maxTokens`。

### Design principles

1. **官方 contract first**：先从 feature-list 登记的公开 service/type/event contract 建立静态白名单，再绑定运行时对象；不通过私有模块变量、concrete provider 私有成员或同包偶然导出扩大范围。
2. **Identity-preserving passthrough**：方法调用保留参数、receiver、返回值、Promise、disposer、同步/异步时序和异常 identity。只有 A13 的只读快照、事件 catalog 元数据和既有 guard 明确要求的冻结行为可以构造新对象。
3. **Local degradation**：缺失或 malformed 的单个 namespace member、service、event slice 或 client leaf 只影响自己的 owner。根 facade 仍按既有 P1 语义运行；feature 或 service 级失败分别使用 P2/P3/P4。
4. **Central semantics are single-owner**：event bus/freeze/schema、facade composition、mount order、catalog cardinality 和最终 feature-list reconciliation 不由并行 leaf worktree 修改。
5. **No implicit integration**：并行分支必须从已提交 baseline 派生，按声明的 write set 交付；每个 batch 先通过 focused tests 和 blocking adversarial review，才进入 join point。

### Classification and mechanisms

| 范围 | 类别 | 引出机制 | 本 feature 行为 |
|---|---|---|---|
| L11/L12, A12/A13, S7/S8, T11/T12/T13, P9, ST9 | A | 官方 service/public export/official event 直接透传 | 加入现有 host namespace 或现有 event facade；不做底层重入模拟 |
| P10 | A | 现有官方 `system-prompt/assemble` waterfall 经共同 event-bus/freeze 语义适配 | 由 W2 integration 集中修改共享语义；不属于 host namespace leaf 或 O17-O20 producer slice |
| O17-O20 | A | catalog-only metadata slices declare the official producer; the existing events bus registers the consumer's wrapped `ctx.on` hook | 不创建 producer-side `ctx.on`、bridge listener、re-emission、replay 或 synthetic producer；不改写 payload |
| SV19/SV20 | A, delivered | 现有静态 service definition 和 facade | 只做 exact member、negative boundary、局部降级回归 |
| SV21-SV48 | A | `ctx.get()` 解析官方 service，静态 definition 生成 frozen facade | 每个 service 独立 P4；只暴露定义表成员 |
| C10-C20 | A | client bundle 中对官方 `ctx.provide`/`ctx.reflect.provide` service 做 leaf-scoped publication | 每个 client leaf 独立 guard、发布和 stale-disposer 防护 |
| C21-C24 | A | client 官方事件源直接订阅并接入现有 client event surface | 保留名称、顺序、payload identity 和 listener lifecycle |
| C25 | A | 官方 `connection.api.llm` 读面直接挂载 | 保留 RPC 参数、signal、返回和错误语义 |
| RB1 | B, delivered | 既有 Typert remote owner | 只回归验证；不重做、不改名 |

## Architecture

### Runtime layers

```text
official DSH public services / exports / event producers
                     |
        static contract definitions + member probes
                     |
       host leaf facades / event catalog slices
                     |
     PluginApiService stable namespace composition
                     |
          pluginApi consumer-facing API

official client providers / connection API / client events
                     |
       client leaf adapters and guarded publication
                     |
            pluginApi.client public surface
```

The existing M0-M3 lifecycle remains the outer transaction:

1. host `apply()` establishes core guards and the reusable `pluginApi` service;
2. feature guards probe the official dependency and prepare a leaf;
3. the leaf is mounted only after its cleanup registration is accepted;
4. `featureRegistry` records the committed leaf exactly once;
5. cleanup invalidates the leaf before fallible native disposal, so retained references fail locally;
6. client apply follows the same per-leaf publication and identity-safe disposal rules already used by the client bundle.

M4 does not change the relative order of the existing M0-M3 mounters. The integration owner inserts M4 leaves into the existing positions below and records the same order in `tasks.md` and the delivery report. P10 is the one shared semantic exception: its implementation is owned by W2 integration because it changes the common event-bus freeze boundary.

### Host composition

The host side has four independent composition planes:

| Plane | Owner | Composition rule |
|---|---|---|
| Core namespaces | host namespace batch + integration owner | Extend `llm`, `agent`, `session`, `tools`, `systemPrompt`, `settings` only with approved M4 members. Preserve existing object shape and disabled surfaces. P10 is excluded from this leaf batch. |
| Host event catalog | host event batch + integration owner | Add five catalog-only producer slices for O17-O20. Compose through the existing fail-loud `composeCatalogs`; omit only the slice whose official producer guard fails. The existing events bus remains the sole native subscription owner. |
| Service seams | W1 host-services leaf + W2 integration | W1 creates only a disjoint neutral definition fragment and focused tests. W2 exclusively updates `lib/services.js` and the central definition tests, removes legacy metadata, imports the fragment, and constructs every service independently with the existing method/getter/forward machinery and P4 fallback. |
| Shared event semantics | integration owner | Update the common waterfall freeze path and the system-prompt catalog so P10 preserves official writable assembly semantics without changing unrelated event policies. |
| Delivered remote | integration owner | Keep the current `remote` owner untouched except for regression assertions and traceability. |

The root `PluginApiService` remains service-lifetime stable. Namespace getters may return a newly composed frozen view when an epoch is replaced, but an old leaf token or old facade method must never regain access after cleanup. All M4 additions use the existing `mountFeature`, `prepareFeature`, `unmountFeature`, and feature registry mechanisms rather than introducing a second lifecycle protocol.

The existing host mount order remains the ordering contract for integration:

```text
tools -> events -> agent -> llm -> llm/request -> llm/admission
      -> session -> sessionDurable -> execRoute -> sessionRoute
      -> settings -> systemPrompt -> services -> typert
      -> settingsRemote -> remote
```

M4 leaves are inserted into these existing owners without reordering M0-M3 mounts. P10 is wired through the existing `events` owner after the shared waterfall policy is updated; it does not create a new mount point.

### Client composition

The client bundle is split into leaf adapters, but has one integration owner for the outer bundle and central client facade. The join points and order are:

```text
clientManifest
  -> clientConnection
  -> clientCodec
  -> clientOfficialServices
  -> clientRemoteContribution
  -> clientSettingsRemote
  -> clientSettingsScope
  -> clientSlots
  -> clientSlotEvents
  -> clientRemoteEvents
```

`clientOfficialServices` publishes the C10-C20 leaves in this fixed order:

```text
modules -> locale -> sessions -> workspaces -> chatFileMentions
        -> layout -> theme -> appShell -> sessionLogDownload
        -> cordisInspect -> dynamicCordisRunner
```

The client batch owns leaf publication and official event wiring, while W2 integration owns the `clientOfficialServices` join point, central client facade/index changes, and the final mount-order assertions. Each leaf follows this sequence:

```text
probe official provider
  -> build exact member/event adapter
  -> publish leaf with owner token
  -> expose feature status
  -> stale-safe disposer
```

The leaf adapter does not clone service objects or expose a generic proxy. It creates a frozen outward facade containing only the approved member list. Methods call the official receiver directly. Getters read the official value at the declared point of access. If a cleanup handle is returned by the official client service, it is returned without wrapping.

`client.connection.api.llm` is a nested public read face, not a new RPC implementation. The adapter resolves the official connection service once per invocation according to the existing connection lifecycle contract, then delegates `providers`, `models`, and `discoverModels` with the original payload and optional signal.

Client events are registered against the official event source once per active epoch. A listener disposer is scoped to the owning leaf. A stale disposer checks its owner token before removing a registration, so a delayed cleanup cannot remove a newer registration from a reapply.

## Components and Interfaces

### 1. Host namespace extensions

The host namespace batch owns the following approved public members. It must use existing disabled-surface conventions and must not alter unrelated M0-M3 methods.

| Namespace | M4 members | Contract decision |
|---|---|---|
| `pluginApi.llm` | `listProviders`, `listConfigurableProviders`, `discoverModels`, `providerRetryPolicy`, `listModels`, `resolveCallConfig`, `contentHasImage`, `createUserMessage`, `BlockAssembler` | Runtime methods and exported artifacts are direct official references. Missing member disables the affected LLM extension only. |
| `pluginApi.agent` | `currentInitiator`, `requireInitiator`, `withInitiator`, `withoutInitiator`, `isOwnedBy`, `options` | Initiator methods preserve official receiver and callback semantics. `options` is a frozen exact-key snapshot of `provider`, `model`, `maxTokens`; it does not expose the live Agent or registry. |
| `pluginApi.session` | `create`, `prepare`, `enter`, `announce`, `flush`, `append`, `deriveEventMessage` | Store methods delegate to `ctx.sessions`; `deriveEventMessage` delegates to the official public session export/instance method. No synthetic event or projection layer is added. |
| `pluginApi.tools` | `toolAbortedError`, `executionMode`, `defineTool` | `toolAbortedError` retains the delivered factory and fallback. The two new methods delegate official public service/package behavior without reimplementing execution. |
| `pluginApi.systemPrompt` | `assemble` | `assemble` delegates the official service. P10's event participation is wired by the shared event-semantics integration owner, not by this namespace leaf. |
| `pluginApi.settings` | `writable`, `prepareDocument`, `get`, `update`, `replace`, `mutate` | Settings scope methods delegate the official `SettingsScope` receiver and preserve document/update semantics. |

The `T11`, `RB1`, `SV19`, and `SV20` surfaces remain named and owned exactly as delivered. Their tests are part of the M4 integration batch but no new implementation owner is created for them.

### 2. Host event catalog

The host event batch contributes five independent static, catalog-only slices. The table below is design-time traceability; only the fields listed in `CatalogEntry` below are runtime data.

| Producer slice | Feature-list IDs | Event | Mode | Scope | Payload | Args | Fault | Freeze | Producer binding |
|---|---|---|---|---|---|---|---|---|---|
| `agentLoopConfigStartFailed` | O17 | `agent-loop/config-start-failed` | `emit` | `scopeFiltered: false`; `scopeKey: undefined` | `{ sessionId, error }` | `(payload)` | `contain` | `all` | official agent-loop event |
| `agentPresetSelected` | O17 | `agent-preset/selected` | `emit` | `scopeFiltered: false`; `scopeKey: undefined` | `sessionId`; `agentPreset` | `(sessionId, agentPreset)` | `contain` | `all` | official agent-preset event |
| `cordisDynamicLifecycle` | O18 | `cordis/dynamic-package`; `cordis/dynamic-retract`; `cordis/request-run`; `cordis/request-run-resolved` | `emit` | `scopeFiltered: false`; `scopeKey: undefined` | `DynamicCordisPackage`; `DynamicCordisRetracted`; `DynamicCordisRunRequest`; `DynamicCordisRequestResolved` | `(pkg)`; `(retracted)`; `(request)`; `(resolved)` | `contain` | `all` | official dynamic Cordis producer |
| `cordisInspectLifecycle` | O19 | `cordis/inspect-query`; `cordis/inspect-query-resolved` | `emit` | `scopeFiltered: false`; `scopeKey: undefined` | `CordisInspectQueryRequest`; `CordisInspectQueryResolved` | `(request)`; `(resolved)` | `contain` | `all` | official inspect producer |
| `storageDomainChanged` | O20 | `domain/changed` | `emit` | `scopeFiltered: false`; `scopeKey: undefined` | `DomainChanged` | `(change)` | `contain` | `all` | official storage-domain producer |

Each producer slice contains only the static names and metadata for an official producer, plus the guard that decides whether the slice is active. It does not install a bridge listener, re-emit an event, poll, synthesize, or replay a payload. When a slice guard passes, the existing events bus is the sole consumer-subscription owner: `pluginApi.events.on(name, listener)` registers the wrapped native `ctx.on(name, ...)` hook, and the bus owns its epoch cleanup and stale-disposer protection. A missing or malformed producer omits or leaves inert only that slice; it never causes an M4 bridge/native registration for that producer, while the other four slices and all existing catalog slices remain active. Within a slice, duplicate event names are rejected during composition. The `contain` policy isolates observer failures from the official producer, while `freeze: 'all'` retains the existing read-only treatment for these observer-style `emit` events.

The integration owner asserts the exact nine event names and the exact runtime field set. A focused integration test dispatches one official `ctx.emit` and verifies that one facade listener receives one delivery, proving there is no duplicate bridge delivery. Additional tests cover native-hook disposal after epoch cleanup and slice omission/inert behavior when the official producer is unavailable. Feature-list IDs and class labels are documentation-only traceability and never appear in runtime catalog objects, event names, error messages, or test fixtures.

### 2.1 P10 writable waterfall contract

P10 is a shared event-bus semantic change owned by W2 integration. It is explicitly excluded from both W1 host-namespaces and W1 host-events. The official `dsh-system-prompt` implementation invokes `system-prompt/assemble` as a cooperative waterfall and treats the returned assembly as authoritative.

The integration owner shall make the following sequence explicit:

1. `events-bus.js` identifies a trailing `next` function before applying any argument freeze policy.
2. The `system-prompt/assemble` catalog entry declares `fault: 'propagate'` and the dedicated `freeze: 'waterfall'` policy. The policy leaves the runtime `assembly` and `context` argument graphs unfrozen for the listener chain; it does not alter their identity or clone them.
3. For a non-`monitor` listener, `fault: 'propagate'` means a synchronous throw before `next()`, a rejection returned by `next()`, or a synchronous throw or rejected Promise after `await next()` reaches the official waterfall unchanged. These dispatch-time failures are not activation or cleanup failures and are never caught by the facade safe logger. The existing `monitor` priority remains observer-only: its own failures are contained and it continues the chain without becoming the waterfall result owner.
4. `assembly.sections`, `assembly.contexts`, `assembly.tools`, and `assembly.variables` are the only approved writable top-level fields. A listener may mutate their permitted nested arrays/records or replace the field value before or after `await next()`. The listener may also return a replacement `PromptAssembly`, as required by the official contract.
5. `context.scope` retains the original scope object identity and remains the value used for scope filtering. `context.signal` retains the original `AbortSignal` identity; it is neither deep-frozen nor replaced by the bus. The context object is not frozen by the bus.
6. Catalog metadata, the frozen catalog object itself, listener registration records, priority/order state, and disposer ownership remain protected. No other event changes its freeze behavior.

The shared implementation therefore updates `lib/events-bus.js`, `lib/deep-freeze.js`, and `lib/system-prompt-events-catalog.js` in one integration-owned change. Focused tests must cover mutation and replacement of all four assembly fields both before and after `await next()`, exact scope/signal identity, return-value authority, propagation of a normal listener failure both before and after `await next()`, monitor containment, and unchanged freeze behavior for existing events.

### 3. Host service seam definitions

The W1 host-services batch creates a disjoint neutral definition fragment containing the following exact keys and members. W1 does not edit the existing `lib/services.js` definition table or `test/services-definitions.test.mjs`. W2 is the exclusive owner of both files at integration time: it imports the fragment, removes `pkg` from every old and new runtime definition, and updates the central tests to assert that every definition has exactly the keys `{ key, ctxService, members }`. `pkg` is not runtime contract data and is not replaced by another package field. All entries use the existing definition kinds: `method`, `getter`, or `forward` where a public helper is explicitly registered. No concrete provider member is inferred. The table below is the complete SV21-SV48 contract, including the official service key, the facade key, the member kind, optionality, and the source boundary used to resolve it.

| ID | Facade key | `ctxService` | Member | Kind | Optional | Official source boundary |
|---|---|---|---|---|---|---|
| SV21 | `agentLoop` | `agentLoop` | `config` | getter | no | generated `SERVICE_API` readonly member |
| SV21 | `agentLoop` | `agentLoop` | `create` | method | no | generated `SERVICE_API` method |
| SV21 | `agentLoop` | `agentLoop` | `createAgent` | method | no | generated `SERVICE_API` method |
| SV21 | `agentLoop` | `agentLoop` | `resume` | method | no | generated `SERVICE_API` method |
| SV22 | `agentPresets` | `agentPresets` | `list` | method | no | generated `SERVICE_API` method |
| SV22 | `agentPresets` | `agentPresets` | `resolve` | method | no | generated `SERVICE_API` method |
| SV22 | `agentPresets` | `agentPresets` | `mount` | method | no | generated `SERVICE_API` method |
| SV22 | `agentPresets` | `agentPresets` | `composeFrom` | method | no | generated `SERVICE_API` method |
| SV22 | `agentPresets` | `agentPresets` | `composedPreset` | method | no | generated `SERVICE_API` method |
| SV22 | `agentPresets` | `agentPresets` | `read` | method | no | generated `SERVICE_API` method |
| SV22 | `agentPresets` | `agentPresets` | `copy` | method | no | generated `SERVICE_API` method |
| SV22 | `agentPresets` | `agentPresets` | `remove` | method | no | generated `SERVICE_API` method |
| SV22 | `agentPresets` | `agentPresets` | `serviceFor` | method | no | generated `SERVICE_API` method |
| SV22 | `agentPresets` | `agentPresets` | `recompose` | method | no | generated `SERVICE_API` method |
| SV22 | `agentPresets` | `agentPresets` | `standingKeyFor` | method | no | generated `SERVICE_API` method |
| SV23 | `apiProxy` | `apiProxy` | `downloads` | getter | no | generated `SERVICE_API` readonly service face |
| SV23 | `apiProxy` | `apiProxy` | `respond` | method | no | generated `SERVICE_API` method |
| SV24 | `clientModules` | `clientModules` | `graph` | method | no | generated `SERVICE_API` method |
| SV24 | `clientModules` | `clientModules` | `clientPath` | method | no | generated `SERVICE_API` method |
| SV24 | `clientModules` | `clientModules` | `rebuilt` | method | no | generated `SERVICE_API` method |
| SV24 | `clientModules` | `clientModules` | `onRebuilt` | method | no | generated `SERVICE_API` method |
| SV24 | `clientModules` | `clientModules` | `onGraphChanged` | method | no | generated `SERVICE_API` method |
| SV25 | `commands` | `commands` | `register` | method | no | generated `SERVICE_API` method |
| SV25 | `commands` | `commands` | `list` | method | no | generated `SERVICE_API` method |
| SV25 | `commands` | `commands` | `find` | method | no | generated `SERVICE_API` method |
| SV25 | `commands` | `commands` | `execute` | method | no | generated `SERVICE_API` method |
| SV26 | `credentials` | `credentials` | `resolve` | method | no | generated `SERVICE_API` method |
| SV26 | `credentials` | `credentials` | `describe` | method | no | generated `SERVICE_API` method |
| SV26 | `credentials` | `credentials` | `set` | method | no | generated `SERVICE_API` method |
| SV26 | `credentials` | `credentials` | `unset` | method | no | generated `SERVICE_API` method |
| SV27 | `directoryPicker` | `directoryPicker` | `capability` | method | no | generated `SERVICE_API` method |
| SV28 | `e2b` | `e2b` | `cwd` | getter | no | generated `SERVICE_API` readonly member |
| SV28 | `e2b` | `e2b` | `runtimeRoot` | getter | no | generated `SERVICE_API` readonly member |
| SV28 | `e2b` | `e2b` | `getSandbox` | method | no | generated `SERVICE_API` method |
| SV29 | `goals` | `goals` | `get` | method | no | generated `SERVICE_API` method |
| SV29 | `goals` | `goals` | `disarm` | method | no | generated `SERVICE_API` method |
| SV29 | `goals` | `goals` | `create` | method | no | generated `SERVICE_API` method |
| SV29 | `goals` | `goals` | `edit` | method | no | generated `SERVICE_API` method |
| SV29 | `goals` | `goals` | `pause` | method | no | generated `SERVICE_API` method |
| SV29 | `goals` | `goals` | `resume` | method | no | generated `SERVICE_API` method |
| SV29 | `goals` | `goals` | `complete` | method | no | generated `SERVICE_API` method |
| SV29 | `goals` | `goals` | `block` | method | no | generated `SERVICE_API` method |
| SV29 | `goals` | `goals` | `clear` | method | no | generated `SERVICE_API` method |
| SV29 | `goals` | `goals` | `remoteExportCreate` | method | no | generated `SERVICE_API` method |
| SV30 | `invariants` | `invariants` | `register` | method | no | generated `SERVICE_API` method |
| SV31 | `lsp` | `lsp` | `registerProvider` | method | no | generated `SERVICE_API` method |
| SV31 | `lsp` | `lsp` | `query` | method | no | generated `SERVICE_API` method |
| SV32 | `messageFeedback` | `messageFeedback` | `list` | method | no | generated `SERVICE_API` method |
| SV32 | `messageFeedback` | `messageFeedback` | `put` | method | no | generated `SERVICE_API` method |
| SV32 | `messageFeedback` | `messageFeedback` | `delete` | method | no | generated `SERVICE_API` method |
| SV33 | `permissionPresets` | `permissionPresets` | `current` | method | no | generated `SERVICE_API` method |
| SV33 | `permissionPresets` | `permissionPresets` | `selectFor` | method | no | generated `SERVICE_API` method |
| SV33 | `permissionPresets` | `permissionPresets` | `resolve` | method | no | generated `SERVICE_API` method |
| SV33 | `permissionPresets` | `permissionPresets` | `optionOf` | method | no | generated `SERVICE_API` method |
| SV33 | `permissionPresets` | `permissionPresets` | `set` | method | no | generated `SERVICE_API` method |
| SV34 | `planMode` | `planMode` | `get` | method | no | generated `SERVICE_API` method |
| SV34 | `planMode` | `planMode` | `set` | method | no | generated `SERVICE_API` method |
| SV35 | `sandbox` | `sandbox` | `confine` | method | no | generated `SERVICE_API` method |
| SV36 | `sandboxPolicy` | `sandboxPolicy` | `defaultMode` | getter | no | generated `SERVICE_API` readonly member |
| SV36 | `sandboxPolicy` | `sandboxPolicy` | `workspaceRoot` | getter | no | generated `SERVICE_API` readonly member |
| SV36 | `sandboxPolicy` | `sandboxPolicy` | `resolve` | method | no | generated `SERVICE_API` method |
| SV36 | `sandboxPolicy` | `sandboxPolicy` | `overrideOf` | method | no | generated `SERVICE_API` method |
| SV37 | `sessionPersistence` | `sessionPersistence` | `locate` | method | no | generated `SERVICE_API` method |
| SV37 | `sessionPersistence` | `sessionPersistence` | `supportsRawArtifacts` | getter | no | generated `SERVICE_API` readonly member |
| SV37 | `sessionPersistence` | `sessionPersistence` | `readRaw` | method | no | generated `SERVICE_API` method |
| SV37 | `sessionPersistence` | `sessionPersistence` | `create` | method | no | generated `SERVICE_API` method |
| SV37 | `sessionPersistence` | `sessionPersistence` | `append` | method | no | generated `SERVICE_API` method |
| SV37 | `sessionPersistence` | `sessionPersistence` | `prepare` | method | no | generated `SERVICE_API` method |
| SV37 | `sessionPersistence` | `sessionPersistence` | `load` | method | no | generated `SERVICE_API` method |
| SV37 | `sessionPersistence` | `sessionPersistence` | `inspect` | method | no | generated `SERVICE_API` method |
| SV37 | `sessionPersistence` | `sessionPersistence` | `readFrom` | method | no | generated `SERVICE_API` method |
| SV37 | `sessionPersistence` | `sessionPersistence` | `list` | method | no | generated `SERVICE_API` method |
| SV37 | `sessionPersistence` | `sessionPersistence` | `listSnapshots` | method | no | generated `SERVICE_API` method |
| SV38 | `sessionProjectionCache` | `sessionProjectionCache` | `cachedSnapshot` | method | no | generated `SERVICE_API` method |
| SV38 | `sessionProjectionCache` | `sessionProjectionCache` | `write` | method | no | generated `SERVICE_API` method |
| SV38 | `sessionProjectionCache` | `sessionProjectionCache` | `coldSnapshot` | method | no | generated `SERVICE_API` method |
| SV39 | `shell` | `shell` | `resolve` | method | no | generated `SERVICE_API` method |
| SV39 | `shell` | `shell` | `run` | method | no | generated `SERVICE_API` method |
| SV39 | `shell` | `shell` | `start` | method | no | generated `SERVICE_API` method |
| SV40 | `spillStore` | `spillStore` | `saveText` | method | no | generated `SERVICE_API` method |
| SV41 | `storageDomain` | `storageDomain` | `open` | method | no | generated `SERVICE_API` method |
| SV41 | `storageDomain` | `storageDomain` | `get` | method | no | generated `SERVICE_API` method |
| SV41 | `storageDomain` | `storageDomain` | `closeAll` | method | no | generated `SERVICE_API` method |
| SV42 | `subprocess` | `subprocess` | `resolveExecutable` | method | no | generated `SERVICE_API` method |
| SV42 | `subprocess` | `subprocess` | `spawn` | method | no | generated `SERVICE_API` method |
| SV42 | `subprocess` | `subprocess` | `spawnTerminal` | method | no | generated `SERVICE_API` method |
| SV43 | `terminals` | `terminals` | `registerBackend` | method | no | generated `SERVICE_API` method |
| SV43 | `terminals` | `terminals` | `listBackends` | method | no | generated `SERVICE_API` method |
| SV43 | `terminals` | `terminals` | `spawn` | method | no | generated `SERVICE_API` method |
| SV43 | `terminals` | `terminals` | `hasOwnerActivity` | method | no | generated `SERVICE_API` method |
| SV43 | `terminals` | `terminals` | `startSend` | method | no | generated `SERVICE_API` method |
| SV43 | `terminals` | `terminals` | `read` | method | no | generated `SERVICE_API` method |
| SV43 | `terminals` | `terminals` | `signal` | method | no | generated `SERVICE_API` method |
| SV43 | `terminals` | `terminals` | `kill` | method | no | generated `SERVICE_API` method |
| SV43 | `terminals` | `terminals` | `list` | method | no | generated `SERVICE_API` method |
| SV44 | `timer` | `timer` | `timeout` | method | no | generated `SERVICE_API` overload set |
| SV44 | `timer` | `timer` | `interval` | method | no | generated `SERVICE_API` overload set |
| SV44 | `timer` | `timer` | `throttle` | method | no | generated `SERVICE_API` method |
| SV44 | `timer` | `timer` | `debounce` | method | no | generated `SERVICE_API` method |
| SV45 | `toolResultPruner` | `toolResultPruner` | `config` | getter | no | generated `SERVICE_API` readonly member |
| SV45 | `toolResultPruner` | `toolResultPruner` | `measureContent` | method | no | generated `SERVICE_API` method |
| SV45 | `toolResultPruner` | `toolResultPruner` | `pruneContent` | method | no | generated `SERVICE_API` method |
| SV45 | `toolResultPruner` | `toolResultPruner` | `pruneSession` | method | no | generated `SERVICE_API` method |
| SV46 | `typertGateway` | `typertGateway` | `invoke` | method | no | generated `SERVICE_API` method |
| SV47 | `webServer` | `webServer` | `register` | method | no | generated `SERVICE_API` method |
| SV47 | `webServer` | `webServer` | `registerUpgrade` | method | no | generated `SERVICE_API` method |
| SV47 | `webServer` | `webServer` | `registerFallback` | method | no | generated `SERVICE_API` method |
| SV47 | `webServer` | `webServer` | `tapIndex` | method | no | generated `SERVICE_API` method |
| SV47 | `webServer` | `webServer` | `applyIndexTaps` | method | no | generated `SERVICE_API` method |
| SV48 | `web` | `web` | `registerSearchProvider` | method | no | generated `SERVICE_API` method; existing delivered member |
| SV48 | `web` | `web` | `registerFetchProvider` | method | no | generated `SERVICE_API` method; existing delivered member |
| SV48 | `web` | `web` | `search` | method | no | generated `SERVICE_API` method |
| SV48 | `web` | `web` | `fetch` | method | no | generated `SERVICE_API` method |

`jobs`, `shellEnv`, and all previously delivered service keys remain in the same static table. `web.search` and `web.fetch` are additions to the existing `web` service facade, not a second service key. The service namespace cardinality and exact member cardinality are asserted centrally after integration. The source column is design-time provenance only; runtime definitions retain only the facade key, `ctxService`, member name, kind, and optional flag.

For each definition, `createServicesNamespace` probes `ctx.get(ctxService)`, checks every required member, and builds either an active frozen facade or a P4 disabled facade. A missing optional official service does not make the root `services` namespace unavailable. A malformed required member disables only that service key. The facade never introspects or spreads the official object.

### 3.1 ST9 settings failure split

ST9 has two deliberately different guard boundaries. The integration owner must preserve both:

| Condition | Surface | Failure path | Required error fields | Unrelated surfaces |
|---|---|---|---|---|
| `ctx.get('settings')` is absent or throws | settings service lookup | P3 | `PluginApiServiceUnavailableError`; `service === 'settings'` | settings registration, settings events, and root facade remain active |
| the settings service exists but `writable`, `prepareDocument`, `get`, `update`, `replace`, or `mutate` is absent/malformed | ST9 member set | P2 | `PluginApiFeatureDisabledError`; `feature === 'settings'` | settings registration, settings events, and root facade remain active |

The P3 branch must not be collapsed into a disabled settings feature, and the P2 branch must not make the optional service lookup appear unavailable. Focused tests exercise both conditions independently and assert that the other settings surfaces continue to work.

### 4. Client service leaves

The client batch uses the following leaf-to-member contract. These lists are complete; constructors, UI internals, concrete provider members, and unrelated same-package exports are excluded.

| Leaf | Approved members |
|---|---|
| `modules` | `version`, `loadCache`, `import`, `registerStatic`, `prefetch`, `invalidate` |
| `locale` | `getLocale`, `getSnapshot`, `subscribe`, `setLocale`, `register`, `bind` |
| `sessions` | `list`, `currentProvideInfo`, `searchResultLimit`, `open`, `openSubagent`, `subagentAddress`, `setSubagentCatalogOpen`, `refreshSubagents`, `noteAgentPreset`, `clear`, `search`, `fork`, `provide`, `scope`, `scopeOf`, `sessionOf`, `binding` |
| `workspaces` | `list`, `connectWorkspace`, `startSession`, `create`, `pickDirectory`, `listDirectory`, `createDirectory`, `openPath`, `rename`, `delete`, `insertBefore`, `insertSessionBefore`, `archiveSession` |
| `chatFileMentions` | `forClosing` |
| `layout` | `toggleSidebar`, `openDetails`, `closeDetails` |
| `theme` | `getTheme`, `exportInspectTokens`, `setTheme`, `register`, `overrideTokens` |
| `appShell` | `renderApp` |
| `sessionLogDownload` | `store`, `download`, `dismiss`, `dispose` |
| `cordisInspect` | `register`, `publish`, `query`, `close` |
| `dynamicCordisRunner` | `activeRuns`, `lastRunError`, `renderFailures`, `reconcileApprovals`, `approve`, `decline`, `startUserRun`, `subscribe`, `getSnapshot`, `isLoaded` |

Each leaf has a required service/member probe. A missing or malformed leaf becomes P4 at the client leaf level and does not block other leaves. The outer client facade remains publishable when all required bundle primitives are present. Each active leaf returns official values and handles unchanged.

### 5. Client events and connection

The client event batch adds these exact event surfaces:

| ID | Event | Contract |
|---|---|---|
| C21 | `locale/change` | one official locale snapshot argument |
| C22 | `theme/change` | one official theme snapshot argument |
| C23 | `connection/reset` | official reset listener payload/order |
| C24 | `command/executed` | `(sessionId, commandName, result)` |

The event adapter must preserve the official dispatch timing, argument identity, listener disposer identity, and contained failure behavior. It must not synthesize an event when the producer is absent.

The connection adapter exposes exactly `client.connection.api.llm.providers`, `models`, and `discoverModels`. It delegates to the official RPC object and preserves payload, optional `AbortSignal`, returned Promise identity/adoption behavior, rejection, and endpoint selection. A missing `api.llm` or malformed member disables only the connection leaf.

### 6. Delivered remote publication

RB1 remains owned by the existing host remote implementation. Integration adds regression tests for:

- JSON-safe endpoint discovery through the official Typert marker and method descriptors;
- wire parameter names preserved exactly;
- owner-scoped disposer identity and stale-disposer isolation;
- P2 `PluginApiFeatureDisabledError` with `feature === 'remote'` on unavailable publication;
- unrelated M4 host/client leaves surviving remote failure.

No second remote publication path is introduced.

## 7. Feature-list owner matrix

The following matrix is the design-time one-to-one ownership proof. Every ID in the approved Requirements inventory appears exactly once. `owner` names the Stage 4 top-level batch or the integration owner; `mechanism` names the concrete adapter boundary; `public contract / evidence` identifies the whitelist or regression proof; `status` is the expected final status. The integration task must convert this matrix into centralized cardinality and traceability assertions without changing ownership.

| ID | Owner | Mechanism | Public contract / evidence | Status |
|---|---|---|---|---|
| L11 | host-namespaces | official LLM service facade | six provider/config methods; receiver/argument/return tests | implemented |
| L12 | host-namespaces | official public LLM exports | exactly `contentHasImage`, `createUserMessage`, `BlockAssembler`; negative boundary test | implemented |
| A12 | host-namespaces | official AgentRegistry methods | five initiator/ownership methods; callback and receiver tests | implemented |
| A13 | host-namespaces | snapshot adapter | frozen exact `{ provider, model, maxTokens }`; no live state | implemented |
| S7 | host-namespaces | official SessionStore methods | `create`, `prepare`, `enter`, `announce`, `flush`; lifecycle identity tests | implemented |
| S8 | host-namespaces | official SessionStore/public helper | `append`, `deriveEventMessage`; durable behavior tests | implemented |
| T11 | integration | delivered tool-aborted factory | exact constructor/code/fallback regression | delivered |
| T12 | host-namespaces | official ToolRuntime method | `executionMode`; falsey/error/receiver tests | implemented |
| T13 | host-namespaces | official tool definition export | `defineTool`; schema and metadata passthrough tests | implemented |
| P9 | host-namespaces | official SystemPrompt service | `assemble`; result/argument/error tests | implemented |
| P10 | W2 integration | existing official waterfall through shared event-bus policy | exact writable `system-prompt/assemble` behavior before/after `next()`; shared semantics regression | implemented |
| RB1 | integration | delivered Typert remote owner | JSON-safe wire, parameter, disposer, stale-owner regression | delivered |
| ST9 | host-namespaces | optional settings service + member guard | explicit P3 service lookup and P2 member split | implemented |
| C10 | client-leaves | official client module provider | exact six-member whitelist and negative boundary | implemented |
| C11 | client-leaves | official locale provider | exact six-member whitelist and event source | implemented |
| C12 | client-leaves | official sessions provider | exact outward face and identity tests | implemented |
| C13 | client-leaves | official workspaces provider | exact outward face and identity tests | implemented |
| C14 | client-leaves | official chat-file-mentions provider | `forClosing` only | implemented |
| C15 | client-leaves | official layout provider | three approved methods only | implemented |
| C16 | client-leaves | official theme provider | five approved members and snapshot tests | implemented |
| C17 | client-leaves | official app-shell provider | `renderApp` only | implemented |
| C18 | client-leaves | official session-log provider | four approved members and cleanup identity | implemented |
| C19 | client-leaves | official Cordis inspect provider | four approved members and disposer identity | implemented |
| C20 | client-leaves | official dynamic Cordis runner provider | ten approved members and stale cleanup tests | implemented |
| C21 | client-leaves | official locale event source | `locale/change`, one snapshot argument, order/disposer tests | implemented |
| C22 | client-leaves | official theme event source | `theme/change`, one snapshot argument, order/disposer tests | implemented |
| C23 | client-leaves | official connection event source | `connection/reset`, official payload/order | implemented |
| C24 | client-leaves | official command event source | `command/executed(sessionId, commandName, result)` | implemented |
| C25 | client-leaves | official connection API | `providers`, `models`, `discoverModels`; RPC/signal/error tests | implemented |
| O17 | host-events | catalog-only official producer metadata | two exact rows; one official dispatch yields one facade delivery | implemented |
| O18 | host-events | catalog-only official producer metadata | four exact rows; one official dispatch yields one facade delivery | implemented |
| O19 | host-events | catalog-only official producer metadata | two exact rows; one official dispatch yields one facade delivery | implemented |
| O20 | host-events | catalog-only official producer metadata | one exact row after durability confirmation; no producer-side registration | implemented |
| SV19 | integration | delivered service definition/facade | exact nine-member and negative-boundary regression | delivered |
| SV20 | integration | delivered service definition/facade | exact three-member and negative-boundary regression | delivered |
| SV21 | host-services | static service definition | `agentLoop`: `config`, `create`, `createAgent`, `resume` | implemented |
| SV22 | host-services | static service definition | `agentPresets`: eleven approved members | implemented |
| SV23 | host-services | static service definition | `apiProxy`: `downloads`, `respond` | implemented |
| SV24 | host-services | static service definition | `clientModules`: five approved members | implemented |
| SV25 | host-services | static service definition | `commands`: four approved members | implemented |
| SV26 | host-services | static service definition | `credentials`: four approved members | implemented |
| SV27 | host-services | static service definition | `directoryPicker.capability` only | implemented |
| SV28 | host-services | static service definition | `e2b`: `cwd`, `runtimeRoot`, `getSandbox` | implemented |
| SV29 | host-services | static service definition | `goals`: ten approved members | implemented |
| SV30 | host-services | static service definition | `invariants.register` only | implemented |
| SV31 | host-services | static service definition | `lsp`: `registerProvider`, `query` | implemented |
| SV32 | host-services | static service definition | `messageFeedback`: `list`, `put`, `delete` | implemented |
| SV33 | host-services | static service definition | `permissionPresets`: five approved members | implemented |
| SV34 | host-services | static service definition | `planMode`: `get`, `set` | implemented |
| SV35 | host-services | static service definition | `sandbox.confine` only | implemented |
| SV36 | host-services | static service definition | `sandboxPolicy`: four approved members | implemented |
| SV37 | host-services | static service definition | `sessionPersistence`: eleven approved members | implemented |
| SV38 | host-services | static service definition | `sessionProjectionCache`: three approved members | implemented |
| SV39 | host-services | static service definition | `shell`: `resolve`, `run`, `start` | implemented |
| SV40 | host-services | static service definition | `spillStore.saveText` only | implemented |
| SV41 | host-services | static service definition | `storageDomain`: `open`, `get`, `closeAll` | implemented |
| SV42 | host-services | static service definition | `subprocess`: three approved members | implemented |
| SV43 | host-services | static service definition | `terminals`: nine approved members | implemented |
| SV44 | host-services | static service definition | `timer`: four approved members and overload tests | implemented |
| SV45 | host-services | static service definition | `toolResultPruner`: four approved members | implemented |
| SV46 | host-services | static service definition | `typertGateway.invoke` only | implemented |
| SV47 | host-services | static service definition | `webServer`: five approved members | implemented |
| SV48 | host-services | static service definition | existing web provider registration plus `search`, `fetch` | implemented |

The matrix contains 63 rows: 13 core/remote IDs, 16 client IDs, 4 host-event IDs, and 30 service IDs. No ID is owned by more than one batch; delivered IDs are integration-owned only for regression evidence.

## Data Models

### Host capability definition

```text
ServiceDefinition {
  key: string
  ctxService: string
  members: readonly MemberDefinition[]
}

MemberDefinition {
  kind: 'method' | 'getter' | 'forward'
  name: string
  optional?: boolean
}
```

Definitions are static, frozen, and owned by W2 after integration. The W1 fragment is a neutral input artifact, not a second service-definition registry. `buildActiveFacade` uses the definition to make a complete member probe and a frozen exact-shape facade. `buildDisabledFacade` exposes the same declared shape with typed failures, so callers can distinguish a missing capability from an absent property. Central tests assert the exact definition keys `{ key, ctxService, members }`, the complete namespace key set, and the absence of legacy `pkg` metadata.

### Feature publication record

```text
FeatureRecord {
  name: string
  token: object
  isActive: boolean
  dispose(): boolean
}
```

The existing service publication token is the identity boundary. A cleanup callback may remove only the token it owns and only if it is still current. A retained facade checks the current feature/leaf state before touching an official object.

### Catalog entry

```text
CatalogEntry {
  name: string
  mode: 'on' | 'emit' | 'serial' | 'parallel' | 'waterfall' | 'bail'
  scopeFiltered: boolean
  scopeKey: 'args[0].agent' | 'args[1].scope' | null | undefined
  payload: string
  args: string
  fault?: 'contain' | 'created' | 'propagate'
  freeze?: 'all' | 'waterfall' | { deep: string[] } | 'except-signal'
}
```

M4 host events use the existing catalog schema. O17-O20 explicitly use `fault: 'contain'` and `freeze: 'all'` because these are observer-style official `emit` events. P10 is the sole writable exception: `system-prompt/assemble` uses `fault: 'propagate'` and `freeze: 'waterfall'` as specified above. `source` and feature classification are design-time traceability only and never runtime catalog fields, test fixture fields, implementation keys, or error text. The integration owner asserts the exact field set and rejects legacy synonyms such as `subject`, governance classification fields, `freeze: 'none'`, or unapproved policy values.

### Client leaf record

```text
ClientLeafRecord {
  name: string
  owner: object
  api: object
  isActive: boolean
  dispose(): boolean
}
```

Client records are private. `api` is a frozen exact member facade. The owner token is checked by every cleanup path and event disposer. No public API exposes the record or its internal owner identity.

### Documentation-only traceability record

The W3 integration owner maintains the one-to-one ID-to-evidence mapping only in the Markdown delivery artifact `docs/specs/plugin-api-official-passthrough-m4/delivery-report.md` and in the corresponding `feature-list.md` status updates. Each row records the scope ID, owner batch, requirement, focused evidence, status, and negative boundary. This mapping is documentation-only: no runtime JavaScript, JSON, catalog object, implementation identifier, or test fixture may contain feature-list IDs or governance classification labels. Runtime and focused tests assert only neutral public capability names, event names, member sets, behavior, and cardinalities; they do not encode the traceability table.

## Error Handling

Error precedence is fixed:

1. **P1** `PluginApiInactiveError` when the root facade is inactive;
2. **P2** `PluginApiFeatureDisabledError` when the owning host/client feature is disabled;
3. **P3** `PluginApiServiceUnavailableError` for an optional service lookup that is intentionally unavailable;
4. **P4** per-service or per-client-leaf disabled facade with `isActive === false` and P2 on operation.

Activation and cleanup are fail-safe. Any missing dependency, throwing getter, malformed member, native registration error, rejected setup Promise, or disposer error at those boundaries is caught at the existing boundary, logged through the safe logger, and isolated to the owning leaf. No `apply()` path throws through the harness boot boundary. A registered listener's error while an official dispatcher is executing it is a dispatch-time outcome, not an activation or cleanup error, and follows the catalog entry's `fault` policy.

Official operation errors are not converted. Once the facade has passed its guard and invoked the official member, its thrown error, rejected Promise, return identity, and receiver behavior pass through unchanged. Guard code must not eagerly invoke getters or methods merely to determine availability when doing so would change official semantics; shape probes are limited to the approved public member contract and any resulting throw is treated as local malformed-dependency failure.

For `system-prompt/assemble`, the event adapter must preserve official writable fields through waterfall execution. It may protect event metadata and listener lifecycle, but cannot freeze `assembly.sections`, `contexts`, `tools`, or `variables` in a way that blocks an official listener before or after `await next()`. Its `fault: 'propagate'` policy preserves official dispatch semantics for normal listeners: a throw or rejection before `next()` or after `await next()` aborts or rejects the official waterfall unchanged. The activation/cleanup fail-safe boundary does not catch those errors.

For client and service cleanup, state invalidation precedes native disposal. Cleanup continues through all stages even when one stage throws. A stale disposer returns the existing false/no-op outcome and cannot remove a newer owner.

## Parallel Worktree Architecture

The approved Requirements require parallel development to be explicit. This Design establishes the batch DAG that `tasks.md` will refine into executable contracts.

### Integration owner

The integration owner is the branch `codex/plugin-api-official-passthrough-m4` in `.worktrees/plugin-api-official-passthrough-m4`, based on baseline `2c2da4b`. It owns all shared files, the join points, final traceability, and the final merge wave.

Shared/frozen files for parallel leaf work:

- `lib/index.js`
- `lib/plugin-api-service.js`
- `lib/client.js`
- `lib/catalog-compose.js`
- `lib/events-bus.js`
- `lib/deep-freeze.js`
- `lib/system-prompt-events-catalog.js`
- `lib/feature-registry.js`
- `lib/errors.js`
- package manifests and bundle patch files
- centralized cardinality/inventory tests
- `docs/specs/plugin-api-official-passthrough-m4/requirements.md`
- `docs/specs/plugin-api-official-passthrough-m4/design.md`
- `docs/specs/plugin-api-official-passthrough-m4/tasks.md`

Leaf branches may not edit these files. For every W1 contract below, `lib/events-bus.js`, `lib/deep-freeze.js`, and `lib/system-prompt-events-catalog.js` are one frozen P10 semantic unit whose unique modification owner is W2 integration. They contribute new leaf modules and focused tests only; the integration owner performs mechanical imports, mount registration, ordering, central facade composition, and package changes at the join point.

### Planned waves

| Wave | Batch | Worktree/branch contract | Primary write set | Join prerequisite |
|---|---|---|---|---|
| W0 | contract scaffolding and test harness | integration owner | shared files only | Design and Tasks approved |
| W1 | host namespace leaves | `.worktrees/plugin-api-official-passthrough-m4-host-namespaces` / `codex/plugin-api-official-passthrough-m4-host-namespaces` | new host namespace helper modules and focused host tests | W0 committed contract helpers |
| W1 | host event catalog leaves | `.worktrees/plugin-api-official-passthrough-m4-host-events` / `codex/plugin-api-official-passthrough-m4-host-events` | new event catalog/producer adapter modules and focused event tests | W0 committed catalog schema |
| W1 | host service definition leaves | `.worktrees/plugin-api-official-passthrough-m4-services` / `codex/plugin-api-official-passthrough-m4-services` | service definition modules or disjoint definition fragments and focused service tests | W0 committed P4 helper contract |
| W1 | client leaf adapters | `.worktrees/plugin-api-official-passthrough-m4-client` / `codex/plugin-api-official-passthrough-m4-client` | new client leaf modules and focused client tests | W0 committed client leaf contract |
| W2 | consumer-facing integration | integration owner | frozen shared files, including the atomic P10 semantic unit, package manifests only as needed, central tests | all W1 branches committed, reviewed, preflighted |
| W3 | final reconciliation and verification | integration owner | feature-list status, traceability report, delivery docs, required fixes | W2 focused tests green |

W1 batches are independent only at the leaf-module level. They must not each modify a common index, central catalog, package manifest, or aggregate test. If a leaf needs a shared semantic change, it records a deviation and sends it to the integration owner; it does not make an uncoordinated shared edit.

### Batch contracts

The following contracts are part of the design, not optional coordination notes. `Out of scope` means every listed ID is excluded from that batch's implementation and test changes; the integration owner may later add centralized evidence for it at W2/W3. All W1 branches derive from the W0 committed boundary, use the exact worktree and branch names in the table, and have one commit boundary before joining W2.

| Batch | In scope | Out of scope | Allowed files | Forbidden files | Contract inputs, vocabulary, guard | Commit and evidence gate |
|---|---|---|---|---|---|---|
| W0 contract scaffolding | No feature-list implementation ID; shared test seams and contract fixtures only | All 63 IDs as implementation ownership | integration-owned shared files listed above; W0-only fixtures | all leaf modules owned by W1; official package files | approved Requirements/Design; existing P1-P4 errors; exact catalog schema; no runtime governance identifiers | one committed scaffolding boundary after Tasks approval; `git diff --check`, focused harness tests, and Luna(max) review before W1 derivation |
| W1 host-namespaces | L11, L12, A12, A13, S7, S8, T12, T13, P9, ST9 | P10, T11, RB1, C10-C25, O17-O20, SV19-SV48 | new host namespace leaf modules and `test/` focused host tests; no central wiring | `lib/index.js`, `lib/plugin-api-service.js`, `lib/client.js`, `lib/events-bus.js`, `lib/deep-freeze.js`, `lib/system-prompt-events-catalog.js`, `lib/catalog-compose.js`, `lib/feature-registry.js`, `lib/errors.js`, manifests, aggregate tests, all docs | approved namespace/member tables; L12 and A13 exact whitelists; ST9 required split: optional service lookup is P3/fail-open, malformed members are P2/local; namespace guards are required fail-closed except settings service lookup; no event catalog fields in namespace APIs | one leaf-only commit; exact member/negative-boundary, receiver/identity, failure, and retained-reference tests; P10 is excluded and tested only by W2 shared-semantics work; diff/write-set audit plus Luna(max) blocking review |
| W1 host-events | O17, O18, O19, O20 | P10, L11, L12, A12, A13, S7, S8, T11, T12, T13, P9, RB1, ST9, C10-C25, SV19-SV48 | five catalog-only producer slices and focused event tests | all frozen/shared files, existing catalog slices, `lib/events-bus.js`, `lib/deep-freeze.js`, `lib/system-prompt-events-catalog.js`, `lib/catalog-compose.js`, manifests, aggregate tests, official package files | nine exact event rows; runtime schema `name/mode/scopeFiltered/scopeKey/payload/args` plus `fault/freeze`; all rows `emit`, `scopeFiltered:false`, `fault:'contain'`, `freeze:'all'`; optional producer guard fail-open; existing events bus is the sole native subscription owner; no bridge listener, synthetic producer, replay, or re-emission; runtime tests use neutral names and cardinalities only | one slice-only commit; exact names/cardinality/metadata, one-dispatch/one-delivery behavior through the existing bus, contained failure, missing producer isolation, stale native-hook cleanup, and slice omission/inert checks; write-set audit plus Luna(max) blocking review |
| W1 host-services | SV21-SV48 | P10, L11, L12, A12, A13, S7, S8, T11, T12, T13, P9, RB1, ST9, C10-C25, O17-O20, SV19, SV20 | one neutral static definition fragment and focused fragment tests; no central definition-table edits | new neutral fragment module and focused fragment test only; `lib/services.js` and `test/services-definitions.test.mjs` remain W2-owned | exact key/member table; only `method/getter/forward`; provider-independent public members; per-service P4 disabled facade; optional service guard fail-open; no object spread/introspection, no `pkg` metadata, and no service-level P3 for the P4 definitions | one fragment-only commit; exact service/member cardinality, receiver/return/disposer/error identity, missing service/member isolation, negative private-member tests; write-set audit plus Luna(max) blocking review |
| W1 client-leaves | C10-C25 | P10, L11, L12, A12, A13, S7, S8, T11, T12, T13, P9, RB1, ST9, O17-O20, SV19-SV48 | new client leaf adapters and focused client tests; leaf-local helper modules are allowed | `lib/client.js`, host shared files including `lib/events-bus.js`, `lib/deep-freeze.js`, and `lib/system-prompt-events-catalog.js`, package manifests, aggregate tests, host event/catalog files, official package files | exact C10-C20 whitelists; C21-C24 official event names and argument contracts; C25 exact nested `connection.api.llm` face; P4 per leaf; optional client providers fail-open; owner-token/stale-disposer rules; no generic proxy or cloned return handles; leaf publication and event wiring are joined by W2 through `clientOfficialServices` | one client-leaf commit; exact whitelist/negative boundary, event identity/order/disposer, RPC signal/error/Promise forwarding, repeated apply/out-of-order cleanup, partial failure tests; write-set audit plus Luna(max) blocking review |
| W2 integration | all IDs through their matrix owners; integration responsibility, not duplicate leaf ownership | no new feature-list ID, no C-class proposal, no R-class replacement, no consumer migration | frozen shared files, `lib/services.js`, `test/services-definitions.test.mjs`, package manifests and bundle wiring only as required, centralized integration tests | unrelated refactors, official package files, leaf worktree files except mechanical merge resolution | all W1 committed/reviewed boundaries; unique owner of the P10 `events-bus`/`deep-freeze`/system-prompt-catalog semantic unit and the complete service-definition table; remove `pkg` from all definitions and assert exact definition keys; existing events bus is the sole O17-O20 native subscription owner; exact mount order; P1-P4 paths; catalog and service/client cardinality; delivered T11/RB1/SV19/SV20 regression-only; traceability remains docs-only | read-only preflight first; merge in declared order with focused tests after each join; one integration commit per top-level join and Luna(max) review before next dependent join |
| W3 reconciliation | all 63 IDs and final feature-list status | new behavior outside the approved inventory | feature-list/status registration, traceability and delivery docs, centralized verification fixes only | new leaf APIs, unrelated runtime refactors, official package files | final inventory is authoritative; every ID has one owner, evidence, status, negative boundary; deployed/browser claims require corresponding evidence and are not inferred from unit green | final reconciliation commit after full suite, boot checks, cardinality, provenance, immutability, and `git diff --check`; final report records evidence classes and deviations |

The W1 contracts intentionally freeze the semantic infrastructure while allowing disjoint leaf files to proceed concurrently. A branch that needs a change to a forbidden shared file must stop, record a deviation for the integration owner, and wait for the centralized decision; it may not silently widen its write set.

### Join and merge protocol

Before W2 changes the integration branch, the integration owner performs read-only preflight for every branch:

1. compare the branch against its task contract and baseline;
2. snapshot tracked, untracked, and generated-file provenance;
3. verify the write set and frozen-file rule;
4. run `git diff --check` and official-package immutability checks;
5. inspect pairwise `git merge-tree` conflict edges;
6. run the branch focused tests and inspect negative-boundary evidence;
7. confirm exactly one owner for every M4 ID.

The merge order is the declared dependency order: contract scaffolding, host namespaces, host events, services, client leaves, then central integration. After each top-level batch is merged, its focused tests run before the next merge. The integration owner does not perform a coordinator-wide refactor during this wave.

Every top-level batch receives one blocking adversarial review after implementation and before the next dependent batch. A substantive deviation requires a Requirements/Design revision note, a batch report, an integration decision log entry, and fresh focused evidence.

## Testing Strategy

### Focused host tests

- exact namespace member presence and negative boundary for L11/L12/A12/A13/S7/S8/T11/T12/T13/P9/ST9;
- official receiver, argument count, identity, Promise/disposer, sync/async error and falsey-result preservation;
- A13 exact frozen keys and absence of live agent/session/context/inbox/registry state;
- P10 writable system-prompt waterfall mutation and replacement before/after `await next()`, exact scope/signal identity and return-value authority, normal-listener throw/rejection propagation before and after `await next()`, and monitor containment;
- local P1/P2/P4 behavior and unrelated feature survival;
- reapply, partial activation, stale cleanup and retained-reference invalidation.

### Focused event tests

- exact nine O17-O20 names, mode, args, payload shape and catalog cardinality;
- direct producer dispatch, payload identity, dispatch ordering, listener disposal and contained failure;
- missing/malformed producer omits only the M4 slice;
- no synthetic producer, no unapproved event, no governance identifier in runtime catalog.

### Focused service tests

- all SV21-SV48 definitions and member cardinalities;
- active facade exact shape, official receiver forwarding, getter behavior, return/disposer/error identity;
- missing service and missing member each produce only the expected P4 facade;
- private/concrete-provider members are absent;
- existing SV19/SV20 behavior remains unchanged;
- final service namespace includes all previous services plus M4 additions with no duplicate key.

### Focused client tests

- each C10-C20 exact member whitelist and negative boundary;
- C21-C24 event ordering, argument identity and stale disposer behavior;
- C25 connection LLM payload/signal/Promise/error forwarding;
- missing/malformed/throwing provider disables only its leaf;
- repeated apply, out-of-order disposal, partial failure and newer-owner preservation;
- client facade remains publishable when optional leaves are unavailable.

### Delivered regression and integration tests

- T11 exact error constructor/fallback contract;
- RB1 JSON-safe remote endpoint, wire parameter and owner disposer contract;
- SV19/SV20 exact nine/three member contract;
- full existing `node --test` suite;
- targeted host/client boot checks, clearly labeled separately from unit and integration tests;
- exact M4 inventory/cardinality assertions and one-to-one traceability report for all 63 IDs;
- `git diff --check`, official DSH package diff check, untracked provenance check, and worktree merge preflight.

The final report distinguishes unit, integration, headless smoke, dev boot, and deployed-runtime evidence. A green aggregate suite alone is not treated as proof of browser or deployed acceptance.

## Requirements traceability

| Requirements | Design coverage |
|---|---|
| R1 | M4 inventory, primary-owner rule, final evidence record, exact cardinality checks |
| R2-R5 | host namespace table, direct passthrough rules, P1-P4 and local degradation |
| R6 | settings member table and official scope receiver preservation |
| R7 | O17-O20 catalog slice and writable waterfall exception |
| R8 | SV21-SV48 static service table, P4 construction and negative boundary |
| R9 | C10-C25 leaf tables, direct client publication and connection adapter |
| R10 | delivered RB1 regression-only owner and exact remote tests |
| R11 | activation/cleanup containment, stale owner invalidation, no scope leakage |
| R12 | focused test matrix, cardinality/inventory evidence, final report evidence types |
| R13 | wave DAG, worktree naming, baseline, write sets, frozen files, preflight, join and review protocol |

## Scope and compatibility boundary

This design does not implement C-class proposals, a new R-class replacement bundle, or any modification under `/usr/lib/node_modules/@deepseek-ai/dsh/**`. It does not add consumer migrations or business semantics. Any implementation discovery that would require one of those changes is an integration deviation and must stop the affected batch for an explicit decision.

The feature-list remains authoritative. The L12 and A13 corrections are this feature's approved, explicit scope boundaries and must be synchronized back to the M4 inventory during final reconciliation without adding a new feature ID.
