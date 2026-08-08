# Axiom 当前状态与下一阶段

审计日期：2026-08-08；审计基线：`main@94be990`（v0.4.8）。本报告以 HEAD、迁移、测试和本机已运行的 Axiom 为准，而非旧 PRD。工作区原有未提交的 `PRD.md`、`src/App.css`、`src/ai/solution.schema.json` 及素材未纳入审计或本次提交。

## Executive summary

Axiom 已有两条可用的本地闭环：错题从采集、裁剪、入库到题目分析/解答/作答识别；教材从导入、页提取、识别、结构确认到知识节点和候选标签入库。Horizon 不是空壳：教材、知识节点、标签定义/别名、问题标签、审核、教材匹配、批量重标注和审计迁移均已存在，并有较强的 SQLite 完整性约束。

关键缺口是两条闭环只在数据层相遇：当前分析 worker 仅在“教材已由用户锁定”时把教材**元数据**放进 prompt，不会自动选择教材，也不会加载该教材的知识节点/active tag candidates。因此模型给出的自由文本标签通常不能命中受控标签；虽然后续事务式 mapping 已实现，实际题目仍可完成而没有标签。实机中已观察到一条“教材已确认 + AI 解析完成 + 四类标签均为空”的题目。

AI 可靠性已优于早期版本（持久化 ModelRun、provider attempts、重启恢复、fallback loop、超时），但错误信息仍是字符串拼接。前端最终只展示 `error_message`，实机失败题显示“未返回错误详情”，不能辨别网络、鉴权、限流、模型输出、schema、映射还是持久化。

## 当前架构与完成度

| 领域 | 实际状态 | 证据与限制 |
| --- | --- | --- |
| 错题采集/入库 | 可用闭环 | `CaptureWorkspace`、`DocumentEditor`、`database.ts`；图片、regions、saved/candidate 状态已持久化。 |
| Problem Analysis | 可用但可靠性可诊断性不足 | `ai/pipeline.ts` 串行 claim→provider→parser→transaction；`model_runs` 保存结果。 |
| Solution/Attempt/Reasoning | 可用的异步子闭环 | `solutionPipeline.ts`、`intelligencePipeline.ts`、migration 0013；题目分析成功后排队，不阻塞主分析。 |
| 教材导入 | 可用闭环 | `CurriculumImportFlow`/`horizonDatabase.ts` 和 Rust extraction commands；checkpoint、stage attempt、失败页占位均已有。 |
| 知识结构 | 可用、受约束 | `knowledge_nodes` 与 0024/0026/0028；当前树收敛为章节→知识点，重复节点会软归档/重定向。 |
| Tag/Horizon | 基础设施已完成约 75% | `tag_definitions`、`tag_aliases`、`problem_tags`、taxonomy version、审核/合并/批量重标注均存在；缺少“受限知识上下文→稳定 canonical mapping”的连接。 |
| Problem→教材 | 手动可用、自动不完整 | 0023 和 `resolveProblemTextbook` 有单教材/metadata/AI hint 策略；调用只发生在完成写入后，并非分析前。 |
| Provider fallback | 有顺序 fallback，无策略模型 | `getVisionProvidersForRun` 逐个尝试；无按 error 分类的 retry/fallback 决策或 backoff。 |
| Today/洞察 | UI 占位 | Sidebar 暴露入口，`ModulePlaceholder`；0027 建表了未来 Learning Loop，但没有产品闭环。 |

## Qwen3.8 Max 修改评估

8 月 1–6 日的主要贡献已合入 `520fb72`：教材工作台重建、迁移 0024–0029、任务恢复、受控标签事务化、响应式滚动、LaTex/Markdown 统一，以及 `5b2c805` 的锁定教材 prompt 注入。`git log` 显示这些是增量修复而非仅视觉 patch。

应保留且不要重写：

- `ad7b88f`：`completeProblemAIModelRun` 内把 mapping 写入与分析完成同一事务，避免“标签写失败却 completed”。
- `f4afa42`、0023：题目/教材科目一致性 trigger 和科目编辑冲突保护。
- `55278a2`、`e0db5c4`、`00adcbc`：批量 relabel claim、attempt 和恢复的并发保护。
- 0024/0026/0028：历史树修复与 sibling unique guard；绝不可修改已发布 migration，应追加迁移。
- `c85a288`、`c19c146`：StrictMode boot 去重和 nested `100vh` 修复。

需要在下一阶段修正的不是 Qwen 的数据模型，而是最后一公里：`getLockedTextbookContext` 只返回 title/subject/grade/volume/publisher/edition；`prepareControlledProblemAnalysis` 在模型完成后才由 `textbookHint` 选择教材。这样即使模型输出正确教材线索，也无法用具体节点 vocabulary 约束输出。另一个小但重要的绕路是 provider attempts 存为 `model_runs.provider_attempts_json` JSON，而不是结构化表；保留兼容读写，下一阶段新增结构化字段/表而非删除历史字段。

## 值得现在修的技术债

- P0：统一 AI error envelope、ModelRun final error code 和 UI ErrorState。
- P0：在 analysis 前 deterministic resolve subject/textbook；仅将 selected textbook 的可控知识上下文发送给模型。
- P0：明确 tags 为空的原因（无教材、无 active definitions、无候选、mapping failed），不要让完成态伪装成完整标注。
- P1：把 retry/fallback 的选择基于错误分类；避免对 401/400/schema 错误盲目切换 provider。
- P1：替换 UI primitives 外的 Unicode `×`、`✓`、`⌕` 与遗留 `primary-button`/`icon-button`。
- P2：修复 11 条 React Hook dependency lint warning；它们可能带来 toast/state 的陈旧闭包。

可等待：0027 Learning Loop/Today、图谱 edge 推理、全文 semantic retrieval、全 App 一次性 UI 重写、provider attempts 历史数据迁移。

## 推荐实施顺序与验收

1. AI error contract：每次 run 有 machine code、public message、retry/fallback semantics 和安全 debug detail；失败题可从 UI 看清类型并重试。
2. Subject/Textbook resolver：分析前按有效科目加载未归档教材；一个候选自动选，多候选只用 deterministic metadata/用户决策，不能猜测则 unresolved。
3. Constrained context：仅 selected textbook 的 active knowledge tag、别名、章节证据被压缩/分块进 prompt；输出 canonical id 或明确 candidate。
4. Controlled mapping/UI：原子写入 `ProblemTag`/difficulty；显示标签、待确认队列、无教材/未映射状态；保留用户锁定标签。
5. 用上述路径迁移的 UI 为首批 Design System consumers，并完成 E2E 和故障路径验证。

完成定义：同科目仅一教材时新题无需手选即可匹配；多教材时不会错误自动绑定；成功分析至少能解释每类标签是否 mapped/candidate/unmapped；401、429、timeout、invalid JSON、DB failure 在 ModelRun 和 UI 中可区分；现有教材/错题闭环、重启恢复和已确认标签不回归。
