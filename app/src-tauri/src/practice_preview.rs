use serde::Serialize;
use std::{fs, path::PathBuf, process::Command};
use tauri::AppHandle;

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

#[tauri::command]
pub fn render_practice_pdf_page(
    app: AppHandle,
    path: String,
    page_number: u32,
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
    let output = directory.join(format!("{stem}-page-{page_number}-1440.png"));
    if !output.is_file() {
        let result = Command::new(crate::commands::vision_helper_path(&app)?)
            .args([
                "render-pdf-page",
                "--input",
                pdf.to_string_lossy().as_ref(),
                "--output",
                output.to_string_lossy().as_ref(),
                "--page",
                &page_number.to_string(),
                "--width",
                "1440",
            ])
            .output()
            .map_err(|error| format!("无法启动 PDF 预览器：{error}"))?;
        if !result.status.success() {
            return Err(format!(
                "PDF 页面预览失败：{}",
                String::from_utf8_lossy(&result.stderr).trim()
            ));
        }
    }
    Ok(PracticePdfPagePreview {
        path: output.to_string_lossy().to_string(),
        pixel_width: 1440,
        pixel_height: 2036,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_missing_non_pdf_and_zero_page_inputs() {
        assert!(validated_pdf("/tmp/not-a-practice.txt").is_err());
        assert!(validated_pdf("/tmp/missing-practice.pdf").is_err());
    }
}
