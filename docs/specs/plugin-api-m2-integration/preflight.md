# Pre-merge Audit: plugin-api-m2-integration

> Audit date: 2026-08-18
> Integration base: `main@920d55b8d9a5893af0caddc70dfea07fa3683507`
> Scope: read-only admission audit for Task 1.1; no input branch or implementation file was changed

## 1. Admission summary

| Input branch | Stage 4 HEAD | Worktree | Tasks | Delivery registration | Baseline | Decision |
|---|---|---|---|---|---|---|
| `feature/plugin-api-compaction-m2` | `58361a9076d9694a29fbea783a645b27d36d8d6f` | clean | complete | AGENTS + feature list | 400/400 pass | admitted |
| `feature/plugin-api-llm-request-m2` | `6ed0ed8d50fa4335cc4d822fe6657d708b2261d8` | clean | complete | AGENTS + feature list + supersession | 468/468 pass | admitted |
| `feature/plugin-api-agent-create-m2` | `5b4c0b86698121ab3c2442b7203c8185fdf3c7cb` | clean | complete | AGENTS + feature list | 462/462 pass | admitted with D1 recorded |
| `feature/plugin-api-session-durable-m2` | `4506e7125f030fdf79e65197061d5744ae1e4d68` | clean | complete | AGENTS + feature list | 458/458 pass | admitted with D3 recorded |
| `feature/plugin-api-exec-route-m2` | `4fc4370ea4873aa47c0bc96d568cbd2355066227` | clean | complete | AGENTS + feature list | focused 48/48 pass; full 417/425 pass | admitted with D1/D2 recorded; Task 2.5 must restore the required shared set to green |

All five inputs have committed Stage 4 boundaries, no unchecked task, clean attached worktrees and delivered metadata. Every changed path is inside this repository; no branch contains a tracked path under `/usr/lib/node_modules/@deepseek-ai/dsh` or another official package tree. The main baseline is 388/388 passing.

The external official installation is not a Git worktree, so the audit freezes a reproducible content baseline instead of claiming a nonexistent `git status`: sorted SHA-256 hashes of every regular file under `/usr/lib/node_modules/@deepseek-ai/dsh` produce aggregate `cf16c829391784a030402d7cb18d6c58955433e48741576ea83e093037b8b213`. A separate symlink scan finds only ten relative `node_modules/.bin` links to packages inside that installation and no link into this workspace. Task 12.2 must recompute both checks; a digest change or workspace-targeting link is an official-package modification failure.

The exec-route full-suite deviation is not silently waived: its feature-focused owner/guard/facade/host tests pass, while eight frozen shared tests retain the pre-feature nine-mounter expectation. This is an implementation/test-integration deviation that can preserve the approved A9/T10 Goal and Requirements, so Requirement 1.5 admits it with a mandatory Task 2.5 resolution. It is not a Goal, classification, public acceptance or migration-boundary change under Requirement 1.6.

## 2. Input contract inventory

| Input | Approved contribution | Feature key / mount | Guard and failure boundary | Shared ownership introduced |
|---|---|---|---|---|
| compaction | `pluginApi.services.compaction.{compactIfNeeded,compactNow,compactRegion}` | existing `services`; no new key or mounter | definition-level P4; parent services remains independent | `lib/services.js` 19th static definition and services tests |
| L2/L4 | `pluginApi.llm.request.transform(...)`; constrained `pluginApi.llm.admission.register(...)` | `llm/request` before `llm/admission` | mandatory LLM/public-boundary probes; P2 staged rollback | L4 sole raw stream owner, L2 scoped gateway, prepared facade slots, legacy admission removal |
| A11 | `pluginApi.agent.create/resume/register`, provider lifecycle and availability | composed during `agent`; no A11 feature key | per-member disabled presentation; M1 agent base survives | agent view composer and context-bound official forwarding; branch also carries a duplicate exec-route implementation (D1) |
| session durable | five-kind durable metadata, `onDurable/onceDurable`, constrained `appendMessage` | `sessionDurable` after events/session | runtime/audit/contract probes; P2 epoch rollback | session overlay, durable audit peers and per-epoch observer implementation superseded by D3 |
| A9/T10 | shared `agent.routeOf(exec)` / `tools.routeOf(exec)` | `execRoute` after session | route capture failure contained; missing route is `undefined`; branch guard has superseded `agents` probe (D2) | single WeakMap route owner, prepended tools hook and coordinated agent/tools delegates |

API naming and shape are isomorphic with the approved integration design after the recorded supersessions. M2 inputs add no event-catalog source file or catalog slice. Durable names remain session-log data, route remains query-only, L4 remains a facade operation, and compaction remains a static service member.

All input packages still declare facade `0.1.0-rc.6-0.2` / API `0.2`; only session-durable adds its five audit-only producer peers (`dsh-user-approval`, `dsh-schedule`, `dsh-subagent`, `dsh-subagent-in-process-driver`, `dsh-agent-loop`). Final `0.3` metadata is deliberately coordinator-owned by Task 8.2, not a merge-wave correction.

## 3. Recorded deviations and authoritative resolutions

