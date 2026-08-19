# Stage 0 Goal: plugin-api-migration-assistant

> feature_name: `plugin-api-migration-assistant`
> 状态：Stage 0 goal
> 里程碑：post-M3 / M4 tooling

## Goal

为已经存在的 DeepSeek Harness 第三方插件提供一套可审查、可回滚、以语义等价为优先的迁移工作流，把插件直接使用的、已被 `dsh-plugin-api` 覆盖的 DSH 原生扩展点迁移到受支持的 `pluginApi` 门面。

该能力应以独立的迁移工具形态交付，与运行时 facade 解耦：先扫描并解释插件依赖，再只自动改写可以证明一对一等价的调用；需要语义判断的 B 类能力生成审查建议；无法由 facade 支持的 C 类或动态调用明确报告，不得静默改写。

## Why

`dsh-plugin-api` 已经为多类 host/client 能力提供统一入口，但旧插件仍可能通过内部包 import、Cordis service lookup、事件直连或 monkey-patch 访问 DSH。仅提供 facade 不会自动迁移这些插件，导致生态采用成本高、兼容性收益难以兑现。

迁移助手把“发现直连依赖 → 判断可迁移性 → 生成安全 diff → 运行验证 → 持续审计”固化为可重复流程，降低插件作者接入 facade 的成本，同时避免把不等价的语义转换伪装成自动兼容。

## Users and Outcome

- 第三方插件作者：可以扫描自己的插件，看到每个原生 DSH 调用对应的迁移状态和具体建议。
- facade 维护者：可以用版本化规则库逐步增加安全迁移覆盖，而不把迁移逻辑散落在运行时 facade 中。
- Harness 集成维护者：可以在 CI 中阻止新增的未迁移直连，并保留迁移前后的可验证证据。

## Scope boundary

本 feature 的目标范围包括：

- JavaScript/TypeScript 插件的静态 API 使用扫描；
- `SAFE`、`REVIEW`、`MANUAL`、`UNSUPPORTED` 迁移等级及版本化规则库；
- dry-run、可审查 diff、备份/回滚和机器可读报告；
- 首批 A 类一对一直通能力的 AST codemod；
- 开发环境只读审计记录器：由开发 harness 显式提交绕过 facade 的观察，工具负责规范化、持久化和报告，但不代理调用。

本 feature 明确不承诺：

- 在运行时拦截或重写任意已经加载的插件；
- 自动重写需要业务语义判断的 B 类 hook；
- 自动实现 C 类上游能力；
- 保证任意插件都可以无人工修改地迁移；
- 修改官方 DSH 包或其内部源码。

## Success boundary

当迁移助手能够对真实第三方插件完整列出 host/client 两面的 DSH 直连面，并对首批 A 类调用生成通过测试的最小 diff；对 B/C 类、动态访问和不确定语义给出明确的非静默报告；由开发 harness 提交的 audit observation 可被持久化读取；且迁移结果可通过 baseline/delta 在 CI 中重复检查时，本 Goal 达成。

Requirements、Design 和 Tasks 阶段将进一步冻结规则格式、CLI 边界、AST 变换契约、报告 schema、测试夹具和真实插件迁移验收对象。
