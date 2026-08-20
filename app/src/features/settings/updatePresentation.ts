export type UpdateErrorPhase = 'check' | 'install'

/** 格式化远端更新资产大小；null/0 表示服务端未提供可靠长度。 */
export function formatSize(bytes: number | null): string {
  if (bytes == null || bytes <= 0) return '大小未知'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

export function updateErrorTitle(phase: UpdateErrorPhase): string {
  return phase === 'install' ? '安装更新失败' : '检查更新失败'
}
