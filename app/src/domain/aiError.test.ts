import { describe, expect, it } from 'vitest'
import { classifyAIError, createAIError, publicAIErrorMessage } from './aiError'

describe('AI error contract', () => {
  it.each([
    ['HTTP 401 unauthorized', 'AUTHENTICATION_ERROR'],
    ['HTTP 403 forbidden', 'AUTHENTICATION_ERROR'],
    ['HTTP 429 too many requests', 'RATE_LIMIT_ERROR'],
    ['HTTP 503 unavailable', 'PROVIDER_ERROR'],
    ['network connection refused', 'NETWORK_ERROR'],
    ['connect timeout', 'TIMEOUT_ERROR'],
    ['read timed out', 'TIMEOUT_ERROR'],
    ['模型响应中没有 JSON 对象', 'MODEL_OUTPUT_ERROR'],
    ['模型 JSON 不符合 Schema', 'SCHEMA_VALIDATION_ERROR'],
    ['canonical tag 映射失败', 'MAPPING_ERROR'],
    ['SQLite transaction failed', 'PERSISTENCE_ERROR'],
    ['task cancelled', 'CANCELLED'],
    ['请求输入无效', 'REQUEST_INVALID'],
  ] as const)('classifies %s', (message, code) => {
    expect(classifyAIError(new Error(message)).code).toBe(code)
  })

  it('does not allow auth, schema, persistence, or cancellation fallback', () => {
    for (const code of ['AUTHENTICATION_ERROR', 'SCHEMA_VALIDATION_ERROR', 'PERSISTENCE_ERROR', 'CANCELLED'] as const) {
      expect(createAIError(code).fallbackAllowed).toBe(false)
    }
  })

  it('keeps safe details separate from the public message', () => {
    const error = classifyAIError(new Error('HTTP 429 provider trace abc'))
    expect(publicAIErrorMessage(error)).not.toContain('trace abc')
    expect(error.detailSafe).toContain('trace abc')
  })
})
