import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button,
  Dialog,
  DialogFooter,
  EmptyState,
  IconButton,
  InlineNotice,
  ListboxSelect,
  SearchField,
  StatusBadge,
  Tabs,
} from '../../components/ui'
import type { Feedback } from '../../components/ui'
import type { HorizonTagType } from '../../domain/models'
import type { Textbook } from '../../domain/horizon'
import { userFacingError } from '../../domain/userFacingError'
import {
  bulkReviewTagScope,
  confirmProblemTag,
  keepProblemTag,
  listTagDefinitionSummaries,
  listTagReviewItems,
  rejectProblemTag,
  reviewTagDefinition,
  type TagDefinitionSummary,
  type TagReviewItem,
} from '../../platform/horizonDatabase'
import { selectBulkReviewScope, type BulkReviewProjectType } from './bulkReviewScope'
import { Icon } from '../../components/Icon'

type ReviewProjectFilter = BulkReviewProjectType
type ReviewStatusFilter = 'pending' | 'all' | 'rejected'

const dimensions: Array<{ value: HorizonTagType; label: string }> = [
  { value: 'knowledge', label: '知识点' },
  { value: 'method', label: '解题方法' },
  { value: 'model', label: '题型模型' },
  { value: 'error', label: '错误类型' },
]

const projectFilters: Array<{ value: ReviewProjectFilter; label: string }> = [
  { value: 'all', label: '全部项目' },
  { value: 'definition', label: '标签定义' },
  { value: 'mapping', label: '错题标签' },
  { value: 'unmapped', label: '独立标签' },
]

function isPendingDefinition(definition: TagDefinitionSummary) {
  return (definition.lifecycleStatus === 'candidate' || definition.verificationStatus === 'needs_review') &&
    !['archived', 'merged', 'rejected'].includes(definition.lifecycleStatus) &&
    !['user_verified', 'rejected'].includes(definition.verificationStatus)
}

function isRejectedDefinition(definition: TagDefinitionSummary) {
  return definition.lifecycleStatus === 'rejected' || definition.verificationStatus === 'rejected'
}

function isPendingProblemTag(item: TagReviewItem) {
  return !item.isLocked && item.verificationStatus !== 'user_verified' &&
    item.verificationStatus !== 'rejected' && item.mappingStatus !== 'rejected'
}

function isRejectedProblemTag(item: TagReviewItem) {
  return item.mappingStatus === 'rejected' || item.verificationStatus === 'rejected'
}

function sourceLabel(source: string | undefined) {
  if (source === 'textbook' || source === 'textbook_extracted') return '教材提取'
  if (source === 'model' || source === 'ai_inferred') return 'AI 识别'
  if (source === 'user' || source === 'user_created') return '用户创建'
  return source || '—'
}

function rowKey(row: ReviewRow) {
  return row.kind === 'definition' ? `definition:${row.value.id}` : `problem:${row.value.id}`
}

type ReviewRow =
  | { kind: 'definition'; value: TagDefinitionSummary }
  | { kind: 'problem'; value: TagReviewItem }

