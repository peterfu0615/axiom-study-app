// @ts-expect-error Vitest executes this contract in Node, while the app tsconfig is browser-only.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  getProblemUnderstandingUploadDisclosure,
  MockAIProvider,
  setAIProviderForTests,
  type AIProvider,
} from '../../ai/provider'

describe('capture privacy contracts', () => {
  it('does not describe the local Mock provider as an external image upload', () => {
    setAIProviderForTests(new MockAIProvider(0))
    expect(getProblemUnderstandingUploadDisclosure()).toMatchObject({
      providerId: 'mock-default',
      sendsImagesExternally: false,
    })
  })

  it('requires disclosure for providers without an explicit local boundary', () => {
    const provider: AIProvider = {
      id: 'remote-provider',
      model: 'vision-model',
      supportsText: true,
      supportsVision: true,
      analyzeProblemImage: async () => { throw new Error('unused') },
    }
    setAIProviderForTests(provider)
    expect(getProblemUnderstandingUploadDisclosure()).toEqual({
      providerId: 'remote-provider',
      model: 'vision-model',
      sendsImagesExternally: true,
    })
    setAIProviderForTests(new MockAIProvider(0))
  })

  it('writes redactions into native crop pixels without an interrupting provider dialog', () => {
    const editor = readFileSync(new URL('./DocumentEditor.tsx', import.meta.url), 'utf8')
    const library = readFileSync(new URL('../library/ProblemLibrary.tsx', import.meta.url), 'utf8')
    const database = readFileSync(new URL('../../platform/database.ts', import.meta.url), 'utf8')
    const swift = readFileSync(new URL('../../../src-tauri/native/AxiomVision.swift', import.meta.url), 'utf8')

    expect(editor).not.toContain('确认发送题目图片')
    expect(editor).not.toContain('uploadDisclosure.providerId')
    expect(editor).toContain('queueAI: true')
    expect(editor).toContain('redactions: []')
    // 采集保存、重试和开始整理都直接排队；数据范围说明留在设置中，
    // 不再在主流程暴露 Provider UUID 或用重复弹窗打断保存。
    expect(library).not.toContain('setAIUploadConfirming')
    expect(library).toContain('const retryAI = async () => {')
    expect(database).toContain("ai_status = 'not_started'")
    expect(database).toContain('ai_active_model_run_id = NULL')
    expect(swift).toContain('opaqueMask.composited(over: cropped)')
    expect(swift).toContain('--redactions-json')
  })
})
