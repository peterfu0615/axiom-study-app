import { useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { DatabasePathCheck } from '../platform/database'
import { migrateDatabase } from '../platform/native'
import { Button, Dialog, DialogFooter, InlineNotice } from './ui'
import './DatabaseLocationErrorDialog.css'

interface DatabaseLocationErrorDialogProps {
  check: DatabasePathCheck
}

/**
 * Blocks startup when the two database clients resolve different files. The
 * recovery copies data and never deletes the source, so it is offered directly
 * instead of adding another confirmation step.
 */
export function DatabaseLocationErrorDialog({ check }: DatabaseLocationErrorDialogProps) {
  const [migrating, setMigrating] = useState(false)
  const [migrateResult, setMigrateResult] = useState<'success' | 'failure' | null>(null)
  const canRepair = Boolean(check.pluginPath && check.rustPath)

  const handleMigrate = async () => {
    if (!check.pluginPath || !check.rustPath) return
    setMigrating(true)
    setMigrateResult(null)
    try {
      await migrateDatabase(check.pluginPath, check.rustPath)
      setMigrateResult('success')
    } catch (error) {
      console.error('修复本地数据连接失败', error)
      setMigrateResult('failure')
    } finally {
      setMigrating(false)
    }
  }

  const handleExit = async () => {
    await getCurrentWindow().destroy()
  }

  return (
    <Dialog
      dismissible={false}
      onClose={() => undefined}
      open
      role="alertdialog"
      title="需要修复本地数据连接"
    >
      <div className="database-recovery">
        <p>
          Axiom 检测到两个本地数据位置。为避免把新内容写入错误位置，应用已暂停进入工作区。
        </p>
        <InlineNotice
          feedback={{
            tone: 'warning',
            message: '自动修复只会把现有数据复制到正确位置，不会删除原文件、错题或复习记录。',
          }}
        />

        <ol className="database-recovery__steps">
          <li>复制现有数据到 Axiom 当前使用的位置。</li>
          <li>退出并重新打开 Axiom。</li>
          <li>确认错题库与今日复习内容正常显示。</li>
        </ol>

        {!canRepair && (
          <InlineNotice
            feedback={{
              tone: 'danger',
              message: 'Axiom 无法自动定位数据文件。请先安全退出，再联系支持人员处理；当前数据不会被修改。',
            }}
          />
        )}
        {migrateResult === 'success' && (
          <InlineNotice
            feedback={{
              tone: 'success',
              message: '数据已复制，原文件仍然保留。请退出 Axiom，然后重新打开应用。',
            }}
          />
        )}
        {migrateResult === 'failure' && (
          <InlineNotice
            feedback={{
              tone: 'danger',
              message: '数据没有复制，原文件未被修改。你可以重试；如果仍然失败，请安全退出并联系支持人员。',
            }}
          />
        )}

        <details className="database-recovery__details">
          <summary>查看技术信息</summary>
          <dl>
            <div><dt>检测到的位置</dt><dd>{check.pluginPath || '无法确定'}</dd></div>
            <div><dt>Axiom 需要的位置</dt><dd>{check.rustPath || '无法确定'}</dd></div>
          </dl>
        </details>

        <DialogFooter>
          {migrateResult === 'success' ? (
            <Button onClick={() => void handleExit()} variant="primary">退出 Axiom</Button>
          ) : (
            <>
              <Button disabled={migrating} onClick={() => void handleExit()} variant="secondary">安全退出</Button>
              <Button
                disabled={!canRepair}
                loading={migrating}
                onClick={() => void handleMigrate()}
                variant="primary"
              >
                复制数据到正确位置
              </Button>
            </>
          )}
        </DialogFooter>
      </div>
    </Dialog>
  )
}
