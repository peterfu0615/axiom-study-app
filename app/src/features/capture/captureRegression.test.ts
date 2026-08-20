// @ts-expect-error Vitest executes this contract in Node, while the app tsconfig is browser-only.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('capture responsiveness contracts', () => {
  it('uses one event-driven orientation watcher and releases the camera before editing', () => {
    const workspace = read('./CaptureWorkspace.tsx')
    expect(workspace).toContain('startCameraOrientationWatch(')
    expect(workspace).not.toContain('getCameraOrientation')
    expect(workspace).not.toMatch(/setInterval\([^)]*camera/u)
    expect(workspace).toContain('disabled={busy || !frameReady}')
    expect(workspace).toContain('let hasSuccessfulFrame = false')
    expect(workspace).toContain('hasSuccessfulFrame = true')
    expect(workspace).not.toContain("track.readyState === 'live'")
    expect(workspace).toContain("disabled={cameraStatus === 'requesting'}")
    expect(workspace).toMatch(
      /stopCameraStream\(stream\)\s*setStream\(null\)\s*setFrameReady\(false\)\s*latestOrientationRef\.current = null\s*const nextStream = await openCameraStream/u,
    )
    expect(workspace).toMatch(
      /stopCameraStream\(stream\)[\s\S]*setStream\(null\)[\s\S]*setEditingDocument\(document\)/u,
    )
  })

  it('shows corrected output before OCR completion and resets transient output on failure', () => {
    const editor = read('./DocumentEditor.tsx')
    expect(editor).toContain('progress.correctedPath')
    expect(editor).toContain("setProcessingStage('failed')")
    expect(editor).toContain('setCorrectedPath(document.correctedImagePath)')
    expect(editor).toContain('applyProcessingProgress')
  })

  it('keeps the helper CLI background-only without creating an NSApplication', () => {
    const helper = read('../../../src-tauri/native/AxiomVision.swift')
    expect(helper).toContain('AVCaptureDevice.RotationCoordinator(')
    expect(helper).toContain('videoRotationAngleForHorizonLevelCapture')
    expect(helper).not.toContain('NSApplication.shared')
    expect(helper).toContain('case "warm-up"')
  })
})
