// @ts-expect-error Vitest executes this contract in Node, while the app tsconfig is browser-only.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Planner workspace integration', () => {
  const workspace = readFileSync(new URL('./PlannerWorkspace.tsx', import.meta.url), 'utf8')
  const database = readFileSync(new URL('../../platform/plannerDatabase.ts', import.meta.url), 'utf8')
  const app = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8')

  it('uses Horizon review and correction evidence instead of acting as an isolated todo list', () => {
    expect(database).toContain('getSevenDayReviewForecast')
    expect(database).toContain("source_type='correction'")
    expect(database).toContain('practice_evidences')
    expect(database).toContain('subjectSpeedRatios')
  })

  it('records actual duration and routes system work back into the learning loop', () => {
    expect(workspace).toContain('记录实际用时')
    expect(workspace).toContain('completePlannerTask(completion.id, completion.actualMinutes)')
    expect(workspace).toContain("onNavigate('today')")
    expect(app).toContain('<PlannerWorkspace onNavigate={setSection}')
  })
})
