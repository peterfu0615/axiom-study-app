import type { AITextbookHint } from './models'
import type { Textbook } from './horizon'

/** Minimum score required before metadata can select a textbook. */
export const TEXTBOOK_MATCH_MIN_SCORE = 0.52
/** A close second result is ambiguous and must remain unresolved. */
export const TEXTBOOK_MATCH_TIE_MARGIN = 0.08
/** Low-confidence hints are retained for audit but cannot route a problem. */
export const TEXTBOOK_HINT_MIN_CONFIDENCE = 0.35

export type ProblemTextbookMatchSource =
  | 'single_subject_textbook'
  | 'metadata_match'
  | 'ai_hint'
  | 'user'
  | 'legacy_current_fallback'
  | 'unresolved'

export interface ProblemTextbookMatch {
  textbook: Textbook | null
  confidence: number
  reason: string | null
  source: ProblemTextbookMatchSource
}

export interface ResolveProblemTextbookInput {
  subject: string
  lockedTextbookId: string | null
  hint: AITextbookHint | null
  textbooks: Textbook[]
  legacyCurrentTextbookId?: string | null
}

function normalized(value: string | null | undefined) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s\u3000·•,，、。:：;；/\\_\-—–()（）[\]【】]+/gu, '')
    .trim()
}

function gradeToken(value: string | null | undefined) {
  const text = normalized(value)
  return text
    .replace(/第([一二三四五六七八九十百\d]+)学年级/gu, '$1年级')
    .replace(/七年级/gu, '7年级')
    .replace(/八年级/gu, '8年级')
    .replace(/九年级/gu, '9年级')
}

function volumeToken(value: string | null | undefined) {
  const text = normalized(value)
  return text
    .replace(/第一册/gu, '上册')
    .replace(/第二册/gu, '下册')
    .replace(/第1册/gu, '上册')
    .replace(/第2册/gu, '下册')
}

function titleTokens(value: string | null | undefined) {
  const text = normalized(value)
  return new Set(text.match(/[a-z]+|\d+|[\u4e00-\u9fff]/gu) ?? [text].filter(Boolean))
}

function overlap(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return 0
  let shared = 0
  for (const token of left) if (right.has(token)) shared += 1
  return shared / Math.max(left.size, right.size)
}

interface ScoredTextbook {
  textbook: Textbook
  score: number
  reason: string
}

export function scoreProblemTextbook(
  textbook: Textbook,
  hint: AITextbookHint,
): ScoredTextbook {
  const reasons: string[] = []
  let score = 0
  const hintGrade = gradeToken(hint.grade)
  const hintVolume = volumeToken(hint.volume)
  const bookGrade = gradeToken(textbook.grade)
  const bookVolume = volumeToken(textbook.volume)
  const sameGrade = Boolean(hintGrade && bookGrade && hintGrade === bookGrade)
  const sameVolume = Boolean(hintVolume && bookVolume && hintVolume === bookVolume)
  if (sameGrade && sameVolume) {
    score += 0.52
    reasons.push('年级和册别一致')
  } else {
    if (sameGrade) { score += 0.2; reasons.push('年级一致') }
    if (sameVolume) { score += 0.2; reasons.push('册别一致') }
  }

  const hintTitle = normalized(hint.title)
  const bookTitle = normalized(textbook.title)
  if (hintTitle && bookTitle && hintTitle === bookTitle) {
    score += 0.24
    reasons.push('教材标题一致')
  } else {
    const titleOverlap = overlap(titleTokens(hint.title), titleTokens(textbook.title))
    if (titleOverlap > 0) {
      score += 0.16 * titleOverlap
      reasons.push('教材标题部分一致')
    }
  }
  const hintPublisher = normalized(hint.publisher)
  const bookPublisher = normalized(textbook.publisher)
  if (hintPublisher && bookPublisher && hintPublisher === bookPublisher) {
    score += 0.08
    reasons.push('出版社一致')
  }
  const hintEdition = normalized(hint.edition)
  const bookEdition = normalized(textbook.edition)
  if (hintEdition && bookEdition && hintEdition === bookEdition) {
    score += 0.08
    reasons.push('版本一致')
  }
  return {
    textbook,
    // Metadata strength is the routing score. The model confidence is shown to
    // the user separately and must not turn an otherwise exact grade/volume
    // match into an artificial miss.
    score: Math.min(1, score),
    reason: reasons.length ? reasons.join('、') : '没有足够的教材元数据依据',
  }
}

export function resolveProblemTextbook(
  input: ResolveProblemTextbookInput,
): ProblemTextbookMatch {
  const subject = input.subject.trim()
  const candidates = input.textbooks.filter((textbook) => textbook.subject === subject)
  const locked = input.lockedTextbookId
    ? input.textbooks.find((textbook) => textbook.id === input.lockedTextbookId && textbook.subject === subject)
    : null
  if (locked) {
    return { textbook: locked, confidence: 1, reason: '用户已锁定教材', source: 'user' }
  }

  const available = candidates.filter((textbook) => textbook.archivedAt === null)
  if (!available.length) {
    return { textbook: null, confidence: 0, reason: '当前科目没有可用教材', source: 'unresolved' }
  }
  if (available.length === 1) {
    return {
      textbook: available[0],
      confidence: 0.95,
      reason: '当前科目只有一本未归档教材',
      source: 'single_subject_textbook',
    }
  }

  const hint = input.hint
  if (hint && hint.confidence >= TEXTBOOK_HINT_MIN_CONFIDENCE) {
    const scored = available
      .map((textbook) => scoreProblemTextbook(textbook, hint))
      .sort((left, right) => right.score - left.score)
    const best = scored[0]
    const second = scored[1]
    if (best && best.score >= TEXTBOOK_MATCH_MIN_SCORE &&
      (!second || best.score - second.score >= TEXTBOOK_MATCH_TIE_MARGIN)) {
      const source: ProblemTextbookMatchSource = best.score >= 0.72 ? 'metadata_match' : 'ai_hint'
      return {
        textbook: best.textbook,
        confidence: best.score,
        reason: best.reason,
        source,
      }
    }
    if (best && second && best.score >= TEXTBOOK_MATCH_MIN_SCORE &&
      best.score - second.score < TEXTBOOK_MATCH_TIE_MARGIN) {
      return { textbook: null, confidence: best.score, reason: '多个教材元数据得分接近，无法确定', source: 'unresolved' }
    }
  }

  const legacy = input.legacyCurrentTextbookId
    ? available.find((textbook) => textbook.id === input.legacyCurrentTextbookId)
    : null
  if (legacy) {
    return {
      textbook: legacy,
      confidence: 0.35,
      reason: '兼容旧版本教材选择，仅作为低优先级回退',
      source: 'legacy_current_fallback',
    }
  }
  return { textbook: null, confidence: 0, reason: '教材元数据不足以安全匹配', source: 'unresolved' }
}
