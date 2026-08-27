# API 形状标准：投影 / 策略 / 变更三面边界（api shape）

> 适用范围：所有新增**语义组合型** feature（非纯官方直通）的公开 API 设计；纯官方直通（A 类）按官方形状原样直通，不适用三面改造。
> 权威性：Stage 0 共同问题 NO.9 的综合落地（2026-08-21 确认）。
> 关联：命名空间安置规则见 `docs/specs/plugin-api-features/feature-list.md`「命名空间安置规则」；失败呈现沿用既有 P1–P4 路径；横切派发语义（priority / deepFreeze / fault containment）永不走 R（`capability-strategy.md`）。

## 1. 三面定义（face）

| 面 | 允许 | 禁止 | 生命周期 | 失败呈现 |
|---|---|---|---|---|
| **projection**（投影） | 订阅事件、组合既有服务、返回冻结只读视图 | 无副作用：不写状态、不注册策略、不调 mutation | observer 订阅 + disposer；可按 epoch 重建（先例：H2 `DurableObservationHub`） | 视图缺位/降级，绝不抛穿 |
| **policy registry**（策略注册） | 单一 register 入口；系统在**明确决策点**调用策略，返回决定/改写值 | 策略不产生副作用、不做 mutation、不私下读状态（输入显式传入）；门面不伪造决策结果 | 注册返回 disposer；身份 owner id + generation token；决策幂等收敛（先例：`llm/request` at-most-once、compaction-events / session-title 策略瀑布） | 策略抛错只降级该决策点为默认决定 |
| **durable mutation**（变更） | 写持久/半持久状态；identity + generation + commitState；必声明 scope 一档；按 operation 声明能力 | 不自己做策略决策；不做汇总投影 | 事务 commit/rollback；fail-closed + audit | 见 `durable-state-and-scope.md` |

## 2. 数据流（单向，面间不私通）

```text
decision point（系统内）→ 调 policy → mutation（可能发生）→ 发事件 → projection（订阅重算）
```

- policy 不读状态；mutation 不决策；projection 不注册不写。
- 每个面的状态空间只有一个 owner。

## 3. 一面原则（one primary face per feature）

- 每个候选 feature **只有一个主公开面**：读 → projection；收策略 → policy；写状态 → mutation。
- 一个 feature 可以同时包含 facade translation 与一个 R capability slice；这不改变一面原则，二者必须有独立 owner 和清晰的组件归属。
- 自然多面的候选：拆成多个 feature，或同一 feature 内拆为**独立 owner 的面**（先例：llm 命名空间内 modelInfo 投影 / admission 策略 / stream 直通并存，不共享私有状态，各自 feature guard）。
- 跨 feature 共享原语（durable record、epoch、lease/CAS、transaction 骨架）放**内部共享模块**，不进公开 namespace 当万能 root（先例：H2 `DurableObservationHub` 为底座；`lib/remote-publication.js` 共享核心被多 owner 参数化复用）。

## 4. smell 判据（评审必查）

1. 同一 feature 公开 API 同时出现 register + query + mutate 且共享状态空间 → 必须拆；
2. 投影有副作用 / 策略不是纯函数 / mutation 绕过 policy → 违规；
3. durable mutation 跨 scope 档（`durable-state-and-scope.md` §1）→ 拆。

## 5. 与既有规则衔接

- 顶层命名空间只保留给核心域与基础设施；二线纯直通 seam 一律收敛 `pluginApi.services.*`；带门面附加语义的 feature 自建顶层命名空间（feature-list.md 安置规则）。
- B 类是否转 R 按官方组件边界、契约保留、风险与维护成本判断；R 类硬性规则见 `capability-strategy.md`。三面模型不改变该判断，只约束 R 与 B 的公开 API 形状。
- facade 可以组合多个官方组件的公开能力；一个 R capability slice 可以跨组件协同（须在 feature-list.md §3.1 报备登记），但每个替换行仍归属唯一官方组件包，且不能依赖跨组件 replacement 才能成立。
