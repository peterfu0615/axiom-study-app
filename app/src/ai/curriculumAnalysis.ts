import { normalizeTagName, type TextbookRecognition } from '../domain/horizon'

export const CURRICULUM_TAG_PROMPT_VERSION = 'curriculum-tags-v2'
export const CURRICULUM_TAG_SCHEMA_VERSION = 'curriculum-tags-v2'
export const CURRICULUM_AUDIT_PROMPT_VERSION = 'curriculum-audit-v2'
export const CURRICULUM_AUDIT_SCHEMA_VERSION = 'curriculum-audit-v2'

export type CurriculumTagOrigin =
  | 'textbook_extracted'
  | 'ai_inferred'
  | 'existing_library'
  | 'user_created'

export interface CurriculumTagCandidate {
  tagType: 'knowledge' | 'method' | 'model'
  canonicalName: string
  aliases: string[]
  description: string | null
  origin: CurriculumTagOrigin
  knowledgeNames: string[]
  pageNumbers: number[]
  evidenceText: string | null
  confidence: number
  existingTagId: string | null
}

export interface CurriculumTagAnalysis {
  subject: string
  candidates: CurriculumTagCandidate[]
  warnings: string[]
}

export interface CurriculumAuditResult {
  acceptedNames: string[]
  rejectedNames: string[]
  warnings: string[]
}

export const curriculumTagsJSONSchema = {
  type: 'object', required: ['subject', 'tags', 'warnings'],
  properties: {
    subject: { type: 'string' },
    tags: { type: 'array', maxItems: 320, items: { type: 'object', required: [
      'tag_type', 'canonical_name', 'aliases', 'description', 'origin',
      'knowledge_names', 'page_numbers', 'evidence_text', 'confidence',
    ], properties: {
      tag_type: { type: 'string', enum: ['knowledge', 'method', 'model'] },
      canonical_name: { type: 'string' }, aliases: { type: 'array', items: { type: 'string' } },
      description: { type: ['string', 'null'] },
      origin: { type: 'string', enum: ['textbook_extracted', 'ai_inferred', 'existing_library'] },
      knowledge_names: { type: 'array', items: { type: 'string' } },
      page_numbers: { type: 'array', items: { type: 'integer' } },
      evidence_text: { type: ['string', 'null'] }, confidence: { type: 'number' },
    } } }, warnings: { type: 'array', items: { type: 'string' } },
  },
} as const

export const curriculumAuditJSONSchema = {
  type: 'object', required: ['accepted_names', 'rejected_names', 'warnings'],
  properties: {
    accepted_names: { type: 'array', items: { type: 'string' } },
    rejected_names: { type: 'array', items: { type: 'string' } },
    warnings: { type: 'array', items: { type: 'string' } },
  },
} as const

function pageText(pages: Array<{ pageNumber: number; evidenceText: string }>) {
  return pages.map((page) => `[[PAGE ${page.pageNumber}]]\n${page.evidenceText}`).join('\n\n')
}

export function buildCurriculumTagPrompt(input: {
  recognition: TextbookRecognition
  outline: unknown
  pages: Array<{ pageNumber: number; evidenceText: string }>
  existingTags: Array<{ id: string; tagType: string; canonicalName: string; aliases: string[] }>
}) {
  return `你是中国 K12 课程标签设计助手。只返回符合 JSON Schema 的 JSON。

知识点以当前教材全文和目录为主要边界，必须属于当前教材，尽量给出页码、原文依据和章节，不得明显超出教学范围。

解题方法和题型模型既可从教材提取，也可根据已识别科目、年级、知识结构及学科常识合理扩展。不要求教材原文明确命名，不要求页码或原文证据；不得因教材未写出“倍长中线”“待定系数法”“一线三等角”等名称而拒绝建立相关标签。推断项使用 ai_inferred。方法和模型须关联适用知识点，关联可由你推断。

严格科目隔离。先与 existing_tags 的规范名和别名比较，明显同义时返回已有名称、origin=existing_library，不新造近义标签。控制数量：知识点最多 180，方法最多 60，题型模型最多 80。不要生成难度标签；难度固定为基础、中档、压轴并由具体题目分析决定。所有新生成项只是候选。

<recognition>${JSON.stringify(input.recognition)}</recognition>
<outline>${JSON.stringify(input.outline)}</outline>
<existing_tags>${JSON.stringify(input.existingTags)}</existing_tags>
<textbook_pages>\n${pageText(input.pages)}\n</textbook_pages>`
}

