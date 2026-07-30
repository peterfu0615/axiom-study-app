# AIJob 状态机设计

> 本文档描述 Axiom 中所有 AI 任务（错题分析、正解生成、学生解答识别、推理分析、选区讲解）的统一状态机，作为稳定性保障与未来扩展的基线。

## 1. 设计目标

- **可恢复**：App 崩溃 / 强杀后，重启时能自动把卡住的 `processing` 任务拉回 `pending` 重跑。
- **幂等**：同一任务重复执行不会产生脏数据；每条领域记录通过 `active_model_run_id` 指向「当前生效的那一次运行」。
- **可观测**：状态流转全部落库，前端可通过 `ai_status` / `status` 字段渲染进度与失败原因。
- **不阻塞 UI**：AI 执行在前端 Web Worker（`runSolutionWorker`）与 Rust 端异步进行，状态机在数据库层驱动。

## 2. 统一状态枚举

所有 AI 相关表（`problems.ai_status`、`problem_solutions.status`、`student_attempts.status`、`reasoning_analyses.status`）共用同一组状态：

| 状态 | 含义 | 谁写入 |
| --- | --- | --- |
| `not_started` | 尚未发起 AI 任务（默认值） | 迁移 / 新建记录 |
| `pending` | 已入队，等待 Worker 取走 | 入队逻辑（`queueProblemAI` 等） |
| `processing` | Worker 已取出，正在调用模型 | Worker 开始执行时 |
| `completed` | 模型返回且解析成功 | 解析器成功后 |
| `failed` | 模型调用失败或解析失败 | 异常分支 |

`model_runs.status` 使用一个精简子集：`pending` → `processing` → `completed` / `failed`。

## 3. 状态流转图

```
                    queue(task)
  not_started ───────────────────► pending
       ▲                                │
       │ recover (processing→pending)   │ Worker 取走
       │                                ▼
       │                            processing
       │                              │     │
       │                 成功 (parse)   │     │ 失败 / 异常
       │                              ▼     ▼
       └── (用户重跑时回退) ──── completed  failed
```

关键不变量：
- `processing` 是**非持久承诺**——App 重启后必须被回收为 `pending`，否则任务永久卡死。
- `completed` / `failed` 是终态，只有用户显式重跑才会回到 `pending`。
- 领域记录的 `active_model_run_id` 始终指向最近一次「有意义」的运行（成功或失败均保留），便于展示原始输出与重试。

## 4. 启动恢复机制

三条恢复路径在 App 启动时（`setup` 完成后、`drainPending*` 之前）执行：

1. **`recoverProblemAITasks`**：将 `problems.ai_status IN ('pending','processing')` 且其 `ai_active_model_run_id` 指向的 `model_runs.status = 'processing'` 的行，重置 `model_runs.status = 'pending'`、清空 `error_message`。
2. **`recoverSolutionTasks`**：同上，针对 `problem_solutions` + `task_type = 'generate_solution'`。
3. **`recoverIntelligenceTasks`**：分两步——先把已完成 `model_runs` 但领域记录仍为 `pending/processing` 的「漏标记」补成 `completed`；再把仍为 `processing` 的 `model_runs` 重置为 `pending`。

> 恢复逻辑只做**向前修正**（processing→pending 或补齐 completed），从不删除数据，保证可审计。

## 5. 入队 / 排队策略

- 每类任务有独立的 `drainPending*` 轮询：在前一次执行完成（成功或失败）后触发下一轮，避免并发竞争同一连接。
- 排队失败（如数据库锁）记录日志但不抛出，下一轮自动重试。
- 单连接 Mutex（见 [SQLite 性能评估](./SQLITE_PERFORMANCE.md)）天然串行化，无需应用层分布式锁。

## 6. 失败处理与重试

- 失败时写入 `error_message`（领域记录）与 `model_runs.error_message` + `raw_output`。
- `provider_attempts_json`（migration 0014）记录多 Provider 逐次尝试的原始输出，供诊断 fallback 链路。
- 重试由用户显式触发，状态回退 `failed → pending`，并新建一条 `model_runs`（旧记录保留为历史）。

## 7. 已知限制 / 未来改进

| 项 | 现状 | 建议 |
| --- | --- | --- |
| 自动重试上限 | 无自动重试，仅用户手动 | 可加 `retry_count` 字段与指数退避，但首版不做以避免放大 API 成本 |
| 长任务超时 | Rust 端 `wait-timeout` 控制子进程；HTTP 无显式超时 | 已在 `ai.rs` 用 `MAX_RESPONSE_BYTES` 兜底；后续可加 reqwest timeout |
| 跨设备状态同步 | 无 | 单机产品，暂不需要 |
| 任务取消 | 无显式取消 | Worker 重启即丢弃进行中任务，恢复机制兜底；如需可加 `cancelled` 终态 |

## 8. 验证要点

- 强杀 App 后重启：卡在 `processing` 的任务应自动回到 `pending` 并被重新执行。
- 模型返回非法 JSON：状态应落到 `failed`，`error_message` 非空，UI 显示可重试。
- 同一题目连续点击两次「分析」：第二条入队，前一条完成后才执行第二条，不产生交错。
