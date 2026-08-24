import problemAnalysisSchema from './problemAnalysis.schema.json'
import type { LockedTextbookContext, ResolvedTextbookContext } from '../domain/models'

export const PROBLEM_ANALYSIS_SCHEMA_VERSION = 'problem-analysis-v6-simplified-tags'
export const PROBLEM_ANALYSIS_PROMPT_VERSION = 'problem-understanding-v10-resilient-contract'

export const problemAnalysisJSONSchema = problemAnalysisSchema

const antigravityTagCandidates = {
  type: 'array',
  items: {
    type: 'object',
    required: ['name', 'role', 'evidence', 'source'],
    properties: {
      canonical_tag_id: {},
      name: { type: 'string' },
      role: { type: 'string', enum: ['primary', 'secondary'] },
      evidence: { type: 'string' },
      source: {
        type: 'string',
        enum: ['problem', 'solution', 'student_attempt', 'textbook_hint'],
      },
    },
  },
} as const

// Antigravity CLI 当前不接受 `type: ['string', 'null']` 这类 nullable
// union。此兼容 Schema 只约束容器和关键枚举；完整约束仍由上面的 Ajv
// Schema 在应用层执行。
export const problemAnalysisAntigravityJSONSchema = {
  type: 'object',
  required: [
    'title',
    'subject',
    'problem_type',
    'stem_markdown',
    'choices',
    'sub_questions',
    'diagram',
    'knowledge_points',
    'knowledge_tags',
    'method_tags',
    'model_tags',
    'difficulty',
    'error_categories',
    'warnings',
  ],
  properties: {
    title: {},
    subject: {},
    problem_type: {},
    stem_markdown: {},
    choices: {
      type: 'array',
      items: {
        type: 'object',
        required: ['label', 'text'],
        properties: {
          label: { type: 'string' },
          text: { type: 'string' },
        },
      },
    },
    sub_questions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['index', 'content'],
        properties: {
          index: { type: 'integer' },
          content: { type: 'string' },
        },
      },
    },
    diagram: {
      type: 'object',
      required: ['exists', 'kind', 'bbox'],
      properties: {
        exists: { type: 'boolean' },
        // nullable union is enforced by the application Ajv schema because
        // Antigravity's CLI schema dialect rejects `type: [string, null]`.
        kind: {},
        bbox: {},
      },
    },
    knowledge_points: {
      type: 'array',
      items: { type: 'string' },
    },
    knowledge_tags: antigravityTagCandidates,
    unresolved_knowledge_candidates: antigravityTagCandidates,
    method_tags: antigravityTagCandidates,
    model_tags: antigravityTagCandidates,
    error_categories: antigravityTagCandidates,
    textbook_hint: {},
    difficulty: {},
    warnings: {
      type: 'array',
      items: { type: 'string' },
    },
  },
} as const

