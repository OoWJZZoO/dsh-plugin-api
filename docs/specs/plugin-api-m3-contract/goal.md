# Stage 0 Goal: plugin-api-m3-contract

> feature_name: `plugin-api-m3-contract`
> 状态：Stage 0 goal（无人值守授权下由协调者代行确认）
> 里程碑：M3

## Goal

在派生任何 M3 实现 worktree 之前，冻结 settings 可视化配置桥与 client bundle 的共同契约，使 ST4、ST5、ST6、C1、C2、C3、C4、C5、C6、C8、C9 能以明确的 host/client 边界、公共 wire/codec/lifecycle/fail-safe 语义、唯一共享文件 owner 和依赖有序的 worktree 波次并行交付，并在一个 integration worktree 中可审计地合并和验收。

## Why

M3 同时跨越官方 host service、Typert remote、浏览器端 bundle、remote contribution、settings scope、slot 和 forwarded event。若未提前冻结命名、装载边界和共享文件写入规则，各 feature 会重复实现 client composition、codec 校验和失败呈现，导致合并期产生无法机械解决的语义冲突，并可能把 C 类官方缺口误包装成稳定 API。

## Users and Outcome

- **消费者插件作者**：以统一的 host `pluginApi.settings`/`pluginApi.services` 能力和 client `client.*` helper，注册远程设置、使用连接、slot 和事件桥。
- **M3 feature 实现者**：按固定 feature key、文件边界、依赖和验证责任在独立 worktree 实现，不改写其他 feature 的 owner。
- **integration 维护者**：按预定波次执行只读预检、顺序合并、统一波和全量验收，能够定位每个 feature 的交付证据。

## Scope

本契约覆盖 feature-list 中全部 M3 条目：ST4–ST6、C1–C6、C8–C9。它冻结每项的 feature/namespace/guard/mounter 命名映射、A/B 分类、host/client 责任、wire 与 codec 边界、生命周期/disposer、P1–P4 fail-safe 路径、共享文件唯一 owner、worktree 时间线、合并顺序和迁移验收。它不实现 `lib/`、`test/` 或 `package.json` 代码，不实现 M4 的 C7、ST7 或其他 C 类 proposal，也不修改官方 DSH 包。

## Success Boundary

当契约包获 Stage 0–3 边界提交后，任何 M3 实现 worktree 都能从已提交契约边界派生；每个 worktree 的范围、共享文件编辑模式和顶层审查批次明确；integration worktree 能以一次合并波加一次统一波接纳 11 项实现，并以全量 `node --test`、host/client boot、codec/wire negative cases、slot/remote/event lifecycle 和两个目标消费者迁移验收作为完成条件。

## Planned Worktree Timeline

```text
W0 main: m3-contract（本 feature；不单开 worktree）
  └─ 冻结契约包并提交 Stage 0–3 边界

W1 m3-package-contract: C1 → C8
  └─ client manifest、Typert 工件的 package/exports/loader 边界

W2 parallel:
  ├─ m3-settings-host: ST4
  ├─ m3-client-foundation: C9 → ST6
  └─ m3-client-event-bridge: C6

W3 parallel:
  ├─ m3-remote-core: C2
  ├─ m3-slots: C4 → C5
  └─ m3-settings-scope: C3

W4 sequential bridge: ST5（依赖 ST4 + C2 + ST6 + C9）

W5 m3-integration: 按依赖顺序合并 W1–W4，完成统一波、迁移验收和全量验证
```

W1 完成后，W2 的 C9→ST6 owner 从该已提交边界派生；C9 是 ST6 的 client runtime 基础，但不与 C1/C8 共享实现 owner。
