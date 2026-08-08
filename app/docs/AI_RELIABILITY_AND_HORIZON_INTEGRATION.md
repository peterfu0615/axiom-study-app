# AI 可靠性与 Horizon 集成审计

## 当前完整调用链

`ProblemLibrary` 的“重新整理”调用 `queueProblemAI`（`platform/database.ts`），在事务中创建 `model_runs(task_type=analyze_problem_image)` 并把 `problems.ai_status` 置 pending。`runProblemAIWorker`（`ai/pipeline.ts`）claim run、读取 problem regions、读取已锁定教材元数据、通过 `getVisionProvidersForRun` 轮询 provider。OpenAI-compatible provider 经 `platform/native.ts` 调用 Rust `analyze_problem_with_openai_compatible`；Rust 从 SQLite 读取 API key、读取图片、POST chat completions（connect 15s；非流 120s；流 300s）。响应返回前端后由 `parseProblemAnalysis` 做 JSON fence/尾逗号/截断修复和 AJV schema 验证。

成功时 worker 先保存 raw output/provider attempt，再调用 `completeProblemAIModelRun`：写 `model_runs.output_json/status`、`problems.ai_*`、diagram region，并在同一事务调用 `prepareControlledProblemAnalysis`/`writeControlledProblemAnalysis`。随后解答和 student attempt 独立排队。失败时每个 provider 的 raw output/error 被追加到 JSON attempts，全部失败后 `failProblemAIModelRun` 写 failed + 字符串 error。UI 用事件刷新并直接渲染该字符串。

## Failure matrix

| 节点 | 当前行为 | 缺陷 | 目标 code / 行动 |
| --- | --- | --- | --- |
| 配置/密钥 | Rust 返回中文字符串 | 无 `AUTHENTICATION` 语义 | `AUTH_INVALID`，停止，打开设置。 |
| DNS/连接/读超时 | reqwest 错误拼进 `AI API 请求失败` | 不可区分 timeout/network | `NETWORK`/`TIMEOUT`，有限自动 retry。 |
| HTTP 429/5xx | 返回 HTTP 文本 | 无 status/retry-after/fallback policy | `RATE_LIMIT`/`PROVIDER_UNAVAILABLE`，backoff 后 fallback。 |
| HTTP 4xx/vision unsupported | 仅识别部分 vision 文案 | 400 schema/context/auth 混同 | `MODEL_CAPABILITY`、`REQUEST_INVALID`、`AUTH_INVALID`。 |
| SSE/partial output | 有 2MB 上限，流无逐 chunk idle timeout | cancelled/partial 不可审计 | `STREAM_INTERRUPTED`；保存 partial。 |
| JSON/schema | parser 有不错 repair | UI 看不到 parse vs schema；错误是自由字符串 | `MODEL_OUTPUT_INVALID`/`SCHEMA_INVALID`；可换 provider 一次。 |
| mapping | transaction rollback 是正确的 | 无独立 code，用户误以为 AI failed | `TAG_MAPPING_FAILED`，不可换模型，保留 debug correlation。 |
| SQLite/锁/事务 | 多处 lock 和 rollback | 前端无法区分 persistence | `PERSISTENCE_FAILED`，短 retry，记录 DB operation。 |
| cancel/restart | restart 将 processing 改 pending | 没有用户 cancel for problem run；resume 语义不透明 | `CANCELLED` terminal；restart 有 attempt lineage。 |

## 最小侵入统一 Error Model

新增 TS/Rust 共用 JSON envelope，保留当前 `error_message` 兼容字段：`{code, title, userMessage, retryable, fallbackAllowed, providerId, model, httpStatus, runId, attemptId, detailSafe, occurredAt}`。敏感 response body/API key 不进入 `userMessage`、telemetry 或 raw UI；`detailSafe` 只存 endpoint host、HTTP status、parser path、SQLite error kind。

