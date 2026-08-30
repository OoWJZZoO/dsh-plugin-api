# 持久状态与作用域标准（durable state & scope）

> 适用范围：所有写持久/半持久状态的 feature（durable observation、lease/coordination、checkpoint、workspace mutation transaction、附件处理记录、第三方插件私有 storage 等）。
> 关联：终态词汇见 `identity-and-lifecycle.md` §3；并发取消、提交资格与 retry 传播见 `concurrency-and-cancellation.md`；durable mutation 面在 API 形状中的位置见 `api-shape.md` §1；fail-safe 底线见 AGENTS.md。

## 1. 存储作用域分层（scope 即存储契约）

| 层 | 适合的数据 |
|---|---|
| session | 对话、turn、execution observation、session branch、prompt provenance |
| workspace | 文件 lease、项目任务、checkpoint、跨 session coordination |
| profile | 插件配置、能力状态、用户预算、profile 安装状态 |

- 每个 durable 记录必须**归属且只归属其中一档**，并在 design 中显式声明。
- 跨档需求 = 拆分为多个记录/feature，不得用单一记录横跨两层。

## 2. durable mutation 面契约

- 记录身份：identity（owner 域内唯一）+ generation（owner-specific opaque token，见 `identity-and-lifecycle.md` §2）+ commitState（统一终态词汇，见 `identity-and-lifecycle.md` §3）。
- 事务性：多步变更必须提供 commit/rollback（或等价 fail-closed 语义）；**不允许半提交状态对外可见**。
- fail-closed：未知/未声明的操作默认拒绝；审计可追溯（who / what / when / generation）。
- 副作用可证明：超出声明 API 的副作用必须可证明（与 `capability-strategy.md` §3.5 一致）。

## 3. 操作能力声明与 retry 语义

- **按 operation 声明能力**（幂等？可自动重试？fail-closed？）；未知或未声明时**默认不自动 retry**。
- **retry ≠ 重新执行同一 execution**，必须显式区分：
  - execution-1 内 attempt-1 → error、attempt-2 → success：同一 execution identity，重试在 attempt 层级；
  - provider、tool 或其他内部驱动的自动重试仍属于同一 execution，但每次重试都必须增加一个 attempt；不得用“operation 层重试”绕过 attempt 身份与审计。
  - 内部驱动的 tool/provider 自动重试通常复用 execution；由模型、用户或其他外部调用再次发起的相同操作创建新的 execution，并应记录 parent/cause（如可用）。
  - 区分不清会导致 usage、budget、route、audit 全部混乱；feature design 必须声明其 retry 属于哪一层。

## 4. 失败分类（决定可否自动重试）

| 类别 | 例子 | 自动 retry |
|---|---|---|
| transient | 暂时网络断开、provider 503、MCP server 临时不可用 | 允许，但必须有边界（次数/退避/超时） |
| permanent | 参数错误、权限不足、schema 不匹配、文件不存在 | 通常禁止 |
| aborted | 用户取消或 AbortSignal 触发 | 禁止（不是 transient） |
| denied | approval 拒绝 | 禁止自动绕过 |
| superseded | 旧 generation/attempt 已被新操作取代 | 禁止继续补写结果 |

- 分类必须落在 operation 能力声明（§3）里，不得由调用方事后猜测。

## 5. 第三方插件私有 storage（与公共领域状态分离）

`pluginApi.storage` 是基于官方 `storageDomain` 的 **owner-scoped、scope-bound 薄绑定层**。它只解决稳定命名、作用域绑定、handle 生命周期和最小 schema envelope，不实现新的存储后端或数据库平台。

责任边界：

- owner 从调用者上下文自动派生；插件只声明 owner 内的局部 store 名称。
- 插件私有 storage **只保存单一 owner 的私有实现数据**。
- `settings` 保存用户可配置数据；session/domain API 保存公共领域事实；memory 保存用户或 Agent 语义记忆；插件 storage **不替代这些领域**。
- **多插件共享状态不得借插件私有 storage 绕过相应领域的 authority、coordination 或 transaction。**

Durable scope 与 §1 同构，只有三档：`profile` / `workspace` / `session`。不增加 `agent` scope；跨档需求拆分为多个记录或 feature，不用单一记录横跨两层。

Schema envelope：每类记录只使用 schema ID、整数 version 和 data，概念上至少包含：

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

生命周期：

- 插件停用或重载时关闭该插件持有的 storage handle。
- 关闭 handle 不删除数据；插件卸载默认保留数据。
- 永久删除只能由显式 purge 操作触发，不能由普通 disable、reload 或 uninstall 隐式触发。
- 旧 handle 在关闭后不得继续写入；stale disposer/回调不得影响新 generation 或其他 owner。

当前不提供：通用 migration framework、per-plugin quota、secret storage、跨 store transaction、通用 CAS/fencing、自动备份恢复、orphan collector、插件自选 backend。`services.storage` 与 `services.storageDomain` 继续作为 advanced、runtime-bound passthrough，但不因此获得默认 Composable Profile 保证。
