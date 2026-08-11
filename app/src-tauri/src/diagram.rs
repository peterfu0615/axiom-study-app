use std::{
    fs,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

pub const TIKZ_RENDERER_VERSION: &str = "axiom-restricted-svg-v1";
pub const TIKZ_PREAMBLE_VERSION: &str = "axiom-tikz-preamble-v1";
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
    pub error_code: Option<String>,
    pub error_message: Option<String>,
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
    Ok(normalized)
}

fn render_hash(normalized: &str, preamble_version: &str) -> String {
    let identity =
        format!("renderer={TIKZ_RENDERER_VERSION}\npreamble={preamble_version}\n{normalized}");
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
                if x.is_finite() && y.is_finite() && x.abs() <= 10_000.0 && y.abs() <= 10_000.0 {
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

fn primitives_to_svg(primitives: &[Primitive]) -> Result<String, RenderError> {
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
    let padding = ((max_x - min_x).max(max_y - min_y) * 0.08).max(0.35);
    min_x -= padding;
    min_y -= padding;
    max_x += padding;
    max_y += padding;
    let width = max_x - min_x;
    let height = max_y - min_y;
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
                let fill_color = if *fill { "#25231c" } else { "none" };
                let dash = if *dashed {
                    " stroke-dasharray=\"0.14 0.11\""
                } else {
                    ""
                };
                let stroke_width = if *thick { 0.07 } else { 0.045 };
                let marker = if *arrow {
                    " marker-end=\"url(#arrow)\""
                } else {
                    ""
                };
                body.push_str(&format!(
                    "<{element} points=\"{rendered}\" fill=\"{fill_color}\" stroke=\"#25231c\" stroke-width=\"{stroke_width}\" stroke-linecap=\"round\" stroke-linejoin=\"round\"{dash}{marker}/>",
                ));
            }
            Primitive::Circle {
                center,
                radius,
                fill,
            } => {
                let (cx, cy) = map(*center);
                let fill_color = if *fill { "#25231c" } else { "none" };
                body.push_str(&format!(
                    "<circle cx=\"{cx:.4}\" cy=\"{cy:.4}\" r=\"{radius:.4}\" fill=\"{fill_color}\" stroke=\"#25231c\" stroke-width=\"0.045\"/>",
                ));
            }
            Primitive::Text { at, value } => {
                let (x, y) = map(*at);
                body.push_str(&format!(
                    "<text x=\"{x:.4}\" y=\"{y:.4}\" fill=\"#25231c\" font-family=\"-apple-system, PingFang SC, sans-serif\" font-size=\"0.32\" text-anchor=\"middle\" dominant-baseline=\"middle\">{}</text>",
                    escape_xml(value)
                ));
            }
        }
    }
    let svg = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {width:.4} {height:.4}\" role=\"img\"><defs><marker id=\"arrow\" markerWidth=\"6\" markerHeight=\"6\" refX=\"5\" refY=\"3\" orient=\"auto\"><path d=\"M0,0 L6,3 L0,6 Z\" fill=\"#25231c\"/></marker></defs>{body}</svg>"
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
    timeout: Duration,
) -> Result<(PathBuf, String, bool), RenderError> {
    let normalized = normalize_source(source)?;
    let hash = render_hash(&normalized, preamble_version);
    fs::create_dir_all(cache_directory).map_err(|error| RenderError::Io(error.to_string()))?;
    let destination = cache_directory.join(format!("{hash}.svg"));
    if destination.is_file() {
        return Ok((destination, hash, true));
    }
    let deadline = Instant::now()
        .checked_add(timeout)
        .ok_or(RenderError::Timeout)?;
    let primitives = parse_primitives(&normalized, deadline)?;
    if Instant::now() >= deadline {
        return Err(RenderError::Timeout);
    }
    let svg = primitives_to_svg(&primitives)?;
    let temporary = cache_directory.join(format!(".{hash}-{}.tmp", Uuid::new_v4()));
    fs::write(&temporary, svg.as_bytes()).map_err(|error| RenderError::Io(error.to_string()))?;
    match fs::rename(&temporary, &destination) {
        Ok(()) => Ok((destination, hash, false)),
        Err(_) if destination.is_file() => {
            let _ = fs::remove_file(temporary);
            Ok((destination, hash, true))
        }
        Err(error) => {
            let _ = fs::remove_file(temporary);
            Err(RenderError::Io(error.to_string()))
        }
    }
}

fn failed_result(source: &str, error: RenderError) -> TikzRenderResult {
    let normalized = normalize_source(source).unwrap_or_else(|_| source.trim().to_string());
    TikzRenderResult {
        render_status: "failed".to_string(),
        rendered_asset_path: None,
        rendered_mime_type: None,
        render_hash: render_hash(&normalized, TIKZ_PREAMBLE_VERSION),
        renderer_version: TIKZ_RENDERER_VERSION.to_string(),
        cache_hit: false,
        error_code: Some(error.code().to_string()),
        error_message: Some(error.message()),
    }
}

#[tauri::command]
pub fn render_tikz(app: AppHandle, source: String) -> TikzRenderResult {
    let cache_directory = match app.path().app_data_dir() {
        // Keep generated assets directly under the existing managed diagrams
        // directory so media inventory and garbage collection can see them.
        Ok(path) => path.join("media").join("diagrams"),
        Err(error) => return failed_result(&source, RenderError::Io(error.to_string())),
    };
    match render_to_cache(
        &cache_directory,
        &source,
        TIKZ_PREAMBLE_VERSION,
        RENDER_TIMEOUT,
    ) {
        Ok((path, hash, cache_hit)) => TikzRenderResult {
            render_status: "rendered".to_string(),
            rendered_asset_path: Some(path.to_string_lossy().to_string()),
            rendered_mime_type: Some("image/svg+xml".to_string()),
            render_hash: hash,
            renderer_version: TIKZ_RENDERER_VERSION.to_string(),
            cache_hit,
            error_code: None,
            error_message: None,
        },
        Err(error) => failed_result(&source, error),
    }
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
        let (path, _, _) =
            render_to_cache(&directory, source, TIKZ_PREAMBLE_VERSION, RENDER_TIMEOUT)
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
            assert!(svg.contains("#25231c"));
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
            RENDER_TIMEOUT,
        )
        .expect_err("single point path must fail");
        assert!(matches!(error, RenderError::InvalidGeometry(_)));
    }

    #[test]
    fn enforces_timeout_and_cache_version_identity() {
        let directory = cache_directory("timeout-cache");
        let source = r"\draw (0,0)--(1,1);";
        assert_eq!(
            render_to_cache(&directory, source, TIKZ_PREAMBLE_VERSION, Duration::ZERO)
                .expect_err("zero budget must time out"),
            RenderError::Timeout
        );
        let first = render_to_cache(&directory, source, "preamble-v1", RENDER_TIMEOUT)
            .expect("first render");
        let second = render_to_cache(&directory, source, "preamble-v1", RENDER_TIMEOUT)
            .expect("cache render");
        let changed = render_to_cache(&directory, source, "preamble-v2", RENDER_TIMEOUT)
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
                    render_to_cache(&directory, source, TIKZ_PREAMBLE_VERSION, RENDER_TIMEOUT)
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
