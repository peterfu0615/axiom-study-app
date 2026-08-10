import { describe, expect, it } from 'vitest'
import { applyReviewRating, initialReviewSkillState, type ReviewRating } from './review'
import { previewReviewStateReplay, replayReviewHistory, type CurrentReplayState, type ReviewReplayEvent } from './reviewReplay'

const at = new Date(2026, 7, 10, 9).getTime()
const event = (id: string, offset: number, rating: ReviewRating = 'good', tags = ['k1']): ReviewReplayEvent => ({
  logId: id, reviewedAt: at + offset, subject: '数学', skillBundleId: 'b1', rating,
  difficulty: 'intermediate', tagIds: tags, previousBundleState: null,
})

function current(expected: ReturnType<typeof replayReviewHistory>): CurrentReplayState[] {
  return expected.map(({ eventCount: _, legacyBoundary: __, ...item }) => item)
}

describe('review state replay', () => {
  it('handles empty history without inventing state', () => {
    expect(previewReviewStateReplay([], []).status).toBe('empty')
  })

  it('replays one skill, multiple skills and bundle state deterministically', () => {
    const events = [event('b', 0, 'hard', ['k1', 'm1']), event('a', 0, 'good', ['k1', 'm1']), event('c', 100, 'easy', ['k1'])]
    const forward = replayReviewHistory(events)
    expect(replayReviewHistory([...events].reverse())).toEqual(forward)
    expect(forward.filter((item) => item.kind === 'skill')).toHaveLength(2)
    expect(forward.find((item) => item.kind === 'bundle')?.eventCount).toBe(3)
  })

  it('detects corrupted, missing and strictly covered extra state', () => {
    const events = [event('a', 0)]
    const expected = replayReviewHistory(events)
    const actual = current(expected)
    actual[0] = { ...actual[0], state: { ...actual[0].state, masteryEstimate: .01 } }
    actual.splice(1, 1)
    actual.push({ kind: 'skill', key: 'skill:数学:extra', subject: '数学', entityId: 'extra', schedulerVersion: 'horizon-v1', state: {
      ...applyReviewRating(initialReviewSkillState(), 'hard', 'basic', at), lastPracticedAt: at,
    } })
    expect(previewReviewStateReplay(events, actual).differences.map((item) => item.kind).sort()).toEqual(['extra', 'mismatch', 'missing'])
  })

  it('is consistent after replacing derived state with replay output and remains idempotent', () => {
    const events = [event('a', 0, 'again'), event('b', 100, 'good')]
    const rebuilt = current(replayReviewHistory(events))
    expect(previewReviewStateReplay(events, rebuilt).status).toBe('consistent')
    expect(previewReviewStateReplay(events, current(replayReviewHistory(events))).differences).toEqual([])
  })

  it('preserves a bundle legacy baseline and withholds unsafe partial skill replay', () => {
    const baseline = { ...initialReviewSkillState(), evidenceCount: 4, masteryEstimate: .7 }
    const events = [{ ...event('a', 0), previousBundleState: baseline }]
    const expected = replayReviewHistory(events)
    expect(expected.find((item) => item.kind === 'bundle')?.legacyBoundary).toBe(true)
    const actual = current(expected)
    const skill = actual.find((item) => item.kind === 'skill')!
    skill.state = { ...skill.state, evidenceCount: 3 }
    const preview = previewReviewStateReplay(events, actual)
    expect(preview.status).toBe('legacy_partial')
    expect(preview.legacyKeys).toHaveLength(1)
  })
})
