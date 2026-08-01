import { invoke } from '@tauri-apps/api/core'
import type { AIProblemAnalysis, HorizonTagType } from '../domain/models'
import {
  mapCandidatesToControlledTags,
  type KnowledgeNode,
  type KnowledgeEdge,
  type ProblemTag,
  type TagDefinition,
  type Textbook,
} from '../domain/horizon'
import {
  importTextbookSource,
  mergeKnowledgeNodes,
  mergeTagDefinitions,
  removeTextbookSource,
} from './native'

interface ExecuteResult {
  rowsAffected: number
  lastInsertId: number
}

const execute = (sql: string, params: unknown[] = []) =>
  invoke<ExecuteResult>('db_execute', { sql, params })
const select = <T>(sql: string, params: unknown[] = []) =>
  invoke<T>('db_select', { sql, params })
const id = () => crypto.randomUUID()
const bool = (value: unknown) => Number(value) === 1
const nullableString = (value: unknown) => value == null ? null : String(value)
const nullableNumber = (value: unknown) => value == null ? null : Number(value)

async function transaction<T>(operation: () => Promise<T>): Promise<T> {
  await execute('BEGIN IMMEDIATE')
  try {
    const value = await operation()
    await execute('COMMIT')
    return value
  } catch (error) {
    await execute('ROLLBACK').catch(() => {})
    throw error
  }
}

async function ensureTaxonomyVersion(subject: string): Promise<number> {
  const scopedSubject = subject.trim()
  const rows = await select<Array<{ version: number }>>(
    `SELECT version FROM taxonomy_versions
     WHERE subject = $1 AND status = 'published' ORDER BY version DESC LIMIT 1`,
    [scopedSubject],
  )
  if (rows[0]) return Number(rows[0].version)
  await execute(
    `INSERT OR IGNORE INTO taxonomy_versions (
      id, subject, version, status, note, created_at, published_at
    ) VALUES ($1, $2, 1, 'published', 'Horizon foundation', $3, $3)`,
    [id(), scopedSubject, Date.now()],
  )
  return 1
}

