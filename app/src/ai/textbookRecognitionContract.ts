import textbookRecognitionSchema from './textbookRecognition.schema.json'

export const TEXTBOOK_RECOGNITION_SCHEMA_VERSION = 'textbook-recognition-v1'
export const TEXTBOOK_RECOGNITION_PROMPT_VERSION = 'textbook-recognition-v1'
export const textbookRecognitionJSONSchema = textbookRecognitionSchema

export const textbookRecognitionAntigravityJSONSchema = {
  type: 'object',
  required: [
    'title', 'subject', 'grade', 'volume', 'publisher', 'edition',
    'overall_confidence', 'warnings',
  ],
  properties: {
    title: { type: 'object' },
    subject: { type: 'object' },
    grade: { type: 'object' },
    volume: { type: 'object' },
    publisher: { type: 'object' },
    edition: { type: 'object' },
    overall_confidence: { type: 'number' },
    warnings: { type: 'array', items: { type: 'string' } },
  },
} as const

export const TEXTBOOK_RECOGNITION_PROMPT = String.raw`
你是中文教材信息识别助手。根据文件名、OCR 文本和目录候选，识别教材基本信息。

规则：
1. 只返回符合 JSON Schema 的 JSON，不要 Markdown 或解释。
2. title、subject、grade、volume、publisher、edition 都必须返回 value、confidence、evidence。
3. 没有可靠依据时 value 必须为 null，confidence 不得高于 0.45；不得编造出版社、版本或册别。
4. subject 使用用户可读名称，例如“数学”“物理”“化学”“英语”。
5. evidence 必须引用输入中的短文本、目录标题或文件名；不能引用时返回空字符串。
6. overall_confidence 表示整本教材信息的可信度，warnings 写入冲突、缺失或 OCR 风险。
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
