use serde_json::{json, Value};
use sha2::{Digest, Sha384};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteConnection},
    Column, ConnectOptions, Executor, Row, TypeInfo,
};
use std::borrow::Cow;
use std::time::Duration;
use tauri::{async_runtime::Mutex, AppHandle, Manager};
use tauri_plugin_sql::Migration;

/// 单连接 SQLite 状态。
///
/// tauri-plugin-sql 内部使用多连接池（默认 5），BEGIN/COMMIT 会被路由到不同连接，
/// 导致 "cannot start a transaction within a transaction" 和 "database is locked" 错误。
/// 这里使用单一 sqlx 连接 + Mutex 序列化所有数据操作，从根上消除连接交错问题。
/// 迁移同样由本模块的 migrate_embedded_schema 在这条连接上执行；
/// tauri-plugin-sql 不注册任何迁移，仅用于前端数据读写。
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

/// sqlx 的 Migrator（tauri-plugin-sql 内部路径）会把每个 migration 放进外层
/// 事务，但 0024–0026 的历史 migration 为了保证 SQLite 数据修复的原子性，
/// 自身包含 BEGIN IMMEDIATE/COMMIT。SQLite 不允许事务嵌套，因此这些
/// migration 不能直接交给 plugin/sqlx Migrator 执行。
///
/// 这里在 Rust 启动阶段使用同一数据库连接预执行全部 migration，并写入
/// 与 sqlx/tauri-plugin-sql 兼容的 `_sqlx_migrations` 记录与 SHA-384 校验值。
/// 仅在执行时去掉 migration 文本最外层的显式事务；磁盘上的 migration
/// 原文不变，checksum 始终按原文计算。用户库中由 codex/horizon-quality-upgrade
/// 分支应用过的 24–27 记录因此能通过校验。这样既兼容历史文件，又保证
/// schema 变更和安装记录在同一个事务中提交。
pub(crate) async fn migrate_embedded_schema(
    conn: &mut SqliteConnection,
    migrations: &[Migration],
) -> Result<(), String> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS _sqlx_migrations (
            version BIGINT PRIMARY KEY NOT NULL,
            description TEXT NOT NULL,
            installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            success BOOLEAN NOT NULL,
            checksum BLOB NOT NULL,
            execution_time BIGINT NOT NULL
        )",
    )
    .await
    .map_err(|error| format!("创建 migration 记录表失败：{error}"))?;

    let mut known = std::collections::HashMap::with_capacity(migrations.len());
    let mut previous_version = None;
    for migration in migrations {
        if previous_version.is_some_and(|version| migration.version <= version) {
            return Err(format!(
                "migration 版本必须严格递增：{} 排在 {:?} 之后",
                migration.version, previous_version
            ));
        }
        previous_version = Some(migration.version);
        if known.insert(migration.version, migration).is_some() {
            return Err(format!("migration 版本重复：{}", migration.version));
        }
    }

    let applied_rows = sqlx::query(
        "SELECT version, success, checksum
         FROM _sqlx_migrations
         ORDER BY version",
    )
    .fetch_all(&mut *conn)
    .await
    .map_err(|error| format!("读取 migration 记录失败：{error}"))?;

    let mut applied = std::collections::HashSet::with_capacity(applied_rows.len());
    for row in applied_rows {
        let version: i64 = row
            .try_get("version")
            .map_err(|error| format!("读取 migration 版本失败：{error}"))?;
        let success: i64 = row
            .try_get("success")
            .map_err(|error| format!("读取 migration 状态失败：{error}"))?;
        let checksum: Vec<u8> = row
            .try_get("checksum")
            .map_err(|error| format!("读取 migration 校验值失败：{error}"))?;
        let Some(migration) = known.get(&version) else {
            return Err(format!("数据库包含未知 migration：{version}"));
        };
        if success != 1 {
            return Err(format!("数据库包含未完成 migration：{version}"));
        }
        let expected = Sha384::digest(migration.sql.as_bytes());
        if checksum.as_slice() != expected.as_slice() {
            return Err(format!(
                "migration 校验值不匹配：{version} ({})",
                migration.description
            ));
        }
        applied.insert(version);
    }

    for migration in migrations {
        if applied.contains(&migration.version) {
            continue;
        }

        let sql = migration_sql_for_execution(migration)?;
        let started_at = std::time::Instant::now();
        conn.execute("BEGIN IMMEDIATE")
            .await
            .map_err(|error| format!("开始 migration {} 事务失败：{error}", migration.version))?;

        let result = async {
            conn.execute(sql.as_ref())
                .await
                .map_err(|error| format!("执行 migration {} 失败：{error}", migration.version))?;

            let checksum = Sha384::digest(migration.sql.as_bytes());
            sqlx::query(
                "INSERT INTO _sqlx_migrations
                 (version, description, installed_on, success, checksum, execution_time)
                 VALUES ($1, $2, CURRENT_TIMESTAMP, 1, $3, $4)",
            )
            .bind(migration.version)
            .bind(migration.description)
            .bind(checksum.as_slice())
            .bind(started_at.elapsed().as_millis() as i64)
            .execute(&mut *conn)
            .await
            .map_err(|error| format!("登记 migration {} 失败：{error}", migration.version))?;

            Ok::<(), String>(())
        }
        .await;

        match result {
            Ok(()) => {
                conn.execute("COMMIT").await.map_err(|error| {
                    format!("提交 migration {} 事务失败：{error}", migration.version)
                })?;
                applied.insert(migration.version);
            }
            Err(error) => {
                let _ = conn.execute("ROLLBACK").await;
                return Err(error);
            }
        }
    }

    Ok(())
}

