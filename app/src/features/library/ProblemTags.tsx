import { useCallback, useEffect, useMemo, useState } from 'react'
import { AI_STATUS_EVENT } from '../../ai/pipeline'
import { Badge, Button, Dialog, ListboxSelect, StatusBadge } from '../../components/ui'
import type { HorizonTagType } from '../../domain/models'
import {
  summarizeProblemTagOutcome,
  type ProblemTag,
  type TagDefinition,
} from '../../domain/horizon'
import {
  addProblemTag,
  confirmProblemDifficulty,
  confirmProblemTag,
  getProblemDifficulty,
  getProblemTextbookMatch,
  keepProblemTag,
  listProblemTags,
  listTagDefinitions,
  removeProblemTag,
  setProblemTextbookMatch,
  type ProblemTextbookMatchView,
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
  if (tag.mappingStatus === 'rejected' || tag.verificationStatus === 'rejected') {
    return { label: '已驳回', tone: 'danger' as const }
  }
  if (tag.isLocked) return { label: '已确认', tone: 'success' as const }
  return { label: '待处理', tone: 'warning' as const }
}

function difficultyStatus(difficulty: ProblemDifficultyView) {
  return difficulty.isLocked || difficulty.verificationStatus === 'user_verified'
    ? { label: '已确认', tone: 'success' as const }
    : { label: '待确认', tone: 'warning' as const }
}

const textbookMatchSourceLabels: Record<ProblemTextbookMatchView['source'], string> = {
  single_subject_textbook: '单一科目教材自动匹配',
  metadata_match: '教材元数据匹配',
  ai_hint: 'AI 教材线索',
  user: '用户已确认',
  legacy_current_fallback: '兼容旧版本选择',
  unresolved: '未找到对应教材',
}

