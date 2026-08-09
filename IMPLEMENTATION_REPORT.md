# Axiom AI Reliability / Horizon Integration 实施报告

## 1. Baseline

本轮以 `main` 的 `79117e9 docs(audit): document current state and next phase` 为实施基线，并在动手前阅读了 `CURRENT_STATE_AND_NEXT_PHASE.md`、`AI_RELIABILITY_AND_HORIZON_INTEGRATION.md`、`UI_UX_AUDIT.md`、`DESIGN_SYSTEM.md` 与 `NEXT_IMPLEMENTATION_PLAN.md`。基线确认 Terra 报告的关键结论仍成立：错题分析与教材导入两条既有闭环都存在；`tag_definitions`、`tag_aliases`、`problem_tags`、`knowledge_nodes`、taxonomy version、Problem/Textbook match、ModelRun、受控映射和 relabel/review 基础设施都仍在当前调用路径中；教材解析主要发生在分析结果之后；旧 prompt 只有教材 metadata；失败最终主要落为自由字符串；现有 `ListboxSelect` 的 portal、键盘、typeahead 和焦点能力值得保留；Curriculum 仍是较成熟的视觉母体。

开始时工作区已有用户修改和未跟踪资料。本轮始终没有暂存或改写 `PRD.md`、`app/src/App.css`、`app/src/ai/solution.schema.json`、`.qa-shots/`、`icons/horizon-text-icon.png` 与 `test/` 下的教材 PDF。迁移最大编号原为 0029，历史迁移 0001–0029 未被修改。

## 2. Branch / commits

实施分支为 `codex/horizon-ai-reliability-integration`。未 push、未创建 tag、Release 或 PR。

| Commit | Phase / checkpoint | 目的 |
| --- | --- | --- |
| `ede1ff7` | Phase 1 | `feat(ai): add structured failure diagnostics` |
| `b6e1ed8` | Phase 2 | `feat(horizon): resolve textbook before analysis` |
| `6472f1f` | Phase 3 | `feat(ai): constrain analysis to textbook knowledge` |
| `deaeda5` | Phase 4 | `feat(horizon): persist controlled analysis outcomes` |
| `bb2ab8c` | Phase 5 | `feat(ui): apply design system to AI review path` |
| `061d451` | Phase 6 QA 返工 | `fix(ai): prevent inherited CLI output hang` |
| `fa5995a` | Phase 6 QA 返工 | `fix(curriculum): persist structured AI failures` |

## 3. Files changed

相对基线共修改 41 个文件，集中在五个边界：AI transport/orchestration、Horizon domain/persistence、contract/schema、UI primitives/ProblemTags、Rust migration/CLI transport。主要入口包括：

| 区域 | 主要文件 |
| --- | --- |
| Error contract | `app/src/domain/aiError.ts`, `app/src/ai/provider.ts`, `app/src/ai/pipeline.ts` |
| Run / attempt persistence | `app/src/platform/database.ts`, `app/src-tauri/src/ai.rs` |
| Textbook resolution | `app/src/domain/problemTextbook.ts`, `app/src/platform/horizonDatabase.ts` |
| Knowledge context | `app/src/domain/knowledgeContext.ts`, `app/src/ai/problemAnalysisContract.ts`, `app/src/ai/problemAnalysis.schema.json` |
| Controlled persistence | `app/src/domain/horizon.ts`, `app/src/platform/horizonDatabase.ts` |
| Review UI | `app/src/features/library/ProblemTags.tsx`, `app/src/features/library/ProblemTags.css` |
| Design foundation | `app/src/index.css`, `app/src/components/ui/ui.css`, `app/src/components/ui/index.tsx`, `app/src/components/ui/ListboxSelect.tsx`, `app/src/components/Icon.tsx` |
| Curriculum failure UI | `app/src/features/curriculum/CurriculumImportFlow.tsx`, `app/src-tauri/src/horizon.rs` |

## 4. Database migrations

