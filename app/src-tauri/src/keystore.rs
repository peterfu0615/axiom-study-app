//! macOS Keychain storage for AI provider credentials.
//!
//! The database stores only `credential_ref`. Actual API keys are read by Rust
//! immediately before a provider request and never cross the frontend IPC bridge.

use keyring::Entry;
use sqlx::Row;
use tauri::{AppHandle, Manager};

const SERVICE: &str = "com.axiom.study";

fn entry_name(provider_id: &str) -> String {
    format!("ai-provider:{provider_id}")
}

#[tauri::command(rename_all = "camelCase")]
pub fn store_api_key(provider_id: String, api_key: String) -> Result<String, String> {
    let provider_id = provider_id.trim();
    let api_key = api_key.trim();
    if provider_id.is_empty() || api_key.is_empty() {
        return Err("Provider ID 和 API Key 不能为空".to_string());
    }
    let entry = Entry::new(SERVICE, &entry_name(provider_id))
        .map_err(|error| format!("Keychain 创建失败：{error}"))?;
    entry
        .set_password(api_key)
        .map_err(|error| format!("Keychain 写入失败：{error}"))?;
    let stored = entry
        .get_password()
        .map_err(|error| format!("Keychain 写入后校验失败：{error}"))?;
    if stored != api_key {
        return Err("Keychain 写入后校验失败：保存内容不一致".to_string());
    }
    Ok(provider_id.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub fn has_api_key(credential_ref: String) -> Result<bool, String> {
    let credential_ref = credential_ref.trim();
    if credential_ref.is_empty() {
        return Ok(false);
    }
    let entry = Entry::new(SERVICE, &entry_name(credential_ref))
        .map_err(|error| format!("Keychain 状态检查失败：{error}"))?;
    match entry.get_password() {
        Ok(password) => Ok(!password.trim().is_empty()),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(error) => Err(format!("Keychain 状态检查失败：{error}")),
    }
}

pub fn load_api_key_internal(credential_ref: &str) -> Result<String, String> {
    Entry::new(SERVICE, &entry_name(credential_ref.trim()))
        .map_err(|error| format!("Keychain 读取失败：{error}"))?
        .get_password()
        .map_err(|error| match error {
            keyring::Error::NoEntry => "Keychain 中未找到 API Key，请重新保存".to_string(),
            other => format!("Keychain 读取失败：{other}"),
        })
}

#[tauri::command(rename_all = "camelCase")]
pub fn delete_api_key(credential_ref: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE, &entry_name(credential_ref.trim()))
        .map_err(|error| format!("Keychain 删除失败：{error}"))?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("Keychain 删除失败：{error}")),
    }
}

/// One-way migration from historical plaintext rows into Keychain.
pub async fn migrate_api_keys_to_keychain(app: &AppHandle) -> Result<(), String> {
    let db_state = app
        .try_state::<crate::db::DbState>()
        .ok_or_else(|| "数据库状态未初始化".to_string())?;
    let mut guard = db_state.connection.lock().await;
    let conn = guard
        .as_mut()
        .ok_or_else(|| "数据库连接尚未初始化".to_string())?;
    let rows = sqlx::query("SELECT id, api_key FROM ai_provider_profiles WHERE api_key != ''")
        .fetch_all(&mut *conn)
        .await
        .map_err(|error| format!("查询待迁移 API Key 失败：{error}"))?;
    for row in rows {
        let id: String = row
            .try_get("id")
            .map_err(|error| format!("读取 Provider ID 失败：{error}"))?;
        let api_key: String = row
            .try_get("api_key")
            .map_err(|error| format!("读取 API Key 失败：{error}"))?;
        if api_key.is_empty() {
            continue;
        }
        Entry::new(SERVICE, &entry_name(&id))
            .map_err(|error| format!("Keychain 创建失败（Provider {id}）：{error}"))?
            .set_password(&api_key)
            .map_err(|error| format!("Keychain 写入失败（Provider {id}）：{error}"))?;
        sqlx::query(
            "UPDATE ai_provider_profiles \
             SET credential_ref = $1, api_key = '' WHERE id = $1",
        )
        .bind(&id)
        .execute(&mut *conn)
        .await
        .map_err(|error| format!("清除数据库明文 API Key 失败（Provider {id}）：{error}"))?;
        log::info!("API Key 已安全迁移到 Keychain：Provider {id}");
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
