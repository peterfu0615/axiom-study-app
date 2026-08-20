import { describe, expect, it, vi } from 'vitest'
import { createAIError } from '../domain/aiError'
import { AIProviderFailure } from './provider'
import { aiRetryDelayMs, runWithAIBackoff } from './retryPolicy'

describe('AI retry policy', () => {
  const context = { providerId: 'provider-a', model: 'model-a', runId: 'run-a' }

  it('uses bounded exponential delays and recovers a retryable call', async () => {
    expect([0, 1, 2, 8].map(aiRetryDelayMs)).toEqual([350, 700, 1_400, 5_000])
    const operation = vi.fn()
      .mockRejectedValueOnce(new AIProviderFailure(createAIError('RATE_LIMIT_ERROR')))
      .mockRejectedValueOnce(new AIProviderFailure(createAIError('TIMEOUT_ERROR')))
      .mockResolvedValue('ok')
    const onFailure = vi.fn(async () => undefined)
    const wait = vi.fn(async () => undefined)

    await expect(runWithAIBackoff({ context, operation, onFailure, wait })).resolves.toBe('ok')
    expect(operation).toHaveBeenCalledTimes(3)
    expect(wait).toHaveBeenNthCalledWith(1, 350)
    expect(wait).toHaveBeenNthCalledWith(2, 700)
    expect(onFailure).toHaveBeenCalledTimes(2)
  })

  it('does not retry authentication failures', async () => {
    const operation = vi.fn().mockRejectedValue(
      new AIProviderFailure(createAIError('AUTHENTICATION_ERROR')),
    )
    const wait = vi.fn(async () => undefined)
    await expect(runWithAIBackoff({
      context,
      operation,
      onFailure: async () => undefined,
      wait,
    })).rejects.toMatchObject({ envelope: { code: 'AUTHENTICATION_ERROR' } })
    expect(operation).toHaveBeenCalledOnce()
    expect(wait).not.toHaveBeenCalled()
  })
})