| Migration | 内容 | 兼容性 |
| --- | --- | --- |
| `0030_structured_ai_errors.sql` | 为 ModelRun 增加 machine-readable terminal error，并建立规范化 `provider_attempts` 存储 | 保留 `model_runs.error_message` 与 `provider_attempts_json`，旧记录继续读取 |
| `0031_textbook_resolution_audit.sql` | 保存 resolver version、candidate count 与 decision JSON | 对旧题为 nullable，不改变旧匹配字段 |
| `0032_curriculum_structured_errors.sql` | 为教材 import job/attempt 增加 `error_code`、`error_json` | 保留旧 `error_message`，旧字符串在读取时动态分类 |

新增的 migration integrity 测试覆盖 fresh install 1..=32、0027→0032、0031→0032、历史 error message 保留以及原有 0028/0029 integrity guards。真实应用数据库已在 debug App 启动时从 0031 升到 0032；可选的 `/tmp/axiom-verify.db` 副本测试因 fixture 不存在而跳过。发布过的 0001–0029 原文未改动。

## 5. AI Error architecture

统一 `AIErrorEnvelope` 包含 `code`、`title`、`userMessage`、`retryable`、`fallbackAllowed`、`providerId`、`model`、`httpStatus`、`runId`、`attemptId`、`detailSafe` 与 `occurredAt`。稳定 code 覆盖认证、网络、超时、限流、Provider、模型能力、无效请求、模型输出、schema、mapping、persistence 与 cancellation。

Rust transport 把 HTTP status、连接/超时和 CLI 失败转为稳定 code；Provider parser 把 malformed JSON 与 schema invalid 分离；mapping 与 completion transaction 的错误在 orchestration 层分别分类为 `MAPPING_ERROR` / `PERSISTENCE_ERROR`。UI 只消费 envelope，不直接解释 Provider 私有错误。日志与 UI 不保存 API key、authorization header 或完整敏感 payload；safe detail 经过长度限制和密钥形态脱敏。

`model_runs.error_code/error_json` 保存 terminal machine error；每次 Provider 调用写入独立 `provider_attempts` 行，同时继续维护历史 JSON 字段。教材 import 的 job 与 stage attempt 在 0032 后也持久化相同 envelope。旧字符串没有失效：读取时优先使用有效 `error_json`，否则对 `error_message` 做兼容分类。

## 6. Retry / fallback policy

错题分析对单个 Provider 最多调用两次（首次加一次有限 retry，当前 backoff 为 300ms），随后只在 `fallbackAllowed` 时进入下一个已启用视觉 Provider。401/403、request-invalid、schema-contract、mapping、persistence 与 cancellation 不会被无脑换 Provider 掩盖；429、network、timeout 与 Provider unavailable/5xx 可有限 retry/fallback。用户取消是 terminal，不自动 retry。每次成功或失败调用都形成可审计 attempt。

教材阶段保留原有“安全阶段重试”模型：新的 stage attempt supersede 旧 active attempt，late result 不能赢；错误现在结构化。教材 pipeline 本轮没有改造成跨 Provider 自动 fallback，避免扩大到 Horizon import orchestration 重写；实际 CLI 失败因此在 UI 停在可恢复状态，由用户明确重试。

## 7. Textbook Resolution architecture

分析 worker claim ModelRun 后、调用 Provider 前执行：

`Problem → effective subject → eligible same-subject textbooks → deterministic resolver → selected textbook / unresolved`。

effective subject 沿用 `user_subject → ai_subject → subject`。候选只接受同科目、未归档且 extraction status 为 `completed` 或 `needs_review` 的教材。用户 lock 最高优先；单一候选使用 `single_subject_textbook`；多教材使用 grade、volume、publisher、edition、title 与题目 metadata 的确定性评分；没有明显赢家时返回 unresolved。跨科目手动选择由服务层查询和数据库约束拒绝。每次决策保存 resolver version、candidate count、selected id、source/reason、confidence 和安全 evidence detail。

无教材或多教材不明确时分析仍可继续，但 prompt 不获得伪教材 context，mapping 不会制造教材 canonical knowledge ID，Problem Detail 明确显示“未匹配”并提供统一 Picker。

## 8. Knowledge Context retrieval

`ResolvedTextbookContext` 包含教材 identity、subject、taxonomy version、候选 canonical tag ID/name/aliases、KnowledgeNode ID、chapter/hierarchy path 与 evidence。检索 SQL 从 selected textbook 的 active KnowledgeNode 与 active knowledge TagDefinition 出发，不读取其他教材或科目。