export function ReviewCenter({
  subject,
  textbook,
  onReviewDataChanged,
}: {
  subject: string
  textbook: Textbook | null
  onReviewDataChanged?: () => void
}) {
  const [tagType, setTagType] = useState<HorizonTagType>('knowledge')
  const [projectFilter, setProjectFilter] = useState<ReviewProjectFilter>('all')
  const [statusFilter, setStatusFilter] = useState<ReviewStatusFilter>('pending')
  const [query, setQuery] = useState('')
  const [definitions, setDefinitions] = useState<TagDefinitionSummary[]>([])
  const [problemTags, setProblemTags] = useState<TagReviewItem[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [rowBusy, setRowBusy] = useState<Set<string>>(new Set())
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [bulkDecision, setBulkDecision] = useState<'approve' | 'reject' | null>(null)
  const [feedback, setFeedback] = useState<Feedback>(null)

  const refresh = useCallback(async () => {
    if (!subject || (tagType === 'knowledge' && !textbook)) {
      setDefinitions([])
      setProblemTags([])
      onReviewDataChanged?.()
      return
    }
    setLoading(true)
    try {
      const scopeTextbookId = tagType === 'knowledge' ? textbook?.id ?? null : null
      const [nextDefinitions, nextProblemTags] = await Promise.all([
        listTagDefinitionSummaries(subject, tagType, scopeTextbookId),
        listTagReviewItems(subject, tagType, scopeTextbookId),
      ])
      setDefinitions(nextDefinitions)
      setProblemTags(nextProblemTags)
      setFeedback(null)
      onReviewDataChanged?.()
    } catch (reason) {
      console.warn('读取标签审核项目失败', reason)
      setFeedback({
        tone: 'danger',
        message: userFacingError(
          reason,
          '未能读取审核项目。现有标签和错题关联没有改变，请重试。',
        ),
      })
    } finally {
      setLoading(false)
    }
  }, [onReviewDataChanged, subject, tagType, textbook])

  useEffect(() => { void refresh() }, [refresh])

  const visibleDefinitions = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('zh-CN')
    return definitions.filter((definition) => {
      const statusMatch = statusFilter === 'pending'
        ? isPendingDefinition(definition)
        : statusFilter === 'rejected'
          ? isRejectedDefinition(definition)
          : isPendingDefinition(definition) || isRejectedDefinition(definition)
      const queryMatch = !needle || definition.canonicalName.toLocaleLowerCase('zh-CN').includes(needle) ||
        (definition.description ?? '').toLocaleLowerCase('zh-CN').includes(needle)
      return statusMatch && queryMatch
    })
  }, [definitions, query, statusFilter])

  const visibleProblemTags = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('zh-CN')
    return problemTags.filter((item) => {
      const statusMatch = statusFilter === 'pending'
        ? isPendingProblemTag(item)
        : statusFilter === 'rejected'
          ? isRejectedProblemTag(item)
          : isPendingProblemTag(item) || isRejectedProblemTag(item)
      const projectMatch = projectFilter === 'all' ||
        (projectFilter === 'mapping' && item.mappingStatus === 'mapped') ||
        (projectFilter === 'unmapped' && item.mappingStatus !== 'mapped')
      const queryMatch = !needle || item.candidateName.toLocaleLowerCase('zh-CN').includes(needle) ||
        item.evidence.toLocaleLowerCase('zh-CN').includes(needle) ||
        (item.currentTargetName ?? '').toLocaleLowerCase('zh-CN').includes(needle)
      return statusMatch && projectMatch && queryMatch
    })
  }, [problemTags, projectFilter, query, statusFilter])

  const rows = useMemo<ReviewRow[]>(() => [
    ...(projectFilter === 'all' || projectFilter === 'definition'
      ? visibleDefinitions.map((value) => ({ kind: 'definition' as const, value })) : []),
    ...(projectFilter === 'all' || projectFilter === 'mapping' || projectFilter === 'unmapped'
      ? visibleProblemTags.map((value) => ({ kind: 'problem' as const, value })) : []),
  ], [projectFilter, visibleDefinitions, visibleProblemTags])

  const bulkScope = useMemo(() => {
    const scope = selectBulkReviewScope(
      visibleDefinitions,
      visibleProblemTags,
      '',
      'review',
      projectFilter,
    )
    return scope
  }, [projectFilter, visibleDefinitions, visibleProblemTags])

  const approveCount = bulkScope.definitionIds.length + bulkScope.approveProblemTagIds.length
  const rejectCount = bulkScope.definitionIds.length + bulkScope.rejectProblemTagIds.length
  const unmappedCount = visibleProblemTags.filter((item) => isPendingProblemTag(item) && item.mappingStatus !== 'mapped').length

  const runRowAction = async (row: ReviewRow, action: () => Promise<void>) => {
    const key = rowKey(row)
    setRowBusy((current) => new Set(current).add(key))
    setRowErrors((current) => { const next = { ...current }; delete next[key]; return next })
    try {
      await action()
      await refresh()
      return true
    } catch (reason) {
      console.warn('处理单项标签审核失败', reason)
      setRowErrors((current) => ({
        ...current,
        [key]: userFacingError(
          reason,
          '这一项没有更新，其他审核结果仍然保留。请重试。',
        ),
      }))
      return false
    } finally {
      setRowBusy((current) => { const next = new Set(current); next.delete(key); return next })
    }
  }

  const approveProblem = (item: TagReviewItem) => {
    if (!item.tagId) {
      void runRowAction({ kind: 'problem', value: item }, () => keepProblemTag(item.id))
      return
    }
    void runRowAction({ kind: 'problem', value: item }, () => confirmProblemTag(item.id))
  }

  const rejectRow = (row: ReviewRow) => {
    if (row.kind === 'definition') {
      void runRowAction(row, () => reviewTagDefinition(row.value, 'reject'))
    } else {
      void runRowAction(row, () => rejectProblemTag(row.value.id))
    }
  }

  const confirmBulk = async () => {
    if (!bulkDecision) return
    const decision = bulkDecision
    setBusy(true)
    try {
      const result = await bulkReviewTagScope({
        subject,
        tagType,
        textbookId: tagType === 'knowledge' ? textbook?.id ?? null : null,
        definitionIds: bulkScope.definitionIds,
        problemTagIds: decision === 'approve' ? bulkScope.approveProblemTagIds : bulkScope.rejectProblemTagIds,
        decision,
      })
      setBulkDecision(null)
      await refresh()
      const affected = result.approvedDefinitions + result.rejectedDefinitions +
        result.approvedProblemTags + result.rejectedProblemTags
      setFeedback({ tone: 'success', message: `${decision === 'approve' ? '批准' : '驳回'}完成：已处理 ${affected} 项。` })
    } catch (reason) {
      console.warn('批量处理标签审核失败', reason)
      setFeedback({
        tone: 'danger',
        message: userFacingError(
          reason,
          '批量处理没有完成。已处理的项目会保留，请刷新后继续。',
        ),
      })
    } finally {
      setBusy(false)
    }
  }

  if (!subject) {
    return <EmptyState description="先导入教材或建立课程，再进行标签审核。" title="暂无可审核课程" />
  }

  if (tagType === 'knowledge' && !textbook) {
    return (
      <div className="curriculum-review-view__empty">
        <EmptyState description="知识点审核必须限定一本教材，请先在课程顶部选择教材。" title="请先选择教材" />
      </div>
    )
  }

  return (
    <section className="curriculum-review-center">
      <header className="curriculum-review-center__header">
        <div>
          <h2>审核确认</h2>
          <p>{tagType === 'knowledge' ? `当前教材：${textbook?.title ?? '未选择教材'}` : `当前科目：${subject}`}</p>
        </div>
        <span className="curriculum-review-center__count">{loading ? '正在更新…' : `${rows.length} 项`}</span>
      </header>

      <Tabs
        ariaLabel="审核标签维度"
        onChange={setTagType}
        options={dimensions.map((dimension) => ({ value: dimension.value, label: dimension.label }))}
        value={tagType}
        variant="rail"
      />

      <div className="curriculum-review-center__body">
        <div className="curriculum-review-toolbar">
          <SearchField className="curriculum-search" label="搜索审核项目" onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称或依据" value={query} />
          <ListboxSelect ariaLabel="审核项目类型" onValueChange={(value) => setProjectFilter(value as ReviewProjectFilter)} options={projectFilters} value={projectFilter} />
          <ListboxSelect ariaLabel="审核状态" onValueChange={(value) => setStatusFilter(value as ReviewStatusFilter)} options={[{ value: 'pending', label: '待处理' }, { value: 'all', label: '全部状态' }, { value: 'rejected', label: '已驳回' }]} value={statusFilter} />
          <div className="curriculum-review-bulk-actions">
            <Button disabled={busy || !approveCount} onClick={() => setBulkDecision('approve')} variant="secondary">一键批准 {approveCount} 项</Button>
            <Button disabled={busy || !rejectCount} onClick={() => setBulkDecision('reject')} variant="danger">一键驳回 {rejectCount} 项</Button>
          </div>
        </div>

        <InlineNotice feedback={feedback} onClose={() => setFeedback(null)} />

        <div className="curriculum-review-list" aria-live="polite">
          {!loading && !rows.length
            ? <EmptyState description={statusFilter === 'pending' ? '当前筛选范围没有待处理审核项目。' : '当前筛选范围没有审核项目。'} title="没有审核项目" />
            : rows.map((row) => {
              const key = rowKey(row)
              const pending = row.kind === 'definition' ? isPendingDefinition(row.value) : isPendingProblemTag(row.value)
              const name = row.kind === 'definition' ? row.value.canonicalName : row.value.candidateName || row.value.currentTargetName || '未命名标签'
              const source = sourceLabel(row.value.source)
              const evidence = row.kind === 'definition' ? row.value.description || '标签定义候选' : row.value.evidence || '暂无题目依据'
              const scope = row.kind === 'definition'
                ? row.value.textbookId ? textbook?.title || '当前教材' : subject
                : row.value.textbookTitle || (tagType === 'knowledge' ? textbook?.title || '当前教材' : subject)
              const tagState = row.kind === 'definition' ? '课程标签' : row.value.tagId ? '已有标签' : '独立标签'
              const rejected = row.kind === 'definition' ? isRejectedDefinition(row.value) : isRejectedProblemTag(row.value)
              return (
                <article className="curriculum-review-row" key={key}>
                  <div className="curriculum-review-row__main">
                    <strong>{name}</strong>
                    <small>{row.kind === 'definition' ? '标签定义' : '错题标签'}</small>
                  </div>
                  <div><span>来源</span><strong>{source}</strong></div>
                  <div><span>证据</span><strong title={evidence}>{evidence}</strong></div>
                  <div><span>{row.kind === 'definition' ? '作用域' : '对应教材/科目'}</span><strong title={scope}>{scope}</strong></div>
                  <div><span>标签状态</span><strong>{tagState}</strong></div>
                  <StatusBadge tone={rejected ? 'neutral' : pending ? 'warning' : 'success'}>{pending ? '待处理' : '已驳回'}</StatusBadge>
                  <div className="curriculum-review-row__actions">
                    <IconButton aria-busy={rowBusy.has(key) || undefined} disabled={busy || rowBusy.has(key) || !pending} label={`批准“${name}”`} onClick={() => row.kind === 'definition' ? void runRowAction(row, () => reviewTagDefinition(row.value, 'approve')) : approveProblem(row.value)}>{rowBusy.has(key) ? <span aria-hidden="true" className="ax-spinner curriculum-review-row__spinner" /> : <Icon name="check" size={16} />}</IconButton>
                    <IconButton aria-busy={rowBusy.has(key) || undefined} className="is-danger" disabled={busy || rowBusy.has(key) || !pending} label={`驳回“${name}”`} onClick={() => rejectRow(row)}>{rowBusy.has(key) ? <span aria-hidden="true" className="ax-spinner curriculum-review-row__spinner" /> : <Icon name="close" size={16} />}</IconButton>
                  </div>
                  {rowErrors[key] && <p className="curriculum-review-row__error" role="alert">{rowErrors[key]}</p>}
                </article>
              )
            })}
        </div>
      </div>

      <Dialog onClose={() => { if (!busy) setBulkDecision(null) }} open={Boolean(bulkDecision)} title={bulkDecision === 'approve' ? '一键批准审核项目' : '一键驳回审核项目'}>
        <div className="curriculum-dialog-form">
          {bulkDecision === 'approve'
            ? <p>将批准 {bulkScope.definitionIds.length} 个课程标签和 {bulkScope.approveProblemTagIds.length} 个错题标签；{unmappedCount} 个独立标签保持原样，可在题目中单独处理。当前科目：{subject}。{tagType === 'knowledge' ? `当前教材：${textbook?.title ?? '未选择教材'}。` : ''}</p>
            : <p>将驳回 {bulkScope.definitionIds.length + bulkScope.rejectProblemTagIds.length} 个审核项目。当前科目：{subject}。{tagType === 'knowledge' ? `当前教材：${textbook?.title ?? '未选择教材'}。` : ''}历史来源、证据和审计记录不会被删除。</p>}
          <DialogFooter><Button disabled={busy} onClick={() => setBulkDecision(null)} variant="ghost">取消</Button><Button disabled={busy} loading={busy} onClick={() => void confirmBulk()} variant={bulkDecision === 'approve' ? 'primary' : 'danger'}>{bulkDecision === 'approve' ? '批准这些项目' : '驳回这些项目'}</Button></DialogFooter>
        </div>
      </Dialog>

    </section>
  )
}
