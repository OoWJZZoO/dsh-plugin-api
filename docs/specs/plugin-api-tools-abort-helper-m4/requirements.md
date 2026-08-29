# Requirements: plugin-api-tools-abort-helper-m4

> **公共契约现状注（2026-08-29 追加）**：本制品成文于目标领域树 cutover 之前，文中的公共 path 为旧命名。现行命名以 [`public-contract.registry.json`](../plugin-api-m7-public-contract-refactor/public-contract.registry.json) 的 `oldToTargetMapping` 为唯一权威，本制品涉及的映射如下：
>
> | 本制品使用的旧 path | 现行 path |
> |---|---|
> | `ctx.pluginApi.client.*`（client 根） | `ctx.pluginApi` 直接根成员（已无 `.client` 子命名空间） |
>
> 本制品的 `pluginApi.tools.toolAbortedError()` 属 `tools` 领域，path 未变。现行契约基线：包版本 `0.1.0-rc.6-0.1.0`（runtime `0.1.0-rc.6` / `dsh.api` `0.1`）；本制品中出现的 `0.1.0-rc.6-0.x` 为历史交付边界记录，不代表现行版本。本注只更新命名与版本指针，不改动本制品已获批的 Goal / Requirements 验收边界。

> feature_name: `plugin-api-tools-abort-helper-m4`
> 状态：Stage 1 草案（待对抗性审查与用户批准）
> 上游：Stage 0 Goal（已确认）、`AGENTS.md` §2/§4/§6、`docs/specs/plugin-api-features/feature-list.md` §2.6（`pluginApi.tools`，T1–T10）、`docs/specs/plugin-api-tools-m1/`、`dsh-pro-ex-ability-anchor/lib/index.js`（`loadAbortedErrorFactory`，当前手工组合路径）
> 类型：A 类（官方公开常量/类的稳定化 helper，无新语义）；host-only，无 client bundle。

---

## Introduction

社区自研工具/执行器要正确处理 abort，就必须自行 import `@deepseek-ai/dsh-tools`（取 `TOOL_ABORTED`）与 `@deepseek-ai/dsh-llm`（取 `HarnessError`）两个官方包，并**手工组合**官方 dsh-tool-bash / dsh-tool-pwsh 使用的错误对象：

```js
const error = new HarnessError('tool call aborted', TOOL_ABORTED) // dsh-tools 与 dsh-llm 各自的公开导出
error.name = 'AbortError'                                         // 官方无论述的第二次赋值
throw error
```

社区实现各不相同（有的退回裸 `Error` 命名 `AbortError`，有的组合出错误的 code/name），agent loop 对 abort 的识别因此不可靠；且该直连官方包的路径被 `AGENTS.md` §4.1 明确标记为 **unsupported escape hatch**：无兼容承诺、官方内部变化时可能破坏。

本 feature 提供 `pluginApi.tools.toolAbortedError()` 作为**唯一稳定入口**，返回一个与官方路径**同 class、同 name、同 code** 的“工具调用已中止”错误，agent loop / 官方 tool runtime 可以原样识别。helper 本身只消费官方公开导出（`TOOL_ABORTED` from `@deepseek-ai/dsh-tools`、`HarnessError` from `@deepseek-ai/dsh-llm`），不引入新错误分类，不接管 abort 监听/超时逻辑，不新增 namespace。

官方身份事实（源码出处，A 类判定依据）：

- `TOOL_ABORTED === "ABORTED"` 由 `@deepseek-ai/dsh-tools` 根导出（`dsh-tools/lib/index.js:2411,3570`）。
- `HarnessError` 由 `@deepseek-ai/dsh-llm` 根导出（`dsh-llm/lib/types/error.js`，公开类，带 `code`）。
- 官方 dsh-tool-bash / dsh-tool-pwsh 的一致构造：`new HarnessError("tool call aborted", TOOL_ABORTED)` 后 `error.name = "AbortError"`（`dsh-tool-bash/lib/index.js:408-409,434-435`）。
- 该身份被官方以 in-band 形式固化：tool runtime 的 canonical abort outcome `toolAbortedResult` 的 `error.info` 为 `{ name: "AbortError", code: TOOL_ABORTED }`（`dsh-tools/lib/index.js:3532-3549`）；工具 body 抛出 `HarnessError` 时 `toolErrorResult`/`errorInfo` 把 `{ name, code }` 原样写入 `result.error.info`（`dsh-tools/lib/index.js:2494-2497,3472-3489`）。因此抛出本 helper 的**非降级**返回值（§3 降级路径为裸 `Error`、无 `code`，不逐字段相等），经官方 runtime 物化后与官方 abort outcome `error.info` 逐字段相等 —— “agent loop 可以原样识别”。

