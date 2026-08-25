import {
  addLocalReviewDays,
  applyReviewRating,
  buildReviewUnitPool,
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
  estimatedMinutes: number
  sourceHash: string
}

export function reviewLoadLevel(unitCount: number): ReviewLoadLevel {
  if (unitCount <= 0) return 'empty'
  if (unitCount === 1) return 'light'
  if (unitCount <= 3) return 'normal'
  return 'heavy'
}

function forecastSourceHash(candidates: ReviewCandidate[], date: string) {
  const source = candidates.map((candidate) => candidate.problemId).sort().join('|') + `:${date}`
  let hash = 2_166_136_261
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * Pure forward projection. Future reviews are simulated as being completed
 * on their due date with a Good rating. The cloned state never crosses the
 * persistence boundary; real feedback immediately replaces this projection.
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
  const horizonEnd = endOfLocalReviewDay(horizon.at(-1) ?? todayStart)

  candidates.forEach((sourceCandidate) => {
    let candidate: ReviewCandidate = {
      ...sourceCandidate,
      tags: sourceCandidate.tags.map((tag) => ({ ...tag })),
      skillStates: Object.fromEntries(Object.entries(sourceCandidate.skillStates)
        .map(([key, state]) => [key, { ...state }])),
      bundleState: sourceCandidate.bundleState ? { ...sourceCandidate.bundleState } : null,
    }
    if (!candidate.subject.trim() || !candidate.stemMarkdown.trim()) return
    let previousDayIndex = -1
    for (let occurrence = 0; occurrence < horizon.length; occurrence += 1) {
      const dueAt = candidateDueAt(candidate, now, targetRetention)
      if (!Number.isFinite(dueAt) || dueAt > horizonEnd) break
      const dueDayIndex = dueAt < todayStart
        ? 0
        : horizon.findIndex((day) => dueAt <= endOfLocalReviewDay(day))
      // A daily plan cannot expose the same problem more than once on one
      // local day. Very short initial intervals are therefore projected onto
      // the next available day instead of being counted dozens of times today.
      const index = Math.max(dueDayIndex, previousDayIndex + 1)
      if (index < 0) break
      if (index >= horizon.length) break
      buckets[index].push(candidate)
      if (occurrence === 0 && dueAt < todayStart) overdue[index] += 1

      const reviewedAt = index === 0 && dueAt < now ? now : Math.max(dueAt, horizon[index])
      const difficulty = candidate.difficulty ?? 'intermediate'
      const stateEntries = Object.entries(candidate.skillStates)
      candidate = {
        ...candidate,
        skillStates: Object.fromEntries(stateEntries.map(([key, state]) => [
          key,
          applyReviewRating(state, 'good', difficulty, reviewedAt, { targetRetention }),
        ])),
        bundleState: candidate.bundleState
          ? applyReviewRating(candidate.bundleState, 'good', difficulty, reviewedAt, { targetRetention })
          : null,
        lastReviewedAt: reviewedAt,
        lastRating: 'good',
        reviewCount: candidate.reviewCount + 1,
      }
      previousDayIndex = index
    }
  })

  return horizon.map((dayStart, index) => {
    const candidatesForDay = buckets[index]
    const displayAt = dayStart + 12 * 60 * 60 * 1000
    const units = buildReviewUnitPool(candidatesForDay, displayAt)
    const date = localReviewDate(dayStart)
    return {
      date,
      dayStart,
      estimatedUnitCount: units.length,
      estimatedProblemCount: candidatesForDay.length,
      overdueProblemCount: overdue[index],
      loadLevel: reviewLoadLevel(units.length),
      dominantThemes: units.slice(0, 2).map((unit) => unit.title),
      estimatedMinutes: Math.ceil(candidatesForDay.reduce(
        (sum, candidate) => sum + estimateReviewProblemSeconds(candidate), 0,
      ) / 60),
      sourceHash: forecastSourceHash(candidatesForDay, date),
    }
  })
}
