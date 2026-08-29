# Recovery policy migration recipe

> **公共契约现状注（2026-08-29 追加）**：本配方成文于目标领域树 cutover 之前，文中的公共 path 为旧命名，**消费者迁移请以现行 path 为准，本配方中的旧 path 仅供追溯**。现行命名以 [`public-contract.registry.json`](../plugin-api-m7-public-contract-refactor/public-contract.registry.json) 的 `oldToTargetMapping` 为唯一权威，本制品涉及的映射如下：
>
> | 本制品使用的旧 path | 现行 path |
> |---|---|
> | `pluginApi.recovery`（`classify/capability/policy/evaluate/consume/adapters/visibility/availability`） | `pluginApi.executions.recovery`（叶子名不变） |
> | `pluginApi.routePolicy` | `pluginApi.llm.routing`（policy 叶子改复数 `policies`） |
> | `pluginApi.execution` | `pluginApi.executions` |
>
> 现行契约基线：包版本 `0.1.0-rc.6-0.1.0`（runtime `0.1.0-rc.6` / `dsh.api` `0.1`）；本制品中出现的 `0.1.0-rc.6-0.x` 为历史交付边界记录，不代表现行版本。本注只更新命名与版本指针，不改动本制品已获批的 Goal / Requirements 验收边界。

`recovery-policy` is an explicit decision surface. A consumer owns execution
state and calls `pluginApi.recovery.evaluate(input)` at a supported decision
point; it then executes the returned action through its existing owner. The
facade never retries a provider, selects a route, creates an attempt, restores
a checkpoint, or mutates a workspace.

```js
const disposeCapability = pluginApi.recovery.capability.declare({
  operationId: 'my-operation',
  ownerId: 'my-plugin',
  generation: '1',
  scope: 'session',
  idempotent: true,
  retryable: true,
  allowedActions: ['retry', 'fallback', 'stop'],
  sideEffectClass: 'read-only',
  retryBudget: { maxAttempts: 2 },
  deadlineMs: 30_000,
})

const disposePolicy = pluginApi.recovery.policy.register({
  id: 'temporary-provider-failure',
  ownerId: 'my-plugin',
  generation: '1',
  match(input) {
    return input.classification.class === 'transient'
  },
  decide() {
    return {
      action: 'retry',
      reason: { code: 'temporary-provider-failure' },
      bounds: {
        attemptsRemaining: 1,
        deadlineAt: new Date(Date.now() + 30_000).toISOString(),
        backoff: { kind: 'fixed', ms: 250 },
      },
    }
  },
})

const decision = await pluginApi.recovery.evaluate({
  failure: errorObservation,
  capability: { operationId: 'my-operation', ownerId: 'my-plugin', generation: '1' },
  execution: { executionId, attemptId, active: true },
  scope: 'session',
  evidence: { source: { kind: 'operation', observedAt: new Date().toISOString() } },
})

if (decision.action === 'retry') {
  pluginApi.recovery.consume(decision.decisionId, { attemptId: decision.proposedAttemptId })
  // The operation owner creates the next attempt using its own public seam.
}
```

If a caller needs route selection, it passes the fallback lineage to
`pluginApi.routePolicy`/the official loop. If it needs execution history or
budget evidence, it passes the corresponding public projection. It must not
derive execution identity from event sequence, object identity, or a private
counter. `aborted`, `denied`, and `superseded` observations are not transient.

## Bounded migration evidence

The repository acceptance fixture passes explicit projections for execution,
usage/budget, route lineage, diagnostics, session branch, and checkpoint
availability through `evaluate`. The recovery owner copies their provenance
into the immutable decision and leaves the supplied projections unchanged.
Fallback is verified as a handoff: the decision carries only failed-attempt
parentage, while the route owner remains responsible for candidate selection;
no retry, fallback, fork, abort, billing, checkpoint restore, workspace
transaction, lease/CAS, scheduler, or provider call is made by recovery.

The focused evidence is in
`test/recovery-policy-acceptance.test.mjs`; the consumer migration boundary is
the explicit `pluginApi.recovery` surface and the existing authoritative
`pluginApi.execution`, `pluginApi.routePolicy`,
`pluginApi.diagnostics`, session/branch, and checkpoint owners.

The feature deliberately has no client-owned retry controller and no durable
checkpoint or workspace transaction. U13/U14/U15 remain proposal-only until
the official runtime publishes equivalent seams; consumers should keep the
existing owner-specific implementation until that migration boundary exists.