**形状（Stage 1 定稿）**：`pluginApi.tools.toolAbortedError(): Error` —— 零参数；每次调用返回一个**新构造**的、未冻结的可抛掷 Error；可用官方常量时返回完整 typed identity，不可用时 fail-safe 降级（见 §3）。

---

## 1. `pluginApi.tools.toolAbortedError` 表面形状（Stage 1 定稿）

**User Story**: As a third-party tool author, I want one stable method `pluginApi.tools.toolAbortedError()` on the existing tools namespace, so that I can throw an officially-recognized "tool call aborted" error without importing `dsh-tools`/`dsh-llm` and without hand-composing the object.

**Acceptance Criteria**

1.1. WHEN the tools feature is active and a plugin calls `pluginApi.tools.toolAbortedError()` THEN the facade SHALL return an `Error` instance, and the call SHALL NOT itself throw.（A）

1.2. WHEN the call receives arguments THEN the facade SHALL ignore them (the method is a zero-argument factory); the returned identity SHALL be the same regardless of arguments.（A）

1.3. GIVEN two calls to `pluginApi.tools.toolAbortedError()` THEN each SHALL return a newly constructed instance (SHALL NOT return a shared singleton), and SHALL NOT deep-freeze the returned error (it SHALL remain a mutable, ordinary throwable).（A）

1.4. WHEN the returned error is thrown by a tool body THEN its identity SHALL be exactly what the official agent loop / tool runtime recognizes as an abort（契约见 §2.4–2.5）.（A）

1.5. WHERE the tools feature is disabled（`pluginApi.tools.isActive === false`）IF `toolAbortedError` is called THEN the facade SHALL throw the facade-standard `PluginApiFeatureDisabledError('tools')`, following the disabled contract of the namespace's regular methods（与 `register`/`restrict`/`get` 等一致；`routeOf` 是本命名空间唯一豁免成员、与本 helper 无关）（shape 仍存在，行为按门面约定。）.（A + 门面基础）

**Type**: A（官方已提供 `HarnessError` + `TOOL_ABORTED`，仅稳定化构造路径；AC 1.5 为门面基础 fail-safe 约定）

---

## 2. typed identity 与官方路径等价

**User Story**: As a third-party tool author, I want the returned error to be exactly the same class/code/name as the official `dsh-tool-bash` abort error, so that existing official recognition code treats my error identically to an official built-in tool's abort.

**Acceptance Criteria**

2.1. GIVEN the official `HarnessError`（`@deepseek-ai/dsh-llm`）is available WHEN `pluginApi.tools.toolAbortedError()` is called THEN the returned error SHALL satisfy `error instanceof HarnessError === true`.（A）

2.2. GIVEN the official `TOOL_ABORTED` constant（`@deepseek-ai/dsh-tools`）is available WHEN the method above is called THEN the returned error SHALL satisfy `error.code === TOOL_ABORTED`（i.e. `"ABORTED"`）.（A）

2.3. WHEN the method above is called THEN the returned error SHALL satisfy `error.name === "AbortError"` and `error.message === "tool call aborted"`（与官方 dsh-tool-bash 构造的字面量逐字节一致）.（A）

2.4. GIVEN the canonical official composition `new HarnessError("tool call aborted", TOOL_ABORTED)` followed by `error.name = "AbortError"` WHEN the helper's return value is compared on `{ name, code, message }` THEN the two SHALL be deep-equal（typed identity，锁入测试）.（A）

2.5. GIVEN the non-degraded return value（§2.1–2.2 的官方常量可用前提，未走 §3 降级路径）IF a tool body throws that error and the official tool runtime materializes the outcome THEN the resulting `error.info` SHALL equal `{ name: "AbortError", code: TOOL_ABORTED }`, byte-identical to the official canonical abort outcome (`toolAbortedResult`), so the agent loop recognizes the throw as an abort as-is.（A）

