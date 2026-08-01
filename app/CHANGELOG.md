# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格与 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added
- 现有文档：README 重写为生产就绪版本、新增 CONTRIBUTING 贡献指南。

### Changed
- （暂无）

### Removed
- （暂无）

## [0.4.1] - 2026-08-01

课程工作区重构版 Beta，保留现有教材解析、标签与批量更新能力。

### Added
- 课程页改为“知识结构 / 标签概览”双视图，支持科目与教材筛选。
- 增加教材导入任务、AI 教材信息确认、目录校正与后台恢复流程。
- 增加按教材隔离的知识树主从编辑布局，以及四维标签概览。
- 增加旧题标签更新的进度、暂停、继续和失败详情。
- 增加课程状态夹具与视觉验收截图。

### Changed
- 统一课程、标签和题目标签确认交互，移除内部架构术语。
- 新增非破坏性 SQLite 迁移 0017，记录教材导入任务与批量更新暂停状态。

## [0.1.0] - 2026-07-30

Phase 1 稳定性加固首版 Beta。对应稳定性 commit：`5efedb0`（数据库路径安全 + 媒体 GC）、`5e9e3b5`（生产日志 + Keychain 密钥存储）。详见 [docs/PHASE1_STABILITY_REPORT.md](./docs/PHASE1_STABILITY_REPORT.md)。

### Added
- **数据库路径一致性校验**：新增 `get_database_path` / `canonicalize_path` / `migrate_database` 命令；前端启动时校验 tauri-plugin-sql 与 Rust sqlx 路径一致性，不一致时弹出 `DatabaseLocationErrorDialog` 引导修复。
- **媒体垃圾回收**：新增 `list_media_directory` / `delete_media_file` Rust 命令，覆盖 `original` / `corrected` / `problems` / `diagrams` 四类目录；前端 `scanOrphanedMedia` / `deleteOrphanedMedia` 全量支持。
- **Keychain API Key 存储**：新增 `keystore.rs`（`store_api_key` / `load_api_key` / `delete_api_key`）与启动迁移 `migrate_api_keys_to_keychain`；Migration 0015 增加 `credential_ref` 列，迁移后清空 `api_key` 明文；Rust AI 命令改用 `credential_ref`，内部从 Keychain 直读，API Key 不经 IPC 回传前端。
- **AIJob 状态机文档**：补充 [docs/AIJOB_STATE_MACHINE.md](./docs/AIJOB_STATE_MACHINE.md)，记录 `not_started → pending → processing → completed/failed` 状态机与启动恢复机制。

### Changed
- **生产日志目录**：显式将日志目录设置为 `~/Library/Application Support/com.axiom.study/logs/`（`axiom.log`），与数据库目录对齐；release=Info、debug=Trace，stdout 仅 debug 输出。
- **SQLite release 日志策略**：release 构建关闭 `log_statements(Trace)`，避免 SQL 序列化开销与日志膨胀；debug 仍保留 Trace 便于排查。详见 [docs/SQLITE_PERFORMANCE.md](./docs/SQLITE_PERFORMANCE.md)。

### Fixed
- 修复 tauri-plugin-sql 与 Rust sqlx 解析到不同物理文件导致数据「丢失」假象的问题。
- 修复 release 构建仍开启 SQL Trace 日志导致的性能与体积问题。

### Known Limitations
- 仅 arm64（vision sidecar 仅提供 `aarch64-apple-darwin`）。
- 当前构建为 ad-hoc 签名、未公证：用户首次打开会遇到 Gatekeeper 拦截，需右键「打开」或 `xattr -dr com.apple.quarantine` 解除。
- CSP 暂未收紧（`csp: null`）。
- 真实用户 Acceptance Test 待 Phase 2 执行。

[Unreleased]: https://github.com/axiom/axiom/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/axiom/axiom/releases/tag/v0.1.0
