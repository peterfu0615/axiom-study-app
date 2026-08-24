import {
  addLocalReviewDays,
  applyReviewRating,
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
  if (scheduled !== undefined) return scheduled
  // 未曾复习的新录入错题或带历史记录的题目：
  // 艾宾浩斯记忆遗忘曲线（Ebbinghaus Forgetting Curve）：
  // 遗忘在学习后立即开始，且初期极快。
  // 新题目标准复习周期：Day 0 (录入当天) -> Day 1 -> Day 2 -> Day 4 -> Day 7 -> Day 15 -> Day 30。
  // 若未完成复习或仅刚录入，若已跨过录入当天则基于其录入时间与难度推导首轮到期日。
  if (candidate.lastReviewedAt && candidate.lastRating) {
    return applyReviewRating(
      null,
      candidate.lastRating,
      candidate.difficulty ?? 'intermediate',
      candidate.lastReviewedAt,
    ).nextReviewAt ?? todayStart
  }
  // 未复习过的新题：若录入时间小于今天起始，则已在第一轮到期（今天）；
  // 否则安排在录入次日（Day 1 艾宾浩斯第一记忆复习点）
  const createdDayStart = startOfLocalReviewDay(candidate.createdAt || todayStart)
  if (createdDayStart < todayStart) {
    return todayStart
  }
  // 录入当天的新题，艾宾浩斯第 1 个巩固周期在第 1 天（明天）
  return addLocalReviewDays(todayStart, 1)
}

export function reviewLoadLevel(unitCount: number): ReviewLoadLevel {
  if (unitCount <= 0) return 'empty'
  if (unitCount === 1) return 'light'
  if (unitCount <= 3) return 'normal'
  return 'heavy'
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
): ReviewForecastDay[] {
  const todayStart = startOfLocalReviewDay(now)
  const horizon = Array.from({ length: days }, (_, offset) => addLocalReviewDays(todayStart, offset))
  const buckets = horizon.map(() => [] as ReviewCandidate[])
  const overdue = horizon.map(() => 0)

  candidates.forEach((candidate) => {
    if (!candidate.subject.trim() || !candidate.stemMarkdown.trim()) return
    const dueAt = earliestDueAt(candidate, todayStart)
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
