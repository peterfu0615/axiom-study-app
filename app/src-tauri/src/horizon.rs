use serde::{Deserialize, Serialize};
use sqlx::{Executor, Row, SqliteConnection};
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

const CURRICULUM_AI_STAGES: [&str; 3] = [
    "ai_analyzing_structure",
    "ai_generating_tags",
    "ai_auditing",
];

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCurriculumImportAttemptRequest {
    job_id: String,
    stage: String,
    prompt_version: String,
    schema_version: String,
    /// A restart is only used after an explicit retry or after application
    /// restart has proven that the previous local worker is gone.  Ordinary
    /// duplicate start signals must return the active attempt instead.
    #[serde(default)]
    restart_active_attempt: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurriculumImportAttemptLease {
    pub attempt_id: String,
    pub attempt_number: i64,
    pub run_token: String,
    pub run_generation: i64,
    pub created: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteCurriculumImportAttemptRequest {
    job_id: String,
    stage: String,
    attempt_id: String,
    attempt_number: i64,
    run_token: String,
    run_generation: i64,
    raw_output: String,
    #[serde(default)]
    provider_task_id: Option<String>,
    #[serde(default)]
    metadata_json: Option<String>,
    #[serde(default)]
    structure_json: Option<String>,
    #[serde(default)]
    tags_json: Option<String>,
    #[serde(default)]
    audit_json: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FailCurriculumImportAttemptRequest {
    job_id: String,
    stage: String,
    attempt_id: String,
    attempt_number: i64,
    run_token: String,
    run_generation: i64,
    error_message: String,
}

#[derive(Clone, Debug)]
struct ExistingAttempt {
    id: String,
    stage: String,
    number: i64,
    run_token: String,
    run_generation: i64,
}

fn validate_curriculum_ai_stage(stage: &str) -> Result<&str, String> {
    let stage = stage.trim();
    if CURRICULUM_AI_STAGES.contains(&stage) {
        Ok(stage)
    } else {
        Err("无效的教材 AI 分析阶段".to_string())
    }
}

fn next_curriculum_stage(stage: &str) -> Result<(&'static str, &'static str), String> {
    match stage {
        "ai_analyzing_structure" => Ok(("ai_generating_tags", "ai_generating_tags")),
        "ai_generating_tags" => Ok(("ai_auditing", "ai_auditing")),
        "ai_auditing" => Ok(("waiting_for_review", "waiting_for_review")),
        _ => Err("无效的教材 AI 分析阶段".to_string()),
    }
}

async fn find_running_curriculum_attempt(
    conn: &mut SqliteConnection,
    job_id: &str,
    stage: &str,
    preferred_attempt_id: Option<&str>,
) -> Result<Option<ExistingAttempt>, String> {
    let row =
        if let Some(attempt_id) = preferred_attempt_id.filter(|value| !value.trim().is_empty()) {
            sqlx::query(
                "SELECT id, stage, attempt_number, run_token, run_generation \
             FROM curriculum_import_attempts \
             WHERE id = $1 AND job_id = $2 AND status = 'running' LIMIT 1",
            )
            .bind(attempt_id)
            .bind(job_id)
            .fetch_optional(&mut *conn)
            .await
            .map_err(|error| format!("读取活跃教材分析尝试失败：{error}"))?
        } else {
            None
        };
    let row = match row {
        Some(row) => Some(row),
        None => sqlx::query(
            "SELECT id, stage, attempt_number, run_token, run_generation \
             FROM curriculum_import_attempts \
             WHERE job_id = $1 AND stage = $2 AND status = 'running' \
             ORDER BY started_at DESC, id DESC LIMIT 1",
        )
        .bind(job_id)
        .bind(stage)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|error| format!("读取活跃教材分析尝试失败：{error}"))?,
    };
    row.map(|row| {
        Ok(ExistingAttempt {
            id: row
                .try_get("id")
                .map_err(|error| format!("读取尝试 ID 失败：{error}"))?,
            stage: row
                .try_get("stage")
                .map_err(|error| format!("读取尝试阶段失败：{error}"))?,
            number: row
                .try_get("attempt_number")
                .map_err(|error| format!("读取尝试编号失败：{error}"))?,
            run_token: row
                .try_get("run_token")
                .map_err(|error| format!("读取尝试运行令牌失败：{error}"))?,
            run_generation: row
                .try_get("run_generation")
                .map_err(|error| format!("读取尝试代次失败：{error}"))?,
        })
    })
    .transpose()
}

async fn create_curriculum_import_attempt_in_transaction(
    conn: &mut SqliteConnection,
    request: &CreateCurriculumImportAttemptRequest,
) -> Result<CurriculumImportAttemptLease, String> {
    let stage = validate_curriculum_ai_stage(&request.stage)?;
    let job = sqlx::query(
        "SELECT status, resume_stage, active_attempt_id, run_generation \
         FROM curriculum_import_jobs WHERE id = $1",
    )
    .bind(&request.job_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|error| format!("读取教材导入任务失败：{error}"))?
    .ok_or_else(|| "找不到教材导入任务".to_string())?;
    let resume_stage: String = job
        .try_get("resume_stage")
        .map_err(|error| format!("读取教材恢复阶段失败：{error}"))?;
    if resume_stage != stage {
        return Err(format!(
            "教材导入当前阶段为 {resume_stage}，不能启动 {stage}"
        ));
    }
    let active_attempt_id: Option<String> = job
        .try_get("active_attempt_id")
        .map_err(|error| format!("读取活跃教材尝试失败：{error}"))?;
    let run_generation: i64 = job
        .try_get("run_generation")
        .map_err(|error| format!("读取教材运行代次失败：{error}"))?;

    if let Some(active) =
        find_running_curriculum_attempt(conn, &request.job_id, stage, active_attempt_id.as_deref())
            .await?
    {
        if active.stage == stage && !request.restart_active_attempt {
            // A duplicated React effect, worker message or coordinator call
            // observes the same lease and must not dispatch a second request.
            sqlx::query(
                "UPDATE curriculum_import_jobs SET active_attempt_id = $1, \
                 active_attempt_number = $2, run_token = $3, run_generation = $4 \
                 WHERE id = $5",
            )
            .bind(&active.id)
            .bind(active.number)
            .bind(&active.run_token)
            .bind(active.run_generation)
            .bind(&request.job_id)
            .execute(&mut *conn)
            .await
            .map_err(|error| format!("同步活跃教材尝试失败：{error}"))?;
            return Ok(CurriculumImportAttemptLease {
                attempt_id: active.id,
                attempt_number: active.number,
                run_token: active.run_token,
                run_generation: active.run_generation,
                created: false,
            });
        }

        // A manual retry or app-restart recovery is a new safe-stage run.  The
        // earlier provider call cannot update the job after this point.
        sqlx::query(
            "UPDATE curriculum_import_attempts SET status = 'superseded', finished_at = $1 \
             WHERE id = $2 AND status = 'running'",
        )
        .bind(chrono_millis()?)
        .bind(&active.id)
        .execute(&mut *conn)
        .await
        .map_err(|error| format!("关闭旧教材分析尝试失败：{error}"))?;
    }

    let attempt_number: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(attempt_number), 0) + 1 \
         FROM curriculum_import_attempts WHERE job_id = $1 AND stage = $2",
    )
    .bind(&request.job_id)
    .bind(stage)
    .fetch_one(&mut *conn)
    .await
    .map_err(|error| format!("生成教材分析尝试编号失败：{error}"))?;
    let attempt_id = Uuid::new_v4().to_string();
    let run_token = Uuid::new_v4().to_string();
    let next_generation = run_generation.saturating_add(1);
    let now = chrono_millis()?;
    sqlx::query(
        "INSERT INTO curriculum_import_attempts ( \
           id, job_id, stage, attempt_number, status, started_at, run_token, run_generation \
         ) VALUES ($1, $2, $3, $4, 'running', $5, $6, $7)",
    )
    .bind(&attempt_id)
    .bind(&request.job_id)
    .bind(stage)
    .bind(attempt_number)
    .bind(now)
    .bind(&run_token)
    .bind(next_generation)
    .execute(&mut *conn)
    .await
    .map_err(|error| format!("创建教材分析尝试失败：{error}"))?;
    sqlx::query(
        "UPDATE curriculum_import_jobs SET status = $1, resume_stage = $1, \
         active_attempt_id = $2, active_attempt_number = $3, stage_started_at = $4, \
         run_token = $5, run_generation = $6, prompt_version = $7, schema_version = $8, \
         error_message = NULL, updated_at = $4 WHERE id = $9",
    )
    .bind(stage)
    .bind(&attempt_id)
    .bind(attempt_number)
    .bind(now)
    .bind(&run_token)
    .bind(next_generation)
    .bind(request.prompt_version.trim())
    .bind(request.schema_version.trim())
    .bind(&request.job_id)
    .execute(&mut *conn)
    .await
    .map_err(|error| format!("更新教材分析阶段失败：{error}"))?;
    Ok(CurriculumImportAttemptLease {
        attempt_id,
        attempt_number,
        run_token,
        run_generation: next_generation,
        created: true,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub async fn create_curriculum_import_attempt(
    state: State<'_, DbState>,
    request: CreateCurriculumImportAttemptRequest,
) -> Result<CurriculumImportAttemptLease, String> {
    let mut guard = state.connection.lock().await;
    let conn = guard.as_mut().ok_or("数据库连接尚未初始化")?;
    conn.execute("BEGIN IMMEDIATE")
        .await
        .map_err(|error| format!("无法开始教材导入事务：{error}"))?;
    let result = create_curriculum_import_attempt_in_transaction(conn, &request).await;
    match result {
        Ok(value) => conn
            .execute("COMMIT")
            .await
            .map(|_| value)
            .map_err(|error| format!("提交教材导入事务失败：{error}")),
        Err(error) => {
            let _ = conn.execute("ROLLBACK").await;
            Err(error)
        }
    }
}

async fn active_attempt_matches(
    conn: &mut SqliteConnection,
    job_id: &str,
    stage: &str,
    attempt_id: &str,
    attempt_number: i64,
    run_token: &str,
    run_generation: i64,
) -> Result<bool, String> {
    let row = sqlx::query(
        "SELECT id FROM curriculum_import_jobs \
         WHERE id = $1 AND resume_stage = $2 AND active_attempt_id = $3 \
           AND active_attempt_number = $4 AND run_token = $5 AND run_generation = $6",
    )
    .bind(job_id)
    .bind(stage)
    .bind(attempt_id)
    .bind(attempt_number)
    .bind(run_token)
    .bind(run_generation)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|error| format!("校验教材分析尝试失败：{error}"))?;
    Ok(row.is_some())
}

async fn complete_curriculum_import_attempt_in_transaction(
    conn: &mut SqliteConnection,
    request: &CompleteCurriculumImportAttemptRequest,
) -> Result<bool, String> {
    let stage = validate_curriculum_ai_stage(&request.stage)?;
    let (next_status, next_stage) = next_curriculum_stage(stage)?;
    if !active_attempt_matches(
        conn,
        &request.job_id,
        stage,
        &request.attempt_id,
        request.attempt_number,
        &request.run_token,
        request.run_generation,
    )
    .await?
    {
        return Ok(false);
    }
    let now = chrono_millis()?;
    let attempt = sqlx::query(
        "UPDATE curriculum_import_attempts SET status = 'succeeded', raw_output = $1, \
         provider_task_id = COALESCE($2, provider_task_id), finished_at = $3 \
         WHERE id = $4 AND job_id = $5 AND stage = $6 AND attempt_number = $7 \
           AND run_token = $8 AND run_generation = $9 AND status = 'running'",
    )
    .bind(&request.raw_output)
    .bind(&request.provider_task_id)
    .bind(now)
    .bind(&request.attempt_id)
    .bind(&request.job_id)
    .bind(stage)
    .bind(request.attempt_number)
    .bind(&request.run_token)
    .bind(request.run_generation)
    .execute(&mut *conn)
    .await
    .map_err(|error| format!("完成教材分析尝试失败：{error}"))?;
    if attempt.rows_affected() != 1 {
        return Ok(false);
    }
    let job = sqlx::query(
        "UPDATE curriculum_import_jobs SET status = $1, resume_stage = $2, \
         metadata_json = COALESCE($3, metadata_json), \
         structure_json = COALESCE($4, structure_json), \
         tags_json = COALESCE($5, tags_json), audit_json = COALESCE($6, audit_json), \
         provider_task_id = COALESCE($7, provider_task_id), raw_output = $8, \
         error_message = NULL, active_attempt_id = NULL, active_attempt_number = NULL, \
         stage_started_at = NULL, updated_at = $9 \
         WHERE id = $10 AND resume_stage = $11 AND active_attempt_id = $12 \
           AND active_attempt_number = $13 AND run_token = $14 AND run_generation = $15",
    )
    .bind(next_status)
    .bind(next_stage)
    .bind(&request.metadata_json)
    .bind(&request.structure_json)
    .bind(&request.tags_json)
    .bind(&request.audit_json)
    .bind(&request.provider_task_id)
    .bind(&request.raw_output)
    .bind(now)
    .bind(&request.job_id)
    .bind(stage)
    .bind(&request.attempt_id)
    .bind(request.attempt_number)
    .bind(&request.run_token)
    .bind(request.run_generation)
    .execute(&mut *conn)
    .await
    .map_err(|error| format!("推进教材分析阶段失败：{error}"))?;
    if job.rows_affected() != 1 {
        return Err("教材分析状态在完成前发生变化".to_string());
    }
    Ok(true)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn complete_curriculum_import_attempt(
    state: State<'_, DbState>,
    request: CompleteCurriculumImportAttemptRequest,
) -> Result<bool, String> {
    let mut guard = state.connection.lock().await;
    let conn = guard.as_mut().ok_or("数据库连接尚未初始化")?;
    conn.execute("BEGIN IMMEDIATE")
        .await
        .map_err(|error| format!("无法开始教材导入事务：{error}"))?;
    let result = complete_curriculum_import_attempt_in_transaction(conn, &request).await;
    match result {
        Ok(value) => conn
            .execute("COMMIT")
            .await
            .map(|_| value)
            .map_err(|error| format!("提交教材导入事务失败：{error}")),
        Err(error) => {
            let _ = conn.execute("ROLLBACK").await;
            Err(error)
        }
    }
}

async fn fail_curriculum_import_attempt_in_transaction(
    conn: &mut SqliteConnection,
    request: &FailCurriculumImportAttemptRequest,
) -> Result<bool, String> {
    let stage = validate_curriculum_ai_stage(&request.stage)?;
    if !active_attempt_matches(
        conn,
        &request.job_id,
        stage,
        &request.attempt_id,
        request.attempt_number,
        &request.run_token,
        request.run_generation,
    )
    .await?
    {
        return Ok(false);
    }
    let now = chrono_millis()?;
    let attempt = sqlx::query(
        "UPDATE curriculum_import_attempts SET status = 'failed', error_message = $1, \
         finished_at = $2 WHERE id = $3 AND job_id = $4 AND stage = $5 \
           AND attempt_number = $6 AND run_token = $7 AND run_generation = $8 \
           AND status = 'running'",
    )
    .bind(request.error_message.trim())
    .bind(now)
    .bind(&request.attempt_id)
    .bind(&request.job_id)
    .bind(stage)
    .bind(request.attempt_number)
    .bind(&request.run_token)
    .bind(request.run_generation)
    .execute(&mut *conn)
    .await
    .map_err(|error| format!("记录教材分析失败失败：{error}"))?;
    if attempt.rows_affected() != 1 {
        return Ok(false);
    }
    let job = sqlx::query(
        "UPDATE curriculum_import_jobs SET status = 'ai_failed_recoverable', \
         resume_stage = $1, error_message = $2, active_attempt_id = NULL, \
         active_attempt_number = NULL, stage_started_at = NULL, updated_at = $3 \
         WHERE id = $4 AND resume_stage = $5 AND active_attempt_id = $6 \
           AND active_attempt_number = $7 AND run_token = $8 AND run_generation = $9",
    )
    .bind(stage)
    .bind(request.error_message.trim())
    .bind(now)
    .bind(&request.job_id)
    .bind(stage)
    .bind(&request.attempt_id)
    .bind(request.attempt_number)
    .bind(&request.run_token)
    .bind(request.run_generation)
    .execute(&mut *conn)
    .await
    .map_err(|error| format!("更新可恢复教材分析失败状态失败：{error}"))?;
    if job.rows_affected() != 1 {
        return Err("教材分析状态在失败处理前发生变化".to_string());
    }
    Ok(true)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn fail_curriculum_import_attempt(
    state: State<'_, DbState>,
    request: FailCurriculumImportAttemptRequest,
) -> Result<bool, String> {
    let mut guard = state.connection.lock().await;
    let conn = guard.as_mut().ok_or("数据库连接尚未初始化")?;
    conn.execute("BEGIN IMMEDIATE")
        .await
        .map_err(|error| format!("无法开始教材导入事务：{error}"))?;
    let result = fail_curriculum_import_attempt_in_transaction(conn, &request).await;
    match result {
        Ok(value) => conn
            .execute("COMMIT")
            .await
            .map(|_| value)
            .map_err(|error| format!("提交教材导入事务失败：{error}")),
        Err(error) => {
            let _ = conn.execute("ROLLBACK").await;
            Err(error)
        }
    }
}

#[cfg(test)]
mod curriculum_attempt_tests {
    use super::*;
    use sqlx::Connection;
    use std::sync::Arc;

    async fn test_connection() -> SqliteConnection {
        let mut conn = SqliteConnection::connect(":memory:").await.unwrap();
        conn.execute(
            "CREATE TABLE curriculum_import_jobs (
               id TEXT PRIMARY KEY NOT NULL,
               status TEXT NOT NULL,
               resume_stage TEXT NOT NULL,
               active_attempt_id TEXT,
               active_attempt_number INTEGER,
               stage_started_at INTEGER,
               run_token TEXT,
               run_generation INTEGER NOT NULL DEFAULT 0,
               prompt_version TEXT NOT NULL DEFAULT '',
               schema_version TEXT NOT NULL DEFAULT '',
               metadata_json TEXT,
               structure_json TEXT,
               tags_json TEXT,
               audit_json TEXT,
               provider_task_id TEXT,
               raw_output TEXT,
               error_message TEXT,
               updated_at INTEGER NOT NULL DEFAULT 0
             )",
        )
        .await
        .unwrap();
        conn.execute(
            "CREATE TABLE curriculum_import_attempts (
               id TEXT PRIMARY KEY NOT NULL,
               job_id TEXT NOT NULL,
               stage TEXT NOT NULL,
               attempt_number INTEGER NOT NULL,
               provider_task_id TEXT,
               status TEXT NOT NULL,
               raw_output TEXT,
               error_message TEXT,
               started_at INTEGER NOT NULL,
               finished_at INTEGER,
               run_token TEXT NOT NULL DEFAULT '',
               run_generation INTEGER NOT NULL DEFAULT 0,
               UNIQUE(job_id, stage, attempt_number)
             )",
        )
        .await
        .unwrap();
        conn.execute(
            "CREATE UNIQUE INDEX idx_curriculum_import_attempt_one_active_stage
             ON curriculum_import_attempts(job_id, stage) WHERE status = 'running'",
        )
        .await
        .unwrap();
        conn
    }

    async fn insert_job(conn: &mut SqliteConnection, id: &str, stage: &str) {
        sqlx::query(
            "INSERT INTO curriculum_import_jobs (id, status, resume_stage)
             VALUES ($1, $2, $2)",
        )
        .bind(id)
        .bind(stage)
        .execute(conn)
        .await
        .unwrap();
    }

    fn create_request(
        job_id: &str,
        stage: &str,
        restart: bool,
    ) -> CreateCurriculumImportAttemptRequest {
        CreateCurriculumImportAttemptRequest {
            job_id: job_id.to_string(),
            stage: stage.to_string(),
            prompt_version: "prompt-test".to_string(),
            schema_version: "schema-test".to_string(),
            restart_active_attempt: restart,
        }
    }

    async fn create_attempt(
        conn: &mut SqliteConnection,
        request: &CreateCurriculumImportAttemptRequest,
    ) -> Result<CurriculumImportAttemptLease, String> {
        conn.execute("BEGIN IMMEDIATE").await.unwrap();
        let result = create_curriculum_import_attempt_in_transaction(conn, request).await;
        match result {
            Ok(value) => {
                conn.execute("COMMIT").await.unwrap();
                Ok(value)
            }
            Err(error) => {
                conn.execute("ROLLBACK").await.unwrap();
                Err(error)
            }
        }
    }

    async fn fail_attempt(
        conn: &mut SqliteConnection,
        request: &FailCurriculumImportAttemptRequest,
    ) -> Result<bool, String> {
        conn.execute("BEGIN IMMEDIATE").await.unwrap();
        let result = fail_curriculum_import_attempt_in_transaction(conn, request).await;
        match result {
            Ok(value) => {
                conn.execute("COMMIT").await.unwrap();
                Ok(value)
            }
            Err(error) => {
                conn.execute("ROLLBACK").await.unwrap();
                Err(error)
            }
        }
    }

    async fn complete_attempt(
        conn: &mut SqliteConnection,
        request: &CompleteCurriculumImportAttemptRequest,
    ) -> Result<bool, String> {
        conn.execute("BEGIN IMMEDIATE").await.unwrap();
        let result = complete_curriculum_import_attempt_in_transaction(conn, request).await;
        match result {
            Ok(value) => {
                conn.execute("COMMIT").await.unwrap();
                Ok(value)
            }
            Err(error) => {
                conn.execute("ROLLBACK").await.unwrap();
                Err(error)
            }
        }
    }

    fn identity(
        job_id: &str,
        stage: &str,
        lease: &CurriculumImportAttemptLease,
    ) -> (String, String, String, i64, String, i64) {
        (
            job_id.to_string(),
            stage.to_string(),
            lease.attempt_id.clone(),
            lease.attempt_number,
            lease.run_token.clone(),
            lease.run_generation,
        )
    }

    fn complete_request(
        job_id: &str,
        stage: &str,
        lease: &CurriculumImportAttemptLease,
    ) -> CompleteCurriculumImportAttemptRequest {
        let (job_id, stage, attempt_id, attempt_number, run_token, run_generation) =
            identity(job_id, stage, lease);
        CompleteCurriculumImportAttemptRequest {
            job_id,
            stage,
            attempt_id,
            attempt_number,
            run_token,
            run_generation,
            raw_output: "{}".to_string(),
            provider_task_id: None,
            metadata_json: Some("{}".to_string()),
            structure_json: Some("[]".to_string()),
            tags_json: Some("{}".to_string()),
            audit_json: Some("{}".to_string()),
        }
    }

    fn fail_request(
        job_id: &str,
        stage: &str,
        lease: &CurriculumImportAttemptLease,
    ) -> FailCurriculumImportAttemptRequest {
        let (job_id, stage, attempt_id, attempt_number, run_token, run_generation) =
            identity(job_id, stage, lease);
        FailCurriculumImportAttemptRequest {
            job_id,
            stage,
            attempt_id,
            attempt_number,
            run_token,
            run_generation,
            error_message: "Provider unavailable".to_string(),
        }
    }

    #[test]
    fn duplicate_structure_signals_share_one_active_attempt() {
        tauri::async_runtime::block_on(async {
            let mut conn = test_connection().await;
            insert_job(&mut conn, "job", "ai_analyzing_structure").await;
            let first = create_attempt(
                &mut conn,
                &create_request("job", "ai_analyzing_structure", false),
            )
            .await
            .unwrap();
            let duplicate = create_attempt(
                &mut conn,
                &create_request("job", "ai_analyzing_structure", false),
            )
            .await
            .unwrap();
            assert!(first.created);
            assert!(!duplicate.created);
            assert_eq!(first.attempt_id, duplicate.attempt_id);
            assert_eq!(duplicate.attempt_number, 1);
            let count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM curriculum_import_attempts
                 WHERE job_id = 'job' AND stage = 'ai_analyzing_structure'",
            )
            .fetch_one(&mut conn)
            .await
            .unwrap();
            assert_eq!(count, 1);
        });
    }

    #[test]
    fn mutex_serializes_concurrent_stage_starts_and_keeps_number_one() {
        tauri::async_runtime::block_on(async {
            let mut conn = test_connection().await;
            insert_job(&mut conn, "job", "ai_analyzing_structure").await;
            let conn = Arc::new(tauri::async_runtime::Mutex::new(conn));
            let first_conn = Arc::clone(&conn);
            let second_conn = Arc::clone(&conn);
            let first_request = create_request("job", "ai_analyzing_structure", false);
            let second_request = first_request.clone();
            let first = async move {
                let mut guard = first_conn.lock().await;
                create_attempt(&mut guard, &first_request).await.unwrap()
            };
            let second = async move {
                let mut guard = second_conn.lock().await;
                create_attempt(&mut guard, &second_request).await.unwrap()
            };
            let (left, right) = futures_util::future::join(first, second).await;
            assert_eq!(left.attempt_number, 1);
            assert_eq!(right.attempt_number, 1);
            assert_ne!(left.created, right.created);
            let mut guard = conn.lock().await;
            let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM curriculum_import_attempts")
                .fetch_one(&mut *guard)
                .await
                .unwrap();
            assert_eq!(count, 1);
        });
    }

    #[test]
    fn retries_increment_per_stage_and_different_stages_start_at_one() {
        tauri::async_runtime::block_on(async {
            let mut conn = test_connection().await;
            insert_job(&mut conn, "job", "ai_analyzing_structure").await;
            let one = create_attempt(
                &mut conn,
                &create_request("job", "ai_analyzing_structure", false),
            )
            .await
            .unwrap();
            assert!(fail_attempt(
                &mut conn,
                &fail_request("job", "ai_analyzing_structure", &one),
            )
            .await
            .unwrap());
            let two = create_attempt(
                &mut conn,
                &create_request("job", "ai_analyzing_structure", false),
            )
            .await
            .unwrap();
            assert_eq!(two.attempt_number, 2);
            assert!(fail_attempt(
                &mut conn,
                &fail_request("job", "ai_analyzing_structure", &two),
            )
            .await
            .unwrap());
            let three = create_attempt(
                &mut conn,
                &create_request("job", "ai_analyzing_structure", false),
            )
            .await
            .unwrap();
            assert_eq!(three.attempt_number, 3);
            assert!(complete_attempt(
                &mut conn,
                &complete_request("job", "ai_analyzing_structure", &three),
            )
            .await
            .unwrap());
            let tag = create_attempt(
                &mut conn,
                &create_request("job", "ai_generating_tags", false),
            )
            .await
            .unwrap();
            assert_eq!(tag.attempt_number, 1);
        });
    }

    #[test]
    fn recovery_restart_supersedes_once_and_late_result_cannot_win() {
        tauri::async_runtime::block_on(async {
            let mut conn = test_connection().await;
            insert_job(&mut conn, "job", "ai_analyzing_structure").await;
            let first = create_attempt(
                &mut conn,
                &create_request("job", "ai_analyzing_structure", false),
            )
            .await
            .unwrap();
            let retry = create_attempt(
                &mut conn,
                &create_request("job", "ai_analyzing_structure", true),
            )
            .await
            .unwrap();
            assert_eq!(retry.attempt_number, 2);
            assert!(!complete_attempt(
                &mut conn,
                &complete_request("job", "ai_analyzing_structure", &first),
            )
            .await
            .unwrap());
            let active: String = sqlx::query_scalar(
                "SELECT active_attempt_id FROM curriculum_import_jobs WHERE id = 'job'",
            )
            .fetch_one(&mut conn)
            .await
            .unwrap();
            assert_eq!(active, retry.attempt_id);
        });
    }

    #[test]
    fn safe_stage_pipeline_reaches_review_and_keeps_unique_constraint() {
        tauri::async_runtime::block_on(async {
            let mut conn = test_connection().await;
            insert_job(&mut conn, "job", "ai_analyzing_structure").await;
            let structure = create_attempt(
                &mut conn,
                &create_request("job", "ai_analyzing_structure", false),
            )
            .await
            .unwrap();
            assert!(complete_attempt(
                &mut conn,
                &complete_request("job", "ai_analyzing_structure", &structure),
            )
            .await
            .unwrap());
            let tags = create_attempt(
                &mut conn,
                &create_request("job", "ai_generating_tags", false),
            )
            .await
            .unwrap();
            assert!(complete_attempt(
                &mut conn,
                &complete_request("job", "ai_generating_tags", &tags),
            )
            .await
            .unwrap());
            let audit = create_attempt(&mut conn, &create_request("job", "ai_auditing", false))
                .await
                .unwrap();
            assert!(
                complete_attempt(&mut conn, &complete_request("job", "ai_auditing", &audit),)
                    .await
                    .unwrap()
            );
            let status: String =
                sqlx::query_scalar("SELECT status FROM curriculum_import_jobs WHERE id = 'job'")
                    .fetch_one(&mut conn)
                    .await
                    .unwrap();
            assert_eq!(status, "waiting_for_review");
            let indexes = sqlx::query("PRAGMA index_list('curriculum_import_attempts')")
                .fetch_all(&mut conn)
                .await
                .unwrap();
            assert!(indexes.iter().any(|row| {
                row.try_get::<String, _>("name")
                    .map(|name| name == "idx_curriculum_import_attempt_one_active_stage")
                    .unwrap_or(false)
            }));
        });
    }
}
