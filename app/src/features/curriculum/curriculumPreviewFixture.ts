import type { CurriculumImportJob } from '../../domain/horizon'

const now = 1_754_000_000_000
const nodes = [
  { id: 'chapter-1', textbook_id: 'math-book', subject: '数学', canonical_name: '第一章 有理数', node_type: 'chapter', parent_id: null, path: '第一章 有理数', sort_order: 0, curriculum_version: 1, description: null, source_page_start: 1, source_page_end: 24, evidence_text: '目录：第一章 有理数', source_path: '/preview/math.pdf', extraction_method: 'pdf_text', confidence: .96, verification_status: 'user_verified', merged_into_id: null, archived_at: null, created_at: now, updated_at: now },
  { id: 'section-1', textbook_id: 'math-book', subject: '数学', canonical_name: '1.1 正数和负数', node_type: 'section', parent_id: 'chapter-1', path: '第一章 有理数/1.1 正数和负数', sort_order: 0, curriculum_version: 1, description: null, source_page_start: 2, source_page_end: 5, evidence_text: '1.1 正数和负数：用正负数表示相反意义的量。', source_path: '/preview/math.pdf', extraction_method: 'pdf_text', confidence: .93, verification_status: 'user_verified', merged_into_id: null, archived_at: null, created_at: now, updated_at: now },
  { id: 'knowledge-1', textbook_id: 'math-book', subject: '数学', canonical_name: '相反数', node_type: 'knowledge', parent_id: 'section-1', path: '第一章 有理数/1.1 正数和负数/相反数', sort_order: 0, curriculum_version: 1, description: '理解只有符号不同的两个数互为相反数。', source_page_start: 4, source_page_end: 4, evidence_text: '只有符号不同的两个数叫做互为相反数，0 的相反数是 0。', source_path: '/preview/math.pdf', extraction_method: 'pdf_text', confidence: .72, verification_status: 'needs_review', merged_into_id: null, archived_at: null, created_at: now, updated_at: now },
  { id: 'section-2', textbook_id: 'math-book', subject: '数学', canonical_name: '1.2 有理数', node_type: 'section', parent_id: 'chapter-1', path: '第一章 有理数/1.2 有理数', sort_order: 1, curriculum_version: 1, description: null, source_page_start: 6, source_page_end: 12, evidence_text: '有理数的分类与数轴表示。', source_path: '/preview/math.pdf', extraction_method: 'pdf_text', confidence: .88, verification_status: 'needs_review', merged_into_id: null, archived_at: null, created_at: now, updated_at: now },
  { id: 'chapter-2', textbook_id: 'math-book', subject: '数学', canonical_name: '第二章 整式的加减', node_type: 'chapter', parent_id: null, path: '第二章 整式的加减', sort_order: 1, curriculum_version: 1, description: null, source_page_start: 25, source_page_end: 50, evidence_text: '目录：第二章 整式的加减', source_path: '/preview/math.pdf', extraction_method: 'pdf_text', confidence: .9, verification_status: 'needs_review', merged_into_id: null, archived_at: null, created_at: now, updated_at: now },
]

const tags = [
  { id: 'tag-opposite', subject: '数学', tag_type: 'knowledge', canonical_name: '相反数', aliases: '互为相反数', description: '数轴与相反数概念', parent_id: null, knowledge_node_id: 'knowledge-1', textbook_id: 'math-book', source: 'textbook', taxonomy_version: 1, verification_status: 'user_verified', lifecycle_status: 'active', method_class: null, merged_into_id: null, archived_at: null, created_at: now, updated_at: now, problem_count: 8 },
  { id: 'tag-number-line', subject: '数学', tag_type: 'knowledge', canonical_name: '数轴表示', aliases: '', description: null, parent_id: null, knowledge_node_id: 'section-2', textbook_id: 'math-book', source: 'model', taxonomy_version: 1, verification_status: 'needs_review', lifecycle_status: 'candidate', method_class: null, merged_into_id: null, archived_at: null, created_at: now, updated_at: now, problem_count: 2 },
  { id: 'tag-classify', subject: '数学', tag_type: 'method', canonical_name: '分类讨论', aliases: '分情况讨论', description: '按条件拆分情况求解', parent_id: null, knowledge_node_id: null, textbook_id: null, source: 'user', taxonomy_version: 2, verification_status: 'user_verified', lifecycle_status: 'active', method_class: 'core', merged_into_id: null, archived_at: null, created_at: now, updated_at: now, problem_count: 13 },
  { id: 'tag-transform', subject: '数学', tag_type: 'method', canonical_name: '等价变形', aliases: '', description: null, parent_id: null, knowledge_node_id: null, textbook_id: null, source: 'model', taxonomy_version: 1, verification_status: 'needs_review', lifecycle_status: 'candidate', method_class: 'optional', merged_into_id: null, archived_at: null, created_at: now, updated_at: now, problem_count: 5 },
  { id: 'tag-number-model', subject: '数学', tag_type: 'model', canonical_name: '数轴上的距离关系', aliases: '', description: '由点的位置关系求距离或绝对值', parent_id: null, knowledge_node_id: null, textbook_id: null, source: 'user', taxonomy_version: 1, verification_status: 'user_verified', lifecycle_status: 'active', method_class: null, merged_into_id: null, archived_at: null, created_at: now, updated_at: now, problem_count: 7 },
  { id: 'tag-sign-error', subject: '数学', tag_type: 'error', canonical_name: '符号判断错误', aliases: '', description: null, parent_id: null, knowledge_node_id: null, textbook_id: null, source: 'model', taxonomy_version: 1, verification_status: 'needs_review', lifecycle_status: 'candidate', method_class: null, merged_into_id: null, archived_at: null, created_at: now, updated_at: now, problem_count: 4 },
]

