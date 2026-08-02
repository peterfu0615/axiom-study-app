import type { CurriculumImportJob } from '../../domain/horizon'

export const CURRICULUM_PREVIEW_STATES = [
  'review-empty', 'review-many', 'review-filtered',
  'review-bulk-approve-confirm', 'review-bulk-reject-confirm',
  'review-row-loading', 'review-unmapped',
  'bulk-review-success', 'tag-table-centered', 'custom-select-open',
  'structure-long-tree', 'structure-long-detail', 'structure-820x620',
  'structure-chapter-knowledge', 'structure-unclassified-knowledge',
  'ai-missing-difficulty-score', 'relabel-running-single-card', 'relabel-failed-retry',
  'import-processing-wide',
] as const

const now = 1_754_000_000_000
const nodes = [
  { id: 'chapter-1', textbook_id: 'math-book', subject: '数学', canonical_name: '第一章 有理数', node_type: 'chapter', parent_id: null, path: '第一章 有理数', sort_order: 0, curriculum_version: 1, description: null, source_page_start: 1, source_page_end: 24, evidence_text: '目录：第一章 有理数', source_path: '/preview/math.pdf', extraction_method: 'pdf_text', confidence: .96, verification_status: 'user_verified', is_unclassified: 0, merged_into_id: null, archived_at: null, created_at: now, updated_at: now },
  { id: 'knowledge-1', textbook_id: 'math-book', subject: '数学', canonical_name: '相反数', node_type: 'knowledge', parent_id: 'chapter-1', path: '第一章 有理数/相反数', sort_order: 0, curriculum_version: 1, description: '理解只有符号不同的两个数互为相反数。', source_page_start: 4, source_page_end: 4, evidence_text: '只有符号不同的两个数叫做互为相反数，0 的相反数是 0。', source_path: '/preview/math.pdf', extraction_method: 'pdf_text', confidence: .72, verification_status: 'needs_review', is_unclassified: 0, merged_into_id: null, archived_at: null, created_at: now, updated_at: now },
  { id: 'knowledge-2', textbook_id: 'math-book', subject: '数学', canonical_name: '数轴表示', node_type: 'knowledge', parent_id: 'chapter-1', path: '第一章 有理数/数轴表示', sort_order: 1, curriculum_version: 1, description: null, source_page_start: 6, source_page_end: 12, evidence_text: '有理数的分类与数轴表示。', source_path: '/preview/math.pdf', extraction_method: 'pdf_text', confidence: .88, verification_status: 'needs_review', is_unclassified: 0, merged_into_id: null, created_at: now, updated_at: now },
  { id: 'chapter-2', textbook_id: 'math-book', subject: '数学', canonical_name: '第二章 整式的加减', node_type: 'chapter', parent_id: null, path: '第二章 整式的加减', sort_order: 1, curriculum_version: 1, description: null, source_page_start: 25, source_page_end: 50, evidence_text: '目录：第二章 整式的加减', source_path: '/preview/math.pdf', extraction_method: 'pdf_text', confidence: .9, verification_status: 'needs_review', is_unclassified: 0, merged_into_id: null, created_at: now, updated_at: now },
]

