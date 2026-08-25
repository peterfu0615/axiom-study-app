use printpdf::path::PaintMode;
use printpdf::{
    Color, Image, ImageTransform, IndirectFontRef, Mm, PdfDocument, PdfDocumentReference,
    PdfLayerReference, Rect, Rgb, Svg, SvgTransform,
};
use qrcode::{Color as QrColor, QrCode};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{BufWriter, Cursor};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const POINT_TO_MM: f32 = 25.4 / 72.0;
const PAGE_HEIGHT_POINTS: f32 = 841.89;
const PDF_RENDERER_VERSION: &str = "axiom-printpdf-v4";

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PracticeDocument {
    id: String,
    practice_set_id: String,
    attempt_id: String,
    document_type: String,
    title: String,
    metadata: DocumentMetadata,
    layout: DocumentLayout,
    pages: Vec<DocumentPage>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentMetadata {
    subject: String,
    created_at: i64,
    item_count: usize,
    strategy: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentLayout {
    version: String,
    width_points: f32,
    height_points: f32,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentPage {
    page_index: usize,
    page_identity: String,
    qr_payload: String,
    marker_rects: Vec<DocumentRect>,
    questions: Vec<DocumentQuestion>,
    answer_regions: Vec<AnswerRegion>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
struct DocumentRect {
    x: f32,
    y: f32,
    width: f32,
    height: f32,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentQuestion {
    practice_item_id: String,
    display_number: usize,
    statement_markdown: String,
    options: Option<Vec<String>>,
    difficulty: String,
    diagram_image_paths: Vec<String>,
    canonical_answer: Option<String>,
    solution_markdown: Option<String>,
    frame: DocumentRect,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnswerRegion {
    id: String,
    practice_item_id: String,
    region_index: usize,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfRenderResult {
    document_id: String,
    file_path: String,
    content_hash: String,
    renderer_version: String,
    page_count: usize,
    byte_length: u64,
    cache_hit: bool,
}

fn pt_mm(value: f32) -> Mm {
    Mm(value * POINT_TO_MM)
}

fn pdf_y(top_origin_y: f32) -> Mm {
    pt_mm(PAGE_HEIGHT_POINTS - top_origin_y)
}

fn set_black(layer: &PdfLayerReference) {
    layer.set_fill_color(Color::Rgb(Rgb::new(0.12, 0.11, 0.09, None)));
    layer.set_outline_color(Color::Rgb(Rgb::new(0.12, 0.11, 0.09, None)));
}

fn fill_rect(layer: &PdfLayerReference, rect: &DocumentRect) {
    let shape = Rect::new(
        pt_mm(rect.x),
        pdf_y(rect.y + rect.height),
        pt_mm(rect.x + rect.width),
        pdf_y(rect.y),
    )
    .with_mode(PaintMode::Fill);
    layer.add_rect(shape);
}

fn stroke_rect(layer: &PdfLayerReference, rect: &DocumentRect) {
    let shape = Rect::new(
        pt_mm(rect.x),
        pdf_y(rect.y + rect.height),
        pt_mm(rect.x + rect.width),
        pdf_y(rect.y),
    )
    .with_mode(PaintMode::Stroke);
    layer.add_rect(shape);
}

fn font_path() -> Result<PathBuf, String> {
    [
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/Library/Fonts/Arial Unicode.ttf",
    ]
    .iter()
    .map(PathBuf::from)
    .find(|path| path.is_file())
    .ok_or_else(|| "无法找到支持中文的系统字体 Arial Unicode".to_string())
}

fn add_font(document: &PdfDocumentReference) -> Result<IndirectFontRef, String> {
    let bytes = fs::read(font_path()?).map_err(|error| format!("读取中文字体失败：{error}"))?;
    document
        .add_external_font_with_subsetting(&mut Cursor::new(bytes), true)
        .map_err(|error| format!("嵌入中文字体失败：{error}"))
}

fn normalize_math_text(value: &str) -> String {
    let mut normalized = value.to_string();
    while let Some(start) = normalized.find("\\frac{") {
        let numerator_start = start + "\\frac{".len();
        let Some(numerator_end_offset) = normalized[numerator_start..].find('}') else {
            break;
        };
        let numerator_end = numerator_start + numerator_end_offset;
        let denominator_open = numerator_end + 1;
        if normalized.as_bytes().get(denominator_open) != Some(&b'{') {
            break;
        }
        let denominator_start = denominator_open + 1;
        let Some(denominator_end_offset) = normalized[denominator_start..].find('}') else {
            break;
        };
        let denominator_end = denominator_start + denominator_end_offset;
        let replacement = format!(
            "({})/({})",
            &normalized[numerator_start..numerator_end],
            &normalized[denominator_start..denominator_end]
        );
        normalized.replace_range(start..=denominator_end, &replacement);
    }
    normalized
        .replace("\\sqrt", "√")
        .replace("\\therefore", "∴")
        .replace("\\because", "∵")
        .replace("\\Longrightarrow", "⟹")
        .replace("\\Rightarrow", "⇒")
        .replace("\\geq", "≥")
        .replace("\\leq", "≤")
        .replace("\\neq", "≠")
        .replace("\\times", "×")
        .replace("\\cdot", "·")
        .replace("\\pm", "±")
        .replace("\\text", "")
        .replace("\\(", "")
        .replace("\\)", "")
        .replace(['$', '{', '}'], "")
        .replace("**", "")
        .replace("###", "")
}

fn wrap_text(value: &str, max_chars: usize) -> Vec<String> {
    let normalized = normalize_math_text(value);
    let mut lines = Vec::new();
    for paragraph in normalized.lines() {
        let chars: Vec<char> = paragraph.trim().chars().collect();
        if chars.is_empty() {
            lines.push(String::new());
            continue;
        }
        for chunk in chars.chunks(max_chars) {
            lines.push(chunk.iter().collect());
        }
    }
    lines
}

#[derive(Clone, Copy)]
struct TextLayout {
    x: f32,
    top_y: f32,
    size: f32,
    max_chars: usize,
    max_lines: usize,
}

fn draw_lines(layer: &PdfLayerReference, font: &IndirectFontRef, value: &str, layout: TextLayout) {
    set_black(layer);
    let mut top_y = layout.top_y;
    for line in wrap_text(value, layout.max_chars)
        .into_iter()
        .take(layout.max_lines)
    {
        layer.use_text(
            line,
            layout.size,
            pt_mm(layout.x),
            pdf_y(top_y + layout.size),
            font,
        );
        top_y += layout.size * 1.45;
    }
}

fn draw_qr(
    layer: &PdfLayerReference,
    payload: &str,
    x: f32,
    y: f32,
    size: f32,
) -> Result<(), String> {
    let code =
        QrCode::new(payload.as_bytes()).map_err(|error| format!("生成页面二维码失败：{error}"))?;
    let width = code.width();
    let quiet = 4usize;
    let module = size / (width + quiet * 2) as f32;
    set_black(layer);
    for row in 0..width {
        for column in 0..width {
            if code[(column, row)] != QrColor::Dark {
                continue;
            }
            fill_rect(
                layer,
                &DocumentRect {
                    x: x + (column + quiet) as f32 * module,
                    y: y + (row + quiet) as f32 * module,
                    width: module + 0.05,
                    height: module + 0.05,
                },
            );
        }
    }
    Ok(())
}

fn draw_asset(layer: &PdfLayerReference, path: &str, x: f32, top_y: f32) {
    let asset = Path::new(path);
    if !asset.is_file() {
        return;
    }
    if asset.extension().and_then(|value| value.to_str()) == Some("svg") {
        if let Ok(source) = fs::read_to_string(asset) {
            if let Ok(svg) = Svg::parse(&source) {
                let scale = 110.0 / svg.width.0.max(svg.height.0) as f32;
                let reference = svg.into_xobject(layer);
                reference.add_to_layer(
                    layer,
                    SvgTransform {
                        translate_x: Some(pt_mm(x).into()),
                        translate_y: Some(pdf_y(top_y + 100.0).into()),
                        scale_x: Some(scale),
                        scale_y: Some(scale),
                        dpi: Some(72.0),
                        ..Default::default()
                    },
                );
            }
        }
        return;
    }
    if let Ok(dynamic) = image::open(asset) {
        let width = dynamic.width().max(1) as f32;
        let height = dynamic.height().max(1) as f32;
        let scale = (260.0 / width).min(100.0 / height);
        Image::from_dynamic_image(&dynamic).add_to_layer(
            layer.clone(),
            ImageTransform {
                translate_x: Some(pt_mm(x)),
                translate_y: Some(pdf_y(top_y + height * scale)),
                scale_x: Some(scale),
                scale_y: Some(scale),
                dpi: Some(72.0),
                ..Default::default()
            },
        );
    }
}

fn draw_question(
    layer: &PdfLayerReference,
    font: &IndirectFontRef,
    question: &DocumentQuestion,
    document_type: &str,
) {
    set_black(layer);
    let title = format!(
        "{}.  {}",
        question.display_number,
        if document_type == "answer_sheet" {
            "作答区域"
        } else {
            ""
        }
    );
    layer.use_text(
        title,
        13.0,
        pt_mm(question.frame.x),
        pdf_y(question.frame.y + 14.0),
        font,
    );
    if document_type != "answer_sheet" {
        draw_lines(
            layer,
            font,
            &question.statement_markdown,
            TextLayout {
                x: question.frame.x + 24.0,
                top_y: question.frame.y + 2.0,
                size: 11.5,
                max_chars: 43,
                max_lines: 7,
            },
        );
        let mut detail_y = question.frame.y + 56.0;
        if let Some(options) = &question.options {
            for (index, option) in options.iter().enumerate() {
                draw_lines(
                    layer,
                    font,
                    &format!("{}. {option}", char::from(b'A' + index as u8)),
                    TextLayout {
                        x: question.frame.x + 24.0,
                        top_y: detail_y,
                        size: 10.5,
                        max_chars: 43,
                        max_lines: 2,
                    },
                );
                detail_y += 18.0;
            }
        }
        for path in &question.diagram_image_paths {
            draw_asset(layer, path, question.frame.x + 24.0, detail_y);
            detail_y += 105.0;
        }
        if document_type == "solutions" {
            if let Some(answer) = &question.canonical_answer {
                draw_lines(
                    layer,
                    font,
                    &format!("参考答案：{answer}"),
                    TextLayout {
                        x: question.frame.x + 24.0,
                        top_y: detail_y,
                        size: 10.5,
                        max_chars: 43,
                        max_lines: 4,
                    },
                );
                detail_y += 46.0;
            }
            if let Some(solution) = &question.solution_markdown {
                draw_lines(
                    layer,
                    font,
                    solution,
                    TextLayout {
                        x: question.frame.x + 24.0,
                        top_y: detail_y,
                        size: 9.5,
                        max_chars: 48,
                        max_lines: 8,
                    },
                );
            }
        }
    }
}

fn content_hash(document: &PracticeDocument) -> Result<String, String> {
    let mut value = serde_json::to_vec(document)
        .map_err(|error| format!("序列化 PracticeDocument 失败：{error}"))?;
    value.extend_from_slice(PDF_RENDERER_VERSION.as_bytes());
    Ok(format!("{:x}", Sha256::digest(value)))
}

fn output_path(
    app: &AppHandle,
    document: &PracticeDocument,
    hash: &str,
) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?
        .join("exports")
        .join("practice");
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建练习导出目录：{error}"))?;
    Ok(directory.join(format!(
        "{}-{}-{}.pdf",
        document.practice_set_id,
        document.document_type,
        &hash[..12]
    )))
}

fn render(document: &PracticeDocument, destination: &Path) -> Result<(), String> {
    if document.pages.is_empty() {
        return Err("PracticeDocument 至少需要一页".to_string());
    }
    if document.layout.version != "practice-a4-v1"
        || (document.layout.width_points - 595.28).abs() > 0.5
        || (document.layout.height_points - 841.89).abs() > 0.5
    {
        return Err("不支持的 PDF layout".to_string());
    }
    let metadata_title = match document.document_type.as_str() {
        "questions" => "Axiom Practice Questions",
        "answer_sheet" => "Axiom Practice Answer Sheet",
        "solutions" => "Axiom Practice Solutions",
        _ => "Axiom Practice Document",
    };
    let (pdf, first_page, first_layer) =
        PdfDocument::new(metadata_title, Mm(210.0), Mm(297.0), "content");
    let font = add_font(&pdf)?;
    for (index, page) in document.pages.iter().enumerate() {
        let (page_ref, layer_ref) = if index == 0 {
            (first_page, first_layer)
        } else {
            pdf.add_page(Mm(210.0), Mm(297.0), "content")
        };
        let layer = pdf.get_page(page_ref).get_layer(layer_ref);
        set_black(&layer);
        layer.use_text(&document.title, 18.0, pt_mm(42.0), pdf_y(57.0), &font);
        layer.use_text(
            format!(
                "{} · {} 题",
                document.metadata.subject, document.metadata.item_count
            ),
            9.0,
            pt_mm(42.0),
            pdf_y(77.0),
            &font,
        );
        draw_qr(&layer, &page.qr_payload, 493.0, 30.0, 58.0)?;
        for marker in &page.marker_rects {
            fill_rect(&layer, marker);
        }
        for question in &page.questions {
            draw_question(&layer, &font, question, &document.document_type);
        }
        for region in &page.answer_regions {
            stroke_rect(
                &layer,
                &DocumentRect {
                    x: region.x * PAGE_HEIGHT_POINTS * 595.28 / 841.89,
                    y: region.y * PAGE_HEIGHT_POINTS,
                    width: region.width * 595.28,
                    height: region.height * PAGE_HEIGHT_POINTS,
                },
            );
            let display_number = page
                .questions
                .iter()
                .find(|question| question.practice_item_id == region.practice_item_id)
                .map(|question| question.display_number)
                .unwrap_or(region.region_index + 1);
            layer.use_text(
                format!("第 {display_number} 题作答区"),
                6.5,
                pt_mm(region.x * 595.28 + 4.0),
                pdf_y(region.y * PAGE_HEIGHT_POINTS + 10.0),
                &font,
            );
        }
        layer.use_text(
            format!("第 {} / {} 页", page.page_index + 1, document.pages.len()),
            7.0,
            pt_mm(42.0),
            pdf_y(818.0),
            &font,
        );
    }
    let temporary = destination.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    pdf.save(&mut BufWriter::new(
        fs::File::create(&temporary).map_err(|error| format!("创建 PDF 临时文件失败：{error}"))?,
    ))
    .map_err(|error| format!("写入 PDF 失败：{error}"))?;
    fs::rename(&temporary, destination).map_err(|error| format!("提交 PDF 文件失败：{error}"))
}

fn render_practice_pdf_blocking(
    app: AppHandle,
    document: PracticeDocument,
) -> Result<PdfRenderResult, String> {
    let hash = content_hash(&document)?;
    let destination = output_path(&app, &document, &hash)?;
    let cache_hit = destination.is_file();
    if !cache_hit {
        render(&document, &destination)?;
    }
    let metadata =
        fs::metadata(&destination).map_err(|error| format!("读取 PDF 产物失败：{error}"))?;
    Ok(PdfRenderResult {
        document_id: document.id,
        file_path: destination.to_string_lossy().to_string(),
        content_hash: hash,
        renderer_version: PDF_RENDERER_VERSION.to_string(),
        page_count: document.pages.len(),
        byte_length: metadata.len(),
        cache_hit,
    })
}

#[tauri::command]
pub async fn render_practice_pdf(
    app: AppHandle,
    document: PracticeDocument,
) -> Result<PdfRenderResult, String> {
    tauri::async_runtime::spawn_blocking(move || render_practice_pdf_blocking(app, document))
        .await
        .map_err(|error| format!("PDF 后台任务异常：{error}"))?
}

#[tauri::command]
pub fn open_practice_pdf(app: AppHandle, path: String) -> Result<(), String> {
    let canonical_path = managed_practice_pdf(&app, &path)?;
    std::process::Command::new("open")
        .arg(&canonical_path)
        .spawn()
        .map_err(|error| format!("无法打开 PDF：{error}"))?;
    Ok(())
}

#[tauri::command]
pub fn practice_pdf_exists(app: AppHandle, path: String) -> Result<bool, String> {
    Ok(managed_practice_pdf(&app, &path)
        .map(|candidate| candidate.is_file())
        .unwrap_or(false))
}

fn managed_practice_pdf(app: &AppHandle, path: &str) -> Result<PathBuf, String> {
    let export_root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?
        .join("exports")
        .join("practice");
    let canonical_root = export_root
        .canonicalize()
        .map_err(|error| format!("无法解析练习导出目录：{error}"))?;
    let canonical_path = PathBuf::from(path)
        .canonicalize()
        .map_err(|error| format!("无法解析 PDF 路径：{error}"))?;
    if !canonical_path.starts_with(&canonical_root)
        || canonical_path.extension().and_then(|value| value.to_str()) != Some("pdf")
    {
        return Err("只能操作 Axiom 管理的练习 PDF".to_string());
    }
    Ok(canonical_path)
}

fn save_practice_pdf_blocking(
    app: AppHandle,
    path: String,
    destination: String,
) -> Result<(), String> {
    let source = managed_practice_pdf(&app, &path)?;
    let destination = PathBuf::from(destination);
    if destination.extension().and_then(|value| value.to_str()) != Some("pdf") {
        return Err("练习文件必须保存为 PDF".to_string());
    }
    if source == destination {
        return Ok(());
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("无法创建保存目录：{error}"))?;
    }
    fs::copy(source, destination).map_err(|error| format!("保存练习 PDF 失败：{error}"))?;
    Ok(())
}

#[tauri::command]
pub async fn save_practice_pdf(
    app: AppHandle,
    path: String,
    destination: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || save_practice_pdf_blocking(app, path, destination))
        .await
        .map_err(|error| format!("PDF 保存后台任务异常：{error}"))?
}

#[tauri::command]
pub fn print_practice_pdf(app: AppHandle, path: String) -> Result<(), String> {
    let source = managed_practice_pdf(&app, &path)?;
    std::process::Command::new("open")
        .args(["-a", "Preview"])
        .arg(source)
        .spawn()
        .map_err(|error| format!("无法在系统预览中打开 PDF：{error}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> PracticeDocument {
        PracticeDocument {
            id: "document-test".into(), practice_set_id: "set-test".into(), attempt_id: "attempt-test".into(),
            document_type: "answer_sheet".into(), title: "Axiom 数学练习".into(),
            metadata: DocumentMetadata { subject: "数学".into(), created_at: 1, item_count: 1, strategy: "deterministic-v1".into() },
            layout: DocumentLayout { version: "practice-a4-v1".into(), width_points: 595.28, height_points: 841.89 },
            pages: vec![DocumentPage {
                page_index: 0, page_identity: "page-test".into(),
                qr_payload: "AXIOM|layout=practice-a4-v1|set=set-test|attempt=attempt-test|document=document-test|page=0".into(),
                marker_rects: vec![DocumentRect { x: 24.0, y: 24.0, width: 11.0, height: 11.0 }],
                questions: vec![DocumentQuestion {
                    practice_item_id: "item-test".into(), display_number: 1,
                    statement_markdown: "求方程 $x^2=4$ 的解。".into(), options: None,
                    difficulty: "basic".into(), diagram_image_paths: vec![], canonical_answer: None,
                    solution_markdown: None, frame: DocumentRect { x: 42.0, y: 112.0, width: 511.0, height: 140.0 },
                }],
                answer_regions: vec![AnswerRegion { id: "region-test".into(), practice_item_id: "item-test".into(), region_index: 0, x: 0.08, y: 0.18, width: 0.84, height: 0.15 }],
            }],
        }
    }

    #[test]
    fn renders_real_a4_pdf_with_chinese_qr_and_answer_identity() {
        let directory =
            std::env::temp_dir().join(format!("axiom-practice-pdf-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&directory).expect("create test directory");
        let destination = directory.join("answer-sheet.pdf");
        let document = fixture();
        render(&document, &destination).expect("render practice PDF");
        let bytes = fs::read(&destination).expect("read PDF");
        assert!(bytes.starts_with(b"%PDF-"));
        assert!(
            bytes.len() > 20_000,
            "embedded Chinese font and QR should produce a substantive PDF"
        );
        assert_eq!(
            content_hash(&document).unwrap(),
            content_hash(&document).unwrap()
        );
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn normalizes_common_latex_without_changing_math_meaning() {
        assert_eq!(
            normalize_math_text("$m > -\\frac{1}{3}$ and \\sqrt{4}"),
            "m > -(1)/(3) and √4"
        );
    }
}
