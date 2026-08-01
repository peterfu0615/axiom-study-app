import { useCallback, useEffect, useMemo, useState } from 'react'
import { AI_STATUS_EVENT } from '../../ai/pipeline'
import { Button, Dialog, StatusBadge } from '../../components/ui'
import type { HorizonTagType } from '../../domain/models'
import type { ProblemTag, TagDefinition } from '../../domain/horizon'
import {
  addProblemTag,
  confirmProblemDifficulty,
  confirmProblemTag,
  getProblemDifficulty,
  listProblemTags,
  listTagDefinitions,
  removeProblemTag,
  type ProblemDifficultyView,
} from '../../platform/horizonDatabase'

const labels: Record<HorizonTagType, string> = {
  knowledge: '知识点', method: '方法', model: '题型模型', error: '错误类型',
}
const difficultyLabels = { basic: '基础', intermediate: '中档', advanced: '压轴' }
const sourceLabels: Record<ProblemTag['source'], string> = {
  model: 'AI 识别', textbook: '教材', user: '手动添加', legacy: '历史数据',
}

function mappingStatus(tag: ProblemTag) {
  if (tag.isLocked) return { label: '已确认', tone: 'success' as const }
  if (tag.mappingStatus === 'mapped') return { label: '待确认', tone: 'warning' as const }
  if (tag.mappingStatus === 'candidate') return { label: '待确认对应', tone: 'warning' as const }
  return { label: '未映射', tone: 'neutral' as const }
}

function difficultyStatus(difficulty: ProblemDifficultyView) {
  return difficulty.isLocked || difficulty.verificationStatus === 'user_verified'
    ? { label: '已确认', tone: 'success' as const }
    : { label: '待确认', tone: 'warning' as const }
}

