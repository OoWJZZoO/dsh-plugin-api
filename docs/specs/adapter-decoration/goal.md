# Stage 0 - Goal

## Feature Name

`adapter-decoration`

## Status

SPEC1 Stage 0：Goal 已获用户确认（2026-08-26）；Stage 1 Requirements 已获确认，现进入 Stage 2 Design。用户已明确批准本 feature 采用 R 类通道。

## Goal

为 LLM provider/adapter 提供官方边界内可组合、可查询、可撤销的 decoration lifecycle，使插件能够在不复制 model metadata、不伪造 synthetic adapter、不中断真实 stream ownership 的前提下，为 adapter 增加观测、策略或兼容包装。

当前 `registerAdapter` 只解决 provider 注册；ModLens 等插件需要复制官方 model info、委托真实 provider，并监听 `llm/adapters-updated` 自行 reconcile。早期 `dsh-read-image` 也需要 adapter discovery、重入和自嵌套防护。现有 API 没有统一的 decorator identity、顺序、generation、disposer 和 provider unload 语义。

本 feature 通过 R 类 replacement bundle，替换拥有真实 provider identity、model info 和 stream ownership 的官方 `dsh-llm` loader 行，在保真复刻官方 `llm` service/event 面后增加 decoration contract。

## Primary Users

- 需要为模型调用增加 metrics、tracing、审计或兼容转换的插件作者；
- 需要叠加多个 adapter wrapper 并保证顺序与卸载的 provider 集成作者；
- 负责 provider 热更新、adapter reconcile 和 partial boot 的宿主维护者。

## Scope Summary

- `pluginApi.llm.adapters.decorate({ id, match, priority, capabilities, wrap })`；
- wrapper 接收 stable adapter identity、source route、`AbortSignal` 和 operation context；
- decoration chain 查询、generation reconcile 和 identity-bound disposer；
- 将 metadata overlay 与 execution transform 分离，避免复制或伪造官方 model info；
- 防止 wrapper 重新匹配自己形成递归；
- provider unload/replacement 时自动撤销失效 decoration；
- 保留官方 adapter/provider 注册、model discovery、stream、错误和事件语义；
- decorator 失败只影响该 decoration 或对应调用，不能穿透 apply 或杀死宿主 boot。

## Expected Result

插件可以向真实 adapter 注册一层有明确 identity 的 wrapper，例如记录调用耗时、增加审计字段或做兼容性输入转换。多个 wrapper 按稳定优先级和 tie-break 规则组成链；插件 dispose 只移除自己的 decoration；provider 被替换或卸载后，旧 decoration 不会残留到新 adapter。wrapper 不能通过重新匹配自身递归套娃，也不能把一次 stream retry 伪装成新的 provider identity。

示例流程：`latency-metrics` decoration 匹配 `openai` provider，`audit` decoration 匹配同一 adapter；调用链为“真实 adapter → latency-metrics → audit → provider stream”。卸载 `openai` provider 时两层 decoration 一并进入 stale/revoked 状态；重新加载后需以新 adapter identity 重新 reconcile。

## R-Class Boundary

- 替换 `dsh-llm` 官方 loader 行，具体 row id、runtime identity 和唯一 owner 在 Requirements/Design 阶段经源码核实后冻结；
- replacement 必须完整复刻原 `llm` service、provider/adapter 注册面、模型发现、stream 入口、事件和 teardown 语义，再增加 decoration contract；
- 不覆盖 `@deepseek-ai/dsh-llm` 包 import 面，不修改官方安装目录；
- 必须具备 boot 自检、runtime/package 版本锁定、组件唯一 owner 冲突检测和 fail-safe 停用；
- 不把 decorator chain 变成新的 route/retry/approval/billing owner；横切 priority、deepFreeze、fault containment 仍由既有框架/门面负责；
- 若源码核实无法证明 adapter/provider loader 是唯一稳定 owner，Requirements 阶段应暂停并转为 C 类上游提案。

## Non-Goals

- 不替代 `llm.registerAdapter`、provider discovery 或现有 `llm/stream` API；
- 不在 stream 中途切换 provider/model，不自动执行 retry、fallback、approval 或 route policy；
- 不复制完整 adapter metadata 或建立第二份 model registry；
- 不承诺所有 wrapper 都可安全重放，非幂等 transform 必须显式声明并遵守取消边界；
- 不在本阶段冻结具体 decorator 排序算法、wrapper 参数 wire shape 或官方 row identity，待 Requirements/Design 源码核实后确定。
