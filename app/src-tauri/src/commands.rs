use std::{
    collections::HashSet,
    fs,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::{AtomicI64, Ordering},
    sync::{Arc, Mutex, OnceLock},
    thread,
    time::Duration,
    time::Instant,
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;
use wait_timeout::ChildExt;

use crate::models::{
    CameraOrientationInfo, DocumentProcessingResult, ImportedTextbookSource, MediaEntry,
    NativeCapabilities, NormalizedRect, PersistedMedia, PersistedProblemImage,
    TextbookExtractionResult,
};

const MAX_IMAGE_BYTES: usize = 30 * 1024 * 1024;
const MAX_TEXTBOOK_BYTES: u64 = 300 * 1024 * 1024;
const ALLOWED_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "webp"];
/// 教材提取的宽裕总超时。300 MB 的扫描版教材可能有数百页，Vision
/// accurate 模式每页数秒，最坏情况下整本 OCR 需要数十分钟；45 分钟
/// 足以覆盖这种极端输入，同时保证病态 PDF（渲染死循环、超大页数）
/// 不会让导入永远挂起。用户主动取消仍由 cancel 标志负责，不受此限制。
const TEXTBOOK_EXTRACTION_TIMEOUT: Duration = Duration::from_secs(45 * 60);
static CANCELLED_TEXTBOOK_IMPORTS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

fn cancelled_textbook_imports() -> &'static Mutex<HashSet<String>> {
    CANCELLED_TEXTBOOK_IMPORTS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn now_millis() -> Result<i64, String> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("系统时间不可用：{error}"))?;
    i64::try_from(duration.as_millis()).map_err(|_| "系统时间超出范围".to_string())
}

fn media_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?
        .join("media")
        .join("original");
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建图片目录：{error}"))?;
    Ok(directory)
}

fn corrected_media_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?
        .join("media")
        .join("corrected");
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建矫正图片目录：{error}"))?;
    Ok(directory)
}

fn problem_media_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?
        .join("media")
        .join("problems");
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建题块图片目录：{error}"))?;
    Ok(directory)
}

fn diagram_media_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?
        .join("media")
        .join("diagrams");
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建图形图片目录：{error}"))?;
    Ok(directory)
}

fn textbook_source_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?
        .join("textbooks");
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建教材目录：{error}"))?;
    Ok(directory)
}

fn textbook_import_temp_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("无法定位应用缓存目录：{error}"))?
        .join("curriculum-import");
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建教材临时目录：{error}"))?;
    Ok(directory)
}

fn textbook_import_cancelled(request_id: &str) -> bool {
    cancelled_textbook_imports()
        .lock()
        .map(|requests| requests.contains(request_id))
        .unwrap_or(false)
}