function previewStructureNodes(state: string) {
  if (!state.startsWith('structure-long') && state !== 'structure-820x620' && state !== 'structure-unclassified-knowledge') return nodes
  const longEvidence = '本节点用于验证详情栏在较短窗口下的独立滚动。'.repeat(16)
  const base = state === 'structure-long-detail' || state === 'structure-820x620'
    ? nodes.map((node, index) => index === 0 ? { ...node, description: longEvidence, evidence_text: longEvidence } : node)
    : nodes
  const extra = state === 'structure-unclassified-knowledge' ? [] : Array.from({ length: 12 }, (_, chapterIndex) => {
    const chapterNumber = chapterIndex + 3
    const chapterId = `long-chapter-${chapterNumber}`
    const chapter = {
      id: chapterId, textbook_id: 'math-book', subject: '数学', canonical_name: `第${chapterNumber}章 综合练习`, node_type: 'chapter', parent_id: null,
      path: `第${chapterNumber}章 综合练习`, sort_order: chapterNumber, source_page_start: 50 + chapterIndex * 12, source_page_end: 61 + chapterIndex * 12,
      evidence_text: `目录：第${chapterNumber}章 综合练习`, source_path: '/preview/math.pdf', extraction_method: 'pdf_text', confidence: .9,
      verification_status: 'needs_review', merged_into_id: null, archived_at: null, created_at: now, updated_at: now,
    }
    const children = Array.from({ length: 5 }, (_, knowledgeIndex) => {
      const knowledgeNumber = knowledgeIndex + 1
      const knowledgeId = `${chapterId}-knowledge-${knowledgeNumber}`
      return {
        id: knowledgeId, textbook_id: 'math-book', subject: '数学', canonical_name: `${chapterNumber}.${knowledgeNumber} 综合方法`, node_type: 'knowledge', parent_id: chapterId,
        path: `${chapter.path}/${chapterNumber}.${knowledgeNumber} 综合方法`, sort_order: knowledgeIndex, source_page_start: chapter.source_page_start + knowledgeIndex,
        source_page_end: chapter.source_page_start + knowledgeIndex + 2, evidence_text: `章节依据：${chapterNumber}.${knowledgeNumber} 综合方法`, source_path: '/preview/math.pdf',
        extraction_method: 'pdf_text', confidence: .86, verification_status: 'needs_review', is_unclassified: 0, merged_into_id: null, archived_at: null, created_at: now, updated_at: now,
      }
    })
    return [chapter, ...children]
  }).flat()
  if (state === 'structure-unclassified-knowledge') {
    return [...base, {
      id: 'unclassified-chapter', textbook_id: 'math-book', subject: '数学', canonical_name: '待归类知识点', node_type: 'chapter', parent_id: null,
      path: '待归类知识点', sort_order: 99, curriculum_version: 1, description: '暂时无法从目录或页码确定归属的知识点。', source_page_start: null, source_page_end: null,
      evidence_text: '结构兼容迁移', source_path: '/preview/math.pdf', extraction_method: 'manual', confidence: 0, verification_status: 'needs_review', is_unclassified: 1,
      merged_into_id: null, archived_at: null, created_at: now, updated_at: now,
    }, {
      id: 'unclassified-knowledge', textbook_id: 'math-book', subject: '数学', canonical_name: '待确认的知识主题', node_type: 'knowledge', parent_id: 'unclassified-chapter',
      path: '待归类知识点/待确认的知识主题', sort_order: 0, curriculum_version: 1, description: null, source_page_start: null, source_page_end: null,
      evidence_text: '无法从现有目录定位', source_path: '/preview/math.pdf', extraction_method: 'pdf_text', confidence: .35, verification_status: 'needs_review', is_unclassified: 0,
      merged_into_id: null, archived_at: null, created_at: now, updated_at: now,
    }]
  }
  return [...base, ...extra]
}

const tags = [
  { id: 'tag-opposite', subject: '数学', tag_type: 'knowledge', canonical_name: '相反数', aliases: '互为相反数', description: '数轴与相反数概念', parent_id: null, knowledge_node_id: 'knowledge-1', textbook_id: 'math-book', source: 'textbook', taxonomy_version: 1, verification_status: 'user_verified', lifecycle_status: 'active', method_class: null, merged_into_id: null, archived_at: null, created_at: now, updated_at: now, problem_count: 8 },
  { id: 'tag-number-line', subject: '数学', tag_type: 'knowledge', canonical_name: '数轴表示', aliases: '', description: null, parent_id: null, knowledge_node_id: 'knowledge-2', textbook_id: 'math-book', source: 'model', taxonomy_version: 1, verification_status: 'needs_review', lifecycle_status: 'candidate', method_class: null, merged_into_id: null, archived_at: null, created_at: now, updated_at: now, problem_count: 2 },
  { id: 'tag-classify', subject: '数学', tag_type: 'method', canonical_name: '分类讨论', aliases: '分情况讨论', description: '按条件拆分情况求解', parent_id: null, knowledge_node_id: null, textbook_id: null, source: 'user', taxonomy_version: 2, verification_status: 'user_verified', lifecycle_status: 'active', method_class: 'core', merged_into_id: null, archived_at: null, created_at: now, updated_at: now, problem_count: 13 },
  { id: 'tag-transform', subject: '数学', tag_type: 'method', canonical_name: '等价变形', aliases: '', description: null, parent_id: null, knowledge_node_id: null, textbook_id: null, source: 'model', taxonomy_version: 1, verification_status: 'needs_review', lifecycle_status: 'candidate', method_class: 'optional', merged_into_id: null, archived_at: null, created_at: now, updated_at: now, problem_count: 5 },
  { id: 'tag-number-model', subject: '数学', tag_type: 'model', canonical_name: '数轴上的距离关系', aliases: '', description: '由点的位置关系求距离或绝对值', parent_id: null, knowledge_node_id: null, textbook_id: null, source: 'user', taxonomy_version: 1, verification_status: 'user_verified', lifecycle_status: 'active', method_class: null, merged_into_id: null, archived_at: null, created_at: now, updated_at: now, problem_count: 7 },
  { id: 'tag-sign-error', subject: '数学', tag_type: 'error', canonical_name: '符号判断错误', aliases: '', description: null, parent_id: null, knowledge_node_id: null, textbook_id: null, source: 'model', taxonomy_version: 1, verification_status: 'needs_review', lifecycle_status: 'candidate', method_class: null, merged_into_id: null, archived_at: null, created_at: now, updated_at: now, problem_count: 4 },
]

