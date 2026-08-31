# Stage 0 — Goal

## Feature Name

`plugin-api-m8-api-idiom-refactor`

## Goal

在正式发布前，将 `dsh-plugin-api` 的 host/client 受支持公共 API 面按八个统一的 API idiom（projection、policy、mutation、operation、contribution、resourceRegistry、coordination、selfDescription）重构为一致、可机械验证的调用契约。

本 feature 以整个公共面为治理边界：为每个公共叶子成员、公开 handle 成员和 `services.*` 例外确定唯一目标归属，完成必要的重命名、合并、拆分、迁移、删除与形状对齐，并证明能力没有未说明的损失。实现按多个有依赖的 Wave 执行，但对外作为一次统一的公共契约迁移交付。

## Scope Boundary

- 覆盖 M7 冻结后的 host/client 公共 API、公开 handle 成员、事件面、`services.*` 直通面、类型和运行时 surface。
- 覆盖成员级 contract registry、host/client parity、idiom 命名与形状、结果和 handle 字段、失败与冲突语义、owner、scope、authority、生命周期、generation/seq/epoch、组合、并发和取消边界。
- 覆盖事件的 observe、producer authority、事件语义分类、派发 outcome、监听者故障 containment，以及自定义事件的受限生产入口。
- 覆盖旧路径、重复入口、内部机制泄漏和咨询式入口的处置；删除项必须有能力替代或明确记录为能力缺口。
- 覆盖 projection/selfDescription、policy/resourceRegistry/contribution、mutation/operation/coordination 等跨 namespace 的统一契约迁移，不按 namespace 或 idiom 形成相互独立的公共 feature。
- 覆盖 host/client 的连接、remote、slot、codec、lifecycle 和设置桥等公共面，使其遵循同一套可观察词汇和生命周期规则。
- 覆盖 registry、类型、快照、能力矩阵、反直觉问题清单和测试证据之间的一致性与能力守恒验证。
- 覆盖两个本地消费者 `dsh-read-image` 与 `dsh-pro-ex-ability-anchor` 的目标路径迁移、full/选择性安装装配对账，以及 headless smoke 和 dev boot 验收。
- 遵守 `docs/standards/` 现行规范、`docs/standards/refactor/` 目标规范、AGENTS.md 的 spec coding 确认门、阶段提交、干净工作区、fail-safe 和不修改官方 DSH 包文件约束。

## Out Of Scope

- 不新增与目标 idiom 无关的业务能力，不把本轮重构扩展成通用 SDK、权限系统、全局 owner graph、全局依赖排序图或通用 schema migration 平台。
- 不按八个 idiom、单个 namespace 或单个消费者拆成彼此独立的公共 feature；这些只作为同一 feature 的实施批次和验收维度。
- 不保留旧公共路径、兼容 alias、deprecated forwarding property、silent no-op 或隐藏兼容分支来掩盖迁移未完成。
- 不把 C 类能力缺口伪装成已实现能力；仅登记所需的上游能力性质和 proposal。新增 R 类 replacement 不在本 feature 中未经批准引入，已有 replacement 只按公共契约对账需要处理。
- 不修改 `/usr/lib/node_modules/@deepseek-ai/dsh/**` 或任何官方包文件。
- 不以减少入口数量作为能力损失或完成度证明；所有删除、迁移和 gap 都必须按能力簇说明替代或理由。

## Success Criteria

- `member-inventory.md` 中每个 current leaf、每个目标 leaf 和每个公开 handle 成员都有唯一、完整的 registry 条目；新增公共叶子不得绕过登记。
- registry 能机械验证 idiom 归属、命名词表、host/client parity、handle 覆盖、失败与冲突外层契约、generation/seq/epoch 语义、事件语义和 availability 形状。
- 所有保留、重命名、合并和迁移能力都有目标 path；所有删除项都有 replacement 或 gap reason；不存在未说明的孤儿公共路径或能力损失。
- 同一 idiom 跨 namespace 的入口、结果/handle、失败方式、冲突规则、生命周期和可用性表达保持同构，领域差异只出现在明确登记的领域数据、concurrency 或 reducer 字段中。
- host/client 公共面遵循统一词汇；`services.*` 仅保留经过审计的官方直通成员；事件观察权与生产权分离，派发结果和 listener containment 可验证。
- 组合测试覆盖逆序加载、owner/scope 隔离、冲突、重复注册、stale disposer、generation、callback failure、取消、CAS/fencing、authority bypass、client remote/slot/settings/lifecycle 等关键边界。
- 两个本地消费者、full 与选择性安装模式、headless smoke 和 dev boot 均按目标契约通过验收。
- 全部实现、测试、registry、规格制品和登记通过 Stage 4 全局终审，并在完成提交后保持工作区干净。
