import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  captureVideoFrame,
  openCameraStream,
  requestCameraDevices,
} from './camera'

function context2d() {
  return {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    drawImage: vi.fn(),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('captureVideoFrame', () => {
  it('encodes the full-resolution frame through async Blob APIs', async () => {
    const context = context2d()
    const toDataURL = vi.fn(() => 'data:image/jpeg;base64,synchronous')
    const toBlob = vi.fn(
      (callback: BlobCallback, type?: string, quality?: number) => {
        queueMicrotask(() => callback(new Blob(['frame'], { type })))
        expect(type).toBe('image/jpeg')
        expect(quality).toBe(0.94)
      },
    )
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      toBlob,
      toDataURL,
    }

    class FileReaderMock {
      error: DOMException | null = null
      result: string | ArrayBuffer | null = null
      onerror: ((this: FileReader, event: ProgressEvent<FileReader>) => unknown) | null = null
      onload: ((this: FileReader, event: ProgressEvent<FileReader>) => unknown) | null = null

      readAsDataURL() {
        queueMicrotask(() => {
          this.result = 'data:image/jpeg;base64,Y2FtZXJhLWZyYW1l'
          this.onload?.call(this as unknown as FileReader, {} as ProgressEvent<FileReader>)
        })
      }
    }

    vi.stubGlobal('document', {
      createElement: vi.fn((tag: string) => {
        expect(tag).toBe('canvas')
        return canvas
      }),
    })
    vi.stubGlobal('FileReader', FileReaderMock)

    const video = { videoWidth: 1440, videoHeight: 1920 } as HTMLVideoElement
    const onFrameCopied = vi.fn()
    await expect(captureVideoFrame(video, 0, onFrameCopied)).resolves.toBe(
      'data:image/jpeg;base64,Y2FtZXJhLWZyYW1l',
    )
    expect(canvas.width).toBe(1440)
    expect(canvas.height).toBe(1920)
    expect(toBlob).toHaveBeenCalledOnce()
    expect(toDataURL).not.toHaveBeenCalled()
    expect(onFrameCopied).toHaveBeenCalledOnce()
  })

  it('rejects cleanly when WebKit cannot create an encoded Blob', async () => {
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context2d()),
      toBlob: vi.fn((callback: BlobCallback) => callback(null)),
    }
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas) })

    await expect(
      captureVideoFrame(
        { videoWidth: 1440, videoHeight: 1920 } as HTMLVideoElement,
        0,
      ),
    ).rejects.toThrow('无法编码相机帧')
  })

  it('does not release the camera when no frame can be copied', async () => {
    const onFrameCopied = vi.fn()
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({
        width: 0,
        height: 0,
        getContext: vi.fn(() => context2d()),
        toBlob: vi.fn(),
      })),
    })

    await expect(
      captureVideoFrame(
        { videoWidth: 0, videoHeight: 0 } as HTMLVideoElement,
        0,
        onFrameCopied,
      ),
    ).rejects.toThrow('相机画面尚未准备好')
    expect(onFrameCopied).not.toHaveBeenCalled()
  })
})

describe('camera acquisition', () => {
  it('uses an already-authorized device list without opening a probe stream', async () => {
    const getUserMedia = vi.fn()
    vi.stubGlobal('navigator', {
      mediaDevices: {
        enumerateDevices: vi.fn().mockResolvedValue([
          {
            deviceId: 'iphone-camera',
            groupId: 'continuity',
            kind: 'videoinput',
            label: 'Peter 的 iPhone Camera',
          },
        ]),
        getUserMedia,
      },
    })

    await expect(requestCameraDevices()).resolves.toEqual([
      { id: 'iphone-camera', label: 'Peter 的 iPhone Camera' },
    ])
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('times out a stalled request and stops a stream that resolves late', async () => {
    const stop = vi.fn()
    const deferred: { resolve?: (stream: MediaStream) => void } = {}
    const getUserMedia = vi.fn(
      () =>
        new Promise<MediaStream>((resolve) => {
          deferred.resolve = resolve
        }),
    )
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia },
    })

    const pending = openCameraStream('iphone-camera', 5)
    await expect(pending).rejects.toThrow('相机连接超过 1 秒')
    deferred.resolve?.({
      getTracks: () => [{ stop }],
    } as unknown as MediaStream)
    await Promise.resolve()

    expect(stop).toHaveBeenCalledOnce()
  })
})
