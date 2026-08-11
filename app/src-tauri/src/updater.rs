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
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

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
    expected_version: String,
) -> Result<(), String> {
    let current_version = env!("CARGO_PKG_VERSION");
    let client = reqwest::Client::builder()
        .user_agent(format!("Axiom/{current_version} (macOS self-updater)"))
        .build()
        .map_err(|e| format!("构建 HTTP 客户端失败：{e}"))?;

    // 每次更新使用独立目录，避免残留安装脚本或并发更新互相删除文件。
    let update_dir = std::env::temp_dir().join(format!("axiom-update-{}", Uuid::new_v4()));
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
    validate_update_bundle(&new_app_path, &expected_version)?;

    // 4. 定位并预检当前 .app bundle。必须在退出前确认原位置可写，
    // 否则不能让用户先失去正在运行的旧版本。
    let app_bundle_path = current_app_bundle_path()?;
    ensure_update_target_is_writable(&app_bundle_path)?;

    // 安装脚本会在当前进程退出后继续运行；日志不能放在会被清理的临时目录里。
    let install_log_path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位更新日志目录：{e}"))?
        .join("logs")
        .join("update-install.log");
    if let Some(parent) = install_log_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("无法创建更新日志目录：{e}"))?;
    }

    // 5. 生成并启动 detached 安装脚本
    let pid = std::process::id();
    let script_path = write_install_script(
        pid,
        &app_bundle_path,
        &new_app_path,
        &update_dir,
        &install_log_path,
        &expected_version,
    )?;

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

    let app_bundle = std::fs::canonicalize(app_bundle)
        .map_err(|e| format!("无法解析当前 .app bundle 路径：{e}"))?;

    // macOS 的 App Translocation 副本是只读临时位置；即使替换成功也会在
    // 下次启动时消失，所以必须要求用户先把应用安装到稳定目录。
    if app_bundle.to_string_lossy().contains("/AppTranslocation/") {
        return Err(
            "Axiom 正在 macOS 的隔离临时位置运行。请先将 Axiom 拖入“应用程序”文件夹，再使用自动更新。"
                .to_string(),
        );
    }

    log::info!("当前 .app bundle 路径：{}", app_bundle.display());
    Ok(app_bundle)
}

