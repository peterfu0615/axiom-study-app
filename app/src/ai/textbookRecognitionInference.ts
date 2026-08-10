import type { TextbookRecognition, TextbookMetadataField } from '../domain/horizon'

interface RecognitionEvidence {
  sourceName: string
  outline: Array<{ title: string; evidenceText: string }>
  pages: Array<{ pageNumber: number; evidenceText: string }>
}

const subjectPatterns: Array<[string, RegExp]> = [
  ['道德与法治', /道德与法治/u],
  ['数学', /数学/u],
  ['语文', /语文/u],
  ['英语', /英语/u],
  ['物理', /物理/u],
  ['化学', /化学/u],
  ['生物', /生物/u],
  ['历史', /历史/u],
  ['地理', /地理/u],
]

const gradePattern = /(?:小学|初中|高中)?[一二三四五六七八九十１２３４５６７８９０]+年级/u
const volumePattern = /(?:上册|下册|全一册|全一卷|上学期|下学期)/u
const publisherPattern = /[\u4e00-\u9fff]{2,24}出版社/u
const editionPattern = /(?:20\d{2}|19\d{2})年(?:版|新课标|课程标准修订)/u

function field(value: string, evidence: string): TextbookMetadataField {
  return { value: value.trim() || null, evidence: evidence.trim() }
}

function missing(current: TextbookMetadataField, value: string | null, evidence: string) {
  return current.value ? current : value ? field(value, evidence) : current
}

/**
 * Compatible providers occasionally return structurally valid but empty
 * metadata objects.  Keep that response as the AI result, then fill only the
 * fields that have direct local evidence so the user can confirm them.  This
 * is deliberately conservative: it never invents a publisher or edition.
 */
export function inferMissingTextbookRecognition(
  recognition: TextbookRecognition,
  input: RecognitionEvidence,
): TextbookRecognition {
  const sourceName = input.sourceName.replace(/\.[^.]+$/u, '')
  const evidenceItems = [
    input.sourceName,
    ...input.outline.map((item) => `${item.title} ${item.evidenceText}`),
    ...input.pages.slice(0, 24).map((page) => page.evidenceText),
  ]
  const evidence = evidenceItems.join('\n')
  const subjectMatch = subjectPatterns.find(([, pattern]) => pattern.test(evidence))
  const gradeMatch = evidence.match(gradePattern)
  const volumeMatch = evidence.match(volumePattern)
  const publisherMatch = evidence.match(publisherPattern)
  const editionMatch = sourceName.match(editionPattern) ?? evidence.match(editionPattern)
  const inferredSubject = subjectMatch?.[0] ?? null
  const inferredGrade = gradeMatch?.[0] ?? null
  const inferredVolume = volumeMatch?.[0] ?? null
  const inferredPublisher = publisherMatch?.[0] ?? null
  const inferredEdition = editionMatch?.[0] ?? null
  const inferredTitle = inferredSubject && inferredGrade && inferredVolume
    ? `${inferredSubject}${inferredGrade}${inferredVolume}`
    : sourceName

  const result: TextbookRecognition = {
    ...recognition,
    title: missing(recognition.title, inferredTitle, input.sourceName),
    subject: missing(recognition.subject, inferredSubject, input.sourceName),
    grade: missing(recognition.grade, inferredGrade, input.sourceName),
    volume: missing(recognition.volume, inferredVolume, input.sourceName),
    publisher: missing(recognition.publisher, inferredPublisher, publisherMatch?.[0] ?? ''),
    edition: missing(recognition.edition, inferredEdition, editionMatch?.[0] ?? ''),
  }
  const metadataKeys: Array<keyof Pick<TextbookRecognition, 'title' | 'subject' | 'grade' | 'volume' | 'publisher' | 'edition'>> = [
    'title', 'subject', 'grade', 'volume', 'publisher', 'edition',
  ]
  const metadataValues = [result.title, result.subject, result.grade,
    result.volume, result.publisher, result.edition]
  const filled = metadataValues.some((item, index) => !recognition[metadataKeys[index]].value && item.value)
  if (!filled) return result
  const warning = 'AI 未返回完整教材信息，已根据文件名、目录和本地正文填充候选；请在确认页检查。'
  return {
    ...result,
    warnings: result.warnings.includes(warning) ? result.warnings : [...result.warnings, warning],
  }
}
