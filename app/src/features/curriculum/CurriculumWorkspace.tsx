import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from '../../components/Icon'
import {
  AsyncState,
  Button,
  Dialog,
  EmptyState,
  IconButton,
  Menu,
  MenuItem,
  SelectField,
  StatusBadge,
  Surface,
  Tabs,
} from '../../components/ui'
import type { KnowledgeNode, Textbook } from '../../domain/horizon'
import {
  addKnowledgeEdge,
  archiveKnowledgeNode,
  cancelCurriculumImportJob,
  confirmKnowledgeNode,
  createManualTextbook,
  listCurriculumImportJobs,
  listHorizonSubjects,
  listKnowledgeEdges,
  listKnowledgeNodes,
  listTextbooks,
  mergeKnowledgeNodes,
  saveKnowledgeNode,
  setCurrentTextbook,
} from '../../platform/horizonDatabase'
import { CurriculumImportFlow } from './CurriculumImportFlow'
import { buildKnowledgeTree, knowledgeNodeLabel, matchingKnowledgeNodeIds, type KnowledgeTreeItem } from './curriculumTree'
import { TagOverview } from './TagOverview'
import './Curriculum.css'

type CourseView = 'structure' | 'tags'
type NodeEditor = { node: KnowledgeNode | null; parentId: string | null } | null
type NodeRelation = { node: KnowledgeNode; targetId: string; relation: 'contains' | 'prerequisite_of' | 'derived_from' | 'similar_to' | 'confusable_with' | 'used_by' | 'appears_in' } | null

const nodeTypes: Array<[KnowledgeNode['nodeType'], string]> = [
  ['chapter', '章'], ['section', '节'], ['knowledge', '知识点'],
  ['definition', '定义'], ['formula', '公式'], ['theorem', '定理'], ['property', '性质'],
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
                ? <IconButton className="curriculum-tree-toggle" label={isExpanded ? '收起目录' : '展开目录'} onClick={() => onToggle(item.node.id)}><span className={isExpanded ? 'is-open' : ''}>›</span></IconButton>
                : <span className="curriculum-tree-toggle-placeholder" />}
              <button onClick={() => onSelect(item.node)} type="button"><span>{item.node.canonicalName}</span><small>{knowledgeNodeLabel(item.node)}</small></button>
              {item.node.verificationStatus === 'needs_review' && <i aria-label="待确认" />}
            </div>
            {hasChildren && isExpanded && <KnowledgeTree expanded={expanded} items={item.children} onSelect={onSelect} onToggle={onToggle} selectedId={selectedId} visibleIds={visibleIds} />}
          </li>
        )
      })}
    </ul>
  )
}

