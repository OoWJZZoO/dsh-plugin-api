# Stage 2 - Design

> feature_name: `credential-mutation-contract`
> milestone: M10
> status: Stage 0–2 已交付（2026-09-12）。Goal 于 2026-09-11 获批；Requirements 与 Design 同批交付。本文只定义设计与可验证契约，不创建 Tasks、不写实现代码；Tasks 以对抗性审查为门（AGENTS.md §3.2），通过后进入 Stage 4。
> 上游输入：本目录 `goal.md`（2026-09-11 获批）、`requirements.md`（同批交付基线）；M10 工作纲领 §3.6（OBS-06）；M7 deletion report B4-5；canonical registry `services.credentials` 现状（resolve/describe）与 `credentials/updated` 事件登记。

## Status

Stage 2 Design（2026-09-12 交付，Stage 0–2 已交付）。本文与已交付的 Requirements 一一对应；公共 path、写包装、ref/revision 冲突检测、事件复用、三向 secret 分离与脱敏边界在本文件定稿。实现通道：**A 类受控包装为主 + 一处声明式 B 类冲突检测**——官方 `dsh-credentials` 写 seam（`set(ref, value): Promise<void>` / `unset(ref): Promise<void>`）存在（冻结 runtime `@deepseek-ai/dsh-credentials@0.1.0-rc.6` + `@deepseek-ai/dsh-credentials-local@0.1.0-rc.6` 实测），但官方 seam **没有 compare-and-set 参数**（实测确认），并发冲突检测按 Requirements Req 3.2 以 **B 类底层模拟**补齐，fail-closed 为默认，本文件如实标注并给出模拟规则；事件可见状态复用官方 `credentials/updated` authority（registry 已登记），不建第二套事件体系。无 upstream proposal、**无 R 点位**（官方组件 seam 完整，B 类模拟只是门面附加检测，不触达组件边界替换条件）。

## Overview

`credential-mutation-contract` 在主门面新增 **`pluginApi.credentials`** 一等命名空间，为受权操作方提供受约束、可追溯的受管凭据创建/更新/删除面：

- **写**：`set(ref, value, options?)` / `unset(ref, options?)` —— 包装官方 provider 写 seam，补 owner 归因、审计、提交前校验与 revision 冲突检测；成功以官方真实持久化为准。
- **自描述**：`availability()`（含只读 backend 状态）。
- **读**：不新增读成员——既有 `services.credentials.resolve/describe`（advanced 直通）继续承载查询，契约原样（Req 10.1）；本面结果携带的 revision 标记只用于并发检测语境。

secret 的输入、存储、输出三向分离（goal Scope direction）：

- **输入方向（开放）**：受权用户在 client 端输入新凭据，经**插件自身 remote**（插件自有的受权路径与 codec 校验）到达 host 侧插件 handler，handler 调用本面提交到同一 credential authority。
- **存储方向（官方）**：官方 credentials provider 是唯一存储 authority；门面零缓存、零影子状态。
- **输出方向（一律禁止）**：任何查询、错误、日志、RPC outcome、快照、异常 cause、client payload 不回显 secret 值；host 侧脱敏完成后才序列化（visibility-and-redaction §4）。

## Architecture

```text
authorized user (client)
   └─▶ plugin-owned remote (插件自有受权路径，插件 codec 校验输入)
         └─▶ host plugin handler
               └─▶ pluginApi.credentials.set/unset
                     ├─ 前置校验：ref 模式 / 非空值 / describe(ref).writable / owner 归因 / availability   [A]
                     ├─ revision 冲突检测（B 类声明式模拟：官方无 CAS 参数）                              [B]
                     ├─ official provider set/unset（唯一存储 authority，独占写入链）                      [A]
                     └─ 结果：冻结判别式 { ok, code, reason?, revision? }（无值）

官方事实流：official provider ──notifyUpdated──▶ Cordis 'credentials/updated' (ref)
              └─▶ 门面 events bus 既有桥接（events catalog 已登记，client remote 转发白名单已含）
              └─▶ 门面 revision 标记推进（唯一事实来源）
```

数据流单向：caller → 官方 provider（唯一 mutation owner）→ `credentials/updated` 事实 → 门面 revision 标记与既有观察面；门面不缓存、不影子凭据状态（Req 10.2）。

