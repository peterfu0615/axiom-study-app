import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const stylesheet = readFileSync(new URL('./Curriculum.css', import.meta.url), 'utf8')

describe('curriculum structure layout contract', () => {
  it('allocates the summary and structure card as two rows inside one viewport', () => {
    expect(stylesheet).toMatch(/\.curriculum-structure-view\s*\{[\s\S]*grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)/u)
    expect(stylesheet).toMatch(/\.curriculum-structure-shell\s*\{[\s\S]*height:\s*auto/u)
    expect(stylesheet).toMatch(/\.curriculum-structure-shell\s*\{[\s\S]*min-height:\s*0/u)
  })

  it('keeps the directory and detail panes as independent scroll owners', () => {
    expect(stylesheet).toMatch(/\.curriculum-tree-scroll\s*\{[\s\S]*overflow-y:\s*auto[\s\S]*overscroll-behavior:\s*contain/u)
    expect(stylesheet).toMatch(/\.curriculum-node-detail\s*\{[\s\S]*overflow-y:\s*auto[\s\S]*overflow-x:\s*hidden[\s\S]*overscroll-behavior:\s*contain/u)
  })
})
