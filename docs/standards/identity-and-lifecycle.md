# 身份与生命周期标准（identity & lifecycle）

> 适用范围：所有会暴露 identity、generation、终态语义的 feature（execution observation、session branch、lease/coordination、checkpoint、task 观察、诊断等）。
> 权威性：Stage 0 共同问题 NO.1 / NO.3 / NO.4 的综合落地（2026-08-21 确认）；feature 立项时逐条对照。
> 关联：durable mutation 面的 commitState 执行细节见 `durable-state-and-scope.md`；projection 面的 observer epoch 见 `api-shape.md`。

## 1. execution 身份

- **executionId 由 plugin-api 自己生成**，不等待官方提供稳定 execution identity；具体生成规则随首个 execution feature 的 design 定稿（承诺全局唯一即可，不承诺可排序）。
- 不得把 event seq 当作 execution identity：事件碎片可能乱序、重放或丢失，身份必须独立于事件序列。
- execution identity **不因 attempt 重试而变化**：attempt 是 execution 之下的层级（见 `durable-state-and-scope.md` §3）。

## 2. generation 语义

- generation 使用 **owner-specific opaque token**：每个 owner 用自己的生成规则与命名空间，门面不做全局统一单调序号。
- 若某个 owner 确实需要排序，**额外提供 owner-local revision**；revision 只在同一 owner 内可比。
- owner 身份 = owner id；generation 只用来判定"旧状态/旧回调是否已被取代"，**不得跨 owner 比较**。

## 3. 终态词汇（统一 terminal outcome）

- 统一终态词汇：`success` / `error` / `aborted` / `denied` / `superseded`。
- **不同对象仍使用不同字段承载**：execution → `outcome`、mutation → `commitState`、resource → `lifecycleState`；任务可复用统一终态词汇。语义统一，字段不合并。
- 不得把生命周期词（`settled`、`committed`、`closed`、`disposed`）与终态混用：终态与生命周期跟踪是两层概念。
- 终态 final 且唯一：一个对象只允许一个终态，事后不得改写；`superseded` 本身是一个终态，不是"允许旧结果补写"的通道（见 `durable-state-and-scope.md` §4）。