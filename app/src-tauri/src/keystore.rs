//! API Key 存储迁移模块。
//!
//! 历史上 Axiom 曾使用 macOS Keychain 存储 API Key（v0.1.1）。
//! 现改为数据库明文存储（单机自用场景，简化使用）。
//!
//! 启动时执行反向迁移：扫描数据库中所有 credential_ref 非空但 api_key 为空的 provider，
//! 尝试从 Keychain 读取并写回数据库 api_key 列。

use keyring::Entry;
use sqlx::Row;
use tauri::{AppHandle, Manager};

/// Keychain 服务名，与 bundle identifier 一致。
const SERVICE: &str = "com.axiom.study";

/// 构造 Keychain 条目名：`ai-provider:{provider_id}`。
fn entry_name(provider_id: &str) -> String {
    format!("ai-provider:{provider_id}")
}

/// 反向迁移：把 Keychain 中的 API Key 迁回数据库明文存储。
///
/// 扫描所有 credential_ref 非空但 api_key 为空的 provider，
/// 从 Keychain 读取 key 写回数据库，并清理 Keychain 条目。
///
/// 失败不阻塞启动（调用方 catch 并 log::warn）。
pub async fn migrate_keychain_to_db(app: &AppHandle) -> Result<(), String> {
    let db_state = app
        .try_state::<crate::db::DbState>()
        .ok_or_else(|| "数据库状态未初始化".to_string())?;
    let mut guard = db_state.connection.lock().await;
    let conn = guard
        .as_mut()
        .ok_or_else(|| "数据库连接尚未初始化".to_string())?;

    // 查询所有 credential_ref 非空但 api_key 为空的 provider（旧版数据）
    let rows = sqlx::query(
        "SELECT id, credential_ref FROM ai_provider_profiles \
         WHERE credential_ref != '' AND (api_key IS NULL OR api_key = '')",
    )
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| format!("查询待迁移 Provider 失败：{e}"))?;

    if rows.is_empty() {
        return Ok(());
    }

    for row in rows {
        let id: String = row
            .try_get("id")
            .map_err(|e| format!("读取 provider id 失败：{e}"))?;
        let credential_ref: String = row
            .try_get("credential_ref")
            .map_err(|e| format!("读取 credential_ref 失败：{e}"))?;

        // 从 Keychain 读取
        let entry = Entry::new(SERVICE, &entry_name(&credential_ref));
        let api_key = match entry {
            Ok(entry) => match entry.get_password() {
                Ok(key) => key,
                Err(keyring::Error::NoEntry) => {
                    log::info!("Keychain 中未找到 provider {id} 的 key，跳过");
                    continue;
                }
                Err(e) => {
                    log::warn!("读取 Keychain 失败（provider {id}）：{e}");
                    continue;
                }
            },
            Err(e) => {
                log::warn!("创建 Keychain entry 失败（provider {id}）：{e}");
                continue;
            }
        };

        if api_key.is_empty() {
            continue;
        }

        // 写回数据库
        sqlx::query("UPDATE ai_provider_profiles SET api_key = $1 WHERE id = $2")
            .bind(&api_key)
            .bind(&id)
            .execute(&mut *conn)
            .await
            .map_err(|e| format!("更新 api_key 失败（provider {id}）：{e}"))?;

        // 清理 Keychain 条目（迁移完成后删除）
        if let Ok(entry) = Entry::new(SERVICE, &entry_name(&credential_ref)) {
            let _ = entry.delete_credential();
        }

        log::info!("API Key 已从 Keychain 迁回数据库：provider {id}");
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{entry_name, SERVICE};

    #[test]
    fn entry_name_includes_provider_id() {
        assert_eq!(entry_name("abc-123"), "ai-provider:abc-123");
    }

    #[test]
    fn service_matches_bundle_identifier() {
        assert_eq!(SERVICE, "com.axiom.study");
    }
}
