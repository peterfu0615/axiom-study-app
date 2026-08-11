export const TIKZ_REPAIR_LIMIT = 2

export const TIKZ_GENERATION_PROMPT = `你为 Axiom 生成受限 TikZ body。
只输出以 \\draw、\\fill、\\filldraw 或 \\node 开头并以分号结束的命令。
不要输出 Markdown 代码围栏、documentclass、usepackage、tikzpicture 环境或宏定义。
只使用明确的数值坐标。路径支持 --、cycle、rectangle、circle；函数图像使用离散数值坐标折线。
允许的样式只有 thick、dashed、->。标签必须简短、可读，不包含命令。
不得读取或写入文件，不得使用 shell、网络、外部命令、循环或递归。`

const forbidden = [
  '```', '\\documentclass', '\\usepackage', '\\begin{', '\\end{',
  '\\input', '\\include', '\\write', '\\read', '\\def', '\\newcommand',
  '\\foreach', '\\loop',
]

export function parseGeneratedTikzBody(raw: string) {
  const body = raw.trim()
  if (!body) throw new Error('模型没有返回 TikZ 内容')
  const lower = body.toLocaleLowerCase('en-US')
  const blocked = forbidden.find((token) => lower.includes(token.toLocaleLowerCase('en-US')))
  if (blocked) throw new Error(`TikZ 输出包含禁止内容：${blocked}`)
  const commands = body.split(';').map((command) => command.trim()).filter(Boolean)
  if (!commands.length || commands.length > 500) throw new Error('TikZ 命令数量无效')
  if (commands.some((command) => !/^\\(draw|filldraw|fill|node)\b/u.test(command))) {
    throw new Error('TikZ 输出包含不支持的命令')
  }
  return `${commands.join('; ')};`
}

export function buildTikzRepairPrompt(source: string, errorCode: string, errorMessage: string) {
  return `${TIKZ_GENERATION_PROMPT}\n\n上一次渲染失败。只修复受限 TikZ body，不改变题目表达。\n错误代码：${errorCode}\n错误：${errorMessage}\n原始 body：\n${source}`
}

export async function renderGeneratedTikzWithRepair<T extends {
  renderStatus: 'rendered' | 'failed'
  errorCode: string | null
  errorMessage: string | null
}>(input: {
  initialSource: string
  render: (source: string) => Promise<T>
  repair: (prompt: string, attempt: number) => Promise<string>
}) {
  let source = parseGeneratedTikzBody(input.initialSource)
  for (let repairCount = 0; repairCount <= TIKZ_REPAIR_LIMIT; repairCount += 1) {
    const result = await input.render(source)
    if (result.renderStatus === 'rendered' || repairCount === TIKZ_REPAIR_LIMIT) {
      return { source, result, repairCount }
    }
    const repaired = await input.repair(buildTikzRepairPrompt(
      source,
      result.errorCode || 'render_failed',
      result.errorMessage || '图形渲染失败',
    ), repairCount + 1)
    source = parseGeneratedTikzBody(repaired)
  }
  throw new Error('TikZ repair 状态异常')
}
