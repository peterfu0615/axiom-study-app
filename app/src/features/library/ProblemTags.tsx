import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AI_STATUS_EVENT } from '../../ai/pipeline'
import { Icon } from '../../components/Icon'
import { Badge, Button, Dialog, IconButton, ListboxSelect, StatusBadge } from '../../components/ui'
import type { HorizonTagType } from '../../domain/models'
import {
  type ProblemTag,
  type TagDefinition,
} from '../../domain/horizon'
import {
  addProblemTag,
  getAvailableHorizonTags,
  getProblemDifficulty,
  listProblemTags,
  removeProblemTag,
  type AvailableHorizonTagsStatus,
  type ProblemDifficultyView,
} from '../../platform/horizonDatabase'

const labels: Record<HorizonTagType, string> = {
  knowledge: '知识点', method: '方法', model: '题型', error: '错误类型',
}
const difficultyLabels = { basic: '基础', intermediate: '中档', advanced: '压轴' }

export function ProblemTags({ problemId, subjectId, subject }: { problemId: string; subjectId: string | null; subject: string | null }) {
  const [tags, setTags] = useState<ProblemTag[]>([])
  const [definitions, setDefinitions] = useState<TagDefinition[]>([])
  const [difficulty, setDifficulty] = useState<ProblemDifficultyView | null>(null)
  const [availability, setAvailability] = useState<AvailableHorizonTagsStatus | 'no_subject'>('no_subject')
  const [message, setMessage] = useState<string | null>(null)
  const [picker, setPicker] = useState<{ type: HorizonTagType } | null>(null)
  const [selectedDefinitionId, setSelectedDefinitionId] = useState('')
  // Two-step removal: the first click arms the ×, the second removes.
  // Prevents accidental one-click deletes; auto-disarms shortly after.
  const [armedTagId, setArmedTagId] = useState<string | null>(null)
  const armTimerRef = useRef<number | null>(null)
  useEffect(() => () => {
    if (armTimerRef.current !== null) window.clearTimeout(armTimerRef.current)
  }, [])
  const armTagRemoval = (tagId: string) => {
    setArmedTagId(tagId)
    if (armTimerRef.current !== null) window.clearTimeout(armTimerRef.current)
    armTimerRef.current = window.setTimeout(() => {
      armTimerRef.current = null
      setArmedTagId(null)
    }, 2500)
  }
  const removeTag = (tagId: string) => {
    if (armedTagId !== tagId) {
      armTagRemoval(tagId)
      return
    }
    if (armTimerRef.current !== null) {
      window.clearTimeout(armTimerRef.current)
      armTimerRef.current = null
    }
    setArmedTagId(null)
    void removeProblemTag(tagId)
      .then(() => refresh())
      .catch((error) => setMessage(`移除标签失败：${String(error)}`))
  }

  const refresh = useCallback(async () => {
    if (!subjectId) { setTags([]); setDefinitions([]); setDifficulty(null); setAvailability('no_subject'); return }
    const [nextTags, available, nextDifficulty] = await Promise.all([
      listProblemTags(problemId), getAvailableHorizonTags(subjectId), getProblemDifficulty(problemId),
    ])
    setTags(nextTags); setDefinitions(available.tags); setDifficulty(nextDifficulty); setAvailability(available.status)
    setMessage(null)
  }, [problemId, subjectId])

  useEffect(() => {
    // Guard against out-of-order responses when switching problems quickly.
    let cancelled = false
    setArmedTagId(null)
    void refresh().catch((error) => {
      if (cancelled) return
      console.error('Horizon tag query failed', { problemId, subjectId, error })
      setMessage('标签加载失败，请稍后重试。')
    })
    return () => { cancelled = true }
  }, [problemId, refresh, subjectId])
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
  const openPicker = (type: HorizonTagType) => {
    setSelectedDefinitionId('')
    setPicker({ type })
  }

  const applyPicker = async () => {
    if (!picker || !subjectId) return
    const definition = definitions.find((item) => item.id === selectedDefinitionId)
    if (!definition) return
    try {
      await addProblemTag(problemId, subjectId, definition)
      setPicker(null)
      await refresh()
    } catch (error) {
      // Surface the failure inside the picker instead of swallowing it as an
      // unhandled rejection (e.g. cross-subject tag rejections).
      setMessage(`添加标签失败：${String(error)}`)
    }
  }

  const pickerOptions = picker
    ? definitions.filter((item) => item.tagType === picker.type)
    : []
  const emptyPickerMessage = availability === 'no_horizon_structure'
    ? '这个科目还没有知识结构。'
    : availability === 'subject_not_found' || availability === 'subject_archived'
      ? '这道题的科目当前不可用。'
      : '这个科目还没有可用的知识点。'

  return <section className="problem-tags">
    <header><div><p className="eyebrow">题目标签</p><h3>知识点、方法、题型与错误类型</h3></div><StatusBadge>{subject || '请先确认科目'}</StatusBadge></header>
    {message && <p className="problem-tag-error">{message}</p>}
    <div className="problem-tag-dimensions">
      {(['knowledge','method','model','error'] as HorizonTagType[]).map((type) => <div className="problem-tag-dimension" key={type}>
        <div className="problem-tag-dimension-title"><strong>{labels[type]}</strong><IconButton appearance="plain" className="problem-tag-add" disabled={!subject} label={`添加${labels[type]}`} onClick={() => openPicker(type)}><Icon name="plus" size={16} /></IconButton></div>
        <div className="problem-tag-collection">
          {grouped[type].map((tag) => <article className="controlled-problem-tag" key={tag.id}>
            <Badge>{tag.canonicalName}</Badge>
            <IconButton
              appearance="plain"
              aria-pressed={armedTagId === tag.id}
              className={`problem-tag-remove${armedTagId === tag.id ? ' is-armed' : ''}`}
              label={armedTagId === tag.id ? `再次点击确认移除${tag.canonicalName}` : `移除${tag.canonicalName}`}
              onClick={() => removeTag(tag.id)}
              tone="danger"
            >
              <Icon name="close" size={16} />
            </IconButton>
          </article>)}
          {!grouped[type].length && <small className="empty-tag-dimension">暂无</small>}
        </div>
      </div>)}
      <div className="problem-tag-dimension difficulty">
        <div className="problem-tag-dimension-title"><strong>难度</strong></div>
        {difficulty ? <Badge>{difficultyLabels[difficulty.level]}</Badge> : <small className="empty-tag-dimension">暂无</small>}
      </div>
    </div>
    <Dialog onClose={() => setPicker(null)} open={Boolean(picker)} title={`添加${picker ? labels[picker.type] : '标签'}`}>
      <div className="problem-tag-picker">
        <p>选择一个已有的{picker ? labels[picker.type] : '标签'}。</p>
        <ListboxSelect label="选择标签" onValueChange={setSelectedDefinitionId} options={[{ value: '', label: '请选择' }, ...pickerOptions.map((item) => ({ value: item.id, label: item.canonicalName }))]} value={selectedDefinitionId} />
        {!pickerOptions.length && <p className="problem-tag-picker__empty">{emptyPickerMessage}</p>}
        <div><Button onClick={() => setPicker(null)} variant="ghost">取消</Button><Button disabled={!selectedDefinitionId} onClick={() => void applyPicker()} variant="primary">确认</Button></div>
      </div>
    </Dialog>
  </section>
}