### 官方契约证据（冻结 runtime 实测）

| 官方事实 | 证据锚点 |
|---|---|
| 抽象 seam：providers 实现 resolve/describe/set/unset 四操作；`notifyUpdated(ref)` 只在写/重载**实际提交后**派发 `credentials/updated`（payload 仅 ref），listener 失败 contained | `dsh-credentials/lib/index.js` `CredentialProvider.notifyUpdated`（43–59）、模块文档（3–10） |
| ref 模式：`/^[A-Za-z_][A-Za-z0-9_]*$/`（POSIX shell identifier）；空值存储被拒（"use unset"）；层规则"空值即处处缺席" | `credentialRef`（12–21）；`dsh-credentials-local` `set`（274–277） |
| 本地 provider 写路径：独占操作链（settled tail queue）+ 跨进程文件锁 + 写前从盘重读（`reconcileFromDisk`）+ 原子替换（0600）；内存快照仅在写入成功后更新；`notifyUpdated` 仅在提交后调用 → **官方保证：写失败/抛错时原值保持生效，无半提交可见** | `write`（295–321）、`enqueue`（281–286）、模块文档（33–45） |
| 层级：继承进程 env（只读，胜）> 管理存储（可写）> `.env` 回退（只读）；env 影子下的写被官方拒绝（`assertUnshadowed`） | 模块文档（12–31）+ `assertUnshadowed`（327–329） |
| `describe(ref)` → `{ configured, source: 'env'|'file'|'project-env'|'user-env', writable }`；env 源 `writable: false`（只读 backend 的 ref 级信号） | `describe`（252–273） |
| `resolve(ref)` → `{ value, source } \| undefined`（值只存在于 host 侧） | `resolve`（234–251） |
| `unset` 对缺席 ref 是静默无操作提交（不 append、不 notifyUpdated） | `write` 内 `if (value === void 0 && existing === void 0) return;`（309） |
| **官方 seam 无 compare-and-set 参数/revision**（`set(ref, value)`、`unset(ref)` 签名实测） | `set`/`unset`（274–280） |
| 外部编辑热发布：watcher 重读 → `changedRefs` → 逐 ref `notifyUpdated` | `refresh`/`reconcileFromDisk`（354–386） |
| 官方组件无 client manifest、无 remote/slot/版本协商（服务行） | 官方 `package.json` 无 `dsh` 键（实测） |

### Namespace 放置（对照 registry 现状）

公共 path 定为**顶层 `credentials` 一等命名空间**（capability ID `credentials`），不是任何既有领域的子命名空间。逐一对照最近候选领域的排除理由：

- **不放 `settings.*`**：官方模型刻意分离"配置面"与"凭据存储"——settings 文档承载 *引用*（ref），从不看值；官方模块文档明言"configuration surfaces describe a reference without ever seeing its value"。把凭据写入挂到 settings 会把两个 authority 混在一个 namespace 下，且 `settings` 域契约（document mutation 有 scope/revision，`domain-composition.md` §2 `settings` 行）与凭据的 per-ref CAS/官方 provider 存储语义不同构。
- **不放 `security.*`**：facade `security` 域是插件贡献的 policy/redaction/egress **决策注册**面（idiom = policy/resourceRegistry）；凭据写入是 mutation，不是策略注册，与 plan-mode/preset 线同一论证。
- **不放 `profiles.*` / `storage.*`**：profiles 域是部署配置 bundle 的 inspect/apply/snapshot 契约；storage 是 owner 私有薄绑定（`durable-state-and-scope.md` §5 明言不作为共享 authority 载体）。两者都不承载"共享受管凭据 authority"。
- **一等领域的成立判据（public-api-shape §1）全部满足**：独立词汇（ref/resolve/describe/set/unset/updated）、独立资源身份（CredentialRef，官方 branded 类型语义）、独立使用场景（provider 集成的凭据生命周期管理，消费方横跨 settings/providers/models）；registry 现状亦把它作为独立官方服务 key + 独立事件（`credentials/updated` 在 facade event catalog 中已是一等事件名，不隶属任何领域前缀）。
- 与 `services.credentials`（resolve/describe，advanced 直通）分层共存（`llm.*` ↔ `services.llm` 先例）；`services.credentials` 白名单**不回流** `set`/`unset`（Req 8.1），resolve/describe 契约原样（Req 10.1）。

