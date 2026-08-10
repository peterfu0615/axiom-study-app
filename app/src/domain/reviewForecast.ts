import {
  addLocalReviewDays,
  buildReviewUnitPool,
  endOfLocalReviewDay,
  localReviewDate,
  startOfLocalReviewDay,
  type ReviewCandidate,
} from './review'

export type ReviewLoadLevel = 'empty' | 'light' | 'normal' | 'heavy'

export interface ReviewForecastDay {
  date: string
  dayStart: number
  estimatedUnitCount: number
  estimatedProblemCount: number
  overdueProblemCount: number
  loadLevel: ReviewLoadLevel
  dominantThemes: string[]
}

function earliestDueAt(candidate: ReviewCandidate, todayStart: number) {
  const states = Object.values(candidate.skillStates)
  const scheduled = states
    .map((state) => state.nextReviewAt)
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right)[0]
  // New and legacy candidates without a schedule are due for their first
  // review today. This is the same initial-state input used by Today Planner.
  return scheduled ?? todayStart
}

export function reviewLoadLevel(unitCount: number): ReviewLoadLevel {
  if (unitCount <= 0) return 'empty'
  if (unitCount === 1) return 'light'
  if (unitCount <= 3) return 'normal'
  return 'heavy'
}

/**
 * Static seven-day projection. Each current candidate is assigned to its
 * earliest scheduled local day and clustered with the same pure planner used
 * by Today. No future feedback or future session is invented.
 */
export function buildSevenDayReviewForecast(
  candidates: ReviewCandidate[],
  now: number,
): ReviewForecastDay[] {
  const todayStart = startOfLocalReviewDay(now)
  const days = Array.from({ length: 7 }, (_, offset) => addLocalReviewDays(todayStart, offset))
  const buckets = days.map(() => [] as ReviewCandidate[])
  const overdue = days.map(() => 0)

  candidates.forEach((candidate) => {
    if (!candidate.subject.trim() || !candidate.stemMarkdown.trim()) return
    const dueAt = earliestDueAt(candidate, todayStart)
    if (dueAt < todayStart) {
      buckets[0].push(candidate)
      overdue[0] += 1
      return
    }
    const index = days.findIndex((day) => dueAt <= endOfLocalReviewDay(day))
    if (index >= 0) buckets[index].push(candidate)
  })

  return days.map((dayStart, index) => {
    const candidatesForDay = buckets[index]
    const units = buildReviewUnitPool(candidatesForDay, dayStart + 12 * 60 * 60 * 1000)
    return {
      date: localReviewDate(dayStart),
      dayStart,
      estimatedUnitCount: units.length,
      estimatedProblemCount: candidatesForDay.length,
      overdueProblemCount: overdue[index],
      loadLevel: reviewLoadLevel(units.length),
      dominantThemes: units.slice(0, 2).map((unit) => unit.title),
    }
  })
}
