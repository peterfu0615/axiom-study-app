import { describe, expect, it } from 'vitest'
import {
  explainSelectionAntigravityJSONSchema,
  reasoningAnalysisAntigravityJSONSchema,
  studentAttemptAntigravityJSONSchema,
} from './intelligenceContract'

describe('Antigravity intelligence schemas', () => {
  it('avoid nullable union syntax rejected by the CLI schema dialect', () => {
    for (const schema of [
      studentAttemptAntigravityJSONSchema,
      reasoningAnalysisAntigravityJSONSchema,
      explainSelectionAntigravityJSONSchema,
    ]) {
      expect(JSON.stringify(schema)).not.toContain('"type":[')
    }
  })
})
