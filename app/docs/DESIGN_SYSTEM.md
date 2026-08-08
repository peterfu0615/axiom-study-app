# Axiom Design System

## Philosophy

Desktop-first、macOS-native feeling、information-dense but calm。内容（题目、教材、知识结构、分析）是主角；黄色仅是明确主操作和 focus，不是大面积装饰。优先 spacing、typography、surface 层级，避免 dashboard 化、无意义渐变、每区都 card。

## Tokens

采用 CSS variables，语义 token 不直接在 feature 写 hex。现有浅/暗主题可映射到下列名称。

```css
:root {
  --ax-color-bg: #fffdf7; --ax-color-surface: #fffaf0;
  --ax-color-inset: #fff7d8; --ax-color-elevated: #fffdf7;
  --ax-color-hover: #fff4bf; --ax-color-selected: #fff4bf;
  --ax-text-primary: #29261d; --ax-text-secondary: #746f61;
  --ax-text-tertiary: #938d7f; --ax-text-disabled: #aaa391;
  --ax-border-subtle: #f2ead0; --ax-border-default: #eadfae;
  --ax-border-strong: #c8bb86; --ax-border-focus: #d9aa00;
  --ax-accent: #ffd50a; --ax-accent-hover: #e6bd00; --ax-accent-ink: #4a3b00;
  --ax-success-fg: #6a5100; --ax-success-bg: #fff2bf;
  --ax-warning-fg: #8a5710; --ax-warning-bg: #fff0c7;
  --ax-danger-fg: #b34a42; --ax-danger-bg: #fbe9e7; --ax-info-fg: #556b8d;
  --ax-space-1: 2px; --ax-space-2: 4px; --ax-space-3: 6px; --ax-space-4: 8px;
  --ax-space-5: 12px; --ax-space-6: 16px; --ax-space-7: 20px; --ax-space-8: 24px; --ax-space-9: 32px; --ax-space-10: 40px;
  --ax-radius-sm: 6px; --ax-radius-md: 9px; --ax-radius-lg: 14px; --ax-radius-pill: 999px;
  --ax-control-sm: 32px; --ax-control-md: 38px; --ax-control-lg: 44px;
  --ax-shadow-floating: 0 16px 40px rgb(17 17 17 / 18%), 0 2px 8px rgb(17 17 17 / 9%);
  --ax-motion-instant: 80ms; --ax-motion-fast: 140ms; --ax-motion-standard: 180ms;
}
```

Dark theme changes token values only. No new literal hex, font size, radius, shadow, z-index or static inline visual style without a token decision.

## Typography and sizing

System stack: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", sans-serif`.

| Token | Size/line/weight | Usage |
| --- | --- | --- |
| PageTitle | 22/30/650 | 一个页面一个。 |
| SectionTitle | 16/24/650 | section heading。 |
| ItemTitle | 14/20/600 | card/list title。 |
| Body | 13/20/400 | 默认正文。 |
| BodyStrong | 13/20/600 | 值/强调。 |
| Secondary | 12/18/400 | helper/metadata。 |
| Label | 11/16/650 | 表单标签，不作正文。 |
| Caption | 10/14/600 | 稀少的状态/计数。 |

并排 control 一律 md=38px，13px 文本，12px horizontal padding，16px icon，7px icon gap；sm 只用于 dense table/action，lg 只用于主导入 CTA。

## Surfaces, cards and primitives

Page Surface 是 bg；Section 是 title+spacing，默认无 box；Card 只表示独立实体（教材、错题、任务）；Card 内强调使用 Inset Surface；Row 用于设置和列表。可见 hierarchy 最多两层。普通 Card 无明显 shadow，floating menu/dialog 才用 shadow。

Button：primary（每视觉群最多一个）、secondary、ghost、danger。Input/Select 共享 border/radius/height/focus。唯一 Select 是 `ListboxSelect`：Chevron/selected check 使用 `Icon`，menu 与 trigger 同宽，option min-height 36px，portal，keyboard/typeahead/escape 必须保留。Badge 表示分类；Status 表示运行状态，fit-content，永远有文字/图标而非只颜色。

Dialog 只有 backdrop、header、scroll body、footer actions；Popover 用 floating shadow。Loading：button=spinner，局部未知内容=skeleton，确定时长=progress，FlowingTaskSurface=多阶段教材/AI 长任务。AI ErrorState 必有 title、short explanation、retry、可选 safe technical details、secondary action。

## Layout, motion, accessibility

content horizontal padding：small desktop 16、normal 24、large 32；page section gap 24/32；sidebar 220 preferred（可压至 188）；toolbar 52。一个 primary scroll owner；dialog/tree/list 可独立 scroll，禁止无意 nested scroll。820×620 是最低支持，优先折叠次要 metadata、限制面板 min width 和允许 title wrap。

hover/focus 使用 fast；popover fast；modal standard；尊重 `prefers-reduced-motion`。图标仅 `Icon.tsx` 主系统，尺寸 12/16/20/24，stroke 1.7。click target >=32px；语义 button/label/listbox；全控件 focus-visible；文字 contrast 合格；不能只颜色表达状态。

## Architecture and anti-patterns

`components/ui` 放无领域 primitive；`components/patterns` 放 PageHeader/SectionHeader/StatusMessage/TaskSurface/SettingsRow；feature components 留在 feature。禁止万能组件、Card 为分区、Card 无限嵌套、再造 Select、Unicode UI icon、静态 inline style、无 token 值、无意义 gradient/animation、只显示“操作失败”、以及为了统一把所有页面做成同样卡片。

## Migration

Phase 1 token alias 与 icon additions；Phase 2 Button/Input/Select/Badge/ErrorState；Phase 3 Page/Section/scroll patterns；Phase 4 Problem import→analysis→detail 和 textbook import→structure；Phase 5 settings/secondary pages；Phase 6 删除已无引用 legacy CSS。每 phase 要 visual QA（820×620、laptop、large）、keyboard/focus、dark theme 和 build/test。
