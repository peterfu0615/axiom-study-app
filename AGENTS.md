# AGENTS.md

> 本文档为 AI Agent / 新接手开发者提供项目背景、架构概览、协作规范与发布流程。
> 最后更新：2026-07-30，对应版本 v0.1.1。

---

## 1. 项目背景

**Axiom** 是一款面向中文 K12 学生的智能错题整理工作台，运行于 macOS（Apple Silicon 优先）。

- **技术栈**：Tauri 2.x（Rust 2021 后端）+ React 19 + TypeScript + Vite
- **数据存储**：本机 SQLite（WAL 模式），媒体文件保存在 `app_data_dir`
- **AI 处理**：双通道 — OpenAI Compatible API + Antigravity CLI
- **目标用户**：中学生 / 家教 / 教师，单机使用，无服务端依赖
- **当前阶段**：Beta（未签名 / 未公证），通过 GitHub Release 分发

### 核心功能模块

| 模块 | 描述 |
| --- | --- |
| 拍照采集 | 截屏 / 文件导入，自动校正旋转，裁剪题目区域 |
| 题库管理 | 候选题 / 已保存题 / 已归档，支持拖拽排序、标签、检索 |
| AI 解题 | 调用 OpenAI Compatible 视觉模型分析题目，生成结构化解答 |
| 解答引擎 | 步骤化解答、关键方法、公式、知识点标注 |
| 设置 | AI Provider 配置、外观主题、关于、自动更新 |

### 仓库结构

```
Axiom/
├── app/                          # 应用主目录
│   ├── src/                      # 前端源码（React + TypeScript）
│   │   ├── ai/                   # AI Provider 抽象层
│   │   ├── components/           # 通用组件（Toast, Sidebar 等）
│   │   ├── domain/               # 领域模型与类型
│   │   ├── features/             # 功能模块（capture, library, settings）
│   │   ├── platform/             # 平台适配层（native, database, theme）
│   │   └── App.tsx               # 应用根组件
│   ├── src-tauri/                # Rust 后端
│   │   ├── src/
│   │   │   ├── ai.rs             # AI 请求处理（OpenAI Compatible / CLI）
│   │   │   ├── commands.rs       # 媒体管理、数据库命令
│   │   │   ├── db.rs             # SQLite 连接与初始化
│   │   │   ├── keystore.rs       # macOS Keychain API Key 存储
│   │   │   ├── updater.rs        # 自动更新模块（GitHub Release 检查/下载/替换）
│   │   │   ├── lib.rs            # 应用入口与插件注册
│   │   │   └── models.rs         # 数据模型
│   │   ├── migrations/           # SQLite 迁移脚本（0001-0015）
│   │   ├── Cargo.toml            # Rust 依赖
│   │   └── tauri.conf.json        # Tauri 配置
│   ├── scripts/
│   │   ├── bump-version.mjs      # 版本号同步脚本
│   │   └── generate-problem-analysis-validator.mjs
│   └── docs/                     # 项目文档
│       ├── PHASE1_STABILITY_REPORT.md
│       ├── PHASE2_DELIVERY_REPORT.md
│       ├── RELEASE_CHECKLIST.md
│       ├── ACCEPTANCE_TEST.md
│       ├── CHANGELOG.md
│       ├── CONTRIBUTING.md
│       ├── AIJOB_STATE_MACHINE.md
│       └── SQLITE_PERFORMANCE.md
├── .github/workflows/
│   ├── ci.yml                    # CI：lint + typecheck + test
│   └── release.yml               # Release：构建 + 打包 + 发布
└── AGENTS.md                     # 本文件
```

---

## 2. 已完成的更改总结

### Phase 1：稳定性加固（v0.1.0 → v0.1.1）

| Commit | 类型 | 内容 |
| --- | --- | --- |
| `5efedb0` | fix | 数据库路径一致性校验 + 媒体垃圾回收覆盖全目录 |
| `5e9e3b5` | fix | 生产日志（显式日志目录）+ Keychain API Key 存储 |