/// 只移除 migration 文本最外层的事务边界，不改动其源文本或 checksum。
/// 触发器内部的 BEGIN/END 不在首尾，因此不会被误处理。
fn migration_body_for_execution(sql: &str) -> &str {
    let statement_start = leading_sql_trivia_len(sql);
    let executable = &sql[statement_start..];
    let begin_len = if executable
        .get(.."BEGIN IMMEDIATE;".len())
        .is_some_and(|value| value.eq_ignore_ascii_case("BEGIN IMMEDIATE;"))
    {
        "BEGIN IMMEDIATE;".len()
    } else if executable
        .get(.."BEGIN;".len())
        .is_some_and(|value| value.eq_ignore_ascii_case("BEGIN;"))
    {
        "BEGIN;".len()
    } else {
        return sql;
    };

    let executable_end = trailing_sql_trivia_start(sql);
    let Some(commit_start) = executable_end.checked_sub("COMMIT;".len()) else {
        return sql;
    };
    if !sql[commit_start..executable_end].eq_ignore_ascii_case("COMMIT;") {
        return sql;
    }

    &sql[statement_start + begin_len..commit_start]
}

/// 0024 was already shipped with a valid SQLx checksum, but its correlated
/// scalar subquery orders by columns from the outer `node` alias.  The SQLite
/// library bundled by sqlx rejects that name resolution even though the macOS
/// system SQLite used by the original fixture accepts it.  Never edit the
/// historical file: existing databases must keep its checksum.  Instead,
/// normalize only that known block while executing an unapplied 0024 and
/// record the checksum of the immutable source text.
fn migration_sql_for_execution<'a>(migration: &'a Migration) -> Result<Cow<'a, str>, String> {
    let body = migration_body_for_execution(migration.sql);
    if migration.version != 24 {
        return Ok(Cow::Borrowed(body));
    }

    const LEGACY_LOOKUP: &str = r#"    (
      SELECT chapter.id
      FROM knowledge_nodes chapter
      WHERE chapter.textbook_id = node.textbook_id
        AND chapter.node_type = 'chapter'
        AND chapter.archived_at IS NULL
        AND (
          lower(node.path) LIKE lower(chapter.path) || '/%'
          OR (
            node.source_page_start IS NOT NULL
            AND chapter.source_page_start IS NOT NULL
            AND node.source_page_start >= chapter.source_page_start
            AND node.source_page_start <= COALESCE(chapter.source_page_end, 2147483647)
          )
        )
      ORDER BY CASE WHEN lower(node.path) LIKE lower(chapter.path) || '/%' THEN 0 ELSE 1 END,
        abs(COALESCE(node.source_page_start, chapter.source_page_start) - COALESCE(chapter.source_page_start, node.source_page_start))
      LIMIT 1
    ),"#;
    const COMPATIBLE_LOOKUP: &str = r#"    (
      SELECT chapter.id
      FROM knowledge_nodes chapter
      WHERE chapter.textbook_id = node.textbook_id
        AND chapter.node_type = 'chapter'
        AND chapter.archived_at IS NULL
        AND lower(node.path) LIKE lower(chapter.path) || '/%'
      ORDER BY length(chapter.path) DESC, chapter.sort_order, chapter.id
      LIMIT 1
    ),
    (
      SELECT chapter.id
      FROM knowledge_nodes chapter
      WHERE chapter.textbook_id = node.textbook_id
        AND chapter.node_type = 'chapter'
        AND chapter.archived_at IS NULL
        AND node.source_page_start IS NOT NULL
        AND chapter.source_page_start IS NOT NULL
        AND node.source_page_start >= chapter.source_page_start
        AND node.source_page_start <= COALESCE(chapter.source_page_end, 2147483647)
      ORDER BY chapter.source_page_start DESC, chapter.sort_order, chapter.id
      LIMIT 1
    ),"#;

    if body.matches(LEGACY_LOOKUP).count() != 1 {
        return Err("migration 24 的兼容修复目标与已知源文件不一致".to_string());
    }
    Ok(Cow::Owned(body.replacen(
        LEGACY_LOOKUP,
        COMPATIBLE_LOOKUP,
        1,
    )))
}

