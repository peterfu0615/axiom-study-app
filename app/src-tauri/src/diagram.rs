use std::{
    fs,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

pub const TIKZ_RENDERER_VERSION: &str = "axiom-restricted-svg-v4";
pub const TIKZ_PREAMBLE_VERSION: &str = "axiom-tikz-preamble-v2";
pub const TIKZ_VALIDATOR_VERSION: &str = "axiom-diagram-validator-v2";
const MAX_SOURCE_BYTES: usize = 32 * 1024;
const MAX_COMMANDS: usize = 500;
const MAX_OUTPUT_BYTES: usize = 1024 * 1024;
const RENDER_TIMEOUT: Duration = Duration::from_millis(250);

const FORBIDDEN_COMMANDS: &[&str] = &[
    "\\documentclass",
    "\\usepackage",
    "\\input",
    "\\include",
    "\\openin",
    "\\openout",
    "\\read",
    "\\write",
    "\\immediate",
    "\\special",
    "\\catcode",
    "\\csname",
    "\\newcommand",
    "\\renewcommand",
    "\\def",
    "\\loop",
    "\\foreach",
    "\\begin{document}",
    "\\end{document}",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TikzRenderResult {
    pub render_status: String,
    pub rendered_asset_path: Option<String>,
    pub rendered_mime_type: Option<String>,
    pub render_hash: String,
    pub renderer_version: String,
    pub cache_hit: bool,
    pub validation_status: String,
    pub validation_errors: Vec<String>,
    pub width: Option<f64>,
    pub height: Option<f64>,
    pub aspect_ratio: Option<f64>,
    pub ink_coverage: Option<f64>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagramValidationContract {
    #[serde(default)]
    required_labels: Vec<String>,
    #[serde(default)]
    required_relations: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum RenderError {
    Empty,
    SourceTooLarge,
    ForbiddenCommand(String),
    UnsupportedCommand(String),
    InvalidGeometry(String),
    TooManyCommands,
    Timeout,
    OutputTooLarge,
    VisualValidation(String),
    SemanticValidation(String),
    Io(String),
}

impl RenderError {
    fn code(&self) -> &'static str {
        match self {
            Self::Empty => "empty_source",
            Self::SourceTooLarge => "source_too_large",
            Self::ForbiddenCommand(_) => "forbidden_command",
            Self::UnsupportedCommand(_) => "unsupported_command",
            Self::InvalidGeometry(_) => "invalid_geometry",
            Self::TooManyCommands => "too_many_commands",
            Self::Timeout => "render_timeout",
            Self::OutputTooLarge => "output_too_large",
            Self::VisualValidation(_) => "visual_validation_failed",
            Self::SemanticValidation(_) => "semantic_validation_failed",
            Self::Io(_) => "render_io_failed",
        }
    }

    fn message(&self) -> String {
        match self {
            Self::Empty => "TikZ 内容为空".to_string(),
            Self::SourceTooLarge => "TikZ 内容超过 32 KB 限制".to_string(),
            Self::ForbiddenCommand(command) => format!("TikZ 包含禁止命令：{command}"),
            Self::UnsupportedCommand(command) => format!("暂不支持此 TikZ 命令：{command}"),
            Self::InvalidGeometry(detail) => format!("TikZ 图形无法解析：{detail}"),
            Self::TooManyCommands => "TikZ 命令数量超过限制".to_string(),
            Self::Timeout => "TikZ 渲染超过时间限制".to_string(),
            Self::OutputTooLarge => "TikZ 渲染结果超过 1 MB 限制".to_string(),
            Self::VisualValidation(detail) => format!("TikZ 图形视觉检查未通过：{detail}"),
            Self::SemanticValidation(detail) => format!("TikZ 图形语义检查未通过：{detail}"),
            Self::Io(detail) => format!("TikZ 缓存写入失败：{detail}"),
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct Point {
    x: f64,
    y: f64,
}

#[derive(Debug)]
enum Primitive {
    Path {
        points: Vec<Point>,
        closed: bool,
        fill: bool,
        dashed: bool,
        thick: bool,
        arrow: bool,
        right_angle: bool,
        parallel: bool,
        equal_length: bool,
        tangent: bool,
        collinear: bool,
    },
    Circle {
        center: Point,
        radius: f64,
        fill: bool,
    },
    Text {
        at: Point,
        value: String,
    },
}

fn normalize_source(source: &str) -> Result<String, RenderError> {
    if source.len() > MAX_SOURCE_BYTES {
        return Err(RenderError::SourceTooLarge);
    }
    let without_comments = source
        .lines()
        .map(|line| line.split('%').next().unwrap_or_default().trim())
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let normalized = without_comments
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if normalized.is_empty() {
        return Err(RenderError::Empty);
    }
    if normalized
        .chars()
        .any(|character| character == '\0' || character.is_control())
    {
        return Err(RenderError::InvalidGeometry("包含控制字符".to_string()));
    }
    let lower = normalized.to_ascii_lowercase();
    for command in FORBIDDEN_COMMANDS {
        if lower.contains(command) {
            return Err(RenderError::ForbiddenCommand((*command).to_string()));
        }
    }
    if lower.contains("\\begin{tikzpicture}") || lower.contains("\\end{tikzpicture}") {
        return Err(RenderError::ForbiddenCommand(
            "只允许 TikZ body，不允许完整环境".to_string(),
        ));
    }
    for parameter in [
        "transform canvas",
        "minimum size",
        "line width",
        "xscale",
        "yscale",
        "scale=",
        "opacity=",
    ] {
        if lower.contains(parameter) {
            return Err(RenderError::InvalidGeometry(format!(
                "不允许由图形源控制布局参数：{parameter}"
            )));
        }
    }
    Ok(normalized)
}

fn render_hash(
    normalized: &str,
    preamble_version: &str,
    contract: &DiagramValidationContract,
) -> String {
    let contract = serde_json::to_string(contract).unwrap_or_default();
    let identity = format!(
        "renderer={TIKZ_RENDERER_VERSION}\npreamble={preamble_version}\nvalidator={TIKZ_VALIDATOR_VERSION}\ncontract={contract}\n{normalized}"
    );
    format!("{:x}", Sha256::digest(identity.as_bytes()))
}

fn parse_coordinates(command: &str) -> Vec<Point> {
    let mut points = Vec::new();
    let mut rest = command;
    while let Some(start) = rest.find('(') {
        let after = &rest[start + 1..];
        let Some(end) = after.find(')') else { break };
        let pair = &after[..end];
        let mut values = pair.split(',').map(str::trim);
        if let (Some(x), Some(y), None) = (values.next(), values.next(), values.next()) {
            if let (Ok(x), Ok(y)) = (x.parse::<f64>(), y.parse::<f64>()) {
                if x.is_finite() && y.is_finite() && x.abs() <= 100.0 && y.abs() <= 100.0 {
                    points.push(Point { x, y });
                }
            }
        }
        rest = &after[end + 1..];
    }
    points
}

fn option_block(command: &str) -> &str {
    let Some(start) = command.find('[') else {
        return "";
    };
    let after = &command[start + 1..];
    let Some(end) = after.find(']') else {
        return "";
    };
    &after[..end]
}

fn text_label(command: &str) -> Result<String, RenderError> {
    let start = command
        .rfind('{')
        .ok_or_else(|| RenderError::InvalidGeometry("节点缺少文字".to_string()))?;
    let end = command
        .rfind('}')
        .filter(|end| *end > start)
        .ok_or_else(|| RenderError::InvalidGeometry("节点文字未闭合".to_string()))?;
    let value = command[start + 1..end].trim().trim_matches('$').trim();
    if value.is_empty()
        || value.len() > 128
        || value
            .chars()
            .any(|character| matches!(character, '{' | '}' | '\\'))
    {
        return Err(RenderError::InvalidGeometry("节点文字无效".to_string()));
    }
    Ok(value.to_string())
}

fn parse_primitives(normalized: &str, deadline: Instant) -> Result<Vec<Primitive>, RenderError> {
    let commands = normalized
        .split(';')
        .map(str::trim)
        .filter(|command| !command.is_empty())
        .collect::<Vec<_>>();
    if commands.len() > MAX_COMMANDS {
        return Err(RenderError::TooManyCommands);
    }
    let mut primitives = Vec::new();
    for command in commands {
        if Instant::now() >= deadline {
            return Err(RenderError::Timeout);
        }
        if command.starts_with("\\node") {
            let points = parse_coordinates(command);
            let at = points
                .first()
                .copied()
                .ok_or_else(|| RenderError::InvalidGeometry("节点缺少坐标".to_string()))?;
            primitives.push(Primitive::Text {
                at,
                value: text_label(command)?,
            });
            continue;
        }
        let (fill, body) = if let Some(body) = command.strip_prefix("\\filldraw") {
            (true, body)
        } else if let Some(body) = command.strip_prefix("\\fill") {
            (true, body)
        } else if let Some(body) = command.strip_prefix("\\draw") {
            (false, body)
        } else {
            return Err(RenderError::UnsupportedCommand(
                command
                    .split_whitespace()
                    .next()
                    .unwrap_or(command)
                    .to_string(),
            ));
        };
        let options = option_block(body);
        let points = parse_coordinates(body);
        if body.contains("circle") {
            let center = points
                .first()
                .copied()
                .ok_or_else(|| RenderError::InvalidGeometry("圆缺少圆心".to_string()))?;
            let circle = body
                .split("circle")
                .nth(1)
                .and_then(|tail| tail.split('(').nth(1))
                .and_then(|tail| tail.split(')').next())
                .and_then(|radius| radius.trim().parse::<f64>().ok())
                .filter(|radius| radius.is_finite() && *radius > 0.0 && *radius <= 10_000.0)
                .ok_or_else(|| RenderError::InvalidGeometry("圆半径无效".to_string()))?;
            primitives.push(Primitive::Circle {
                center,
                radius: circle,
                fill,
            });
        } else {
            if points.len() < 2 {
                return Err(RenderError::InvalidGeometry(
                    "路径至少需要两个坐标".to_string(),
                ));
            }
            primitives.push(Primitive::Path {
                points,
                closed: body.contains("cycle") || body.contains("rectangle"),
                fill,
                dashed: options.contains("dashed"),
                thick: options.contains("thick"),
                arrow: options.contains("->"),
                right_angle: options.contains("axiomRightAngle"),
                parallel: options.contains("axiomParallel"),
                equal_length: options.contains("axiomEqualLength"),
                tangent: options.contains("axiomTangent"),
                collinear: options.contains("axiomCollinear"),
            });
        }
    }
    if primitives.is_empty() {
        return Err(RenderError::Empty);
    }
    Ok(primitives)
}

fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[derive(Debug, Clone, Copy)]
struct DiagramMetrics {
    min_x: f64,
    max_y: f64,
    width: f64,
    height: f64,
    aspect_ratio: f64,
    ink_coverage: f64,
}

fn validate_primitives(
    primitives: &[Primitive],
    contract: &DiagramValidationContract,
) -> Result<DiagramMetrics, RenderError> {
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    let mut include = |point: Point, radius: f64| {
        min_x = min_x.min(point.x - radius);
        min_y = min_y.min(point.y - radius);
        max_x = max_x.max(point.x + radius);
        max_y = max_y.max(point.y + radius);
    };
    for primitive in primitives {
        match primitive {
            Primitive::Path { points, .. } => points.iter().for_each(|point| include(*point, 0.0)),
            Primitive::Circle { center, radius, .. } => include(*center, *radius),
            Primitive::Text { at, .. } => include(*at, 0.35),
        }
    }
    if !min_x.is_finite() || max_x - min_x <= 0.0 || max_y - min_y <= 0.0 {
        return Err(RenderError::InvalidGeometry("图形边界为空".to_string()));
    }
    let raw_width = max_x - min_x;
    let raw_height = max_y - min_y;
    let aspect_ratio = raw_width / raw_height;
    if raw_width > 100.0 || raw_height > 100.0 || !(0.12..=8.0).contains(&aspect_ratio) {
        return Err(RenderError::VisualValidation(format!(
            "边界比例异常（{raw_width:.2} × {raw_height:.2}，比例 {aspect_ratio:.2}）"
        )));
    }
    let area = raw_width * raw_height;
    let mut ink_area = 0.0;
    let mut labels = Vec::new();
    let mut has_right_angle = false;
    let mut has_parallel = false;
    let mut has_equal_length = false;
    let mut has_tangent = false;
    let mut has_collinear = false;
    for primitive in primitives {
        match primitive {
            Primitive::Path {
                points,
                closed,
                fill,
                thick,
                right_angle,
                parallel,
                equal_length,
                tangent,
                collinear,
                ..
            } => {
                let length = points
                    .windows(2)
                    .map(|pair| {
                        ((pair[1].x - pair[0].x).powi(2) + (pair[1].y - pair[0].y).powi(2)).sqrt()
                    })
                    .sum::<f64>();
                ink_area += length * if *thick { 0.07 } else { 0.045 };
                if *fill && *closed {
                    let polygon_area = points
                        .iter()
                        .zip(points.iter().cycle().skip(1))
                        .take(points.len())
                        .map(|(left, right)| left.x * right.y - right.x * left.y)
                        .sum::<f64>()
                        .abs()
                        / 2.0;
                    if polygon_area / area > 0.45 {
                        return Err(RenderError::VisualValidation(
                            "大面积不透明填充会遮挡图形".to_string(),
                        ));
                    }
                    ink_area += polygon_area;
                }
                has_right_angle |= *right_angle;
                has_parallel |= *parallel;
                has_equal_length |= *equal_length;
                has_tangent |= *tangent;
                has_collinear |= *collinear;
            }
            Primitive::Circle { radius, fill, .. } => {
                ink_area += if *fill {
                    std::f64::consts::PI * radius.powi(2)
                } else {
                    std::f64::consts::TAU * radius * 0.045
                };
            }
            Primitive::Text { value, .. } => {
                labels.push(value.as_str());
                ink_area += 0.08 * value.chars().count().max(1) as f64;
            }
        }
    }
    let ink_coverage = (ink_area / area).clamp(0.0, 1.0);
    if !(0.0005..=0.55).contains(&ink_coverage) {
        return Err(RenderError::VisualValidation(format!(
            "墨迹覆盖率异常（{:.1}%）",
            ink_coverage * 100.0
        )));
    }
    let missing_labels = contract
        .required_labels
        .iter()
        .filter(|required| !labels.contains(&required.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    if !missing_labels.is_empty() {
        return Err(RenderError::SemanticValidation(format!(
            "缺少点名 {}",
            missing_labels.join("、")
        )));
    }
    if contract
        .required_relations
        .iter()
        .any(|relation| matches!(relation.as_str(), "perpendicular" | "right_angle"))
        && !has_right_angle
    {
        return Err(RenderError::SemanticValidation(
            "缺少垂直关系标记".to_string(),
        ));
    }
    for (relation, present, message) in [
        ("parallel", has_parallel, "缺少平行关系标记"),
        ("equal_length", has_equal_length, "缺少等长关系标记"),
        ("tangent", has_tangent, "缺少相切关系标记"),
        ("collinear", has_collinear, "缺少共线关系标记"),
    ] {
        if contract
            .required_relations
            .iter()
            .any(|required| required == relation)
            && !present
        {
            return Err(RenderError::SemanticValidation(message.to_string()));
        }
    }
    let padding = ((max_x - min_x).max(max_y - min_y) * 0.08).max(0.35);
    min_x -= padding;
    min_y -= padding;
    max_x += padding;
    max_y += padding;
    let width = max_x - min_x;
    let height = max_y - min_y;
    Ok(DiagramMetrics {
        min_x,
        max_y,
        width,
        height,
        aspect_ratio,
        ink_coverage,
    })
}

fn primitives_to_svg(
    primitives: &[Primitive],
    metrics: DiagramMetrics,
) -> Result<String, RenderError> {
    let DiagramMetrics {
        min_x,
        max_y,
        width,
        height,
        ..
    } = metrics;
    let map = |point: Point| (point.x - min_x, max_y - point.y);
    let mut body = String::new();
    for primitive in primitives {
        match primitive {
            Primitive::Path {
                points,
                closed,
                fill,
                dashed,
                thick,
                arrow,
                right_angle: _,
                parallel: _,
                equal_length: _,
                tangent: _,
                collinear: _,
            } => {
                let rendered = points
                    .iter()
                    .map(|point| {
                        let (x, y) = map(*point);
                        format!("{x:.4},{y:.4}")
                    })
                    .collect::<Vec<_>>()
                    .join(" ");
                let element = if *closed { "polygon" } else { "polyline" };
                let fill_color = if *fill { "#111111" } else { "none" };
                let dash = if *dashed {
                    " stroke-dasharray=\"0.14 0.11\""
                } else {
                    ""
                };
                let stroke_width = if *thick { 0.09 } else { 0.06 };
                let marker = if *arrow {
                    " marker-end=\"url(#arrow)\""
                } else {
                    ""
                };
                body.push_str(&format!(
                    "<{element} points=\"{rendered}\" fill=\"{fill_color}\" stroke=\"#111111\" stroke-width=\"{stroke_width}\" stroke-linecap=\"round\" stroke-linejoin=\"round\"{dash}{marker}/>",
                ));
            }
            Primitive::Circle {
                center,
                radius,
                fill,
            } => {
                let (cx, cy) = map(*center);
                let fill_color = if *fill { "#111111" } else { "none" };
                body.push_str(&format!(
                    "<circle cx=\"{cx:.4}\" cy=\"{cy:.4}\" r=\"{radius:.4}\" fill=\"{fill_color}\" stroke=\"#111111\" stroke-width=\"0.06\"/>",
                ));
            }
            Primitive::Text { at, value } => {
                let (x, y) = map(*at);
                body.push_str(&format!(
                    "<text x=\"{x:.4}\" y=\"{y:.4}\" fill=\"#111111\" font-family=\"Times New Roman, STIX Two Text, Songti SC, serif\" font-size=\"0.38\" font-weight=\"500\" text-anchor=\"middle\" dominant-baseline=\"middle\">{}</text>",
                    escape_xml(value)
                ));
            }
        }
    }
    let svg = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {width:.4} {height:.4}\" preserveAspectRatio=\"xMidYMid meet\" role=\"img\"><defs><marker id=\"arrow\" markerWidth=\"6\" markerHeight=\"6\" refX=\"5\" refY=\"3\" orient=\"auto\"><path d=\"M0,0 L6,3 L0,6 Z\" fill=\"#111111\"/></marker></defs>{body}</svg>"
    );
    if svg.len() > MAX_OUTPUT_BYTES {
        return Err(RenderError::OutputTooLarge);
    }
    Ok(svg)
}

fn render_to_cache(
    cache_directory: &Path,
    source: &str,
    preamble_version: &str,
    contract: &DiagramValidationContract,
    timeout: Duration,
) -> Result<(PathBuf, String, bool, DiagramMetrics), RenderError> {
    let normalized = normalize_source(source)?;
    let hash = render_hash(&normalized, preamble_version, contract);
    let deadline = Instant::now()
        .checked_add(timeout)
        .ok_or(RenderError::Timeout)?;
    let primitives = parse_primitives(&normalized, deadline)?;
    let metrics = validate_primitives(&primitives, contract)?;
    fs::create_dir_all(cache_directory).map_err(|error| RenderError::Io(error.to_string()))?;
    let destination = cache_directory.join(format!("{hash}.svg"));
    if destination.is_file() {
        return Ok((destination, hash, true, metrics));
    }
    if Instant::now() >= deadline {
        return Err(RenderError::Timeout);
    }
    let svg = primitives_to_svg(&primitives, metrics)?;
    let temporary = cache_directory.join(format!(".{hash}-{}.tmp", Uuid::new_v4()));
    fs::write(&temporary, svg.as_bytes()).map_err(|error| RenderError::Io(error.to_string()))?;
    match fs::rename(&temporary, &destination) {
        Ok(()) => Ok((destination, hash, false, metrics)),
        Err(_) if destination.is_file() => {
            let _ = fs::remove_file(temporary);
            Ok((destination, hash, true, metrics))
        }
        Err(error) => {
            let _ = fs::remove_file(temporary);
            Err(RenderError::Io(error.to_string()))
        }
    }
}

fn failed_result(
    source: &str,
    contract: &DiagramValidationContract,
    error: RenderError,
) -> TikzRenderResult {
    let normalized = normalize_source(source).unwrap_or_else(|_| source.trim().to_string());
    TikzRenderResult {
        render_status: "failed".to_string(),
        rendered_asset_path: None,
        rendered_mime_type: None,
        render_hash: render_hash(&normalized, TIKZ_PREAMBLE_VERSION, contract),
        renderer_version: TIKZ_RENDERER_VERSION.to_string(),
        cache_hit: false,
        validation_status: "rejected".to_string(),
        validation_errors: vec![error.message()],
        width: None,
        height: None,
        aspect_ratio: None,
        ink_coverage: None,
        error_code: Some(error.code().to_string()),
        error_message: Some(error.message()),
    }
}

fn render_tikz_blocking(
    app: AppHandle,
    source: String,
    contract: Option<DiagramValidationContract>,
) -> TikzRenderResult {
    let contract = contract.unwrap_or_default();
    let cache_directory = match app.path().app_data_dir() {
        // Keep generated assets directly under the existing managed diagrams
        // directory so media inventory and garbage collection can see them.
        Ok(path) => path.join("media").join("diagrams"),
        Err(error) => return failed_result(&source, &contract, RenderError::Io(error.to_string())),
    };
    match render_to_cache(
        &cache_directory,
        &source,
        TIKZ_PREAMBLE_VERSION,
        &contract,
        RENDER_TIMEOUT,
    ) {
        Ok((path, hash, cache_hit, metrics)) => TikzRenderResult {
            render_status: "rendered".to_string(),
            rendered_asset_path: Some(path.to_string_lossy().to_string()),
            rendered_mime_type: Some("image/svg+xml".to_string()),
            render_hash: hash,
            renderer_version: TIKZ_RENDERER_VERSION.to_string(),
            cache_hit,
            validation_status: "validated".to_string(),
            validation_errors: Vec::new(),
            width: Some(metrics.width),
            height: Some(metrics.height),
            aspect_ratio: Some(metrics.aspect_ratio),
            ink_coverage: Some(metrics.ink_coverage),
            error_code: None,
            error_message: None,
        },
        Err(error) => failed_result(&source, &contract, error),
    }
}

#[tauri::command]
pub async fn render_tikz(
    app: AppHandle,
    source: String,
    contract: Option<DiagramValidationContract>,
) -> TikzRenderResult {
    let error_source = source.clone();
    let error_contract = contract.clone().unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || render_tikz_blocking(app, source, contract))
        .await
        .unwrap_or_else(|error| {
            failed_result(
                &error_source,
                &error_contract,
                RenderError::Io(format!("TikZ 后台任务异常：{error}")),
            )
        })
}

#[cfg(test)]
pub(crate) fn render_validated_fixture(
    cache_directory: &Path,
    source: &str,
    required_labels: &[&str],
    require_perpendicular: bool,
) -> PathBuf {
    let contract = DiagramValidationContract {
        required_labels: required_labels
            .iter()
            .map(|label| (*label).to_string())
            .collect(),
        required_relations: if require_perpendicular {
            vec!["perpendicular".to_string()]
        } else {
            Vec::new()
        },
    };
    render_to_cache(
        cache_directory,
        source,
        TIKZ_PREAMBLE_VERSION,
        &contract,
        RENDER_TIMEOUT,
    )
    .expect("validated fixture should render")
    .0
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{sync::Arc, thread};

    fn cache_directory(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!("axiom-tikz-{label}-{}", Uuid::new_v4()))
    }

    fn render_fixture(label: &str, source: &str) -> String {
        let directory = cache_directory(label);
        let (path, _, _, _) = render_to_cache(
            &directory,
            source,
            TIKZ_PREAMBLE_VERSION,
            &DiagramValidationContract::default(),
            RENDER_TIMEOUT,
        )
        .expect("fixture should render");
        let svg = fs::read_to_string(path).expect("svg should exist");
        let _ = fs::remove_dir_all(directory);
        svg
    }

    #[test]
    fn renders_real_school_diagram_fixtures_as_svg() {
        let cases = [
            (
                "triangle",
                r"\draw[thick] (0,0)--(4,0)--(1.2,2.8)--cycle; \node at (0,-.35) {A}; \node at (4,-.35) {B}; \node at (1.2,3.15) {C};",
            ),
            (
                "parallelogram",
                r"\draw (0,0)--(3.5,0)--(4.7,2)--(1.2,2)--cycle; \draw[dashed] (0,0)--(4.7,2);",
            ),
            (
                "axes",
                r"\draw[->] (-2,0)--(3,0); \draw[->] (0,-2)--(0,3); \node at (2.8,-.3) {x}; \node at (.3,2.8) {y};",
            ),
            (
                "function",
                r"\draw[->] (-2,0)--(3,0); \draw[->] (0,-1)--(0,4); \draw[thick] (-1.5,2.25)--(-1,1)--(0,0)--(1,1)--(1.5,2.25);",
            ),
            (
                "physics",
                r"\draw[thick] (0,0)--(4,0); \draw (1,0)--(1,2); \fill (1,2) circle (0.1); \draw[->] (1,2)--(3,2); \node at (3.2,2) {F};",
            ),
        ];
        for (label, source) in cases {
            let svg = render_fixture(label, source);
            assert!(svg.starts_with("<svg"));
            assert!(svg.contains("#111111"));
            assert!(!svg.contains("background"));
        }
    }

    #[test]
    fn rejects_invalid_and_dangerous_tex_without_spawning_a_process() {
        assert!(matches!(normalize_source(""), Err(RenderError::Empty)));
        assert!(matches!(
            normalize_source(r"\input{/etc/passwd}"),
            Err(RenderError::ForbiddenCommand(_))
        ));
        assert!(matches!(
            normalize_source(r"\documentclass{article}\begin{document}x"),
            Err(RenderError::ForbiddenCommand(_))
        ));
        let error = render_to_cache(
            &cache_directory("invalid"),
            r"\draw (0,0);",
            TIKZ_PREAMBLE_VERSION,
            &DiagramValidationContract::default(),
            RENDER_TIMEOUT,
        )
        .expect_err("single point path must fail");
        assert!(matches!(error, RenderError::InvalidGeometry(_)));
    }

    #[test]
    fn validates_bounds_visual_sanity_and_semantic_contract() {
        let directory = cache_directory("validated-contract");
        let perpendicular = DiagramValidationContract {
            required_labels: vec!["A".into(), "B".into(), "C".into(), "D".into()],
            required_relations: vec!["perpendicular".into()],
        };
        let valid_source = include_str!("../tests/fixtures/tikz/perpendicular.tikz");
        let valid = render_to_cache(
            &directory,
            valid_source,
            TIKZ_PREAMBLE_VERSION,
            &perpendicular,
            RENDER_TIMEOUT,
        )
        .expect("labelled perpendicular diagram should validate");
        assert!((0.12..=8.0).contains(&valid.3.aspect_ratio));
        assert!((0.0005..=0.55).contains(&valid.3.ink_coverage));
        if let Ok(output) = std::env::var("AXIOM_TIKZ_TEST_OUTPUT") {
            fs::copy(&valid.0, output).expect("copy standalone validated SVG");
        }

        let missing_mark = render_to_cache(
            &directory,
            r"\draw (-2,0)--(2,0); \draw (0,-2)--(0,2); \node at (-2.3,0) {A}; \node at (2.3,0) {C}; \node at (0,-2.3) {B}; \node at (0,2.3) {D};",
            TIKZ_PREAMBLE_VERSION,
            &perpendicular,
            RENDER_TIMEOUT,
        )
        .expect_err("missing right-angle mark must fail semantic validation");
        assert!(matches!(missing_mark, RenderError::SemanticValidation(_)));

        for source in [
            r"\draw[line width=40pt] (0,0)--(2,2);",
            r"\draw[scale=100] (0,0)--(2,2);",
            include_str!("../tests/fixtures/tikz/invalid-black-fill.tikz"),
            r"\draw (0,0)--(1000,1);",
        ] {
            assert!(render_to_cache(
                &directory,
                source,
                TIKZ_PREAMBLE_VERSION,
                &DiagramValidationContract::default(),
                RENDER_TIMEOUT,
            )
            .is_err());
        }
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn enforces_timeout_and_cache_version_identity() {
        let directory = cache_directory("timeout-cache");
        let source = r"\draw (0,0)--(1,1);";
        assert_eq!(
            render_to_cache(
                &directory,
                source,
                TIKZ_PREAMBLE_VERSION,
                &DiagramValidationContract::default(),
                Duration::ZERO,
            )
            .expect_err("zero budget must time out"),
            RenderError::Timeout
        );
        let first = render_to_cache(
            &directory,
            source,
            "preamble-v1",
            &DiagramValidationContract::default(),
            RENDER_TIMEOUT,
        )
        .expect("first render");
        let second = render_to_cache(
            &directory,
            source,
            "preamble-v1",
            &DiagramValidationContract::default(),
            RENDER_TIMEOUT,
        )
        .expect("cache render");
        let changed = render_to_cache(
            &directory,
            source,
            "preamble-v2",
            &DiagramValidationContract::default(),
            RENDER_TIMEOUT,
        )
        .expect("changed preamble render");
        assert!(!first.2);
        assert!(second.2);
        assert_eq!(first.1, second.1);
        assert_ne!(first.1, changed.1);
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn concurrent_identical_renders_share_one_cache_asset() {
        let directory = Arc::new(cache_directory("concurrent"));
        let source = r"\draw (0,0)--(2,0)--(1,1)--cycle;";
        let handles = (0..8)
            .map(|_| {
                let directory = Arc::clone(&directory);
                thread::spawn(move || {
                    render_to_cache(
                        &directory,
                        source,
                        TIKZ_PREAMBLE_VERSION,
                        &DiagramValidationContract::default(),
                        RENDER_TIMEOUT,
                    )
                    .expect("concurrent render")
                })
            })
            .collect::<Vec<_>>();
        let results = handles
            .into_iter()
            .map(|handle| handle.join().expect("thread should finish"))
            .collect::<Vec<_>>();
        assert!(results.iter().all(|result| result.0 == results[0].0));
        assert_eq!(
            fs::read_dir(directory.as_ref())
                .expect("cache directory")
                .filter_map(Result::ok)
                .filter(
                    |entry| entry.path().extension().and_then(|value| value.to_str())
                        == Some("svg")
                )
                .count(),
            1
        );
        let _ = fs::remove_dir_all(directory.as_ref());
    }
}
