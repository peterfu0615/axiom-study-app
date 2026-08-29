# Axiom 系统重构最终 UX Review

审查日期：2026-08-30

审查对象：Axiom v0.8.2 React/Tauri macOS 界面。本审查覆盖 App Shell、今日、采集与页面处理、错题库与错题详情、课程与教材导入、练习相关界面、洞察、设置、全局反馈、共享组件和响应式行为。底层 SQLite、AI Provider、相机硬件和 Tauri 原生命令没有因界面重构而改写。

配套文档：[UI_UX_AUDIT.md](UI_UX_AUDIT.md) 记录重构前问题、信息架构和任务流决策；[DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) 是实施后的 Token、组件、页面模板和交互契约。本文件只记录实施完成后的逐项验收、发现的问题和已经落地的纠正，不以 TODO 代替修复。

## 1. 审查方法与证据边界

本轮审查以源码、自动化契约、组件测试、完整前端测试、生产构建和真实浏览器渲染共同取证。视觉和交互检查覆盖 1280×800 普通桌面与 820×620 最低正式窗口，覆盖浅色与深色主题；浏览器检查包含 Sidebar、Tabs、Segmented Control、Dialog、设置导航、课程导入状态、错题库主从布局和窄窗滚动。键盘检查包含 Tab、Arrow、Home / End、Escape、`Cmd+1…5` 与 `Cmd+,`。可访问性还对 6 套主题的浅色/深色共 12 个调色板执行 WCAG 对比度契约测试。

Vite 浏览器没有 Tauri IPC、SQLite、系统相机或真实 AI Provider。因此它能够证明页面骨架、错误/空态、响应式、焦点、ARIA 和浏览器侧交互，但不能证明真实相机授权、数据库迁移、模型响应质量或原生安装包。相关界面通过代码路径、现有测试和安全错误态验证；原生硬件验收仍属于发布 Acceptance Test，而不是被本次视觉预览冒充为已经执行。

审查优先级固定为：熟悉 > 清楚 > 顺手 > 高效 > 稳定 > 精致 > 个性化 > 新颖。引用上游 `apple-design` 的部分只用于判断响应性、用户掌控、空间连续性、克制和可访问替代；没有把 Apple 视觉表皮复制到 Axiom，也没有用动画掩盖任务流问题。

## 2. 核心任务流复核

| 高频任务 | 实施后的可见路径 | 上下文与成功反馈 | 失败与恢复 |
| --- | --- | --- | --- |
| 添加错题 | 今日 First Use 或 Sidebar“采集” → 相机/导入 Segmented Control → 页面处理 → 勾选题块 → “保存 N 道错题” | 队列保持可见；处理页保留原图、题块和选择；保存后明确数量并可前往错题库 | 权限、文件和识别错误显示安全说明；重试不要求重新选择输入 |
| 今日练习与订正 | 启动默认进入“今日” → 单一生成/继续 Primary → 练习 → 提交 → 结果 | 模块 keep-alive 保留进行中状态；页面状态区而非瞬时 Toast 承担长任务进度 | 阶段失败显示可恢复动作；未知总量不伪造百分比或 `0/1` |
| 查找并处理错题 | 错题库 → Search / Filter / Tabs → 点击行进入详情 → 详情 Tabs / 高频动作 / More | 行点击始终表示打开对象；Checkbox 独立负责批量选择；宽窗保留 Master，窄窗用显式 Back | 列表和详情局部失败不清空搜索；可恢复删除立即执行并提供 Undo |
| 管理课程与教材 | 课程 → 知识结构/标签概览/审核确认 Tabs → 导入教材独立流程 | Progress Steps 说明当前位置；任务完成回到课程；筛选与选中教材保持 | 识别失败保留已选择资料；提供“重试识别”与“放弃导入”，错误不暴露技术细节 |
| 查看洞察 | 洞察 → 选择 7/30 天 → 先看结论 → 趋势/分布 → 技能证据 | 时间范围和内容层级可见；结论先于技术明细 | 数据不可用时使用局部 Error State，不把整个应用变成空白页 |
| 调整 AI 服务 | 设置 → AI 服务 → Provider 列表 → 同页详情表单 | 单一连续 Master-Detail；选中服务、保存状态和移除操作位置稳定 | 加载失败禁用表单，避免用默认值覆盖真实配置；重试保留用户输入；移除凭据使用高风险 Dialog |
| 调整复习/外观/维护 | 设置 → 对应分类 → Setting Row / Radio / 明确保存 | Boolean 才使用 Switch；互斥外观使用真实 Radio；复合复习设置显式保存 | 保存失败保留值并给出修复路径；维护错误使用安全文案与重试 |

