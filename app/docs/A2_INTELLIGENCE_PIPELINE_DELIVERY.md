# Axiom A2.0 Intelligence Pipeline 交付报告

## 结果

本轮在原有 Basic AI、Solution Engine、手动裁剪和 Antigravity CLI 之上完成了以下链路：

`题目/作答/图形区域 → Problem Analysis → Solution → Student Attempt OCR → Reasoning Analysis → Explain Selection`

没有替换现有自动切题或图像增强算法。图形自动检测仍由 VLM 输出分类和归一化边界，并复用现有安全裁图命令。

## 修改文件

### 新增

- `src/ai/intelligenceContract.ts`
- `src/ai/intelligenceParser.ts`
- `src/ai/intelligencePipeline.ts`
- `src/domain/problemRegions.ts`
- `src/features/library/SolutionComparison.tsx`
- `src-tauri/migrations/0013_intelligence_pipeline.sql`
- `src-tauri/migrations/0014_model_run_provider_attempts.sql`
- `src/ai/intelligenceContract.test.ts`
- `src/ai/intelligenceParser.test.ts`
- `src/features/library/ProblemCropEditor.test.ts`
- `src/features/library/SolutionComparison.test.tsx`

### 修改

- `src/domain/models.ts`
- `src/ai/provider.ts`
- `src/ai/provider.test.ts`
- `src/ai/pipeline.ts`
- `src/ai/pipeline.test.ts`
- `src/ai/problemAnalysisContract.ts`
- `src/ai/problemAnalysisParser.ts`
- `src/ai/problemAnalysisParser.test.ts`
- `src/ai/solutionPipeline.ts`
- `src/platform/database.ts`
- `src/platform/native.ts`
- `src/App.tsx`
- `src/App.css`
- `src/components/CropSelectionCanvas.tsx`
- `src/features/capture/DocumentEditor.tsx`
- `src/features/library/ProblemCropEditor.tsx`
- `src/features/library/ProblemLibrary.tsx`
- `src-tauri/src/ai.rs`
- `src-tauri/src/lib.rs`

### 删除

- 无。

## 数据模型与迁移

| 原状态 | 新状态 |
| --- | --- |
| 题目只有 `problems.crop_*` 主裁图 | 新增 `problem_regions`，支持 `question / answer / diagram / annotation` |
| 没有独立学生解答 OCR 结果 | 新增 `student_attempts`，保存原始 Markdown、步骤、置信度、区域关联和状态 |
| 没有学生推理分析 | 新增 `reasoning_analyses`，保存步骤评价、首错、错误类型、知识缺口和建议 |
| `model_runs` 主要记录 Basic/Solution | 新增 `extract_student_attempt / analyze_student_reasoning / explain_selection` 任务类型 |
| fallback 只保留最后一次输出 | 新增 `provider_attempts_json`，保留最近 12 次 Provider 尝试的模型、修复策略、错误和限长原文 |

迁移 0013 会从旧 `problems.crop_*` 回填主 `question` 区域。旧字段、`problems.solution_json` 和旧 `user_attempts` 均保留。历史错题不会批量创建新任务。

## Provider 设计

Provider 抽象新增或保留以下能力：

```ts
analyzeProblem(input)
extractStudentAttempt(input)
analyzeStudentReasoning(input)
explainSelection(input)
generateSolution(input)
```

`analyzeProblemImage` 继续作为兼容入口。新 Intelligence 能力第一阶段由 `AntigravityCLIProvider` 实现，模型名称继续读取 Provider 配置，不在业务层写死 Gemini 型号。

Antigravity 原生执行器现在：

- 在 Tauri 阻塞线程池执行，120 秒超时；
- stdout/stderr 流式读取，任一超过 2 MB 会终止子进程；
- 保持多图输入顺序并去重；
- 最多 8 张、合计最多 60 MB、单张最多 30 MB；
- 只允许 Axiom `media` 目录内的 JPG/PNG/WebP，并校验文件魔数；
- CLI 缺失、退出失败、超时、输出超限和非法 Schema 均形成明确错误。

## Prompt / Schema 变化

### Problem Analysis

旧版只描述单张题目裁图。`problem-analysis-v2` 增加：

```diff
+ question / answer / diagram 多区域输入职责
+ geometry / function / chart / table / other 图形分类
+ bbox 必须使用主题目裁图的 0–1 坐标
+ 附加作答图只补充识别，不进行学生正误判断
+ 选项和小问保持独立字段
```

解析器对 bbox 做兼容修复：

- 合法 `[x,y,width,height]` 转为对象；
- 非对象、越界、缺字段或非法 tuple 转为 `null` 并追加 warning；
- 合法对象的额外键会被移除；
- bbox 异常不再使整道题直接失败。

### 新 Prompt

