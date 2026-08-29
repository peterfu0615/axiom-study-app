import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const srcRoot = join(appRoot, 'src')

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? walk(path) : [path]
  })
}

function sourcePath(path) {
  return relative(appRoot, path).replaceAll('\\', '/')
}

const errors = []
const sourceFiles = walk(srcRoot)

// Raw controls below are reviewed, specialized interaction surfaces (crop
// handles, camera/document canvases, full-card selectors and recovery chrome).
// Shared form and action controls must use components/ui. Any new raw control,
// or an increase in one of these files, fails this audit until explicitly
// reviewed and justified here.
const specializedControlBudget = {
  'src/components/DatabaseLocationErrorDialog.tsx': 2,
  'src/components/Sidebar.tsx': 2,
  'src/components/Toast.tsx': 2,
  'src/features/capture/CaptureWorkspace.tsx': 7,
  'src/features/capture/DocumentEditor.tsx': 13,
  'src/features/curriculum/CurriculumAnalysisStatusButton.tsx': 1,
  'src/features/curriculum/CurriculumImportFlow.tsx': 1,
  'src/features/curriculum/CurriculumWorkspace.tsx': 1,
  'src/features/curriculum/TagOverview.tsx': 1,
  'src/features/library/ProblemCropEditor.tsx': 5,
  'src/features/library/ProblemLibrary.tsx': 3,
  'src/features/library/SolutionComparison.tsx': 4,
  'src/features/practice/PracticeSetView.tsx': 2,
  'src/features/settings/AISettings.tsx': 2,
  'src/features/today/TodayWorkspace.tsx': 1,
}

for (const path of sourceFiles.filter((candidate) => candidate.endsWith('.tsx'))) {
  const relativePath = sourcePath(path)
  if (relativePath.includes('/components/ui/') || relativePath.endsWith('.test.tsx')) continue
  const source = readFileSync(path, 'utf8')
  const count = source.match(/<(?:button|input|select|textarea)\b/gu)?.length ?? 0
  const budget = specializedControlBudget[relativePath] ?? 0
  if (count > budget) {
    errors.push(`${relativePath}: ${count} 个原生控件超过已审查上限 ${budget}；请使用 components/ui 或明确审查例外`)
  }
}

const forbiddenUserCopy = [
  '确认发送题目图片',
  '实例指纹',
  '安全错误',
  'variant-fnv1a:',
  '审校',
  '文档契约',
  '练习 ID',
  '排版引擎',
]
for (const path of sourceFiles.filter((candidate) => candidate.endsWith('.tsx') && candidate.includes('/features/'))) {
  const source = readFileSync(path, 'utf8')
  for (const phrase of forbiddenUserCopy) {
    if (source.includes(phrase)) errors.push(`${sourcePath(path)}: 不得在用户界面出现内部文案“${phrase}”`)
  }
}

// Palette values belong in index.css; all consuming styles must use semantic
// tokens. Typography and card radii are likewise constrained to product roles.
const literalStyle = /(?:font-size|line-height|border-radius):\s*[0-9.]+px\b|#[0-9a-fA-F]{3,8}\b/gu
const literalSpacing = /(?:margin(?:-(?:top|right|bottom|left|inline|block))?|padding(?:-(?:top|right|bottom|left|inline|block))?|gap|row-gap|column-gap):\s*[^;}]*?(?<![-\d])(?:[2-9]|\d{2,})px\b/gu
const literalTypography = /(?:font-size|line-height):\s*([0-9.]+)(?:px|rem|em|%)?\b/gu
for (const path of sourceFiles.filter((candidate) => candidate.endsWith('.css') && !candidate.endsWith('/index.css'))) {
  const source = readFileSync(path, 'utf8')
  const matches = [...source.matchAll(literalStyle)]
  for (const match of matches) {
    const line = source.slice(0, match.index).split('\n').length
    errors.push(`${sourcePath(path)}:${line}: 使用设计 Token 替代 “${match[0]}”`)
  }
  for (const match of source.matchAll(literalSpacing)) {
    const line = source.slice(0, match.index).split('\n').length
    errors.push(`${sourcePath(path)}:${line}: margin、padding 与 gap 必须使用 Spacing Token`)
  }
  for (const match of source.matchAll(literalTypography)) {
    const declaration = match[0]
    const value = Number(match[1])
    if (declaration.startsWith('line-height') && (value === 0 || value === 1)) continue
    const line = source.slice(0, match.index).split('\n').length
    errors.push(`${sourcePath(path)}:${line}: font-size 与文字 line-height 必须使用 Typography Token`)
  }
}

const publicErrorSource = readFileSync(join(srcRoot, 'components/ui/index.tsx'), 'utf8')
if (publicErrorSource.includes('<code>{error.code}') || publicErrorSource.includes('{error.detailSafe}')) {
  errors.push('src/components/ui/index.tsx: 公共 ErrorState 不得渲染内部错误码或 detailSafe')
}

