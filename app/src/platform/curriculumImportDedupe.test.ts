import { beforeEach, describe, expect, it, vi } from 'vitest'

// End-to-end duplicate protection for knowledge tree imports (checkpoint 4).
//
// The fake DB below simulates exactly the SQLite behaviour the import path
// touches, including migration 0026's partial unique index
// (textbook_id, ifnull(parent_id,''), lower(trim(canonical_name)))
// WHERE archived_at IS NULL AND merged_into_id IS NULL.  If the JS reuse
// logic ever stops resolving existing siblings, the fake throws the same
// UNIQUE constraint error the real database would, so the test fails loudly
// instead of silently creating duplicate rows.

interface FakeNode {
  id: string
  textbook_id: string
  parent_id: string | null
  canonical_name: string
  node_type: string
  created_at: number
}

const fake = vi.hoisted(() => {
  const state = {
    nodes: [] as Array<{
      id: string
      textbook_id: string
      parent_id: string | null
      canonical_name: string
      node_type: string
      created_at: number
    }>,
    pages: 0,
    jobs: [] as Array<Record<string, unknown>>,
    nodeInsertStatements: 0,
    siblingLoadStatements: 0,
    clock: 0,
  }
  return state
})

const normalize = (value: string) => value.trim().toLowerCase()

function assertSiblingUnique(
  textbookId: string,
  parentId: string | null,
  canonicalName: string,
) {
  const collision = fake.nodes.find(
    (node) =>
      node.textbook_id === textbookId &&
      (node.parent_id ?? '') === (parentId ?? '') &&
      normalize(node.canonical_name) === normalize(canonicalName),
  )
  if (collision) {
    throw new Error(
      'UNIQUE constraint failed: idx_knowledge_nodes_sibling_name_v2',
    )
  }
}

function pushNode(node: FakeNode) {
  assertSiblingUnique(node.textbook_id, node.parent_id, node.canonical_name)
  fake.clock += 1
  fake.nodes.push({ ...node, created_at: fake.clock })
}

function jobRow(outline: Array<{ title: string; level: number }>) {
  return {
    id: 'job-1',
    original_source_path: '/tmp/math-book.pdf',
    source_path: '/tmp/math-book.pdf',
    source_name: 'math-book.pdf',
    source_type: 'pdf',
    content_hash: 'hash-1',
    status: 'waiting_for_review',
    resume_stage: 'waiting_for_review',
    page_count: 2,
    extraction_method: 'pdf_text',
    extraction_json: JSON.stringify({
      pageCount: 2,
      extractionMethod: 'pdf_text',
      pages: [
        { pageNumber: 1, evidenceText: 'p1', extractionMethod: 'pdf_text', confidence: 1 },
        { pageNumber: 2, evidenceText: 'p2', extractionMethod: 'pdf_text', confidence: 1 },
      ],
      outline: outline.map((item, index) => ({
        ...item,
        pageNumber: index + 1,
        evidenceText: '',
        confidence: 1,
      })),
      warnings: [],
    }),
    metadata_json: '',
    provider: '',
    model: '',
    prompt_version: '',
    schema_version: '',
    input_hash: '',
    raw_output: '',
    error_message: '',
    provider_task_id: '',
    structure_json: '',
    tags_json: '',
    audit_json: '',
    progress_current: 1,
    progress_total: 1,
    progress_fraction: 1,
    progress_label: '',
    created_at: 1,
    updated_at: 1,
  }
}

const ok = { rowsAffected: 1, lastInsertId: 0 }

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (command: string, args?: { sql?: string; params?: unknown[] }) => {
    const sql = (args?.sql ?? '').trim()
    const params = (args?.params ?? []) as unknown[]
    if (command === 'db_select') {
      if (sql.startsWith('SELECT * FROM curriculum_import_jobs WHERE id = $1')) {
        return fake.jobs.filter((job) => job.id === params[0])
      }
      if (sql.startsWith('SELECT version FROM taxonomy_versions')) {
        return [{ version: 1 }]
      }
      if (sql.startsWith('SELECT id, parent_id, canonical_name, created_at FROM knowledge_nodes')) {
        fake.siblingLoadStatements += 1
        return fake.nodes
          .filter((node) => node.textbook_id === params[0])
          .map((node) => ({
            id: node.id,
            parent_id: node.parent_id,
            canonical_name: node.canonical_name,
            created_at: node.created_at,
          }))
      }
      if (sql.startsWith('SELECT id, tag_type, canonical_name FROM tag_definitions')) {
        return []
      }
      return []
    }
    if (command !== 'db_execute') throw new Error(`unexpected invoke: ${command}`)
    if (sql === 'BEGIN IMMEDIATE' || sql === 'COMMIT' || sql === 'ROLLBACK') return ok
    if (sql.startsWith('UPDATE curriculum_import_jobs')) return ok
    if (sql.startsWith('DELETE FROM curriculum_import_jobs')) {
      fake.jobs = fake.jobs.filter((job) => job.id !== params[0])
      return ok
    }
    if (sql.startsWith('INSERT INTO textbooks')) return ok
    if (sql.startsWith('INSERT INTO textbook_pages')) {
      fake.pages += params.length / 10
      return ok
    }
    if (sql.startsWith('INSERT INTO knowledge_nodes')) {
      fake.nodeInsertStatements += 1
      const isChapter = sql.includes("'chapter'")
      const paramCount = isChapter ? 15 : 16
      expect(params.length % paramCount).toBe(0)
      for (let start = 0; start < params.length; start += paramCount) {
        const row = params.slice(start, start + paramCount)
        pushNode({
          id: String(row[0]),
          textbook_id: String(row[1]),
          canonical_name: String(row[3]),
          parent_id: isChapter ? null : String(row[4]),
          node_type: isChapter ? 'chapter' : 'knowledge',
          created_at: 0,
        })
      }
      return ok
    }
    return ok
  }),
}))