分类：`AUTHENTICATION_ERROR`、`NETWORK_ERROR`、`TIMEOUT_ERROR`、`RATE_LIMIT_ERROR`、`PROVIDER_ERROR`、`MODEL_CAPABILITY_ERROR`、`MODEL_OUTPUT_ERROR`、`SCHEMA_VALIDATION_ERROR`、`MAPPING_ERROR`、`PERSISTENCE_ERROR`、`CANCELLED`。每次 provider call 写一个 attempt（最终可仍镜像 JSON），ModelRun 写 terminal envelope；UI ErrorState 显示标题、短说明、可展开“技术信息”、Retry，且只在允许时显示“尝试其他 Provider”。401/403/400/schema 不 fallback；429/5xx/network/timeout 可以指数 backoff（例如 1s/3s，最多 2 次）再 fallback；用户 cancel 不 retry。

## Problem → Subject → Textbook 的现状与策略

有效科目优先级已固定为 `user_subject → ai_subject → subject`（`getProblemTextbookMatch`、`updateProblemUserFields`）。0023 保证教材同科目。`ProblemTextbookMatch` 支持 `single_subject_textbook`、`metadata_match`、`ai_hint`、`user`、legacy fallback、unresolved；`setProblemTextbookMatch` 能锁定用户选择。教材带 title/grade/volume/publisher/edition/source/status，并支持同科目多个教材。

但 resolver 的调用点在**分析结束**的 `prepareControlledProblemAnalysis`，且真正 prompt 只在原先已锁定时附加 metadata。目标应提前到 queue/claim 之间：

1. deterministic 得到有效 subject；没有则要求用户确认/允许模型分类但不绑定教材。
2. 查询同科目、未归档、`extraction_status=completed|needs_review` 的教材。
3. 一项：自动匹配、source=`single_subject_textbook`；多项：先保持 locked/user，再做 exact grade/volume/publisher/edition metadata score。不要以纯模型猜测覆盖用户选择。
4. 分数没有显著赢家：`unresolved`，分析仍可执行，但知识 tag context 为空且 UI 要求选择教材；不得写跨教材 knowledge tag。

## Tag 现状与目标架构

已有：0016 的 `tag_definitions`/`tag_aliases`/`problem_tags`/taxonomy version；`mapCandidatesToControlledTags` 限制 active、subject，knowledge 还限制 `matchedTextbookId`；`writeControlledProblemAnalysis` 原子 supersede 非锁定模型标签、插入 candidate、难度；ProblemTags 提供确认/拒绝/手动添加，ReviewCenter/TagOverview 提供审核。knowledge/method/model/error 使用同一 tag 表但知识标签与 KnowledgeNode 绑定，其他三类不必伪造为教材节点。

缺失：分析 contract 当前输出 name/evidence/confidence，不输出 canonical tag id；prompt 没有受限 candidates，因而 alias matching 只能事后精确 normalized-name 命中，语义近似不会匹配。不要重建 Horizon。新增 `ResolvedTextbookContext`：textbook identity、taxonomy version、有限 chapters、每项 `{tagId, canonicalName, aliases, nodeId, chapter, evidence}`。先用确定性 lexical/alias candidate retrieval（上限如 40）；超出时按题干/OCR top-K；prompt 要求知识标签只从 candidate IDs 中选择，否则填 `unresolvedCandidates`。服务端再次验证 subject/textbook/id，绝不信任模型 id。

## 阶段与验收

- Phase 1：错误 envelope、attempt schema、UI ErrorState 和测试矩阵。
- Phase 2：pre-analysis resolver、迁移（为 match 增加 resolver version/decision detail 或独立 audit table）和 picker unresolved state。
- Phase 3：knowledge context retrieval、schema vNext、canonical ID mapping；保留旧 schema parser 以阅读历史 ModelRun。
- Phase 4：ProblemTag/difficulty 结果与审核 UI；针对空标签给显性理由。
- Phase 5：mock/fixture E2E：single/multiple/unresolved textbook，alias match、unknown tag、locked tag、401/429/timeout/schema/DB fault/restart。