const flowingTaskSource = readFileSync(join(srcRoot, 'components/ui/FlowingTaskSurface.tsx'), 'utf8')
if (flowingTaskSource.includes('is-indeterminate')) {
  errors.push('src/components/ui/FlowingTaskSurface.tsx: 未知进度任务不得显示伪造的进度条')
}

// Accessibility primitives must be global. A page-scoped visually-hidden
// helper can make labels unexpectedly visible when a shared control moves to
// another template.
const indexCss = readFileSync(join(srcRoot, 'index.css'), 'utf8')
if (!indexCss.includes('.sr-only {')) {
  errors.push('src/index.css: 缺少全局 .sr-only 辅助技术文本 primitive')
}
for (const path of sourceFiles.filter((candidate) => candidate.endsWith('.css') && !candidate.endsWith('/index.css'))) {
  if (readFileSync(path, 'utf8').includes('.sr-only')) {
    errors.push(`${sourcePath(path)}: .sr-only 必须只在 index.css 中全局定义`)
  }
}

// The component inventory is a product contract, not a suggestion. New pages
// compose these shared semantics instead of inventing near-identical controls.
const sharedUiSource = readFileSync(join(srcRoot, 'components/ui/index.tsx'), 'utf8')
const sharedComponentNames = [
  'Button', 'IconButton', 'TextField', 'SearchField', 'Textarea', 'Select', 'Combobox',
  'Checkbox', 'RadioGroup', 'Switch', 'SegmentedControl', 'Tabs', 'Breadcrumb',
  'SidebarItem', 'NavigationItem', 'ListRow', 'Table', 'Card', 'Tag', 'Badge',
  'StatusBadge', 'Tooltip', 'Popover', 'DropdownMenu', 'Dialog', 'DialogFooter',
  'Sheet', 'EmptyState', 'LoadingState', 'ErrorState', 'Skeleton', 'PageHeader',
  'DetailHeader', 'SettingsSection', 'SettingRow', 'Toolbar', 'ProgressSteps',
]
for (const name of sharedComponentNames) {
  const definition = new RegExp(`export (?:function|const) ${name}\\b|export \\{ ${name} \\}`)
  if (!definition.test(sharedUiSource)) errors.push(`src/components/ui/index.tsx: 缺少共享组件 ${name}`)
}
const toastSource = readFileSync(join(srcRoot, 'components/Toast.tsx'), 'utf8')
if (!toastSource.includes('export function Toast') || !toastSource.includes("role={toast.tone === 'error' ? 'alert' : 'status'}")) {
  errors.push('src/components/Toast.tsx: Toast 必须保留统一组件及成功/错误播报语义')
}

