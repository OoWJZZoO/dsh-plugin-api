# Route-aware consumer migration recipe

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
