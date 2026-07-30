import { Icon } from './Icon'
import { useTheme } from '../platform/theme'
import axiomWordmark from '../../../icons/axiom_text.png'

export type AppSection =
  | 'today'
  | 'capture'
  | 'library'
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
  { id: 'insights', label: '洞察', icon: 'insights' },
]

export function Sidebar({
  active,
  onChange,
}: {
  active: AppSection
  onChange: (section: AppSection) => void
}) {
  const { resolvedTheme, toggle } = useTheme()
  return (
    <aside className="sidebar">
      <div className="traffic-light-space" data-tauri-drag-region />
      <div className="brand">
        <img
          alt="Axiom"
          className="brand-wordmark"
          src={axiomWordmark}
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
          className="nav-item"
          onClick={toggle}
          type="button"
          aria-label={
            resolvedTheme === 'dark' ? '切换到浅色模式' : '切换到深色模式'
          }
        >
          <Icon name={resolvedTheme === 'dark' ? 'sun' : 'moon'} />
          <span>{resolvedTheme === 'dark' ? '浅色模式' : '深色模式'}</span>
        </button>
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
          本地数据已启用
        </div>
      </div>
    </aside>
  )
}
