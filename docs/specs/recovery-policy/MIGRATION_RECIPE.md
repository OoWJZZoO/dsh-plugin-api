# Recovery policy migration recipe

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
`pluginApi.execution`, `pluginApi.usage`, `pluginApi.routePolicy`,
`pluginApi.diagnostics`, session/branch, and checkpoint owners.

The feature deliberately has no client-owned retry controller and no durable
checkpoint or workspace transaction. U13/U14/U15 remain proposal-only until
the official runtime publishes equivalent seams; consumers should keep the
existing owner-specific implementation until that migration boundary exists.
