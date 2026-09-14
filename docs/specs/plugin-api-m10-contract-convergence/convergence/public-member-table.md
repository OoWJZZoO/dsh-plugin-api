# 公共成员表（Public Member Table）

> feature: `plugin-api-m10-contract-convergence`（Stage 4 交付物，Req 2.1）

> 本表由 canonical registry 的 `members` **机械派生**（`scripts/convergence-verify.mjs` 逐字核对 idiom/effect/composition/runtime/authority/availabilityShape/currentShape），registry 是唯一事实源（Req 12.1），本表不得手工偏离；字段值不截断，以便逐字比对。
> Req 2.1 的其余字段（owner、失败呈现、handle 形状、旧路径处理）在 registry 同名行的 `authority`/`failureSemantics`/`identitySource`/`currentShape` 与 `oldToTargetMapping` 中登记，本表以同源引用呈现。

共 537 行（registry `members` 全量）。

| publicPath | runtime | idiom | effect | composition | scope | authority | conflictRule | concurrency | availabilityShape | currentShape |
|---|---|---|---|---|---|---|---|---|---|---|
| isActive | host | selfDescription | read | pure | facade | facade root | not-applicable | — | none | frozen boolean state |
| apiVersion | host | selfDescription | read | pure | facade | facade root | not-applicable | — | none | frozen string |
| assertCompatible | host | selfDescription | read | pure | facade | facade root | not-applicable | — | none | typed throw negotiation |
| capabilityMatrix | host | selfDescription | read | pure | facade | facade root self-description | not-applicable | — | none | — |
| capabilities | host | selfDescription | read | pure | facade | facade root | not-applicable | — | none | frozen query surface |
| capabilities.get | host | selfDescription | read | pure | facade | facade root | not-applicable | — | none | status object per capability path |
| capabilities.list | host | selfDescription | read | pure | facade | facade root | not-applicable | — | none | frozen path list with prefix filter |
| capabilities.require | host | selfDescription | read | pure | facade | facade root | not-applicable | — | none | typed throw on missing |
| events.catalog | host | selfDescription | read | pure | facade | event producer authority | not-applicable | — | none | getter returning event catalog |
| events.on | host | projection | subscribe | pure | facade | event producer authority | not-applicable | — | namespace availability() | subscription returning bare disposer |
| events.once | host | projection | subscribe | pure | facade | event producer authority | not-applicable | — | namespace availability() | one-shot subscription |
| events.emit | host | operation | execute | exclusive | facade | event producer authority | not-applicable | exclusive | namespace availability() | frozen discriminated dispatch result: { ok, code: dispatched\|denied\|unsupported\|error, outcome? } — a caller that is not the event producer owner is denied before anything is dispatched, and an entry that declares no producer is denied for every caller |
| events.serial | host | operation | execute | exclusive | facade | event producer authority | not-applicable | exclusive | namespace availability() | frozen discriminated dispatch result: { ok, code: dispatched\|denied\|unsupported\|error, outcome? } — a caller that is not the event producer owner is denied before anything is dispatched, and an entry that declares no producer is denied for every caller |
| events.parallel | host | operation | execute | exclusive | facade | event producer authority | not-applicable | exclusive | namespace availability() | frozen discriminated dispatch result: { ok, code: dispatched\|denied\|unsupported\|error, outcome? } — a caller that is not the event producer owner is denied before anything is dispatched, and an entry that declares no producer is denied for every caller |
| events.bail | host | operation | execute | exclusive | facade | event producer authority | not-applicable | exclusive | namespace availability() | frozen discriminated dispatch result: { ok, code: dispatched\|denied\|unsupported\|error, outcome? } — a caller that is not the event producer owner is denied before anything is dispatched, and an entry that declares no producer is denied for every caller |
| events.waterfall | host | operation | execute | exclusive | facade | event producer authority | not-applicable | exclusive | namespace availability() | frozen discriminated dispatch result: { ok, code: dispatched\|denied\|unsupported\|error, outcome? } — a caller that is not the event producer owner is denied before anything is dispatched, and an entry that declares no producer is denied for every caller |
| events.observe | host | projection | subscribe | pure | facade | event producer authority | not-applicable | — | namespace availability() | standard projection subscription handle; observes cataloged canonical events and separately defined custom events through the same contract |
| events.observe.handle | host | projection | read | pure | facade | event producer authority | not-applicable | — | namespace availability() | bare disposer |
| events.define | host | resourceRegistry | register | additive | facade | event producer authority | owner-conflict | — | namespace availability() | events.define(spec) returns a frozen publisher handle |
| events.define.handle | host | operation | execute | exclusive | facade | event producer authority | not-applicable | deduplicate | namespace availability() | frozen { id, ownerId, generation, name, emit(payload), dispose() } |
| events.availability | host | selfDescription | read | pure | facade | event producer authority | not-applicable | — | frozen { status } | — |
| llm.isActive | host | selfDescription | read | pure | facade | llm domain authority | not-applicable | — | none | getter boolean |
| llm.modelInfo | host | projection | read | pure | facade | llm domain authority | not-applicable | — | namespace availability() | query returning model info |
| llm.prepareCall | host | operation | execute | exclusive | facade | llm domain authority | not-applicable | exclusive | namespace availability() | call preparation |
| llm.stream | host | operation | execute | exclusive | facade | llm domain authority | not-applicable | exclusive | namespace availability() | official stream call |
| llm.registerAdapter | host | resourceRegistry | register | additive | facade | llm domain authority | content-conflict | latest-wins | namespace availability() | adapter registration |
| llm.registerConfigurableProviders | host | resourceRegistry | register | additive | facade | llm domain authority | content-conflict | latest-wins | namespace availability() | provider registration |
| llm.registerModelDiscovery | host | resourceRegistry | register | additive | facade | llm domain authority | content-conflict | latest-wins | namespace availability() | model discovery registration |
| llm.availability | host | selfDescription | read | pure | facade | llm domain authority | not-applicable | — | frozen { status } | — |
| llm.listProviders | host | passthrough-exception | execute | pure | facade | llm domain authority | not-applicable | — | none | official ctx.llm forwarding leaf merged by the activated llm feature |
| llm.listConfigurableProviders | host | passthrough-exception | execute | pure | facade | llm domain authority | not-applicable | — | none | official ctx.llm forwarding leaf merged by the activated llm feature |
| llm.discoverModels | host | passthrough-exception | execute | pure | facade | llm domain authority | not-applicable | — | none | official ctx.llm forwarding leaf merged by the activated llm feature |
| llm.providerRetryPolicy | host | passthrough-exception | execute | pure | facade | llm domain authority | not-applicable | — | none | official ctx.llm forwarding leaf merged by the activated llm feature |
| llm.listModels | host | passthrough-exception | execute | pure | facade | llm domain authority | not-applicable | — | none | official ctx.llm forwarding leaf merged by the activated llm feature |
| llm.resolveCallConfig | host | passthrough-exception | execute | pure | facade | llm domain authority | not-applicable | — | none | official ctx.llm forwarding leaf merged by the activated llm feature |
| llm.contentHasImage | host | passthrough-exception | read | pure | facade | llm domain authority | not-applicable | — | none | official llm artifact getter merged by the activated llm feature |
| llm.createUserMessage | host | passthrough-exception | read | pure | facade | llm domain authority | not-applicable | — | none | official llm artifact getter merged by the activated llm feature |
| llm.BlockAssembler | host | passthrough-exception | read | pure | facade | llm domain authority | not-applicable | — | none | official llm constructor artifact getter merged by the activated llm feature |
| llm.requestTransforms.transform | host | policy | decide | ordered | facade | llm domain authority | owner-conflict | latest-wins | namespace availability() | registration entry verb named transform |
| llm.requestTransforms.register.handle | host | policy | decide | ordered | facade | llm domain authority | owner-conflict | latest-wins | namespace availability() | frozen { id, ownerId, generation, dispose() } |
| llm.admissionPolicies.register | host | policy | decide | ordered | facade | llm domain authority | owner-conflict | latest-wins | namespace availability() | register(spec) returns the shared frozen handle; the owner is derived from the caller context and the generation is facade-minted; official policy registration performs the installation |
| llm.admissionPolicies.register.handle | host | policy | decide | ordered | facade | llm domain authority | owner-conflict | latest-wins | namespace availability() | frozen { id, ownerId, generation, dispose() } |
| llm.adapters.decorate | host | resourceRegistry | register | additive | facade | llm domain authority | content-conflict | latest-wins | namespace availability() | adapter decoration entry |
| llm.adapters.snapshot | host | projection | read | pure | facade | llm domain authority | not-applicable | — | namespace availability() | adapter snapshot query |
| llm.adapters.list | host | projection | read | pure | facade | llm domain authority | not-applicable | — | namespace availability() | real adapter route query: frozen union of facade owner records and official topology state with honest per-entry availability |
| llm.adapters.register.handle | host | resourceRegistry | register | additive | facade | llm domain authority | content-conflict | compare-and-swap | namespace availability() | fixed registry handle { id, ownerId, generation, dispose() }; identity-bound caller teardown; stale disposer is a typed no-op |
| llm.routing.forExecution | host | projection | read | pure | facade | llm domain authority | not-applicable | — | namespace availability() | route resolution query |
| llm.routing.current | host | projection | read | pure | facade | llm domain authority | not-applicable | — | namespace availability() | current route snapshot |
| llm.routing.on | host | projection | subscribe | pure | facade | llm domain authority | not-applicable | — | namespace availability() | subscription |
| llm.routing.observe | host | projection | subscribe | pure | facade | llm domain authority | not-applicable | — | namespace availability() | subscription |
| llm.routing.observe.handle | host | projection | read | pure | session | session authority | not-applicable | — | namespace availability() | new target handle without a current counterpart |
| llm.routing.once | host | projection | subscribe | pure | facade | llm domain authority | not-applicable | — | namespace availability() | one-shot subscription |
| llm.routing.wait | host | operation | execute | exclusive | facade | llm domain authority | not-applicable | exclusive | namespace availability() | await route readiness |
| llm.routing.policies.register | host | policy | decide | ordered | facade | llm domain authority | owner-conflict | latest-wins | namespace availability() | register(spec) returns the shared frozen handle; the caller no longer declares ownerId or generation — both are supplied by the facade; the registration table is keyed by (owner, id) |
| llm.routing.candidates.register | host | resourceRegistry | register | additive | facade | llm domain authority | content-conflict | latest-wins | namespace availability() | register(spec) returns the shared frozen handle; owner derived and generation minted by the facade; the registration table is keyed by (owner, id) |
| llm.routing.candidates.list | host | projection | read | pure | facade | llm domain authority | not-applicable | — | namespace availability() | candidate query |
| llm.routing.health.observe | host | projection | subscribe | pure | facade | llm domain authority | not-applicable | — | namespace availability() | health subscription |
| llm.routing.health.get | host | projection | read | pure | facade | llm domain authority | not-applicable | — | namespace availability() | health view query |
| llm.routing.health.history | host | projection | read | pure | facade | llm domain authority | not-applicable | — | namespace availability() | health history query |
| llm.routing.health.registerCircuitPolicy | host | policy | decide | ordered | facade | llm domain authority | owner-conflict | latest-wins | namespace availability() | circuit policy registration |
| llm.routing.health.registerProbe | host | resourceRegistry | register | additive | facade | llm domain authority | content-conflict | latest-wins | namespace availability() | probe registration |
| llm.routing.health.probe | host | operation | execute | exclusive | facade | llm domain authority | not-applicable | exclusive | namespace availability() | manual probe segment driver |
| llm.routing.health.startProbe | host | operation | execute | exclusive | facade | llm domain authority | not-applicable | exclusive | namespace availability() | manual probe start |
| llm.routing.health.completeProbe | host | operation | execute | exclusive | facade | llm domain authority | not-applicable | exclusive | namespace availability() | manual probe completion |
| llm.routing.circuit.status | host | projection | read | pure | facade | llm domain authority | not-applicable | — | namespace availability() | circuit state query named status |
| llm.routing.circuit.inspect | host | projection | read | pure | facade | llm domain authority | not-applicable | — | namespace availability() | circuit state query named status |
| llm.routing.decisions.get | host | projection | read | pure | facade | llm domain authority | not-applicable | — | namespace availability() | decision view query |
| llm.routing.decisions.history | host | projection | read | pure | facade | llm domain authority | not-applicable | — | namespace availability() | decision history query |
| llm.routing.availability | host | selfDescription | read | pure | facade | llm domain authority | not-applicable | — | frozen { status } | availability query throwing when inactive |
| agents.isActive | host | selfDescription | read | pure | facade | agent registry authority | not-applicable | — | none | getter boolean |
| agents.get | host | projection | read | pure | facade | agent registry authority | not-applicable | — | namespace availability() | agent query |
| agents.list | host | projection | read | pure | facade | agent registry authority | not-applicable | — | namespace availability() | agent list |
| agents.roots | host | projection | read | pure | facade | agent registry authority | not-applicable | — | namespace availability() | root agents query |
| agents.create | host | operation | execute | exclusive | facade | agent registry authority | not-applicable | exclusive | namespace availability() | agent creation |
| agents.resume | host | operation | execute | exclusive | facade | agent registry authority | not-applicable | exclusive | namespace availability() | agent resume |
| agents.register | host | resourceRegistry | register | additive | facade | agent registry authority | content-conflict | latest-wins | namespace availability() | agent definition registration |
| agents.providers.enter | host | resourceRegistry | register | additive | facade | agent registry authority | content-conflict | latest-wins | namespace availability() | provider claim entry |
| agents.providers.announce | host | resourceRegistry | register | additive | facade | agent registry authority | content-conflict | latest-wins | namespace availability() | provider announcement |
| agents.providers.setFactory | host | resourceRegistry | register | additive | facade | agent registry authority | content-conflict | latest-wins | namespace availability() | provider factory claim |
| agents.providers.isActive | host | selfDescription | read | pure | facade | agent registry authority | not-applicable | — | none | frozen boolean data property |
| agents.availability | host | selfDescription | read | pure | facade | agent registry authority | not-applicable | — | frozen { status } | object map of per-member booleans |
| agents.providers.register.handle | host | resourceRegistry | register | additive | facade | agent registry authority | content-conflict | latest-wins | namespace availability() | frozen { id, ownerId, generation, dispose() }; the announce variant reports the irreversible-registration no-op |
| agents.currentInitiator | host | passthrough-exception | execute | pure | facade | agent registry authority | not-applicable | — | none | official agents registry forwarding leaf merged by the activated agent feature |
| agents.requireInitiator | host | passthrough-exception | execute | pure | facade | agent registry authority | not-applicable | — | none | official agents registry forwarding leaf merged by the activated agent feature |
| agents.withInitiator | host | passthrough-exception | execute | pure | facade | agent registry authority | not-applicable | — | none | official agents registry forwarding leaf merged by the activated agent feature |
| agents.withoutInitiator | host | passthrough-exception | execute | pure | facade | agent registry authority | not-applicable | — | none | official agents registry forwarding leaf merged by the activated agent feature |
| agents.isOwnedBy | host | passthrough-exception | execute | pure | facade | agent registry authority | not-applicable | — | none | official agents registry forwarding leaf merged by the activated agent feature |
| agents.options | host | passthrough-exception | read | pure | facade | agent registry authority | not-applicable | — | none | official agent options snapshot getter merged by the activated agent feature |
| executions.observe | host | projection | subscribe | pure | facade | execution authority | not-applicable | — | namespace availability() | execution observation subscription |
| executions.get | host | projection | read | pure | facade | execution authority | not-applicable | — | namespace availability() | execution view query; a definitely-absent subject answers the typed missing code while an undeterminable one answers unavailable |
| executions.history | host | projection | read | pure | facade | execution authority | not-applicable | — | namespace availability() | history query |
| executions.onChange | host | projection | subscribe | pure | facade | execution authority | not-applicable | — | namespace availability() | change subscription |
| executions.visibility.register | host | policy | decide | ordered | facade | execution authority | owner-conflict | latest-wins | namespace availability() | visibility policy registration |
| executions.availability | host | selfDescription | read | pure | facade | execution authority | not-applicable | — | frozen { status } | frozen { sources, epoch } object |
| executions.observe.handle | host | projection | read | pure | facade | execution authority | not-applicable | — | namespace availability() | new target handle without a current counterpart |
| executions.recovery.classify | host | — | read | pure | facade | execution authority | not-applicable | — | none | input normalization helper exposed publicly |
| executions.recovery.capability.declare | host | resourceRegistry | register | additive | facade | execution authority | content-conflict | latest-wins | namespace availability() | recovery capability declaration |
| executions.recovery.policy.register | host | policy | decide | ordered | facade | execution authority | owner-conflict | latest-wins | namespace availability() | recovery policy registration |
| executions.recovery.evaluate | host | operation | execute | exclusive | facade | execution authority | not-applicable | exclusive | namespace availability() | recovery evaluation |
| executions.recovery.consume | host | — | read | pure | facade | execution authority | not-applicable | — | none | consultation-style acknowledgement entry |
| executions.recovery.adapters.fromAgentRequestError | host | passthrough-exception | execute | pure | facade | execution authority | not-applicable | — | none | official error adapter toolbox |
| executions.recovery.adapters.fromToolResult | host | passthrough-exception | execute | pure | facade | execution authority | not-applicable | — | none | official error adapter toolbox |
| executions.recovery.adapters.unsupported | host | passthrough-exception | execute | pure | facade | execution authority | not-applicable | — | none | official error adapter toolbox |
| executions.recovery.visibility.register | host | policy | decide | ordered | facade | execution authority | owner-conflict | latest-wins | namespace availability() | recovery visibility policy registration |
| executions.recovery.visibility.project | host | — | read | pure | facade | execution authority | not-applicable | — | none | manual projection driver |
| executions.recovery.availability | host | selfDescription | read | pure | facade | execution authority | not-applicable | — | frozen { status } | availability getter throwing when inactive |
| executions.recovery.coverage | host | selfDescription | read | pure | facade | execution authority | not-applicable | — | none | recovery coverage projection { status, registration, cooperative, automatic, observedAt } |
| sessions.get | host | projection | read | pure | session | session authority | not-applicable | — | namespace availability() | session query |
| sessions.list | host | projection | read | pure | session | session authority | not-applicable | — | namespace availability() | session list |
| sessions.header | host | projection | read | pure | session | session authority | not-applicable | — | namespace availability() | session header query |
| sessions.events | host | projection | read | pure | session | session authority | not-applicable | — | namespace availability() | session events query |
| sessions.seq | host | projection | read | pure | session | session authority | not-applicable | — | namespace availability() | sequence query |
| sessions.surface | host | projection | read | pure | session | session authority | not-applicable | — | namespace availability() | surface projection |
| sessions.requestHeader | host | projection | read | pure | session | session authority | not-applicable | — | namespace availability() | request header query |
| sessions.requestContext | host | projection | read | pure | session | session authority | not-applicable | — | namespace availability() | request context query |
| sessions.deriveMessages | host | projection | read | pure | session | session authority | not-applicable | — | namespace availability() | message derivation |
| sessions.sessionEventTypes | host | projection | read | pure | session | session authority | not-applicable | — | namespace availability() | event type list |
| sessions.surfaceEventTypes | host | projection | read | pure | session | session authority | not-applicable | — | namespace availability() | event type list |
| sessions.isSessionEventType | host | projection | read | pure | session | session authority | not-applicable | — | namespace availability() | event type predicate |
| sessions.isSurfaceEventType | host | projection | read | pure | session | session authority | not-applicable | — | namespace availability() | event type predicate |
| sessions.views.header | host | projection | read | pure | session | session authority | not-applicable | — | namespace availability() | session header query |
| sessions.views.events | host | projection | read | pure | session | session authority | not-applicable | — | namespace availability() | session events query |
| sessions.views.seq | host | projection | read | pure | session | session authority | not-applicable | — | namespace availability() | sequence query |
| sessions.views.surface | host | projection | read | pure | session | session authority | not-applicable | — | namespace availability() | surface event query |
| sessions.views.requestHeader | host | projection | read | pure | session | session authority | not-applicable | — | namespace availability() | request header helper |
| sessions.views.requestContext | host | projection | read | pure | session | session authority | not-applicable | — | namespace availability() | request context helper |
| sessions.views.deriveMessages | host | projection | read | pure | session | session authority | not-applicable | — | namespace availability() | message derivation helper |
| sessions.views.isSessionEventType | host | projection | read | pure | session | session authority | not-applicable | — | namespace availability() | event type predicate |
| sessions.views.isSurfaceEventType | host | projection | read | pure | session | session authority | not-applicable | — | namespace availability() | event type predicate |
| sessions.views.sessionEventTypes | host | projection | read | pure | session | session authority | not-applicable | — | namespace availability() | event type list |
| sessions.views.surfaceEventTypes | host | projection | read | pure | session | session authority | not-applicable | — | namespace availability() | event type list |
| sessions.on | host | projection | subscribe | pure | session | session authority | not-applicable | — | namespace availability() | subscription |
| sessions.observe | host | projection | subscribe | pure | session | session authority | not-applicable | — | namespace availability() | subscription |
| sessions.once | host | projection | subscribe | pure | session | session authority | not-applicable | — | namespace availability() | one-shot subscription |
| sessions.fork | host | mutation | mutate | exclusive | session | session authority | compare-and-swap | — | namespace availability() | session fork write |
| sessions.availability | host | selfDescription | read | pure | session | session authority | not-applicable | — | frozen { status } | — |
| sessions.observe.handle | host | projection | read | pure | session | session authority | not-applicable | — | namespace availability() | new target handle without a current counterpart |
| sessions.create | host | passthrough-exception | execute | pure | session | session authority | not-applicable | — | none | official session store forwarding leaf merged by the activated session feature |
| sessions.prepare | host | passthrough-exception | execute | pure | session | session authority | not-applicable | — | none | official session store forwarding leaf merged by the activated session feature |
| sessions.enter | host | passthrough-exception | execute | pure | session | session authority | not-applicable | — | none | official session store forwarding leaf merged by the activated session feature |
| sessions.announce | host | passthrough-exception | execute | pure | session | session authority | not-applicable | — | none | official session store forwarding leaf merged by the activated session feature |
| sessions.flush | host | passthrough-exception | execute | pure | session | session authority | not-applicable | — | none | official session store forwarding leaf merged by the activated session feature |
| sessions.append | host | passthrough-exception | execute | pure | session | session authority | not-applicable | — | none | official session append forwarding leaf merged by the activated session feature |
| sessions.deriveEventMessage | host | passthrough-exception | execute | pure | session | session authority | not-applicable | — | none | official public session export forwarding leaf merged by the activated session feature |
| sessions.durable.durableEventTypes | host | projection | read | pure | session | session authority | not-applicable | — | namespace availability() | getter list |
| sessions.durable.list | host | projection | read | pure | session | session authority | not-applicable | — | namespace availability() | getter list |
| sessions.durable.durableEventDescriptors | host | projection | read | pure | session | session authority | not-applicable | — | namespace availability() | getter map |
| sessions.durable.isDurableEventType | host | projection | read | pure | session | session authority | not-applicable | — | namespace availability() | predicate |
| sessions.durable.getDurableEventDescriptor | host | projection | read | pure | session | session authority | not-applicable | — | namespace availability() | descriptor query |
| sessions.durable.get | host | projection | read | pure | session | session authority | not-applicable | — | namespace availability() | descriptor query |
| sessions.durable.onDurable | host | projection | subscribe | pure | session | session authority | not-applicable | — | namespace availability() | durable subscription |
| sessions.durable.observe | host | projection | subscribe | pure | session | session authority | not-applicable | — | namespace availability() | durable subscription |
| sessions.durable.observe.handle | host | projection | read | pure | session | session authority | not-applicable | — | namespace availability() | new target handle without a current counterpart |
| sessions.durable.onceDurable | host | projection | subscribe | pure | session | session authority | not-applicable | — | namespace availability() | one-shot durable subscription |
| sessions.durable.appendMessage | host | mutation | mutate | exclusive | session | session authority | compare-and-swap | — | namespace availability() | durable append write |
| sessions.branches.create | host | mutation | mutate | exclusive | session | session authority | compare-and-swap | — | namespace availability() | branch create write |
| sessions.branches.graph | host | projection | read | pure | session | session authority | not-applicable | — | namespace availability() | branch graph query |
| sessions.branches.plan | host | projection | read | pure | session | session authority | not-applicable | — | namespace availability() | branch plan query |
| sessions.branches.preview | host | projection | read | pure | session | session authority | not-applicable | — | namespace availability() | branch preview query |
| sessions.branches.commit | host | mutation | mutate | exclusive | session | session authority | compare-and-swap | — | namespace availability() | branch commit write |
| sessions.branches.rollback | host | mutation | mutate | exclusive | session | session authority | compare-and-swap | — | namespace availability() | branch rollback write |
| sessions.branches.restore | host | mutation | mutate | exclusive | session | session authority | compare-and-swap | — | namespace availability() | branch restore write |
| sessions.branches.availability | host | selfDescription | read | pure | session | session authority | not-applicable | — | frozen { status } | availability() returning { active, contract } |
| sessions.channels.open | host | coordination | execute | coordinated | session | session authority | fencing | exclusive | availability(scope) | channel open returning open result |
| sessions.channels.acquire.handle | host | coordination | execute | coordinated | session | session authority | fencing | exclusive | availability(scope) | — |
| sessions.channels.heartbeat | host | coordination | execute | coordinated | session | session authority | fencing | exclusive | availability(scope) | lease heartbeat |
| sessions.channels.revoke | host | coordination | execute | coordinated | session | session authority | fencing | exclusive | availability(scope) | channel revocation |
| sessions.channels.subscribe | host | projection | subscribe | pure | session | session authority | not-applicable | — | namespace availability() | channel subscription |
| sessions.channels.onChange | host | projection | subscribe | pure | session | session authority | not-applicable | — | namespace availability() | channel change subscription |
| sessions.channels.observe | host | projection | subscribe | pure | session | session authority | not-applicable | — | namespace availability() | channel observation |
| sessions.channels.fetchEvents | host | projection | read | pure | session | session authority | not-applicable | — | namespace availability() | event fetch query |
| sessions.channels.list | host | projection | read | pure | session | session authority | not-applicable | — | namespace availability() | event fetch query |
| sessions.channels.ack | host | operation | execute | exclusive | session | session authority | not-applicable | exclusive | namespace availability() | acknowledgement state transition |
| sessions.channels.resume | host | operation | execute | exclusive | session | session authority | not-applicable | exclusive | namespace availability() | resume state transition |
| sessions.channels.auth.registerVerifier | host | policy | decide | ordered | session | session authority | owner-conflict | latest-wins | namespace availability() | verifier registration |
| sessions.channels.auth.registerAuthorizer | host | policy | decide | ordered | session | session authority | owner-conflict | latest-wins | namespace availability() | authorizer registration |
| sessions.channels.auth.registerPairingProvider | host | resourceRegistry | register | additive | session | session authority | content-conflict | latest-wins | namespace availability() | pairing provider registration |
| sessions.channels.auth.initiatePairing | host | operation | execute | exclusive | session | session authority | not-applicable | exclusive | namespace availability() | pairing initiation |
| sessions.channels.auth.approvePairing | host | operation | execute | exclusive | session | session authority | not-applicable | exclusive | namespace availability() | pairing approval |
| sessions.channels.auth.rejectPairing | host | operation | execute | exclusive | session | session authority | not-applicable | exclusive | namespace availability() | pairing rejection |
| sessions.channels.redaction.registerProfile | host | resourceRegistry | register | additive | session | session authority | content-conflict | latest-wins | namespace availability() | redaction profile registration |
| sessions.channels.dispatchChannelMethod | host | — | read | pure | session | session authority | not-applicable | — | none | internal dispatch mechanism |
| sessions.channels.channelGenerationOf | host | — | read | pure | session | session authority | not-applicable | — | none | internal generation field reader |
| sessions.channels.availability | host | selfDescription | read | pure | session | session authority | not-applicable | — | frozen { status } | — |
| tools.isActive | host | selfDescription | read | pure | facade | tools authority | not-applicable | — | none | getter boolean |
| tools.register | host | resourceRegistry | register | additive | facade | tools authority | content-conflict | latest-wins | namespace availability() | tool definition registration; both forms answer with the same frozen handle — the global form and the scoped form (optional opts.scope installs the definition through the target agent context, scoped layer, target-only visibility) — with (owner, scope, key) conflict keys for the scoped path (a second scoped registration under the same key is a typed conflict before the official backing is reached, no content comparison) while the global path keeps the official content-idempotent/content-conflict semantics; the scoped form carries the registered domain extension member targetId |
| tools.register.handle | host | resourceRegistry | register | additive | facade | tools authority | content-conflict | latest-wins | namespace availability() | frozen { id, ownerId, generation, dispose() }; the scoped form adds the registered extension member targetId |
| tools.restrict | host | policy | decide | ordered | facade | tools authority | owner-conflict | latest-wins | namespace availability() | restriction filter registration |
| tools.guard | host | policy | decide | ordered | facade | tools authority | owner-conflict | latest-wins | namespace availability() | guard registration |
| tools.get | host | projection | read | pure | facade | tools authority | not-applicable | — | namespace availability() | tool query |
| tools.schemas | host | projection | read | pure | facade | tools authority | not-applicable | — | namespace availability() | schema collection query |
| tools.list | host | projection | read | pure | facade | tools authority | not-applicable | — | namespace availability() | schema collection query |
| tools.execute | host | operation | execute | exclusive | facade | tools authority | not-applicable | exclusive | namespace availability() | tool execution |
| tools.presentAs | host | resourceRegistry | register | additive | facade | tools authority | content-conflict | latest-wins | namespace availability() | presentation registration |
| tools.executionMode | host | resourceRegistry | register | additive | facade | tools authority | content-conflict | latest-wins | namespace availability() | execution mode registration |
| tools.defineTool | host | resourceRegistry | register | additive | facade | tools authority | content-conflict | latest-wins | namespace availability() | tool construction helper resolving official module |
| tools.toolAbortedError | host | passthrough-exception | execute | pure | facade | tools authority | not-applicable | — | none | official tool-aborted error constructor |
| tools.availability | host | selfDescription | read | pure | facade | tools authority | not-applicable | — | frozen { status } | — |
| tools.discovery.isActive | host | selfDescription | read | pure | facade | tools authority | not-applicable | — | none | getter boolean |
| tools.discovery.catalog.register | host | resourceRegistry | register | additive | facade | tools authority | content-conflict | latest-wins | namespace availability() | register(spec) returns the shared frozen handle; the caller-supplied owner string is deleted — the owner is derived from the caller context and feeds the generation |
| tools.discovery.search | host | projection | read | pure | facade | tools authority | not-applicable | — | namespace availability() | search query |
| tools.discovery.list | host | projection | read | pure | facade | tools authority | not-applicable | — | namespace availability() | search query |
| tools.discovery.activate | host | operation | execute | exclusive | facade | tools authority | not-applicable | exclusive | namespace availability() | activation transition |
| tools.discovery.deactivate | host | operation | execute | exclusive | facade | tools authority | not-applicable | exclusive | namespace availability() | deactivation transition |
| tools.discovery.audit.query | host | projection | read | pure | facade | tools authority | not-applicable | — | namespace availability() | audit query |
| tools.discovery.audit.list | host | projection | read | pure | facade | tools authority | not-applicable | — | namespace availability() | audit query |
| tools.discovery.availability | host | selfDescription | read | pure | facade | tools authority | not-applicable | — | frozen { status } | availability getter throwing when inactive |
| tools.discovery.catalog.register.handle | host | resourceRegistry | register | additive | facade | tools authority | content-conflict | latest-wins | namespace availability() | frozen { id, ownerId, generation, dispose() } |
| skills.activation.registerDescriptor | host | resourceRegistry | register | additive | facade | skill activation authority | content-conflict | latest-wins | namespace availability() | descriptor registration |
| skills.activation.registerSkill | host | resourceRegistry | register | additive | facade | skill activation authority | content-conflict | latest-wins | namespace availability() | skill registration |
| skills.activation.activate | host | operation | execute | exclusive | facade | skill activation authority | not-applicable | exclusive | namespace availability() | activation transition |
| skills.activation.deactivate | host | operation | execute | exclusive | facade | skill activation authority | not-applicable | exclusive | namespace availability() | deactivation transition |
| skills.activation.exposure | host | projection | read | pure | facade | skill activation authority | not-applicable | — | namespace availability() | exposure query |
| skills.activation.exposure.list | host | projection | read | pure | facade | skill activation authority | not-applicable | — | namespace availability() | exposure query |
| skills.activation.audit | host | projection | read | pure | facade | skill activation authority | not-applicable | — | namespace availability() | audit query |
| skills.activation.audit.list | host | projection | read | pure | facade | skill activation authority | not-applicable | — | namespace availability() | audit query |
| skills.activation.policy.registerMinimalCatalogUpdate | host | policy | decide | ordered | facade | skill activation authority | owner-conflict | latest-wins | namespace availability() | minimal catalog update policy registration |
| skills.activation.availability | host | selfDescription | read | pure | facade | skill activation authority | not-applicable | — | frozen { status } | availability() returning { active, contract } |
| skills.activation.register.handle | host | resourceRegistry | register | additive | facade | skill activation authority | content-conflict | latest-wins | namespace availability() | registration result |
| prompts.isActive | host | selfDescription | read | pure | facade | system prompt authority | not-applicable | — | none | getter boolean |
| prompts.section | host | contribution | register | additive | facade | system prompt authority | owner-conflict | deduplicate | namespace availability() | section contribution |
| prompts.context | host | contribution | register | additive | facade | system prompt authority | owner-conflict | deduplicate | namespace availability() | context contribution |
| prompts.variable | host | contribution | register | additive | facade | system prompt authority | owner-conflict | deduplicate | namespace availability() | variable contribution |
| prompts.tools | host | contribution | register | additive | facade | system prompt authority | owner-conflict | deduplicate | namespace availability() | tool contribution |
| prompts.suppressRuntimeContext | host | contribution | register | additive | facade | system prompt authority | owner-conflict | deduplicate | namespace availability() | runtime context suppression contribution |
| prompts.render | host | projection | read | pure | facade | system prompt authority | not-applicable | — | namespace availability() | prompt rendering |
| prompts.renderContextSections | host | projection | read | pure | facade | system prompt authority | not-applicable | — | namespace availability() | context sections rendering |
| prompts.renderContextSnapshot | host | projection | read | pure | facade | system prompt authority | not-applicable | — | namespace availability() | context snapshot rendering |
| prompts.joinContextSections | host | projection | read | pure | facade | system prompt authority | not-applicable | — | namespace availability() | section join helper |
| prompts.assemble | host | passthrough-exception | execute | pure | facade | system prompt authority | not-applicable | — | none | official system prompt forwarding leaf merged by the activated systemPrompt feature |
| prompts.contribute.handle | host | contribution | register | additive | facade | system prompt authority | owner-conflict | deduplicate | namespace availability() | contribution disposers |
| prompts.availability | host | selfDescription | read | pure | facade | system prompt authority | not-applicable | — | frozen { status } | — |
| prompts.provenance.contribute | host | contribution | register | additive | facade | system prompt authority | owner-conflict | deduplicate | namespace availability() | provenance contribution |
| prompts.provenance.compose | host | projection | read | pure | facade | system prompt authority | not-applicable | — | namespace availability() | provenance composition query |
| prompts.provenance.inspect | host | projection | read | pure | facade | system prompt authority | not-applicable | — | namespace availability() | provenance inspection query |
| prompts.provenance.mapping | host | projection | read | pure | facade | system prompt authority | not-applicable | — | namespace availability() | provenance mapping query |
| prompts.provenance.observe | host | projection | subscribe | pure | facade | system prompt authority | not-applicable | — | namespace availability() | provenance observation |
| prompts.provenance.policy.register | host | policy | decide | ordered | facade | system prompt authority | owner-conflict | latest-wins | namespace availability() | register(spec) with id / priority / decide returns the shared frozen handle; the priority is validated against the fixed vocabulary and an unknown priority raises rather than silently defaulting; registration failures are typed errors, never a discriminated result; owner derived from the caller context |
| prompts.provenance.availability | host | selfDescription | read | pure | facade | system prompt authority | not-applicable | — | frozen { status } | availability query throwing when inactive |
| attachments.availability | host | selfDescription | read | pure | facade | attachment pipeline authority | not-applicable | — | frozen { status } | availability query |
| attachments.pipeline.ingest | host | operation | execute | exclusive | facade | attachment pipeline authority | not-applicable | exclusive | namespace availability() | pipeline ingest step |
| attachments.pipeline.transform | host | operation | execute | exclusive | facade | attachment pipeline authority | not-applicable | exclusive | namespace availability() | pipeline transform step |
| attachments.pipeline.cleanup | host | operation | execute | exclusive | facade | attachment pipeline authority | not-applicable | exclusive | namespace availability() | pipeline cleanup step |
| attachments.pipeline.registerTransform | host | resourceRegistry | register | additive | facade | attachment pipeline authority | content-conflict | latest-wins | namespace availability() | transform registration |
| attachments.pipeline.capabilities | host | selfDescription | read | pure | facade | attachment pipeline authority | not-applicable | — | none | pipeline capability getter |
| attachments.projection.resolve | host | projection | read | pure | facade | attachment pipeline authority | not-applicable | — | namespace availability() | attachment resolution |
| attachments.projection.get | host | projection | read | pure | facade | attachment pipeline authority | not-applicable | — | namespace availability() | attachment resolution |
| attachments.projection.open | host | projection | read | pure | facade | attachment pipeline authority | not-applicable | — | namespace availability() | attachment open |
| attachments.projection.project | host | projection | read | pure | facade | attachment pipeline authority | not-applicable | — | namespace availability() | attachment projection |
| attachments.projection.provenance | host | projection | read | pure | facade | attachment pipeline authority | not-applicable | — | namespace availability() | provenance view |
| attachments.projection.availability | host | selfDescription | read | pure | facade | attachment pipeline authority | not-applicable | — | frozen { status } | availability getter |
| attachments.pipeline.transforms.register.handle | host | resourceRegistry | register | additive | facade | attachment pipeline authority | content-conflict | latest-wins | namespace availability() | frozen { id, ownerId, generation, dispose() } (resource scope, not the caller identity) |
| mcp.servers | host | projection | read | pure | facade | mcp replacement authority | not-applicable | — | namespace availability() | server catalog query |
| mcp.tools | host | projection | read | pure | facade | mcp replacement authority | not-applicable | — | namespace availability() | tool catalog query |
| mcp.resolvePublicName | host | projection | read | pure | facade | mcp replacement authority | not-applicable | — | namespace availability() | name resolution helper |
| mcp.onChange | host | projection | subscribe | pure | facade | mcp replacement authority | not-applicable | — | namespace availability() | catalog change subscription |
| mcp.observe | host | projection | subscribe | pure | facade | mcp replacement authority | not-applicable | — | namespace availability() | catalog change subscription |
| mcp.observe.handle | host | projection | read | pure | session | session authority | not-applicable | — | namespace availability() | new target handle without a current counterpart |
| mcp.availability | host | selfDescription | read | pure | facade | mcp replacement authority | not-applicable | — | frozen { status } | — |
| tasks.register | host | resourceRegistry | register | additive | facade | task authority | content-conflict | latest-wins | namespace availability() | task definition registration |
| tasks.start | host | operation | execute | exclusive | facade | task authority | not-applicable | exclusive | namespace availability() | task start |
| tasks.claim | host | coordination | execute | coordinated | facade | task authority | fencing | exclusive | availability(scope) | task claim |
| tasks.reassign | host | coordination | execute | coordinated | facade | task authority | fencing | exclusive | availability(scope) | task reassignment |
| tasks.settle | host | operation | execute | exclusive | facade | task authority | not-applicable | exclusive | namespace availability() | task settlement |
| tasks.attach | host | operation | execute | exclusive | facade | task authority | not-applicable | exclusive | namespace availability() | task attachment |
| tasks.get | host | projection | read | pure | facade | task authority | not-applicable | — | namespace availability() | task query; a definitely-absent subject answers the typed missing code while an undeterminable one answers unavailable |
| tasks.observe | host | projection | subscribe | pure | facade | task authority | not-applicable | — | namespace availability() | task observation |
| tasks.history | host | projection | read | pure | facade | task authority | not-applicable | — | namespace availability() | task history query; a definitely-absent subject answers the typed missing code while an undeterminable one answers unavailable |
| tasks.availability | host | selfDescription | read | pure | facade | task authority | not-applicable | — | frozen { status } | — |
| coordination.availability | host | selfDescription | read | pure | facade | coordination authority | not-applicable | — | frozen { status } | availability query |
| coordination.acquire | host | coordination | execute | coordinated | facade | coordination authority | fencing | exclusive | availability(scope) | lease acquisition |
| coordination.acquire.handle | host | coordination | execute | coordinated | facade | coordination authority | fencing | exclusive | availability(scope) | lease handle returned by acquire |
| coordination.heartbeat | host | coordination | execute | coordinated | facade | coordination authority | fencing | exclusive | availability(scope) | lease heartbeat |
| coordination.release | host | coordination | execute | coordinated | facade | coordination authority | fencing | exclusive | availability(scope) | lease give-back |
| coordination.takeover | host | coordination | execute | coordinated | facade | coordination authority | fencing | exclusive | availability(scope) | cross-owner takeover |
| coordination.compareAndSet | host | coordination | execute | coordinated | facade | coordination authority | fencing | exclusive | availability(scope) | CAS state change |
| coordination.watch | host | projection | subscribe | pure | facade | coordination authority | not-applicable | — | namespace availability() | state watch subscription |
| coordination.observe | host | projection | subscribe | pure | facade | coordination authority | not-applicable | — | namespace availability() | state watch subscription |
| coordination.observe.handle | host | projection | read | pure | session | session authority | not-applicable | — | namespace availability() | new target handle without a current counterpart |
| workspaces.transactions.prepare | host | operation | execute | exclusive | workspace | workspace transaction authority | not-applicable | exclusive | namespace availability() | transaction prepare |
| workspaces.transactions.record | host | mutation | mutate | exclusive | workspace | workspace transaction authority | not-applicable | — | namespace availability() | transaction record write |
| workspaces.transactions.preview | host | projection | read | pure | workspace | workspace transaction authority | not-applicable | — | namespace availability() | transaction preview |
| workspaces.transactions.commit | host | operation | execute | exclusive | workspace | workspace transaction authority | not-applicable | exclusive | namespace availability() | transaction commit |
| workspaces.transactions.rollback | host | operation | execute | exclusive | workspace | workspace transaction authority | not-applicable | exclusive | namespace availability() | transaction rollback |
| workspaces.transactions.recover | host | operation | execute | exclusive | workspace | workspace transaction authority | not-applicable | exclusive | namespace availability() | transaction recovery |
| workspaces.transactions.get | host | projection | read | pure | workspace | workspace transaction authority | not-applicable | — | namespace availability() | transaction query |
| workspaces.transactions.observe | host | projection | subscribe | pure | workspace | workspace transaction authority | not-applicable | — | namespace availability() | transaction observation |
| workspaces.transactions.prepare.handle | host | operation | execute | exclusive | workspace | workspace transaction authority | not-applicable | exclusive | namespace availability() | transaction handle |
| security.policy.register | host | policy | decide | ordered | facade | security authority | owner-conflict | latest-wins | namespace availability() | security policy registration |
| agents.decisions.register | host | policy | decide | ordered | facade | agent runtime authority | owner-conflict | — | namespace availability() | agents.decisions.register({ point, id, priority?, scope?, decide }) returns a frozen handle { id, ownerId, generation, dispose() }; decisions follow the per-point vocabulary and the value-aware waterfall semantics |
| tools.executionPolicies.register | host | policy | decide | ordered | facade | tools execution authority | owner-conflict | — | namespace availability() | tools.executionPolicies.register({ point, id, priority?, scope?, decide }) returns a frozen handle; execute is the around-execution barrier and post-execute carries the official accept/block decision vocabulary |
| prompts.assemblyPolicies.register | host | policy | decide | ordered | facade | system-prompt authority | owner-conflict | — | namespace availability() | prompts.assemblyPolicies.register({ id, priority?, scope?, decide }) returns a frozen handle; the decide receives (assembly, context, next) and a record with a sections array is the whole-assembly replacement |
| events.decisions.register | host | policy | decide | ordered | facade | per-point producer authority | owner-conflict | — | namespace availability() | events.decisions.register(name, { id, priority?, scope?, decide }) returns a frozen handle; only the enumerated admitted points are accepted and every other name is a typed unsupported rejection naming the carrying face |
| security.redaction.register | host | policy | decide | ordered | facade | security authority | owner-conflict | latest-wins | namespace availability() | redaction policy registration |
| security.egress.register | host | policy | decide | ordered | facade | security authority | owner-conflict | latest-wins | namespace availability() | egress rule registration |
| security.egress.coverage | host | selfDescription | read | pure | facade | security authority | not-applicable | — | none | egress coverage projection { status, registration, cooperative, automatic, observedAt } |
| security.egress.check | host | — | read | pure | facade | security authority | not-applicable | — | none | consultation-style egress check |
| security.egress.lease.acquire | host | coordination | execute | coordinated | facade | security authority | fencing | exclusive | availability(scope) | egress lease acquisition (async coordination Outcome<Lease>; release(handle) give-back) |
| security.egress.lease.acquire.handle | host | coordination | execute | coordinated | facade | security authority | fencing | exclusive | availability(scope) | lease handle returned by acquire |
| security.egress.lease.release | host | coordination | execute | coordinated | facade | security authority | fencing | exclusive | availability(scope) | egress lease give-back verb (release(handle); idempotent; stale handle yields typed code conflict) |
| security.audit.query | host | projection | read | pure | facade | security authority | not-applicable | — | namespace availability() | audit query |
| security.audit.list | host | projection | read | pure | facade | security authority | not-applicable | — | namespace availability() | audit query |
| security.availability | host | selfDescription | read | pure | facade | security authority | not-applicable | — | frozen { status } | availability getter throwing when inactive |
| diagnostics.register | host | resourceRegistry | register | additive | facade | diagnostics authority | content-conflict | latest-wins | namespace availability() | register(spec) derives the owner from the caller context (a declared ownerId is ignored) and returns the shared frozen handle; invalid input raises a typed input error that lists the legal scope values |
| diagnostics.get | host | projection | read | pure | facade | diagnostics authority | not-applicable | — | namespace availability() | diagnostics query |
| diagnostics.onChange | host | projection | subscribe | pure | facade | diagnostics authority | not-applicable | — | namespace availability() | change subscription |
| diagnostics.observe | host | projection | subscribe | pure | facade | diagnostics authority | not-applicable | — | namespace availability() | change subscription |
| diagnostics.observe.handle | host | projection | read | pure | session | session authority | not-applicable | — | namespace availability() | new target handle without a current counterpart |
| diagnostics.availability | host | selfDescription | read | pure | facade | diagnostics authority | not-applicable | — | frozen { status } | — |
| settings.isActive | host | selfDescription | read | pure | profile | settings authority | not-applicable | — | none | frozen boolean data property |
| settings.register | host | resourceRegistry | register | additive | profile | settings authority | content-conflict | latest-wins | namespace availability() | settings section registration |
| settings.scope | host | projection | read | pure | profile | settings authority | not-applicable | — | namespace availability() | scope binding query returning a scope handle |
| settings.describe | host | projection | read | pure | profile | settings authority | not-applicable | — | namespace availability() | settings description query |
| settings.inspect | host | projection | read | pure | profile | settings authority | not-applicable | — | namespace availability() | settings description query |
| settings.installSettingsSection | host | — | read | pure | profile | settings authority | not-applicable | — | none | official section installer |
| settings.update | host | mutation | mutate | exclusive | profile | settings authority | compare-and-swap | — | namespace availability() | settings update write |
| settings.replace | host | mutation | mutate | exclusive | profile | settings authority | compare-and-swap | — | namespace availability() | settings replace write |
| settings.mutate | host | mutation | mutate | exclusive | profile | settings authority | compare-and-swap | — | namespace availability() | settings mutation write |
| settings.writable | host | passthrough-exception | execute | pure | profile | settings authority | not-applicable | — | none | official settings forwarding getter merged by the activated settings feature |
| settings.prepareDocument | host | passthrough-exception | execute | pure | profile | settings authority | not-applicable | — | none | official settings forwarding leaf merged by the activated settings feature |
| settings.get | host | passthrough-exception | execute | pure | profile | settings authority | not-applicable | — | none | official settings forwarding leaf merged by the activated settings feature; distinct from the facade scope handle read member |
| settings.remote | host | contribution | register | additive | profile | settings authority | owner-conflict | deduplicate | namespace availability() | one-argument remote contribution mount function remote(namespace, serviceKey) |
| settings.availability | host | selfDescription | read | pure | profile | settings authority | not-applicable | — | frozen { status } | — |
| settings.dispose | host | — | read | pure | profile | settings authority | not-applicable | — | none | namespace disposer clearing the scope cache |
| settings.register.handle | host | projection | read | pure | profile | settings authority | not-applicable | — | namespace availability() | registration handle with read members |
| settings.scope.handle | host | projection | read | pure | profile | settings authority | not-applicable | — | namespace availability() | scope handle { get(), watch(callback), update(patch), replace(section), mutate(ops, expectedRevision) } |
| profiles.inspect | host | projection | read | pure | profile | profile authority | not-applicable | — | namespace availability() | profile inspection query |
| profiles.health | host | projection | read | pure | profile | profile authority | not-applicable | — | namespace availability() | profile health query |
| profiles.planDiff | host | projection | read | pure | profile | profile authority | not-applicable | — | namespace availability() | plan diff query |
| profiles.apply | host | mutation | mutate | exclusive | profile | profile authority | compare-and-swap | — | namespace availability() | profile apply write |
| profiles.snapshot.create | host | mutation | mutate | exclusive | profile | profile authority | compare-and-swap | — | namespace availability() | snapshot create write |
| profiles.snapshot.modify | host | mutation | mutate | exclusive | profile | profile authority | compare-and-swap | — | namespace availability() | snapshot modify write |
| profiles.snapshot.delete | host | mutation | mutate | exclusive | profile | profile authority | compare-and-swap | — | namespace availability() | snapshot delete write |
| profiles.snapshot.apply | host | mutation | mutate | exclusive | profile | profile authority | compare-and-swap | — | namespace availability() | snapshot apply write |
| profiles.snapshot.validate | host | operation | execute | exclusive | profile | profile authority | not-applicable | exclusive | namespace availability() | snapshot validation |
| profiles.availability | host | selfDescription | read | pure | profile | profile authority | not-applicable | — | frozen { status } | — |
| remotes.isActive | host | selfDescription | read | pure | facade | remote publication authority | not-applicable | — | none | frozen boolean data property |
| remotes.publish | host | resourceRegistry | register | additive | facade | remote publication authority | content-conflict | latest-wins | namespace availability() | remote service publication |
| remotes.register.handle | host | resourceRegistry | register | additive | facade | remote publication authority | content-conflict | latest-wins | namespace availability() | frozen { id, ownerId, generation, dispose() } |
| remotes.dispose | host | — | read | pure | facade | remote publication authority | not-applicable | — | none | namespace-level disposer |
| storage.isActive | host | selfDescription | read | pure | workspace | storage binding authority | not-applicable | — | none | getter boolean |
| storage.open | host | operation | execute | exclusive | workspace | storage binding authority | not-applicable | exclusive | namespace availability() | storage binding open returning binding handle |
| storage.availability | host | selfDescription | read | pure | workspace | storage binding authority | not-applicable | — | frozen { status } | availability() returning { status, scope, durability, epoch } |
| storage.open.handle.close | host | — | read | pure | workspace | storage binding authority | not-applicable | — | none | handle close disposer returning a discriminated result |
| storage.open.handle.purge | host | mutation | mutate | exclusive | workspace | storage binding authority | not-applicable | — | namespace availability() | handle purge action returning a discriminated result |
| storage.open.handle.dispose | host | operation | execute | exclusive | workspace | storage binding authority | not-applicable | — | namespace availability() | handle dispose action returning a discriminated result |
| storage.open.handle.domain | host | passthrough-exception | execute | pure | workspace | storage binding authority | not-applicable | — | none | official storage domain handle exposed on the binding handle |
| services | host | passthrough-exception | execute | pure | facade | official service authority | not-applicable | — | none | audited official service namespace |
| isActive | client | selfDescription | read | pure | facade | facade root | not-applicable | — | none | frozen boolean state |
| apiVersion | client | selfDescription | read | pure | facade | facade root | not-applicable | — | none | frozen string |
| assertCompatible | client | selfDescription | read | pure | facade | facade root | not-applicable | — | none | typed throw negotiation |
| capabilities.get | client | selfDescription | read | pure | facade | facade root | not-applicable | — | none | status object per capability path |
| capabilities.list | client | selfDescription | read | pure | facade | facade root | not-applicable | — | none | frozen path list |
| capabilities.require | client | selfDescription | read | pure | facade | facade root | not-applicable | — | none | typed throw on missing |
| connection.isActive | client | selfDescription | read | pure | facade | client connection authority | not-applicable | — | none | getter boolean |
| connection.rpc.call | client | operation | execute | exclusive | facade | client connection authority | not-applicable | exclusive | namespace availability() | rpc call |
| connection.api.settings | client | projection | read | pure | facade | client connection authority | not-applicable | — | namespace availability() | settings api accessor |
| connection.api.llm | client | projection | read | pure | facade | client connection authority | not-applicable | — | namespace availability() | conditional official llm accessor |
| connection.dispose | client | — | read | pure | facade | client connection authority | not-applicable | — | none | connection disposer exposed publicly |
| events.isActive | client | selfDescription | read | pure | facade | event producer authority | not-applicable | — | none | getter boolean |
| events.on | client | projection | subscribe | pure | facade | event producer authority | not-applicable | — | namespace availability() | named subscription |
| events.localeChange.on | client | projection | subscribe | pure | facade | event producer authority | not-applicable | — | namespace availability() | official event face subscription |
| events.themeChange.on | client | projection | subscribe | pure | facade | event producer authority | not-applicable | — | namespace availability() | official event face subscription |
| events.connectionReset.on | client | projection | subscribe | pure | facade | event producer authority | not-applicable | — | namespace availability() | official event face subscription |
| events.commandExecuted.on | client | projection | subscribe | pure | facade | event producer authority | not-applicable | — | namespace availability() | official event face subscription |
| events.localeChange.isActive | client | selfDescription | read | pure | facade | event producer authority | not-applicable | — | none | official event face active state getter |
| events.themeChange.isActive | client | selfDescription | read | pure | facade | event producer authority | not-applicable | — | none | official event face active state getter |
| events.connectionReset.isActive | client | selfDescription | read | pure | facade | event producer authority | not-applicable | — | none | official event face active state getter |
| events.commandExecuted.isActive | client | selfDescription | read | pure | facade | event producer authority | not-applicable | — | none | official event face active state getter |
| remotes.$on | client | projection | read | pure | facade | remote publication authority | not-applicable | — | namespace availability() | remote event subscription |
| remotes.$dispatch | client | operation | execute | exclusive | facade | remote publication authority | not-applicable | exclusive | namespace availability() | remote dispatch |
| remotes.mountRemote | client | contribution | register | additive | facade | remote publication authority | owner-conflict | deduplicate | namespace availability() | remote mounting |
| remotes.mountRemoteContribution | client | contribution | register | additive | facade | remote publication authority | owner-conflict | deduplicate | namespace availability() | remote contribution mount |
| remotes.contribute.handle | client | contribution | register | additive | facade | remote publication authority | owner-conflict | deduplicate | namespace availability() | mount handles |
| settings.scope | client | projection | read | pure | profile | settings authority | not-applicable | — | namespace availability() | scope binding returning official scope |
| settings.remote.mountRemoteContribution | client | contribution | register | additive | profile | settings authority | owner-conflict | deduplicate | namespace availability() | remote settings contribution mount |
| slots.register | client | contribution | register | additive | facade | slot assembly authority | owner-conflict | deduplicate | namespace availability() | slot registration |
| slots.inject | client | contribution | register | additive | facade | slot assembly authority | owner-conflict | deduplicate | namespace availability() | slot injection |
| slots.entries | client | projection | read | pure | facade | slot assembly authority | not-applicable | — | namespace availability() | entries query |
| slots.subscribe | client | projection | subscribe | pure | facade | slot assembly authority | not-applicable | — | namespace availability() | entries subscription |
| slots.on | client | projection | subscribe | pure | facade | slot assembly authority | not-applicable | — | namespace availability() | slot event subscription |
| lifecycle.isActive | client | selfDescription | read | pure | facade | client lifecycle authority | not-applicable | — | none | getter boolean |
| lifecycle.registerFace | client | resourceRegistry | register | additive | facade | client lifecycle authority | content-conflict | latest-wins | namespace availability() | face registration returning handle |
| lifecycle.availability | client | selfDescription | read | pure | facade | client lifecycle authority | not-applicable | — | frozen { status } | availability query |
| lifecycle.onChange | client | projection | subscribe | pure | facade | client lifecycle authority | not-applicable | — | namespace availability() | change subscription |
| lifecycle.onRebind | client | projection | subscribe | pure | facade | client lifecycle authority | not-applicable | — | namespace availability() | rebind subscription |
| lifecycle.scan | client | projection | read | pure | facade | client lifecycle authority | not-applicable | — | namespace availability() | face snapshot query |
| lifecycle.register.handle | client | resourceRegistry | register | additive | facade | client lifecycle authority | content-conflict | latest-wins | namespace availability() | face registration handle |
| codec.zod | client | — | read | pure | facade | client codec authority | not-applicable | — | none | raw schema library instance exposed on the public codec face |
| codec.json | client | resourceRegistry | register | additive | facade | client codec authority | content-conflict | latest-wins | namespace availability() | json codec helper |
| codec.strict | client | resourceRegistry | register | additive | facade | client codec authority | content-conflict | latest-wins | namespace availability() | strict codec helper |
| codec.invocation | client | resourceRegistry | register | additive | facade | client codec authority | content-conflict | latest-wins | namespace availability() | invocation codec builder |
| codec.validateInvocation | client | operation | execute | exclusive | facade | client codec authority | not-applicable | exclusive | namespace availability() | invocation validation |
| services | client | passthrough-exception | execute | pure | facade | official service authority | not-applicable | — | none | audited official browser services namespace plus seven passthrough leaves |
| skills.availability | host | selfDescription | read | pure | facade | skill activation authority | not-applicable | — | frozen { status } | — |
| workspaces.availability | host | selfDescription | read | pure | workspace | workspace transaction authority | not-applicable | — | frozen { status } | — |
| remotes.availability | host | selfDescription | read | pure | facade | remote publication authority | not-applicable | — | frozen { status } | — |
| connection.availability | client | selfDescription | read | pure | facade | client connection authority | not-applicable | — | frozen { status } | — |
| events.availability | client | selfDescription | read | pure | facade | event producer authority | not-applicable | — | frozen { status } | — |
| remotes.availability | client | selfDescription | read | pure | facade | remote publication authority | not-applicable | — | frozen { status } | — |
| settings.availability | client | selfDescription | read | pure | profile | settings authority | not-applicable | — | frozen { status } | — |
| slots.availability | client | selfDescription | read | pure | facade | slot assembly authority | not-applicable | — | frozen { status } | — |
| codec.availability | client | selfDescription | read | pure | facade | client codec authority | not-applicable | — | frozen { status } | — |
| llm.routing.policies.register.handle | host | policy | decide | ordered | facade | llm domain authority | owner-conflict | latest-wins | namespace availability() | frozen { id, ownerId, generation, dispose() } |
| llm.routing.candidates.register.handle | host | resourceRegistry | register | additive | facade | llm domain authority | content-conflict | latest-wins | namespace availability() | frozen { id, ownerId, generation, dispose() } |
| llm.routing.health.circuitPolicy.register.handle | host | policy | decide | ordered | facade | llm domain authority | owner-conflict | latest-wins | namespace availability() | frozen { id, ownerId, generation, dispose() } |
| llm.routing.health.probe.register.handle | host | resourceRegistry | register | additive | facade | llm domain authority | content-conflict | latest-wins | namespace availability() | frozen { id, ownerId, generation, dispose() } |
| llm.providers.register.handle | host | resourceRegistry | register | additive | facade | llm domain authority | content-conflict | latest-wins | namespace availability() | — |
| llm.models.register.handle | host | resourceRegistry | register | additive | facade | llm domain authority | content-conflict | latest-wins | namespace availability() | — |
| agents.register.handle | host | resourceRegistry | register | additive | facade | agent registry authority | content-conflict | latest-wins | namespace availability() | — |
| executions.visibility.register.handle | host | policy | decide | ordered | facade | execution authority | owner-conflict | latest-wins | namespace availability() | — |
| executions.recovery.capability.register.handle | host | resourceRegistry | register | additive | facade | execution authority | content-conflict | latest-wins | namespace availability() | — |
| executions.recovery.policy.register.handle | host | policy | decide | ordered | facade | execution authority | owner-conflict | latest-wins | namespace availability() | — |
| executions.recovery.visibility.register.handle | host | policy | decide | ordered | facade | execution authority | owner-conflict | latest-wins | namespace availability() | — |
| sessions.channels.auth.register.handle | host | policy | decide | ordered | session | session authority | owner-conflict | latest-wins | namespace availability() | — |
| sessions.channels.auth.pairingProvider.register.handle | host | resourceRegistry | register | additive | session | session authority | content-conflict | latest-wins | namespace availability() | — |
| sessions.channels.redaction.register.handle | host | resourceRegistry | register | additive | session | session authority | content-conflict | latest-wins | namespace availability() | — |
| skills.activation.policy.register.handle | host | policy | decide | ordered | facade | skill activation authority | owner-conflict | latest-wins | namespace availability() | — |
| tools.restrict.register.handle | host | policy | decide | ordered | facade | tools authority | owner-conflict | latest-wins | namespace availability() | frozen { id, ownerId, generation, dispose() } |
| tools.guard.register.handle | host | policy | decide | ordered | facade | tools authority | owner-conflict | latest-wins | namespace availability() | frozen { id, ownerId, generation, dispose() } |
| tools.presentation.register.handle | host | resourceRegistry | register | additive | facade | tools authority | content-conflict | latest-wins | namespace availability() | frozen { id, ownerId, generation, dispose() } |
| tools.executionMode.register.handle | host | resourceRegistry | register | additive | facade | tools authority | content-conflict | latest-wins | namespace availability() | — |
| tasks.register.handle | host | resourceRegistry | register | additive | facade | task authority | content-conflict | latest-wins | namespace availability() | — |
| security.policy.register.handle | host | policy | decide | ordered | facade | security authority | owner-conflict | latest-wins | namespace availability() | — |
| security.redaction.register.handle | host | policy | decide | ordered | facade | security authority | owner-conflict | latest-wins | namespace availability() | — |
| security.egress.register.handle | host | policy | decide | ordered | facade | security authority | owner-conflict | latest-wins | namespace availability() | — |
| prompts.provenance.policy.register.handle | host | policy | decide | ordered | facade | system prompt authority | owner-conflict | latest-wins | namespace availability() | frozen { id, ownerId, generation, dispose() } |
| prompts.provenance.contribute.handle | host | contribution | register | additive | facade | system prompt authority | owner-conflict | deduplicate | namespace availability() | — |
| diagnostics.register.handle | host | resourceRegistry | register | additive | facade | diagnostics authority | content-conflict | latest-wins | namespace availability() | frozen { id, ownerId, generation, dispose() } |
| settings.remote.contribute.handle | host | contribution | register | additive | profile | settings authority | owner-conflict | deduplicate | namespace availability() | — |
| slots.contribute.handle | client | contribution | register | additive | facade | slot assembly authority | owner-conflict | deduplicate | namespace availability() | — |
| llm.adapters.register | host | resourceRegistry | register | additive | facade | llm authority | content-conflict | compare-and-swap | namespace availability() | real adapter route registration (plain-object spec: provider route id, declared models with real capability fields, callable stream implementation; optional replace-by-generation CAS) |
| llm.providers.register | host | resourceRegistry | register | additive | facade | llm authority | content-conflict | latest-wins | namespace availability() | official directory registration handle |
| llm.models.register | host | resourceRegistry | register | additive | facade | llm authority | content-conflict | latest-wins | namespace availability() | official model discovery disposer |
| llm.requestTransforms.register | host | policy | decide | ordered | facade | llm authority | owner-conflict | latest-wins | namespace availability() | register(spec) returns the shared frozen handle; the owner is derived from the caller context and the generation is facade-minted; official transform registration performs the installation |
| llm.routing.health.circuitPolicy.register | host | policy | decide | ordered | facade | routing authority | owner-conflict | latest-wins | namespace availability() | register(spec) returns the shared frozen handle; owner derived and generation minted by the facade; the registration table is keyed by (owner, id) |
| llm.routing.health.probe.register | host | resourceRegistry | register | additive | facade | routing authority | content-conflict | latest-wins | namespace availability() | register(spec) returns the shared frozen handle; owner derived and generation minted by the facade; the registration table is keyed by (owner, id) |
| agents.providers.register | host | resourceRegistry | register | additive | facade | agents authority | content-conflict | latest-wins | namespace availability() | register(spec) requires an explicit variant kind (factory \| announce \| enter), forwards the official verb verbatim and returns the shared frozen handle for every variant; an invalid or missing kind raises a typed error naming the legal variants; the announce variant is irreversible, so its dispose answers the typed stale no-op with that reason |
| executions.recovery.capability.register | host | resourceRegistry | register | additive | facade | recovery authority | content-conflict | latest-wins | namespace availability() | recovery capability declaration |
| sessions.channels.auth.register | host | policy | decide | ordered | session | channel authority | owner-conflict | latest-wins | namespace availability() | official verifier/authorizer registration disposer |
| sessions.channels.auth.pairingProvider.register | host | resourceRegistry | register | additive | session | channel authority | content-conflict | latest-wins | namespace availability() | official pairing provider registration disposer |
| sessions.channels.redaction.register | host | resourceRegistry | register | additive | session | channel authority | content-conflict | latest-wins | namespace availability() | official redaction profile registration disposer |
| tools.restrict.register | host | policy | decide | ordered | facade | tools authority | owner-conflict | latest-wins | namespace availability() | restriction registration; both forms answer with the same frozen handle (global and scoped through the target agent context); the official restrict verb performs the installation |
| tools.guard.register | host | policy | decide | ordered | facade | tools authority | owner-conflict | latest-wins | namespace availability() | guard registration; the official registration verb performs the installation and its disposer is wrapped into the shared frozen handle |
| tools.presentation.register | host | resourceRegistry | register | additive | facade | tools authority | content-conflict | latest-wins | namespace availability() | presentation registration; the official registration verb performs the installation and its disposer is wrapped into the shared frozen handle |
| tools.executionMode.register | host | resourceRegistry | register | additive | facade | tools authority | content-conflict | latest-wins | namespace availability() | official execution mode registration disposer |
| skills.activation.register | host | resourceRegistry | register | additive | facade | skills activation authority | content-conflict | latest-wins | namespace availability() | merged skill/descriptor registration |
| skills.activation.policy.register | host | policy | decide | ordered | facade | skills activation authority | owner-conflict | latest-wins | namespace availability() | minimal catalog update policy registration |
| prompts.contribute | host | contribution | register | additive | facade | prompts authority | owner-conflict | deduplicate | namespace availability() | merged contribution entry with seq handle; scope-bearing specs (spec.scope bound to an agents.scopes.handle) install into the target agent scoped layer with (owner, target, id) conflict keys and never degrade to a global installation; the handle dispose() is a discriminated result (revoked / stale) |
| remotes.register | host | resourceRegistry | register | additive | facade | remote authority | content-conflict | exclusive | namespace availability() | register(spec) returns the shared frozen handle; owner derived from the caller context; re-registration of the same key is idempotent and returns the same handle |
| settings.remote.contribute | host | contribution | register | additive | profile | settings authority | owner-conflict | deduplicate | namespace availability() | one-argument remote contribution mount function |
| attachments.pipeline.transforms.register | host | resourceRegistry | register | additive | facade | attachments authority | content-conflict | latest-wins | namespace availability() | register(spec) returns the shared frozen handle carrying a facade-minted slot token; the declared owner is the resource scope the transform lookup keys on, so registrations of different owners can never overwrite each other; identical content re-registration is idempotent |
| sessions.channels.acquire | host | coordination | execute | coordinated | session | channel authority | fencing | exclusive | namespace availability() | channel lease acquisition (open rename) |
| sessions.channels.release | host | coordination | execute | coordinated | session | channel authority | fencing | exclusive | namespace availability() | channel lease release (revoke rename) |
| tasks.acquire | host | coordination | execute | coordinated | facade | task authority | fencing | exclusive | namespace availability() | task claim (claim rename) |
| tasks.takeover | host | coordination | execute | coordinated | facade | task authority | fencing | exclusive | namespace availability() | task reassignment (reassign rename) |
| tasks.acquire.handle | host | coordination | execute | coordinated | facade | task authority | fencing | exclusive | namespace availability() | — |
| sessions.views.availability | host | selfDescription | read | pure | session | session authority | not-applicable | — | frozen { status } | namespace availability() returning frozen { status } |
| sessions.activity.current | host | projection | read | pure | session | session activity projection owner | not-applicable | — | namespace availability member on sessions.activity | frozen { snapshot, sessionQueue, gap, unavailable } \| typed absence { ok:false, code:'absent' } |
| sessions.activity.get | host | projection | read | pure | session | session activity projection owner | not-applicable | — | namespace availability member on sessions.activity | frozen { snapshot, sessionQueue, gap, unavailable } \| typed absence { ok:false, code:'absent' } |
| sessions.activity.list | host | projection | read | pure | session | session activity projection owner | not-applicable | — | namespace availability member on sessions.activity | frozen { items, nextCursor, truncated, gap, unavailable } |
| sessions.activity.history | host | projection | read | pure | session | session activity projection owner | not-applicable | — | namespace availability member on sessions.activity | frozen { items, truncated, unavailable, gap, boundary:'facade-lifetime' } |
| sessions.activity.observe | host | projection | read | additive | session | session activity projection owner | not-applicable | — | namespace availability member on sessions.activity | handle { current(), subscribe(listener), dispose(), epoch } |
| sessions.activity.observe.handle | host | projection | read | additive | session | session activity projection owner | not-applicable | — | none | members: current() / subscribe(listener) / dispose() / epoch |
| sessions.activity.availability | host | selfDescription | read | pure | facade | session activity projection owner | not-applicable | — | leaf | frozen { status: active\|degraded\|unavailable, reason?: string } |
| sessions.planMode.get | host | projection | read | pure | session | official plan-mode authority | not-applicable | — | namespace availability member on sessions.planMode | frozen { target, active, pending?, observedAt, source: 'official' } \| typed degraded/unavailable view; never the facade's own bookkeeping |
| sessions.planMode.select | host | mutation | mutate | coordinated | session | official plan-mode authority | compare-and-swap | — | namespace availability member on sessions.planMode | frozen discriminated result { ok, code: committed\|queued\|cancelled\|noop\|unavailable\|invalid-target\|invalid-input\|denied\|internal, reason?, commitState?, mode?, pending?, appliedAt? } mapped from the official arbitration verbs |
| sessions.planMode.observe | host | projection | subscribe | additive | session | official plan-mode authority | not-applicable | — | namespace availability member on sessions.planMode | target-bound observe handle { current(), subscribe(listener), dispose(), epoch } |
| sessions.planMode.observe.handle | host | projection | read | additive | session | official plan-mode authority | not-applicable | — | none | members: current() / subscribe(listener) / dispose() / epoch |
| sessions.planMode.availability | host | selfDescription | read | pure | facade | official plan-mode authority | not-applicable | — | leaf | frozen { status: active\|degraded\|unavailable, reason?: string } |
| sessions.permissionPresets.current | host | projection | read | pure | session | official permission-presets authority | not-applicable | — | namespace availability member on sessions.permissionPresets | frozen { target, preset, observedAt, source: 'official' } \| typed degraded/unavailable view; the derived custom state is reported verbatim and is never a selection target |
| sessions.permissionPresets.options | host | projection | read | pure | session | official permission-presets authority | not-applicable | — | namespace availability member on sessions.permissionPresets | frozen { target, options, currentValue, observedAt, source } from the official permissions projection \| typed degraded view with an empty option list (nothing is ever fabricated) |
| sessions.permissionPresets.select | host | mutation | mutate | coordinated | session | official permission-presets authority | compare-and-swap | — | namespace availability member on sessions.permissionPresets | frozen discriminated result { ok, code: committed\|unchanged\|not-applied\|invalid-preset\|unknown-preset\|invalid-target\|invalid-input\|denied\|unavailable\|internal, reason?, commitState?, preset?, appliedAt? } mapped from the official selection verbs with a read-back proof |
| sessions.permissionPresets.observe | host | projection | subscribe | additive | session | official permission-presets authority | not-applicable | — | namespace availability member on sessions.permissionPresets | target-bound observe handle { current(), subscribe(listener), dispose(), epoch } |
| sessions.permissionPresets.observe.handle | host | projection | read | additive | session | official permission-presets authority | not-applicable | — | none | members: current() / subscribe(listener) / dispose() / epoch |
| sessions.permissionPresets.availability | host | selfDescription | read | pure | facade | official permission-presets authority | not-applicable | — | leaf | frozen { status: active\|degraded\|unavailable, reason?: string } |
| credentials.set | host | mutation | mutate | coordinated | profile | official credentials provider | compare-and-swap | compare-and-swap | namespace availability member on credentials | frozen discriminated result { ok, code: committed\|unchanged\|conflict\|revision-unknown\|read-only\|invalid-input\|denied\|unavailable\|internal, reason?, ref?, revision?, expectedRevision?, currentRevision?, persistedAt? } \| never carries a credential value; success is proven against the management storage layer (source: file) |
| credentials.unset | host | mutation | mutate | coordinated | profile | official credentials provider | compare-and-swap | compare-and-swap | namespace availability member on credentials | frozen discriminated result over the same code set; an absent managed ref is the declared idempotent unchanged result, and a rejected write is verified against the management storage layer before it is reported as committed or failed |
| credentials.availability | host | selfDescription | read | pure | facade | official credentials provider | not-applicable | — | leaf | frozen { status: active\|degraded\|unavailable, reason?: string }; per-ref read-only backends stay a ref-level signal on the preflight, not a namespace status |
| sessions.compaction.run | host | operation | execute | coordinated | session | compaction replacement authority | not-applicable | exclusive | namespace availability member on sessions.compaction | frozen discriminated result: compacted (lineage, no summary body) / skipped (no-candidate) / rejected (policy reason) / aborted / failed (stable code and stage) \| the gate failure is the typed feature-disabled error and the engine stays the only executor |
| sessions.compaction.availability | host | selfDescription | read | pure | facade | compaction replacement authority | not-applicable | — | leaf | frozen { status: active\|degraded\|unavailable, reason?: string } resolved from the marker/version gate on every read; never throws |
| workflows.start | host | operation | execute | additive | profile | workflow authority | not-applicable | — | namespace availability member on workflows | frozen synchronous discriminated result: {ok:true, code:started, operation} where operation is the run control handle, or a no-run refusal (official codes passed through unchanged; facade codes invalid-request / parent-unresolved / internal); terminal is absent because the run may still be in flight at return — its terminal source is operation.status() |
| workflows.start.handle | host | operation | execute | additive | profile | workflow authority | not-applicable | — | none | frozen { id, ownerId, meta, status(), observe(listener), result, cancel(reason?), dispose() }; observe is a run-scoped filter over the existing workflow/* feed and returns an unsubscribe function; meta / result / cancel are registered domain extension members |
| workflows.availability | host | selfDescription | read | pure | facade | workflow authority | not-applicable | — | leaf | frozen { status: active\|degraded\|unavailable, reason?: string } probing the official engine seam on every read; never throws |
| sessions.request | host | operation | execute | exclusive | session | session request authority | owner-conflict | deduplicate | namespace availability() with reason layering | accepted { ok:true, code:accepted, operation:{ id, ownerId, capability, status(), observe(), dispose() } } \| steered { ok:true, code:accepted, delivery:'steer', operation:{ id } } \| queued { ok:true, code:accepted, delivery:'queue', queuedRef:{ id, operationId } } \| typed duplicate \| already-running \| rejected \| denied \| unavailable; message.attachmentRefs carries official durable image references (ImageAttachmentRef) that are verified through the attachments authority and mapped one-to-one into { type:'image', attachment:<canonical ref> } blocks — any unresolvable reference fails the whole request typed with a per-reference reason |
| sessions.request.handle | host | operation | read | exclusive | session | session request authority | not-applicable | deduplicate | none | members: id / ownerId / capability(deduped,noAutoRetry,failClosed) / status() / observe() / dispose() |
| sessions.cancel | host | operation | execute | exclusive | session | session request authority | not-applicable | deduplicate | namespace availability() with reason layering | typed {ok:true, code:accepted} \| {ok:true, code:accepted, scope:'queue'} (a not-yet-claimed queued delivery was discarded) \| {ok:false, code:conflict\|stale\|invalid-input\|unavailable}; a claimed queued delivery falls through to the live-operation cancel only while its recorded operationId is still the live one |
| sessions.cancel.handle | host | operation | read | exclusive | session | session request authority | not-applicable | deduplicate | none | members: id / ownerId / capability(deduped,noAutoRetry,failClosed) / status() / observe() / dispose() |
| sessions | client | selfDescription | read | pure | facade | facade client root | not-applicable | — | namespace availability() | client semantic root with same-shape request/cancel members |
| sessions.request | client | operation | execute | exclusive | session | session request authority | owner-conflict | deduplicate | namespace availability() with reason layering | accepted { ok:true, code:accepted, operation:{ id, ownerId, capability, status(), observe(), dispose() } } \| steered { ok:true, code:accepted, delivery:'steer', operation:{ id } } \| queued { ok:true, code:accepted, delivery:'queue', queuedRef:{ id, operationId } } \| typed duplicate \| already-running \| rejected \| denied \| unavailable; message.attachmentRefs carries official durable image references (ImageAttachmentRef) that are verified through the attachments authority and mapped one-to-one into { type:'image', attachment:<canonical ref> } blocks — any unresolvable reference fails the whole request typed with a per-reference reason |
| sessions.cancel | client | operation | execute | exclusive | session | session request authority | not-applicable | deduplicate | namespace availability() with reason layering | typed {ok:true, code:accepted} \| {ok:true, code:accepted, scope:'queue'} (a not-yet-claimed queued delivery was discarded) \| {ok:false, code:conflict\|stale\|invalid-input\|unavailable}; a claimed queued delivery falls through to the live-operation cancel only while its recorded operationId is still the live one |
| attention.current | host | projection | read | pure | session | attention hub (host) | not-applicable | — | namespace availability() | frozen array of redacted items or availability view |
| attention.list | host | projection | read | pure | session | attention hub (host) | not-applicable | — | namespace availability() | frozen { items, nextCursor } or availability view |
| attention.observe | host | projection | subscribe | additive | session | attention hub (host) | not-applicable | — | namespace availability() | handle { current(), subscribe(listener), dispose(), epoch } |
| attention.observe.handle | host | projection | read | additive | session | attention hub (host) | not-applicable | — | none | members: current() / subscribe(listener) / dispose() / epoch |
| attention.contribute | host | contribution | register | exclusive | session | attention hub (host) | owner-conflict | — | namespace availability() | typed {ok:true, code:registered, handle:{id, ownerId, seq, dispose()}} \| {ok:false, code:conflict\|owner-conflict\|invalid-input\|capacity\|stale} |
| attention.dismiss | host | operation | execute | exclusive | session | attention hub (host) | owner-conflict | deduplicate | namespace availability() | typed {ok:true, code:dismissed} \| {ok:false, code:not-found\|unavailable\|invalid-input} |
| attention.invoke | host | operation | execute | exclusive | session | attention hub (host) | owner-conflict | deduplicate | namespace availability() | typed {ok:true, code:invoked, result?} \| {ok:false, code:not-found\|conflict\|unavailable} |
| attention.availability | host | selfDescription | read | pure | facade | attention hub (host) | not-applicable | — | leaf | frozen { status: active\|degraded\|unavailable, reason?: string } |
| attention | client | selfDescription | read | pure | facade | facade client root | not-applicable | — | namespace availability() | client attention projection (audience-filtered) over the browser runtime |
| attention.current | client | projection | read | pure | session | attention hub (host) | not-applicable | — | namespace availability() | frozen array of audience-filtered redacted items |
| attention.list | client | projection | read | pure | session | attention hub (host) | not-applicable | — | namespace availability() | frozen { items, nextCursor } |
| attention.observe | client | projection | subscribe | additive | session | attention hub (host) | not-applicable | — | namespace availability() | handle { current(), subscribe(listener), dispose(), epoch } |
| attention.observe.handle | client | projection | read | additive | session | attention hub (host) | not-applicable | — | none | members: current() / subscribe(listener) / dispose() / epoch |
| attention.contribute | client | contribution | register | exclusive | session | attention hub (host) | owner-conflict | — | namespace availability() | typed contribution outcome over the client-request carrier |
| attention.dismiss | client | operation | execute | exclusive | session | attention hub (host) | owner-conflict | deduplicate | namespace availability() | typed dismissal outcome |
| attention.invoke | client | operation | execute | exclusive | session | attention hub (host) | owner-conflict | deduplicate | namespace availability() | typed invocation outcome |
| executions.recovery.checkpoints.create | host | mutation | mutate | coordinated | session | checkpoint capture authority | content-conflict | — | namespace availability() | typed {ok:true, code:created\|deduplicated, summary:{checkpointId,...}} \| {ok:false, code:conflict\|unavailable\|denied\|invalid-input} |
| executions.recovery.checkpoints.list | host | projection | read | pure | session | checkpoint projection owner | not-applicable | — | namespace availability() | frozen { items, nextCursor, truncated, unavailable, gap } |
| executions.recovery.checkpoints.inspect | host | projection | read | pure | session | checkpoint projection owner | not-applicable | — | namespace availability() | frozen record view { record, scope: {session\|workspace, resourceStatus}, availability } \| typed absence |
| executions.recovery.checkpoints.planRestore | host | projection | read | pure | session | checkpoint restore planner | not-applicable | — | namespace availability() | frozen plan projection; anchored steps carry owner authority binding |
| executions.recovery.checkpoints.restore | host | operation | execute | coordinated | session | checkpoint restore authority (single operation terminal) | fencing | exclusive | namespace availability() | typed {ok:true, code:accepted\|completed, operation:{id, ownerId, status(), observe(), dispose()}, observedAt} \| {ok:false, code:aborted\|denied, reason, operation, observedAt}; the former read-only status snapshot is now operation.status(); accepted is used only when the terminal is not yet decidable |
| executions.recovery.checkpoints.restore.handle | host | operation | read | coordinated | session | checkpoint restore authority | fencing | exclusive | none | frozen { id, ownerId, status(), observe(), dispose() }; status() carries the restore stage, attempts, result and terminal |
| executions.recovery.checkpoints.availability | host | selfDescription | read | pure | facade | checkpoint projection owner | not-applicable | — | leaf | frozen { status: active\|degraded\|unavailable, reason?: string, sources: per-source availability } |
| llm.adapters.decorations.register | host | resourceRegistry | register | additive | facade | llm domain authority | content-conflict | latest-wins | namespace availability() | decoration registration on the replacement-owned decoration registry (labels vocabulary, execution phase stream) |
| llm.adapters.decorations.list | host | projection | read | pure | facade | llm domain authority | not-applicable | — | namespace availability() | decoration snapshot query (frozen decoration registry projection) |
| llm.adapters.decorations.register.handle | host | resourceRegistry | register | additive | facade | llm domain authority | content-conflict | latest-wins | namespace availability() | caller-bound facet handle { dispose(), snapshot() } (idiom exception recorded) |
| llm.models.list | host | projection | read | pure | facade | llm domain authority | not-applicable | — | namespace availability() | unified model-catalog projection: frozen read-time merge of official adapter-route catalogs, facade-registered declared capability fields, and dormant directory entries; per-entry honest unavailable marking; decorations never feed the view |
| agents.scopes.register | host | resourceRegistry | register | additive | facade | agents domain authority | not-applicable | latest-wins | namespace availability() | scope-bound handle registration: resolves the target through the official agents registry; unresolvable targets and malformed specs are discriminated typed results (unavailable/invalid-input) without global fallback, while an inactive core or an unmounted scoped feature is a typed disabled/inactive error (the member stays present) |
| agents.scopes.register.handle | host | resourceRegistry | register | additive | facade | agents domain authority | not-applicable | latest-wins | namespace availability() | scope-bound handle { id, ownerId, generation, target, status(), dispose() } (idiom exception recorded); dispose is an identity-bound discriminated no-op result (stale after dispose or owner unload) |
| agents.scopes.snapshotOf | host | projection | read | pure | facade | agents domain authority | not-applicable | — | namespace availability() | per-step model-selection snapshot consumption cell for the bound target: current (writer latest) and assembled (step-captured); stale or foreign handles are typed unavailable |
| sessions.interactions.list | client | projection | read | pure | session | facade client root | not-applicable | — | namespace availability() | the same typed shape the host face returns, projected value-only before it rides the carrier |
| sessions.interactions.get | client | projection | read | pure | session | facade client root | not-applicable | — | namespace availability() | the same typed shape the host face returns, projected value-only before it rides the carrier |
| sessions.interactions.respond | client | operation | execute | coordinated | session | facade client root | owner-conflict | exclusive | namespace availability() | the same typed shape the host face returns, projected value-only before it rides the carrier |
| sessions.interactions.availability | client | selfDescription | read | pure | facade | facade client root | not-applicable | — | namespace availability() | the same typed shape the host face returns, projected value-only before it rides the carrier |
| sessions.selection.get | client | projection | read | pure | session | facade client root | not-applicable | — | namespace availability() | the same typed shape the host face returns, projected value-only before it rides the carrier |
| sessions.selection.set | client | mutation | execute | coordinated | session | facade client root | compare-and-swap | compare-and-swap | namespace availability() | frozen { ok:true, code:'committed', revision, view } \| { ok:false, code:'conflict'\|'rejected'\|'unavailable', reason? }; the submitted selection is completed from the official current value for fields the caller did not name |
| sessions.selection.availability | client | selfDescription | read | pure | facade | facade client root | not-applicable | — | namespace availability() | the same typed shape the host face returns, projected value-only before it rides the carrier |
| sessions.interactions | host | selfDescription | read | pure | facade | pending-interaction authority | not-applicable | — | namespace availability() | caller-bound sub-surface whose disabled face keeps the exact member set |
| sessions.selection | host | selfDescription | read | pure | facade | selection authority | not-applicable | — | namespace availability() | caller-bound sub-surface whose disabled face keeps the exact member set |
| sessions.interactions.list | host | projection | read | pure | session | pending-interaction authority | not-applicable | — | namespace availability member on sessions.interactions (per-kind sources) | frozen { ok:true, items:[{ id, kind:'approval', sessionId, summary, createdAt, answerShape }], nextCursor, sources:{ approval, question } } \| typed unavailable/degraded; an empty list never stands in for a healthy source |
| sessions.interactions.get | host | projection | read | pure | session | pending-interaction authority | not-applicable | — | namespace availability member on sessions.interactions | frozen { ok:true, view } \| { ok:false, code:'missing'\|'unavailable' } |
| sessions.interactions.respond | host | operation | execute | coordinated | session | official approval authority (the waterfall answerer chain) | owner-conflict | exclusive | namespace availability member on sessions.interactions | frozen { ok:true, code:'accepted' } \| { ok:false, code:'stale'\|'rejected'\|'denied'\|'unavailable', reason? }; 'denied' is a reserved code on this member (the facade performs no authorization decision of its own) |
| sessions.interactions.availability | host | selfDescription | read | pure | facade | pending-interaction authority | not-applicable | — | leaf | frozen { status, reason?, sources } — degraded while the question source is unavailable on this runtime |
| sessions.selection.get | host | projection | read | pure | session | official api-proxy selection state (read through the audited apiProxy whitelist member) | not-applicable | — | namespace availability member on sessions.selection | frozen { ok:true, view:{ sessionId, provider, model, effort, revision, source, committedAt, observedAt } } \| typed unavailable; source discloses the effective tier and committedAt stays null unless this facade witnessed the commit |
| sessions.selection.set | host | mutation | execute | coordinated | session | official api-proxy selection state (submitted through the audited apiProxy whitelist member) | compare-and-swap | compare-and-swap | namespace availability member on sessions.selection | frozen { ok:true, code:'committed', revision, view } \| { ok:false, code:'conflict'\|'rejected'\|'unavailable', reason? }; the submitted selection is completed from the official current value for fields the caller did not name |
| sessions.selection.availability | host | selfDescription | read | pure | facade | selection authority | not-applicable | — | leaf | frozen { status: active\|degraded\|unavailable, reason? } — degraded when only the submit seam is missing |

## 附：namespace 导航记录（registry `namespaces`）

| namespace | runtime | capabilityPath | contributingFeatures | availabilityMember |
|---|---|---|---|---|
| events | host | events | ['facade domain assembly'] | events.availability |
| llm | host | llm | ['facade domain assembly'] | llm.availability |
| agents | host | agents | ['facade domain assembly'] | agents.availability |
| executions | host | executions | ['facade domain assembly'] | executions.availability |
| sessions | host | sessions | ['facade domain assembly'] | sessions.availability |
| tools | host | tools | ['facade domain assembly'] | tools.availability |
| skills | host | skills | ['facade domain assembly'] | skills.availability |
| prompts | host | prompts | ['facade domain assembly'] | prompts.availability |
| attachments | host | attachments | ['facade domain assembly'] | attachments.availability |
| mcp | host | mcp | ['facade domain assembly'] | mcp.availability |
| tasks | host | tasks | ['facade domain assembly'] | tasks.availability |
| coordination | host | coordination | ['facade domain assembly'] | coordination.availability |
| workspaces | host | workspaces | ['facade domain assembly'] | workspaces.availability |
| security | host | security | ['facade domain assembly'] | security.availability |
| diagnostics | host | diagnostics | ['facade domain assembly'] | diagnostics.availability |
| settings | host | settings | ['facade domain assembly'] | settings.availability |
| profiles | host | profiles | ['facade domain assembly'] | profiles.availability |
| remotes | host | remotes | ['facade domain assembly'] | remotes.availability |
| storage | host | storage | ['facade domain assembly'] | storage.availability |
| services | host | services | ['facade domain assembly'] | — |
| llm.routing | host | llm.routing | ['facade domain assembly'] | llm.routing.availability |
| executions.recovery | host | executions.recovery | ['facade domain assembly'] | executions.recovery.availability |
| sessions.branches | host | sessions.branches | ['facade domain assembly'] | sessions.branches.availability |
| sessions.channels | host | sessions.channels | ['facade domain assembly'] | sessions.channels.availability |
| sessions.views | host | sessions | ['facade domain assembly'] | sessions.views.availability |
| tools.discovery | host | tools.discovery | ['facade domain assembly'] | tools.discovery.availability |
| skills.activation | host | skills.activation | ['facade domain assembly'] | skills.activation.availability |
| prompts.provenance | host | prompts.provenance | ['facade domain assembly'] | prompts.provenance.availability |
| attachments.projection | host | attachments.projection | ['facade domain assembly'] | attachments.projection.availability |
| connection | client | connection | ['facade domain assembly'] | connection.availability |
| events | client | events | ['facade domain assembly'] | events.availability |
| remotes | client | remotes | ['facade domain assembly'] | remotes.availability |
| settings | client | settings | ['facade domain assembly'] | settings.availability |
| slots | client | slots | ['facade domain assembly'] | slots.availability |
| lifecycle | client | lifecycle | ['facade domain assembly'] | lifecycle.availability |
| codec | client | codec | ['facade domain assembly'] | codec.availability |
| services | client | services | ['facade domain assembly'] | — |
| sessions.activity | host | sessions.activity | ['session-activity-projection'] | sessions.activity.availability |
| sessions.planMode | host | sessions.planMode | ['session-plan-mode-control'] | sessions.planMode.availability |
| sessions.permissionPresets | host | sessions.permissionPresets | ['session-permission-preset-control'] | sessions.permissionPresets.availability |
| sessions.compaction | host | sessions.compaction | ['compaction-operation'] | sessions.compaction.availability |
| credentials | host | credentials | ['credential-mutation-contract'] | credentials.availability |
| workflows | host | workflows | ['workflow-execution-contract'] | workflows.availability |
| sessions.request | host | sessions.request | ['session-interaction-operation'] | sessions.availability |
| attention | host | attention | ['client-attention-contribution'] | attention.availability |
| attention | client | client.attention | ['client-attention-contribution'] | — |
| executions.recovery.checkpoints | host | executions.recovery.checkpoints | ['checkpoint-restore-contract'] | executions.recovery.checkpoints.availability |
| sessions | client | client.sessions | ['session-interaction-operation'] | — |
| sessions.interactions | host | sessions.interactions | ['interactive-session-access'] | sessions.interactions.availability |
| sessions.selection | host | sessions.selection | ['interactive-session-access'] | sessions.selection.availability |
| sessions.interactions | client | sessions.interactions | ['interactive-session-access'] | sessions.interactions.availability |
| sessions.selection | client | sessions.selection | ['interactive-session-access'] | sessions.selection.availability |