与审计前相比，任务效率的主要收益来自删除无意义的模式切换和确认，而不是机械追求少一次点击：应用默认进入今日；模块切换不卸载当前模块；列表行与多选不再复用同一点击语义；软删除从“操作 + 确认”变为“操作 + 可选 Undo”；高风险凭据移除仍保留确认；课程导入虽然保留多步骤，但每一步都承担必要决策并持续显示进度。

## 3. 十五维最终审查

| 维度 | 结论与当前证据 | 审查中发现并完成的纠正 |
| --- | --- | --- |
| Navigation Consistency | 通过。六个一级模块统一由 Sidebar Item 进入并使用 `aria-current=page`；今日是默认入口；课程、错题和设置的二级层级分别使用 Tabs 或稳定 Navigation，完整子流程使用带目标文案的 Back / Breadcrumb。模块实例 keep-alive，跨模块返回保留内部上下文。 | `Cmd+1…5` 和 `Cmd+,` 原先只改变选中模块，键盘焦点可能停在旧入口；现已在切换后聚焦新模块的 Sidebar Item，视觉位置与输入位置一致。 |
| Hierarchy Consistency | 通过。页面共享 Page Header、Toolbar、List/Master-Detail、Detail Header、Editor、Workflow 和 Settings 骨架；局部任务区最多一个 accent Primary，Secondary、Ghost、Danger 权重稳定。Page Title 限制为 26px，不使用营销 Hero。 | 课程窄窗 Header 曾因为响应式堆叠把列表推离首屏；正式支持的 820px 不再堆叠，工具栏改为紧凑两行，列表获得明确剩余高度。 |
| Component Consistency | 通过。Button、IconButton、Text/Search/Textarea、Select、Combobox、Checkbox、Radio、Switch、Segmented、Tabs、Breadcrumb、Navigation、List、Table、Card、Tag、Badge、Tooltip、Popover、Dropdown、Dialog、Sheet、Toast、Empty/Loading/Error/Skeleton 均由共享层定义。共享 Button 默认 `type=button`，只有表单提交显式声明 `submit`；自动审查禁止 feature 新增近似 raw control。 | Provider 选择项原为可点击 `div` 内嵌按钮，产生嵌套交互语义；已改为独立真实 button，与排序 IconButton 成为同级控件。错题几何行改为真实 button；解答比较从整块伪按钮改为明确的“查看完整解答”操作。 |
| Terminology Consistency | 通过。一级名称固定为“今日、采集、错题库、课程、洞察、设置”；领域词固定为“教材、知识点、标签、练习、订正、AI 服务”。按钮使用“导入教材”“保存设置”“移入回收站”“重新加载”等具体动作，不使用脱离上下文的“确定”。 | 数据加载共用错误文案从重复的泛化描述收敛为“内容未能加载 / 重新加载”；Dialog 标题直接说明正在移除哪个 AI 服务。 |
| Task-flow Efficiency | 通过。默认入口直达下一学习任务；模块保活减少返回重建；行点击稳定；批量 Checkbox 独立；可恢复删除使用 Undo；复杂导入保留必要步骤；低频管理动作进入 More。 | 标签移除原本采用陌生的“两次点击武装”模式；已改为立即移除并在定义可恢复时提供 6 秒 Undo。页面处理和错题软删除采用同一原则。 |
| Discoverability | 通过。高频 Primary 与 Search/Filter 直接可见，More 只收纳低频动作；First Use 说明为空原因和下一步；图标按钮有文本 accessible name 与 Tooltip；窄窗详情有明确“返回错题列表”。 | 今日空态的主要动作由“重新检查”改为“添加错题”；课程空态在尚无教材时隐藏重复 Header 导入按钮，只保留一个明确 CTA。 |
| Affordance | 通过。按钮、行、Tabs、Checkbox、Radio、Switch 和 Search 使用平台熟悉形态；Selected、Pressed、Focused、Disabled 均有统一状态。Switch 只表示立即生效 Boolean，互斥模式使用 Radio / Segmented。 | 相机来源模式改用 Segmented Control，连续多页改用 Switch；批量错题选择保持独立 Checkbox，不再让整行突然变成选择器。 |
| Feedback | 通过。Pressed 在 pointer-down 即响应；异步按钮使用 loading/disabled/`aria-busy`；长任务保留在页面状态区；Toast 只补充成功与 Undo；错误和状态 live region 避免重复播报。 | 教材分析曾显示重复标题、伪 `0/1` 和装饰流光；现在未知总量只显示阶段文字与 spinner，失败使用 `role=alert`，Normal 使用 `role=status`。 |
| Error Prevention | 通过。不可逆/高影响动作使用确认 Dialog；可恢复动作不打断；表单加载失败时不可编辑，验证失败保留值；未保存离开由全局 guard 处理；按钮 loading 防止重复提交。 | 复习设置在读取失败时曾可能以默认值覆盖持久配置；现在整个表单禁用并提供 Retry，只有加载成功后才允许保存。数据库路径恢复 Dialog 改为不可跳过的 `alertdialog`。 |
| Recoverability | 通过。错题和标签等软删除提供 Undo；识别/导入失败保留输入与已完成步骤；局部 Error State 有明确 Retry；Dialog/Sheet 关闭恢复 trigger focus；未保存输入不因一次验证失败清空。 | 原始异常字符串可能泄漏 SQL、路径或 Provider 技术细节；共享 `userFacingError` 现在映射权限、网络、数据库忙、磁盘空间等可行动文案，详细错误只进入日志。 |
| Accessibility | 通过。语义控件、程序化 Label、Tooltip/`aria-describedby`、roving tabindex、focus trap/restore、live region、非颜色状态冗余、统一 focus ring 和 reduced motion/transparency/contrast 均已覆盖。12 个主题调色板的正文、次要/三级文本、Primary Control、Danger 与 Eyebrow 小文本均自动验证 ≥4.5:1；最小正式窗口中主要控件保持可达。 | Dialog/Sheet 完成焦点循环与恢复；Tooltip 合并既有 `aria-describedby`；Combobox 的 Arrow/Home/End 跳过 disabled 选项；高对比与减少透明度不再保留模糊媒体浮层。自动审查发现并修正 Axiom Eyebrow、Sakura Primary Control、Ocean/Forest Muted 四处 AA 失败，而不是只凭视觉判断。 |
| Information Density | 通过。List Row 同时显示主信息、关键状态和必要 metadata；详情的历史/变式进入 Tabs；设置使用连续 Section/Row；空态紧凑；Card 只保留给真正独立对象或媒体边界。 | 采集页外层大 Card、课程大面积虚线空态、Provider 嵌套 Card 和错题空态边框已移除；课程统计由错误的 7 列/4 列换行修正为与 6 个指标一致的一行。 |
| Responsive Behavior | 通过。正式支持 820×620；1024 以下 Sidebar 使用 184px Token；错题 Master-Detail 变为列表或详情；设置导航水平；采集上下分区；课程 rail/content 各自拥有明确滚动 owner；无横向溢出。 | 真实 820×620 检查发现 Tag Overview 裁切、Review Center 列表被挤出、Capture `overflow:hidden` 三处问题；均已直接修改，并复查 `scrollHeight/clientHeight` 与横向 overflow。小于 820 不是正式移动端目标。 |
| Keyboard Interaction | 通过。Sidebar 全部可 Tab；`Cmd+1…5`、`Cmd+,`、`Cmd+S` 有可点击替代；Tabs/Segmented/Radio/Menu/Listbox/Combobox 支持 Arrow，适用控件支持 Home/End；Escape 关闭 overlay 并恢复焦点。 | 浏览器验证 Tabs 与 Review dimension 的 ArrowRight 同时更新选中和焦点；“移除 AI 服务”Dialog 的 Escape 关闭后焦点返回“移除”按钮；模块快捷键焦点同步问题已修复。 |
| Visual Consistency | 通过。颜色完全按语义 Token；Typography、Spacing、Control、Icon、Radius、Border、Shadow、Content Width、Motion 和 Z-index 有有限集合；浅/深主题使用同一契约。679 处结构间距和 40 处排版字面量已迁移到有限 Token；视觉层级主要来自排版、间距、对齐和分隔。 | FlowingTaskSurface、课程状态、相机主舞台、解答处理中和 AI 扫描占位的装饰渐变/Glow 已删除；透明材质只保留媒体或悬浮 chrome，并有实色辅助模式；没有新增 Dashboard 小组件拼贴或 Card 嵌套。 |

