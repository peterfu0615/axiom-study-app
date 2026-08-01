use std::{
    fs,
    io::{Read, Result as IoResult},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
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
    supports_vision: bool,
    supports_text: bool,
    enabled: bool,
    sort_order: i64,
    created_at: i64,
    updated_at: i64,
}

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
    Ok(())
}

async fn upsert_ai_provider_profile(
    conn: &mut sqlx::SqliteConnection,
    profile: &PersistedAIProviderProfile,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO ai_provider_profiles (
           id, name, provider, base_url, api_key, credential_ref, command_path, model,
           supports_vision, supports_text, enabled, sort_order, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
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
           supports_vision = excluded.supports_vision,
           supports_text = excluded.supports_text,
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
    .bind(profile.supports_vision)
    .bind(profile.supports_text)
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
    if profiles.is_empty() {
        return Err("请至少保留一个 Provider".to_string());
    }
    let mut ids = std::collections::HashSet::new();
    for profile in &profiles {
        provider_profile_error(profile)?;
        if !ids.insert(profile.id.trim().to_string()) {
            return Err("Provider ID 不能重复".to_string());
        }
    }
    let mut guard = state.connection.lock().await;
    let conn = guard.as_mut().ok_or("数据库连接尚未初始化")?;
    conn.execute("BEGIN IMMEDIATE")
        .await
        .map_err(|error| format!("无法开始 Provider 保存事务：{error}"))?;
    let result = async {
        let existing_ids = sqlx::query("SELECT id FROM ai_provider_profiles")
            .fetch_all(&mut *conn)
            .await
            .map_err(|error| format!("读取已有 Provider 失败：{error}"))?;
        for profile in &profiles {
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
        validate_provider_save_statuses(&profiles, &statuses)?;
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

fn read_bounded<R: Read>(
    mut reader: R,
    limit: usize,
    exceeded: Arc<AtomicBool>,
) -> IoResult<Vec<u8>> {
    let mut output = Vec::with_capacity(limit.min(64 * 1024));
    let mut buffer = [0_u8; 16 * 1024];
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            return Ok(output);
        }
        let remaining = limit.saturating_sub(output.len());
        output.extend_from_slice(&buffer[..read.min(remaining)]);
        if read > remaining {
            exceeded.store(true, Ordering::Release);
        }
    }
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

#[tauri::command(rename_all = "camelCase")]
pub async fn analyze_problem_with_openai_compatible(
    app: AppHandle,
    request: OpenAICompatibleAnalysisRequest,
    on_chunk: Channel<StreamChunk>,
    stream: Option<bool>,
) -> Result<Value, String> {
    let endpoint = endpoint_url(&request.base_url)?;
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

    // response_format：优先使用 json_schema（若 Provider 支持），否则 json_object
    let response_format = match request.json_schema.as_deref() {
        Some(schema_str) if !schema_str.trim().is_empty() => {
            // 校验 schema 是合法 JSON
            match serde_json::from_str::<Value>(schema_str) {
                Ok(schema_value) => json!({
                    "type": "json_schema",
                    "json_schema": { "name": "axiom_output", "schema": schema_value }
                }),
                Err(_) => json!({ "type": "json_object" }),
            }
        }
        _ => json!({ "type": "json_object" }),
    };

    // 当 stream 参数为 true 时启用流式输出
    let stream_enabled = stream.unwrap_or(false);
    let mut body = json!({
        "model": model,
        "temperature": 0.1,
        "response_format": response_format,
        "messages": [
            { "role": "system", "content": prompt },
            { "role": "user", "content": user_content }
        ]
    });
    if stream_enabled {
        body["stream"] = json!(true);
    }

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
    let response = client
        .post(endpoint)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("AI API 请求失败：{error}"))?;
    let status = response.status();

    // ── 流式分支：SSE 逐 chunk 读取，通过 Channel 推送增量 ──
    if stream_enabled {
        if !status.is_success() {
            let bytes = response
                .bytes()
                .await
                .map_err(|error| format!("无法读取 AI API 错误响应：{error}"))?;
            let response_text = String::from_utf8_lossy(&bytes);
            let provider_message = provider_error_message(&response_text);
            let error_message = if is_vision_unsupported(&provider_message) {
                format!(
                    "当前模型不支持图片输入，请选择视觉模型。HTTP {}：{}",
                    status.as_u16(),
                    provider_message
                )
            } else {
                format!(
                    "AI API 请求失败（HTTP {}）：{}",
                    status.as_u16(),
                    if provider_message.is_empty() {
                        "Provider 未返回错误详情"
                    } else {
                        &provider_message
                    }
                )
            };
            return Ok(json!({
                "rawOutput": response_text,
                "errorMessage": error_message
            }));
        }

        let channel = on_chunk;
        let mut accumulated = String::new();
        let mut buffer = String::new();
        let mut stream = response.bytes_stream();
        let mut total_bytes: usize = 0;

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
                "errorMessage": "当前模型不支持图片输入，请选择视觉模型。"
            }));
        }
        return Ok(json!({
            "rawOutput": accumulated,
            "errorMessage": null
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
    if !status.is_success() {
        let provider_message = provider_error_message(&response_text);
        let error_message = if is_vision_unsupported(&provider_message) {
            format!(
                "当前模型不支持图片输入，请选择视觉模型。HTTP {}：{}",
                status.as_u16(),
                provider_message
            )
        } else {
            format!(
                "AI API 请求失败（HTTP {}）：{}",
                status.as_u16(),
                if provider_message.is_empty() {
                    "Provider 未返回错误详情"
                } else {
                    &provider_message
                }
            )
        };
        return Ok(json!({
            "rawOutput": response_text,
            "errorMessage": error_message
        }));
    }
    let response_json: Value = match serde_json::from_slice(&bytes) {
        Ok(value) => value,
        Err(error) => {
            return Ok(json!({
                "rawOutput": response_text,
                "errorMessage": format!("AI API 响应不是 JSON：{error}")
            }));
        }
    };
    let content = match response_content(&response_json) {
        Ok(value) => value,
        Err(error) => {
            return Ok(json!({
                "rawOutput": response_text,
                "errorMessage": error
            }));
        }
    };
    if is_vision_unsupported(&content) {
        return Ok(json!({
            "rawOutput": content,
            "errorMessage": "当前模型不支持图片输入，请选择视觉模型。"
        }));
    }
    Ok(json!({
        "rawOutput": content,
        "errorMessage": null
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
    let mut child = command
        .arg("--print")
        .arg(full_prompt)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("无法启动 Antigravity CLI：{error}"))?;

    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法读取 Antigravity CLI 输出".to_string())?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法读取 Antigravity CLI 日志".to_string())?;
    let stdout_exceeded = Arc::new(AtomicBool::new(false));
    let stderr_exceeded = Arc::new(AtomicBool::new(false));
    let stdout_limit = Arc::clone(&stdout_exceeded);
    let stderr_limit = Arc::clone(&stderr_exceeded);
    let stdout_reader =
        thread::spawn(move || read_bounded(&mut stdout, MAX_RESPONSE_BYTES, stdout_limit));
    let stderr_reader =
        thread::spawn(move || read_bounded(&mut stderr, MAX_RESPONSE_BYTES, stderr_limit));

    let started_at = Instant::now();
    let mut timed_out = false;
    let mut oversized = false;
    let status = loop {
        if stdout_exceeded.load(Ordering::Acquire) || stderr_exceeded.load(Ordering::Acquire) {
            oversized = true;
            let _ = child.kill();
            let _ = child.wait();
            break None;
        }
        if started_at.elapsed() >= Duration::from_secs(120) {
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
    let stdout = stdout_reader
        .join()
        .map_err(|_| "读取 Antigravity CLI 输出失败".to_string())?
        .map_err(|error| format!("读取 Antigravity CLI 输出失败：{error}"))?;
    let stderr = stderr_reader
        .join()
        .map_err(|_| "读取 Antigravity CLI 日志失败".to_string())?
        .map_err(|error| format!("读取 Antigravity CLI 日志失败：{error}"))?;
    if oversized {
        return Ok(json!({
            "rawOutput": String::from_utf8_lossy(&stdout),
            "errorMessage": "Antigravity CLI 输出或日志超过 2 MB，已终止"
        }));
    }
    if timed_out {
        return Ok(json!({
            "rawOutput": String::from_utf8_lossy(&stdout),
            "errorMessage": "Antigravity CLI 超过 120 秒，已终止"
        }));
    }
    let status = status.ok_or_else(|| "Antigravity CLI 未返回退出状态".to_string())?;
    let envelope_output = String::from_utf8_lossy(&stdout).trim().to_string();
    let stderr_text = String::from_utf8_lossy(&stderr);
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
        antigravity_command, antigravity_response, clear_ai_provider_api_key, endpoint_url,
        is_vision_unsupported, load_provider_api_key_from_connection, provider_error_message,
        read_ai_provider_save_statuses, read_bounded, upsert_ai_provider_profile,
        validate_provider_save_statuses, PersistedAIProviderProfile,
    };
    use sqlx::{sqlite::SqliteConnectOptions, ConnectOptions, Connection, Executor};
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };

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
    fn validates_antigravity_command_configuration() {
        assert_eq!(
            antigravity_command("agy").unwrap(),
            std::path::PathBuf::from("agy")
        );
        assert!(antigravity_command("").is_err());
        assert!(antigravity_command("./agy").is_err());
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

    #[test]
    fn bounds_cli_output_while_continuing_to_drain_the_stream() {
        let exceeded = Arc::new(AtomicBool::new(false));
        let output = read_bounded(
            std::io::Cursor::new(vec![b'x'; 128]),
            32,
            Arc::clone(&exceeded),
        )
        .unwrap();
        assert_eq!(output.len(), 32);
        assert!(exceeded.load(Ordering::Acquire));
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
                   supports_vision INTEGER NOT NULL,
                   supports_text INTEGER NOT NULL,
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
                supports_vision: true,
                supports_text: true,
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
