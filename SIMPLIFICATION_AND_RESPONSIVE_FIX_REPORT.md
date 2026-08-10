# Axiom 产品概念简化与响应式修复报告

日期：2026-08-09

分支：`codex/simplify-tags-confidence-responsive-ui`

起点：`4991447 chore: sync generated release artifacts`（Axiom 0.4.9）

## 1. 基线与范围

实施前确认工作区存在用户未提交内容：`PRD.md`、`app/src/App.css`、`app/src/ai/solution.schema.json`、`.qa-shots/`、`icons/horizon-text-icon.png` 和测试 PDF。这些内容均未修改、丢弃或纳入本轮提交。当前最大 migration 为 `0032_curriculum_structured_errors.sql`；本轮不改变数据库物理结构，也未修改任何历史 migration。

代码核对和真实 App 复现确认了四个问题：active AI contract 仍输出 confidence；教材与错题 UI 仍显示百分比；legacy unresolved 标签要求用户执行 mapping；ProblemTags 的双列由 viewport media query 控制，实际 detail pane 已很窄时仍可能保持双列，且 tag/metadata 的 intrinsic width 会撑大 grid item；ErrorState 没有受控最大宽度及所属内容区居中 wrapper。

本轮保留了上一阶段的教材解析与确认闭环、Problem → subject → textbook resolution、bounded knowledge candidates、canonical ID 服务端校验、subject/textbook integrity、ProblemTag transaction、locked/confirmed protection、AIErrorEnvelope、ProviderAttempt、ModelRun、retry/fallback 和 recovery。没有回退 Horizon 数据模型。

## 2. Confidence 简化

### 2.1 从 active path 删除

- Problem Analysis contract 升级为 `problem-analysis-v6-simplified-tags`，prompt 升级为 `problem-understanding-v9-simplified-tags`。新 schema 不再声明或要求分析级、标签候选、难度或教材提示 confidence。
- Textbook Recognition contract 升级为 v3，新 schema、prompt、parser type 和 inference 不再产生 `confidence` 或 `overall_confidence`。
- Curriculum Analysis contract 升级为 v4，知识候选不再输出 confidence；候选是否进入审核由 canonical/unresolved 和数据完整性决定，不再由概率阈值决定。
- Student Attempt active contract 升级为 v2，步骤不再要求 confidence。
- domain model 删除 active `AITagCandidate`、`AIDifficulty`、`AITextbookHint`、`AIProblemAnalysis` 和 `StudentAttemptStep` confidence 字段。
- 教材导入、知识结构、知识节点详情、错题信息、ProblemTags 和 capture block UI 删除百分比、高/低置信度与 confidence metadata。
- 教材自动匹配不再接受基于 AI confidence 的阈值决策；确定性 metadata score 仅作为 resolver 内部排序信息，不暴露成“模型置信度”。

OCR 的 `TextLine` / `ProblemBlock` 原生测量 confidence 仍作为底层识别质量数据存在，但不进入本轮定义的用户产品心智模型，也不再显示在题目采集结果中。

### 2.2 历史兼容

旧 ModelRun JSON 仍可包含 confidence。新 parser 会在 v6/v3/v2 校验前忽略这些历史字段，因此旧记录可读，但不会重新进入业务决策或 UI。已有 SQLite confidence 列未进行高风险 table rebuild：遇到历史 NOT NULL 约束时，写入兼容性的 inert `0`/`NULL`，读取结果不再参与 active decision。此处保留的是存储兼容，不是伪造产品概率。

## 3. 标签模型简化

用户现在只需要理解标签名称、来源（AI 识别或手动添加）、必要的证据、已确认/待处理状态以及保留/移除操作。`核心/辅助`、confidence 百分比、`未映射`、`选择对应标签`、mapping dialog 和整块黄色 mapping card 已从 ProblemTags 删除。

AI unresolved label 以普通“待处理”标签显示。用户可以直接“保留”，`keepProblemTag` 会将该标签标记为 `user_verified` 和 locked，而不要求建立 A → B taxonomy 映射；也可以直接移除。重新分析仍遵守 locked/confirmed protection。

系统内部仍保留 `tag_definitions`、`tag_aliases`、canonical IDs、KnowledgeNode 关系、subject/textbook constraints 和服务端 canonical validation。prompt 明确要求模型先比较 constrained candidates 的规范名和别名，语义等价时复用既有 canonical 标签，不创造近义项。exact normalized match、alias match 和 canonical candidate selection 仍自动运行。确实无法可靠关联时允许独立/unresolved 标签存在，不阻塞分析，也不把 taxonomy maintenance 转嫁给用户。

