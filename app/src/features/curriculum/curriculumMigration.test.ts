import { describe, expect, it } from 'vitest'
// @ts-expect-error Vitest runs in Node; the application tsconfig intentionally excludes Node globals.
import { readFileSync } from 'node:fs'

const migration = readFileSync(new URL('../../../src-tauri/migrations/0024_flatten_curriculum_tree.sql', import.meta.url), 'utf8')

describe('curriculum tree compatibility migration', () => {
  it('is append-only, transactional, and creates a review-only fallback chapter', () => {
    // 0024 是 codex/horizon-quality-upgrade 分支的历史迁移，用户库已应用并
    // 记录了 checksum，必须逐字节保留（含自带事务）；它不经过 sqlx Migrator
    // 执行，而是由 Rust 侧 migrate_embedded_schema 剥离最外层 BEGIN/COMMIT 后运行。
    expect(migration).toContain('BEGIN IMMEDIATE;')
    expect(migration).toContain('COMMIT;')
    expect(migration).toContain('ADD COLUMN is_unclassified')
    expect(migration).toContain("'curriculum-unclassified-' || textbook.id")
    expect(migration).toContain("canonical_name = '待归类知识点'")
  })

  it('converts every active legacy non-chapter node to a direct knowledge child', () => {
    expect(migration).toContain("node_type = CASE WHEN node_type = 'chapter' THEN 'chapter' ELSE 'knowledge' END")
    expect(migration).toContain('parent_id = CASE')
    expect(migration).toContain('axiom_node_chapter')
    expect(migration).toContain('trg_knowledge_node_two_level_insert')
    expect(migration).toContain('trg_knowledge_node_two_level_update')
    expect(migration).toContain('idx_relabel_one_active_subject')
    expect(migration).toContain('section/detail nodes can be converted')
  })

  it('moves all known references before archiving duplicate source rows', () => {
    expect(migration).toContain('UPDATE tag_definitions')
    expect(migration).toContain('UPDATE tag_definition_revisions')
    expect(migration).toContain('curriculum_tag_knowledge_links')
    expect(migration).toContain('knowledge_edges')
    expect(migration).toContain('merged_into_id')
  })
})
