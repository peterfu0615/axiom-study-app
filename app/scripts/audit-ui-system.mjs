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
  'src/features/library/ProblemLibrary.tsx': 2,
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
for (const path of sourceFiles.filter((candidate) => candidate.endsWith('.css') && !candidate.endsWith('/index.css'))) {
  const source = readFileSync(path, 'utf8')
  const matches = [...source.matchAll(literalStyle)]
  for (const match of matches) {
    const line = source.slice(0, match.index).split('\n').length
    errors.push(`${sourcePath(path)}:${line}: 使用设计 Token 替代 “${match[0]}”`)
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

if (errors.length) {
  console.error(`UI 系统审查失败（${errors.length} 项）：\n${errors.map((error) => `- ${error}`).join('\n')}`)
  process.exitCode = 1
} else {
  console.log('UI 系统审查通过：文字层级、卡片圆角、公共控件、异步状态与内部信息边界均符合约束。')
}
