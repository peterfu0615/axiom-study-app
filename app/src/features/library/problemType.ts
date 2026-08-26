const internalProblemTypeLabels: Record<string, string> = {
  choice: '选择题',
  multiple_choice: '选择题',
  fill_blank: '填空题',
  calculation: '计算题',
  proof: '证明题',
  solution: '解答题',
  short_answer: '简答题',
  reading_comprehension: '阅读理解题',
  application: '应用题',
  comprehensive: '综合题',
}

export function problemTypeLabel(value: string | null | undefined) {
  const visible = (value ?? '').trim().replace(/^AI\s*题型\s*[：:]\s*/iu, '')
  if (!visible) return '待识别'
  const normalized = visible.toLowerCase().replace(/[\s-]+/gu, '_')
  if (internalProblemTypeLabels[normalized]) return internalProblemTypeLabels[normalized]
  // Do not leak unknown provider enums such as `long_form_v2` into the UI.
  if (/^[a-z][a-z0-9_-]*$/iu.test(visible)) return '待识别'
  return visible
}
