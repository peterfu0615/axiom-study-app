import { Icon } from './Icon'
import { SidebarItem } from './ui'

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
  return (
    <aside className="sidebar">
      <div className="traffic-light-space" data-tauri-drag-region />
      <div className="brand">
        {/* 文字式 wordmark：fill 跟随 currentColor（--brand），随颜色主题联动 */}
        <svg
          aria-label="Axiom"
          aria-hidden="true"
          className="brand-icon"
          fill="currentColor"
          role="img"
          viewBox="0 0 124 30"
          xmlns="http://www.w3.org/2000/svg"
        >
          <text
            fontFamily="Georgia, 'Times New Roman', 'Songti SC', serif"
            fontSize="28"
            fontStyle="italic"
            fontWeight="700"
            x="0"
            y="24"
          >
            Axiom
          </text>
        </svg>
      </div>

      <nav aria-label="主要导航">
        {items.map((item) => (
          <SidebarItem
            active={active === item.id}
            data-sidebar-section={item.id}
            icon={item.icon}
            key={item.id}
            label={item.label}
            onClick={() => onChange(item.id)}
          />
        ))}
      </nav>

      <div className="sidebar-footer">
        <SidebarItem
          active={active === 'settings'}
          data-sidebar-section="settings"
          icon="settings"
          label="设置"
          onClick={() => onChange('settings')}
        />

      </div>
    </aside>
  )
}