function rowToTextbook(row: Record<string, unknown>): Textbook {
  return {
    id: String(row.id),
    subject: String(row.subject),
    title: String(row.title),
    grade: nullableString(row.grade),
    volume: nullableString(row.volume),
    publisher: nullableString(row.publisher),
    edition: nullableString(row.edition),
    sourceType: String(row.source_type) as Textbook['sourceType'],
    sourcePath: nullableString(row.source_path),
    contentHash: nullableString(row.content_hash),
    extractionStatus: String(row.extraction_status) as Textbook['extractionStatus'],
    extractionMethod: nullableString(row.extraction_method) as Textbook['extractionMethod'],
    isCurrent: bool(row.is_current),
    archivedAt: nullableNumber(row.archived_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

function rowToKnowledgeNode(row: Record<string, unknown>): KnowledgeNode {
  return {
    id: String(row.id),
    textbookId: String(row.textbook_id),
    subject: String(row.subject),
    canonicalName: String(row.canonical_name),
    nodeType: String(row.node_type) as KnowledgeNode['nodeType'],
    parentId: nullableString(row.parent_id),
    path: String(row.path || ''),
    sortOrder: Number(row.sort_order),
    curriculumVersion: Number(row.curriculum_version),
    description: nullableString(row.description),
    sourcePageStart: nullableNumber(row.source_page_start),
    sourcePageEnd: nullableNumber(row.source_page_end),
    evidenceText: nullableString(row.evidence_text),
    sourcePath: nullableString(row.source_path),
    extractionMethod: String(row.extraction_method) as KnowledgeNode['extractionMethod'],
    confidence: Number(row.confidence),
    verificationStatus: String(row.verification_status) as KnowledgeNode['verificationStatus'],
    mergedIntoId: nullableString(row.merged_into_id),
    archivedAt: nullableNumber(row.archived_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

function rowToTagDefinition(row: Record<string, unknown>): TagDefinition {
  return {
    id: String(row.id),
    subject: String(row.subject),
    tagType: String(row.tag_type) as TagDefinition['tagType'],
    canonicalName: String(row.canonical_name),
    aliases: String(row.aliases || '').split('\u001f').filter(Boolean),
    description: nullableString(row.description),
    parentId: nullableString(row.parent_id),
    knowledgeNodeId: nullableString(row.knowledge_node_id),
    textbookId: nullableString(row.textbook_id),
    source: String(row.source) as TagDefinition['source'],
    taxonomyVersion: Number(row.taxonomy_version),
    verificationStatus: String(row.verification_status) as TagDefinition['verificationStatus'],
    lifecycleStatus: String(row.lifecycle_status) as TagDefinition['lifecycleStatus'],
    methodClass: nullableString(row.method_class) as TagDefinition['methodClass'],
    mergedIntoId: nullableString(row.merged_into_id),
    archivedAt: nullableNumber(row.archived_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

export async function listHorizonSubjects(): Promise<string[]> {
  const rows = await select<Array<{ subject: string }>>(
    `SELECT subject FROM textbooks WHERE archived_at IS NULL
     UNION
     SELECT trim(COALESCE(NULLIF(user_subject, ''), NULLIF(ai_subject, ''), NULLIF(subject, '')))
     FROM problems
     WHERE status = 'saved' AND deleted_at IS NULL
       AND trim(COALESCE(NULLIF(user_subject, ''), NULLIF(ai_subject, ''), NULLIF(subject, ''))) != ''
     ORDER BY subject`,
  )
  return rows.map((row) => String(row.subject)).filter(Boolean)
}

export async function listTextbooks(subject?: string): Promise<Textbook[]> {
  const rows = await select<Record<string, unknown>[]>(
    `SELECT * FROM textbooks
     WHERE archived_at IS NULL AND ($1 = '' OR subject = $1)
     ORDER BY subject, is_current DESC, updated_at DESC`,
    [subject?.trim() ?? ''],
  )
  return rows.map(rowToTextbook)
}

export async function createManualTextbook(subject: string, title: string) {
  const now = Date.now()
  const textbookId = id()
  await ensureTaxonomyVersion(subject)
  await transaction(async () => {
    await execute('UPDATE textbooks SET is_current = 0 WHERE subject = $1', [subject.trim()])
    await execute(
      `INSERT INTO textbooks (
        id, subject, title, source_type, extraction_status, extraction_method,
        is_current, created_at, updated_at
      ) VALUES ($1, $2, $3, 'manual', 'needs_review', 'manual', 1, $4, $4)`,
      [textbookId, subject.trim(), title.trim(), now],
    )
  })
  return textbookId
}

export async function importTextbook(
  subject: string,
  title: string,
  sourcePath: string,
) {
  const imported = await importTextbookSource(sourcePath)
  const textbookId = id()
  const now = Date.now()
  await ensureTaxonomyVersion(subject)
  try {
    await transaction(async () => {
    await execute('UPDATE textbooks SET is_current = 0 WHERE subject = $1', [subject.trim()])
    await execute(
      `INSERT INTO textbooks (
        id, subject, title, source_type, source_path, content_hash,
        extraction_status, extraction_method, is_current, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 'needs_review', $7, 1, $8, $8)`,
      [
        textbookId,
        subject.trim(),
        title.trim(),
        imported.sourceType,
        imported.sourcePath,
        imported.contentHash,
        imported.extraction.extractionMethod,
        now,
      ],
    )
    for (const page of imported.extraction.pages) {
      await execute(
        `INSERT INTO textbook_pages (
          id, textbook_id, subject, page_number, evidence_text, source_path,
          extraction_method, confidence, verification_status, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'needs_review', $9, $9)`,
        [
          id(), textbookId, subject.trim(), page.pageNumber,
          page.evidenceText, imported.sourcePath, page.extractionMethod,
          page.confidence, now,
        ],
      )
    }
    const parents = new Map<number, { id: string; path: string }>()
    for (const [index, candidate] of imported.extraction.outline.entries()) {
      const level = Math.max(1, Math.min(3, candidate.level))
      const parent = parents.get(level - 1) ?? null
      const nodeId = id()
      const path = parent ? `${parent.path}/${candidate.title}` : candidate.title
      await execute(
        `INSERT INTO knowledge_nodes (
          id, textbook_id, subject, canonical_name, node_type, parent_id, path,
          sort_order, source_page_start, source_page_end, evidence_text, source_path,
          extraction_method, confidence, verification_status, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10, $11, $12, $13,
          'needs_review', $14, $14)`,
        [
          nodeId, textbookId, subject.trim(), candidate.title,
          level === 1 ? 'chapter' : level === 2 ? 'section' : 'knowledge',
          parent?.id ?? null, path, index, candidate.pageNumber,
          candidate.evidenceText, imported.sourcePath,
          imported.extraction.extractionMethod, candidate.confidence, now,
        ],
      )
      parents.set(level, { id: nodeId, path })
      for (let deeper = level + 1; deeper <= 3; deeper += 1) parents.delete(deeper)
    }
    })
  } catch (error) {
    await removeTextbookSource(imported.sourcePath).catch(() => {})
    throw error
  }
  return textbookId
}

export async function listKnowledgeNodes(textbookId: string): Promise<KnowledgeNode[]> {
  const rows = await select<Record<string, unknown>[]>(
    `SELECT * FROM knowledge_nodes
     WHERE textbook_id = $1 AND archived_at IS NULL
     ORDER BY path, sort_order`,
    [textbookId],
  )
  return rows.map(rowToKnowledgeNode)
}

export async function listKnowledgeEdges(textbookId: string): Promise<KnowledgeEdge[]> {
  const rows = await select<Record<string, unknown>[]>(
    `SELECT edge.* FROM knowledge_edges edge
     JOIN knowledge_nodes source ON source.id = edge.from_node_id
     WHERE source.textbook_id = $1 ORDER BY edge.created_at`, [textbookId],
  )
  return rows.map((row) => ({
    id: String(row.id), subject: String(row.subject),
    fromNodeId: String(row.from_node_id), toNodeId: String(row.to_node_id),
    relationType: String(row.relation_type) as KnowledgeEdge['relationType'],
    confidence: Number(row.confidence), source: String(row.source) as KnowledgeEdge['source'],
    verificationStatus: String(row.verification_status) as KnowledgeEdge['verificationStatus'],
  }))
}

export async function addKnowledgeEdge(
  subject: string,
  fromNodeId: string,
  toNodeId: string,
  relationType: KnowledgeEdge['relationType'],
) {
  await execute(
    `INSERT INTO knowledge_edges (
      id, subject, from_node_id, to_node_id, relation_type, confidence,
      source, verification_status, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, 1, 'user', 'user_verified', $6, $6)`,
    [id(), subject, fromNodeId, toNodeId, relationType, Date.now()],
  )
}

export async function saveKnowledgeNode(input: {
  id?: string
  textbookId: string
  subject: string
  canonicalName: string
  nodeType: KnowledgeNode['nodeType']
  parentId: string | null
  description?: string
}) {
  const now = Date.now()
  if (input.id) {
    await execute(
      `UPDATE knowledge_nodes SET canonical_name = $1, node_type = $2,
       parent_id = $3, description = $4, updated_at = $5
       WHERE id = $6 AND subject = $7 AND textbook_id = $8`,
      [input.canonicalName.trim(), input.nodeType, input.parentId,
        input.description?.trim() || null, now, input.id, input.subject, input.textbookId],
    )
    return input.id
  }
  const nodeId = id()
  await execute(
    `INSERT INTO knowledge_nodes (
      id, textbook_id, subject, canonical_name, node_type, parent_id, path,
      extraction_method, confidence, verification_status, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $4, 'manual', 1, 'user_verified', $7, $7)`,
    [nodeId, input.textbookId, input.subject, input.canonicalName.trim(), input.nodeType,
      input.parentId, now],
  )
  return nodeId
}

export async function confirmKnowledgeNode(node: KnowledgeNode) {
  const now = Date.now()
  const taxonomyVersion = await ensureTaxonomyVersion(node.subject)
  await transaction(async () => {
    await execute(
      `UPDATE knowledge_nodes SET verification_status = 'user_verified',
       confidence = 1, updated_at = $1 WHERE id = $2 AND subject = $3`,
      [now, node.id, node.subject],
    )
    if (node.nodeType === 'knowledge' || ['definition', 'formula', 'theorem', 'property'].includes(node.nodeType)) {
      await execute(
        `INSERT INTO tag_definitions (
          id, subject, tag_type, canonical_name, knowledge_node_id, source,
          taxonomy_version, verification_status, lifecycle_status, created_at, updated_at
        ) VALUES ($1, $2, 'knowledge', $3, $4, 'textbook', $5,
          'user_verified', 'active', $6, $6)
        ON CONFLICT(subject, tag_type, canonical_name) DO UPDATE SET
          knowledge_node_id = excluded.knowledge_node_id,
          verification_status = 'user_verified', lifecycle_status = 'active',
          archived_at = NULL, updated_at = excluded.updated_at`,
        [id(), node.subject, node.canonicalName, node.id, taxonomyVersion, now],
      )
    }
  })
}

export async function archiveKnowledgeNode(node: KnowledgeNode) {
  await execute(
    `UPDATE knowledge_nodes SET archived_at = $1, updated_at = $1
     WHERE id = $2 AND subject = $3`,
    [Date.now(), node.id, node.subject],
  )
}

export { mergeKnowledgeNodes }

export async function listTagDefinitions(
  subject: string,
  tagType?: HorizonTagType,
): Promise<TagDefinition[]> {
  const rows = await select<Record<string, unknown>[]>(
    `SELECT td.*, kn.textbook_id,
       COALESCE(group_concat(ta.alias, char(31)), '') AS aliases
     FROM tag_definitions td
     LEFT JOIN knowledge_nodes kn ON kn.id = td.knowledge_node_id
     LEFT JOIN tag_aliases ta ON ta.tag_id = td.id AND ta.subject = td.subject
     WHERE td.subject = $1 AND ($2 = '' OR td.tag_type = $2)
     GROUP BY td.id
     ORDER BY td.tag_type, td.lifecycle_status, td.canonical_name`,
    [subject, tagType ?? ''],
  )
  return rows.map(rowToTagDefinition)
}

export async function createTagDefinition(input: {
  subject: string
  tagType: HorizonTagType
  canonicalName: string
  description?: string
  methodClass?: 'core' | 'optional' | null
  approved?: boolean
}) {
  const now = Date.now()
  const tagId = id()
  const taxonomyVersion = await ensureTaxonomyVersion(input.subject)
  await execute(
    `INSERT INTO tag_definitions (
      id, subject, tag_type, canonical_name, description, source,
      verification_status, lifecycle_status, method_class, taxonomy_version,
      created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, 'user', $6, $7, $8, $9, $10, $10)`,
    [tagId, input.subject, input.tagType, input.canonicalName.trim(),
      input.description?.trim() || null,
      input.approved ? 'user_verified' : 'needs_review',
      input.approved ? 'active' : 'candidate', input.methodClass ?? null,
      taxonomyVersion, now],
  )
  return tagId
}

export async function reviewTagDefinition(
  tag: TagDefinition,
  decision: 'approve' | 'reject' | 'archive',
) {
  const lifecycle = decision === 'approve' ? 'active' : decision === 'reject' ? 'rejected' : 'archived'
  const verification = decision === 'approve' ? 'user_verified' : 'rejected'
  const now = Date.now()
  const taxonomyVersion = await ensureTaxonomyVersion(tag.subject)
  await execute(
    `UPDATE tag_definitions SET lifecycle_status = $1, verification_status = $2,
     archived_at = $3, taxonomy_version = $4, updated_at = $5
     WHERE id = $6 AND subject = $7`,
    [lifecycle, verification, decision === 'archive' ? now : null,
      taxonomyVersion, now, tag.id, tag.subject],
  )
}

export async function publishTaxonomyVersion(subject: string, note: string) {
  const now = Date.now()
  return transaction(async () => {
    const rows = await select<Array<{ version: number }>>(
      'SELECT COALESCE(max(version), 0) AS version FROM taxonomy_versions WHERE subject = $1',
      [subject],
    )
    const version = Number(rows[0]?.version || 0) + 1
    await execute(
      `UPDATE taxonomy_versions SET status = 'retired'
       WHERE subject = $1 AND status = 'published'`, [subject],
    )
    await execute(
      `INSERT INTO taxonomy_versions (
        id, subject, version, status, note, created_at, published_at
      ) VALUES ($1, $2, $3, 'published', $4, $5, $5)`,
      [id(), subject, version, note.trim() || null, now],
    )
    return version
  })
}

export async function addTagAlias(tag: TagDefinition, alias: string) {
  await execute(
    `INSERT INTO tag_aliases (id, subject, tag_id, alias, source, created_at)
     VALUES ($1, $2, $3, $4, 'user', $5)`,
    [id(), tag.subject, tag.id, alias.trim(), Date.now()],
  )
}

export { mergeTagDefinitions }

export async function listProblemTags(problemId: string): Promise<ProblemTag[]> {
  const rows = await select<Record<string, unknown>[]>(
    `SELECT pt.*, COALESCE(td.canonical_name, pt.candidate_name, '') AS canonical_name
     FROM problem_tags pt LEFT JOIN tag_definitions td ON td.id = pt.tag_id
     WHERE pt.problem_id = $1 AND pt.superseded_at IS NULL
     ORDER BY pt.tag_type, pt.role, canonical_name`,
    [problemId],
  )
  return rows.map((row) => ({
    id: String(row.id),
    problemId: String(row.problem_id),
    subject: String(row.subject),
    tagType: String(row.tag_type) as ProblemTag['tagType'],
    tagId: nullableString(row.tag_id),
    canonicalName: String(row.canonical_name),
    role: String(row.role) as ProblemTag['role'],
    mappingStatus: String(row.mapping_status) as ProblemTag['mappingStatus'],
    confidence: Number(row.confidence),
    evidence: String(row.evidence),
    source: String(row.source) as ProblemTag['source'],
    taxonomyVersion: Number(row.taxonomy_version),
    modelRunId: nullableString(row.model_run_id),
    verificationStatus: String(row.verification_status) as ProblemTag['verificationStatus'],
    isLocked: bool(row.is_locked),
    updatedAt: Number(row.updated_at),
  }))
}

export async function confirmProblemTag(problemTagId: string, tagId?: string) {
  const now = Date.now()
  if (tagId) {
    await execute(
      `UPDATE problem_tags SET tag_id = $1, candidate_name = NULL,
       mapping_status = 'mapped', source = 'user', verification_status = 'user_verified',
       is_locked = 1, confidence = 1, updated_at = $2 WHERE id = $3`,
      [tagId, now, problemTagId],
    )
  } else {
    await execute(
      `UPDATE problem_tags SET source = 'user', verification_status = 'user_verified',
       is_locked = 1, updated_at = $1 WHERE id = $2 AND tag_id IS NOT NULL`,
      [now, problemTagId],
    )
  }
}

export async function removeProblemTag(problemTagId: string) {
  await execute(
    `UPDATE problem_tags SET superseded_at = $1, updated_at = $1 WHERE id = $2`,
    [Date.now(), problemTagId],
  )
}

export async function addProblemTag(
  problemId: string,
  subject: string,
  tag: TagDefinition,
  role: 'primary' | 'secondary' = 'secondary',
) {
  if (tag.subject !== subject) throw new Error('不能把其他科目的标签添加到本题')
  const now = Date.now()
  await execute(
    `INSERT INTO problem_tags (
      id, problem_id, subject, tag_type, tag_id, candidate_name, role,
      mapping_status, confidence, evidence, source, taxonomy_version,
      verification_status, is_locked, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, NULL, $6, 'mapped', 1,
      '用户在题目详情中添加', 'user', $7, 'user_verified', 1, $8, $8)`,
    [id(), problemId, subject, tag.tagType, tag.id, role, tag.taxonomyVersion, now],
  )
}

export interface ProblemDifficultyView {
  id: string
  level: 'basic' | 'intermediate' | 'advanced'
  score: number | null
  reason: string
  confidence: number
  source: 'model' | 'user' | 'legacy'
  verificationStatus: string
  isLocked: boolean
}

export async function getProblemDifficulty(problemId: string): Promise<ProblemDifficultyView | null> {
  const rows = await select<Record<string, unknown>[]>(
    `SELECT * FROM problem_difficulties
     WHERE problem_id = $1 AND superseded_at IS NULL LIMIT 1`, [problemId],
  )
  const row = rows[0]
  return row ? {
    id: String(row.id), level: String(row.level) as ProblemDifficultyView['level'],
    score: nullableNumber(row.score), reason: String(row.reason || ''),
    confidence: Number(row.confidence), source: String(row.source) as ProblemDifficultyView['source'],
    verificationStatus: String(row.verification_status), isLocked: bool(row.is_locked),
  } : null
}

export async function confirmProblemDifficulty(
  difficultyId: string,
  level?: ProblemDifficultyView['level'],
) {
  await execute(
    `UPDATE problem_difficulties SET level = COALESCE($1, level), source = 'user',
     verification_status = 'user_verified', is_locked = 1, confidence = 1,
     updated_at = $2 WHERE id = $3 AND superseded_at IS NULL`,
    [level ?? null, Date.now(), difficultyId],
  )
}

export async function applyControlledProblemAnalysis(
  problemId: string,
  modelRunId: string,
  analysis: AIProblemAnalysis,
) {
  const problems = await select<Array<{ effective_subject: string }>>(
    `SELECT trim(COALESCE(NULLIF(user_subject, ''), NULLIF(ai_subject, ''), NULLIF(subject, ''))) AS effective_subject
     FROM problems WHERE id = $1`,
    [problemId],
  )
  const subject = String(problems[0]?.effective_subject || '')
  if (!subject) return
  if (analysis.subject.trim() && analysis.subject.trim().toLocaleLowerCase('zh-CN') !== subject.toLocaleLowerCase('zh-CN')) {
    return
  }
  const textbooks = await listTextbooks(subject)
  const currentTextbookId = textbooks.find((book) => book.isCurrent)?.id ?? null
  const definitions = await listTagDefinitions(subject)
  const taxonomyVersion = await ensureTaxonomyVersion(subject)
  const candidateGroups: Array<[HorizonTagType, typeof analysis.knowledgeTags]> = [
    ['knowledge', analysis.knowledgeTags ?? []],
    ['method', analysis.methodTags ?? []],
    ['model', analysis.modelTags ?? []],
    ['error', analysis.errorCategories ?? []],
  ]
  const now = Date.now()
  await transaction(async () => {
    await execute(
      `UPDATE problem_tags SET superseded_at = $1, updated_at = $1
       WHERE problem_id = $2 AND superseded_at IS NULL AND source = 'model'
         AND is_locked = 0 AND verification_status != 'user_verified'`,
      [now, problemId],
    )
    for (const [tagType, candidates = []] of candidateGroups) {
      const mappings = mapCandidatesToControlledTags(
        subject, tagType, candidates, definitions, currentTextbookId,
      )
      for (const mapping of mappings) {
        if (!mapping.definition) {
          await execute(
            `INSERT OR IGNORE INTO tag_definitions (
              id, subject, tag_type, canonical_name, source, verification_status,
              lifecycle_status, method_class, taxonomy_version, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, 'model', 'needs_review', 'candidate', $5, $6, $7, $7)`,
            [id(), subject, tagType, mapping.candidate.name,
              tagType === 'method' ? (mapping.candidate.role === 'primary' ? 'core' : 'optional') : null,
              taxonomyVersion, now],
          )
        }
        await execute(
          `INSERT OR IGNORE INTO problem_tags (
            id, problem_id, subject, tag_type, tag_id, candidate_name, role,
            mapping_status, confidence, evidence, source, taxonomy_version,
            model_run_id, verification_status, is_locked, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'model', $11,
            $12, $13, 0, $14, $14)`,
          [id(), problemId, subject, tagType, mapping.definition?.id ?? null,
            mapping.definition ? null : mapping.candidate.name, mapping.candidate.role,
            mapping.mappingStatus, mapping.candidate.confidence, mapping.candidate.evidence,
            mapping.definition?.taxonomyVersion ?? taxonomyVersion, modelRunId,
            mapping.verificationStatus, now],
        )
      }
    }
    const existingLockedDifficulty = await select<Array<{ id: string }>>(
      `SELECT id FROM problem_difficulties WHERE problem_id = $1
       AND superseded_at IS NULL AND (is_locked = 1 OR verification_status = 'user_verified')`,
      [problemId],
    )
    if (analysis.difficulty && existingLockedDifficulty.length === 0) {
      await execute(
        `UPDATE problem_difficulties SET superseded_at = $1, updated_at = $1
         WHERE problem_id = $2 AND superseded_at IS NULL`,
        [now, problemId],
      )
      await execute(
        `INSERT INTO problem_difficulties (
          id, problem_id, subject, level, score, reason, confidence, source,
          model_run_id, verification_status, is_locked, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'model', $8, $9, 0, $10, $10)`,
        [id(), problemId, subject, analysis.difficulty.level, analysis.difficulty.score,
          analysis.difficulty.reason, analysis.difficulty.confidence, modelRunId,
          analysis.difficulty.confidence >= 0.72 ? 'ai_verified' : 'needs_review', now],
      )
    }
  })
}

export interface RelabelBatch {
  id: string
  subject: string
  status: 'pending' | 'processing' | 'completed' | 'cancelled' | 'failed'
  totalCount: number
  completedCount: number
  failedCount: number
  createdAt: number
  updatedAt: number
}

export async function createRelabelBatch(subject: string): Promise<string> {
  const batchId = id()
  const now = Date.now()
  await transaction(async () => {
    const problems = await select<Array<{ id: string }>>(
      `SELECT id FROM problems WHERE status = 'saved' AND deleted_at IS NULL
       AND trim(COALESCE(NULLIF(user_subject, ''), NULLIF(ai_subject, ''), NULLIF(subject, ''))) = $1`,
      [subject],
    )
    await execute(
      `INSERT INTO tag_relabel_batches (id, subject, total_count, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $4)`,
      [batchId, subject, problems.length, now],
    )
    for (const problem of problems) {
      await execute(
        `INSERT INTO tag_relabel_items (batch_id, problem_id, subject, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $4)`,
        [batchId, problem.id, subject, now],
      )
    }
  })
  return batchId
}

export async function listRelabelItems(batchId: string) {
  return select<Array<{ problem_id: string; status: string; model_run_id: string | null }>>(
    'SELECT problem_id, status, model_run_id FROM tag_relabel_items WHERE batch_id = $1 ORDER BY created_at',
    [batchId],
  )
}

export async function markRelabelItemQueued(batchId: string, problemId: string, modelRunId: string) {
  const now = Date.now()
  await transaction(async () => {
    await execute(
      `UPDATE tag_relabel_items SET status = 'queued', model_run_id = $1, updated_at = $2
       WHERE batch_id = $3 AND problem_id = $4 AND status = 'pending'`,
      [modelRunId, now, batchId, problemId],
    )
    await execute(
      `UPDATE tag_relabel_batches SET status = 'processing', updated_at = $1
       WHERE id = $2 AND status = 'pending'`,
      [now, batchId],
    )
  })
}

export async function refreshRelabelBatch(batchId: string): Promise<RelabelBatch | null> {
  const now = Date.now()
  await transaction(async () => {
    await execute(
      `UPDATE tag_relabel_items SET status = (
        SELECT CASE mr.status WHEN 'completed' THEN 'completed' WHEN 'failed' THEN 'failed'
          WHEN 'cancelled' THEN 'cancelled' ELSE tag_relabel_items.status END
        FROM model_runs mr WHERE mr.id = tag_relabel_items.model_run_id
       ), updated_at = $1
       WHERE batch_id = $2 AND model_run_id IS NOT NULL`,
      [now, batchId],
    )
    await execute(
      `UPDATE tag_relabel_batches SET
        completed_count = (SELECT count(*) FROM tag_relabel_items WHERE batch_id = $1 AND status = 'completed'),
        failed_count = (SELECT count(*) FROM tag_relabel_items WHERE batch_id = $1 AND status = 'failed'),
        status = CASE
          WHEN status = 'cancelled' THEN 'cancelled'
          WHEN NOT EXISTS (SELECT 1 FROM tag_relabel_items WHERE batch_id = $1 AND status IN ('pending','queued','processing')) THEN 'completed'
          ELSE status END,
        completed_at = CASE WHEN NOT EXISTS (
          SELECT 1 FROM tag_relabel_items WHERE batch_id = $1 AND status IN ('pending','queued','processing')
        ) THEN $2 ELSE completed_at END,
        updated_at = $2 WHERE id = $1`,
      [batchId, now],
    )
  })
  const rows = await select<Record<string, unknown>[]>(
    'SELECT * FROM tag_relabel_batches WHERE id = $1', [batchId],
  )
  const row = rows[0]
  return row ? {
    id: String(row.id), subject: String(row.subject), status: String(row.status) as RelabelBatch['status'],
    totalCount: Number(row.total_count), completedCount: Number(row.completed_count),
    failedCount: Number(row.failed_count), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  } : null
}

export async function cancelRelabelBatch(batchId: string) {
  const now = Date.now()
  await transaction(async () => {
    await execute(
      `UPDATE model_runs SET status = 'cancelled', error_message = '用户取消批量重标注'
       WHERE id IN (SELECT model_run_id FROM tag_relabel_items WHERE batch_id = $1)
         AND status IN ('pending', 'processing')`,
      [batchId],
    )
    await execute(
      `UPDATE problems SET ai_status = 'failed', ai_active_model_run_id = NULL, updated_at = $1
       WHERE ai_active_model_run_id IN (
         SELECT model_run_id FROM tag_relabel_items WHERE batch_id = $2
       )`,
      [now, batchId],
    )
    await execute(
      `UPDATE tag_relabel_items SET status = 'cancelled', updated_at = $1
       WHERE batch_id = $2 AND status IN ('pending', 'queued', 'processing')`,
      [now, batchId],
    )
    await execute(
      `UPDATE tag_relabel_batches SET status = 'cancelled', updated_at = $1,
       completed_at = $1 WHERE id = $2`,
      [now, batchId],
    )
  })
}