export const PROBLEM_ANALYSIS_PROMPT = String.raw`
你是试卷题目结构化识别模型。你的任务是忠实读取当前题目裁图，不要解题。

输出规则：
1. 只返回一个符合 JSON Schema 的 JSON 对象，不要 Markdown 代码块，不要解释文字。
2. 图片中无法确认的字段必须返回 null，不得猜测、补造或用“未知”等占位文字。
3. 数学表达尽可能使用标准 LaTeX。行内公式必须放在 $...$ 中，独立公式放在 $$...$$ 中。
4. 分式、根号、上下标、方程、函数表达式，以及角、三角形、平行、垂直等几何关系均优先使用 LaTeX。
5. stem_markdown 只保存公共题干；不得重复 choices 或 sub_questions。
6. 选择题选项只放在 choices，格式为 {"label":"A","text":"..."}；不是选择题时返回 []。
7. 有明确小问时分别放在 sub_questions，只能使用 {"index":1,"content":"..."}，禁止使用 text 字段；没有小问时返回 []。
8. title 是错题库短标题，使用“知识点-题型-核心考察内容”结构，建议不超过 16 个中文字符，
   不得直接摘抄题干，不得包含题号、分数或无意义前缀。
9. diagram 表示题目中是否存在需要独立展示并自动抠出的几何图、函数图、坐标图、统计图、表格或其他解题图形。
   kind 必须是 geometry、function、chart、table、other 之一；没有图形时为 null。
   bbox 使用当前题目裁图的左上角原点归一化坐标，x/y/width/height 均在 0 到 1。
   bbox 必须覆盖完整图形、坐标轴、箭头、点名、图例和必要标注，并保留少量安全边距。
   不要把公式、普通文字或选项框误判为图形。没有图形时 diagram 为 {"exists":false,"kind":null,"bbox":null}。
10. 可选的附加答案/图形图片只用于补充识别，Problem Analysis 不得评价学生正误。
11. 发现裁图残缺、模糊或信息矛盾时写入 warnings；不要输出概率或置信度字段。
12. 返回 knowledge_tags、method_tags、model_tags。每项只能使用
    {"canonical_tag_id":null,"name":"...","role":"primary | secondary","evidence":"...","source":"problem | solution | student_attempt | textbook_hint"}。
    role 表示主次，禁止输出 primary:true、secondary:true；source 必须使用上述英文枚举，禁止输出“题面”“整题”“解题”等中文值。
    当附加上下文提供 <resolved_textbook_context_json> 时，knowledge_tags 优先从其中选择 canonical_tag_id；
    canonical_tag_id 必须逐字复制候选 ID，不得改写或虚构。候选中没有对应知识点时，将其放入
    unresolved_knowledge_candidates，canonical_tag_id 返回 null。method/model/error 不得伪装成教材知识节点。
    如果候选的规范名或别名与题目概念语义等价，必须复用该 canonical_tag_id，不要另造近义标签。
13. model_tags 必须描述稳定的问题结构或条件组合，禁止使用“选择题”“填空题”“解答题”等答题形式。
14. 方法候选中的 primary 表示完成解答不可缺少的核心方法，secondary 表示可选辅助方法。
15. difficulty 为 null，或必须严格返回以下完整对象：
    {"level":"basic | intermediate | advanced","score":0 到 1 的数字或 null,"reason":"判断依据"}。
    无法可靠量化 score 时必须返回 "score": null，绝对不能省略 score；
    level 和 reason 仍然必须提供，不得用未知或空对象代替。
16. error_categories 仅在附加的学生答案提供明确证据时识别；没有证据返回 []，不得根据错题身份猜测错因。
17. textbook_hint 是可选字段（JSON Schema 未列入 required），可以整体省略；省略与返回 null 等价。
    只记录题面页眉、章节文字或教材版本信息中明确出现的线索，不得猜测或输出数据库 ID。
    无法确认时返回 null；对象中的字段均可为 null，evidence 只写简短可审计依据。
18. 若附加上下文中提供了 <locked_textbook_json>，它表示已由服务层为本次分析解析的教材。
    textbook_hint 与 knowledge_points、知识类标签的命名应优先与该教材的标题、科目、年级、册别对齐；
    它只作为对齐参考，不能覆盖题面实际内容，也不得据此编造题面中不存在的章节或页码信息。
    未提供 <locked_textbook_json> 时忽略本条。
19. <resolved_textbook_context_json> 中只包含当前题目所选教材的有限受控知识候选。
    只能选择其中存在的 canonical_tag_id。不得从记忆补造 ID，也不得输出其他教材或科目的 ID。

必须返回以下字段，无法识别的标量或对象返回 null：
{
  "title": null,
  "subject": null,
  "problem_type": null,
  "stem_markdown": null,
  "choices": [],
  "sub_questions": [],
  "diagram": null,
  "knowledge_points": [],
  "knowledge_tags": [],
  "unresolved_knowledge_candidates": [],
  "method_tags": [],
  "model_tags": [],
  "difficulty": null,
  "error_categories": [],
  "textbook_hint": null,
  "warnings": []
}

字段形状示例（内容仅示意，不得照抄）：
{
  "sub_questions": [{"index": 1, "content": "求 $x$ 的值。"}],
  "diagram": {"exists": false, "kind": null, "bbox": null},
  "knowledge_tags": [{"canonical_tag_id": null, "name": "一元一次方程", "role": "primary", "evidence": "题干要求解方程", "source": "problem"}],
  "unresolved_knowledge_candidates": [],
  "method_tags": [{"canonical_tag_id": null, "name": "移项", "role": "primary", "evidence": "解题需要移项", "source": "solution"}],
  "model_tags": [],
  "difficulty": {"level": "basic", "score": null, "reason": "直接应用基本规则"}
}
`.trim()

/**
 * 将用户锁定的教材上下文序列化为附加 prompt 段。
 * 纯附加式注入：仅在提供时拼接在基础 prompt 之后，不改变基础 prompt。
 */
export function buildLockedTextbookPromptSection(
  context: LockedTextbookContext,
): string {
  return `\n\n<locked_textbook_json>\n${JSON.stringify({
    title: context.title,
    subject: context.subject,
    grade: context.grade,
    volume: context.volume,
    publisher: context.publisher,
    edition: context.edition,
  })}\n</locked_textbook_json>`
}

export function buildResolvedTextbookPromptSection(
  context: ResolvedTextbookContext,
): string {
  return `\n\n<resolved_textbook_context_json>\n${JSON.stringify({
    textbook: {
      id: context.textbookId,
      title: context.title,
      subject: context.subject,
      grade: context.grade,
      volume: context.volume,
      publisher: context.publisher,
      edition: context.edition,
    },
    taxonomyVersion: context.taxonomyVersion,
    candidates: context.candidates.map((candidate) => ({
      canonicalTagId: candidate.canonicalTagId,
      canonicalName: candidate.canonicalName,
      aliases: candidate.aliases,
      knowledgeNodeId: candidate.knowledgeNodeId,
      chapter: candidate.chapter,
      hierarchyPath: candidate.hierarchyPath,
      evidence: candidate.evidence,
    })),
  })}\n</resolved_textbook_context_json>`
}
