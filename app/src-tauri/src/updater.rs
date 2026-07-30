//! 自动更新模块：从 GitHub Release 检查、下载、校验、替换并重启。
//!
//! 流程：
//! 1. `check_for_updates` — 调用 GitHub API 获取最新 release，与当前版本比较。
//! 2. `download_and_install_update` — 下载 `.app.zip`（带进度事件），
//!    校验 SHA256，解压，生成 detached 安装脚本，退出当前进程。
//!    脚本等待进程退出后替换 `.app` 并重新启动。
//!
//! 更新源配置：修改下方 `UPDATE_OWNER` 常量为你创建的 GitHub 用户名/组织名。
//! 仓库 `axiom-update-pusher` 的 Release 需包含以下资产：
//!   - `Axiom_<version>_<arch>.app.zip`   — 打包好的应用
//!   - `Axiom_<version>_<arch>.app.zip.sha256` — SHA256 校验值（可选但推荐）

use futures_util::StreamExt;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

// ────────────────────────────────────────────────────────────
// 更新源配置
// ────────────────────────────────────────────────────────────

/// GitHub 仓库 owner。用户创建 `axiom-update-pusher` 仓库后，将此值改为实际用户名。
/// 也可在编译时通过环境变量 `UPDATE_REPO_OWNER` 覆盖。
const UPDATE_OWNER: &str = match option_env!("UPDATE_REPO_OWNER") {
    Some(owner) => owner,
    None => "peterfu0615",
};

/// GitHub 仓库名。
const UPDATE_REPO: &str = "axiom-update-pusher";

// ────────────────────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    body: Option<String>,
    published_at: Option<String>,
    assets: Vec<GithubAsset>,
    #[serde(rename = "message")]
    api_error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
    size: u64,
}

/// 检查更新返回的完整信息，前端用于展示版本号、更新日志和下载。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    /// 最新版本号（不含 v 前缀），如 `0.2.0`
    pub version: String,
    /// 当前安装版本号
    pub current_version: String,
    /// 更新日志（Markdown）
    pub release_notes: String,
    /// 发布时间（ISO 8601）
    pub published_at: String,
    /// `.app.zip` 下载 URL
    pub download_url: String,
    /// 下载文件大小（字节）
    pub download_size: u64,
    /// `.sha256` 校验文件 URL（可能为空）
    pub sha256_url: Option<String>,
}

/// 下载进度事件 payload，通过 `update://progress` 事件发送到前端。
#[derive(Debug, Clone, serde::Serialize)]
pub struct DownloadProgress {
    pub downloaded: u64,
    pub total: u64,
    pub percent: f64,
}

// ────────────────────────────────────────────────────────────
// Tauri 命令
// ────────────────────────────────────────────────────────────

/// 返回当前应用版本（编译时从 Cargo.toml 注入）。
#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// 检查 GitHub 最新 release。返回 `Some(UpdateInfo)` 表示有更新，`None` 表示已是最新。
/// 网络错误或仓库不存在时返回 `Err`，调用方应静默处理。
#[tauri::command(rename_all = "camelCase")]
pub async fn check_for_updates() -> Result<Option<UpdateInfo>, String> {
    let current = env!("CARGO_PKG_VERSION");
    let url = format!("https://api.github.com/repos/{UPDATE_OWNER}/{UPDATE_REPO}/releases/latest");

    let client = reqwest::Client::builder()
        .user_agent(format!("Axiom/{current} (macOS self-updater)"))
        .build()
        .map_err(|e| format!("构建 HTTP 客户端失败：{e}"))?;

    let response = client
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("请求 GitHub API 失败：{e}"))?;

    let status = response.status();
    let release: GithubRelease = response
        .json()
        .await
        .map_err(|e| format!("解析 GitHub release 失败（HTTP {status}）：{e}"))?;

    // GitHub API 返回错误消息（如 404 仓库不存在）
    if !status.is_success() {
        let msg = release
            .api_error
            .unwrap_or_else(|| format!("HTTP {status}"));
        return Err(format!("GitHub API 返回错误：{msg}"));
    }

    // tag_name 形如 "v0.2.0"，去掉 v 前缀
    let latest = release.tag_name.trim_start_matches('v').to_string();

    if !is_newer(&latest, current) {
        log::info!("应用已是最新版本（{current}）");
        return Ok(None);
    }

    // 根据当前架构选择对应的资产
    let arch = std::env::consts::ARCH; // "aarch64" or "x86_64"
    let zip_asset = release
        .assets
        .iter()
        .find(|a| a.name.contains(arch) && a.name.ends_with(".app.zip"))
        .ok_or_else(|| format!("Release 中未找到 {arch} 架构的 .app.zip 资产"))?;

    let sha256_asset = release
        .assets
        .iter()
        .find(|a| a.name.contains(arch) && a.name.ends_with(".sha256"));

    let info = UpdateInfo {
        version: latest,
        current_version: current.to_string(),
        release_notes: release.body.unwrap_or_default(),
        published_at: release.published_at.unwrap_or_default(),
        download_url: zip_asset.browser_download_url.clone(),
        download_size: zip_asset.size,
        sha256_url: sha256_asset.map(|a| a.browser_download_url.clone()),
    };

    log::info!(
        "发现新版本：{} → {}（{}bytes）",
        info.current_version,
        info.version,
        info.download_size
    );
    Ok(Some(info))
}

