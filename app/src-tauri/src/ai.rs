use std::{
    collections::HashMap,
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, ExitStatus, Stdio},
    sync::{Mutex, OnceLock},
    thread,
    time::{Duration, Instant},
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use futures_util::StreamExt;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{Executor, Row};
use tauri::{ipc::Channel, AppHandle, Manager, State};
const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES: u64 = 30 * 1024 * 1024;
const MAX_IMAGE_TOTAL_BYTES: u64 = 60 * 1024 * 1024;
const MAX_IMAGE_COUNT: usize = 8;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ResponseFormatMode {
    JsonSchema,
    JsonObject,
    None,
}

impl ResponseFormatMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::JsonSchema => "json_schema",
            Self::JsonObject => "json_object",
            Self::None => "none",
        }
    }
}

static RESPONSE_FORMAT_CACHE: OnceLock<Mutex<HashMap<String, ResponseFormatMode>>> =
    OnceLock::new();

/// 流式输出增量 chunk，通过 Tauri Channel 推送到前端。
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamChunk {
    /// 累积的完整文本（包含本次增量）
    pub accumulated: String,
    /// 本次增量文本
    pub delta: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAICompatibleAnalysisRequest {
    base_url: String,
    model: String,
    /// Provider identity. Rust loads its API Key directly from local SQLite.
    provider_id: String,
    /// 主图（与 image_paths 合并使用，兼容旧调用）
    #[serde(default)]
    crop_image_path: Option<String>,
    /// 附加图片（题图、图形、答题区等，多区域分析时使用）
    #[serde(default)]
    image_paths: Vec<String>,
    /// System prompt
    prompt: String,
    /// 用户消息文本（可选；不传时使用默认提示语）
    #[serde(default)]
    user_text: Option<String>,
    /// JSON Schema 字符串（可选；部分 Provider 支持 response_format json_schema）
    #[serde(default)]
    json_schema: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AntigravityCLIAnalysisRequest {
    command_path: String,
    model: String,
    crop_image_path: Option<String>,
    #[serde(default)]
    image_paths: Vec<String>,
    prompt: String,
    json_schema: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedAIProviderProfile {
    id: String,
    name: String,
    provider: String,
    base_url: String,
    /// Only a newly-entered value is supplied here.  A blank value means
    /// preserve SQLite's existing key, never overwrite it with an empty string.
    api_key: String,
    credential_ref: String,
    command_path: String,
    model: String,
    #[serde(default)]
    input_cost_per_million_usd: Option<f64>,
    #[serde(default)]
    output_cost_per_million_usd: Option<f64>,
    supports_vision: bool,
    supports_text: bool,
    #[serde(default)]
    task_types: Vec<String>,
    enabled: bool,
    sort_order: i64,
    created_at: i64,
    updated_at: i64,
}

const AI_PROVIDER_TASK_TYPES: &[&str] = &[
    "problem_understanding",
    "solution_generation",
    "solution_review",
    "attempt_analysis",
    "tag_mapping",
    "variant_planning",
    "variant_generation",
    "variant_verification",
    "submission_grading",
    "explain_selection",
    "textbook_recognition",
    "curriculum_analysis",
    "geometry_scene",
];

/// Safe post-commit status returned to the frontend.  The full API Key never
/// leaves SQLite; only a boolean and the final four characters are exposed.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AIProviderSaveStatus {
    pub id: String,
    pub provider: String,
    pub has_api_key: bool,
    pub api_key_suffix: String,
}

fn provider_profile_error(profile: &PersistedAIProviderProfile) -> Result<(), String> {
    if profile.id.trim().is_empty() {
        return Err("Provider ID 不能为空".to_string());
    }
    if profile.name.trim().is_empty() {
        return Err("Provider 名称不能为空".to_string());
    }
    if !matches!(
        profile.provider.as_str(),
        "mock" | "openai_compatible" | "antigravity_cli"
    ) {
        return Err("Provider 类型无效".to_string());
    }
    if profile.enabled
        && profile.provider == "openai_compatible"
        && (profile.base_url.trim().is_empty() || profile.model.trim().is_empty())
    {
        return Err(format!("“{}”启用前请填写 Base URL 和 Model", profile.name));
    }
    if profile.enabled
        && profile.provider == "antigravity_cli"
        && (profile.command_path.trim().is_empty() || profile.model.trim().is_empty())
    {
        return Err(format!("“{}”启用前请填写 CLI 路径和 Model", profile.name));
    }
    for price in [
        profile.input_cost_per_million_usd,
        profile.output_cost_per_million_usd,
    ]
    .into_iter()
    .flatten()
    {
        if !price.is_finite() || price < 0.0 {
            return Err(format!("“{}”的 Token 单价必须是非负数字", profile.name));
        }
    }
    let mut task_types = std::collections::HashSet::new();
    for task_type in &profile.task_types {
        if !AI_PROVIDER_TASK_TYPES.contains(&task_type.as_str()) {
            return Err(format!("“{}”包含不支持的任务路由", profile.name));
        }
        if !task_types.insert(task_type) {
            return Err(format!("“{}”的任务路由不能重复", profile.name));
        }
    }
    Ok(())
}

async fn upsert_ai_provider_profile(
    conn: &mut sqlx::SqliteConnection,
    profile: &PersistedAIProviderProfile,
) -> Result<(), String> {
    let task_types_json = serde_json::to_string(&profile.task_types)
        .map_err(|error| format!("序列化 Provider 任务路由失败：{error}"))?;
    sqlx::query(
        "INSERT INTO ai_provider_profiles (
           id, name, provider, base_url, api_key, credential_ref, command_path, model,
           input_cost_per_million_usd, output_cost_per_million_usd,
           supports_vision, supports_text, task_types_json, enabled, sort_order, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           provider = excluded.provider,
           base_url = excluded.base_url,
           api_key = CASE
             WHEN trim(excluded.api_key) != '' THEN excluded.api_key
             ELSE ai_provider_profiles.api_key
           END,
           credential_ref = CASE
             WHEN excluded.provider != 'openai_compatible' THEN ''
             WHEN trim(excluded.credential_ref) != '' THEN excluded.credential_ref
             ELSE ai_provider_profiles.credential_ref
           END,
           command_path = excluded.command_path,
           model = excluded.model,
           input_cost_per_million_usd = excluded.input_cost_per_million_usd,
           output_cost_per_million_usd = excluded.output_cost_per_million_usd,
           supports_vision = excluded.supports_vision,
           supports_text = excluded.supports_text,
           task_types_json = excluded.task_types_json,
           enabled = excluded.enabled,
           sort_order = excluded.sort_order,
           updated_at = excluded.updated_at",
    )
    .bind(profile.id.trim())
    .bind(profile.name.trim())
    .bind(profile.provider.trim())
    .bind(profile.base_url.trim())
    .bind(profile.api_key.trim())
    .bind(profile.credential_ref.trim())
    .bind(profile.command_path.trim())
    .bind(profile.model.trim())
    .bind(profile.input_cost_per_million_usd)
    .bind(profile.output_cost_per_million_usd)
    .bind(profile.supports_vision)
    .bind(profile.supports_text)
    .bind(task_types_json)
    .bind(profile.enabled)
    .bind(profile.sort_order)
    .bind(profile.created_at)
    .bind(profile.updated_at)
    .execute(&mut *conn)
    .await
    .map_err(|error| format!("保存 Provider 配置失败：{error}"))?;
    Ok(())
}

async fn read_ai_provider_save_statuses(
    conn: &mut sqlx::SqliteConnection,
) -> Result<Vec<AIProviderSaveStatus>, String> {
    let rows = sqlx::query(
        "SELECT id, provider,
           CAST(CASE WHEN trim(api_key) != '' THEN 1 ELSE 0 END AS INTEGER) AS has_api_key,
           CASE
             WHEN length(trim(api_key)) > 4 THEN substr(trim(api_key), -4)
             ELSE ''
           END AS api_key_suffix
         FROM ai_provider_profiles
         ORDER BY sort_order, created_at",
    )
    .fetch_all(&mut *conn)
    .await
    .map_err(|error| format!("读取 Provider 保存状态失败：{error}"))?;

    rows.into_iter()
        .map(|row| {
            Ok(AIProviderSaveStatus {
                id: row
                    .try_get("id")
                    .map_err(|error| format!("读取 Provider ID 失败：{error}"))?,
                provider: row
                    .try_get("provider")
                    .map_err(|error| format!("读取 Provider 类型失败：{error}"))?,
                has_api_key: row
                    .try_get::<i64, _>("has_api_key")
                    .map_err(|error| format!("读取 Provider API Key 状态失败：{error}"))?
                    != 0,
                api_key_suffix: row
                    .try_get("api_key_suffix")
                    .map_err(|error| format!("读取 Provider API Key 掩码失败：{error}"))?,
            })
        })
        .collect()
}

fn validate_provider_save_statuses(
    profiles: &[PersistedAIProviderProfile],
    statuses: &[AIProviderSaveStatus],
) -> Result<(), String> {
    for profile in profiles {
        if profile.enabled && profile.provider == "openai_compatible" {
            let saved = statuses
                .iter()
                .find(|status| status.id == profile.id.trim())
                .is_some_and(|status| status.has_api_key);
            if !saved {
                return Err(format!("“{}”启用前请保存 API Key", profile.name));
            }
        }
    }
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn persist_ai_provider_profiles(
    state: State<'_, crate::db::DbState>,
    profiles: Vec<PersistedAIProviderProfile>,
) -> Result<Vec<AIProviderSaveStatus>, String> {
    let mut guard = state.connection.lock().await;
    let conn = guard.as_mut().ok_or("数据库连接尚未初始化")?;
    persist_ai_provider_profiles_in_connection(conn, &profiles).await
}

async fn persist_ai_provider_profiles_in_connection(
    conn: &mut sqlx::SqliteConnection,
    profiles: &[PersistedAIProviderProfile],
) -> Result<Vec<AIProviderSaveStatus>, String> {
    let mut ids = std::collections::HashSet::new();
    for profile in profiles {
        provider_profile_error(profile)?;
        if !ids.insert(profile.id.trim().to_string()) {
            return Err("Provider ID 不能重复".to_string());
        }
    }
    conn.execute("BEGIN IMMEDIATE")
        .await
        .map_err(|error| format!("无法开始 Provider 保存事务：{error}"))?;
    let result = async {
        let existing_ids = sqlx::query("SELECT id FROM ai_provider_profiles")
            .fetch_all(&mut *conn)
            .await
            .map_err(|error| format!("读取已有 Provider 失败：{error}"))?;
        for profile in profiles {
            upsert_ai_provider_profile(conn, profile).await?;
        }
        for row in existing_ids {
            let id: String = row
                .try_get("id")
                .map_err(|error| format!("读取已有 Provider ID 失败：{error}"))?;
            if !ids.contains(&id) {
                sqlx::query("DELETE FROM ai_provider_profiles WHERE id = $1")
                    .bind(&id)
                    .execute(&mut *conn)
                    .await
                    .map_err(|error| format!("删除 Provider 配置失败：{error}"))?;
            }
        }
        let statuses = read_ai_provider_save_statuses(conn).await?;
        validate_provider_save_statuses(profiles, &statuses)?;
        Ok::<_, String>(statuses)
    }
    .await;
    match result {
        Ok(statuses) => {
            conn.execute("COMMIT")
                .await
                .map_err(|error| format!("提交 Provider 保存事务失败：{error}"))?;
            for status in &statuses {
                log::debug!(
                    "Provider 配置保存完成：id={} provider={} has_api_key={}",
                    status.id,
                    status.provider,
                    status.has_api_key
                );
            }
            Ok(statuses)
        }
        Err(error) => {
            let _ = conn.execute("ROLLBACK").await;
            Err(error)
        }
    }
}

async fn clear_ai_provider_api_key(
    conn: &mut sqlx::SqliteConnection,
    provider_id: &str,
) -> Result<(), String> {
    let provider_id = provider_id.trim();
    if provider_id.is_empty() {
        return Err("Provider ID 不能为空".to_string());
    }
    let changed = sqlx::query("UPDATE ai_provider_profiles SET api_key = '' WHERE id = $1")
        .bind(provider_id)
        .execute(&mut *conn)
        .await
        .map_err(|error| format!("删除 Provider API Key 失败：{error}"))?;
    if changed.rows_affected() != 1 {
        return Err("找不到指定的 AI Provider".to_string());
    }
    let saved: i64 = sqlx::query_scalar(
        "SELECT CASE WHEN trim(api_key) = '' THEN 1 ELSE 0 END
             FROM ai_provider_profiles WHERE id = $1",
    )
    .bind(provider_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(|error| format!("校验 Provider API Key 删除失败：{error}"))?;
    if saved != 1 {
        return Err("Provider API Key 删除后校验失败".to_string());
    }
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn delete_ai_provider_api_key(
    state: State<'_, crate::db::DbState>,
    provider_id: String,
) -> Result<(), String> {
    let mut guard = state.connection.lock().await;
    let conn = guard.as_mut().ok_or("数据库连接尚未初始化")?;
    conn.execute("BEGIN IMMEDIATE")
        .await
        .map_err(|error| format!("无法开始 API Key 删除事务：{error}"))?;
    let result = clear_ai_provider_api_key(conn, &provider_id).await;
    match result {
        Ok(()) => conn
            .execute("COMMIT")
            .await
            .map(|_| ())
            .map_err(|error| format!("提交 API Key 删除事务失败：{error}")),
        Err(error) => {
            let _ = conn.execute("ROLLBACK").await;
            Err(error)
        }
    }
}

fn endpoint_url(base_url: &str) -> Result<Url, String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("Base URL 不能为空".to_string());
    }
    let endpoint = if trimmed.ends_with("/chat/completions") {
        trimmed.to_string()
    } else {
        format!("{trimmed}/chat/completions")
    };
    let url = Url::parse(&endpoint).map_err(|error| format!("Base URL 无效：{error}"))?;
    if !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
        return Err("Base URL 不能包含账号、密码或 fragment".to_string());
    }
    if url.scheme() != "https" {
        let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1"));
        if url.scheme() != "http" || !local {
            return Err("真实 API 必须使用 HTTPS；仅本机地址允许 HTTP".to_string());
        }
    }
    Ok(url)
}

async fn load_provider_api_key_from_connection(
    conn: &mut sqlx::SqliteConnection,
    provider_id: &str,
) -> Result<String, String> {
    let provider_id = provider_id.trim();
    if provider_id.is_empty() {
        return Err("Provider ID 不能为空".to_string());
    }
    let row = sqlx::query("SELECT api_key FROM ai_provider_profiles WHERE id = $1")
        .bind(provider_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|error| format!("读取 Provider 配置失败：{error}"))?
        .ok_or_else(|| "找不到指定的 AI Provider".to_string())?;
    let api_key: String = row
        .try_get("api_key")
        .map_err(|error| format!("读取 Provider API Key 失败：{error}"))?;
    let api_key = api_key.trim().to_string();
    if api_key.is_empty() {
        return Err("该 Provider 尚未保存 API Key，请在设置中填写后重试".to_string());
    }
    Ok(api_key)
}

async fn load_provider_api_key(app: &AppHandle, provider_id: &str) -> Result<String, String> {
    let db_state = app
        .try_state::<crate::db::DbState>()
        .ok_or_else(|| "数据库状态未初始化".to_string())?;
    let mut guard = db_state.connection.lock().await;
    let conn = guard.as_mut().ok_or("数据库连接尚未初始化")?;
    load_provider_api_key_from_connection(conn, provider_id).await
}

fn managed_image_path(app: &AppHandle, image_path: &str) -> Result<PathBuf, String> {
    let path = Path::new(image_path)
        .canonicalize()
        .map_err(|error| format!("无法读取题目图片：{error}"))?;
    let media_root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?
        .join("media")
        .canonicalize()
        .map_err(|error| format!("无法读取 Axiom 图片目录：{error}"))?;
    if !path.starts_with(&media_root) {
        return Err("只允许发送 Axiom media 目录中的题目图片".to_string());
    }
    let metadata = fs::metadata(&path).map_err(|error| format!("无法读取题目图片：{error}"))?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_IMAGE_BYTES {
        return Err("题目图片为空或超过 30 MB".to_string());
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "jpg" | "jpeg" | "png" | "webp") {
        return Err("真实 AI 请求仅支持 JPG、PNG 和 WebP".to_string());
    }
    let mut file = fs::File::open(&path).map_err(|error| format!("无法读取题目图片：{error}"))?;
    let mut header = [0_u8; 12];
    let read = file
        .read(&mut header)
        .map_err(|error| format!("无法校验题目图片：{error}"))?;
    let valid_signature = match extension.as_str() {
        "jpg" | "jpeg" => read >= 3 && header[..3] == [0xff, 0xd8, 0xff],
        "png" => read >= 8 && header[..8] == [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a],
        "webp" => read >= 12 && &header[..4] == b"RIFF" && &header[8..12] == b"WEBP",
        _ => false,
    };
    if !valid_signature {
        return Err("题目图片扩展名与文件内容不匹配".to_string());
    }
    Ok(path)
}

struct CapturedCommandOutput {
    status: Option<ExitStatus>,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    timed_out: bool,
    oversized: bool,
}

/// Capture CLI output in regular files instead of pipes. Some CLI launchers
/// leave a background updater alive with inherited stdout/stderr descriptors;
/// joining pipe-reader threads would then wait forever even after the main
/// process exited or was killed. Reading a regular file reaches its current EOF
/// without depending on every descendant closing the inherited descriptor.
fn run_command_with_file_capture(
    command: &mut Command,
    timeout: Duration,
    limit: usize,
) -> Result<CapturedCommandOutput, String> {
    let capture_dir = std::env::temp_dir().join(format!(
        "axiom-antigravity-capture-{}",
        uuid::Uuid::new_v4()
    ));
    fs::create_dir(&capture_dir)
        .map_err(|error| format!("创建 Antigravity CLI 临时输出目录失败：{error}"))?;
    let stdout_path = capture_dir.join("stdout.log");
    let stderr_path = capture_dir.join("stderr.log");
    let result = (|| -> Result<CapturedCommandOutput, String> {
        let stdout_file = fs::File::create(&stdout_path)
            .map_err(|error| format!("创建 Antigravity CLI 输出文件失败：{error}"))?;
        let stderr_file = fs::File::create(&stderr_path)
            .map_err(|error| format!("创建 Antigravity CLI 日志文件失败：{error}"))?;
        let mut child = command
            .stdout(Stdio::from(stdout_file))
            .stderr(Stdio::from(stderr_file))
            .spawn()
            .map_err(|error| format!("无法启动 Antigravity CLI：{error}"))?;
        let started_at = Instant::now();
        let mut timed_out = false;
        let mut oversized = false;
        let status = loop {
            let stdout_len = fs::metadata(&stdout_path).map_or(0, |value| value.len());
            let stderr_len = fs::metadata(&stderr_path).map_or(0, |value| value.len());
            if stdout_len > limit as u64 || stderr_len > limit as u64 {
                oversized = true;
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
            if started_at.elapsed() >= timeout {
                timed_out = true;
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
            match child
                .try_wait()
                .map_err(|error| format!("等待 Antigravity CLI 失败：{error}"))?
            {
                Some(status) => break Some(status),
                None => thread::sleep(Duration::from_millis(25)),
            }
        };
        let read_capture = |path: &Path| -> Result<Vec<u8>, String> {
            let mut bytes = Vec::with_capacity(limit.min(64 * 1024));
            fs::File::open(path)
                .map_err(|error| format!("打开 Antigravity CLI 临时输出失败：{error}"))?
                .take(limit.saturating_add(1) as u64)
                .read_to_end(&mut bytes)
                .map_err(|error| format!("读取 Antigravity CLI 临时输出失败：{error}"))?;
            Ok(bytes)
        };
        let mut stdout = read_capture(&stdout_path)?;
        let mut stderr = read_capture(&stderr_path)?;
        oversized |= stdout.len() > limit || stderr.len() > limit;
        stdout.truncate(limit);
        stderr.truncate(limit);
        Ok(CapturedCommandOutput {
            status,
            stdout,
            stderr,
            timed_out,
            oversized,
        })
    })();
    let _ = fs::remove_dir_all(capture_dir);
    result
}

fn image_data_url(app: &AppHandle, image_path: &str) -> Result<String, String> {
    let path = managed_image_path(app, image_path)?;
    let bytes = fs::read(&path).map_err(|error| format!("无法读取题目图片：{error}"))?;
    let mime = match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        _ => return Err("真实 AI 请求仅支持 JPG、PNG 和 WebP".to_string()),
    };
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

fn antigravity_command(command_path: &str) -> Result<PathBuf, String> {
    let trimmed = command_path.trim();
    if trimmed.is_empty() {
        return Err("Antigravity CLI 路径不能为空".to_string());
    }
    let candidate = Path::new(trimmed);
    if candidate.components().count() == 1 {
        return Ok(PathBuf::from(trimmed));
    }
    if !candidate.is_absolute() {
        return Err("Antigravity CLI 请填写命令名或绝对路径".to_string());
    }
    let resolved = candidate
        .canonicalize()
        .map_err(|error| format!("无法读取 Antigravity CLI：{error}"))?;
    if !resolved.is_file() {
        return Err("Antigravity CLI 路径不是文件".to_string());
    }
    Ok(resolved)
}

fn antigravity_response(body: &str) -> Result<String, String> {
    let envelope: Value =
        serde_json::from_str(body).map_err(|error| format!("CLI 输出封套不是 JSON：{error}"))?;
    if envelope.get("status").and_then(Value::as_str) != Some("SUCCESS") {
        return Err(envelope
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("Agent 执行失败")
            .to_string());
    }
    if let Some(structured) = envelope.get("structured_output") {
        if !structured.is_null() {
            return serde_json::to_string(structured)
                .map_err(|error| format!("无法读取 CLI 结构化输出：{error}"));
        }
    }
    envelope
        .get("response")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "CLI 输出封套缺少 response".to_string())
}

fn response_content(response: &Value) -> Result<String, String> {
    let content = response
        .pointer("/choices/0/message/content")
        .ok_or_else(|| "API 响应缺少 choices[0].message.content".to_string())?;
    if let Some(text) = content.as_str() {
        return Ok(text.to_string());
    }
    if let Some(parts) = content.as_array() {
        let text = parts
            .iter()
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("");
        if !text.is_empty() {
            return Ok(text);
        }
    }
    Err("API 返回了不支持的消息内容格式".to_string())
}

fn provider_error_message(body: &str) -> String {
    if let Ok(value) = serde_json::from_str::<Value>(body) {
        if let Some(message) = value
            .pointer("/error/message")
            .or_else(|| value.get("message"))
            .and_then(Value::as_str)
        {
            return message.trim().to_string();
        }
    }
    body.trim().chars().take(1200).collect()
}

fn safe_provider_message(message: &str, api_key: &str) -> String {
    let mut safe = if api_key.is_empty() {
        message.to_string()
    } else {
        message.replace(api_key, "[已隐藏]")
    };
    for marker in ["Bearer ", "bearer "] {
        let mut cursor = 0;
        while let Some(relative_start) = safe[cursor..].find(marker) {
            let start = cursor + relative_start;
            let token_start = start + marker.len();
            let token_len = safe[token_start..]
                .find(|character: char| {
                    character.is_whitespace() || matches!(character, '"' | '\'' | ',' | '}')
                })
                .unwrap_or(safe.len() - token_start);
            safe.replace_range(token_start..token_start + token_len, "[已隐藏]");
            cursor = token_start + "[已隐藏]".len();
        }
    }
    safe.trim().chars().take(500).collect()
}

fn response_format_rejected(status: u16, message: &str) -> bool {
    if !matches!(status, 400 | 422) {
        return false;
    }
    let lower = message.to_ascii_lowercase();
    let mentions_format = lower.contains("response_format")
        || lower.contains("response format")
        || lower.contains("json_schema")
        || lower.contains("json schema");
    let unavailable = lower.contains("unavailable")
        || lower.contains("unsupported")
        || lower.contains("not supported")
        || lower.contains("does not support")
        || lower.contains("unknown type");
    mentions_format && unavailable
}

fn next_response_format_mode(
    current: ResponseFormatMode,
    has_schema: bool,
) -> Option<ResponseFormatMode> {
    match current {
        ResponseFormatMode::JsonSchema if has_schema => Some(ResponseFormatMode::JsonObject),
        ResponseFormatMode::JsonSchema | ResponseFormatMode::JsonObject => {
            Some(ResponseFormatMode::None)
        }
        ResponseFormatMode::None => None,
    }
}

fn response_format_cache_key(provider_id: &str, endpoint: &Url, model: &str) -> String {
    format!(
        "{}:{}:{}",
        provider_id.trim(),
        endpoint.as_str(),
        model.trim()
    )
}

fn cached_response_format(key: &str) -> Option<ResponseFormatMode> {
    RESPONSE_FORMAT_CACHE
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .ok()
        .and_then(|cache| cache.get(key).copied())
}

fn remember_response_format(key: String, mode: ResponseFormatMode) {
    if let Ok(mut cache) = RESPONSE_FORMAT_CACHE
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
    {
        cache.insert(key, mode);
    }
}

fn build_chat_completion_body(
    model: &str,
    prompt: &str,
    user_content: &[Value],
    schema: Option<&Value>,
    mode: ResponseFormatMode,
    stream: bool,
) -> Value {
    let mut body = json!({
        "model": model,
        "temperature": 0.1,
        "messages": [
            { "role": "system", "content": prompt },
            { "role": "user", "content": user_content }
        ]
    });
    match mode {
        ResponseFormatMode::JsonSchema => {
            if let Some(schema) = schema {
                body["response_format"] = json!({
                    "type": "json_schema",
                    "json_schema": { "name": "axiom_output", "schema": schema }
                });
            }
        }
        ResponseFormatMode::JsonObject => {
            body["response_format"] = json!({ "type": "json_object" });
        }
        ResponseFormatMode::None => {}
    }
    if stream {
        body["stream"] = json!(true);
    }
    body
}

fn normalized_ai_usage(value: &Value) -> Option<Value> {
    let usage = value.get("usage")?;
    let token = |primary: &str, fallback: &str| {
        usage
            .get(primary)
            .or_else(|| usage.get(fallback))
            .and_then(Value::as_i64)
            .filter(|value| *value >= 0)
    };
    let prompt_tokens = token("prompt_tokens", "input_tokens");
    let completion_tokens = token("completion_tokens", "output_tokens");
    let total_tokens = token("total_tokens", "total_token_count").or_else(|| {
        prompt_tokens
            .zip(completion_tokens)
            .map(|(input, output)| input + output)
    });
    if prompt_tokens.is_none() && completion_tokens.is_none() && total_tokens.is_none() {
        return None;
    }
    Some(json!({
        "promptTokens": prompt_tokens,
        "completionTokens": completion_tokens,
        "totalTokens": total_tokens,
    }))
}

fn is_vision_unsupported(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    [
        "does not support image",
        "doesn't support image",
        "image input is not supported",
        "image inputs are not supported",
        "vision is not supported",
        "text-only model",
        "not a multimodal",
        "不支持图片",
        "不支持图像",
        "纯文本模型",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

fn native_ai_error(
    code: &str,
    title: &str,
    user_message: &str,
    retryable: bool,
    fallback_allowed: bool,
    http_status: Option<u16>,
    detail_safe: String,
) -> Value {
    let occurred_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
        .unwrap_or(0);
    json!({
        "code": code,
        "title": title,
        "userMessage": user_message,
        "retryable": retryable,
        "fallbackAllowed": fallback_allowed,
        "providerId": null,
        "model": null,
        "httpStatus": http_status,
        "runId": null,
        "attemptId": null,
        "detailSafe": detail_safe,
        "occurredAt": occurred_at
    })
}

fn http_ai_error(
    status: u16,
    vision_unsupported: bool,
    endpoint_host: &str,
    provider_message: &str,
    attempted_formats: &[String],
) -> Value {
    let detail = format!(
        "stage=provider_http; host={endpoint_host}; status={status}; formats={}; provider={}",
        attempted_formats.join(","),
        provider_message
    );
    if vision_unsupported {
        return native_ai_error(
            "MODEL_CAPABILITY_ERROR",
            "当前模型不支持此任务",
            "请选择支持图片输入的模型后重新运行。",
            false,
            true,
            Some(status),
            detail,
        );
    }
    let (code, title, default_message, retryable, fallback) = match status {
        401 | 403 => (
            "AUTHENTICATION_ERROR",
            "AI 服务认证失败",
            "API Key 无效或没有访问当前模型的权限，请检查 Provider 设置。",
            false,
            false,
        ),
        408 => (
            "TIMEOUT_ERROR",
            "AI 分析超时",
            "模型服务响应超时，可以重新尝试。",
            true,
            true,
        ),
        429 => (
            "RATE_LIMIT_ERROR",
            "模型服务繁忙",
            "请求过于频繁或当前额度受限，请稍后重试。",
            true,
            true,
        ),
        400..=499 => (
            "REQUEST_INVALID",
            "AI 请求无法发送",
            "Provider 拒绝了请求，请检查模型能力与请求配置。",
            false,
            false,
        ),
        _ => (
            "PROVIDER_ERROR",
            "模型服务暂时不可用",
            "Provider 未能完成请求，可以重新尝试。",
            true,
            true,
        ),
    };
    let message = if matches!(status, 400..=499) && !provider_message.is_empty() {
        format!("Provider 拒绝了请求：{provider_message}")
    } else {
        default_message.to_string()
    };
    native_ai_error(
        code,
        title,
        &message,
        retryable,
        fallback,
        Some(status),
        detail,
    )
}

#[tauri::command(rename_all = "camelCase")]
pub async fn analyze_problem_with_openai_compatible(
    app: AppHandle,
    request: OpenAICompatibleAnalysisRequest,
    on_chunk: Channel<StreamChunk>,
    stream: Option<bool>,
) -> Result<Value, String> {
    let endpoint = endpoint_url(&request.base_url)?;
    let endpoint_host = endpoint.host_str().unwrap_or("unknown").to_string();
    let model = request.model.trim();
    if model.is_empty() {
        return Err("Model 不能为空".to_string());
    }
    // The credential never crosses IPC and is never copied into ModelRun or
    // request diagnostics.  SQLite is the persistent source across app swaps.
    let api_key = load_provider_api_key(&app, &request.provider_id).await?;
    let prompt = request.prompt.trim();
    if prompt.is_empty() {
        return Err("分析 Prompt 不能为空".to_string());
    }

    // 合并 crop_image_path 与 image_paths（去重、限流）
    let mut requested_paths: Vec<String> = Vec::new();
    if let Some(crop) = request.crop_image_path.as_ref() {
        let trimmed = crop.trim();
        if !trimmed.is_empty() {
            requested_paths.push(trimmed.to_string());
        }
    }
    for path in &request.image_paths {
        let trimmed = path.trim();
        if !trimmed.is_empty() && !requested_paths.iter().any(|p| p == trimmed) {
            requested_paths.push(trimmed.to_string());
        }
    }
    if requested_paths.len() > MAX_IMAGE_COUNT {
        return Err(format!("单次 AI 请求最多支持 {MAX_IMAGE_COUNT} 张图片"));
    }

    // 构造 user content：纯文本任务无图片，视觉任务含图片
    let user_text = request
        .user_text
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or("请根据输入内容生成符合 Schema 的 JSON。");
    let mut user_content: Vec<Value> = vec![json!({ "type": "text", "text": user_text })];
    for path in &requested_paths {
        let data_url = image_data_url(&app, path)?;
        user_content.push(json!({
            "type": "image_url",
            "image_url": { "url": data_url, "detail": "high" }
        }));
    }

    let schema = request
        .json_schema
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .and_then(|value| serde_json::from_str::<Value>(value).ok());
    let stream_enabled = stream.unwrap_or(false);
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        // 流式模式下不设全局 timeout（由 SSE 流自身控制）
        .timeout(if stream_enabled {
            Duration::from_secs(300)
        } else {
            Duration::from_secs(120)
        })
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("无法初始化 API 客户端：{error}"))?;
    let cache_key = response_format_cache_key(&request.provider_id, &endpoint, model);
    let default_mode = if schema.is_some() {
        ResponseFormatMode::JsonSchema
    } else {
        ResponseFormatMode::JsonObject
    };
    let mut format_mode = cached_response_format(&cache_key).unwrap_or(default_mode);
    if format_mode == ResponseFormatMode::JsonSchema && schema.is_none() {
        format_mode = ResponseFormatMode::JsonObject;
    }
    let mut attempted_formats = Vec::new();
    let response = loop {
        attempted_formats.push(format_mode.as_str().to_string());
        let body = build_chat_completion_body(
            model,
            prompt,
            &user_content,
            schema.as_ref(),
            format_mode,
            stream_enabled,
        );
        let response = client
            .post(endpoint.clone())
            .bearer_auth(&api_key)
            .json(&body)
            .send()
            .await
            .map_err(|error| format!("AI API 请求失败：{error}"))?;
        let status = response.status();
        if status.is_success() {
            remember_response_format(cache_key.clone(), format_mode);
            break response;
        }
        let bytes = response
            .bytes()
            .await
            .map_err(|error| format!("无法读取 AI API 错误响应：{error}"))?;
        if bytes.len() > MAX_RESPONSE_BYTES {
            return Err("AI API 错误响应超过 2 MB".to_string());
        }
        let response_text = String::from_utf8_lossy(&bytes).to_string();
        let provider_message = provider_error_message(&response_text);
        if response_format_rejected(status.as_u16(), &provider_message) {
            if let Some(next_mode) = next_response_format_mode(format_mode, schema.is_some()) {
                format_mode = next_mode;
                continue;
            }
        }
        let safe_message = safe_provider_message(&provider_message, &api_key);
        let vision_unsupported = is_vision_unsupported(&safe_message);
        let error_message = if vision_unsupported {
            format!(
                "当前模型不支持图片输入，请选择视觉模型。HTTP {}：{}",
                status.as_u16(),
                safe_message
            )
        } else {
            format!(
                "AI API 请求失败（HTTP {}）：{}",
                status.as_u16(),
                if safe_message.is_empty() {
                    "Provider 未返回错误详情"
                } else {
                    &safe_message
                }
            )
        };
        return Ok(json!({
            "rawOutput": response_text,
            "errorMessage": error_message,
            "error": http_ai_error(status.as_u16(), vision_unsupported, &endpoint_host, &safe_message, &attempted_formats),
            "responseFormatMode": format_mode.as_str(),
            "attemptedResponseFormats": attempted_formats,
        }));
    };

    // ── 流式分支：SSE 逐 chunk 读取，通过 Channel 推送增量 ──
    if stream_enabled {
        let channel = on_chunk;
        let mut accumulated = String::new();
        let mut buffer = String::new();
        let mut stream = response.bytes_stream();
        let mut total_bytes: usize = 0;
        let mut usage: Option<Value> = None;

        while let Some(chunk_result) = stream.next().await {
            let chunk = chunk_result.map_err(|error| format!("读取 SSE 流失败：{error}"))?;
            total_bytes += chunk.len();
            if total_bytes > MAX_RESPONSE_BYTES {
                return Err("AI API 流式响应超过 2 MB".to_string());
            }
            buffer.push_str(&String::from_utf8_lossy(&chunk));

            // SSE 以 \n\n 分隔事件，每行 `data: {json}` 或 `data: [DONE]`
            while let Some(newline_pos) = buffer.find('\n') {
                let line: String = buffer.drain(..=newline_pos).collect();
                let trimmed = line.trim_end_matches('\r').trim();
                if trimmed.is_empty() || !trimmed.starts_with("data:") {
                    continue;
                }
                let data = trimmed["data:".len()..].trim();
                if data == "[DONE]" {
                    continue;
                }
                // 解析 SSE chunk JSON，提取 delta.content
                let chunk_json: Value = match serde_json::from_str(data) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                if let Some(chunk_usage) = normalized_ai_usage(&chunk_json) {
                    usage = Some(chunk_usage);
                }
                let delta = chunk_json
                    .pointer("/choices/0/delta/content")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                if delta.is_empty() {
                    continue;
                }
                accumulated.push_str(delta);
                // 推送增量到前端（忽略 Channel 已关闭的错误）
                let _ = channel.send(StreamChunk {
                    accumulated: accumulated.clone(),
                    delta: delta.to_string(),
                });
            }
        }

        if is_vision_unsupported(&accumulated) {
            return Ok(json!({
                "rawOutput": accumulated,
                "errorMessage": "当前模型不支持图片输入，请选择视觉模型。",
                "error": native_ai_error("MODEL_CAPABILITY_ERROR", "当前模型不支持此任务", "请选择支持图片输入的模型后重新运行。", false, true, None, "stage=stream_content".to_string()),
                "responseFormatMode": format_mode.as_str(),
                "attemptedResponseFormats": attempted_formats,
            }));
        }
        return Ok(json!({
            "rawOutput": accumulated,
            "errorMessage": null,
            "usage": usage,
            "responseFormatMode": format_mode.as_str(),
            "attemptedResponseFormats": attempted_formats,
        }));
    }

    // ── 非流式分支（原有逻辑） ──
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("无法读取 AI API 响应：{error}"))?;
    if bytes.len() > MAX_RESPONSE_BYTES {
        return Err("AI API 响应超过 2 MB".to_string());
    }
    let response_text = String::from_utf8_lossy(&bytes);
    let response_json: Value = match serde_json::from_slice(&bytes) {
        Ok(value) => value,
        Err(error) => {
            return Ok(json!({
                "rawOutput": response_text,
                "errorMessage": format!("AI API 响应不是 JSON：{error}"),
                "error": native_ai_error("MODEL_OUTPUT_ERROR", "模型返回内容无法解析", "模型服务没有返回可读取的结构化响应。", true, true, None, format!("stage=provider_envelope_json; kind={:?}", error.classify())),
                "responseFormatMode": format_mode.as_str(),
                "attemptedResponseFormats": attempted_formats,
            }));
        }
    };
    let content = match response_content(&response_json) {
        Ok(value) => value,
        Err(error) => {
            return Ok(json!({
                "rawOutput": response_text,
                "errorMessage": error,
                "error": native_ai_error("MODEL_OUTPUT_ERROR", "模型返回内容无法解析", "模型响应中没有可读取的结果。", true, true, None, "stage=response_content".to_string()),
                "responseFormatMode": format_mode.as_str(),
                "attemptedResponseFormats": attempted_formats,
            }));
        }
    };
    let usage = normalized_ai_usage(&response_json);
    if is_vision_unsupported(&content) {
        return Ok(json!({
            "rawOutput": content,
            "errorMessage": "当前模型不支持图片输入，请选择视觉模型。",
            "error": native_ai_error("MODEL_CAPABILITY_ERROR", "当前模型不支持此任务", "请选择支持图片输入的模型后重新运行。", false, true, None, "stage=response_content".to_string()),
            "responseFormatMode": format_mode.as_str(),
            "attemptedResponseFormats": attempted_formats,
        }));
    }
    Ok(json!({
        "rawOutput": content,
        "errorMessage": null,
        "usage": usage,
        "responseFormatMode": format_mode.as_str(),
        "attemptedResponseFormats": attempted_formats,
    }))
}

#[tauri::command]
pub async fn analyze_problem_with_antigravity_cli(
    app: AppHandle,
    request: AntigravityCLIAnalysisRequest,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        analyze_problem_with_antigravity_cli_blocking(app, request)
    })
    .await
    .map_err(|error| format!("Antigravity CLI 后台任务异常：{error}"))?
}

fn analyze_problem_with_antigravity_cli_blocking(
    app: AppHandle,
    request: AntigravityCLIAnalysisRequest,
) -> Result<Value, String> {
    let command_path = antigravity_command(&request.command_path)?;
    let model = request.model.trim();
    if model.is_empty() {
        return Err("Model 不能为空".to_string());
    }
    let prompt = request.prompt.trim();
    if prompt.is_empty() {
        return Err("分析 Prompt 不能为空".to_string());
    }
    let schema = request.json_schema.trim();
    if schema.is_empty() {
        return Err("JSON Schema 不能为空".to_string());
    }
    serde_json::from_str::<Value>(schema).map_err(|error| format!("JSON Schema 无效：{error}"))?;

    let mut requested_paths = request.image_paths;
    if let Some(crop_image_path) = request.crop_image_path {
        requested_paths.insert(0, crop_image_path);
    }
    requested_paths.retain(|path| !path.trim().is_empty());
    if requested_paths.is_empty() {
        return Err("至少需要一张题目图片".to_string());
    }
    if requested_paths.len() > MAX_IMAGE_COUNT * 4 {
        return Err("单次 AI 请求包含过多重复图片路径".to_string());
    }
    let mut image_paths = Vec::with_capacity(requested_paths.len());
    let mut total_image_bytes = 0_u64;
    for requested_path in requested_paths {
        let path = managed_image_path(&app, &requested_path)?;
        if image_paths.contains(&path) {
            continue;
        }
        if image_paths.len() >= MAX_IMAGE_COUNT {
            return Err(format!("单次 AI 请求最多支持 {MAX_IMAGE_COUNT} 张图片"));
        }
        total_image_bytes = total_image_bytes.saturating_add(
            fs::metadata(&path)
                .map_err(|error| format!("无法读取题目图片：{error}"))?
                .len(),
        );
        if total_image_bytes > MAX_IMAGE_TOTAL_BYTES {
            return Err("单次 AI 请求的图片总大小不能超过 60 MB".to_string());
        }
        image_paths.push(path);
    }
    let mut image_parents = Vec::new();
    for parent in image_paths.iter().filter_map(|path| path.parent()) {
        if !image_parents.contains(&parent) {
            image_parents.push(parent);
        }
    }
    let image_prompt = image_paths
        .iter()
        .map(|path| format!("@{}", path.to_string_lossy()))
        .collect::<Vec<_>>()
        .join(" ");
    let full_prompt =
        format!("{prompt}\n\n请使用视觉能力直接读取并分析这些本地题目图片：{image_prompt}");

    let mut command = Command::new(&command_path);
    command
        .arg("--print-timeout")
        .arg("100s")
        .arg("--model")
        .arg(model)
        .arg("--output-format")
        .arg("json")
        .arg("--json-schema")
        .arg(schema)
        .arg("--dangerously-skip-permissions");
    for parent in image_parents {
        command.arg("--add-dir").arg(parent);
    }
    command.arg("--print").arg(full_prompt);
    let captured =
        run_command_with_file_capture(&mut command, Duration::from_secs(120), MAX_RESPONSE_BYTES)?;
    if captured.oversized {
        return Ok(json!({
            "rawOutput": String::from_utf8_lossy(&captured.stdout),
            "errorMessage": "Antigravity CLI 输出或日志超过 2 MB，已终止"
        }));
    }
    if captured.timed_out {
        return Ok(json!({
            "rawOutput": String::from_utf8_lossy(&captured.stdout),
            "errorMessage": "Antigravity CLI 超过 120 秒，已终止"
        }));
    }
    let status = captured
        .status
        .ok_or_else(|| "Antigravity CLI 未返回退出状态".to_string())?;
    let envelope_output = String::from_utf8_lossy(&captured.stdout).trim().to_string();
    let stderr_text = String::from_utf8_lossy(&captured.stderr);
    if !status.success() {
        let details: String = stderr_text.trim().chars().take(1200).collect();
        let cli_error = antigravity_response(&envelope_output)
            .err()
            .unwrap_or_else(|| "Agent 执行失败".to_string());
        let details_suffix = if details.is_empty() {
            String::new()
        } else {
            format!("；{details}")
        };
        return Ok(json!({
            "rawOutput": envelope_output,
            "errorMessage": format!(
                "Antigravity CLI 调用失败（退出码 {}）：{}{}",
                status.code().map_or_else(|| "未知".to_string(), |code| code.to_string()),
                cli_error,
                details_suffix
            )
        }));
    }
    let raw_output = match antigravity_response(&envelope_output) {
        Ok(response) => response.trim().to_string(),
        Err(error) => {
            return Ok(json!({
                "rawOutput": envelope_output,
                "errorMessage": format!("无法解析 Antigravity CLI 输出：{error}")
            }));
        }
    };
    if raw_output.is_empty() {
        // 将 envelope 原文与 stderr 一并暴露，便于排查 CLI 返回 SUCCESS 但内容为空的根因
        let stderr_excerpt: String = stderr_text.trim().chars().take(800).collect();
        let envelope_excerpt: String = envelope_output.chars().take(800).collect();
        let diagnostic = if !stderr_excerpt.is_empty() {
            format!("（envelope: {envelope_excerpt}; stderr: {stderr_excerpt}）")
        } else if !envelope_excerpt.is_empty() {
            format!("（envelope: {envelope_excerpt}）")
        } else {
            String::new()
        };
        return Ok(json!({
            "rawOutput": "",
            "errorMessage": format!("Antigravity CLI 未返回内容{diagnostic}")
        }));
    }
    if is_vision_unsupported(&raw_output) {
        return Ok(json!({
            "rawOutput": raw_output,
            "errorMessage": "当前 Antigravity 模型不支持图片输入，请选择视觉模型。"
        }));
    }
    Ok(json!({
        "rawOutput": raw_output,
        "errorMessage": null
    }))
}

#[cfg(test)]
mod tests {
    use super::{
        antigravity_command, antigravity_response, build_chat_completion_body,
        clear_ai_provider_api_key, endpoint_url, http_ai_error, is_vision_unsupported,
        load_provider_api_key_from_connection, next_response_format_mode, normalized_ai_usage,
        persist_ai_provider_profiles_in_connection, provider_error_message,
        read_ai_provider_save_statuses, response_format_rejected, run_command_with_file_capture,
        safe_provider_message, upsert_ai_provider_profile, validate_provider_save_statuses,
        PersistedAIProviderProfile, ResponseFormatMode,
    };
    use sqlx::{sqlite::SqliteConnectOptions, ConnectOptions, Connection, Executor};
    use std::{
        process::Command,
        time::{Duration, Instant},
    };

    #[test]
    fn normalizes_openai_and_responses_usage_without_inventing_missing_values() {
        let openai = normalized_ai_usage(&serde_json::json!({
            "usage": { "prompt_tokens": 120, "completion_tokens": 30, "total_tokens": 150 }
        }))
        .unwrap();
        assert_eq!(openai["promptTokens"], 120);
        assert_eq!(openai["completionTokens"], 30);
        assert_eq!(openai["totalTokens"], 150);

        let responses = normalized_ai_usage(&serde_json::json!({
            "usage": { "input_tokens": 9, "output_tokens": 4 }
        }))
        .unwrap();
        assert_eq!(responses["totalTokens"], 13);
        assert!(normalized_ai_usage(&serde_json::json!({ "usage": {} })).is_none());
        assert!(normalized_ai_usage(&serde_json::json!({
            "usage": { "total_tokens": -1 }
        }))
        .is_none());
    }

    #[test]
    fn builds_compatible_chat_completion_endpoint() {
        assert_eq!(
            endpoint_url("https://example.com/v1").unwrap().as_str(),
            "https://example.com/v1/chat/completions"
        );
        assert!(endpoint_url("http://example.com/v1").is_err());
        assert!(endpoint_url("http://127.0.0.1:1234/v1").is_ok());
    }

    #[test]
    fn extracts_provider_error_and_detects_text_only_models() {
        let message = provider_error_message(
            r#"{"error":{"message":"This model does not support image inputs"}}"#,
        );
        assert_eq!(message, "This model does not support image inputs");
        assert!(is_vision_unsupported(&message));
        assert!(!is_vision_unsupported("rate limit exceeded"));
    }

    #[test]
    fn builds_each_safe_response_format_body() {
        let schema = serde_json::json!({"type":"object"});
        let content = vec![serde_json::json!({"type":"text","text":"return json"})];
        let strict = build_chat_completion_body(
            "model",
            "prompt",
            &content,
            Some(&schema),
            ResponseFormatMode::JsonSchema,
            false,
        );
        assert_eq!(strict["response_format"]["type"], "json_schema");
        let object = build_chat_completion_body(
            "model",
            "prompt",
            &content,
            Some(&schema),
            ResponseFormatMode::JsonObject,
            true,
        );
        assert_eq!(object["response_format"]["type"], "json_object");
        assert_eq!(object["stream"], true);
        let plain = build_chat_completion_body(
            "model",
            "prompt",
            &content,
            Some(&schema),
            ResponseFormatMode::None,
            false,
        );
        assert!(plain.get("response_format").is_none());
    }

    #[test]
    fn downgrades_only_explicit_response_format_rejections() {
        let deepseek = "This response_format type is unavailable now";
        assert!(response_format_rejected(400, deepseek));
        assert_eq!(
            next_response_format_mode(ResponseFormatMode::JsonSchema, true),
            Some(ResponseFormatMode::JsonObject)
        );
        assert_eq!(
            next_response_format_mode(ResponseFormatMode::JsonObject, true),
            Some(ResponseFormatMode::None)
        );
        assert!(!response_format_rejected(401, deepseek));
        assert!(!response_format_rejected(400, "model does not exist"));
        assert!(!response_format_rejected(
            429,
            "response_format unavailable"
        ));
    }

    #[test]
    fn redacts_provider_credentials_before_diagnostics() {
        let safe = safe_provider_message(
            "Bearer sk-secret failed and sk-secret was echoed",
            "sk-secret",
        );
        assert!(!safe.contains("sk-secret"));
        assert!(safe.contains("[已隐藏]"));
    }

    #[test]
    fn maps_http_failures_to_stable_safe_error_codes() {
        for (status, expected, retryable, fallback) in [
            (401, "AUTHENTICATION_ERROR", false, false),
            (403, "AUTHENTICATION_ERROR", false, false),
            (429, "RATE_LIMIT_ERROR", true, true),
            (503, "PROVIDER_ERROR", true, true),
            (400, "REQUEST_INVALID", false, false),
        ] {
            let error = http_ai_error(
                status,
                false,
                "api.example.test",
                "provider detail",
                &["json_object".to_string()],
            );
            assert_eq!(error["code"], expected);
            assert_eq!(error["retryable"], retryable);
            assert_eq!(error["fallbackAllowed"], fallback);
            assert_eq!(error["httpStatus"], status);
            assert!(error["detailSafe"]
                .as_str()
                .unwrap()
                .contains("api.example.test"));
        }
        assert_eq!(
            http_ai_error(
                400,
                true,
                "api.example.test",
                "image unsupported",
                &["json_object".to_string()],
            )["code"],
            "MODEL_CAPABILITY_ERROR"
        );
    }

    #[test]
    fn validates_antigravity_command_configuration() {
        assert_eq!(
            antigravity_command("agy").unwrap(),
            std::path::PathBuf::from("agy")
        );
        assert!(antigravity_command("").is_err());
        assert!(antigravity_command("./agy").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn file_capture_does_not_wait_for_descendant_to_close_output() {
        let mut command = Command::new("sh");
        command.arg("-c").arg("(sleep 2) & printf done");
        let started_at = Instant::now();
        let output = run_command_with_file_capture(&mut command, Duration::from_secs(1), 1024)
            .expect("shell command should be captured");

        assert!(started_at.elapsed() < Duration::from_secs(1));
        assert_eq!(String::from_utf8_lossy(&output.stdout), "done");
        assert!(output.status.is_some_and(|status| status.success()));
        assert!(!output.timed_out);
    }

    #[test]
    fn extracts_antigravity_json_envelope_response() {
        assert_eq!(
            antigravity_response(r#"{"status":"SUCCESS","response":"{\"title\":\"代数\"}\n"}"#)
                .unwrap(),
            "{\"title\":\"代数\"}\n"
        );
        assert_eq!(
            antigravity_response(
                r#"{"status":"SUCCESS","response":"ignored","structured_output":{"ok":true}}"#
            )
            .unwrap(),
            r#"{"ok":true}"#
        );
        assert!(
            antigravity_response(r#"{"status":"ERROR","response":"","error":"model failed"}"#)
                .unwrap_err()
                .contains("model failed")
        );
    }

    #[cfg(unix)]
    #[test]
    fn bounds_cli_output_capture() {
        let mut command = Command::new("sh");
        command.arg("-c").arg("printf '%0128d' 0");
        let output = run_command_with_file_capture(&mut command, Duration::from_secs(1), 32)
            .expect("shell output should be captured");

        assert_eq!(output.stdout.len(), 32);
        assert!(output.oversized);
    }

    #[test]
    fn sqlite_provider_key_survives_a_simulated_app_bundle_replacement() {
        tauri::async_runtime::block_on(async {
            let path = std::env::temp_dir().join(format!(
                "axiom-provider-key-update-{}.db",
                uuid::Uuid::new_v4()
            ));
            let options = SqliteConnectOptions::new()
                .filename(&path)
                .create_if_missing(true);
            let mut old_app = options.connect().await.unwrap();
            old_app
                .execute(
                    "CREATE TABLE ai_provider_profiles (
                       id TEXT PRIMARY KEY NOT NULL,
                       api_key TEXT NOT NULL DEFAULT ''
                     )",
                )
                .await
                .unwrap();
            old_app
                .execute(
                    "INSERT INTO ai_provider_profiles (id, api_key)
                     VALUES ('provider', 'sk-update-persistence-test')",
                )
                .await
                .unwrap();
            drop(old_app);

            // A self-update replaces only Axiom.app.  Opening the same stable
            // app-data database after that replacement must return the key.
            let options = SqliteConnectOptions::new()
                .filename(&path)
                .create_if_missing(false);
            let mut new_app = options.connect().await.unwrap();
            assert_eq!(
                load_provider_api_key_from_connection(&mut new_app, "provider")
                    .await
                    .unwrap(),
                "sk-update-persistence-test"
            );
            drop(new_app);
            let _ = std::fs::remove_file(path);
        });
    }

    #[test]
    fn database_key_loader_rejects_missing_or_empty_keys_without_keychain() {
        tauri::async_runtime::block_on(async {
            let mut conn = sqlx::SqliteConnection::connect(":memory:").await.unwrap();
            conn.execute(
                "CREATE TABLE ai_provider_profiles (
                   id TEXT PRIMARY KEY NOT NULL,
                   api_key TEXT NOT NULL DEFAULT ''
                 )",
            )
            .await
            .unwrap();
            conn.execute("INSERT INTO ai_provider_profiles (id, api_key) VALUES ('empty', '')")
                .await
                .unwrap();
            assert!(load_provider_api_key_from_connection(&mut conn, "empty")
                .await
                .unwrap_err()
                .contains("尚未保存"));
            assert!(load_provider_api_key_from_connection(&mut conn, "missing")
                .await
                .unwrap_err()
                .contains("找不到"));
        });
    }

    #[test]
    fn saving_an_empty_provider_list_deletes_the_last_mock_transactionally() {
        tauri::async_runtime::block_on(async {
            let mut conn = sqlx::SqliteConnection::connect(":memory:").await.unwrap();
            conn.execute(
                "CREATE TABLE ai_provider_profiles (
                   id TEXT PRIMARY KEY NOT NULL,
                   name TEXT NOT NULL,
                   provider TEXT NOT NULL,
                   base_url TEXT NOT NULL,
                   api_key TEXT NOT NULL DEFAULT '',
                   credential_ref TEXT NOT NULL DEFAULT '',
                   command_path TEXT NOT NULL DEFAULT '',
                   model TEXT NOT NULL,
                   input_cost_per_million_usd REAL,
                   output_cost_per_million_usd REAL,
                   supports_vision INTEGER NOT NULL,
                   supports_text INTEGER NOT NULL,
                   task_types_json TEXT NOT NULL DEFAULT '[]',
                   enabled INTEGER NOT NULL,
                   sort_order INTEGER NOT NULL,
                   created_at INTEGER NOT NULL,
                   updated_at INTEGER NOT NULL
                 )",
            )
            .await
            .unwrap();
            conn.execute(
                "INSERT INTO ai_provider_profiles (
                   id, name, provider, base_url, model, supports_vision,
                   supports_text, enabled, sort_order, created_at, updated_at
                 ) VALUES (
                   'mock-default', 'Mock Provider', 'mock', '', 'mock-vision-v1',
                   1, 1, 1, 0, 1, 1
                 )",
            )
            .await
            .unwrap();

            let statuses = persist_ai_provider_profiles_in_connection(&mut conn, &[])
                .await
                .expect("empty configuration should be valid");
            assert!(statuses.is_empty());
            let remaining: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM ai_provider_profiles")
                .fetch_one(&mut conn)
                .await
                .unwrap();
            assert_eq!(remaining, 0);
        });
    }

    #[test]
    fn sqlite_profile_save_preserves_blank_input_replaces_new_key_and_deletes_explicitly() {
        tauri::async_runtime::block_on(async {
            let mut conn = sqlx::SqliteConnection::connect(":memory:").await.unwrap();
            conn.execute(
                "CREATE TABLE ai_provider_profiles (
                   id TEXT PRIMARY KEY NOT NULL,
                   name TEXT NOT NULL,
                   provider TEXT NOT NULL,
                   base_url TEXT NOT NULL,
                   api_key TEXT NOT NULL DEFAULT '',
                   credential_ref TEXT NOT NULL DEFAULT '',
                   command_path TEXT NOT NULL DEFAULT '',
                   model TEXT NOT NULL,
                   input_cost_per_million_usd REAL,
                   output_cost_per_million_usd REAL,
                   supports_vision INTEGER NOT NULL,
                   supports_text INTEGER NOT NULL,
                   task_types_json TEXT NOT NULL DEFAULT '[]',
                   enabled INTEGER NOT NULL,
                   sort_order INTEGER NOT NULL,
                   created_at INTEGER NOT NULL,
                   updated_at INTEGER NOT NULL
                 )",
            )
            .await
            .unwrap();
            let mut profile = PersistedAIProviderProfile {
                id: "provider-a".to_string(),
                name: "Provider A".to_string(),
                provider: "openai_compatible".to_string(),
                base_url: "https://example.com/v1".to_string(),
                api_key: "sk-original-key".to_string(),
                credential_ref: "legacy-a".to_string(),
                command_path: "".to_string(),
                model: "model-a".to_string(),
                input_cost_per_million_usd: Some(0.15),
                output_cost_per_million_usd: Some(0.6),
                supports_vision: true,
                supports_text: true,
                task_types: vec!["problem_understanding".to_string()],
                enabled: true,
                sort_order: 0,
                created_at: 1,
                updated_at: 1,
            };
            upsert_ai_provider_profile(&mut conn, &profile)
                .await
                .unwrap();
            assert_eq!(
                load_provider_api_key_from_connection(&mut conn, "provider-a")
                    .await
                    .unwrap(),
                "sk-original-key"
            );

            // A blank field is the UI's "do not change" signal.
            profile.api_key.clear();
            profile.updated_at = 2;
            upsert_ai_provider_profile(&mut conn, &profile)
                .await
                .unwrap();
            assert_eq!(
                load_provider_api_key_from_connection(&mut conn, "provider-a")
                    .await
                    .unwrap(),
                "sk-original-key"
            );

            profile.api_key = "sk-replacement-key".to_string();
            profile.updated_at = 3;
            upsert_ai_provider_profile(&mut conn, &profile)
                .await
                .unwrap();
            assert_eq!(
                load_provider_api_key_from_connection(&mut conn, "provider-a")
                    .await
                    .unwrap(),
                "sk-replacement-key"
            );

            // Switching provider type with an empty edit field must not clear
            // the durable SQLite key.  Only the explicit delete command may
            // remove it.
            profile.provider = "antigravity_cli".to_string();
            profile.command_path = "agy".to_string();
            profile.model = "gemini-3.6-flash-high".to_string();
            profile.enabled = false;
            profile.api_key.clear();
            profile.credential_ref.clear();
            profile.updated_at = 4;
            upsert_ai_provider_profile(&mut conn, &profile)
                .await
                .unwrap();
            assert_eq!(
                load_provider_api_key_from_connection(&mut conn, "provider-a")
                    .await
                    .unwrap(),
                "sk-replacement-key"
            );

            let statuses = read_ai_provider_save_statuses(&mut conn).await.unwrap();
            let provider_status = statuses
                .iter()
                .find(|status| status.id == "provider-a")
                .unwrap();
            assert_eq!(provider_status.provider, "antigravity_cli");
            assert!(provider_status.has_api_key);
            assert_eq!(provider_status.api_key_suffix, "-key");
            validate_provider_save_statuses(std::slice::from_ref(&profile), &statuses).unwrap();

            let mut second = profile;
            second.id = "provider-b".to_string();
            second.name = "Provider B".to_string();
            second.api_key = "sk-second-key".to_string();
            second.provider = "openai_compatible".to_string();
            second.base_url = "https://example.com/v1".to_string();
            second.enabled = true;
            second.sort_order = 1;
            upsert_ai_provider_profile(&mut conn, &second)
                .await
                .unwrap();
            assert_eq!(
                load_provider_api_key_from_connection(&mut conn, "provider-b")
                    .await
                    .unwrap(),
                "sk-second-key"
            );

            clear_ai_provider_api_key(&mut conn, "provider-a")
                .await
                .unwrap();
            assert!(
                load_provider_api_key_from_connection(&mut conn, "provider-a")
                    .await
                    .is_err()
            );
            assert_eq!(
                load_provider_api_key_from_connection(&mut conn, "provider-b")
                    .await
                    .unwrap(),
                "sk-second-key"
            );
        });
    }
}