候选先做 NFKC/大小写/标点归一化，再对 canonical name、alias、章节与题干/OCR 文本做 deterministic lexical ranking；结果稳定排序。硬上限为 30 个候选、序列化 context 12,000 characters，同时记录 `totalKnowledgeCount`、`candidateLimit` 与 `contextCharacterCount`。真实 QA 教材有 85 个知识节点，传入模型的仍只有受限 top candidates，不会发送整本图谱。

## 9. Problem Analysis contract changes

Problem Analysis schema/contract 增加候选 ID 选择与 `unresolvedKnowledgeCandidates`，并把 `ResolvedTextbookContext` 作为可信 prompt context。模型可以输出 canonical ID、confidence 与 evidence，但 ID 仍视为不可信输入。旧 schema/run 解析继续工作，v3/历史输出没有被删除；generated validator 与 schema 同步更新。

模型返回不存在的 ID、跨科目 ID、跨教材 ID、inactive tag、taxonomy/KnowledgeNode 关系不成立时不会直接写 canonical relation。未知知识保留为 unresolved ProblemTag 进入审核，不伪造 canonical ID。

## 10. Tag mapping / persistence

复用 `prepareControlledProblemAnalysis` 与 `writeControlledProblemAnalysis`。prepare 在事务前读取题目、教材与 definitions；write 仍由 `completeProblemAIModelRun` 的同一 transaction 驱动。因此 ModelRun completion、受控 tag、difficulty 与 active run 更新要么同时成功，要么整体 rollback。

普通 re-analysis 只 supersede 未锁定、未 user-verified 的旧 model tags。locked / confirmed / manual tags 保留；difficulty 也遵守 locked/user-verified guard。知识点只映射 selected textbook 下有效 KnowledgeNode-backed definition；method/model/error 继续沿用共享 Tag infrastructure 的既有 domain semantics。mapping 失败时 run 不会 completed，persistence 失败也不会产生部分成功状态。

审核状态现在能区分 mapped、needs review、unresolved、no textbook、no active definitions、no candidate 与 mapping failure，并解释“AI 完成但没有标签”的原因。

## 11. UI / Design System changes

新增/收敛 color、typography、spacing、radius、border、shadow、motion 与 control-size tokens；新路径消费 PageTitle 22/30/650、SectionTitle 16/24/650、ItemTitle 14/20/600、Body 13/20/400、Secondary 12/18/400、38px medium control、16px icon 以及 6/9/14/pill radius 体系。

保留原 `ListboxSelect` 的 portal、keyboard、typeahead 与 focus 实现，只把 Unicode chevron/check 替换为 `Icon.tsx` 图标并统一开合 motion。新增共享 `ErrorState`，支持 title、短说明、按策略显示 Retry、secondary action 与可展开 safe technical detail。ProblemTags 改为 Badge/Status/Row 语义；Textbook Picker 复用 Listbox；Status Capsule 使用 intrinsic width 与 `flex: 0 0 auto`。本轮页面的 Card 层级收敛为 page/section/card/row，没有重写 Curriculum 或滥用 FlowingTaskSurface。

## 12. Compatibility decisions

没有删除历史 `error_message`、`provider_attempts_json`、旧 Problem Analysis schema 或旧教材匹配字段。没有修改 0001–0029。现有 subject precedence、Problem/Textbook consistency constraints、relabel claim/recovery、StrictMode boot guard、nested viewport fix、Curriculum UI 和 FlowingTaskSurface 都被保留。报告与 HEAD 的主要差异是当前项目已到 v0.4.8 且迁移基线为 0029；实施按 HEAD 处理。

## 13. Automated test results

最终门禁：

| Check | 结果 |
| --- | --- |
| `npm run lint` | PASS；0 errors，11 个确认是既有的 hook/Fast Refresh/parser warnings |
| `npm run typecheck` | PASS |
| `npm test -- --run` | PASS；42 files / 346 tests |
| `npm run build` | PASS；仅既有 dynamic import 与 >500k chunk warnings |
| `cargo fmt --all -- --check` | PASS |
| `cargo clippy --all-targets -- -D warnings` | PASS |
| `cargo test --lib` | PASS；49 tests |
| Debug `.app` bundle | PASS；`npm run tauri -- build --debug --bundles app` |