**关键修复**：
- **数据库路径**：`tauri-plugin-sql` 与 Rust `sqlx` 可能解析到不同物理文件，导致数据「丢失」假象。新增 `migrate_database` / `canonicalize_path` 命令 + `DatabaseLocationErrorDialog` 启动校验。
- **API Key 安全**：API Key 不再明文存于数据库，改用 macOS Keychain（`keyring` crate）。数据库仅存 `credential_ref`。AI 请求由 Rust 内部直接从 Keychain 读取，不回传前端。
- **日志目录**：显式设为 `~/Library/Application Support/com.axiom.study/logs/axiom.log`，避免 `tauri-plugin-log` 默认 `~/Library/Logs/` 与 app data 不一致。
- **SQLite 性能**：Release 构建关闭 SQL Trace 日志，避免每条 SQL 序列化开销。

### Phase 2：产品化与分发（v0.1.1）

| Commit | 类型 | 内容 |
| --- | --- | --- |
| `ee7c19c` | chore | 根级 `.gitignore` + 移除 `.DS_Store` 跟踪 |
| `569350e` | ci | GitHub Actions CI/CD（含 arm64 检测） |
| `a7f0c6a` | chore | 版本同步脚本 + 发布清单 + Beta Release 路线 |
| `d11aacc` | docs | CHANGELOG + CONTRIBUTING + ACCEPTANCE_TEST |
| `b6da763` | docs | README 重写 |
| `27f3e57` | style | cargo fmt 格式统一 |
| `0387d3a` | docs | Phase 2 交付报告 |

### 自动更新功能（v0.1.1）

| Commit | 类型 | 内容 |
| --- | --- | --- |
| `6053b55` | feat | 自动更新模块：GitHub Release 检查/下载/替换/重启 |
| `e85bd98` | fix | 修复 `option_env!` 参数名 + URL 反引号 |
| `1621ffc` | chore | bump version to 0.1.1 |
| (待提交) | fix | 修复 `UpdateInfo` 序列化字段名 + 命令参数 `rename_all = "camelCase"` |

**自动更新架构**：
- **Rust 端**（`updater.rs`）：调用 GitHub API `/repos/{owner}/axiom-update-pusher/releases/latest`，比较版本号，流式下载 `.app.zip`（带进度事件），校验 SHA256，`unzip` 解压，生成 detached bash 脚本（等待进程退出 → 替换 `.app` → 移除 quarantine → 重启），退出当前进程。
- **前端**：启动后台静默检查 + Toast 提示；设置页「更新」Tab 显示当前版本、最新版本、发布日期、下载大小、更新日志（Markdown 渲染）、检查更新按钮、下载进度条、立即更新并重启按钮。
- **更新源**：`peterfu0615/axiom-update-pusher` 仓库（PUBLIC），Release 资产命名 `Axiom_{version}_{arch}.app.zip` + `.sha256`。
- **编译时配置**：`UPDATE_REPO_OWNER` 环境变量覆盖默认 owner。

---

## 3. 最新版本功能描述（v0.1.1）

### 新增功能

1. **自动更新**
   - 启动时静默检查 GitHub Release，有更新时 Toast 提示
   - 设置 → 更新 Tab：版本号、更新日志、下载进度条、一键更新重启
   - SHA256 完整性校验
   - detached 脚本替换 `.app` + 移除 quarantine + 自动重启

2. **Keychain API Key 存储**
   - API Key 存入 macOS Keychain，数据库仅存 `credential_ref`
   - 启动时自动迁移已有明文 Key
   - AI 请求由 Rust 内部读取，不回传前端

3. **生产日志**
   - 显式日志目录：`~/Library/Application Support/com.axiom.study/logs/`
   - Release 构建关闭 SQL Trace 日志
   - 日志轮转：`KeepAll`，单文件 5MB

4. **数据库路径一致性校验**
   - 启动时检查 `tauri-plugin-sql` 与 Rust `sqlx` 路径是否一致
   - 不一致时显示 `DatabaseLocationErrorDialog`，阻止操作

5. **媒体垃圾回收**
   - 覆盖 `original` / `corrected` / `problems` / `diagrams` 四类目录
   - `list_media_directory` + `delete_media_file` Rust 命令

6. **GitHub Actions CI/CD**
   - CI：lint + typecheck + test
   - Release：arm64 架构检测、构建、打包、可选签名、GitHub Release 创建
   - 自动生成 `.sha256` 校验文件

