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
use reqwest::Url;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES: u64 = 30 * 1024 * 1024;
const MAX_IMAGE_TOTAL_BYTES: u64 = 60 * 1024 * 1024;
const MAX_IMAGE_COUNT: usize = 8;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAICompatibleAnalysisRequest {
    base_url: String,
    model: String,
    /// Keychain 凭据引用（provider id），Rust 内部从 Keychain 读取实际 API Key。
    /// 不再接受明文 api_key，避免 key 经 IPC 回传前端。
    credential_ref: String,
    crop_image_path: String,
    prompt: String,
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

#[tauri::command]
pub async fn analyze_problem_with_openai_compatible(
    app: AppHandle,
    request: OpenAICompatibleAnalysisRequest,
) -> Result<Value, String> {
    let endpoint = endpoint_url(&request.base_url)?;
    let model = request.model.trim();
    if model.is_empty() {
        return Err("Model 不能为空".to_string());
    }
    let credential_ref = request.credential_ref.trim();
    if credential_ref.is_empty() {
        return Err("凭据引用不能为空（请先在设置中保存 API Key）".to_string());
    }
    // 从 Keychain 直接读取 API Key，不经过前端 IPC
    let api_key = crate::keystore::load_api_key_internal(credential_ref)?;
    if api_key.is_empty() {
        return Err("Keychain 中未找到 API Key，请重新保存".to_string());
    }
    let prompt = request.prompt.trim();
    if prompt.is_empty() {
        return Err("分析 Prompt 不能为空".to_string());
    }
    let image_url = image_data_url(&app, &request.crop_image_path)?;
    let body = json!({
        "model": model,
        "temperature": 0.1,
        "response_format": { "type": "json_object" },
        "messages": [
            {
                "role": "system",
                "content": prompt
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "请根据图片生成题目结构化信息和可浏览标题。"
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": image_url,
                            "detail": "high"
                        }
                    }
                ]
            }
        ]
    });

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(90))
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
        antigravity_command, antigravity_response, endpoint_url, is_vision_unsupported,
        provider_error_message, read_bounded,
    };
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
}
