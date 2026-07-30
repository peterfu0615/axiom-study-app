use keyring::Entry;
use sqlx::Row;
use tauri::{AppHandle, Manager};

/// Keychain 服务名，与 bundle identifier 一致。
const SERVICE: &str = "com.axiom.study";

/// 构造 Keychain 条目名：`ai-provider:{provider_id}`。
fn entry_name(provider_id: &str) -> String {
    format!("ai-provider:{provider_id}")
}

/// 将 API Key 存入 macOS Keychain，返回 credential_ref（即 provider_id）。
///
/// Keychain 是平台级安全存储：App Sandbox 下只有 Axiom 可读取，
/// 数据库不再保存明文 key，降低泄露面。
#[tauri::command]
pub fn store_api_key(provider_id: String, api_key: String) -> Result<String, String> {
    let entry = Entry::new(SERVICE, &entry_name(&provider_id))
        .map_err(|e| format!("Keychain 创建失败：{e}"))?;
    entry
        .set_password(&api_key)
        .map_err(|e| format!("Keychain 写入失败：{e}"))?;
    Ok(provider_id)
}

/// 从 Keychain 读取 API Key。
///
/// 由 Rust AI 命令内部调用，实际 key 不经 IPC 回传前端。
#[tauri::command]
pub fn load_api_key(credential_ref: String) -> Result<String, String> {
    load_api_key_internal(&credential_ref)
}

/// 内部函数：从 Keychain 读取 API Key（非 Tauri 命令版本，供 Rust 内部调用）。
pub fn load_api_key_internal(credential_ref: &str) -> Result<String, String> {
    let entry = Entry::new(SERVICE, &entry_name(credential_ref))
        .map_err(|e| format!("Keychain 读取失败：{e}"))?;
    entry
        .get_password()
        .map_err(|e| format!("Keychain 读取失败：{e}"))
}

/// 从 Keychain 删除 API Key。
/// 条目不存在时视为成功（幂等删除）。
#[tauri::command]
pub fn delete_api_key(credential_ref: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE, &entry_name(&credential_ref))
        .map_err(|e| format!("Keychain 删除失败：{e}"))?;
    match entry.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Keychain 删除失败：{e}")),
    }
}

/// 启动时迁移：扫描数据库中所有有明文 api_key 的 provider，
/// 将 key 存入 Keychain，然后清空数据库中的 api_key 列并写入 credential_ref。
///
/// 失败不阻塞启动（调用方 catch 并 log::warn）。
pub async fn migrate_api_keys_to_keychain(app: &AppHandle) -> Result<(), String> {
    let db_state = app
        .try_state::<crate::db::DbState>()
        .ok_or_else(|| "数据库状态未初始化".to_string())?;
    let mut guard = db_state.connection.lock().await;
    let conn = guard
        .as_mut()
        .ok_or_else(|| "数据库连接尚未初始化".to_string())?;

    // 查询所有有明文 api_key 的 provider
    let rows = sqlx::query("SELECT id, api_key FROM ai_provider_profiles WHERE api_key != ''")
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| format!("查询待迁移 API Key 失败：{e}"))?;

    for row in rows {
        let id: String = row
            .try_get("id")
            .map_err(|e| format!("读取 provider id 失败：{e}"))?;
        let api_key: String = row
            .try_get("api_key")
            .map_err(|e| format!("读取 api_key 失败：{e}"))?;

        if api_key.is_empty() {
            continue;
        }

        // 存入 Keychain
        let entry = Entry::new(SERVICE, &entry_name(&id))
            .map_err(|e| format!("Keychain 创建失败（provider {id}）：{e}"))?;
        entry
            .set_password(&api_key)
            .map_err(|e| format!("Keychain 写入失败（provider {id}）：{e}"))?;

        // 清空数据库明文，写入 credential_ref
        sqlx::query("UPDATE ai_provider_profiles SET credential_ref = $1, api_key = '' WHERE id = $2")
            .bind(&id)
            .bind(&id)
            .execute(&mut *conn)
            .await
            .map_err(|e| format!("更新 credential_ref 失败（provider {id}）：{e}"))?;

        log::info!("API Key 已迁移到 Keychain：provider {id}");
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
