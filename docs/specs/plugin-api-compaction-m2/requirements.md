# Feature Requirements: plugin-api-compaction-m2

## Introduction

`plugin-api-compaction-m2` delivers SV17 as a host-side, A-class capability
seam at `ctx.pluginApi.services.compaction`. It extends the already delivered
18-key `pluginApi.services` namespace with a stable, read-only facade for the
official `ctx.compaction` service.

The facade's supported member set is deliberately determined by the public
abstract service contract, not by a loaded backend's runtime shape. Source
research against the installed DSH runtime establishes that
`@deepseek-ai/dsh-compaction` declares these three and only these abstract
operations on `CompactionEngine`:

- `compactIfNeeded(agent, trigger, signal)`;
- `compactNow(agent, signal, sourceCommandId?)`;
- `compactRegion(start, end, agent, signal?)`.

`BasicCompactionEngine.summarize(input, agent, signal?)` is a protected
subclass customization hook in `@deepseek-ai/dsh-compaction-basic`; its input
and result types are not part of that package's root public exports. It is not
a consumer-facing `CompactionEngine` operation and is therefore outside this
facade contract.

This feature depends on `plugin-api-capabilities-m1` and reuses its services
namespace, common A-class passthrough contract, typed errors, fail-safe guard,
and per-service/per-member disabled-facade presentation. It introduces no
client API, no new compaction backend, no changes to compaction policy or
summarization, and no Cordis event or event-catalog entry.

**Type:** A (official service direct binding; no semantic translation)

**Scope boundary:** The official package's `compaction/*` names are durable
session-log event types rather than Cordis `Events`. This feature neither
subscribes to, emits, nor stabilizes them through `pluginApi.events`.

---

## Requirements

### 1. `services.compaction` namespace integration and read-only shape

**User Story:** As a third-party plugin author, I want a discoverable,
read-only `pluginApi.services.compaction` facade, so that I can use the
official compaction capability without binding to a concrete backend's shape.

**Acceptance Criteria:**

1. GIVEN the `pluginApi` service and the `services` feature are active, WHEN a third-party plugin reads `ctx.pluginApi.services`, THEN it SHALL expose exactly these 19 keys and no others: `fs`, `codeRuntime`, `workspaces`, `subagents`, `workflows`, `approval`, `userQuestions`, `attachments`, `skills`, `storage`, `sessionProjections`, `sessionQuery`, `sessionTitle`, `sessionTelemetry`, `sessionReferences`, `tokenMeter`, `agentDefaultModel`, `web`, and `compaction`.
2. GIVEN the `pluginApi` service is active, all existing capability services are unavailable, and a complete `ctx.compaction` service is available, WHEN the `services` feature mounts, THEN it SHALL remain active and expose an active `pluginApi.services.compaction` facade while each existing unavailable service facade follows its delivered disabled-facade contract.
3. GIVEN the `pluginApi` service and the `services` feature are active, WHEN a third-party plugin reads `ctx.pluginApi.services.compaction`, THEN it SHALL receive a stable facade object with observable `isActive === true` and exactly the three callable members `compactIfNeeded`, `compactNow`, and `compactRegion`.
4. WHEN a third-party plugin attempts to assign to, delete, extend, or otherwise mutate `pluginApi.services` or `pluginApi.services.compaction`, THEN that mutation SHALL NOT be observable by any consumer.
5. WHEN the facade is created, THEN it SHALL NOT freeze, seal, proxy, or otherwise mutate the official `ctx.compaction` service object.
6. GIVEN a third-party plugin reads any existing non-compaction member of `pluginApi.services`, WHEN this feature is active, THEN that member's key, facade identity, passthrough surface, and disabled-state behavior SHALL remain governed by the delivered `plugin-api-capabilities-m1` contract.

**Type:** Facade foundation plus A-class service direct binding.

---

### 2. Stable abstract compaction operation contract

**User Story:** As a compaction consumer, I want the facade to expose only
operations all valid `CompactionEngine` providers must implement, so that my
plugin remains independent of the installed backend.

**Acceptance Criteria:**