// User-visible failures are translated by the shared safe-copy boundary.
// Raw thrown values may be logged, but never interpolated directly into UI.
const unsafeErrorPatterns = [
  /set(?:Error|Feedback|Status|Message)\s*\(\s*String\s*\(/u,
  /message:\s*String\s*\(/u,
  /notify\s*\(\s*String\s*\(/u,
  /\$\{String\((?:error|reason)\)/u,
]
for (const path of sourceFiles.filter((candidate) => /\/features\/.*\.(?:ts|tsx)$/u.test(candidate))) {
  const source = readFileSync(path, 'utf8')
  if (unsafeErrorPatterns.some((pattern) => pattern.test(source))) {
    errors.push(`${sourcePath(path)}: 用户错误反馈必须经过 userFacingError 或领域安全文案`)
  }
}

// Core architecture contracts: predictable landing location, preserved module
// context, familiar controls for list/detail work, and non-dismissible recovery.
const appSource = readFileSync(join(srcRoot, 'App.tsx'), 'utf8')
for (const required of [
  "useState<AppSection>('today')",
  'visitedSections.current.add(section)',
  "if (!event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return",
  '<Sidebar',
]) {
  if (!appSource.includes(required)) errors.push(`src/App.tsx: 缺少应用外壳契约 “${required}”`)
}

const librarySource = readFileSync(join(srcRoot, 'features/library/ProblemLibrary.tsx'), 'utf8')
for (const required of ['<Tabs', '<Checkbox', '<DropdownMenu', '<DialogFooter']) {
  if (!librarySource.includes(required)) errors.push(`src/features/library/ProblemLibrary.tsx: 缺少列表/详情交互契约 “${required}”`)
}
for (const forbidden of ['deleteConfirming', 'deleteArmed', 'curriculum-dialog-actions']) {
  if (librarySource.includes(forbidden)) errors.push(`src/features/library/ProblemLibrary.tsx: 不得恢复旧交互状态 “${forbidden}”`)
}
if (librarySource.includes('role="button"')) {
  errors.push('src/features/library/ProblemLibrary.tsx: 可点击媒体必须使用真实 button')
}
const comparisonSource = readFileSync(join(srcRoot, 'features/library/SolutionComparison.tsx'), 'utf8')
if (comparisonSource.includes('role="button"') || !comparisonSource.includes('className="comparison-open-action"')) {
  errors.push('src/features/library/SolutionComparison.tsx: 解答预览必须提供显式共享 Button，不得让整块内容模拟按钮')
}
const problemTagsSource = readFileSync(join(srcRoot, 'features/library/ProblemTags.tsx'), 'utf8')
for (const required of ['label: \'撤销\'', '<DialogFooter>', 'userFacingError(']) {
  if (!problemTagsSource.includes(required)) errors.push(`src/features/library/ProblemTags.tsx: 缺少标签可恢复性契约 “${required}”`)
}
if (problemTagsSource.includes('armedTagId')) {
  errors.push('src/features/library/ProblemTags.tsx: 标签移除不得恢复隐蔽的双击确认状态')
}

const recoverySource = readFileSync(join(srcRoot, 'components/DatabaseLocationErrorDialog.tsx'), 'utf8')
for (const required of ['dismissible={false}', 'role="alertdialog"', '<DialogFooter>']) {
  if (!recoverySource.includes(required)) errors.push(`src/components/DatabaseLocationErrorDialog.tsx: 缺少关键恢复契约 “${required}”`)
}
if (recoverySource.includes('check.error')) {
  errors.push('src/components/DatabaseLocationErrorDialog.tsx: 不得直接显示底层数据库错误')
}

// Motion and materials must communicate state. Shared task feedback cannot use
// decorative gradients/glows, and transparency always has an accessible
// opaque fallback.
const flowingTaskCss = readFileSync(join(srcRoot, 'components/ui/FlowingTaskSurface.css'), 'utf8')
const curriculumStatusCss = readFileSync(join(srcRoot, 'features/curriculum/CurriculumAnalysisStatus.css'), 'utf8')
const appCss = readFileSync(join(srcRoot, 'App.css'), 'utf8')
for (const [path, source] of [
  ['src/components/ui/FlowingTaskSurface.css', flowingTaskCss],
  ['src/features/curriculum/CurriculumAnalysisStatus.css', curriculumStatusCss],
]) {
  if (/gradient\(|__glow/u.test(source)) errors.push(`${path}: 异步状态不得使用装饰性渐变或 Glow`)
}
for (const obsoleteEffect of ['--ax-ai-flow-highlight', 'ai-text-scan', 'ai-content-scan', 'solution-scan']) {
  if (appCss.includes(obsoleteEffect)) errors.push(`src/App.css: 异步状态不得恢复装饰效果 “${obsoleteEffect}”`)
}
if (!sharedUiSource.includes("type={props.type ?? 'button'}")) {
  errors.push('src/components/ui/index.tsx: 共享 Button 必须默认 type="button" 以避免意外表单提交')
}
for (const [path, source] of [
  ['src/components/ui/ui.css', readFileSync(join(srcRoot, 'components/ui/ui.css'), 'utf8')],
  ['src/App.css', readFileSync(join(srcRoot, 'App.css'), 'utf8')],
  ['src/features/practice/PracticeSetView.css', readFileSync(join(srcRoot, 'features/practice/PracticeSetView.css'), 'utf8')],
]) {
  if (!source.includes('@media (prefers-reduced-transparency: reduce)')) {
    errors.push(`${path}: 半透明界面缺少 prefers-reduced-transparency 回退`)
  }
}

const designSystem = readFileSync(join(appRoot, 'docs/DESIGN_SYSTEM.md'), 'utf8')
const uxAudit = readFileSync(join(appRoot, 'docs/UI_UX_AUDIT.md'), 'utf8')
for (const section of ['Token Contract', 'Component Contract', 'Page Templates', 'Accessibility', 'Responsive Contract']) {
  if (!designSystem.includes(section)) errors.push(`docs/DESIGN_SYSTEM.md: 缺少 ${section} 决策`)
}
for (const section of ['用户角色与核心场景', '最高频核心任务与当前成本', '目标信息架构', '目标任务流', '全局交互硬规则', '状态设计矩阵']) {
  if (!uxAudit.includes(section)) errors.push(`docs/UI_UX_AUDIT.md: 缺少 ${section} 审计`)
}

if (errors.length) {
  console.error(`UI 系统审查失败（${errors.length} 项）：\n${errors.map((error) => `- ${error}`).join('\n')}`)
  process.exitCode = 1
} else {
  console.log('UI 系统审查通过：信息架构、组件语义、错误边界、辅助技术、异步反馈与响应式材料均符合约束。')
}
