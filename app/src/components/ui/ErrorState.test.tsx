import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createAIError } from '../../domain/aiError'
import { ErrorState } from './index'

describe('ErrorState', () => {
  it('renders a public explanation, retry action, and safe technical detail', () => {
    const html = renderToStaticMarkup(
      <ErrorState
        error={createAIError('TIMEOUT_ERROR', {
          runId: 'run-1',
          detailSafe: 'host=api.example.test; stage=read',
        })}
        onRetry={() => undefined}
      />,
    )
    expect(html).toContain('AI 分析超时')
    expect(html).toContain('模型服务响应超时')
    expect(html).toContain('重新尝试')
    expect(html).toContain('TIMEOUT_ERROR')
    expect(html).toContain('host=api.example.test')
  })

  it('does not offer retry for terminal authentication errors', () => {
    const html = renderToStaticMarkup(
      <ErrorState error={createAIError('AUTHENTICATION_ERROR')} onRetry={() => undefined} />,
    )
    expect(html).not.toContain('重新尝试')
  })
})
