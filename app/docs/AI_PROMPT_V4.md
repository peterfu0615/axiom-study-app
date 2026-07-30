# AI Prompt v4 与结构化输出约定

## 版本

- Prompt：`problem-understanding-v4`
- Schema：`problem-analysis-v4`
- 代码来源：`src/ai/problemAnalysisContract.ts`

## 相对旧版的关键变化

```diff
- 只理解题目，不要解题，不要补造图片中不存在的信息。
+ 只返回一个符合 JSON Schema 的 JSON 对象，不要解释或代码围栏。
+ 图片中无法确认的字段返回 null，不使用“未知”等占位内容。

- stem_markdown 包含题目正文，choices 单独返回。
+ stem_markdown 只保存公共题干。
+ choices 与 sub_questions 分别使用独立数组，不得在题干中重复。

- 使用 Markdown 和标准 LaTeX。
+ 所有可表达的数学内容优先使用 LaTeX。
+ 行内公式强制 $...$，块公式强制 $$...$$。

- title 使用 18 到 50 个汉字的多段描述。
+ title 使用“知识点-题型-核心考察内容”，建议不超过 16 个中文字符，
+ 不得直接摘抄题干、题号或分数。

- diagram 只覆盖几何图、函数图或其他解题图形。
+ diagram 同时覆盖几何图、函数/坐标图、统计图、表格及其他解题图形。
+ bbox 明确使用当前题目裁图、左上角原点、0–1 归一化坐标。
+ diagram 新增 kind，限定 geometry/function/chart/table/other。
+ 没有图形时返回 {"exists":false,"kind":null,"bbox":null}。
```

## 校验与修复

模型原文首先保存到 `model_runs.raw_output`，结构化结果通过以下流程后才写入题目：

1. 移除完整 Markdown JSON 围栏；
2. 从解释文字中提取第一个平衡 JSON 对象；
3. 删除对象或数组末尾的多余逗号；
4. 仅在字符串完整且括号顺序有效时补齐被截断的 `}` / `]`；
5. 将旧版 camelCase 字段映射为 v4 snake_case，并用 null 或空数组补齐缺失顶层字段；
6. 使用 JSON Schema 校验类型、必填字段、额外字段和 bbox 范围；
7. 校验失败时将 Model Run 标记为失败，保留原图、人工编辑及模型原文。

`model_runs.repair_strategy` 记录实际采用的修复步骤。`output_json` 只保存通过校验并规范化后的结构化结果。Ajv validator 在构建期生成 standalone 模块，避免生产 WebView 在严格 CSP 下执行动态代码。

## 兼容策略

- 已有 v2/v3 `output_json` 不迁移、不覆盖，读取时继续经过兼容规范化函数。
- 旧错题没有 `sub_questions` 时按空数组处理并继续显示原始题干。
- 旧 diagram 没有 kind 时映射为 `unknown`，继续使用原 bbox 展示。
- v4 允许模型返回 null；进入领域模型时，字符串 null 降级为空字符串，数组 null 降级为空数组。
