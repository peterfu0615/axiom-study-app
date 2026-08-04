# Axiom

Axiom 是一款 macOS 桌面应用，用于智能整理与复习学生错题（错题本）。基于 Tauri 2、React 19、TypeScript、Rust 和 SQLite 构建，集成 Apple Vision OCR、Core Image 透视矫正与多 AI 服务商智能分析。

- Bundle ID：`com.axiom.study`
- 当前版本：0.4.5（Beta）
- 架构：仅 Apple Silicon（arm64）

## 截图

UI 截图位于 `app/docs/screenshots/`，包括题目库主界面、Antigravity 服务商设置等。

## 功能

- 摄像头采集与图片导入（SHA-256 去重）
- 文档扫描：Apple Vision 边界检测 + Core Image 透视矫正，保留色彩 / 文档灰度两种优化模式
- 本地中英文 OCR、题号 / 分栏 / 留白版面分析、自动题目块切分
- 题目块编辑：拖动、四角缩放、重命名、拆分、合并、增删
- AI 智能分析：题目解析、解题方案生成、学生作答提取、推理分析、讲法选择
- 多 AI 服务商：Mock、OpenAI 兼容（vision LLM）、Antigravity CLI（Gemini），支持拖拽排序
- 暗色模式、KaTeX 数学公式渲染
- 媒体垃圾回收（original / corrected / problems / diagrams 四类目录）
- AIJob 状态机与启动恢复
- API Key 持久化于本地 SQLite（不回传前端，日志不落密钥）

## 环境要求

- macOS 13.0 或更高（Apple Silicon）
- Node.js 22 或更高
- Rust stable（最低 1.77.2，edition 2021）
- 完整 Xcode（Vision/Core Image 原生 sidecar 编译需要）

## 快速开始

```sh
cd app
npm install
npm run tauri dev
```

首次启动 Vision OCR 时，macOS 可能需要加载本地识别模型，首张图片处理会略慢。

## 构建

```sh
cd app
npm run tauri -- build
```

产物位于 `app/src-tauri/target/release/bundle/`：
- `macos/Axiom.app`
- `dmg/Axiom_0.4.5_aarch64.dmg`

## 测试与检查

```sh
# 前端
cd app
npm run lint          # oxlint
npm run typecheck     # tsc -b --noEmit
npm test              # vitest run

# Rust
cd app/src-tauri
cargo check
cargo clippy -- -D warnings
cargo test --lib
```

一键全量检查：`cd app && npm run check`（lint + test + build）。

## 项目结构

```text
app/
  src/
    ai/              AI 流水线、Schema 与解析器
    components/      应用外壳与共用组件
    domain/          与框架无关的领域类型
    features/        按产品模块组织的界面与用例（capture / library / settings）
    platform/        相机、Tauri 命令、SQLite 适配器
  src-tauri/
    native/          Apple Vision / Core Image Swift 处理器（编译为 sidecar）
    binaries/        构建时生成的 sidecar 二进制
    migrations/      追加式 SQLite 迁移（0001–0025）
    src/             Rust 命令、数据库、AI 编排、自动更新
    Info.plist        macOS 隐私声明（NSCameraUsageDescription）
    Entitlements.plist
  docs/              架构与设计文档（见下）
```

## 数据目录

应用运行时数据存放于：

```text
~/Library/Application Support/com.axiom.study/
  axiom.db          SQLite 主库（WAL 模式，单连接 Mutex）
  axiom.db-wal
  axiom.db-shm
  logs/axiom.log    本地时区日志
  media/
    original/        原图
    corrected/       透视矫正后页面
    problems/        题目块截图
    diagrams/        提取的图示
```

API Key 持久化于本地 SQLite `ai_provider_profiles.api_key` 列，仅在 Rust 端内部使用，不回传前端、日志不落密钥；Keychain 只用于旧版本数据的一次性恢复。

## 文档索引

详细设计、架构与运维文档位于 `app/docs/`：

| 文档 | 内容 |
| --- | --- |
| [ARCHITECTURE.md](./docs/ARCHITECTURE.md) | 架构决策与模块边界 |
| [AIJOB_STATE_MACHINE.md](./docs/AIJOB_STATE_MACHINE.md) | AIJob 状态机与启动恢复 |
| [SQLITE_PERFORMANCE.md](./docs/SQLITE_PERFORMANCE.md) | SQLite 性能优化与 release 日志策略 |
| [PHASE1_STABILITY_REPORT.md](./docs/PHASE1_STABILITY_REPORT.md) | Phase 1 稳定性加固与 Release Build 验证 |
| [AI_PROMPT_V4.md](./docs/AI_PROMPT_V4.md) | AI Prompt v4 规范 |
| [ANTIGRAVITY_PROVIDER.md](./docs/ANTIGRAVITY_PROVIDER.md) | Antigravity CLI（Gemini）服务商接入 |
| [DIAGRAM_EXTRACTION.md](./docs/DIAGRAM_EXTRACTION.md) | 题目图示提取 |
| [CONTRIBUTING.md](./docs/CONTRIBUTING.md) | 贡献指南 |

CI 配置见仓库根目录 `.github/workflows/`（`ci.yml` 与 `release.yml`）。产品范围与验收口径见仓库根目录的 `PRD.md`。

## License

UNLICENSED / 私有项目。未授权使用、复制或分发均被禁止。
