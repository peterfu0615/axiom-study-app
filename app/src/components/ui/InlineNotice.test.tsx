import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { InlineNotice } from './index'

describe('InlineNotice feedback routing', () => {
  it('renders success as a status and never gives it the danger class', () => {
    const html = renderToStaticMarkup(<InlineNotice feedback={{ tone: 'success', message: '批准完成：已处理 5 项。' }} />)
    expect(html).toContain('role="status"')
    expect(html).toContain('ax-inline-notice--success')
    expect(html).not.toContain('ax-inline-notice--danger')
  })

  it('renders danger as an alert while retaining a separate tone token', () => {
    const html = renderToStaticMarkup(<InlineNotice feedback={{ tone: 'danger', message: '保存失败' }} />)
    expect(html).toContain('role="alert"')
    expect(html).toContain('ax-inline-notice--danger')
    expect(html).not.toContain('ax-inline-notice--success')
  })
})
