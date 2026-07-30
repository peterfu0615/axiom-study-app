#!/usr/bin/env python3
"""将文件夹中的所有文件、文件结构和 git commit 记录合并保存到 1-5 个文件中。

用法:
    python3 export_snapshot.py [目标文件夹] [输出目录] [--format txt|md] [--max-files N]

默认:
    目标文件夹 = 当前目录
    输出目录   = ./snapshot_output
    格式       = md
    最大文件数 = 5
"""

import argparse
import os
import subprocess
import sys
from pathlib import Path

# 跳过这些目录与文件扩展名（二进制 / 依赖 / 缓存）
SKIP_DIRS = {
    ".git", "node_modules", ".venv", "venv", "__pycache__",
    ".next", ".nuxt", "dist", "build", "target", ".idea", ".vscode",
}
SKIP_EXTS = {
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".icns", ".svg",
    ".mp3", ".mp4", ".wav", ".avi", ".mov",
    ".zip", ".tar", ".gz", ".rar", ".7z",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx",
    ".exe", ".dll", ".so", ".dylib", ".class", ".o", ".a",
    ".lock", ".bin", ".dat", ".db", ".sqlite",
}
MAX_FILE_SIZE = 2 * 1024 * 1024  # 单个源文件超过 2MB 则跳过内容、仅记录路径
CHUNK_TARGET_SIZE = 800 * 1024   # 每个输出文件目标大小 ~800KB


def is_text_file(path: Path) -> bool:
    if path.suffix.lower() in SKIP_EXTS:
        return False
    try:
        with path.open("rb") as f:
            chunk = f.read(4096)
        if b"\x00" in chunk:
            return False
        chunk.decode("utf-8")
        return True
    except (UnicodeDecodeError, OSError):
        return False


def build_tree(root: Path) -> str:
    """生成简洁的目录树。"""
    lines = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
        rel = os.path.relpath(dirpath, root)
        depth = 0 if rel == "." else rel.count(os.sep) + 1
        indent = "  " * depth
        if rel != ".":
            lines.append(f"{indent}{os.path.basename(dirpath)}/")
        for name in sorted(filenames):
            lines.append(f"{indent}  {name}")
    return "\n".join(lines)


def collect_file_contents(root: Path):
    """返回 [(相对路径, 内容)] 列表。"""
    items = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
        for name in sorted(filenames):
            full = Path(dirpath) / name
            rel = full.relative_to(root).as_posix()
            try:
                size = full.stat().st_size
            except OSError:
                continue
            if size > MAX_FILE_SIZE:
                items.append((rel, f"[文件过大 ({size} bytes)，已跳过内容]"))
                continue
            if not is_text_file(full):
                items.append((rel, "[二进制文件，已跳过内容]"))
                continue
            try:
                content = full.read_text(encoding="utf-8", errors="replace")
                items.append((rel, content))
            except OSError as e:
                items.append((rel, f"[读取失败: {e}]"))
    return items


