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

  it('writes redactions into native crop pixels and preserves a local-only save branch', () => {
    const editor = readFileSync(new URL('./DocumentEditor.tsx', import.meta.url), 'utf8')
    const library = readFileSync(new URL('../library/ProblemLibrary.tsx', import.meta.url), 'utf8')
    const database = readFileSync(new URL('../../platform/database.ts', import.meta.url), 'utf8')
    const swift = readFileSync(new URL('../../../src-tauri/native/AxiomVision.swift', import.meta.url), 'utf8')

    expect(editor).toContain('确认发送题目图片')
    expect(editor).toContain('saveBlocks(false)')
    expect(editor).toContain('redactions: []')
    // 产品决策：题目解析不再弹出「确认发送题目图片」，重试/开始整理直接排队；
    // 采集保存流程（DocumentEditor）的披露确认保持不变。
    expect(library).not.toContain('setAIUploadConfirming')
    expect(library).toContain('const retryAI = async () => {')
    expect(database).toContain("ai_status = 'not_started'")
    expect(database).toContain('ai_active_model_run_id = NULL')
    expect(swift).toContain('opaqueMask.composited(over: cropped)')
    expect(swift).toContain('--redactions-json')
  })
})
