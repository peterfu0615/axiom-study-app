//! Signed application updates backed by the official Tauri Updater plugin.
//!
//! The update URL and public key live in `tauri.conf.json`. The frontend and
//! schema-ahead recovery path can only ask the plugin to re-check that signed
//! manifest; neither accepts an arbitrary artifact URL.

use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc,
};
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

const UPDATE_OWNER: &str = match option_env!("UPDATE_REPO_OWNER") {
    Some(owner) => owner,
    None => "peterfu0615",
};
const UPDATE_REPO: &str = match option_env!("UPDATE_REPO") {
    Some(repo) => repo,
    None => "axiom-study-app",
};

pub fn latest_release_page_url() -> String {
    format!("https://github.com/{UPDATE_OWNER}/{UPDATE_REPO}/releases/latest")
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "snake_case")]
enum UpdateStage {
    Checking,
    Downloading,
    VerifyingSignature,
    Installing,
    Relaunching,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateProgress {
    stage: UpdateStage,
    downloaded: u64,
    total: Option<u64>,
    percent: Option<f64>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateFailure {
    stage: UpdateStage,
    code: &'static str,
    message: String,
    retryable: bool,
    manual_download_url: String,
}

fn failure(stage: UpdateStage, code: &'static str, message: impl Into<String>) -> String {
    let error = UpdateFailure {
        stage,
        code,
        message: message.into(),
        retryable: !matches!(code, "signature_invalid" | "manifest_invalid"),
        manual_download_url: latest_release_page_url(),
    };
    log::error!(
        target: "axiom_lib::updater",
        "签名更新失败 stage={:?} code={} version={} arch={}",
        error.stage,
        error.code,
        env!("CARGO_PKG_VERSION"),
        std::env::consts::ARCH,
    );
    serde_json::to_string(&error).unwrap_or_else(|_| "更新失败".to_string())
}

fn plugin_error(stage: UpdateStage, reason: impl std::fmt::Display) -> String {
    let detail = reason.to_string().to_lowercase();
    let code = if detail.contains("signature") || detail.contains("minisign") {
        "signature_invalid"
    } else if detail.contains("json") || detail.contains("manifest") {
        "manifest_invalid"
    } else if detail.contains("network") || detail.contains("request") || detail.contains("http") {
        "network_unavailable"
    } else {
        "updater_plugin_failed"
    };
    failure(stage, code, "签名更新未能完成，请重试或使用手动下载。")
}

fn emit_progress(app: &AppHandle, progress: UpdateProgress) {
    let _ = app.emit("update://progress", progress);
}

#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Schema-ahead startup recovery uses the same configured endpoint and public
/// key as the normal UI. The signed bundle is fully verified before Tauri
/// replaces the running application.
pub async fn install_latest_signed_update(app: AppHandle) -> Result<bool, String> {
    emit_progress(
        &app,
        UpdateProgress {
            stage: UpdateStage::Checking,
            downloaded: 0,
            total: None,
            percent: None,
        },
    );
    let updater = app
        .updater()
        .map_err(|error| plugin_error(UpdateStage::Checking, error))?;
    let Some(update) = updater
        .check()
        .await
        .map_err(|error| plugin_error(UpdateStage::Checking, error))?
    else {
        return Ok(false);
    };
    let downloaded = Arc::new(AtomicU64::new(0));
    let progress_downloaded = downloaded.clone();
    let finished_downloaded = downloaded.clone();
    let download_finished = Arc::new(AtomicBool::new(false));
    let finished_flag = download_finished.clone();
    let progress_app = app.clone();
    let finished_app = app.clone();
    let bytes = update
        .download(
            move |chunk_length, content_length| {
                let downloaded = progress_downloaded
                    .fetch_add(chunk_length as u64, Ordering::Relaxed)
                    .saturating_add(chunk_length as u64);
                emit_progress(
                    &progress_app,
                    UpdateProgress {
                        stage: UpdateStage::Downloading,
                        downloaded,
                        total: content_length,
                        percent: content_length.filter(|total| *total > 0).map(|total| {
                            (downloaded as f64 / total as f64 * 100.0).clamp(0.0, 100.0)
                        }),
                    },
                );
            },
            move || {
                finished_flag.store(true, Ordering::Relaxed);
                let downloaded = finished_downloaded.load(Ordering::Relaxed);
                emit_progress(
                    &finished_app,
                    UpdateProgress {
                        stage: UpdateStage::VerifyingSignature,
                        downloaded,
                        total: Some(downloaded),
                        percent: Some(100.0),
                    },
                );
            },
        )
        .await
        .map_err(|error| {
            let stage = if download_finished.load(Ordering::Relaxed) {
                UpdateStage::VerifyingSignature
            } else {
                UpdateStage::Downloading
            };
            plugin_error(stage, error)
        })?;
    let downloaded = downloaded.load(Ordering::Relaxed);
    emit_progress(
        &app,
        UpdateProgress {
            stage: UpdateStage::Installing,
            downloaded,
            total: Some(downloaded),
            percent: Some(100.0),
        },
    );
    update
        .install(&bytes)
        .map_err(|error| plugin_error(UpdateStage::Installing, error))?;
    emit_progress(
        &app,
        UpdateProgress {
            stage: UpdateStage::Relaunching,
            downloaded,
            total: Some(downloaded),
            percent: Some(100.0),
        },
    );
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::{failure, plugin_error, UpdateStage};

    #[test]
    fn failures_are_structured_and_never_contain_artifact_urls() {
        let value: serde_json::Value = serde_json::from_str(&failure(
            UpdateStage::Checking,
            "network_unavailable",
            "temporarily unavailable",
        ))
        .expect("structured updater failure");
        assert_eq!(value["stage"], "checking");
        assert_eq!(value["code"], "network_unavailable");
        assert_eq!(value["retryable"], true);
        assert!(value.get("downloadUrl").is_none());
    }

    #[test]
    fn signature_and_manifest_errors_are_stable_and_not_retryable() {
        for (reason, expected) in [
            ("minisign signature mismatch", "signature_invalid"),
            ("manifest json invalid", "manifest_invalid"),
        ] {
            let value: serde_json::Value =
                serde_json::from_str(&plugin_error(UpdateStage::VerifyingSignature, reason))
                    .expect("structured updater error");
            assert_eq!(value["code"], expected);
            assert_eq!(value["retryable"], false);
        }
    }
}