- `student-attempt-v1`：只做手写/打印答案 OCR，不判错，保留步骤顺序和置信度。
- `reasoning-analysis-v1`：允许不同正确解法，步骤状态限定为 `correct / wrong / missing_reason / unclear`。
- `explain-selection-v1`：解释用户冻结的选区，不默认扩展为批改。

所有 Prompt 只允许 JSON，无代码围栏；缺失字段使用 `null` 或 `[]`；数学表达使用 LaTeX Markdown。应用端继续执行严格 Ajv Schema；Antigravity 端使用不含 nullable union 的兼容 Schema，避免 CLI Schema 方言拒绝请求。

## Pipeline 与错误恢复

- Basic AI 成功后独立排队 Solution 和可用的 Student Attempt。
- Student Attempt 完成后排队 Reasoning；推理排队失败不会反向污染已完成 OCR。
- 题目或图形区域变化会重跑 Problem Analysis；仅作答区域变化只重跑 Student Attempt。
- 各 Pipeline 启动恢复并发进行，不会因单个 120 秒任务阻塞其他队列恢复。
- claim、complete、fail 和激活实体状态使用事务，并校验 active run，旧运行不能覆盖新结果。
- 启动恢复会协调 run/entity 的不一致状态；无法恢复的解释任务会明确标记失败。
- 每次 Provider fallback 尝试写入 `model_runs.provider_attempts_json`；最后一次完整原文仍保存到 `raw_output`。

## UI 变化

- 采集页和重新裁图页支持题目、蓝色作答、绿色图形区域；新增区域默认位于题目下半部，可独立移动、缩放、删除和保存。
- 错题详情使用紧凑 `SolutionComparisonPreview`，正确解法和我的解答左右排列、固定分割线、底部渐变截断。
- 点击预览打开固定居中且不可拖动的比较弹窗；两侧有独立滚动区域。
- 760px 以下自动改为上下堆叠，并继续保留两个独立滚动区。
- 完整弹窗展示步骤、关键方法、使用公式、知识点、步骤评价、错误类型和知识缺口。
- 正解句子 hover 显示黄色“向我解释”；题干、选项、小问、正解和用户解的原生文字选择均支持同一入口。
- 解释调用真实 Antigravity Provider；浮层支持拖动、关闭、加载、成功、完整错误和重试。
- 关闭或发起新请求会使旧请求结果失效，避免晚返回结果重新打开浮层或串题。

## 测试结果

| 范围 | 结果 |
| --- | --- |
| TypeScript / lint / production build | 通过 |
| Vitest | 15 个文件、74 个测试通过 |
| Rust format | 通过 |
| Rust tests | 9 个测试通过 |
| SQLite 全迁移烟测 | 通过；3 张新表和 `provider_attempts_json` 均存在 |
| 文档图像回归 | 通过；3 份 fixture 分别识别 3、3、10 个题块 |
| bbox tuple、非法值、额外键 | 通过 |
| LaTeX 分式、根号、上下标和几何符号 | 通过现有 MathMarkdown 测试 |
| 双栏 SSR 预览 | 通过 |
| 700×620 响应式实测 | 通过；弹窗与解释面板均未越界，两栏独立滚动 |
| Tauri Debug App / DMG | 通过 |

## 当前限制

- 本轮没有使用用户真实 Gemini 凭据发起计费/配额相关的端到端请求；已覆盖 Provider 参数、严格解析、原生执行器和错误路径，真实模型质量仍需用实际答案区域验收。
- OpenAI Compatible Provider 本轮仍只承担原有 Basic AI；Student Attempt、Reasoning 和 Explain 第一阶段仅由 Antigravity CLI 提供。
- `annotation` 已进入模型和数据库，但没有独立编辑入口。
- 关闭解释浮层会立即忽略旧结果，但已经启动的 CLI 进程仍继续完成并写入调试运行历史。
- Reasoning 允许 Solution 为 `null`；若它先于 Solution 完成，本轮不会因 Solution 后到而自动二次分析。
- Provider 尝试历史保留最近 12 次，每次原始输出最多 128 KB；最后一次输出另有 2 MB 的 `raw_output`。
- Vite 仍提示主 bundle 超过 500 KB；不影响功能，但后续可以按页面拆包。

## 下一阶段 Mistake Analysis 建议

使用 `StudentAttempt.steps[]` 和 `ReasoningAnalysis.stepEvaluations[]` 的步骤索引建立稳定定位；Tutor 的 `explainStep()` 可直接复用本轮 `ExplainSelectionInput`、Provider fallback、严格解析和浮层，仅将来源扩展为具体步骤。复习系统应优先消费 `firstWrongStep`、`errorType` 和 `knowledgeGaps`，不要根据正解与用户解文本差异直接判错。