**Type**: A（identity 全部落在官方公开导出上；官方 runtime 的物化路径已存在，本 feature 只保证抛出对象与之逐字段一致）

---

## 3. fail-safe：官方常量不可用时的显式降级

**User Story**: As a plugin maintainer, I want the helper itself to stay fail-safe when the official `dsh-tools`/`dsh-llm` exports cannot be resolved, so that an exotic runtime (missing optional package, or a future version that renamed/removed an export) never crashes the facade boot or the tool's throw path.

**Acceptance Criteria**

3.1. GIVEN the official `TOOL_ABORTED` export or `HarnessError` class cannot be resolved at call time WHEN `pluginApi.tools.toolAbortedError()` is called THEN the helper SHALL degrade to a plain `Error` with `name === "AbortError"` and `message === "tool call aborted"` (without the `HarnessError` instance/`code`), and SHALL NOT throw a resolution error.（A）

3.2. GIVEN `@deepseek-ai/dsh-tools` cannot be loaded at mount time WHEN the facade applies THEN `apply` SHALL return normally (fail-safe), `pluginApi.tools` SHALL mount according to the feature guard, and the missing package SHALL NOT cause any error to propagate out of `apply`（常量解析的“可失败/惰性”机制属 design 决策，不在需求层规定，见本组 Type 注）.（A + 门面基础）

3.3. WHEN the helper degrades per AC 3.1 within a running host THEN the degraded behavior SHALL remain stable for the host lifetime（不随调用在降级/非降级之间摆动；该稳定性如何实现的机制属 design 决策）.（A）

3.4. WHEN the helper is mounted THEN it SHALL create no runtime side effects beyond the stabilized factory (no listeners, no `exec.signal` subscription, no timer), and SHALL NOT modify any file under `/usr/lib/node_modules/@deepseek-ai/dsh/**` or any other official package.（A + 硬约束）

**Type**: A（fail-safe 遵循 AGENTS.md §2.6；常量解析方式属 design 决策，此处只立行为约束）

---

## 4. 范围边界与非目标

**User Story**: As a repository maintainer, I want crystal-clear boundaries so that this helper never grows into an error-classification system, an abort/timing framework, or a new namespace.

**Acceptance Criteria**

4.1. WHEN this feature is delivered THEN it SHALL NOT introduce any new error class, new error `code`, or new error-classification helper beyond `pluginApi.tools.toolAbortedError` itself.（A）

4.2. WHEN this feature is delivered THEN it SHALL NOT take over abort listening or tool timeout logic: it SHALL NOT subscribe to `exec.signal`, SHALL NOT implement timeouts, and SHALL NOT wrap `tools/execute`; the official cancel/timeout ownership（`ToolRuntime` cancellation、`dsh-tool-call-timeout-policy`）SHALL remain the sole owners.（A）

4.3. WHEN this feature is delivered THEN it SHALL NOT add any new top-level namespace on `pluginApi`; the helper SHALL live on the existing `pluginApi.tools` namespace.（A）

4.4. WHEN the helper consumes official exports THEN it SHALL consume only official public exports（`TOOL_ABORTED` from `@deepseek-ai/dsh-tools`、`HarnessError` from `@deepseek-ai/dsh-llm`）and SHALL NOT reach into official module-private symbols.（A）

4.5. WHEN this feature is delivered THEN it SHALL NOT touch the client bundle / `pluginApi.client` face.（A）

4.6. WHEN this feature is delivered THEN its implementation surface SHALL stay minimal（one small pure helper module + a thin member on the existing tools facade）；the helper module SHALL keep zero harness dependency per AGENTS.md §6（纯函数模块，仅依赖官方公开类的构造语义）.（A + 工程约束）

**Type**: A / 工程与治理约束

---

## 5. 治理与登记（交付动作）

**User Story**: As a repository maintainer, I want this feature registered in the canonical governance surfaces at delivery time, so that no registry goes stale（AGENTS.md §8 防过期规则）.

**Acceptance Criteria**

