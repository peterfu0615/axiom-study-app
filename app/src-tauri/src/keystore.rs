//! Legacy macOS Keychain support for AI provider credentials.
//!
//! SQLite `ai_provider_profiles.api_key` is the durable local source of truth.
//! Keychain is retained only for a one-time recovery of values written by older
//! releases; it is not required to save or use an API key any more.

use keyring::Entry;
use sqlx::Row;
use tauri::{AppHandle, Manager};

const SERVICE: &str = "com.axiom.study";

fn entry_name(provider_id: &str) -> String {
    format!("ai-provider:{provider_id}")
}

fn recovery_timestamp() -> Result<i64, String> {
    use std::time::{SystemTime, UNIX_EPOCH};
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("系统时间不可用：{error}"))?;
    i64::try_from(duration.as_millis()).map_err(|_| "系统时间超出范围".to_string())
}

async fn apply_api_key_recovery_result(
    conn: &mut sqlx::SqliteConnection,
    provider_id: &str,
    recovered_api_key: Option<String>,
    attempted_at: i64,
) -> Result<bool, String> {
    let recovered = recovered_api_key
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let recovered_at = if let Some(api_key) = recovered {
        sqlx::query(
            "UPDATE ai_provider_profiles SET api_key = $1
             WHERE id = $2 AND trim(api_key) = ''",
        )
        .bind(api_key)
        .bind(provider_id)
        .execute(&mut *conn)
        .await
        .map_err(|error| format!("回迁 API Key 失败（Provider {provider_id}）：{error}"))?;
        Some(attempted_at)
    } else {
        None
    };
    sqlx::query(
        "INSERT INTO ai_provider_api_key_recovery_attempts
         (provider_id, attempted_at, recovered_at, error_code)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT(provider_id) DO NOTHING",
    )
    .bind(provider_id)
    .bind(attempted_at)
    .bind(recovered_at)
    .bind(if recovered_at.is_some() {
        None::<&str>
    } else {
        Some("unavailable")
    })
    .execute(&mut *conn)
    .await
    .map_err(|error| format!("记录 API Key 回迁状态失败（Provider {provider_id}）：{error}"))?;
    Ok(recovered_at.is_some())
}

/// Best-effort, one-time reverse migration for users of releases that moved a
/// database key to Keychain and then cleared `api_key`.  The recovery marker
/// records only a status code, never the credential or a Keychain error body.
pub async fn restore_api_keys_to_sqlite_once(app: &AppHandle) -> Result<(), String> {
    let db_state = app
        .try_state::<crate::db::DbState>()
        .ok_or_else(|| "数据库状态未初始化".to_string())?;
    let mut guard = db_state.connection.lock().await;
    let conn = guard
        .as_mut()
        .ok_or_else(|| "数据库连接尚未初始化".to_string())?;
    let rows = sqlx::query(
        "SELECT profile.id, profile.credential_ref
         FROM ai_provider_profiles AS profile
         WHERE trim(profile.api_key) = '' AND trim(profile.credential_ref) != ''
           AND NOT EXISTS (
             SELECT 1 FROM ai_provider_api_key_recovery_attempts AS recovery
             WHERE recovery.provider_id = profile.id
           )",
    )
    .fetch_all(&mut *conn)
    .await
    .map_err(|error| format!("查询待回迁 API Key 失败：{error}"))?;
    for row in rows {
        let id: String = row
            .try_get("id")
            .map_err(|error| format!("读取 Provider ID 失败：{error}"))?;
        let credential_ref: String = row
            .try_get("credential_ref")
            .map_err(|error| format!("读取 Provider 凭据引用失败：{error}"))?;
        let recovered = Entry::new(SERVICE, &entry_name(credential_ref.trim()))
            .ok()
            .and_then(|entry| entry.get_password().ok())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let attempted_at = recovery_timestamp()?;
        let restored = apply_api_key_recovery_result(conn, &id, recovered, attempted_at).await?;
        if restored {
            log::info!("已从旧 Keychain 回迁 API Key：Provider {id}");
        } else {
            log::warn!("旧 Keychain 中没有可回迁的 API Key：Provider {id}");
        }
    }
    Ok(())
}

/// Invoked only after tauri-plugin-sql has finished applying migrations.  The
/// setup hook runs before that plugin's migration phase, so doing recovery
/// there would race the recovery-marker table on a user's first fixed launch.
#[tauri::command]
pub async fn recover_legacy_api_keys(app: AppHandle) -> Result<(), String> {
    restore_api_keys_to_sqlite_once(&app).await
}

#[cfg(test)]
mod tests {
    use super::{apply_api_key_recovery_result, entry_name, SERVICE};
    use sqlx::{Connection, Executor, Row};

    #[test]
    fn entry_name_includes_provider_id() {
        assert_eq!(entry_name("abc-123"), "ai-provider:abc-123");
    }

    #[test]
    fn service_matches_bundle_identifier() {
        assert_eq!(SERVICE, "com.axiom.study");
    }

    #[test]
    fn recovery_writes_sqlite_key_or_preserves_provider_when_keychain_is_unavailable() {
        tauri::async_runtime::block_on(async {
            let mut conn = sqlx::SqliteConnection::connect(":memory:").await.unwrap();
            conn.execute(
                "CREATE TABLE ai_provider_profiles (
                   id TEXT PRIMARY KEY NOT NULL,
                   api_key TEXT NOT NULL DEFAULT '',
                   credential_ref TEXT NOT NULL DEFAULT ''
                 )",
            )
            .await
            .unwrap();
            conn.execute(
                "CREATE TABLE ai_provider_api_key_recovery_attempts (
                   provider_id TEXT PRIMARY KEY NOT NULL,
                   attempted_at INTEGER NOT NULL,
                   recovered_at INTEGER,
                   error_code TEXT
                 )",
            )
            .await
            .unwrap();
            conn.execute(
                "INSERT INTO ai_provider_profiles (id, api_key, credential_ref)
                 VALUES ('recoverable', '', 'old-ref'), ('unavailable', '', 'missing-ref')",
            )
            .await
            .unwrap();

            assert!(apply_api_key_recovery_result(
                &mut conn,
                "recoverable",
                Some("sk-recovered-key".to_string()),
                123,
            )
            .await
            .unwrap());
            assert!(
                !apply_api_key_recovery_result(&mut conn, "unavailable", None, 124)
                    .await
                    .unwrap()
            );

            let key: String =
                sqlx::query("SELECT api_key FROM ai_provider_profiles WHERE id = 'recoverable'")
                    .fetch_one(&mut conn)
                    .await
                    .unwrap()
                    .try_get("api_key")
                    .unwrap();
            assert_eq!(key, "sk-recovered-key");
            let unavailable = sqlx::query(
                "SELECT api_key, credential_ref FROM ai_provider_profiles WHERE id = 'unavailable'",
            )
            .fetch_one(&mut conn)
            .await
            .unwrap();
            assert_eq!(unavailable.try_get::<String, _>("api_key").unwrap(), "");
            assert_eq!(
                unavailable.try_get::<String, _>("credential_ref").unwrap(),
                "missing-ref"
            );
            let error_code: String = sqlx::query(
                "SELECT error_code FROM ai_provider_api_key_recovery_attempts
                 WHERE provider_id = 'unavailable'",
            )
            .fetch_one(&mut conn)
            .await
            .unwrap()
            .try_get("error_code")
            .unwrap();
            assert_eq!(error_code, "unavailable");
        });
    }
}