### Client 半面判定（capability-strategy §10 六问，逐项记录；Requirements 要求显式判定的 client 输入路径问题）

| # | 问题 | 判定 | 证据 |
|---|---|---|---|
| 1 | 被替换官方行是否声明 client manifest？ | 否 | 本 feature 无 replacement 行；官方 `dsh-credentials`/`dsh-credentials-local` 无 `dsh.client` |
| 2 | 是否注册 remote namespace？ | 否 | 门面不新增 remote；凭据写入的 client 输入经**插件自身 remote**（插件自有受权路径），不是门面公共 client 面 |
| 3 | 是否提供 slot 或 settings bridge？ | 否 | 门面不新增；官方 Models/设置页走官方自有 client 面，不在本面范围 |
| 4 | 是否有 client↔host 版本协商？ | 否 | 无新协议族（revision 标记是 in-process API 字段，不跨 wire——见 Data Models 注） |
| 5 | 是否有 browser-side state 或重连语义？ | 否 | 写面在 host；client 只提交、不持有凭据状态 |
| 6 | 官方行是否拥有 client-facing event/service？ | 部分（既有） | `credentials/updated` 在官方 gateway 的 client 转发白名单中，且门面 `client-remote-events` 转发表**已包含**它（`lib/client-remote-events.js` FORWARDED_REMOTE_EVENTS）——这是既有转发，本 feature 不新增 client 面、不修改该转发契约 |

**结论：host-only，本 feature 不新增公共 client 半面；client 录入路径 = 插件自身 remote → host handler → 本面。** 该判定同时回答 Requirements Introduction 留待 Design 的"client 录入路径是否需要公共 client 半面"：不需要——公共 client 半面会把"谁能写凭据"的授权面扩展到门面层，与 Req 6（低信任 remote 不得借面扩大权限）冲突；插件自有 remote 保持授权与插件业务绑定。

## Hook / Binding Classification

| 绑定/钩子 | 引出机制 | 分类 | 失败路径与 guard |
|---|---|---|---|
| `set`/`unset` → 官方 provider `set`/`unset` | 官方 ctx 服务受控包装（`ctx.get('credentials')` 存在性 + 写成员形状探测） | A（受控稳定化） | 服务缺失/写成员缺失 → feature 停用 + typed unavailable；官方抛错 → bounded typed 结果（见 Error Handling） |
| 提交前 backend 状态检查 → 官方 `describe(ref)` | 官方服务读（白名单成员） | A | describe 抛错 → typed unavailable（fail-closed，不提交） |
| revision 冲突检测 → 门面维护的 per-ref 标记 + 提交时比较 | **B 类底层模拟**：官方 seam 无 CAS 参数；门面以官方 `credentials/updated` 事实推进的标记做 optimistic compare | B（声明式模拟，fail-closed 默认） | 标记不可知 → typed `revision-unknown` 拒绝（fail-closed）；标记已知且不匹配 → `conflict`；模拟结果永不呈现为官方仲裁（Req 3.2） |
| 提交后事实 → 官方 `credentials/updated` | 官方派发点；门面 events bus 已有直绑桥接（events catalog 登记 `mode: 'emit'`、`payload: 'ref'`、`fault: 'contain'`） | A（官方事件直绑，复用既有桥） | 桥接缺失/降级 → 读面仍反映官方状态（Req 4.2：观察降级 typed，不伪造事件）；revision 推进停滞 → 标记判 `revision-unknown`（fail-closed） |
| idempotent same-value 检查 → 官方 `resolve(ref)`（host 内部） | 官方服务读；值只在 host 内比较，从不进入结果/日志/序列化 | A | resolve 失败 → 不做幂等跳过，走正常提交路径（保守） |
| audit ring | 门面 authority 内部组件（三线统一先例） | A（门面 authority 基础设施） | 写失败 → gap 标记，不伪造 |

## Components and Interfaces

### C1. Feature mount 与 availability guard

与 sibling 两线同构（fail-safe 挂载、namespace 常在、成员 typed unavailable 不抛穿）。`availability()` 反映官方 provider 与写成员的可达性（Req 9.1）：当挂载的 provider 暴露 namespace 级只读/降级信号时记 `degraded` 并附 bounded reason；观察桥/revision 推进降级同样记 `degraded`；服务缺失/错配记 `unavailable`。单个 ref 的只读/影子状态（env 影子）是 ref 级信号，由提交前 `services.credentials.describe(ref).writable` 检查承载（粒度对齐 public-api-shape §5：namespace availability 不掩盖也不替代 ref 级状态）。