export function ProblemTags({ problemId, subject }: { problemId: string; subject: string | null }) {
  const [tags, setTags] = useState<ProblemTag[]>([])
  const [definitions, setDefinitions] = useState<TagDefinition[]>([])
  const [difficulty, setDifficulty] = useState<ProblemDifficultyView | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [picker, setPicker] = useState<{ tag: ProblemTag | null; type: HorizonTagType } | null>(null)
  const [selectedDefinitionId, setSelectedDefinitionId] = useState('')

  const refresh = useCallback(async () => {
    if (!subject) { setTags([]); setDefinitions([]); setDifficulty(null); return }
    const [nextTags, nextDefinitions, nextDifficulty] = await Promise.all([
      listProblemTags(problemId), listTagDefinitions(subject), getProblemDifficulty(problemId),
    ])
    setTags(nextTags); setDefinitions(nextDefinitions); setDifficulty(nextDifficulty)
  }, [problemId, subject])

  useEffect(() => { void refresh().catch((error) => setMessage(String(error))) }, [refresh])
  useEffect(() => {
    const listener = (event: Event) => {
      if ((event as CustomEvent<{ problemId?: string }>).detail?.problemId === problemId) void refresh()
    }
    window.addEventListener(AI_STATUS_EVENT, listener)
    return () => window.removeEventListener(AI_STATUS_EVENT, listener)
  }, [problemId, refresh])

  const grouped = useMemo(() => Object.fromEntries(
    (['knowledge','method','model','error'] as HorizonTagType[])
      .map((type) => [type, tags.filter((tag) => tag.tagType === type)]),
  ) as Record<HorizonTagType, ProblemTag[]>, [tags])

  const openPicker = (type: HorizonTagType, tag: ProblemTag | null) => {
    setSelectedDefinitionId('')
    setPicker({ type, tag })
  }

  const applyPicker = async () => {
    if (!picker || !subject) return
    const definition = definitions.find((item) => item.id === selectedDefinitionId)
    if (!definition) return
    if (picker.tag) await confirmProblemTag(picker.tag.id, definition.id)
    else await addProblemTag(problemId, subject, definition)
    setPicker(null)
    await refresh()
  }

  const pickerOptions = picker
    ? definitions.filter((item) => item.tagType === picker.type && item.lifecycleStatus === 'active')
    : []

  return <section className="problem-tags">
    <header><div><p className="eyebrow">题目标签</p><h3>知识点、方法、题型与错误类型</h3></div><StatusBadge>{subject || '请先确认科目'}</StatusBadge></header>
    {message && <p className="problem-tag-error">{message}</p>}
    <div className="problem-tag-dimensions">
      {(['knowledge','method','model','error'] as HorizonTagType[]).map((type) => <div className="problem-tag-dimension" key={type}>
        <div className="problem-tag-dimension-title"><strong>{labels[type]}</strong><Button disabled={!subject} onClick={() => openPicker(type, null)} variant="ghost">添加</Button></div>
        {grouped[type].map((tag) => <article className={`controlled-problem-tag ${tag.mappingStatus}`} key={tag.id}>
          <div><strong>{tag.canonicalName}</strong><small>{tag.role === 'primary' ? '核心' : '辅助'} · {Math.round(tag.confidence * 100)}% · {sourceLabels[tag.source]}</small></div>
          <p>{tag.evidence || '未提供标签依据'}</p>
          <StatusBadge tone={mappingStatus(tag).tone}>{mappingStatus(tag).label}</StatusBadge>
          <div>{tag.mappingStatus === 'mapped' && !tag.isLocked && <Button onClick={() => void confirmProblemTag(tag.id).then(refresh)} variant="secondary">确认</Button>}
            {tag.mappingStatus !== 'mapped' && <Button onClick={() => openPicker(type, tag)} variant="secondary">选择对应标签</Button>}
            <Button onClick={() => void removeProblemTag(tag.id).then(refresh)} variant="ghost">移除</Button></div>
        </article>)}
        {!grouped[type].length && <small className="empty-tag-dimension">暂无{labels[type]}</small>}
      </div>)}
      <div className="problem-tag-dimension difficulty">
        <div className="problem-tag-dimension-title"><strong>难度</strong></div>
        {difficulty ? <article className="controlled-problem-tag mapped"><div><strong>{difficultyLabels[difficulty.level]}</strong><small>{Math.round(difficulty.confidence * 100)}% · {sourceLabels[difficulty.source]}</small></div><p>{difficulty.reason || '未提供难度依据'}</p><StatusBadge tone={difficultyStatus(difficulty).tone}>{difficultyStatus(difficulty).label}</StatusBadge>{!difficulty.isLocked && <div><Button onClick={() => void confirmProblemDifficulty(difficulty.id).then(refresh)} variant="secondary">确认</Button></div>}</article> : <small className="empty-tag-dimension">暂无难度</small>}
      </div>
    </div>
    <Dialog onClose={() => setPicker(null)} open={Boolean(picker)} title={picker?.tag ? `确认${labels[picker.type]}对应关系` : `添加${picker ? labels[picker.type] : '标签'}`}>
      <div className="problem-tag-picker">
        <p>{picker?.tag ? `“${picker.tag.canonicalName}”需要对应到当前科目中的一个标签。` : `选择一个已确认的${picker ? labels[picker.type] : '标签'}。`}</p>
        <label>选择标签<select onChange={(event) => setSelectedDefinitionId(event.target.value)} value={selectedDefinitionId}><option value="">请选择</option>{pickerOptions.map((item) => <option key={item.id} value={item.id}>{item.canonicalName}</option>)}</select></label>
        {!pickerOptions.length && <p className="problem-tag-picker__empty">当前科目还没有可选标签，请先在课程中创建或确认标签。</p>}
        <div><Button onClick={() => setPicker(null)} variant="ghost">取消</Button><Button disabled={!selectedDefinitionId} onClick={() => void applyPicker()} variant="primary">确认</Button></div>
      </div>
    </Dialog>
  </section>
}