/// 检查下载并解压后的 bundle 是否完整且符合用户选择的 Release 版本。
/// 这一步必须在旧应用退出前完成，避免损坏或错版本资产覆盖可用版本。
fn validate_update_bundle(app_path: &Path, expected_version: &str) -> Result<(), String> {
    if !app_path.is_dir() {
        return Err(format!(
            "解压后的更新不是 .app 目录：{}",
            app_path.display()
        ));
    }

    let plist = app_path.join("Contents/Info.plist");
    let executable = app_path.join("Contents/MacOS/axiom");
    if !plist.is_file() || !executable.is_file() {
        return Err("更新包缺少 Axiom.app 的必要文件，已停止安装。".to_string());
    }

    let output = std::process::Command::new("/usr/libexec/PlistBuddy")
        .args(["-c", "Print :CFBundleShortVersionString"])
        .arg(&plist)
        .output()
        .map_err(|e| format!("读取更新包版本失败：{e}"))?;
    if !output.status.success() {
        return Err(format!(
            "读取更新包版本失败：{}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let actual = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let expected = expected_version.trim_start_matches('v');
    if actual != expected {
        return Err(format!(
            "更新包版本不匹配：期望 {expected}，实际 {actual}。已保留当前应用。"
        ));
    }

    Ok(())
}

/// 在退出当前应用前确认其父目录可写。更新脚本只能替换 bundle 本身，
/// 不会尝试提权或触及 Application Support 中的用户数据。
fn ensure_update_target_is_writable(app_bundle_path: &Path) -> Result<(), String> {
    let parent = app_bundle_path
        .parent()
        .ok_or_else(|| format!("无法获取应用安装目录：{}", app_bundle_path.display()))?;
    let probe = parent.join(format!(".axiom-update-write-probe-{}", Uuid::new_v4()));
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)
        .map_err(|e| {
            format!(
                "当前 Axiom 安装目录不可写（{}）：{e}。请将应用安装到“应用程序”文件夹或可写目录后重试。",
                parent.display()
            )
        })?;
    std::fs::remove_file(&probe).map_err(|e| format!("清理更新写入预检文件失败：{e}"))?;
    Ok(())
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

/// 生成 detached 安装脚本。
///
/// 脚本逻辑：
/// 1. 等待当前进程退出（PID 轮询，最长 30 秒）
/// 2. 先在旧 bundle 所在目录暂存并校验新 bundle，旧 bundle 仅改名为备份
/// 3. 在同一目录内原子切换 bundle；任一步失败均恢复旧 bundle
/// 4. 移除 quarantine 属性（Beta 未签名构建需要）并启动新版
/// 5. 仅在成功启动后清理备份和临时目录；安装日志永久保留
fn write_install_script(
    pid: u32,
    app_bundle_path: &Path,
    new_app_path: &Path,
    update_dir: &Path,
    install_log_path: &Path,
    expected_version: &str,
) -> Result<PathBuf, String> {
    let app_path = shell_quote(&app_bundle_path.to_string_lossy());
    let new_path = shell_quote(&new_app_path.to_string_lossy());
    let update_dir_quoted = shell_quote(&update_dir.to_string_lossy());
    let log_path = shell_quote(&install_log_path.to_string_lossy());
    let expected_version = shell_quote(expected_version.trim_start_matches('v'));

    let script = format!(
        r#"#!/bin/bash
# Axiom self-update installer (auto-generated)
# 等待当前应用退出后，以可回滚的方式替换 .app 并重新启动。

set -u

PID={pid}
APP_PATH={app_path}
NEW_APP_PATH={new_path}
UPDATE_DIR={update_dir_quoted}
LOG_FILE={log_path}
EXPECTED_VERSION={expected_version}
APP_PARENT_DIR="$(dirname "$APP_PATH")"
STAGED_APP_PATH="$APP_PARENT_DIR/.Axiom.app.axiom-staged-$PID"
BACKUP_PATH="$APP_PARENT_DIR/.Axiom.app.axiom-backup-$PID"

mkdir -p "$(dirname "$LOG_FILE")" || exit 1

log() {{
    echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"
}}

restore_backup() {{
    if [ -d "$BACKUP_PATH" ]; then
        log "恢复更新前的 Axiom.app ..."
        rm -rf "$APP_PATH"
        mv "$BACKUP_PATH" "$APP_PATH" >> "$LOG_FILE" 2>&1 || log "错误：恢复旧应用失败，请从 $BACKUP_PATH 手动恢复。"
    fi
}}

validate_bundle() {{
    local bundle="$1"
    local plist="$bundle/Contents/Info.plist"
    if [ ! -f "$plist" ] || [ ! -f "$bundle/Contents/MacOS/axiom" ]; then
        log "错误：新应用 bundle 文件不完整。"
        return 1
    fi
    local bundle_version
    bundle_version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$plist" 2>> "$LOG_FILE") || return 1
    if [ "$bundle_version" != "$EXPECTED_VERSION" ]; then
        log "错误：新应用版本不匹配（期望 $EXPECTED_VERSION，实际 $bundle_version）。"
        return 1
    fi
    if ! codesign --verify --deep --strict "$bundle" >> "$LOG_FILE" 2>&1; then
        log "新应用 bundle 签名不完整，补充 ad-hoc 签名..."
        codesign --force --deep --sign - "$bundle" >> "$LOG_FILE" 2>&1 || return 1
    fi
    codesign --verify --deep --strict "$bundle" >> "$LOG_FILE" 2>&1
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

# 先在目标目录暂存并完整校验新版。跨卷移动的耗时发生在旧版仍完整存在时。
log "暂存新应用到 $STAGED_APP_PATH ..."
if ! mv "$NEW_APP_PATH" "$STAGED_APP_PATH" >> "$LOG_FILE" 2>&1; then
    log "错误：无法暂存新应用，旧应用未被修改。"
    exit 1
fi
if ! validate_bundle "$STAGED_APP_PATH"; then
    log "错误：新应用校验失败，旧应用未被修改。"
    rm -rf "$STAGED_APP_PATH"
    exit 1
fi

# 同一目录内的 rename 可原子完成。先保留旧版备份；移动新版失败则立刻回滚。
log "备份当前应用到 $BACKUP_PATH ..."
if ! mv "$APP_PATH" "$BACKUP_PATH" >> "$LOG_FILE" 2>&1; then
    log "错误：无法备份当前应用，中止更新。"
    exit 1
fi
log "切换至新应用..."
if ! mv "$STAGED_APP_PATH" "$APP_PATH" >> "$LOG_FILE" 2>&1; then
    log "错误：无法切换至新应用，尝试恢复旧应用。"
    restore_backup
    exit 1
fi

if ! validate_bundle "$APP_PATH"; then
    log "错误：切换后的新应用校验失败，尝试恢复旧应用。"
    restore_backup
    exit 1
fi

# 移除 quarantine 属性（Beta 未签名构建需要）
log "移除 quarantine 属性..."
xattr -dr com.apple.quarantine "$APP_PATH" 2>/dev/null || true

# 重新启动应用。只有 open 成功后才删除旧版备份，失败时备份会保留供恢复。
log "重新启动 $APP_PATH ..."
if ! open -n "$APP_PATH" >> "$LOG_FILE" 2>&1; then
    log "错误：无法重新启动新版；旧版备份保留在 $BACKUP_PATH。"
    exit 1
fi

rm -rf "$BACKUP_PATH"
rm -rf "$UPDATE_DIR"
log "更新完成并已请求启动新版。"
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
/// 任一版本号无法解析时视为无更新（返回 false），避免字符串比较误判。
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
        // 无法解析的版本号一律视为无更新
        _ => false,
    }
}

// ────────────────────────────────────────────────────────────
// 测试
// ────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn create_signed_test_app(path: &Path, version: &str) {
        let contents = path.join("Contents");
        let executable_dir = contents.join("MacOS");
        std::fs::create_dir_all(&executable_dir).unwrap();
        std::fs::write(
            contents.join("Info.plist"),
            format!(
                r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleDevelopmentRegion</key><string>en</string>
<key>CFBundleExecutable</key><string>axiom</string>
<key>CFBundleIdentifier</key><string>com.axiom.study.test</string>
<key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>{version}</string>
<key>CFBundleVersion</key><string>{version}</string>
</dict></plist>"#
            ),
        )
        .unwrap();
        let executable = executable_dir.join("axiom");
        std::fs::write(&executable, "#!/bin/bash\nexit 0\n").unwrap();
        #[cfg(unix)]
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(std::process::Command::new("codesign")
            .args(["--force", "--deep", "--sign", "-"])
            .arg(path)
            .status()
            .unwrap()
            .success());
    }

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
    fn treats_unparseable_versions_as_no_update() {
        // 无法解析的版本号视为无更新，不再回退字符串比较
        assert!(!is_newer("abc", "def"));
        assert!(!is_newer("abc", "0.1.0"));
        assert!(!is_newer("0.2.0", "not-a-version"));
        assert!(!is_newer("1.2", "1.2.0"));
    }

    #[test]
    fn installer_stages_validates_and_rolls_back_without_touching_user_data() {
        let update_dir =
            std::env::temp_dir().join(format!("axiom-updater-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&update_dir).unwrap();
        let app_path = std::path::Path::new("/Applications/Axiom.app");
        let new_app_path = update_dir.join("Axiom.app");
        let install_log = update_dir.join("persistent-update.log");
        let script = write_install_script(
            42,
            app_path,
            &new_app_path,
            &update_dir,
            &install_log,
            "0.6.1",
        )
        .unwrap();
        let contents = std::fs::read_to_string(&script).unwrap();
        assert!(contents.contains("APP_PATH='/Applications/Axiom.app'"));
        assert!(contents.contains("EXPECTED_VERSION='0.6.1'"));
        assert!(
            contents.contains("STAGED_APP_PATH=\"$APP_PARENT_DIR/.Axiom.app.axiom-staged-$PID\"")
        );
        assert!(contents.contains("BACKUP_PATH=\"$APP_PARENT_DIR/.Axiom.app.axiom-backup-$PID\""));
        assert!(contents.contains("mv \"$APP_PATH\" \"$BACKUP_PATH\""));
        assert!(contents.contains("restore_backup"));
        assert!(contents.contains("open -n \"$APP_PATH\""));
        assert!(contents.contains("validate_bundle \"$APP_PATH\""));
        assert!(contents.contains("codesign --verify --deep --strict \"$bundle\""));
        assert!(contents.contains("codesign --force --deep --sign - \"$bundle\""));
        assert!(contents.contains("persistent-update.log"));
        assert!(!contents.contains("Application Support"));
        assert!(!contents.contains("axiom.db"));
        assert!(!contents.contains("media/"));
        let _ = std::fs::remove_dir_all(update_dir);
    }

    #[test]
    fn shell_quote_preserves_paths_with_single_quotes() {
        assert_eq!(
            shell_quote("/Applications/Peter's Axiom.app"),
            "'/Applications/Peter'\"'\"'s Axiom.app'"
        );
    }

    #[test]
    fn installer_replaces_signed_bundle_and_requests_restart() {
        let root = std::env::temp_dir().join(format!("axiom-updater-install-{}", Uuid::new_v4()));
        let applications = root.join("Applications");
        let update_dir = root.join("update");
        let old_app = applications.join("Axiom.app");
        let new_app = update_dir.join("Axiom.app");
        let install_log = root.join("logs/update-install.log");
        let marker = root.join("restarted-path.txt");
        let bin_dir = root.join("bin");

        create_signed_test_app(&old_app, "0.6.0");
        create_signed_test_app(&new_app, "0.6.1");
        std::fs::create_dir_all(&bin_dir).unwrap();
        let open_stub = bin_dir.join("open");
        std::fs::write(
            &open_stub,
            "#!/bin/bash\nprintf '%s' \"$2\" > \"$AXIOM_TEST_RESTART_MARKER\"\n",
        )
        .unwrap();
        #[cfg(unix)]
        std::fs::set_permissions(&open_stub, std::fs::Permissions::from_mode(0o755)).unwrap();

        let script = write_install_script(
            u32::MAX,
            &old_app,
            &new_app,
            &update_dir,
            &install_log,
            "0.6.1",
        )
        .unwrap();
        let path = format!(
            "{}:{}",
            bin_dir.display(),
            std::env::var("PATH").unwrap_or_default()
        );
        assert!(std::process::Command::new("bash")
            .arg(&script)
            .env("PATH", path)
            .env("AXIOM_TEST_RESTART_MARKER", &marker)
            .status()
            .unwrap()
            .success());

        assert!(std::fs::read_to_string(old_app.join("Contents/Info.plist"))
            .unwrap()
            .contains("<string>0.6.1</string>"));
        assert_eq!(
            std::fs::read_to_string(&marker).unwrap(),
            old_app.to_string_lossy()
        );
        assert!(std::fs::read_to_string(&install_log)
            .unwrap()
            .contains("更新完成并已请求启动新版。"));
        assert!(!applications
            .join(".Axiom.app.axiom-backup-4294967295")
            .exists());
        assert!(!update_dir.exists());
        let _ = std::fs::remove_dir_all(root);
    }
}