vi.mock('./native', () => ({
  completeCurriculumImportAttempt: vi.fn(),
  bindRelabelBatchItemModelRun: vi.fn(),
  claimRelabelBatchItem: vi.fn(),
  createCurriculumImportAttempt: vi.fn(),
  bulkReviewCurriculumTags: vi.fn(),
  failCurriculumImportAttempt: vi.fn(),
  updateCurriculumImportProgress: vi.fn(),
  importTextbookSource: vi.fn(),
  cleanupTextbookImportTemp: vi.fn(),
  mergeKnowledgeNodes: vi.fn(),
  mergeTagDefinitions: vi.fn(),
  promoteTextbookSource: vi.fn(async (path: string) => path),
  recoverRelabelBatchItems: vi.fn(),
  removeTextbookSource: vi.fn(),
  verifyTextbookSource: vi.fn(),
}))

import { confirmCurriculumImportJob } from './horizonDatabase'

// Force both imports to target the same textbook row: the first id() call in
// each confirm flow is the textbook id, so pinning it simulates re-importing
// into an existing textbook (the scenario migration 0026 protects).
let forcedTextbookId: string | null = null
let idCounter = 0
const asUuid = (value: string) => value as ReturnType<typeof crypto.randomUUID>
vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
  if (forcedTextbookId) {
    const value = forcedTextbookId
    forcedTextbookId = null
    return asUuid(value)
  }
  idCounter += 1
  return asUuid(`id-${idCounter}`)
})

const baseOutline = [
  { title: '第十六章 二次根式', level: 1 },
  { title: '二次根式的加减', level: 2 },
  { title: 'Unit 1 Fractions', level: 1 },
  { title: 'Adding Fractions', level: 2 },
]

const variantOutline = [
  // 空白变体：前后空白与全角空格
  { title: ' 第十六章 二次根式 ', level: 1 },
  { title: '二次根式的加减\u3000', level: 2 },
  // 大小写变体 + 前后空白
  { title: ' unit 1 fractions ', level: 1 },
  { title: ' ADDING fractions ', level: 2 },
]

describe('knowledge tree duplicate protection (migration 0026)', () => {
  beforeEach(() => {
    fake.nodes.length = 0
    fake.pages = 0
    fake.jobs.length = 0
    fake.nodeInsertStatements = 0
    fake.siblingLoadStatements = 0
    fake.clock = 0
    forcedTextbookId = null
  })

  it('reuses existing chapters and points on re-import instead of duplicating or failing', async () => {
    fake.jobs.push(jobRow(baseOutline))
    forcedTextbookId = 'textbook-1'
    await confirmCurriculumImportJob('job-1', { subject: '数学', title: '八年级下册' })

    const firstImportNodes = fake.nodes.map((node) => ({ ...node }))
    expect(firstImportNodes).toHaveLength(4)
    expect(fake.nodeInsertStatements).toBe(2) // 章节一批 + 知识点一批

    // 同一教材重复导入同一批章节/知识点（大小写/空白变体）
    fake.jobs.push(jobRow(variantOutline))
    forcedTextbookId = 'textbook-1'
    await confirmCurriculumImportJob('job-1', { subject: '数学', title: '八年级下册' })

    // 没有新建任何节点，也没有触发唯一索引错误
    expect(fake.nodes).toHaveLength(4)
    expect(fake.nodeInsertStatements).toBe(2) // 第二次导入零插入
    expect(fake.nodes.map((node) => node.id)).toEqual(firstImportNodes.map((node) => node.id))
    // 复用依靠每次导入一次（而不是每节点一次）的 sibling 预载
    expect(fake.siblingLoadStatements).toBe(2)
  })

  it('keeps chapter-level and point-level reuse scoped to their parent', async () => {
    fake.jobs.push(jobRow(baseOutline))
    forcedTextbookId = 'textbook-1'
    await confirmCurriculumImportJob('job-1', { subject: '数学', title: '八年级下册' })
    const chapterIds = fake.nodes
      .filter((node) => node.node_type === 'chapter')
      .map((node) => node.id)
    const points = fake.nodes.filter((node) => node.node_type === 'knowledge')
    // 两个知识点分别挂在两个章节下，同名知识点在不同章节中允许并存
    expect(new Set(points.map((point) => point.parent_id)).size).toBe(2)
    expect(chapterIds).toHaveLength(2)

    fake.jobs.push(jobRow(baseOutline))
    forcedTextbookId = 'textbook-1'
    await confirmCurriculumImportJob('job-1', { subject: '数学', title: '八年级下册' })
    expect(fake.nodes).toHaveLength(4)
    expect(
      fake.nodes.filter((node) => node.node_type === 'knowledge').map((point) => point.parent_id),
    ).toEqual(points.map((point) => point.parent_id))
  })
})