fn copy_and_hash_textbook(
    source: &Path,
    target: &Path,
    request_id: &str,
) -> Result<String, String> {
    let mut reader = BufReader::new(
        fs::File::open(source).map_err(|error| format!("无法读取教材文件：{error}"))?,
    );
    let mut writer =
        fs::File::create(target).map_err(|error| format!("保存教材文件失败：{error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 1024 * 1024];
    loop {
        if textbook_import_cancelled(request_id) {
            return Err("教材导入已取消".to_string());
        }
        let read = reader
            .read(&mut buffer)
            .map_err(|error| format!("读取教材文件失败：{error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        writer
            .write_all(&buffer[..read])
            .map_err(|error| format!("保存教材文件失败：{error}"))?;
    }
    writer
        .flush()
        .map_err(|error| format!("保存教材文件失败：{error}"))?;
    Ok(format!("{:x}", hasher.finalize()))
}

fn hash_textbook_file(path: &Path) -> Result<String, String> {
    let mut reader =
        BufReader::new(fs::File::open(path).map_err(|error| format!("无法读取教材文件：{error}"))?);
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 1024 * 1024];
    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|error| format!("读取教材文件失败：{error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn import_textbook_source(
    app: AppHandle,
    source_path: String,
    request_id: String,
) -> Result<ImportedTextbookSource, String> {
    tauri::async_runtime::spawn_blocking(move || {
        import_textbook_source_blocking(app, source_path, request_id)
    })
    .await
    .map_err(|error| format!("教材后台提取任务异常结束：{error}"))?
}

#[cfg(target_os = "macos")]
fn import_textbook_source_blocking(
    app: AppHandle,
    source_path: String,
    request_id: String,
) -> Result<ImportedTextbookSource, String> {
    let source = Path::new(&source_path)
        .canonicalize()
        .map_err(|error| format!("无法读取教材文件：{error}"))?;
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "pdf" | "jpg" | "jpeg" | "png" | "webp") {
        return Err("仅支持 PDF、JPG、PNG 和 WebP 教材或目录文件".to_string());
    }
    let metadata = fs::metadata(&source).map_err(|error| format!("无法读取教材文件：{error}"))?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_TEXTBOOK_BYTES {
        return Err("教材文件为空或超过 300 MB".to_string());
    }
    let id = Uuid::new_v4().to_string();
    let target = textbook_import_temp_directory(&app)?.join(format!("{id}.{extension}"));
    let content_hash = copy_and_hash_textbook(&source, &target, &request_id).inspect_err(|_| {
        let _ = fs::remove_file(&target);
    })?;

    let helper = vision_helper_path(&app)?;
    if !helper.is_file() {
        let _ = fs::remove_file(&target);
        return Err("本地教材提取器尚未构建".to_string());
    }
    let command = if extension == "pdf" {
        "extract-textbook"
    } else {
        "extract-textbook-image"
    };
    let mut child = Command::new(helper)
        .arg(command)
        .arg("--input")
        .arg(&target)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            let _ = fs::remove_file(&target);
            format!("无法启动教材提取器：{error}")
        })?;
    let mut stdout = child.stdout.take().ok_or("无法读取教材提取结果")?;
    let stderr = child.stderr.take().ok_or("无法读取教材提取日志")?;
    let stdout_thread = thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout.read_to_end(&mut bytes).map(|_| bytes)
    });
    let app_for_progress = app.clone();
    let processed_pages = Arc::new(AtomicI64::new(0));
    let processed_pages_for_progress = Arc::clone(&processed_pages);
    let progress_thread = thread::spawn(move || {
        let mut diagnostic = String::new();
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if let Some(payload) = line.strip_prefix("AXIOM_PROGRESS ") {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(payload) {
                    if let Some(current) = value.get("currentPage").and_then(|item| item.as_i64()) {
                        processed_pages_for_progress.fetch_max(current, Ordering::Relaxed);
                    }
                    let _ = app_for_progress.emit("curriculum-extraction-progress", value);
                }
            } else {
                diagnostic.push_str(&line);
                diagnostic.push('\n');
            }
        }
        diagnostic
    });
    let started = Instant::now();
    let status = loop {
        if textbook_import_cancelled(&request_id) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = fs::remove_file(&target);
            cancelled_textbook_imports()
                .lock()
                .ok()
                .map(|mut set| set.remove(&request_id));
            return Err("教材导入已取消".to_string());
        }
        if started.elapsed() >= TEXTBOOK_EXTRACTION_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            // 子进程已终止，管道随之关闭，读取线程会立即退出。
            let _ = stdout_thread.join();
            let _ = progress_thread.join();
            let _ = fs::remove_file(&target);
            cancelled_textbook_imports()
                .lock()
                .ok()
                .map(|mut set| set.remove(&request_id));
            let processed = processed_pages.load(Ordering::Relaxed);
            let progress_note = if processed > 0 {
                format!("，已处理 {processed} 页")
            } else {
                String::new()
            };
            return Err(format!(
                "教材内容提取超时（超过 45 分钟）{progress_note}。请尝试页数更少的教材文件。"
            ));
        }
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("等待教材提取失败：{error}"))?
        {
            break status;
        }
        thread::sleep(Duration::from_millis(80));
    };
    let output = stdout_thread
        .join()
        .map_err(|_| "教材提取输出线程异常".to_string())?
        .map_err(|error| format!("读取教材提取结果失败：{error}"))?;
    let diagnostic = progress_thread.join().unwrap_or_default();
    cancelled_textbook_imports()
        .lock()
        .ok()
        .map(|mut set| set.remove(&request_id));
    if !status.success() {
        let _ = fs::remove_file(&target);
        return Err(format!("教材内容提取失败：{diagnostic}"));
    }
    let extraction: TextbookExtractionResult =
        serde_json::from_slice(&output).map_err(|error| {
            let _ = fs::remove_file(&target);
            format!("无法解析教材提取结果：{error}")
        })?;
    Ok(ImportedTextbookSource {
        source_path: target.to_string_lossy().to_string(),
        content_hash,
        byte_length: metadata.len(),
        source_type: if extension == "pdf" {
            "pdf"
        } else {
            "directory_image"
        }
        .to_string(),
        extraction,
    })
}

#[tauri::command]
pub fn cancel_textbook_import(request_id: String) {
    if let Ok(mut requests) = cancelled_textbook_imports().lock() {
        requests.insert(request_id);
    }
}

#[tauri::command]
pub async fn verify_textbook_source(
    source_path: String,
    expected_hash: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let source = Path::new(&source_path)
            .canonicalize()
            .map_err(|error| format!("原教材文件已不可访问：{error}"))?;
        let actual = hash_textbook_file(&source)?;
        if actual != expected_hash {
            return Err("原教材文件内容已变化，无法安全恢复上次分析".to_string());
        }
        Ok(())
    })
    .await
    .map_err(|error| format!("教材哈希校验任务异常结束：{error}"))?
}

