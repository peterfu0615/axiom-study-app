import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button,
  Dialog,
  EmptyState,
  FlowingTaskSurface,
  Menu,
  MenuItem,
  SelectField,
  StatusBadge,
  Tabs,
} from '../../components/ui'
import type { TagDefinition, Textbook } from '../../domain/horizon'
import type { HorizonTagType } from '../../domain/models'
import {
  addTagAlias,
  confirmProblemTag,
  createRelabelBatch,
  createTagDefinition,
  getCurriculumTagStats,
  getLatestRelabelBatch,
  getRelabelScopeCount,
  bulkReviewTagScope,
  listTagDefinitionSummaries,
  listTagReviewItems,
  mergeTagDefinitions,
  pauseRelabelBatch,
  refreshRelabelBatch,
  resumeRelabelBatch,
  reviewTagDefinition,
  type CurriculumTagStats,
  type RelabelBatch,
  type TagDefinitionSummary,
  type TagReviewItem,
} from '../../platform/horizonDatabase'
import { startRelabelBatchWorker } from './relabelWorker'
import { selectBulkReviewScope } from './bulkReviewScope'

type TagStatusFilter = 'all' | 'review' | 'active' | 'archived'

const dimensions: Array<{ value: HorizonTagType; label: string; description: string }> = [
  { value: 'knowledge', label: '知识点', description: '仅显示所选教材中的知识点' },
  { value: 'method', label: '解题方法', description: '可在当前科目的不同教材间复用' },
  { value: 'model', label: '题型模型', description: '描述稳定的题目结构与条件组合' },
  { value: 'error', label: '错误类型', description: '用于记录可确认的错误模式' },
]

function tagStatus(tag: TagDefinition) {
  if (tag.lifecycleStatus === 'candidate' || tag.verificationStatus === 'needs_review') return { label: '待确认', tone: 'warning' as const }
  if (tag.lifecycleStatus === 'active') return { label: '可用', tone: 'success' as const }
  if (tag.lifecycleStatus === 'merged') return { label: '已合并', tone: 'neutral' as const }
  if (tag.lifecycleStatus === 'archived') return { label: '已归档', tone: 'neutral' as const }
  return { label: '未采用', tone: 'neutral' as const }
}

function confidenceLabel(confidence: number) {
  return `${Math.round(confidence * 100)}%`
}

