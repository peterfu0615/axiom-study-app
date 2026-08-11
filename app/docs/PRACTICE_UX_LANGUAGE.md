# Practice 用户文案规范

Practice 的用户界面描述学习任务，不描述内部实现。数据库、日志、测试和开发文档仍可使用准确的领域名称，但这些名称不得直接进入学生可见的标题、按钮、状态标签或错误引导。

| 内部概念 | 用户界面用语 |
| --- | --- |
| `ReviewSession` / `ReviewModule` / `Review Unit` | 今日学习、学习主题 |
| `PracticeSet` / `Practice Set` | 练习、本组练习 |
| `PracticeAttempt` | 本次作答、本次练习 |
| `SkillBundle` / `SkillState` | 相关知识、学习进度 |
| `Practice Loop` / round | 巩固练习、再练一组 |
| deterministic planner / strategy | 不展示；必要时称为自动生成 |
| OCR / layout identity / answer region | 读取作答、匹配练习、识别答案 |
| evidence / scheduler update | 已自动更新学习进度、已安排后续学习 |

每个页面只保留一个与当前阶段对应的主操作。Today 的主操作是“生成今日练习”或“查看今日练习”；文档准备阶段是“提交作答”；批改结果待确认时是“确认结果”；需要巩固时是“再练一组”；完成时是“完成”。保存 PDF、打印、修改识别结果等均为次级操作。

异步处理中应说明用户能理解的当前动作，例如“正在读取作答”“正在匹配练习”“正在读取答案”“正在批改”。错误文案应给出下一步，不暴露数据库表名、内部 ID、Provider 响应或状态机值。
