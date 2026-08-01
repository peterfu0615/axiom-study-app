use sqlx::{Executor, Row};
use tauri::State;
use uuid::Uuid;

use crate::db::DbState;

fn validate_subject(subject: &str) -> Result<&str, String> {
    let subject = subject.trim();
    if subject.is_empty() {
        return Err("科目不能为空".to_string());
    }
    Ok(subject)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn merge_tag_definitions(
    state: State<'_, DbState>,
    subject: String,
    source_tag_id: String,
    target_tag_id: String,
) -> Result<(), String> {
    let subject = validate_subject(&subject)?;
    if source_tag_id == target_tag_id {
        return Err("不能将标签合并到自身".to_string());
    }
    let mut guard = state.connection.lock().await;
    let conn = guard.as_mut().ok_or("数据库连接尚未初始化")?;
    conn.execute("BEGIN IMMEDIATE")
        .await
        .map_err(|error| format!("无法开始标签合并事务：{error}"))?;
    let result = async {
        let rows = sqlx::query(
            "SELECT id, tag_type, canonical_name, lifecycle_status \
             FROM tag_definitions \
             WHERE subject = $1 AND id IN ($2, $3)",
        )
        .bind(subject)
        .bind(&source_tag_id)
        .bind(&target_tag_id)
        .fetch_all(&mut *conn)
        .await
        .map_err(|error| format!("读取待合并标签失败：{error}"))?;
        if rows.len() != 2 {
            return Err("源标签或目标标签不存在于当前科目".to_string());
        }
        let source = rows
            .iter()
            .find(|row| row.get::<String, _>("id") == source_tag_id)
            .ok_or("找不到源标签")?;
        let target = rows
            .iter()
            .find(|row| row.get::<String, _>("id") == target_tag_id)
            .ok_or("找不到目标标签")?;
        let source_type: String = source.get("tag_type");
        let target_type: String = target.get("tag_type");
        if source_type != target_type {
            return Err("只能合并同一科目中的同类型标签".to_string());
        }
        let target_status: String = target.get("lifecycle_status");
        if target_status != "active" {
            return Err("目标标签必须是已审核的正式标签".to_string());
        }
        let source_name: String = source.get("canonical_name");
        let now = chrono_millis()?;
        sqlx::query(
            "INSERT OR IGNORE INTO tag_aliases \
             (id, subject, tag_id, alias, source, created_at) \
             VALUES ($1, $2, $3, $4, 'merge', $5)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(subject)
        .bind(&target_tag_id)
        .bind(source_name)
        .bind(now)
        .execute(&mut *conn)
        .await
        .map_err(|error| format!("保存合并别名失败：{error}"))?;
        sqlx::query(
            "UPDATE tag_definitions \
             SET lifecycle_status = 'merged', merged_into_id = $1, \
                 archived_at = $2, updated_at = $2 \
             WHERE id = $3 AND subject = $4",
        )
        .bind(&target_tag_id)
        .bind(now)
        .bind(&source_tag_id)
        .bind(subject)
        .execute(&mut *conn)
        .await
        .map_err(|error| format!("更新源标签失败：{error}"))?;
        Ok::<_, String>(())
    }
    .await;
    match result {
        Ok(()) => conn
            .execute("COMMIT")
            .await
            .map(|_| ())
            .map_err(|error| format!("提交标签合并失败：{error}")),
        Err(error) => {
            let _ = conn.execute("ROLLBACK").await;
            Err(error)
        }
    }
}

#[tauri::command(rename_all = "camelCase")]
pub async fn merge_knowledge_nodes(
    state: State<'_, DbState>,
    subject: String,
    source_node_id: String,
    target_node_id: String,
) -> Result<(), String> {
    let subject = validate_subject(&subject)?;
    if source_node_id == target_node_id {
        return Err("不能将知识节点合并到自身".to_string());
    }
    let mut guard = state.connection.lock().await;
    let conn = guard.as_mut().ok_or("数据库连接尚未初始化")?;
    conn.execute("BEGIN IMMEDIATE")
        .await
        .map_err(|error| format!("无法开始知识节点合并事务：{error}"))?;
    let result = async {
        let rows = sqlx::query(
            "SELECT id, textbook_id FROM knowledge_nodes \
             WHERE subject = $1 AND id IN ($2, $3) AND archived_at IS NULL",
        )
        .bind(subject)
        .bind(&source_node_id)
        .bind(&target_node_id)
        .fetch_all(&mut *conn)
        .await
        .map_err(|error| format!("读取待合并知识节点失败：{error}"))?;
        if rows.len() != 2 {
            return Err("源节点或目标节点不存在于当前科目".to_string());
        }
        let textbook_ids = rows
            .iter()
            .map(|row| row.get::<String, _>("textbook_id"))
            .collect::<std::collections::HashSet<_>>();
        if textbook_ids.len() != 1 {
            return Err("知识节点只能在同一科目的同一本教材内合并".to_string());
        }
        let now = chrono_millis()?;
        sqlx::query(
            "UPDATE knowledge_nodes SET parent_id = $1, updated_at = $2 \
             WHERE parent_id = $3 AND subject = $4",
        )
        .bind(&target_node_id)
        .bind(now)
        .bind(&source_node_id)
        .bind(subject)
        .execute(&mut *conn)
        .await
        .map_err(|error| format!("迁移子节点失败：{error}"))?;
        sqlx::query(
            "UPDATE knowledge_nodes \
             SET merged_into_id = $1, archived_at = $2, updated_at = $2 \
             WHERE id = $3 AND subject = $4",
        )
        .bind(&target_node_id)
        .bind(now)
        .bind(&source_node_id)
        .bind(subject)
        .execute(&mut *conn)
        .await
        .map_err(|error| format!("归档源知识节点失败：{error}"))?;
        Ok::<_, String>(())
    }
    .await;
    match result {
        Ok(()) => conn
            .execute("COMMIT")
            .await
            .map(|_| ())
            .map_err(|error| format!("提交知识节点合并失败：{error}")),
        Err(error) => {
            let _ = conn.execute("ROLLBACK").await;
            Err(error)
        }
    }
}

fn chrono_millis() -> Result<i64, String> {
    use std::time::{SystemTime, UNIX_EPOCH};
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("系统时间不可用：{error}"))?;
    i64::try_from(duration.as_millis()).map_err(|_| "系统时间超出范围".to_string())
}