## 4. 页面与状态覆盖矩阵

| 页面 | Normal | Loading | Empty / First Use / No Result | Error / Partial / No Permission | Ongoing / Success |
| --- | --- | --- | --- | --- | --- |
| 今日 | 主题、待订正、主任务 | 准备计划 Skeleton/状态 | 说明没有可安排内容，直接添加错题；筛选结果为空不冒充首次使用 | 已有内容可保留时局部显示刷新失败 | 生成/继续练习与进度反馈 |
| 采集 | 相机/导入、队列、处理入口 | 连接设备、导入、识别 | 说明相机和导入两条路径；队列空态紧凑 | 相机权限、设备、文件和保存错误分别说明 | 队列数量、处理进度、保存数量 |
| 页面处理 | 画布、题块、选择、Toolbar | 自动分割/保存状态 | 无题块时允许手动新增 | 原图和调整不丢失，允许重试 | 保存后 Toast 与下一步 |
| 错题库 | Tabs、Search、Filter、List/Detail | 列表/详情各自加载 | 无错题、无归档、回收站为空、无搜索结果使用不同原因与动作 | 列表或解答局部错误，保留筛选和对象上下文 | 编辑、归档、回收站、Undo |
| 课程 | 教材、知识结构、标签、审核 | tree/table Skeleton 与分析阶段 | 首次导入 CTA；无标签/无审核项说明原因 | 部分数据/识别失败可恢复 | 当前教材、待审核计数、导入步骤 |
| 洞察 | 范围、结论、趋势、证据 | Summary/chart Skeleton | 未形成数据时说明先完成练习 | 单一区块失败不清除其他数据 | 范围和最近更新时间 |
| 设置 | 导航、Setting Row、表单 | 控件 disabled、加载状态 | 无 Provider 时提供创建入口 | 加载失败禁用写入；保存失败保留输入；维护可重试 | 立即生效或明确“已保存” |

