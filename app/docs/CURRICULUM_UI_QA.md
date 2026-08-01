# 课程页面视觉验收记录

本记录对应课程重构实现，使用开发服务器的确定性状态夹具完成。夹具仅在开发环境通过
`?ui-preview=curriculum` 启用，不读取或改写本机用户数据库。

## 已审查的主要状态

| 状态 | 截图 | 审查结果 |
| --- | --- | --- |
| 已导入教材的知识结构 | [knowledge-structure.png](screenshots/course-redesign/knowledge-structure.png) | 顶层仅有“知识结构 / 标签概览”；目录与节点详情使用主从布局。 |
| 首次使用 | [empty-course.png](screenshots/course-redesign/empty-course.png) | 提供导入教材和手动创建的完整空状态。 |
| 标签概览与待确认映射 | [tag-overview.png](screenshots/course-redesign/tag-overview.png) | 四维标签、统计、待确认队列和紧凑更新任务位于同一视图。 |
| 无标签 | [empty-tags.png](screenshots/course-redesign/empty-tags.png) | 保留新建入口，且空状态不会撑成大型空卡片。 |
| 更新任务运行中 | [tag-update-running.png](screenshots/course-redesign/tag-update-running.png) | 显示进度、完成、待确认、失败、暂停与详情入口。 |
| 更新任务已暂停 | [tag-update-paused.png](screenshots/course-redesign/tag-update-paused.png) | 显示已暂停状态和继续入口。 |
| 教材信息确认 | [import-confirmation.png](screenshots/course-redesign/import-confirmation.png) | 展示字段级依据、可信度及低置信度修正。 |
| AI 后台处理中 | [import-processing.png](screenshots/course-redesign/import-processing.png) | 仅显示当前状态、流动光效、内描边进度条和低强调度取消入口。 |
| 课程结构校正 | [import-structure.png](screenshots/course-redesign/import-structure.png) | 目录节点可修改层级和名称，完成动作采用自然文案。 |
| 导入失败 | [import-failed.png](screenshots/course-redesign/import-failed.png) | 只有失败状态提供重新尝试与放弃分析。 |

## 全局教材分析夹具

`state` 参数可使用以下确定性状态：

| state | 用途 |
| --- | --- |
| `global-analysis-structure` | App Shell 显示“分析教材中”，进度为教材结构识别。 |
| `global-analysis-tags` | 标签分块分析，使用持久化的 `3/5` 进度。 |
| `global-analysis-audit` | 质量审计阶段。 |
| `global-analysis-completed` | 全局按钮切换为“分析完成”，无持续动画。 |
| `global-analysis-failed` | 全局按钮切换为“分析已暂停”，进度页显示重试和放弃。 |
| `import-progress-minimal` | 直接打开精简进度卡。 |

本轮 820×620 视口验收截图位于
[`docs/screenshots/curriculum-analysis`](screenshots/curriculum-analysis)，覆盖课程、错题库、
设置、精简进度、完成、失败以及深色审计状态。

审查视口为本地桌面宽度。页面继续沿用 Axiom 的暖黄色主操作、细边界和低阴影层级；
顶层下划线导航与标签维度的纵向导航刻意使用不同形态，避免出现两层相同的分段控件。
