# Stage 0 Goal: plugin-api-m10-contract-convergence

> feature_name: `plugin-api-m10-contract-convergence`
> milestone: M10
> status: Stage 0 Goal 提交用户批量确认（2026-09-12）；Requirements / Design 未开始
> 输入溯源：M10 工作纲领 §3.10（OBS-01–14）、§7 统一验收矩阵；观察报告 §5 OBS-13/OBS-14、§6 纠正表、§7 闭合判据；M7 deletion report 批准记录与五项「后续 B 类接口义务」；M8 migration ledger（第 30 行决策参与处置与 AGENTS.md §4 第 3 条的治理表述张力）；M9 已交付登记、feature-list 历史行现状注；canonical registry。

## Goal

以**整棵公共 API** 为对象完成设计收敛、残余功能归属和跨线验收，确保前九条 M10 线不形成九块拼接的局部正确面；纠正历史减法和形状归并造成的能力损失，以及 registry/文档/实现之间的漂移。这是 M10 主体 feature 之一，不是发布前收尾。

本 feature 是合法的公共 API 重构 feature：拥有跨线合同与验收权，不拥有各领域的运行时状态；不新增「convergence API」、不新增万能 runtime root。允许在正式获批规格内重命名、拆分/合并 namespace、重塑参数/结果/handle、移动直通面、替换错误抽象、移除旧 alias（本地开发阶段 API 重构窗口，现行 delivered 不构成外部兼容承诺）。

## Why

用户裁决「过了 M10 后，门面在 API 形状上浑然一体无缺漏，这些问题全部得到解决」。OBS-13 证实形状守恒不等于行为守恒：registry rename 记录与实际行为不一致（OBS-02 的 adapter 碰撞）、决策事件 catalog 保留语义描述但公共调用者无法参与（OBS-01）、feature-list 历史行仍含已删除写路径、M9 部分规格状态与临时链接漂移、AGENTS.md 事件决策表述与 M8 侧向参与删除存在治理张力。OBS-14 登记宿主残余 API（优雅 appExit、launch environment fallback、home/scope 行为）必须有归属，不许因「属宿主」自动忽略。M7 五项删除义务由五个控制类 feature 分别兑现，但总树一致性、逐成员 idiom 归类、全路径 authority、能力自描述、真实消费者守恒与安装等价只能整树验收。

## Scope direction

按纲领 §3.10 的十项设计决定，Goal 层面确立方向：

1. **语义树**：形成共同目标树与逐成员 old → target → behavior 映射；注册/装饰、观测/决策、追加/替换、模式/权限、操作/事实互不混义；领域根和 services 分层有一致依据。
2. **八类 idiom**：按行为而不是旧名字归类；入口、handle、失败、availability、owner、generation/seq/epoch、终态一致；必要例外有明确理由，不删行为来迎合名字。
3. **全路径 authority**：同资源的高低层入口和官方返回 live handle 的合法用法均纳入地图；advanced seam 明确保证级别；关键不变量由门面自身闭合，不借推荐 services/raw 对象绕过。
4. **事实生产与参与分离**：扩决策参与不扩大 canonical fact 伪造权；研究插件自有事件走既有 `events.define`。
5. **残余功能归属**：OBS-14 的优雅 appExit、launch environment fallback、home/scope 行为，以及逐子包验收新发现的真实 DSH 交互，必须判定现有等价路径或收入本 feature 的明确公共 seam 范围；小型 runtime access 优先受限声明式/白名单面；跨出一等领域时正式拆线。
6. **M9 接线与状态回归**：ANY 修复后的 request/activity/checkpoint/attention 在实际组装下回归，query、operation、restore、续跑和 client 观察串成一条链。
7. **能力自描述**：成员级实际 reachability，source/authority/carrier 缺失与正常业务拒绝区别呈现；不用 aggregate active 掩盖部分失效。
8. **真实消费者守恒**：对观察报告 17 个项目及其运行时子包逐行为对账，同时覆盖 constitution 的 read-image/anchor；可用仓库内迁移切片/fixture，最终要有运行证据，不强制替第三方发布新版本。
9. **安装与兼容**：full 与选择性（main + 全部辅助包）装配行为相同；卸载恢复官方行；缺失/错配局部失效；官方直接使用者契约不被破坏。
10. **文档与登记**：canonical registry 是唯一事实源；历史现状注与新规格一致；补偿 M7 删除义务逐项对账；解决 M8 决策面与 constitution 表述冲突（经人类确认同步，不在 ANY 中改治理掩盖偏差）；M9 过期状态和临时链接按提交事实更新。

SPEC1 取舍方向：总树重构允许较激进，但顺序必须是「先确定需要保留的行为 → 定目标树 → 逐成员减法」；禁止先删 path、再把消费者缺失写成 contract-outside。现有 standards 的实质边界若要修改，作为人类确认的设计决定同步治理文档。

## Boundaries

- 不新增万能 runtime root、convergence namespace 或跨域大状态机。
- 不吞并产品插件；TS 化、SDK、对外发布、安装到系统路径与任何版本决策不在本线（纲领 §1.4）。
- 不把降级视为里程碑完成：正确基线的必需行为缺失 = M10 未完成；真实硬阻塞报证据并保持未完成，等待人类取舍。
- 未安装、断线、错配、合法冲突、用户拒绝、外部故障的诚实降级不视为缺陷，但不得借降级掩盖正确基线未实现。
- 版本冻结：不步进 runtime identity、`dsh.api` 或任何包版本字段。

## Expected result

纲领 §7.1 的三张表（消费者行为表、公共成员表、实现/装配表）对 17 个样本项目及其运行时子包逐行为闭合；§7.2 跨线用户故事（多 agent 协作、图片变体、自动继续与远端交互、checkpoint/rewind、模式与权限、主动压缩、workflow、原有能力不回归）全部跑通；canonical registry、能力自描述、当前规范/README、实现与消费者证据相互一致；full 与选择性装配等价。完成后不存在未归属的 OBS 问题或已承诺未接线的公开成员。

## Stage boundary

本文件只确认 Goal 方向，不批准目标树终表、逐成员映射、idiom 归类终稿或任何 standards 修订文本。Requirements 应把覆盖判据（三张表义务）、跨线验收矩阵、残余归属规则与文档登记义务写成 EARS；Design 再产出语义树与逐成员映射、idiom 归类、authority 地图、standards 同步清单与装配验收方案。
