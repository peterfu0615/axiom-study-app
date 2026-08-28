use crate::typst_math::latex_to_typst;
use qrcode::{Color as QrColor, QrCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use uuid::Uuid;
use wait_timeout::ChildExt;

const A4_WIDTH_POINTS: f32 = 595.28;
const A4_HEIGHT_POINTS: f32 = 841.89;
const PAGE_MARGIN_POINTS: f32 = 42.0;
const CONTENT_WIDTH_POINTS: f32 = A4_WIDTH_POINTS - PAGE_MARGIN_POINTS * 2.0;
const TYPST_VERSION: &str = "0.14.2";
const RENDERER_VERSION: &str = "axiom-typst-v2";
const RENDER_TIMEOUT: Duration = Duration::from_secs(20);
const RENDER_OUTPUT_LIMIT: usize = 64 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletePracticeDocument {
    id: String,
    practice_set_id: String,
    attempt_id: String,
    document_type: String,
    title: String,
    metadata: DocumentMetadata,
    layout: DocumentLayout,
    sections: Vec<PracticeSection>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentMetadata {
    subject: String,
    created_at: i64,
    item_count: usize,
    strategy: String,
    session_mode: String,
    max_duration_seconds: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentLayout {
    version: String,
    width_points: f32,
    height_points: f32,
    margin_points: f32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct PracticeSection {
    kind: SectionKind,
    title: String,
    blocks: Vec<ContentBlock>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
enum SectionKind {
    Exercise,
    AnswerSheet,
    Solution,
}

impl SectionKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Exercise => "exercise",
            Self::AnswerSheet => "answer_sheet",
            Self::Solution => "solution",
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum InlineContent {
    Text { text: String },
    InlineMath { latex: String },
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum ContentBlock {
    Paragraph {
        content: Vec<InlineContent>,
    },
    DisplayMath {
        latex: String,
    },
    Image {
        path: String,
        alt: String,
        purpose: String,
    },
    TikzDiagram {
        path: String,
        diagram_id: Option<String>,
        alt: String,
    },
    List {
        ordered: bool,
        items: Vec<Vec<InlineContent>>,
    },
    AnswerSpace {
        practice_item_id: String,
        line_count: usize,
        minimum_height_points: f32,
    },
    PageBreak {
        reason: String,
    },
    SectionCover {
        section: SectionKind,
        brand: String,
        title: String,
        subtitle: String,
        date_label: String,
        item_count: usize,
    },
    Question {
        practice_item_id: String,
        display_number: usize,
        content: Vec<ContentBlock>,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionPageRange {
    start_page: usize,
    end_page: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderedAnswerRegion {
    id: String,
    practice_item_id: String,
    region_index: usize,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderedDocumentPage {
    page_index: usize,
    page_identity: String,
    qr_payload: String,
    width_points: f32,
    height_points: f32,
    answer_regions: Vec<RenderedAnswerRegion>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletePdfRenderResult {
    document_id: String,
    file_path: String,
    content_hash: String,
    renderer_version: String,
    page_count: usize,
    byte_length: u64,
    cache_hit: bool,
    section_page_ranges: BTreeMap<String, SectionPageRange>,
    pages: Vec<RenderedDocumentPage>,
    degraded_solution_item_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PracticePdfRenderError {
    stage: &'static str,
    code: &'static str,
    message: &'static str,
    practice_set_id: String,
    document_id: String,
    renderer_contract: &'static str,
    renderer_version: Option<String>,
}

#[derive(Debug)]
struct PracticePage {
    local_index: usize,
    section: SectionKind,
    page_identity: String,
    qr_payload: String,
    qr_asset: String,
    questions: Vec<ContentBlock>,
}

#[derive(Debug)]
struct BuildOutput {
    source: String,
    practice_pages: Vec<PracticePage>,
    degraded_solution_item_ids: Vec<String>,
}

struct RenderedMetadata {
    page_count: usize,
    section_page_ranges: BTreeMap<String, SectionPageRange>,
    pages: Vec<RenderedDocumentPage>,
}

struct RenderOutput {
    metadata: RenderedMetadata,
    typst_version: String,
    degraded_solution_item_ids: Vec<String>,
}

fn typst_string(value: &str) -> String {
    format!(
        "\"{}\"",
        value
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('\r', "")
            .replace('\n', "\\n")
    )
}

fn inline_typst(content: &[InlineContent]) -> Result<String, String> {
    let mut output = String::new();
    for inline in content {
        match inline {
            InlineContent::Text { text } => {
                output.push_str("#text(");
                output.push_str(&typst_string(text));
                output.push(')');
            }
            InlineContent::InlineMath { latex } => {
                if latex.as_bytes().windows(2).any(|pair| pair == b"__") {
                    output.push_str("#text(");
                    output.push_str(&typst_string(latex));
                    output.push(')');
                } else {
                    output.push('$');
                    output.push_str(
                        &latex_to_typst(latex)
                            .map_err(|error| format!("无法排版行内公式 `{latex}`：{error}"))?,
                    );
                    output.push('$');
                }
            }
        }
    }
    Ok(output)
}

fn copy_asset(
    original: &str,
    render_directory: &Path,
    assets: &mut HashMap<String, String>,
) -> Result<String, String> {
    if let Some(existing) = assets.get(original) {
        return Ok(existing.clone());
    }
    let source = Path::new(original);
    if !source.is_file() {
        return Err(format!("练习图片不存在：{}", source.display()));
    }
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .filter(|value| matches!(value.as_str(), "png" | "jpg" | "jpeg" | "svg"))
        .ok_or_else(|| format!("练习图片格式不受支持：{}", source.display()))?;
    let mut bytes = Vec::new();
    fs::File::open(source)
        .and_then(|mut file| file.read_to_end(&mut bytes))
        .map_err(|error| format!("读取练习图片失败：{error}"))?;
    let hash = format!("{:x}", Sha256::digest(&bytes));
    let relative = format!("assets/{}.{}", &hash[..20], extension);
    let destination = render_directory.join(&relative);
    if !destination.is_file() {
        fs::write(&destination, bytes).map_err(|error| format!("准备练习图片失败：{error}"))?;
    }
    assets.insert(original.to_string(), relative.clone());
    Ok(relative)
}

fn block_typst(
    block: &ContentBlock,
    render_directory: &Path,
    assets: &mut HashMap<String, String>,
    page_identity: Option<&str>,
) -> Result<String, String> {
    match block {
        ContentBlock::Paragraph { content } => Ok(format!(
            "#block(width: 100%, below: 7pt)[{}]\n",
            inline_typst(content)?
        )),
        ContentBlock::DisplayMath { latex } => Ok(format!(
            "#block(width: 100%, below: 9pt)[#align(center)[$ {} $]]\n",
            latex_to_typst(latex)
                .map_err(|error| format!("无法排版独立公式 `{latex}`：{error}"))?
        )),
        ContentBlock::Image {
            path,
            alt: _,
            purpose,
        } => {
            let relative = copy_asset(path, render_directory, assets)?;
            let width = if purpose == "source" { "82%" } else { "68%" };
            Ok(format!(
                "#block(width: 100%, below: 10pt)[#align(center)[#image({}, width: {width}, height: 145pt, fit: \"contain\")]]\n",
                typst_string(&relative)
            ))
        }
        ContentBlock::TikzDiagram {
            path,
            alt: _,
            diagram_id,
        } => {
            let relative = copy_asset(path, render_directory, assets)?;
            let _ = diagram_id;
            Ok(format!(
                "#block(width: 100%, below: 10pt)[#align(center)[#image({}, width: 68%, height: 150pt, fit: \"contain\")]]\n",
                typst_string(&relative)
            ))
        }
        ContentBlock::List { ordered, items } => {
            let entries = items
                .iter()
                .map(|item| inline_typst(item).map(|value| format!("[{value}]")))
                .collect::<Result<Vec<_>, _>>()?
                .join(", ");
            let marker = if *ordered { "numbering: \"1.\", " } else { "" };
            Ok(format!(
                "#block(width: 100%, below: 8pt)[#list({marker}indent: 18pt, body-indent: 8pt, {entries})]\n"
            ))
        }
        ContentBlock::AnswerSpace {
            practice_item_id,
            line_count,
            minimum_height_points,
        } => {
            let identity = page_identity.ok_or_else(|| "答题区域缺少页面身份".to_string())?;
            let region_id = format!("{identity}:answer:{practice_item_id}:0");
            Ok(format!(
                "#block(width: 100%, below: 9pt)[\n\
                   #text(size: 8.5pt, fill: rgb(\"#77746c\"))[作答]\n\
                   #v(4pt)\n\
                   #context [#metadata((kind: \"answer-region\", id: {}, practice_item_id: {}, region_index: 0, page_identity: {}, page: counter(page).get().first(), pos: here().position(), width: 471.28, height: {})) <axiom-meta>]\n\
                   #rect(width: 100%, height: {}pt, stroke: .65pt + rgb(\"#aaa79e\"), radius: 2pt)[\n\
                     #pad(x: 10pt, y: 8pt)[#for _ in range({}) {{ line(length: 100%, stroke: .32pt + rgb(\"#dedbd2\")); v(13pt) }}]\n\
                   ]\n\
                 ]\n",
                typst_string(&region_id),
                typst_string(practice_item_id),
                typst_string(identity),
                minimum_height_points,
                minimum_height_points,
                line_count,
            ))
        }
        ContentBlock::PageBreak { reason } => {
            let _ = reason;
            Ok("#pagebreak()\n".to_string())
        }
        ContentBlock::SectionCover { .. } | ContentBlock::Question { .. } => {
            Err("文档块嵌套层级无效".to_string())
        }
    }
}

fn cover_typst(cover: &ContentBlock) -> Result<String, String> {
    let ContentBlock::SectionCover {
        section,
        brand,
        title,
        subtitle,
        date_label,
        item_count,
    } = cover
    else {
        return Err("章节缺少封面".to_string());
    };
    let section_name = section.as_str();
    let subtitle = if subtitle.trim().is_empty() {
        String::new()
    } else {
        format!(
            "#v(18pt)\n#text(size: 12pt, fill: rgb(\"#595750\"), {})\n",
            typst_string(subtitle)
        )
    };
    Ok(format!(
        "#context [#metadata((kind: \"section-start\", section: {}, page: counter(page).get().first(), pos: here().position())) <axiom-meta>]\n\
         #v(145pt)\n\
         #align(center)[\n\
           #text(font: \"Libertinus Serif\", size: 15pt, weight: \"semibold\", tracking: 1.2pt, {})\n\
           #v(24pt)\n\
           #text(size: 31pt, weight: \"bold\", {})\n\
           {}\
           #v(12pt)\n\
           #text(size: 11pt, fill: rgb(\"#77746c\"), {})\n\
           #v(74pt)\n\
           #line(length: 72pt, stroke: 2pt + rgb(\"#ffd50a\"))\n\
         ]\n",
        typst_string(section_name),
        typst_string(brand),
        typst_string(title),
        subtitle,
        typst_string(&format!("{date_label} · {item_count} 题")),
    ))
}

fn body_header(document: &CompletePracticeDocument, solution: bool) -> String {
    let title = if solution {
        format!("Axiom {}答案与解析", document.metadata.subject)
    } else {
        format!("Axiom {}练习", document.metadata.subject)
    };
    let identity = if solution {
        String::new()
    } else {
        "#v(10pt)\n#grid(columns: (1fr, 1fr), [姓名：#line(length: 105pt, stroke: .6pt)], [#align(right)[日期：#line(length: 82pt, stroke: .6pt)]])\n".to_string()
    };
    format!(
        "#align(center)[#text(size: 16pt, weight: \"bold\", {}) #linebreak() #text(size: 9.5pt, fill: rgb(\"#77746c\"), {})]\n\
         {}#v(12pt)\n#horizontal-rule()\n#v(13pt)\n",
        typst_string(&title),
        typst_string(&format!("{} · {} 题", document.metadata.subject, document.metadata.item_count)),
        identity,
    )
}

fn question_typst(
    question: &ContentBlock,
    section: SectionKind,
    render_directory: &Path,
    assets: &mut HashMap<String, String>,
    page_identity: Option<&str>,
) -> Result<String, String> {
    let ContentBlock::Question {
        practice_item_id: _,
        display_number,
        content,
    } = question
    else {
        return Err("章节正文包含非题目块".to_string());
    };
    let mut body = String::new();
    for block in content {
        body.push_str(&block_typst(
            block,
            render_directory,
            assets,
            page_identity,
        )?);
    }
    let breakable = section == SectionKind::Solution;
    Ok(format!(
        "#block(width: 100%, breakable: {}, below: 14pt)[\n\
           #grid(columns: (25pt, 1fr), column-gutter: 7pt,\n\
             [#text(size: 12pt, weight: \"bold\")[{}.]],\n\
             [{}]\n\
           )\n\
           #v(12pt)\n\
           #line(length: 100%, stroke: .35pt + rgb(\"#dedbd2\"))\n\
         ]\n",
        if breakable { "true" } else { "false" },
        display_number,
        body
    ))
}

fn unavailable_solution_typst(question: &ContentBlock) -> Result<(String, String), String> {
    let ContentBlock::Question {
        practice_item_id,
        display_number,
        ..
    } = question
    else {
        return Err("解析章节正文包含非题目块".to_string());
    };
    Ok((
        format!(
            "#block(width: 100%, breakable: true, below: 14pt)[\n\
               #grid(columns: (25pt, 1fr), column-gutter: 7pt,\n\
                 [#text(size: 12pt, weight: \"bold\")[{}.]],\n\
                 [#text(fill: rgb(\"#77746c\"))[答案与解析暂不可用。练习题仍可正常作答。]]\n\
               )\n\
               #v(12pt)\n\
               #line(length: 100%, stroke: .35pt + rgb(\"#dedbd2\"))\n\
             ]\n",
            display_number
        ),
        practice_item_id.clone(),
    ))
}

fn qr_svg(payload: &str) -> Result<String, String> {
    let code = QrCode::new(payload.as_bytes())
        .map_err(|error| format!("生成答题卡二维码失败：{error}"))?;
    let width = code.width();
    let quiet = 4usize;
    let total = width + quiet * 2;
    let mut paths = String::new();
    for row in 0..width {
        for column in 0..width {
            if code[(column, row)] == QrColor::Dark {
                paths.push_str(&format!(
                    "<rect x=\"{}\" y=\"{}\" width=\"1\" height=\"1\"/>",
                    column + quiet,
                    row + quiet
                ));
            }
        }
    }
    Ok(format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {total} {total}\" shape-rendering=\"crispEdges\"><g fill=\"#000\">{paths}</g></svg>"
    ))
}

fn estimated_block_height(block: &ContentBlock) -> f32 {
    match block {
        ContentBlock::Paragraph { content } => {
            let characters = content
                .iter()
                .map(|inline| match inline {
                    InlineContent::Text { text } => text.chars().count(),
                    InlineContent::InlineMath { latex } => latex.chars().count().max(8),
                })
                .sum::<usize>();
            22.0 * ((characters.max(1) as f32 / 35.0).ceil())
        }
        ContentBlock::DisplayMath { .. } => 40.0,
        ContentBlock::Image { .. } | ContentBlock::TikzDiagram { .. } => 166.0,
        ContentBlock::List { items, .. } => 24.0 * items.len().max(1) as f32,
        ContentBlock::AnswerSpace {
            minimum_height_points,
            ..
        } => minimum_height_points + 28.0,
        _ => 0.0,
    }
}

fn estimated_question_height(question: &ContentBlock) -> Result<f32, String> {
    let ContentBlock::Question {
        display_number: _,
        content,
        ..
    } = question
    else {
        return Err("练习正文包含非题目块".to_string());
    };
    let estimated = 56.0 + content.iter().map(estimated_block_height).sum::<f32>();
    Ok(
        if content
            .iter()
            .any(|block| matches!(block, ContentBlock::AnswerSpace { .. }))
        {
            estimated
        } else {
            estimated.max(96.0)
        },
    )
}

fn build_practice_pages(
    document: &CompletePracticeDocument,
    section: &PracticeSection,
    render_directory: &Path,
) -> Result<Vec<PracticePage>, String> {
    let questions = section
        .blocks
        .iter()
        .filter(|block| matches!(block, ContentBlock::Question { .. }))
        .cloned();
    let mut groups: Vec<Vec<ContentBlock>> = Vec::new();
    let mut current = Vec::new();
    let mut used = 0.0f32;
    for question in questions {
        let required = estimated_question_height(&question)?;
        if !current.is_empty() && used + required > 610.0 {
            groups.push(current);
            current = Vec::new();
            used = 0.0;
        }
        used += required;
        current.push(question);
    }
    if !current.is_empty() {
        groups.push(current);
    }
    groups
        .into_iter()
        .enumerate()
        .map(|(index, questions)| {
            let page_identity = format!("{}:{}-page:{index}", document.id, section.kind.as_str());
            let page_token = format!("{:x}", Sha256::digest(page_identity.as_bytes()));
            let qr_payload = match document.layout.version.as_str() {
                "practice-a4-v1" => {
                    format!("AXIOM|layout=practice-a4-v1|page={}", &page_token[..32])
                }
                "practice-a4-v2" => format!("AXIOM|v=2|page={}", &page_token[..32]),
                "practice-a4-v3" => format!("AXIOM|v=3|page={}", &page_token[..32]),
                _ => return Err("不支持的完整练习文档二维码版本".to_string()),
            };
            let qr_asset = format!("assets/{}-qr-{index}.svg", section.kind.as_str());
            fs::write(render_directory.join(&qr_asset), qr_svg(&qr_payload)?)
                .map_err(|error| format!("写入练习页二维码失败：{error}"))?;
            Ok(PracticePage {
                local_index: index,
                section: section.kind,
                page_identity,
                qr_payload,
                qr_asset,
                questions,
            })
        })
        .collect()
}

fn practice_page_typst(
    page: &PracticePage,
    section: SectionKind,
    document: &CompletePracticeDocument,
    render_directory: &Path,
    assets: &mut HashMap<String, String>,
) -> Result<String, String> {
    let mut questions = String::new();
    for question in &page.questions {
        questions.push_str(&question_typst(
            question,
            section,
            render_directory,
            assets,
            Some(&page.page_identity),
        )?);
    }
    Ok(format!(
        "#context [#metadata((kind: \"practice-page\", page_identity: {}, page: counter(page).get().first())) <axiom-meta>]\n\
         #block(width: {}pt, height: 839pt)[\n\
           #place(top + left, dx: 24pt, dy: 24pt)[#rect(width: 11pt, height: 11pt, fill: black)]\n\
           #place(top + left, dx: 560.28pt, dy: 24pt)[#rect(width: 11pt, height: 11pt, fill: black)]\n\
           #place(top + left, dx: 24pt, dy: 806.89pt)[#rect(width: 11pt, height: 11pt, fill: black)]\n\
           #place(top + left, dx: 560.28pt, dy: 806.89pt)[#rect(width: 11pt, height: 11pt, fill: black)]\n\
           #place(top + left, dx: 493pt, dy: 30pt)[#image({}, width: 58pt, height: 58pt)]\n\
           #place(top + left, dx: 42pt, dy: 42pt)[#box(width: {}pt)[\n\
             #text(size: 16pt, weight: \"bold\")[Axiom {}{}]\n\
             #v(4pt)\n\
             #text(size: 9pt, fill: rgb(\"#77746c\"))[姓名：________________　日期：______________]\n\
             #v(16pt)\n\
             {}\n\
           ]]\n\
           #place(top + left, dx: 42pt, dy: 818pt)[#text(size: 7pt, fill: rgb(\"#77746c\"))[{} {}]]\n\
         ]\n",
        typst_string(&page.page_identity),
        A4_WIDTH_POINTS,
        typst_string(&page.qr_asset),
        CONTENT_WIDTH_POINTS,
        document.metadata.subject,
        if section == SectionKind::AnswerSheet { "统一答题页" } else { "练习" },
        questions,
        if section == SectionKind::AnswerSheet { "答题页" } else { "练习页" },
        page.local_index + 1,
    ))
}

fn build_source(
    document: &CompletePracticeDocument,
    render_directory: &Path,
) -> Result<BuildOutput, String> {
    if document.document_type != "complete"
        || !matches!(
            document.layout.version.as_str(),
            "practice-a4-v1" | "practice-a4-v2" | "practice-a4-v3"
        )
        || (document.layout.width_points - A4_WIDTH_POINTS).abs() > 0.5
        || (document.layout.height_points - A4_HEIGHT_POINTS).abs() > 0.5
        || (document.layout.margin_points - PAGE_MARGIN_POINTS).abs() > 0.5
    {
        return Err("不支持的完整练习文档 layout".to_string());
    }
    if !(document.sections.len() == 2 || document.sections.len() == 3)
        || document.sections.first().map(|section| section.kind) != Some(SectionKind::Exercise)
        || document.sections.last().map(|section| section.kind) != Some(SectionKind::Solution)
        || (document.sections.len() == 3 && document.sections[1].kind != SectionKind::AnswerSheet)
    {
        return Err("完整练习文档必须按练习、可选答题页、解析组织".to_string());
    }
    fs::create_dir_all(render_directory.join("assets"))
        .map_err(|error| format!("创建 Typst 资源目录失败：{error}"))?;
    let mut practice_pages = Vec::new();
    let mut assets = HashMap::new();
    let mut source = format!(
        "#set document(title: {}, author: \"Axiom\")\n\
         #set page(paper: \"a4\", margin: (x: 42pt, top: 42pt, bottom: 42pt))\n\
         #set text(font: (\"Libertinus Serif\", \"Source Han Serif\", \"Songti SC\"), size: 10.5pt, fill: rgb(\"#25231c\"), lang: \"zh\")\n\
         #show math.equation: set text(font: (\"New Computer Modern Math\", \"Libertinus Serif\", \"Source Han Serif\"))\n\
         #set par(justify: true, leading: .72em)\n\
         #let horizontal-rule() = line(length: 100%, stroke: .55pt + rgb(\"#a9a69d\"))\n",
        typst_string(&document.title)
    );

    let mut degraded_solution_item_ids = Vec::new();
    for (section_index, section) in document.sections.iter().enumerate() {
        if section_index > 0 {
            source.push_str("#pagebreak()\n");
        }
        source.push_str("#set page(paper: \"a4\", margin: (x: 42pt, top: 42pt, bottom: 42pt), header: none, footer: none)\n");
        let cover = section
            .blocks
            .first()
            .ok_or_else(|| format!("{} 章节为空", section.title))?;
        source.push_str(&cover_typst(cover)?);
        source.push_str("#pagebreak()\n");

        match section.kind {
            SectionKind::Solution => {
                source.push_str(
                    "#set page(paper: \"a4\", margin: (x: 42pt, top: 42pt, bottom: 42pt), footer: context [#align(center)[#text(size: 7pt, fill: rgb(\"#77746c\"))[第 #counter(page).display() 页 / 共 #counter(page).final().first() 页]]])\n",
                );
                source.push_str(&body_header(
                    document,
                    section.kind == SectionKind::Solution,
                ));
                for question in section
                    .blocks
                    .iter()
                    .filter(|block| matches!(block, ContentBlock::Question { .. }))
                {
                    match question_typst(
                        question,
                        section.kind,
                        render_directory,
                        &mut assets,
                        None,
                    ) {
                        Ok(rendered) => source.push_str(&rendered),
                        Err(_) => {
                            let (fallback, practice_item_id) =
                                unavailable_solution_typst(question)?;
                            log::warn!(
                                "练习解析题降级（document_id={} item_id={} code=solution_content_unsupported）",
                                document.id,
                                practice_item_id
                            );
                            degraded_solution_item_ids.push(practice_item_id);
                            source.push_str(&fallback);
                        }
                    }
                }
            }
            SectionKind::Exercise | SectionKind::AnswerSheet => {
                let section_pages = build_practice_pages(document, section, render_directory)?;
                source.push_str(
                    "#set page(paper: \"a4\", margin: 0pt, header: none, footer: none)\n",
                );
                for (index, page) in section_pages.iter().enumerate() {
                    if index > 0 {
                        source.push_str("#pagebreak()\n");
                    }
                    source.push_str(&practice_page_typst(
                        page,
                        section.kind,
                        document,
                        render_directory,
                        &mut assets,
                    )?);
                }
                practice_pages.extend(section_pages);
            }
        }
    }
    source.push_str(
        "#context [#metadata((kind: \"document-end\", page: counter(page).get().first(), pos: here().position())) <axiom-meta>]\n",
    );
    Ok(BuildOutput {
        source,
        practice_pages,
        degraded_solution_item_ids,
    })
}

fn typst_binary() -> Result<PathBuf, String> {
    if let Some(path) = option_env!("AXIOM_TYPST_BINARY") {
        let candidate = PathBuf::from(path);
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    if let Ok(executable) = std::env::current_exe() {
        if let Some(directory) = executable.parent() {
            for name in ["axiom-typst", "typst"] {
                let candidate = directory.join(name);
                if candidate.is_file() {
                    return Ok(candidate);
                }
            }
        }
    }
    if let Some(path) = ["/opt/homebrew/bin/typst", "/usr/local/bin/typst"]
        .into_iter()
        .map(PathBuf::from)
        .find(|path| path.is_file())
    {
        return Ok(path);
    }
    #[cfg(test)]
    if let Some(path) = std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths)
            .map(|directory| directory.join("typst"))
            .find(|candidate| candidate.is_file())
    }) {
        return Ok(path);
    }
    Err("Axiom 缺少离线 Typst 排版引擎，请重新安装应用".to_string())
}

fn read_renderer_output<R: Read>(mut reader: R) -> std::io::Result<Vec<u8>> {
    let mut retained = Vec::new();
    let mut buffer = [0u8; 8 * 1024];
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        let remaining = RENDER_OUTPUT_LIMIT.saturating_sub(retained.len());
        retained.extend_from_slice(&buffer[..read.min(remaining)]);
    }
    Ok(retained)
}

fn run_typst(binary: &Path, arguments: &[String], directory: &Path) -> Result<String, String> {
    let mut child = Command::new(binary)
        .args(arguments)
        .current_dir(directory)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("无法启动 Typst 排版引擎：{error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法读取 Typst 标准输出".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法读取 Typst 错误输出".to_string())?;
    let stdout_reader = thread::spawn(move || read_renderer_output(stdout));
    let stderr_reader = thread::spawn(move || read_renderer_output(stderr));
    let status = match child.wait_timeout(RENDER_TIMEOUT) {
        Ok(Some(status)) => status,
        Ok(None) => {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            return Err("Typst 排版超过 20 秒限制".to_string());
        }
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            return Err(format!("等待 Typst 排版失败：{error}"));
        }
    };
    let stdout = stdout_reader
        .join()
        .map_err(|_| "读取 Typst 标准输出时后台任务异常".to_string())?
        .map_err(|error| format!("读取 Typst 标准输出失败：{error}"))?;
    let stderr = stderr_reader
        .join()
        .map_err(|_| "读取 Typst 错误输出时后台任务异常".to_string())?
        .map_err(|error| format!("读取 Typst 错误输出失败：{error}"))?;
    if !status.success() {
        let stderr = String::from_utf8_lossy(&stderr);
        return Err(format!(
            "Typst 排版失败：{}",
            stderr.lines().take(10).collect::<Vec<_>>().join(" ")
        ));
    }
    Ok(String::from_utf8_lossy(&stdout).to_string())
}

fn verify_typst(binary: &Path, directory: &Path) -> Result<String, String> {
    let version = run_typst(binary, &["--version".to_string()], directory)?;
    let version = version.trim();
    let expected_prefix = format!("typst {TYPST_VERSION}");
    if version != expected_prefix && !version.starts_with(&format!("{expected_prefix} ")) {
        return Err(format!(
            "Typst 版本不匹配：需要 {TYPST_VERSION}，实际为 {version}"
        ));
    }
    Ok(version.to_string())
}

fn parse_points(value: &Value) -> Result<f32, String> {
    value
        .as_str()
        .and_then(|value| value.strip_suffix("pt"))
        .and_then(|value| value.parse::<f32>().ok())
        .ok_or_else(|| format!("Typst 位置 metadata 无效：{value}"))
}

fn rendered_metadata(
    metadata_json: &str,
    practice_pages: &[PracticePage],
) -> Result<RenderedMetadata, String> {
    let values: Vec<Value> = serde_json::from_str(metadata_json)
        .map_err(|error| format!("解析 Typst metadata 失败：{error}"))?;
    let mut section_starts = BTreeMap::new();
    let mut page_count = None;
    let mut page_numbers_by_identity = BTreeMap::new();
    let mut regions_by_page: BTreeMap<String, (usize, Vec<RenderedAnswerRegion>)> = BTreeMap::new();
    for value in values {
        match value.get("kind").and_then(Value::as_str) {
            Some("section-start") => {
                let section = value
                    .get("section")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "章节 metadata 缺少 section".to_string())?;
                let page = value
                    .get("page")
                    .and_then(Value::as_u64)
                    .ok_or_else(|| "章节 metadata 缺少 page".to_string())?
                    as usize;
                section_starts.insert(section.to_string(), page);
            }
            Some("document-end") => {
                page_count = value
                    .get("page")
                    .and_then(Value::as_u64)
                    .map(|page| page as usize);
            }
            Some("practice-page") => {
                let page_identity = value
                    .get("page_identity")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "练习页面 metadata 缺少页面身份".to_string())?;
                let page = value
                    .get("page")
                    .and_then(Value::as_u64)
                    .ok_or_else(|| "练习页面 metadata 缺少 page".to_string())?
                    as usize;
                page_numbers_by_identity.insert(page_identity.to_string(), page);
            }
            Some("answer-region") => {
                let page_identity = value
                    .get("page_identity")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "答题区域 metadata 缺少页面身份".to_string())?
                    .to_string();
                let page = value
                    .get("page")
                    .and_then(Value::as_u64)
                    .ok_or_else(|| "答题区域 metadata 缺少 page".to_string())?
                    as usize;
                let pos = value
                    .get("pos")
                    .ok_or_else(|| "答题区域 metadata 缺少位置".to_string())?;
                let x = parse_points(pos.get("x").ok_or_else(|| "答题区域缺少 x".to_string())?)?;
                let y = parse_points(pos.get("y").ok_or_else(|| "答题区域缺少 y".to_string())?)?;
                let width = value
                    .get("width")
                    .and_then(Value::as_f64)
                    .ok_or_else(|| "答题区域缺少 width".to_string())?
                    as f32;
                let height = value
                    .get("height")
                    .and_then(Value::as_f64)
                    .ok_or_else(|| "答题区域缺少 height".to_string())?
                    as f32;
                let region = RenderedAnswerRegion {
                    id: value
                        .get("id")
                        .and_then(Value::as_str)
                        .ok_or_else(|| "答题区域缺少 id".to_string())?
                        .to_string(),
                    practice_item_id: value
                        .get("practice_item_id")
                        .and_then(Value::as_str)
                        .ok_or_else(|| "答题区域缺少题目身份".to_string())?
                        .to_string(),
                    region_index: value
                        .get("region_index")
                        .and_then(Value::as_u64)
                        .unwrap_or(0) as usize,
                    x: x / A4_WIDTH_POINTS,
                    y: y / A4_HEIGHT_POINTS,
                    width: width / A4_WIDTH_POINTS,
                    height: height / A4_HEIGHT_POINTS,
                };
                regions_by_page
                    .entry(page_identity)
                    .or_insert_with(|| (page, Vec::new()))
                    .1
                    .push(region);
            }
            _ => {}
        }
    }
    let page_count = page_count.ok_or_else(|| "Typst metadata 缺少文档页数".to_string())?;
    let exercise_start = *section_starts
        .get("exercise")
        .ok_or_else(|| "缺少练习章节页码".to_string())?;
    let solution_start = *section_starts
        .get("solution")
        .ok_or_else(|| "缺少解析章节页码".to_string())?;
    let answer_sheet_start = section_starts.get("answer_sheet").copied();
    let mut ranges = BTreeMap::from([
        (
            "exercise".to_string(),
            SectionPageRange {
                start_page: exercise_start,
                end_page: answer_sheet_start.unwrap_or(solution_start) - 1,
            },
        ),
        (
            "solution".to_string(),
            SectionPageRange {
                start_page: solution_start,
                end_page: page_count,
            },
        ),
    ]);
    if let Some(answer_sheet_start) = answer_sheet_start {
        ranges.insert(
            "answer_sheet".to_string(),
            SectionPageRange {
                start_page: answer_sheet_start,
                end_page: solution_start - 1,
            },
        );
    }
    let pages = practice_pages
        .iter()
        .map(|page| {
            let global_page = page_numbers_by_identity
                .get(&page.page_identity)
                .copied()
                .or_else(|| {
                    regions_by_page
                        .get(&page.page_identity)
                        .map(|entry| entry.0)
                })
                .ok_or_else(|| {
                    format!(
                        "{} 页面 {} 缺少真实页面 metadata",
                        page.section.as_str(),
                        page.local_index + 1
                    )
                })?;
            let regions = regions_by_page
                .remove(&page.page_identity)
                .map(|entry| entry.1)
                .unwrap_or_default();
            Ok(RenderedDocumentPage {
                page_index: global_page - 1,
                page_identity: page.page_identity.clone(),
                qr_payload: page.qr_payload.clone(),
                width_points: A4_WIDTH_POINTS,
                height_points: A4_HEIGHT_POINTS,
                answer_regions: regions,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(RenderedMetadata {
        page_count,
        section_page_ranges: ranges,
        pages,
    })
}

fn content_hash(
    document: &CompletePracticeDocument,
    typst_version: &str,
) -> Result<String, String> {
    let mut value = serde_json::to_vec(document)
        .map_err(|error| format!("序列化完整 PracticeDocument 失败：{error}"))?;
    value.extend_from_slice(RENDERER_VERSION.as_bytes());
    value.extend_from_slice(typst_version.as_bytes());
    Ok(format!("{:x}", Sha256::digest(value)))
}

fn output_path(
    app: &AppHandle,
    document: &CompletePracticeDocument,
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
        "{}-complete-{}.pdf",
        document.practice_set_id,
        &hash[..12]
    )))
}

fn render_to_path(
    document: &CompletePracticeDocument,
    destination: &Path,
) -> Result<RenderOutput, String> {
    let render_directory = std::env::temp_dir().join(format!("axiom-typst-{}", Uuid::new_v4()));
    fs::create_dir_all(&render_directory)
        .map_err(|error| format!("创建 Typst 临时目录失败：{error}"))?;
    let result: Result<RenderOutput, String> = (|| {
        let binary = typst_binary()?;
        let version = verify_typst(&binary, &render_directory)?;
        let build = build_source(document, &render_directory)?;
        let source_path = render_directory.join("practice.typ");
        let output_path = render_directory.join("practice.pdf");
        fs::write(&source_path, build.source.as_bytes())
            .map_err(|error| format!("写入 Typst 文档失败：{error}"))?;
        let timestamp = (document.metadata.created_at.max(0) / 1000).to_string();
        run_typst(
            &binary,
            &[
                "compile".to_string(),
                "--root".to_string(),
                render_directory.to_string_lossy().to_string(),
                "--creation-timestamp".to_string(),
                timestamp.clone(),
                "practice.typ".to_string(),
                "practice.pdf".to_string(),
            ],
            &render_directory,
        )?;
        let bytes =
            fs::read(&output_path).map_err(|error| format!("读取 Typst PDF 失败：{error}"))?;
        if !bytes.starts_with(b"%PDF-") {
            return Err("Typst 没有生成有效 PDF".to_string());
        }
        let metadata_json = run_typst(
            &binary,
            &[
                "query".to_string(),
                "--root".to_string(),
                render_directory.to_string_lossy().to_string(),
                "--creation-timestamp".to_string(),
                timestamp,
                "practice.typ".to_string(),
                "<axiom-meta>".to_string(),
                "--field".to_string(),
                "value".to_string(),
                "--format".to_string(),
                "json".to_string(),
            ],
            &render_directory,
        )?;
        let metadata = rendered_metadata(&metadata_json, &build.practice_pages)?;
        let temporary = destination.with_extension(format!("{}.tmp", Uuid::new_v4()));
        fs::write(&temporary, bytes).map_err(|error| format!("写入 PDF 临时文件失败：{error}"))?;
        fs::rename(&temporary, destination)
            .map_err(|error| format!("提交完整 PDF 失败：{error}"))?;
        Ok(RenderOutput {
            metadata,
            typst_version: version,
            degraded_solution_item_ids: build.degraded_solution_item_ids,
        })
    })();
    let _ = fs::remove_dir_all(&render_directory);
    result
}

fn render_complete_practice_pdf_blocking(
    app: AppHandle,
    document: CompletePracticeDocument,
) -> Result<CompletePdfRenderResult, Box<PracticePdfRenderError>> {
    let mut verified_renderer_version = None;
    let result: Result<CompletePdfRenderResult, String> = (|| {
        let binary = typst_binary()?;
        let probe_directory = std::env::temp_dir();
        let typst_version = verify_typst(&binary, &probe_directory)?;
        verified_renderer_version = Some(typst_version.clone());
        let hash = content_hash(&document, &typst_version)?;
        let destination = output_path(&app, &document, &hash)?;
        let cache_hit = destination.is_file();
        let output = render_to_path(&document, &destination)?;
        let metadata = fs::metadata(&destination)
            .map_err(|error| format!("读取完整 PDF 产物失败：{error}"))?;
        Ok(CompletePdfRenderResult {
            document_id: document.id.clone(),
            file_path: destination.to_string_lossy().to_string(),
            content_hash: hash,
            renderer_version: format!("{RENDERER_VERSION}+{}", output.typst_version),
            page_count: output.metadata.page_count,
            byte_length: metadata.len(),
            cache_hit,
            section_page_ranges: output.metadata.section_page_ranges,
            pages: output.metadata.pages,
            degraded_solution_item_ids: output.degraded_solution_item_ids,
        })
    })();
    match result {
        Ok(rendered) => Ok(rendered),
        Err(raw) => {
            let error = safe_render_error(&document, &raw, verified_renderer_version);
            log::error!(
                "完整练习 PDF 排版失败（document_id={} practice_set_id={} stage={} code={} contract={} renderer={}）",
                error.document_id,
                error.practice_set_id,
                error.stage,
                error.code,
                error.renderer_contract,
                error.renderer_version.as_deref().unwrap_or("unavailable")
            );
            Err(Box::new(error))
        }
    }
}

#[tauri::command]
pub async fn render_complete_practice_pdf(
    app: AppHandle,
    document: CompletePracticeDocument,
) -> Result<CompletePdfRenderResult, Box<PracticePdfRenderError>> {
    let error_document = document.clone();
    tauri::async_runtime::spawn_blocking(move || {
        render_complete_practice_pdf_blocking(app, document)
    })
    .await
    .unwrap_or_else(|error| {
        Err(Box::new(safe_render_error(
            &error_document,
            &format!("Typst 后台任务异常：{error}"),
            None,
        )))
    })
}

fn safe_render_error(
    document: &CompletePracticeDocument,
    raw: &str,
    renderer_version: Option<String>,
) -> PracticePdfRenderError {
    let (stage, code, message) = if raw.contains("缺少离线 Typst")
        || raw.contains("无法启动 Typst")
        || raw.contains("Typst 版本不匹配")
    {
        (
            "renderer_runtime",
            "renderer_unavailable",
            "离线排版引擎不可用",
        )
    } else if raw.contains("超过 20 秒限制") {
        ("renderer_runtime", "renderer_timeout", "练习文档排版超时")
    } else if raw.contains("layout") || raw.contains("必须按练习、解析组织") {
        (
            "document_contract",
            "document_contract_invalid",
            "练习文档结构无效",
        )
    } else if raw.contains("公式")
        || raw.contains("LaTeX")
        || raw.contains("图形")
        || raw.contains("SVG")
        || raw.contains("资源")
    {
        (
            "document_content",
            "document_content_unsupported",
            "练习内容包含暂不支持的排版元素",
        )
    } else if raw.contains("目录")
        || raw.contains("文件")
        || raw.contains("写入")
        || raw.contains("读取")
        || raw.contains("提交完整 PDF")
    {
        ("filesystem", "renderer_io_failed", "无法写入练习 PDF")
    } else if raw.contains("metadata") || raw.contains("位置") {
        ("render_result", "render_result_invalid", "排版结果校验失败")
    } else {
        ("renderer", "renderer_failed", "练习 PDF 排版失败")
    };
    PracticePdfRenderError {
        stage,
        code,
        message,
        practice_set_id: document.practice_set_id.clone(),
        document_id: document.id.clone(),
        renderer_contract: RENDERER_VERSION,
        renderer_version,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paragraph(text: &str) -> ContentBlock {
        ContentBlock::Paragraph {
            content: vec![InlineContent::Text { text: text.into() }],
        }
    }

    fn formula(latex: &str) -> ContentBlock {
        ContentBlock::DisplayMath {
            latex: latex.into(),
        }
    }

    fn question(id: &str, number: usize, content: Vec<ContentBlock>) -> ContentBlock {
        ContentBlock::Question {
            practice_item_id: id.into(),
            display_number: number,
            content,
        }
    }

    fn cover(section: SectionKind, title: &str) -> ContentBlock {
        ContentBlock::SectionCover {
            section,
            brand: "Axiom".into(),
            title: title.into(),
            subtitle: "数学 · 6 题".into(),
            date_label: "2026年8月12日".into(),
            item_count: 6,
        }
    }

    fn fixture(image_path: &Path, svg_path: &Path) -> CompletePracticeDocument {
        let mut exercise_questions = vec![
            question(
                "item-1",
                1,
                vec![
                    ContentBlock::Paragraph {
                        content: vec![
                            InlineContent::Text {
                                text: "一次函数 ".into(),
                            },
                            InlineContent::InlineMath {
                                latex: "y=(3m+1)x-2".into(),
                            },
                        ],
                    },
                    formula(r"\frac{1}{2}+\sqrt{3}"),
                    ContentBlock::Image {
                        path: image_path.to_string_lossy().to_string(),
                        alt: "原始图片".into(),
                        purpose: "diagram".into(),
                    },
                    ContentBlock::AnswerSpace {
                        practice_item_id: "item-1".into(),
                        line_count: 4,
                        minimum_height_points: 88.0,
                    },
                ],
            ),
            question(
                "item-2",
                2,
                vec![
                    ContentBlock::Paragraph {
                        content: vec![
                            InlineContent::InlineMath {
                                latex: r"\angle ABC".into(),
                            },
                            InlineContent::Text {
                                text: "，且 ".into(),
                            },
                            InlineContent::InlineMath {
                                latex: r"AC \perp BD".into(),
                            },
                            InlineContent::Text {
                                text: "，角度为 ".into(),
                            },
                            InlineContent::InlineMath {
                                latex: r"180^\circ".into(),
                            },
                        ],
                    },
                    ContentBlock::TikzDiagram {
                        path: svg_path.to_string_lossy().to_string(),
                        diagram_id: Some("diagram-1".into()),
                        alt: "TikZ 矢量图".into(),
                    },
                    ContentBlock::AnswerSpace {
                        practice_item_id: "item-2".into(),
                        line_count: 6,
                        minimum_height_points: 124.0,
                    },
                ],
            ),
        ];
        for index in 3..=6 {
            exercise_questions.push(question(
                &format!("item-{index}"),
                index,
                vec![
                    paragraph(&format!("第 {index} 题数学公式回归")),
                    formula(if index % 2 == 0 {
                        r"x^2+2x+1"
                    } else {
                        r"\frac{1}{2}+\sqrt{3}"
                    }),
                    ContentBlock::AnswerSpace {
                        practice_item_id: format!("item-{index}"),
                        line_count: 4,
                        minimum_height_points: 88.0,
                    },
                ],
            ));
        }
        let mut solution_questions = vec![
            question(
                "item-1",
                1,
                vec![
                    paragraph("答案与解题过程"),
                    formula(r"\because \text{一次函数 } y=(3m+1)x-2 \therefore m>-\frac{1}{3}"),
                    formula(r"\therefore \begin{cases} -2k + b = 0 \\ b = 4 \end{cases}"),
                    formula(r"x^2+2x+1"),
                ],
            ),
            question(
                "item-2",
                2,
                vec![paragraph("相关知识"), formula(r"\angle ABC=180^\circ")],
            ),
        ];
        for index in 3..=6 {
            solution_questions.push(question(
                &format!("item-{index}"),
                index,
                vec![
                    paragraph("答案与解析"),
                    formula(if index % 2 == 0 {
                        r"x^2+2x+1=(x+1)^2"
                    } else {
                        r"\frac{1}{2}+\sqrt{3}"
                    }),
                ],
            ));
        }
        CompletePracticeDocument {
            id: "document-fixture".into(),
            practice_set_id: "set-fixture".into(),
            attempt_id: "attempt-fixture".into(),
            document_type: "complete".into(),
            title: "Axiom 数学练习".into(),
            metadata: DocumentMetadata {
                subject: "数学".into(),
                created_at: 1_786_464_000_000,
                item_count: 6,
                strategy: "fixture".into(),
                session_mode: "standard".into(),
                max_duration_seconds: 2_520,
            },
            layout: DocumentLayout {
                version: "practice-a4-v2".into(),
                width_points: A4_WIDTH_POINTS,
                height_points: A4_HEIGHT_POINTS,
                margin_points: PAGE_MARGIN_POINTS,
            },
            sections: vec![
                PracticeSection {
                    kind: SectionKind::Exercise,
                    title: "练习".into(),
                    blocks: [
                        vec![
                            cover(SectionKind::Exercise, "数学练习"),
                            ContentBlock::PageBreak {
                                reason: "cover_to_body".into(),
                            },
                        ],
                        exercise_questions,
                    ]
                    .concat(),
                },
                PracticeSection {
                    kind: SectionKind::Solution,
                    title: "答案与解析".into(),
                    blocks: [
                        vec![
                            cover(SectionKind::Solution, "答案与解析"),
                            ContentBlock::PageBreak {
                                reason: "cover_to_body".into(),
                            },
                        ],
                        solution_questions,
                    ]
                    .concat(),
                },
            ],
        }
    }

    #[test]
    fn accepts_camel_case_structured_content_from_tauri_ipc() {
        let block: ContentBlock = serde_json::from_value(serde_json::json!({
            "kind": "answerSpace",
            "practiceItemId": "item-ipc",
            "lineCount": 4,
            "minimumHeightPoints": 88.0
        }))
        .expect("deserialize frontend content block");
        assert!(matches!(
            block,
            ContentBlock::AnswerSpace {
                practice_item_id,
                line_count: 4,
                ..
            } if practice_item_id == "item-ipc"
        ));
    }

    #[test]
    fn degrades_only_an_unsupported_solution_question() {
        let directory =
            std::env::temp_dir().join(format!("axiom-typst-degrade-{}", Uuid::new_v4()));
        let mut document = fixture(Path::new("/tmp/unused.png"), Path::new("/tmp/unused.svg"));
        for section in &mut document.sections {
            for block in &mut section.blocks {
                if let ContentBlock::Question { content, .. } = block {
                    content.retain(|item| {
                        !matches!(
                            item,
                            ContentBlock::Image { .. } | ContentBlock::TikzDiagram { .. }
                        )
                    });
                }
            }
        }
        let ContentBlock::Question { content, .. } = &mut document.sections[1].blocks[2] else {
            panic!("solution question fixture")
        };
        content.push(formula(r"\unsupported"));

        let built = build_source(&document, &directory).expect("exercise remains renderable");
        assert_eq!(built.degraded_solution_item_ids, vec!["item-1"]);
        assert!(built.source.contains("答案与解析暂不可用"));
        assert!(built.source.contains("item-1"));
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn render_errors_expose_safe_diagnostics_without_user_content() {
        let document = fixture(Path::new("/tmp/unused.png"), Path::new("/tmp/unused.svg"));
        let error = safe_render_error(
            &document,
            r"无法排版独立公式 `\private-formula`：不支持的 LaTeX 命令",
            Some("typst 0.14.2".into()),
        );
        let serialized = serde_json::to_string(&error).expect("serialize safe error");
        assert!(serialized.contains("document_content_unsupported"));
        assert!(serialized.contains("axiom-typst-v2"));
        assert!(!serialized.contains("private-formula"));

        let timeout = safe_render_error(&document, "Typst 排版超过 20 秒限制", None);
        assert_eq!(timeout.stage, "renderer_runtime");
        assert_eq!(timeout.code, "renderer_timeout");
    }

    #[test]
    fn renders_answer_blanks_as_text_for_existing_documents() {
        let rendered = inline_typst(&[InlineContent::InlineMath {
            latex: "(1)___________".into(),
        }])
        .expect("render answer blank");
        assert_eq!(rendered, "#text(\"(1)___________\")");
    }

    #[test]
    fn drains_large_typst_diagnostics_without_false_timeout() {
        let directory =
            std::env::temp_dir().join(format!("axiom-typst-diagnostics-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).expect("create diagnostics fixture directory");
        let source = (0..500)
            .map(|_| "$________$")
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(directory.join("invalid.typ"), source).expect("write invalid Typst fixture");
        let binary = typst_binary().expect("locate Typst renderer");
        let started = std::time::Instant::now();
        let error = run_typst(
            &binary,
            &[
                "compile".into(),
                "--diagnostic-format".into(),
                "short".into(),
                "invalid.typ".into(),
                "invalid.pdf".into(),
            ],
            &directory,
        )
        .expect_err("invalid source must fail");
        assert!(error.contains("Typst 排版失败"));
        assert!(!error.contains("20 秒限制"));
        assert!(started.elapsed() < RENDER_TIMEOUT);
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn builds_and_compiles_a_real_typst_practice_document() {
        let directory = std::env::temp_dir().join(format!("axiom-typst-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).expect("create fixture directory");
        let image_path = directory.join("source.png");
        image::RgbImage::from_pixel(320, 120, image::Rgb([245, 245, 245]))
            .save(&image_path)
            .expect("write fixture image");
        let svg_path = crate::diagram::render_validated_fixture(
            &directory.join("diagram-cache"),
            include_str!("../tests/fixtures/tikz/perpendicular.tikz"),
            &["A", "B", "C", "D"],
            true,
        );
        let mut document = fixture(&image_path, &svg_path);
        let ContentBlock::Question { content, .. } = &mut document.sections[0].blocks[2] else {
            panic!("exercise question fixture")
        };
        content.insert(
            0,
            ContentBlock::Paragraph {
                content: vec![InlineContent::InlineMath {
                    latex: "(1)___________".into(),
                }],
            },
        );
        let destination = directory.join("practice.pdf");
        let output =
            render_to_path(&document, &destination).expect("render Typst practice document");
        assert!(output.typst_version.starts_with("typst 0.14.2"));
        assert!(output.metadata.page_count >= 4);
        assert_eq!(
            output.metadata.section_page_ranges["exercise"].start_page,
            1
        );
        assert!(
            output.metadata.section_page_ranges["exercise"].end_page
                < output.metadata.section_page_ranges["solution"].start_page
        );
        assert!(!output
            .metadata
            .section_page_ranges
            .contains_key("answerSheet"));
        assert_eq!(
            output
                .metadata
                .pages
                .iter()
                .flat_map(|page| &page.answer_regions)
                .count(),
            6
        );
        assert!(output
            .metadata
            .pages
            .iter()
            .flat_map(|page| &page.answer_regions)
            .all(|region| region.x >= 0.0
                && region.y >= 0.0
                && region.x + region.width <= 1.0
                && region.y + region.height <= 1.0));
        let bytes = fs::read(&destination).expect("read rendered pdf");
        assert!(bytes.starts_with(b"%PDF-"));
        assert!(bytes.len() > 20_000);
        let answer_questions = (1..=6)
            .map(|index| {
                question(
                    &format!("item-{index}"),
                    index,
                    vec![
                        paragraph(&format!("第 {index} 题作答区")),
                        ContentBlock::AnswerSpace {
                            practice_item_id: format!("item-{index}"),
                            line_count: 6,
                            minimum_height_points: 112.0,
                        },
                    ],
                )
            })
            .collect::<Vec<_>>();
        document.metadata.session_mode = "mock_test".into();
        document.metadata.max_duration_seconds = 3_600;
        document.sections.insert(
            1,
            PracticeSection {
                kind: SectionKind::AnswerSheet,
                title: "统一答题页".into(),
                blocks: [
                    vec![
                        cover(SectionKind::AnswerSheet, "统一答题页"),
                        ContentBlock::PageBreak {
                            reason: "cover_to_body".into(),
                        },
                    ],
                    answer_questions,
                ]
                .concat(),
            },
        );
        let mock_destination = directory.join("practice-mock.pdf");
        let mock_output = render_to_path(&document, &mock_destination)
            .expect("render mock-test document with answer sheet");
        assert!(mock_output
            .metadata
            .section_page_ranges
            .contains_key("answer_sheet"));
        assert!(
            mock_output.metadata.section_page_ranges["exercise"].end_page
                < mock_output.metadata.section_page_ranges["answer_sheet"].start_page
        );
        assert!(
            mock_output.metadata.section_page_ranges["answer_sheet"].end_page
                < mock_output.metadata.section_page_ranges["solution"].start_page
        );
        if let Ok(output) = std::env::var("AXIOM_TYPST_TEST_OUTPUT") {
            let output = PathBuf::from(output);
            if let Some(parent) = output.parent() {
                fs::create_dir_all(parent).expect("create acceptance PDF directory");
            }
            fs::copy(&destination, output).expect("copy rendered acceptance PDF");
        }
        let _ = fs::remove_dir_all(directory);
    }
}
