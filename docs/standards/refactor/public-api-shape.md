# 公共 API 形状标准（M7）

> 适用范围：M7 门面重构涉及的 host/client 公共 namespace、capability path、命名和公共面减法。
> 关联：组合和 authority 见 [`composition-and-authority.md`](composition-and-authority.md)；能力与 `services.*` 见 [`capability-and-services.md`](capability-and-services.md)；通用 API 形状三面模型见 [`../api-shape.md`](../api-shape.md)。

## 1. Namespace 原则

- 公共 namespace 按第三方开发者理解的 bounded context 组织，不按 feature、mounter、官方组件包、交付批次或 A/B/C/R 实现分类组织。
- 每个 feature 必须挂到最近的既有领域。只有拥有独立词汇、资源身份和使用场景的一等领域才能新增顶层 namespace。
- 根空间可以宽而浅；不得为了减少顶层名称增加没有业务含义的 `platform.infrastructure.orchestration.*` 伞形层级。
- replacement bundle、官方 owner 和治理分类不得出现在公开 path 中。
- 公共 API、内部 feature/mounter key、安装 bundle/package identity 是三个独立 identity。一个公共 capability 可以由多个内部 feature/package 协同提供，一个 package 也可以提供多个 capability slice；第三方只依赖公共 path。

## 2. 目标 Host API

```text
pluginApi
├── isActive / apiVersion / assertCompatible / capabilities
├── events
│   ├── on / once / catalog
│   ├── define（owner-scoped 自定义事件）
│   └── dispatch（emit / serial / parallel / bail / waterfall；producer authority gated）
├── llm
│   ├── modelInfo / prepareCall / stream / provider 查询与注册
│   ├── requestTransforms.register
│   ├── admissionPolicies.register
│   ├── adapters.decorate / snapshot
│   └── routing
│       ├── forExecution / current / on / once / wait
│       ├── policies.register
│       ├── candidates
│       ├── health / circuit
│       └── decisions
├── agents
│   ├── get / list / roots / create / resume / register
│   ├── providers
│   ├── initiators
│   ├── options
│   └── availability
├── executions
│   ├── observe / get / history / onChange / visibility
│   └── recovery
│       ├── classify / evaluate / consume
│       ├── capabilities / policies
│       ├── adapters / visibility
│       └── availability
├── sessions
│   ├── get / list / create / fork / append / appendMessage / ...
│   ├── branches
│   └── channels
├── tools
│   ├── register / restrict / guard / get / schemas / execute / ...
│   └── discovery
├── skills
│   └── activation
├── prompts
│   ├── section / context / variable / tools / assemble / render / ...
│   └── provenance
│       └── contribute / compose / inspect / mapping / observe
├── attachments
│   ├── pipeline
│   └── projection
├── mcp
│   ├── catalog
│   └── lifecycle
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

主要归并规则：

- `routing` 与 `routePolicy` 合并为 `llm.routing`；公开语义是 provider/model 路由，不由当前官方组件落点决定。
- `execution` 使用资源集合名 `executions`，`recovery` 归入 `executions.recovery`。
- `sessionChannel` 归入 `sessions.channels`，branch 能力统一为 `sessions.branches`。
- `workspaceTransactions` 归入 `workspaces.transactions`，通用 `coordination` 保持一等领域。
- `systemPrompt` 与 context provenance 归入 `prompts`，后者位于 `prompts.provenance` 且保持独立 owner。
- `tools.discovery`、`skills.activation`、`llm.adapters` 保持在各自领域内。
- `mcp`、`attachments`、`tasks`、`security`、`diagnostics` 具有独立词汇和资源模型，保留顶层。
- 第三方插件私有持久状态统一位于 `storage`；它是 owner-scoped 薄绑定，不是共享数据库平台。
- 只增加事件词汇的能力进入 `events.catalog`，不因此新增对象 namespace。

## 3. 命名和形状

1. 资源集合使用复数，如 `agents`、`sessions`、`executions`、`profiles`、`remotes`。
2. 概念系统保留惯用名，如 `llm`、`mcp`、`security`、`settings`、`coordination`。
3. namespace 使用名词，方法使用动词。
4. 注册表使用复数资源或 `policies.register`，避免使用看起来像立即执行的 `request.transform()` 形状。
5. 查询优先使用 `get/list/inspect/history`；订阅使用 `onChange/observe`；注册返回 identity-bound disposer 或 handle。
6. 除 `services.*` 外，最多两层领域 namespace 后接方法；只有强领域关系才允许第三层。
7. 在本地重构期不保留兼容 alias；删除重复 authority，例如多个 namespace 上指向同一个 route 查询的委托。
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
└── services.*
```

