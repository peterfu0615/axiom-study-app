// @ts-expect-error Vitest executes this contract in Node, while the app tsconfig is browser-only.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('problem recovery contract', () => {
  it('soft deletes saved problems without deleting evidence or media', () => {
    const source = readFileSync(new URL('./database.ts', import.meta.url), 'utf8')
    const start = source.indexOf('export async function deleteProblem')
    const end = source.indexOf('export async function restoreProblem', start)
    const deletion = source.slice(start, end)
    expect(deletion).toContain('SET deleted_at=$1')
    expect(deletion).not.toContain('DELETE FROM problems')
    expect(deletion).not.toContain('removeProblemImage')
    expect(source).toContain('SET deleted_at=NULL')
  })

  it('exposes a recoverable trash view in the library', () => {
    const source = readFileSync(new URL('../features/library/ProblemLibrary.tsx', import.meta.url), 'utf8')
    expect(source).toContain("type LibraryView = 'active' | 'archived' | 'trash'")
    expect(source).toContain('恢复到错题库')
    expect(source).toContain('移入回收站的错题会保留复习记录与媒体，可随时恢复')
  })

  it('hydrates library search and filter metadata for list and detail reads', () => {
    const source = readFileSync(new URL('./database.ts', import.meta.url), 'utf8')
    expect(source).toContain('const SAVED_PROBLEM_LIBRARY_COLUMNS')
    expect(source.match(/SELECT \$\{SAVED_PROBLEM_LIBRARY_COLUMNS\}/g)).toHaveLength(3)
    expect(source).toContain('AS library_search_text')
    expect(source).toContain('AS library_mastery_estimate')
    expect(source).toContain('AS library_next_review_at')
  })
})