### C2. 写面 `set(ref, value, options?)`（Req 1、3）

单次提交序列（async；官方 seam 为 Promise）：

1. **前置校验（任何副作用之前）**：
   - availability/owner：写 seam 不可用 → `unavailable`；caller fiber 不可归因 → `denied`（'owner-unresolved'，三线统一 fail-closed 规则）。
   - ref 模式：不符官方 ref 模式（`^[A-Za-z_][A-Za-z0-9_]*$`）→ `invalid-input`。
   - 值：空字符串/非字符串 → `invalid-input`（官方空值拒绝语义的前置化；"空值即缺席"由 `unset` 承载）。
   - backend 状态：官方 `describe(ref)` 返回 `writable: false`（env 影子，只读 backend）→ `read-only`，附 bounded reason（"由启动环境只读提供；请在启动 shell 处理"语义）；`configured === false` 与否**不阻止写入**（官方 provider 接受对任意合法 ref 建立存储值——这正是"先有 ref 写入、后有 provider 配置引用"的正常顺序，详见"ref/配置关联"注）。
   - revision 冲突检测（B 类，见 C4）：caller 提供 `options.expectedRevision` 且与门面当前标记不匹配 → `conflict`（不匹配已知标记）或 `revision-unknown`（无标记证据）——均不提交。
2. **幂等检查（声明式，Req 4.3）**：host 内部调用官方 `resolve(ref)`；当 `source === 'file'`（管理存储自身持有该 ref）且存储值 === 提交值 → **跳过官方写 seam**，返回 `{ ok:false, code:'unchanged', reason:'value already stored', revision: <当前标记> }`——与官方 preset `apply` 的"已生效不 append"同构，三线统一的"无操作类"呈现（ok:false）；不产生重复 `credentials/updated` 事实、不推进 revision。resolve 失败则不做跳过，走正常提交（保守方向）。
3. **官方提交**：调用官方 `set(ref, value)`；await 完成 = 官方真实持久化（官方独占写链 + 原子替换 + 提交后 `notifyUpdated`）→ `{ ok:true, code:'committed', commitState:'success', ref, revision: <提交后标记>, persistedAt }`（Req 1.1：success = 真实持久化）。
4. **失败映射**：官方抛错 → `{ ok:false, code: 'read-only'|'unavailable'|'internal', reason }`（按官方错误语义归类：影子/只读类 → `read-only`；disposed/后端缺失类 → `unavailable`；其余 → `internal`），reason 经 bounded 化 + secret 形状过滤（官方错误消息含 ref/路径，不含值；防御性过滤见 Error Handling）。

**ref/当前配置关联的校验边界（goal"ref 与当前配置关联的校验先于副作用"的落地声明）**：门面能校验的"当前配置关联"= 官方 backend 对该 ref 的当前状态（模式合法性、可写性、影子/只读——即 C2 步骤 1）。**caller 配置对 ref 的业务关联**（如"该 ref 是我 provider 配置引用的那个 key"）属于插件业务语义——官方模型下配置面只持有 ref 字符串，门面没有、也不应建立"哪个插件配置引用哪个 ref"的注册表（那会变成第二套配置 authority）。真实消费者先例（`dsh-vision-toolkit/src/web.ts` `saveCredential`）正是插件在自身 settings 描述符上校验 ref 关联与 revision 后才调用凭据写入；本面为该模式提供受支持的底层动作。设计不把插件业务关联检查收编进门面（克制设计；跨线归 `interactive-session-access`/各插件自身 remote 契约）。

### C3. 写面 `unset(ref, options?)`（Req 2）

1. 前置校验同 C2（ref 模式、owner、availability、revision 检测；无值检查）。
2. 官方 `unset(ref)`；官方对缺席 ref 是静默无操作提交（实测）→ 声明的 typed 结果：**`{ ok:false, code:'unchanged', reason:'ref absent; nothing to remove' }`**（幂等呈现，与三线"无操作类"一致；Req 2.2 的 declare 分支选定）。存在则移除 → `{ ok:true, code:'committed', commitState:'success', ref, revision }`；此后官方 `resolve` 按官方层级回退（env > 无 > `.env` 回退）（Req 2.1）。
3. 失败映射同 C2 步骤 4；官方保证失败时原值保持生效（Req 2.3）。

