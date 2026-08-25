import type { UpdateStage } from '../../platform/native'

export type UpdateErrorPhase = UpdateStage

/** 格式化远端更新资产大小；null/0 表示服务端未提供可靠长度。 */
export function formatSize(bytes: number | null): string {
  if (bytes == null || bytes <= 0) return '大小未知'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

export function updateErrorTitle(phase: UpdateErrorPhase): string {
  if (phase === 'checking') return '检查更新失败'
  if (phase === 'downloading') return '下载更新失败'
  if (phase === 'verifying_signature') return '更新签名验证失败'
  if (phase === 'relaunching') return '重启应用失败'
  return '安装更新失败'
}
