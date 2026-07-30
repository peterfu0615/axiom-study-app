import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DatabaseLocationErrorDialog } from './DatabaseLocationErrorDialog'
import type { DatabasePathCheck } from '../platform/database'

describe('DatabaseLocationErrorDialog', () => {
  it('renders error title and both paths when mismatch detected', () => {
    const check: DatabasePathCheck = {
      ok: false,
      pluginPath: '/Users/test/Library/Containers/com.axiom.study/Data/axiom.db',
      rustPath: '/Users/test/Library/Application Support/com.axiom.study/axiom.db',
      error: '数据库路径不一致',
    }
    const html = renderToStaticMarkup(
      <DatabaseLocationErrorDialog check={check} />,
    )
    expect(html).toContain('数据库位置错误')
    expect(html).toContain(check.pluginPath!)
    expect(html).toContain(check.rustPath!)
    expect(html).toContain('迁移数据库')
    expect(html).toContain('安全退出')
  })

  it('renders error message when present', () => {
    const check: DatabasePathCheck = {
      ok: false,
      error: '无法获取 Rust 端数据库路径',
    }
    const html = renderToStaticMarkup(
      <DatabaseLocationErrorDialog check={check} />,
    )
    expect(html).toContain('无法获取 Rust 端数据库路径')
  })

  it('lists the risk warnings', () => {
    const check: DatabasePathCheck = {
      ok: false,
      pluginPath: '/a.db',
      rustPath: '/b.db',
    }
    const html = renderToStaticMarkup(
      <DatabaseLocationErrorDialog check={check} />,
    )
    expect(html).toContain('数据库 migration 重复执行')
    expect(html).toContain('用户数据「消失」')
    expect(html).toContain('读取到空数据或过时数据')
  })
})