### C4. Revision 标记与并发冲突（Req 3；声明的 B 类模拟规则）

- **标记来源（唯一事实）**：官方 `credentials/updated` 事件（官方只在真实提交/热发布后派发，payload 仅 ref）。门面为每个 ref 维护单调递增的不透明整数标记：首次观察到该 ref 的事件即 `known`，每事件 +1。标记是**资源状态 revision**（跨 caller 可比，同 settings 文档 revision 先例），不是 owner generation（`identity-and-lifecycle.md` §2 的 owner-specific generation 不适用于共享资源状态——标记全部派生自同一官方事实流）。
- **暴露位置**：只出现在本面结果（committed/unchanged/conflict 的 `revision` 字段）与 conflict 上下文中；不新增公共读成员、不进入 `services.credentials` 契约（Req 10.1）、不跨 wire（in-process API 字段；client 经插件 remote 获得的是插件自有契约）。
- **比较规则（Req 3.1 的"caller 上次观察状态"载体）**：caller 从上一次本面结果取得 `revision`，作为 `options.expectedRevision` 回传；提交时与门面当前标记比较：
  - 匹配 → 提交（官方独占写链仍为最终裁决，官方层并发由官方队列/文件锁串行化）。
  - 不匹配（已知标记）→ `{ ok:false, code:'conflict', ref, expectedRevision, currentRevision }`（bounded 上下文，无值；Req 3.4 的重读重试指引字段）。
  - 无标记证据（facade 挂载后未观察到该 ref 的任何事件——外部编辑先于挂载、或观察桥降级）→ fail-closed：**提供 expectedRevision 的提交被拒** `{ ok:false, code:'revision-unknown' }`；不提供 expectedRevision 的提交放行（官方独占写链保证持久化原子性）——这是声明的 bootstrap 规则：首次写入建立标记基线，此后可用 optimistic CAS（Req 3.2 的"typed rejection or the design-declared fallback"选定后者并显式声明）。
- **并发提交裁决（Req 3.3）**：两个受权 writer 并发提交不同值：官方 provider 的独占操作链把它们串行化，逐个原子提交——最终存储值是官方串行序的最后一个提交（官方仲裁）；两个 caller 各自在自己的提交完成点取得真实结果（都 `committed` 不是伪成功——各自确实先后持久化）。门面不制造第二个赢家裁决；`conflict` 只由 expectedRevision 检测产生（caller 显式声明了乐观前提）。"at most one claims success"在声明乐观前提的同一提交窗口内成立：同一 expectedRevision 的两个并发提交，只有一个能与当时标记匹配通过比较点（比较点在门面同步段内执行），后到者得 `conflict`。
- **取消**：写操作是短事务，无 signal 参数（官方 seam 无取消点；Requirements concurrency 分册结论"无取消面（写操作短事务）"）；Promise rejection 即失败终态，无在途补写（官方快照更新只在成功后）。

### C5. 事件复用与可见状态（Req 4）

- 提交后可见状态 = 官方 `credentials/updated`（producer authority 保留在官方 credentials authority；门面 events bus 既有直绑桥与 client 转发白名单已承载，本面**零新增事件、零自产事实**——Req 4.1）。
- 后续 provider 请求读到新值：官方 resolve 每次 fan 到 provider（官方"resolve once per operation"语义），无门面缓存（Req 10.2）。
- 幂等：same-value 提交在 C2 步骤 2 被跳过 → 不发重复事实（Req 4.3）；unset-of-absent 官方本就不派发。
- 观察桥降级：读面（官方 resolve/describe 直通）仍反映官方状态；本面 availability 记 `degraded`；revision 推进停滞 → 提供了 expectedRevision 的提交 fail-closed（Req 4.2 的 typed 降级，不伪造事件）。

### C6. 信任与授权边界（Req 6）