Fixtures/mocks 覆盖 401、403、429、5xx、network、connect/read timeout、malformed JSON、schema invalid、mapping、SQLite persistence、cancel、fallback lineage、restart recovery、fresh/upgrade migration、canonical/alias/unknown/hallucinated/cross-textbook mapping、locked/confirmed/rejected/re-analysis semantics。

## 14. Computer Use scenarios actually tested

真实运行的是当前 workspace 的 debug bundle `/Users/Peter/Coding/Axiom/app/src-tauri/target/debug/bundle/macos/Axiom.app`，不是 `/Applications` 中可能落后的安装版。

1. 打开采集工作台与既有 source document，进入“矫正与切题”，确认已保存题块恢复、图像、工具栏、disabled state 和 scroll ownership。
2. 打开错题库，选择真实错题并执行“重新整理”。分析前保留用户锁定数学教材；Provider 完成真实分析；UI 展示 3 个教材 canonical knowledge tags、3 个 method tags、2 个 unresolved model candidates 和中档 difficulty。
3. 在数据库核对同一 run 的 completed 状态、ProviderAttempt lineage、resolver decision 与所有 mapped knowledge tag 的同一 textbook ID。
4. 在真实 processing 中强制重启 App。恢复逻辑复用原 ModelRun，未创建重复 run，随后成功完成。
5. 打开已有 schema-invalid 错题，确认 ErrorState 显示明确 schema 文案且按策略不显示无效 retry；展开 safe technical details。
6. 导入用户提供的 210 页教材 PDF，完成本地 PDF text extraction 与 outline preview，并启动结构识别。外部 CLI 返回 Provider failure，UI 正确进入可恢复 ErrorState；重试产生新的 curriculum attempt 和持久化 `PROVIDER_ERROR` envelope。
7. 在课程中检查既有数学教材的知识结构（85 个节点）与审核状态，证明既有导入→结构入库闭环仍可读取。
8. 实测 Listbox 打开/关闭、方向键、Return、Escape 与 ASCII typeahead；中文 IME 注入受 Computer Use 限制，没有把工具注入失败当作组件失败。
9. 实测 dark、light，并恢复 Follow System；ErrorState、Picker、Status 与 tags 均无明显颜色/对比问题。
10. 用临时 QA-only 初始尺寸真实启动 820×620，检查采集页、错题双栏、教材 Picker、长标签、状态胶囊、文本换行、overflow 与内部滚动；随后恢复仓库的 1180×760 配置且未提交临时值。1180×760 与较大窗口也已操作检查。
11. 在 macOS System Settings 真实开启 Reduce Motion，检查 Axiom 仍可操作，再恢复用户原来的关闭状态。
12. QA 时间段应用日志没有新增 Rust ERROR/WARN；测试结束后关闭 QA App。

## 15. Bugs discovered during validation

1. Antigravity CLI 主进程会启动后台 updater；后台进程继承 stdout/stderr pipe。主 CLI 已退出或超时后，Rust 仍在 join pipe reader，ModelRun 因此可永久停在 processing。
2. 教材 import job/attempt 仍只保存字符串错误，课程页使用自定义失败卡，未消费 Phase 1 的 ErrorState。
3. `/Applications` 中的旧 Axiom 不认识 migration 0030+；若误用它做 QA，会出现 “unknown migration 30”。因此所有最终 QA 改用 workspace bundle。

## 16. Bugs fixed during validation

1. CLI capture 改为有界临时普通文件。普通文件读取当前 EOF 不依赖所有后代关闭继承 descriptor；仍保留 120 秒 timeout 与 2MB 上限，并新增真实 descendant-FD 回归测试。
2. 增加 0032，把 curriculum job/attempt 接入统一 error envelope；retry/complete 清除旧 structured error；旧行动态兼容；课程页改用共享 ErrorState。
3. 为 restart 增加“先 recover 再 claim”、attempt normalized storage 与 lineage 回归测试。真实中断 run 已成功恢复并完成。

## 17. Known remaining issues

