import { describe, expect, it } from 'vitest'
import type { ProblemBlock } from './models'
import {
  allProblemBlockIds,
  replaceProblemBlockSelection,
  resolveUserOverride,
  selectProblemBlocks,
  toggleProblemBlockId,
} from './problemSelection'

const blocks: ProblemBlock[] = [
  {
    id: 'one',
    title: '题目一',
    rect: { x: 0, y: 0, width: 1, height: 0.4 },
    confidence: 1,
    lineIds: [],
    source: 'auto',
  },
  {
    id: 'two',
    title: '题目二',
    rect: { x: 0, y: 0.5, width: 1, height: 0.4 },
    confidence: 1,
    lineIds: [],
    source: 'auto',
  },
]

describe('problem save selection', () => {
  it('defaults to all candidate blocks and can select none', () => {
    const selected = allProblemBlockIds(blocks)
    expect([...selected]).toEqual(['one', 'two'])
    expect([...new Set<string>()]).toEqual([])
  })

  it('toggles one block without mutating the previous selection', () => {
    const selected = allProblemBlockIds(blocks)
    const next = toggleProblemBlockId(selected, 'two')
    expect([...selected]).toEqual(['one', 'two'])
    expect([...next]).toEqual(['one'])
  })

  it('filters the complete layout down to the selected save subset', () => {
    expect(
      selectProblemBlocks(blocks, new Set(['two'])).map((block) => block.id),
    ).toEqual(['two'])
  })

  it('lets split blocks inherit their source selection', () => {
    const selected = replaceProblemBlockSelection(
      new Set(['one']),
      new Set(['one']),
      ['top', 'bottom'],
      true,
    )
    expect([...selected]).toEqual(['top', 'bottom'])
  })

  it('keeps a merged block unselected unless all sources were selected', () => {
    const selected = replaceProblemBlockSelection(
      new Set(['one']),
      new Set(['one', 'two']),
      ['merged'],
      false,
    )
    expect([...selected]).toEqual([])
  })

  it('removes deleted blocks from the save selection', () => {
    const selected = replaceProblemBlockSelection(
      new Set(['one', 'two']),
      new Set(['one']),
      [],
      false,
    )
    expect([...selected]).toEqual(['two'])
  })
})

describe('user field precedence', () => {
  it('uses the base value before the user supplies an override', () => {
    expect(resolveUserOverride(null, '模型题干')).toBe('模型题干')
  })

  it('uses the user value ahead of the base value', () => {
    expect(resolveUserOverride('人工题干', '模型题干')).toBe('人工题干')
  })

  it('preserves an explicitly cleared user value', () => {
    expect(resolveUserOverride('', '模型题干')).toBe('')
  })
})
