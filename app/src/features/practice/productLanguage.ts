export function practiceErrorMessage(reason: unknown) {
  const detail = reason instanceof Error
    ? reason.message
    : typeof reason === 'string'
      ? reason
      : (() => {
        try { return JSON.stringify(reason) ?? String(reason) }
        catch { return String(reason) }
      })()
  if (/排版|公式|Typst|LaTeX|环境/.test(detail)) return '练习文档暂时无法生成，请重试；如果仍然失败，请重新生成这组练习。'
  if (/没有.*关联题|没有.*已验证|找不到.*题目/.test(detail)) return '暂时找不到适合这个主题的练习题。请先在错题库补充或完成题目解析。'
  if (/不属于当前/.test(detail)) return '这份作答页不属于当前练习，请上传本组练习对应的页面。'
  if (/页面身份|二维码/.test(detail)) return '未识别到页面二维码，请确保整页完整、清晰且未被遮挡。'
  if (/二维码|四角|页面边界|拍摄|图片格式/.test(detail)) return '无法完整读取答题卡，请确保整页入镜、四角清晰且没有明显阴影。'
  if (/PDF|pdf/.test(detail)) return '无法读取这份 PDF，请确认文件可以正常打开，或改为上传清晰照片。'
  if (/Provider|provider|API|模型|AI/.test(detail)) return '暂时无法自动读取作答，请检查 AI 设置后重试。'
  return '暂时无法完成此操作，请重试。'
}
