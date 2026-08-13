import { describe, expect, it } from 'vitest'
import { practiceErrorMessage } from './productLanguage'

describe('practice product language', () => {
  it('turns implementation errors into actionable student-facing guidance', () => {
    expect(practiceErrorMessage('PracticeResponse abc 找不到对应题目')).not.toContain('PracticeResponse')
    expect(practiceErrorMessage('页面身份不属于当前 PracticeSet')).toBe('这份作答页不属于当前练习，请上传本组练习对应的页面。')
    expect(practiceErrorMessage('未识别到 Axiom 答题卡页面身份')).toBe('未识别到页面二维码，请确保整页完整、清晰且未被遮挡。')
    expect(practiceErrorMessage('Provider request failed')).toBe('暂时无法自动读取作答，请检查 AI 设置后重试。')
  })
})