7. **版本管理**
   - `bump-version.mjs` 脚本同步 `package.json` / `Cargo.toml` / `tauri.conf.json`
   - 语义版本号（SemVer）

### 已知限制

- 仅 arm64（Apple Silicon）
- 未签名 / 未公证：首次打开需右键「打开」或 `xattr -dr com.apple.quarantine`
- 自动更新无签名校验（仅 SHA256 完整性），存在 MITM 风险（与 Keychain 安全加固方向相反，建议后续迁移到 Tauri Updater 插件）

---

## 4. Git Commit 规范

### 格式

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Type

| Type | 描述 |
| --- | --- |
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `docs` | 文档变更 |
| `style` | 代码格式（不影响功能） |
| `refactor` | 重构（既不是 feat 也不是 fix） |
| `perf` | 性能优化 |
| `test` | 测试相关 |
| `chore` | 构建 / 工具 / 依赖变更 |
| `ci` | CI/CD 配置变更 |

### Scope（可选）

模块名称，如：`updater` / `keystore` / `database` / `ai` / `ui` / `release`。

### 规则

1. **subject** 用中文或英文均可，但同一项目内保持一致。不超过 50 字符，结尾不加句号。
2. **body** 说明「为什么」而非「做了什么」（代码已说明做了什么）。每行不超过 72 字符。
3. **footer** 用于引用 Issue、标注 BREAKING CHANGE。
4. 一个 commit 只做一件事。不要把不相关的改动放在同一个 commit。
5. Phase 级别的重大变更至少拆为 2 个稳定性 commit，不要一次性提交全部修改。

### AI 任务完成后的提交规则

凡是 AI 为用户完成了会修改仓库文件的任务，且任务已经完成并通过与风险相称的验证，AI 必须在结束本次任务前创建本地 `git commit`。纯阅读、分析、答疑或没有文件变更的任务不需要提交；用户明确要求暂不提交、只查看 diff 或等待人工审查时，遵循用户要求。

每次提交必须遵循以下流程：

1. 开始任务前先查看 `git status --short`，识别工作区中已有的用户改动；已有改动属于用户，不能默认纳入本次提交。
2. 只修改和暂存本次任务范围内的文件或代码块。禁止使用 `git add .`、`git add -A` 等方式把整个工作区一并加入；同一文件同时包含既有改动时，必须使用分块暂存，无法安全区分时先停止并请求用户处理。
3. 在提交前执行适合本次改动的检查。代码改动至少运行相关 lint、typecheck、test 或构建；文档、配置和脚本改动至少检查 `git diff --check`，并视风险运行对应验证。
4. 提交前检查 `git diff --cached`，确认没有密钥、个人数据、构建产物、临时文件、无关改动或错误的版本号。
5. 一个独立任务默认生成一个 commit；如果任务包含彼此独立且需要分别回滚的功能，应拆成多个逻辑 commit。提交信息必须遵循本节 Conventional Commit 格式，并说明变更原因。
6. 提交成功后，在最终回复中报告 commit hash、提交主题、主要文件和验证结果。提交失败时不得声称已提交，应保留改动并明确失败原因。

以下情况不自动扩大权限或操作范围：

- AI 只创建本地提交，不默认 push、创建 tag、创建 Release、修改远端分支或发起 PR；这些操作必须由用户明确要求。
- 不得为了完成提交而使用 `git reset --hard`、`git checkout --`、删除用户文件、改写既有 commit、rebase 或 force push。
- 如果检查失败是由本次改动引起的，应先修复；如果确认是独立的既有问题，可以提交本次已完成的改动，但必须在最终回复中记录该验证失败。
- 未完成、被外部依赖阻塞或等待用户决定的任务，不得伪装成已完成提交；只有用户明确要求保存工作进度时，才允许创建带有明确 `wip` 标识的临时提交。

### 示例

```
feat(updater): add auto-update from GitHub releases

实现自定义 GitHub 下载替换式自动更新：
- Rust: check_for_updates / download_and_install_update
- 前端: UpdateSettings Tab + 启动静默检查 + Toast
- CI: release.yml 生成 .sha256 校验文件
```

```
fix(updater): correct env var name in option_env

option_env! 参数应为环境变量名 "UPDATE_REPO_OWNER"，而非 owner 值本身。
```

---

## 5. Release 规范