5.1. WHEN this feature is delivered THEN the feature-list SHALL add one item under §2.6 `pluginApi.tools`（拟作 `T11 工具中止错误构造`，最终编号以 feature-list 登记为准），type 标注 `A`，milestone `M4`，status `delivered`，并附官方源码出处。（Governance）

5.2. WHEN this feature is delivered THEN the feature-list §4 迁移验收表 SHALL add one row for `dsh-pro-ex-ability-anchor` 的 `loadAbortedErrorFactory` → `pluginApi.tools.toolAbortedError()`（see §6）.（Governance）

5.3. WHEN this feature is delivered THEN the delivered-feature registry in AGENTS.md §8 SHALL append one entry for `plugin-api-tools-abort-helper-m4`（范围 / 状态 / spec 目录 / 关键约束），and the corresponding feature-list status（§2.6 的 T11 条目与 §4 迁移行）SHALL be kept consistent（feature-list 无独立 feature 登记表；登记本体在 AGENTS.md §8，feature-list 只同步状态，见 AGENTS.md §8 防过期规则）.（Governance）

5.4. WHEN this feature is delivered THEN its API 协议版本号 SHALL NOT be bumped by this feature alone；任何 minor 升级 SHALL 由 M4 integration 统一定界并记录（经 AGENTS.md §8 登记，`plugin-api-compaction-events-r1` 已交付并承接 `0.1.0-rc.6-0.4` / `dsh.api` `0.4` 作为现行 boundary；本 feature 不提前断言版本，最终 boundary 以 M4 integration 批准记录为准）.（Governance）

**Type**: Governance

---

## 6. dsh-pro-ex-ability-anchor 迁移验收证据（非目的）

**User Story**: As a community tool author, I want proof that the facade entry is directly reusable, demonstrated by the existing hand-rolled factory in `dsh-pro-ex-ability-anchor` being deleted in favor of `pluginApi.tools.toolAbortedError()`.

**Acceptance Criteria**

6.1. GIVEN `dsh-pro-ex-ability-anchor` is migrated WHEN its `loadAbortedErrorFactory`（`lib/index.js`，当前手工组合 `HarnessError`/`TOOL_ABORTED` 并回退裸 `AbortError` 的实现）is deleted and replaced by a call to `pluginApi.tools.toolAbortedError()` THEN the replacement SHALL preserve the same observable error identity the Windows Git Bash tool currently relies on.（A 验收证据）

6.2. GIVEN `dsh-pro-ex-ability-anchor` is migrated per AC 6.1 WHEN its headless smoke and dev boot run THEN both SHALL pass with no loss of abort-recognition behavior.【非目的】：该 migration 是验收证据、不是本 feature 的实现目标；其执行按获批 Tasks 进行。（验收证据）

6.3. WHEN the migration per AC 6.1 cannot be completed within this feature's delivery window THEN the deleted-factory evidence SHALL be waived only with an explicit record in the delivery report explaining why（e.g. consumer repo unavailable）; the typed-identity contract（§2）SHALL remain fully locked by this repo's own tests regardless.（验收证据）

**Type**: A 验收证据（非本 feature 的目的）

---

## 7. 需求覆盖检查

| Stage 0 Goal 关键承诺 | 覆盖需求 |
|---|---|
| 唯一稳定入口 `pluginApi.tools.toolAbortedError()`，形状 Stage 1 定稿 | §1（1.1–1.5） |
| 返回错误与官方路径同 class / 同 code / 同 name（typed identity），测试锁定 | §2（2.1–2.5） |
| agent loop 可以原样识别 | §2（2.4–2.5） |
| 官方常量不可用时 helper 自身 fail-safe（显式降级或 typed error），绝不抛穿 apply | §3（3.1–3.4）+ §1（1.5） |
| 不引入新错误分类、不接管 abort 监听/超时逻辑、无新 namespace | §4（4.1–4.6） |
| 只消费官方公开导出、极小实现面 | §4（4.4, 4.6） |
| 验收证据：pro-ex 删除 `loadAbortedErrorFactory` | §6（6.1–6.3） |
| 登记与文档新鲜度 | §5（5.1–5.4） |

> 非目标（与 AGENTS.md §6 一致，本 spec 不实现）：不做完整错误分类体系；不做工具执行超时/取消框架；不做 client 面；不新增 namespace；不 patch 官方包。
