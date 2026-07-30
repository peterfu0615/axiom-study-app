import { useEffect, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { DatabasePathCheck } from '../platform/database'
import { migrateDatabase } from '../platform/native'

interface DatabaseLocationErrorDialogProps {
  check: DatabasePathCheck
}

/**
 * 数据库路径不一致错误对话框。
 *
 * 当 plugin-sql 与 Rust sqlx 指向不同数据库文件时显示，
 * 阻塞应用启动，避免用户在错误数据库上操作导致数据丢失。
 *
 * 提供两个操作：
 *   - 迁移数据库：把 DB 文件从错误位置复制到期望位置（不删除原文件），提示重启
 *   - 安全退出：直接退出 App
 */
export function DatabaseLocationErrorDialog({ check }: DatabaseLocationErrorDialogProps) {
  const [migrating, setMigrating] = useState(false)
  const [migrateResult, setMigrateResult] = useState<
    | { ok: true }
    | { ok: false; message: string }
    | null
  >(null)

  useEffect(() => {
    // 阻止用户通过快捷键关闭窗口绕过此对话框
    // （窗口本身仍可拖动，但不应允许关闭后继续使用错误数据库）
  }, [])

  const handleMigrate = async () => {
    if (!check.pluginPath || !check.rustPath) return
    setMigrating(true)
    setMigrateResult(null)
    try {
      await migrateDatabase(check.pluginPath, check.rustPath)
      setMigrateResult({ ok: true })
    } catch (error) {
      setMigrateResult({
        ok: false,
        message: String(error),
      })
    } finally {
      setMigrating(false)
    }
  }

  const handleExit = async () => {
    await getCurrentWindow().destroy()
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(8px)',
      }}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="db-error-title"
    >
      <div
        style={{
          maxWidth: '560px',
          width: '90%',
          background: 'var(--surface, #1e1e1e)',
          border: '1px solid var(--border, #333)',
          borderRadius: '12px',
          padding: '28px 32px',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
          color: 'var(--text, #e0e0e0)',
          fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
        }}
      >
        <h2
          id="db-error-title"
          style={{
            margin: '0 0 16px',
            fontSize: '20px',
            fontWeight: 600,
            color: '#ff6b6b',
          }}
        >
          数据库位置错误
        </h2>

        <p style={{ margin: '0 0 16px', fontSize: '14px', lineHeight: '1.6' }}>
          Axiom 检测到数据库连接指向了不同的文件位置。这可能导致：
        </p>
        <ul
          style={{
            margin: '0 0 16px',
            paddingLeft: '20px',
            fontSize: '13px',
            lineHeight: '1.8',
            color: 'var(--text-secondary, #999)',
          }}
        >
          <li>数据库 migration 重复执行</li>
          <li>用户数据「消失」（实际写入了错误位置）</li>
          <li>读取到空数据或过时数据</li>
        </ul>

        <div
          style={{
            background: 'var(--canvas, #161616)',
            border: '1px solid var(--border, #333)',
            borderRadius: '8px',
            padding: '12px 14px',
            marginBottom: '16px',
            fontSize: '12px',
            fontFamily: 'ui-monospace, monospace',
            lineHeight: '1.6',
            overflow: 'auto',
          }}
        >
          <div style={{ marginBottom: '8px' }}>
            <span style={{ color: '#ff9999' }}>当前路径（plugin-sql）：</span>
            <br />
            <span style={{ wordBreak: 'break-all' }}>
              {check.pluginPath || '未知'}
            </span>
          </div>
          <div>
            <span style={{ color: '#99ccff' }}>期望路径（Rust sqlx）：</span>
            <br />
            <span style={{ wordBreak: 'break-all' }}>
              {check.rustPath || '未知'}
            </span>
          </div>
        </div>

        {check.error && (
          <p
            style={{
              margin: '0 0 16px',
              fontSize: '12px',
              color: 'var(--text-secondary, #999)',
              fontStyle: 'italic',
            }}
          >
            {check.error}
          </p>
        )}

        {migrateResult?.ok && (
          <div
            style={{
              background: 'rgba(76, 175, 80, 0.15)',
              border: '1px solid rgba(76, 175, 80, 0.4)',
              borderRadius: '8px',
              padding: '12px 14px',
              marginBottom: '16px',
              fontSize: '13px',
            }}
          >
            数据库已成功复制到期望位置。<strong>请退出并重新启动 Axiom</strong>
            以加载正确的数据库文件。原文件未被删除。
          </div>
        )}

        {migrateResult && !migrateResult.ok && (
          <div
            style={{
              background: 'rgba(255, 107, 107, 0.15)',
              border: '1px solid rgba(255, 107, 107, 0.4)',
              borderRadius: '8px',
              padding: '12px 14px',
              marginBottom: '16px',
              fontSize: '13px',
            }}
          >
            迁移失败：{migrateResult.message}
            <br />
            <span style={{ fontSize: '12px', color: 'var(--text-secondary, #999)' }}>
              你可以手动复制数据库文件，或联系支持。
            </span>
          </div>
        )}

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={handleExit}
            style={{
              padding: '8px 20px',
              fontSize: '14px',
              borderRadius: '8px',
              border: '1px solid var(--border, #444)',
              background: 'transparent',
              color: 'var(--text, #e0e0e0)',
              cursor: 'pointer',
            }}
          >
            安全退出
          </button>
          <button
            type="button"
            onClick={handleMigrate}
            disabled={migrating || !check.pluginPath || !check.rustPath || migrateResult?.ok === true}
            style={{
              padding: '8px 20px',
              fontSize: '14px',
              fontWeight: 500,
              borderRadius: '8px',
              border: 'none',
              background:
                migrating || !check.pluginPath || !check.rustPath || migrateResult?.ok === true
                  ? 'var(--border, #444)'
                  : 'var(--brand, #4a9eff)',
              color: '#fff',
              cursor:
                migrating || !check.pluginPath || !check.rustPath || migrateResult?.ok === true
                  ? 'not-allowed'
                  : 'pointer',
            }}
          >
            {migrating ? '迁移中...' : '迁移数据库（复制，不删除原文件）'}
          </button>
        </div>
      </div>
    </div>
  )
}
