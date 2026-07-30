use serde_json::{json, Value};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteConnection},
    Column, ConnectOptions, Executor, Row, TypeInfo,
};
use std::time::Duration;
use tauri::{async_runtime::Mutex, AppHandle, Manager};

/// 单连接 SQLite 状态。
///
/// tauri-plugin-sql 内部使用多连接池（默认 5），BEGIN/COMMIT 会被路由到不同连接，
/// 导致 "cannot start a transaction within a transaction" 和 "database is locked" 错误。
/// 这里使用单一 sqlx 连接 + Mutex 序列化所有数据操作，从根上消除连接交错问题。
/// tauri-plugin-sql 仅保留用于启动时迁移。
#[derive(Default)]
pub struct DbState {
    pub connection: Mutex<Option<SqliteConnection>>,
}

/// 计算 Rust sqlx 端实际使用的数据库文件绝对路径。
/// 这是「单一来源」：前端通过 `get_database_path` 命令拿到同一路径，
/// 用于校验 tauri-plugin-sql 的 `Database.load('sqlite:axiom.db')` 是否解析到同一文件。
pub fn db_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位应用数据目录：{e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建应用数据目录：{e}"))?;
    Ok(dir.join("axiom.db"))
}

/// 将路径转为字符串，供前端比对。
/// 失败时返回错误字符串，便于前端在日志中定位问题。
#[tauri::command]
pub fn get_database_path(app: AppHandle) -> Result<String, String> {
    let path = db_path(&app)?;
    path.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "数据库路径包含非 UTF-8 字符".to_string())
}

/// 解析符号链接并返回路径的规范形式。
/// 用于校验 plugin-sql 与 Rust sqlx 是否指向同一物理文件，
/// 避免 macOS 容器路径（~/Library/Containers/... 与 /Users/<name>/...）的字符串差异导致误判。
#[tauri::command]
pub fn canonicalize_path(path: String) -> Result<String, String> {
    let canonical =
        std::fs::canonicalize(&path).map_err(|e| format!("无法解析路径 {path}：{e}"))?;
    canonical
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "规范路径包含非 UTF-8 字符".to_string())
}

/// 将数据库文件从 `from` 复制到 `to`，用于修复 plugin-sql 与 Rust sqlx 路径不一致。
///
/// 约束（不自动删除任何数据库）：
///   - 仅复制，不删除源文件；
///   - 若 `to` 已存在则报错，避免覆盖；
///   - 校验 `from` 必须存在且是一个文件。
///
/// 复制成功后由前端提示用户重启 App。
#[tauri::command]
pub fn migrate_database(from: String, to: String) -> Result<(), String> {
    let source = std::path::Path::new(&from);
    if !source.is_file() {
        return Err(format!("源数据库文件不存在：{from}"));
    }
    let target = std::path::Path::new(&to);
    if target.exists() {
        return Err(format!("目标路径已存在文件，为避免覆盖已中止：{to}"));
    }
    // 确保目标目录存在
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("无法创建目标目录 {to}：{e}"))?;
    }
    std::fs::copy(source, target).map_err(|e| format!("复制数据库失败（{from} → {to}）：{e}"))?;
    Ok(())
}

