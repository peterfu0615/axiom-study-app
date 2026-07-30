# Axiom Basic AI 与错题详情体验优化交付报告

## 交付范围

本轮在现有架构内完成 LaTeX/Markdown 统一渲染、小问结构化、阅读字体层级、短标题规则、AI 处理中视觉反馈、题目图形自动识别与抠图、Antigravity CLI Provider，以及 Prompt/Schema/非法 JSON 处理。页面矫正、题目切分与手动调整流程未改动。

## 修改文件列表

### 新增

- `src/domain/mathMarkdown.ts`
- `src/domain/mathMarkdown.test.ts`
- `src/ai/problemAnalysis.schema.json`
- `src/ai/generated/problemAnalysisValidator.js`
- `src/ai/generated/problemAnalysisValidator.d.ts`
- `scripts/generate-problem-analysis-validator.mjs`
- `src-tauri/migrations/0008_ai_sub_questions.sql`
- `src-tauri/migrations/0009_model_run_raw_output.sql`
- `src-tauri/migrations/0010_ai_diagram_extraction.sql`
- `src-tauri/migrations/0011_antigravity_cli_provider.sql`
- `docs/AI_PROMPT_V4.md`
- `docs/READING_TYPOGRAPHY.md`
- `docs/DIAGRAM_EXTRACTION.md`
- `docs/ANTIGRAVITY_PROVIDER.md`
- `docs/screenshots/problem-library-wide.jpeg`
- `docs/screenshots/antigravity-provider-settings.jpeg`
- `docs/screenshots/responsive-820x620.png`

### 修改

- `package.json`
- `package-lock.json`
- `src/index.css`
- `src/App.css`
- `src/components/Icon.tsx`
- `src/components/MathMarkdown.tsx`
- `src/components/MathMarkdown.test.tsx`
- `src/domain/models.ts`
- `src/domain/ai.ts`
- `src/domain/ai.test.ts`
- `src/ai/problemAnalysisContract.ts`
- `src/ai/problemAnalysisParser.ts`
- `src/ai/problemAnalysisParser.test.ts`
- `src/ai/provider.ts`
- `src/ai/provider.test.ts`
- `src/ai/pipeline.ts`
- `src/ai/pipeline.test.ts`
- `src/features/capture/DocumentEditor.tsx`
- `src/features/library/ProblemLibrary.tsx`
- `src/features/settings/AISettings.tsx`
- `src/platform/database.ts`
- `src/platform/native.ts`
- `src-tauri/src/ai.rs`
- `src-tauri/src/commands.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/tauri.conf.json`

### 删除或重命名

- `docs/AI_PROMPT_V3.md` 重命名为 `docs/AI_PROMPT_V4.md`。
- 无产品代码删除。

## AI Schema 变化

| 字段 | 旧版 | 新版 v4 | 旧记录处理 |
| --- | --- | --- | --- |
| `sub_questions` | 无 | `[{index, content}]`，允许 `[]/null` | 缺失时读取为 `[]`，保留原题干 |
| `diagram.kind` | 无 | `geometry/function/chart/table/other/null` | 缺失时领域层映射为 `unknown` |
| `diagram.bbox` | 有，约束较弱 | x/y/width/height 均为 0–1 | 继续读取旧 bbox |
| `model_runs.raw_output` | 无 | 始终保存模型原文 | 历史记录默认为空字符串 |
| `model_runs.repair_strategy` | 无 | 保存实际修复步骤 | 历史记录为 null |
| `problems.ai_diagram_image_path` | 无 | 独立抠图路径 | 历史记录为 null，UI 回退 bbox |
| `problems.ai_diagram_kind` | 无 | 图形分类 | 历史记录为 null/unknown |
| Provider `command_path` | 无 | Antigravity CLI 路径 | 历史 Provider 默认为空 |

迁移 8–11 均为顺序迁移；已在包含 1–9 历史迁移的真实本地数据库上验证升级成功。

## Prompt 变化

完整 diff 见 `docs/AI_PROMPT_V4.md`。核心变化：

- 只返回 JSON，不允许解释文字或代码围栏。
- 缺失信息返回 null，不允许臆造。
- 数学内容优先 LaTeX，行内/块公式明确使用 `$...$`/`$$...$$`。
- 公共题干、选项、小问分别进入独立字段，禁止重复。
- Title 改为“知识点-题型-核心考察内容”，建议不超过 16 字且不得摘抄题干。
- diagram 新增图形类型，bbox 明确为相对题目裁图的 0–1 坐标。

