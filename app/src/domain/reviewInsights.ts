import type { DifficultyLevel, HorizonTagType } from './models'
import {
  addLocalReviewDays,
  localReviewDate,
  startOfLocalReviewDay,
  type ReviewRating,
  type ReviewSkillState,
  type ReviewTag,
} from './review'

export type InsightRangeDays = 7 | 30

export interface ReviewInsightRecord {
  moduleId: string
  subject: string
  sessionDate: string
  status: 'pending' | 'completed' | 'deferred'
  completedAt: number | null
  sourceProblemId: string
  rating: ReviewRating | null
  sourceMode: 'original' | 'variant'
  difficulty: DifficultyLevel
  tags: ReviewTag[]
  errorCategories: ReviewTag[]
}

export interface InsightSkill {
  subject: string
  tagId: string
  name: string
  type: Extract<HorizonTagType, 'knowledge' | 'method' | 'model'>
  state: ReviewSkillState
}

export interface BundleMasteryChange {
  logId: string
  subject: string
  reviewedAt: number
  previousMastery: number
  newMastery: number
}

export interface ReviewInsights {
  rangeDays: InsightRangeDays
  subject: string | null
  subjects: string[]
  fromDate: string
  toDate: string
  overview: {
    completedUnits: number
    completedProblems: number
    deferredUnits: number
    completionRate: number | null
    futureDueSkills: number
    overdueSkills: number
  }
  trend: Array<{ date: string; completedUnits: number; completedProblems: number; masteryDelta: number | null }>
  ratings: Record<ReviewRating, number>
  mastery: Record<'stable' | 'consolidating' | 'attention' | 'insufficient', InsightSkill[]>
  themes: Array<{ type: HorizonTagType; name: string; count: number }>
  recurringErrors: Array<{ name: string; count: number; difficultCount: number }>
  skillDetails: InsightSkillDetail[]
}

export interface InsightEvidenceSplit {
  attempts: number
  difficultAttempts: number
  successRate: number | null
}

export interface InsightSkillDetail extends InsightSkill {
  conclusionEligible: boolean
  reerrorRate: number | null
  original: InsightEvidenceSplit
  variant: InsightEvidenceSplit
}

function masteryGroup(skill: InsightSkill) {
  if (skill.state.evidenceCount < 3) return 'insufficient'
  if (skill.state.masteryEstimate >= .75 && skill.state.uncertainty <= .55 && skill.state.retrievability >= .65) return 'stable'
  if (skill.state.masteryEstimate >= .5 && skill.state.retrievability >= .5) return 'consolidating'
  return 'attention'
}