export function CurriculumWorkspace({ initialView = 'structure' }: { initialView?: CourseView }) {
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
  const [continueImportId, setContinueImportId] = useState<string | null>(null)
  const [resumeJobId, setResumeJobId] = useState<string | null>(null)
  const [replaceImportOpen, setReplaceImportOpen] = useState(false)
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

  const selectedTextbook = textbooks.find((book) => book.id === textbookId) ?? null
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null

  const refreshSubjects = useCallback(async () => {
    const next = await listHorizonSubjects()
    setSubjects(next)
    setSubject((current) => current || next[0] || '')
  }, [])

  const refreshImportJobs = useCallback(async () => {
    const jobs = await listCurriculumImportJobs()
    setResumeJobId(jobs[0]?.id ?? null)
    if (!continueImportId) setContinueImportId(jobs[0]?.id ?? null)
  }, [continueImportId])

  useEffect(() => {
    void Promise.all([refreshSubjects(), refreshImportJobs()]).catch((reason) => setError(String(reason)))
  }, [refreshImportJobs, refreshSubjects])

  useEffect(() => {
    if (!subject) {
      setTextbooks([])
      setTextbookId(null)
      setLoading(false)
      return
    }
    setLoading(true)
    void listTextbooks(subject)
      .then((next) => {
        setTextbooks(next)
        setTextbookId((current) => current && next.some((book) => book.id === current)
          ? current
          : next.find((book) => book.isCurrent)?.id ?? next[0]?.id ?? null)
      })
      .catch((reason) => setError(String(reason)))
      .finally(() => setLoading(false))
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

  useEffect(() => { void refreshTree().catch((reason) => setError(String(reason))) }, [refreshTree])

  const selectSubject = (next: string) => {
    setSubject(next)
    setTextbookId(null)
    setSelectedNodeId(null)
  }

  const openNodeEditor = (node: KnowledgeNode | null, parentId: string | null) => {
    setNodeEditor({ node, parentId })
    setNodeName(node?.canonicalName ?? '')
    setNodeType(node?.nodeType ?? 'knowledge')
    setNodeParentId(node?.parentId ?? parentId)
    setNodeDescription(node?.description ?? '')
  }

  const saveNode = async () => {
    if (!selectedTextbook || !nodeEditor) return
    setBusy(true)
    try {
      const nodeId = await saveKnowledgeNode({
        id: nodeEditor.node?.id,
        textbookId: selectedTextbook.id,
        subject: selectedTextbook.subject,
        canonicalName: nodeName,
        nodeType,
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

  const setCurrent = async () => {
    if (!selectedTextbook) return
    setBusy(true)
    try {
      await setCurrentTextbook(selectedTextbook)
      setTextbooks(await listTextbooks(selectedTextbook.subject))
    } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }

  const tree = useMemo(() => buildKnowledgeTree(nodes), [nodes])
  const visibleNodeIds = useMemo(() => matchingKnowledgeNodeIds(nodes, query), [nodes, query])
  const chapterCount = nodes.filter((node) => node.nodeType === 'chapter').length
  const knowledgeCount = nodes.filter((node) => ['knowledge', 'definition', 'formula', 'theorem', 'property'].includes(node.nodeType)).length
  const reviewCount = nodes.filter((node) => node.verificationStatus === 'needs_review').length

  const beginNewImport = () => {
    if (resumeJobId) {
      setReplaceImportOpen(true)
      return
    }
    setContinueImportId(null)
    setImportMode(true)
  }

  const abandonAndBegin = async () => {
    if (!resumeJobId) return
    setBusy(true)
    try {
      await cancelCurriculumImportJob(resumeJobId)
      setResumeJobId(null)
      setContinueImportId(null)
      setReplaceImportOpen(false)
      setImportMode(true)
    } catch (reason) {
      setError(String(reason))
    } finally {
      setBusy(false)
    }
  }

  if (importMode) {
    return <CurriculumImportFlow
      initialJobId={continueImportId}
      onBack={() => { setImportMode(false); void refreshImportJobs() }}
      onCompleted={(newTextbookId) => {
        setImportMode(false)
        setContinueImportId(null)
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
          await refreshSubjects(); await refreshImportJobs()
        })()
      }}
      onManual={() => { setImportMode(false); setManualSubject(subject); setManualOpen(true) }}
    />
  }

  return (
    <main className="workspace curriculum-workspace">
      <header className="workspace-header curriculum-page-header">
        <div><p className="eyebrow">学习资料</p><h1>课程</h1><p className="subtitle">管理教材、知识结构与当前科目的标签概况。</p></div>
        <Button onClick={beginNewImport} variant="primary">导入教材</Button>
      </header>

      <div className="curriculum-filters">
        <SelectField label="科目" onChange={(event) => selectSubject(event.target.value)} value={subject}>
          {!subjects.length && <option value="">暂无课程</option>}
          {subjects.map((item) => <option key={item} value={item}>{item}</option>)}
        </SelectField>
        <SelectField disabled={!subject || !textbooks.length} label="教材" onChange={(event) => setTextbookId(event.target.value || null)} value={textbookId ?? ''}>
          {!textbooks.length && <option value="">暂无教材</option>}
          {textbooks.map((book) => <option key={book.id} value={book.id}>{book.title}{book.isCurrent ? ' · 当前使用' : ''}</option>)}
        </SelectField>
        {resumeJobId && <div className="curriculum-task-link"><span>上次教材分析尚未完成</span><Button onClick={() => { setContinueImportId(resumeJobId); setImportMode(true) }}>继续分析</Button><Button onClick={() => void cancelCurriculumImportJob(resumeJobId).then(refreshImportJobs)} variant="ghost">放弃</Button></div>}
      </div>

      <Tabs ariaLabel="课程视图" onChange={setView} options={[{ value: 'structure', label: '知识结构' }, { value: 'tags', label: '标签概览' }]} value={view} />

      <div className={`curriculum-view-scroll curriculum-view-scroll--${view}`}>
        {error && <div className="curriculum-inline-error" role="alert"><span>{error}</span><IconButton label="关闭提示" onClick={() => setError(null)}>×</IconButton></div>}

        {view === 'tags' ? <TagOverview onCreateKnowledge={() => { setView('structure'); if (selectedTextbook) openNodeEditor(null, selectedNode?.id ?? null) }} subject={subject} textbook={selectedTextbook} /> : (
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
            <>
              <section className="curriculum-book-summary">
                <div><div className="curriculum-book-summary__title"><h2>{selectedTextbook.title}</h2>{selectedTextbook.isCurrent && <StatusBadge tone="brand">当前使用</StatusBadge>}</div><p>{[selectedTextbook.grade, selectedTextbook.volume, selectedTextbook.publisher, selectedTextbook.edition].filter(Boolean).join(' · ') || '教材信息待确认'}</p></div>
                <dl><div><dt>章节</dt><dd>{chapterCount}</dd></div><div><dt>知识点</dt><dd>{knowledgeCount}</dd></div><div><dt>待确认</dt><dd>{reviewCount}</dd></div></dl>
                <Menu label="教材操作"><MenuItem disabled={selectedTextbook.isCurrent || busy} onClick={() => void setCurrent()}>设为当前教材</MenuItem></Menu>
              </section>
              <Surface className="curriculum-structure-shell">
                <aside className="curriculum-tree-panel">
                  <div className="curriculum-panel-heading"><div><h2>课程目录</h2><span>{nodes.length} 个节点</span></div><Button onClick={() => openNodeEditor(null, selectedNode?.id ?? null)}>新增节点</Button></div>
                  <label className="curriculum-search"><span>⌕</span><input onChange={(event) => setQuery(event.target.value)} placeholder="搜索章节或知识点" value={query} /></label>
                  <div className="curriculum-tree-scroll"><KnowledgeTree expanded={expanded} items={tree} onSelect={(node) => setSelectedNodeId(node.id)} onToggle={(nodeId) => setExpanded((current) => { const next = new Set(current); if (next.has(nodeId)) next.delete(nodeId); else next.add(nodeId); return next })} selectedId={selectedNodeId} visibleIds={visibleNodeIds} /></div>
                </aside>
                <section className="curriculum-node-detail">
                  {selectedNode ? <>
                    <header><div><div className="curriculum-detail-kicker"><span>{knowledgeNodeLabel(selectedNode)}</span><StatusBadge tone={verification(selectedNode).tone}>{verification(selectedNode).label}</StatusBadge></div><h2>{selectedNode.canonicalName}</h2><p>{selectedNode.path}</p></div><div className="curriculum-node-actions"><Button onClick={() => openNodeEditor(selectedNode, selectedNode.parentId)}>编辑</Button><Menu><MenuItem disabled={busy || selectedNode.verificationStatus === 'user_verified'} onClick={() => void confirmNode(selectedNode)}>确认节点</MenuItem><MenuItem onClick={() => openNodeEditor(selectedNode, selectedNode.parentId)}>移动到章节</MenuItem><MenuItem onClick={() => { setMergeSource(selectedNode); setMergeTargetId('') }}>合并节点</MenuItem><MenuItem onClick={() => setRelation({ node: selectedNode, targetId: '', relation: 'prerequisite_of' })}>添加关联</MenuItem><MenuItem className="is-danger" onClick={() => void archiveNode(selectedNode)}>归档节点</MenuItem></Menu></div></header>
                    <dl className="curriculum-node-facts"><div><dt>教材页码</dt><dd>{selectedNode.sourcePageStart ? `第 ${selectedNode.sourcePageStart}${selectedNode.sourcePageEnd && selectedNode.sourcePageEnd !== selectedNode.sourcePageStart ? `–${selectedNode.sourcePageEnd}` : ''} 页` : '手动建立'}</dd></div><div><dt>来源</dt><dd>{selectedNode.extractionMethod === 'manual' ? '手动建立' : selectedNode.extractionMethod === 'vision_ocr' ? '扫描识别' : '教材文字提取'}</dd></div><div><dt>识别可信度</dt><dd>{Math.round(selectedNode.confidence * 100)}%</dd></div><div><dt>关联关系</dt><dd>{edgeCount ? `${edgeCount} 条课程关系` : '尚未添加'}</dd></div></dl>
                    <section className="curriculum-evidence"><h3>教材依据</h3><p>{selectedNode.evidenceText || '该节点由你手动建立，尚未添加教材依据。'}</p></section>
                    {selectedNode.description && <section className="curriculum-evidence"><h3>备注</h3><p>{selectedNode.description}</p></section>}
                  </> : <EmptyState description="从左侧选择章节或知识点，即可查看教材依据并进行编辑。" title="选择一个课程节点" />}
                </section>
              </Surface>
            </>
          )}
          </AsyncState>
        )}
      </div>

      <Dialog onClose={() => setManualOpen(false)} open={manualOpen} title="手动创建课程">
        <div className="curriculum-dialog-form"><label>科目<input onChange={(event) => setManualSubject(event.target.value)} placeholder="例如：数学" value={manualSubject} /></label><label>教材或课程名称<input onChange={(event) => setManualTitle(event.target.value)} placeholder="例如：七年级数学上册" value={manualTitle} /></label><div className="curriculum-dialog-actions"><Button onClick={() => setManualOpen(false)} variant="ghost">取消</Button><Button disabled={!manualSubject.trim() || !manualTitle.trim()} loading={busy} onClick={() => void createManual()} variant="primary">创建课程</Button></div></div>
      </Dialog>

      <Dialog onClose={() => setReplaceImportOpen(false)} open={replaceImportOpen} title="开始新教材">
        <div className="curriculum-dialog-form"><p>上次教材分析尚未完成。开始新教材将放弃上次结果。</p><div className="curriculum-dialog-actions"><Button onClick={() => { setReplaceImportOpen(false); setContinueImportId(resumeJobId); setImportMode(true) }} variant="primary">继续上次分析</Button><Button loading={busy} onClick={() => void abandonAndBegin()} variant="secondary">放弃上次并导入新教材</Button><Button onClick={() => setReplaceImportOpen(false)} variant="ghost">取消</Button></div></div>
      </Dialog>

      <Dialog onClose={() => setNodeEditor(null)} open={Boolean(nodeEditor)} title={nodeEditor?.node ? '编辑课程节点' : '新增课程节点'}>
        <div className="curriculum-dialog-form"><label>节点名称<input onChange={(event) => setNodeName(event.target.value)} value={nodeName} /></label><label>类型<select onChange={(event) => setNodeType(event.target.value as KnowledgeNode['nodeType'])} value={nodeType}>{nodeTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>所属章节<select onChange={(event) => setNodeParentId(event.target.value || null)} value={nodeParentId ?? ''}><option value="">作为根节点</option>{nodes.filter((node) => node.id !== nodeEditor?.node?.id).map((node) => <option key={node.id} value={node.id}>{node.path}</option>)}</select></label><label>备注<textarea onChange={(event) => setNodeDescription(event.target.value)} value={nodeDescription} /></label><div className="curriculum-dialog-actions"><Button onClick={() => setNodeEditor(null)} variant="ghost">取消</Button><Button disabled={!nodeName.trim()} loading={busy} onClick={() => void saveNode()} variant="primary">保存</Button></div></div>
      </Dialog>

      <Dialog onClose={() => setMergeSource(null)} open={Boolean(mergeSource)} title="合并课程节点">
        <div className="curriculum-dialog-form"><p>“{mergeSource?.canonicalName}”将归入你选择的节点，历史引用会保留。</p><label>合并到<select onChange={(event) => setMergeTargetId(event.target.value)} value={mergeTargetId}><option value="">请选择节点</option>{nodes.filter((node) => node.id !== mergeSource?.id).map((node) => <option key={node.id} value={node.id}>{node.path}</option>)}</select></label><div className="curriculum-dialog-actions"><Button onClick={() => setMergeSource(null)} variant="ghost">取消</Button><Button disabled={!mergeTargetId} loading={busy} onClick={() => void mergeNode()} variant="primary">合并</Button></div></div>
      </Dialog>

      <Dialog onClose={() => setRelation(null)} open={Boolean(relation)} title="添加课程关联">
        <div className="curriculum-dialog-form"><label>关联类型<select onChange={(event) => setRelation((current) => current ? { ...current, relation: event.target.value as NonNullable<NodeRelation>['relation'] } : current)} value={relation?.relation ?? 'prerequisite_of'}><option value="prerequisite_of">前置知识</option><option value="derived_from">由此推导</option><option value="similar_to">相似知识</option><option value="confusable_with">易混淆</option><option value="used_by">被用于</option><option value="appears_in">出现于</option><option value="contains">包含</option></select></label><label>关联到<select onChange={(event) => setRelation((current) => current ? { ...current, targetId: event.target.value } : current)} value={relation?.targetId ?? ''}><option value="">请选择节点</option>{nodes.filter((node) => node.id !== relation?.node.id).map((node) => <option key={node.id} value={node.id}>{node.path}</option>)}</select></label><div className="curriculum-dialog-actions"><Button onClick={() => setRelation(null)} variant="ghost">取消</Button><Button disabled={!relation?.targetId} loading={busy} onClick={() => void addRelation()} variant="primary">添加关联</Button></div></div>
      </Dialog>
    </main>
  )
}