- 门面自有语义位于根领域。
- 纯官方 client 直通统一进入 `services.*`，包括 conversation、conversation events/views、timer、command UI 和 model directories 等。
- host/client 分别导出 `HostPluginApi` 与 `ClientPluginApi` 类型，不依赖运行时可选属性区分环境。
- `defineManifest` 是构建期 helper，只作为 client 静态模块导出，不进入运行时 `ctx.pluginApi`。
- client slot、remote、settings 和 lifecycle 同样遵守 owner、generation、stale disposer 和 composition contract。

## 5. Capability registry

公开能力按公共语义 path 索引，不暴露内部 mounter/registry 快照：

```js
pluginApi.capabilities.get('llm.adapters')
pluginApi.capabilities.get('sessions.channels')
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

发布前的公共面减法必须在目标 namespace 重组完成后进行：

1. 在旧 namespace 上只做清点和候选标记，不零散删除并保留临时 alias。
2. 完成 domain-first namespace 重组，候选能力不晋升为新的高层 API，也不建立新 alias。
3. 新结构稳定后逐成员执行 public surface minimization，直接删除确定不保留的 API。
4. 只对最终保留的 API 继续做 composition 加固、conformance、文档和发布验收。

对于仅因 runtime identity 差异无法稳定兑现的 `services.*` 成员，遵守 [`capability-and-services.md`](capability-and-services.md) 的 `disabled/unavailable` 规则，不因 runtime 差异而静默移除公共路径。

## 7. 优先转译的语义钩子

以下语义优先通过 facade 转译为领域 API；每个具体 feature 仍需在自己的 spec 中说明官方事件直绑、底层钩子模拟或 upstream proposal，以及失败路径和 guard：

- 同步 `llm/request`：可以基于 `llm/stream` 重入模拟，但必须 at-most-once、幂等并能收敛。
- `llm/admission`：第三方只声明本会话/请求需要某项准入并承诺投影，不直接修改或公开 `ModelInfo`；必要的 `resolveModelInfo` 包装属于隐藏实现，并标为需上游补齐的边界。
- `exec.route` / `routeOf(exec)`：优先从 `agent.session.requestContext()` 或 `tools/pre-execute` 注入路由快照。
- settings 可视化配置桥：使用 `TypertRemoteService` 与客户端 `ctx.remote.$mount` 的官方能力组合。
- session 上屏事件：使用 helper 封装 `surfaceOp` 与 `sourceEventSeqs`，避免调用方重复构造协议细节。

这些转译不改变 `services.*` 的低层定位，也不把无法由门面实现的语义伪装成已稳定能力。

## 8. Client 构建边界

client bundle 可以自带一份用于生成真实 codec 的 `zod`，以满足 `dsh-api-remotes` 的校验要求；其他需要宿主共享实例的依赖应尽量保持为 `peerDependencies`。client 语义与 host 语义使用同一 owner、generation、stale disposer 和 composition contract，不因运行在浏览器而降低保证。

## 9. Public contract registry

应建立机器可读的 public contract registry，作为以下内容的单一事实源：host/client public path 和成员、capability ID 与 availability 粒度、authority map、composition mode、scope、owner、conflict rule、类型签名、错误/result vocabulary、`services.*` 静态白名单，以及 deprecated/removed 状态。

该 registry 可以生成或验证 `HostPluginApi` / `ClientPluginApi` 类型、capability/claim 类型、API reference、active/disabled surface snapshot、services 审计表和多插件组合测试矩阵。运行时实现可以继续手写，但公共结构不得在多个构造器、测试和文档中各自维护一份。