完整 Schema 由 Ajv standalone validator 校验。standalone 文件在构建期生成，避免生产 WebView 严格 CSP 下的动态代码执行。非法 JSON 依次尝试移除围栏、提取平衡对象、删除尾逗号和安全补全容器；失败则显示错误状态，原始输出仍保存在 model run。

## UI 变化

- 题干、选项和小问统一复用 `MathMarkdown`，渲染前统一调用公式规范化函数。
- 小问使用圆形序号，逐问独立渲染 LaTeX。
- 字体层级使用 SF/PingFang SC 明确回退，并按 Large Title、Title、Headline、Body、Subheadline、Caption 分层。
- AI pending/processing 改为图标与渐变扫描文字；正式内容和图形在处理中模糊，不再显示“新的 AI Task 已创建”。
- 图形区优先展示独立抠图；旧记录或抠图失败时回退为原题图 bbox。
- 窗口最小尺寸由 980×680 调整为 820×620，详情操作、图形与信息区域在断点下换行或单列。
- 用户 Title、题干、科目和知识点的手动编辑优先级未改变。

截图：

- `docs/screenshots/problem-library-wide.jpeg`
- `docs/screenshots/antigravity-provider-settings.jpeg`
- `docs/screenshots/responsive-820x620.png`

## Provider 变化

新增 `AntigravityCLIProvider`，继续实现既有 `AIProvider` 接口：

```ts
analyzeProblemImage(input: AIProblemInput): Promise<AIProviderResult>
```

新增原生命令：

```text
analyze_problem_with_antigravity_cli
```

调用不经过 shell，支持 CLI 路径、模型名称、100 秒 CLI timeout、120 秒宿主 timeout、JSON 传输封套、图片目录授权和 `@绝对图片路径`。设置页新增 `OpenAI Compatible / Gemini (Antigravity CLI)` 选择。

## 测试结果

| 类别 | 结果 | 覆盖 |
| --- | --- | --- |
| LaTeX 规范化 | 通过 | 正常公式、缺 `$`、嵌套分式、中文夹公式、纯中文、A/B 分式选项 |
| 数学渲染 | 通过 | 分式、根号、上下标、角、三角形、垂直、平行 |
| 题型结构 | 通过 | 单问、多小问、选择题、几何/函数图形字段 |
| JSON 异常 | 通过 | 围栏、解释文字、尾逗号、括号截断、Schema 违反 |
| AI 异常 | 通过 | 文本模型误用于视觉、Provider 失败、无可用 VLM |
| 图形抠图 | 通过 | bbox 规范化、独立文件命名、旧文件替换、失败回退 |
| Provider | 通过 | OpenAI-compatible、Mock、Antigravity 路由和 fallback |
| Antigravity 实机 | 通过 | 本机 `agy`、Gemini 模型、`@图片路径`、JSON 封套、图形 enum |
| 数据迁移 | 通过 | 真实旧库迁移 1–11，旧错题可读 |
| 生产 bundle | 通过 | 严格 CSP 下启动，无 Ajv 运行时编译白屏 |
| 820×620 响应式 | 通过 | `scrollWidth=820`，无横向溢出，采集区切为单列 |
| 前端自动化 | 通过 | 9 个测试文件，51/51 |
| Rust 自动化 | 通过 | 8/8 |
| Lint / TypeScript / Vite | 通过 | `npm run check` |
| macOS debug bundle | 通过 | `.app` 与 `.dmg` 生成 |

## 当前限制

- Schema 目前只支持一个 `diagram` bbox；一道题存在多个相离图形时，模型需返回覆盖它们的联合区域，尚未支持 `diagrams[]`。
- 历史错题不会自动批量生成独立图形文件；打开时继续使用原图 bbox，重新整理后才生成独立抠图。
- Antigravity CLI 的完整 nullable Schema 与当前 `--json-schema` 不兼容，因此 CLI 先使用兼容子集，应用层再执行完整 Ajv 校验。
- Antigravity Provider 依赖本机已安装、已登录且可访问所配模型的 `agy`。
- AI 即使遵守容器 Schema，仍可能误识别题目语义或 bbox；用户手动重新裁剪和编辑仍是最终纠错路径。
- Vite 仍报告主 chunk 超过 500 kB 的性能警告；本轮遵守“不大规模重构”，未做路由级拆包。
- 当前阶段 API Key 仍按既有产品设计明文保存在本机 SQLite，本轮未改造密钥存储。
