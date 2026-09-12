# Stage 0 Goal: llm-adapter-registration

> feature_name: `llm-adapter-registration`
> milestone: M10
> status: Stage 0–2 已交付（2026-09-12）；Requirements / Design 同批交付于本目录（requirements.md / design.md）
> 输入溯源：M10 工作纲领 §3.2（OBS-02）；观察报告 §5 OBS-02；M8 migration ledger 第 41–43 行（`registerAdapter`→`llm.adapters.register` rename、`registerConfigurableProviders`/`registerModelDiscovery` 两条线）；canonical registry `llm.adapters.register` 现行登记（currentShape 为 decoration registration）与 `llm.providers.register` / `llm.models.register` 现状；`packages/llm` replacement owner 现状。

## Goal

把「登记新的可调用 adapter/provider route」与「装饰既有 adapter」在门面内彻底分开：插件能够登记真实可调用的模型路由与调用实现，模型查询与选择器能看到应可见的 provider/model/capability；adapter decoration 继续独立工作但不拥有 adapter 路由。消除现行 `llm.adapters.register` 一面承载两种不等价行为的语义碰撞。

主公开面是 resourceRegistry（登记/查询新 adapter 路由）；模型目录是独立只读 projection；decoration 保留独立 registry 身份。最终公共 path（含对现行碰撞入口的重命名/拆分）在 Design 中确定，本阶段不批准具体 path。

## Why

OBS-02 已证实：canonical registry 把旧 `llm.registerAdapter` 以 rename 迁到 `llm.adapters.register`、旧 `llm.adapters.decorate` 以 split 迁到同一入口，而现行实现实际调用 decoration facet——`packages/llm` 的 decoration registry 明确不创建 synthetic adapter，decoration metadata 只允许 labels。真实消费者 `dsh-vision-toolkit` 的图片变体（创建独立 provider id 并调用 registerAdapter，使图片变体成为模型选择器中的独立路由）与 `dsh-tianshu-tui/vision-ask` 的 vision adapter 无法等价迁移。`llm.providers.register`（configurable provider 目录登记）与 `llm.models.register`（model discovery）均不绑定真实 stream backend。缺失的是新可调用 adapter/provider route 的登记、真实 model capability、冲突、替换/撤销与在途调用生命周期，而不是某个基类导出。

## Scope direction

- 注册新的 provider route 与实际调用实现：从登记到 catalog/model selection/真实调用全链路工作；模型查询与选择器投影能看到新 provider/model/capability；普通模型与图片变体同时存在，不把 label overlay 冒充原生 inputModality、不伪造官方模型真值。
- 冲突与幂等合同清楚：内容等价重复登记、不同内容冲突、跨 owner 冲突、原子替换与撤销各有确定结果。
- 装饰器可以绑定新 adapter，但不拥有 adapter 路由：二者的卸载与 generation 分开，替换/卸载时在途流、prepared call、取消与旧 handle 按官方及门面合同处理，不拆其他 owner 的 wrapper。
- configurable provider、model discovery、adapter registration、decoration 四种动作在 API 树上可辨认，不因「都叫 register」混在一起。
- 通道方向：官方 registerAdapter 已存在，优先按 A/B 稳定适配其真实登记动作；复用既有 llm replacement owner（`@deepseek-ai/dsh-plugin-api-llm`），不新建第二个 llm owner；是否扩展 R slice 由真实契约决定，不为 A 类能力先造 replacement。
- 现行 `llm.adapters.register` 的语义碰撞允许重命名/拆分现有面并迁移全部调用点与测试，不加长期 alias 掩盖错误抽象（本地开发阶段 API 重构窗口）；公共函数可以接普通对象，不要求实现 LlmAdapter SDK。
- client 模型选择复用此线的目录语义，不另建第二套模型目录。

## Boundaries

- 不吞并 adapter decoration 领域：decoration 保留独立 policy/registry 身份，本线只划清二者边界并修正 rename 记录。
- 不修改官方模型真值；不通过装饰现有模型假称保留了「可选的独立图片变体」。
- 不新建第二个 llm 组件 owner；不重复 `llm.routing` / `requestTransforms` / `admissionPolicies` 的既有职责。
- 模型目录为独立只读 projection，不承载注册写权。
- 版本冻结：不步进 runtime identity、`dsh.api` 或任何包版本字段。

## Expected result

无官方 inject/import 的 synthetic provider 从登记 → catalog/model selection → 真实 mock stream 全链路工作；独立图片变体可选且原始模型仍可用；两个 owner 冲突有确定结果；decorate + route replace + dispose 交叉执行正确；列表变化与实际调用一致。`dsh-vision-toolkit` 的图片变体适配器与 TUI vision-ask adapter 可经公共路径等价迁移。

## Stage boundary

本文件只确认 Goal 方向，不批准具体公共 path、参数形状、capability 投影字段或 R 扩展内部契约。Requirements 应把注册/查询/冲突/装饰分离/在途生命周期写成 EARS，并按 `capability-strategy.md` §10 六问记录 client 半面判定；Design 再确定 registry 拆分与 rename 记录修正、replacement 扩展点位（若需）与全部调用点迁移。
