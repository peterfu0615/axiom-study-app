import solutionSchema from './solution.schema.json'

export const SOLUTION_SCHEMA_VERSION = 'solution-v1'
export const SOLUTION_PROMPT_VERSION = 'middle-school-solution-v1'

export const solutionJSONSchema = solutionSchema

// Antigravity CLI 不接受 nullable union；完整约束由应用层 Ajv Schema 执行。
export const solutionAntigravityJSONSchema = {
  type: 'object',
  required: [
    'content_markdown',
    'steps',
    'key_method',
    'used_formulas',
    'knowledge_points',
  ],
  properties: {
    content_markdown: { type: 'string' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        required: ['index', 'title', 'content_markdown'],
        properties: {
          index: { type: 'integer' },
          title: { type: 'string' },
          content_markdown: { type: 'string' },
        },
      },
    },
    key_method: {},
    used_formulas: {
      type: 'array',
      items: { type: 'string' },
    },
    knowledge_points: {
      type: 'array',
      items: { type: 'string' },
    },
  },
} as const

export const SOLUTION_PROMPT = String.raw`
你是中国中学数学标准答案生成模型。请根据题目图片和结构化题目信息给出可直接写入参考答案的标准解答。

输出规则：
1. 只返回一个符合 JSON Schema 的 JSON 对象，不要 Markdown 代码块、前言、总结或解释性文字。
2. content_markdown 必须是完整标准答案；steps 必须按相同推导顺序拆成独立步骤，index 从 1 连续递增。
3. 使用 LaTeX Markdown：行内公式放在 $...$，独立公式放在 $$...$$。
4. 分式、根号、上下标、方程、函数式、角、三角形、平行和垂直关系必须使用 LaTeX。
5. 几何证明和逻辑推导优先使用 \because、\therefore、\Rightarrow、\Longrightarrow、\iff。
6. 禁止用“因为……所以……”承担证明逻辑。必要中文只用于步骤标题、方法名称和极短的衔接说明。
7. 推理必须完整，不得省略决定性条件、公式代入、变形过程或最终结论。
8. key_method 是核心方法名称；无法可靠判断时返回 null。
9. knowledge_points 只关联输入中已有或可由题目直接确认的知识点，不得臆造；没有时返回 []。
10. 题目信息不足以得到唯一可靠解答时，不得编造答案，应让输出无法通过完整解答约束，由应用显示生成失败。

必须返回以下结构：
{
  "content_markdown": "完整标准解答",
  "steps": [
    {
      "index": 1,
      "title": "步骤标题",
      "content_markdown": "本步骤的 LaTeX Markdown"
    }
  ],
  "key_method": null,
  "used_formulas": [],
  "knowledge_points": []
}
`.trim()