/// 下载并安装更新。下载进度通过 `update://progress` 事件报告。
/// 完成后退出当前进程，由 detached 脚本完成替换和重启。
#[tauri::command(rename_all = "camelCase")]
pub async fn download_and_install_update(
    app: AppHandle,
    download_url: String,
    sha256_url: Option<String>,
) -> Result<(), String> {
    let current_version = env!("CARGO_PKG_VERSION");
    let client = reqwest::Client::builder()
        .user_agent(format!("Axiom/{current_version} (macOS self-updater)"))
        .build()
        .map_err(|e| format!("构建 HTTP 客户端失败：{e}"))?;

    // 准备临时目录
    let update_dir = std::env::temp_dir().join("axiom-update");
    if update_dir.exists() {
        std::fs::remove_dir_all(&update_dir).ok();
    }
    std::fs::create_dir_all(&update_dir).map_err(|e| format!("无法创建更新临时目录：{e}"))?;

    // 1. 下载 .app.zip（带进度）
    let zip_path = update_dir.join("Axiom.app.zip");
    log::info!("开始下载更新：{download_url}");
    download_with_progress(&client, &download_url, &zip_path, &app).await?;

    // 2. 下载并校验 SHA256（如果提供了 URL）
    if let Some(sha_url) = sha256_url {
        verify_sha256(&client, &sha_url, &zip_path).await?;
    } else {
        log::warn!("未提供 SHA256 校验 URL，跳过完整性校验");
    }

    // 3. 解压 .app.zip → Axiom.app
    let new_app_path = update_dir.join("Axiom.app");
    if new_app_path.exists() {
        std::fs::remove_dir_all(&new_app_path).map_err(|e| format!("清理旧解压产物失败：{e}"))?;
    }
    log::info!("解压更新包...");
    unzip_app_bundle(&zip_path, &update_dir)?;

    if !new_app_path.exists() {
        return Err(format!(
            "解压后未找到 Axiom.app（在 {}）",
            update_dir.display()
        ));
    }

    // 4. 定位当前 .app bundle 路径
    let app_bundle_path = current_app_bundle_path()?;

    // 5. 生成并启动 detached 安装脚本
    let pid = std::process::id();
    let script_path = write_install_script(pid, &app_bundle_path, &new_app_path, &update_dir)?;

    log::info!("启动 detached 安装脚本：{}", script_path.display());
    std::process::Command::new("bash")
        .arg(&script_path)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("无法启动安装脚本：{e}"))?;

    // 给脚本一点时间初始化，然后退出应用
    std::thread::sleep(std::time::Duration::from_millis(500));
    log::info!("退出当前进程，安装脚本将完成替换和重启");
    app.exit(0);
    Ok(())
}

// ────────────────────────────────────────────────────────────
// 内部实现
// ────────────────────────────────────────────────────────────

