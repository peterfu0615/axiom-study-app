import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AI_STATUS_EVENT } from '../../ai/pipeline'
import { Icon } from '../../components/Icon'
import { Toast } from '../../components/Toast'
import { Badge, Button, Dialog, DialogFooter, IconButton, Input, ListboxSelect, StatusBadge } from '../../components/ui'
import { userFacingError } from '../../domain/userFacingError'
import type { HorizonTagType } from '../../domain/models'
import {
  type ProblemTag,
  type TagDefinition,
} from '../../domain/horizon'
import {
  addProblemTag,
  confirmProblemTag,
  createTagDefinition,
  getAvailableHorizonTags,
  getProblemDifficulty,
  listProblemTags,
  removeProblemTag,
  type AvailableHorizonTagsStatus,
  type ProblemDifficultyView,
} from '../../platform/horizonDatabase'
import { useToast } from '../../platform/useToast'

const labels: Record<HorizonTagType, string> = {
  knowledge: '知识点', method: '方法', model: '题型', error: '错误类型',
}
const difficultyLabels = { basic: '基础', intermediate: '中档', advanced: '压轴' }

export function ProblemTags({ problemId, subjectId, subject, onChange }: { problemId: string; subjectId: string | null; subject: string | null; onChange?: () => void }) {
  const [tags, setTags] = useState<ProblemTag[]>([])
  const [definitions, setDefinitions] = useState<TagDefinition[]>([])
  const [difficulty, setDifficulty] = useState<ProblemDifficultyView | null>(null)
  const [availability, setAvailability] = useState<AvailableHorizonTagsStatus | 'no_subject'>('no_subject')
  const [message, setMessage] = useState<string | null>(null)
  const [picker, setPicker] = useState<{ type: HorizonTagType } | null>(null)
  const [selectedDefinitionId, setSelectedDefinitionId] = useState('')
  const [newTagName, setNewTagName] = useState('')
  const reqSeqRef = useRef(0)
  const { toast, notify, dismiss, pauseAutoDismiss, resumeAutoDismiss } = useToast()

  const refresh = useCallback(async () => {
    const seq = ++reqSeqRef.current
    const targetProblemId = problemId
    const targetSubjectId = subjectId
    if (!targetSubjectId) {
      if (reqSeqRef.current === seq) {
        setTags([])
        setDefinitions([])
        setDifficulty(null)
        setAvailability('no_subject')
      }
      return
    }
    const [nextTags, available, nextDifficulty] = await Promise.all([
      listProblemTags(targetProblemId),
      getAvailableHorizonTags(targetSubjectId),
      getProblemDifficulty(targetProblemId),
    ])
    if (reqSeqRef.current === seq) {
      setTags(nextTags)
      setDefinitions(available.tags)
      setDifficulty(nextDifficulty)
      setAvailability(available.status)
      setMessage(null)
    }
  }, [problemId, subjectId])

  const removeTag = async (tag: ProblemTag) => {
    const definition = definitions.find((item) => item.id === tag.tagId)
    setMessage(null)
    try {
      await removeProblemTag(tag.id)
      await refresh()
      onChange?.()
      notify(`已移除“${tag.canonicalName}”标签。`, 'info', definition && subjectId ? {
        duration: 6000,
        action: {
          label: '撤销',
          onClick: () => {
            void (async () => {
              try {
                await addProblemTag(problemId, subjectId, definition, tag.role)
                await refresh()
                onChange?.()
                notify(`已恢复“${tag.canonicalName}”标签。`, 'success')
              } catch (error) {
                console.warn('撤销移除题目标签失败', error)
                notify(userFacingError(error, '标签没有恢复，请重新添加。'), 'error')
              }
            })()
          },
        },
      } : undefined)
    } catch (error) {
      console.warn('移除题目标签失败', error)
      setMessage(userFacingError(error, '标签没有移除，请重试。'))
    }
  }

  useEffect(() => {
    void refresh().catch((error) => {
      console.error('Horizon tag query failed', { problemId, subjectId, error })
      setMessage('标签加载失败，请稍后重试。')
    })
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
      onChange?.()
    } catch (error) {
      // Surface the failure inside the picker instead of swallowing it as an
      // unhandled rejection (e.g. cross-subject tag rejections).
      console.warn('添加题目标签失败', error)
      setMessage(userFacingError(error, '标签没有添加，请检查选择后重试。'))
    }
  }

  const createAndApplyTag = async () => {
    if (!picker || !subjectId || !subject?.trim() || !newTagName.trim() || picker.type === 'knowledge') return
    try {
      const tagId = await createTagDefinition({
        subject: subject.trim(), tagType: picker.type, canonicalName: newTagName.trim(), approved: true,
        methodClass: picker.type === 'method' ? 'optional' : null,
      })
      const available = await getAvailableHorizonTags(subjectId)
      const definition = available.tags.find((item) => item.id === tagId)
      if (!definition) throw new Error('新标签创建后无法读取')
      await addProblemTag(problemId, subjectId, definition)
      setPicker(null); setNewTagName('')
      await refresh()
      onChange?.()
    } catch (error) {
      console.warn('创建题目标签失败', error)
      setMessage(userFacingError(error, '标签没有创建，当前输入仍然保留。请重试。'))
    }
  }

  const confirmTag = async (tagId: string) => {
    try {
      await confirmProblemTag(tagId)
      await refresh()
      onChange?.()
    } catch (error) {
      console.warn('确认题目标签失败', error)
      setMessage(userFacingError(error, '标签没有确认，请重试。'))
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
    {message && <p className="problem-tag-error" role="alert">{message}</p>}
    <div className="problem-tag-dimensions">
      {(['knowledge','method','model','error'] as HorizonTagType[]).map((type) => <div className="problem-tag-dimension" key={type}>
        <div className="problem-tag-dimension-title"><strong>{labels[type]}</strong><IconButton appearance="plain" className="problem-tag-add" disabled={!subject} label={`添加${labels[type]}`} onClick={() => openPicker(type)}><Icon name="plus" size={16} /></IconButton></div>
        <div className="problem-tag-collection">
          {grouped[type].map((tag) => <article className="controlled-problem-tag" key={tag.id}>
            <Badge>{tag.canonicalName}</Badge>
            {tag.tagId && tag.verificationStatus !== 'user_verified' && tag.verificationStatus !== 'rejected' && <Button onClick={() => void confirmTag(tag.id)} variant="ghost">确认</Button>}
            <IconButton
              appearance="plain"
              className="problem-tag-remove"
              label={`移除${tag.canonicalName}`}
              onClick={() => void removeTag(tag)}
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
        {picker && picker.type !== 'knowledge' && <Input label={`或创建新的${labels[picker.type]}`} onChange={(event) => setNewTagName(event.target.value)} placeholder={`输入${labels[picker.type]}名称`} value={newTagName} />}
        <DialogFooter><Button onClick={() => setPicker(null)} variant="ghost">取消</Button>{newTagName.trim() && picker?.type !== 'knowledge' ? <Button onClick={() => void createAndApplyTag()} variant="primary">创建并添加</Button> : <Button disabled={!selectedDefinitionId} onClick={() => void applyPicker()} variant="primary">添加标签</Button>}</DialogFooter>
      </div>
    </Dialog>
    <Toast toast={toast} onClose={dismiss} onPause={pauseAutoDismiss} onResume={resumeAutoDismiss} />
  </section>
}