| 状态 | 问题 |
| --- | --- |
| BLOCKED（外部） | 本次新导入教材的 Antigravity 结构识别返回无细节的 Provider failure；因此“新 PDF 本次完整 AI 识别→人工批准→入库”没有伪报成功。内部 stage/attempt/error/retry/recovery 路径均已由 fixture 与真实失败验证。 |
| Existing | lint 有 11 个本轮未新增的 legacy warnings。 |
| Existing | Vite 报一个静态/动态 import 重叠与主 chunk 超过 500k。 |
| Tool limitation | Computer Use 可验证 ASCII typeahead；中文 IME 自动注入不稳定，但中文选项可用方向键选择，组件级测试覆盖 typeahead 算法。 |

## 18. Deferred work

按 scope 明确未做 Today Engine、学习调度、变式题、Learning Loop、图谱推理、全文语义搜索、全 App UI 重写、Horizon 模型推倒重做或无关 legacy warning 清理。教材 pipeline 的跨 Provider 自动 fallback 也保留为后续专门工作；本轮仅保证它的安全 stage retry、attempt lineage 与结构化错误可诊断。

## 19. Final Acceptance Criteria status

| Acceptance Criterion | 状态 | 证据 / 说明 |
| --- | --- | --- |
| 当前两条旧闭环没有回归 | PASS | 346 frontend + 49 Rust tests；真实错题 re-analysis；既有教材 85 节点可读 |
| 同 subject 只有一本教材时自动匹配 | PASS | resolver unit/service tests；真实题绑定单一数学教材 |
| 多教材无法确定时不错误自动绑定 | PASS | deterministic resolver tests 返回 unresolved |
| 用户教材 lock 永远优先 | PASS | tests + 真实 re-analysis 前后 locked ID 不变 |
| knowledge context 只来自 selected textbook | PASS | scoped SQL、prompt tests、真实 mapped tag textbook ID 检查 |
| 模型返回/映射 canonical knowledge tags | PASS | v4 contract、parser/mapping tests、真实 3 个 canonical knowledge tags |
| hallucinated/cross-textbook ID 被拒绝 | PASS | server-side mapping tests |
| unknown tag 进入 unresolved/review | PASS | tests + 真实 2 个 unresolved model candidates |
| ProblemTag 原子持久化 | PASS | completion transaction rollback tests |
| locked/confirmed tag 不被 re-analysis 破坏 | PASS | supersede/locked/confirmed/rejected tests |
| AI failure 有 machine code | PASS | 0030/0032；真实 curriculum `PROVIDER_ERROR` |
| UI 区分主要错误类别 | PASS | ErrorState definitions + fixture tests + schema/provider 实际展示 |
| retry/fallback 按类别执行 | PASS | policy tests；non-fallback schema 实际展示 |
| ModelRun / ProviderAttempt 可审计 | PASS | normalized rows + JSON compatibility；真实 lineage 检查 |
| restart/resume 状态正确 | PASS | tests + 真实 processing restart recovery |
| ErrorState/Picker/Tag/Status 使用 primitives | PASS | 实现与 visual/interaction QA |
| Listbox 无 Unicode chevron/check | PASS | source + component test |
| 新代码无任意视觉值 | PASS | foundation token contract test |
| Card hierarchy 收敛 | PASS | ProblemTags/ErrorState/教材路径实际检查 |
| 820×620、普通、较大窗口无关键 overflow | PASS | 三档真实窗口检查，最小尺寸使用 QA-only bundle |
| keyboard/focus/listbox 正常 | PASS | component tests + Return/Down/Escape/typeahead 实操 |
| Light/Dark 无明显错误 | PASS | 两主题实操并恢复 Follow System |
| Reduce Motion 正常 | PASS | macOS 设置真实开启检查并恢复 |
| lint/typecheck/tests/build/Rust checks | PASS | 见第 13 节 |
| 真实 App 核心路径实际操作 | PASS | 采集入口、真实 re-analysis、受控标签、错误/recovery、教材 extraction 均已操作 |
| 新 PDF 完整 AI 识别→批准→入库 | BLOCKED | 外部 Antigravity 教材识别 Provider failure；没有伪造成功 |

除上表最后一项外，本轮代码与内部链路的 Acceptance Criteria 均通过。最后一项是明确的真实外部 Provider 阻塞，不是未实现的内部状态处理；其失败、重试、attempt lineage 和 UI 已按新契约完整记录。
