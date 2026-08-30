# 组合与 Authority 标准

> 适用范围：所有由多个第三方插件共同使用的 facade 语义、注册表、策略、变更、事件生产权和生命周期。
> 关联：语义三面见 `api-shape.md`；公共形状见 `public-api-shape.md`；身份和终态见 `identity-and-lifecycle.md`；并发与取消见 `concurrency-and-cancellation.md`；各领域最低要求见 `domain-composition.md`。

## 1. 兼容层次

每个公共成员必须明确保证到哪一层：

1. **形状稳定**：名称、参数、返回和错误契约稳定。
2. **生命周期稳定**：注册、重载、卸载和 stale cleanup 不误伤其他 owner。
3. **组合稳定**：多个 owner 同时使用时结果确定，或明确表达插件作者需要承担的顺序后果。
4. **Authority 稳定**：所有受支持的写路径服从同一个 state owner、策略和冲突规则。

推荐语义 API 应覆盖四层。`services.*` 默认只承诺第一层，其他保证按成员登记，不能按整个 service 推断。

## 2. Composition mode

每个公共成员必须登记一种主要组合模式：

| Mode | 含义 | 最小机制 |
|---|---|---|
| `pure` | 对其他插件不可观察地改变共享状态 | 无共享副作用；不泄漏可写 live object |
| `additive` | 多 owner 增加相互隔离的条目或 observer | owner 归因、同 key 冲突规则、identity-bound disposer |
| `ordered` | 多 owner 参与 transform、policy 或 decision | additive 要求，加固定 priority、注册顺序、领域 reducer 和 callback containment |
| `coordinated` | 多 owner 可能写同一逻辑资源 | resource identity、scope、generation 与最小 CAS/fencing/transaction |
| `exclusive` | 同一 scope 只能有一个 authority | 静态 claim 和副作用前冲突检查 |

`transactional`、`latest-wins`、`waterfall` 等是实现机制或冲突规则，不新增 composition mode。

## 3. Composable Profile

可组合子集由以下部分组成：

```text
Composable Profile
├── pure queries and frozen projections
├── observe-only additive subscriptions
├── owner-scoped additive registrations
├── deterministic ordered transforms/policies
└── explicitly declared coordinated mutations
```

- `pure`、满足约束的 `additive` 和 `ordered` 默认可以进入该 profile。
- `coordinated` 只有在插件声明 resource/scope 且通过门面仲裁后才能进入。
- `exclusive` 不属于无声明的默认 profile；取得唯一 claim 后才可作为受控能力使用。
- 未完成 composition 审计的 API 不得标为推荐。
- composition contract 是审查词汇，不要求所有 API 共用重量级运行时；每个成员只实现其真实 mode 所需的最小机制。

## 4. Pure 的强定义

`pure` 不是“方法名像查询”：

- 不写共享状态，不注册 provider/listener，不改变全局选择、缓存 authority 或默认配置。
- 不返回可直接修改共享状态的 live object；返回值必须是冻结快照、不可变 value 或只读 handle。
- 可以懒加载，但不得改变其他插件可观察的业务结果。
- `get()`、`list()` 和 getter 必须逐项审计，不能按名称自动标记 pure。

## 5. Owner、Key 与生命周期

所有注册、策略和 mutation API 统一遵守：

1. owner identity 优先从调用方 Cordis fiber/插件身份派生，不接受调用方伪造 owner。
2. 调用方提供的内部 `id` 只在本 owner namespace 内有意义；跨 owner 同名不得静默覆盖。
3. 仅供机器关联的私有 key 应自动 owner-qualification。tool 名、command 名、remote service key 等用户可见全局名称不得静默改名，必须使用共享、冲突拒绝或 claim 规则。
4. `latest-wins` 只允许发生在同一 owner、同一逻辑 key 内。
5. disposer/handle 必须绑定 owner、resource key 和 generation；stale disposer 返回 typed no-op，不能删除新 generation 或其他 owner 的资源。
6. 普通事件监听同 priority 按成功注册顺序执行；需要业务顺序的 feature 必须使用固定 priority、明确依赖或领域内规则（见 `ordering.md`），不依赖隐式“谁先加载”来证明业务正确性。
7. 返回的 live handle 不得泄漏无边界共享写 authority；只读需求返回冻结投影，写需求返回能力受限的 opaque handle。
8. callback 失败只按当前决策点的 containment 规则影响该 owner，不得破坏 registry 或其他 owner。

## 6. Authority closure

当高层 API 声称维护某个不变量时，所有受支持的同资源写路径必须满足以下之一：

1. 经过该高层 authority 的 policy、coordination 或 transaction；
2. 被明确声明为另一个互斥 authority，并在组合前检测冲突；
3. 被排除在 Composable Profile 之外，并明确列出会旁路的高层保证。

否则高层不变量只能描述自身调用路径，不能成为门面的全局保证。

公共契约清单中每个成员至少登记：

