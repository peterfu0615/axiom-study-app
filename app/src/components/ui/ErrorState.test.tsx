import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createAIError } from '../../domain/aiError'
import { ErrorState } from './index'

describe('ErrorState', () => {
  it('renders a public explanation and retry action without internal diagnostics', () => {
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
    expect(html).not.toContain('TIMEOUT_ERROR')
    expect(html).not.toContain('host=api.example.test')
    expect(html).not.toContain('run-1')
  })

  it('does not offer retry for terminal authentication errors', () => {
    const html = renderToStaticMarkup(
      <ErrorState error={createAIError('AUTHENTICATION_ERROR')} onRetry={() => undefined} />,
    )
    expect(html).not.toContain('重新尝试')
  })
})
