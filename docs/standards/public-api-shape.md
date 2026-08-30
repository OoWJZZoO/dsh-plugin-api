# 公共 API 形状标准（namespace 与成员形状）

> 适用范围：门面 host/client 公共 namespace、capability path、命名与形状、公共面减法、public contract registry。
> 关联：语义三面（projection / policy / durable mutation）见 `api-shape.md`；组合与 authority 见 `composition-and-authority.md`；各领域最低组合要求见 `domain-composition.md`；`services.*` 定位与分级见 `capability-strategy.md` §6；版本模型见 `versioning-and-protocols.md`。

## 1. Namespace 原则

- 公共 namespace 按第三方开发者理解的 bounded context 组织，不按 feature、mounter、官方组件包、交付批次或 A/B/C/R 实现分类组织。
- 每个 feature 必须挂到最近的既有领域。只有拥有独立词汇、资源身份和使用场景的一等领域才能新增顶层 namespace。
- 根空间可以宽而浅；不得为了减少顶层名称增加没有业务含义的伞形层级。
- replacement bundle、官方 owner 和治理分类不得出现在公开 path 中。
- 公共 API、内部 feature/mounter key、安装 bundle/package identity 是三个独立 identity。一个公共 capability 可以由多个内部 feature/package 协同提供，一个 package 也可以提供多个 capability slice；第三方只依赖公共 path。

## 2. 现行 Host 领域树

```text
pluginApi
├── isActive / apiVersion / assertCompatible / capabilities
├── events
├── llm
│   ├── modelInfo / prepareCall / stream / providers
│   ├── requestTransforms
│   ├── admissionPolicies
│   ├── adapters
│   └── routing
│       ├── forExecution / current / on / once / wait
│       ├── policies / candidates
│       ├── health / circuit
│       └── decisions
├── agents
│   ├── get / list / roots / create / resume / register
│   ├── providers
│   └── availability
├── executions
│   ├── observe / get / history / onChange / visibility
│   ├── availability
│   └── recovery
│       ├── classify / evaluate / consume
│       ├── capability / policy
│       ├── adapters / visibility
│       └── availability
├── sessions
│   ├── get / list / fork / header / events / seq / surface /
│   ├── requestHeader / requestContext / deriveMessages
│   ├── durableEventTypes / durableEventDescriptors / isDurableEventType
│   ├── onDurable / onceDurable / appendMessage
│   ├── branches
│   └── channels
├── tools
│   ├── register / restrict / guard / get / schemas / execute /
│   ├── presentAs / executionMode / defineTool / toolAbortedError
│   └── discovery
├── skills
│   └── activation
├── prompts
│   ├── section / context / variable / tools / suppressRuntimeContext
│   ├── render / renderContextSections
│   └── provenance
│       └── contribute / compose / inspect / mapping / observe / policy
├── attachments
│   ├── pipeline
│   └── projection
├── mcp
├── tasks
├── coordination
├── workspaces
│   └── transactions
├── security
├── diagnostics
├── settings
├── profiles
├── remotes
├── storage
└── services
    └── <静态白名单的官方低层 service passthrough>
```

现行 domain tree 与逐成员状态的唯一事实源是公共契约 registry（`hostDomainTree` 与 `members`）。本册不复制其逐成员登记。

主要归并规则（已完成，旧 path 不再存在）：

- `routing` 与 `routePolicy` 合并为 `llm.routing`；公开语义是 provider/model 路由，不由当前官方组件落点决定。
- `execution` 使用资源集合名 `executions`，`recovery` 归入 `executions.recovery`。
- `sessionChannel` 归入 `sessions.channels`，branch 能力为 `sessions.branches`。
- `workspaceTransactions` 归入 `workspaces.transactions`，通用 `coordination` 保持一等领域。
- `systemPrompt` 与 context provenance 归入 `prompts`，后者位于 `prompts.provenance` 且保持独立 owner。
- `tools.discovery`、`skills.activation`、`llm.adapters` 保持在各自领域内。
- 第三方插件私有持久状态位于 `storage`；它是 owner-scoped 薄绑定，不是共享数据库平台。
- 只增加事件词汇的能力进入 `events.catalog`，不因此新增对象 namespace。

## 3. 命名和形状

1. 资源集合使用复数，如 `agents`、`sessions`、`executions`、`profiles`、`remotes`。
2. 概念系统保留惯用名，如 `llm`、`mcp`、`security`、`settings`、`coordination`。
3. namespace 使用名词，方法使用动词。
4. 注册表使用复数资源或 `policies.register`，避免使用看起来像立即执行的 `request.transform()` 形状。
5. 查询优先使用 `get/list/inspect/history`；订阅使用 `onChange/observe`；注册返回 identity-bound disposer 或 handle。
6. 除 `services.*` 外，最多两层领域 namespace 后接方法；只有强领域关系才允许第三层。
7. 本地重构期不保留兼容 alias；删除重复 authority，例如多个 namespace 上指向同一个 route 查询的委托。
8. 事件协议名继续使用稳定的 slash path；capability path 使用 dot path，两者不得混用。