```text
publicPath
capability
runtime: host | client | both
effect: read | subscribe | register | decide | mutate | execute
composition: pure | additive | ordered | coordinated | exclusive
stateOwner
scope
resourceKey
identitySource
conflictRule
lifecycle
bypasses
```

`bypasses` 必须说明是否绕过 transaction、security policy、audit、branch、routing 或其他高层 authority。没有完成 authority map 的成员不能进入推荐面。

## 7. Static claim 与 Preflight

第三方插件可以在 manifest 中声明组合需求，概念形状如下：

```js
pluginApi: {
  requires: {
    api: '>=B.C <next-B',
    capabilities: ['llm.adapters', 'sessions.branches'],
  },
  claims: [
    { resource: 'sessions.title.provider', scope: 'root', mode: 'exclusive' },
    { resource: 'workspaces.files', scope: 'workspace', mode: 'coordinated' },
  ],
}
```

- profile 组合/preflight 应在插件产生副作用前检查 capability 与 claim 冲突。
- claim resource 使用公共语义 dot path，不使用 slash event name、package 或 mounter 名。
- manifest claim 只声明 authority 类别、singleton 占用或可申请的 resource class，不是具体资源实例的 possession/fencing token。
- 动态资源实例仍须在调用时通过 coordinated API 获取 identity-bound handle；静态声明不能跳过 generation、CAS 或 fencing 校验。
- owner identity 来自实际插件装配身份，manifest 不能自报另一个 owner。
- exclusive 冲突应确定性拒绝；coordinated claim 必须解析到具体 scope/resource authority。
- 未声明的 singleton/shared mutation 不进入 Composable Profile。
- 静态检查不能证明业务结果一致，只排除已知 authority、版本、scope 和组合模式冲突。

## 8. 策略、Transform 与事件

- 通用 `waterfall` 只能提供调用机制，不能替代领域组合规则。
- 订阅权与生产权分离：`on/once` 可以是 additive consumer 面；canonical system event 的 `emit/serial/parallel/bail/waterfall` 只授予其 producer authority。
- 第三方自定义事件只能通过 owner-scoped `events.define` 取得能力受限的 publisher handle，不能依赖一个可派发任意系统事件名的全局入口。**当前 `events` 面未提供 `define` 与 publisher handle**（面成员为 `catalog / on / once / emit / serial / parallel / bail / waterfall`），因此第三方自定义事件当前没有受支持的派发入口。
- 每个多插件决策点必须写明 decision vocabulary、支配元素、多个 transform 的合并规则、priority 相同的注册顺序、callback 失败策略、reducer 的幂等/结合性或顺序依赖，以及输出是否冻结并携带 owner/provenance。
- 关键决策点优先使用领域 typed decision 和 reducer，不向第三方只暴露可返回任意对象的裸 waterfall。

## 9. 善意但有 Bug 的插件模型

门面面向合作但可能有缺陷的第三方插件。组合保证覆盖：malformed/越界输入、重复注册/apply/dispose、漏 dispose、意外同名、callback throw/rejection、共享异步管线挂起、abort/卸载/generation 更新后的迟到 callback、并发调用、错误顺序、冲突重放、未声明 claim 的调用和已证实的共享集合无界增长。

明确排除：主动绕过门面、私有 import、身份伪造、凭据窃取、同步无限循环、主动资源攻击以及宿主进程/内核隔离。claim 只解决组合 authority，不构成安全权限系统。

门面只约束共享资源和 owner 边界，不限制插件自己的内部计算、私有状态组织和业务流程。合法 owner 在自身 scope/resource 内取得 handle 后，不受额外沙箱式限制。

## 10. 失败语义

- 门面 core 不可用：统一 inactive error。
- capability 调用前不可用：统一 capability-unavailable error。
- 注册 key/owner/claim 冲突：稳定的 conflict typed result/error，包含可公开的 resource/scope，不泄漏私密状态。
- 正常业务拒绝、竞争和 stale generation：判别式 typed result，不伪装为异常崩溃。
- 已启动且可能产生副作用的长操作：返回 handle 与唯一 terminal outcome。
- 插件 callback 异常：按决策点 containment，不抛穿 apply/dispatch，不改变其他 owner 的注册状态。
- `undefined` 只用于领域明确的合法缺失，不同时表示 unavailable、conflict 和 unknown。

## 11. 开发期证明与运行时检查

每一种公共组合原语都必须用两个独立 synthetic plugin 验证：反向加载顺序的声明行为、同 key 冲突、卸载隔离、callback 失败、旧 disposer/generation、scope/resource 隔离、冲突归因、ordered reducer 重复运行、coordinated stale fencing/CAS、exclusive claim 副作用前拒绝、authority closure，以及 pure view 不泄漏写 authority。client 的 slot/remote/settings/lifecycle 也执行同等级测试。

运行时不重复执行开发期的两两测试，只保留 caller owner 派生、key/claim 冲突、generation/stale disposer、CAS/fencing 和 callback containment 等廉价检查。显式 `conflict`、`stale` 或 `unavailable` 是契约规定的兼容结果，不等同于运行时失控。