const reviewItems = [
  { id: 'review-mapped', problem_id: 'problem-1', subject: '数学', tag_type: 'knowledge', tag_id: 'tag-number-line', candidate_name: null, current_target_name: '数轴表示', confidence: .76, evidence: '题目要求比较点到原点的距离。', mapping_status: 'mapped', verification_status: 'needs_review', is_locked: 0, source: 'model', problem_textbook_id: 'math-book', matched_textbook_title: '义务教育教科书 数学 七年级上册', superseded_at: null, updated_at: now },
  { id: 'review-unmapped', problem_id: 'problem-2', subject: '数学', tag_type: 'knowledge', tag_id: null, candidate_name: '绝对值比较', current_target_name: null, confidence: .56, evidence: '题干出现距离与绝对值关系。', mapping_status: 'candidate', verification_status: 'needs_review', is_locked: 0, source: 'model', problem_textbook_id: 'math-book', matched_textbook_title: '义务教育教科书 数学 七年级上册', superseded_at: null, updated_at: now },
  { id: 'review-rejected', problem_id: 'problem-3', subject: '数学', tag_type: 'knowledge', tag_id: null, candidate_name: '无关候选', current_target_name: null, confidence: .21, evidence: '依据不足。', mapping_status: 'rejected', verification_status: 'rejected', is_locked: 1, source: 'user', problem_textbook_id: 'math-book', matched_textbook_title: '义务教育教科书 数学 七年级上册', superseded_at: null, updated_at: now },
  { id: 'review-method', problem_id: 'problem-4', subject: '数学', tag_type: 'method', tag_id: 'tag-transform', candidate_name: null, current_target_name: '等价变形', confidence: .68, evidence: '题目步骤使用等价变形。', mapping_status: 'mapped', verification_status: 'ai_verified', is_locked: 0, source: 'model', problem_textbook_id: null, matched_textbook_title: null, superseded_at: null, updated_at: now },
]

