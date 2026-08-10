import textbookRecognitionSchema from './textbookRecognition.schema.json'

export const TEXTBOOK_RECOGNITION_SCHEMA_VERSION = 'textbook-recognition-v3-review-state'
export const TEXTBOOK_RECOGNITION_PROMPT_VERSION = 'textbook-recognition-v3-review-state'
export const textbookRecognitionJSONSchema = textbookRecognitionSchema

const textbookChapterSchema = {
  type: 'object',
  required: ['title', 'page_start', 'page_end', 'knowledge_points'],
  properties: {
    title: { type: 'string', minLength: 1 },
    page_start: { type: ['integer', 'null'], minimum: 1 },
    page_end: { type: ['integer', 'null'], minimum: 1 },
    knowledge_points: {
      type: 'array', maxItems: 180, items: {
        type: 'object', required: ['name', 'page_numbers', 'evidence'], properties: {
          name: { type: 'string', minLength: 1 },
          page_numbers: { type: 'array', items: { type: 'integer', minimum: 1 } },
          evidence: { type: 'string' },
          chapter_name: { type: ['string', 'null'] },
        },
      },
    },
  },
} as const

export const textbookRecognitionAntigravityJSONSchema = {
  type: 'object',
  required: [
    'title', 'subject', 'grade', 'volume', 'publisher', 'edition',
    'chapters', 'warnings',
  ],
  properties: {
    // Keep the nested field contract explicit.  The previous schema only said
    // `type: object`, which let compatible providers legally return six empty
    // objects.  That response parsed as success and left the tag stage without
    // a subject.  Repeating the small field schema here is intentional: some
    // OpenAI-compatible gateways do not resolve `$ref` or `$defs` in a
    // response_format schema.
    title: {
      type: 'object', required: ['value', 'evidence'], properties: {
        value: { type: ['string', 'null'] }, evidence: { type: 'string' },
      },
    },
    subject: {
      type: 'object', required: ['value', 'evidence'], properties: {
        value: { type: ['string', 'null'] }, evidence: { type: 'string' },
      },
    },
    grade: {
      type: 'object', required: ['value', 'evidence'], properties: {
        value: { type: ['string', 'null'] }, evidence: { type: 'string' },
      },
    },
    volume: {
      type: 'object', required: ['value', 'evidence'], properties: {
        value: { type: ['string', 'null'] }, evidence: { type: 'string' },
      },
    },
    publisher: {
      type: 'object', required: ['value', 'evidence'], properties: {
        value: { type: ['string', 'null'] }, evidence: { type: 'string' },
      },
    },
    edition: {
      type: 'object', required: ['value', 'evidence'], properties: {
        value: { type: ['string', 'null'] }, evidence: { type: 'string' },
      },
    },
    chapters: { type: 'array', maxItems: 120, items: textbookChapterSchema },
    warnings: { type: 'array', items: { type: 'string' } },
  },
} as const

export const TEXTBOOK_RECOGNITION_PROMPT = String.raw`
你是中文教材信息识别助手。根据文件名、OCR 文本和目录候选，识别教材基本信息。

规则：
1. 只返回符合 JSON Schema 的 JSON，不要 Markdown 或解释。
2. title、subject、grade、volume、publisher、edition 都必须返回 value、evidence。
3. 没有直接依据时 value 必须为 null；不得编造出版社、版本或册别。
4. subject 使用用户可读名称，例如“数学”“物理”“化学”“英语”。
5. evidence 必须引用输入中的短文本、目录标题或文件名；不能引用时返回空字符串。
6. warnings 写入冲突、缺失或 OCR 风险；不要输出概率或置信度字段。
7. chapters 必须使用“章节/单元 → knowledge_points”的嵌套结构。章节可以是章、单元或篇，但必须是教材顶层教学单元；不要输出 section、节或根级独立 knowledge 节点。
8. 每个 knowledge_points 项必须给出 name、page_numbers、evidence；无法可靠归属章节的项目放入唯一标题为“待归类知识点”的章节。
9. page_start/page_end 不确定时返回 null，不要用 0 或猜测页码。
`.trim()

export function buildTextbookRecognitionPrompt(input: {
  sourceName: string
  pageCount: number
  outline: Array<{ title: string; level: number; pageNumber: number; evidenceText: string }>
  pages: Array<{ pageNumber: number; evidenceText: string }>
}) {
  const evidence = {
    source_name: input.sourceName,
    page_count: input.pageCount,
    outline: input.outline.slice(0, 80),
    page_excerpts: input.pages
      .filter((page) => page.evidenceText.trim())
      .slice(0, 12)
      .map((page) => ({
        page_number: page.pageNumber,
        text: page.evidenceText.slice(0, 1600),
      })),
  }
  return `${TEXTBOOK_RECOGNITION_PROMPT}\n\n<textbook_evidence>\n${JSON.stringify(evidence)}\n</textbook_evidence>`
}
