use image::{DynamicImage, GrayImage, ImageBuffer, Rgb, RgbImage};
use serde::{Deserialize, Serialize};
use std::collections::{HashSet, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

const CORRECTED_WIDTH: u32 = 1190;
const CORRECTED_HEIGHT: u32 = 1684;
const MARKER_LEFT_X: f64 = 29.5 / 595.28;
const MARKER_RIGHT_X: f64 = 565.78 / 595.28;
const MARKER_TOP_Y: f64 = 29.5 / 841.89;
const MARKER_BOTTOM_Y: f64 = 812.39 / 841.89;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanRegion {
    id: String,
    practice_item_id: String,
    region_index: usize,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanLayout {
    page_id: String,
    page_identity: String,
    qr_payload: String,
    width_points: f64,
    height_points: f64,
    regions: Vec<ScanRegion>,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImagePoint {
    x: f64,
    y: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturedResponse {
    region_id: String,
    practice_item_id: String,
    region_index: usize,
    answer_asset_path: String,
    pixel_width: u32,
    pixel_height: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PracticeScanResult {
    practice_attempt_id: String,
    practice_document_page_id: String,
    page_identity: String,
    qr_payload: String,
    source_asset_path: String,
    corrected_asset_path: String,
    source_width: u32,
    source_height: u32,
    corrected_width: u32,
    corrected_height: u32,
    orientation_degrees: u16,
    page_detected: bool,
    corners: Vec<ImagePoint>,
    stages: Vec<String>,
    responses: Vec<CapturedResponse>,
}

#[derive(Clone, Copy, Debug)]
struct MarkerCandidate {
    center: ImagePoint,
}

fn validate_region(region: &ScanRegion) -> Result<(), String> {
    let values = [region.x, region.y, region.width, region.height];
    if values.iter().any(|value| !value.is_finite())
        || region.x < 0.0
        || region.y < 0.0
        || region.width <= 0.0
        || region.height <= 0.0
        || region.x + region.width > 1.000_001
        || region.y + region.height > 1.000_001
    {
        return Err(format!("答题区域 {} 超出页面边界", region.id));
    }
    Ok(())
}

fn rotate(image: &DynamicImage, degrees: u16) -> DynamicImage {
    match degrees {
        90 => image.rotate90(),
        180 => image.rotate180(),
        270 => image.rotate270(),
        _ => image.clone(),
    }
}

fn decode_qr(image: &DynamicImage) -> Option<(String, u16)> {
    let gray = image.to_luma8();
    let mut decoder = quircs::Quirc::default();
    for code in decoder.identify(gray.width() as usize, gray.height() as usize, gray.as_raw()) {
        let Ok(code) = code else { continue };
        let top_edge_x = f64::from(code.corners[1].x - code.corners[0].x);
        let top_edge_y = f64::from(code.corners[1].y - code.corners[0].y);
        let observed_quarter_turns =
            (top_edge_y.atan2(top_edge_x).to_degrees() / 90.0).round() as i32;
        let correction = ((4 - observed_quarter_turns.rem_euclid(4)) % 4 * 90) as u16;
        let Ok(decoded) = code.decode() else { continue };
        let Ok(payload) = String::from_utf8(decoded.payload) else {
            continue;
        };
        if payload.starts_with("AXIOM|layout=practice-a4-v1|")
            || payload.starts_with("AXIOM|v=2|page=")
            || payload.starts_with("AXIOM|v=3|page=")
        {
            return Some((payload, correction));
        }
    }
    None
}

fn recognize_identity(image: &DynamicImage) -> Result<(DynamicImage, u16, String), String> {
    for trial_degrees in [0, 90, 180, 270] {
        let trial = rotate(image, trial_degrees);
        if let Some((payload, additional_degrees)) = decode_qr(&trial) {
            let degrees = (trial_degrees + additional_degrees) % 360;
            return Ok((rotate(image, degrees), degrees, payload));
        }
    }
    Err("未识别到 Axiom 答题卡页面身份；请确保二维码完整、清晰且未被遮挡".to_string())
}

fn in_corner_zone(x: u32, y: u32, width: u32, height: u32) -> bool {
    (x < width * 22 / 100 || x > width * 78 / 100)
        && (y < height * 17 / 100 || y > height * 83 / 100)
}

fn marker_candidates(gray: &GrayImage) -> Vec<MarkerCandidate> {
    let width = gray.width();
    let height = gray.height();
    let mut visited = vec![false; (width * height) as usize];
    let mut candidates = Vec::new();
    let min_dimension = width.min(height) as f64;
    let min_size = (min_dimension * 0.004).max(3.0);
    let max_size = min_dimension * 0.07;

    for y in 0..height {
        for x in 0..width {
            let index = (y * width + x) as usize;
            if visited[index] || !in_corner_zone(x, y, width, height) || gray[(x, y)][0] > 92 {
                continue;
            }
            let mut queue = VecDeque::from([(x, y)]);
            visited[index] = true;
            let (mut min_x, mut max_x, mut min_y, mut max_y) = (x, x, y, y);
            let mut area = 0_u32;
            while let Some((current_x, current_y)) = queue.pop_front() {
                area += 1;
                min_x = min_x.min(current_x);
                max_x = max_x.max(current_x);
                min_y = min_y.min(current_y);
                max_y = max_y.max(current_y);
                for (next_x, next_y) in [
                    (current_x.saturating_sub(1), current_y),
                    (current_x.saturating_add(1), current_y),
                    (current_x, current_y.saturating_sub(1)),
                    (current_x, current_y.saturating_add(1)),
                ] {
                    if next_x >= width
                        || next_y >= height
                        || !in_corner_zone(next_x, next_y, width, height)
                    {
                        continue;
                    }
                    let next_index = (next_y * width + next_x) as usize;
                    if !visited[next_index] && gray[(next_x, next_y)][0] <= 92 {
                        visited[next_index] = true;
                        queue.push_back((next_x, next_y));
                    }
                }
            }
            let component_width = f64::from(max_x - min_x + 1);
            let component_height = f64::from(max_y - min_y + 1);
            let ratio = component_width / component_height;
            let density = f64::from(area) / (component_width * component_height);
            if component_width >= min_size
                && component_height >= min_size
                && component_width <= max_size
                && component_height <= max_size
                && (0.45..=2.2).contains(&ratio)
                && density >= 0.55
            {
                candidates.push(MarkerCandidate {
                    center: ImagePoint {
                        x: f64::from(min_x + max_x) / 2.0,
                        y: f64::from(min_y + max_y) / 2.0,
                    },
                });
            }
        }
    }
    candidates
}

fn detect_markers(image: &DynamicImage) -> Result<[ImagePoint; 4], String> {
    let gray = image.to_luma8();
    let candidates = marker_candidates(&gray);
    let targets = [
        ImagePoint { x: 0.0, y: 0.0 },
        ImagePoint {
            x: f64::from(gray.width()),
            y: 0.0,
        },
        ImagePoint {
            x: f64::from(gray.width()),
            y: f64::from(gray.height()),
        },
        ImagePoint {
            x: 0.0,
            y: f64::from(gray.height()),
        },
    ];
    let mut used = HashSet::new();
    let mut selected = Vec::new();
    for target in targets {
        let candidate = candidates
            .iter()
            .enumerate()
            .filter(|(index, _)| !used.contains(index))
            .min_by(|(_, left), (_, right)| {
                let left_distance =
                    (left.center.x - target.x).powi(2) + (left.center.y - target.y).powi(2);
                let right_distance =
                    (right.center.x - target.x).powi(2) + (right.center.y - target.y).powi(2);
                left_distance.total_cmp(&right_distance)
            });
        let Some((index, candidate)) = candidate else {
            return Err("未检测到四个完整的页面定位标记；请保留整张纸并避免阴影遮挡".to_string());
        };
        used.insert(index);
        selected.push(candidate.center);
    }
    selected
        .try_into()
        .map_err(|_| "页面定位标记数量错误".to_string())
}

fn solve_homography(
    destination: [ImagePoint; 4],
    source: [ImagePoint; 4],
) -> Result<[f64; 8], String> {
    let mut matrix = [[0.0_f64; 9]; 8];
    for (index, (to, from)) in destination.into_iter().zip(source).enumerate() {
        let row = index * 2;
        matrix[row] = [
            to.x,
            to.y,
            1.0,
            0.0,
            0.0,
            0.0,
            -from.x * to.x,
            -from.x * to.y,
            from.x,
        ];
        matrix[row + 1] = [
            0.0,
            0.0,
            0.0,
            to.x,
            to.y,
            1.0,
            -from.y * to.x,
            -from.y * to.y,
            from.y,
        ];
    }
    for column in 0..8 {
        let pivot = (column..8)
            .max_by(|left, right| {
                matrix[*left][column]
                    .abs()
                    .total_cmp(&matrix[*right][column].abs())
            })
            .ok_or_else(|| "页面透视矩阵不可解".to_string())?;
        if matrix[pivot][column].abs() < 1e-9 {
            return Err("页面透视矩阵退化；请重新拍摄完整页面".to_string());
        }
        matrix.swap(column, pivot);
        let divisor = matrix[column][column];
        for value in matrix[column].iter_mut().skip(column) {
            *value /= divisor;
        }
        let normalized_pivot = matrix[column];
        for (row, values) in matrix.iter_mut().enumerate() {
            if row == column {
                continue;
            }
            let factor = values[column];
            for (value, pivot_value) in values.iter_mut().zip(normalized_pivot).skip(column) {
                *value -= factor * pivot_value;
            }
        }
    }
    Ok(std::array::from_fn(|index| matrix[index][8]))
}

fn sample_bilinear(image: &RgbImage, x: f64, y: f64) -> Rgb<u8> {
    if x < 0.0 || y < 0.0 || x >= f64::from(image.width() - 1) || y >= f64::from(image.height() - 1)
    {
        return Rgb([255, 255, 255]);
    }
    let x0 = x.floor() as u32;
    let y0 = y.floor() as u32;
    let dx = x - f64::from(x0);
    let dy = y - f64::from(y0);
    let pixels = [
        image[(x0, y0)],
        image[(x0 + 1, y0)],
        image[(x0, y0 + 1)],
        image[(x0 + 1, y0 + 1)],
    ];
    Rgb(std::array::from_fn(|channel| {
        let top = f64::from(pixels[0][channel]) * (1.0 - dx) + f64::from(pixels[1][channel]) * dx;
        let bottom =
            f64::from(pixels[2][channel]) * (1.0 - dx) + f64::from(pixels[3][channel]) * dx;
        (top * (1.0 - dy) + bottom * dy).round() as u8
    }))
}

fn correct_perspective(image: &DynamicImage, markers: [ImagePoint; 4]) -> Result<RgbImage, String> {
    let destination_markers = [
        ImagePoint {
            x: MARKER_LEFT_X * f64::from(CORRECTED_WIDTH),
            y: MARKER_TOP_Y * f64::from(CORRECTED_HEIGHT),
        },
        ImagePoint {
            x: MARKER_RIGHT_X * f64::from(CORRECTED_WIDTH),
            y: MARKER_TOP_Y * f64::from(CORRECTED_HEIGHT),
        },
        ImagePoint {
            x: MARKER_RIGHT_X * f64::from(CORRECTED_WIDTH),
            y: MARKER_BOTTOM_Y * f64::from(CORRECTED_HEIGHT),
        },
        ImagePoint {
            x: MARKER_LEFT_X * f64::from(CORRECTED_WIDTH),
            y: MARKER_BOTTOM_Y * f64::from(CORRECTED_HEIGHT),
        },
    ];
    let homography = solve_homography(destination_markers, markers)?;
    let source = image.to_rgb8();
    Ok(ImageBuffer::from_fn(
        CORRECTED_WIDTH,
        CORRECTED_HEIGHT,
        |x, y| {
            let x = f64::from(x);
            let y = f64::from(y);
            let denominator = homography[6] * x + homography[7] * y + 1.0;
            if denominator.abs() < 1e-9 {
                return Rgb([255, 255, 255]);
            }
            sample_bilinear(
                &source,
                (homography[0] * x + homography[1] * y + homography[2]) / denominator,
                (homography[3] * x + homography[4] * y + homography[5]) / denominator,
            )
        },
    ))
}

fn practice_media_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?
        .join("media")
        .join("practice");
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建练习回传目录：{error}"))?;
    Ok(directory)
}

fn validate_source(app: &AppHandle, source_path: &str) -> Result<PathBuf, String> {
    let source = Path::new(source_path)
        .canonicalize()
        .map_err(|error| format!("无法读取答题卡图片：{error}"))?;
    let media_root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?
        .join("media")
        .canonicalize()
        .map_err(|error| format!("无法读取 Axiom 媒体目录：{error}"))?;
    if !source.is_file() || !source.starts_with(media_root) {
        return Err("只能处理已导入 Axiom 的答题卡图片".to_string());
    }
    Ok(source)
}

fn crop_region(image: &RgbImage, region: &ScanRegion) -> Result<RgbImage, String> {
    validate_region(region)?;
    let x = (region.x * f64::from(image.width())).round() as u32;
    let y = (region.y * f64::from(image.height())).round() as u32;
    let width = (region.width * f64::from(image.width())).round().max(1.0) as u32;
    let height = (region.height * f64::from(image.height())).round().max(1.0) as u32;
    if x + width > image.width() || y + height > image.height() {
        return Err(format!("答题区域 {} 的像素边界无效", region.id));
    }
    Ok(image::imageops::crop_imm(image, x, y, width, height).to_image())
}

fn run_capture(
    source: &Path,
    output_directory: &Path,
    practice_attempt_id: &str,
    layouts: &[ScanLayout],
) -> Result<PracticeScanResult, String> {
    run_capture_with_layout(source, output_directory, practice_attempt_id, layouts, None)
}

fn run_capture_with_layout(
    source: &Path,
    output_directory: &Path,
    practice_attempt_id: &str,
    layouts: &[ScanLayout],
    forced_page_id: Option<&str>,
) -> Result<PracticeScanResult, String> {
    if layouts.is_empty() {
        return Err("没有可用于识别的答题卡布局，请先导出机器答题卡".to_string());
    }
    let source_image =
        image::open(source).map_err(|error| format!("答题卡图片格式无效：{error}"))?;
    let source_width = source_image.width();
    let source_height = source_image.height();
    let (oriented, orientation_degrees, payload, layout, identity_stage) =
        if let Some(page_id) = forced_page_id {
            let layout = layouts
                .iter()
                .find(|candidate| candidate.page_id == page_id)
                .ok_or_else(|| "手动选择的页面不属于当前 PracticeSet".to_string())?;
            let degrees = if source_width > source_height { 90 } else { 0 };
            (
                rotate(&source_image, degrees),
                degrees,
                layout.qr_payload.clone(),
                layout,
                "manual_layout_selection",
            )
        } else {
            let (oriented, degrees, payload) = recognize_identity(&source_image)?;
            let layout = layouts
                .iter()
                .find(|candidate| candidate.qr_payload == payload)
                .ok_or_else(|| "页面身份不属于当前 PracticeSet，未提取任何作答区域".to_string())?;
            (oriented, degrees, payload, layout, "identity_recognition")
        };
    if (layout.width_points - 595.28).abs() > 0.5 || (layout.height_points - 841.89).abs() > 0.5 {
        return Err("页面身份对应的布局不是受支持的 A4 版本".to_string());
    }
    for region in &layout.regions {
        validate_region(region)?;
    }
    let markers = detect_markers(&oriented)?;
    let corrected = correct_perspective(&oriented, markers)?;
    let corrected_path = output_directory.join(format!(
        "{}-page-{}.jpg",
        practice_attempt_id,
        Uuid::new_v4()
    ));
    corrected
        .save_with_format(&corrected_path, image::ImageFormat::Jpeg)
        .map_err(|error| format!("保存矫正答题卡失败：{error}"))?;
    let mut responses = Vec::new();
    for region in &layout.regions {
        let crop = crop_region(&corrected, region)?;
        let path = output_directory.join(format!(
            "{}-answer-{}-{}.jpg",
            practice_attempt_id,
            region.region_index,
            Uuid::new_v4()
        ));
        crop.save_with_format(&path, image::ImageFormat::Jpeg)
            .map_err(|error| format!("保存独立答题区域失败：{error}"))?;
        responses.push(CapturedResponse {
            region_id: region.id.clone(),
            practice_item_id: region.practice_item_id.clone(),
            region_index: region.region_index,
            answer_asset_path: path.to_string_lossy().to_string(),
            pixel_width: crop.width(),
            pixel_height: crop.height(),
        });
    }
    Ok(PracticeScanResult {
        practice_attempt_id: practice_attempt_id.to_string(),
        practice_document_page_id: layout.page_id.clone(),
        page_identity: layout.page_identity.clone(),
        qr_payload: payload,
        source_asset_path: source.to_string_lossy().to_string(),
        corrected_asset_path: corrected_path.to_string_lossy().to_string(),
        source_width,
        source_height,
        corrected_width: corrected.width(),
        corrected_height: corrected.height(),
        orientation_degrees,
        page_detected: true,
        corners: markers.into_iter().collect(),
        stages: [
            "page_detection",
            identity_stage,
            "orientation",
            "perspective_correction",
            "layout_lookup",
            "answer_region_extraction",
            "per_item_crop",
        ]
        .into_iter()
        .map(str::to_string)
        .collect(),
        responses,
    })
}

fn validate_practice_attempt_id(practice_attempt_id: &str) -> Result<(), String> {
    if practice_attempt_id.is_empty()
        || practice_attempt_id.contains('/')
        || practice_attempt_id.contains('\\')
        || practice_attempt_id.contains("..")
    {
        return Err("PracticeAttempt ID 无效".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn process_practice_scan(
    app: AppHandle,
    source_path: String,
    practice_attempt_id: String,
    layouts: Vec<ScanLayout>,
) -> Result<PracticeScanResult, String> {
    validate_practice_attempt_id(&practice_attempt_id)?;
    let source = validate_source(&app, &source_path)?;
    let output_directory = practice_media_directory(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        run_capture(&source, &output_directory, &practice_attempt_id, &layouts)
    })
    .await
    .map_err(|error| format!("等待答题卡扫描任务失败：{error}"))?
}

#[tauri::command]
pub async fn process_practice_scan_for_page(
    app: AppHandle,
    source_path: String,
    practice_attempt_id: String,
    layouts: Vec<ScanLayout>,
    practice_document_page_id: String,
) -> Result<PracticeScanResult, String> {
    validate_practice_attempt_id(&practice_attempt_id)?;
    if practice_document_page_id.trim().is_empty() {
        return Err("必须选择当前练习中的页面".to_string());
    }
    let source = validate_source(&app, &source_path)?;
    let output_directory = practice_media_directory(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        run_capture_with_layout(
            &source,
            &output_directory,
            &practice_attempt_id,
            &layouts,
            Some(&practice_document_page_id),
        )
    })
    .await
    .map_err(|error| format!("等待手动页面扫描任务失败：{error}"))?
}

#[tauri::command]
pub fn prepare_practice_submission(app: AppHandle, source_path: String) -> Result<String, String> {
    let source = PathBuf::from(&source_path)
        .canonicalize()
        .map_err(|error| format!("无法读取作答文件：{error}"))?;
    if !source.is_file() {
        return Err("作答文件不存在".to_string());
    }
    if source
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_lowercase)
        .as_deref()
        != Some("pdf")
    {
        return Err("只有 PDF 需要转换后提交".to_string());
    }
    let destination =
        practice_media_directory(&app)?.join(format!("submission-{}.png", Uuid::new_v4()));
    let output = std::process::Command::new("/usr/bin/sips")
        .args(["-s", "format", "png"])
        .arg(&source)
        .arg("--out")
        .arg(&destination)
        .output()
        .map_err(|error| format!("无法转换 PDF 作答文件：{error}"))?;
    if !output.status.success() || !destination.is_file() {
        return Err("PDF 转换失败，请改为上传清晰的 JPG 或 PNG 图片".to_string());
    }
    Ok(destination.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use qrcode::QrCode;

    #[test]
    fn decodes_an_external_generated_practice_page_when_provided() {
        let Ok(path) = std::env::var("AXIOM_CAPTURE_PAGE_FIXTURE") else {
            return;
        };
        let image = image::open(path).expect("external practice page should open");
        let (_, _, payload) = recognize_identity(&image).expect("generated page QR should decode");
        if let Ok(expected) = std::env::var("AXIOM_CAPTURE_EXPECTED_QR") {
            assert_eq!(payload, expected);
        }
        eprintln!("decoded practice QR: {payload}");
    }

    fn fixture(payload: &str) -> RgbImage {
        let mut image = RgbImage::from_pixel(800, 1132, Rgb([255, 255, 255]));
        let markers = [
            (MARKER_LEFT_X, MARKER_TOP_Y),
            (MARKER_RIGHT_X, MARKER_TOP_Y),
            (MARKER_RIGHT_X, MARKER_BOTTOM_Y),
            (MARKER_LEFT_X, MARKER_BOTTOM_Y),
        ];
        for (x, y) in markers {
            let center_x = (x * 800.0).round() as i32;
            let center_y = (y * 1132.0).round() as i32;
            for pixel_y in center_y - 8..=center_y + 8 {
                for pixel_x in center_x - 8..=center_x + 8 {
                    image.put_pixel(pixel_x as u32, pixel_y as u32, Rgb([0, 0, 0]));
                }
            }
        }
        let code = QrCode::new(payload.as_bytes()).expect("QR fixture");
        for row in 0..code.width() {
            for column in 0..code.width() {
                if code[(column, row)] != qrcode::Color::Dark {
                    continue;
                }
                for offset_y in 0..3 {
                    for offset_x in 0..3 {
                        image.put_pixel(
                            570 + ((column + 4) * 3 + offset_x) as u32,
                            35 + ((row + 4) * 3 + offset_y) as u32,
                            Rgb([0, 0, 0]),
                        );
                    }
                }
            }
        }
        for y in 235..295 {
            for x in 105..690 {
                if (x + y) % 19 < 3 {
                    image.put_pixel(x, y, Rgb([32, 45, 70]));
                }
            }
        }
        image
    }

    fn layout(payload: &str) -> ScanLayout {
        ScanLayout {
            page_id: "page-1".into(),
            page_identity: "identity-1".into(),
            qr_payload: payload.into(),
            width_points: 595.28,
            height_points: 841.89,
            regions: vec![ScanRegion {
                id: "region-1".into(),
                practice_item_id: "item-1".into(),
                region_index: 0,
                x: 0.1,
                y: 0.19,
                width: 0.8,
                height: 0.1,
            }],
        }
    }

    fn perspective_fixture(source: &RgbImage) -> RgbImage {
        let target_corners = [
            ImagePoint { x: 68.0, y: 35.0 },
            ImagePoint { x: 842.0, y: 82.0 },
            ImagePoint {
                x: 864.0,
                y: 1210.0,
            },
            ImagePoint { x: 32.0, y: 1168.0 },
        ];
        let source_corners = [
            ImagePoint { x: 0.0, y: 0.0 },
            ImagePoint {
                x: f64::from(source.width() - 1),
                y: 0.0,
            },
            ImagePoint {
                x: f64::from(source.width() - 1),
                y: f64::from(source.height() - 1),
            },
            ImagePoint {
                x: 0.0,
                y: f64::from(source.height() - 1),
            },
        ];
        let transform =
            solve_homography(target_corners, source_corners).expect("fixture transform");
        ImageBuffer::from_fn(900, 1240, |x, y| {
            let x = f64::from(x);
            let y = f64::from(y);
            let denominator = transform[6] * x + transform[7] * y + 1.0;
            sample_bilinear(
                source,
                (transform[0] * x + transform[1] * y + transform[2]) / denominator,
                (transform[3] * x + transform[4] * y + transform[5]) / denominator,
            )
        })
    }

    #[test]
    fn recovers_rotated_page_identity_and_individual_answer_crop() {
        let payload =
            "AXIOM|layout=practice-a4-v1|set=set-1|attempt=attempt-1|document=document-1|page=0";
        let directory =
            std::env::temp_dir().join(format!("axiom-practice-capture-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).expect("temporary output");
        let source = directory.join("rotated.png");
        DynamicImage::ImageRgb8(fixture(payload))
            .rotate270()
            .save(&source)
            .expect("fixture image");
        let result = run_capture(&source, &directory, "attempt-1", &[layout(payload)])
            .expect("capture rotated sheet");
        assert_eq!(result.orientation_degrees, 90);
        assert_eq!(result.page_identity, "identity-1");
        assert_eq!(result.responses.len(), 1);
        assert!(Path::new(&result.responses[0].answer_asset_path).is_file());
        assert_eq!(
            result.stages.last().map(String::as_str),
            Some("per_item_crop")
        );
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn captures_a_v2_practice_page_with_an_inline_answer_region() {
        let payload = "AXIOM|v=2|page=f85cb7bd0910177ef1109b1502a204d3";
        let directory =
            std::env::temp_dir().join(format!("axiom-practice-v2-capture-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).expect("temporary output");
        let source = directory.join("practice-page.png");
        fixture(payload).save(&source).expect("fixture image");
        let result = run_capture(&source, &directory, "attempt-v2", &[layout(payload)])
            .expect("capture v2 practice page");
        assert_eq!(result.page_identity, "identity-1");
        assert_eq!(result.responses.len(), 1);
        assert!(Path::new(&result.responses[0].answer_asset_path).is_file());
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn manual_page_selection_recovers_a_sheet_with_an_unreadable_qr() {
        let payload = "AXIOM|v=3|page=manual-fixture";
        let directory =
            std::env::temp_dir().join(format!("axiom-practice-manual-capture-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).expect("temporary output");
        let source = directory.join("practice-page-no-qr.png");
        let mut image = fixture(payload);
        for y in 20..190 {
            for x in 540..720 {
                image.put_pixel(x, y, Rgb([255, 255, 255]));
            }
        }
        image.save(&source).expect("fixture image");
        assert!(run_capture(&source, &directory, "attempt-manual", &[layout(payload)]).is_err());

        let result = run_capture_with_layout(
            &source,
            &directory,
            "attempt-manual",
            &[layout(payload)],
            Some("page-1"),
        )
        .expect("manual page selection should use the persisted layout");
        assert_eq!(result.practice_document_page_id, "page-1");
        assert!(result
            .stages
            .iter()
            .any(|stage| stage == "manual_layout_selection"));
        assert_eq!(result.responses.len(), 1);
        assert!(run_capture_with_layout(
            &source,
            &directory,
            "attempt-manual",
            &[layout(payload)],
            Some("foreign-page"),
        )
        .is_err());
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn rejects_a_recognized_page_from_another_practice_set() {
        let payload = "AXIOM|layout=practice-a4-v1|set=foreign|attempt=a|document=d|page=0";
        let directory =
            std::env::temp_dir().join(format!("axiom-practice-capture-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).expect("temporary output");
        let source = directory.join("foreign.png");
        fixture(payload).save(&source).expect("fixture image");
        let error = run_capture(
            &source,
            &directory,
            "attempt-1",
            &[layout(
                "AXIOM|layout=practice-a4-v1|set=set-1|attempt=a|document=d|page=0",
            )],
        )
        .expect_err("foreign page must fail");
        assert!(error.contains("不属于当前 PracticeSet"));
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn corrects_perspective_before_cropping_the_answer_region() {
        let payload =
            "AXIOM|layout=practice-a4-v1|set=set-1|attempt=attempt-1|document=document-1|page=0";
        let directory =
            std::env::temp_dir().join(format!("axiom-practice-capture-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).expect("temporary output");
        let source = directory.join("perspective.png");
        perspective_fixture(&fixture(payload))
            .save(&source)
            .expect("perspective fixture");
        let result = run_capture(&source, &directory, "attempt-1", &[layout(payload)])
            .expect("capture perspective sheet");
        let crop = image::open(&result.responses[0].answer_asset_path)
            .expect("answer crop")
            .to_luma8();
        let ink_pixels = crop.pixels().filter(|pixel| pixel[0] < 150).count();
        assert!(
            ink_pixels > 1_000,
            "the corrected crop must retain the written answer strokes"
        );
        assert_eq!(
            (result.corrected_width, result.corrected_height),
            (1190, 1684)
        );
        let _ = fs::remove_dir_all(directory);
    }
}