- 无门面 IAM（goal Boundary）；授权输入 = owner 可归因 + 官方服务/写成员可达 + 官方 backend 可写性（describe）。任一不可确定 → fail-closed typed 拒绝（Req 6.2）。
- 低信任 remote 不得借面获得写能力：无公共 client 半面（六问判定）；client 值只经插件自身 remote 进入该插件自己的 handler；门面归因 handler 所在插件，不信任 client 声明身份（Req 6.1/6.3）。
- caller 自报 owner 不接受；不可归因 → `denied`（三线统一）。

### C7. 审计与可追溯（Req 7）

三线统一 v1 载体：feature-authority 内部有界内存环（容量 512、`truncated`/`gapSince`、深冻结、进程作用域、**非 durable、不新增存储档位**）。记录字段：`{ seq, at, ownerId, action: 'credential.set'|'credential.unset', ref, outcome }`——**只含元数据，永不含凭据值**（Req 7.1/7.3）。写失败保留效果 + gap 标记；v1 无公共审计查询成员（Stage 4 经内部测试缝取证）。

## Data Models

```text
set/unset 输入   set(ref, value, { expectedRevision? }) ; unset(ref, { expectedRevision? })
结果             { ok, code, reason?, ref?, revision?, expectedRevision?, currentRevision?, persistedAt? }  // 冻结；永不含凭据值
revision 标记    per-ref 不透明单调整数；来源 = 官方 credentials/updated 事实；in-process only（不跨 wire、不入 durable）
audit 记录       { seq, at, ownerId, action, ref, outcome }   // bounded、脱敏、冻结出环
availability     { status, reason? }                           // 冻结
```

结果码集合（本面领域码）：`committed` / `unchanged` / `conflict` / `revision-unknown` / `read-only` / `invalid-input` / `denied` / `unavailable` / `internal`。统一词汇与 sibling 两线一致（`ok/code/reason`；`commitState:'success'` 仅 committed）。

## Secret Visibility And Redaction（Req 5；visibility-and-redaction 分册逐出口边界）

| 出口 | 机制 | 保证 |
|---|---|---|
| `describe`/`resolve` 读面 | 既有 `services.credentials` 直通契约原样（describe 只含 configured/source/writable；resolve 的值仅在 host 内） | 契约不变（Req 10.1）；本面不新增会携带值的读成员 |
| 本面结果 / RPC outcome | 结果字段白名单（Data Models）；值不在字段集合中，结构上无法携带 | fail-closed：新增字段须过本设计修订，不动态扩展 |
| 审计 | 只记 ref/owner/时间/outcome 元数据（C7） | 值按构造不入环 |
| 日志 | 门面日志只含 bounded code/ref/动作；官方 provider 日志（notifyUpdated listener 失败等）官方已只打 ref | 门面侧 reason 输出前过 bounded 化 + secret 形状过滤（复用 `lib/security-redaction.js` 的 `isSecretShapedString/isSecretShapedKey` 既有机制） |
| 异常 cause | 官方错误 → 门面 typed code + bounded reason；原始 cause 不进入结果/序列化，只在 host 日志按上述过滤后输出（错误链含值的可能被形状过滤拦下；**无法证明已脱敏的 outlet 一律省略内容**——Req 5.4 fail-closed） | host 侧完成，先于任何序列化 |
| 快照 | 本面不产生任何凭据状态快照/投影 | 无出口 |
| client payloads | 无公共 client 半面；`credentials/updated` 转发 payload 仅 ref（官方 + 既有转发契约，不含值） | client 只验证形状，从不承担脱敏（visibility-and-redaction §4） |
| 输入方向 | client → 插件 remote → host handler → 本面；值单向向下，不回显 | 插件 remote 的输入校验是插件自有 codec 契约（dsh-api-remotes）；本面收到后值只流向官方 provider |

**三向分离结论**：输入开放（经插件自有受权路径）、存储官方唯一、输出全出口禁止/脱敏，且"不得向 UI 输出 secret"不取消录入功能（goal Boundary；录入与回显是两个数据方向）。

## Concurrency And Conflict Rules（concurrency-and-cancellation §6 声明）

