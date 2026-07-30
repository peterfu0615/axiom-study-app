import type { AppSection } from '../../components/Sidebar'

const modules: Record<
  Exclude<AppSection, 'capture'>,
  { eyebrow: string; title: string; description: string; phase: string }
> = {
  today: {
    eyebrow: '复习调度',
    title: '今日',
    description:
      '完成题目结构化与复习状态模型后，这里会生成每日到期队列。',
    phase: '阶段 3',
  },
  library: {
    eyebrow: '知识资产',
    title: '错题库',
    description: '自动切题完成后，可在这里搜索、筛选和订正每一道错题。',
    phase: '阶段 1',
  },
  insights: {
    eyebrow: '学习分析',
    title: '洞察',
    description: '积累真实作答和复习记录后，这里会呈现薄弱知识点与错因趋势。',
    phase: '阶段 3',
  },
  settings: {
    eyebrow: '应用偏好',
    title: '设置',
    description: '后续可配置模型服务、教材体系、隐私和每日复习上限。',
    phase: '阶段 2–3',
  },
}

export function ModulePlaceholder({
  section,
}: {
  section: Exclude<AppSection, 'capture'>
}) {
  const module = modules[section]
  return (
    <main className="workspace placeholder-workspace">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">{module.eyebrow}</p>
          <h1>{module.title}</h1>
        </div>
      </header>
      <div className="module-placeholder">
        <span>{module.phase}</span>
        <h2>模块边界已经预留</h2>
        <p>{module.description}</p>
      </div>
    </main>
  )
}
