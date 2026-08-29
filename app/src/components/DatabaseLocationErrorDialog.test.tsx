import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DatabaseLocationErrorDialog } from './DatabaseLocationErrorDialog'
import type { DatabasePathCheck } from '../platform/database'

describe('DatabaseLocationErrorDialog', () => {
  it('blocks the workspace and offers a non-destructive repair when paths differ', () => {
    const check: DatabasePathCheck = {
      ok: false,
      pluginPath: '/Users/test/Library/Containers/com.axiom.study/Data/axiom.db',
      rustPath: '/Users/test/Library/Application Support/com.axiom.study/axiom.db',
      error: '数据库路径不一致',
    }
    const html = renderToStaticMarkup(
      <DatabaseLocationErrorDialog check={check} />,
    )
    expect(html).toContain('role="alertdialog"')
    expect(html).toContain('需要修复本地数据连接')
    expect(html).toContain(check.pluginPath!)
    expect(html).toContain(check.rustPath!)
    expect(html).toContain('复制数据到正确位置')
    expect(html).toContain('安全退出')
  })

  it('does not expose a raw startup error when automatic repair is unavailable', () => {
    const check: DatabasePathCheck = {
      ok: false,
      error: '无法获取 Rust 端数据库路径',
    }
    const html = renderToStaticMarkup(
      <DatabaseLocationErrorDialog check={check} />,
    )
    expect(html).not.toContain(check.error!)
    expect(html).toContain('Axiom 无法自动定位数据文件')
    expect(html).toContain('当前数据不会被修改')
    expect(html).toContain('disabled=""')
  })

  it('explains the safe recovery sequence and preservation guarantee', () => {
    const check: DatabasePathCheck = {
      ok: false,
      pluginPath: '/a.db',
      rustPath: '/b.db',
    }
    const html = renderToStaticMarkup(
      <DatabaseLocationErrorDialog check={check} />,
    )
    expect(html).toContain('不会删除原文件、错题或复习记录')
    expect(html).toContain('退出并重新打开 Axiom')
    expect(html).toContain('确认错题库与今日复习内容正常显示')
    expect(html).not.toContain('migration')
  })
})
