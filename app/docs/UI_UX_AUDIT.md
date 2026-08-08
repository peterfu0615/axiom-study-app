# UI/UX 审计

## 当前视觉语言

项目已有一套温暖纸张感、黄色单 accent、macOS system font 的基础：`index.css` 的 `--canvas/--surface/--brand` 和 dark theme；`components/ui/ui.css` 的 Button/Listbox/StatusBadge/Dialog/FlowingTaskSurface。课程工作台是当前最接近目标的一代：密度较高、任务状态明确、Listbox 具 portal/keyboard/typeahead/focus。错题采集/详情、设置仍保留大量 `App.css` 遗留 class，形成双系统。

实机核验：错题库可以进入详情并正确显示教材匹配、AI 状态和标签区；失败态只显示“未返回错误详情”。课程页在没有当前 subject 选择时为空态清晰，但教材 selector disabled；这要求后续 picker 的 empty/disabled/explanation 规则一致。

## Inventory

| 分类 | 已有 | 审计结论 |
| --- | --- | --- |
| Foundation | `index.css`、`workspaceLayout.css` | 有颜色主题/reduce motion/min width；缺少正式 scale。 |
| Primitive | `components/ui/index.tsx`、`ListboxSelect.tsx` | Button/IconButton/InlineNotice/Tabs/Badge/Empty/Async/Progress/Dialog/Menu/FileDropzone；不全且仍大量绕过。 |
| Feature components | Capture、Library、Curriculum、Settings | domain 边界清楚，但 CSS 语言不统一。 |
| Pattern | FlowingTaskSurface、Curriculum import/review | 最成熟；应作为长任务 pattern，不应泛化为所有 loading。 |
| Icons | `Icon.tsx` 线性 SVG + 大量文字符号 | 主系统是 custom SVG；仍混用 `×`、`✓`、`⌕`、箭头。 |

## 主要问题与优先级

P0：没有完整 token contract；`App.css` 与 `ui.css` 分别定义按钮、卡片、间距和状态。P0：Select 同时存在 native/select-like 和 `ListboxSelect`，后者却用 Unicode chevron/check。P1：Card/section 过度框选，错题详情的“题目/标签/学习反馈/继续学习”容器层级过多。P1：AI failed state 是纯文本，未接上可诊断 ErrorState。P1：滚动由 `workspaceLayout.css` 用 `:has()` 紧急覆盖，表明 scroll ownership 尚未成为 layout contract。P2：内联静态 style 集中在 `DatabaseLocationErrorDialog`，且遗留 `primary-button`/`icon-button` 与 `ax-*` 并存。P2：font-size 10/11/12/13/14/16/18 及 650/660 随意出现。P3：状态胶囊和一些 icon 的颜色/字重细节。

## Layout、卡片和可访问性

页面应只拥有一个 primary scroll owner：普通 workspace 的内容区；复杂 tree/list 用区域 scroll；Dialog 自己 scroll。禁止 page scroll 内的 `100vh` child。当前 820px `min-width` 是 desktop 边界，需补 small/normal/large desktop 规则，而非 mobile stack。Status 必须 `inline-flex; width:max-content; flex:0 0 auto`（`ax-status-badge` 已正确）；不得让它成为满宽条。

`ListboxSelect` 的 aria listbox、keyboard arrows、typeahead、focus 与 portal positioning 是应保留的实现。需替换其 `⌄/✓` 为 `Icon`，并给按钮、输入、dialog、menu 全量 focus-visible；状态不可仅凭颜色。系统 Reduce Motion 已覆盖，新的 motion 必须遵守。

## 迁移目标

不重写质量较高的 Curriculum 流程。先让 tokens/primitives 在 ProblemTags、AI ErrorState、Textbook Picker 和任务状态落地，再逐页迁移 Capture→Library detail→Curriculum→Settings；每一步删除对应 legacy CSS，不能只叠加覆盖。
