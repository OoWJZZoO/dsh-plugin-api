# Stage 0 Goal: plugin-api-official-passthrough-m4

> feature_name: `plugin-api-official-passthrough-m4`
> 状态：Stage 0 goal，已获用户确认
> 里程碑：M4

## Goal

在 `dsh-plugin-api` 门面中完成 feature-list 所列全部剩余 A 类官方透传能力的统一规划与交付：补齐核心 host namespace API、host service seams、host event catalog，以及 client service/event/API 面，使第三方插件能够通过稳定的 `pluginApi` host/client 入口访问已由官方 runtime 提供的公开能力，同时保持官方参数、receiver、返回值、Promise、disposer、异常和生命周期语义不变。

M4 作为一个 feature 统一管理和验收，但按技术边界拆分为多个可独立实现、测试和对抗审查的 Stage 4 顶层批次；“一个 feature”不等于“一个实现批次”。

## Why

当前门面已经覆盖 M0–M3 及部分旧 M4 能力，但 feature-list 仍有一批官方已经存在、第三方插件仍需直接访问的 A 类接口未被稳定化。缺少这些透传面会迫使插件绕过 `ctx.pluginApi` 直接依赖官方 service、client provider 或事件实现，扩大官方 runtime 变化对社区插件的影响面。

这些接口大多是薄封装，但它们分布在不同的 host/client 生命周期和失败边界中。先把它们纳入一个统一 feature，再按边界分批实现，可以统一版本、命名、guard、降级和验收口径，同时避免把 client 局部启动、事件 payload 语义和 `system-prompt/assemble` 可写 waterfall 等非纯转发问题误当成无风险的机械复制。

## Users and Outcome

- **第三方插件作者**：通过 `ctx.pluginApi` 获取核心 namespace 和 host service，通过 client bundle 获取官方浏览器 service、event 和 connection API，不再需要为这些官方公开能力编写各自的直连适配层。
- **门面维护者**：拥有一份与 feature-list 对齐的 M4 能力边界、统一的 host/client 命名与降级规则，以及按顶层批次执行和审查的交付结构。
- **集成与审查维护者**：能够分别验证每个 service、client leaf 和 event slice 的可用性、参数/身份透传和 fail-safe 行为，并确认任一缺失或异常的可选官方能力不会破坏无关能力。

预期结果是：M4 范围内的 A 类官方能力全部可通过门面访问；单项官方能力缺失时按既有 feature/per-service/per-leaf 规则局部降级；host 与 client 的重复 apply、异常依赖、返回 identity、生命周期 cleanup 和完整 boot 行为均有可审计证据。

## Scope

本 feature 覆盖 `docs/specs/plugin-api-features/feature-list.md` 中 M4 的剩余 A 类条目：

1. 核心 host namespace 补面：L11/L12、A12/A13、S7/S8、T12/T13、P9/P10、ST9。
2. host event catalog：O17–O20，统一接入 `pluginApi.events`。
3. host service catalog：SV21–SV48，沿用 `pluginApi.services` 的声明式、只读、逐 service 降级模型。
4. client service/event/API：C10–C25，沿用现有 client bundle 的逐 leaf guard、composition 和 cleanup 模型。
5. M4 集成与回归验证：精确能力清单、参数和 receiver 透传、返回/Promise/disposer identity、异常与 rejection 保持、重复 apply、局部降级、host/client boot，以及官方 runtime 缺失或形状变化时的 fail-safe。

`T11`、`SV19`、`SV20` 和已交付的 `RB1` 只做状态核验、回归覆盖和必要的集成修正，不重新命名、不重复实现既有能力。

## Boundaries

- 本 feature 不实现 C 类 upstream proposal，包括官方 `exec.route`、官方 `llm/admission`、异步完整 `llm/request`、动态 settings namespace 和原生动态 remote discovery。
- 本 feature 不新增 R 类 replacement bundle，也不修改任何官方 DSH 包文件。
- 本 feature 不把 A 类透传扩展为新的语义转换、请求改写、数据投影或跨域业务逻辑。
- `P10` 虽归类为 A 类，但其官方 waterfall 的可写 assembly 语义必须单独定义和验证，不能仅以普通 method passthrough 处理。
- Stage 0 只确认目标；Requirements、Design、Tasks 和实现代码须分别通过后续确认门。

## Success Boundary

当本 feature 的 Stage 0–3 制品获批并提交后，后续实现工作应能从该契约边界派生多个独立 worktree 或批次，每个批次拥有明确的文件 owner、依赖顺序、测试范围和阻塞式对抗审查边界；最终 M4 集成能够证明 feature-list 所列 M4 范围内的 feature 均已纳入并完成验收、无遗漏，且不引入 C 类/R 类能力或破坏 M0–M3 已交付行为。
