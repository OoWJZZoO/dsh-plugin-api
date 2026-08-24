# 身份与生命周期标准（identity & lifecycle）

> 适用范围：所有会暴露 identity、generation、终态语义的 feature（execution observation、session branch、lease/coordination、checkpoint、task 观察、诊断等）。
> 权威性：Stage 0 共同问题 NO.1 / NO.3 / NO.4 的综合落地（2026-08-21 确认）；feature 立项时逐条对照。
> 关联：durable mutation 面的 commitState 执行细节见 `durable-state-and-scope.md`；并发取消、stale callback 与 disposer 所有权见 `concurrency-and-cancellation.md`；projection 面的 observer epoch 见 `api-shape.md`。

## 1. execution 身份

- **executionId 由 plugin-api 自己生成**，不等待官方提供稳定 execution identity；具体生成规则随首个 execution feature 的 design 定稿（承诺全局唯一即可，不承诺可排序）。
- execution 的边界由 feature 定义，但必须代表一次逻辑操作；feature 必须在 design 中说明触发来源、parent/cause 和何时开始/结束。
- 不得把 event seq 当作 execution identity：事件碎片可能乱序、重放或丢失，身份必须独立于事件序列。
- execution identity **不因 attempt 重试而变化**：attempt 是 execution 之下的层级（见 `durable-state-and-scope.md` §3）。
- 内部驱动的自动重试复用同一 execution 并新增 attempt；外部重新触发同一操作，即使参数相同，也创建新的 execution。

## 2. generation 语义

- generation 使用 **owner-specific opaque token**：每个 owner 用自己的生成规则与命名空间，门面不做全局统一单调序号。
- 若某个 owner 确实需要排序，**额外提供 owner-local revision**；revision 只在同一 owner 内可比。
- owner 身份 = owner id；generation 只用来判定"旧状态/旧回调是否已被取代"，**不得跨 owner 比较**。

## 3. 终态词汇（统一 terminal outcome）

- 统一终态词汇：`success` / `error` / `aborted` / `denied` / `superseded`。
- **不同对象仍使用不同字段承载**：execution → `outcome`、mutation → `commitState`、resource → `lifecycleState`；任务可复用统一终态词汇。语义统一，字段不合并。
- 不得把生命周期词（`settled`、`committed`、`closed`、`disposed`）与终态混用：终态与生命周期跟踪是两层概念。
- 终态 final 且唯一：一个对象只允许一个终态，事后不得改写；`superseded` 本身是一个终态，不是"允许旧结果补写"的通道（见 `durable-state-and-scope.md` §4）。
- timeout 不新增终态词汇，归入 `error`，并以原因/分类字段标记为 timeout。
- 对尚未提交的竞争性失败信号，裁决优先级为 `aborted` > `superseded` > 普通 `error` > timeout 型 `error`。该优先级只适用于同一提交窗口；任何终态一旦原子提交，后到信号不得改写它。
- generation 只保证同一 owner、同一运行生命周期内有效；需要跨重启识别的对象必须使用单独的 durable identity。
