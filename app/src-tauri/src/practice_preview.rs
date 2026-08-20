use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Duration,
};
use tauri::AppHandle;
use uuid::Uuid;
use wait_timeout::ChildExt;

const PREVIEW_WIDTH: u32 = 1440;
const PREVIEW_TIMEOUT: Duration = Duration::from_secs(30);
const PREVIEW_RENDERER_VERSION: &str = "coregraphics-v2";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PracticePdfPagePreview {
    path: String,
    pixel_width: u32,
    pixel_height: u32,
}

fn validated_pdf(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    if path.extension().and_then(|value| value.to_str()) != Some("pdf") || !path.is_file() {
        return Err("练习 PDF 不存在或格式无效".to_string());
    }
    Ok(path)
}

fn preview_dimensions(path: &Path) -> Result<(u32, u32), String> {
    let (width, height) =
        image::image_dimensions(path).map_err(|_| "PDF 预览结果无效".to_string())?;
    if width == 0 || height == 0 {
        return Err("PDF 预览结果为空".to_string());
    }
    Ok((width, height))
}

fn safe_identifier(value: Option<&str>) -> &str {
    match value {
        Some(value)
            if !value.is_empty()
                && value.len() <= 64
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_')) =>
        {
            value
        }
        Some(_) => "invalid",
        None => "unknown",
    }
}

fn render_practice_pdf_page_blocking(
    helper: PathBuf,
    path: String,
    page_number: u32,
    practice_set_id: Option<String>,
) -> Result<PracticePdfPagePreview, String> {
    if page_number == 0 {
        return Err("PDF 页码必须从 1 开始".to_string());
    }
    let pdf = validated_pdf(&path)?;
    let stem = pdf
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "练习 PDF 文件名无效".to_string())?;
    let directory = pdf
        .parent()
        .ok_or_else(|| "无法定位练习 PDF 目录".to_string())?
        .join("previews");
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建 PDF 预览缓存：{error}"))?;
    let output = directory.join(format!(
        "{stem}-{PREVIEW_RENDERER_VERSION}-page-{page_number}-{PREVIEW_WIDTH}.png"
    ));

    if output.is_file() {
        if let Ok((pixel_width, pixel_height)) = preview_dimensions(&output) {
            return Ok(PracticePdfPagePreview {
                path: output.to_string_lossy().to_string(),
                pixel_width,
                pixel_height,
            });
        }
        let _ = fs::remove_file(&output);
    }

    let temporary = directory.join(format!(
        ".{stem}-page-{page_number}-{PREVIEW_WIDTH}-{}.png",
        Uuid::new_v4()
    ));
    let mut child = Command::new(helper)
        .args([
            "render-pdf-page",
            "--input",
            pdf.to_string_lossy().as_ref(),
            "--output",
            temporary.to_string_lossy().as_ref(),
            "--page",
            &page_number.to_string(),
            "--width",
            &PREVIEW_WIDTH.to_string(),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("无法启动 PDF 预览器：{error}"))?;

    let status = match child.wait_timeout(PREVIEW_TIMEOUT) {
        Ok(Some(status)) => status,
        Ok(None) => {
            let _ = child.kill();
            let _ = child.wait();
            let _ = fs::remove_file(&temporary);
            log::warn!(
                "练习 PDF 页面预览超时 [stage=preview_render code=timeout practiceSetId={} page={} renderer={}]",
                safe_identifier(practice_set_id.as_deref()),
                page_number,
                PREVIEW_RENDERER_VERSION
            );
            return Err("PDF 页面预览超时，请重试".to_string());
        }
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            let _ = fs::remove_file(&temporary);
            return Err(format!("等待 PDF 预览器失败：{error}"));
        }
    };
    let result = child.wait_with_output().map_err(|error| {
        let _ = fs::remove_file(&temporary);
        format!("读取 PDF 预览结果失败：{error}")
    })?;
    if !status.success() || !result.status.success() {
        let _ = fs::remove_file(&temporary);
        log::warn!(
            "练习 PDF 页面预览失败 [stage=preview_render code=sidecar_exit practiceSetId={} page={} status={:?} stderrBytes={} renderer={}]",
            safe_identifier(practice_set_id.as_deref()),
            page_number,
            result.status.code(),
            result.stderr.len(),
            PREVIEW_RENDERER_VERSION
        );
        return Err("PDF 页面预览失败，请重试".to_string());
    }

    let (pixel_width, pixel_height) = match preview_dimensions(&temporary) {
        Ok(dimensions) => dimensions,
        Err(error) => {
            let _ = fs::remove_file(&temporary);
            log::warn!(
                "练习 PDF 页面预览无效 [stage=preview_validate code=invalid_png practiceSetId={} page={} renderer={}]",
                safe_identifier(practice_set_id.as_deref()),
                page_number,
                PREVIEW_RENDERER_VERSION
            );
            return Err(error);
        }
    };
    if output.is_file() {
        let _ = fs::remove_file(&temporary);
    } else if let Err(error) = fs::rename(&temporary, &output) {
        if output.is_file() {
            let _ = fs::remove_file(&temporary);
        } else {
            let _ = fs::remove_file(&temporary);
            return Err(format!("无法保存 PDF 预览缓存：{error}"));
        }
    }

    Ok(PracticePdfPagePreview {
        path: output.to_string_lossy().to_string(),
        pixel_width,
        pixel_height,
    })
}