def get_git_log(root: Path, limit: int = 500) -> str:
    """获取 git commit 记录，失败则返回提示。"""
    try:
        result = subprocess.run(
            ["git", "-C", str(root), "log",
             f"-n{limit}", "--date=iso",
             "--pretty=format:%H|%h|%an|%ad|%s"],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode != 0:
            return f"[git log 失败: {result.stderr.strip()}]"
        lines = result.stdout.splitlines()
        if not lines:
            return "[无 git commit 记录]"
        rows = ["| Commit | Author | Date | Subject |", "|---|---|---|---|"]
        for line in lines:
            parts = line.split("|", 4)
            if len(parts) != 5:
                continue
            full_h, short_h, author, date, subject = parts
            rows.append(f"| `{short_h}` | {author} | {date} | {subject} |")
        return "\n".join(rows)
    except (subprocess.SubprocessError, FileNotFoundError) as e:
        return f"[git 不可用: {e}]"


def get_git_status(root: Path) -> str:
    try:
        result = subprocess.run(
            ["git", "-C", str(root), "status", "--short"],
            capture_output=True, text=True, timeout=15,
        )
        if result.returncode != 0:
            return f"[git status 失败: {result.stderr.strip()}]"
        return result.stdout.strip() or "[工作区干净]"
    except (subprocess.SubprocessError, FileNotFoundError) as e:
        return f"[git 不可用: {e}]"


def render_header(root: Path, fmt: str) -> str:
    if fmt == "md":
        return (
            f"# 项目快照: {root.name}\n\n"
            f"- 导出路径: `{root}`\n"
            f"- 生成时间: 由脚本自动生成\n\n"
        )
    return (
        f"项目快照: {root.name}\n"
        f"导出路径: {root}\n"
        f"{'=' * 60}\n\n"
    )


def render_section(title: str, body: str, fmt: str) -> str:
    if fmt == "md":
        return f"\n## {title}\n\n```\n{body}\n```\n"
    return f"\n{'=' * 60}\n{title}\n{'=' * 60}\n{body}\n"


def render_file_block(rel: str, content: str, fmt: str) -> str:
    # 根据扩展名猜语言标签
    ext_map = {
        ".py": "python", ".js": "javascript", ".ts": "typescript",
        ".tsx": "tsx", ".jsx": "jsx", ".rs": "rust", ".go": "go",
        ".java": "java", ".c": "c", ".cpp": "cpp", ".h": "c",
        ".md": "markdown", ".json": "json", ".yaml": "yaml", ".yml": "yaml",
        ".html": "html", ".css": "css", ".scss": "scss", ".sh": "bash",
        ".sql": "sql", ".swift": "swift", ".kt": "kotlin",
    }
    if fmt == "md":
        lang = ext_map.get(Path(rel).suffix.lower(), "")
        return f"\n### `{rel}`\n\n```{lang}\n{content}\n```\n"
    return (
        f"\n--- FILE: {rel} ---\n"
        f"{content}\n"
        f"--- END: {rel} ---\n"
    )


def split_into_chunks(blocks, header, max_files: int):
    """按目标大小把内容块切成最多 max_files 个分片。"""
    chunks = []
    current = [header]
    current_size = len(header)
    for block in blocks:
        bsize = len(block)
        if (current_size + bsize > CHUNK_TARGET_SIZE
                and len(current) > 1
                and len(chunks) + 1 < max_files):
            chunks.append(current)
            current = [header]
            current_size = len(header)
        current.append(block)
        current_size += bsize
    chunks.append(current)
    return chunks


def main():
    parser = argparse.ArgumentParser(description="导出项目快照")
    parser.add_argument("target", nargs="?", default=".",
                        help="目标文件夹 (默认当前目录)")
    parser.add_argument("output", nargs="?", default="./snapshot_output",
                        help="输出目录 (默认 ./snapshot_output)")
    parser.add_argument("--format", choices=["txt", "md"], default="md",
                        help="导出格式 (默认 md)")
    parser.add_argument("--max-files", type=int, default=5,
                        help="最大输出文件数 (默认 5，限制 1-5)")
    args = parser.parse_args()

    if not (1 <= args.max_files <= 5):
        sys.exit("--max-files 必须在 1-5 之间")

    root = Path(args.target).resolve()
    if not root.is_dir():
        sys.exit(f"目标不是目录: {root}")

    out_dir = Path(args.output).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"[1/4] 扫描目录: {root}")
    tree = build_tree(root)
    files = collect_file_contents(root)
    print(f"      收集到 {len(files)} 个文件")

    print(f"[2/4] 读取 git 记录")
    git_log = get_git_log(root)
    git_status = get_git_status(root)

    print(f"[3/4] 拼装内容并分片")
    ext = "md" if args.format == "md" else "txt"
    header = render_header(root, args.format)
    sections = [
        render_section("目录结构", tree, args.format),
        render_section("Git 提交记录", git_log, args.format),
        render_section("Git 当前状态", git_status, args.format),
        render_section("文件内容", "", args.format),
    ]
    blocks = [render_file_block(rel, content, args.format)
              for rel, content in files]

    chunks = split_into_chunks(blocks, header + "\n".join(sections),
                               args.max_files)

    print(f"[4/4] 写出 {len(chunks)} 个文件到 {out_dir}")
    total = len(chunks)
    for i, chunk in enumerate(chunks, 1):
        suffix = f"_part{i}of{total}" if total > 1 else ""
        out_path = out_dir / f"snapshot{suffix}.{ext}"
        prefix = f"> 分片 {i}/{total}\n\n" if total > 1 and args.format == "md" \
            else f"分片 {i}/{total}\n{'=' * 60}\n\n" if total > 1 else ""
        out_path.write_text(prefix + "\n".join(chunk), encoding="utf-8")
        size_kb = out_path.stat().st_size / 1024
        print(f"      → {out_path.name}  ({size_kb:.1f} KB)")

    print("完成。")


if __name__ == "__main__":
    main()