## 4. Client API

浏览器 Cordis context 与 host context 分离。客户端直接提供环境专属的 `ctx.pluginApi`，不使用冗余的 `ctx.pluginApi.client.*`：

```text
ctx.pluginApi
├── isActive / apiVersion / assertCompatible / capabilities
├── connection
├── events
├── remotes
├── settings
├── slots
├── lifecycle
├── codec
└── services
```

- 门面自有语义位于根领域。
- 纯官方 client 直通（conversation、conversation events/views、timer、command UI、input triggers、model directories 等）统一进入 `services.*`。
- host/client 分别导出 `HostPluginApi` 与 `ClientPluginApi` 类型，不依赖运行时可选属性区分环境。
- `defineManifest` 是构建期 helper，只作为 client 静态模块导出，不进入运行时 `ctx.pluginApi`。
- client slot、remote、settings 和 lifecycle 同样遵守 owner、generation、stale disposer 和 composition contract。

## 5. Capability registry

公开能力按公共语义 path 索引，不暴露内部 mounter/registry 快照：

```js
pluginApi.capabilities.get('llm.adapters')
pluginApi.capabilities.list({ prefix: 'llm.' })
pluginApi.capabilities.require(['llm.routing', 'events.compaction'])
```

- capability ID 必须是公共语义 path，不得使用内部 feature key、package 名或 replacement 名。
- capability 状态只表达 `active | degraded | unavailable`；健康状态属于 `diagnostics`。
- 公共 namespace 始终存在，不能通过属性是否存在表达安装状态。
- 调用不可用成员统一返回或抛出 capability-unavailable typed error；正常业务冲突不复用 unavailable 错误。
- capability 粒度必须足以表达部分可用性，不能用一个过大的 namespace boolean 掩盖成员差异。
- API 协议兼容与 capability presence 分开协商；无关 capability 的加性新增不应使旧插件整体失配。

## 6. 公共面减法

公共面减法是逐成员执行的删除动作，其前置条件与边界为：

- 只在公共领域树稳定后执行；领域树调整期间不删除成员，也不为零散删除保留临时 alias。
- 候选能力不晋升为新的高层 API，也不为候选建立新 alias。
- 只对最终保留的成员投入 composition 加固、文档和发布验收。

删除候选的判据见 `capability-strategy.md` §7。对于仅因 runtime identity 差异无法稳定兑现的 `services.*` 成员，遵守 `disabled/unavailable` 规则（见 `capability-strategy.md` §6.2），不因 runtime 差异而静默移除公共路径。

## 7. 当前语义转译实现

以下语义当前由 facade 转译提供，不是官方直通：

- 同步 `llm/request`：由 `llm/stream` 重入模拟，at-most-once、幂等且可收敛。
- `llm/admission`：第三方只声明本会话/请求需要某项准入并承诺投影；`ModelInfo` 不被公开也不被第三方修改，`resolveModelInfo` 包装是隐藏实现。
- 路由快照：由 `agent.session.requestContext()` 或 `tools/pre-execute` 注入，路由查询的唯一入口是 `llm.routing.forExecution()`。
- settings 可视化配置桥：由 `TypertRemoteService` 与客户端 `ctx.remote.$mount` 组合实现。
- session 上屏事件：helper 封装 `surfaceOp` 与 `sourceEventSeqs`，调用方不自行构造协议细节。

这些转译不改变 `services.*` 的低层定位。各 feature 的 spec 分别记录其官方事件直绑、底层钩子模拟或 upstream proposal，以及失败路径与 guard。

## 8. Client 构建边界

client bundle 自带一份用于生成真实 codec 的 `zod`，以满足 `dsh-api-remotes` 的校验要求；其他需要宿主共享实例的依赖保持为 `peerDependencies`。client 语义与 host 语义使用同一 owner、generation、stale disposer 和 composition contract，不因运行在浏览器而降低保证。

## 9. Public contract registry

公共契约 registry（`docs/specs/plugin-api-m7-public-contract-refactor/public-contract.registry.json`）是以下内容的单一事实源：host/client public path 与成员、capability ID 与 availability 粒度、authority map、composition mode、scope、owner、conflict rule、`services.*` 静态白名单，以及 deprecated/removed 状态。

该 registry 可以生成或验证 `HostPluginApi` / `ClientPluginApi` 类型、capability/claim 类型、API reference、active/disabled surface snapshot、services 审计表和多插件组合测试矩阵。运行时实现可以继续手写，但公共结构不得在多个构造器、测试和文档中各自维护一份。