#[tauri::command]
pub fn cleanup_textbook_import_temp(
    app: AppHandle,
    preserve_paths: Vec<String>,
) -> Result<(), String> {
    let directory = textbook_import_temp_directory(&app)?;
    let preserved = preserve_paths
        .into_iter()
        .filter_map(|path| Path::new(&path).canonicalize().ok())
        .collect::<HashSet<_>>();
    for entry in
        fs::read_dir(directory).map_err(|error| format!("无法扫描教材临时目录：{error}"))?
    {
        let path = entry
            .map_err(|error| format!("无法读取教材临时文件：{error}"))?
            .path();
        if path.is_file()
            && !path
                .canonicalize()
                .ok()
                .is_some_and(|canonical| preserved.contains(&canonical))
        {
            fs::remove_file(path).map_err(|error| format!("清理教材临时文件失败：{error}"))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn promote_textbook_source(app: AppHandle, path: String) -> Result<String, String> {
    let source = Path::new(&path)
        .canonicalize()
        .map_err(|error| format!("教材临时文件不可用：{error}"))?;
    let temp = textbook_import_temp_directory(&app)?
        .canonicalize()
        .map_err(|error| format!("无法读取教材临时目录：{error}"))?;
    if source.parent() != Some(temp.as_path()) {
        return Ok(source.to_string_lossy().to_string());
    }
    let file_name = source.file_name().ok_or("教材临时文件名无效")?;
    let target = textbook_source_directory(&app)?.join(file_name);
    fs::rename(&source, &target)
        .or_else(|_| {
            fs::copy(&source, &target)?;
            fs::remove_file(&source)
        })
        .map_err(|error| format!("保存正式教材文件失败：{error}"))?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
pub fn remove_textbook_source(app: AppHandle, path: String) -> Result<(), String> {
    let directories = [
        textbook_source_directory(&app)?,
        textbook_import_temp_directory(&app)?,
    ]
    .into_iter()
    .filter_map(|directory| directory.canonicalize().ok())
    .collect::<Vec<_>>();
    let candidate = Path::new(&path);
    if !candidate.exists() {
        return Ok(());
    }
    let canonical = candidate
        .canonicalize()
        .map_err(|error| format!("无法验证教材路径：{error}"))?;
    if !directories
        .iter()
        .any(|directory| canonical.parent() == Some(directory.as_path()))
    {
        return Err("只能清理 Axiom 管理的教材源文件".to_string());
    }
    fs::remove_file(canonical).map_err(|error| format!("清理教材源文件失败：{error}"))
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn import_textbook_source(
    _app: AppHandle,
    _source_path: String,
    _request_id: String,
) -> Result<ImportedTextbookSource, String> {
    Err("教材自动提取目前仅支持 macOS".to_string())
}

fn versioned_problem_image_name(problem_id: &str) -> String {
    format!("{problem_id}-{}.jpg", Uuid::new_v4())
}

fn versioned_diagram_image_name(problem_id: &str) -> String {
    format!("{problem_id}-diagram-{}.jpg", Uuid::new_v4())
}

/// 校验 problem_id 是否可作为输出文件名前缀。
///
/// `problem_id` 仅用作输出文件名前缀（与随机 UUID 拼接），
/// 不需要是合法 UUID；前端会传入形如 `<uuid>-answer`、`<uuid>-diagram-<region_id>`
/// 的复合标识符。但为防止目录穿越和非法字符，仍需做路径安全校验。
fn sanitize_problem_id(problem_id: &str) -> Result<String, String> {
    if problem_id.is_empty()
        || problem_id.contains('/')
        || problem_id.contains('\\')
        || problem_id.contains("..")
        || problem_id.contains('\0')
        || problem_id.contains(|c: char| c.is_control())
    {
        return Err("题目 ID 无效".to_string());
    }
    Ok(problem_id.to_string())
}

fn validate_normalized_rect(rect: &NormalizedRect) -> Result<(), String> {
    let values = [rect.x, rect.y, rect.width, rect.height];
    if values.iter().any(|value| !value.is_finite()) {
        return Err("题块裁剪区域包含无效数值".to_string());
    }
    if rect.x < 0.0 || rect.y < 0.0 || rect.width <= 0.0 || rect.height <= 0.0 {
        return Err("题块裁剪区域无效".to_string());
    }
    let max_x = rect.x + rect.width;
    let max_y = rect.y + rect.height;
    if max_x > 1.000_001 || max_y > 1.000_001 {
        return Err("题块裁剪区域超出页面范围".to_string());
    }
    Ok(())
}

#[cfg(all(target_os = "macos", debug_assertions))]
fn vision_helper_path(_app: &AppHandle) -> Result<PathBuf, String> {
    validate_vision_helper_path(PathBuf::from(env!("AXIOM_VISION_HELPER")))
}

#[cfg(all(target_os = "macos", not(debug_assertions)))]
fn vision_helper_path(_app: &AppHandle) -> Result<PathBuf, String> {
    let executable =
        std::env::current_exe().map_err(|error| format!("无法定位应用程序：{error}"))?;
    let helper = executable
        .parent()
        .ok_or_else(|| "无法定位应用程序目录".to_string())?
        .join("axiom-vision");
    validate_vision_helper_path(helper)
}

#[cfg(target_os = "macos")]
fn validate_vision_helper_path(helper: PathBuf) -> Result<PathBuf, String> {
    use std::os::unix::fs::PermissionsExt;

    let metadata = fs::metadata(&helper)
        .map_err(|error| format!("图像处理器不可用（{}）：{error}", helper.display()))?;
    if !metadata.is_file() {
        return Err(format!("图像处理器不是有效文件：{}", helper.display()));
    }
    if metadata.permissions().mode() & 0o111 == 0 {
        return Err(format!(
            "图像处理器缺少执行权限，请重新安装最新版 Axiom：{}",
            helper.display()
        ));
    }
    Ok(helper)
}

fn persist_bytes(
    app: &AppHandle,
    bytes: &[u8],
    extension: &str,
    source_type: &str,
) -> Result<PersistedMedia, String> {
    if bytes.is_empty() {
        return Err("图片内容为空".to_string());
    }
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err("单张图片不能超过 30 MB".to_string());
    }

    let extension = extension.to_ascii_lowercase();
    if !ALLOWED_EXTENSIONS.contains(&extension.as_str()) {
        return Err("仅支持 JPG、PNG 和 WebP 图片".to_string());
    }

    let id = Uuid::new_v4().to_string();
    let content_hash = format!("{:x}", Sha256::digest(bytes));
    let path = media_directory(app)?.join(format!("{id}.{extension}"));
    fs::write(&path, bytes).map_err(|error| format!("保存图片失败：{error}"))?;

    Ok(PersistedMedia {
        id,
        path: path.to_string_lossy().to_string(),
        content_hash,
        byte_length: bytes.len() as u64,
        source_type: source_type.to_string(),
        captured_at: now_millis()?,
    })
}

#[tauri::command]
pub fn platform_capabilities(app: AppHandle) -> Result<NativeCapabilities, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?;

    Ok(NativeCapabilities {
        platform: std::env::consts::OS.to_string(),
        architecture: std::env::consts::ARCH.to_string(),
        camera_backend: "webkit-media-devices".to_string(),
        minimum_macos_version: "13.0".to_string(),
        app_data_dir: app_data_dir.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn import_image(app: AppHandle, source_path: String) -> Result<PersistedMedia, String> {
    let source = Path::new(&source_path);
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "图片没有可识别的扩展名".to_string())?
        .to_ascii_lowercase();
    if !ALLOWED_EXTENSIONS.contains(&extension.as_str()) {
        return Err("仅支持 JPG、PNG 和 WebP 图片".to_string());
    }

    let metadata = fs::metadata(source).map_err(|error| format!("无法读取所选图片：{error}"))?;
    if metadata.len() > MAX_IMAGE_BYTES as u64 {
        return Err("单张图片不能超过 30 MB".to_string());
    }

    let bytes = fs::read(source).map_err(|error| format!("无法读取所选图片：{error}"))?;
    persist_bytes(&app, &bytes, &extension, "import")
}

#[tauri::command]
pub fn persist_camera_frame(app: AppHandle, data_url: String) -> Result<PersistedMedia, String> {
    let encoded = data_url
        .strip_prefix("data:image/jpeg;base64,")
        .ok_or_else(|| "相机帧格式无效".to_string())?;
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|error| format!("无法解码相机帧：{error}"))?;
    persist_bytes(&app, &bytes, "jpg", "camera")
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn camera_orientation(
    app: AppHandle,
    device_label: String,
) -> Result<CameraOrientationInfo, String> {
    let helper = vision_helper_path(&app)?;
    if !helper.is_file() {
        return Err("本地相机方向检测器尚未构建".to_string());
    }
    let output = Command::new(helper)
        .arg("camera-orientation")
        .arg("--device-label")
        .arg(device_label)
        .output()
        .map_err(|error| format!("无法读取相机方向：{error}"))?;
    if !output.status.success() {
        return Err(format!(
            "相机方向检测失败：{}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    serde_json::from_slice(&output.stdout).map_err(|error| format!("无法解析相机方向：{error}"))
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn camera_orientation(
    _app: AppHandle,
    _device_label: String,
) -> Result<CameraOrientationInfo, String> {
    Err("相机方向检测目前仅支持 macOS".to_string())
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn process_document(
    app: AppHandle,
    source_document_id: String,
    source_path: String,
    mode: String,
) -> Result<DocumentProcessingResult, String> {
    if mode != "color" && mode != "grayscale" {
        return Err("未知的色彩优化模式".to_string());
    }

    let input = Path::new(&source_path)
        .canonicalize()
        .map_err(|error| format!("无法读取原图：{error}"))?;
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?
        .canonicalize()
        .map_err(|error| format!("无法读取应用数据目录：{error}"))?;
    if !input.starts_with(&app_data) {
        return Err("只允许处理已导入 Axiom 的图片".to_string());
    }

    let processing_run_id = Uuid::new_v4().to_string();
    let output_path = corrected_media_directory(&app)?
        .join(format!("{}-{}.jpg", source_document_id, processing_run_id));
    let helper = vision_helper_path(&app)?;
    if !helper.is_file() {
        return Err("本地图像处理器尚未构建".to_string());
    }

    let started = Instant::now();
    let mut child = Command::new(&helper)
        .arg("process")
        .arg("--input")
        .arg(&input)
        .arg("--output")
        .arg(&output_path)
        .arg("--mode")
        .arg(&mode)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("无法启动图像处理器：{error}"))?;

    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法读取处理结果".to_string())?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法读取处理日志".to_string())?;
    let stdout_reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stdout.read_to_end(&mut bytes);
        bytes
    });
    let stderr_reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stderr.read_to_end(&mut bytes);
        bytes
    });

    let status = match child
        .wait_timeout(Duration::from_secs(45))
        .map_err(|error| format!("等待图片处理失败：{error}"))?
    {
        Some(status) => status,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            let _ = fs::remove_file(&output_path);
            return Err("图片处理超过 45 秒，请缩小图片或重试".to_string());
        }
    };
    let stdout = stdout_reader
        .join()
        .map_err(|_| "读取处理结果失败".to_string())?;
    let stderr = stderr_reader
        .join()
        .map_err(|_| "读取处理日志失败".to_string())?;

    if !status.success() {
        let _ = fs::remove_file(&output_path);
        let details = String::from_utf8_lossy(&stderr);
        return Err(format!("图片处理失败：{details}"));
    }

    let mut result: DocumentProcessingResult = serde_json::from_slice(&stdout)
        .map_err(|error| format!("无法解析图像处理结果：{error}"))?;
    result.processing_run_id = Some(processing_run_id);
    result.duration_ms = Some(started.elapsed().as_millis());
    Ok(result)
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn process_document(
    _app: AppHandle,
    _source_document_id: String,
    _source_path: String,
    _mode: String,
) -> Result<DocumentProcessingResult, String> {
    Err("图片矫正目前仅支持 macOS".to_string())
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn crop_problem_image(
    app: AppHandle,
    problem_id: String,
    source_path: String,
    rect: NormalizedRect,
) -> Result<PersistedProblemImage, String> {
    validate_normalized_rect(&rect)?;

    // problem_id 仅用作输出文件名前缀，不需要是合法 UUID；
    // 但仍需校验路径安全，防止目录穿越或非法字符。
    let safe_problem_id = sanitize_problem_id(&problem_id)?;
    let input = Path::new(&source_path)
        .canonicalize()
        .map_err(|error| format!("无法读取校正后的页面图片：{error}"))?;
    if !input.is_file() {
        return Err("校正后的页面图片不存在".to_string());
    }

    let corrected_directory = corrected_media_directory(&app)?
        .canonicalize()
        .map_err(|error| format!("无法读取校正图片目录：{error}"))?;
    if !input.starts_with(&corrected_directory) {
        return Err("只能从 Axiom 保存的校正页面生成题块图片".to_string());
    }

    let output_path =
        problem_media_directory(&app)?.join(versioned_problem_image_name(&safe_problem_id));

    let helper = vision_helper_path(&app)?;
    if !helper.is_file() {
        return Err("本地图像处理器尚未构建".to_string());
    }

    let mut child = Command::new(&helper)
        .arg("crop")
        .arg("--input")
        .arg(&input)
        .arg("--output")
        .arg(&output_path)
        .arg("--x")
        .arg(rect.x.to_string())
        .arg("--y")
        .arg(rect.y.to_string())
        .arg("--width")
        .arg(rect.width.to_string())
        .arg("--height")
        .arg(rect.height.to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("无法启动题块裁剪器：{error}"))?;

    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法读取裁剪结果".to_string())?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法读取裁剪日志".to_string())?;
    let stdout_reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stdout.read_to_end(&mut bytes);
        bytes
    });
    let stderr_reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stderr.read_to_end(&mut bytes);
        bytes
    });

    let status = match child
        .wait_timeout(Duration::from_secs(20))
        .map_err(|error| format!("等待题块裁剪失败：{error}"))?
    {
        Some(status) => status,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            let _ = fs::remove_file(&output_path);
            return Err("题块裁剪超过 20 秒，请重试".to_string());
        }
    };
    let _ = stdout_reader.join();
    let stderr = stderr_reader
        .join()
        .map_err(|_| "读取裁剪日志失败".to_string())?;

    if !status.success() {
        let _ = fs::remove_file(&output_path);
        let details = String::from_utf8_lossy(&stderr);
        return Err(format!("题块图片生成失败：{details}"));
    }
    let metadata = fs::metadata(&output_path).map_err(|error| {
        let _ = fs::remove_file(&output_path);
        format!("题块图片写入失败：{error}")
    })?;
    if metadata.len() == 0 {
        let _ = fs::remove_file(&output_path);
        return Err("题块图片写入失败：生成的文件为空".to_string());
    }

    Ok(PersistedProblemImage {
        path: output_path.to_string_lossy().to_string(),
        created: true,
    })
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn crop_problem_image(
    _app: AppHandle,
    _problem_id: String,
    _source_path: String,
    _rect: NormalizedRect,
) -> Result<PersistedProblemImage, String> {
    Err("题块裁剪目前仅支持 macOS".to_string())
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn crop_problem_diagram(
    app: AppHandle,
    problem_id: String,
    source_path: String,
    rect: NormalizedRect,
) -> Result<PersistedProblemImage, String> {
    validate_normalized_rect(&rect)?;

    // problem_id 仅用作输出文件名前缀，不需要是合法 UUID；
    // 但仍需校验路径安全，防止目录穿越或非法字符。
    let safe_problem_id = sanitize_problem_id(&problem_id)?;
    let input = Path::new(&source_path)
        .canonicalize()
        .map_err(|error| format!("无法读取题块图片：{error}"))?;
    if !input.is_file() {
        return Err("题块图片不存在".to_string());
    }

    let problem_directory = problem_media_directory(&app)?
        .canonicalize()
        .map_err(|error| format!("无法读取题块图片目录：{error}"))?;
    if !input.starts_with(&problem_directory) {
        return Err("只能从 Axiom 保存的题块图片抠取图形".to_string());
    }

    let output_path =
        diagram_media_directory(&app)?.join(versioned_diagram_image_name(&safe_problem_id));
    let helper = vision_helper_path(&app)?;
    if !helper.is_file() {
        return Err("本地图像处理器尚未构建".to_string());
    }

    let mut child = Command::new(&helper)
        .arg("crop")
        .arg("--input")
        .arg(&input)
        .arg("--output")
        .arg(&output_path)
        .arg("--x")
        .arg(rect.x.to_string())
        .arg("--y")
        .arg(rect.y.to_string())
        .arg("--width")
        .arg(rect.width.to_string())
        .arg("--height")
        .arg(rect.height.to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("无法启动图形裁剪器：{error}"))?;

    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法读取图形裁剪结果".to_string())?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法读取图形裁剪日志".to_string())?;
    let stdout_reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stdout.read_to_end(&mut bytes);
        bytes
    });
    let stderr_reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stderr.read_to_end(&mut bytes);
        bytes
    });

    let status = match child
        .wait_timeout(Duration::from_secs(20))
        .map_err(|error| format!("等待图形裁剪失败：{error}"))?
    {
        Some(status) => status,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            let _ = fs::remove_file(&output_path);
            return Err("图形裁剪超过 20 秒，请重试".to_string());
        }
    };
    let _ = stdout_reader.join();
    let stderr = stderr_reader
        .join()
        .map_err(|_| "读取图形裁剪日志失败".to_string())?;

    if !status.success() {
        let _ = fs::remove_file(&output_path);
        let details = String::from_utf8_lossy(&stderr);
        return Err(format!("图形图片生成失败：{details}"));
    }
    let metadata = fs::metadata(&output_path).map_err(|error| {
        let _ = fs::remove_file(&output_path);
        format!("图形图片写入失败：{error}")
    })?;
    if metadata.len() == 0 {
        let _ = fs::remove_file(&output_path);
        return Err("图形图片写入失败：生成的文件为空".to_string());
    }

    Ok(PersistedProblemImage {
        path: output_path.to_string_lossy().to_string(),
        created: true,
    })
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn crop_problem_diagram(
    _app: AppHandle,
    _problem_id: String,
    _source_path: String,
    _rect: NormalizedRect,
) -> Result<PersistedProblemImage, String> {
    Err("图形裁剪目前仅支持 macOS".to_string())
}

