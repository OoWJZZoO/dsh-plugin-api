---
name: spec-coding
description: Kiro 式 spec-driven development 五阶段工作流（Goal → Requirements → Design → Tasks → Execute），每个阶段须经用户显式确认后才进入下一阶段；需求用 EARS 语法、制品落在 docs/specs/<feature_name>/。在本仓库开始新 feature、或用户要求 spec coding / spec-first 时使用。
whenToUse: 在 dsh-plugin-api 仓库开始新 feature 的规格编写，或用户明确要求 spec coding / spec-driven development / 规格先行 时加载。
user-invocable: true
---

# Kiro Spec-Driven Development Workflow

本 skill 是 [kevinlin/spec-coding-mcp](https://github.com/kevinlin/spec-coding-mcp) 五阶段工作流在 DeepSeek Harness 中的移植版。**它只负责驱动流程，不代替 `agent/dsh-plugin-api/AGENTS.md`；两者冲突时，以 AGENTS.md 的铁律为准。**

## 何时使用

- 在 `dsh-plugin-api` 仓库开始一个新 feature 的规格编写；
- 用户明确要求 spec coding / spec-driven development / 规格先行；
- 一个 feature 需要先写清楚再实现，而不是直接改代码。

## 工作流总览

| 阶段 | 制品 | 确认门 |
|---|---|---|
| 0. Goal | `feature_name` + 目标摘要 | 用户确认目标后才进入 1 |
| 1. Requirements | `docs/specs/<feature_name>/requirements.md` | 用户确认需求后才进入 2 |
| 2. Design | `docs/specs/<feature_name>/design.md` | 用户确认设计后才进入 3 |
| 3. Tasks | `docs/specs/<feature_name>/tasks.md` | 用户确认任务后才进入 4 |
| 4. Execute | 代码 + 测试，逐任务执行 | 每完成一个任务停下等用户复核 |

硬规则：

- 每个阶段**必须得到用户明确批准**（如 “yes / approved / 可以 / 没问题”）才能进入下一阶段；未批准时只能修订当前阶段文档。
- `feature_name` 必须 kebab-case（如 `plugin-api-core`）。
- 使用 `todo_write` 跟踪五个阶段的进度。
- 执行阶段若发现 spec 有误，**先回改对应 spec 文档并重新确认**，不得在代码里悄悄偏离 spec。

---

## Stage 0: Goal Confirmation

先通过对话把“做什么、为什么、给谁用、预期结果、技术约束”问清楚。这是后续一切工作的地基。

约束：

- MUST 与用户充分对话，理解目标；
- MUST 询问并澄清：解决什么问题、谁使用、预期结果、技术约束；
- MUST 在用户明确确认前不得进入下一阶段；
- MUST 总结理解到的目标并等待用户确认；
- MUST 基于确认后的目标生成合适的 `feature_name`；
- SHOULD 在目标过宽或模糊时建议细化；
- MUST 在用户明确批准目标摘要前不得开始写 requirements。

`todo_write`：

```
- Goal confirmation (in_progress)
- Requirements gathering (pending)
- Design documentation (pending)
- Task planning (pending)
- Task execution (pending)
```

---

## Stage 1: Requirements Gathering

基于确认后的目标，先生成一版 EARS 需求文档，再与用户迭代修改，直到完整准确。此阶段**不做代码探索**，只写需求。

约束：

- MUST 创建 `docs/specs/<feature_name>/requirements.md`（若不存在）；
- MUST 基于用户目标**先生成初版**，而不是先连续提问；
- MUST 使用以下结构：
  - Introduction：概述 feature；
  - 层级编号需求，每条包含：
    - User Story：`As a [role], I want [feature], so that [benefit]`
    - Acceptance Criteria：编号 EARS 列表；
- MUST 使用 EARS 语法：
  - `WHEN <trigger> THEN <system> SHALL <behavior>`
  - `GIVEN <precondition> WHEN <trigger> THEN <system> SHALL <behavior>`
  - `WHERE <scope> IF <condition> THEN <system> SHALL <behavior>`
- SHOULD 在初版中考量边界情况、用户体验、技术约束、成功标准；
- 每次更新 requirements 后 MUST 请用户明确批准；用户不批准就继续改，直到批准；
- MUST 在获得明确批准前不得进入 design。

EARS 示例：

```text
WHEN a third-party plugin registers a synchronous llm/request transform
THEN the adapter SHALL receive the transformed request and the transform SHALL be idempotent.
```

本仓库的 requirements 还应明确标注每条需求属于哪一类：

- **A 类**：官方已 dispatch，只需稳定化；
- **B 类**：官方没有 dispatch 点，用底层钩子模拟；
- **C 类**：不改官方做不到，需写 upstream proposal。

`todo_write`：Goal 标 completed，Requirements 标 in_progress。

---

## Stage 2: Design Documentation

需求获批后，基于需求做必要的技术调研（读 DSH 源码、查官方文档），产出设计文档。调研结论直接融入设计，不单独建调研文件。

约束：

- MUST 创建 `docs/specs/<feature_name>/design.md`（若不存在）；
- MUST 基于需求识别需要调研的点，并实际调研；
- SHOULD 在对话中引用来源链接；
- MUST 包含以下章节：
  - Overview
  - Architecture
  - Components and Interfaces
  - Data Models
  - Error Handling
  - Testing Strategy
- SHOULD 适当使用 Mermaid 图；
- MUST 确保设计覆盖全部已确认需求；
- SHOULD 标注关键设计决策与理由；
- 每次更新 design 后 MUST 请用户明确批准；未批准不得进入 tasks；
- 若设计中发现需求缺口，MUST 主动提出回退到 requirements。

本仓库 design 还必须写清每个钩子的引出机制：官方事件直接绑定 / 底层钩子模拟 / 标记为 upstream proposal，并给出失败路径与 guard 策略。

`todo_write`：Requirements 标 completed，Design 标 in_progress。

---

## Stage 3: Task Planning

设计获批后，把设计转成可执行的编码任务清单。任务文档必须基于设计文档。

约束：

- MUST 创建 `docs/specs/<feature_name>/tasks.md`（若不存在）；
- MUST 按以下原则把设计转成任务：

```text
Convert the feature design into a series of prompts for a code-generation LLM
that will implement each step in a test-driven manner. Prioritize best
practices, incremental progress, and early testing, ensuring no big jumps in
complexity at any stage. Make sure that each prompt builds on the previous
prompts, and ends with wiring things together. There should be no hanging or
orphaned code that isn't integrated into a previous step. Focus ONLY on tasks
that involve writing, modifying, or testing code.
```

- MUST 用编号 checkbox 列表，最多两级层级（如 `1.1`、`1.2`）；
- 每个任务 MUST 包含：
  - 明确目标（写/改/测具体代码）；
  - 子要点补充信息；
  - 引用 requirements 的具体子需求编号；
- MUST 只包含编码代理可执行的任务；禁止 UAT、部署、性能采集、用户培训、文档编写等非编码任务；
- SHOULD 优先 TDD；每个任务建立在前一个任务之上，最终把所有东西接起来；
- MUST 确保所有需求都被任务覆盖；
- 每次更新 tasks 后 MUST 请用户明确批准；未批准不得进入 execute；
- 若发现设计或需求有缺口，MUST 主动提出回退。

`todo_write`：Design 标 completed，Task planning 标 in_progress。

---

## Stage 4: Task Execution

从 `tasks.md` 找第一个未完成任务，**一次只做一个任务**。

前置：执行前 MUST 先读完 `requirements.md`、`design.md`、`tasks.md` 三份文档。

约束：

- 只做当前这一个任务，不夹带其他任务的功能；
- 若有子任务，先做子任务；
- 对照任务引用的需求条目验证实现；
- 完成当前任务后**停下等用户复核**，不要自动继续下一个任务；
- 用户未指定任务时，从 `tasks.md` 推荐下一个任务；
- 完成任务后 MUST 回写 `docs/specs/<feature_name>/tasks.md`，把该任务标记为 implemented。

本仓库补充规则（来自 AGENTS.md，优先级更高）：

- 未走完确认门之前禁止创建 `lib/`、`package.json`、`test/` 等实现产物；
- 测试用 `node --test`；纯函数模块保持零 harness 依赖；
- 不修改官方 DSH 包文件；所有入口 fail-safe，绝不抛穿 apply。

`todo_write`：进入执行后按任务粒度建立新列表，例如：

```
- Task 1.1: <任务描述> (in_progress)
- Task 1.2: <任务描述> (pending)
```

---

## 小结

1. 明确目标 → 2. EARS 需求 → 3. 技术设计 → 4. 任务清单 → 5. 逐任务执行。
每个阶段都建立在前一阶段之上，且必须经用户明确批准后才能继续。
