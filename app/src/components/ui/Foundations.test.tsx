import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
// @ts-expect-error Vitest executes this contract in Node, while the app tsconfig is browser-only.
import { readFileSync } from 'node:fs'
import {
  Badge,
  Breadcrumb,
  Button,
  Card,
  Checkbox,
  Combobox,
  DetailHeader,
  DiscreteSlider,
  Dialog,
  DialogFooter,
  FlowingTaskSurface,
  Heading,
  IconButton,
  Input,
  ListRow,
  LoadingState,
  NavigationItem,
  PageHeader,
  Popover,
  ProgressSteps,
  RadioGroup,
  SearchField,
  SegmentedControl,
  SettingRow,
  Sheet,
  Skeleton,
  StatusBadge,
  StatusTag,
  Surface,
  Switch,
  Table,
  TableCell,
  TableRow,
  Tabs,
  Tag,
  Text,
  Tooltip,
} from './index'
import { discreteSliderIndexFromPointer } from './discreteSlider'
import { nextEnabledTabIndex } from './tabNavigation'
import { Icon } from '../Icon'

describe('design system foundations', () => {
  it('announces asynchronous work without fake progress or decorative glow', () => {
    const html = renderToStaticMarkup(
      <FlowingTaskSurface
        progressCurrent={0}
        progressLabel="正在识别教材结构"
        progressTotal={1}
        state="running"
        title="正在识别教材结构"
      />,
    )
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-labelledby=')
    expect(html).not.toContain('0 / 1')
    expect(html).not.toContain('__glow')
    expect(html.match(/正在识别教材结构/gu)).toHaveLength(1)
  })

  it('supports a non-dismissible alert dialog for blocking recovery', () => {
    const html = renderToStaticMarkup(
      <Dialog dismissible={false} onClose={() => undefined} open role="alertdialog" title="修复数据连接">
        <p>当前数据不会被修改。</p>
        <DialogFooter><Button>安全退出</Button></DialogFooter>
      </Dialog>,
    )
    expect(html).toContain('role="alertdialog"')
    expect(html).toContain('修复数据连接')
    expect(html).not.toContain('aria-label="关闭"')
  })

  it('defaults shared actions to non-submitting buttons', () => {
    const html = renderToStaticMarkup(<>
      <Button>普通操作</Button>
      <Button type="submit">提交表单</Button>
    </>)
    expect(html).toContain('type="button"')
    expect(html).toContain('type="submit"')
  })

  it('renders accessible input metadata and category/status primitives', () => {
    const html = renderToStaticMarkup(<>
      <Input error="必填" label="教材" value="" readOnly />
      <Badge>全等三角形</Badge>
      <StatusBadge tone="warning">待确认</StatusBadge>
      <IconButton appearance="plain" label="删除" tone="danger">icon</IconButton>
      {(['pending', 'completed', 'deferred', 'again', 'hard', 'good', 'easy'] as const)
        .map((kind) => <StatusTag key={kind} kind={kind}>{kind}</StatusTag>)}
    </>)
    expect(html).toContain('<label')
    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain('ax-badge')
    expect(html).toContain('ax-status-badge--warning')
    expect(html).toContain('ax-icon-button--plain')
    expect(html).toContain('ax-icon-button--danger')
    expect(html).toContain('ax-status-tag--completed')
    expect(html).toContain('ax-status-tag--again')
  })

  it('covers shared text, search, checkbox and surface hierarchy', () => {
    const html = renderToStaticMarkup(<Surface as="article" padding="standard" variant="raised">
      <Heading as="h3" reading role="card">勾股定理</Heading>
      <Text reading>在直角三角形中验证关系。</Text>
      <SearchField label="搜索题目" placeholder="搜索" />
      <Checkbox defaultChecked label="自动整理" />
    </Surface>)
    expect(html).toContain('ax-surface--raised ax-surface--padding-standard')
    expect(html).toContain('ax-heading--card ax-heading--reading')
    expect(html).toContain('ax-text--reading')
    expect(html).toContain('aria-label="搜索题目"')
    expect(html).toContain('ax-checkbox__box')
  })

  it('keeps Status capsules intrinsic and core feature CSS tokenized', () => {
    const ui = readFileSync(new URL('./ui.css', import.meta.url), 'utf8')
    const tags = readFileSync(new URL('../../features/library/ProblemTags.css', import.meta.url), 'utf8')
    expect(ui).toContain('width: fit-content')
    expect(ui).toContain('flex: 0 0 auto')
    expect(ui).toContain('var(--ax-primary-control-ink)')
    expect(ui).toMatch(/\.ax-icon-button--plain \{[^}]*border-color: transparent;[^}]*outline: none;[^}]*background: transparent;[^}]*box-shadow: none;/u)
    expect(ui).toContain('.ax-icon-button--plain:focus-visible')
    expect(tags).not.toMatch(/#[\da-f]{3,8}/iu)
    expect(tags).not.toMatch(/font-size:\s*\d/gu)
    expect(tags).not.toMatch(/border-radius:\s*\d/gu)
  })

  it('maps product typography to the macOS text-style hierarchy', () => {
    const tokens = readFileSync(new URL('../../index.css', import.meta.url), 'utf8')
    const refinement = readFileSync(new URL('../../uiRefinement.css', import.meta.url), 'utf8')
    const ui = readFileSync(new URL('./ui.css', import.meta.url), 'utf8')
    const html = renderToStaticMarkup(
      <PageHeader actions={<Button>开始</Button>} eyebrow="学习趋势" summary="复习趋势与掌握变化" title="洞察" />,
    )

    for (const token of [
      '--ax-type-large-title-size: 26px', '--ax-type-title-1-size: 22px',
      '--ax-type-title-2-size: 17px', '--ax-type-title-3-size: 15px',
      '--ax-type-headline-size: 13px', '--ax-type-body-size: 13px',
      '--ax-type-callout-size: 12px', '--ax-type-subheadline-size: 11px',
      '--ax-type-footnote-size: 10px', '--ax-type-caption-size: 10px',
      '--ax-type-eyebrow-size', '--ax-type-page-size', '--ax-type-section-size',
      '--ax-type-card-size', '--ax-type-body-small-size',
      '--ax-type-control-size', '--ax-type-label-size', '--ax-type-meta-size',
      '--ax-type-caption-size', '--ax-page-eyebrow',
    ]) expect(tokens).toContain(token)
    expect(tokens).toContain('--ax-type-page-size: var(--ax-type-large-title-size)')
    expect(tokens).toContain('--ax-type-control-size: var(--ax-type-headline-size)')
    expect(tokens).toContain('font-optical-sizing: auto')
    expect(refinement).not.toContain('letter-spacing: -0.035em')
    expect(ui).not.toMatch(/font-size:\s*(?:[0-9]|1[0-8])px/u)
    expect(html).toContain('ax-page-header__eyebrow')
    expect(html).toContain('ax-page-header__title')
    expect(html).toContain('ax-page-header__summary')
    expect(refinement).toContain('color: var(--ax-page-eyebrow)')

    for (const source of [
      '../../features/today/TodayWorkspace.tsx',
      '../../features/capture/CaptureWorkspace.tsx',
      '../../features/library/ProblemLibrary.tsx',
      '../../features/curriculum/CurriculumWorkspace.tsx',
      '../../features/insights/InsightsWorkspace.tsx',
      '../../features/settings/AISettings.tsx',
      '../../features/practice/PracticeSetView.tsx',
    ]) expect(readFileSync(new URL(source, import.meta.url), 'utf8')).toContain('<PageHeader')
  })

  it('centers shared icon-and-text controls without local offsets', () => {
    const ui = readFileSync(new URL('./ui.css', import.meta.url), 'utf8')
    const refinement = readFileSync(new URL('../../uiRefinement.css', import.meta.url), 'utf8')
    const html = renderToStaticMarkup(<>
      <Button><Icon name="refresh" size={16} />刷新</Button>
      <SegmentedControl
        ariaLabel="采集方式"
        onChange={() => undefined}
        options={[{ value: 'camera', label: <><Icon name="camera" size={16} />iPhone 相机</> }]}
        value="camera"
      />
    </>)

    expect(html).toContain('ax-button__content')
    expect(html).toContain('class="icon"')
    expect(ui).toMatch(/\.ax-button__content \{[^}]*display: inline-flex;[^}]*align-items: center;/u)
    expect(refinement).toMatch(/\.segmented-control button \{[^}]*display: inline-flex;[^}]*align-items: center;/u)
    expect(refinement).not.toMatch(/\.segmented-control[^}]*translateY/u)
  })

  it('renders the shared discrete selector with slider accessibility metadata', () => {
    const html = renderToStaticMarkup(<DiscreteSlider
      ariaLabel="难度"
      onChange={() => undefined}
      options={[{ value: 'basic', label: '基础' }, { value: 'middle', label: '中档' }, { value: 'advanced', label: '进阶' }]}
      value="middle"
    />)
    expect(html).toContain('role="slider"')
    expect(html).toContain('aria-valuenow="1"')
    expect(html).toContain('aria-valuetext="中档"')
    expect(html).toContain('ax-discrete-slider__stop is-reached')
    expect(html).toContain('is-current')
    expect(discreteSliderIndexFromPointer(10, 10, 300, 3)).toBe(0)
    expect(discreteSliderIndexFromPointer(165, 10, 300, 3)).toBe(1)
    expect(discreteSliderIndexFromPointer(310, 10, 300, 3)).toBe(2)
  })

  it('supports icon-bearing rail tabs for settings navigation', () => {
    const settings = readFileSync(new URL('../../features/settings/AISettings.tsx', import.meta.url), 'utf8')
    const ui = readFileSync(new URL('./ui.css', import.meta.url), 'utf8')
    const html = renderToStaticMarkup(
      <Tabs
        ariaLabel="设置分区"
        onChange={() => undefined}
        options={[{ value: 'providers', label: 'AI 模型', icon: 'ai' }]}
        value="providers"
        variant="rail"
      />,
    )

    expect(html).toContain('ax-tabs__content')
    expect(html).toContain('ax-tabs__icon')
    expect(html).toContain('class="icon"')
    expect(ui).toMatch(/\.ax-tabs__content \{[^}]*display: inline-flex;[^}]*align-items: center;/u)
    for (const icon of ['refresh', 'ai', 'sun', 'info', 'download']) {
      expect(settings).toContain(`icon: '${icon}'`)
    }
  })

  it('moves shared tabs with arrow, home and end keys while skipping disabled tabs', () => {
    const options = [{}, { disabled: true }, {}, {}]

    expect(nextEnabledTabIndex(options, 0, 'ArrowRight')).toBe(2)
    expect(nextEnabledTabIndex(options, 2, 'ArrowLeft')).toBe(0)
    expect(nextEnabledTabIndex(options, 0, 'ArrowLeft')).toBe(3)
    expect(nextEnabledTabIndex(options, 3, 'ArrowDown')).toBe(0)
    expect(nextEnabledTabIndex(options, 0, 'ArrowUp')).toBe(3)
    expect(nextEnabledTabIndex(options, 2, 'Home')).toBe(0)
    expect(nextEnabledTabIndex(options, 0, 'End')).toBe(3)
  })

  it('keeps feature headers and compact AI actions on shared primitives', () => {
    const insights = readFileSync(new URL('../../features/insights/InsightsWorkspace.tsx', import.meta.url), 'utf8')
    const insightsCss = readFileSync(new URL('../../features/insights/Insights.css', import.meta.url), 'utf8')
    const library = readFileSync(new URL('../../features/library/ProblemLibrary.tsx', import.meta.url), 'utf8')

    expect(insights).toContain('<PageHeader')
    expect(insightsCss).not.toContain('.insights-header')
    expect(library).toContain('<Button className="problem-ai-notice__action"')
    expect(library).not.toContain('<button className="problem-ai-notice__action"')
  })

  it('provides one semantic vocabulary for navigation, choice, content and overlays', () => {
    const html = renderToStaticMarkup(<>
      <NavigationItem active icon="today" label="今日" shortcut="⌘1" />
      <Breadcrumb items={[{ label: '错题库', onClick: () => undefined }, { label: '勾股定理' }]} />
      <DetailHeader actions={<Button>编辑</Button>} metadata="初二数学" title="勾股定理" />
      <Card><ListRow description="2026-08-29" onClick={() => undefined} status={<StatusBadge>待复习</StatusBadge>} title="直角三角形" /></Card>
      <RadioGroup
        ariaLabel="外观"
        onChange={() => undefined}
        options={[{ value: 'system', label: '跟随系统' }, { value: 'light', label: '浅色' }]}
        value="system"
        variant="cards"
      />
      <Switch defaultChecked description="保存后立即生效" label="连续采集" />
      <Combobox onValueChange={() => undefined} options={[{ value: 'math', label: '数学' }]} value="math" />
      <SettingRow description="仅保存在本机" label="自动整理"><Switch label="启用自动整理" /></SettingRow>
      <ProgressSteps current="confirm" steps={[{ value: 'source', label: '选择来源' }, { value: 'confirm', label: '确认结构' }]} />
      <Table caption="教材列表" columns={[{ key: 'name', label: '教材' }, { key: 'status', label: '状态' }]}>
        <TableRow><TableCell as="th">人教版数学</TableCell><TableCell>可用</TableCell></TableRow>
      </Table>
      <Tag onRemove={() => undefined}>全等三角形</Tag>
      <Tooltip content="刷新数据"><IconButton label="刷新"><Icon name="refresh" /></IconButton></Tooltip>
      <Popover label="筛选条件" trigger="筛选">按状态筛选</Popover>
      <Sheet onClose={() => undefined} open title="筛选"><Checkbox label="只看待复习" /></Sheet>
      <Skeleton lines={2} />
      <LoadingState label="正在载入错题" />
    </>)

    expect(html).toContain('aria-current="page"')
    expect(html).toContain('aria-label="面包屑"')
    expect(html).toContain('ax-detail-header')
    expect(html).toContain('ax-list-row')
    expect(html).toContain('type="radio"')
    expect(html).toContain('role="switch"')
    expect(html).toContain('role="combobox"')
    expect(html).toContain('aria-current="step"')
    expect(html).toContain('<table')
    expect(html).toContain('ax-tag')
    expect(html).toContain('role="tooltip"')
    expect(html).toContain('ax-popover__trigger')
    expect(html).toContain('ax-sheet')
    expect(html).toContain('ax-skeleton')
    expect(html).toContain('正在载入错题')
  })
})