1. WHEN a third-party plugin calls `pluginApi.services.compaction.compactIfNeeded(agent, trigger, signal)`, THEN the facade SHALL invoke `ctx.compaction.compactIfNeeded(agent, trigger, signal)` with the same arguments in the same order and SHALL return the exact official return value.
2. WHEN a third-party plugin calls `pluginApi.services.compaction.compactNow(agent, signal)` or `pluginApi.services.compaction.compactNow(agent, signal, sourceCommandId)`, THEN the facade SHALL invoke `ctx.compaction.compactNow` with the exact corresponding argument list, preserving whether `sourceCommandId` was omitted, and SHALL return the exact official return value.
3. WHEN a third-party plugin calls `pluginApi.services.compaction.compactRegion(start, end, agent)` or `pluginApi.services.compaction.compactRegion(start, end, agent, signal)`, THEN the facade SHALL invoke `ctx.compaction.compactRegion` with the exact corresponding argument list, preserving whether `signal` was omitted, and SHALL return the exact official return value.
4. WHEN any stable compaction operation throws synchronously or returns a rejected promise, THEN the facade SHALL propagate the exact error or rejection unchanged and SHALL NOT catch, wrap, suppress, retry, or substitute it.
5. WHEN a third-party plugin supplies an agent, trigger, abort signal, command identity, range value, callback, object, or any other argument to a stable compaction operation, THEN the facade SHALL pass that value through without cloning, freezing, caching, wrapping, validation, or alteration.
6. WHEN a stable compaction operation returns an object, promise, value, error, or other result, THEN the facade SHALL preserve its identity and observable timing and SHALL NOT proxy, clone, cache, or attach facade-specific side effects to it.
7. WHEN the facade delegates a stable compaction operation, THEN it SHALL preserve the official `ctx.compaction` object as the method's `this` binding.

**Type:** A (official `@deepseek-ai/dsh-compaction` abstract service direct passthrough).

---

### 3. Backend-neutral boundary and provider seam

**User Story:** As a compaction backend maintainer, I want the facade contract
to distinguish the official provider interface from one backend's extension
hooks, so that alternate valid providers are not made incompatible by an
accidental Basic-backend dependency.

**Acceptance Criteria:**

1. WHEN a third-party plugin reads `pluginApi.services.compaction`, THEN the facade SHALL NOT expose `summarize`, `config`, automatic-compaction state, overflow state, injection metadata, or any other member declared only by `BasicCompactionEngine` or another concrete backend.
2. WHEN the installed `ctx.compaction` implementation has an own, inherited, private, protected, or dynamically added member outside the three stable operations, THEN the facade SHALL NOT expose that member.
3. WHEN a third-party plugin calls a supported facade operation, THEN the facade SHALL not determine support from the concrete backend class name, package identity, configuration shape, or presence of Basic-specific members.
4. WHEN a compaction provider author needs to supply a backend, THEN this feature SHALL NOT provide a registration, replacement, configuration, or summarization API; the supported provider seam remains the official public `CompactionEngine` contract, whose provider obligations are the three stable operations.
5. WHEN an upstream version promotes an additional operation into the public `CompactionEngine` contract, THEN that operation SHALL NOT appear in this facade until a separately approved specification explicitly adds it.
6. WHEN an upstream version provides a public, backend-neutral consumer contract for summarization, THEN this feature SHALL NOT expose it until a separately approved specification explicitly adds it.

**Type:** A contract boundary; no Basic-backend coupling and no new provider semantics.

---

### 4. Per-service and per-member degradation

**User Story:** As a plugin author, I want compaction availability to be
explicit and locally contained, so that a missing or incomplete compaction
provider cannot disable other capability facades or crash harness boot.

**Acceptance Criteria:**

1. GIVEN the `services` feature is active and `ctx.get('compaction')` is unavailable or throws while the services namespace is built, WHEN a third-party plugin reads `pluginApi.services.compaction`, THEN it SHALL receive an observable disabled facade with `isActive === false`; calls to each declared stable operation SHALL produce the foundation-defined typed feature-disabled error for `services.compaction` and SHALL NOT call an official service.
2. GIVEN the `services` feature is active and `ctx.get('compaction')` resolves to a value missing a declared stable operation or where a declared stable operation is not callable, WHEN the services namespace is built, THEN the compaction facade SHALL be observably disabled through the existing per-member disabled-facade path; it SHALL expose `isActive === false`, each declared stable operation SHALL produce the foundation-defined typed feature-disabled error for `services.compaction`, and the facade SHALL NOT expose a partially active surface.
3. GIVEN the `pluginApi` core is inactive, WHEN any declared `services.compaction` operation is called from either an active or disabled compaction facade, THEN it SHALL produce the foundation-defined typed inactive error before touching an official service.
4. GIVEN the `services` feature is disabled before the compaction facade mounts, WHEN any declared `pluginApi.services.compaction` operation is called, THEN it SHALL produce the foundation-defined typed feature-disabled error for `services` and SHALL NOT call an official service.
5. GIVEN the `services` feature is active and the official compaction service is missing, incomplete, or cannot be probed, WHEN the host plugin applies, THEN only `services.compaction` SHALL be disabled for that cause; all other independently available `pluginApi.services.*` facades SHALL remain available according to their own contracts, and `apply` SHALL not throw through.
6. GIVEN construction of the compaction facade fails for an unexpected reason, WHEN the host plugin applies, THEN the failure SHALL be contained by the existing fail-safe path, logged through the existing diagnostic mechanism where available, and SHALL NOT disable unrelated services or throw through `apply`.