export function ProblemTags({ problemId, subject }: { problemId: string; subject: string | null }) {
  const [tags, setTags] = useState<ProblemTag[]>([])
  const [definitions, setDefinitions] = useState<TagDefinition[]>([])
  const [difficulty, setDifficulty] = useState<ProblemDifficultyView | null>(null)
  const [textbookMatch, setTextbookMatch] = useState<ProblemTextbookMatchView | null>(null)
  const [selectedTextbookId, setSelectedTextbookId] = useState('')
  const [textbookBusy, setTextbookBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [picker, setPicker] = useState<{ type: HorizonTagType } | null>(null)
  const [selectedDefinitionId, setSelectedDefinitionId] = useState('')

  const refresh = useCallback(async () => {
    if (!subject) { setTags([]); setDefinitions([]); setDifficulty(null); setTextbookMatch(null); return }
    const [nextTags, nextDefinitions, nextDifficulty, nextTextbookMatch] = await Promise.all([
      listProblemTags(problemId), listTagDefinitions(subject), getProblemDifficulty(problemId), getProblemTextbookMatch(problemId),
    ])
    setTags(nextTags); setDefinitions(nextDefinitions); setDifficulty(nextDifficulty); setTextbookMatch(nextTextbookMatch)
    setSelectedTextbookId(nextTextbookMatch?.textbook?.id ?? '')
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
  const outcome = useMemo(() => summarizeProblemTagOutcome({
    tags,
    definitions,
    selectedTextbookId: textbookMatch?.textbook?.id ?? null,
  }), [definitions, tags, textbookMatch?.textbook?.id])

  const openPicker = (type: HorizonTagType) => {
    setSelectedDefinitionId('')
    setPicker({ type })
  }

  const applyPicker = async () => {
    if (!picker || !subject) return
    const definition = definitions.find((item) => item.id === selectedDefinitionId)
    if (!definition) return
    await addProblemTag(problemId, subject, definition)
    setPicker(null)
    await refresh()
  }

  const updateTextbookMatch = async (textbookId: string | null, lock: boolean) => {
    setTextbookBusy(true)
    setMessage(null)
    try {
      await setProblemTextbookMatch(problemId, textbookId, lock)
      await refresh()
    } catch (error) {
      setMessage(String(error))
    } finally {
      setTextbookBusy(false)
    }
  }

  const pickerOptions = picker
    ? definitions.filter((item) => item.tagType === picker.type && item.lifecycleStatus === 'active' &&
      (picker.type !== 'knowledge' || item.textbookId === textbookMatch?.textbook?.id))
    : []

  return <section className="problem-tags">
    <header><div><p className="eyebrow">题目标签</p><h3>知识点、方法、题型与错误类型</h3></div><StatusBadge>{subject || '请先确认科目'}</StatusBadge></header>
    {message && <p className="problem-tag-error">{message}</p>}
    {textbookMatch && <section className="problem-textbook-match" aria-label="题目教材匹配">
      <div className="problem-textbook-match__header">
        <div><strong>对应教材</strong><small>{textbookMatch.textbook?.title || '未找到对应教材'}</small></div>
        <StatusBadge tone={textbookMatch.locked ? 'success' : textbookMatch.textbook ? 'warning' : 'neutral'}>
          {textbookMatch.locked ? '用户已确认' : textbookMatch.textbook ? '待确认' : '未匹配'}
        </StatusBadge>
      </div>
      <p className="problem-textbook-match__reason">识别依据：{textbookMatch.reason || textbookMatchSourceLabels[textbookMatch.source]}</p>
      <div className="problem-textbook-match__actions">
        <ListboxSelect
          ariaLabel="选择本题教材"
          disabled={textbookBusy}
          onValueChange={setSelectedTextbookId}
          options={[{ value: '', label: '未匹配' }, ...textbookMatch.candidates.map((book) => ({ value: book.id, label: `${book.title}${book.grade || book.volume ? `（${[book.grade, book.volume].filter(Boolean).join(' · ')}）` : ''}` }))]}
          value={selectedTextbookId}
        />
        <div>
          <Button disabled={textbookBusy || !selectedTextbookId || (textbookMatch.locked && selectedTextbookId === textbookMatch.textbook?.id)} onClick={() => void updateTextbookMatch(selectedTextbookId, true)} variant="secondary">{textbookMatch.locked ? '更换教材' : '确认教材'}</Button>
          {textbookMatch.textbook && <Button disabled={textbookBusy} onClick={() => void updateTextbookMatch(null, false)} variant="ghost">清除匹配</Button>}
        </div>
      </div>
    </section>}
    {subject && textbookMatch && tags.length === 0 && <section className="problem-tag-outcome" aria-label="AI 标签结果">
      <div className="problem-textbook-match__header">
        <div><strong>{outcome.title}</strong><small>{outcome.detail}</small></div>
        <StatusBadge tone={outcome.code === 'mapped' ? 'success' : outcome.code === 'needs_review' || outcome.code === 'unresolved' ? 'warning' : 'neutral'}>
          {outcome.code === 'no_textbook' ? '未匹配教材' : '无结果'}
        </StatusBadge>
      </div>
    </section>}
    <div className="problem-tag-dimensions">
      {(['knowledge','method','model','error'] as HorizonTagType[]).map((type) => <div className="problem-tag-dimension" key={type}>
        <div className="problem-tag-dimension-title"><strong>{labels[type]}</strong><Button disabled={!subject} onClick={() => openPicker(type)} variant="ghost">添加</Button></div>
        {grouped[type].map((tag) => <article className={`controlled-problem-tag ${tag.mappingStatus}`} key={tag.id}>
          <div className="controlled-problem-tag__heading"><Badge>{tag.canonicalName}</Badge><small>{sourceLabels[tag.source]}</small></div>
          <p>{tag.evidence || '未提供标签依据'}</p>
          <StatusBadge tone={mappingStatus(tag).tone}>{mappingStatus(tag).label}</StatusBadge>
          <div className="controlled-problem-tag__actions">{!tag.isLocked && <Button onClick={() => void (tag.mappingStatus === 'mapped' ? confirmProblemTag(tag.id) : keepProblemTag(tag.id)).then(refresh)} variant="secondary">保留</Button>}
            <Button onClick={() => void removeProblemTag(tag.id).then(refresh)} variant="ghost">移除</Button></div>
        </article>)}
        {!grouped[type].length && <small className="empty-tag-dimension">暂无{labels[type]}</small>}
      </div>)}
      <div className="problem-tag-dimension difficulty">
        <div className="problem-tag-dimension-title"><strong>难度</strong></div>
        {difficulty ? <article className="controlled-problem-tag mapped"><div className="controlled-problem-tag__heading"><strong>{difficultyLabels[difficulty.level]}</strong><small>{sourceLabels[difficulty.source]}</small></div><p>{difficulty.reason || '未提供难度依据'}</p><StatusBadge tone={difficultyStatus(difficulty).tone}>{difficultyStatus(difficulty).label}</StatusBadge>{!difficulty.isLocked && <div className="controlled-problem-tag__actions"><Button onClick={() => void confirmProblemDifficulty(difficulty.id).then(refresh)} variant="secondary">保留</Button></div>}</article> : <small className="empty-tag-dimension">暂无难度</small>}
      </div>
    </div>
    <Dialog onClose={() => setPicker(null)} open={Boolean(picker)} title={`添加${picker ? labels[picker.type] : '标签'}`}>
      <div className="problem-tag-picker">
        <p>选择一个已有的{picker ? labels[picker.type] : '标签'}。</p>
        <ListboxSelect label="选择标签" onValueChange={setSelectedDefinitionId} options={[{ value: '', label: '请选择' }, ...pickerOptions.map((item) => ({ value: item.id, label: item.canonicalName }))]} value={selectedDefinitionId} />
        {!pickerOptions.length && <p className="problem-tag-picker__empty">{picker?.type === 'knowledge' && !textbookMatch?.textbook ? '本题尚未匹配教材，暂时不能添加教材知识点。' : '当前科目还没有可选标签，请先在课程中创建标签。'}</p>}
        <div><Button onClick={() => setPicker(null)} variant="ghost">取消</Button><Button disabled={!selectedDefinitionId} onClick={() => void applyPicker()} variant="primary">确认</Button></div>
      </div>
    </Dialog>
  </section>
}
