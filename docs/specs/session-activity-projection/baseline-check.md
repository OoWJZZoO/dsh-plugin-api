# Baseline Check — session-activity-projection（W1.1 核验记录）

> 制品归属：`session-activity-projection` 线（W1.1 基线核验）；Stage 4 实现输入。

## 核验结论

以 `docs/specs/plugin-api-m7-public-contract-refactor/public-contract.registry.json` 为唯一事实源逐项核对（2026-09-06，只读）：

| 字段 | registry 声明 | 本线核验 |
|---|---|---|
| `contractBaseline.packageVersion` | `0.1.0-rc.6-0.1.0` | 一致；本线不 bump 任何版本字段 |
| `contractBaseline.runtime` | `0.1.0-rc.6` | 一致（主包 `package.json` version 前缀） |
| `contractBaseline.api` / `dshApi` | `0.1` | 一致（主包 `dsh.api: 0.1`） |
| `contractBaseline.frozen` | `true` | 一致；本线无新包、无新行、不新增 wire/durable revision |

本线交付全部在冻结基线内完成：不新建 replacement 包、不修改 `packages/*`、不触碰任何冻结文件。

## 官方证据源 probe（W1.2 记录，只读）

- `dsh-agent-loop`（`agent-loop` 行）：durable `turn/start|end`（data `{turn, reason?}`，reason.kind ∈ completed/blocked/max-tokens/aborted/error）、`step/start|end`（data `{turn, step}`）、`user/message|assistant/message|assistant/chunk|request/header|tool/call|tool/result`；事件 `agent/status`（status ∈ idle|running）、`agent/error`、`agent/inbox/inserted|claimed|discarded`。
- `dsh-session`：`session/event` firehose（callback args `(session, event)`，event = `{type, seq, time, data, ...surfaceMetadata}`，deep-frozen，seq 为 session log 单调序号）；`session/created|disposed|flush`。
- `dsh-user-approval`：durable `approval/asked`（data `{id, toolName, callId?, reason?}`）与 `approval/decided`（data `{id, outcome}`；outcome ∈ allowed-once|rejected|cancelled|unavailable）——官方保证 audit 对在 open turn 内闭合。
- `dsh-tools`：事件 `tools/change`、`tools/result` 等；durable 经 session firehose。
- 版本锁定证据：官方 `dsh-agent-loop@0.1.0-rc.6`（package.json 无 `dsh` client manifest 字段；见 shared-slice-registration.md 六问证据）。

probe 结论：durable joiner 以 session firehose 为 live 路径、以 `sessions.get(id).events` 为 replay 路径，两者共享同一 cursor（`seq`）去重；`agent/status|error` 与 `tools/change` 为仅有的非 durable 信号源。