所有共享控件还通过统一 CSS 和组件契约覆盖 Default、Hover、Pressed、Focused、Selected、Disabled；异步控件额外覆盖 Loading。Offline 不作为本地数据页面的独立全局模式；需要联网的 AI 与更新功能把离线归入可识别、可重试的网络 Error State。No Permission 主要用于相机/文件能力，并说明到系统设置修复的方法。

## 5. 运行时窗口、主题与输入复核

| 场景 | 结果 |
| --- | --- |
| 1280×800 浅色 | 今日、采集、错题库、课程、洞察、设置骨架清楚；Master-Detail 展开；无无意义 Hero 留白或嵌套 Card。 |
| 820×620 浅色 | 184px Sidebar 与 636px 内容区稳定；课程、采集、错题、设置无横向溢出；列表和工作区有正确滚动 owner；Primary、Back、Retry 可达。 |
| 820×620 深色 | 语义 Surface、Text、Border、Selected、Danger 和 Error State 保持层级；未出现只适用于浅色的局部颜色。 |
| Tabs / Segmented / Review dimensions | ArrowRight 更新选中项与真实焦点；ARIA tab/radio 状态同步。 |
| Sidebar shortcuts | `Cmd+3`、`Cmd+,` 等切换模块且保留设置子页；切换后焦点跟随 active navigation item。 |
| Dialog | `aria-modal`、标题关联、焦点约束、Escape 关闭和触发器焦点恢复生效；数据库关键恢复流程不可用 Escape 绕过。 |
| Async status | 正常状态只播报状态文字；失败为 alert；没有伪确定进度、重复阶段名、Glow 或等待动画阻塞操作。 |