#[tauri::command]
pub async fn render_practice_pdf_page(
    app: AppHandle,
    path: String,
    page_number: u32,
    practice_set_id: Option<String>,
) -> Result<PracticePdfPagePreview, String> {
    let helper = crate::commands::vision_helper_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        render_practice_pdf_page_blocking(helper, path, page_number, practice_set_id)
    })
    .await
    .map_err(|error| format!("PDF 页面预览任务异常结束：{error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_missing_non_pdf_and_zero_page_inputs() {
        assert!(validated_pdf("/tmp/not-a-practice.txt").is_err());
        assert!(validated_pdf("/tmp/missing-practice.pdf").is_err());
    }

    #[test]
    fn reads_real_png_dimensions_and_rejects_empty_results() {
        let directory = std::env::temp_dir().join(format!("axiom-preview-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).expect("preview test directory");
        let image_path = directory.join("preview.png");
        image::RgbImage::from_pixel(40, 60, image::Rgb([255, 255, 255]))
            .save(&image_path)
            .expect("preview fixture");
        assert_eq!(preview_dimensions(&image_path).unwrap(), (40, 60));
        fs::write(directory.join("empty.png"), []).expect("empty fixture");
        assert!(preview_dimensions(&directory.join("empty.png")).is_err());
        fs::remove_dir_all(directory).expect("preview cleanup");
    }

    #[test]
    fn diagnostic_identifiers_never_echo_arbitrary_content() {
        assert_eq!(safe_identifier(Some("practice-set_01")), "practice-set_01");
        assert_eq!(safe_identifier(Some("学生题目内容")), "invalid");
        assert_eq!(safe_identifier(None), "unknown");
    }

    #[test]
    fn vision_pdf_rasterization_does_not_use_appkit_thumbnail_controls() {
        let source = include_str!("../native/AxiomVision.swift");
        assert!(!source.contains("import AppKit"));
        assert!(!source.contains(".thumbnail("));
        assert!(!source.contains("NSImage"));
        assert!(!source.contains("NSBitmapImageRep"));
        assert!(source.contains("CGPDFDocument"));
        assert!(source.contains("CGContext("));
        assert!(source.contains("let rasterScale = min("));
        assert!(source.contains("context.scaleBy(x: rasterScale, y: rasterScale)"));
        assert_eq!(PREVIEW_RENDERER_VERSION, "coregraphics-v2");
    }

    #[cfg(unix)]
    #[test]
    fn renders_with_a_sidecar_then_reuses_the_valid_cache() {
        use std::os::unix::fs::PermissionsExt;

        let directory = std::env::temp_dir().join(format!("axiom-preview-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).expect("preview test directory");
        let pdf = directory.join("practice.pdf");
        fs::write(&pdf, b"fixture").expect("pdf fixture");
        let fixture = directory.join("fixture.png");
        image::RgbImage::from_pixel(80, 120, image::Rgb([255, 255, 255]))
            .save(&fixture)
            .expect("image fixture");
        let helper = directory.join("preview-helper.sh");
        fs::write(
            &helper,
            "#!/bin/sh\noutput=''\nwhile [ \"$#\" -gt 0 ]; do\n  case \"$1\" in\n    --output) output=\"$2\"; shift 2 ;;\n    *) shift ;;\n  esac\ndone\ncp \"$(dirname \"$0\")/fixture.png\" \"$output\"\n",
        )
        .expect("helper fixture");
        let mut permissions = fs::metadata(&helper).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&helper, permissions).unwrap();

        let first = render_practice_pdf_page_blocking(
            helper.clone(),
            pdf.to_string_lossy().to_string(),
            1,
            Some("practice-set-1".to_string()),
        )
        .expect("first render");
        assert_eq!((first.pixel_width, first.pixel_height), (80, 120));
        fs::remove_file(helper).expect("remove helper to prove cache reuse");
        let cached = render_practice_pdf_page_blocking(
            directory.join("missing-helper"),
            pdf.to_string_lossy().to_string(),
            1,
            Some("practice-set-1".to_string()),
        )
        .expect("cached render");
        assert_eq!(cached.path, first.path);
        assert_eq!((cached.pixel_width, cached.pixel_height), (80, 120));
        fs::remove_dir_all(directory).expect("preview cleanup");
    }
}
