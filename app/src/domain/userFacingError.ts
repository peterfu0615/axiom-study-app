/**
 * Converts a small set of cross-product failures into actionable, non-technical
 * guidance. Callers still provide an operation-specific fallback and log the
 * original error for diagnostics; renderer copy must never expose raw backend,
 * database, file-system, or provider messages.
 */
export function userFacingError(error: unknown, fallback: string): string {
  const raw = String(error instanceof Error ? error.message : error).toLocaleLowerCase('zh-CN')

  if (/not.?allowed|permission denied|operation not permitted|unauthori[sz]ed|没有权限|权限不足|未授权/u.test(raw)) {
    return '当前操作缺少系统权限。请在 macOS“系统设置”中允许 Axiom 访问后重试。'
  }
  if (/network|offline|dns|socket|connection|timed? ?out|网络|离线|连接失败|连接超时/u.test(raw)) {
    return '网络连接暂时不可用。当前内容已保留，请检查网络后重试。'
  }
  if (/database is locked|database busy|sqlite_busy|资源正忙|数据库已锁定/u.test(raw)) {
    return '本地数据正忙，当前内容已保留。请稍等片刻后重试。'
  }
  if (/disk full|no space left|quota exceeded|存储空间不足|磁盘空间不足/u.test(raw)) {
    return '本机存储空间不足，当前内容已保留。请清理空间后重试。'
  }

  return fallback
}
