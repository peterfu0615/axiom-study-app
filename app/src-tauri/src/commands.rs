use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::Duration,
    time::Instant,
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use uuid::Uuid;
use wait_timeout::ChildExt;

use crate::models::{
    CameraOrientationInfo, DocumentProcessingResult, NativeCapabilities, NormalizedRect,
    PersistedMedia, PersistedProblemImage,
};

const MAX_IMAGE_BYTES: usize = 30 * 1024 * 1024;
const ALLOWED_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "webp"];

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

fn versioned_problem_image_name(problem_id: &str) -> String {
    format!("{problem_id}-{}.jpg", Uuid::new_v4())
}

fn versioned_diagram_image_name(problem_id: &str) -> String {
    format!("{problem_id}-diagram-{}.jpg", Uuid::new_v4())
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
    Ok(PathBuf::from(env!("AXIOM_VISION_HELPER")))
}

#[cfg(all(target_os = "macos", not(debug_assertions)))]
fn vision_helper_path(_app: &AppHandle) -> Result<PathBuf, String> {
    let executable =
        std::env::current_exe().map_err(|error| format!("无法定位应用程序：{error}"))?;
    executable
        .parent()
        .map(|path| path.join("axiom-vision"))
        .ok_or_else(|| "无法定位图像处理器".to_string())
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

    let safe_problem_id = Uuid::parse_str(&problem_id)
        .map_err(|_| "题目 ID 无效".to_string())?
        .to_string();
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

    let safe_problem_id = Uuid::parse_str(&problem_id)
        .map_err(|_| "题目 ID 无效".to_string())?
        .to_string();
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

#[cfg(test)]
mod tests {
    use super::{
        validate_normalized_rect, versioned_diagram_image_name, versioned_problem_image_name,
    };
    use crate::models::NormalizedRect;

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
}
