use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCapabilities {
    pub platform: String,
    pub architecture: String,
    pub camera_backend: String,
    pub minimum_macos_version: String,
    pub app_data_dir: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedMedia {
    pub id: String,
    pub path: String,
    pub content_hash: String,
    pub byte_length: u64,
    pub source_type: String,
    pub captured_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedProblemImage {
    pub path: String,
    pub created: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CameraOrientationInfo {
    pub device_name: String,
    pub is_continuity_camera: bool,
    pub preview_rotation_angle: f64,
    pub capture_rotation_angle: f64,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextLine {
    pub id: String,
    pub text: String,
    pub confidence: f64,
    pub rect: NormalizedRect,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProblemBlock {
    pub id: String,
    pub title: String,
    pub rect: NormalizedRect,
    pub confidence: f64,
    pub line_ids: Vec<String>,
    pub source: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentProcessingResult {
    pub processing_run_id: Option<String>,
    pub corrected_path: String,
    pub width: i64,
    pub height: i64,
    pub page_detected: bool,
    pub corners: HashMap<String, Point>,
    pub text_lines: Vec<TextLine>,
    pub blocks: Vec<ProblemBlock>,
    pub enhancement_mode: String,
    pub warnings: Vec<String>,
    pub duration_ms: Option<u128>,
}
