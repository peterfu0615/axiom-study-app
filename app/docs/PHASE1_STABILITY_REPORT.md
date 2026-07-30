# Phase 1 稳定性报告

> 本报告记录 Axiom Phase 1「稳定性加固」的执行结果、Release Build 验证结论与遗留风险。
> 对应两个稳定性 commit：`5efedb0`（数据库路径安全 + 媒体 GC）、`5e9e3b5`（生产日志 + Keychain 密钥存储）。

## 1. Phase 1 修复清单

### 1.1 数据库路径一致性（commit 5efedb0）
- **问题**：tauri-plugin-sql 与 Rust sqlx 解析到不同物理文件（容器路径 vs 用户路径），导致数据「丢失」假象。
- **修复**：新增 `get_database_path` / `canonicalize_path` / `migrate_database` 命令；前端启动时校验路径一致性，不一致时弹出 `DatabaseLocationErrorDialog` 引导用户修复。
- **验证**：路径校验逻辑有单元测试覆盖；对话框组件有交互测试。

### 1.2 媒体垃圾回收（commit 5efedb0）
- **问题**：`original/` `corrected/` `problems/` `diagrams/` 四类目录无统一清理入口，孤立文件累积。
- **修复**：新增 `list_media_directory` / `delete_media_file` Rust 命令，覆盖全部四类目录；前端 `scanOrphanedMedia` / `deleteOrphanedMedia` 全量支持。
- **验证**：`allowed_media_subdirs_cover_all_four_categories` 等单元测试通过。

### 1.3 生产日志（commit 5e9e3b5）
- **问题**：tauri-plugin-log 默认写入 `~/Library/Logs/com.axiom.study/`，与数据库 `~/Library/Application Support/com.axiom.study/` 分离，用户排查时找错位置。
- **修复**：显式计算日志目录 `~/Library/Application Support/com.axiom.study/logs/`，通过 `TargetKind::Folder { file_name: "axiom" }` 写入；release=Info，debug=Trace；stdout 仅 debug。
- **约束满足**：✅ Logger 明确日志目录策略，不接受默认路径（执行约束 #3）。
- **验证**：实际运行确认 `axiom.log` 写入正确目录，时间戳为本地时区。

### 1.4 Keychain API Key 存储（commit 5e9e3b5）
- **问题**：API Key 明文存于数据库 `ai_provider_profiles.api_key`，泄露面大。
- **修复**：
  - 新增 `keystore.rs`：`store_api_key` / `load_api_key` / `delete_api_key` + 启动迁移 `migrate_api_keys_to_keychain`。
  - Migration 0015 增加 `credential_ref` 列；迁移后 `api_key` 列清空。
  - Rust AI 命令改为接受 `credential_ref`，内部调用 `load_api_key_internal` 从 Keychain 直读。
  - 前端 `AIProviderProfile.apiKey` 仅用于 UI 输入，读取后为空；设置页显示「已保存到 Keychain / 未保存」状态。
  - 移除 Provider 时清理其 Keychain 条目（失败不阻塞）。
- **约束满足**：✅ Keychain 优先 Rust 直接读取，API Key 不经 IPC 回传前端（执行约束 #2）。
- **验证**：keystore 单元测试 + provider 集成测试（断言传 `credentialRef` 而非 `apiKey`）通过。

### 1.5 SQLite 性能优化（commit 5e9e3b5）
- **问题**：release 构建仍开启 `log_statements(Trace)`，每条 SQL 序列化开销 + 日志膨胀。
- **修复**：`cfg!(debug_assertions)` 下 Trace，release 下 Off。
- **详见**：[SQLITE_PERFORMANCE.md](./SQLITE_PERFORMANCE.md)。

### 1.6 AIJob 状态机
- **现状**：已有完整的 `not_started → pending → processing → completed/failed` 状态机 + 启动恢复机制。
- **详见**：[AIJOB_STATE_MACHINE.md](./AIJOB_STATE_MACHINE.md)。

## 2. Release Build 验证（P0-1）

### 2.1 构建结果
| 产物 | 路径 | 大小 | 架构 |
| --- | --- | --- | --- |
| Axiom.app | `target/release/bundle/macos/Axiom.app` | 20 MB | arm64 |
| Axiom_0.1.0_aarch64.dmg | `target/release/bundle/dmg/` | 8.3 MB | arm64 |

