import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from '../../components/Icon'
import {
  AsyncState,
  Button,
  Dialog,
  EmptyState,
  IconButton,
  ListboxSelect,
  Menu,
  MenuItem,
  PageHeader,
  StatusBadge,
  Surface,
  Tabs,
} from '../../components/ui'
import type { KnowledgeNode, Textbook } from '../../domain/horizon'
import {
  addKnowledgeEdge,
  archiveKnowledgeNode,
  archiveSubject,
  archiveTextbook,
  confirmKnowledgeNode,
  createManualTextbook,
  getCurriculumReviewCount,
  getSubjectDeletionImpact,
  getTextbookDeletionImpact,
  listHorizonSubjects,
  listKnowledgeEdges,
  listKnowledgeNodes,
  listTextbooks,
  mergeKnowledgeNodes,
  saveKnowledgeNode,
  type TextbookDeletionImpact,
  type SubjectDeletionImpact,
} from '../../platform/horizonDatabase'
import { CurriculumImportFlow } from './CurriculumImportFlow'
import { useCurriculumAnalysisStatus } from './CurriculumAnalysisContext'
import { CurriculumAnalysisStatusPill } from './CurriculumAnalysisStatusButton'
import { buildKnowledgeTree, knowledgeNodeLabel, matchingKnowledgeNodeIds, type KnowledgeTreeItem } from './curriculumTree'
import { TagOverview } from './TagOverview'
import { ReviewCenter } from './ReviewCenter'
import './Curriculum.css'

type CourseView = 'structure' | 'tags' | 'review'
type NodeEditor = { node: KnowledgeNode | null; parentId: string | null } | null
type NodeRelation = { node: KnowledgeNode; targetId: string; relation: 'contains' | 'prerequisite_of' | 'derived_from' | 'similar_to' | 'confusable_with' | 'used_by' | 'appears_in' } | null

const nodeTypes: Array<[KnowledgeNode['nodeType'], string]> = [
  ['chapter', '章节/单元'], ['knowledge', '知识点'],
]

function verification(node: KnowledgeNode) {
  if (node.verificationStatus === 'user_verified') return { label: '已确认', tone: 'success' as const }
  if (node.verificationStatus === 'needs_review') return { label: '待确认', tone: 'warning' as const }
  return { label: '待整理', tone: 'neutral' as const }
}

function KnowledgeTree({
  items,
  selectedId,
  visibleIds,
  expanded,
  onSelect,
  onToggle,
}: {
  items: KnowledgeTreeItem[]
  selectedId: string | null
  visibleIds: Set<string>
  expanded: Set<string>
  onSelect: (node: KnowledgeNode) => void
  onToggle: (id: string) => void
}) {
  return (
    <ul className="curriculum-tree" role="tree">
      {items.map((item) => {
        if (!visibleIds.has(item.node.id)) return null
        const hasChildren = item.children.some((child) => visibleIds.has(child.node.id))
        const isExpanded = expanded.has(item.node.id)
        return (
          <li key={item.node.id} role="treeitem">
            <div className={`curriculum-tree-row ${selectedId === item.node.id ? 'is-selected' : ''}`}>
              {hasChildren
                ? <IconButton aria-expanded={isExpanded} className="curriculum-tree-toggle" label={isExpanded ? '收起目录' : '展开目录'} onClick={() => onToggle(item.node.id)}><span className={isExpanded ? 'is-open' : ''}>›</span></IconButton>
                : <span className="curriculum-tree-toggle-placeholder" />}
              <button
                onClick={() => onSelect(item.node)}
                type="button"
              ><span>{item.node.canonicalName}</span></button>
            </div>
            {hasChildren && isExpanded && <KnowledgeTree expanded={expanded} items={item.children} onSelect={onSelect} onToggle={onToggle} selectedId={selectedId} visibleIds={visibleIds} />}
          </li>
        )
      })}
    </ul>
  )
}