export function TagOverview({
  subject,
  textbook,
  onCreateKnowledge,
}: {
  subject: string
  textbook: Textbook | null
  onCreateKnowledge?: () => void
}) {
  const [type, setType] = useState<HorizonTagType>('knowledge')
  const [stats, setStats] = useState<CurriculumTagStats | null>(null)
  const [tags, setTags] = useState<TagDefinitionSummary[]>([])
  const [reviewItems, setReviewItems] = useState<TagReviewItem[]>([])
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<TagStatusFilter>('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newOpen, setNewOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [methodClass, setMethodClass] = useState<'core' | 'optional'>('core')
  const [detailTag, setDetailTag] = useState<TagDefinitionSummary | null>(null)
  const [alias, setAlias] = useState('')
  const [mergeTargetId, setMergeTargetId] = useState('')
  const [mappingItem, setMappingItem] = useState<TagReviewItem | null>(null)
  const [mappingTagId, setMappingTagId] = useState('')
  const [scopeOpen, setScopeOpen] = useState(false)
  const [scopeCount, setScopeCount] = useState(0)
  const [batch, setBatch] = useState<RelabelBatch | null>(null)
  const [busy, setBusy] = useState(false)
  const [bulkDecision, setBulkDecision] = useState<'approve' | 'reject' | null>(null)

  const refresh = useCallback(async () => {
    if (!subject) {
      setStats(null); setTags([]); setReviewItems([]); setBatch(null)
      return
    }
    setLoading(true)
    try {
      const [nextStats, nextTags, nextReviews, nextBatch, nextScope] = await Promise.all([
        getCurriculumTagStats(subject, textbook?.id ?? null),
        listTagDefinitionSummaries(subject, type, textbook?.id ?? null),
        listTagReviewItems(subject, type),
        getLatestRelabelBatch(subject),
        getRelabelScopeCount(subject),
      ])
      setStats(nextStats); setTags(nextTags); setReviewItems(nextReviews); setBatch(nextBatch); setScopeCount(nextScope)
      setError(null)
    } catch (reason) {
      setError(String(reason))
    } finally {
      setLoading(false)
    }
  }, [subject, textbook?.id, type])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (!batch || !['processing', 'paused', 'pending'].includes(batch.status)) return undefined
    const timer = window.setInterval(() => { void refreshRelabelBatch(batch.id).then((next) => next && setBatch(next)) }, 1200)
    return () => window.clearInterval(timer)
  }, [batch])

  const filtered = useMemo(() => tags.filter((tag) => {
    const queryMatches = !query.trim() || tag.canonicalName.toLocaleLowerCase('zh-CN').includes(query.trim().toLocaleLowerCase('zh-CN')) || tag.aliases.some((item) => item.includes(query.trim()))
    const statusMatches = statusFilter === 'all'
      || statusFilter === 'review' && (tag.lifecycleStatus === 'candidate' || tag.verificationStatus === 'needs_review')
      || statusFilter === 'active' && tag.lifecycleStatus === 'active'
      || statusFilter === 'archived' && tag.lifecycleStatus === 'archived'
    return queryMatches && statusMatches
  }), [query, statusFilter, tags])

  const bulkScope = useMemo(() => selectBulkReviewScope(filtered, reviewItems, query, statusFilter), [filtered, query, reviewItems, statusFilter])
  const { definitionIds: bulkDefinitionIds, filteredReviewItems, approveProblemTagIds: bulkApproveProblemTagIds, rejectProblemTagIds: bulkRejectProblemTagIds, unmappedReviewCount } = bulkScope
  const bulkProblemTagIds = bulkDecision === 'reject' ? bulkRejectProblemTagIds : bulkApproveProblemTagIds
  const approveItemCount = bulkDefinitionIds.length + bulkApproveProblemTagIds.length
  const rejectItemCount = bulkDefinitionIds.length + bulkRejectProblemTagIds.length
  const bulkItemCount = bulkDecision === 'reject' ? rejectItemCount : approveItemCount
  const bulkScopeLabel = query.trim() || statusFilter !== 'all' ? '筛选结果' : '全部'

  const createTag = async () => {
    if (!newName.trim() || !subject) return
    setBusy(true)
    try {
      await createTagDefinition({ subject, tagType: type, canonicalName: newName, methodClass: type === 'method' ? methodClass : null, approved: true })
      setNewName(''); setNewOpen(false); await refresh()
    } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }

  const reviewTag = async (tag: TagDefinition, decision: 'approve' | 'reject' | 'archive') => {
    setBusy(true)
    try { await reviewTagDefinition(tag, decision); await refresh() } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }

  const saveAlias = async () => {
    if (!detailTag || !alias.trim()) return
    setBusy(true)
    try { await addTagAlias(detailTag, alias); setAlias(''); await refresh() } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }

  const mergeTag = async () => {
    if (!detailTag || !mergeTargetId) return
    setBusy(true)
    try { await mergeTagDefinitions(detailTag.subject, detailTag.id, mergeTargetId); setDetailTag(null); await refresh() } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }

  const confirmMapping = async () => {
    if (!mappingItem || !mappingTagId) return
    setBusy(true)
    try { await confirmProblemTag(mappingItem.id, mappingTagId); setMappingItem(null); setMappingTagId(''); await refresh() } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }

  const startBatch = async () => {
    if (!subject) return
    setBusy(true)
    try {
      const id = await createRelabelBatch(subject)
      const next = await refreshRelabelBatch(id)
      setBatch(next)
      void startRelabelBatchWorker(id).then(() => refreshRelabelBatch(id).then((value) => value && setBatch(value)))
    } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }

  const toggleBatch = async () => {
    if (!batch) return
    setBusy(true)
    try {
      const next = batch.status === 'paused' ? await resumeRelabelBatch(batch.id) : await pauseRelabelBatch(batch.id)
      setBatch(next)
      if (next?.status === 'processing') void startRelabelBatchWorker(next.id)
    } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }

  const confirmBulkReview = async () => {
    if (!bulkDecision || !bulkItemCount) return
    setBusy(true)
    try {
      const result = await bulkReviewTagScope({
        subject,
        tagType: type,
        textbookId: type === 'knowledge' ? textbook?.id ?? null : null,
        definitionIds: bulkDefinitionIds,
        problemTagIds: bulkProblemTagIds,
        decision: bulkDecision,
      })
      setBulkDecision(null)
      await refresh()
      const affected = result.approvedDefinitions + result.approvedProblemTags +
        result.rejectedDefinitions + result.rejectedProblemTags
      setError(`${bulkDecision === 'approve' ? '批准' : '驳回'}完成：已处理 ${affected} 项。`)
    } catch (reason) {
      setError(String(reason))
    } finally {
      setBusy(false)
    }
  }

  if (!subject) {
    return <EmptyState description="先导入一本教材，或手动创建课程后再查看标签概况。" title="还没有可查看的课程" />
  }

  const counts: Record<HorizonTagType, number> = {
    knowledge: stats?.knowledgeCount ?? 0, method: stats?.methodCount ?? 0,
    model: stats?.modelCount ?? 0, error: stats?.errorCount ?? 0,
  }
  const currentDimension = dimensions.find((item) => item.value === type) ?? dimensions[0]
  const done = batch ? batch.completedCount + batch.failedCount : 0
  const relabelState = batch?.status === 'processing' || batch?.status === 'pending'
    ? 'running'
    : batch?.status === 'paused'
      ? 'paused'
      : batch?.status === 'completed'
        ? 'completed'
        : batch?.status === 'failed'
          ? 'failed'
          : 'idle' as const

  return (
    <section className="curriculum-tag-overview">
      <section className="curriculum-tag-stats" aria-label="标签概况">
        {[
          ['知识点', stats?.knowledgeCount ?? 0], ['解题方法', stats?.methodCount ?? 0],
          ['题型模型', stats?.modelCount ?? 0], ['错误类型', stats?.errorCount ?? 0],
          ['待确认', stats?.needsReviewCount ?? 0], ['未映射', stats?.unmappedCount ?? 0],
          ['已关联错题', stats?.linkedProblemCount ?? 0],
        ].map(([label, value]) => <div key={String(label)}><span>{label}</span><strong>{value}</strong></div>)}
      </section>

      <section className={`curriculum-tag-shell ${!loading && !filtered.length ? 'is-empty' : ''}`}>
        <Tabs ariaLabel="标签维度" onChange={setType} options={dimensions.map((item) => ({ value: item.value, label: item.label, count: counts[item.value] }))} value={type} variant="rail" />
        <div className="curriculum-tag-content">
          <header className="curriculum-tag-content__header"><div><h2>{currentDimension.label}</h2><p>{type === 'knowledge' && !textbook ? '请选择教材后查看教材知识点。' : currentDimension.description}</p></div>{type === 'knowledge' ? <Button disabled={!textbook} onClick={onCreateKnowledge}>新增知识点</Button> : <Button onClick={() => setNewOpen(true)} variant="primary">新建{currentDimension.label}</Button>}</header>
          {error && <div className="curriculum-inline-error" role="alert"><span>{error}</span><Button onClick={() => { setError(null); void refresh() }} variant="ghost">重试</Button></div>}
          <div className="curriculum-tag-toolbar"><label className="curriculum-search"><span>⌕</span><input onChange={(event) => setQuery(event.target.value)} placeholder={`搜索${currentDimension.label}`} value={query} /></label><SelectField aria-label="标签状态" onChange={(event) => setStatusFilter(event.target.value as TagStatusFilter)} value={statusFilter}><option value="all">全部状态</option><option value="review">待确认</option><option value="active">可用</option><option value="archived">已归档</option></SelectField><span>{loading ? '正在更新…' : `${filtered.length} 项`}</span><div className="curriculum-tag-bulk-actions"><Button disabled={busy || !approveItemCount} onClick={() => setBulkDecision('approve')} variant="secondary">批准{bulkScopeLabel} {approveItemCount}</Button><Button disabled={busy || !rejectItemCount} onClick={() => setBulkDecision('reject')} variant="danger">驳回{bulkScopeLabel} {rejectItemCount}</Button></div></div>
          {!loading && !filtered.length ? <EmptyState action={type !== 'knowledge' ? <Button onClick={() => setNewOpen(true)} variant="primary">新建{currentDimension.label}</Button> : undefined} description={type === 'knowledge' ? '所选教材尚未确认知识点。可返回知识结构新增或确认节点。' : `当前科目还没有${currentDimension.label}。`} title={`暂无${currentDimension.label}`} /> : <div className="curriculum-tag-table"><div className="curriculum-tag-table__header"><span>标签名称</span><span>类型或角色</span><span>关联错题</span><span>状态</span><span /></div>{filtered.map((tag) => { const status = tagStatus(tag); return <article key={tag.id}><button className="curriculum-tag-name" onClick={() => { setDetailTag(tag); setAlias(''); setMergeTargetId('') }} type="button"><strong>{tag.canonicalName}</strong><small>{tag.aliases.length ? `别名：${tag.aliases.join('、')}` : tag.description || '暂无说明'}</small></button><span>{tag.tagType === 'method' ? tag.methodClass === 'core' ? '核心方法' : '辅助方法' : currentDimension.label}</span><span>{tag.problemCount}</span><StatusBadge tone={status.tone}>{status.label}</StatusBadge><Menu><MenuItem onClick={() => setDetailTag(tag)}>查看详情</MenuItem>{tag.lifecycleStatus === 'candidate' && <MenuItem disabled={busy} onClick={() => void reviewTag(tag, 'approve')}>确认使用</MenuItem>}{tag.lifecycleStatus === 'active' && <MenuItem disabled={busy} onClick={() => void reviewTag(tag, 'archive')}>归档</MenuItem>}{tag.lifecycleStatus === 'candidate' && <MenuItem className="is-danger" disabled={busy} onClick={() => void reviewTag(tag, 'reject')}>不采用</MenuItem>}</Menu></article> })}</div>}

          {filteredReviewItems.length > 0 && <section className="curriculum-review-queue"><div><h3>需要确认的标签</h3><p>{filteredReviewItems.length} 个识别结果尚未完成审核。</p></div><div>{filteredReviewItems.slice(0, 3).map((item) => <button key={item.id} onClick={() => { setMappingItem(item); setMappingTagId('') }} type="button"><strong>{item.candidateName || '已映射标签'}</strong><span>依据：{item.evidence || '暂无'}</span><small>{confidenceLabel(item.confidence)}</small></button>)}</div></section>}

          <section className="curriculum-relabel-task">
            <div><span>旧错题标签更新</span><h3>{batch?.status === 'completed' ? '当前科目的标签更新已完成' : `还有 ${batch ? Math.max(0, batch.totalCount - done) : scopeCount} 道当前科目的错题可以更新`}</h3><p>{batch ? `已完成 ${batch.completedCount} 道，待确认 ${batch.needsReviewCount} 项，失败 ${batch.failedCount} 道。` : '更新后，这些错题可以参与后续复习。'}</p></div>
            {batch && ['processing', 'paused', 'pending'].includes(batch.status)
              ? <FlowingTaskSurface
                  actions={<><Button disabled={busy} onClick={() => void toggleBatch()}>{batch.status === 'paused' ? '继续' : '暂停'}</Button><Button onClick={() => setScopeOpen(true)} variant="ghost">查看详情</Button></>}
                  compact
                  detail={`已完成 ${batch.completedCount} 道 · 待确认 ${batch.needsReviewCount} 项 · 失败 ${batch.failedCount} 道`}
                  progress={batch.totalCount ? done / batch.totalCount : null}
                  progressCurrent={done}
                  progressLabel={batch.status === 'paused' ? '任务已暂停' : '正在更新'}
                  progressTotal={batch.totalCount}
                  state={relabelState}
                  title={batch.status === 'paused' ? '旧错题更新已暂停' : '正在更新旧错题标签'}
                />
              : <div className="curriculum-relabel-task__actions"><Button onClick={() => setScopeOpen(true)} variant="secondary">查看范围</Button><Button disabled={busy || !scopeCount} onClick={() => void startBatch()} variant="primary">开始更新</Button></div>}
          </section>
        </div>
      </section>

      <Dialog onClose={() => setNewOpen(false)} open={newOpen} title={`新建${currentDimension.label}`}><div className="curriculum-dialog-form"><label>名称<input onChange={(event) => setNewName(event.target.value)} value={newName} /></label>{type === 'method' && <label>角色<select onChange={(event) => setMethodClass(event.target.value as 'core' | 'optional')} value={methodClass}><option value="core">核心方法</option><option value="optional">辅助方法</option></select></label>}<div className="curriculum-dialog-actions"><Button onClick={() => setNewOpen(false)} variant="ghost">取消</Button><Button disabled={!newName.trim()} loading={busy} onClick={() => void createTag()} variant="primary">保存</Button></div></div></Dialog>
      <Dialog onClose={() => setDetailTag(null)} open={Boolean(detailTag)} title={detailTag?.canonicalName || '标签详情'}><div className="curriculum-dialog-form"><p>{detailTag?.description || '可在这里维护别名、合并和归档等低频操作。'}</p><label>添加别名<input onChange={(event) => setAlias(event.target.value)} placeholder="输入当前科目内的另一种说法" value={alias} /></label><Button disabled={!alias.trim()} loading={busy} onClick={() => void saveAlias()}>添加别名</Button><label>合并到<select onChange={(event) => setMergeTargetId(event.target.value)} value={mergeTargetId}><option value="">选择同类型标签</option>{tags.filter((item) => item.id !== detailTag?.id && item.lifecycleStatus === 'active').map((item) => <option key={item.id} value={item.id}>{item.canonicalName}</option>)}</select></label><Button disabled={!mergeTargetId} loading={busy} onClick={() => void mergeTag()}>合并标签</Button>{detailTag?.lifecycleStatus === 'active' && <Button loading={busy} onClick={() => void reviewTag(detailTag, 'archive')} variant="danger">归档标签</Button>}</div></Dialog>
      <Dialog onClose={() => setMappingItem(null)} open={Boolean(mappingItem)} title="确认识别结果"><div className="curriculum-dialog-form"><p>“{mappingItem?.candidateName}”需要对应到当前科目中的一个标签。依据：{mappingItem?.evidence || '暂无'}</p><label>对应标签<select onChange={(event) => setMappingTagId(event.target.value)} value={mappingTagId}><option value="">请选择标签</option>{tags.filter((tag) => tag.lifecycleStatus === 'active').map((tag) => <option key={tag.id} value={tag.id}>{tag.canonicalName}</option>)}</select></label><div className="curriculum-dialog-actions"><Button onClick={() => setMappingItem(null)} variant="ghost">取消</Button><Button disabled={!mappingTagId} loading={busy} onClick={() => void confirmMapping()} variant="primary">确认对应</Button></div></div></Dialog>
      <Dialog onClose={() => { if (!busy) setBulkDecision(null) }} open={Boolean(bulkDecision)} title={bulkDecision === 'approve' ? '批准标签审核结果' : '驳回标签审核结果'}><div className="curriculum-dialog-form"><p>{bulkDecision === 'approve' ? <>将批准 {bulkDefinitionIds.length} 个标签定义和 {bulkProblemTagIds.length} 个已明确映射的题目标签。仍需手动处理：{unmappedReviewCount} 个未映射或映射不明确项目。</> : <>将驳回当前科目“{subject}”的 {bulkDefinitionIds.length + bulkProblemTagIds.length} 个候选结果。知识点维度的作用教材为“{textbook?.title || '未选择教材'}”。历史证据不会被删除。</>}</p><div className="curriculum-dialog-actions"><Button disabled={busy} onClick={() => setBulkDecision(null)} variant="ghost">取消</Button><Button disabled={busy || !bulkItemCount} loading={busy} onClick={() => void confirmBulkReview()} variant={bulkDecision === 'approve' ? 'primary' : 'danger'}>{bulkDecision === 'approve' ? '确认批准' : '确认驳回'}</Button></div></div></Dialog>
      <Dialog onClose={() => setScopeOpen(false)} open={scopeOpen} title="旧错题标签更新范围"><div className="curriculum-dialog-form"><p>当前科目共有 {batch?.totalCount ?? scopeCount} 道已保存错题会进入更新任务。用户已经确认的标签不会被重新覆盖。</p>{batch && <p>已完成 {batch.completedCount} 道，待确认 {batch.needsReviewCount} 项，失败 {batch.failedCount} 道。</p>}<div className="curriculum-dialog-actions"><Button onClick={() => setScopeOpen(false)} variant="primary">知道了</Button></div></div></Dialog>
    </section>
  )
}
