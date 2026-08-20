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