- **并发策略**：`compare-and-swap`（门面 revision 标记 optimistic compare，B 类声明）叠加**官方独占写链**（provider 单文档串行 + 文件锁 + 原子替换）作为最终 mutation owner——每份共享状态只有一个并发语义 owner（官方 provider），门面标记不构成第二仲裁（§1.4）。
- **scope 与冲突判定**：scope = 单个 ref 的存储状态；判定 = expectedRevision 比较（乐观前提由 caller 显式给出）+ 官方串行提交。
- **取消行为**：无取消面（短事务）；失败 = typed 终态，原值保持（官方保证）。
- **提交条件**：官方写 Promise 完成 + 官方提交后事实（notifyUpdated）；无官方提交即无成功（门面不预发成功）。
- **cleanup owner**：feature disposer（revision 标记表、事件桥订阅、审计环）；标记随进程生命周期，不跨重启承诺（非 durable，诚实标注）。
- **stale 处理**：观察桥 dispose 后到达的事件不推进已停用表；feature 重载后标记从零重建（`revision-unknown` fail-closed 兜底，不猜测跨生命周期连续性）。

## Error Handling And Guard Strategy

- fail-safe 挂载；官方 provider 缺失/写成员缺失 → 各面 typed unavailable，不影响主门面与其余能力（Req 9.2 的局部失效隔离；`services.credentials` 读直通由其自身白名单条目治理，不连带）。
- 官方抛错归类映射（C2 步骤 4）；错误 reason 出口统一过 bounded + secret 形状过滤；无法证明脱敏的 outlet 省略内容（fail-closed，Req 5.4）。
- revision 模拟的诚实性：B 类检测结果在 registry 登记与文档中标注为门面模拟，永不表述为官方仲裁（Req 3.2）；模拟层自身故障（标记表不可用）→ 一律 `revision-unknown`（fail-closed），不退化为放行。
- 幂等跳过只做 value 相等 + `source === 'file'` 双条件；任一不确定即走真实提交（保守方向，不制造虚假 unchanged）。
- 治理代号不进入实现命名（运行时命名 `credentials.set` 等中立能力词）。

## Authority Closure（composition-and-authority §6；Req 8）

| 写路径 | 归属 |
|---|---|
| `credentials.set`/`unset`（门面） | 唯一受支持门面写路径（owner/审计/冲突检测/typed 结果） |
| 官方 provider 写 seam | 唯一存储 authority 与最终 mutation owner（独占写链）；官方 Models/设置页等官方产品面经官方自有路径写同一 seam——统一 authority = 官方 provider；门面不拦截官方路径 |
| 插件私有 storage / 直接写 `.env`/配置文件 / 泛化 settings 写入 | **非替代品**（Req 8.2）：门面不提供、文档不宣传任何此类 shim；`.env` 层是官方只读回退层，不是写目标 |
| 直接 inject/import 官方 credentials 组件 | unsupported escape hatch，门面不声称拦截（Req 8.3） |

## Registry 拟新增行（设计陈述，Stage 4 落地时同步 canonical registry）

| publicPath | idiom | effect | composition | conflictRule | scope | authority | runtime |
|---|---|---|---|---|---|---|---|
| `credentials.set` | mutation | mutate | coordinated | compare-and-swap | profile | official credentials provider（唯一存储 authority） | host |
| `credentials.unset` | mutation | mutate | coordinated | compare-and-swap | profile | official credentials provider | host |
| `credentials.availability` | selfDescription | read | pure | not-applicable | profile | facade | host |

capability ID：`credentials`；scope 取 `profile`（凭据存储位于 harness home 的 profile 级文档，非 session/workspace）；`eventCatalog` 无新增事件（`credentials/updated` 已登记，producer authority 官方）。B 类冲突检测在本表 conflictRule 语义与 design 文字中双处标注。

## Testing Strategy（对应 Req 11）

1. **写语义**：set/unset/unchanged/未设置 unset 的 declared 结果；ref 模式与空值前置拒绝；官方提交后真实持久化（后续官方 resolve 读到新值 / unset 后官方层级回退）；写失败保持原值（注入后端故障：无半提交、resolve 返回原值）。
2. **冲突**：expectedRevision 匹配/不匹配/无证据（revision-unknown）三分支；同 expectedRevision 并发提交的确定裁决；conflict 上下文字段（expected/current）存在且无值暴露；B 类模拟标注在 registry 断言中。
3. **脱敏清扫**：逐出口断言值缺席——describe、availability、audit、日志、RPC 结果、快照（无此出口）、异常 cause、client payload（含 malformed 与 failing write 场景）；形状过滤的 fail-closed 行为。
4. **信任与降级**：不可归因 denied 且状态不变；env 影子 ref 的 read-only 拒绝（describe writable:false → 不触 seam）；只读 backend/unavailable；无关能力隔离；两个 synthetic plugin 反向注册顺序 + owner 派生。
5. **事件复用**：提交后 `credentials/updated` 经既有 events bus 桥可达（本面零新增事件）；same-value 跳过不发重复事实；观察桥降级 typed。
6. **registry/surface**：逐成员登记（单一主 idiom）、snapshot 一致、受护 `npm test`、`git diff --check`、registry/surface 一致、全局终审（Req 11.5）。

