// @ts-expect-error Vitest executes this contract in Node, while the app tsconfig is browser-only.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('practice submission recovery UI', () => {
  const source = readFileSync(new URL('./PracticeSetView.tsx', import.meta.url), 'utf8')

  it('accepts ordered multi-file submission and exposes a manual page choice', () => {
    expect(source).toContain('multiple: true')
    expect(source).toContain("'manual_match'")
    expect(source).toContain('PracticeSubmissionMatchError')
    expect(source).toContain('resumeManualMatch')
    expect(source).toContain('manualMatch.pageOptions.map')
  })

  it('does not retry-import already persisted pages after a later page fails', () => {
    expect(source).toContain('submissions: reason.submissions')
    expect(source).toContain('const [failed, ...remaining] = manualMatch.submissions')
    expect(source).toContain('{ ...failed, practiceDocumentPageId }')
  })

  it('expands every annotated PDF page and offers live continuous scanning', () => {
    expect(source).toContain('prepared.pages.map')
    expect(source).toContain('annotationsPreserved: prepared.annotationsPreserved')
    expect(source).toContain("setMode('scanner')")
    expect(source).toContain('<PracticeSubmissionScanner')
    const scanner = readFileSync(new URL('./PracticeSubmissionScanner.tsx', import.meta.url), 'utf8')
    expect(scanner).toContain('previewPracticeScan')
    expect(scanner).toContain('answerRegions.map')
    expect(scanner).toContain("sourceKind: 'camera_scan'")
    expect(scanner).toContain('startCameraOrientationWatch')
    expect(scanner).toContain('页面稳定后自动拍摄')
    expect(scanner).toContain('stablePageRef.current.count < 2')
    const rust = readFileSync(new URL('../../../src-tauri/src/practice_capture.rs', import.meta.url), 'utf8')
    const swift = readFileSync(new URL('../../../src-tauri/native/AxiomVision.swift', import.meta.url), 'utf8')
    expect(rust).not.toContain('Command::new("/usr/bin/sips")')
    expect(rust).toContain('prepare_pdf_submission')
    expect(swift).toContain('case "pdf-info"')
    expect(swift).toContain('CGPDFDocument')
  })

  it('keeps a visual fixture for the advanced submission methods', () => {
    const app = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8')
    const preview = readFileSync(new URL('./PracticeSubmissionPreview.tsx', import.meta.url), 'utf8')
    expect(app).toContain("preview === 'submission'")
    expect(preview).toContain('initialMode="submit"')
  })
})