#[tauri::command]
pub fn remove_problem_image(app: AppHandle, path: String) -> Result<(), String> {
    let problem_directory = problem_media_directory(&app)?
        .canonicalize()
        .map_err(|error| format!("无法读取题块图片目录：{error}"))?;
    let candidate = Path::new(&path);
    let parent = candidate
        .parent()
        .ok_or_else(|| "题块图片路径无效".to_string())?
        .canonicalize()
        .map_err(|error| format!("无法验证题块图片路径：{error}"))?;
    if parent != problem_directory {
        return Err("只能清理 Axiom 管理的题块图片".to_string());
    }
    if candidate.exists() {
        fs::remove_file(candidate).map_err(|error| format!("清理题块图片失败：{error}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn remove_problem_diagram(app: AppHandle, path: String) -> Result<(), String> {
    let diagram_directory = diagram_media_directory(&app)?
        .canonicalize()
        .map_err(|error| format!("无法读取图形图片目录：{error}"))?;
    let candidate = Path::new(&path);
    let parent = candidate
        .parent()
        .ok_or_else(|| "图形图片路径无效".to_string())?
        .canonicalize()
        .map_err(|error| format!("无法验证图形图片路径：{error}"))?;
    if parent != diagram_directory {
        return Err("只能清理 Axiom 管理的图形图片".to_string());
    }
    if candidate.exists() {
        fs::remove_file(candidate).map_err(|error| format!("清理图形图片失败：{error}"))?;
    }
    Ok(())
}

/// 媒体根目录（app_data_dir/media），所有媒体文件都位于其下。
/// 用于校验 list_media_directory / delete_media_file 的路径不逃逸。
fn media_root(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?
        .join("media");
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建媒体目录：{error}"))?;
    Ok(directory)
}

/// 允许的媒体子目录名，防止路径穿越。
const ALLOWED_MEDIA_SUBDIRS: &[&str] =
    &["original", "corrected", "problems", "diagrams", "practice"];

/// 枚举指定媒体子目录下的所有文件，返回每个文件的元数据。
///
/// `subdir` 必须是 `original` / `corrected` / `problems` / `diagrams` / `practice` 之一，
/// 任何其他值（含 `..`、绝对路径）都会被拒绝，防止目录穿越。
///
/// 返回的 `absolute_path` 经过 canonicalize，与数据库中存储的路径格式一致，
/// 便于前端直接与数据库引用比对。
#[tauri::command]
pub fn list_media_directory(app: AppHandle, subdir: String) -> Result<Vec<MediaEntry>, String> {
    if !ALLOWED_MEDIA_SUBDIRS.contains(&subdir.as_str()) {
        return Err(format!("不支持的媒体子目录：{subdir}"));
    }
    let target_dir = media_root(&app)?.join(&subdir);
    // 子目录可能尚未创建（无文件时），返回空列表而非报错
    if !target_dir.exists() {
        return Ok(Vec::new());
    }
    let canonical_root = target_dir
        .canonicalize()
        .map_err(|e| format!("无法解析媒体目录：{e}"))?;

    let mut entries = Vec::new();
    let read_dir =
        fs::read_dir(&canonical_root).map_err(|e| format!("无法读取媒体目录 {subdir}：{e}"))?;
    for entry in read_dir.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let absolute_path = match path.to_str() {
            Some(s) => s.to_string(),
            None => continue,
        };
        let relative_path = match path.strip_prefix(&canonical_root) {
            Ok(rel) => format!("{subdir}/{}", rel.to_string_lossy()),
            Err(_) => continue,
        };
        let created_at = metadata
            .created()
            .ok()
            .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
            .and_then(|d| i64::try_from(d.as_millis()).ok());
        entries.push(MediaEntry {
            relative_path,
            absolute_path,
            size: metadata.len(),
            created_at,
        });
    }
    Ok(entries)
}

/// 删除单个媒体文件。
///
/// 安全约束：
///   - 路径必须位于 `media/{original|corrected|problems|diagrams|practice}/` 之一（canonicalize 后校验）；
///   - 调用方应在删除前再次检查数据库引用（前端传入引用集合校验）；
///   - 文件不存在时返回 Ok（幂等删除）。
#[tauri::command]
pub fn delete_media_file(app: AppHandle, path: String) -> Result<(), String> {
    let root = media_root(&app)?
        .canonicalize()
        .map_err(|e| format!("无法解析媒体根目录：{e}"))?;
    let candidate = Path::new(&path);
    // canonicalize 失败说明文件可能不存在，对删除操作视为成功（幂等）
    let canonical = match candidate.canonicalize() {
        Ok(c) => c,
        Err(_) => return Ok(()),
    };
    // 校验 canonical 路径必须在 media/ 下，且 parent 必须是允许的子目录
    let parent = canonical
        .parent()
        .ok_or_else(|| "媒体文件路径无效".to_string())?;
    if !parent.starts_with(&root) {
        return Err("只能删除 Axiom 管理的媒体文件".to_string());
    }
    let subdir_name = parent
        .strip_prefix(&root)
        .map_err(|_| "媒体文件路径不在允许的子目录中".to_string())?
        .to_str()
        .unwrap_or("");
    if !ALLOWED_MEDIA_SUBDIRS.contains(&subdir_name) {
        return Err(format!("不支持的媒体子目录：{subdir_name}"));
    }
    fs::remove_file(&canonical).map_err(|e| format!("删除媒体文件失败：{e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        copy_and_hash_textbook, hash_textbook_file, validate_normalized_rect,
        validate_vision_helper_path, versioned_diagram_image_name, versioned_problem_image_name,
        ALLOWED_MEDIA_SUBDIRS,
    };
    use crate::models::NormalizedRect;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use uuid::Uuid;

    #[test]
    fn accepts_valid_normalized_crop() {
        assert!(validate_normalized_rect(&NormalizedRect {
            x: 0.1,
            y: 0.2,
            width: 0.8,
            height: 0.3,
        })
        .is_ok());
    }

    #[test]
    fn rejects_empty_and_out_of_bounds_crops() {
        assert!(validate_normalized_rect(&NormalizedRect {
            x: 0.1,
            y: 0.2,
            width: 0.0,
            height: 0.3,
        })
        .is_err());
        assert!(validate_normalized_rect(&NormalizedRect {
            x: 0.8,
            y: 0.2,
            width: 0.3,
            height: 0.3,
        })
        .is_err());
    }

    #[test]
    fn creates_a_new_versioned_path_for_each_problem_crop() {
        let problem_id = "fe8dfe78-8b90-4931-a15d-ecbc6f79ff65";
        let first = versioned_problem_image_name(problem_id);
        let second = versioned_problem_image_name(problem_id);
        assert!(first.starts_with(problem_id));
        assert!(first.ends_with(".jpg"));
        assert_ne!(first, second);
    }

    #[test]
    fn creates_a_scoped_versioned_path_for_each_diagram_crop() {
        let problem_id = "fe8dfe78-8b90-4931-a15d-ecbc6f79ff65";
        let first = versioned_diagram_image_name(problem_id);
        let second = versioned_diagram_image_name(problem_id);
        assert!(first.starts_with(&format!("{problem_id}-diagram-")));
        assert!(first.ends_with(".jpg"));
        assert_ne!(first, second);
    }

    #[test]
    fn allowed_media_subdirs_cover_all_five_categories() {
        assert_eq!(
            ALLOWED_MEDIA_SUBDIRS,
            &["original", "corrected", "problems", "diagrams", "practice"]
        );
    }

    #[test]
    fn vision_helper_must_be_executable() {
        let path = std::env::temp_dir().join(format!("axiom-helper-test-{}", Uuid::new_v4()));
        fs::write(&path, b"helper").expect("write helper fixture");

        let mut permissions = fs::metadata(&path).expect("helper metadata").permissions();
        permissions.set_mode(0o644);
        fs::set_permissions(&path, permissions).expect("remove executable bit");
        assert!(validate_vision_helper_path(path.clone()).is_err());

        let mut permissions = fs::metadata(&path).expect("helper metadata").permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&path, permissions).expect("restore executable bit");
        assert_eq!(
            validate_vision_helper_path(path.clone()).expect("executable helper"),
            path
        );
        fs::remove_file(path).expect("remove helper fixture");
    }

    #[test]
    fn streams_an_eighty_megabyte_textbook_copy_and_hash() {
        let directory = std::env::temp_dir().join(format!("axiom-stream-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).expect("create test directory");
        let source = directory.join("source.pdf");
        let target = directory.join("target.pdf");
        fs::File::create(&source)
            .and_then(|file| file.set_len(80 * 1024 * 1024))
            .expect("create sparse 80 MB fixture");
        let copied_hash =
            copy_and_hash_textbook(&source, &target, "stream-test").expect("stream copy and hash");
        assert_eq!(
            fs::metadata(&target).expect("target metadata").len(),
            80 * 1024 * 1024
        );
        assert_eq!(
            copied_hash,
            hash_textbook_file(&target).expect("hash target")
        );
        fs::remove_dir_all(directory).expect("clean test directory");
    }
}
