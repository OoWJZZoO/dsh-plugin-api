# Official package immutability audit baseline

> Part of `plugin-api-session-title` Stage 4 task 1.4 (requirements 2.3 / 8.3).
> The replacement replacement bundle `@deepseek-ai/dsh-plugin-api-session-title` forks
> the official `ctx.sessionTitle` row. It NEVER modifies any file under
> `/usr/lib/node_modules/@deepseek-ai/dsh/**`. This baseline pins the exact
> byte-identity of the forked artifacts so the Stage 4 delivery audit (task 8.3)
> can compare against it.

## Pinned official package: `@deepseek-ai/dsh-session-title@0.1.0-rc.6`

Resolved at `/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session-title`.

| file | sha256 |
|---|---|
| `lib/index.js` | `c1d1dd2debcd11b116fe55d854af9cf5ae99bff44e8364eaa6f1a4c254d5d881` |
| `lib/invariant.js` | `a332486d5032c4e10e6e5a20f8feee6daf3add8bf061e8789e1bacaa528503d2` |
| `package.json` | `9913015535a36cb01e41334c8358a802a1df2f142c0421223e6f6fe8f323844a` |

Complete package file tree (audited): `LICENSE`, `README.i18n.yaml`, `README.md`,
`README.zh.md`, `lib/index.js`, `lib/invariant.js`,
`lib/types/{client,index,invariant,normalize,types}.{js,d.ts}` + `package.json`.

## Official row composition (fork target)

`dsh-base/cordis.patch.yml` (sha256
`9870a518274194c0e1ebd870cee2737fbc2ffc04ae36887871ffe6fcf74beac1`) rows:

- `id: session-title` → `name: '@deepseek-ai/dsh-session-title'`,
  config `{ fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 }` — **forked**.
- `id: session-title-llm` → `name: '@deepseek-ai/dsh-session-title-first-prompt-llm'` — **not forked** (design D9: the first-prompt provider consumes the post-policy candidate set via `messages[0]`).

## Delivery audit (task 8.3) comparison

Recompute the sha256 of the three official files above and re-verify the
`dsh-base` patch rows; any difference means the official checkout changed and the
forked contract must be re-pinned before delivery. Also re-run
`git status --porcelain` on `/usr/lib/node_modules/@deepseek-ai/dsh` to assert no
official file was modified by this worktree.