export function buildCurriculumAuditPrompt(input: {
  subject: string
  candidates: CurriculumTagCandidate[]
  knowledgeNames: string[]
}) {
  return `你是课程标签质量审计助手。只返回 JSON。审计以下候选是否与科目“${input.subject}”及当前知识结构相关，拒绝跨科目、明显越界、重复或无实际含义的标签。解题方法和题型模型不需要教材页码证据，不能仅因教材未明确命名而拒绝；知识点仍需教材边界。不要创建难度名称。\n<knowledge>${JSON.stringify(input.knowledgeNames)}</knowledge>\n<candidates>${JSON.stringify(input.candidates)}</candidates>`
}

function objectFromOutput(rawOutput: string) {
  const trimmed = rawOutput.trim().replace(/^```(?:json)?\s*|\s*```$/giu, '')
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('教材标签结果中没有完整 JSON 对象')
  return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>
}

const strings = (value: unknown) => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
  : []

export function parseCurriculumTags(rawOutput: string, expectedSubject: string): CurriculumTagAnalysis {
  const value = objectFromOutput(rawOutput)
  const subject = typeof value.subject === 'string' ? value.subject.trim() : ''
  if (!subject || normalizeTagName(subject) !== normalizeTagName(expectedSubject)) {
    throw new Error(`教材标签科目不匹配：期望 ${expectedSubject}，收到 ${subject || '空值'}`)
  }
  const limits = { knowledge: 180, method: 60, model: 80 }
  const counts = { knowledge: 0, method: 0, model: 0 }
  const seen = new Set<string>()
  const candidates: CurriculumTagCandidate[] = []
  for (const raw of Array.isArray(value.tags) ? value.tags : []) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const tag = raw as Record<string, unknown>
    const tagType = tag.tag_type
    const canonicalName = typeof tag.canonical_name === 'string' ? tag.canonical_name.trim() : ''
    if (!['knowledge', 'method', 'model'].includes(String(tagType)) || !canonicalName) continue
    const type = tagType as CurriculumTagCandidate['tagType']
    const key = `${type}:${normalizeTagName(canonicalName)}`
    if (seen.has(key) || counts[type] >= limits[type]) continue
    seen.add(key); counts[type] += 1
    const origin = ['textbook_extracted', 'ai_inferred', 'existing_library'].includes(String(tag.origin))
      ? tag.origin as CurriculumTagOrigin : 'ai_inferred'
    candidates.push({
      tagType: type, canonicalName, aliases: strings(tag.aliases),
      description: typeof tag.description === 'string' ? tag.description.trim() || null : null,
      origin, knowledgeNames: strings(tag.knowledge_names),
      pageNumbers: type === 'knowledge' && Array.isArray(tag.page_numbers)
        ? tag.page_numbers.filter((page): page is number => Number.isInteger(page) && Number(page) > 0) : [],
      evidenceText: type === 'knowledge' && typeof tag.evidence_text === 'string' ? tag.evidence_text.trim() || null : null,
      confidence: typeof tag.confidence === 'number' ? Math.max(0, Math.min(1, tag.confidence)) : 0,
      existingTagId: null,
    })
  }
  return { subject, candidates, warnings: strings(value.warnings) }
}

export function parseCurriculumAudit(rawOutput: string): CurriculumAuditResult {
  const value = objectFromOutput(rawOutput)
  return { acceptedNames: strings(value.accepted_names), rejectedNames: strings(value.rejected_names), warnings: strings(value.warnings) }
}

export function reconcileCurriculumTagCandidates(
  candidates: CurriculumTagCandidate[],
  existing: Array<{ id: string; tagType: string; canonicalName: string; aliases: string[] }>,
) {
  return candidates.map((candidate) => {
    const names = [candidate.canonicalName, ...candidate.aliases].map(normalizeTagName)
    const match = existing.find((tag) => tag.tagType === candidate.tagType &&
      [tag.canonicalName, ...tag.aliases].some((name) => names.includes(normalizeTagName(name))))
    return match ? { ...candidate, canonicalName: match.canonicalName, origin: 'existing_library' as const, existingTagId: match.id } : candidate
  }).filter((candidate, index, all) => all.findIndex((other) =>
    other.tagType === candidate.tagType && normalizeTagName(other.canonicalName) === normalizeTagName(candidate.canonicalName)) === index)
}