/// 下载文件并报告进度。进度通过 `update://progress` 事件发送到前端。
async fn download_with_progress(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    app: &AppHandle,
) -> Result<(), String> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("下载请求失败：{e}"))?;

    if !response.status().is_success() {
        return Err(format!("下载失败：HTTP {}", response.status()));
    }

    let total = response.content_length().unwrap_or(0);
    let mut file = std::fs::File::create(dest).map_err(|e| format!("创建下载文件失败：{e}"))?;

    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("读取下载数据失败：{e}"))?;
        file.write_all(&chunk)
            .map_err(|e| format!("写入下载文件失败：{e}"))?;
        downloaded += chunk.len() as u64;
        let percent = if total > 0 {
            downloaded as f64 / total as f64 * 100.0
        } else {
            0.0
        };
        let _ = app.emit(
            "update://progress",
            DownloadProgress {
                downloaded,
                total,
                percent,
            },
        );
    }

    file.flush().map_err(|e| format!("刷新下载文件失败：{e}"))?;
    log::info!("下载完成：{} bytes → {}", downloaded, dest.display());
    Ok(())
}

/// 下载 `.sha256` 文件并校验本地 zip 的完整性。
async fn verify_sha256(
    client: &reqwest::Client,
    sha_url: &str,
    zip_path: &Path,
) -> Result<(), String> {
    log::info!("下载 SHA256 校验文件...");
    let sha_response = client
        .get(sha_url)
        .send()
        .await
        .map_err(|e| format!("下载 SHA256 文件失败：{e}"))?;

    if !sha_response.status().is_success() {
        return Err(format!(
            "下载 SHA256 文件失败：HTTP {}",
            sha_response.status()
        ));
    }

    let sha_content = sha_response
        .text()
        .await
        .map_err(|e| format!("读取 SHA256 内容失败：{e}"))?;

    // .sha256 文件格式可能为 "<hash>" 或 "<hash>  <filename>"
    let expected = sha_content.split_whitespace().next().unwrap_or("");
    if expected.is_empty() {
        return Err("SHA256 文件内容为空".to_string());
    }

    log::info!("计算下载文件的 SHA256...");
    let data = std::fs::read(zip_path).map_err(|e| format!("读取下载文件失败：{e}"))?;
    let actual = format!("{:x}", Sha256::digest(&data));

    if !actual.eq_ignore_ascii_case(expected) {
        return Err(format!("SHA256 校验失败：期望 {expected}，实际 {actual}"));
    }

    log::info!("SHA256 校验通过");
    Ok(())
}

/// 使用系统 `unzip` 命令解压 .app.zip。
fn unzip_app_bundle(zip_path: &Path, dest_dir: &Path) -> Result<(), String> {
    let output = std::process::Command::new("unzip")
        .arg("-o")
        .arg(zip_path)
        .arg("-d")
        .arg(dest_dir)
        .output()
        .map_err(|e| format!("启动 unzip 失败：{e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("解压失败：{stderr}"));
    }

    Ok(())
}

/// 获取当前运行的 .app bundle 路径。
/// 可执行文件位于 `Axiom.app/Contents/MacOS/Axiom`，需向上回溯三级。
fn current_app_bundle_path() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("无法获取当前可执行文件路径：{e}"))?;

    // exe = .../Axiom.app/Contents/MacOS/Axiom
    let app_bundle = exe
        .parent() // .../Axiom.app/Contents/MacOS
        .and_then(|p| p.parent()) // .../Axiom.app/Contents
        .and_then(|p| p.parent()); // .../Axiom.app

    let app_bundle = app_bundle
        .ok_or_else(|| "无法定位 .app bundle 路径（可能不在标准 bundle 结构中运行）".to_string())?;

    // 确认路径以 .app 结尾
    if app_bundle.extension().map_or(true, |ext| ext != "app") {
        return Err(format!(
            "当前运行路径不是 .app bundle：{}。请通过 DMG 安装后再使用自动更新。",
            app_bundle.display()
        ));
    }

    log::info!("当前 .app bundle 路径：{}", app_bundle.display());
    Ok(app_bundle.to_path_buf())
}

