import { describe, expect, it } from 'vitest'
import { TIKZ_REPAIR_LIMIT, buildTikzRepairPrompt, parseGeneratedTikzBody, renderGeneratedTikzWithRepair } from './tikzContract'

describe('controlled TikZ generation contract', () => {
  it('accepts only the restricted body commands', () => {
    expect(parseGeneratedTikzBody('\\draw (0,0)--(1,1); \\node at (0,0) {O};'))
      .toBe('\\draw (0,0)--(1,1); \\node at (0,0) {O};')
  })

  it.each([
    '```tikz\n\\draw (0,0)--(1,1);\n```',
    '\\documentclass{standalone}',
    '\\begin{tikzpicture}\\draw (0,0)--(1,1);\\end{tikzpicture}',
    '\\input{/etc/passwd}',
    '\\foreach \\x in {1,2} { \\draw (0,0)--(\\x,1); }',
  ])('rejects unsafe model output: %s', (raw) => {
    expect(() => parseGeneratedTikzBody(raw)).toThrow()
  })

  it('builds a bounded repair request with structured render failure', () => {
    expect(TIKZ_REPAIR_LIMIT).toBe(2)
    const prompt = buildTikzRepairPrompt('\\draw (0,0);', 'invalid_geometry', '路径至少需要两个坐标')
    expect(prompt).toContain('invalid_geometry')
    expect(prompt).toContain('\\draw (0,0);')
    expect(prompt).toContain('只修复受限 TikZ body')
  })

  it('repairs a compile failure once and keeps the accepted source', async () => {
    const rendered = await renderGeneratedTikzWithRepair({
      initialSource: '\\draw (0,0);',
      render: async (source) => source.includes('--')
        ? { renderStatus: 'rendered' as const, errorCode: null, errorMessage: null }
        : { renderStatus: 'failed' as const, errorCode: 'invalid_geometry', errorMessage: '路径无效' },
      repair: async (prompt, attempt) => {
        expect(prompt).toContain('invalid_geometry')
        expect(attempt).toBe(1)
        return '\\draw (0,0)--(1,1);'
      },
    })
    expect(rendered.source).toBe('\\draw (0,0)--(1,1);')
    expect(rendered.repairCount).toBe(1)
    expect(rendered.result.renderStatus).toBe('rendered')
  })

  it('stops repair at the strict retry limit', async () => {
    let repairs = 0
    const rendered = await renderGeneratedTikzWithRepair({
      initialSource: '\\draw (0,0);',
      render: async () => ({ renderStatus: 'failed' as const, errorCode: 'invalid_geometry', errorMessage: '路径无效' }),
      repair: async () => { repairs += 1; return '\\draw (0,0);' },
    })
    expect(repairs).toBe(TIKZ_REPAIR_LIMIT)
    expect(rendered.repairCount).toBe(TIKZ_REPAIR_LIMIT)
    expect(rendered.result.renderStatus).toBe('failed')
  })

  it('repairs a compiled diagram that fails visual or semantic validation', async () => {
    let renders = 0
    const rendered = await renderGeneratedTikzWithRepair({
      initialSource: '\\fill (0,0)--(4,0)--(2,3)--cycle;',
      render: async () => (++renders === 1
        ? { renderStatus: 'rendered' as const, validationStatus: 'rejected' as const, validationErrors: ['大面积填充'], errorCode: null, errorMessage: null }
        : { renderStatus: 'rendered' as const, validationStatus: 'validated' as const, validationErrors: [], errorCode: null, errorMessage: null }),
      repair: async (prompt) => {
        expect(prompt).toContain('大面积填充')
        return '\\draw (0,0)--(4,0)--(2,3)--cycle;'
      },
    })
    expect(rendered.repairCount).toBe(1)
    expect(rendered.result.validationStatus).toBe('validated')
  })
})
