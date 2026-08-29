# Axiom Design System

版本：1.0

适用范围：Axiom macOS 桌面端全部用户界面

配套决策：[UI_UX_AUDIT.md](UI_UX_AUDIT.md)

## 1. 设计原则

Axiom 是信息密集但平静的本地学习工作台。内容、任务状态和下一步操作是主角；品牌黄色只用于 Primary Action、选中状态与 Focus，不承担装饰。界面首先通过 Typography、Spacing、Alignment、Grouping、Contrast 和 Whitespace 建立层级；Surface、Border 和 Shadow 只在内容确实需要边界时使用。

所有页面只能消费本系统的语义 Token 和共享组件。Feature CSS 可以定义特有布局和媒体几何，但不得发明近似字体、控件、颜色、圆角、状态或交互模型。设计系统的目标不是让所有页面长得一样，而是让相同语义表现一致。

### 1.1 Apple 设计方法在 Axiom 中的适用边界

本轮系统参考 [`emilkowalski/skills`](https://github.com/emilkowalski/skills) 中的 [`apple-design`](https://github.com/emilkowalski/skills/blob/main/skills/apple-design/SKILL.md) 与 [`emil-design-eng`](https://github.com/emilkowalski/skills/blob/main/skills/emil-design-eng/SKILL.md) 方法，但将其作为可验证的交互原则，而不是视觉模仿。Axiom 采用 Purpose、Agency、Responsibility、Familiarity、Flexibility、Simplicity、Craft、Delight 的判断顺序，并把后者理解为前七项成立后的结果。任何效果如果不能提高可预测性、理解、完成感或恢复能力，就不进入产品。

- **即时响应**：所有 Pressable 在 pointer-down 阶段通过 `:active` 给出轻微、短促的反馈；业务提交仍在 click / keyboard activation 时发生。不得加入人工等待或为了等动画结束而锁定输入。
- **用户掌控**：可恢复删除优先执行后提供 Undo；只有不可逆或高风险操作使用确认 Dialog。动画和异步任务都不得阻止 Back、Cancel 或合理的并行导航。
- **空间一致性**：Popover / Menu 从 trigger 一侧出现并沿原路径消失；右侧 Sheet 只从右侧进入和退出；返回动作明确指向来源对象。Dialog 因不隶属于单个 trigger，保持窗口中心语义。
- **熟悉与克制**：Sidebar、Toolbar、List、Detail、Back、More、Search 和系统控件遵循 macOS 用户已有心理模型。透明材质只可用于确实悬浮于内容之上的 chrome；普通页面、Card 和 Section 不使用 blur、Glow 或玻璃叠层。
- **高频无阻滞**：键盘切换、列表选择、Tabs 与每天数十次发生的 Hover 不做位移动画；偶发 Popover、Dialog、Sheet、Toast 才使用短促状态过渡。Bounce 仅允许在真实拖拽 / flick 交接动量时使用，当前产品没有此类需求，因此默认不使用。
- **可访问替代**：`prefers-reduced-motion` 取消位移与缩放但保留必要的颜色 / 透明度反馈；`prefers-reduced-transparency` 将悬浮材质变为实色；`prefers-contrast: more` 使用实色背景和明确边界。
- **排版随字号工作**：使用系统 UI 字体和 optical sizing；大标题略收紧 tracking，正文保持接近 0，小号 metadata 可轻微放宽。层级由 size、weight、leading 共同构成，不靠字号无限分叉。

## 2. Token Contract

### 2.1 Color

Feature 层只能使用语义名称，不直接使用品牌值或十六进制值。浅色、深色与颜色主题只改变语义 Token 的映射。

| 语义 | Token | 用途 |
| --- | --- | --- |
| Background | `--ax-color-bg` | 应用画布 |
| Surface | `--ax-color-surface` | Sidebar、标准内容面 |
| Raised Surface | `--ax-color-surface-raised` | 需要从背景分离的对象 |
| Inset / Muted Surface | `--ax-color-inset` / `--ax-color-surface-muted` | 输入、内嵌信息、次级区域 |
| Hover / Selected | `--ax-color-hover` / `--ax-color-selected` | 交互与选择反馈 |
| Primary / Secondary / Tertiary Text | `--ax-text-primary` / `--ax-text-secondary` / `--ax-text-tertiary` | 文字层级 |
| Disabled Text | `--ax-text-disabled` | 禁用内容 |
| Border | `--ax-border-subtle` / `--ax-border-default` / `--ax-border-strong` | 分隔、控件、强调边界 |
| Focus | `--ax-border-focus` / `--ax-focus-ring` | 键盘和输入焦点 |
| Accent | `--ax-accent` / `--ax-accent-hover` / `--ax-accent-active` | Primary、Selected、Focus |
| Success | `--ax-success-fg` / `--ax-success-bg` | 已完成、已保存、可用 |
| Warning | `--ax-warning-fg` / `--ax-warning-bg` | 待确认、部分数据、需注意 |
| Danger | `--ax-danger-fg` / `--ax-danger-bg` | 不可逆、高风险、失败 |
| Info | `--ax-info-fg` / `--ax-info-bg` | 中性说明与后台任务 |
| Media Overlay | `--ax-media-overlay-fg` / `--ax-media-overlay-bg` / `--ax-media-overlay-solid` | 仅用于相机、扫描等媒体上的浮层；减少透明度时改为实色 |

状态不得只靠颜色表达。Success、Warning、Danger、Selected 至少同时具有文字、图标、边框或形状之一。

### 2.2 Typography Scale

界面字体使用 `--ax-font-ui`，题干、公式解释和长篇解答使用 `--ax-font-reading`，代码和安全的技术值使用 `--ax-font-mono`。页面不得建立新的近似字号。

| Role | Token | Size / Line / Weight | 用途 |
| --- | --- | --- | --- |
| Caption | `--ax-type-caption-*` | 10 / 13 / 500 | 稀少计数、图表轴、极短状态 |
| Metadata | `--ax-type-meta-*` | 11 / 15 / 400 | 日期、来源、辅助 metadata |
| Label | `--ax-type-label-*` | 12 / 17 / 600 | 表单标签、短字段名 |
| Body Small | `--ax-type-body-small-*` | 12 / 17 / 400 | Helper、次级说明 |
| Body | `--ax-type-body-*` | 13 / 19 / 400 | 默认正文 |
| Body Strong / Control | 对应 weight / `--ax-type-control-*` | 13 / 18–19 / 600 | 值、按钮、行标题强调 |
| Card / Item Title | `--ax-type-card-*` | 15 / 20 / 600 | 独立对象标题、列表主信息 |
| Section Heading | `--ax-type-section-*` | 17 / 23 / 700 | 页面 Section |
| Page Title | `--ax-type-page-*` | 26 / 32 / 700 | 每页一个，不作营销式 Display |

`Display 44px` 仅可用于打印文档、教学内容或明确数据可视化，不得用于应用页面标题。中文正文 line-height 可以由 reading style 提升，但必须消费 `--ax-reading-line`，不得在 feature 中散落 `1.65`、`1.7`、`1.75`。

### 2.3 Spacing Scale

| Token | 值 | 典型用途 |
| --- | --- | --- |
| `--ax-space-1` | 2px | 光学微调，不用于可点击间距 |
| `--ax-space-2` | 4px | 紧密内部关系 |
| `--ax-space-3` | 6px | 图标与短标签 |
| `--ax-space-4` | 8px | 控件内部、密集列表 |
| `--ax-space-5` | 12px | Row、Toolbar |
| `--ax-space-6` | 16px | 标准内边距 |
| `--ax-space-7` | 20px | 紧凑 Section |
| `--ax-space-8` | 24px | 页面 Section |
| `--ax-space-9` | 32px | 大 Section / 页面边距 |
| `--ax-space-10` | 40px | 稀少的宽松页面间隔 |
| `--ax-space-11` | 48px | 空态与顶层结构最大常用间隔 |

Margin、Padding、Gap 原则上只能来自该集合。1px 只用于 border、divider 与必要光学对齐；结构尺寸、媒体宽高、图表坐标和由数据计算的 inline style 不属于 spacing。`clamp()` 的端点也必须使用 Token。自动审查会拒绝共享与 Feature CSS 中新的正数像素间距字面量。

### 2.4 Control、Icon、Radius 与 Border

| 类别 | 允许值 |
| --- | --- |
| Control Height | 32 / 38 / 44px：`--ax-control-sm/md/lg` |
| Click Target | 默认 ≥38px；密集表格最低 32px；独立图标建议 ≥38px |
| Icon Size | 12 / 16 / 20 / 24px；媒体空态可用 32px |
| Radius | 4 / 8 / 12 / 18px / pill：`xs/sm/md/lg/pill` |
| Border Width | 1px 默认；2px 仅 selected indicator / strong focus |
| Shadow | none / card / floating；普通 Section 与 Row 无 shadow |

大圆角不是高级感。`lg` 只用于独立 Card、Dialog、Sheet；输入和按钮使用 `sm/md`；Badge 使用 pill。Card 不得嵌套 Card，必要的内部强调使用 Inset Surface。

### 2.5 Content / Container Width

| Token | 用途 |
| --- | --- |
| `--ax-content-reading-width: 780px` | 题干、解答、长文阅读 |
| `--ax-content-form-width: 640px` | 设置和普通表单 |
| `--ax-content-page-width: 1180px` | 标准页面主体 |
| `--ax-content-wide-width: 1480px` | Master-Detail、表格和复杂工作区 |
| `--ax-sidebar-width: 220px` | 普通 Sidebar |
| `--ax-sidebar-narrow-width: 184px` | 窄桌面 Sidebar |

Capture canvas、PDF、crop editor 等工作面可突破标准内容宽度，但其 Toolbar 与 Header 仍遵循页面栅格。

### 2.6 Motion 与 Z-index

| Token | 值 / 用途 |
| --- | --- |
| `--ax-motion-instant` | 100ms，pressed / tiny state |
| `--ax-motion-fast` | 140ms，hover / focus / menu |
| `--ax-motion-standard` | 200ms，dialog / sheet |
| `--ax-ease-out` | 进入、反馈与退出的响应型曲线 |
| `--ax-ease-move` | 屏幕内位置变化的对称曲线 |
| `--ax-z-popover` | floating menu / tooltip / popover |
| `--ax-z-dialog` | dialog / sheet backdrop |
| `--ax-z-toast` | toast / global feedback |

动画只说明状态变化，不装饰等待。高频键盘动作不动画；Hover 只做短颜色反馈；Popover / Menu 以 trigger 为 transform origin；可直接操控的 drag 才能使用可中断 spring。`prefers-reduced-motion` 下取消位移、缩放、流动和非必要 transition。未知进度不得伪造确定进度条。

## 3. Component Contract

### 3.1 Actions

**Button**：`primary / secondary / ghost / danger`。一个局部任务区原则上只有一个 Primary。Loading 必须设置 `aria-busy`、禁用重复提交并保留按钮宽度。Danger 不得使用 accent 外观。默认 `type="button"`，真正提交表单时才显式使用 `submit`，避免次级操作触发表单提交。

**IconButton**：只用于高度通用图标；必须提供 `label`，并由 Tooltip 显示文案。默认 38px，密集 Toolbar 可用 32px。

**Dropdown Menu**：低频次要操作。Trigger 使用 More 图标和 label；Arrow / Home / End / Escape 可操作。Danger MenuItem 使用明确文案和 danger tone。

### 3.2 Form Controls

**Text Field**：普通单行输入；Label、Hint、Inline Error 与输入关联。验证失败保留值并聚焦第一个错误。

**Search Field**：`type=search`，放大镜、可理解 label、Escape / 清空行为。不得用 Text Field 模拟。

**Textarea**：长文本；与 Text Field 共享高度之外的 padding、border、focus、disabled 和 error。

**Select**：从有限或较大集合中选择一项，使用 `ListboxSelect` 的统一公开名称。支持 keyboard、typeahead、portal、Escape 和 focus restore。

**Combobox**：当选项多且用户需要输入缩小范围时使用；必须显示 filtered listbox、空结果、active descendant 和清空行为。不能用在自由文本字段。

**Checkbox**：多个独立选择，或表格 / 列表批量选择；Label 点击切换。不得把整行点击改成 Checkbox。

**Radio / Radio Group**：少量互斥选择且需要同时比较；外观、颜色主题等可使用 Choice Card 变体，但底层仍是真实 radio。

**Switch**：立即生效的 Boolean。Label 描述当前设置，不用“开启模式 A / 模式 B”表达互斥模式；失败时回滚并提示。

**Segmented Control**：两到四个紧密相关的显示模式，选项短且宽度可容纳；不用于导航到不同对象集合或复杂页面。

### 3.3 Navigation

**Sidebar Item / Navigation Item**：一级模块，选中时 `aria-current=page`；图标 + 文案固定，窄窗仍优先保留文案。可展示快捷键 Tooltip，但快捷键不是唯一入口。

**Tabs**：同一对象或集合的持久二级视图。使用 roving tabindex、Arrow / Home / End、`aria-selected` 和对应 `tabpanel`。Underline 用于页面内容，Rail 用于设置导航。

**Breadcrumb / Back**：完整子流程显示“返回上层对象”；多于两层才使用 Breadcrumb trail。Back 使用向左图标，文案包含目标，不仅写“返回”。

### 3.4 Content

**List Row**：同一类对象的可扫描行，固定呈现主标题、关键状态、重要 metadata 和必要 secondary information；主点击只进入详情。行尾只显示最多一个高频 action 或 More。

**Table**：用于多对象、重复字段的精确比较。必须有 header、row semantics、可理解空态；窄窗按列优先级隐藏或转为 row detail，而不是任意压缩。

**Card**：只表示可作为整体理解、与周围内容需要边界的独立对象，如教材、错题、任务摘要。Card 不是 Section；Card 内不得再套 Card。

**Tag**：表示非状态分类，如知识点、方法。**Badge**：表示离散状态、计数或异常。普通 metadata 使用 Text，不加 Badge。

**Metadata List**：稳定的 label/value 组合使用 `dl` 或共享结构，不拆成一组无意义小卡片。

### 3.5 Overlays

**Tooltip**：解释 IconButton、截断文本或陌生术语；仅显示短文本，不放操作。Hover 与 Focus 都可触发。

**Popover**：短暂、轻量、无需离开上下文的信息或少量选项。点击外部与 Escape 关闭，关闭后恢复 trigger focus。

**Dialog**：少量输入或真正高风险确认。必须有明确标题、focus trap、Escape、focus restore、可滚动 body 和独立 footer。禁止把复杂流程塞入 Dialog。

**Sheet**：窄窗口中的筛选、短表单或次级详情；保留原页面上下文。桌面宽窗若内容适合固定侧栏，不强制使用 Sheet。

### 3.6 Feedback 与状态

**Toast**：操作结果的补充反馈；支持一个短 Undo / Next Action。错误停留更久且可关闭。长任务状态不得只放 Toast。

**Inline Notice**：与当前 Section 直接相关的持久信息；Success、Warning、Danger 均有文字与图标。

**Loading State**：页面首次加载使用 Skeleton；按钮使用 spinner；确定总量使用 Progress；多阶段 AI / 教材任务使用 FlowingTaskSurface；未知总量显示阶段文字与 indeterminate spinner。

**Empty State**：说明为什么为空、用户接下来能做什么；默认紧凑，不占满剩余窗口。First Use、No Result 和真正 Empty 使用不同文案和动作。

**Error State**：标题说明发生了什么，正文说明数据是否保留和如何恢复；Retry 只在 retryable 时显示。不向普通用户展示内部 code / run ID / schema。

**Skeleton**：形状接近最终内容，禁用 animation 时保持静态；不可无限替代真实空态。

## 4. Page Templates

### 4.1 List Page

顺序固定为 Page Header、可选 View Tabs、Toolbar（Search / Filter / Count / Batch）、List 或 Table、Pagination / Loading。Toolbar 不漂浮在无关位置；无搜索结果保留输入和 filter，并提供清除操作。

### 4.2 Master-Detail Page

宽窗显示 Master List 与 Detail Pane。列表选择不重置筛选和滚动；详情切换对象时保留选中的 Tab。窄窗一次只显示列表或详情，详情顶部有“返回列表”。不得简单把列表和详情上下堆叠。

### 4.3 Detail Page

Back / Breadcrumb、Object Header、一个 Primary + Secondary / More、Metadata、Tabs 或 Sections、Main Content。Danger 管理动作不放在阅读内容中间。

### 4.4 Editor Page

Back、Title + save status、Secondary actions、一个 Primary Save、Main editor/canvas、Inspector。未保存状态可见；`Cmd+S` 可用但按钮始终存在；离开策略明确。

### 4.5 Workflow Page

Back、Page Header、Progress Steps、当前步骤内容、Back / Continue actions。长任务允许离开时明确说明后台继续；失败返回可恢复阶段，不清空已确认输入。

### 4.6 Today / Insights / Settings

Today 固定为 Header + 单一 CTA、待订正、今日主题、次级预测；不是任意 Widget Dashboard。Insights 固定为 Range、Summary、由结论到证据的 Sections、Detail Table。Settings 固定为 Settings Navigation、Section Header、Setting Row / Form、Inline status。

## 5. Interaction States

所有可交互组件必须覆盖 Default、Hover、Pressed、Focused、Selected、Disabled；异步组件还覆盖 Loading。Hover 不得成为发现操作的唯一方式；Pressed 只产生短暂位移或颜色变化；Focus 使用统一 ring，不以移除 outline 结束。Disabled 保持可读 label，并在原因不明显时给 helper / tooltip。

## 6. Accessibility 与输入方式

- 正文和控件达到 WCAG AA 对比度；大号状态数字也不使用低对比装饰色。
- 所有主题的浅色与深色调色板都必须通过自动化对比度契约；Primary、Secondary、Tertiary、Primary Control、Danger 与 Eyebrow 小文本至少达到 4.5:1。
- 键盘 Tab 顺序遵循视觉顺序；Tabs / Menu / Listbox / Radio Group 支持对应 Arrow 键。
- 独立点击区域优先 ≥38px，密集行最低 32px。
- 所有输入有程序化 Label；图标按钮有 accessible name；状态用 live region 但避免重复播报。
- 色盲用户可通过文字、图标或形状识别状态。
- `Cmd+1…5`、`Cmd+,`、`Cmd+S` 是效率增强，不是唯一完成方式。
- 一级模块快捷键切换后，焦点跟随到新模块对应的 Sidebar Item；视觉选中与键盘焦点不得停留在两个不同模块。
- 内容图片使用有意义 alt；纯装饰图标 `aria-hidden=true`。

## 7. Responsive Contract

- 宽屏 ≥1440：Sidebar 220px，标准页面约束宽度；Master-Detail 展开。
- 普通桌面 1024–1439：Sidebar 200–220px，主要双栏保留，次级 metadata 可换行。
- 窄桌面 820–1023：Sidebar 176–188px；Master-Detail 切换视图；Settings nav 水平滚动；采集区域上下分区；低频 action 进入 More。
- 小于 820 不作为正式产品目标；仍不得让 Primary、Back 或 Error recovery 不可达。

页面只能有一个主滚动 owner。Tree、List、Detail、Dialog 可拥有受控局部滚动；禁止无意识 nested scroll 和 padded scroller 内的 `100vh` child。

## 8. Architecture 与自动约束

- `components/ui`：无领域语义的 primitives。
- `components/patterns` 或 UI index 中的 pattern exports：PageHeader、Toolbar、DetailHeader、SettingsSection、SettingRow、ProgressSteps、state surfaces。
- `features/*`：领域内容与工作流，不重写通用控件。
- `index.css`：主题和 Token 单一事实源。
- `components/ui/ui.css`：primitive 与 template 样式。
- Feature CSS：本领域布局、媒体、图表；不得定义通用按钮、输入、状态、字号或颜色。

UI audit 必须拒绝新的 raw shared controls、feature hex、非 Token font-size / line-height / radius、未审查的 spacing literal、Unicode 控件图标、公开内部错误信息和新增 legacy control class。既有例外只能减少，不能增加。

## 9. 禁止模式

- Everything is a Card、Card 套 Card、用 Shadow 代替分组。
- 大面积渐变、Glow、Glassmorphism、Backdrop blur 和装饰动画。
- 巨大 Page Title、营销式 Hero、无意义留白或 Dashboard 小组件拼贴。
- 每条 metadata 都用 Badge、每个 Button 都加 Icon、装饰性图标占据列表空间。
- 所有操作都藏进 More，或所有操作都直接平铺。
- Toggle 表示 A/B 模式、整行点击在批量模式改变语义、自造二次武装按钮。
- 只显示“失败”“Error”“Something went wrong”，或清空验证失败后的输入。
- 依赖颜色、hover、快捷键或 tooltip 才能完成核心任务。
- 为了统一外观重写稳定领域逻辑、数据库或 AI pipeline。