### 发布前检查清单

参照 [app/docs/RELEASE_CHECKLIST.md](app/docs/RELEASE_CHECKLIST.md)。关键步骤：

1. **代码质量**
   - `cd app && npm run lint`（oxlint，0 errors）
   - `cd app && npm run typecheck`（tsc，通过）
   - `cd app && npm test`（vitest，全部通过）
   - `cd app/src-tauri && cargo clippy -- -D warnings`（0 warnings）
   - `cd app/src-tauri && cargo fmt -- --check`（无 diff）

2. **构建验证**
   - `cd app && npm run tauri -- build`
   - 确认产出：`Axiom.app` + `Axiom_{version}_{arch}.dmg`

3. **Acceptance Test**
   - 按 [app/docs/ACCEPTANCE_TEST.md](app/docs/ACCEPTANCE_TEST.md) 执行
   - 真实用户签字确认

4. **更新源准备**（如需发布自动更新）
   - 确认 `axiom-update-pusher` 仓库可访问（PUBLIC）
   - 打包 `.app.zip`：`cd bundle/macos && zip -r -y Axiom_{version}_{arch}.app.zip Axiom.app`
   - 生成 `.sha256`：`shasum -a 256 <zip> | awk '{print $1}' > <zip>.sha256`

### 发布流程

#### 方式 A：手动发布（当前 Beta 阶段推荐）

```bash
# 1. 确认版本号已 bump
cd app && node scripts/bump-version.mjs <new-version>

# 2. 构建产物
npm run tauri -- build

# 3. 打包更新资产
cd src-tauri/target/release/bundle/macos
zip -r -y /tmp/Axiom_<version>_aarch64.app.zip Axiom.app
shasum -a 256 /tmp/Axiom_<version>_aarch64.app.zip | awk '{print $1}' > /tmp/Axiom_<version>_aarch64.app.zip.sha256

# 4. 创建 GitHub Release（更新源仓库）
gh release create v<version> \
  --repo peterfu0615/axiom-update-pusher \
  --title "Axiom <version>" \
  --notes "<changelog>" \
  /tmp/Axiom_<version>_aarch64.app.zip \
  /tmp/Axiom_<version>_aarch64.app.zip.sha256

# 5. 提交版本 bump
cd /Users/Peter/Coding/Axiom
git add app/package.json app/src-tauri/Cargo.toml app/src-tauri/Cargo.lock app/src-tauri/tauri.conf.json
git commit -m "chore: bump version to <version>"
```

#### 方式 B：GitHub Actions 自动发布（Stable 阶段）

1. 配置 Secrets（见 [release.yml](.github/workflows/release.yml)）：
   - `APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD`（签名）
   - `APPLE_ID` / `APPLE_PASSWORD`（公证）
   - `APPLE_TEAM_ID`
2. 打 tag：`git tag v<version> && git push origin v<version>`
3. release.yml 自动触发：构建 → 打包 → 签名 → 公证 → 创建 Release

### 资产命名规范

| 资产 | 命名 | 用途 |
| --- | --- | --- |
| DMG | `Axiom_{version}_{arch}.dmg` | 手动安装 |
| App.zip | `Axiom_{version}_{arch}.app.zip` | 自动更新下载 |
| SHA256 | `Axiom_{version}_{arch}.app.zip.sha256` | 完整性校验 |

`{arch}` 取值：`aarch64`（Apple Silicon）/ `x86_64`（Intel）。

### Beta Release 边界

- **当前为 Beta**：未签名 / 未公证，仅 arm64，用户需手动解除 Gatekeeper。
- **Stable Release 前置条件**：Apple Developer ID 申请 + 签名公证配置 + Acceptance Test 通过。
- 自动更新功能在 Beta 阶段可用（移除 quarantine），但下载无签名校验，存在 MITM 风险。Stable 阶段建议迁移到 Tauri Updater 插件（支持签名校验）。

---

## 6. 版本管理规范

### 版本号策略