Curriculum 的 ReviewCenter 不再提供 mapping 选择器；内部 historical mapped/unmapped 数据仍可读，但用户看到的是“已有标签”或“独立标签”。TagOverview 同样删除未映射统计和 alias/merge 维护操作。

## 4. ProblemTags 响应式修复

根因不是某两个中文字符串，而是 breakpoint 取决于外层 viewport、双列缺少组件宽度感知、部分 flex/grid child 保留 `min-width:auto`，以及 badge/metadata 的不可缩内容共同推高 intrinsic width。

修复规则如下：

- `.problem-tags` 成为 named inline-size container，并明确 `width: 100%`、`min-width: 0`、`max-width: 100%` 和 `box-sizing: border-box`。
- 双列固定为 `repeat(2, minmax(0, 1fr))`；当组件自身宽度不超过 640px 时通过 `@container problem-tags` 折叠为单列。640px 来自真实 1180px split-window 中约 530–600px detail pane 的复现，而不是任意 viewport breakpoint。
- tag row、heading、evidence、actions、section 和 textbook metadata 均允许缩小和换行；badge 使用 `max-width: 100%`、`white-space: normal` 和 `overflow-wrap: anywhere`，普通中文仍采用自然换行，没有全局粗暴 `break-all`。
- metadata 和 actions 使用正常 flex wrap，不使用 absolute positioning，也没有固定高度。
- textbook picker 在窄 container 中占满一行；按钮组自然下移。
- candidate/unresolved 不再使用大面积 warning background，普通数据采用 Row 层级。

真实数据验证包含“一次函数与坐标轴围成的三角形面积”“待定系数法求一次函数解析式”“一次函数的图象与性质”“一次函数与一元一次方程、不等式的关系”、多组 Knowledge/Method/Model tags 和长 evidence。源码契约测试额外锁定长标签、多项 tag、窄 container、metadata wrap 及无水平 overflow 所需的关键 CSS 规则。

## 5. ErrorState

共享 ErrorState 新增 token `--ax-state-panel-max: 640px`，使用 `width: min(100%, var(--ax-state-panel-max))`、`max-width: 100%` 和 `margin-inline: auto`。题目结果区增加 `.problem-ai-error-region` 居中 wrapper。组件整体居中，但标题、说明和技术信息继续左对齐；actions 可换行，technical detail code 限制为组件宽度并允许任意长安全错误信息换行。

实机展开 `SCHEMA_VALIDATION_ERROR` 技术信息后，面板宽度没有跳变，也没有横向溢出。Retry 是否显示仍完全由 structured error/retry state 控制。

## 6. 自动化验证

| 检查 | 结果 |
| --- | --- |
| `npm run lint` | PASS，0 error；11 条既有 warning，与实施前基线一致 |
| `npm run typecheck` | PASS |
| `npm test` | PASS，43 个文件、350 项测试 |
| `npm run build` | PASS，schema validators 重新生成、TypeScript 与 Vite production build 成功 |
| `cargo fmt --all -- --check` | PASS |
| `cargo clippy --all-targets -- -D warnings` | PASS |
| `cargo test --lib` | PASS，49 项测试 |
| migration integrity | PASS，fresh DB、v27 DB 和真实用户数据库副本均升级至 0032 |
| `git diff --check`（排除用户既有文件） | PASS |

新增 `simplificationContract.test.ts`，覆盖 active schemas 不再声明 confidence、历史 Problem Analysis confidence 被兼容剥离、ProblemTags 不暴露 mapping/confidence 文案、container responsive contract 和 ErrorState 居中/长文本 contract。既有 tests 同步覆盖 active decision 不再依赖 confidence、旧输出解析、canonical/alias mapping、独立标签保留、recovery 和 persistence 兼容。

构建仍报告既有 bundle size 和 mixed dynamic/static import 提示；它们不是本轮引入，也未扩大范围处理。

## 7. Computer Use / 真实 App QA

验证对象为当前 workspace 生成的 debug bundle：`app/src-tauri/target/debug/bundle/macos/Axiom.app`，不是 `/Applications` 中的历史版本。

实际执行：

