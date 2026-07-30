# SQLite 性能评估

> 评估 Axiom 当前 SQLite 配置在单机桌面场景下的性能特征、瓶颈与风险，给出可执行的优化建议。

## 1. 当前配置总览

| 维度 | 配置 | 位置 |
| --- | --- | --- |
| 数据库文件 | `~/Library/Application Support/com.axiom.study/axiom.db` | `db.rs::db_path` |
| Journal 模式 | **WAL**（Write-Ahead Logging） | `init_db` → `SqliteJournalMode::Wal` |
| 并发模型 | **单连接 + `Mutex<Option<SqliteConnection>>`** | `DbState` |
| busy_timeout | **10s** | `PRAGMA busy_timeout = 10000` |
| foreign_keys | **ON** | `PRAGMA foreign_keys = ON` |
| 连接池 | tauri-plugin-sql 仅用于启动迁移；运行时所有读写走单连接 | `db.rs` 注释 |
| 语句日志 | Trace 级别（仅 debug） | `log_statements(Trace)` |

## 2. 设计取舍分析

### 2.1 单连接 + Mutex（核心决策）

**背景**：tauri-plugin-sql 默认 5 连接池，BEGIN/COMMIT 路由到不同连接会导致 `cannot start a transaction within a transaction` 与 `database is locked`。

**取舍**：
- ✅ 彻底消除连接交错与锁竞争——所有 SQL 串行执行，事务语义完整。
- ✅ WAL 模式下读写不互斥，单连接仍能服务读请求（读走 WAL 快照）。
- ⚠️ 吞吐上限 = 单连接串行吞吐。对 Axiom（单用户、低 QPS、操作以用户触发为主）完全够用。
- ⚠️ 长查询会阻塞后续操作；当前最长查询是 AI 任务的 `SELECT ... JOIN model_runs`，毫秒级，无风险。

**结论**：取舍合理。单机错题工具不存在高并发，单连接换来的事务正确性收益远大于吞吐损失。

### 2.2 WAL 模式

- ✅ 写不阻塞读，UI 列表查询与 AI 写入可并行（读走 WAL 快照）。
- ✅ 崩溃恢复：WAL 在 checkpoint 时合并，正常使用由 SQLite 自动管理。
- 注意：WAL 文件（`axiom.db-wal`、`axiom.db-shm`）需与主库同目录，备份时必须一并复制。

## 3. 索引覆盖评估

| 表 | 索引 | 覆盖的查询 |
| --- | --- | --- |
| `problems` | `idx_problems_library(status, deleted_at, archived_at, created_at DESC)` | 错题库列表分页 |
| `problems` | `idx_problems_ai_status(ai_status, updated_at)` | AI 任务 drain 扫描 |
| `model_runs` | `idx_model_runs_problem_task(problem_id, task_type, created_at DESC)` | 按题目查历史运行 |
| `problem_solutions` | `idx_problem_solutions_status(status, updated_at)` | 正解任务 drain |
| `problem_regions` | `idx_problem_regions_problem_type(problem_id, region_type, updated_at)` | 区域列表 |
| `reasoning_analyses` | `idx_reasoning_analyses_problem(problem_id, updated_at)` | 推理分析列表 |
| `ai_provider_profiles` | 无（行数极少，全表扫描可接受） | 设置页 |

### 缺失索引（建议补充）

| 表 | 建议索引 | 理由 |
| --- | --- | --- |
| `student_attempts` | `(problem_id)` | `recoverIntelligenceTasks` 与列表查询按 `problem_id` 过滤；当前 `UNIQUE(problem_id)` 已隐含索引，**无需额外添加** |
| `model_runs` | 已有 `(problem_id, task_type, created_at DESC)`，恢复查询按 `status = 'processing'` 过滤 | 数据量小，全扫可接受；如未来运行量增长可加 `idx_model_runs_status` |

**结论**：当前索引覆盖良好，`student_attempts` 的 `UNIQUE(problem_id)` 已隐式提供 `(problem_id)` 索引，无需新增。

## 4. 容量与性能预估

| 场景 | 预估规模 | 单次操作耗时 |
| --- | --- | --- |
| 错题库列表 | 1k–10k 条 | <5ms（索引 + LIMIT） |
| 单题 AI 分析写入 | 1 条 problem + 1 条 model_run | <2ms |
| 启动恢复扫描 | 全表 `model_runs` 过滤 `processing` | <10ms（<10k 行） |
| 媒体 GC 扫描 | 文件系统遍历，非 SQL | 取决于文件数 |

> 即使到 10 万条错题，WAL + 索引下单查询仍在 20ms 内。Axiom 的性能瓶颈是 AI 模型调用（秒级），不在 SQLite。

## 5. 风险与缓解

| 风险 | 现状 | 缓解 |
| --- | --- | --- |
| 语句日志在 release 拖慢 | `log_statements(Trace)` 始终开启 | **建议**：release 关闭，仅 debug 开启 |
| WAL 文件膨胀 | 未显式 checkpoint | SQLite 自动 checkpoint（默认每 1000 帧）；单机低写量无风险 |
| 单连接 Mutex 持锁过久 | 所有命令共享一把锁 | 当前查询均毫秒级，无长事务；AI 调用不持锁（先读后释放，调用结束再写） |
| 备份遗漏 WAL | 无备份机制 | Phase 2 文档中提示用户备份主库 + `-wal` + `-shm` |

## 6. 可执行优化项

1. **Release 关闭语句日志**（P1）：`log_statements` 在 `cfg!(debug_assertions)` 时为 Trace，release 改为 `log::LevelFilter::Off`，避免每条 SQL 序列化开销。

   ```rust
   let log_statements = if cfg!(debug_assertions) {
       log::LevelFilter::Trace
   } else {
       log::LevelFilter::Off
   };
   // .log_statements(log_statements)
   ```

2. **`synchronous` PRAGMA**（可选）：WAL 模式下 `PRAGMA synchronous = NORMAL` 即可保证耐久性且提升写吞吐。当前用 SQLite 默认（FULL），对单机可接受，暂不调整。

3. **暂不加连接池**：单机场景单连接足够，引入连接池会重新带来事务交错问题，得不偿失。

## 7. 结论

当前 SQLite 配置对 Axiom 的单机、单用户、低 QPS 场景**完全胜任**，WAL + 单连接 Mutex 是针对历史事务错误的正确修复。唯一值得立即处理的是 release 关闭语句日志（项 1），其余维持现状。
