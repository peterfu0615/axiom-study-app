# Axiom Typography System

Axiom 的产品 UI 字号体系以 Apple macOS 内建文本样式为基线。字体栈优先使用系统提供的 San Francisco 与苹方，不在应用中打包系统字体。PDF、题目正文、KaTeX 和数学阅读排版不属于这套产品 UI 字号体系。

## Platform primitives

| Axiom token | macOS reference | Size / line height | Default use |
| --- | --- | --- | --- |
| `large-title` | Large Title | 26 / 32 | 一级 Workspace 标题 |
| `title-1` | Title 1 | 22 / 28 | 少量突出标题 |
| `title-2` | Title 2 | 17 / 23 | Section 标题、Dialog 标题 |
| `title-3` | Title 3 | 15 / 20 | Card 标题、条目主标题 |
| `headline` | Headline | 13 / 18 | Button、Tab、强调正文 |
| `body` | Body | 13 / 19 | 产品正文、输入内容 |
| `callout` | Callout | 12 / 17 | Label、辅助正文 |
| `subheadline` | Subheadline | 11 / 15 | Metadata、Eyebrow |
| `footnote` | Footnote | 10 / 14 | 低优先级说明 |
| `caption` | Caption | 10 / 13 | Status、Badge、紧凑标注 |

Apple 的 macOS Body 原始建议行高是 16pt。Axiom 的中文界面将 Body、Callout、Subheadline 行高分别放宽到 19、17、15px，避免苹方中文在多行说明中显得拥挤。字号与层级保持 macOS 基线不变。

## Product role mapping

产品组件只使用 `--ax-type-page-*`、`section`、`card`、`body`、`body-small`、`control`、`label`、`meta`、`caption` 等语义角色。平台 primitive 负责固定比例，产品 role 负责表达用途。除 Logo、KPI 数字、题目阅读内容等明确例外外，不新增临时字号。

正文默认使用 Regular，Card 和控件使用 Semibold，Page 与 Section 使用 Bold。遵循 Apple HIG，不使用 Ultralight、Thin 或 Light。浏览器使用系统字体的自动 optical sizing 与 tracking；只有 Eyebrow 保留少量正向 tracking 作为层级标识。

## Accessibility and layout

macOS 产品 UI 的最小字号为 10px。扩大文字后，窄窗口优先将 Header action、表单列和并排内容改为纵向布局，不通过压缩到 10px 以下保持原有列数。图标和文字控件共同使用 Control 样式，并保持符号尺寸随控件层级协调。

参考：[Apple Human Interface Guidelines — Typography](https://developer.apple.com/design/human-interface-guidelines/typography)。
