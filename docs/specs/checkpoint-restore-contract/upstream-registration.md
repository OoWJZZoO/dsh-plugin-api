# U-series 上游提案与退役条件登记（草稿）

> feature: checkpoint-restore-contract
> 状态: 本线 spec 制品内登记草稿（任务 8.9 / 10.3）。**registry/feature-list §3.1 的正式登记由集成波执行**（tasks 任务 15.2）；本文件为集成波提供登记内容。U-series 编号由集成波统一编配，本文件不预占编号。

## 1. workspace snapshot slice（新建 replacement 包，dsh-workspace owner）

- **承载能力**：workspace 受管状态快照捕获（capture-point）与 fail-closed 官方-API 重建恢复路径（restore-path）；capability 门 = probe（`workspace-slice-probe.md`，2026-09-06 通过）。
- **上游提案**：请官方 `@deepseek-ai/dsh-workspace` 提供等价公开 seam：workspace 受管状态的权威快照读取（capture）与身份保持的恢复/回滚 API（restore），使第三方无需替代该行即可获得 file 级 rescue。
- **退役条件**：官方提供等价 snapshot/restore 公开 seam 且可承载本 slice 的完好行为后，本包迁移回官方绑定并进入 deprecation；登记时须同步 feature-list §3.1 跨组件 R 报备（owner `@deepseek-ai/dsh-workspace`）。
- **客户端半面**：host-only（六问全否，证据见 probe 文档 §1.1）。

## 2. 共享 loop boundary slice 消费（agent-loop owner 包；联合登记）

- **承载能力（本线侧）**：live-attempt observed 证据、stop-then-restore 的 `by: 'system'` 唯一 cancel 路径、auto-capture 触发点。
- **上游提案/退役条件**：共享切片本体由其实现线（`session-interaction-operation`，agent-loop owner 包）登记；本线只登记消费契约——官方提供 attempt 生命周期公开面（可观察 attempt 状态 + 统一 cancel seam）后，本线消费点迁移，切片与消费侧同步退役。

## 3. 残余 C 类 gap（各附退役条件；集成波统一补登 U-series）

| gap | 性质 | 证据 | 退役条件 |
|---|---|---|---|
| 执行中（in-flight）attempt/tool/provider 状态恢复 | in-flight 状态无 durable 可引用面；stop-then-restore 是可达边界 | requirements §R 决策节 / design §3 | 官方提供 attempt 持久化 seam 后升级为可捕获 source |
| 跨档原子单提交（cross-scope atomic single commit） | 无官方跨组件原子原语；崩溃原子性不可证明 | 同上 | 官方提供跨组件原子提交原语 |
| 官方内部 durability checkpoint 引用（session-checkpoint-policy 行） | 官方行无 ctx 服务/事件面，契约不可复刻 | design §Current-State Findings | 官方公开 checkpoint 引用 seam 后新增 capture source |
| 外部副作用回滚 | 非任何官方组件可承诺语义 | requirements §Boundaries | 不适用（永久诚实边界；按 policy 人工处理） |

## 4. 集成波动作清单（供集成代理）

1. feature-list §3.1 登记：workspace snapshot slice（owner `@deepseek-ai/dsh-workspace`）+ 共享 loop boundary slice 消费联合登记（tasks 15.2）。
2. 为上述 1–3 项编配 U-series 编号并落 feature-list/capability-strategy §9 同步。
3. registry `executions.recovery.checkpoints.*` 全成员 + capabilities 子簇 + `planRestore` verb 例外 + `agent/attempt/*` 事件面登记（tasks 15.1）。