export function curriculumPreviewImportJob(state: string): CurriculumImportJob {
  const recognition = {
    title: { value: '义务教育教科书 数学 七年级上册', confidence: .97, evidence: '封面标题与目录页' },
    subject: { value: '数学', confidence: .99, evidence: '数学 七年级上册' },
    grade: { value: '七年级', confidence: .92, evidence: '七年级' },
    volume: { value: '上册', confidence: .94, evidence: '上册' },
    publisher: { value: '人民教育出版社', confidence: .87, evidence: '版权页' },
    edition: { value: null, confidence: .41, evidence: '版权页文字不完整' },
    chapters: [
      {
        title: '第一章 有理数', pageStart: 1, pageEnd: 24, evidenceText: '目录：第一章 有理数',
        knowledgePoints: [
          { name: '相反数', pageNumbers: [4], evidence: '只有符号不同的两个数互为相反数。', confidence: .72, chapterName: '第一章 有理数' },
          { name: '数轴表示', pageNumbers: [6, 7], evidence: '在数轴上表示有理数。', confidence: .78, chapterName: '第一章 有理数' },
        ],
      },
      { title: '第二章 整式的加减', pageStart: 25, pageEnd: 50, evidenceText: '目录：第二章 整式的加减', knowledgePoints: [] },
    ],
    overallConfidence: .84,
    warnings: ['版本信息识别不完整，建议确认。'],
  }
  const extraction = { pageCount: 128, extractionMethod: 'pdf_text' as const, pages: [], outline: [
    { title: '第一章 有理数', level: 1, pageNumber: 1, evidenceText: '第一章 有理数', confidence: .95 },
    { title: '1.1 正数和负数', level: 2, pageNumber: 2, evidenceText: '1.1 正数和负数', confidence: .94 },
    { title: '相反数', level: 3, pageNumber: 4, evidenceText: '相反数', confidence: .71 },
    { title: '第二章 整式的加减', level: 1, pageNumber: 25, evidenceText: '第二章 整式的加减', confidence: .9 },
  ], warnings: [] }
  const status = state === 'import-failed' || state === 'global-analysis-failed'
    ? 'ai_failed_recoverable'
    : state === 'global-analysis-tags' || state === 'import-progress-minimal'
      ? 'ai_generating_tags'
      : state === 'global-analysis-audit'
        ? 'ai_auditing'
        : state === 'import-processing' || state === 'import-processing-wide' || state === 'ai-missing-difficulty-score' || state === 'global-analysis-structure'
          ? 'ai_analyzing_structure' : 'waiting_for_review'
  const progress = status === 'ai_analyzing_structure'
    ? { current: 0, total: 1, fraction: .18, label: '正在识别教材结构' }
    : status === 'ai_generating_tags'
      ? { current: 3, total: 5, fraction: .63, label: '标签创建中 · 3/5' }
      : status === 'ai_auditing'
        ? { current: 0, total: 1, fraction: .88, label: '正在检查分析结果' }
        : status === 'waiting_for_review'
          ? { current: 1, total: 1, fraction: 1, label: '分析完成' }
          : { current: 3, total: 5, fraction: .63, label: '分析已暂停' }
  return {
    id: 'preview-import', originalSourcePath: '/preview/math.pdf', sourcePath: '/preview/math.pdf', sourceName: '七年级数学上册.pdf', sourceType: 'pdf', contentHash: 'preview', status,
    stage: status === 'ai_failed_recoverable' ? 'ai_analyzing_structure' : status, pageCount: 128,
    extractionMethod: 'pdf_text', extraction, recognition, provider: 'preview', model: 'preview', promptVersion: 'textbook-recognition-v2-chapter-knowledge', schemaVersion: 'textbook-recognition-v2-chapter-knowledge', inputHash: 'preview', rawOutput: '', errorMessage: status === 'ai_failed_recoverable' ? '模拟的 AI 请求错误，可从安全阶段重试。' : null, providerTaskId: null, structure: { chapters: recognition.chapters, legacy_outline: extraction.outline }, tags: null, audit: null, progressCurrent: progress.current, progressTotal: progress.total, progressFraction: progress.fraction, progressLabel: progress.label, createdAt: now, updatedAt: now,
  }
}

function relabelBatch(state: string) {
  if (!state.startsWith('relabel-')) return null
  const paused = state === 'relabel-paused'
  const completed = state === 'relabel-completed'
  const single = state === 'relabel-running-single-card'
  const retry = state === 'relabel-failed-retry'
  return {
    id: 'preview-relabel', subject: '数学', status: completed ? 'completed' : retry ? 'failed' : 'processing',
    total_count: single ? 1 : retry ? 3 : 18, completed_count: single ? 0 : completed ? 17 : paused ? 7 : retry ? 2 : 8, failed_count: completed ? 1 : retry ? 1 : 0,
    paused_at: paused ? now - 12_000 : null, created_at: now - 70_000, updated_at: now,
    completed_at: completed ? now - 5_000 : null,
  }
}

