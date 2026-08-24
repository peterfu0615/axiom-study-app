import {
  addLocalReviewDays,
  buildReviewUnitPool,
  candidateRetention,
  candidateDueAt,
  endOfLocalReviewDay,
  estimateReviewProblemSeconds,
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
  averageRetention: number
  minimumRetention: number
  targetRetention: number
  estimatedMinutes: number
  sourceHash: string
}

export function reviewLoadLevel(unitCount: number): ReviewLoadLevel {
  if (unitCount <= 0) return 'empty'
  if (unitCount === 1) return 'light'
  if (unitCount <= 3) return 'normal'
  return 'heavy'
}

function forecastSourceHash(candidates: ReviewCandidate[], now: number, targetRetention: number) {
  const source = candidates.map((candidate) =>
    `${candidate.problemId}:${candidateDueAt(candidate, now, targetRetention)}`).sort().join('|')
  let hash = 2_166_136_261
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * Static forward projection. Each current candidate is assigned to its
 * earliest scheduled local day and clustered with the same pure planner used
 * by Today. No future feedback or future session is invented.
 */
export function buildReviewForecast(
  candidates: ReviewCandidate[],
  now: number,
  days = 7,
  targetRetention = .85,
): ReviewForecastDay[] {
  const todayStart = startOfLocalReviewDay(now)
  const horizon = Array.from({ length: days }, (_, offset) => addLocalReviewDays(todayStart, offset))
  const buckets = horizon.map(() => [] as ReviewCandidate[])
  const overdue = horizon.map(() => 0)

  candidates.forEach((candidate) => {
    if (!candidate.subject.trim() || !candidate.stemMarkdown.trim()) return
    const dueAt = candidateDueAt(candidate, now, targetRetention)
    if (dueAt < todayStart) {
      buckets[0].push(candidate)
      overdue[0] += 1
      return
    }
    const index = horizon.findIndex((day) => dueAt <= endOfLocalReviewDay(day))
    if (index >= 0) buckets[index].push(candidate)
  })

  return horizon.map((dayStart, index) => {
    const candidatesForDay = buckets[index]
    const displayAt = dayStart + 12 * 60 * 60 * 1000
    const units = buildReviewUnitPool(candidatesForDay, displayAt)
    const retentions = candidatesForDay.map((candidate) => {
      return candidateRetention(candidate, displayAt)
    })
    return {
      date: localReviewDate(dayStart),
      dayStart,
      estimatedUnitCount: units.length,
      estimatedProblemCount: candidatesForDay.length,
      overdueProblemCount: overdue[index],
      loadLevel: reviewLoadLevel(units.length),
      dominantThemes: units.slice(0, 2).map((unit) => unit.title),
      averageRetention: retentions.length
        ? retentions.reduce((sum, value) => sum + value, 0) / retentions.length
        : 1,
      minimumRetention: retentions.length ? Math.min(...retentions) : 1,
      targetRetention,
      estimatedMinutes: Math.ceil(candidatesForDay.reduce(
        (sum, candidate) => sum + estimateReviewProblemSeconds(candidate), 0,
      ) / 60),
      sourceHash: forecastSourceHash(candidatesForDay, now, targetRetention),
    }
  })
}