**Type:** Facade foundation (P1 inactive core, P2 services disabled, P4 per-member disabled facade).

---

### 5. No event, policy, or backend behavior changes

**User Story:** As a harness maintainer, I want this facade to remain a narrow
capability seam, so that exposing it cannot alter compaction behavior or create
an unsupported event contract.

**Acceptance Criteria:**

1. WHEN this feature mounts, THEN it SHALL NOT register, subscribe to, emit, re-emit, translate, or add catalog entries for any `compaction/*` name through `pluginApi.events` or the Cordis event bus.
2. WHEN a third-party plugin invokes a stable compaction operation through the facade, THEN the facade SHALL NOT alter compaction trigger policy, retention policy, summary algorithm, lock/transaction behavior, session event sequencing, durability behavior, range validation, or abort behavior beyond the official service's own behavior.
3. WHEN a third-party plugin directly injects `ctx.compaction`, imports an official compaction package, or otherwise interacts with a concrete backend outside this facade, THEN the facade SHALL NOT intercept, patch, block, or alter that interaction; that path remains the unsupported escape hatch defined by the foundation contract.
4. WHEN this feature is implemented, THEN it SHALL NOT create, register, configure, replace, or modify a compaction backend.

**Type:** A boundary; no event stabilization or semantic translation.

---

### 6. Testability and regression coverage

**User Story:** As a maintainer, I want focused automated coverage for the
new facade and the changed namespace cardinality, so that the abstract-contract
boundary and fail-safe degradation remain regression-safe without a real
harness boot.

**Acceptance Criteria:**

1. WHEN `node --test` runs with mocked Cordis context and official services, THEN tests SHALL assert that the services namespace exposes exactly the 19 keys in section 1, including `compaction`, and remains read-only.
2. WHEN `node --test` runs with a complete mock `ctx.compaction`, THEN tests SHALL assert that the compaction facade is frozen, `isActive === true`, exposes exactly the three stable operations, preserves the official `this` binding, forwards all arguments unchanged, preserves returned-value identity, propagates thrown and rejected official errors unchanged, and preserves the omitted trailing optional argument lists of `compactNow(agent, signal)` and `compactRegion(start, end, agent)`.
3. WHEN `node --test` runs with a mock compaction service containing Basic-specific or arbitrary extra members, THEN tests SHALL assert that none of those members, including `summarize` and `config`, appear on the facade.
4. GIVEN the `services` feature is active, WHEN `node --test` runs with `ctx.get('compaction')` absent or throwing while one or more other services are available, THEN tests SHALL assert that only the compaction facade is disabled, its declared operations produce the correct typed error without official calls, other available service facades remain active, and apply does not throw.
5. GIVEN the `services` feature is active, WHEN `node --test` runs with a mock compaction service missing or making non-callable one declared stable operation, THEN tests SHALL assert that the compaction facade is disabled through the per-member disabled-facade path, exposes no partially active operation surface, leaves other available service facades active, and does not throw through apply.
6. WHEN `node --test` runs with an inactive `pluginApi` core or a disabled `services` feature, THEN tests SHALL assert that every declared compaction operation reports the foundation-defined typed inactive or feature-disabled error before touching the mock official service.
7. GIVEN all existing capability services are unavailable and a complete mock `ctx.compaction` is available, WHEN `node --test` runs, THEN tests SHALL assert that the `services` feature remains active, `services.compaction.isActive === true`, and every existing unavailable service facade preserves its delivered disabled-facade behavior.
8. GIVEN mocked Cordis context and mocked official services, WHEN `node --test` runs, THEN no test SHALL require booting a real harness, a concrete Basic backend, or a real compaction transaction.

**Type:** Quality gate.