function importJob(state: string): CurriculumImportJob {
  const recognition = {
    title: { value: '义务教育教科书 数学 七年级上册', confidence: .97, evidence: '封面标题与目录页' },
    subject: { value: '数学', confidence: .99, evidence: '数学 七年级上册' },
    grade: { value: '七年级', confidence: .92, evidence: '七年级' },
    volume: { value: '上册', confidence: .94, evidence: '上册' },
    publisher: { value: '人民教育出版社', confidence: .87, evidence: '版权页' },
    edition: { value: null, confidence: .41, evidence: '版权页文字不完整' },
    overallConfidence: .84,
    warnings: ['版本信息识别不完整，建议确认。'],
  }
  const extraction = { pageCount: 128, extractionMethod: 'pdf_text' as const, pages: [], outline: [
    { title: '第一章 有理数', level: 1, pageNumber: 1, evidenceText: '第一章 有理数', confidence: .95 },
    { title: '1.1 正数和负数', level: 2, pageNumber: 2, evidenceText: '1.1 正数和负数', confidence: .94 },
    { title: '相反数', level: 3, pageNumber: 4, evidenceText: '相反数', confidence: .71 },
    { title: '第二章 整式的加减', level: 1, pageNumber: 25, evidenceText: '第二章 整式的加减', confidence: .9 },
  ], warnings: [] }
  const status = state === 'import-failed' ? 'ai_failed_recoverable' : state === 'import-processing' ? 'ai_analyzing_structure' : 'waiting_for_review'
  return {
    id: 'preview-import', originalSourcePath: '/preview/math.pdf', sourcePath: '/preview/math.pdf', sourceName: '七年级数学上册.pdf', sourceType: 'pdf', contentHash: 'preview', status,
    stage: status === 'ai_failed_recoverable' ? 'ai_analyzing_structure' : status, pageCount: 128,
    extractionMethod: 'pdf_text', extraction, recognition, provider: 'preview', model: 'preview', promptVersion: 'v1', schemaVersion: 'v1', inputHash: 'preview', rawOutput: '', errorMessage: status === 'ai_failed_recoverable' ? '模拟的 AI 请求错误，可从安全阶段重试。' : null, providerTaskId: null, structure: extraction.outline, tags: null, audit: null, createdAt: now, updatedAt: now,
  }
}

function relabelBatch(state: string) {
  if (!state.startsWith('relabel-')) return null
  const paused = state === 'relabel-paused'
  const completed = state === 'relabel-completed'
  return {
    id: 'preview-relabel', subject: '数学', status: completed ? 'completed' : paused ? 'processing' : 'processing',
    total_count: 18, completed_count: completed ? 17 : paused ? 7 : 8, failed_count: completed ? 1 : 1,
    paused_at: paused ? now - 12_000 : null, created_at: now - 70_000, updated_at: now,
    completed_at: completed ? now - 5_000 : null,
  }
}