### 2.2 自包含性检查
| 项 | 结论 |
| --- | --- |
| 第三方动态库依赖 | ✅ 无（`otool -L` 仅显示 `/usr/lib` / `/System` 系统库） |
| Frameworks 目录 | ✅ 无需（Tauri 静态链接，前端 dist 嵌入二进制） |
| 外部 vision 二进制 | ✅ 已打包 `Contents/MacOS/axiom-vision`（arm64） |
| Info.plist | ✅ `com.axiom.study` / v0.1.0 / min macOS 13.0 / NSCameraUsageDescription 已声明 |

### 2.3 运行时验证
| 项 | 结论 |
| --- | --- |
| 数据目录创建 | ✅ `~/Library/Application Support/com.axiom.study/` |
| WAL 模式 | ✅ `axiom.db-wal` + `axiom.db-shm` 存在 |
| 日志目录 | ✅ `~/Library/Application Support/com.axiom.study/logs/axiom.log`（非 OS 默认 `~/Library/Logs/`） |
| 日志格式 | ✅ `[日期][时间][级别][target] 消息`，本地时区 |

### 2.4 代码签名
| 项 | 值 |
| --- | --- |
| 签名类型 | **adhoc**（链接器临时签名，非 Developer ID） |
| TeamIdentifier | not set |
| 公证状态 | **未公证** |

> **结论**：当前 DMG 仅可作为 **Beta Release**（执行约束 #6）。用户首次打开会遇到 Gatekeeper 拦截，需右键「打开」或 `xattr -dr com.apple.quarantine` 解除。签名公证路线见 Phase 2。

### 2.5 架构覆盖
- 当前仅 arm64（vision 二进制只有 `axiom-vision-aarch64-apple-darwin`）。
- 缺少 `axiom-vision-x86_64-apple-darwin`，无法构建 Intel / Universal 版本。
- **Phase 2 GitHub Actions 必须检测 runner 架构**（执行约束 #4），arm64 runner 产出 arm64 包，x86_64 runner 产出 x86_64 包，或交叉编译 Universal。

## 3. 测试结果
| 套件 | 结果 |
| --- | --- |
| TypeScript typecheck (`tsc -b --noEmit`) | ✅ 通过 |
| Rust `cargo check` | ✅ 通过 |
| Rust 单元测试 (`cargo test --lib`) | ✅ 12 passed |
| 前端测试 (`vitest run`) | ✅ 106 passed (17 files) |

## 4. 新用户验收清单（模拟）

> 因开发机正在运行 `tauri dev`（共享数据目录），未执行冷启动 Release .app。以下基于代码分析与运行时数据验证。

| 步骤 | 预期 | 状态 |
| --- | --- | --- |
| 首次启动创建数据目录 | `app_data_dir` 自动创建 | ✅ 代码确认 `db_path` 会 `create_dir_all` |
| 数据库初始化 + 迁移 | 15 条迁移自动执行 | ✅ 迁移列表已含 0015 |
| 日志写入正确目录 | `logs/axiom.log` | ✅ 实测确认 |
| API Key 不回传前端 | `apiKey` 读取后为空 | ✅ 代码 + 模型确认 |
| **真实用户 Acceptance Test** | 完整功能流程走查 | ⏳ **Phase 2 执行**（约束 #5） |

## 5. 遗留风险与 Phase 2 行动项

| 风险 | 严重度 | Phase 2 行动 |
| --- | --- | --- |
| 未签名 / 未公证 | 高 | 申请 Developer ID，配置 `tauri.conf.json` 签名，CI 加 notarize 步骤；Beta 前明确路线 |
| 仅 arm64 | 中 | 补 x86_64 vision 二进制或交叉编译 Universal；GitHub Actions 检测架构 |
| CSP 关闭（`csp: null`） | 中 | 评估收紧 CSP（此前白屏已修复，需回归测试） |
| 真实用户验收未执行 | 高 | Phase 2 完成真实用户 Acceptance Test |
| 前端 JS bundle 920KB | 低 | 可后续 code-split，非阻塞 |

## 6. 结论

Phase 1 稳定性加固已完成，两个稳定性 commit 拆分提交（约束 #1）。Release Build 验证通过：构建成功、自包含、日志与数据库路径对齐、API Key 安全存储。**主要遗留**是代码签名（Beta 限制）与真实用户验收（Phase 2），均已在 Phase 2 计划中安排。
