export const AI_ERROR_CODES = [
  'AUTHENTICATION_ERROR',
  'NETWORK_ERROR',
  'TIMEOUT_ERROR',
  'RATE_LIMIT_ERROR',
  'PROVIDER_ERROR',
  'MODEL_CAPABILITY_ERROR',
  'REQUEST_INVALID',
  'MODEL_OUTPUT_ERROR',
  'SCHEMA_VALIDATION_ERROR',
  'MAPPING_ERROR',
  'PERSISTENCE_ERROR',
  'CANCELLED',
] as const

export type AIErrorCode = (typeof AI_ERROR_CODES)[number]

export interface AIErrorEnvelope {
  code: AIErrorCode
  title: string
  userMessage: string
  retryable: boolean
  fallbackAllowed: boolean
  providerId: string | null
  model: string | null
  httpStatus: number | null
  runId: string | null
  attemptId: string | null
  detailSafe: string | null
  occurredAt: number
}

type ErrorContext = Partial<Pick<AIErrorEnvelope,
  'providerId' | 'model' | 'httpStatus' | 'runId' | 'attemptId' | 'detailSafe' | 'occurredAt'>>

const definitions: Record<AIErrorCode, Pick<AIErrorEnvelope,
  'title' | 'userMessage' | 'retryable' | 'fallbackAllowed'>> = {
  AUTHENTICATION_ERROR: {
    title: 'AI 服务认证失败', userMessage: 'API Key 无效或没有访问当前模型的权限，请检查 AI 服务设置。',
    retryable: false, fallbackAllowed: true,
  },
  NETWORK_ERROR: {
    title: '无法连接模型服务', userMessage: '网络连接失败，请检查网络后重新尝试。',
    retryable: true, fallbackAllowed: true,
  },
  TIMEOUT_ERROR: {
    title: 'AI 分析超时', userMessage: '模型服务响应超时，可以重新尝试。',
    retryable: true, fallbackAllowed: true,
  },
  RATE_LIMIT_ERROR: {
    title: '模型服务繁忙', userMessage: '请求过于频繁或当前额度受限，请稍后重试。',
    retryable: true, fallbackAllowed: true,
  },
  PROVIDER_ERROR: {
    title: '模型服务暂时不可用', userMessage: 'AI 服务未能完成请求，可以重新尝试。',
    retryable: true, fallbackAllowed: true,
  },
  MODEL_CAPABILITY_ERROR: {
    title: '当前模型不支持此任务', userMessage: '请选择支持图片输入的模型后重新运行。',
    retryable: false, fallbackAllowed: true,
  },
  REQUEST_INVALID: {
    title: 'AI 请求无法发送', userMessage: '请求配置或输入无效，请检查题目图片与 AI 服务设置。',
    retryable: false, fallbackAllowed: false,
  },
  MODEL_OUTPUT_ERROR: {
    title: '模型返回内容无法解析', userMessage: '模型没有返回可读取的结构化结果，可以重新尝试。',
    retryable: true, fallbackAllowed: true,
  },
  SCHEMA_VALIDATION_ERROR: {
    title: '模型结果格式不符合要求', userMessage: '模型结果缺少必要字段或字段类型错误，可以重新尝试。',
    retryable: false, fallbackAllowed: true,
  },
  MAPPING_ERROR: {
    title: '知识标签映射失败', userMessage: '题目分析已返回，但无法安全映射到教材知识体系。',
    retryable: false, fallbackAllowed: false,
  },
  PERSISTENCE_ERROR: {
    title: '分析结果保存失败', userMessage: '结果未能保存，请重新尝试。',
    retryable: true, fallbackAllowed: false,
  },
  CANCELLED: {
    title: 'AI 分析已取消', userMessage: '任务已取消，不会自动重试。',
    retryable: false, fallbackAllowed: false,
  },
}

export function createAIError(code: AIErrorCode, context: ErrorContext = {}): AIErrorEnvelope {
  return {
    code,
    ...definitions[code],
    providerId: context.providerId ?? null,
    model: context.model ?? null,
    httpStatus: context.httpStatus ?? null,
    runId: context.runId ?? null,
    attemptId: context.attemptId ?? null,
    detailSafe: context.detailSafe?.slice(0, 1200) ?? null,
    occurredAt: context.occurredAt ?? Date.now(),
  }
}

export function isAIErrorEnvelope(value: unknown): value is AIErrorEnvelope {
  if (!value || typeof value !== 'object') return false
  const error = value as Partial<AIErrorEnvelope>
  return AI_ERROR_CODES.includes(error.code as AIErrorCode) &&
    typeof error.title === 'string' && typeof error.userMessage === 'string' &&
    typeof error.retryable === 'boolean' && typeof error.fallbackAllowed === 'boolean'
}

export function classifyAIError(error: unknown, context: ErrorContext = {}): AIErrorEnvelope {
  if (isAIErrorEnvelope(error)) return { ...error, ...context }
  if (error instanceof AIExecutionError) return { ...error.envelope, ...context }
  // Provider adapters deliberately wrap the safe native envelope together
  // with raw output and repair metadata.  Preserve that envelope instead of
  // reclassifying the wrapper's user-facing message as a generic provider
  // failure.  Keep this structural to avoid a domain -> provider import cycle.
  if (error && typeof error === 'object' && 'error' in error) {
    const carried = (error as { error?: unknown }).error
    if (isAIErrorEnvelope(carried)) return { ...carried, ...context }
  }
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLocaleLowerCase('en-US')
  let code: AIErrorCode = 'PROVIDER_ERROR'
  if (/\b(401|403)\b|unauthori[sz]ed|forbidden|api key|credential|鉴权|认证/u.test(lower)) code = 'AUTHENTICATION_ERROR'
  else if (/\b429\b|rate.?limit|too many requests|限流/u.test(lower)) code = 'RATE_LIMIT_ERROR'
  else if (/timeout|timed out|超时/u.test(lower)) code = 'TIMEOUT_ERROR'
  else if (/network|dns|connect|connection|socket|网络/u.test(lower)) code = 'NETWORK_ERROR'
  else if (/不支持图片|does not support image|text-only|vision/u.test(lower)) code = 'MODEL_CAPABILITY_ERROR'
  else if (/schema|不符合 schema|字段类型/u.test(lower)) code = 'SCHEMA_VALIDATION_ERROR'
  else if (/json|无法解析模型|没有 json|malformed/u.test(lower)) code = 'MODEL_OUTPUT_ERROR'
  else if (/mapping|映射|canonical tag|知识标签/u.test(lower)) code = 'MAPPING_ERROR'
  else if (/sqlite|database|transaction|数据库|写入|保存/u.test(lower)) code = 'PERSISTENCE_ERROR'
  else if (/cancelled|canceled|已取消/u.test(lower)) code = 'CANCELLED'
  else if (/invalid|不能为空|最多支持|请求配置|输入无效/u.test(lower)) code = 'REQUEST_INVALID'
  const inferredHttpStatus = Number(message.match(/\b([45]\d\d)\b/u)?.[1] ?? 0) || null
  const httpStatus = context.httpStatus ?? inferredHttpStatus
  return createAIError(code, { ...context, httpStatus, detailSafe: context.detailSafe ?? message })
}

export class AIExecutionError extends Error {
  readonly envelope: AIErrorEnvelope

  constructor(envelope: AIErrorEnvelope) {
    super(envelope.userMessage)
    this.name = 'AIExecutionError'
    this.envelope = envelope
  }
}

export function publicAIErrorMessage(error: AIErrorEnvelope) {
  return `${error.title}：${error.userMessage}`
}
