// @ts-expect-error Vitest executes this source contract in Node.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const database = readFileSync(new URL('./database.ts', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../../src-tauri/migrations/0061_review_v3_preparation.sql', import.meta.url), 'utf8')

describe('mistake capture evidence contract', () => {
  it('keeps one original mistake time and replaces only the controlled-tag revision on re-analysis', () => {
    expect(migration).toContain('problem_id TEXT NOT NULL UNIQUE')
    expect(database).toContain('ON CONFLICT(problem_id) DO UPDATE SET tags_revision_hash=excluded.tags_revision_hash')
    const conflict = database.slice(database.indexOf('ON CONFLICT(problem_id) DO UPDATE SET tags_revision_hash'))
    expect(conflict.slice(0, 300)).not.toContain('captured_at=')
    expect(database).toContain('Number(source?.created_at ?? now)')
  })
})
