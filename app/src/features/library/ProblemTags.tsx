import { useCallback, useEffect, useMemo, useState } from 'react'
import { AI_STATUS_EVENT } from '../../ai/pipeline'
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

export function ProblemTags({ problemId, subject }: { problemId: string; subject: string | null }) {
  const [tags, setTags] = useState<ProblemTag[]>([])
  const [definitions, setDefinitions] = useState<TagDefinition[]>([])
  const [difficulty, setDifficulty] = useState<ProblemDifficultyView | null>(null)
  const [message, setMessage] = useState<string | null>(null)

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

  const mapCandidate = async (tag: ProblemTag) => {
    const available = definitions.filter((item) => item.tagType === tag.tagType && item.lifecycleStatus === 'active')
    const target = window.prompt(
      `输入要映射的标签 ID：\n${available.map((item) => `${item.id}  ${item.canonicalName}`).join('\n')}`,
    )
    if (!target?.trim()) return
    await confirmProblemTag(tag.id, target.trim()); await refresh()
  }

  const addTag = async (type: HorizonTagType) => {
    if (!subject) return
    const available = definitions.filter((item) => item.tagType === type && item.lifecycleStatus === 'active')
    const target = window.prompt(
      `输入${labels[type]}标签 ID：\n${available.map((item) => `${item.id}  ${item.canonicalName}`).join('\n')}`,
    )
    const definition = available.find((item) => item.id === target?.trim())
    if (!definition) return
    await addProblemTag(problemId, subject, definition); await refresh()
  }

  return <section className="problem-horizon-tags">
    <header><div><p className="eyebrow">Horizon 标签</p><h3>科目内四维标注</h3></div><span>{subject || '请先确认科目'}</span></header>
    {message && <p className="problem-tag-error">{message}</p>}
    <div className="problem-tag-dimensions">
      {(['knowledge','method','model','error'] as HorizonTagType[]).map((type) => <div className="problem-tag-dimension" key={type}>
        <div className="problem-tag-dimension-title"><strong>{labels[type]}</strong><button disabled={!subject} onClick={() => void addTag(type)}>添加</button></div>
        {grouped[type].map((tag) => <article className={`controlled-problem-tag ${tag.mappingStatus}`} key={tag.id}>
          <div><strong>{tag.canonicalName}</strong><small>{tag.role === 'primary' ? '核心' : '辅助'} · {Math.round(tag.confidence * 100)}% · {tag.source}</small></div>
          <p>{tag.evidence || '未提供标签依据'}</p>
          <span>{tag.mappingStatus} · v{tag.taxonomyVersion}{tag.isLocked ? ' · 已锁定' : ''}</span>
          <div>{tag.mappingStatus === 'mapped' && !tag.isLocked && <button onClick={() => void confirmProblemTag(tag.id).then(refresh)}>确认并锁定</button>}
            {tag.mappingStatus !== 'mapped' && <button onClick={() => void mapCandidate(tag)}>映射</button>}
            <button onClick={() => void removeProblemTag(tag.id).then(refresh)}>移除</button></div>
        </article>)}
        {!grouped[type].length && <small className="empty-tag-dimension">暂无{labels[type]}</small>}
      </div>)}
      <div className="problem-tag-dimension difficulty">
        <div className="problem-tag-dimension-title"><strong>难度</strong></div>
        {difficulty ? <article className="controlled-problem-tag mapped"><div><strong>{difficultyLabels[difficulty.level]}</strong><small>{Math.round(difficulty.confidence * 100)}% · {difficulty.source}</small></div><p>{difficulty.reason || '未提供难度依据'}</p><span>{difficulty.verificationStatus}{difficulty.isLocked ? ' · 已锁定' : ''}</span>{!difficulty.isLocked && <div><button onClick={() => void confirmProblemDifficulty(difficulty.id).then(refresh)}>确认并锁定</button></div>}</article> : <small className="empty-tag-dimension">暂无难度</small>}
      </div>
    </div>
  </section>
}
