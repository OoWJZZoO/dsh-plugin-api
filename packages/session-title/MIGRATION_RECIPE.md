# pro-ex migration recipe: title correction → `session-title/candidate`

> Records `plugin-api-session-title` tasks 7.1–7.3 (requirements §7, design C7).
> The consumer migration is **evidence, not the feature's purpose** (req 7.3).
> This recipe mirrors the equivalent expression and is executed in the
> `dsh-pro-ex-ability-anchor` repository by its own independently-approved
> migration task.

## Current status

- **7.1 in-repo fixture** — delivered: `packages/session-title/test/migration-anchor-scenario.test.mjs`
  proves the exclude decision makes both the fallback and a registered
  first-prompt provider start from the REAL first user message when a virtual
  anchor (`source.form === 'extrapro-anchor'`) is stamped `source.kind: 'user'`.
- **7.2 pro-ex migration execution** — **BLOCKED (blocked-report)**. The
  migration lives in `../dsh-pro-ex-ability-anchor` and must be driven by that
  repository's independently-approved task (design C7: "该迁移在
  `../dsh-pro-ex-ability-anchor` 仓库执行，属于其独立获批任务"). As of this
  Stage 4 delivery no such approved migration task exists in the pro-ex repo
  (its HEAD is `069cd3d`, still on `dsh-plugin-api-main@0.1.0-rc.6-0.4`, with the
  title-correction hack at `lib/index.js:574-691` preserved). Per AGENTS.md /
  tasks 7.2, this Stage does **not** modify the cross-repo consumer without the
  approved task.
- **7.3 acceptance evidence** — partially delivered (in-repo fixture + this
  recipe); the headless-smoke + dev-boot acceptance for the consumer is blocked
  on 7.2.

## The migration (design C7, equivalent expression)

The consumer plugin already depends on the main facade
(`@deepseek-ai/dsh-plugin-api-main`; for the candidate slice, use `0.1.0-rc.6-0.5`
+/ `dsh.api` `0.5`). Delete the whole title-correction hack at
`lib/index.js:574-691` (`titleFixed`, `realTitleText`, `titleCitesVirtual`,
`fixSessionTitle`, and the two `session/event` observers) and replace it with a
single `session-title/candidate` exclude listener:

```js
import { ANCHOR_USER_SOURCE_FORM } from './lib/runtime.js'

// Once (plugin apply): express the old title-correction as a candidate-policy
// exclusion. The virtual anchor is excluded at the scheduling filter, so it
// never becomes a fallback source nor the first-prompt provider's messages[0].
ctx.pluginApi?.events?.on?.('session-title/candidate', (payload, next) => {
  if (payload?.message?.source?.form === ANCHOR_USER_SOURCE_FORM) {
    return { kind: 'exclude', reason: 'trajectory anchor virtual request' }
  }
  return next()
})
```

Behavior after migration (verified by the in-repo fixture):
- virtual anchor → excluded in `onUserMessage` → no pending/fallback scheduled;
- the real first user message becomes the fallback `first` AND the built-in
  `session-title-llm` first-prompt provider's `messages[0]`;
- no private `sessionTitle.registration` reads, no hand-written `session/title`
  appends;
- `pluginApi.services.sessionTitle` (SV13) still delegates
  get/rename/refresh/register to the replacement service unchanged (req 3.7).

## Consumer acceptance (when 7.2 unblocks)

1. `../dsh-pro-ex-ability-anchor` removes `lib/index.js:574-691` and adds the
   listener above.
2. headless smoke passes with the replacement row active (`ctx.sessionTitle`
   carries `Symbol.for('dsh-plugin-api.session-title.contract')`);
3. dev profile boot passes; an anchored session's title is derived from the real
   user message, never the virtual one (req 7.1/7.3).
