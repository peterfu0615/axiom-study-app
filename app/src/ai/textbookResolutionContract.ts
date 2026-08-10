export interface AutonomousTextbookCandidate {
  id: string
  title: string
  grade: string | null
  volume: string | null
  publisher: string | null
  edition: string | null
  chapterFingerprints: string[]
}

export interface AutonomousTextbookResolutionInput {
  subject: string
  problemText: string
  candidates: AutonomousTextbookCandidate[]
}

export const textbookResolutionJSONSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['selected_textbook_id'],
  properties: {
    selected_textbook_id: { type: 'string', minLength: 1 },
  },
} as const

export function buildAutonomousTextbookResolutionPrompt(
  input: AutonomousTextbookResolutionInput,
) {
  return `你是教材选择助手。根据题目和有限候选教材，选择最适合本题的一本教材。

规则：
1. 只能返回 candidates 中已有的 id，不得生成或改写 id。
2. 所有候选已经由服务端限制为同科目、未归档且提取状态可用。
3. 优先参考年级、册别、标题和章节主题；信息不足时选择内容主题最接近的一本。
4. 只返回符合 JSON Schema 的 JSON，不要解释。

<resolution_input_json>
${JSON.stringify(input)}
</resolution_input_json>`
}

function extractJSONObject(value: string) {
  const trimmed = value.trim().replace(/^```(?:json)?\s*|\s*```$/giu, '')
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('教材选择结果中没有完整 JSON 对象')
  return trimmed.slice(start, end + 1)
}

export function parseAutonomousTextbookResolution(rawOutput: string) {
  const parsed = JSON.parse(extractJSONObject(rawOutput)) as Record<string, unknown>
  const selectedTextbookId = typeof parsed.selected_textbook_id === 'string'
    ? parsed.selected_textbook_id.trim()
    : ''
  if (!selectedTextbookId) throw new Error('教材选择结果缺少 selected_textbook_id')
  return { selectedTextbookId }
}