/// 生成 detached 安装脚本。
///
/// 脚本逻辑：
/// 1. 等待当前进程退出（PID 轮询，最长 30 秒）
/// 2. 删除旧 .app，移动新 .app 到原位置
/// 3. 移除 quarantine 属性（Beta 未签名构建需要）
/// 4. 清理临时目录
/// 5. 重新启动应用
fn write_install_script(
    pid: u32,
    app_bundle_path: &Path,
    new_app_path: &Path,
    update_dir: &Path,
) -> Result<PathBuf, String> {
    let log_path = update_dir.join("install.log");
    let app_path_str = app_bundle_path.to_string_lossy();
    let new_path_str = new_app_path.to_string_lossy();
    let update_dir_str = update_dir.to_string_lossy();
    let log_path_str = log_path.to_string_lossy();

    let script = format!(
        r#"#!/bin/bash
# Axiom self-update installer (auto-generated)
# 等待当前应用退出后替换 .app 并重新启动。

PID={pid}
APP_PATH="{app_path_str}"
NEW_APP_PATH="{new_path_str}"
UPDATE_DIR="{update_dir_str}"
LOG_FILE="{log_path_str}"

log() {{
    echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"
}}

log "安装脚本启动，等待 PID $PID 退出..."

# 等待应用退出（每 0.3 秒轮询一次，最多 30 秒）
for i in $(seq 1 100); do
    if ! kill -0 "$PID" 2>/dev/null; then
        log "应用进程已退出。"
        break
    fi
    sleep 0.3
done

# 超时仍未退出则中止
if kill -0 "$PID" 2>/dev/null; then
    log "错误：应用在 30 秒后仍未退出，中止更新。"
    exit 1
fi

# 替换 .app bundle
log "替换 $APP_PATH ← $NEW_APP_PATH ..."
rm -rf "$APP_PATH"
if ! mv "$NEW_APP_PATH" "$APP_PATH"; then
    log "错误：无法移动新应用到 $APP_PATH"
    exit 1
fi

# 移除 quarantine 属性（Beta 未签名构建需要）
log "移除 quarantine 属性..."
xattr -dr com.apple.quarantine "$APP_PATH" 2>/dev/null || true

# 清理临时目录
rm -rf "$UPDATE_DIR"

# 重新启动应用
log "重新启动 $APP_PATH ..."
open "$APP_PATH"

log "更新完成。"
"#,
    );

    let script_path = update_dir.join("install-update.sh");
    std::fs::write(&script_path, &script).map_err(|e| format!("写入安装脚本失败：{e}"))?;

    // 设置可执行权限
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o755);
        std::fs::set_permissions(&script_path, perms)
            .map_err(|e| format!("设置脚本权限失败：{e}"))?;
    }

    Ok(script_path)
}

/// 简单的语义版本比较：`latest` 是否比 `current` 新。
/// 仅比较 `major.minor.patch`，忽略预发布后缀（Beta 版视为同版本）。
fn is_newer(latest: &str, current: &str) -> bool {
    fn parse_version(v: &str) -> Option<(u64, u64, u64)> {
        let v = v.split('-').next()?; // 去掉预发布后缀
        let parts: Vec<&str> = v.split('.').collect();
        if parts.len() != 3 {
            return None;
        }
        Some((
            parts[0].parse().ok()?,
            parts[1].parse().ok()?,
            parts[2].parse().ok()?,
        ))
    }

    match (parse_version(latest), parse_version(current)) {
        (Some(l), Some(c)) => l > c,
        _ => {
            // 回退到字符串比较
            latest != current
        }
    }
}

// ────────────────────────────────────────────────────────────
// 测试
// ────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_higher_version() {
        assert!(is_newer("0.2.0", "0.1.0"));
        assert!(is_newer("1.0.0", "0.9.9"));
        assert!(is_newer("0.1.1", "0.1.0"));
    }

    #[test]
    fn rejects_same_or_lower_version() {
        assert!(!is_newer("0.1.0", "0.1.0"));
        assert!(!is_newer("0.0.9", "0.1.0"));
    }

    #[test]
    fn ignores_prerelease_suffix() {
        // Beta 后缀不参与比较，0.2.0-beta.1 视为 0.2.0
        assert!(is_newer("0.2.0", "0.1.0"));
        assert!(!is_newer("0.1.0-beta.1", "0.1.0"));
    }

    #[test]
    fn falls_back_on_invalid_version() {
        // 无效版本回退到字符串比较
        assert!(is_newer("abc", "def"));
        assert!(!is_newer("same", "same"));
    }
}