pub async fn init_db(app: &AppHandle) -> Result<(), String> {
    let path = db_path(app)?;
    let options = SqliteConnectOptions::new()
        .filename(&path)
        .create_if_missing(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
        .busy_timeout(Duration::from_secs(10))
        // release 关闭语句日志，避免每条 SQL 序列化开销与日志膨胀；
        // debug 下保留 Trace 便于排查。
        .log_statements(if cfg!(debug_assertions) {
            log::LevelFilter::Trace
        } else {
            log::LevelFilter::Off
        });

    let mut conn = options
        .connect()
        .await
        .map_err(|e| format!("无法打开数据库连接：{e}"))?;

    // 显式再设置一次 PRAGMA，确保 busy_timeout 在连接级别生效
    conn.execute("PRAGMA busy_timeout = 10000")
        .await
        .map_err(|e| format!("设置 busy_timeout 失败：{e}"))?;
    conn.execute("PRAGMA foreign_keys = ON")
        .await
        .map_err(|e| format!("启用外键约束失败：{e}"))?;

    app.manage(DbState {
        connection: Mutex::new(Some(conn)),
    });
    Ok(())
}

fn bind_value<'q>(
    query: sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>>,
    value: Value,
) -> sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>> {
    match value {
        Value::Null => query.bind(None::<String>),
        Value::Bool(b) => query.bind(b),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                query.bind(i)
            } else if let Some(u) = n.as_u64() {
                query.bind(u as i64)
            } else if let Some(f) = n.as_f64() {
                query.bind(f)
            } else {
                query.bind(n.to_string())
            }
        }
        Value::String(s) => query.bind(s),
        // 数组、对象序列化为 JSON 字符串，与 tauri-plugin-sql 行为一致
        other => {
            let s = other.to_string();
            query.bind(s)
        }
    }
}

/// 将 SQLite 列值转换为 serde_json::Value。
/// 不依赖 sqlx 的 json feature，避免与既有实现冲突。
fn column_to_value(row: &sqlx::sqlite::SqliteRow, col: &sqlx::sqlite::SqliteColumn) -> Value {
    let name = col.name();
    let type_name = col.type_info().name();
    match type_name {
        "TEXT" => row
            .try_get::<Option<String>, _>(name)
            .unwrap_or(None)
            .map(Value::String)
            .unwrap_or(Value::Null),
        "INTEGER" => row
            .try_get::<Option<i64>, _>(name)
            .unwrap_or(None)
            .map(Value::from)
            .unwrap_or(Value::Null),
        "REAL" => row
            .try_get::<Option<f64>, _>(name)
            .unwrap_or(None)
            .and_then(|f| serde_json::Number::from_f64(f).map(Value::Number))
            .unwrap_or(Value::Null),
        "BOOLEAN" => row
            .try_get::<Option<bool>, _>(name)
            .unwrap_or(None)
            .map(Value::Bool)
            .unwrap_or(Value::Null),
        "BLOB" => row
            .try_get::<Option<Vec<u8>>, _>(name)
            .unwrap_or(None)
            .map(|b| Value::String(String::from_utf8_lossy(&b).into_owned()))
            .unwrap_or(Value::Null),
        _ => row
            .try_get::<Option<String>, _>(name)
            .unwrap_or(None)
            .map(Value::String)
            .unwrap_or(Value::Null),
    }
}

#[tauri::command]
pub async fn db_execute(
    state: tauri::State<'_, DbState>,
    sql: String,
    params: Vec<Value>,
) -> Result<Value, String> {
    let mut guard = state.connection.lock().await;
    let conn = guard.as_mut().ok_or("数据库连接尚未初始化")?;

    let mut query = sqlx::query(&sql);
    for param in params {
        query = bind_value(query, param);
    }
    let result = query
        .execute(conn)
        .await
        .map_err(|e| format!("数据库执行失败：{e}"))?;

    Ok(json!({
        "rowsAffected": result.rows_affected(),
        "lastInsertId": result.last_insert_rowid(),
    }))
}

#[tauri::command]
pub async fn db_select(
    state: tauri::State<'_, DbState>,
    sql: String,
    params: Vec<Value>,
) -> Result<Vec<Value>, String> {
    let mut guard = state.connection.lock().await;
    let conn = guard.as_mut().ok_or("数据库连接尚未初始化")?;

    let mut query = sqlx::query(&sql);
    for param in params {
        query = bind_value(query, param);
    }
    let rows = query
        .fetch_all(conn)
        .await
        .map_err(|e| format!("数据库查询失败：{e}"))?;

    let mut out: Vec<Value> = Vec::with_capacity(rows.len());
    for row in rows {
        let mut obj = serde_json::Map::new();
        for col in row.columns() {
            let value = column_to_value(&row, col);
            obj.insert(col.name().to_string(), value);
        }
        out.push(Value::Object(obj));
    }
    Ok(out)
}