export function CurriculumWorkspace({ initialView = 'structure' }: { initialView?: CourseView }) {
  const {
    job: curriculumJob,
    openedJobId,
    openProgress,
    closeProgress,
    publishJob,
  } = useCurriculumAnalysisStatus()
  const [view, setView] = useState<CourseView>(initialView)
  const [subjects, setSubjects] = useState<string[]>([])
  const [subject, setSubject] = useState('')
  const [textbooks, setTextbooks] = useState<Textbook[]>([])
  const [textbookId, setTextbookId] = useState<string | null>(null)
  const [nodes, setNodes] = useState<KnowledgeNode[]>([])
  const [edgeCount, setEdgeCount] = useState(0)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [importMode, setImportMode] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [manualSubject, setManualSubject] = useState('')
  const [manualTitle, setManualTitle] = useState('')
  const [nodeEditor, setNodeEditor] = useState<NodeEditor>(null)
  const [nodeName, setNodeName] = useState('')
  const [nodeType, setNodeType] = useState<KnowledgeNode['nodeType']>('knowledge')
  const [nodeParentId, setNodeParentId] = useState<string | null>(null)
  const [nodeDescription, setNodeDescription] = useState('')
  const [mergeSource, setMergeSource] = useState<KnowledgeNode | null>(null)
  const [mergeTargetId, setMergeTargetId] = useState('')
  const [relation, setRelation] = useState<NodeRelation>(null)
  const [busy, setBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Textbook | null>(null)
  const [deleteImpact, setDeleteImpact] = useState<TextbookDeletionImpact | null>(null)
  const [deleteSubjectOpen, setDeleteSubjectOpen] = useState(false)
  const [deleteSubjectImpact, setDeleteSubjectImpact] = useState<SubjectDeletionImpact | null>(null)
  const [pendingReviewCount, setPendingReviewCount] = useState(0)

  const selectedTextbook = textbooks.find((book) => book.id === textbookId) ?? null
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null

  const refreshSubjects = useCallback(async () => {
    const next = await listHorizonSubjects()
    setSubjects(next)
    setSubject((current) => current || next[0] || '')
  }, [])

  useEffect(() => {
    void refreshSubjects().catch((reason) => setError(String(reason)))
  }, [refreshSubjects])

  useEffect(() => {
    // Guard against out-of-order responses when switching subjects quickly.
    let cancelled = false
    if (!subject) {
      setTextbooks([])
      setTextbookId(null)
      setLoading(false)
      return
    }
    setLoading(true)
    void listTextbooks(subject)
      .then((next) => {
        if (cancelled) return
        setTextbooks(next)
        setTextbookId((current) => current && next.some((book) => book.id === current)
          ? current
          : next[0]?.id ?? null)
      })
      .catch((reason) => { if (!cancelled) setError(String(reason)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [subject])

  const refreshTree = useCallback(async () => {
    if (!textbookId) {
      setNodes([])
      setEdgeCount(0)
      return
    }
    const [nextNodes, nextEdges] = await Promise.all([listKnowledgeNodes(textbookId), listKnowledgeEdges(textbookId)])
    setNodes(nextNodes)
    setEdgeCount(nextEdges.length)
    setSelectedNodeId((current) => current && nextNodes.some((node) => node.id === current) ? current : nextNodes[0]?.id ?? null)
    setExpanded((current) => new Set([...current, ...nextNodes.filter((node) => node.parentId === null).map((node) => node.id)]))
  }, [textbookId])

  useEffect(() => {
    // Switching textbooks triggers overlapping loads; only the latest one may
    // paint the tree, otherwise a slow older response replaces it wholesale.
    let cancelled = false
    void refreshTree().catch((reason) => { if (!cancelled) setError(String(reason)) })
    return () => { cancelled = true }
  }, [refreshTree])

  const refreshReviewCount = useCallback(async () => {
    if (!subject) {
      setPendingReviewCount(0)
      return
    }
    try {
      setPendingReviewCount(await getCurriculumReviewCount(subject, textbookId))
    } catch (reason) {
      setError(String(reason))
    }
  }, [subject, textbookId])

  useEffect(() => {
    let cancelled = false
    void refreshReviewCount().catch((reason) => { if (!cancelled) setError(String(reason)) })
    return () => { cancelled = true }
  }, [refreshReviewCount])

  const handleReviewDataChanged = useCallback(() => {
    void refreshReviewCount()
  }, [refreshReviewCount])

  const selectSubject = (next: string) => {
    setSubject(next)
    setTextbookId(null)
    setSelectedNodeId(null)
  }

  const openNodeEditor = (node: KnowledgeNode | null, parentId: string | null) => {
    const effectiveParentId = node?.parentId ?? parentId
    setNodeEditor({ node, parentId })
    setNodeName(node?.canonicalName ?? '')
    setNodeType(node?.nodeType === 'chapter' || (!node && !effectiveParentId) ? 'chapter' : 'knowledge')
    setNodeParentId(effectiveParentId)
    setNodeDescription(node?.description ?? '')
  }

  const saveNode = async () => {
    if (!selectedTextbook || !nodeEditor) return
    setBusy(true)
    try {
      const parent = nodeParentId ? nodes.find((candidate) => candidate.id === nodeParentId) : null
      if (nodeParentId && parent?.nodeType !== 'chapter') throw new Error('知识点只能归属于章节或单元')
      const normalizedNodeType: KnowledgeNode['nodeType'] = nodeParentId ? 'knowledge' : 'chapter'
      const nodeId = await saveKnowledgeNode({
        id: nodeEditor.node?.id,
        textbookId: selectedTextbook.id,
        subject: selectedTextbook.subject,
        canonicalName: nodeName,
        nodeType: normalizedNodeType,
        parentId: nodeParentId,
        description: nodeDescription,
      })
      setNodeEditor(null)
      await refreshTree()
      setSelectedNodeId(nodeId)
    } catch (reason) {
      setError(String(reason))
    } finally {
      setBusy(false)
    }
  }

  const createManual = async () => {
    if (!manualSubject.trim() || !manualTitle.trim()) return
    setBusy(true)
    try {
      const newId = await createManualTextbook(manualSubject, manualTitle)
      setManualOpen(false)
      setManualTitle('')
      setSubject(manualSubject.trim())
      setTextbookId(newId)
      await refreshSubjects()
    } catch (reason) {
      setError(String(reason))
    } finally {
      setBusy(false)
    }
  }

  const confirmNode = async (node: KnowledgeNode) => {
    setBusy(true)
    try { await confirmKnowledgeNode(node); await refreshTree() } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }

  const archiveNode = async (node: KnowledgeNode) => {
    setBusy(true)
    try { await archiveKnowledgeNode(node); await refreshTree() } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }

  const mergeNode = async () => {
    if (!mergeSource || !mergeTargetId) return
    setBusy(true)
    try {
      await mergeKnowledgeNodes(mergeSource.subject, mergeSource.id, mergeTargetId)
      setMergeSource(null)
      await refreshTree()
    } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }

  const addRelation = async () => {
    if (!relation) return
    setBusy(true)
    try {
      await addKnowledgeEdge(relation.node.subject, relation.node.id, relation.targetId, relation.relation)
      setRelation(null)
      await refreshTree()
    } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }

  const openDeleteTextbookDialog = async (textbook: Textbook) => {
    setDeleteTarget(textbook)
    setDeleteImpact(null)
    try {
      setDeleteImpact(await getTextbookDeletionImpact(textbook.id))
    } catch (reason) {
      setDeleteTarget(null)
      setError(String(reason))
    }
  }

  const closeDeleteTextbookDialog = () => {
    if (busy) return
    setDeleteTarget(null)
    setDeleteImpact(null)
  }

  const confirmDeleteTextbook = async () => {
    if (!deleteTarget || !deleteImpact) return
    setBusy(true)
    try {
      await archiveTextbook(deleteTarget.id)
      setDeleteTarget(null)
      setDeleteImpact(null)
      const nextTextbooks = await listTextbooks(subject)
      setTextbooks(nextTextbooks)
      setTextbookId(nextTextbooks[0]?.id ?? null)
      await refreshSubjects()
    } catch (reason) {
      setError(String(reason))
    } finally {
      setBusy(false)
    }
  }

  const openDeleteSubjectDialog = async () => {
    if (!subject) return
    try {
      const impact = await getSubjectDeletionImpact(subject)
      if (!impact) throw new Error('该科目不存在或已删除')
      setDeleteSubjectImpact(impact)
      setDeleteSubjectOpen(true)
    } catch (reason) { setError(String(reason)) }
  }

  const confirmDeleteSubject = async () => {
    if (!subject || !deleteSubjectImpact) return
    setBusy(true)
    try {
      const removed = await archiveSubject(subject)
      if (!removed) throw new Error('该科目不存在或已删除')
      setDeleteSubjectOpen(false)
      setDeleteSubjectImpact(null)
      const next = await listHorizonSubjects()
      setSubjects(next)
      setSubject(next[0] ?? '')
      setTextbookId(null)
    } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }

  const tree = useMemo(() => buildKnowledgeTree(nodes), [nodes])
  const visibleNodeIds = useMemo(() => matchingKnowledgeNodeIds(nodes, query), [nodes, query])
  const chapterCount = nodes.filter((node) => node.nodeType === 'chapter' && !node.isUnclassified).length
  const knowledgeCount = nodes.filter((node) => ['knowledge', 'definition', 'formula', 'theorem', 'property'].includes(node.nodeType)).length
  const reviewCount = nodes.filter((node) => node.verificationStatus === 'needs_review').length

  const beginNewImport = () => {
    if (curriculumJob) {
      openProgress(curriculumJob.id)
      return
    }
    setImportMode(true)
  }

  const viewedJobId = openedJobId && curriculumJob?.id === openedJobId ? openedJobId : null
  if (importMode || viewedJobId) {
    return <CurriculumImportFlow
      initialJobId={viewedJobId}
      onBack={() => { setImportMode(false); closeProgress() }}
      onCompleted={(newTextbookId) => {
        setImportMode(false)
        closeProgress()
        publishJob(null)
        void (async () => {
          const newBook = (await listTextbooks()).find((item) => item.id === newTextbookId)
          const nextSubject = newBook?.subject ?? subject
          // The subject effect may have already loaded an empty list while the
          // confirmation transaction was still running.  Refresh the new
          // textbook explicitly so the just-saved course is visible without a
          // manual navigation or app restart.
          const nextTextbooks = await listTextbooks(nextSubject)
          setTextbooks(nextTextbooks)
          if (newBook) setSubject(newBook.subject)
          setTextbookId(newTextbookId)
          const [nextNodes, nextEdges] = await Promise.all([
            listKnowledgeNodes(newTextbookId), listKnowledgeEdges(newTextbookId),
          ])
          setNodes(nextNodes)
          setEdgeCount(nextEdges.length)
          setSelectedNodeId(nextNodes[0]?.id ?? null)
          setExpanded(new Set(nextNodes.filter((node) => node.parentId === null).map((node) => node.id)))
          await refreshSubjects()
        })()
      }}
      onManual={() => { setImportMode(false); setManualSubject(subject); setManualOpen(true) }}
    />
  }

  return (
    <main className="workspace curriculum-workspace">
      <PageHeader
        actions={<div className="curriculum-page-header__actions">
          {curriculumJob && <CurriculumAnalysisStatusPill onOpen={() => openProgress(curriculumJob.id)} />}
          <Button onClick={beginNewImport} variant="primary">导入教材</Button>
        </div>}
        className="curriculum-page-header"
        eyebrow="知识结构"
        summary="管理教材、知识结构与当前科目的标签概况。"
        title="课程"
      />

      <div className="curriculum-filters">
        <ListboxSelect label="科目" onValueChange={selectSubject} options={subjects.length ? subjects.map((item) => ({ value: item, label: item })) : [{ value: '', label: '暂无课程' }]} value={subject} />
        <ListboxSelect disabled={!subject || !textbooks.length} label="教材" onValueChange={(value) => setTextbookId(value || null)} options={textbooks.length ? textbooks.map((book) => ({ value: book.id, label: book.title })) : [{ value: '', label: '暂无教材' }]} value={textbookId ?? ''} />
        {subject && <Menu label="科目操作"><MenuItem className="is-danger" disabled={busy} onClick={() => void openDeleteSubjectDialog()}>删除科目</MenuItem></Menu>}
      </div>

      <Tabs ariaLabel="课程视图" onChange={setView} options={[{ value: 'structure', label: '知识结构' }, { value: 'tags', label: '标签概览' }, { value: 'review', label: '审核确认', count: pendingReviewCount }]} value={view} />

      <div className={`curriculum-view-scroll curriculum-view-scroll--${view}`}>
        {error && <div className="curriculum-inline-error" role="alert"><span>{error}</span><IconButton label="关闭提示" onClick={() => setError(null)}>×</IconButton></div>}

        {view === 'tags' ? <div className="curriculum-tags-view"><TagOverview onCreateKnowledge={() => { setView('structure'); if (selectedTextbook) openNodeEditor(null, selectedNode?.nodeType === 'chapter' ? selectedNode.id : selectedNode?.parentId ?? null) }} onReviewDataChanged={handleReviewDataChanged} subject={subject} textbook={selectedTextbook} /></div> : view === 'review' ? <div className="curriculum-review-view"><ReviewCenter onReviewDataChanged={handleReviewDataChanged} subject={subject} textbook={selectedTextbook} /></div> : (
          <AsyncState error={error} loading={loading} onRetry={() => { setError(null); void refreshSubjects(); void refreshTree() }}>
          {!selectedTextbook ? (
            <EmptyState
              action={<Button onClick={beginNewImport} variant="primary">导入教材</Button>}
              description="导入正在使用的教材，Axiom 会自动识别科目、版本、章节目录和候选知识点。"
              icon={<Icon name="curriculum" size={23} />}
              secondaryAction={<Button onClick={() => { setManualSubject(subject); setManualOpen(true) }} variant="secondary">手动创建</Button>}
              title="建立你的课程知识结构"
            />
          ) : (
            <div className="curriculum-structure-view">
              <section className="curriculum-book-summary">
                <div><div className="curriculum-book-summary__title"><h2>{selectedTextbook.title}</h2><Menu label="教材操作"><MenuItem className="is-danger" disabled={busy} onClick={() => void openDeleteTextbookDialog(selectedTextbook)}>删除课程</MenuItem></Menu></div><p>{[selectedTextbook.grade, selectedTextbook.volume, selectedTextbook.publisher, selectedTextbook.edition].filter(Boolean).join(' · ') || '教材信息待确认'}</p></div>
                <dl><div><dt>章节</dt><dd>{chapterCount}</dd></div><div><dt>知识点</dt><dd>{knowledgeCount}</dd></div><div><dt>待确认</dt><dd>{reviewCount}</dd></div></dl>
              </section>
              <Surface className="curriculum-structure-shell">
                <aside className="curriculum-tree-panel">
                  <div className="curriculum-panel-heading"><div><h2>课程目录</h2><span>{nodes.length} 个节点</span></div><Button onClick={() => openNodeEditor(null, selectedNode?.nodeType === 'chapter' ? selectedNode.id : selectedNode?.parentId ?? null)}>新增节点</Button></div>
                  <label className="curriculum-search"><span>⌕</span><input onChange={(event) => setQuery(event.target.value)} placeholder="搜索章节或知识点" value={query} /></label>
                  <div className="curriculum-tree-scroll"><KnowledgeTree expanded={expanded} items={tree} onSelect={(node) => setSelectedNodeId(node.id)} onToggle={(nodeId) => setExpanded((current) => { const next = new Set(current); if (next.has(nodeId)) next.delete(nodeId); else next.add(nodeId); return next })} selectedId={selectedNodeId} visibleIds={visibleNodeIds} /></div>
                </aside>
                <section className="curriculum-node-detail">
                  {selectedNode ? <>
                    <header><div><div className="curriculum-detail-kicker"><span>{knowledgeNodeLabel(selectedNode)}</span><StatusBadge tone={verification(selectedNode).tone}>{verification(selectedNode).label}</StatusBadge></div><h2>{selectedNode.canonicalName}</h2><p>{selectedNode.path}</p></div><div className="curriculum-node-actions"><Button onClick={() => openNodeEditor(selectedNode, selectedNode.parentId)}>编辑</Button><Menu><MenuItem disabled={busy || selectedNode.verificationStatus === 'user_verified'} onClick={() => void confirmNode(selectedNode)}>确认节点</MenuItem><MenuItem onClick={() => openNodeEditor(selectedNode, selectedNode.parentId)}>移动到章节</MenuItem>{selectedNode.nodeType === 'knowledge' && <MenuItem onClick={() => { setMergeSource(selectedNode); setMergeTargetId('') }}>合并节点</MenuItem>}<MenuItem onClick={() => setRelation({ node: selectedNode, targetId: '', relation: 'prerequisite_of' })}>添加关联</MenuItem><MenuItem className="is-danger" onClick={() => void archiveNode(selectedNode)}>归档节点</MenuItem></Menu></div></header>
                    <dl className="curriculum-node-facts"><div><dt>教材页码</dt><dd>{selectedNode.sourcePageStart ? `第 ${selectedNode.sourcePageStart}${selectedNode.sourcePageEnd && selectedNode.sourcePageEnd !== selectedNode.sourcePageStart ? `–${selectedNode.sourcePageEnd}` : ''} 页` : '手动建立'}</dd></div><div><dt>来源</dt><dd>{selectedNode.extractionMethod === 'manual' ? '手动建立' : selectedNode.extractionMethod === 'vision_ocr' ? '扫描识别' : '教材文字提取'}</dd></div><div><dt>审核状态</dt><dd>{verification(selectedNode).label}</dd></div><div><dt>关联关系</dt><dd>{edgeCount ? `${edgeCount} 条课程关系` : '尚未添加'}</dd></div></dl>
                    <section className="curriculum-evidence"><h3>教材依据</h3><p>{selectedNode.evidenceText || '该节点由你手动建立，尚未添加教材依据。'}</p></section>
                    {selectedNode.description && <section className="curriculum-evidence"><h3>备注</h3><p>{selectedNode.description}</p></section>}
                  </> : <EmptyState description="从左侧选择章节或知识点，即可查看教材依据并进行编辑。" title="选择一个课程节点" />}
                </section>
              </Surface>
            </div>
          )}
          </AsyncState>
        )}
      </div>

      <Dialog onClose={() => setManualOpen(false)} open={manualOpen} title="手动创建课程">
        <div className="curriculum-dialog-form"><label>科目<input onChange={(event) => setManualSubject(event.target.value)} placeholder="例如：数学" value={manualSubject} /></label><label>教材或课程名称<input onChange={(event) => setManualTitle(event.target.value)} placeholder="例如：七年级数学上册" value={manualTitle} /></label><div className="curriculum-dialog-actions"><Button onClick={() => setManualOpen(false)} variant="ghost">取消</Button><Button disabled={!manualSubject.trim() || !manualTitle.trim()} loading={busy} onClick={() => void createManual()} variant="primary">创建课程</Button></div></div>
      </Dialog>

      <Dialog onClose={() => { if (!busy) setDeleteSubjectOpen(false) }} open={deleteSubjectOpen} title={`删除「${subject}」？`}>
        <div className="curriculum-dialog-form">
          <p>该科目的 {deleteSubjectImpact?.textbookCount ?? 0} 本教材、{deleteSubjectImpact?.problemCount ?? 0} 道当前错题和学习状态将归档或移除。已完成的 {deleteSubjectImpact?.reviewAttemptCount ?? 0} 次复习、题目快照和不可变日志会保留。</p>
          <div className="curriculum-dialog-actions"><Button disabled={busy} onClick={() => setDeleteSubjectOpen(false)} variant="ghost">取消</Button><Button loading={busy} onClick={() => void confirmDeleteSubject()} variant="danger">删除科目</Button></div>
        </div>
      </Dialog>

      <Dialog onClose={() => setNodeEditor(null)} open={Boolean(nodeEditor)} title={nodeEditor?.node ? '编辑课程节点' : '新增课程节点'}>
        <div className="curriculum-dialog-form"><label>节点名称<input onChange={(event) => setNodeName(event.target.value)} value={nodeName} /></label><ListboxSelect label="知识节点类型" onValueChange={(value) => { const nextType = value as KnowledgeNode['nodeType']; setNodeType(nextType); if (nextType === 'chapter') setNodeParentId(null); else if (!nodeParentId) setNodeParentId(nodes.find((node) => node.nodeType === 'chapter' && node.id !== nodeEditor?.node?.id)?.id ?? null) }} options={nodeTypes.map(([value, label]) => ({ value, label }))} value={nodeType === 'chapter' && !nodeParentId ? 'chapter' : 'knowledge'} /><ListboxSelect label="父章节" onValueChange={(value) => { const nextParentId = value || null; setNodeParentId(nextParentId); setNodeType(nextParentId ? 'knowledge' : 'chapter') }} options={[...(nodeEditor?.node?.nodeType === 'chapter' || !nodeEditor?.node ? [{ value: '', label: '作为根章节' }] : []), ...nodes.filter((node) => node.nodeType === 'chapter' && node.id !== nodeEditor?.node?.id).map((node) => ({ value: node.id, label: node.path }))]} value={nodeParentId ?? ''} /><label>备注<textarea onChange={(event) => setNodeDescription(event.target.value)} value={nodeDescription} /></label><div className="curriculum-dialog-actions"><Button onClick={() => setNodeEditor(null)} variant="ghost">取消</Button><Button disabled={!nodeName.trim()} loading={busy} onClick={() => void saveNode()} variant="primary">保存</Button></div></div>
      </Dialog>

      <Dialog onClose={() => setMergeSource(null)} open={Boolean(mergeSource)} title="合并课程节点">
        <div className="curriculum-dialog-form"><p>“{mergeSource?.canonicalName}”将归入你选择的同章节知识点，历史引用会保留。</p><ListboxSelect label="合并到" onValueChange={setMergeTargetId} options={[{ value: '', label: '请选择节点' }, ...nodes.filter((node) => node.nodeType === 'knowledge' && node.parentId === mergeSource?.parentId && node.id !== mergeSource?.id).map((node) => ({ value: node.id, label: node.path }))]} value={mergeTargetId} /><div className="curriculum-dialog-actions"><Button onClick={() => setMergeSource(null)} variant="ghost">取消</Button><Button disabled={!mergeTargetId} loading={busy} onClick={() => void mergeNode()} variant="primary">合并</Button></div></div>
      </Dialog>

      <Dialog onClose={() => setRelation(null)} open={Boolean(relation)} title="添加课程关联">
        <div className="curriculum-dialog-form"><ListboxSelect label="关联类型" onValueChange={(value) => setRelation((current) => current ? { ...current, relation: value as NonNullable<NodeRelation>['relation'] } : current)} options={[{ value: 'prerequisite_of', label: '前置知识' }, { value: 'derived_from', label: '由此推导' }, { value: 'similar_to', label: '相似知识' }, { value: 'confusable_with', label: '易混淆' }, { value: 'used_by', label: '被用于' }, { value: 'appears_in', label: '出现于' }, { value: 'contains', label: '包含' }]} value={relation?.relation ?? 'prerequisite_of'} /><ListboxSelect label="关联到" onValueChange={(value) => setRelation((current) => current ? { ...current, targetId: value } : current)} options={[{ value: '', label: '请选择节点' }, ...nodes.filter((node) => node.id !== relation?.node.id).map((node) => ({ value: node.id, label: node.path }))]} value={relation?.targetId ?? ''} /><div className="curriculum-dialog-actions"><Button onClick={() => setRelation(null)} variant="ghost">取消</Button><Button disabled={!relation?.targetId} loading={busy} onClick={() => void addRelation()} variant="primary">添加关联</Button></div></div>
      </Dialog>

      <Dialog onClose={closeDeleteTextbookDialog} open={Boolean(deleteTarget)} title="删除课程">
        <div className="curriculum-dialog-form"><p>删除后“{deleteTarget?.title}”将从课程与教材列表中移除，已锁定的题目教材匹配将保留。</p>{deleteImpact ? <><dl className="curriculum-delete-impact"><div><dt>章节</dt><dd>{deleteImpact.chapterCount} 个</dd></div><div><dt>知识点</dt><dd>{deleteImpact.knowledgeCount} 个</dd></div><div><dt>教材页</dt><dd>{deleteImpact.pageCount} 页</dd></div><div><dt>关联题目</dt><dd>{deleteImpact.matchedProblemCount} 道</dd></div></dl>{deleteImpact.matchedProblemCount > 0 && <p>关联题目中未锁定的教材匹配将被清除，已锁定的匹配保持不变。</p>}</> : <p role="status">正在统计删除影响…</p>}<div className="curriculum-dialog-actions"><Button disabled={busy} onClick={closeDeleteTextbookDialog} variant="ghost">取消</Button><Button disabled={!deleteImpact} loading={busy} onClick={() => void confirmDeleteTextbook()} variant="danger">删除课程</Button></div></div>
      </Dialog>
    </main>
  )
}
