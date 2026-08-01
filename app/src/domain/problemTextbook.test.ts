import { describe, expect, it } from 'vitest'
import { resolveProblemTextbook, type ProblemTextbookMatchSource } from './problemTextbook'
import type { Textbook } from './horizon'

function textbook(overrides: Partial<Textbook> = {}): Textbook {
  return {
    id: 'math-8b-2022',
    subject: '数学',
    title: '义务教育教科书 数学 八年级下册',
    grade: '八年级',
    volume: '下册',
    publisher: '人民教育出版社',
    edition: '2022年版',
    sourceType: 'pdf',
    sourcePath: null,
    contentHash: null,
    extractionStatus: 'completed',
    extractionMethod: 'pdf_text',
    isCurrent: false,
    archivedAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

const hint = {
  title: '数学八年级下册',
  grade: '八年级',
  volume: '下册',
  publisher: '人民教育出版社',
  edition: '2022年版',
  confidence: 0.9,
  evidence: '题面页眉',
}

function resolve(overrides: Partial<Parameters<typeof resolveProblemTextbook>[0]> = {}) {
  return resolveProblemTextbook({
    subject: '数学',
    lockedTextbookId: null,
    hint,
    textbooks: [textbook()],
    ...overrides,
  })
}

describe('resolveProblemTextbook', () => {
  it('matches the only textbook in a subject without relying on is_current', () => {
    const result = resolve({ textbooks: [textbook({ isCurrent: false })] })
    expect(result.textbook?.id).toBe('math-8b-2022')
    expect(result.source).toBe('single_subject_textbook')
  })

  it('uses grade and volume before a weak title token match', () => {
    const result = resolve({
      textbooks: [
        textbook({ id: 'math-8a', title: '数学教材', volume: '上册' }),
        textbook({ id: 'math-8b', title: '数学教材', volume: '下册' }),
      ],
    })
    expect(result.textbook?.id).toBe('math-8b')
  })

  it('uses publisher and edition to disambiguate same grade and volume', () => {
    const result = resolve({
      textbooks: [
        textbook({ id: 'other-edition', publisher: '其他出版社', edition: '2013年版' }),
        textbook({ id: 'target', publisher: '人民教育出版社', edition: '2022年版' }),
      ],
    })
    expect(result.textbook?.id).toBe('target')
    expect(result.reason).toContain('出版社一致')
  })

  it('keeps close scores unresolved', () => {
    const result = resolve({
      hint: { ...hint, title: null, grade: '八年级', volume: null, publisher: null, edition: null },
      textbooks: [
        textbook({ id: 'first', title: '教材甲' }),
        textbook({ id: 'second', title: '教材乙' }),
      ],
    })
    expect(result.textbook).toBeNull()
    expect(result.source).toBe('unresolved')
  })

  it('never considers another subject or archived textbook', () => {
    const result = resolve({
      textbooks: [
        textbook({ id: 'physics', subject: '物理' }),
        textbook({ id: 'archived', archivedAt: 10 }),
      ],
      hint: null,
    })
    expect(result.textbook).toBeNull()
  })

  it('preserves a user-locked match even when it is archived', () => {
    const result = resolve({
      lockedTextbookId: 'locked',
      textbooks: [textbook({ id: 'locked', archivedAt: 10 })],
      hint: null,
    })
    expect(result.textbook?.id).toBe('locked')
    expect(result.source).toBe('user')
    expect(result.confidence).toBe(1)
  })

  it('uses legacy is_current only as a low-confidence fallback', () => {
    const result = resolve({
      hint: null,
      textbooks: [textbook({ id: 'legacy', isCurrent: true }), textbook({ id: 'other', title: '另一本教材' })],
      legacyCurrentTextbookId: 'legacy',
    })
    expect(result.textbook?.id).toBe('legacy')
    expect(result.source as ProblemTextbookMatchSource).toBe('legacy_current_fallback')
    expect(result.confidence).toBeLessThan(0.5)
  })

  it('returns unresolved when the subject has no textbooks', () => {
    const result = resolve({ textbooks: [] })
    expect(result.source).toBe('unresolved')
    expect(result.textbook).toBeNull()
  })

  it('does not route from a low-confidence hint', () => {
    const result = resolve({ hint: { ...hint, confidence: 0.1 }, textbooks: [textbook(), textbook({ id: 'other', title: '另一教材' })] })
    expect(result.textbook).toBeNull()
    expect(result.source).toBe('unresolved')
  })
})