export function installCurriculumPreviewFixture(state: string) {
  if (typeof window === 'undefined') return
  const fixtureState = state === 'empty' ? 'empty' : state
  const fixtureNodes = previewStructureNodes(state)
  const hasImport = state.startsWith('import-') || state.startsWith('global-analysis-') || state === 'ai-missing-difficulty-score'
  const imports = hasImport ? [curriculumPreviewImportJob(state)] : []
  const currentBatch = relabelBatch(state)
  const hasTextbook = fixtureState !== 'empty'
  const hasReview = state.startsWith('review-') && state !== 'review-empty'
  const hasTags = state !== 'tags-empty' && state !== 'review-empty'
  const invokedCommands: string[] = []
  const internals = {
    invoke: async (command: string, args: Record<string, unknown> = {}) => {
      invokedCommands.push(command)
      document.documentElement.dataset.curriculumPreviewCommands = invokedCommands.join(',')
      if (command === 'bulk_review_curriculum_tags') {
        return state === 'bulk-review-success'
          ? { approvedDefinitions: 3, rejectedDefinitions: 0, approvedProblemTags: 2, rejectedProblemTags: 0, skippedUnmapped: 1, skippedLocked: 0, skippedInvalid: 0 }
          : { approvedDefinitions: 1, rejectedDefinitions: 0, approvedProblemTags: 0, rejectedProblemTags: 0, skippedUnmapped: 0, skippedLocked: 0, skippedInvalid: 0 }
      }
      if (command === 'db_execute') return { rowsAffected: 1, lastInsertId: 0 }
      if (command !== 'db_select') throw new Error(`预览不支持 ${command}`)
      const sql = String(args.sql || '')
      const params = Array.isArray(args.params) ? args.params : []
      if (sql.includes('SELECT subject FROM textbooks')) return hasTextbook ? [{ subject: '数学' }] : []
      if (sql.includes('FROM textbooks') && sql.includes('archived_at IS NULL')) return hasTextbook ? [{ id: 'math-book', subject: '数学', title: '义务教育教科书 数学 七年级上册', grade: '七年级', volume: '上册', publisher: '人民教育出版社', edition: '2024 年版', source_type: 'pdf', source_path: '/preview/math.pdf', content_hash: 'preview', extraction_status: 'needs_review', extraction_method: 'pdf_text', is_current: 0, archived_at: null, created_at: now, updated_at: now }] : []
      if (sql.includes('FROM knowledge_nodes') && sql.includes('ORDER BY path')) return hasTextbook ? fixtureNodes : []
      if (sql.includes('FROM knowledge_edges')) return [{ id: 'edge-1', subject: '数学', from_node_id: 'knowledge-1', to_node_id: 'knowledge-2', relation_type: 'prerequisite_of', confidence: .8, source: 'textbook', verification_status: 'needs_review' }]
      if (sql.includes('curriculum_import_jobs')) {
        if (sql.includes('WHERE id')) return imports.filter((job) => job.id === params[0]).map((job) => ({
          id: job.id, original_source_path: job.originalSourcePath, source_path: job.sourcePath, source_name: job.sourceName, source_type: job.sourceType, content_hash: job.contentHash, status: job.status, resume_stage: job.stage, page_count: job.pageCount, extraction_method: job.extractionMethod, extraction_json: JSON.stringify(job.extraction), metadata_json: JSON.stringify(job.recognition), structure_json: JSON.stringify(job.structure), tags_json: null, audit_json: null, provider: job.provider, model: job.model, provider_task_id: null, prompt_version: job.promptVersion, schema_version: job.schemaVersion, input_hash: job.inputHash, raw_output: job.rawOutput, error_message: job.errorMessage, progress_current: job.progressCurrent, progress_total: job.progressTotal, progress_fraction: job.progressFraction, progress_label: job.progressLabel, created_at: now, updated_at: now,
        }))
        return imports.map((job) => ({ id: job.id, original_source_path: job.originalSourcePath, source_path: job.sourcePath, source_name: job.sourceName, source_type: job.sourceType, content_hash: job.contentHash, status: job.status, resume_stage: job.stage, page_count: job.pageCount, extraction_method: job.extractionMethod, extraction_json: JSON.stringify(job.extraction), metadata_json: JSON.stringify(job.recognition), structure_json: JSON.stringify(job.structure), tags_json: null, audit_json: null, provider: job.provider, model: job.model, provider_task_id: null, prompt_version: job.promptVersion, schema_version: job.schemaVersion, input_hash: job.inputHash, raw_output: job.rawOutput, error_message: job.errorMessage, progress_current: job.progressCurrent, progress_total: job.progressTotal, progress_fraction: job.progressFraction, progress_label: job.progressLabel, created_at: now, updated_at: now }))
      }
      if (sql.includes('SELECT td.tag_type, count(*)')) return hasTags ? [{ tag_type: 'knowledge', count: 2 }, { tag_type: 'method', count: 2 }, { tag_type: 'model', count: 1 }, { tag_type: 'error', count: 1 }] : []
      if (sql.includes('SELECT count(*) AS count FROM (') && sql.includes('pt.is_locked = 0')) return [{ count: hasReview ? 6 : 0 }]
      if (sql.includes('SELECT count(*) AS count FROM (')) return [{ count: hasTags ? 5 : 0 }]
      if (sql.includes('FROM problem_tags pt') && sql.includes('JOIN problems p')) {
        const type = String(params[1] || '')
        return hasReview ? reviewItems.filter((item) => item.tag_type === type) : []
      }
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
  const previewWindow = window as Window & {
    __TAURI_INTERNALS__?: unknown
  }
  previewWindow.__TAURI_INTERNALS__ = internals
}