export function buildReviewInsights(input: {
  records: ReviewInsightRecord[]
  skills: InsightSkill[]
  changes: BundleMasteryChange[]
  rangeDays: InsightRangeDays
  now: number
  subject?: string | null
}): ReviewInsights {
  const toStart = startOfLocalReviewDay(input.now)
  const fromStart = addLocalReviewDays(toStart, -(input.rangeDays - 1))
  const fromDate = localReviewDate(fromStart)
  const toDate = localReviewDate(toStart)
  const subjects = [...new Set([
    ...input.records.map((record) => record.subject),
    ...input.skills.map((skill) => skill.subject),
  ].filter(Boolean))].sort((left, right) => left.localeCompare(right, 'zh-CN'))
  const selectedSubject = input.subject && subjects.includes(input.subject) ? input.subject : null
  const records = input.records.filter((record) => record.sessionDate >= fromDate && record.sessionDate <= toDate
    && (!selectedSubject || record.subject === selectedSubject))
  const skills = input.skills.filter((skill) => !selectedSubject || skill.subject === selectedSubject)
  const completed = records.filter((record) => record.status === 'completed')
  const deferred = records.filter((record) => record.status === 'deferred')
  const actionable = completed.length + deferred.length + records.filter((record) => record.status === 'pending').length
  const ratings: Record<ReviewRating, number> = { again: 0, hard: 0, good: 0, easy: 0 }
  completed.forEach((record) => { if (record.rating) ratings[record.rating] += 1 })

  const themeCounts = new Map<string, { type: HorizonTagType; name: string; count: number }>()
  const errorCounts = new Map<string, { name: string; count: number; difficultCount: number }>()
  completed.forEach((record) => {
    const seen = new Set<string>()
    record.tags.filter((tag) => tag.type !== 'error').forEach((tag) => {
      const key = `${tag.type}:${tag.id || tag.name}`
      if (seen.has(key)) return
      seen.add(key)
      const current = themeCounts.get(key)
      themeCounts.set(key, { type: tag.type, name: tag.name, count: (current?.count ?? 0) + 1 })
    })
    record.errorCategories.forEach((tag) => {
      const key = tag.id || tag.name
      const current = errorCounts.get(key)
      errorCounts.set(key, {
        name: tag.name, count: (current?.count ?? 0) + 1,
        difficultCount: (current?.difficultCount ?? 0) + Number(record.rating === 'again' || record.rating === 'hard'),
      })
    })
  })

  const changesByDate = new Map<string, number[]>()
  input.changes.filter((change) => !selectedSubject || change.subject === selectedSubject).forEach((change) => {
    const date = localReviewDate(change.reviewedAt)
    if (date < fromDate || date > toDate) return
    const values = changesByDate.get(date) ?? []
    values.push(change.newMastery - change.previousMastery)
    changesByDate.set(date, values)
  })
  const trend = Array.from({ length: input.rangeDays }, (_, offset) => {
    const date = localReviewDate(addLocalReviewDays(fromStart, offset))
    const daily = completed.filter((record) => record.sessionDate === date)
    const changes = changesByDate.get(date) ?? []
    return {
      date,
      completedUnits: daily.length,
      completedProblems: new Set(daily.map((record) => record.sourceProblemId)).size,
      masteryDelta: changes.length ? changes.reduce((sum, value) => sum + value, 0) / changes.length : null,
    }
  })

  const mastery: ReviewInsights['mastery'] = { stable: [], consolidating: [], attention: [], insufficient: [] }
  skills.forEach((skill) => mastery[masteryGroup(skill)].push(skill))
  Object.values(mastery).forEach((items) => items.sort((left, right) =>
    left.subject.localeCompare(right.subject, 'zh-CN') || left.name.localeCompare(right.name, 'zh-CN')))

  const evidenceSplit = (skill: InsightSkill, sourceMode: ReviewInsightRecord['sourceMode']): InsightEvidenceSplit => {
    const attempts = completed.filter((record) => record.sourceMode === sourceMode
      && record.tags.some((tag) => tag.type === skill.type && (tag.id === skill.tagId || (!tag.id && tag.name === skill.name))))
    const rated = attempts.filter((record) => record.rating !== null)
    const successful = rated.filter((record) => record.rating === 'good' || record.rating === 'easy')
    return {
      attempts: attempts.length,
      difficultAttempts: rated.filter((record) => record.rating === 'again' || record.rating === 'hard').length,
      successRate: rated.length ? successful.length / rated.length : null,
    }
  }
  const skillDetails: InsightSkillDetail[] = skills.map((skill) => {
    const attempts = skill.state.successCount + skill.state.failureCount
    return {
      ...skill,
      conclusionEligible: skill.state.evidenceCount >= 3,
      reerrorRate: attempts ? skill.state.failureCount / attempts : null,
      original: evidenceSplit(skill, 'original'),
      variant: evidenceSplit(skill, 'variant'),
    }
  }).sort((left, right) =>
    Number(right.conclusionEligible) - Number(left.conclusionEligible)
    || (right.reerrorRate ?? -1) - (left.reerrorRate ?? -1)
    || left.name.localeCompare(right.name, 'zh-CN'))

  return {
    rangeDays: input.rangeDays, subject: selectedSubject, subjects, fromDate, toDate,
    overview: {
      completedUnits: completed.length,
      completedProblems: new Set(completed.map((record) => record.sourceProblemId)).size,
      deferredUnits: deferred.length,
      completionRate: actionable ? completed.length / actionable : null,
      futureDueSkills: skills.filter((skill) => skill.state.nextReviewAt !== null
        && skill.state.nextReviewAt <= addLocalReviewDays(toStart, 7)).length,
      overdueSkills: skills.filter((skill) => skill.state.nextReviewAt !== null
        && skill.state.nextReviewAt < toStart).length,
    },
    trend, ratings, mastery, skillDetails,
    themes: [...themeCounts.values()].sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, 'zh-CN')).slice(0, 10),
    recurringErrors: [...errorCounts.values()].filter((item) => item.count >= 3)
      .sort((left, right) => right.count - left.count || right.difficultCount - left.difficultCount || left.name.localeCompare(right.name, 'zh-CN')).slice(0, 6),
  }
}
