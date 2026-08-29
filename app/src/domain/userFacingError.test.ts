import { describe, expect, it } from 'vitest'
import { userFacingError } from './userFacingError'

describe('userFacingError', () => {
  it('maps recoverable system failures to actionable product copy', () => {
    expect(userFacingError(new Error('SQLITE_BUSY: database is locked'), 'fallback'))
      .toContain('本地数据正忙')
    expect(userFacingError(new Error('No space left on device'), 'fallback'))
      .toContain('存储空间不足')
    expect(userFacingError(new Error('Network request timed out'), 'fallback'))
      .toContain('检查网络')
    expect(userFacingError(new Error('Permission denied'), 'fallback'))
      .toContain('系统设置')
  })

  it('uses operation-specific copy without exposing an unknown raw error', () => {
    const raw = 'sqlite error 2067 at /private/var/database.sqlite'
    const fallback = '修改没有保存，当前输入已保留。请重试。'
    const message = userFacingError(new Error(raw), fallback)
    expect(message).toBe(fallback)
    expect(message).not.toContain(raw)
  })
})
