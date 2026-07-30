# Axiom 题目阅读字体规范

本规范参考 Apple Human Interface Guidelines 的字体层级原则，并针对中文数学题阅读做了收敛。字号用于建立信息层级，不通过整体缩放来提高可读性。

## 字体族

```css
-apple-system,
BlinkMacSystemFont,
"SF Pro Text",
"PingFang SC",
"Hiragino Sans GB",
"Microsoft YaHei",
ui-sans-serif,
sans-serif
```

macOS 上英文、数字和西文符号优先使用 San Francisco，中文明确回退到苹方，避免只声明西文字体后由浏览器选择不稳定的中文替代字体。数学公式继续由 KaTeX 自带字体渲染。

## 层级映射

| 元素 | HIG 语义 | 字号 | 行高 | 字重 |
| --- | --- | ---: | ---: | ---: |
| 页面主标题 | Large Title | 26px | 32px | 700 |
| 错题详情标题 | Title | 22px | 28px | 700 |
| 分区标题 | Headline | 17px | 22px | 700 |
| 题干 | Body | 15px | 25px | 450 |
| 块级公式 | Body（加大行高） | 16px | 28px | 400 |
| 选项 | Body | 14px | 22px | 400 |
| 小问 | Body | 14px | 23px | 450 |
| 知识点标签 | Subheadline | 12px | 18px | 550 |
| 辅助信息 | Caption | 11px | 16px | 500 |

## 长内容布局规则

- 题干、选项和小问容器均允许自然换行，不设固定高度。
- KaTeX 块公式使用横向滚动作为窄窗口兜底，不压缩公式，也不让公式撑破详情栏。
- 详情头部操作在中等宽度下自动换行；图形与正文在窄窗口下改为单列。
- 错题库在 900px 以下缩窄列表栏，在 840px 以下收敛详情间距与信息网格。
- 中文正文使用较宽松的 1.65 左右行距；公式区域使用独立行高，避免上下标、分式和根号互相挤压。

## 验证场景

1. 长题干：连续三行以上中文与行内公式混排，正文不截断。
2. 多公式：分式、根号、上下标和块公式连续出现，公式之间无垂直重叠。
3. 多选项：四个以上选项自然换行，选项标签与正文保持顶端对齐。
4. 小窗口：900px 与 840px 两个断点下，详情操作区、图形区和事实信息不横向溢出。

实测 820×620 浏览器视口下 `documentElement.scrollWidth` 与视口宽度同为 820px，采集主区域由双列切换为单列；截图见 `docs/screenshots/responsive-820x620.png`。
