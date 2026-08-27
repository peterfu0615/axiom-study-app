import {
  AIExecutionError,
  classifyAIError,
  type AIErrorEnvelope,
} from '../domain/aiError'

export interface AIRetryContext {
  providerId: string
  model: string
  runId: string
}

export function aiRetryDelayMs(failedAttemptIndex: number) {
  const safeIndex = Math.max(0, Math.floor(failedAttemptIndex))
  return Math.min(5_000, 350 * (2 ** safeIndex))
}

export async function runWithAIBackoff<T>(options: {
  context: AIRetryContext
  operation: () => Promise<T>
  onFailure: (
    error: unknown,
    envelope: AIErrorEnvelope,
    attemptNumber: number,
  ) => Promise<void>
  maxAttempts?: number
  wait?: (milliseconds: number) => Promise<void>
}): Promise<T> {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 3))
  const wait = options.wait ?? ((milliseconds: number) =>
    new Promise<void>((resolve) => globalThis.setTimeout(resolve, milliseconds)))
  for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex += 1) {
    try {
      return await options.operation()
    } catch (error) {
      const envelope = classifyAIError(error, options.context)
      await options.onFailure(error, envelope, attemptIndex + 1)
      if (!envelope.retryable || attemptIndex === maxAttempts - 1) {
        throw new AIExecutionError(envelope)
      }
      await wait(aiRetryDelayMs(attemptIndex))
    }
  }
  throw new AIExecutionError(classifyAIError('AI retry policy exhausted', options.context))
}

export async function runWithAIProviderFallback<
  TProvider extends { id: string; model: string },
  TResult,
>(options: {
  providers: TProvider[]
  runId: string
  operation: (provider: TProvider) => Promise<TResult>
  onFailure?: (
    provider: TProvider,
    error: unknown,
    envelope: AIErrorEnvelope,
    attemptNumber: number,
  ) => Promise<void>
  maxAttemptsPerProvider?: number
  wait?: (milliseconds: number) => Promise<void>
}): Promise<{ provider: TProvider; value: TResult }> {
  let lastError: AIErrorEnvelope | null = null
  for (const provider of options.providers) {
    try {
      const value = await runWithAIBackoff({
        context: { providerId: provider.id, model: provider.model, runId: options.runId },
        operation: () => options.operation(provider),
        maxAttempts: options.maxAttemptsPerProvider,
        wait: options.wait,
        onFailure: async (error, envelope, attemptNumber) => {
          lastError = envelope
          await options.onFailure?.(provider, error, envelope, attemptNumber)
        },
      })
      return { provider, value }
    } catch (error) {
      const envelope = error instanceof AIExecutionError
        ? error.envelope
        : classifyAIError(error, { providerId: provider.id, model: provider.model, runId: options.runId })
      lastError = envelope
      if (!envelope.fallbackAllowed) throw new AIExecutionError(envelope)
    }
  }
  throw new AIExecutionError(lastError ?? classifyAIError('没有可用的模型服务', { runId: options.runId }))
}
