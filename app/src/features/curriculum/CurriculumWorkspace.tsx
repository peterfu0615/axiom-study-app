import { open } from '@tauri-apps/plugin-dialog'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { runProblemAIWorker } from '../../ai/pipeline'
import type { HorizonTagType } from '../../domain/models'
import type {
  KnowledgeNode,
  KnowledgeEdge,
  TagDefinition,
  Textbook,
} from '../../domain/horizon'
import { queueProblemAI } from '../../platform/database'
import {
  addTagAlias,
  addKnowledgeEdge,
  archiveKnowledgeNode,
  cancelRelabelBatch,
  confirmKnowledgeNode,
  createManualTextbook,
  createRelabelBatch,
  createTagDefinition,
  importTextbook,
  listHorizonSubjects,
  listKnowledgeNodes,
  listKnowledgeEdges,
  listRelabelItems,
  listTagDefinitions,
  listTextbooks,
  markRelabelItemQueued,
  mergeKnowledgeNodes,
  mergeTagDefinitions,
  publishTaxonomyVersion,
  refreshRelabelBatch,
  reviewTagDefinition,
  saveKnowledgeNode,
  type RelabelBatch,
} from '../../platform/horizonDatabase'
import './Horizon.css'

type WorkspaceTab = 'knowledge' | 'taxonomy' | 'relabel'
const tagTypeLabels: Record<HorizonTagType, string> = {
  knowledge: '知识点', method: '方法', model: '题型模型', error: '错误类型',
}