- 在正常约 1180×760 窗口打开带多组 legacy unresolved 和手动标签的错题，确认 confidence、核心/辅助、未映射、mapping button 和黄色 mapping card 均消失。
- 滚动到完整 ProblemTags，确认 long tag、evidence、状态与 actions 形成稳定单列 Row，Knowledge/Method 不覆盖。
- 使用 macOS 窗口布局得到精确 820×620，检查 detail internal scroll ownership、长中文换行、metadata、actions、无水平滚动和无 Card 异常增宽。
- 通过窗口右下角 drag 从 820×620 连续放大至约 1180×760，再缩小，检查 container query 跨断点重排；没有出现中间宽度覆盖、竖排 metadata 或水平滚动。
- 打开一条真实 AI schema failure，检查居中 ErrorState；展开长技术详情并关闭，宽度和换行稳定。
- 打开/关闭 Textbook Picker 和 tag Listbox，验证 Escape；已有 Listbox 的 portal、focus 和 keyboard navigation 实现未改写。
- 切换深色主题，在 ProblemTags、Settings 和 Curriculum 页面检查 token、对比度和状态层级；随后恢复用户原“跟随系统”设置。浅色与深色均无明显视觉错误。
- 打开教材知识结构，确认 85 个节点目录、教材 metadata、待确认状态不显示 confidence。
- 打开审核确认的“解题方法”维度，真实查看“已有标签/独立标签”、证据与批准/驳回操作，不再出现 mapping 或 confidence。
- 打开手动添加 Dialog 和 Listbox，确认直接选择已有标签的产品模型、Escape/focus 行为。当前真实数据库在所测题目/维度没有可选 active definition，因此未提交一次临时 add/remove mutation；持久化、删除和 locked protection 由自动化数据库测试覆盖。没有为了勾选 QA 项而污染用户数据。
- 检查本次启动日志，未发现由本轮代码产生的 panic、Rust error、database error 或新的 console blocker。

## 8. Checkpoint commits

1. `7da91a9 refactor(horizon): simplify confidence and tag semantics`
2. `b3fe7c8 fix(ui): make problem tags container responsive`
3. `fix(ui): center AI error states and finish QA`（包含本报告；hash 见提交历史）

## 9. Acceptance status

| 条件 | 状态 | 说明 |
| --- | --- | --- |
| 核心 UI 不显示 confidence/百分比 | PASS | 教材、课程、错题、标签和信息页已删除 |
| 新 active AI contracts 不依赖 confidence | PASS | Problem v6、Textbook v3、Curriculum v4、Attempt v2 |
| 历史 confidence 数据兼容 | PASS | parser normalization + inert legacy storage |
| 用户不再理解 mapping | PASS | mapping UI/dialog/stat/actions 已删除 |
| canonical/alias/integrity 保留 | PASS | 内部模型、验证和事务未删除 |
| 无关联标签不阻塞 | PASS | 可作为独立待处理标签保留或移除 |
| 长标签、metadata、actions 响应式稳定 | PASS | container query + shrink/wrap rules + 实机 resize |
| ErrorState 居中且长文本可读 | PASS | shared max-width + feature state region |
| Light/Dark、Picker、Escape/focus | PASS | workspace bundle 实机验证 |
| 手动 add/remove 真实数据 mutation | BLOCKED | 所测真实数据库无可选 active definition；UI 到 Listbox 已验证，数据库自动测试通过，未污染用户数据 |
| 两条既有主闭环无代码回归 | PASS | 全量前后端测试、migration tests、教材与错题真实读取路径通过 |
| 真实 provider 新调用 | BLOCKED | 本轮无需发送外部 AI 请求；使用既有真实 ModelRun error 和 fixture/contracts 验证 |

## 10. Remaining issues

1. 当前用户数据库中部分课程标签仍处于待确认状态，所以特定错题的“添加”选择器可能没有 active option。这是数据审核状态，不是 mapping 简化或响应式回归。批准标签后即可直接选择。
2. 历史 SQLite confidence 列继续存在。物理删除需要重建高风险表且没有产品收益，明确延后；active code 不再读取它作决策。
3. OCR 原生测量 confidence 仍在底层类型中，供识别管线内部使用；若未来要彻底删除算法级指标，应作为独立 OCR contract migration 处理。
4. 前端 11 条既有 lint warning、主 bundle size warning 和 Tauri window import warning 未在本轮扩 scope 清理。
5. 本轮没有 migration、tag、push、GitHub Release 或发布构建。
