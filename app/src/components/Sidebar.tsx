import { Icon } from './Icon'
import axiomIconLight from '../../../icons/Axiom-Icon-GR/axiom-icon-gr/Default/axiom-icon-gr-iOS-Default-1024@1x.png'
import axiomIconDark from '../../../icons/Axiom-Icon-GR/axiom-icon-gr/Default/axiom-icon-gr-iOS-Dark-1024@1x.png'
import { useTheme } from '../platform/theme'

export type AppSection =
  | 'today'
  | 'capture'
  | 'library'
  | 'curriculum'
  | 'insights'
  | 'settings'

const items: Array<{
  id: AppSection
  label: string
  icon: Parameters<typeof Icon>[0]['name']
}> = [
  { id: 'today', label: '今日', icon: 'today' },
  { id: 'capture', label: '采集', icon: 'capture' },
  { id: 'library', label: '错题库', icon: 'library' },
  { id: 'curriculum', label: '课程', icon: 'curriculum' },
  { id: 'insights', label: '洞察', icon: 'insights' },
]

export function Sidebar({
  active,
  onChange,
}: {
  active: AppSection
  onChange: (section: AppSection) => void
}) {
  const { resolvedAppearance } = useTheme()

  return (
    <aside className="sidebar">
      <div className="traffic-light-space" data-tauri-drag-region />
      <div className="brand">
        <img
          alt="Axiom"
          className="brand-icon"
          src={resolvedAppearance === 'dark' ? axiomIconDark : axiomIconLight}
        />
      </div>

      <nav aria-label="主要导航">
        {items.map((item) => (
          <button
            className={`nav-item ${active === item.id ? 'active' : ''}`}
            key={item.id}
            onClick={() => onChange(item.id)}
            type="button"
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <button
          className={`nav-item ${active === 'settings' ? 'active' : ''}`}
          onClick={() => onChange('settings')}
          type="button"
        >
          <Icon name="settings" />
          <span>设置</span>
        </button>
        <div className="local-first-note">
          <span className="status-dot" />
          数据保存在本机
        </div>
      </div>
    </aside>
  )
}