export function CurriculumWorkspace() {
  const [subjects, setSubjects] = useState<string[]>([])
  const [subject, setSubject] = useState('数学')
  const [textbooks, setTextbooks] = useState<Textbook[]>([])
  const [textbookId, setTextbookId] = useState<string | null>(null)
  const [nodes, setNodes] = useState<KnowledgeNode[]>([])
  const [edges, setEdges] = useState<KnowledgeEdge[]>([])
  const [tags, setTags] = useState<TagDefinition[]>([])
  const [tab, setTab] = useState<WorkspaceTab>('knowledge')
  const [tagType, setTagType] = useState<HorizonTagType>('method')
  const [newTagName, setNewTagName] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [batch, setBatch] = useState<RelabelBatch | null>(null)

  const refresh = useCallback(async () => {
    const [nextSubjects, nextTextbooks, nextTags] = await Promise.all([
      listHorizonSubjects(), listTextbooks(subject), listTagDefinitions(subject),
    ])
    setSubjects(nextSubjects)
    setTextbooks(nextTextbooks)
    const nextTextbookId = textbookId && nextTextbooks.some((book) => book.id === textbookId)
      ? textbookId
      : nextTextbooks.find((book) => book.isCurrent)?.id ?? nextTextbooks[0]?.id ?? null
    setTextbookId(nextTextbookId)
    setTags(nextTags)
    if (nextTextbookId) {
      const [nextNodes, nextEdges] = await Promise.all([
        listKnowledgeNodes(nextTextbookId), listKnowledgeEdges(nextTextbookId),
      ])
      setNodes(nextNodes); setEdges(nextEdges)
    } else { setNodes([]); setEdges([]) }
  }, [subject, textbookId])

  useEffect(() => { void refresh().catch((error) => setMessage(String(error))) }, [refresh])
  useEffect(() => {
    if (!textbookId) { setNodes([]); setEdges([]); return }
    void Promise.all([listKnowledgeNodes(textbookId), listKnowledgeEdges(textbookId)])
      .then(([nextNodes, nextEdges]) => { setNodes(nextNodes); setEdges(nextEdges) })
  }, [textbookId])

  const depths = useMemo(() => {
    const byId = new Map(nodes.map((node) => [node.id, node]))
    const result = new Map<string, number>()
    for (const node of nodes) {
      let current = node.parentId ? byId.get(node.parentId) : null
      let depth = 0
      const visited = new Set<string>()
      while (current && !visited.has(current.id) && depth < 8) {
        visited.add(current.id); depth += 1
        current = current.parentId ? byId.get(current.parentId) : null
      }
      result.set(node.id, depth)
    }
    return result
  }, [nodes])

  const handleImport = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: '教材或目录', extensions: ['pdf', 'jpg', 'jpeg', 'png', 'webp'] }],
    })
    if (!selected) return
    const title = window.prompt('教材名称', selected.split('/').pop()?.replace(/\.[^.]+$/u, '') ?? '新教材')
    if (!title?.trim() || !subject.trim()) return
    setBusy(true); setMessage('正在提取 PDF 文本或执行本地 OCR…')
    try {
      const created = await importTextbook(subject, title, selected)
      setTextbookId(created); await refresh(); setMessage('目录候选已生成，请逐项校正确认。')
    } catch (error) { setMessage(`导入失败：${String(error)}`) }
    finally { setBusy(false) }
  }

  const handleManualBook = async () => {
    const title = window.prompt('课程/教材名称')
    if (!title?.trim() || !subject.trim()) return
    setBusy(true)
    try { setTextbookId(await createManualTextbook(subject, title)); await refresh() }
    catch (error) { setMessage(String(error)) }
    finally { setBusy(false) }
  }

  const handleAddNode = async () => {
    if (!textbookId) return
    const name = window.prompt('节点名称')
    if (!name?.trim()) return
    await saveKnowledgeNode({
      textbookId, subject, canonicalName: name, nodeType: 'knowledge', parentId: null,
    })
    setNodes(await listKnowledgeNodes(textbookId))
  }

  const handleEditNode = async (node: KnowledgeNode) => {
    const name = window.prompt('节点名称', node.canonicalName)
    if (!name?.trim()) return
    const parentId = window.prompt('父节点 ID（留空为根节点）', node.parentId ?? '')
    await saveKnowledgeNode({
      id: node.id,
      textbookId: node.textbookId,
      subject: node.subject,
      canonicalName: name,
      nodeType: node.nodeType,
      parentId: parentId?.trim() || null,
      description: node.description ?? undefined,
    })
    setNodes(await listKnowledgeNodes(node.textbookId))
  }

  const handleMergeNode = async (node: KnowledgeNode) => {
    const target = window.prompt('合并到节点 ID（必须同科目、同教材）')
    if (!target?.trim()) return
    await mergeKnowledgeNodes(node.subject, node.id, target.trim())
    setNodes(await listKnowledgeNodes(node.textbookId))
  }

  const handleAddEdge = async (node: KnowledgeNode) => {
    const target = window.prompt('目标知识节点 ID（必须属于当前科目）')
    if (!target?.trim()) return
    const relation = window.prompt(
      '关系：contains / prerequisite_of / derived_from / similar_to / confusable_with / used_by / appears_in',
      'prerequisite_of',
    ) as KnowledgeEdge['relationType'] | null
    if (!relation || !['contains','prerequisite_of','derived_from','similar_to','confusable_with','used_by','appears_in'].includes(relation)) return
    await addKnowledgeEdge(node.subject, node.id, target.trim(), relation)
    setEdges(await listKnowledgeEdges(node.textbookId))
  }

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return
    await createTagDefinition({
      subject, tagType, canonicalName: newTagName,
      methodClass: tagType === 'method' ? 'core' : null, approved: true,
    })
    setNewTagName(''); setTags(await listTagDefinitions(subject))
  }

  const handleAlias = async (tag: TagDefinition) => {
    const alias = window.prompt('添加科目内别名')
    if (!alias?.trim()) return
    await addTagAlias(tag, alias); setTags(await listTagDefinitions(subject))
  }

  const handleMergeTag = async (tag: TagDefinition) => {
    const target = window.prompt('合并到正式标签 ID（必须同科目、同类型）')
    if (!target?.trim()) return
    await mergeTagDefinitions(tag.subject, tag.id, target.trim())
    setTags(await listTagDefinitions(subject))
  }

  const startRelabel = async () => {
    setBusy(true); setMessage(null)
    try {
      const batchId = await createRelabelBatch(subject)
      const items = await listRelabelItems(batchId)
      for (const item of items) {
        const problem = await queueProblemAI(item.problem_id)
        if (problem.aiActiveModelRunId) {
          await markRelabelItemQueued(batchId, problem.id, problem.aiActiveModelRunId)
        }
      }
      void runProblemAIWorker()
      setBatch(await refreshRelabelBatch(batchId))
    } catch (error) { setMessage(`批量重标注启动失败：${String(error)}`) }
    finally { setBusy(false) }
  }

  useEffect(() => {
    if (!batch || !['pending', 'processing'].includes(batch.status)) return
    const timer = window.setInterval(() => {
      void refreshRelabelBatch(batch.id).then(setBatch)
    }, 1500)
    return () => window.clearInterval(timer)
  }, [batch])

  const visibleTags = tags.filter((tag) => tag.tagType === tagType)

  return (
    <main className="horizon-workspace">
      <header className="horizon-header">
        <div><p>Horizon Tag Foundation</p><h1>课程与标签体系</h1></div>
        <div className="horizon-subject-picker">
          <label>科目根作用域</label>
          <input list="horizon-subjects" onChange={(event) => setSubject(event.target.value)} value={subject} />
          <datalist id="horizon-subjects">{subjects.map((item) => <option key={item} value={item} />)}</datalist>
        </div>
      </header>
      <nav className="horizon-tabs">
        <button className={tab === 'knowledge' ? 'active' : ''} onClick={() => setTab('knowledge')}>教材与知识树</button>
        <button className={tab === 'taxonomy' ? 'active' : ''} onClick={() => setTab('taxonomy')}>受控标签库</button>
        <button className={tab === 'relabel' ? 'active' : ''} onClick={() => setTab('relabel')}>旧题重标注</button>
      </nav>
      {message && <div className="horizon-message" role="status">{message}</div>}

      {tab === 'knowledge' && <div className="horizon-grid">
        <aside className="horizon-panel book-panel">
          <div className="panel-title"><div><span>教材</span><strong>{subject}</strong></div></div>
          <div className="book-actions">
            <button disabled={busy} onClick={() => void handleImport()}>导入 PDF / 目录图片</button>
            <button disabled={busy} onClick={() => void handleManualBook()}>手动建立</button>
          </div>
          <ul>{textbooks.map((book) => <li key={book.id}>
            <button className={book.id === textbookId ? 'selected' : ''} onClick={() => setTextbookId(book.id)}>
              <strong>{book.title}</strong><small>{book.extractionMethod ?? 'manual'} · {book.extractionStatus}</small>
            </button>
          </li>)}</ul>
        </aside>
        <section className="horizon-panel tree-panel">
          <div className="panel-title"><div><span>可编辑知识树</span><strong>{textbooks.find((book) => book.id === textbookId)?.title ?? '请选择教材'}</strong></div>
            <button disabled={!textbookId} onClick={() => void handleAddNode()}>新增知识点</button></div>
          <div className="knowledge-tree">
            {nodes.map((node) => <article key={node.id} style={{ '--depth': depths.get(node.id) ?? 0 } as React.CSSProperties}>
              <div><strong>{node.canonicalName}</strong><small>p.{node.sourcePageStart ?? '—'} · {Math.round(node.confidence * 100)}% · {node.verificationStatus}</small></div>
              <code>{node.id.slice(0, 8)}</code>
              <button onClick={() => void handleEditNode(node)}>编辑/移动</button>
              {node.verificationStatus !== 'user_verified' && <button onClick={() => void confirmKnowledgeNode(node).then(refresh)}>确认</button>}
              <button onClick={() => void handleMergeNode(node)}>合并</button>
              <button onClick={() => void handleAddEdge(node)}>关系</button>
              <button onClick={() => void archiveKnowledgeNode(node).then(refresh)}>归档</button>
              {edges.some((edge) => edge.fromNodeId === node.id) && <small className="node-relations">{edges.filter((edge) => edge.fromNodeId === node.id).map((edge) => `${edge.relationType} → ${edge.toNodeId.slice(0, 8)}`).join('；')}</small>}
              {node.evidenceText && <details><summary>教材证据</summary><p>{node.evidenceText}</p></details>}
            </article>)}
            {!nodes.length && <div className="horizon-empty">导入教材目录，或手动建立课程结构。</div>}
          </div>
        </section>
      </div>}

      {tab === 'taxonomy' && <section className="horizon-panel taxonomy-panel">
        <div className="taxonomy-heading"><div className="taxonomy-types">{(['knowledge','method','model','error'] as HorizonTagType[]).map((type) =>
          <button className={tagType === type ? 'active' : ''} key={type} onClick={() => setTagType(type)}>{tagTypeLabels[type]}</button>)}</div>
          <button onClick={() => { const note = window.prompt('新体系版本说明') ?? ''; void publishTaxonomyVersion(subject, note).then((version) => setMessage(`已发布 ${subject} 标签体系 v${version}`)) }}>发布新版本</button></div>
        <div className="tag-create"><input onChange={(event) => setNewTagName(event.target.value)} placeholder={`新增${tagTypeLabels[tagType]}`} value={newTagName} /><button onClick={() => void handleCreateTag()}>创建正式标签</button></div>
        <div className="taxonomy-list">{visibleTags.map((tag) => <article key={tag.id}>
          <div><span className={`tag-status ${tag.lifecycleStatus}`}>{tag.lifecycleStatus}</span><strong>{tag.canonicalName}</strong><small>{tag.aliases.length ? `别名：${tag.aliases.join('、')}` : '无别名'} · v{tag.taxonomyVersion}</small></div>
          <code>{tag.id}</code>
          {tag.lifecycleStatus === 'candidate' && <><button onClick={() => void reviewTagDefinition(tag, 'approve').then(refresh)}>审核通过</button><button onClick={() => void reviewTagDefinition(tag, 'reject').then(refresh)}>拒绝</button></>}
          {tag.lifecycleStatus === 'active' && <><button onClick={() => void handleAlias(tag)}>别名</button><button onClick={() => void handleMergeTag(tag)}>合并</button><button onClick={() => void reviewTagDefinition(tag, 'archive').then(refresh)}>归档</button></>}
        </article>)}</div>
      </section>}

      {tab === 'relabel' && <section className="horizon-panel relabel-panel">
        <h2>{subject}旧题批量重新标注</h2>
        <p>每道题创建独立 ModelRun 并保留输入哈希与原始输出；已由用户确认并锁定的标签不会被覆盖。</p>
        <button disabled={busy || batch?.status === 'processing'} onClick={() => void startRelabel()}>开始批量重标注</button>
        {batch && <div className="batch-progress"><strong>{batch.status}</strong><progress max={batch.totalCount || 1} value={batch.completedCount + batch.failedCount} /><span>{batch.completedCount}/{batch.totalCount} 完成 · {batch.failedCount} 失败</span>
          {batch.status === 'processing' && <button onClick={() => void cancelRelabelBatch(batch.id).then(() => refreshRelabelBatch(batch.id).then(setBatch))}>取消任务</button>}</div>}
      </section>}
    </main>
  )
}