| ID | Observation | Classification | Required resolution |
|---|---|---|---|
| D1 | `agent-create` contains its own `lib/exec-route.js`, mounter, guard, facade delegate and tests, while the independent exec-route branch claims the same A9/T10 owner. | implementation-level duplicate semantic owner; public contracts agree | Preserve A11 composition from agent-create; Task 2.5 takes the independent exec-route feature-local owner as merge input; Task 5.1 folds both facade entries onto one coordinator-owned authority and removes duplicate ownership. |
| D2 | exec-route worktree guard probes `agents`, its mounter depends on `events`/`agent`, and eight shared tests still expect nine mounters. | explicitly superseded implementation/test assertions | Task 2.5 must restore its required focused/shared set to green without changing route semantics; Tasks 5.1/7.1 replace the `agents` probe and broad mounter dependency with tools + session substrates and update affected assertions. |
| D3 | session-durable publishes/owns observers per epoch and synchronously disposes through the events bus on breach. | explicitly superseded lifecycle detail | Tasks 6.1/6.2 implement the approved prepared publication and service-lifetime stable observation hub with private epoch CAS and composite teardown; upstream spec/test wording is synchronized in Task 12.1. |
| D4 | M1 `admission-bridge.js`/projection ownership exists on non-LLM input baselines, while the L2/L4 branch deletes it. | expected sole-owner conflict | L2 scoped gateway is authoritative; Task 4.1 retains exactly one `resolveModelInfo` wrapper and replaces only superseded assertions. |
| D5 | Input branches retain API `0.2`, and only session-durable contains the additional audited peers. | coordinator-owned package convergence | Merge wave preserves branch metadata facts; Task 8.2 writes the unique `0.3` contract and union of approved peers once. |
| D6 | LLM and exec-route delivery metadata mention `dsh-read-image` migration, but no target-repository change is part of these five branch diffs. Session-durable explicitly defers its consumer migration. | migration evidence not supplied by input branches | Requirements 12/13 remain unsatisfied until Tasks 10.1/11.1 modify and test the real consumer repositories; metadata claims are not accepted as migration evidence. |

No recorded deviation changes an approved Goal, A/B/C classification, public acceptance criterion or migration boundary. If merge execution disproves that assessment, the active merge task must stop for Requirement 1.6 adjudication.

## 4. Pairwise conflict matrix

The matrix was generated with `git merge-tree --write-tree --name-only` for every pair. Listed paths are direct content/add-add conflicts; clean auto-merges such as feature-list additions remain coordinator review inputs even when not listed.

| Pair | Direct conflicts | Semantic/shared-test edge |
|---|---|---|
| compaction × L2/L4 | `AGENTS.md`, `test/plugin-api-service.test.mjs` | services facade baseline vs staged LLM facade expectations |
| compaction × A11 | `AGENTS.md` | feature-list/guards auto-merge; services and agent composition remain separate |
| compaction × session durable | `AGENTS.md` | feature-list/guards auto-merge; package peer union deferred |
| compaction × exec-route | `AGENTS.md` | feature-list/guards auto-merge |
| L2/L4 × A11 | `AGENTS.md`, `lib/guards.js`, `lib/index.js`, `lib/plugin-api-service.js`, six shared `test/index*.mjs` files | competing coordinator registries/transactions and facade composers |
| L2/L4 × session durable | `AGENTS.md`, `lib/guards.js`, `lib/index.js`, six shared `test/index*.mjs` files | staged LLM vs immediate durable publication; service file auto-merges but is not authoritative |
| L2/L4 × exec-route | `AGENTS.md`, `lib/guards.js`, `lib/index.js`, `lib/plugin-api-service.js`, `test/index-session.test.mjs`, `test/index-tools.test.mjs` | prepared owners and final mounter order |
| A11 × session durable | `AGENTS.md`, `lib/guards.js`, `lib/index.js`, `lib/plugin-api-service.js`, six shared `test/index*.mjs` files | agent composer vs session overlay and copied coordinator state |
| A11 × exec-route | `AGENTS.md`, `lib/index.js`, `lib/plugin-api-service.js`, `test/plugin-api-service-exec-route.test.mjs` (add/add) | D1 duplicate route authority; independent exec-route owner is feature-local authority |
| session durable × exec-route | `AGENTS.md`, `lib/guards.js`, `lib/index.js`, `lib/plugin-api-service.js`, `test/index-session.test.mjs`, `test/index-tools.test.mjs` | session overlay/epoch vs route delegate and final order |

Shared production ownership is therefore frozen as follows: the coordinator owns final `lib/index.js`, `lib/plugin-api-service.js`, `lib/guards.js`, `lib/services.js`, `package.json` and frozen shared tests; feature branches own their narrow feature-local modules and focused tests. Consumer repositories have no pairwise file conflict in these inputs because none is modified by an admitted branch; their semantic migration edges are deferred to Tasks 10.1 and 11.1.

## 5. Test evidence and next-step gate

| Worktree | Command | Result |
|---|---|---|
| main | `node --test` | 388 pass, 0 fail |
| compaction | `node --test` | 400 pass, 0 fail |
| L2/L4 | `node --test` | 468 pass, 0 fail |
| A11 | `node --test` | 462 pass, 0 fail |
| session durable | `node --test` | 458 pass, 0 fail |
| exec-route | seven-file focused command from Task 1.1 run | 48 pass, 0 fail |
| exec-route | `node --test` | 417 pass, 8 fail; all failures are frozen shared mounter-count/order expectations recorded as D2 |

The principal merge order is frozen as compaction → L2/L4 → A11 → session durable → exec-route. At every Task 2.x step, the current branch focused tests plus directly touched frozen shared host/apply, facade, guard, catalog, services/package/version tests must pass. An incompatible contract conflict pauses the step under Requirements 1.5/1.6; no red test may cross a merge boundary.
