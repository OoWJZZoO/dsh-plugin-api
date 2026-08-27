# 插件私有状态与生命周期标准（M7）

> 适用范围：第三方插件只供自身实现使用的持久或半持久状态。
> 关联：通用 scope 与 durable mutation 见 [`../durable-state-and-scope.md`](../durable-state-and-scope.md)；owner、generation 和 disposer 见 [`composition-and-authority.md`](composition-and-authority.md) 与 [`../concurrency-and-cancellation.md`](../concurrency-and-cancellation.md)。

## 1. 责任边界

门面可以提供基于官方 `storageDomain` 的 owner-scoped、scope-bound 薄绑定层，概念上归入 `pluginApi.storage`。该层只解决稳定命名、作用域绑定、handle 生命周期和最小 schema envelope，不实现新的存储后端或数据库平台。

- owner 从调用者上下文自动派生；插件只声明 owner 内的局部 store 名称。
- 插件私有 storage 只保存单一 owner 的私有实现数据。
- `settings` 保存用户可配置数据；session/domain API 保存公共领域事实；memory 保存用户或 Agent 语义记忆；插件 storage 不替代这些领域。
- 多插件共享状态不得借插件私有 storage 绕过相应领域的 authority、coordination 或 transaction。

## 2. Durable scope

首版 durable scope 仅为：

- `profile`：插件配置、能力状态或 profile 级实现数据；
- `workspace`：项目/工作区范围的插件实现数据；
- `session`：单次会话范围的插件实现数据。

不增加 `agent` scope。每类 durable 记录必须明确归属且只归属其中一档；跨档需求拆分为多个记录或 feature，不用单一记录横跨两层。

## 3. Schema envelope

每类记录只使用 schema ID、整数 version 和 data；概念上至少包含：

```js
{
  schema: 'plugin.example-state',
  version: 1,
  owner: 'derived-owner',
  scope: { ... },
  id: '...',
  data: { ... },
}
```

- 旧版本读取由插件附近的局部 decoder/upcaster 负责。
- 未知未来版本返回 `unsupported-schema`，不猜测、不静默丢字段。
- 新 writer 只写当前版本；没有升级读取需求的数据不预建 migrator。
- 具体 `open/get/put/delete` 等方法形状、domain identity 映射、typed failure 和 conformance test 必须在对应 feature spec 中确定，本标准不冻结这些名字。

## 4. 生命周期

- 插件停用或重载时关闭该插件持有的 storage handle。
- 关闭 handle 不删除数据；插件卸载默认保留数据。
- 永久删除只能由显式 purge 操作触发，不能由普通 disable、reload 或 uninstall 隐式触发。
- 旧 handle 在关闭后不得继续写入；stale disposer/回调不得影响新 generation 或其他 owner。

## 5. 明确不做

首版不提供：

- 通用 migration framework；
- per-plugin quota；
- secret storage；
- 跨 store transaction；
- 通用 CAS/fencing；
- 自动备份恢复；
- orphan collector；
- 插件自选 backend。

`services.storage` 与 `services.storageDomain` 继续作为 advanced、runtime-bound passthrough，但不因此获得默认 Composable Profile 保证。任何需要共享 authority、并发协调或公开领域事实的状态，必须进入相应领域 API，而不能藏入插件私有 storage。
