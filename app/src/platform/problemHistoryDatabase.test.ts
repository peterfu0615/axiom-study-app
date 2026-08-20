import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import { getProblemReviewHistory } from './problemHistoryDatabase'

describe('problem review history', () => {
  beforeEach(() => invoke.mockReset())

  it('groups immutable tag evidence and answer media under each attempt', async () => {
    invoke
      .mockResolvedValueOnce([{ id: 'attempt-1', created_at: 10, rating: 'hard', overall_result: 'partial', first_error_step: 3, error_category: 'calculation_error', answer_image_path: '/answers/1.png', grading_confidence: .9 }])
      .mockResolvedValueOnce([{ review_attempt_id: 'attempt-1', tag_name: '倍长中线', result: 'demonstrated', evidence_text: '辅助线正确', confidence: .92 }])
    await expect(getProblemReviewHistory('problem-1')).resolves.toEqual([expect.objectContaining({
      attemptId: 'attempt-1', firstErrorStep: 3, answerImagePath: '/answers/1.png',
      evidence: [expect.objectContaining({ tagName: '倍长中线', result: 'demonstrated' })],
    })])
    expect(invoke).toHaveBeenCalledTimes(2)
  })
})