fn leading_sql_trivia_len(sql: &str) -> usize {
    let bytes = sql.as_bytes();
    let mut offset = 0;
    loop {
        while offset < bytes.len() && bytes[offset].is_ascii_whitespace() {
            offset += 1;
        }
        if sql[offset..].starts_with("--") {
            offset = sql[offset..]
                .find('\n')
                .map_or(bytes.len(), |newline| offset + newline + 1);
            continue;
        }
        if sql[offset..].starts_with("/*") {
            let Some(end) = sql[offset + 2..].find("*/") else {
                return offset;
            };
            offset += end + 4;
            continue;
        }
        return offset;
    }
}

fn trailing_sql_trivia_start(sql: &str) -> usize {
    let mut end = sql.len();
    loop {
        while end > 0 && sql.as_bytes()[end - 1].is_ascii_whitespace() {
            end -= 1;
        }
        if sql[..end].ends_with("*/") {
            let Some(start) = sql[..end - 2].rfind("/*") else {
                return end;
            };
            end = start;
            continue;
        }
        let line_start = sql[..end].rfind('\n').map_or(0, |newline| newline + 1);
        if sql[line_start..end].trim_start().starts_with("--") {
            end = line_start;
            continue;
        }
        return end;
    }
}

pub async fn init_db(app: &AppHandle, migrations: Vec<Migration>) -> Result<(), String> {
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

    // 启动期在 Rust 侧预执行全部迁移（含 checksum 校验），前端
    // Database.load 时 tauri-plugin-sql 不再自行跑迁移。
    migrate_embedded_schema(&mut conn, &migrations).await?;

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
        // SQLite reports the type of some computed expressions as `NULL`
        // even when the value is an integer (for example a CAST/CASE alias).
        // Try the scalar representations in a deterministic order instead of
        // silently turning the value into JSON null.
        _ => {
            if let Ok(Some(value)) = row.try_get::<Option<i64>, _>(name) {
                Value::from(value)
            } else if let Ok(Some(value)) = row.try_get::<Option<f64>, _>(name) {
                serde_json::Number::from_f64(value)
                    .map(Value::Number)
                    .unwrap_or(Value::Null)
            } else if let Ok(Some(value)) = row.try_get::<Option<String>, _>(name) {
                Value::String(value)
            } else {
                Value::Null
            }
        }
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

#[cfg(test)]
mod tests {
    use super::column_to_value;
    use serde_json::json;
    use sqlx::{Connection, Row};

    #[test]
    fn computed_integer_columns_are_serialized_as_numbers() {
        tauri::async_runtime::block_on(async {
            let mut conn = sqlx::SqliteConnection::connect(":memory:").await.unwrap();
            let row = sqlx::query(
                "SELECT CAST(CASE WHEN trim('saved-key') != '' THEN 1 ELSE 0 END AS INTEGER)
                 AS has_api_key",
            )
            .fetch_one(&mut conn)
            .await
            .unwrap();
            let column = row.columns().first().unwrap();
            assert_eq!(column_to_value(&row, column), json!(1));
        });
    }
}