遵循 [Semantic Versioning](https://semver.org/)：`MAJOR.MINOR.PATCH`

- **MAJOR**：不兼容的 API 变更（当前 0.x 阶段不使用）
- **MINOR**：新功能（向后兼容），Beta 阶段每次发布递增
- **PATCH**：Bug 修复（向后兼容）

### 版本同步

三个文件的版本号必须一致：

| 文件 | 字段 |
| --- | --- |
| `app/package.json` | `version` |
| `app/src-tauri/Cargo.toml` | `version` |
| `app/src-tauri/tauri.conf.json` | `version` |

**使用脚本同步**（不要手动改）：

```bash
cd app && node scripts/bump-version.mjs <new-version>
```

### Git Tag

- 格式：`v<version>`（如 `v0.1.1`）
- 创建：`git tag v<version>`
- 推送：`git push origin v<version>`

### 更新源仓库

- 仓库：`peterfu0615/axiom-update-pusher`（PUBLIC）
- 用途：托管自动更新 Release 资产，与主仓库分离
- Release tag 与主仓库保持一致
- 资产：`.app.zip` + `.sha256`

---

## 7. 开发工作流

### 本地开发

```bash
cd app
npm install
npm run tauri dev
```

### 代码质量检查（提交前必跑）

```bash
# 前端
cd app && npm run lint && npm run typecheck && npm test

# Rust
cd app/src-tauri && cargo clippy -- -D warnings && cargo fmt -- --check && cargo test --lib
```

### 数据库迁移

- 迁移脚本位于 `app/src-tauri/migrations/`，命名 `XXXX_description.sql`
- 新增迁移时递增编号（当前最大 0015）
- 迁移在应用启动时自动执行（`lib.rs` setup）

### Tauri 命令注册

新增 Rust 命令需在两处注册：

1. `lib.rs` 的 `invoke_handler` 中添加
2. 前端 `platform/native.ts` 中添加 wrapper

**注意**：Tauri v2 命令参数默认不转换命名风格。如果 Rust 用 snake_case（`download_url`），前端传 camelCase（`downloadUrl`），必须加 `#[tauri::command(rename_all = "camelCase")]`，否则参数 missing。同理，返回给前端的 struct 字段如果用 snake_case，需加 `#[serde(rename_all = "camelCase")]`。

### 日志查看

```bash
tail -f ~/Library/Application\ Support/com.axiom.study/logs/axiom.log
```

### 更新脚本日志（自动更新安装过程）

```bash
cat /tmp/axiom-update/install.log
```

---

## 8. 关键约束（交接时必读）

1. **Keychain 优先**：API Key 必须存入 macOS Keychain，不允许明文存数据库。AI 请求由 Rust 内部读取，不回传前端。
2. **Logger 显式目录**：日志目录必须显式设置为 `app_data_dir` 下的 `logs/` 子目录，不接受默认路径。
3. **GitHub Actions 架构检测**：不假设 runner 架构，必须 `uname -m` 检测 arm64 / x86_64。
4. **Acceptance Test**：发布前必须执行真实用户 Acceptance Test（参照 `app/docs/ACCEPTANCE_TEST.md`）。
5. **未签名 DMG = Beta**：未签名构建只能作为 Beta Release，必须明确未来签名公证路线。
6. **Phase 提交拆分**：不允许一次性提交全部 Phase 修改，至少拆为两个稳定性 commit。
7. **AI 任务提交**：AI 完成有文件变更的任务并通过验证后，必须按第 4 节规则创建本地 commit；不得自动 push、打 tag 或发布。

---

## 9. 常见问题

### Q: 自动更新报 `missing required key downloadUrl`

A: Tauri 命令参数命名不匹配。Rust 端加 `#[tauri::command(rename_all = "camelCase")]`，返回的 struct 加 `#[serde(rename_all = "camelCase")]`。

### Q: 更新源仓库返回 404

A: 检查仓库是否 PUBLIC。Private 仓库未认证请求返回 404。

### Q: `current_app_bundle_path` 报错「不是 .app bundle」

A: 自动更新只能在通过 `.app` 安装的版本上运行，不能在 `npm run tauri dev` 开发模式下测试。

### Q: Keychain 迁移失败「no such column: credential_ref」

A: 数据库未执行 migration 0015。确认 `migrations/0015_api_key_credential_ref.sql` 存在且 `lib.rs` 中已注册。

### Q: 日志文件找不到

A: 日志目录是 `~/Library/Application Support/com.axiom.study/logs/`，不是 `~/Library/Logs/`。
