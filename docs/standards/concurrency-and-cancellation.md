# 并发与取消标准（concurrency & cancellation）

> 适用范围：存在异步竞争、共享状态、取消信号、generation 替换、stale callback、异步发布或资源清理的 feature。
> 普通同步官方直通不需要额外套用本册；只需保留官方既有并发与取消语义。
> 关联：execution / generation / 终态见 `identity-and-lifecycle.md`；retry 与 durable mutation 见 `durable-state-and-scope.md`；公开面边界见 `api-shape.md`。

## 1. 基本原则

1. **取消是信号，终态是裁决。** `AbortSignal` 或等价取消通知只表示有人请求停止，不等于对象已经提交 `aborted`。owner 必须在统一提交点根据仍有效的竞争信号决定最终 outcome。
2. **停止努力不等于正确性保证。** owner 应尽力取消旧工作，但底层 provider、Promise 或 I/O 可能无法真正停止。正确性必须由 identity / generation guard 保证，而不能依赖底层一定及时终止。
3. **提交能力必须可撤销。** 被替代、已 dispose、已失去 owner 资格或已进入终态的操作，不得继续写共享状态、发布当前结果或清理新 owner 的资源。
4. **每个共享状态只有一个并发语义 owner。** facade、replacement 和内部底座不得各自对同一资源另行定义互相冲突的抢占、排队或提交规则。

## 2. 取消与终态

取消原因必须与终态区分：

| 触发 | 候选终态 | 说明 |
|---|---|---|
| 用户、模型或 owner 主动取消 | `aborted` | 由主动取消请求产生；不得因底层抛出普通错误而改写成含义不明的结果 |
| deadline 到期 | `error` | `reason` / 分类字段标记为 `timeout`；不新增 `timeout` 终态 |
| 新 generation 取代旧 generation | `superseded` | 旧操作不得继续补写；是否同时发出 abort 见 §3 |
| provider 或内部故障 | `error` | 按 operation 能力声明决定是否允许 retry |

同一提交窗口内的未决竞争，沿用 `identity-and-lifecycle.md` 的优先级：
`aborted > superseded > error > timeout-error`。任何终态原子提交后，后到的取消、错误或成功结果都不能改写它。

## 3. AbortSignal 与取消传播

- 父 execution 的取消必须传播给仍存活的 child operation、当前 attempt 和其拥有的 provider/tool 请求。
- child operation 的取消或失败默认只结束 child，不反向取消父 execution；只有当 feature 明确声明 child 是父操作的 required child 时，才可以升级父级 outcome。
- 不得用一个脱离调用者的本地 signal 替换调用者传入的 signal。需要增加本地取消源时，必须组合上游 signal 与本地 signal，并保留上游取消语义。
- 取消传播应当尽早发生，但不能假设下游已经停止；下游回调仍须经过提交资格检查。
- execution 已提交 `aborted`、`superseded` 或其他终态后，不得启动新的 retry attempt。

## 4. Stale result 与提交资格

所有异步结果在写入、发布或触发下一步前，必须验证与该操作相关的提交资格。至少包括：

- owner identity 仍然匹配；
- generation 仍然是 owner 当前认可的 generation；
- execution / operation 尚未进入终态或被禁止提交；
- 目标资源仍由当前操作持有，且没有被新 owner 接管。

校验失败时，旧结果可以作为 diagnostic 或 audit 信息保留，但：

- 不得更新当前状态或 durable record；
- 不得伪装成当前 operation 的成功、失败或进度事件；
- 不得调用新 owner 的 disposer；
- 不得启动依赖当前结果的后续 attempt。

这条规则适用于真实取消失败、网络请求晚到、Promise rejection 晚到、HMR / reconnect 旧回调和 profile 重装等情况。

## 5. Disposer 与资源所有权

- disposer 必须幂等，并且只能撤销本次 owner 实际创建或明确持有的资源。
- 清理按 identity 判断，而不是仅按共享 key 无条件删除；旧 disposer 不得删除新 owner 已发布的同名资源。
- apply 失败时，只清理本次已经确认归属自己的资源；未发布或归属不明的资源不得盲目清理。
- dispose 之后到达的异步回调必须失去发布、提交和再次注册能力。
- replacement、remote mount、observer、listener、lease、timer 和 provider 注册都适用本节；具体 disposer 返回值仍保留官方 API 的 identity 与错误语义。

## 6. 并发策略声明

存在共享状态或异步竞争的 feature 必须在 design 中选择并声明适用策略；不要求所有 feature 使用同一种策略：

| 策略 | 语义 |
|---|---|
| `parallel` | 操作互不影响，可并行完成 |
| `exclusive` | 同一 scope 同时只允许一个操作 |
| `latest-wins` | 新 generation 取代旧 generation，旧结果失去提交资格 |
| `queue` | 按明确顺序排队处理 |
| `compare-and-swap` | 以 revision、lease 或等价条件检查后提交 |
| `deduplicate` | 相同 operation key 可共享一次底层工作，但不合并外部 execution identity |

声明至少要说明 scope、冲突判定、取消行为、提交条件和清理 owner。只读 projection 若没有共享写入或异步重建竞争，可声明“不适用”。

## 7. Retry、attempt 与 execution

- 内部 retry 不创建新的 execution；每个 attempt 可以拥有独立的局部取消控制器。
- attempt timeout 可以结束当前 attempt 并按 operation 能力声明启动下一 attempt，但不能绕过 execution 的取消、superseded 或终态提交规则。
- execution 被取消或 superseded 后，禁止继续启动 attempt；已启动的 attempt 仍必须执行 stale-result guard。
- 模型、用户或其他外部调用再次发起相同操作，即使参数完全相同，也创建新的 execution；不得因底层 deduplicate 而合并身份。
- deduplicate 可以共享底层 Promise 或 provider 工作，但每个外部 execution 必须独立获得其 outcome、取消和提交资格。
- retry 是否允许、次数、退避和 deadline 仍按 `durable-state-and-scope.md` 的 operation capability declaration 决定；未声明时默认不自动 retry。

## 8. 适用性与最低设计要求

以下 feature 通常必须逐条对照本册：

- durable mutation、lease、checkpoint、后台任务和跨 session coordination；
- 异步 re-entry、generation 替换、latest-wins 或会缓存 Promise 的 facade；
- replacement package 的异步 apply / dispose 生命周期；
- client remote publication、mount、reconnect、HMR 或 browser-side state；
- 明确暴露 `AbortSignal`、timeout、cancel 或 disposer 的 API。

普通同步 A 类直通、没有共享状态且不暴露异步生命周期的 feature，只需在 design 中注明本册不适用。适用 feature 的 design 至少要写清：取消来源和传播方向、并发策略、提交资格、stale 结果处理、disposer 所有权，以及 retry 与 execution 的关系。