## Standards Alignment（逐分册结论）

- `capability-strategy.md`：适用。A 类受控包装 + 一处声明式 B 类模拟（官方无 CAS，fail-closed）；无 R slice；`services.credentials` 白名单写路径不回流、读契约原样；§10 六问 → host-only；冻结基线内交付。
- `api-shape.md`：适用。主面 mutation；describe/availability 只读；无策略注册、无汇总投影；一面原则满足。
- `api-idioms.md`：适用。mutation 判别式结果与幂等/冲突语义（§3.3）；事件面按 §4（fact 归官方 authority，本面零自产事件）；统一词汇与 sibling 两线同表。
- `public-api-shape.md`：适用。顶层 `credentials` 一等领域的成立判据逐条论证（§1）；namespace 常在；不引入 package/row 身份；与 `services.credentials` 分层共存不重复 authority。
- `composition-and-authority.md`：适用。owner 派生不可伪造；authority closure（官方 provider 唯一 owner、门面写路径唯一、私有 storage 非替代）；composition `coordinated`；§9 合作模型下不做 IAM。
- `domain-composition.md`：适用。credentials/settings/storage 各归其主：settings 持 ref、credentials 持值、storage 是 owner 私有；本面不吸收 settings/storage 职责。
- `ordering.md`：**not applicable**。无多 owner 顺序决策、无事件排序语义（与 Requirements 分册结论一致）。
- `identity-and-lifecycle.md`：适用。统一终态词汇经 `commitState`（仅 committed）；无新终态词；revision 是资源状态标记（settings revision 先例），不与 owner generation/seq/epoch 混用（§2 语义分界显式声明）。
- `durable-state-and-scope.md`：适用。凭据持久性归官方 provider（真实持久化语义由官方层声明与保证）；门面 revision 标记与审计环均非 durable、诚实标注；不新增第四档 scope。
- `visibility-and-redaction.md`：适用（核心分册）。三向分离；逐出口脱敏表（§3 的覆盖边界要求）；host 侧脱敏先于序列化、client 只验形状（§4）；审计只记元数据；无法证明脱敏的 outlet fail-closed。
- `concurrency-and-cancellation.md`：适用。§6 声明见上（compare-and-swap + 官方独占 owner；无取消面短事务；标记表 cleanup owner；跨生命周期不猜测）。
- `versioning-and-protocols.md`：适用。冻结基线内交付；无新 wire/durable 协议（revision 标记为 in-process API 字段，不构成协议族，不需要 wire/durable revision）。

## Requirements Traceability

| Requirement | 设计承载 |
|---|---|
| Req 1 受控 set/update | C2（前置校验 + 幂等 + 官方提交 + 失败映射 + ref/配置关联边界声明） |
| Req 2 受控 unset | C3（含 absent 的 declared 结果与官方回退层级） |
| Req 3 并发写冲突 | C4（B 类模拟规则、bootstrap、三分支、并发裁决） |
| Req 4 可见状态与事件一致 | C5（官方事件复用、降级 typed、幂等无重复事实） |
| Req 5 secret 三向可见性 | Secret Visibility 表（逐出口机制 + fail-closed）+ 六问判定（输入路径） |
| Req 6 信任与授权边界 | C6（归因 + 官方可写性 + fail-closed；无 client 半面） |
| Req 7 审计 | C7（三线统一 v1 环，只记元数据） |
| Req 8 authority closure | Authority Closure 表（官方唯一 owner + 非替代声明） |
| Req 9 availability/降级 | C1（含 ref 级只读信号放 describe 的 granularity 论证） |
| Req 10 读面回归守卫 | Architecture（零缓存零影子）+ Namespace 放置（services 契约原样） |
| Req 11 验证与交付门 | Testing Strategy |
