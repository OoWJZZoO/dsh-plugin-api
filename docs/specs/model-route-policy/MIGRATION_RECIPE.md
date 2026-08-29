# Route-aware consumer migration recipe

> **公共契约现状注（2026-08-29 追加）**：本配方成文于目标领域树 cutover 之前，文中的公共 path 为旧命名，**消费者迁移请以现行 path 为准，本配方中的旧 path 仅供追溯**。现行命名以 [`public-contract.registry.json`](../plugin-api-m7-public-contract-refactor/public-contract.registry.json) 的 `oldToTargetMapping` 为唯一权威，本制品涉及的映射如下：
>
> | 本制品使用的旧 path | 现行 path |
> |---|---|
> | `pluginApi.routePolicy`（`policy/candidates/health/circuit/decisions/availability`） | `pluginApi.llm.routing`（policy 叶子改复数 `policies`） |
> | `pluginApi.routing`（`ofExecution/current/on/once/wait`） | `pluginApi.llm.routing`（`ofExecution` 改 `forExecution`） |
>
> 现行契约基线：包版本 `0.1.0-rc.6-0.1.0`（runtime `0.1.0-rc.6` / `dsh.api` `0.1`）；本制品中出现的 `0.1.0-rc.6-0.x` 为历史交付边界记录，不代表现行版本。本注只更新命名与版本指针，不改动本制品已获批的 Goal / Requirements 验收边界。

This feature is host-only and keeps `pluginApi.routing` unchanged. A consumer
that only needs the current execution route can keep using
`pluginApi.routing.ofExecution(exec)` (or the existing compatibility delegates).

Consumers that need to participate in model selection should use the additive
`pluginApi.routePolicy` leaf when its `availability().status` is `active`:

```js
const routePolicy = ctx.pluginApi.routePolicy
if (routePolicy.availability().status === 'active') {
  const disposeCandidate = routePolicy.candidates.register({
    id: 'consumer-provider-model',
    ownerId: 'consumer-plugin',
    generation: 'boot-1',
    provider: 'provider-name',
    model: 'model-name',
    source: 'consumer-plugin',
  })

  const disposePolicy = routePolicy.policy.register({
    id: 'consumer-route-policy',
    ownerId: 'consumer-plugin',
    generation: 'boot-1',
    priority: 'normal',
    decide(input) {
      return { kind: 'no-op' }
    },
  })

  ctx.effect(() => () => {
    disposePolicy()
    disposeCandidate()
  })
}
```

The route owner supplies frozen candidate/decision snapshots. It does not own
retry, backoff, execution creation, approval, billing, or attachment work. A
consumer must pass health/admission/budget evidence explicitly to its policy;
it must not infer health from a missing snapshot. A denied decision is a
terminal route result for that request attempt and must be handled by the
official loop or the separately scoped recovery policy.

When the replacement row is unavailable, the leaf remains typed-unavailable;
the consumer should continue its existing `pluginApi.routing` path and avoid
directly importing the replacement package. The official
`@deepseek-ai/dsh-agent-loop` import remains the official package in all
installation modes.