export function installCurriculumPreviewFixture(state: string) {
  if (typeof window === 'undefined') return
  const fixtureState = state === 'empty' ? 'empty' : state
  const imports = state.startsWith('import-') ? [importJob(state)] : []
  const currentBatch = relabelBatch(state)
  const hasTextbook = fixtureState !== 'empty'
  const hasTags = state !== 'tags-empty'
  const internals = {
    invoke: async (command: string, args: Record<string, unknown> = {}) => {
      if (command === 'db_execute') return { rowsAffected: 1, lastInsertId: 0 }
      if (command !== 'db_select') throw new Error(`预览不支持 ${command}`)
      const sql = String(args.sql || '')
      const params = Array.isArray(args.params) ? args.params : []
      if (sql.includes('SELECT subject FROM textbooks')) return hasTextbook ? [{ subject: '数学' }] : []
      if (sql.includes('FROM textbooks') && sql.includes('archived_at IS NULL')) return hasTextbook ? [{ id: 'math-book', subject: '数学', title: '义务教育教科书 数学 七年级上册', grade: '七年级', volume: '上册', publisher: '人民教育出版社', edition: '2024 年版', source_type: 'pdf', source_path: '/preview/math.pdf', content_hash: 'preview', extraction_status: 'needs_review', extraction_method: 'pdf_text', is_current: 1, archived_at: null, created_at: now, updated_at: now }] : []
      if (sql.includes('FROM knowledge_nodes') && sql.includes('ORDER BY path')) return hasTextbook ? nodes : []
      if (sql.includes('FROM knowledge_edges')) return [{ id: 'edge-1', subject: '数学', from_node_id: 'knowledge-1', to_node_id: 'section-2', relation_type: 'prerequisite_of', confidence: .8, source: 'textbook', verification_status: 'needs_review' }]
      if (sql.includes('curriculum_import_jobs')) {
        if (sql.includes('WHERE id')) return imports.filter((job) => job.id === params[0]).map((job) => ({
          id: job.id, original_source_path: job.originalSourcePath, source_path: job.sourcePath, source_name: job.sourceName, source_type: job.sourceType, content_hash: job.contentHash, status: job.status, resume_stage: job.stage, page_count: job.pageCount, extraction_method: job.extractionMethod, extraction_json: JSON.stringify(job.extraction), metadata_json: JSON.stringify(job.recognition), structure_json: JSON.stringify(job.structure), tags_json: null, audit_json: null, provider: job.provider, model: job.model, provider_task_id: null, prompt_version: job.promptVersion, schema_version: job.schemaVersion, input_hash: job.inputHash, raw_output: job.rawOutput, error_message: job.errorMessage, created_at: now, updated_at: now,
        }))
        return imports.map((job) => ({ id: job.id, original_source_path: job.originalSourcePath, source_path: job.sourcePath, source_name: job.sourceName, source_type: job.sourceType, content_hash: job.contentHash, status: job.status, resume_stage: job.stage, page_count: job.pageCount, extraction_method: job.extractionMethod, extraction_json: JSON.stringify(job.extraction), metadata_json: JSON.stringify(job.recognition), structure_json: JSON.stringify(job.structure), tags_json: null, audit_json: null, provider: job.provider, model: job.model, provider_task_id: null, prompt_version: job.promptVersion, schema_version: job.schemaVersion, input_hash: job.inputHash, raw_output: job.rawOutput, error_message: job.errorMessage, created_at: now, updated_at: now }))
      }
      if (sql.includes('SELECT td.tag_type, count(*)')) return hasTags ? [{ tag_type: 'knowledge', count: 2 }, { tag_type: 'method', count: 2 }, { tag_type: 'model', count: 1 }, { tag_type: 'error', count: 1 }] : []
      if (sql.includes('SELECT count(*) AS count FROM (')) return [{ count: hasTags ? 5 : 0 }]
      if (sql.includes('FROM problem_tags WHERE')) return hasTags ? [{ id: 'review-1', problem_id: 'problem-4', candidate_name: '绝对值比较', confidence: .56, evidence: '题目要求比较点到原点的距离', mapping_status: 'candidate', verification_status: 'needs_review' }] : []
      if (sql.includes('mapping_status !=')) return [{ count: hasTags ? 3 : 0 }]
      if (sql.includes('count(DISTINCT problem_id)')) return [{ count: hasTags ? 18 : 0 }]
      if (sql.includes('count(*) AS count FROM problems')) return [{ count: 18 }]
      if (sql.includes('FROM tag_definitions td')) {
        const type = params[1]
        return hasTags ? tags.filter((tag) => tag.tag_type === type) : []
      }
      if (sql.includes('FROM tag_relabel_batches')) {
        if (!currentBatch) return []
        if (sql.includes('SELECT id')) return [{ id: currentBatch.id }]
        return [currentBatch]
      }
      return []
    },
    convertFileSrc: (path: string) => path,
    transformCallback: () => 0,
    unregisterCallback: () => {},
  }
  ;(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = internals
}