## 6. 设计系统执行与防回归

共享实现集中在 `src/components/ui/index.tsx`、`src/components/ui/ui.css`、`src/index.css` 和稳定 Page Template；Feature 层继续负责领域数据与布局，不重写底层数据库或 AI pipeline。`scripts/audit-ui-system.mjs` 会拒绝新增 raw shared control、feature 十六进制颜色、非 Token 字号/行高/圆角、未经审查的正数 Spacing 字面量、Unicode 控件图标、公开原始异常、旧删除武装模式、伪 `role=button`、缺少关键共享组件和异步状态中的 gradient/glow。主题契约另行自动检查 12 个调色板的 WCAG AA 对比度。组件测试覆盖 Button 默认类型、Tabs、Segmented、Combobox、Dialog、Sheet、Toast、Async State 和 FlowingTaskSurface 的关键语义。

本轮保留 `Surface`/`Card` 组件并不表示页面可以自由套卡片：Card 只有在内容构成可独立理解对象时使用；普通 Section 依靠 Heading、Spacing、Divider 和 Alignment。相机画面是明确媒体边界，悬浮扫描状态可使用媒体 Overlay Token；在 `prefers-reduced-transparency` 下必须替换成不透明实色。

## 7. 最终工程门禁

| 门禁 | 实际结果 |
| --- | --- |
| `npm run lint` | 通过；Oxlint 与 `audit-ui-system.mjs` 均无违规。 |
| `npm run typecheck` | 通过；`tsc -b --noEmit` 无类型错误。 |
| `npm test -- --reporter=dot` | 102 个测试文件、624 项测试全部通过。日志中仍有既有 `claimNextStudentAttemptModelRun` mock 警告和特意触发的容错分支 stderr，不影响测试结论。 |
| `npm run build` | 生产构建通过。保留既有 Tauri window 动静态导入提示和主 chunk 大于 500 kB 的性能警告；它们不属于本轮交互重构的正确性失败。 |
| `git diff --check` | 通过；无空白错误。 |

这些门禁证明前端实现、契约和生产打包路径一致，不扩张为原生相机、真实 SQLite 数据迁移、真实 Provider 或已安装 macOS 应用的人工验收结论。

## 8. 最终结论

本轮重构已经把 Axiom 从页面各自定义控件和层级的集合，收敛为可预测的桌面工作台：一级位置稳定，二级层级与对象关系可识别；高频任务直接可见，低频动作有固定去处；行、选择、危险操作、可恢复操作和异步反馈遵循一致语义；窄窗不是把所有内容简单纵向堆叠；视觉精致度来自系统化排版、间距、对齐和状态，而不是装饰性 Card、Badge、渐变或动画。

最终代码质量命令已按上表执行；本地提交信息以交付中的实际 commit 为准。
