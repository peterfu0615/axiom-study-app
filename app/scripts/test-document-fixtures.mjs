import { mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const appRoot = resolve(import.meta.dirname, '..')
const fixtureRoot = resolve(appRoot, '..', 'test')
const buildRoot = resolve(appRoot, 'src-tauri', 'target', 'debug', 'build')

const fixtures = [
  {
    caseName: '偏暗试卷',
    file: '解答题_水印_几何图像处理.png',
    numbers: [18, 19, 20],
    minimumLastBlockBottom: 0.72,
  },
  {
    caseName: '明显阴影试卷',
    file: '解答题_水印_左页边缘判断和裁切_函数图像、表格的处理.png',
    numbers: [18, 19, 20],
    minimumLastBlockBottom: 0.98,
  },
  {
    caseName: '正常光照试卷',
    file: '选择题_水印_试卷多余表头和文本描述裁切_不完整题目处理.png',
    numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    minimumFirstBlockY: 0.12,
    minimumLastBlockBottom: 0.98,
  },
]

function findHelper() {
  const candidates = readdirSync(buildRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('axiom-'))
    .map((entry) => join(buildRoot, entry.name, 'out', 'axiom-vision'))
    .filter((path) => {
      try {
        return statSync(path).isFile()
      } catch {
        return false
      }
    })
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)
  if (!candidates[0]) {
    throw new Error('找不到 axiom-vision；请先运行 cargo check')
  }
  return candidates[0]
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function hasChineseText(title) {
  return (title.match(/[\u3400-\u9fff]/gu) ?? []).length >= 2
}

const helper = findHelper()
const outputRoot = mkdtempSync(join(tmpdir(), 'axiom-document-fixtures-'))
const comparisons = []

for (const [index, fixture] of fixtures.entries()) {
  const source = join(fixtureRoot, fixture.file)
  const prefix = `case-${index + 1}`
  const before = join(outputRoot, `${prefix}-before.jpg`)
  const output = join(outputRoot, `${prefix}-grayscale.jpg`)
  const colorOutput = join(outputRoot, `${prefix}-color.jpg`)
  const process = spawnSync(
    helper,
    [
      'process',
      '--input',
      source,
      '--output',
      output,
      '--before-output',
      before,
      '--mode',
      'grayscale',
    ],
    { encoding: 'utf8' },
  )
  assert(process.status === 0, `${fixture.file}: ${process.stderr}`)
  const result = JSON.parse(process.stdout)

  assert(
    result.blocks.length === fixture.numbers.length,
    `${fixture.file}: 期望 ${fixture.numbers.length} 块，实际 ${result.blocks.length} 块`,
  )
  result.blocks.forEach((block, index) => {
    const expectedNumber = fixture.numbers[index]
    assert(
      block.title.startsWith(`${expectedNumber}.`),
      `${fixture.file}: 第 ${index + 1} 块题号错误：${block.title}`,
    )
    assert(
      hasChineseText(block.title),
      `${fixture.file}: 第 ${expectedNumber} 题标题缺少中文：${block.title}`,
    )
    assert(
      !/[A-Za-z]/u.test(block.title),
      `${fixture.file}: 第 ${expectedNumber} 题标题仍含拉丁乱码：${block.title}`,
    )
    assert(
      block.rect.x <= 0.02 && block.rect.width >= 0.96,
      `${fixture.file}: 第 ${expectedNumber} 题未覆盖完整内容宽度`,
    )
    if (index + 1 < result.blocks.length) {
      const next = result.blocks[index + 1]
      const bottom = block.rect.y + block.rect.height
      assert(
        bottom <= next.rect.y && next.rect.y - bottom <= 0.012,
        `${fixture.file}: 第 ${expectedNumber} 题与下一题之间存在截断或重叠`,
      )
    }
  })
  if (fixture.minimumFirstBlockY) {
    assert(
      result.blocks[0].rect.y >= fixture.minimumFirstBlockY,
      `${fixture.file}: 表头未从第一题中剥离`,
    )
  }
  const last = result.blocks.at(-1)
  assert(
    last.rect.y + last.rect.height >= fixture.minimumLastBlockBottom,
    `${fixture.file}: 最后一题下边界过早`,
  )

  const colorProcess = spawnSync(
    helper,
    ['process', '--input', source, '--output', colorOutput, '--mode', 'color'],
    { encoding: 'utf8' },
  )
  assert(colorProcess.status === 0, `${fixture.file}（彩色）: ${colorProcess.stderr}`)
  const colorResult = JSON.parse(colorProcess.stdout)
  assert(
    colorResult.blocks.length === result.blocks.length,
    `${fixture.file}: 彩色与灰度模式题块数量不一致`,
  )

  comparisons.push({
    caseName: fixture.caseName,
    file: fixture.file,
    before: basename(before),
    color: basename(colorOutput),
    grayscale: basename(output),
    blockCount: result.blocks.length,
  })
  console.log(
    `✓ ${fixture.caseName} / ${fixture.file}: ${result.blocks.length} 个题目块`,
  )
}

const escapeHtml = (value) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

const comparisonCards = comparisons
  .map(
    (comparison) => `
      <section class="case">
        <header>
          <div>
            <p class="eyebrow">${escapeHtml(comparison.caseName)}</p>
            <h2>${escapeHtml(comparison.file)}</h2>
          </div>
          <span>${comparison.blockCount} 个题目块</span>
        </header>
        <div class="pair">
          <figure>
            <figcaption>增强前（透视矫正后）</figcaption>
            <img src="${comparison.before}" alt="${escapeHtml(comparison.caseName)}增强前">
          </figure>
          <figure>
            <figcaption>增强后（保留颜色）</figcaption>
            <img src="${comparison.color}" alt="${escapeHtml(comparison.caseName)}彩色增强后">
          </figure>
          <figure>
            <figcaption>增强后（灰度扫描）</figcaption>
            <img src="${comparison.grayscale}" alt="${escapeHtml(comparison.caseName)}灰度增强后">
          </figure>
        </div>
      </section>`,
  )
  .join('\n')

const report = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Axiom 图像增强回归对比</title>
    <style>
      :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; background: #ecebe7; color: #24231f; }
      main { width: min(1500px, calc(100% - 32px)); margin: 40px auto 80px; }
      h1 { margin: 0 0 8px; font-size: clamp(28px, 4vw, 48px); }
      .intro { margin: 0 0 32px; color: #656258; }
      .case { margin-top: 28px; padding: 24px; border: 1px solid #d7d3c9; border-radius: 18px; background: #f8f7f3; box-shadow: 0 12px 36px rgb(39 35 24 / 8%); }
      header { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; margin-bottom: 20px; }
      .eyebrow { margin: 0 0 6px; color: #746b51; font-size: 13px; font-weight: 700; letter-spacing: .12em; }
      h2 { margin: 0; overflow-wrap: anywhere; font-size: 20px; }
      header span { flex-shrink: 0; padding: 6px 10px; border-radius: 999px; background: #e9e5d9; color: #5e5848; font-size: 13px; }
      .pair { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; }
      figure { margin: 0; min-width: 0; }
      figcaption { margin-bottom: 8px; color: #5f5c53; font-size: 14px; font-weight: 600; }
      img { display: block; width: 100%; height: auto; border: 1px solid #d5d1c7; border-radius: 10px; background: white; }
      @media (max-width: 980px) {
        main { width: min(100% - 20px, 1500px); margin-top: 20px; }
        .case { padding: 14px; border-radius: 12px; }
        header { display: block; }
        header span { display: inline-block; margin-top: 12px; }
        .pair { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Axiom 图像增强回归对比</h1>
      <p class="intro">三栏使用同一透视矫正结果，只比较扫描件增强前后；未使用二值化。</p>
      ${comparisonCards}
    </main>
  </body>
</html>
`

const reportPath = join(outputRoot, 'comparison.html')
writeFileSync(reportPath, report)
console.log(`回归输出：${outputRoot}`)
console.log(`前后对比：${reportPath}`)
